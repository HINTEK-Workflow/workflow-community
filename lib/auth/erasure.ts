import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { remove } from "@/lib/kfid/storage";
import { removeCompanyVideos } from "@/lib/youtube/storage";
import { memoryPseudonyms } from "@/lib/ai/memory";
import { deleteCompetenceCards, deleteCredentialLines } from "@/lib/self-inspection/credentials-server";
import { contentSchema, redactPersonInContent } from "@/lib/self-inspection/model";
import { swedishDayKey } from "@/lib/swedish-time";
import { markRedacted, removeChainedRows } from "@/lib/traceability/chain-server";

/**
 * Radering av personuppgifter (2026-10-03, GDPR art. 17, three levels): a person erases their own account, a
 * company admin erases a member's, and the superadmin erases a whole company.
 *
 * A person is anonymised rather than removed: records in the company point to the user by id, so the name and e-mail
 * disappear everywhere at once while protocols and history the company must keep stay whole ("Borttagen användare").
 * Sign-in, Google links, codes, apps, preferences, invitations and the person's own AI conversations are deleted, and
 * names or addresses in the administration history are replaced. Accounting – invoices, payments, credits and AI
 * usage – is kept for the period the law requires; it points to the company and to the anonymised user.
 */
export const ERASED_NAME = "Borttagen användare";
const erasedEmail = (userId: string) => `borttagen-${userId}@raderad.invalid`;

export class ErasureError extends Error {}

type Tx = Prisma.TransactionClient;

/** Why the person cannot be erased right now, or null. */
export async function erasureBlocker(userId: string, db: Tx | typeof prisma = prisma) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true, organizationMemberships: { where: { isActive: true }, select: { organizationId: true, role: true, organization: { select: { name: true } } } } } });
  if (!user) return "Kontot finns inte.";
  if (user.role === "SUPERADMIN") return "Installationens superadmin kan inte raderas här. Lämna över rollen först.";
  for (const membership of user.organizationMemberships.filter((item) => item.role === "OWNER")) {
    const [owners, others] = await Promise.all([
      db.organizationMember.count({ where: { organizationId: membership.organizationId, role: "OWNER", isActive: true } }),
      db.organizationMember.count({ where: { organizationId: membership.organizationId, isActive: true, userId: { not: userId } } }),
    ]);
    if (owners === 1 && others > 0) return `Du är ensam ägare av ${membership.organization.name}. Gör någon annan till ägare under Användare först.`;
  }
  return null;
}

/**
 * Anonymises one person. Runs inside the caller's transaction; returns what was removed, as counts.
 *
 * Competence cards (2026-10-07): when a person is erased, by an admin or by themselves, the card is kept for three
 * months like the card of a member who was removed (`keepCompetenceCards`), then the nightly job deletes it; when the
 * whole company is erased it goes at once. The stored files of a deleted card are added to `removedFiles`, to be removed from
 * the storage after the transaction has committed.
 */
export async function erasePersonTx(tx: Tx, userId: string, options: { keepCompetenceCards?: boolean; removedFiles?: string[] } = {}) {
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, name: true, organizationMemberships: { select: { organizationId: true } } } });
  const organizations = [...new Set(user.organizationMemberships.map((item) => item.organizationId))];
  const counts = {
    googleAccounts: (await tx.authAccount.deleteMany({ where: { userId } })).count,
    codes: (await tx.verificationToken.deleteMany({ where: { userId } })).count + (await tx.passwordResetToken.deleteMany({ where: { userId } })).count,
    apps: (await tx.oAuthGrant.deleteMany({ where: { userId } })).count + (await tx.oAuthAuthorizationCode.deleteMany({ where: { userId } })).count,
    keys: (await tx.integrationKey.updateMany({ where: { OR: [{ createdById: userId }, { actingUserId: userId }], revokedAt: null }, data: { revokedAt: new Date() } })).count,
    // The person's own AI conversations; one with a proposal stays as its evidence, without the person's name.
    aiConversations: (await tx.aiConversation.deleteMany({ where: { createdById: userId, proposals: { none: {} } } })).count,
    invitations: (await tx.organizationInvitation.deleteMany({ where: { email: user.email, acceptedUserId: null } })).count,
    preferences: (await tx.userPreferences.deleteMany({ where: { userId } })).count,
  };
  // What Workflow AI remembers about the person, per company (stored under a pseudonym).
  await tx.aiMemory.deleteMany({ where: { scope: "USER", subject: { in: organizations.flatMap((organizationId) => memoryPseudonyms(organizationId, userId)) } } });
  // Notiser (2026-10-07): the person's choices, their push devices and the marks of what was sent to them.
  await tx.noticePreference.deleteMany({ where: { userId } });
  await tx.pushSubscription.deleteMany({ where: { userId } });
  await tx.noticeDelivery.deleteMany({ where: { userId } });
  // Kommentarer (2026-11-01): the text stays with the job, without the person's name; a mention of them in others' comments too.
  await tx.comment.updateMany({ where: { authorUserId: userId }, data: { authorUserId: null, authorName: ERASED_NAME } });
  // Säkerhet (2026-10-10): the person's security log, sessions and backup codes; the TOTP secret goes with the user update.
  // The log is chained (Spårbarhet K3, 2026-11-27): the rows go, their links stay as hashes so the chain can still be checked.
  await removeChainedRows(tx, "security", Prisma.sql`"userId" = ${userId}`, "erased");
  await tx.userSession.deleteMany({ where: { userId } });
  await tx.userBackupCode.deleteMany({ where: { userId } });
  // Passkeys (2026-10-11): the public keys and any started ceremony; linked Microsoft accounts went with authAccount.
  await tx.userPasskey.deleteMany({ where: { userId } });
  await tx.webAuthnChallenge.deleteMany({ where: { userId } });
  // Names and addresses written into the administration history of the person's companies.
  for (const text of [user.email, user.name].filter((value): value is string => Boolean(value && value.trim().length >= 3))) {
    await tx.$executeRaw`UPDATE "Comment" SET body = replace(body, ${text}, '[borttagen]'), "authorName" = replace("authorName", ${text}, '[borttagen]') WHERE "organizationId" = ANY(${organizations})`;
    // A rewritten row keeps the hash it was written with, marked as rewritten on purpose (Spårbarhet K3, 2026-11-27).
    await markRedacted(tx, "admin", Prisma.sql`"organizationId" = ANY(${organizations}) AND position(${text} in detail) > 0`);
    await tx.$executeRaw`UPDATE "AdministrationEvent" SET detail = replace(detail, ${text}, '[borttagen]') WHERE "organizationId" = ANY(${organizations}) AND position(${text} in detail) > 0`;
    // Ändringshistoriken names people by id; a name typed into a text (a title, a responsible person's name) goes the same way.
    await markRedacted(tx, "change", Prisma.sql`"organizationId" = ANY(${organizations}) AND position(${text} in "changes") > 0`);
    await tx.$executeRaw`UPDATE "RecordChange" SET "changes" = replace("changes", ${text}, '[borttagen]') WHERE "organizationId" = ANY(${organizations}) AND position(${text} in "changes") > 0`;
  }
  // Egenkontroll (2026-10-06): the authorisation number and level are personal data; the role itself stays with the anonymised person.
  await tx.selfInspectionRoleMember.updateMany({ where: { userId }, data: { authorizationNumber: "", authorizationLevel: "" } });
  // The draft's competence data about the person goes.
  await tx.selfInspectionCompetence.deleteMany({ where: { userId } });
  // Approved versions (2026-10-10): keep only the person's name and role – who was responsible – and lose the
  // authorisation level and competence assessment they froze (lib/self-inspection/model.ts redactPersonInContent).
  await redactSelfInspectionVersions(tx, userId, user.name?.trim() ?? "", organizations);
  // The person's competence card (etapp 3): kept three months when the person is erased, deleted with its files with the company.
  // Kompetenskort v2 (2026-10-08): the rest of the card – groups, driving licence, languages, versions – follows the lines.
  if (options.keepCompetenceCards) {
    await tx.selfInspectionCredential.updateMany({ where: { userId, leftAt: null }, data: { leftAt: new Date() } });
    await tx.selfInspectionCompetenceCard.updateMany({ where: { userId, leftAt: null }, data: { leftAt: new Date() } });
  } else {
    options.removedFiles?.push(...(await deleteCredentialLines(tx, { userId })).files);
    await deleteCompetenceCards(tx, { userId });
  }
  // Their place in assignments goes.
  await tx.selfInspectionAssignment.updateMany({ where: { performerUserId: userId }, data: { performerUserId: null } });
  await tx.selfInspectionAssignment.updateMany({ where: { inspectorUserId: userId }, data: { inspectorUserId: null } });
  // Ej utfört (0.28.0): the history keeps who by id, the written name becomes the erased one (the table allows only that).
  await tx.roundOccurrenceOutcome.updateMany({ where: { userId }, data: { userName: ERASED_NAME } });
  await tx.roundOccurrenceOutcome.updateMany({ where: { revokedById: userId }, data: { revokedByName: ERASED_NAME } });
  await tx.organizationMember.updateMany({ where: { userId }, data: { isActive: false } });
  await tx.user.update({ where: { id: userId }, data: {
    email: erasedEmail(userId), name: ERASED_NAME, image: null, passwordHash: null, isActive: false, emailVerifiedAt: null,
    newsletterOptInAt: null, lastLoginAt: null, passwordChangedAt: new Date(), activeOrganizationId: null,
    totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null, sessionsRevokedAt: new Date(),
  } });
  return counts;
}

/**
 * A member who also works for another company is removed from this one only (2026-10-13): what was personal to them in
 * this company goes too – their own AI conversations (one with a proposal stays as its evidence), what Workflow AI
 * remembers about them here, their imported files, their connected apps, and their keys here are revoked. The account
 * and everything in the other company stay. Returns the stored files to remove after the transaction has committed.
 */
export async function removeMemberDataTx(tx: Tx, organizationId: string, userId: string) {
  const files = (await tx.importedFile.findMany({ where: { organizationId, userId }, select: { storagePath: true } })).map((file) => file.storagePath);
  await tx.importedFile.deleteMany({ where: { organizationId, userId } });
  await tx.aiConversation.deleteMany({ where: { organizationId, createdById: userId, proposals: { none: {} } } });
  await tx.aiMemory.deleteMany({ where: { organizationId, scope: "USER", subject: { in: memoryPseudonyms(organizationId, userId) } } });
  await tx.oAuthAuthorizationCode.deleteMany({ where: { organizationId, userId } });
  await tx.oAuthGrant.deleteMany({ where: { organizationId, userId } });
  await tx.integrationKey.updateMany({ where: { organizationId, OR: [{ createdById: userId }, { actingUserId: userId }], revokedAt: null }, data: { revokedAt: new Date() } });
  return files;
}

/**
 * Egenkontroll och GDPR (2026-10-10): rewrites the approved self-inspection versions of the person's companies that
 * name the person. The database lets a version change only inside this transaction and only its content (and an empty
 * approver's name); number, hash, reason, approver and time stay (migration 20261012130000). How long a version is kept is
 * the company's responsibility as data controller; everything goes when the company is erased (eraseCompany).
 */
async function redactSelfInspectionVersions(tx: Tx, userId: string, name: string, organizations: string[]) {
  if (!organizations.length) return 0;
  const versions = await tx.selfInspectionVersion.findMany({ where: { organizationId: { in: organizations } }, select: { id: true, content: true, approvedById: true, approvedByName: true } });
  const today = swedishDayKey(new Date());
  let changed = 0;
  for (const version of versions) {
    const parsed = contentSchema.safeParse(version.content);
    const content = parsed.success ? redactPersonInContent(parsed.data, userId, name, today) : null;
    const approver = version.approvedById === userId && !version.approvedByName && name ? name : null;
    if (!content && !approver) continue;
    if (!changed) await tx.$executeRawUnsafe("SET LOCAL workflow.self_inspection_erasure = 'on'");
    await tx.selfInspectionVersion.update({ where: { id: version.id }, data: { ...(content ? { content: content as unknown as Prisma.InputJsonValue } : {}), ...(approver ? { approvedByName: approver } : {}) } });
    changed++;
  }
  return changed;
}

// What a company keeps after erasure: accounting the law requires (invoices, payments, credits, AI usage and cost), and
// Workflow's evidence of the terms the company accepted (2026-10-13: kept, anonymised – the person who accepted is
// "Borttagen användare" once erased; only the document, its version, the role and the date remain).
const KEEP = new Set(["Organization", "BillingOrder", "BillingInvoice", "BillingNotice", "BankPayment", "CloudEntitlement", "CloudSubscription",
  "BillingAuditEvent", "CreditPurchase", "BillingAdjustment", "PaymentEvent", "StripeCustomer", "OrganizationBillingPolicy", "PriceChangeNotice",
  "CreditWallet", "CreditExpiryNotice", "AiRun", "AiRunEvent", "LegalAcceptance"]);
/**
 * Personalliggaren (2026-10-09 evening, "läs och exportera kvar"): the register must be kept for its retention
 * time whatever happens to the company, so erasing a company keeps the register rows, the people they name and the
 * projects (building sites) they belong to – the projects emptied of everything but name and register fields. The
 * nightly history:retention job deletes them when the retention time is over (lib/staff-register/server.ts).
 */
const RETAINED_WHERE: Record<string, string> = {
  // Fakturor (owner's decision 2026-11-04): issued invoices and credit invoices stay for seven years counted from the end of the year
  // after their date (lib/customer-invoice/model.ts), the personal number still sealed; lib/customer-invoice/retention-server.ts removes them. Their log, links and series go.
  CustomerInvoice: ` AND FALSE`,
  StaffRegisterEvent: ` AND FALSE`,
  StaffRegisterPerson: ` AND NOT EXISTS (SELECT 1 FROM "StaffRegisterEvent" e WHERE e."personId" = "StaffRegisterPerson"."id")`,
  Project: ` AND NOT EXISTS (SELECT 1 FROM "StaffRegisterEvent" e WHERE e."projectId" = "Project"."id")`,
};

/**
 * Erases a whole company: every work record, file and AI conversation, its own forms, settings and history; members
 * who belong to no other company are anonymised, the others lose the membership. The company row stays, renamed and
 * inactive, so the accounting kept for the law still has its owner.
 */
export async function eraseCompany(organizationId: string, actorId: string) {
  const files: string[] = [];
  const result = await prisma.$transaction(async (tx) => {
    const company = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true, members: { select: { userId: true } } } });
    for (const row of await tx.$queryRaw<{ path: string }[]>`
      SELECT "storagePath" AS path FROM "Attachment" WHERE "organizationId" = ${organizationId}
      UNION ALL SELECT "storagePath" FROM "WorkflowTaskAttachment" WHERE "organizationId" = ${organizationId}
      UNION ALL SELECT "storagePath" FROM "ImportedFile" WHERE "organizationId" = ${organizationId}
      UNION ALL SELECT "storagePath" FROM "GeneratedResult" WHERE "organizationId" = ${organizationId}
      UNION ALL SELECT "storagePath" FROM "SelfInspectionCredentialFile" WHERE "organizationId" = ${organizationId}
      UNION ALL SELECT "storagePath" FROM "SelfInspectionDeviationAttachment" WHERE "organizationId" = ${organizationId}
      UNION ALL SELECT "storagePath" FROM "MachinePartImage" WHERE "organizationId" = ${organizationId}
      UNION ALL SELECT "storagePath" FROM "ReportArchiveEntry" WHERE "organizationId" = ${organizationId}
      UNION ALL SELECT "storagePath" FROM "OperatorFaultPhoto" WHERE "organizationId" = ${organizationId}
      UNION ALL SELECT "storagePath" FROM "BoardImage" WHERE "organizationId" = ${organizationId}
      UNION ALL SELECT "storagePath" FROM "CustomerDocument" WHERE "organizationId" = ${organizationId} AND "storagePath" IS NOT NULL
      UNION ALL SELECT "logoPath" FROM "WorkspaceSettings" WHERE "organizationId" = ${organizationId} AND "logoPath" IS NOT NULL
      UNION ALL SELECT "logoOnDarkPath" FROM "WorkspaceSettings" WHERE "organizationId" = ${organizationId} AND "logoOnDarkPath" IS NOT NULL
      UNION ALL SELECT "logoOnLightPath" FROM "WorkspaceSettings" WHERE "organizationId" = ${organizationId} AND "logoOnLightPath" IS NOT NULL
      UNION ALL SELECT "logoBlackPath" FROM "WorkspaceSettings" WHERE "organizationId" = ${organizationId} AND "logoBlackPath" IS NOT NULL`) files.push(row.path);
    // Members: anonymised when this was their only company.
    let people = 0;
    for (const { userId } of company.members) {
      const others = await tx.organizationMember.count({ where: { userId, organizationId: { not: organizationId }, isActive: true } });
      const role = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
      // The company and everything in it goes, so a person's card is deleted too (their files are in `files` already).
      if (!others && role?.role !== "SUPERADMIN") { await erasePersonTx(tx, userId, { removedFiles: files }); people++; }
    }
    // AI usage is kept as accounting, without the link to the control it read.
    await tx.$executeRaw`UPDATE "AiRun" SET "controlId" = NULL WHERE "organizationId" = ${organizationId}`;
    // The company's own forms (2026-10-13): their published versions carry no organizationId and a trigger keeps them
    // unchangeable, so they are removed here with the same permission as deleting a form (app/api/forms/admin); the form
    // itself and its history go in the passes below. Protocols lose only the reference – they go with the company anyway.
    const ownForms = (await tx.formTemplate.findMany({ where: { organizationId }, select: { id: true } })).map((form) => form.id);
    if (ownForms.length) {
      await tx.$executeRaw`SELECT set_config('hintek.allow_form_delete', 'on', true)`;
      await tx.formTemplateVersion.deleteMany({ where: { templateId: { in: ownForms } } });
    }
    // Every table with the company's id, in passes until nothing more can go (some rows wait for their children).
    let remaining = Prisma.dmmf.datamodel.models.filter((model) => !KEEP.has(model.name) && model.fields.some((field) => field.name === "organizationId")).map((model) => model.name);
    const removed: Record<string, number> = {};
    for (let pass = 0; pass < 8 && remaining.length; pass++) {
      const left: string[] = [];
      for (const table of remaining) {
        await tx.$executeRawUnsafe(`SAVEPOINT erase_step`);
        try {
          const count = await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "organizationId" = $1${RETAINED_WHERE[table] ?? ""}`, organizationId);
          await tx.$executeRawUnsafe(`RELEASE SAVEPOINT erase_step`);
          if (count) removed[table] = (removed[table] ?? 0) + count;
        } catch {
          await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT erase_step`);
          left.push(table);
        }
      }
      remaining = left;
    }
    if (remaining.length) throw new ErasureError(`Kunde inte radera allt (${remaining.join(", ")}). Inget har ändrats.`);
    // The building sites kept for the register keep only what the register shows (name and register fields).
    await tx.$executeRaw`UPDATE "Project" SET "description" = '', "client" = '', "contactPerson" = '', "reference" = '', "workSite" = '', "taskTypes" = '[]', "workMoments" = '[]', "responsibleUserId" = NULL, "responsibleName" = '', "customerId" = NULL, "facilityId" = NULL WHERE "organizationId" = ${organizationId}`;
    // A kept invoice keeps only the document: not who issued it.
    await tx.$executeRaw`UPDATE "CustomerInvoice" SET "createdById" = NULL, "createdByName" = '', "correctedByBasisId" = NULL WHERE "organizationId" = ${organizationId}`;
    const keptRegisterRows = await tx.staffRegisterEvent.count({ where: { organizationId } });
    await tx.organization.update({ where: { id: organizationId }, data: { name: "Raderat företag", slug: `raderat-${organizationId}`, isActive: false, domain: null } });
    const total = Object.values(removed).reduce((sum, count) => sum + count, 0);
    await tx.administrationEvent.create({ data: { actorId, organizationId, action: "company_erased", detail: `Företaget raderades: ${total} poster och ${files.length} filer togs bort, ${people} personer anonymiserades. Bokföringsunderlag behålls enligt lag.${keptRegisterRows ? ` Personalliggaren (${keptRegisterRows} rader) behålls till bevarandetidens slut.` : ""}` } });
    return { name: company.name, records: total, people, files: files.length };
  }, { timeout: 300_000 });
  for (const path of files) await remove(path);
  // The films (Filmer) live in the company's own folder, not under a storagePath (granskningen 2026-11-24 G-18).
  await removeCompanyVideos(organizationId).catch(() => undefined);
  return result;
}
