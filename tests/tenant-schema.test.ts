import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Strict separation of Workflow's global data and the companies' data (2026-10-06): a row with business content
 * always belongs to exactly one organization, so its organization field is required (`String`). An optional one
 * (`String?`) is allowed only here, each with the reason. A new model with an optional organization field stops this
 * test until someone has decided – and written down – why it may exist without a company.
 */
const ALLOWED_OPTIONAL: Record<string, string> = {
  // NULL = one of Workflow's global forms, shown to every company; otherwise exactly one company's own form.
  "FormTemplate.organizationId": "Workflow's global originals have no organization",
  // A legal record of who accepted which terms; user-level terms (e.g. the user agreement) belong to no company, and
  // the record must survive (Restrict) for evidence.
  "LegalAcceptance.organizationId": "acceptance of person-level terms, kept as evidence",
  // A payment provider's webhook record; an event may arrive before (or without) a known organization, and the record
  // stays when the company is removed (SetNull) for the accounts.
  "PaymentEvent.organizationId": "payment provider event log, kept for the accounts",
  // Säkerhetslogg (2026-10-10): a sign-in or a two-factor change is the person's, not a company's; only company events
  // (API keys, the company's rule, an admin's sign-out of a member) carry the company. No business content.
  "SecurityEvent.organizationId": "person-level security events belong to no company",
  // The person's currently chosen company – a pointer for the session, not content.
  "User.activeOrganizationId": "session pointer to the chosen company, not business content",
  // Tavlor etapp 2 (2026-11-18): a screen's ten-minute pairing request belongs to no company until a person approves it.
  "ScreenPairing.organizationId": "a screen's pairing request is anonymous until a company approves it; no business content",
};

function optionalOrganizationFields(schema: string) {
  const found: string[] = [];
  for (const model of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    for (const line of model[2].split("\n")) {
      const field = line.trim().match(/^(\w*[oO]rganizationId)\s+String\?/);
      if (field) found.push(`${model[1]}.${field[1]}`);
    }
  }
  return found;
}

test("every model with business content has a required organization", () => {
  const found = optionalOrganizationFields(readFileSync("prisma/schema.prisma", "utf8"));
  const unexpected = found.filter((field) => !(field in ALLOWED_OPTIONAL));
  assert.deepEqual(unexpected, [], "optional organization field outside the allow-list – make it required or add it with a reason");
  // The list is kept honest: an entry whose field became required (or was removed) is taken out.
  assert.deepEqual(Object.keys(ALLOWED_OPTIONAL).filter((field) => !found.includes(field)), [], "stale allow-list entry");
});

test("the schema check finds an optional organization field", () => {
  const sample = "model Example {\n  id String @id\n  organizationId String?\n  ownerOrganizationId   String?\n  name String\n}\n";
  assert.deepEqual(optionalOrganizationFields(sample), ["Example.organizationId", "Example.ownerOrganizationId"]);
});

/**
 * Tenant relations (security hardening 2026-10-08): a relation from one company's row to another company's row goes
 * through [x, organizationId] -> [id, organizationId], so the database itself refuses a link into another company.
 * A single-column relation between two tenant models is allowed only here, each with what protects it instead. A new
 * single-column tenant relation stops this test until someone has decided – and written down – why.
 */
const SINGLE_COLUMN_TENANT_RELATIONS: Record<string, string> = {
  // SET NULL on the id only (organizationId is required): triggers workflow_assert_customer_tenant / _facility_tenant.
  "Project.customer": "trigger Project_customer_tenant (20260925180000)",
  "Project.facility": "trigger Project_facility_tenant (20260927130000)",
  "WorkflowTask.customer": "trigger WorkflowTask_customer_tenant (20260925180000)",
  "WorkflowTask.facility": "trigger WorkflowTask_facility_tenant (20260927130000)",
  "Control.customer": "trigger Control_customer_tenant (20260925180000)",
  "Control.facility": "trigger Control_facility_tenant (20260927130000)",
  "FormSchedule.customer": "trigger FormSchedule_customer_tenant (20261009200000)",
  "FormSchedule.facility": "trigger FormSchedule_facility_tenant (20261009200000)",
  "SelfInspectionProgram.customer": "trigger SelfInspectionProgram_customer_tenant (20261006120000); egenkontroll register, not changed",
  "SelfInspectionCustomerRequirement.customer": "trigger SelfInspectionCustomerRequirement_customer_tenant; egenkontroll register, not changed",
  // Offert (2026-10-09): SET NULL on the id only, so purging a customer or place, or removing a project, clears the link.
  "Quote.customer": "trigger Quote_customer_tenant (20261011300000)",
  "Quote.facility": "trigger Quote_facility_tenant (20261011300000)",
  "Quote.project": "trigger Quote_project_tenant (20261011300000)",
  // Inköp (2026-10-16): SET NULL on the id only, guarded by triggers like the quote's.
  "Purchase.project": "trigger Purchase_project_tenant (20261016090000)",
  "Purchase.customer": "trigger Purchase_customer_tenant (20261016090000)",
  "Purchase.workOrder": "trigger Purchase_work_order_tenant (20261016090000)",
  // SET NULL on the id only (organizationId is required), Workflow's billing (ee/): trigger from 20261009300000.
  "BillingInvoice.subscription": "trigger BillingInvoice_links_tenant (20261009300000); ee billing",
  "BillingInvoice.order": "trigger BillingInvoice_links_tenant (20261009300000); ee billing",
  "CloudEntitlement.invoice": "trigger CloudEntitlement_invoice_tenant (20261009300000); ee billing",
  // Integrationsmotorn E1 (2026-10-24): SET NULL on the id only, so removing a place keeps the source, its events and its rows.
  "MachineSource.facility": "trigger MachineSource_facility_tenant (20261024160000)",
  "MachineEvent.facility": "trigger MachineEvent_facility_tenant (20261024160000)",
  "MachineAlarmOrder.facility": "trigger MachineAlarmOrder_facility_tenant (20261024160000)",
  // Integrationsmotorn E2: the signal's own object, and the event's code signal (same company and same source).
  "MachineSignal.facility": "trigger MachineSignal_facility_tenant (20261024170000)",
  "MachineEvent.signal": "trigger MachineEvent_signal_tenant (20261024170000), same source as well",
  // Underhåll (2026-10-30): SET NULL on the id only, guarded by same-company triggers (20261031090000).
  "WorkflowTask.machinePart": "trigger WorkflowTask_machine_part_tenant (20261031090000)",
  "MachineSource.machinePart": "trigger MachineSource_machine_part_tenant (20261031090000)",
  "MachineEvent.machinePart": "trigger MachineEvent_machine_part_tenant (20261031090000)",
  "MachineAlarmOrder.machinePart": "trigger MachineAlarmOrder_machine_part_tenant (20261031090000)",
  "MachineSignal.machinePart": "trigger MachineSignal_machine_part_tenant (20261031090000)",
  "MachinePart.customer": "trigger MachinePart_customer_tenant (20261031090000); only a root has a customer (CHECK)",
  "StoreItem.article": "trigger StoreItem_article_tenant (20261031090000); the article may leave with a price file, the item keeps its copy",
  "StoreTransaction.workOrder": "trigger StoreTransaction_work_order_tenant (20261031090000)",
  "StoreTransaction.maintenanceItem": "trigger StoreTransaction_item_tenant (20261031090000)",
  "StoreTransaction.machinePart": "trigger StoreTransaction_machine_part_tenant (20261031090000)",
  "MaintenanceItem.workOrder": "trigger MaintenanceItem_work_order_tenant (20261031090000); removing the order makes the item a draft",
  // Operatörssidan (2026-10-30): SET NULL on the id only, so removing an operator account keeps its fault reports.
  "OperatorFaultReport.account": "trigger OperatorFaultReport_account_tenant (20261030210000)",
  // Dokument (0.87.0): SET NULL on the place id only, so removing a place leaves its documents on the customer.
  "CustomerDocument.place": "trigger customer_document_place_check (20261126120000); same company and same customer",
};

type TenantRelation = { model: string; field: string; target: string; fields: string[]; references: string[] };

function tenantRelations(schema: string) {
  const bodies = new Map([...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map((match) => [match[1], match[2]]));
  const tenant = new Set([...bodies].filter(([, body]) => /^\s+organizationId\s+String\s/m.test(body)).map(([name]) => name));
  const relations: TenantRelation[] = [];
  for (const [model, body] of bodies) {
    if (!tenant.has(model)) continue;
    for (const line of body.split("\n")) {
      const match = line.trim().match(/^(\w+)\s+(\w+)\??\s+@relation\((?:"\w+",\s*)?fields:\s*\[([^\]]*)\],\s*references:\s*\[([^\]]*)\]/);
      if (!match || match[2] === "Organization" || !tenant.has(match[2])) continue;
      const list = (value: string) => value.split(",").map((item) => item.trim());
      relations.push({ model, field: match[1], target: match[2], fields: list(match[3]), references: list(match[4]) });
    }
  }
  return { relations, bodies };
}

test("a relation between two companies' rows carries the organization, or is listed with its protection", () => {
  const { relations } = tenantRelations(readFileSync("prisma/schema.prisma", "utf8"));
  const single = relations.filter((relation) => !relation.fields.includes("organizationId")).map((relation) => `${relation.model}.${relation.field}`);
  assert.deepEqual(single.filter((name) => !(name in SINGLE_COLUMN_TENANT_RELATIONS)), [], "single-column tenant relation outside the allow-list");
  assert.deepEqual(Object.keys(SINGLE_COLUMN_TENANT_RELATIONS).filter((name) => !single.includes(name)), [], "stale allow-list entry");
  // A composite relation pairs organizationId with organizationId.
  for (const relation of relations.filter((item) => item.fields.includes("organizationId")))
    assert.equal(relation.references[relation.fields.indexOf("organizationId")], "organizationId", `${relation.model}.${relation.field}`);
});

test("the relations closed on 2026-10-08 are composite", () => {
  const { relations, bodies } = tenantRelations(readFileSync("prisma/schema.prisma", "utf8"));
  const find = (model: string, field: string) => relations.find((relation) => relation.model === model && relation.field === field);
  for (const [model, field, target] of [
    ["CustomerFacility", "customer", "Customer"], ["CustomerFacility", "parent", "CustomerFacility"],
    ["RoundReminderDelivery", "schedule", "FormSchedule"], ["FormLimitProfile", "facility", "CustomerFacility"],
    ["PlannedActivityAssignment", "member", "OrganizationMember"],
  ]) {
    const relation = find(model, field);
    assert.ok(relation, `${model}.${field} exists`);
    assert.equal(relation.target, target);
    assert.deepEqual(relation.references, ["id", "organizationId"], `${model}.${field} references [id, organizationId]`);
  }
  for (const model of ["Customer", "CustomerFacility", "FormSchedule", "Project", "OrganizationMember"])
    assert.match(bodies.get(model) ?? "", /@@unique\(\[id, organizationId\]\)/, `${model} has @@unique([id, organizationId])`);
  // Step 2 (20261009300000): AI accounting and Workflow's billing.
  for (const [model, field, target] of [
    ["AiRunEvent", "run", "AiRun"], ["AiMessage", "run", "AiRun"], ["AiProposal", "proposedByMessage", "AiMessage"],
    ["BillingOrder", "amendsOrder", "BillingOrder"], ["BillingInvoice", "replacesInvoice", "BillingInvoice"],
    ["BillingNotice", "invoice", "BillingInvoice"], ["BillingAdjustment", "invoice", "BillingInvoice"], ["BillingAdjustment", "purchase", "CreditPurchase"],
  ]) {
    const relation = find(model, field);
    assert.ok(relation, `${model}.${field} exists`);
    assert.equal(relation.target, target);
    assert.deepEqual(relation.references, ["id", "organizationId"], `${model}.${field} references [id, organizationId]`);
  }
  for (const model of ["AiRun", "AiMessage", "BillingOrder", "BillingInvoice", "CreditPurchase"])
    assert.match(bodies.get(model) ?? "", /@@unique\(\[id, organizationId\]\)/, `${model} has @@unique([id, organizationId])`);
  // Återkommande underhåll (20261031100000): a plan's part and an occurrence's plan are composite, so a plan or its work
  // order can never point into another company.
  // Underhåll i två träd (20261101230000, 20261101230100): a machine's place, a place's parent, a store place's parent and an article's store.
  for (const [model, field, target] of [["MaintenancePlan", "part", "MachinePart"], ["WorkflowTask", "maintenancePlan", "MaintenancePlan"], ["MachinePart", "place", "MaintenancePlace"], ["MaintenancePlace", "parent", "MaintenancePlace"], ["StoreLocation", "parent", "StoreLocation"], ["StoreItem", "homeStore", "StoreLocation"]]) {
    const relation = find(model, field);
    assert.ok(relation, `${model}.${field} exists`);
    assert.equal(relation.target, target);
    assert.deepEqual(relation.references, ["id", "organizationId"], `${model}.${field} references [id, organizationId]`);
  }
  assert.match(bodies.get("MaintenancePlan") ?? "", /@@unique\(\[id, organizationId\]\)/, "MaintenancePlan has @@unique([id, organizationId])");
  // OAuth clients register themselves (RFC 7591) and stay global; codes and grants carry the company they were approved for.
  assert.doesNotMatch(bodies.get("OAuthClient") ?? "", /organizationId/);
  for (const model of ["OAuthAuthorizationCode", "OAuthGrant"]) assert.match(bodies.get(model) ?? "", /^\s+organizationId\s+String\s/m, model);
});

for (const [migration, triggers] of [
  ["20261009200000_tenant_composite_relations", ["FormSchedule_customer_tenant", "FormSchedule_facility_tenant", "FormSchedule_links_tenant", "OAuthAuthorizationCode_member", "OAuthGrant_member", "OAuthAuthorizationCode_grant"]],
  ["20261009300000_tenant_composite_relations_ai_billing", ["BillingInvoice_links_tenant", "CloudEntitlement_invoice_tenant", "RoundReminderDelivery_member"]],
] as const) {
  test(`the tenant migration ${migration} checks existing rows before it adds constraints, and never deletes`, () => {
    const sql = readFileSync(`prisma/migrations/${migration}/migration.sql`, "utf8");
    const precheck = sql.indexOf("RAISE EXCEPTION 'Tenant relations");
    assert.ok(precheck > 0, "the pre-check stops on cross-tenant rows");
    assert.ok(precheck < sql.indexOf("ADD CONSTRAINT"), "the pre-check runs before the first constraint");
    assert.ok(precheck < sql.indexOf("CREATE UNIQUE INDEX"), "the pre-check runs before the first index");
    assert.doesNotMatch(sql, /^\s*(DELETE|UPDATE|TRUNCATE)\b/im, "the migration never rewrites or deletes data");
    for (const trigger of triggers) assert.match(sql, new RegExp(`CREATE TRIGGER "${trigger}"`), trigger);
  });
}
