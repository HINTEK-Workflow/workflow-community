import { access } from "node:fs/promises";
import type { PrismaClient } from "@prisma/client";
import { readCreditWalletInvariant } from "@/lib/credits/wallet-invariant";
import { filePath } from "@/lib/kfid/storage";

export type IntegrityFinding = { check: string; detail: string };
export type IntegrityReport = {
  checkedAt: string;
  wallets: { checked: number; unhealthy: number; testModeWarnings: number };
  tenantReferences: Record<string, number>;
  attachments: { checked: number; missing: number; skipped: boolean };
  findings: IntegrityFinding[];
  /** Test-mode wallets (synthetic QA) are reported but do not make a real environment unhealthy. */
  warnings: IntegrityFinding[];
  healthy: boolean;
};

// Cross-tenant references that the database enforces on new writes; this detects any historical drift.
const tenantReferenceChecks: Record<string, string> = {
  projectCustomer: `SELECT count(*)::int AS count FROM "Project" p JOIN "Customer" c ON c."id" = p."customerId" WHERE c."organizationId" <> p."organizationId"`,
  workflowTaskCustomer: `SELECT count(*)::int AS count FROM "WorkflowTask" t JOIN "Customer" c ON c."id" = t."customerId" WHERE c."organizationId" <> t."organizationId"`,
  controlCustomer: `SELECT count(*)::int AS count FROM "Control" x JOIN "Customer" c ON c."id" = x."customerId" WHERE c."organizationId" <> x."organizationId"`,
  projectEventProject: `SELECT count(*)::int AS count FROM "ProjectEvent" e JOIN "Project" p ON p."id" = e."projectId" WHERE p."organizationId" <> e."organizationId"`,
  timeEntryTask: `SELECT count(*)::int AS count FROM "WorkflowTimeEntryEvent" e JOIN "WorkflowTimeEntry" w ON w."id" = e."entryId" JOIN "WorkflowTask" t ON t."id" = w."taskId" WHERE t."organizationId" <> e."organizationId"`,
  timeEntryControl: `SELECT count(*)::int AS count FROM "WorkflowTimeEntryEvent" e JOIN "WorkflowTimeEntry" w ON w."id" = e."entryId" JOIN "Control" x ON x."id" = w."controlId" WHERE x."organizationId" <> e."organizationId"`,
  facilityCustomer: `SELECT count(*)::int AS count FROM "CustomerFacility" f JOIN "Customer" c ON c."id" = f."customerId" WHERE c."organizationId" <> f."organizationId"`,
  facilityLinks: `SELECT ((SELECT count(*) FROM "Project" x JOIN "CustomerFacility" f ON f."id" = x."facilityId" WHERE f."organizationId" <> x."organizationId")
    + (SELECT count(*) FROM "WorkflowTask" x JOIN "CustomerFacility" f ON f."id" = x."facilityId" WHERE f."organizationId" <> x."organizationId")
    + (SELECT count(*) FROM "Control" x JOIN "CustomerFacility" f ON f."id" = x."facilityId" WHERE f."organizationId" <> x."organizationId"))::int AS count`,
  projectDecisionProject:`SELECT count(*)::int AS count FROM "ProjectDecision" d JOIN "Project" p ON p."id" = d."projectId" WHERE p."organizationId" <> d."organizationId"`,
};

/**
 * Read-only system integrity check: credit wallets, tenant references and stored attachment files.
 * It never repairs anything; findings must be investigated and fixed deliberately.
 */
export async function checkSystemIntegrity(db: PrismaClient, options: { checkFiles?: boolean } = {}): Promise<IntegrityReport> {
  const findings: IntegrityFinding[] = [];
  const warnings: IntegrityFinding[] = [];

  const wallets = await db.creditWallet.findMany({ select: { organizationId: true, testMode: true } });
  let unhealthy = 0;
  let testModeWarnings = 0;
  for (const wallet of wallets) {
    const invariant = await readCreditWalletInvariant(db, wallet.organizationId);
    if (invariant.healthy) continue;
    const finding = { check: "creditWallet", detail: `Organisation ${wallet.organizationId}${wallet.testMode ? " (testläge)" : ""}: saldo ${invariant.balance}, lotter ${invariant.lotBalance}, ledger ${invariant.ledgerBalance}, köpt ${invariant.purchasedBalance}/${invariant.purchasedLotBalance}` };
    if (wallet.testMode) { testModeWarnings += 1; warnings.push(finding); }
    else { unhealthy += 1; findings.push(finding); }
  }

  const tenantReferences: Record<string, number> = {};
  for (const [name, statement] of Object.entries(tenantReferenceChecks)) {
    const [row] = await db.$queryRawUnsafe<{ count: number }[]>(statement);
    tenantReferences[name] = row?.count ?? 0;
    if (tenantReferences[name]) findings.push({ check: "tenantReference", detail: `${name}: ${tenantReferences[name]} rader pekar över organisationsgräns` });
  }

  const attachments = { checked: 0, missing: 0, skipped: !options.checkFiles };
  if (options.checkFiles) {
    const stored = [
      ...(await db.attachment.findMany({ select: { id: true, storagePath: true } })).map((item) => ({ ...item, kind: "Attachment" })),
      ...(await db.workflowTaskAttachment.findMany({ select: { id: true, storagePath: true } })).map((item) => ({ ...item, kind: "WorkflowTaskAttachment" })),
    ];
    for (const item of stored) {
      attachments.checked += 1;
      try { await access(filePath(item.storagePath)); } catch {
        attachments.missing += 1;
        findings.push({ check: "attachmentFile", detail: `${item.kind} ${item.id}: filen saknas i lagringen` });
      }
    }
  }

  return { checkedAt: new Date().toISOString(), wallets: { checked: wallets.length, unhealthy, testModeWarnings }, tenantReferences, attachments, findings, warnings, healthy: findings.length === 0 };
}
