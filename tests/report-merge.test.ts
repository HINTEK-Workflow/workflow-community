import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { projectReportFooterLeft, stampContinuousFooter } from "../lib/workflow/report-merge";
import { drawingText, pdfDrawing } from "./helpers/pdf-drawing";
import { createWorkflowPdfReport, defaultWorkflowReportOptions } from "../lib/workflow/report";
import { kfidTask, REFERENCE_COMPANY } from "./fixtures/report-references";
import { kfidFull } from "./fixtures/kfid-answers";

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
  await stampContinuousFooter(result, { fontBytes, left: projectReportFooterLeft("Ställverk", new Date("2026-10-11T10:00:00Z")), company: "Workflow Local" });
  const pages = drawingText(await pdfDrawing(await result.save()));
  assert.equal(pages.length, 8);
  pages.forEach((text, index) => {
    assert.ok(text.includes(`Sida ${index + 1} av 8`), `page ${index + 1} has the continuous number`);
    assert.ok(text.includes("Projektrapport · Ställverk · "));
  });
});

// PDF-granskningen 2026-11-03, fynd 7 (val a): in a project report the sender box stands only on the cover; a
// protocol inside it is drawn without it, while a protocol taken out on its own keeps it.
test("a project report has the sender box on the cover only, not in its protocols", async () => {
  const fontBytes = new Uint8Array(readFileSync("public/fonts/DejaVuSans.ttf"));
  const sender = { organizationNumber: "556000-0000", fSkatt: true };
  const protocol = { ...kfidTask(kfidFull), customerName: "Brf Solgläntan" };
  const cover = await createWorkflowPdfReport({ company: REFERENCE_COMPANY, sender, title: "Projektrapport", projectName: "Stambyte", tasks: [protocol], options: defaultWorkflowReportOptions, fontBytes });
  const inside = await createWorkflowPdfReport({ company: REFERENCE_COMPANY, sender: null, tasks: [protocol], options: defaultWorkflowReportOptions, fontBytes });
  const alone = await createWorkflowPdfReport({ company: REFERENCE_COMPANY, sender, tasks: [protocol], options: defaultWorkflowReportOptions, fontBytes });
  const text = async (bytes: Uint8Array) => drawingText(await pdfDrawing(bytes)).join(" ");
  assert.match(await text(cover), /Org\.nr 556000-0000/);
  assert.doesNotMatch(await text(inside), /Org\.nr 556000-0000/);
  assert.match(await text(alone), /Org\.nr 556000-0000/);
  // Both ways a project report is made, Cloud and Local, draw the protocols so.
  for (const file of ["app/api/projects/[id]/report/route.ts", "features/kfid/local-workspace.tsx"])
    assert.match(readFileSync(file, "utf8"), /createWorkflowPdfReport\(\{ \.\.\.identity, sender: null, tasks: \[(task|protocol)\]/, file);
});
