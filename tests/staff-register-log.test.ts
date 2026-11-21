import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  checkProblem, controlCsv, controlPeriod, controlRows, deserializeIdNumber, effectiveEvents, employerOrgNumber, formatIdNumber, idNumberFrom,
  isLate, maskIdNumber, onSite, parseSwedishIdNumber, personState, registerTime, retentionCutoff, serializeIdNumber, staffRegisterAccess,
  StaffRegisterError, type RegisterEvent,
} from "../lib/staff-register/model";
import { keepsWorkflowRegister, STAFF_REGISTER_SITE_ID_NEEDED, staffRegisterInputSchema, staffRegisterReminder, staffRegisterRows } from "../lib/workflow/staff-register";
import { defaultWorkflowPermissionProfile, normalizeWorkflowPermissionProfile, workflowPermissionMatrix } from "../lib/workflow/permissions";
import { archiveReadableSubjects } from "../lib/workflow/report-archive";
import { createLocalWorkspace, saveLocalProjectRecord } from "../features/kfid/local-workspace-store";
import { swedishDate } from "../lib/swedish-time";

// Personalliggare, steg 1 (2026-10-09): the pure rules of the register.

const today = new Date("2026-10-11T10:00:00Z");

test("personnummer and samordningsnummer are checked with their date and Luhn digit and kept as twelve digits", () => {
  assert.deepEqual(parseSwedishIdNumber("19811218-9876", today), { kind: "PERSONNUMMER", digits: "198112189876" });
  assert.deepEqual(parseSwedishIdNumber("811218-9876", today), { kind: "PERSONNUMMER", digits: "198112189876" }, "ten digits get the century");
  assert.deepEqual(parseSwedishIdNumber("8112189876", today), { kind: "PERSONNUMMER", digits: "198112189876" });
  assert.deepEqual(parseSwedishIdNumber("811218+9876", today), { kind: "PERSONNUMMER", digits: "188112189876" }, "+ means a hundred years or more");
  assert.deepEqual(parseSwedishIdNumber("701063-2391", today), { kind: "SAMORDNINGSNUMMER", digits: "197010632391" }, "day + 60 is a samordningsnummer");
  for (const bad of ["811218-9875", "19811318-9876", "19810231-1234", "abc", "", "19811218+9876", "1981121-89876"]) assert.equal(parseSwedishIdNumber(bad, today), null, bad);
});

test("an identity number is shown masked everywhere but the Kontrollvy and export, and stored with its kind", () => {
  const swedish = idNumberFrom({ idNumber: "811218-9876" }, today);
  assert.equal(formatIdNumber(swedish), "19811218-9876");
  assert.equal(maskIdNumber(swedish), "19811218-••••");
  assert.deepEqual(deserializeIdNumber(serializeIdNumber(swedish)), swedish);
  const foreign = idNumberFrom({ idNumber: " pl 1234-5678 ", foreign: true });
  assert.deepEqual(foreign, { kind: "FOREIGN", value: "PL1234-5678" });
  assert.equal(maskIdNumber(foreign), "••••78");
  assert.throws(() => idNumberFrom({ idNumber: "811218-9875" }), StaffRegisterError);
  assert.throws(() => idNumberFrom({ idNumber: "x", foreign: true }), StaffRegisterError);
  assert.equal(deserializeIdNumber("garbage"), null);
});

test("the employer's number is an org.nr or a sole trader's personnummer", () => {
  assert.equal(employerOrgNumber("5560360793"), "556036-0793");
  assert.equal(employerOrgNumber("556036-0793"), "556036-0793");
  assert.equal(employerOrgNumber("19811218-9876"), "811218-9876");
  assert.throws(() => employerOrgNumber("556036-0794"), /organisationsnummer/);
  assert.throws(() => employerOrgNumber(""), /organisationsnummer/);
});

const at = (time: string) => new Date(`2026-10-11T${time}Z`);
function event(id: string, personId: string, kind: RegisterEvent["kind"], occurred: string, registered = occurred, correctsId: string | null = null, reason = ""): RegisterEvent {
  return { id, personId, personName: personId === "p1" ? "Anna Andersson" : "Bo Berg", idNumber: personId === "p1" ? "19811218-9876" : "19701063-2391", employerName: "Elfirman AB", employerOrgNo: "556036-0793",
    kind, occurredAt: at(occurred), registeredAt: at(registered), registeredByName: "Anna Andersson", correctsId, reason, siteId: "AB12-3456" };
}

test("corrections replace their original when the register is read, the latest correction wins and VOID strikes it", () => {
  const events = [
    event("a", "p1", "IN", "05:00:00"),
    event("b", "p2", "IN", "05:10:00"),
    event("c", "p1", "OUT", "13:00:00"),
    event("d", "p1", "OUT", "14:00:00", "14:05:00", "c", "Fel tid"),
    event("e", "p1", "OUT", "14:30:00", "14:40:00", "c", "Fel tid igen"),
    event("f", "p2", "VOID", "05:10:00", "06:00:00", "b", "Fel person"),
  ];
  const effective = effectiveEvents(events);
  assert.deepEqual(effective.map((item) => [item.id, item.kind, item.occurredAt.toISOString().slice(11, 19)]), [["a", "IN", "05:00:00"], ["c", "OUT", "14:30:00"]]);
  assert.equal(events.length, 6, "nothing is removed from the rows themselves");
  assert.deepEqual(onSite(events, at("12:00:00")).map((item) => item.personId), ["p1"], "p2's check-in was struck");
  assert.deepEqual(onSite(events, at("15:00:00")), [], "after the corrected check-out nobody is on site");
  assert.deepEqual(personState(events, "p1", at("12:00:00")), { onSite: true, since: at("05:00:00") });
  assert.deepEqual(personState(events, "p2", at("12:00:00")), { onSite: false, since: null });
});

test("a double tap never makes two rows, and a time long ago counts as late and needs a reason", () => {
  assert.equal(checkProblem({ onSite: true }, "IN", true), "Du är redan incheckad.");
  assert.equal(checkProblem({ onSite: false }, "OUT", false), "Personen är inte incheckad.");
  assert.equal(checkProblem({ onSite: false }, "IN", true), null);
  assert.equal(checkProblem({ onSite: true }, "OUT", true), null);
  assert.equal(isLate(at("07:00:00"), at("07:10:00")), false);
  assert.equal(isLate(at("07:00:00"), at("07:16:00")), true);
});

test("the register's times are written ÅÅÅÅ:MM:DD TT:MM:SS in Swedish time", () => {
  assert.equal(registerTime(new Date("2026-10-11T05:52:14Z")), "2026:10:11 07:52:14", "summer time");
  assert.equal(registerTime(new Date("2026-12-01T23:05:09Z")), "2026:12:02 00:05:09", "winter time, the next Swedish day");
});

test("the Kontrollvy lists every row, numbered in registration order, with each correction right under its original", () => {
  const rows = controlRows([
    event("c", "p1", "OUT", "13:00:00"),
    event("a", "p1", "IN", "05:00:00"),
    event("d", "p1", "OUT", "14:00:00", "14:05:00", "c", "Fel tid"),
    event("x", "p2", "IN", "13:30:00"),
  ]);
  assert.deepEqual(rows.map((row) => [row.number, row.kind, row.corrects, row.corrected]), [[1, "In", "", false], [2, "Ut", "", true], [4, "Ut", "2", false], [3, "In", "", false]]);
  assert.equal(rows[0].idNumber, "19811218-9876");
  assert.equal(rows[0].time, "2026:10:11 07:00:00");
  assert.equal(rows[2].reason, "Fel tid");
});

test("the CSV export has the business, the site id and every row, and cannot start a formula", () => {
  const csv = controlCsv({ company: "Elfirman AB", companyOrgNo: "556036-0793", siteId: "AB12-3456", project: "Laddplatser", from: "2026-10-11", to: "2026-10-11" },
    [event("a", "p1", "IN", "05:00:00"), { ...event("b", "p2", "IN", "06:00:00"), personName: "=HYPERLINK(1)" }]);
  assert.ok(csv.startsWith("﻿"), "Excel reads it as UTF-8");
  assert.match(csv, /"Näringsidkare";"Elfirman AB, org.nr 556036-0793"/);
  assert.match(csv, /"Byggarbetsplatsens id-nr";"AB12-3456"/);
  assert.match(csv, /"1";"AB12-3456";"Anna Andersson";"19811218-9876";"Elfirman AB";"556036-0793";"In";"2026:10:11 07:00:00";"2026:10:11 07:00:00";"Anna Andersson";"";""/);
  assert.match(csv, /"'=HYPERLINK\(1\)"/);
  assert.equal(csv.split("\r\n").filter(Boolean).length, 7, "four head lines, the headings and two rows");
});

test("a Kontrollvy period is today by default, in order and at most 92 days", () => {
  const period = controlPeriod(null, null, "2026-10-11");
  assert.equal(period.from, "2026-10-11");
  assert.equal(period.startAt.toISOString(), swedishDate(2026, 10, 11).toISOString());
  assert.equal(period.endAt.toISOString(), swedishDate(2026, 10, 12).toISOString());
  assert.equal(controlPeriod("2026-10-01", "2026-10-11", "2026-10-11").to, "2026-10-11");
  assert.throws(() => controlPeriod("2026-10-11", "2026-10-01", "2026-10-11"), /före startdatumet/);
  assert.throws(() => controlPeriod("2026-01-01", "2026-10-11", "2026-10-11"), /högst 92 dagar/);
  assert.equal(controlPeriod("nonsense", null, "2026-10-11").from, "2026-10-11");
});

test("rows are kept until 1 January of the third year after their year (two years after the tax year, also a broken one)", () => {
  assert.equal(retentionCutoff(new Date("2029-12-31T12:00:00Z")).toISOString(), swedishDate(2026, 1, 1).toISOString());
  assert.equal(retentionCutoff(new Date("2030-01-01T00:30:00+01:00")).toISOString(), swedishDate(2027, 1, 1).toISOString(), "a 2026 row goes on 1 January 2030");
  const migration = readFileSync("prisma/migrations/20261011200000_staff_register_log/migration.sql", "utf8");
  assert.match(migration, /BEFORE UPDATE OR DELETE ON "StaffRegisterEvent"/, "the database refuses changes");
  assert.match(migration, /extract\(year FROM \(now\(\) AT TIME ZONE 'UTC'\)\)::int - 2/, "and deletes only rows from before 1 January two years back");
  assert.match(migration, /NEW\."registeredAt" := \(now\(\) AT TIME ZONE 'UTC'\)/, "registration time is the server's");
});

test("everyone who may read the project checks in; the Kontrollvy and registering others are their own rights", () => {
  const member = (grants: string[]) => ({ admin: false, permissions: normalizeWorkflowPermissionProfile({ version: 1, grants }) });
  assert.deepEqual(staffRegisterAccess(member(["projects:read"])), { self: true, control: false, others: false });
  assert.deepEqual(staffRegisterAccess(member([])), { self: false, control: false, others: false });
  assert.deepEqual(staffRegisterAccess(member(["projects:read", "staff-register:read"])), { self: true, control: true, others: false });
  assert.deepEqual(staffRegisterAccess(member(["projects:read", "staff-register:read", "staff-register:edit"])), { self: true, control: true, others: true });
  assert.deepEqual(staffRegisterAccess({ admin: true, permissions: normalizeWorkflowPermissionProfile(null) }), { self: true, control: true, others: true });
  assert.deepEqual(workflowPermissionMatrix["staff-register"], ["read", "edit"]);
  assert.ok(defaultWorkflowPermissionProfile().grants.includes("staff-register:edit"), "Full åtkomst includes it");
  assert.equal(normalizeWorkflowPermissionProfile({ version: 1, grants: ["staff-register:edit"] }).grants.length, 0, "edit needs read");
  assert.ok(!archiveReadableSubjects(() => true).includes("staff-register"), "no reports are archived under it");
});

test("the project's responsible person opens the Kontrollvy of that project only (2026-10-09)", () => {
  const member = (userId: string, grants: string[]) => ({ userId, admin: false, permissions: normalizeWorkflowPermissionProfile({ version: 1, grants }) });
  const theirs = { responsibleUserId: "u-lead" };
  const lead = member("u-lead", ["projects:read"]);
  assert.deepEqual(staffRegisterAccess(lead, theirs), { self: true, control: true, others: false }, "the Kontrollvy, but not registering others");
  assert.equal(staffRegisterAccess(lead, { responsibleUserId: "u-other" }).control, false, "another project's register stays closed");
  assert.equal(staffRegisterAccess(lead, { responsibleUserId: null }).control, false, "a project without a responsible person");
  assert.equal(staffRegisterAccess(lead).control, false, "without a project only the company-wide right counts");
  assert.equal(staffRegisterAccess(member("u-plain", ["projects:read"]), theirs).control, false, "a plain member sees only their own rows");
  assert.equal(staffRegisterAccess({ admin: false, permissions: normalizeWorkflowPermissionProfile({ version: 1, grants: ["projects:read"] }) }, { responsibleUserId: "" }).control, false, "no user id never matches");
  assert.equal(staffRegisterAccess(member("u-reader", ["projects:read", "staff-register:read"]), { responsibleUserId: "u-other" }).control, true, "the read right covers every project");
  assert.equal(staffRegisterAccess({ ...member("u-admin", []), admin: true }, { responsibleUserId: "u-other" }).control, true, "admins too");
});

test("the staff register routes are exempt from the payment block, and only they (2026-10-09)", () => {
  const routes = readFileSync("lib/staff-register/routes.ts", "utf8");
  assert.doesNotMatch(routes.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, ""), /requireCloudWriteAccess\(/, "no write-access gate in the register's handlers");
  assert.match(routes, /legal duty on the building site/, "the exemption says why");
  const post = routes.slice(routes.indexOf("export async function staffRegisterPost"), routes.indexOf("export async function staffRegisterExport"));
  assert.match(post, /checkOrigin\(request\);\s*const ctx = await load\(\);\s*const caller = staffRegisterCaller\(ctx\);/, "Origin and the session are still checked first");
  for (const file of ["app/api/staff-register/route.ts", "app/api/staff-register/export/route.ts"])
    assert.doesNotMatch(readFileSync(file, "utf8"), /requireCloudWriteAccess|context\(/, `${file} only hands over to the handler`);
  assert.match(readFileSync("app/api/workflow-tasks/route.ts", "utf8"), /await requireCloudWriteAccess\(ctx\)/, "work orders and tasks still follow the payment block");
});

test("a project keeps the register in Workflow only with its site id; Local files never do", () => {
  const base = { required: true, siteId: "AB12-3456", builder: "Brf Exempel", system: "Huvudentreprenörens system" };
  const parsed = staffRegisterInputSchema.parse({ ...base, inWorkflow: true });
  assert.deepEqual(parsed, { ...base, inWorkflow: true, system: "" }, "the system on site is not kept beside Workflow's register");
  assert.equal(keepsWorkflowRegister({ staffRegister: parsed }), true);
  assert.equal(staffRegisterReminder({ staffRegister: parsed }), "Checka in i personalliggaren.");
  assert.deepEqual(staffRegisterRows({ staffRegister: parsed })[0], ["Personalliggare", "Förs i Workflow"]);
  const missing = staffRegisterInputSchema.safeParse({ ...base, siteId: "", inWorkflow: true });
  assert.equal(missing.success, false);
  assert.equal(missing.error?.issues[0]?.message, STAFF_REGISTER_SITE_ID_NEEDED);
  assert.equal(keepsWorkflowRegister({ staffRegister: { ...parsed, required: false } }), false);
  assert.equal(keepsWorkflowRegister(undefined), false);
  const local = saveLocalProjectRecord(createLocalWorkspace({ id: "org-local", name: "Lokal" }), { name: "Bygge", description: "", startDate: "2026-10-01", dueDate: "2026-12-31", customerId: null, staffRegister: { ...base, inWorkflow: true } });
  assert.equal(local.project.staffRegister?.inWorkflow, false, "a Local file keeps only steg 0");
});
