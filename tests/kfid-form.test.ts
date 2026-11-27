import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { kfidFormDocument } from "../lib/workflow/builtin-kfid-form";
import { formCompletion, validateFormDocument } from "../lib/workflow/form-document";
import { createFormProtocolPdf } from "../lib/workflow/form-report";
import { defaultWorkflowReportOptions } from "../lib/workflow/report";
import { kfidFull, kfidLong, kfidValues } from "./fixtures/kfid-answers";
import { kfidFiles, kfidTask, REFERENCE_COMPANY as company } from "./fixtures/report-references";
import { drawingText, pdfDrawing } from "./helpers/pdf-drawing";

/**
 * Kontroll före idrifttagning is the form (2026-09-27, decision B; since 2026-10-06 the only control): built
 * only from the form builder's building blocks. Its look is locked by the references in tests/report-reference.test.ts.
 */
const font = () => new Uint8Array(readFileSync("public/fonts/DejaVuSans.ttf"));

test("the control form is valid and uses only building blocks", () => {
  assert.deepEqual(validateFormDocument(kfidFormDocument).issues, []);
});

test("a long answer grows its box instead of being cut after two lines", async () => {
  const bytes = await createFormProtocolPdf({ identity: { company }, fontBytes: font(), task: kfidTask(kfidLong), options: defaultWorkflowReportOptions });
  assert.ok(drawingText(await pdfDrawing(bytes))[0].replace(/\s+/g, " ").includes("rader i rutan"));
});

test("the degree of completion stays as locked", () => {
  // Locked when the older control editor was removed (2026-10-06): the same per cent the protocol shows today.
  assert.equal(formCompletion(kfidFormDocument, kfidValues(kfidFull)).percent, 98);
  assert.equal(formCompletion(kfidFormDocument, kfidValues(kfidLong)).percent, 100);
});

test("version 4: the visual inspection has the points of the former moments, and those moments are gone", async () => {
  const ids = kfidFormDocument.blocks.map((block) => block.id);
  assert.ok(!ids.includes("kfid-fore") && !ids.includes("kfid-funktion"));
  const bytes = await createFormProtocolPdf({ identity: { company }, fontBytes: font(), task: kfidTask(kfidFull, kfidFiles()), options: defaultWorkflowReportOptions });
  const text = drawingText(await pdfDrawing(bytes)).join(" ").replace(/\s+/g, " ");
  for (const point of ["Beröringsskydd, kapslingar och lock på plats", "Polaritet och funktion hos manöverdon kontrollerad", "Märkning och skyltning utförd"]) assert.ok(text.includes(point), point);
  assert.ok(!text.includes("Före spänningssättning"));
});
