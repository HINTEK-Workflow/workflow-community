import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { ControlData } from "../lib/kfid/model";
import { validateForCompletion } from "../lib/kfid/model";
import { kfidForm, kfidFormDocument } from "../lib/workflow/builtin-kfid-form";
import { formCompletion, formDocumentSchema, validateFormDocument, type FormDocument } from "../lib/workflow/form-document";
import { createPdfReport } from "../lib/kfid/report-core";
import { createFormProtocolPdf } from "../lib/workflow/form-report";
import { defaultWorkflowReportOptions, type WorkflowReportTask } from "../lib/workflow/report";
import { controlToFormValues } from "./fixtures/control-to-form";
import { REFERENCE_DIR, referenceControlFull, referenceControlLong, referenceControlTemplate } from "./fixtures/report-references";
import { drawingDifference, drawingText, pdfDrawing, type PdfDrawing } from "./helpers/pdf-drawing";

/**
 * The acid test of decision B (2026-09-27): Kontroll före idrifttagning built only from the form builder's
 * building blocks gives the same PDF as today's control – same texts in the same places – and the same degree of
 * completion.
 */
const font = () => new Uint8Array(readFileSync("public/fonts/DejaVuSans.ttf"));
const company = "HINTEK Power Solutions AB";
const files = [
  { id: "file-1", filename: "grupp2-kopplingsdosa.png", mimeType: "image/png", section: "iso", rowId: "iso-2", bytes: new Uint8Array(readFileSync(`${REFERENCE_DIR}/photo.png`)) },
  { id: "file-2", filename: "Ritning A1.pdf", mimeType: "application/pdf", section: "vis", rowId: null },
];

function task(data: ControlData, attachments: typeof files = [], document: FormDocument = kfidVersion3): WorkflowReportTask {
  return {
    id: "kfid-1", kind: "FORM", title: data.meta.proj, description: "", status: "COMPLETED", progress: 100, assignedToName: "", dueDate: "", totalDurationSec: 0,
    data: { kind: "FORM", details: { templateName: kfidForm.meta.name, templateVersion: 1, document, values: controlToFormValues(data, attachments) } },
    attachments: attachments.map(({ id, filename, mimeType, bytes }) => ({ id, filename, mimeType, bytes })),
  };
}
/**
 * Version 3 of the form – the last version identical to today's control (its three extra moments were off from the
 * start). Version 4 changes the content on request (2026-09-29: two more points in the visual inspection), so
 * the acid test compares version 3, which must stay today's control.
 */
const kfidVersion3 = formDocumentSchema.parse(JSON.parse(readFileSync("tests/fixtures/kfid-form-v3.json", "utf8")));
const reference = (name: string) => JSON.parse(readFileSync(`${REFERENCE_DIR}/${name}.json`, "utf8")) as PdfDrawing;

test("the control form is valid and uses only building blocks", () => {
  assert.deepEqual(validateFormDocument(kfidFormDocument).issues, []);
});

test("the control as a form gives the same PDF as today's control", async () => {
  const bytes = await createFormProtocolPdf({ identity: { company }, fontBytes: font(), task: task(referenceControlFull, files), options: defaultWorkflowReportOptions });
  assert.equal(drawingDifference(await pdfDrawing(bytes), reference("control-full")), null);
});

test("a long control with the company's colours and logo is the same too, page breaks included", async () => {
  // Compared with today's control drawn live from the same data. The project name is one that fits the box: the
  // control cuts a longer value after two lines, while a form's box grows so no answer is lost (tested below).
  const data: ControlData = { ...referenceControlLong, meta: { ...referenceControlLong.meta, proj: "Industrihall Norra – nyinstallation" } };
  const identity = { company, branding: { primary: "#113351", accent: "#f59e0b", soft: "#eef4fb" }, logoBytes: new Uint8Array(readFileSync(`${REFERENCE_DIR}/logo.png`)) };
  const [form, control] = await Promise.all([
    createFormProtocolPdf({ identity, fontBytes: font(), task: task(data), options: defaultWorkflowReportOptions }),
    createPdfReport(data, identity, [], false, font()),
  ]);
  assert.equal(drawingDifference(await pdfDrawing(form), await pdfDrawing(control)), null);
});

test("a long answer grows its box instead of being cut after two lines", async () => {
  const bytes = await createFormProtocolPdf({ identity: { company }, fontBytes: font(), task: task(referenceControlLong), options: defaultWorkflowReportOptions });
  assert.ok(drawingText(await pdfDrawing(bytes))[0].includes("rader i rutan"));
});

test("the blank form is today's empty control template", async () => {
  const bytes = await createFormProtocolPdf({ identity: { company }, fontBytes: font(), task: task(referenceControlTemplate), options: defaultWorkflowReportOptions, blank: true });
  assert.equal(drawingDifference(await pdfDrawing(bytes), reference("control-template")), null);
});

test("the degree of completion is counted like the control's", () => {
  for (const data of [referenceControlFull, referenceControlLong]) {
    const values = controlToFormValues(data);
    assert.equal(formCompletion(kfidVersion3, values).percent, validateForCompletion(data).progress.percent);
  }
});

test("version 4: the visual inspection has the points of the former moments, and those moments are gone", async () => {
  assert.deepEqual(validateFormDocument(kfidVersion3).issues, []);
  const ids = kfidFormDocument.blocks.map((block) => block.id);
  assert.ok(!ids.includes("kfid-fore") && !ids.includes("kfid-funktion"));
  const bytes = await createFormProtocolPdf({ identity: { company }, fontBytes: font(), task: task(referenceControlFull, files, kfidFormDocument), options: defaultWorkflowReportOptions });
  const text = drawingText(await pdfDrawing(bytes)).join(" ");
  for (const point of ["Beröringsskydd, kapslingar och lock på plats", "Polaritet och funktion hos manöverdon kontrollerad", "Märkning och skyltning utförd"]) assert.ok(text.includes(point), point);
  assert.ok(!text.includes("Före spänningssättning"));
});
