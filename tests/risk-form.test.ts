import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { riskForm, riskFormDocument } from "../lib/workflow/builtin-risk-form";
import { evaluateForm, formCompletion, initialFormValues, validateFormDocument } from "../lib/workflow/form-document";
import { createFormProtocolPdf } from "../lib/workflow/form-report";
import { defaultWorkflowReportOptions } from "../lib/workflow/report";
import { workflowTaskCompletion } from "../lib/workflow/task-model";
import { REFERENCE_DIR, referenceRiskTask } from "./fixtures/report-references";
import { riskToFormValues } from "./fixtures/risk-to-form";
import { drawingText, pdfDrawing, type PdfDrawing } from "./helpers/pdf-drawing";

/** Riskbedömning built from the form builder's building blocks (Daniel 2026-09-27, decision B). */
const details = referenceRiskTask.data.kind === "RISK_ASSESSMENT" ? referenceRiskTask.data.details : null!;

test("the risk assessment form is valid", () => {
  assert.deepEqual(validateFormDocument(riskFormDocument).issues, []);
});

test("the risk is likelihood × consequence with today's levels, before and after the measure", () => {
  const values = riskToFormValues(details);
  const result = evaluateForm(riskFormDocument, values);
  assert.equal(result.cells.risker["risk-1"].fore, 15);
  assert.equal(result.cells.risker["risk-1"].efter, 5);
  assert.equal(result.deviations.length, 0, "a risk level is not a deviation");
});

test("the form asks for what today's risk assessment asks for", () => {
  const empty = initialFormValues(riskFormDocument);
  const emptyCompletion = formCompletion(riskFormDocument, empty);
  assert.ok(emptyCompletion.issues.some((item) => item.message === "Identifierade risker: fyll i minst en rad."), "at least one risk");
  assert.ok(emptyCompletion.issues.some((item) => item.message === "Godkänd av: ange namn och bekräfta."), "approval");
  const filled = formCompletion(riskFormDocument, riskToFormValues(details));
  assert.equal(filled.ready, true);
  assert.equal(workflowTaskCompletion({ title: "Riskbedömning", status: "IN_PROGRESS", data: referenceRiskTask.data as never }).ready, true);
  // A risk without its protective measure stops completion, as today.
  const missing = riskToFormValues({ ...details, risks: [{ ...details.risks[0], protectiveMeasure: "" }] });
  assert.ok(formCompletion(riskFormDocument, missing).issues.some((item) => item.message === "Identifierade risker, Risk 1: fyll i skyddsåtgärd."));
});

test("the PDF keeps everything today's risk report shows, in the control's look", async () => {
  const bytes = await createFormProtocolPdf({
    identity: { company: "HINTEK Power Solutions AB" }, fontBytes: new Uint8Array(readFileSync("public/fonts/DejaVuSans.ttf")), options: defaultWorkflowReportOptions,
    task: { ...referenceRiskTask, kind: "FORM", data: { kind: "FORM", details: { templateName: riskForm.meta.name, templateVersion: 1, document: riskFormDocument, values: riskToFormValues(details) } } },
  });
  const text = drawingText(await pdfDrawing(bytes)).join("\n");
  const before = drawingText(JSON.parse(readFileSync(`${REFERENCE_DIR}/risk-assessment.json`, "utf8")) as PdfDrawing).join("\n");
  for (const expected of [...details.risks.flatMap((risk) => [risk.hazard, risk.protectiveMeasure]), details.generalMeasures, "Riskmatris 5 × 5", "Stockholm", "Elon Strömberg", "2026-10-01", "15 · Hög", "5 · Måttlig", "Maria Ek · bekräftad 2026-09-26 09:30"]) {
    assert.ok(text.replace(/\s+/g, " ").includes(expected), `saknar ${expected}`);
  }
  assert.ok(before.includes("Maria Ek"), "the reference has the approval");
  assert.ok(text.includes("RISKBEDÖMNING") && text.includes("Riskbedömning · fortsättning"), "the control's heading and continuation");
  assert.ok(!text.includes("Sammanfattning / avvikelser"), "a risk assessment has no deviation box");
});

test("a risk card is named by the hazard, never by the person responsible for the measure (F4)", async () => {
  const values = riskToFormValues(details);
  values.tables.risker[0].cells.ansvarig = "Daniel Einarsson";
  const bytes = await createFormProtocolPdf({
    identity: { company: "HINTEK Power Solutions AB" }, fontBytes: new Uint8Array(readFileSync("public/fonts/DejaVuSans.ttf")), options: defaultWorkflowReportOptions,
    task: { ...referenceRiskTask, kind: "FORM", data: { kind: "FORM", details: { templateName: riskForm.meta.name, templateVersion: 1, document: riskFormDocument, values } } },
  });
  const lines = drawingText(await pdfDrawing(bytes)).flatMap((page) => page.split("\n"));
  const hazard = details.risks[0].hazard.replace(/\s+/g, " ").trim();
  assert.ok(lines.some((line) => line.startsWith("Risk 1: ") && hazard.startsWith(line.slice(8).replace(/…$/, ""))), "the card heading is the hazard");
  assert.ok(!lines.includes("Risk 1: Daniel Einarsson"));
  assert.ok(lines.includes("Daniel Einarsson"), "the responsible person is its own value on the card");
});
