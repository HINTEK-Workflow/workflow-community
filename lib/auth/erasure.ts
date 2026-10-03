import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { remove } from "@/lib/kfid/storage";
import { memoryPseudonym } from "@/lib/ai/memory";

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
    if (owners === 1 && others > 0) return `Du är ensam ägare av ${membership.organization.name}. Gör någon annan till ägare under Företag och användare först.`;
  }
  return null;
}

/** Anonymises one person. Runs inside the caller's transaction; returns what was removed, as counts. */
export async function erasePersonTx(tx: Tx, userId: string) {
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
  await tx.aiMemory.deleteMany({ where: { scope: "USER", subject: { in: organizations.map((organizationId) => memoryPseudonym(organizationId, userId)) } } });
  // Names and addresses written into the administration history of the person's companies.
  for (const text of [user.email, user.name].filter((value): value is string => Boolean(value && value.trim().length >= 3))) {
    await tx.$executeRaw`UPDATE "AdministrationEvent" SET detail = replace(detail, ${text}, '[borttagen]') WHERE "organizationId" = ANY(${organizations}) AND position(${text} in detail) > 0`;
  }
  await tx.organizationMember.updateMany({ where: { userId }, data: { isActive: false } });
  await tx.user.update({ where: { id: userId }, data: {
    email: erasedEmail(userId), name: ERASED_NAME, image: null, passwordHash: null, isActive: false, emailVerifiedAt: null,
    newsletterOptInAt: null, lastLoginAt: null, passwordChangedAt: new Date(), activeOrganizationId: null,
  } });
  return counts;
}

// What a company keeps after erasure: accounting the law requires (invoices, payments, credits, AI usage and cost).
const KEEP = new Set(["Organization", "BillingOrder", "BillingInvoice", "BillingNotice", "BankPayment", "CloudEntitlement", "CloudSubscription",
  "BillingAuditEvent", "CreditPurchase", "BillingAdjustment", "PaymentEvent", "StripeCustomer", "OrganizationBillingPolicy", "PriceChangeNotice",
  "CreditWallet", "CreditExpiryNotice", "AiRun", "AiRunEvent"]);

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
      UNION ALL SELECT "logoPath" FROM "WorkspaceSettings" WHERE "organizationId" = ${organizationId} AND "logoPath" IS NOT NULL`) files.push(row.path);
    // Members: anonymised when this was their only company.
    let people = 0;
    for (const { userId } of company.members) {
      const others = await tx.organizationMember.count({ where: { userId, organizationId: { not: organizationId }, isActive: true } });
      const role = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
      if (!others && role?.role !== "SUPERADMIN") { await erasePersonTx(tx, userId); people++; }
    }
    // AI usage is kept as accounting, without the link to the control it read.
    await tx.$executeRaw`UPDATE "AiRun" SET "controlId" = NULL WHERE "organizationId" = ${organizationId}`;
    // Every table with the company's id, in passes until nothing more can go (some rows wait for their children).
    let remaining = Prisma.dmmf.datamodel.models.filter((model) => !KEEP.has(model.name) && model.fields.some((field) => field.name === "organizationId")).map((model) => model.name);
    const removed: Record<string, number> = {};
    for (let pass = 0; pass < 8 && remaining.length; pass++) {
      const left: string[] = [];
      for (const table of remaining) {
        await tx.$executeRawUnsafe(`SAVEPOINT erase_step`);
        try {
          const count = await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "organizationId" = $1`, organizationId);
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
    await tx.organization.update({ where: { id: organizationId }, data: { name: "Raderat företag", slug: `raderat-${organizationId}`, isActive: false, domain: null } });
    const total = Object.values(removed).reduce((sum, count) => sum + count, 0);
    await tx.administrationEvent.create({ data: { actorId, organizationId, action: "company_erased", detail: `Företaget raderades: ${total} poster och ${files.length} filer togs bort, ${people} personer anonymiserades. Bokföringsunderlag behålls enligt lag.` } });
    return { name: company.name, records: total, people, files: files.length };
  }, { timeout: 300_000 });
  for (const path of files) await remove(path);
  return result;
}
