import assert from "node:assert/strict";
import test from "node:test";
import { exportBlockers, exportFileName, exportRefusal, exportRows, PRESET_TEMPLATES, templateNameClash, templateSlug, type ExportAbsence, type ExportPerson, type ExportTemplate, type ExportTimeEntry } from "../lib/payroll/export";
import { paxmlTransactions } from "../lib/payroll/paxml";

// Spärrar i löneexporten (2026-10-31, användartest F5/S5): no file when there is nothing to export, no file to the payroll
// system while a person lacks an employee number or a time type lacks a payroll code, and one file name per template.
const people: ExportPerson[] = [
  { userId: "anna", name: "Anna Andersson", email: "anna@example.invalid", employeeNumber: "1001", weeklyWorkMinutes: 2400 },
  { userId: "bo", name: "Bo Berg", email: "bo@example.invalid", employeeNumber: null, weeklyWorkMinutes: 2400 },
  { userId: "cia", name: "Cia Ek", email: "cia@example.invalid", employeeNumber: "  ", weeklyWorkMinutes: 2400 },
];
const preset = (id: string) => PRESET_TEMPLATES.find((item) => item.id === id)!;
const entry = (userId: string, day: string, minutes: number, timeType: string, timeTypeCode: string): ExportTimeEntry =>
  ({ userId, day, seconds: minutes * 60, project: "", workOrder: "", customer: "", timeType, timeTypeCode });
const absence = (userId: string, from: string, to: string, extra: Partial<ExportAbsence> = {}): ExportAbsence =>
  ({ userId, type: "VACATION", note: "", from, to, hours: null, status: "APPROVED", sourceLabel: "Workflow", externalCode: null, ...extra });
const period = { from: "2026-11-01", to: "2026-11-30" };
const blockOf = (template: ExportTemplate, data: { entries?: ExportTimeEntry[]; absences?: ExportAbsence[]; userIds?: string[] }) => {
  const input = { template, ...period, people, exportCodes: { VACATION: "SEM" }, ...data };
  return exportBlockers({ ...input, rowCount: exportRows(input).length });
};

test("Spärr: an empty period gives no file and says so, in every format", () => {
  for (const id of ["preset-worked-day-type", "preset-absence-period", "preset-absence-review"]) {
    const block = blockOf(preset(id), {});
    assert.deepEqual(block, { empty: true, problems: [] }, id);
    assert.equal(exportRefusal(block), "Inget att exportera för perioden. Ingen fil skapades.");
  }
  const paxml = paxmlTransactions({ ...period, people, entries: [] });
  const block = exportBlockers({ template: preset("preset-paxml"), ...period, people, rowCount: paxml.transactions.length, paxmlProblems: paxml.problems });
  assert.equal(block.empty, true, "PAXml without rows is never a file with only a heading");
  assert.match(exportRefusal(block)!, /^Inget att exportera/);
});

test("Spärr: a person without an employee number and a time type without a payroll code stop the file, each named", () => {
  const block = blockOf(preset("preset-worked-day-type"), { entries: [
    entry("anna", "2026-11-02", 480, "Ordinarie", "TID"), entry("anna", "2026-11-03", 60, "Restid", ""),
    entry("bo", "2026-11-02", 120, "Ordinarie", "TID"), entry("cia", "2026-11-04", 60, "", ""),
  ] });
  assert.equal(block.empty, false);
  assert.deepEqual(block.problems, ["Bo Berg saknar anställningsnummer", "Cia Ek saknar anställningsnummer", "Tidstypen Restid saknar lönekod", "Tidstypen Utan tidstyp saknar lönekod"]);
  const message = exportRefusal(block)!;
  assert.match(message, /^Ingen fil skapades\./);
  assert.ok(message.includes("– Bo Berg saknar anställningsnummer.") && message.includes("– Tidstypen Restid saknar lönekod."));
  assert.ok(message.endsWith("Rätta under Tid → Lön och export."));
});

test("Spärr: only what the file holds is asked for – the period, the chosen people and the template's columns", () => {
  // Outside the period and a person not chosen are not in the file, so they stop nothing.
  const entries = [entry("anna", "2026-11-02", 480, "Ordinarie", "TID"), entry("bo", "2026-10-31", 60, "Ordinarie", "TID"), entry("cia", "2026-11-02", 60, "Restid", "")];
  assert.deepEqual(blockOf(preset("preset-worked-day-type"), { entries, userIds: ["anna"] }), { empty: false, problems: [] });
  // A template without the code column never asks for codes; one without the number column never asks for numbers.
  const worked = preset("preset-worked-day");
  assert.deepEqual(blockOf(worked, { entries }).problems, ["Cia Ek saknar anställningsnummer"]);
  assert.deepEqual(blockOf({ ...worked, columns: [{ field: "name", header: "", value: "" }, { field: "hours", header: "", value: "" }] }, { entries }).problems, []);
  // Per person and day the code column is empty on a day of several types by design: only a type without code stops the file.
  assert.deepEqual(blockOf({ ...worked, columns: [...worked.columns, { field: "timeTypeCode", header: "", value: "" }] }, { entries: [entry("anna", "2026-11-02", 60, "Ordinarie", "TID"), entry("anna", "2026-11-02", 60, "Övertid", "ÖT1")] }).problems, []);
  // Absence: the people with absence in the file; applied absence is not in a file of approved absence.
  const absences = [absence("anna", "2026-11-02", "2026-11-03"), absence("bo", "2026-11-05", "2026-11-05", { status: "APPLIED" }), absence("cia", "2026-11-06", "2026-11-06")];
  assert.deepEqual(blockOf(preset("preset-absence-period"), { absences }).problems, ["Cia Ek saknar anställningsnummer"]);
  // The Excel file is for review: it is made also with gaps.
  assert.deepEqual(blockOf(preset("preset-absence-review"), { absences }), { empty: false, problems: [] });
});

test("Spärr: PAXml stops on its own problems, without the row counts, and long lists are cut", () => {
  const paxml = paxmlTransactions({ ...period, people, entries: [entry("anna", "2026-11-02", 60, "Ordinarie", "TID"), entry("anna", "2026-11-03", 60, "Jour", "XYZ"), entry("bo", "2026-11-02", 60, "Ordinarie", "TID")],
    absences: [absence("anna", "2026-11-04", "2026-11-04", { type: "LEAVE" })] });
  assert.deepEqual(paxml.problems, ["Bo Berg saknar anställningsnummer", "Frånvarotypen Ledig saknar exportkod", "Koden XYZ (tidstypen Jour) är ingen tidkod i PAXml"].sort((a, b) => a.localeCompare(b, "sv")));
  const block = exportBlockers({ template: preset("preset-paxml"), ...period, people, rowCount: paxml.transactions.length, paxmlProblems: paxml.problems });
  assert.equal(block.problems.length, 3);
  assert.ok(!exportRefusal(block)!.includes("rader är inte med"));
  const many = exportRefusal({ empty: false, problems: Array.from({ length: 23 }, (_, index) => `Person ${index} saknar anställningsnummer`) })!;
  assert.equal(many.split("\n").filter((line) => line.startsWith("– Person")).length, 20);
  assert.ok(many.includes("– och 3 till."));
  assert.equal(exportRefusal({ empty: false, problems: [] }), null, "a whole file is made");
});

test("Filnamn: one name per template, format and period; a clashing template name is found", () => {
  const names = PRESET_TEMPLATES.map((template) => exportFileName(template, "2026-11-01", "2026-11-30"));
  assert.equal(new Set(names).size, names.length, names.join(", "));
  assert.equal(exportFileName(preset("preset-worked-entry"), "2026-11-01", "2026-11-30"), "projekttid-per-post-csv-2026-11-01-2026-11-30.csv");
  assert.equal(exportFileName(preset("preset-absence-review"), "2026-11-01", "2026-11-30"), "franvaro-for-granskning-excel-2026-11-01-2026-11-30.xlsx");
  assert.notEqual(exportFileName(preset("preset-worked-day"), "2026-11-01", "2026-11-30"), exportFileName(preset("preset-worked-day"), "2026-12-01", "2026-12-31"));
  assert.equal(templateSlug("  Lön & Ö-tid  "), "lon-o-tid");
  assert.equal(templateSlug("???"), "export");
  assert.ok(templateSlug("x".repeat(80)).length <= 48);
  const own = { id: "own-1", name: "Projekttid per post (CSV)" };
  assert.equal(templateNameClash(own, PRESET_TEMPLATES)?.id, "preset-worked-entry", "the same name as Workflow's template");
  assert.equal(templateNameClash({ id: "own-2", name: "projekttid per post csv" }, [own])?.id, "own-1", "the same file name part, other letters");
  assert.equal(templateNameClash(own, [own]), null, "a template never clashes with itself");
  assert.equal(templateNameClash({ id: "own-3", name: "Projekttid per post (CSV) (egen)" }, PRESET_TEMPLATES), null);
});
