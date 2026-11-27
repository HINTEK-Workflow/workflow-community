import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createFormProtocolPdf } from "../lib/workflow/form-report";
import { defaultWorkflowReportOptions } from "../lib/workflow/report";
import { drawingText, pdfDrawing } from "./helpers/pdf-drawing";
import { BUILTIN_FORMS } from "../lib/workflow/builtin-forms";
import { kfidFormDocument } from "../lib/workflow/builtin-kfid-form";
import { companyValueBlank, companyValueSource, mergeCompanyValues, type CompanyValue } from "../lib/workflow/company-values";
import { evaluateForm, formFillLimitFields, formLeafBlocks, formMissingLimit, formRowStarted, initialFormValues, newFormRow, validateFormDocument, type FormTableBlock } from "../lib/workflow/form-document";
import { resolveFormLimits } from "../lib/workflow/form-limits";
import { createLocalWorkspace, parseLocalWorkspace, saveLocalCompanyValues } from "../features/kfid/local-workspace-store";

/** Värden och referenser (2026-10-06): the company's own values, shared by key, filled in where they are used. */
const value = (key: string, fields: Partial<CompanyValue>): CompanyValue => ({ key, low: null, high: null, warnLow: null, warnHigh: null, source: "", reference: "", version: 1, updatedByName: "", ...fields });
const table = (key: string) => formLeafBlocks(kfidFormDocument).find((block): block is FormTableBlock => block.type === "table" && block.key === key)!;

test("the protocol's limits: the object's, then the facility's, then the company's value, then the form's – with where it came from", () => {
  const company = [value("isolation_min", { low: 1, source: "Företagets rutin", reference: "utgåva 2" })];
  const resolved = resolveFormLimits(kfidFormDocument, [], null, "", company);
  assert.deepEqual(resolved.isolation_min, { low: 1, high: null, warnLow: null, warnHigh: null, source: "Företagets rutin, utgåva 2", origin: "company" });
  assert.equal(resolved.continuity_max.origin, "form", "a limit the company has not entered stays empty");
  const facility = [{ facilityId: "f1", objectName: "", values: { isolation_min: { low: 2, high: null, warnLow: null, warnHigh: null, source: "Anläggningens tillstånd" } } }];
  assert.equal(resolveFormLimits(kfidFormDocument, facility, "f1", "", company).isolation_min.origin, "facility");
  assert.equal(resolveFormLimits(kfidFormDocument, facility, "f2", "", company).isolation_min.origin, "company", "another facility takes the company's value");
  assert.equal(companyValueSource({ source: "", reference: "" }), "");
});

test("a limit column starts with the company's value on a new row, can be changed per row, and is no measurement of its own", () => {
  const iso = table("iso");
  const limits = resolveFormLimits(kfidFormDocument, [], null, "", [value("isolation_min", { low: 0.5 })]);
  const row = newFormRow(iso, "r1", { limitValue: (key) => limits[key]?.low ?? limits[key]?.high ?? null });
  assert.equal(row.cells.limit, 0.5);
  assert.equal(formRowStarted(iso, row), false, "an added, untouched row with only its limit does not count");
  assert.equal(newFormRow(iso, "e1", { example: true, limitValue: () => 9 }).cells.limit, undefined, "the example row keeps its own values");
  const values = initialFormValues(kfidFormDocument);
  values.sections["kfid-iso"] = true;
  values.limits = limits;
  values.tables.iso = [{ ...row, cells: { ...row.cells, objekt: "Grupp 1", mohm: 0.4 } }];
  assert.equal(evaluateForm(kfidFormDocument, values).cells.iso.r1.ok, false);
  values.tables.iso[0].cells.limit = 0.3;
  assert.equal(evaluateForm(kfidFormDocument, values).cells.iso.r1.ok, true, "the row's own limit decides");
});

test("the marking replaces the label rule; a form without any marking still uses the label", () => {
  const iso = table("iso");
  const ok = iso.columns.find((column) => column.key === "ok")!;
  const started = { id: "r", label: "", cells: { objekt: "Grupp 1", mohm: 3 } };
  assert.equal(formMissingLimit(iso, ok, started)?.key, "limit");
  const renamed: FormTableBlock = { ...iso, columns: iso.columns.map((column) => column.key === "limit" ? { ...column, label: "Lägsta värde" } : column) };
  assert.equal(formMissingLimit(renamed, ok, started)?.key, "limit", "marked: the label does not matter");
  const unmarked: FormTableBlock = { ...renamed, columns: renamed.columns.map((column) => ({ ...column, limitDefault: undefined })) };
  assert.equal(formMissingLimit(unmarked, ok, started), null, "unmarked and not named as a limit: an ordinary number");
  const older: FormTableBlock = { ...iso, columns: iso.columns.map((column) => ({ ...column, limitDefault: undefined })) };
  assert.equal(formMissingLimit(older, ok, started)?.key, "limit", "an older form: Gräns in the label still counts");
});

test("limit fields of a protocol are filled in from the company's values, a value the person entered stays", () => {
  const followWire = BUILTIN_FORMS.find((form) => form.id === "hintek-foljelinematning-ebr")!.document;
  const limits = resolveFormLimits(followWire, [], null, "", [value("kvot_skarm_max", { high: 0.6 }), value("kvot_jord_min", { low: 0.2 })]);
  const values = initialFormValues(followWire);
  assert.deepEqual(formFillLimitFields(followWire, values, limits), { ...values.fields, grans_skarm: 0.6, grans_jord: 0.2 });
  values.fields.grans_skarm = 0.7;
  assert.equal(formFillLimitFields(followWire, values, limits).grans_skarm, 0.7);
});

test("the form builder's marking is checked: the limit must exist and the field must be a number", () => {
  const document = structuredClone(kfidFormDocument);
  const iso = formLeafBlocks(document).find((block): block is FormTableBlock => block.type === "table" && block.key === "iso")!;
  iso.columns.find((column) => column.key === "limit")!.limitDefault = "saknas";
  iso.columns.find((column) => column.key === "objekt")!.limitDefault = "isolation_min";
  const issues = validateFormDocument(document).issues.map((issue) => issue.message);
  assert.ok(issues.includes("Isolation, Gräns (MΩ): gränsvärdet saknas som fyller i värdet finns inte."), issues.join("; "));
  assert.ok(issues.includes("Isolation, Krets / objekt: bara ett talfält kan fyllas i från ett gränsvärde."), issues.join("; "));
});

test("Local: an older file without values opens with none, and the values are kept in the file", () => {
  const organization = { id: "org-local", name: "Lokalt AB" };
  const older = createLocalWorkspace(organization) as Record<string, unknown>;
  delete older.companyValues;
  const opened = parseLocalWorkspace(older, organization.id);
  assert.deepEqual(opened.companyValues, []);
  const saved = saveLocalCompanyValues(opened, [{ key: "isolation_min", low: 1, high: null, warnLow: null, warnHigh: null, source: "Egen rutin", reference: "" }], "Ägaren");
  assert.equal(parseLocalWorkspace(JSON.parse(JSON.stringify(saved)), organization.id).companyValues[0].source, "Egen rutin");
});

const pdfText = async (templateName: string, document: typeof kfidFormDocument, values: ReturnType<typeof initialFormValues>) => drawingText(await pdfDrawing(await createFormProtocolPdf({
  identity: { company: "QA AB" }, fontBytes: new Uint8Array(readFileSync("public/fonts/DejaVuSans.ttf")), options: defaultWorkflowReportOptions,
  task: { id: "t", kind: "FORM", title: "QA", description: "", status: "IN_PROGRESS", progress: 50, assignedToName: "", dueDate: "", totalDurationSec: 0, attachments: [],
    data: { kind: "FORM", details: { templateName, templateVersion: 1, document, values } } } }))).join(" ");

test("Kontroll före idrifttagning keeps its original report: the company's value stands on the row, no extra section", async () => {
  const values = initialFormValues(kfidFormDocument);
  values.fields.proj = "QA central";
  values.sections["kfid-iso"] = true;
  values.limits = resolveFormLimits(kfidFormDocument, [], null, "", [value("isolation_min", { low: 1, source: "Företagets egen rutin", reference: "2026-01" })]);
  values.tables.iso = [{ id: "r1", label: "", cells: { objekt: "Grupp 1", u: "500 V", mohm: 250, limit: 1 } }];
  const text = await pdfText("Kontroll före idrifttagning", kfidFormDocument, values);
  assert.ok(text.includes("Grupp 1"));
  assert.ok(!text.includes("Gränsvärden"), "no Gränsvärden section in the control's report");
});

test("a form that judges by its limits says in the PDF where each limit came from and the company's source", async () => {
  const thermography = BUILTIN_FORMS.find((form) => form.id === "hintek-termografering")!.document;
  const values = initialFormValues(thermography);
  values.limits = resolveFormLimits(thermography, [], null, "", [value("delta_ref", { high: 30, warnHigh: 10, source: "Företagets egen rutin", reference: "2026-01" })]);
  const text = await pdfText("Termografering", thermography, values);
  for (const part of ["Gränsvärden", "ΔT mot referens", "Företagets egen rutin, 2026-01", "Företaget"]) assert.ok(text.replace(/\s+/g, " ").includes(part), part);
});

test("saving values: a stale version is refused, a blank row removes the value, the newest version wins", () => {
  const first = mergeCompanyValues([], [{ key: "zs_max", low: null, high: 1.2, warnLow: null, warnHigh: null, source: "Egen tabell", reference: "" }], "Admin", "2026-10-06T10:00:00.000Z");
  assert.deepEqual(first, [{ key: "zs_max", low: null, high: 1.2, warnLow: null, warnHigh: null, source: "Egen tabell", reference: "", version: 1, updatedAt: "2026-10-06T10:00:00.000Z", updatedByName: "Admin" }]);
  const second = mergeCompanyValues(first, [{ key: "zs_max", low: null, high: 1.1, warnLow: null, warnHigh: null, source: "Egen tabell", reference: "", version: 1 }], "Admin");
  assert.equal(second[0].version, 2);
  assert.throws(() => mergeCompanyValues(second, [{ key: "zs_max", low: null, high: 1, warnLow: null, warnHigh: null, source: "", reference: "", version: 1 }], "Annan"), /ändrats av någon annan/);
  assert.deepEqual(mergeCompanyValues(second, [{ key: "zs_max", low: null, high: null, warnLow: null, warnHigh: null, source: "", reference: "", version: 2 }], "Admin"), []);
  assert.equal(companyValueBlank({ low: null, high: null, warnLow: null, warnHigh: null, source: "Källa", reference: "" }), false, "a source alone is kept");
  assert.throws(() => mergeCompanyValues([], [{ key: "x", low: 5, high: 1, warnLow: null, warnHigh: null, source: "", reference: "" }], "Admin"));
});
