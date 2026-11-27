import assert from "node:assert/strict";
import test from "node:test";
import { formatTimerClock, formatTimerDuration, timerNeedsAttention } from "../lib/workflow/running-timer";
import { createLocalWorkspace } from "../features/kfid/local-workspace-store";
import { saveLocalWorkflowTaskRecord, updateLocalWorkflowTimer } from "./helpers/timer-clock";
import { riskDone } from "./helpers/risk-step";

test("a timer needs attention after more than 12 hours or past midnight Swedish time", () => {
  // 08:00 Swedish summer time.
  const start = "2026-09-24T06:00:00.000Z";
  assert.equal(timerNeedsAttention(start, "2026-09-24T17:59:00.000Z"), false, "11 h 59 min the same day is fine");
  assert.equal(timerNeedsAttention(start, "2026-09-24T18:00:01.000Z"), true, "more than 12 hours");
  assert.equal(timerNeedsAttention("2026-09-24T21:30:00.000Z", "2026-09-24T22:30:00.000Z"), true, "23:30 to 00:30 Swedish time crosses midnight");
  assert.equal(timerNeedsAttention("2026-09-24T20:30:00.000Z", "2026-09-24T21:30:00.000Z"), false, "22:30 to 23:30 Swedish time does not");
  // Winter time: 23:00 UTC on 25 October is already 00:00 on 26 October in Sweden.
  assert.equal(timerNeedsAttention("2026-10-25T21:00:00.000Z", "2026-10-25T23:00:00.000Z"), true);
});

test("clock and duration labels", () => {
  assert.equal(formatTimerClock(309), "0:05:09");
  assert.equal(formatTimerClock(12 * 3600), "12:00:00");
  assert.equal(formatTimerDuration(35 * 3600 + 53 * 60), "35 h 53 min");
});

const task = (title: string) => ({ version: 0, kind: "WORK_ORDER", title, description: "", status: "PLANNED", projectId: null, customerId: null, assignedToUserId: null, assignedToName: "", dueDate: "",
  data: riskDone({ kind: "WORK_ORDER", details: { executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "" } }) });

test("Local timers are per person and starting one pauses the person's timer on another task", () => {
  let workspace = createLocalWorkspace({ id: "qa-org", name: "QA" });
  const first = saveLocalWorkflowTaskRecord(workspace, task("Första"));
  workspace = first.workspace;
  const second = saveLocalWorkflowTaskRecord(workspace, task("Andra"));
  workspace = second.workspace;
  workspace = updateLocalWorkflowTimer(workspace, first.task.id, "START", "me").workspace;
  // A colleague's entry (for example from a Cloud export) keeps running when "me" pauses.
  workspace = updateLocalWorkflowTimer(workspace, first.task.id, "START", "colleague").workspace;
  const switched = updateLocalWorkflowTimer(workspace, second.task.id, "START", "me");
  assert.equal(switched.stopped.length, 1, "the earlier timer was paused");
  assert.equal(switched.stopped[0].taskId, first.task.id);
  const firstAfter = switched.workspace.workflowTasks.find((item) => item.id === first.task.id)!;
  assert.equal(firstAfter.timeEntries.filter((entry) => !entry.endedAt).map((entry) => entry.userId).join(), "colleague");
  assert.equal(firstAfter.status, "IN_PROGRESS", "still in progress while the colleague works");
  const paused = updateLocalWorkflowTimer(switched.workspace, second.task.id, "PAUSE", "me");
  assert.equal(paused.stopped.length, 1);
  assert.equal(paused.task!.status, "PAUSED");
});

test("completing a Local task stops its running timer and reports it, like Cloud", () => {
  const data = (confirmed: boolean) => riskDone({ kind: "WORK_ORDER" as const, details: { executionNotes: confirmed ? "Utfört" : "", deviations: "", materials: [], signature: { name: confirmed ? "Signerare" : "", confirmed, signedAt: null }, closeNotes: "" } });
  const base = { version: 0, kind: "WORK_ORDER", title: "Slutförs med tidtagning", description: "", status: "PLANNED", projectId: null, customerId: null, assignedToUserId: null, assignedToName: "", dueDate: "" };
  const { workspace, task } = saveLocalWorkflowTaskRecord(createLocalWorkspace({ id: "timer-complete", name: "Tid AB" }), { ...base, data: data(false) });
  const running = updateLocalWorkflowTimer(workspace, task.id, "START", "owner").workspace;
  const started = running.workflowTasks[0];
  const completed = saveLocalWorkflowTaskRecord(running, { ...base, id: task.id, version: started.version, status: "COMPLETED", data: data(true) });
  assert.equal(completed.stopped.length, 1);
  assert.equal(completed.stopped[0].taskId, task.id);
  assert.ok(completed.task.timeEntries.every((entry) => entry.endedAt));
});

test("a timer started and paused within the first minute leaves no time entry (F10)", async () => {
  const real = await import("../features/kfid/local-workspace-store");
  const { MIN_TIME_ENTRY_SECONDS } = await import("../lib/workflow/running-timer");
  assert.equal(MIN_TIME_ENTRY_SECONDS, 60);
  let workspace = real.createLocalWorkspace({ id: "qa-org", name: "QA" });
  const saved = real.saveLocalWorkflowTaskRecord(workspace, task("Snabb paus") as never);
  workspace = real.updateLocalWorkflowTimer(saved.workspace, saved.task.id, "START", "me").workspace;
  const paused = real.updateLocalWorkflowTimer(workspace, saved.task.id, "PAUSE", "me");
  const entries = paused.workspace.workflowTasks.find((item) => item.id === saved.task.id)!.timeEntries;
  assert.equal(entries.length, 0, "no 0-minute entry");
  assert.equal(paused.workspace.timeEntryEvents.length, 0, "and nothing in the time history");
  // "Spara ändå" (2026-10-12): the same short timer is kept when the person asks for it; "Släng" is the plain rule above.
  const again = real.updateLocalWorkflowTimer(paused.workspace, saved.task.id, "START", "me").workspace;
  const kept = real.updateLocalWorkflowTimer(again, saved.task.id, "PAUSE", "me", { keepShort: true });
  const keptEntries = kept.workspace.workflowTasks.find((item) => item.id === saved.task.id)!.timeEntries;
  assert.equal(keptEntries.length, 1, "Spara ändå keeps the short entry");
  assert.ok(keptEntries[0].endedAt, "and it is stopped");
  assert.equal(kept.stopped.length, 1);
  assert.equal(kept.workspace.timeEntryEvents.length, 1, "it enters the time history");
  // Starting on another job with "Spara ändå" keeps the short entry on the first job too.
  const other = real.saveLocalWorkflowTaskRecord(kept.workspace, task("Nästa jobb") as never);
  const started = real.updateLocalWorkflowTimer(other.workspace, saved.task.id, "START", "me").workspace;
  const switched = real.updateLocalWorkflowTimer(started, other.task.id, "START", "me", { keepShort: true });
  assert.equal(switched.stopped.length, 1, "the first job's short timer was stopped and kept");
  assert.equal(switched.stopped[0].taskId, saved.task.id);
  const dropped = real.updateLocalWorkflowTimer(real.updateLocalWorkflowTimer(switched.workspace, saved.task.id, "START", "me").workspace, other.task.id, "START", "me");
  assert.equal(dropped.stopped.length, 0, "without the answer a short timer on the other job is discarded as before");
});
