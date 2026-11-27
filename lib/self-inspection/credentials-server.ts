import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { remove } from "@/lib/kfid/storage";
import { swedishDayKey } from "@/lib/swedish-time";
import { cardChanged, cardContent, cardContentSchema, cardLanguages, CREDENTIAL_RETENTION_MONTHS, credentialExpired, type CardContent } from "./model";

/**
 * Competence cards in Cloud (2026-10-07): deleting lines with their stored files, and the nightly clean-up of the
 * cards of people who left the company more than three months ago. The files are private attachments in the shared
 * storage (lib/kfid/storage.ts); a line's rows go with it through the database, the bytes are removed here.
 * Kompetenskort v2 (2026-10-08): the rest of the card (groups, driving licence, languages) and its versions follow the
 * same rule, and every save keeps a version of the whole card (`recordCardVersion`).
 */
type Tx = Prisma.TransactionClient;

/** The attached files a card line may have (a limit like the other attachments' count per object, 10 MB each). */
export const CREDENTIAL_FILE_LIMIT = 10;

/** Deletes competence-card lines; returns how many went and the stored files to remove once the transaction has committed. */
export async function deleteCredentialLines(tx: Tx, where: Prisma.SelfInspectionCredentialWhereInput) {
  const files = await tx.selfInspectionCredentialFile.findMany({ where: { credential: where }, select: { storagePath: true } });
  const removed = await tx.selfInspectionCredential.deleteMany({ where });
  return { lines: removed.count, files: files.map((file) => file.storagePath) };
}

/** Deletes the rest of cards (v2) – their group places and versions go with them through the keys. */
export async function deleteCompetenceCards(tx: Tx, where: Prisma.SelfInspectionCompetenceCardWhereInput) {
  return (await tx.selfInspectionCompetenceCard.deleteMany({ where })).count;
}

/** Removes stored files; a file that is already gone is not an error. */
export async function removeStoredFiles(paths: readonly string[]) {
  for (const path of paths) await remove(path);
}

/** One person's whole card as it is stored now (lines, files, groups, driving licence, languages). */
export async function storedCardContent(tx: Tx | typeof prisma, organizationId: string, userId: string) {
  const [card, lines] = await Promise.all([
    tx.selfInspectionCompetenceCard.findUnique({ where: { organizationId_userId: { organizationId, userId } }, include: { groups: { select: { group: { select: { name: true } } } } } }),
    tx.selfInspectionCredential.findMany({ where: { organizationId, userId }, take: 2000, include: { files: { select: { filename: true } } } }),
  ]);
  const content: CardContent = cardContent({
    trainings: lines.map((line) => ({ ...line, files: line.files.map((file) => file.filename) })),
    groups: card?.groups.map((item) => item.group.name) ?? [], licenceClasses: card?.licenceClasses ?? [], licenceValidUntil: card?.licenceValidUntil ?? null, languages: cardLanguages(card?.languages),
  });
  return { card, content, left: Boolean(card?.leftAt || lines.some((line) => line.leftAt)) };
}

/**
 * Every save of a card keeps a version of the whole card (kompetenskort v2, 2026-10-08), in the caller's transaction –
 * unless the save changed nothing, or the person is no member any more (a card kept after leaving stays as it was). The
 * caller holds the company's lock, so the numbers never collide.
 */
export async function recordCardVersion(tx: Tx, input: { organizationId: string; userId: string; actorId: string; change: string }) {
  const { organizationId, userId } = input;
  const member = await tx.organizationMember.findUnique({ where: { organizationId_userId: { organizationId, userId } }, select: { userId: true } });
  if (!member) return null;
  const { card, content, left } = await storedCardContent(tx, organizationId, userId);
  if (left) return null;
  const last = await tx.selfInspectionCompetenceCardVersion.findFirst({ where: { organizationId, userId }, orderBy: { number: "desc" }, select: { number: true, content: true } });
  const previous = last ? cardContentSchema.safeParse(last.content) : null;
  if (previous?.success && !cardChanged(previous.data, content)) return null;
  const ensured = card ?? await tx.selfInspectionCompetenceCard.create({ data: { organizationId, userId, licenceClasses: [] } });
  const number = Math.max(ensured.revision, last?.number ?? 0) + 1;
  await tx.selfInspectionCompetenceCardVersion.create({ data: { organizationId, userId, number, content: content as unknown as Prisma.InputJsonValue, change: input.change.slice(0, 200), savedById: input.actorId } });
  await tx.selfInspectionCompetenceCard.update({ where: { id: ensured.id }, data: { revision: number } });
  return number;
}

export type CredentialPurge = { organizationId: string; cards: number; lines: number; files: number };

/**
 * The nightly job (npm run history:retention): the cards of people who left the company more than three months ago are
 * deleted with their files, versions and groups, and one line without names is written to the company's administration
 * history. A card counts from the day the person left; the exact day is decided by `credentialExpired` (Swedish days), the
 * same rule the page uses to say "Sparas till …". `dryRun` (T5, 2026-10-24) only counts what would go.
 */
export async function purgeExpiredCredentials(now = new Date(), options: { dryRun?: boolean } = {}): Promise<CredentialPurge[]> {
  // Only people who left a good while ago are read; the exact day is decided below.
  const before = new Date(now.getTime() - 80 * 86_400_000);
  const [lines, cards] = await Promise.all([
    prisma.selfInspectionCredential.findMany({ where: { leftAt: { not: null, lt: before } }, select: { organizationId: true, userId: true, leftAt: true }, take: 10_000 }),
    prisma.selfInspectionCompetenceCard.findMany({ where: { leftAt: { not: null, lt: before } }, select: { organizationId: true, userId: true, leftAt: true }, take: 10_000 }),
  ]);
  const today = swedishDayKey(now);
  const byCompany = new Map<string, Set<string>>();
  for (const item of [...lines, ...cards]) if (item.leftAt && credentialExpired(item.leftAt, today)) byCompany.set(item.organizationId, (byCompany.get(item.organizationId) ?? new Set()).add(item.userId));
  const results: CredentialPurge[] = [];
  for (const [organizationId, people] of byCompany) {
    const userIds = [...people];
    if (options.dryRun) {
      const where = { organizationId, userId: { in: userIds }, leftAt: { not: null } } satisfies Prisma.SelfInspectionCredentialWhereInput;
      const [lines, files] = await Promise.all([prisma.selfInspectionCredential.count({ where }), prisma.selfInspectionCredentialFile.count({ where: { credential: where } })]);
      results.push({ organizationId, cards: userIds.length, lines, files });
      continue;
    }
    const removed = await prisma.$transaction(async (tx) => {
      const result = await deleteCredentialLines(tx, { organizationId, userId: { in: userIds }, leftAt: { not: null } });
      await deleteCompetenceCards(tx, { organizationId, userId: { in: userIds }, leftAt: { not: null } });
      const count = userIds.length;
      await tx.administrationEvent.create({ data: { actorId: "system:credential-retention", organizationId, action: "credential_retention",
        detail: `Kompetenskort för ${count} ${count === 1 ? "person" : "personer"} som lämnat företaget raderades efter ${CREDENTIAL_RETENTION_MONTHS} månader: ${result.lines} utbildningar eller intyg och ${result.files.length} filer.` } });
      return { ...result, cards: count };
    }, { timeout: 120_000 });
    await removeStoredFiles(removed.files);
    results.push({ organizationId, cards: removed.cards, lines: removed.lines, files: removed.files.length });
  }
  return results;
}
