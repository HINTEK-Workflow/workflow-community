import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { createWorkflowPdfReport, defaultWorkflowReportOptions, reportTasksWithoutReceipts, type WorkflowReportTask } from "@/lib/workflow/report";
import { drawingText, pdfDrawing } from "./helpers/pdf-drawing";
import { reportFontBytes } from "./helpers/report-font";

// Kvitto (owner's decision 2026-11-04): a picture marked as a receipt shows amounts, so without "Visa priser" it is
// neither drawn nor listed under Bilagor; an ordinary picture is. With prices on both print as before.
const createdAt = new Date("2026-11-04T08:00:00.000Z");
const fontBytes = reportFontBytes();
const textOf = async (bytes: Uint8Array) => drawingText(await pdfDrawing(bytes)).join("\n").replace(/\s+/g, " ");

async function task(): Promise<WorkflowReportTask> {
  const jpeg = new Uint8Array(await sharp({ create: { width: 40, height: 30, channels: 3, background: "#3366aa" } }).jpeg().toBuffer());
  return {
    id: "t1", kind: "WORK_ORDER", title: "Order", description: "", status: "COMPLETED", progress: 100, assignedToName: "QA", dueDate: "", totalDurationSec: 0, completedAt: "2026-11-02T14:00:00.000Z",
    attachments: [
      { id: "a1", filename: "tavla-foto.jpg", mimeType: "image/jpeg", bytes: jpeg },
      { id: "a2", filename: "kvitto-grossist.jpg", mimeType: "image/jpeg", bytes: jpeg, receipt: true },
      { id: "a3", filename: "gammal-bild.jpg", mimeType: "image/jpeg", bytes: jpeg, receipt: false },
    ],
    data: { kind: "WORK_ORDER", details: { executionNotes: "Bytt", deviations: "", closeNotes: "", signature: { name: "QA", confirmed: true, signedAt: "2026-11-02T14:00:00.000Z" }, materials: [] } },
  } as WorkflowReportTask;
}

test("without prices a receipt picture is dropped and the others stay", async () => {
  const [kept] = reportTasksWithoutReceipts([await task()], { prices: false });
  assert.deepEqual(kept.attachments.map((item) => item.filename), ["tavla-foto.jpg", "gammal-bild.jpg"]);
  const [all] = reportTasksWithoutReceipts([await task()], { prices: true });
  assert.equal(all.attachments.length, 3);
});

test("a work order report without prices neither draws nor lists the receipt", async () => {
  const text = await textOf(await createWorkflowPdfReport({ company: "QA", tasks: [await task()], options: { ...defaultWorkflowReportOptions, prices: false }, fontBytes, createdAt }));
  assert.ok(text.includes("tavla-foto.jpg") && text.includes("gammal-bild.jpg"), "ordinary pictures are drawn and listed");
  assert.ok(!text.includes("kvitto-grossist"), "the receipt is neither drawn nor listed");
});

test("a project report without prices leaves the receipt out too", async () => {
  const text = await textOf(await createWorkflowPdfReport({ company: "QA", title: "Projektrapport", projectName: "Projekt", tasks: [await task()], options: { ...defaultWorkflowReportOptions, prices: false }, fontBytes, createdAt }));
  assert.ok(text.includes("tavla-foto.jpg"));
  assert.ok(!text.includes("kvitto-grossist"));
});

test("with prices on the receipt prints and is listed as before", async () => {
  const text = await textOf(await createWorkflowPdfReport({ company: "QA", tasks: [await task()], options: { ...defaultWorkflowReportOptions, prices: true }, fontBytes, createdAt }));
  assert.ok(text.includes("tavla-foto.jpg") && text.includes("kvitto-grossist.jpg") && text.includes("gammal-bild.jpg"));
});

test("marking a receipt has the checks of editing the task, also when it is completed, and writes a history line", async () => {
  const { readFileSync } = await import("node:fs");
  const route = readFileSync("app/api/workflow-task-files/[id]/route.ts", "utf8");
  const patch = route.slice(route.indexOf("export async function PATCH"), route.indexOf("export async function DELETE"));
  for (const check of ["checkOrigin(request)", "await context()", "requireCloudWriteAccess(ctx)", "organizationId: ctx.organizationId", 'requireWorkflowPermission(ctx, workflowSubjectForTask(file.task.kind, file.task.formArea), "edit")', 'requireTaskLevelById(ctx.organizationId, file.taskId, ctx.user, "fill")', "workflowTaskRevision.create", ".strict()", "note"])
    assert.ok((patch + route).includes(check), check);
  assert.doesNotMatch(patch, /COMPLETED|CANCELLED/, "no lock on a completed or cancelled task");
  assert.ok(!/workflowTaskAttachment.(delete|create)/.test(patch));
  // Everything else on a completed task stays locked.
  const remove = route.slice(route.indexOf("export async function DELETE"));
  assert.match(remove, /COMPLETED/);
  assert.match(readFileSync("app/api/workflow-task-files/route.ts", "utf8"), /COMPLETED/);
});

test("Local: marking works on a completed task, changes nothing else and writes a history line", async () => {
  const { setLocalAttachmentReceipt } = await import("../features/kfid/local-workspace-store");
  const task = { id: "t", version: 3, title: "A", description: "", status: "COMPLETED", progress: 100, data: { kind: "WORK_ORDER" }, completedAt: "2026-11-01T10:00:00.000Z", updatedAt: "x", revisions: [] };
  const workspace = { localIdentity: { name: "Eva" }, workflowTasks: [task], attachments: [{ id: "a", taskId: "t", filename: "kvitto.jpg", mimeType: "image/jpeg" }, { id: "b", taskId: "t", filename: "x.pdf", mimeType: "application/pdf" }] } as never;
  const next = setLocalAttachmentReceipt(workspace, "t", "a", true, "2026-11-04T08:00:00.000Z") as unknown as { workflowTasks: (typeof task)[]; attachments: { id: string; receipt?: boolean }[] };
  assert.equal(next.attachments.find((item) => item.id === "a")?.receipt, true);
  assert.equal(next.workflowTasks[0].status, "COMPLETED");
  assert.equal(next.workflowTasks[0].version, 4);
  assert.equal(next.workflowTasks[0].revisions.length, 1);
  assert.equal((next.workflowTasks[0].revisions[0] as { snapshot: { note: string } }).snapshot.note, "Kvitto markerat: kvitto.jpg (Eva)");
  assert.equal(setLocalAttachmentReceipt(next as never, "t", "a", true), next, "no change, no history line");
  assert.throws(() => setLocalAttachmentReceipt(workspace, "t", "b", true), /Bara en bild/);
});
