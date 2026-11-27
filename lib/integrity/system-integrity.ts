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
  // Projekttid (2026-10-26): an entry on a project carries its history in the project's company.
  timeEntryProject: `SELECT count(*)::int AS count FROM "WorkflowTimeEntryEvent" e JOIN "WorkflowTimeEntry" w ON w."id" = e."entryId" JOIN "Project" p ON p."id" = w."projectId" WHERE p."organizationId" <> e."organizationId"`,
  // Arbetsordern styr (2026-10-26): no task without its work order, and no time on a task.
  taskWithoutWorkOrder: `SELECT count(*)::int AS count FROM "WorkflowTask" WHERE "kind" <> 'WORK_ORDER' AND "workOrderId" IS NULL`,
  timeOnTask: `SELECT count(*)::int AS count FROM "WorkflowTimeEntry" w JOIN "WorkflowTask" t ON t."id" = w."taskId" WHERE t."kind" <> 'WORK_ORDER'`,
  facilityCustomer: `SELECT count(*)::int AS count FROM "CustomerFacility" f JOIN "Customer" c ON c."id" = f."customerId" WHERE c."organizationId" <> f."organizationId"`,
  facilityLinks: `SELECT ((SELECT count(*) FROM "Project" x JOIN "CustomerFacility" f ON f."id" = x."facilityId" WHERE f."organizationId" <> x."organizationId")
    + (SELECT count(*) FROM "WorkflowTask" x JOIN "CustomerFacility" f ON f."id" = x."facilityId" WHERE f."organizationId" <> x."organizationId")
    + (SELECT count(*) FROM "Control" x JOIN "CustomerFacility" f ON f."id" = x."facilityId" WHERE f."organizationId" <> x."organizationId"))::int AS count`,
  projectDecisionProject:`SELECT count(*)::int AS count FROM "ProjectDecision" d JOIN "Project" p ON p."id" = d."projectId" WHERE p."organizationId" <> d."organizationId"`,
  // Tenant relations (2026-10-08, migration 20261009200000_tenant_composite_relations).
  facilityParent: `SELECT count(*)::int AS count FROM "CustomerFacility" f JOIN "CustomerFacility" p ON p."id" = f."parentId" WHERE p."organizationId" <> f."organizationId"`,
  formScheduleLinks: `SELECT ((SELECT count(*) FROM "FormSchedule" s JOIN "Customer" c ON c."id" = s."customerId" WHERE c."organizationId" <> s."organizationId")
    + (SELECT count(*) FROM "FormSchedule" s JOIN "CustomerFacility" f ON f."id" = s."facilityId" WHERE f."organizationId" <> s."organizationId")
    + (SELECT count(*) FROM "FormSchedule" s JOIN "Project" p ON p."id" = s."projectId" WHERE p."organizationId" <> s."organizationId")
    + (SELECT count(*) FROM "FormSchedule" s JOIN "FormTemplate" t ON t."id" = s."templateId" WHERE t."organizationId" IS NOT NULL AND t."organizationId" <> s."organizationId"))::int AS count`,
  limitProfileFacility: `SELECT count(*)::int AS count FROM "FormLimitProfile" l JOIN "CustomerFacility" f ON f."id" = l."facilityId" WHERE f."organizationId" <> l."organizationId"`,
  roundReminderSchedule: `SELECT count(*)::int AS count FROM "RoundReminderDelivery" d JOIN "FormSchedule" s ON s."id" = d."scheduleId" WHERE s."organizationId" <> d."organizationId"`,
  oauthCodeGrant: `SELECT count(*)::int AS count FROM "OAuthAuthorizationCode" c JOIN "OAuthGrant" g ON g."id" = c."grantId" WHERE g."organizationId" <> c."organizationId" OR g."userId" <> c."userId" OR g."clientId" <> c."clientId"`,
  // Step 2 (migration 20261009300000_tenant_composite_relations_ai_billing).
  aiLinks: `SELECT ((SELECT count(*) FROM "AiRunEvent" e JOIN "AiRun" r ON r."id" = e."runId" WHERE r."organizationId" <> e."organizationId")
    + (SELECT count(*) FROM "AiMessage" m JOIN "AiRun" r ON r."id" = m."runId" WHERE r."organizationId" <> m."organizationId")
    + (SELECT count(*) FROM "AiProposal" p JOIN "AiMessage" m ON m."id" = p."proposedByMessageId" WHERE m."organizationId" <> p."organizationId"))::int AS count`,
  // Workflow's billing tables live in the shared schema (empty in an installation without ee/).
  billingLinks: `SELECT ((SELECT count(*) FROM "BillingOrder" o JOIN "BillingOrder" a ON a."id" = o."amendsOrderId" WHERE a."organizationId" <> o."organizationId")
    + (SELECT count(*) FROM "BillingInvoice" i JOIN "CloudSubscription" s ON s."id" = i."subscriptionId" WHERE s."organizationId" <> i."organizationId")
    + (SELECT count(*) FROM "BillingInvoice" i JOIN "BillingOrder" o ON o."id" = i."orderId" WHERE o."organizationId" <> i."organizationId")
    + (SELECT count(*) FROM "BillingInvoice" i JOIN "BillingInvoice" r ON r."id" = i."replacesInvoiceId" WHERE r."organizationId" <> i."organizationId")
    + (SELECT count(*) FROM "BillingNotice" n JOIN "BillingInvoice" i ON i."id" = n."invoiceId" WHERE i."organizationId" <> n."organizationId")
    + (SELECT count(*) FROM "CloudEntitlement" e JOIN "BillingInvoice" i ON i."id" = e."invoiceId" WHERE i."organizationId" <> e."organizationId")
    + (SELECT count(*) FROM "BillingAdjustment" a JOIN "BillingInvoice" i ON i."id" = a."invoiceId" WHERE i."organizationId" <> a."organizationId")
    + (SELECT count(*) FROM "BillingAdjustment" a JOIN "CreditPurchase" p ON p."id" = a."purchaseId" WHERE p."organizationId" <> a."organizationId"))::int AS count`,
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
      // Certificates on competence cards (2026-10-07).
      ...(await db.selfInspectionCredentialFile.findMany({ select: { id: true, storagePath: true } })).map((item) => ({ ...item, kind: "SelfInspectionCredentialFile" })),
      // Photos on deviation-log entries (2026-10-30).
      ...(await db.selfInspectionDeviationAttachment.findMany({ select: { id: true, storagePath: true } })).map((item) => ({ ...item, kind: "SelfInspectionDeviationAttachment" })),
      // Pictures of machine parts (Underhåll, 2026-10-30).
      ...(await db.machinePartImage.findMany({ select: { id: true, storagePath: true } })).map((item) => ({ ...item, kind: "MachinePartImage" })),
      // Customers' documents (Dokument, 0.87.0); an infected one keeps no file.
      ...(await db.customerDocument.findMany({ where: { storagePath: { not: null } }, select: { id: true, storagePath: true } })).map((item) => ({ id: item.id, storagePath: item.storagePath!, kind: "CustomerDocument" })),
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
