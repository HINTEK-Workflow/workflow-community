import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PDFDocument } from "pdf-lib";
import { createWorkflowPdfReport, defaultWorkflowReportOptions, type WorkflowReportTask } from "../lib/workflow/report";

const base = { id: "task", title: "Rapportprov", description: "Säker dokumentation", status: "IN_PROGRESS" as const, progress: 60, assignedToName: "QA", dueDate: "2026-10-01", totalDurationSec: 3660, attachments: [] };

test("workflow task reports support compact section choices and draft output", async () => {
  const fontBytes = new Uint8Array(await readFile("public/fonts/DejaVuSans.ttf"));
  const task: WorkflowReportTask = { ...base, kind: "RISK_ASSESSMENT", data: { kind: "RISK_ASSESSMENT", details: { risks: [{ hazard: "Fallrisk", likelihood: 4, consequence: 4, protectiveMeasure: "Fallskydd", residualLikelihood: 2, residualConsequence: 2 }], generalMeasures: "Arbetsberedning", approval: { name: "QA", confirmed: true, approvedAt: new Date().toISOString() } } } };
  const full = await createWorkflowPdfReport({ company: "HINTEK", tasks: [task], options: defaultWorkflowReportOptions, fontBytes });
  const compact = await createWorkflowPdfReport({ company: "HINTEK", tasks: [task], options: { ...defaultWorkflowReportOptions, time: false, riskMatrix: false, images: false, attachments: false }, fontBytes });
  assert.ok(full.byteLength > compact.byteLength);
  assert.ok((await PDFDocument.load(full)).getPageCount() >= 1);
});

test("project reports combine multiple workflow task types", async () => {
  const fontBytes = new Uint8Array(await readFile("public/fonts/DejaVuSans.ttf"));
  const workOrder: WorkflowReportTask = { ...base, id: "work", kind: "WORK_ORDER", status: "COMPLETED", progress: 100, data: { kind: "WORK_ORDER", details: { executionNotes: "Monterat", deviations: "Inga", materials: [{ name: "Kabel", quantity: "5", unit: "m" }], signature: { name: "QA", confirmed: true, signedAt: new Date().toISOString() }, closeNotes: "Klart" } } };
  const risk: WorkflowReportTask = { ...base, id: "risk", kind: "RISK_ASSESSMENT", data: { kind: "RISK_ASSESSMENT", details: { risks: [], generalMeasures: "", approval: { name: "", confirmed: false, approvedAt: null } } } };
  const bytes = await createWorkflowPdfReport({ company: "HINTEK", title: "Projektrapport", projectName: "Projekt A", tasks: [workOrder, risk], options: defaultWorkflowReportOptions, fontBytes });
  assert.ok((await PDFDocument.load(bytes)).getPageCount() >= 3);
});

// PDF-granskningen 2026-11-03: the merged project report had no title or author (a new PDFDocument carries none); both
// ways it is put together, Cloud and Local, set them like every other document.
test("a merged project report gets the document's title, author and maker", async () => {
  const { readFileSync } = await import("node:fs");
  const { projectReportMetadata } = await import("../lib/workflow/report-merge");
  const merged = await PDFDocument.create();
  merged.addPage([595, 842]);
  projectReportMetadata(merged, { projectName: "Projekt A", company: "Elfirma AB", createdAt: new Date("2026-11-03T10:00:00Z") });
  // Read as saved: loading with pdf-lib's default would write its own producer and dates over them.
  const pdf = await PDFDocument.load(await merged.save(), { updateMetadata: false });
  assert.equal(pdf.getTitle(), "Projektrapport – Projekt A");
  assert.equal(pdf.getAuthor(), "Elfirma AB");
  assert.equal(pdf.getCreator(), "Workflow");
  assert.equal(pdf.getProducer(), "Workflow");
  assert.equal(pdf.getCreationDate()?.toISOString(), "2026-11-03T10:00:00.000Z");
  for (const file of ["app/api/projects/[id]/report/route.ts", "features/kfid/local-workspace.tsx"])
    assert.match(readFileSync(file, "utf8"), /projectReportMetadata\(result, \{ projectName: project\.name, company: identity\.company \}\);\n\s*await stampContinuousFooter\(result,/, file);
});

// PDF-granskningen 2026-11-03: the expenses table printed à-pris and belopp as typed ("120", "4,50") beside material rows
// formatted "5 760,00"; both columns now use the same form, and a text that is no amount stays as typed.
test("the expenses table prints à-pris and belopp like the material rows", async () => {
  const { drawingText, pdfDrawing } = await import("./helpers/pdf-drawing");
  const fontBytes = new Uint8Array(await readFile("public/fonts/DejaVuSans.ttf"));
  const task: WorkflowReportTask = { ...base, id: "work", kind: "WORK_ORDER", status: "COMPLETED", data: { kind: "WORK_ORDER", details: { executionNotes: "Monterat", deviations: "", closeNotes: "", signature: { name: "QA", confirmed: true, signedAt: "2026-11-03T10:00:00.000Z" }, materials: [
    { name: "Kabel", quantity: "5", unit: "m" },
    { name: "Parkering", quantity: "1", unit: "st", kind: "expense", unitPrice: "120", amount: "120" },
    { name: "Bil, 28 km", quantity: "28", unit: "km", kind: "expense", unitPrice: "4,5", amount: "126" },
    { name: "Lyft", quantity: "1", unit: "st", kind: "expense", unitPrice: "1250", amount: "1250" },
    { name: "Kvitto kommer", quantity: "1", unit: "st", kind: "expense", unitPrice: "", amount: "enligt kvitto" },
  ] } } };
  // One drawn text per line, the no-break space between thousands read as a space.
  const lines = drawingText(await pdfDrawing(await createWorkflowPdfReport({ company: "QA", tasks: [task], options: { ...defaultWorkflowReportOptions, prices: true }, fontBytes }))).join("\n").replace(/\u00a0/g, " ").split("\n");
  const after = (label: string, count: number) => lines.slice(lines.indexOf(label) + 1, lines.indexOf(label) + 1 + count);
  assert.deepEqual(after("Parkering", 4), ["1", "st", "120,00", "120,00"]);
  assert.deepEqual(after("Bil, 28 km", 4), ["28", "km", "4,50", "126,00"]);
  assert.deepEqual(after("Lyft", 4), ["1", "st", "1 250,00", "1 250,00"]);
  // An empty cell is the kit's long dash, as before; a text that is no amount stays as typed.
  assert.deepEqual(after("Kvitto kommer", 5), ["1", "st", "—", "enligt", "kvitto"]);
  assert.match(lines.join("\n"), /\(1 rad utan läsbart belopp\)\n1 496,00/, "the sum is unchanged: 120 + 126 + 1 250, one row missing");
  // Without "Visa priser": what the expense is and how much of it, nothing else.
  const plain = drawingText(await pdfDrawing(await createWorkflowPdfReport({ company: "QA", tasks: [task], options: defaultWorkflowReportOptions, fontBytes }))).join("\n").split("\n");
  assert.deepEqual(plain.slice(plain.indexOf("Parkering") + 1, plain.indexOf("Parkering") + 3), ["1", "st"]);
  assert.ok(!plain.some((line) => /Summa utgifter|À-pris|Belopp|120,00|1.250,00|enligt/.test(line)));
});

test("a reopened work order never reads as signed: the kept name is marked as not signed yet (F17)", async () => {
  const { drawingText, pdfDrawing } = await import("./helpers/pdf-drawing");
  const fontBytes = new Uint8Array(await readFile("public/fonts/DejaVuSans.ttf"));
  const reopened: WorkflowReportTask = { ...base, id: "work", kind: "WORK_ORDER", status: "NEEDS_ACTION", data: { kind: "WORK_ORDER", details: { executionNotes: "Monterat", deviations: "", materials: [], signature: { name: "Elin Bergström", confirmed: false, signedAt: null }, closeNotes: "" } } };
  const text = drawingText(await pdfDrawing(await createWorkflowPdfReport({ company: "HINTEK", tasks: [reopened], options: defaultWorkflowReportOptions, fontBytes }))).join("\n");
  // Drawn in the control's look since 2026-09-30: fact boxes "Signerad av" and "Signering".
  // The line under the name says it once (PDF review 2026-11-04, finding 18).
  assert.ok(text.includes("Inte signerad"));
  assert.ok(text.includes("Elin Bergström"));
  assert.ok(!text.includes("ej signerad ännu"));
});
