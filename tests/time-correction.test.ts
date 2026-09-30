import assert from "node:assert/strict";
import test from "node:test";
import { assertTimeCorrection, timeCorrectionRequiresReason, TimeCorrectionError } from "../lib/workflow/time-correction";
import { createLocalWorkspace, removeLocalWorkflowTimeEntry, saveLocalWorkflowTimeEntry } from "../features/kfid/local-workspace-store";
import { saveLocalWorkflowTaskRecord, updateLocalWorkflowTimer } from "./helpers/timer-clock";

const open = { status: "IN_PROGRESS", archived: false };
const completed = { status: "COMPLETED", archived: false };
const archived = { status: "IN_PROGRESS", archived: true };
const rejects = (fn: () => unknown, status: number, message: RegExp) => assert.throws(fn, (error: unknown) => error instanceof TimeCorrectionError && error.status === status && message.test(error.message));

test("members correct only their own time on open tasks without a comment", () => {
  assert.equal(assertTimeCorrection({ actorIsAdmin: false, actorOwnsEntry: true, source: open, target: open }, ""), "");
  rejects(() => assertTimeCorrection({ actorIsAdmin: false, actorOwnsEntry: false, source: open }, "fel"), 403, /egen/);
  rejects(() => assertTimeCorrection({ actorIsAdmin: false, actorOwnsEntry: true, source: completed }, "fel"), 409, /administratör/);
  rejects(() => assertTimeCorrection({ actorIsAdmin: false, actorOwnsEntry: true, source: open, target: completed }, "fel"), 409, /slutförd/);
});

test("admins need a comment for other members' time and for completed tasks", () => {
  assert.equal(timeCorrectionRequiresReason({ actorIsAdmin: true, actorOwnsEntry: true, source: open, target: open }), false);
  assert.equal(timeCorrectionRequiresReason({ actorIsAdmin: true, actorOwnsEntry: false, target: open }), true);
  assert.equal(timeCorrectionRequiresReason({ actorIsAdmin: true, actorOwnsEntry: true, source: open, target: completed }), true);
  rejects(() => assertTimeCorrection({ actorIsAdmin: true, actorOwnsEntry: false, source: open }, "   "), 422, /kommentar/);
  assert.equal(assertTimeCorrection({ actorIsAdmin: true, actorOwnsEntry: false, source: completed }, "  Flyttad från fel order  "), "Flyttad från fel order");
});

test("archived projects block every time change until restored", () => {
  rejects(() => assertTimeCorrection({ actorIsAdmin: true, actorOwnsEntry: true, source: archived }, "kommentar"), 409, /Återställ projektet/);
  rejects(() => assertTimeCorrection({ actorIsAdmin: true, actorOwnsEntry: true, source: open, target: archived }, "kommentar"), 409, /Återställ projektet/);
});

test("Local keeps an append-only time history and requires a comment on completed tasks", () => {
  const empty = createLocalWorkspace({ id: "org-local", name: "Lokala AB" });
  const { workspace, task } = saveLocalWorkflowTaskRecord(empty, { version: 0, kind: "WORK_ORDER", title: "Lokal arbetsorder", description: "", status: "PLANNED", projectId: null, customerId: null, siteId: null, departmentId: null, assignedToUserId: null, assignedToName: "", dueDate: "", data: { kind: "WORK_ORDER", details: { executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "" } } });
  const created = saveLocalWorkflowTimeEntry(workspace, { taskId: task.id, startedAt: "2026-09-21T07:00:00.000Z", endedAt: "2026-09-21T09:00:00.000Z", note: "" }, "owner", "", "Ägare");
  const entryId = created.workflowTasks[0].timeEntries[0].id;
  assert.equal(created.timeEntryEvents.length, 1);
  assert.equal(created.timeEntryEvents[0].action, "CREATED");

  const completedTask = { ...created, workflowTasks: created.workflowTasks.map((item) => ({ ...item, status: "COMPLETED" as const })) };
  assert.throws(() => saveLocalWorkflowTimeEntry(completedTask, { id: entryId, taskId: task.id, startedAt: "2026-09-21T07:00:00.000Z", endedAt: "2026-09-21T08:00:00.000Z", note: "" }, "owner", ""), /kommentar/);
  const corrected = saveLocalWorkflowTimeEntry(completedTask, { id: entryId, taskId: task.id, startedAt: "2026-09-21T07:00:00.000Z", endedAt: "2026-09-21T08:00:00.000Z", note: "" }, "owner", "Rättad dubbelregistrering", "Ägare");
  assert.equal(corrected.timeEntryEvents[0].action, "UPDATED");
  assert.equal(corrected.timeEntryEvents[0].previous?.durationSec, 7200);
  assert.equal(corrected.timeEntryEvents[0].next?.durationSec, 3600);
  assert.equal(corrected.timeEntryEvents[0].reason, "Rättad dubbelregistrering");

  const removed = removeLocalWorkflowTimeEntry(corrected, entryId, "owner", "Fel uppgift", "Ägare");
  assert.equal(removed.workflowTasks[0].timeEntries.length, 0);
  assert.deepEqual(removed.timeEntryEvents.map((event) => event.action), ["DELETED", "UPDATED", "CREATED"]);
  assert.equal(removed.timeEntryEvents[0].previous?.durationSec, 3600);
});

test("Local start/pause timing enters the time history when the timer stops", () => {
  const empty = createLocalWorkspace({ id: "org-local", name: "Lokala AB" });
  const { workspace, task } = saveLocalWorkflowTaskRecord(empty, { version: 0, kind: "WORK_ORDER", title: "Tidtagning", description: "", status: "PLANNED", projectId: null, customerId: null, siteId: null, departmentId: null, assignedToUserId: null, assignedToName: "", dueDate: "", data: { kind: "WORK_ORDER", details: { executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "" } } });
  const started = updateLocalWorkflowTimer(workspace, task.id, "START", "owner").workspace;
  assert.equal(started.timeEntryEvents.length, 0, "A running entry is not history yet");
  const paused = updateLocalWorkflowTimer(started, task.id, "PAUSE", "owner").workspace;
  assert.equal(paused.timeEntryEvents.length, 1);
  assert.equal(paused.timeEntryEvents[0].action, "CREATED");
  assert.equal(paused.timeEntryEvents[0].entryId, paused.workflowTasks[0].timeEntries[0].id);
  assert.ok(paused.timeEntryEvents[0].next?.endedAt);
  assert.equal(paused.timeEntryEvents[0].actorName, "Lokala AB");
});
