import assert from "node:assert/strict";
import test from "node:test";
import { detectImport, type ExtractedFile } from "../lib/import/detect";
import { absenceLocked, absenceOn, absentShare, affectedWork, countsInPlanning, ABSENCE_LABELS, type Absence } from "../lib/workflow/absence";
import { normalizeCode, statusOf, typeOfCode, sourceSystemKey, systemLabel } from "../lib/payroll/codes";
import { previewAbsenceImport, previewEmployeeNumbers, readAbsenceRows, rowsToWrite, unitsOfRow, type ExistingAbsence, type ImportMember } from "../lib/payroll/absence-import";
import { mapFields } from "../lib/import/detect";
import { ABSENCE_FIELDS, EMPLOYEE_NUMBER_FIELDS } from "../lib/payroll/fields";
import { headingFingerprint, mergeCodeMap, readPayrollSettings } from "../lib/payroll/settings";

const members: ImportMember[] = [
  { userId: "anna", name: "Anna Andersson", email: "anna@example.invalid", employeeNumber: "1001", weeklyWorkMinutes: 2400 },
  { userId: "bo", name: "Bo Berg", email: "bo@example.invalid", employeeNumber: "1002", weeklyWorkMinutes: 1200 },
  { userId: "cia", name: "Cia Ek", email: "cia@example.invalid", employeeNumber: null, weeklyWorkMinutes: 2400 },
];
const HEADERS = ["Anst.nr", "Frånvarokod", "Från", "T.o.m.", "Timmar", "Status", "Id"];
const table = (rows: string[][], headers = HEADERS, name = "franvaro.csv"): ExtractedFile => ({ name, mimeType: "text/csv", size: 100, kind: "table", headers, rows });
const mapping = (file: ExtractedFile) => mapFields(ABSENCE_FIELDS, file.headers ?? []);
const preview = (file: ExtractedFile, existing: ExistingAbsence[] = [], codeMap = {}) => previewAbsenceImport({ rows: readAbsenceRows(file, mapping(file)), members, existing, codeMap, systemKey: "flex_hrm" });
/** What the import would store, as existing records (the second import of the same file sees them). */
const stored = (file: ExtractedFile, existing: ExistingAbsence[] = [], codeMap = {}): ExistingAbsence[] => rowsToWrite(preview(file, existing, codeMap), {}).map((row, index) => ({
  id: `s${index}`, userId: row.unit!.userId, type: row.unit!.type, note: row.unit!.note, from: row.unit!.from, to: row.unit!.to, hours: row.unit!.hours, status: row.unit!.status,
  source: "FILE", externalSystem: "flex_hrm", externalKey: row.unit!.key, externalHash: row.unit!.hash,
}));

test("Frånvaro: flex is its own type; only approved absence counts; imported absence is locked unless the company allows changes", () => {
  assert.equal(ABSENCE_LABELS.FLEX, "Flexledig");
  const base: Absence = { id: "a", userId: "u", type: "VACATION", note: "", from: "2026-11-02", to: "2026-11-02", hours: null, createdBy: "u", createdAt: "", handled: [] };
  assert.equal(countsInPlanning(base), true, "manual absence has no status and counts");
  assert.equal(absenceOn([{ ...base, status: "APPLIED" }], "u", "2026-11-02"), null, "applied does not count");
  assert.equal(absentShare([{ ...base, status: "REJECTED" }], "u", "2026-11-02"), 0);
  assert.equal(affectedWork({ absences: [{ ...base, status: "WITHDRAWN" }], today: "2026-11-01", swedishDay: (iso) => iso.slice(0, 10), workOrders: [],
    bookings: [{ id: "b", title: "B", startsAt: "2026-11-02T07:00:00.000Z", endsAt: "2026-11-02T09:00:00.000Z", userIds: ["u"], status: "PLANNED", href: "/" }] }).length, 0);
  assert.equal(absenceLocked({ source: "MANUAL" }, false), false);
  assert.equal(absenceLocked({ source: "FILE" }, false), true);
  assert.equal(absenceLocked({ source: "API" }, true), false, "the company's setting opens it");
});

test("Koder och status: the company's mapping first, words as suggestions, unknown stays unknown", () => {
  assert.deepEqual(typeOfCode("SEM", { sem: "VACATION" }), { type: "VACATION", suggested: false });
  assert.deepEqual(typeOfCode("Sjukfrånvaro dag 1", {}), { type: "SICK", suggested: true });
  assert.deepEqual(typeOfCode("Vård av barn", {}), { type: "VAB", suggested: true });
  assert.deepEqual(typeOfCode("Flexledig", {}), { type: "FLEX", suggested: true }, "flex is not komp");
  assert.deepEqual(typeOfCode("Kompledigt", {}), { type: "COMP", suggested: true });
  assert.deepEqual(typeOfCode("X17", {}), { type: null, suggested: false });
  assert.equal(normalizeCode("  Sem  Ester "), "sem ester");
  assert.equal(statusOf(""), "APPROVED");
  assert.equal(statusOf("Attesterad"), "APPROVED");
  assert.equal(statusOf("Ej attesterad"), "APPLIED");
  assert.equal(statusOf("Avslagen"), "REJECTED");
  assert.equal(statusOf("Makulerad"), "WITHDRAWN");
  assert.equal(statusOf("kanske"), null);
  assert.equal(sourceSystemKey("none"), "file");
  assert.equal(systemLabel("other", "Lönesystem X"), "Lönesystem X");
  assert.deepEqual(mergeCodeMap({ a: "SICK" }, { " B ": "VACATION", c: "NOPE" }), { a: "SICK", b: "VACATION" }, "keys normalised, unknown types dropped");
});

test("Import: an absence file is recognised and its columns mapped; a staff file too; the other kinds are unchanged", () => {
  const detection = detectImport(table([["1001", "Semester", "2026-11-02", "2026-11-06", "", "Godkänd", "F-1"]]));
  assert.equal(detection.target, "absence");
  assert.equal(detection.mapping.employeeNumber, "Anst.nr");
  assert.equal(detection.mapping.to, "T.o.m.");
  assert.equal(detection.mapping.externalId, "Id");
  const staff = detectImport(table([["1001", "anna@example.invalid", "Anna"]], ["Anställningsnummer", "E-post", "Namn"], "personal.csv"));
  assert.equal(staff.target, "employee_numbers");
  const customers = detectImport(table([["Anna", "Elkraft AB", "anna@example.invalid", "070", "Umeå"]], ["Namn", "Företag", "E-post", "Telefon", "Ort"], "kunder.csv"));
  assert.equal(customers.target, "customers", "a customer list is still a customer list");
  assert.equal(mapFields(EMPLOYEE_NUMBER_FIELDS, ["Anst nr", "Mail"]).email, "Mail");
});

test("Import: new rows, then the same file again changes nothing; a changed row is changed; a missing row is never removed", () => {
  const first = table([["1001", "Semester", "2026-11-02", "2026-11-06", "", "Godkänd", "F-1"], ["1002", "Sjuk", "2026-11-03", "", "", "", "F-2"]]);
  const one = preview(first, [], { semester: "VACATION", sjuk: "SICK" });
  assert.deepEqual(one.counts, { new: 2, changed: 0, unchanged: 0, conflict: 0, ignored: 0, error: 0 });
  // Stored with the mapping above; the same file again: unchanged.
  const savedWithMap = stored(first, [], { semester: "VACATION", sjuk: "SICK" });
  const again = previewAbsenceImport({ rows: readAbsenceRows(first, mapping(first)), members, existing: savedWithMap, codeMap: { semester: "VACATION", sjuk: "SICK" }, systemKey: "flex_hrm" });
  assert.equal(again.counts.unchanged, 2);
  assert.equal(rowsToWrite(again, {}).length, 0, "nothing is written twice");
  // A later file has F-1 one day shorter and no F-2: F-1 changes, F-2 is left as it is (nothing in the plan touches it).
  const later = table([["1001", "Semester", "2026-11-02", "2026-11-05", "", "Godkänd", "F-1"]]);
  const changed = previewAbsenceImport({ rows: readAbsenceRows(later, mapping(later)), members, existing: savedWithMap, codeMap: { semester: "VACATION" }, systemKey: "flex_hrm" });
  assert.equal(changed.counts.changed, 1);
  assert.equal(changed.rows[0].existingId, "s0");
  assert.ok(!changed.rows.some((row) => row.existingId === "s1"), "the missing record is not in the plan, so it stays");
});

test("Import: withdrawn or rejected takes a known record out of planning; applied is kept but does not count; unknown status is an error", () => {
  const first = table([["1001", "Semester", "2026-11-02", "2026-11-06", "", "Ansökt", "F-1"]]);
  const plan = preview(first, [], { semester: "VACATION" });
  assert.equal(plan.counts.new, 1, "applied absence is stored for traceability");
  assert.equal(plan.rows[0].unit!.status, "APPLIED");
  const record: ExistingAbsence = { id: "r1", userId: "anna", type: "VACATION", note: "", from: "2026-11-02", to: "2026-11-06", hours: null, status: "APPROVED", source: "FILE", externalSystem: "flex_hrm", externalKey: "flex_hrm:id:F-1", externalHash: "old" };
  const withdrawn = preview(table([["1001", "Semester", "2026-11-02", "2026-11-06", "", "Makulerad", "F-1"]]), [record], { semester: "VACATION" });
  assert.equal(withdrawn.rows[0].action, "changed");
  assert.equal(withdrawn.rows[0].unit!.status, "WITHDRAWN");
  const unknownRejected = preview(table([["1001", "Semester", "2026-12-01", "", "", "Avslagen", "F-9"]]), [], { semester: "VACATION" });
  assert.equal(unknownRejected.rows[0].action, "ignored", "a rejected absence Workflow never had is not stored");
  assert.equal(preview(table([["1001", "Semester", "2026-12-01", "", "", "kanske", "F-8"]]), [], { semester: "VACATION" }).rows[0].action, "error");
});

test("Import: unknown codes, wrong employee numbers and bad dates are errors with a reason; nothing is matched by name alone", () => {
  const plan = preview(table([
    ["1001", "X17", "2026-11-02", "", "", "", "A"],
    ["9999", "Semester", "2026-11-02", "", "", "", "B"],
    ["1002", "Semester", "31/13/2026", "", "", "", "C"],
    ["", "Semester", "2026-11-02", "", "", "", "D"],
    ["1002", "Semester", "2026-11-09", "2026-11-02", "", "", "E"],
  ]), [], { semester: "VACATION" });
  assert.deepEqual(plan.rows.map((row) => row.action), ["error", "error", "error", "error", "error"]);
  assert.match(plan.rows[0].issues.join(), /X17/);
  assert.match(plan.rows[1].issues.join(), /9999 finns inte/);
  assert.match(plan.rows[2].issues.join(), /kan inte läsas/);
  assert.match(plan.rows[3].issues.join(), /saknar anställningsnummer och e-post/);
  assert.match(plan.rows[4].issues.join(), /före Från/);
  assert.deepEqual(plan.unknownCodes.map((item) => item.code), ["X17"]);
  // By e-mail it works; a member without a number is matched that way.
  const byMail = previewAbsenceImport({ rows: readAbsenceRows(table([["cia@example.invalid", "Sjuk", "2026-11-02"]], ["E-post", "Orsak", "Datum"]), { email: "E-post", code: "Orsak", from: "Datum" }), members, existing: [], codeMap: {}, systemKey: "file" });
  assert.equal(byMail.rows[0].action, "new");
  assert.equal(byMail.rows[0].unit!.userId, "cia");
});

test("Import: a conflict with a manual absence is shown and a person chooses; duplicates in the file are said", () => {
  const manual: ExistingAbsence = { id: "m1", userId: "anna", type: "SICK", note: "", from: "2026-11-03", to: "2026-11-03", hours: null, status: "APPROVED", source: "MANUAL", externalSystem: null, externalKey: null, externalHash: null };
  const file = table([["1001", "Semester", "2026-11-02", "2026-11-06", "", "", "F-1"], ["1001", "Semester", "2026-11-02", "2026-11-06", "", "", "F-1"]]);
  const plan = preview(file, [manual], { semester: "VACATION" });
  assert.equal(plan.rows[0].action, "conflict");
  assert.equal(plan.rows[0].conflict?.id, "m1");
  assert.equal(plan.rows[0].conflict?.manual, true);
  assert.equal(plan.rows[1].action, "error", "the same record twice in the file");
  assert.equal(rowsToWrite(plan, {}).length, 0, "kept by default");
  assert.equal(rowsToWrite(plan, { [plan.rows[0].key]: "replace" }).length, 1, "replaced only on a person's choice");
  // Two rows of the file for the same person and days.
  const overlap = preview(table([["1001", "Semester", "2026-11-02", "2026-11-06", "", "", "F-1"], ["1001", "Sjuk", "2026-11-04", "", "", "", "F-2"]]), [], { semester: "VACATION", sjuk: "SICK" });
  assert.equal(overlap.rows[1].action, "error");
});

test("Import: part of a day – clock times, hours, extent – and the person's own working time", () => {
  const anna = members[0]; const bo = members[1];
  const row = (patch: Partial<ReturnType<typeof readAbsenceRows>[number]>) => ({ index: 0, employeeNumber: "1001", email: "", name: "", code: "Läkare", from: "2026-11-02", to: "2026-11-02", startTime: null, endTime: null, hoursPerDay: null, extent: null, status: "APPROVED" as const, externalId: "", issues: [], ...patch });
  assert.deepEqual(unitsOfRow(row({ startTime: "10:00", endTime: "12:00" }), anna, "LEAVE", "file").units[0].hours, { start: "10:00", end: "12:00" });
  assert.deepEqual(unitsOfRow(row({ hoursPerDay: 2 }), anna, "LEAVE", "file").units[0].hours, { start: "07:00", end: "09:00" });
  assert.equal(unitsOfRow(row({ hoursPerDay: 8 }), anna, "LEAVE", "file").units[0].hours, null, "a full day is the whole day");
  // Bo works half time (4 h a day): 4 hours is his whole day, 50 % is two hours.
  assert.equal(unitsOfRow(row({ hoursPerDay: 4 }), bo, "LEAVE", "file").units[0].hours, null);
  assert.deepEqual(unitsOfRow(row({ extent: 50 }), bo, "PARENTAL", "file").units[0].hours, { start: "07:00", end: "09:00" });
  // Part-time over Fri–Tue: one per workday, each with its own key.
  const split = unitsOfRow(row({ from: "2026-10-30", to: "2026-11-03", extent: 25 }), anna, "PARENTAL", "file").units;
  assert.deepEqual(split.map((unit) => unit.from), ["2026-10-30", "2026-11-02", "2026-11-03"]);
  assert.equal(new Set(split.map((unit) => unit.key)).size, 3);
  assert.equal(unitsOfRow(row({ hoursPerDay: 0 }), anna, "LEAVE", "file").units.length, 0);
  // "Annan orsak" gets the code as its text, never a comment from the file.
  assert.equal(unitsOfRow(row({}), anna, "OTHER", "file").units[0].note, "Läkare");
});

test("Import: a malicious or broken file stays harmless", () => {
  const evil = table([["=cmd|' /C calc'!A0", "=HYPERLINK(\"x\")", "2026-11-02", "", "", "", "<script>"], ["1001", "Semester", "", "", "", "", ""], [], ["1001", "Semester", "2026-11-02", "", "999", "", ""]]);
  const plan = preview(evil, [], { semester: "VACATION" });
  assert.ok(plan.rows.every((row) => row.action === "error"), "an unknown person, a missing date and impossible hours are errors");
  assert.equal(plan.rows.length, 3, "empty rows are skipped");
  const huge = table(Array.from({ length: 1500 }, (_, index) => ["1001", "Semester", `2026-01-${String((index % 28) + 1).padStart(2, "0")}`, "", "", "", `F${index}`]));
  assert.equal(readAbsenceRows(huge, mapping(huge)).length, 1000, "at most 1 000 rows");
});

test("Anställningsnummer: matched by e-mail; a number another member has is a conflict, never moved silently", () => {
  const file = table([["2001", "anna@example.invalid"], ["1001", "cia@example.invalid"], ["3001", "nobody@example.invalid"], ["1002", "bo@example.invalid"]], ["Anställningsnummer", "E-post"]);
  const rows = previewEmployeeNumbers(file, { employeeNumber: "Anställningsnummer", email: "E-post" }, members);
  assert.deepEqual(rows.map((row) => row.action), ["changed", "error", "error", "unchanged"]);
  assert.match(rows[1].issues.join(), /används redan av Anna/);
});

test("Inställningar: a stored row is read safely; templates are found by their headings", () => {
  const settings = readPayrollSettings({ system: "flex_hrm", systemName: "", mode: "weird", importedEditable: false, codeMap: { sem: "VACATION", bad: "NOPE" }, exportCodes: { SICK: "S1" }, importTemplates: "x", exportTemplates: [{ id: "x" }], sftp: { host: "127.0.0.1" }, lastImportAt: null, lastExportAt: null, lastError: "" });
  assert.equal(settings.mode, "manual", "an unknown mode falls back");
  assert.deepEqual(settings.codeMap, {}, "an invalid mapping is dropped whole");
  assert.deepEqual(settings.exportCodes, { SICK: "S1" });
  assert.deepEqual(settings.exportTemplates, []);
  assert.equal(settings.sftp.host, "", "a blocked host is never read back");
  assert.equal(headingFingerprint(["Anst.nr", " Från "]), "anst.nr|från");
});
