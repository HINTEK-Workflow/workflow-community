// Rättigheter, tid och superadmin (beslut 8–11, 2026-11-01): rules without a database. The integration test
// tests/job-card.integration.ts and the screen test tests/tenant-context-qa.browser.cjs try them on the server.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { linesFromWork, invoiceSourceKeys, timeSourceKey } from "../lib/invoice-basis/model";
import { COMPANY_PAYMENT_LABEL, paymentSumText } from "../lib/kfid/customer-company-list";
import { customerReference, mayPickCustomer } from "../lib/kfid/customer-picker-fields";
import { isErasedCompany, PAUSED_COMPANY_TEXT, pausedCompanyRefusal } from "../lib/kfid/paused-company";
import { requireNotPaused } from "../lib/kfid/server";
import { companyHref, summarizeCompanies } from "../lib/kfid/product-overview";
import { payrollBasis, basisRows } from "../lib/payroll/basis";
import { exportBlockers, exportLeftOut, exportRows, PRESET_TEMPLATES } from "../lib/payroll/export";
import { customerPriceTotals } from "../lib/workflow/material-prices";
import { hasWorkflowPermission, normalizeWorkflowPermissionProfile, workflowPermissionPresets } from "../lib/workflow/permissions";
import { bookedActivityWhere } from "../lib/workflow/project-filters";
import { canArchiveProject } from "../lib/workflow/project-status";
import { defaultTimeTypePolicy, policyOfTimeType, timeBillingLookup, timeCountsAsWork, timeTypeInputSchema, timeTypePoliciesOf, timeTypePolicyText, timeTypesWithPolicy, unbilledTimeTypes, type TimeTypeView } from "../lib/workflow/time-types";

const read = (file: string) => readFileSync(file, "utf8");

// ---------- beslut 8: restid ----------

const type = (id: string, name: string, isDefault = false): TimeTypeView => ({ id, name, payrollCode: "", active: true, isDefault, sortOrder: 0 });
const types = [type("ord", "Ordinarie", true), type("over", "Övertid"), type("res", "Restid"), type("jour", "Jour")];

test("travel is by default a line of its own with its own price and is not worked time; other types stay as they were", () => {
  assert.deepEqual(defaultTimeTypePolicy("Restid"), { billing: "own", price: "", workingTime: false });
  assert.deepEqual(defaultTimeTypePolicy(" restid "), { billing: "own", price: "", workingTime: false });
  assert.deepEqual(defaultTimeTypePolicy("Övertid"), { billing: "company", price: "", workingTime: true });
  assert.deepEqual(policyOfTimeType({ res: { billing: "none", price: "", workingTime: true } }, types[2]), { billing: "none", price: "", workingTime: true }, "what the company has decided counts");
});

test("what is stored and cannot be read falls back to the default; a price must be a number", () => {
  assert.deepEqual(timeTypePoliciesOf({ timeTypePolicies: { a: { billing: "own", price: "450", workingTime: true }, b: { billing: "secret" } } }), { a: { billing: "own", price: "450", workingTime: true } });
  assert.deepEqual(timeTypePoliciesOf(null), {});
  assert.deepEqual(timeTypePoliciesOf({ timeTypePolicies: [] }), {});
  assert.equal(timeTypeInputSchema.safeParse({ name: "Resa", policy: { billing: "own", price: "ett", workingTime: false } }).success, false);
  assert.equal(timeTypeInputSchema.safeParse({ name: "Resa", policy: { billing: "own", price: "450,50", workingTime: false } }).success, true);
  assert.equal(timeTypeInputSchema.parse({ name: "Resa" }).policy, undefined, "an API call without a policy changes nothing");
});

test("a member without the price right gets the billing and the working time but never the price", () => {
  const policies = { res: { billing: "own" as const, price: "450", workingTime: false } };
  assert.equal(timeTypesWithPolicy(types, policies, false).find((item) => item.id === "res")!.policy!.price, "");
  assert.equal(timeTypesWithPolicy(types, policies, true).find((item) => item.id === "res")!.policy!.price, "450");
  assert.equal(timeTypePolicyText(policies.res), "Eget pris 450 kr/h · Inte arbetstid");
  assert.equal(timeTypePolicyText({ billing: "company", price: "", workingTime: true }), "Företagets timpris · Arbetstid");
});

test("invoice basis: travel is its own line with its own price; a type that is not billed is no source; time without a type is the standard type", () => {
  const billing = timeBillingLookup(types, { res: { billing: "own", price: "450", workingTime: false }, jour: { billing: "none", price: "", workingTime: true } });
  const jobs = [{ id: "job", title: "Service", materials: [], entries: [
    { id: "e1", durationSec: 3600, timeTypeId: null }, { id: "e2", durationSec: 1800, timeTypeId: "over" },
    { id: "e3", durationSec: 3600, timeTypeId: "res" }, { id: "e4", durationSec: 7200, timeTypeId: "jour" },
  ] }];
  const built = linesFromWork(jobs, { taken: new Set(), hourlyRate: "700", perJob: false, timeBilling: billing });
  assert.deepEqual(built.lines.map((line) => [line.id, line.name, line.quantity, line.unitPrice]), [["labour:job", "Arbete", "1,5", "700"], ["labour:job:res", "Restid", "1", "450"]]);
  assert.deepEqual(built.sources, [timeSourceKey("e1"), timeSourceKey("e2"), timeSourceKey("e3")], "the on-call time is on no basis");
  assert.equal(built.candidates, 3);
  assert.deepEqual(invoiceSourceKeys(jobs, billing), [timeSourceKey("e1"), timeSourceKey("e2"), timeSourceKey("e3")]);
});

test("invoice basis: a type with its own price but none set stays blank, so the line says it lacks a price instead of billing the hourly rate", () => {
  const built = linesFromWork([{ id: "job", title: "Service", materials: [], entries: [{ id: "e1", durationSec: 3600, timeTypeId: "res" }] }], { taken: new Set(), hourlyRate: "700", perJob: true, timeBilling: timeBillingLookup(types, {}) });
  assert.equal(built.lines[0].name, "Restid – Service");
  assert.equal(built.lines[0].unitPrice, "");
});

test("invoice basis: without the company's rules everything is the job's labour line, as before", () => {
  const built = linesFromWork([{ id: "job", title: "Service", materials: [], entries: [{ id: "e1", durationSec: 3600 }] }], { taken: new Set(), hourlyRate: "700", perJob: false });
  assert.deepEqual(built.lines.map((line) => [line.id, line.name]), [["labour:job", "Arbete"]]);
});

test("the overview's unbilled list and the work order report follow the same rules", () => {
  assert.deepEqual(unbilledTimeTypes(types, { jour: { billing: "none", price: "", workingTime: true } }), { ids: ["jour"], standard: false });
  assert.equal(unbilledTimeTypes(types, { ord: { billing: "none", price: "", workingTime: true } }).standard, true);
  const totals = customerPriceTotals([], 3600, 700, [{ name: "Restid", seconds: 1800, rate: 450 }]);
  assert.equal(totals.total, 925);
  assert.equal(totals.labourMissing, false);
  const missing = customerPriceTotals([], 3600, 700, [{ name: "Restid", seconds: 1800, rate: null }]);
  assert.equal(missing.total, 700);
  assert.equal(missing.labourMissing, true, "the total says that a part of the work lacks a price");
  assert.equal(timeCountsAsWork(types, {}, "res"), false);
  assert.equal(timeCountsAsWork(types, {}, null), true);
});

const person = { userId: "anna", name: "Anna", employeeNumber: "1", email: "a@example.invalid", weeklyWorkMinutes: 2400, noFixedHours: false } as never;
const entry = (day: string, minutes: number, timeType: string, workingTime?: boolean) => ({ userId: "anna", day, seconds: minutes * 60, project: "", workOrder: "", customer: "", timeType, timeTypeCode: timeType.slice(0, 3).toUpperCase(), ...(workingTime === undefined ? {} : { workingTime }) });

test("pay basis: travel is a row of its own and outside the sum of worked time", () => {
  const [anna] = payrollBasis({ from: "2026-11-01", to: "2026-11-30", people: [person], absences: [], statusOf: () => "OPEN", entries: [entry("2026-11-02", 480, "Ordinarie"), entry("2026-11-02", 60, "Restid", false)] });
  assert.equal(anna.workedMinutes, 480);
  assert.equal(anna.otherMinutes, 60);
  const rows = basisRows([anna]);
  assert.ok(rows.some((row) => row[3] === "Annan tid" && row[4] === "Restid" && row[7] === "1,00"), "its own row, still with its hours");
  assert.ok(rows.some((row) => row[3] === "Summa arbetad tid" && row[7] === "8,00"));
  assert.ok(rows.some((row) => row[3] === "Summa annan tid" && row[7] === "1,00"));
});

test("payroll export per day: the day's total is worked time; travel keeps a row of its own with its code", () => {
  const template = { ...PRESET_TEMPLATES.find((item) => item.columns.some((column) => column.field === "timeTypeCode"))!, rowsPer: "day" as const, kind: "worked_time" as const };
  const rows = exportRows({ template, from: "2026-11-01", to: "2026-11-30", people: [person], entries: [entry("2026-11-02", 480, "Ordinarie"), entry("2026-11-02", 60, "Restid", false)] } as never);
  assert.equal(rows.length, 2, "two rows, not one total of nine hours");
  const text = rows.map((row) => row.join("|")).join("\n");
  assert.ok(text.includes("RES"), "the travel row has its code");
  assert.ok(text.includes("8"), "the worked hours alone");
});

test("a file without a column for the type holds worked time only, and the preview says what was left out", () => {
  const template = PRESET_TEMPLATES.find((item) => item.id === "preset-worked-day")!;
  const period = { template, from: "2026-11-01", to: "2026-11-30", people: [person], entries: [entry("2026-11-02", 480, "Ordinarie"), entry("2026-11-02", 90, "Restid", false)] };
  const rows = exportRows(period as never);
  assert.equal(rows.length, 1, "never two rows that look the same for one day");
  assert.equal(rows[0].at(-1), "8,00", "the day's worked time alone");
  const lines = exportLeftOut(period as never);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^Restid \(1,50 h\)/);
  assert.deepEqual(exportLeftOut({ ...period, template: PRESET_TEMPLATES.find((item) => item.id === "preset-worked-day-type")! } as never), [], "a file with the code holds it");
  assert.deepEqual(exportLeftOut({ ...period, template: PRESET_TEMPLATES.find((item) => item.id === "preset-paxml")! } as never), [], "PAXml has its own type on every row");
  const onlyTravel = exportBlockers({ ...period, entries: [entry("2026-11-02", 90, "Restid", false)], people: [{ ...(person as object), employeeNumber: null }], rowCount: 0 } as never);
  assert.deepEqual(onlyTravel, { empty: true, problems: [] }, "a person with only time that is left out needs no number in this file");
});

test("the price report from the work order follows the company's rules for time too", () => {
  assert.ok(read("app/api/workflow-tasks/snapshot-report/route.ts").includes("billedLabour: saved?.billedLabour"));
});

test("saving the price settings keeps what the company decided per type of time", () => {
  const source = read("lib/quotes/server.ts");
  assert.ok(source.includes("timeTypePolicies: timeTypePoliciesOf(row?.priceSettings)"));
});

// ---------- beslut 9: arkivera projekt ----------

const archive = (over: Partial<Parameters<typeof canArchiveProject>[0]> = {}) => canArchiveProject({ admin: false, userId: "me", responsibleUserId: "other", canEditProjects: true, canArchiveProjects: false, ...over });

test("archiving a project: the admin and the responsible member by default, others only with the right", () => {
  assert.equal(archive(), false, "a colleague who may edit projects may not archive");
  assert.equal(archive({ admin: true }), true);
  assert.equal(archive({ responsibleUserId: "me" }), true);
  assert.equal(archive({ canArchiveProjects: true }), true, "the right can be given to more");
  assert.equal(archive({ responsibleUserId: "me", canEditProjects: false }), false, "being responsible never grants anything on its own");
  assert.equal(archive({ responsibleUserId: null }), false);
});

test("the preset Utföra arbete has no right to archive, and only Full åtkomst has", () => {
  for (const preset of workflowPermissionPresets) assert.equal(hasWorkflowPermission(preset.profile as never, "projects", "archive"), preset.id === "full", preset.id);
  assert.match(workflowPermissionPresets.find((preset) => preset.id === "field")!.description, /arkiverar bara projekt där personen är ansvarig/);
  const route = read("app/api/projects/route.ts");
  assert.ok(route.includes("if (!canArchiveProject({ admin: ctx.admin"), "the server decides");
});

// ---------- beslut 10: medarbetare via jobbet ----------

test("without the right Kunder the customer card is the job's limited card; the lists need the right", () => {
  const card = read("app/api/customer-card/route.ts");
  assert.ok(card.includes("if (!mayReadCustomerRegister(ctx)) return NextResponse.json(await jobCustomerCard(ctx, query.id)"), "before anything else is read");
  assert.ok(card.indexOf("jobCustomerCard(ctx, query.id)") < card.indexOf("prisma.customer.findFirst"));
  const places = read("app/api/places/route.ts");
  assert.ok(places.includes('if (!mayReadCustomerRegister(ctx)) throw new ApiError(403, "Du saknar behörighet att se kundregistret.")'));
  assert.ok(places.includes("await limitedPlaceView(ctx, id)"));
});

test("the customer page draws the limited card and does not read a task list from it", () => {
  const page = read("features/kfid/customer-card.tsx");
  assert.ok(page.includes('if (!("limited" in result)) setTasks('));
  assert.ok(page.includes('if ("limited" in data) return <JobCustomerCard'));
});

test("a job means an open job of the person's own, and the machine card is for exactly the job's part", async () => {
  const access = read("lib/kfid/job-access.ts");
  assert.ok(access.includes("status: { notIn: [...CLOSED_TASK_STATUSES] }"), "a closed job opens nothing");
  assert.ok(access.includes("{ assignedToUserId: userId }"));
  assert.ok(access.includes("{ OR: [{ machinePartId: partId }, { maintenanceItems: { some: { organizationId, partId } } }] }"));
  const server = read("lib/maintenance/server.ts");
  const card = server.slice(server.indexOf("export async function jobPartCard"), server.indexOf("export type JobPartCard"));
  for (const hidden of ["notes", "images", "balances", "signals", "partCost", "workOrder"]) assert.ok(!card.includes(hidden), `the card reads no ${hidden}`);
  assert.ok(card.includes("jobOnPartWhere(caller.organizationId, caller.userId, id)"));
});

// ---------- beslut 11: superadmin ----------

const refusal = (method: string | null, over: Partial<Parameters<typeof pausedCompanyRefusal>[0]> = {}) => pausedCompanyRefusal({ method, integration: false, erased: false, allowedWhenPaused: false, ...over });

test("a paused company reads and exports but changes nothing", () => {
  assert.equal(refusal("GET"), null);
  assert.equal(refusal("HEAD"), null);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) assert.deepEqual(refusal(method), { status: 423, message: PAUSED_COMPANY_TEXT }, method);
  assert.equal(refusal(null)?.status, 423, "a request whose method is not known counts as a write");
  assert.equal(refusal("POST", { allowedWhenPaused: true }), null, "a report by POST, the terms and the way to pay");
  assert.equal(refusal("GET", { integration: true })?.status, 403, "keys and machines stop");
  assert.equal(refusal("GET", { erased: true })?.status, 403, "an erased company stays closed");
  assert.equal(isErasedCompany({ slug: "raderat-abc" }), true);
  assert.equal(isErasedCompany({ slug: "alfa" }), false);
});

test("the method comes from the server itself, and pausing no longer signs anybody out of the company", () => {
  const proxy = read("proxy.ts");
  assert.ok(proxy.includes("forwarded.set(REQUEST_METHOD_HEADER, request.method);"), "always set here, never what the browser sent");
  const server = read("lib/kfid/server.ts");
  assert.ok(server.includes("if (ctx.organization.isActive === false) throw new ApiError(423, PAUSED_COMPANY_TEXT);"), "the paused check");
  assert.match(server, /requireCloudWriteAccess[^]*?requireNotPaused\(ctx\);/, "requireCloudWriteAccess says the same");
  const route = read("app/api/superadmin/customer-companies/route.ts");
  assert.ok(!route.includes("activeOrganizationId: null"), "the company stays active for its people, in read mode");
  for (const file of ["lib/auth/config.ts", "lib/auth/oauth.ts", "lib/auth/passkey-sign-in.ts", "lib/auth/microsoft.ts"]) assert.ok(!read(file).includes("organization: { isActive: true }"), `${file}: a person in a paused company can sign in`);
  for (const file of ["app/api/workflow-tasks/snapshot-report/route.ts", "app/api/self-inspection/deviation-export/route.ts", "app/api/legal/route.ts", "ee/api/stripe-portal.ts", "ee/api/stripe-checkout.ts"].filter((file) => !file.startsWith("ee/") || existsSync(file))) assert.ok(read(file).includes("allowedWhenPaused: true"), file);
});

test("the payroll files are reads: a paused company keeps them, and every other action on the route stops", () => {
  const route = read("app/api/payroll/route.ts");
  assert.ok(route.includes("context({ allowedWhenPaused: true })"), "the POST is let in");
  assert.ok(route.includes('new Set(["export_preview", "export", "basis", "basis_file"])'), "exactly the four reads");
  assert.ok(route.includes("if (!READ_ACTIONS.has(input.action)) requireNotPaused(ctx);"), "before any action runs");
  assert.ok(route.indexOf("requireNotPaused(ctx)") < route.indexOf("savePayrollSettings(ctx"));
  assert.throws(() => requireNotPaused({ organization: { isActive: false } }), (error: unknown) => (error as { status?: number }).status === 423);
  assert.doesNotThrow(() => requireNotPaused({ organization: { isActive: true } }));
});

test("the customer picker without Kunder is for someone who can make or change a job", () => {
  const member = (...grants: string[]) => ({ admin: false, workflowPermissions: normalizeWorkflowPermissionProfile({ version: 1, grants }) });
  assert.equal(mayPickCustomer(member()), false, "no rights");
  assert.equal(mayPickCustomer(member("work-order:read")), false, "reading work is not making it");
  assert.equal(mayPickCustomer(member("maintenance:read")), false);
  assert.equal(mayPickCustomer(member("work-order:read", "work-order:create")), true);
  assert.equal(mayPickCustomer(member("projects:read", "projects:edit")), true);
  assert.equal(mayPickCustomer(member("quotes:read", "quotes:edit")), true);
  assert.equal(mayPickCustomer({ admin: true, workflowPermissions: normalizeWorkflowPermissionProfile(null) }), true);
});

test("a customer referred to by a job someone only may read says who it is, and nothing else", () => {
  const seen = customerReference({ id: "k", name: "Kalle", company: "Brf", address: "Gatan 1", postalCode: "123", city: "Elstad", email: "a@example.invalid", phone: "1", mobile: "2", lat: 57, lng: 11, notes: "hemligt", customerType: "COMPANY", version: 1, deletedAt: null });
  assert.equal(seen.name, "Kalle");
  assert.equal(seen.company, "Brf");
  for (const field of ["address", "postalCode", "city", "email", "phone", "mobile", "notes"]) assert.equal(seen[field], "", field);
  assert.ok(!("lat" in seen) && !("lng" in seen));
});

test("without Kunder the customer and place answers go through the limited answers, on the server", () => {
  const workspace = read("app/api/workspace/route.ts");
  assert.ok(workspace.includes("if (!mayReadCustomerRegister(ctx)) return NextResponse.json(await customerChoices(ctx,"), "the list");
  assert.ok(workspace.includes("if (!mayReadCustomerRegister(ctx)) return NextResponse.json(await customerForOwnWork(ctx,"), "one customer");
  assert.ok(read("app/api/records/route.ts").includes("if (!mayPickCustomer(ctx)) return NextResponse.json({ items: []"), "the picker's list");
  assert.ok(read("app/api/places/route.ts").includes("if (!mayReadCustomerRegister(ctx)) return NextResponse.json(await limitedPlaceView(ctx, id)"), "one place");
  assert.ok(read("app/api/workflow-search/route.ts").includes('can("customers") ? listRecords('), "the search the tools share");
  const access = read("lib/kfid/job-access.ts");
  assert.ok(access.includes("bookedActivityWhere(userId)"), "planned means the same as in Mina projekt: assignments count, a cancelled booking does not");
  const booked = bookedActivityWhere("u");
  assert.deepEqual(booked.status, { not: "CANCELED" });
  assert.deepEqual(booked.OR, [{ assignedToUserId: "u" }, { assignments: { some: { member: { userId: "u" } } } }]);
});

const payment = (status: "FAILED" | "OVERDUE" | "PAID", since: string | null, ore = 10_000) => ({ status, problemSince: since, problemOre: ore, nextInvoiceAt: null, nextInvoiceOre: null, lastPaymentAt: null, lastPaymentOre: null });

test("the product overview: figures, new companies and the payments to act on, the failed ones first", () => {
  const now = new Date("2026-11-01T12:00:00Z");
  const company = (id: string, createdAt: string, isActive = true, value: ReturnType<typeof payment> | null = null) => ({ id, name: id.toUpperCase(), isActive, createdAt, payment: value });
  const summary = summarizeCompanies([
    company("gammal", "2025-01-01", true, payment("OVERDUE", "2026-10-01")),
    company("ny", "2026-10-20", false, payment("FAILED", "2026-10-25")),
    company("betald", "2026-10-30", true, payment("PAID", null, 0)),
  ], now, true);
  assert.deepEqual(summary.counts, { total: 3, active: 2, paused: 1 });
  assert.deepEqual(summary.newCompanies.map((item) => item.id), ["betald", "ny"]);
  assert.deepEqual(summary.paymentProblems!.map((item) => [item.id, item.status]), [["ny", "FAILED"], ["gammal", "OVERDUE"]]);
  assert.equal(summarizeCompanies([], now, false).paymentProblems, null, "without ee/ there is no payment card");
  assert.equal(companyHref("a b"), "/?view=customer_companies&companyId=a%20b");
  assert.equal(COMPANY_PAYMENT_LABEL.FAILED, "Misslyckad");
  assert.match(paymentSumText(125_000), /^1.250,00 kr$/);
});

test("the superadmin lands on the overview, core works without ee/, and the overview never reads a customer's work", () => {
  const page = read("app/page.tsx");
  assert.ok(page.includes('preferred === "stats") redirect("/?view=product_overview")'));
  const none = read("lib/extensions/none/server.ts");
  assert.ok(none.includes("companyPayments: async () => ({})") && none.includes("hasPayments: false"));
  const route = read("app/api/superadmin/product-overview/route.ts");
  assert.ok(route.includes('ctx.user.role !== "SUPERADMIN"'));
  for (const table of ["workflowTask", "customer.", "project.", "workflowTimeEntry", "quote."]) assert.ok(!route.includes(`prisma.${table}`), table);
  assert.ok(!/from "@\/ee\//.test(route) && !/from "@\/ee\//.test(read("app/api/superadmin/customer-companies/route.ts")), "core reaches ee/ only through the extension");
});
