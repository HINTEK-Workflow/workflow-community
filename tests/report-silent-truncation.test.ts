import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { drawingText, pdfDrawing } from "./helpers/pdf-drawing";
import { createWorkflowPdfReport, defaultWorkflowReportOptions, type WorkflowReportTask } from "../lib/workflow/report";

// Granskning 2026-10-20 (R1), fixed 2026-10-21: the fact boxes of the report kit used to print at most eight lines of a
// value and drop the rest without a sign (a work order's description, deviations and closing comment; every long form
// answer). The decision: the box continues over the page break. Every last line must be in the PDF.
const fontBytes = new Uint8Array(readFileSync("public/fonts/DejaVuSans.ttf"));
const lines = (label: string) => `${Array.from({ length: 20 }, (_, i) => `${label} rad ${i + 1}: lock saknas på dosa ${i + 1}.`).join("\n")}\n${label} SISTA RADEN`;

test("long deviations, description and closing comment are printed whole (or marked as cut)", async () => {
  const task: WorkflowReportTask = {
    id: "t", kind: "WORK_ORDER", title: "Arbetsorder med långa fält", description: lines("Beskrivning"), status: "COMPLETED", progress: 100, assignedToName: "Åsa", dueDate: "", totalDurationSec: 0,
    data: { kind: "WORK_ORDER", details: { executionNotes: "Utfört.", deviations: lines("Avvikelse"), materials: [], signature: { name: "Åsa", confirmed: true, signedAt: "2026-10-20T08:00:00.000Z" }, closeNotes: lines("Kommentar") } },
    attachments: [],
  };
  const text = drawingText(await pdfDrawing(await createWorkflowPdfReport({ company: "Elfirma AB", tasks: [task], options: defaultWorkflowReportOptions, fontBytes, createdAt: new Date("2026-10-20T12:00:00Z") }))).join("\n");
  const missing = ["Beskrivning", "Avvikelse", "Kommentar"].filter((label) => !text.includes(`${label} SISTA RADEN`) && !text.includes("…"));
  assert.deepEqual(missing, [], `cut without a sign: ${missing.join(", ")}`);
});
