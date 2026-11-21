import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { EXPORT_REGISTER, SECRET_COLUMN } from "../lib/kfid/cloud-export-registry";
import { archiveColumns, archiveFileName, archiveTables } from "../lib/kfid/cloud-export-archive";

// The company's export cannot silently fall behind (2026-11-04): every Prisma model is either in the .hwf file, in the sales
// file, in the company archive, or on the explicit list of what stays out, with a reason. A new model fails here until
// somebody has decided which.
const models = Prisma.dmmf.datamodel.models;
const modelNamed = (name: string) => models.find((model) => model.name === name)!;

test("every model is in the export register, and the register names only real models", () => {
  const known = new Set(models.map((model) => model.name));
  const missing = [...known].filter((name) => !(name in EXPORT_REGISTER));
  assert.deepEqual(missing, [], `New model without a decision in lib/kfid/cloud-export-registry.ts: ${missing.join(", ")}. Put it in the export or on the excluded list with a reason.`);
  assert.deepEqual(Object.keys(EXPORT_REGISTER).filter((name) => !known.has(name)), [], "the register names a model that no longer exists");
});

test("every model that belongs to a company is exported or excluded with a real reason", () => {
  const companyModels = models.filter((model) => model.fields.some((field) => field.name === "organizationId"));
  assert.ok(companyModels.length > 100, "the schema was read");
  for (const model of companyModels) {
    const entry = EXPORT_REGISTER[model.name];
    assert.ok(entry, model.name);
    if (entry.status === "excluded") assert.ok(entry.reason.trim().length >= 15, `${model.name} is excluded without a reason`);
  }
});

test("the owner's decision: billing, credits and keys stay out; purchases, absence, maintenance and machine events go in", () => {
  for (const name of ["CreditWallet", "CreditEntry", "BillingInvoice", "CloudSubscription", "BankPayment", "IntegrationKey", "OrganizationDataKey", "OAuthToken", "UserSession", "QuoteLink", "CustomerInvoiceLink"])
    assert.equal(EXPORT_REGISTER[name]?.status, "excluded", `${name} is not exported`);
  for (const name of ["Purchase", "PurchaseLine", "Absence", "TimePeriod", "PayrollIntegration", "MaintenanceItem", "MaintenancePlan", "MachinePart", "StoreItem", "StoreTransaction", "MachineSource", "MachineEvent", "MachineSignal", "StaffRegisterEvent", "OperatorFaultReport", "AdministrationEvent"])
    assert.equal(EXPORT_REGISTER[name]?.status, "archive", `${name} is in the archive`);
  for (const name of ["Quote", "InvoiceBasis", "CustomerInvoice"]) assert.equal(EXPORT_REGISTER[name]?.status, "sales", name);
  for (const name of ["Customer", "Project", "WorkflowTask", "SelfInspectionDeviation"]) assert.equal(EXPORT_REGISTER[name]?.status, "hwf", name);
});

test("an archive table is bound to the company and carries no secret column", () => {
  const folders = new Set<string>();
  for (const { model, entry } of archiveTables()) {
    const fields = modelNamed(model).fields.map((field) => field.name);
    assert.ok(fields.includes("organizationId") || entry.where, `${model} has no company filter`);
    if (entry.where) {
      const where = JSON.stringify(entry.where("ORG-1"));
      assert.ok(where.includes("ORG-1"), `${model}: the filter does not use the company`);
    }
    assert.match(entry.folder, /^[a-z][a-z-]*$/, `${model}: folder name`);
    assert.ok(!folders.has(entry.folder), `${model}: the folder is used twice`);
    folders.add(entry.folder);
    for (const name of [...(entry.omit ?? []), ...(entry.keep ?? [])]) assert.ok(fields.includes(name), `${model}: ${name} is not a column`);
    const columns = archiveColumns(model, entry);
    assert.ok(columns.length > 0, model);
    for (const column of columns) assert.ok(!SECRET_COLUMN.test(column) || entry.keep?.includes(column), `${model}.${column} looks secret and is exported`);
    if (entry.files) assert.ok(columns.includes("storagePath"), `${model}: files need storagePath`);
  }
});

test("secret columns of the archive tables stay out, the masked identity number goes", () => {
  const columnsOf = (model: string) => archiveColumns(model, EXPORT_REGISTER[model] as Parameters<typeof archiveColumns>[1]);
  const person = columnsOf("StaffRegisterPerson");
  assert.ok(!person.includes("idNumberSealed") && !person.includes("idNumberHash") && person.includes("idNumberMasked"));
  const event = columnsOf("StaffRegisterEvent");
  assert.ok(!event.includes("idNumberSealed") && event.includes("idNumberMasked"));
  assert.ok(!columnsOf("MachineSource").includes("secretHash"));
  assert.ok(!columnsOf("OperatorAccount").includes("passwordHash"));
  assert.ok(columnsOf("Purchase").includes("organizationId") && columnsOf("Purchase").includes("status"));
  // A column added to a table follows by itself: the list comes from the model, not from a copy of it.
  assert.deepEqual(columnsOf("Absence").sort(), modelNamed("Absence").fields.filter((field) => field.kind !== "object" && !SECRET_COLUMN.test(field.name) || field.name === "externalHash").map((field) => field.name).sort());
});

test("stored files get safe names inside the zip file", () => {
  assert.equal(archiveFileName("inkop", "cl9x2", "Faktura åäö 1.pdf"), "inkop/filer/cl9x2-Faktura_____1.pdf");
  assert.match(archiveFileName("rapportarkiv", "../../x", "../../../etc/passwd"), /^rapportarkiv\/filer\/x-[A-Za-z0-9._-]+$/);
  assert.ok(!archiveFileName("rapportarkiv", "abc", "..").includes(".."));
  assert.equal(archiveFileName("rapportarkiv", "abc", ""), "rapportarkiv/filer/abc-fil");
});

test("the three export routes keep the same checks: signed-in admin, Cloud company, audit, no caching", () => {
  for (const route of ["export/route.ts", "export/sales/route.ts", "export/archive/route.ts"]) {
    const source = readFileSync(`app/api/cloud-workspace/${route}`, "utf8");
    assert.match(source, /requireCloudStorage\(ctx\)/, route);
    assert.match(source, /requireAdmin\(ctx\)/, route);
    assert.match(source, /auditCompanyExport\(ctx, "(cloud|sales|archive)"\)/, route);
    assert.match(source, /private, no-store/, route);
    assert.ok(!/organizationId:\s*(new URL|searchParams|request)/.test(source), `${route}: the company comes from the session`);
  }
  const archive = readFileSync("app/api/cloud-workspace/export/archive/route.ts", "utf8");
  assert.match(archive, /export async function GET\(\)/, "no request input at all");
});
