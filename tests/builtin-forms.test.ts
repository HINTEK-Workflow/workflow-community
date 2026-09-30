import assert from "node:assert/strict";
import test from "node:test";
import { BUILTIN_FORMS } from "../lib/workflow/builtin-forms";
import { evaluateForm, formCompletion, formDocumentSchema, formPlacedImageIds, formRowLabel, initialFormValues, validateFormDocument, type FormTableBlock } from "../lib/workflow/form-document";
import { evaluateFormula, parseFormula } from "../lib/workflow/form-formula";
import { formPublishChecks } from "../lib/workflow/form-publish";
import { sampleFormValues } from "../lib/workflow/form-sample";
import { createWorkflowPdfReport, defaultWorkflowReportOptions } from "../lib/workflow/report";
import { readFileSync } from "node:fs";

const byId = (id: string) => BUILTIN_FORMS.find((form) => form.id === id)!;
const table = (id: string, key: string) => byId(id).document.blocks.flatMap((block) => block.type === "section" ? block.blocks : []).find((block): block is FormTableBlock => block.type === "table" && block.key === key)!;

test("built-in forms: four inspection types that validate and can be published", () => {
  assert.deepEqual(BUILTIN_FORMS.map((form) => form.meta.name), ["Termografering", "Fortlöpande kontroll", "Isolationsmätning – EBR", "Följelinemätning – EBR"]);
  for (const form of BUILTIN_FORMS) {
    assert.deepEqual(validateFormDocument(form.document).issues, [], form.meta.name);
    assert.deepEqual(formPublishChecks(form.meta, form.document, null).errors, [], form.meta.name);
    // Stored JSON round-trips unchanged, so the migration's hash matches the server's.
    assert.deepEqual(formDocumentSchema.parse(JSON.parse(JSON.stringify(form.document))), form.document);
  }
});

test("built-in forms: no invented limit values – requirements are entered per measurement", () => {
  for (const id of ["hintek-isolationsmatning-ebr", "hintek-foljelinematning-ebr"]) for (const block of byId(id).document.blocks.flatMap((section) => section.type === "section" ? section.blocks : [])) {
    if (block.type === "field") assert.equal(block.min === null && block.max === null, true, `${block.label} has no deviation interval`);
    if (block.type === "table") for (const column of block.columns) assert.equal(column.min === null && column.max === null, true, `${column.label} has no deviation interval`);
  }
  const insulation = byId("hintek-isolationsmatning-ebr").document;
  const values = initialFormValues(insulation);
  values.tables.matningar = [
    { id: "r1", label: "", cells: { objekt: "K1", matning: "L1–PE", spanning: "500 V", uppmatt: 250, krav: 1 } },
    { id: "r2", label: "", cells: { objekt: "K1", matning: "L2–PE", spanning: "500 V", uppmatt: "0,4", krav: 1 } },
    { id: "r3", label: "", cells: { objekt: "K2", matning: "L1–PE", spanning: "500 V", uppmatt: 90 } },
  ];
  const result = evaluateForm(insulation, values);
  assert.equal(result.computed.lagsta, 0.4);
  assert.equal(result.computed.underkanda, 1);
  assert.equal(result.computed.resultat, "Avvikelse");
  assert.equal(result.deviations.length, 1);
  assert.match(result.deviations[0].message, /Isolationsmätningar, K1: Godkänd är inte uppfyllt/);
  values.tables.matningar = values.tables.matningar.filter((row) => row.id !== "r2");
  assert.equal(evaluateForm(insulation, values).computed.resultat, "Krav saknas för någon mätning");
});

test("object cards: row names, choice deviations, pictures per object and completion", () => {
  const thermography = byId("hintek-termografering").document;
  const objects = table("hintek-termografering", "objekt");
  assert.equal(objects.layout, "cards");
  const values = initialFormValues(thermography);
  values.tables.objekt = [
    { id: "o1", label: "", cells: { objekt: "Central A1, grupp 12", maxtemp: 68, reftemp: 31, last: 12, markstrom: 16, bedomning: "Åtgärda omgående", termobild: ["att-1"], foto: ["att-2"] } },
    { id: "o2", label: "", cells: { objekt: "", maxtemp: 30, reftemp: 29, bedomning: "Ingen anmärkning" } },
  ];
  const result = evaluateForm(thermography, values);
  assert.equal(result.cells.objekt.o1.deltat, 37);
  assert.equal(result.cells.objekt.o1.lastgrad, 75);
  assert.equal(result.computed.omgaende, 1);
  assert.equal(formRowLabel(objects, values.tables.objekt[0], 0), "Central A1, grupp 12");
  assert.equal(formRowLabel(objects, values.tables.objekt[1], 1), "Objekt 2");
  assert.deepEqual(result.deviations.map((item) => item.message), ["Termograferade objekt, Central A1, grupp 12: Bedömning – Åtgärda omgående."]);
  assert.deepEqual([...formPlacedImageIds(thermography, values)].sort(), ["att-1", "att-2"]);
  const completion = formCompletion(thermography, values);
  // Required values are asked for row by row, like the control (2026-09-27).
  assert.ok(completion.issues.some((item) => item.message === "Termograferade objekt, Objekt 2: fyll i objekt / position."), "the unnamed object must be named");
});

test("EDATUM gives the next inspection date and clamps to the month's last day", () => {
  const run = (source: string, refs: Record<string, string | number | null>) => evaluateFormula(parseFormula(source), { ref: (name) => refs[name] });
  assert.equal(run("EDATUM(d; m)", { d: "2026-09-26", m: 12 }), "2027-09-26");
  assert.equal(run("EDATUM(d; m)", { d: "2026-01-31", m: 1 }), "2026-02-28");
  assert.equal(run("EDATE(d; m)", { d: "2026-11-15", m: 3 }), "2027-02-15");
  assert.equal(run("EDATUM(d; m)", { d: null, m: 3 }), null);
  const recurring = byId("hintek-fortlopande-kontroll").document;
  const values = initialFormValues(recurring);
  assert.equal(values.fields.intervall, 12, "12 months is the default interval");
  values.fields.kontrolldatum = "2026-09-26";
  assert.equal(evaluateForm(recurring, values).computed.nasta, "2027-09-26");
});

test("PDF: every built-in form renders with example data, pictures in the object card", async () => {
  const font = new Uint8Array(readFileSync("public/fonts/DejaVuSans.ttf"));
  const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
  for (const form of BUILTIN_FORMS) {
    const values = sampleFormValues(form.document, { deviations: true, today: "2026-09-26" });
    if (form.id === "hintek-termografering") values.tables.objekt[0].cells.termobild = ["img-1"];
    const bytes = await createWorkflowPdfReport({ company: "QA", fontBytes: font, options: defaultWorkflowReportOptions, tasks: [{
      id: form.id, kind: "FORM", title: form.meta.name, description: "", status: "IN_PROGRESS", progress: 0, assignedToName: "", dueDate: "", totalDurationSec: 0,
      attachments: [{ id: "img-1", filename: "termo.png", mimeType: "image/png", bytes: png }],
      data: { kind: "FORM", details: { templateName: form.meta.name, templateVersion: 1, document: form.document, values } },
    }] });
    assert.ok(bytes.byteLength > 2000, form.meta.name);
  }
});
