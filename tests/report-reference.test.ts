import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { drawingDifference, pdfDrawing, type PdfDrawing } from "./helpers/pdf-drawing";
import { REFERENCE_DIR, referenceReports } from "./fixtures/report-references";

// Today's control and risk assessment PDFs are locked (Daniel 2026-09-27): the same text in the same places, within
// half a point. A deliberate change of look is approved first and then written with tests/reference-pdfs.ts.
for (const reference of referenceReports.filter((item) => item.locked)) {
  test(`the ${reference.name} PDF looks exactly like the reference`, async () => {
    const expected = JSON.parse(readFileSync(`${REFERENCE_DIR}/${reference.name}.json`, "utf8")) as PdfDrawing;
    assert.equal(drawingDifference(await pdfDrawing(await reference.render()), expected), null);
  });
}
