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

test("a reopened work order never reads as signed: the kept name is marked as not signed yet (F17)", async () => {
  const { drawingText, pdfDrawing } = await import("./helpers/pdf-drawing");
  const fontBytes = new Uint8Array(await readFile("public/fonts/DejaVuSans.ttf"));
  const reopened: WorkflowReportTask = { ...base, id: "work", kind: "WORK_ORDER", status: "NEEDS_ACTION", data: { kind: "WORK_ORDER", details: { executionNotes: "Monterat", deviations: "", materials: [], signature: { name: "Elin Bergström", confirmed: false, signedAt: null }, closeNotes: "" } } };
  const text = drawingText(await pdfDrawing(await createWorkflowPdfReport({ company: "HINTEK", tasks: [reopened], options: defaultWorkflowReportOptions, fontBytes }))).join("\n");
  // Drawn in the control's look since 2026-09-30: fact boxes "Signerad av" and "Signering".
  assert.ok(text.includes("Inte signerad"));
  assert.ok(text.includes("Elin Bergström (ej signerad ännu)"));
});
