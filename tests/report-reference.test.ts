import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { INSTANCE_DEFAULTS } from "../lib/instance-defaults";
import { drawingDifference, pdfDrawing, type PdfDrawing } from "./helpers/pdf-drawing";
import { REFERENCE_DIR, referenceReports } from "./fixtures/report-references";

// Kontroll före idrifttagning (the form) and the risk assessment PDFs are locked (2026-09-27): the same text in the same places, within
// half a point. A deliberate change of look is approved first and then written with tests/reference-pdfs.ts.
// The references are drawn with Workflow's installation's words (the footer names it); the Community export writes the product's
// name there (community/export-rules.mjs, 2026-11-10), so the PDFs are compared only where the name is Workflow's.
// Built from the quoted word, which the export's rewrite keeps.
const ownWords = (INSTANCE_DEFAULTS.name as string) === ["HINTEK", "Workflow"].join(" ");
for (const reference of referenceReports.filter((item) => item.locked)) {
  test(`the ${reference.name} PDF looks exactly like the reference`, { skip: !ownWords && "the references carry Workflow's installation's name" }, async () => {
    const expected = JSON.parse(readFileSync(`${REFERENCE_DIR}/${reference.name}.json`, "utf8")) as PdfDrawing;
    assert.equal(drawingDifference(await pdfDrawing(await reference.render()), expected), null);
  });
}
