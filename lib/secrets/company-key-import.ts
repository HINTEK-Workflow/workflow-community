import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { sealCompanyKey } from "@/lib/integrations/company-keys";
import { externalHint, MAX_ACTIVE_KEYS_PER_KIND } from "@/lib/integrations/keys";
import { ApiError } from "@/lib/kfid/errors";
import { slotOf, type CompanyKeyEntry } from "./company-key-file";

/**
 * Läs in företagets nycklar från en fil (2026-11-26): the chosen entries of a file, written into ONE company – the one
 * the route has checked (actor.organizationId) – and sealed with that company's own data key in this installation. Each kind
 * goes through the same code as when the admin types it in, so the same checks and the same history apply:
 * - a pasted key replaces the active key with the same service and name, or becomes a new one;
 * - Webbplatsen: address, REST address, user and password (lib/website/server.ts; no network call: the REST address is given);
 * - the apps of Facebook och Instagram, LinkedIn and YouTube: id and secret (a changed id disconnects, as by hand – connect again).
 * An entry that is refused (a value that does not look right, the limit of pasted keys) is skipped with the reason; the others
 * are read in. Never a value in a reason, a log or the answer.
 */
export type Actor = { userId: string; organizationId: string };
export type ImportOutcome = { imported: { id: string; label: string }[]; skipped: { id: string; label: string; reason: string }[] };

const reasonOf = (error: unknown) => (error instanceof ApiError && error.status < 500 ? error.message : "Kunde inte sparas.");

async function writeExternal(actor: Actor, entry: Extract<CompanyKeyEntry, { kind: "external" }>) {
  const existing = await prisma.integrationKey.findFirst({
    where: { organizationId: actor.organizationId, kind: "EXTERNAL", provider: entry.provider, name: entry.name, revokedAt: null },
    orderBy: { createdAt: "desc" }, select: { id: true },
  });
  const expiresAt = entry.expiresOn ? new Date(`${entry.expiresOn}T23:59:59Z`) : null;
  if (existing) {
    await prisma.integrationKey.update({ where: { id: existing.id }, data: { encryptedValue: await sealCompanyKey(actor.organizationId, existing.id, entry.value), displayHint: externalHint(entry.value), expiresAt } });
    return;
  }
  const active = await prisma.integrationKey.count({ where: { organizationId: actor.organizationId, kind: "EXTERNAL", revokedAt: null } });
  if (active >= MAX_ACTIVE_KEYS_PER_KIND) throw new ApiError(409, `Företaget har redan ${MAX_ACTIVE_KEYS_PER_KIND} externa nycklar.`);
  const id = randomBytes(12).toString("hex");
  await prisma.integrationKey.create({ data: {
    id, organizationId: actor.organizationId, kind: "EXTERNAL", name: entry.name, provider: entry.provider, displayHint: externalHint(entry.value),
    encryptedValue: await sealCompanyKey(actor.organizationId, id, entry.value), expiresAt, createdById: actor.userId,
  } });
}

async function writeEntry(actor: Actor, entry: CompanyKeyEntry) {
  if (entry.kind === "external") return writeExternal(actor, entry);
  if (entry.kind === "website") {
    const { saveConnection } = await import("@/lib/website/server");
    await saveConnection(actor, { siteUrl: entry.siteUrl, baseUrl: entry.baseUrl, username: entry.username || null, password: entry.password });
    return;
  }
  if (entry.kind === "meta") {
    const { saveMetaConnection } = await import("@/lib/meta/server");
    await saveMetaConnection(actor, { appId: entry.appId, appSecret: entry.appSecret });
    return;
  }
  if (entry.kind === "linkedin") {
    const { saveLinkedInKeys } = await import("@/lib/linkedin/server");
    await saveLinkedInKeys(actor, { clientId: entry.clientId, clientSecret: entry.clientSecret, scopeSet: entry.scopeSet });
    return;
  }
  const { saveYouTubeKeys } = await import("@/lib/youtube/server");
  await saveYouTubeKeys(actor, { clientId: entry.clientId, clientSecret: entry.clientSecret });
}

/** Writes the chosen entries (by id) into the actor's company, one by one. */
export async function importCompanyKeys(actor: Actor, entries: readonly CompanyKeyEntry[], chosen: ReadonlySet<string>): Promise<ImportOutcome> {
  const outcome: ImportOutcome = { imported: [], skipped: [] };
  const slots = new Set<string>();
  for (const entry of entries) {
    if (!chosen.has(entry.id)) continue;
    // One value per place, even if a file were made by hand with the same key twice.
    if (slots.has(slotOf(entry))) { outcome.skipped.push({ id: entry.id, label: entry.label, reason: "Finns två gånger i filen." }); continue; }
    slots.add(slotOf(entry));
    try {
      await writeEntry(actor, entry);
      outcome.imported.push({ id: entry.id, label: entry.label });
    } catch (error) {
      outcome.skipped.push({ id: entry.id, label: entry.label, reason: reasonOf(error) });
    }
  }
  return outcome;
}
