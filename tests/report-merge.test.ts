import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { stampContinuousFooter } from "../lib/workflow/report-merge";
import { drawingText, pdfDrawing } from "./helpers/pdf-drawing";

// Totalkontrollen F5 (2026-09-29): a project report merged from several PDFs is numbered as one document.
test("a merged project report gets one footer with continuous page numbers", async () => {
  const fontBytes = new Uint8Array(readFileSync("public/fonts/DejaVuSans.ttf"));
  const part = async (pages: number) => {
    const pdf = await PDFDocument.create();
    for (let index = 0; index < pages; index += 1) pdf.addPage([595, 842]).drawText(`Del sida ${index + 1} / ${pages}`, { x: 400, y: 27, size: 7 });
    return PDFDocument.load(await pdf.save());
  };
  const result = await PDFDocument.create();
  for (const source of [await part(2), await part(4), await part(2)])
    for (const page of await result.copyPages(source, source.getPageIndices())) result.addPage(page);
  await stampContinuousFooter(result, { fontBytes, left: "HINTEK Workflow · Projektrapport · Ställverk", company: "HINTEK Local" });
  const pages = drawingText(await pdfDrawing(await result.save()));
  assert.equal(pages.length, 8);
  pages.forEach((text, index) => {
    assert.ok(text.includes(`HINTEK Local · Sida ${index + 1} av 8`), `page ${index + 1} has the continuous number`);
    assert.ok(text.includes("HINTEK Workflow · Projektrapport · Ställverk"));
  });
});
