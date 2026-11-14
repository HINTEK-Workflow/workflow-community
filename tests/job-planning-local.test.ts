import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createLocalWorkspace, linkLocalTaskToProject, localWorkToBook, parseLocalWorkspace, saveLocalPlannedActivity, saveLocalProjectRecord, saveLocalWorkflowTaskRecord, type LocalWorkspaceDocument,
} from "../features/kfid/local-workspace-store";
import { swedishDayKey } from "../lib/swedish-time";
import { addDays } from "../lib/workflow/schedule";
import { jobObstacle, reportObstacle, resolveObstacle } from "../lib/workflow/obstacles";

// Plan 1M (2026-10-11) in the Local file: Start on every job, Etapp in the file, and an obstacle kept by a save. The same
// rules as Cloud and the demo (lib/workflow/job-planning.ts, lib/workflow/obstacles.ts).
const today = swedishDayKey(new Date());
const task = (workspace: LocalWorkspaceDocument, values: Record<string, unknown>) => saveLocalWorkflowTaskRecord(workspace, {
  version: 0, kind: "WORK_ORDER", title: "Jobb", description: "", status: "PLANNED", projectId: null, customerId: null, assignedToUserId: null, assignedToName: "", dueDate: "",
  data: { kind: "WORK_ORDER", details: { executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "" } },
  ...values,
});
const project = (workspace: LocalWorkspaceDocument, startDate: string, dueDate: string) => saveLocalProjectRecord(workspace, { name: "Projekt", description: "", startDate, dueDate, customerId: null });

test("a new local job starts today, inside the project's frame and never after Klart senast", () => {
  const workspace = createLocalWorkspace({ id: "org-local", name: "Lokala AB" });
  assert.equal(task(workspace, {}).task.plannedStartDate, today);
  assert.equal(task(workspace, { plannedStartDate: addDays(today, 3) }).task.plannedStartDate, addDays(today, 3), "a chosen Start is kept");
  assert.equal(task(workspace, { dueDate: addDays(today, -2) }).task.plannedStartDate, addDays(today, -2), "never after Klart senast");
  const future = project(workspace, addDays(today, 30), addDays(today, 60));
  assert.equal(task(future.workspace, { projectId: future.project.id, dueDate: addDays(today, 40) }).task.plannedStartDate, addDays(today, 30));
});

test("a saved Start is never cleared and a start after Klart senast is refused clearly", () => {
  const workspace = createLocalWorkspace({ id: "org-local", name: "Lokala AB" });
  const first = task(workspace, { plannedStartDate: addDays(today, 2), dueDate: addDays(today, 9) });
  const again = saveLocalWorkflowTaskRecord(first.workspace, { ...first.task, plannedStartDate: "", title: "Nytt namn" });
  assert.equal(again.task.plannedStartDate, addDays(today, 2));
  assert.throws(() => saveLocalWorkflowTaskRecord(first.workspace, { ...first.task, plannedStartDate: addDays(today, 12) }), /Start måste vara före eller samma dag som Klart senast/);
});

test("Etapp is trimmed, kept in the file through a re-read, and cleared by an empty one", () => {
  const workspace = createLocalWorkspace({ id: "org-local", name: "Lokala AB" });
  const first = task(workspace, { stage: "  Fas   1 " });
  assert.equal(first.task.stage, "Fas 1");
  const read = parseLocalWorkspace(JSON.parse(JSON.stringify(first.workspace)), "org-local");
  assert.equal(read.workflowTasks[0].stage, "Fas 1");
  // A save without the field keeps it; an empty one clears it (and the file says so, so a re-import clears it too).
  const kept = saveLocalWorkflowTaskRecord(read, { ...read.workflowTasks[0], stage: undefined, title: "Ändrad" });
  assert.equal(kept.task.stage, "Fas 1");
  const cleared = saveLocalWorkflowTaskRecord(kept.workspace, { ...kept.task, stage: "" });
  assert.equal(cleared.task.stage, "");
  assert.throws(() => task(workspace, { stage: "x".repeat(61) }));
  // An older file without the field reads as before.
  const older = JSON.parse(JSON.stringify(first.workspace)) as LocalWorkspaceDocument;
  delete older.workflowTasks[0].stage;
  assert.equal(parseLocalWorkspace(older, "org-local").workflowTasks[0].stage, undefined);
});

test("a job without a Start gets today when it is linked to a project", () => {
  const workspace = createLocalWorkspace({ id: "org-local", name: "Lokala AB" });
  const { workspace: withProject, project: made } = project(workspace, addDays(today, -10), addDays(today, 60));
  const old = task(withProject, {});
  const file = JSON.parse(JSON.stringify(old.workspace)) as LocalWorkspaceDocument;
  file.workflowTasks[0].plannedStartDate = ""; // as a job saved before the rule
  const linked = linkLocalTaskToProject(parseLocalWorkspace(file, "org-local"), old.task.id, "WORK_ORDER", made.id);
  assert.equal(linked.workflowTasks[0].plannedStartDate, today);
});

test("an obstacle reported on a local job is kept by the save and resolved with the status back", () => {
  const workspace = createLocalWorkspace({ id: "org-local", name: "Lokala AB" });
  const first = task(workspace, {});
  const reported = reportObstacle({ kind: first.task.kind, status: first.task.status, data: first.task.data }, { reason: "MATERIAL", text: "Kabel beställd" }, new Date(), "");
  const saved = saveLocalWorkflowTaskRecord(first.workspace, { ...first.task, status: reported.status, data: reported.data });
  assert.equal(saved.task.status, "PAUSED", "a work order that waits for material is paused");
  assert.deepEqual([jobObstacle(saved.task)?.reason, jobObstacle(saved.task)?.text], ["MATERIAL", "Kabel beställd"]);
  const reread = parseLocalWorkspace(JSON.parse(JSON.stringify(saved.workspace)), "org-local").workflowTasks[0];
  assert.equal(jobObstacle(reread)?.reason, "MATERIAL", "kept in the file");
  const back = resolveObstacle({ kind: reread.kind, status: reread.status, data: reread.data });
  const resolved = saveLocalWorkflowTaskRecord(saved.workspace, { ...saved.task, status: back.status, data: back.data });
  assert.equal(resolved.task.status, "PLANNED");
  assert.equal(jobObstacle(resolved.task), null);
  // Any other status in a later save drops a stale obstacle.
  const again = reportObstacle({ kind: resolved.task.kind, status: resolved.task.status, data: resolved.task.data }, { reason: "CUSTOMER", text: "" }, new Date(), "");
  const stale = saveLocalWorkflowTaskRecord(resolved.workspace, { ...resolved.task, status: "PLANNED", data: again.data });
  assert.equal(jobObstacle(stale.task), null);
  assert.equal((stale.task.data as { obstacle?: unknown }).obstacle, undefined);
});

test("a round's work order linked to a project in the file keeps its period, whatever the guide sent", () => {
  const made = project(createLocalWorkspace({ id: "org-local", name: "Lokala AB" }), addDays(today, 10), addDays(today, 40));
  const order = task(made.workspace, { plannedStartDate: today, dueDate: addDays(today, 300) });
  const held = { ...order.workspace, workflowTasks: order.workspace.workflowTasks.map((item) => item.id === order.task.id ? { ...item, roundScheduleId: "r1" } : item) };
  const linked = linkLocalTaskToProject(held, order.task.id, "WORK_ORDER", made.project.id, { customer: true, responsible: false, dueDate: addDays(today, 40) });
  const stored = linked.workflowTasks.find((item) => item.id === order.task.id)!;
  assert.deepEqual([stored.projectId, stored.plannedStartDate, stored.dueDate], [made.project.id, today, addDays(today, 300)]);
});

test("a work order linked to a project in the file: Start inside the frame, and its open tasks take the new dates", () => {
  const workspace = createLocalWorkspace({ id: "org-local", name: "Lokala AB" });
  const made = project(workspace, addDays(today, 10), addDays(today, 40));
  const order = task(made.workspace, { plannedStartDate: today, dueDate: addDays(today, 20) });
  const linked = linkLocalTaskToProject(order.workspace, order.task.id, "WORK_ORDER", made.project.id, { customer: true, responsible: false, dueDate: "" });
  const stored = linked.workflowTasks.find((item) => item.id === order.task.id)!;
  assert.equal(stored.plannedStartDate, addDays(today, 10), "before the frame, moved to its start");
  assert.equal(stored.dueDate, addDays(today, 20), "Klart senast inside the frame stays");
});

test("Flytta allt in the file: Start and Klart senast move on open jobs, closed ones stay, and a round's work order keeps its period (2026-11-02)", () => {
  const made = project(createLocalWorkspace({ id: "org-local", name: "Lokala AB" }), addDays(today, 10), addDays(today, 40));
  const open = task(made.workspace, { projectId: made.project.id, plannedStartDate: addDays(today, 12), dueDate: addDays(today, 20), title: "Öppen" });
  const cancelled = task(open.workspace, { projectId: made.project.id, plannedStartDate: addDays(today, 12), dueDate: addDays(today, 20), title: "Utgått" });
  const holder = task(cancelled.workspace, { projectId: made.project.id, plannedStartDate: addDays(today, 12), dueDate: addDays(today, 20), title: "Rond" });
  const prepared: LocalWorkspaceDocument = { ...holder.workspace, workflowTasks: holder.workspace.workflowTasks.map((item) =>
    item.id === cancelled.task.id ? { ...item, status: "CANCELLED" as const } : item.id === holder.task.id ? { ...item, roundScheduleId: "schedule-1" } : item) };
  const moved = saveLocalProjectRecord(prepared, { id: made.project.id, name: "Projekt", description: "", startDate: addDays(today, 17), dueDate: addDays(today, 47), customerId: null, shiftDays: 7 }).workspace;
  const after = (id: string) => moved.workflowTasks.find((item) => item.id === id)!;
  assert.deepEqual([after(open.task.id).plannedStartDate, after(open.task.id).dueDate], [addDays(today, 19), addDays(today, 27)]);
  assert.equal(after(open.task.id).version, open.task.version + 1);
  assert.deepEqual([after(cancelled.task.id).plannedStartDate, after(cancelled.task.id).dueDate], [addDays(today, 12), addDays(today, 20)], "an utgått job stays (it used to move)");
  assert.deepEqual([after(holder.task.id).plannedStartDate, after(holder.task.id).dueDate], [addDays(today, 12), addDays(today, 20)]);
});

test("Att boka in the file: the same rule as Cloud, and a booked job leaves the list", () => {
  const start = createLocalWorkspace({ id: "org-local", name: "Lokala AB" });
  const waiting = task(start, { title: "Väntar", plannedStartDate: addDays(today, 15), dueDate: addDays(today, 17) });
  const undated = task(waiting.workspace, { title: "Utan datum", plannedStartDate: "", dueDate: "" });
  const late = task(undated.workspace, { title: "Förfallen", plannedStartDate: addDays(today, -5), dueDate: addDays(today, -1) });
  const list = localWorkToBook(late.workspace, today);
  assert.ok(list.rows.some((row) => row.id === waiting.task.id));
  assert.ok(!list.rows.some((row) => row.id === late.task.id), "förfallen is counted there");
  const booked = saveLocalPlannedActivity(late.workspace, { projectId: null, workflowTaskId: waiting.task.id, title: "Bokning", description: "", kind: "TASK", status: "PLANNED",
    startsAt: new Date(Date.now() + 15 * 86_400_000).toISOString(), endsAt: new Date(Date.now() + 15 * 86_400_000 + 3_600_000).toISOString(), assignedToUserId: null, assignedToUserIds: [], assignments: [], assignedToName: "" } as never, "Lokal").workspace;
  assert.ok(!localWorkToBook(booked, today).rows.some((row) => row.id === waiting.task.id));
});
