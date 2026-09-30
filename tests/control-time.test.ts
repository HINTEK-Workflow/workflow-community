import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocalWorkspace, parseLocalWorkspace, removeLocalWorkflowTimeEntry, saveLocalControlRecord, saveLocalWorkflowTaskRecord, saveLocalWorkflowTimeEntry } from "../features/kfid/local-workspace-store";
import { blankControl } from "../lib/kfid/model";

const workOrderData = { kind: "WORK_ORDER" as const, details: { executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "" } };

test("manual time on a Local control moves between control and work order with the same id and history", () => {
  const empty = createLocalWorkspace({ id: "control-time", name: "Kontrolltid AB" });
  const data = blankControl();
  data.meta.proj = "Kontroll med tid";
  const withControl = saveLocalControlRecord(empty, { version: 0, customerId: null, data, status: "DRAFT" });
  const control = withControl.control;
  assert.deepEqual(control.timeEntries, [], "a new control starts without time");
  const { workspace, task } = saveLocalWorkflowTaskRecord(withControl.workspace, { version: 0, kind: "WORK_ORDER", title: "Arbetsorder", description: "", status: "PLANNED", projectId: null, customerId: null, siteId: null, departmentId: null, assignedToUserId: null, assignedToName: "", dueDate: "", data: workOrderData });

  const created = saveLocalWorkflowTimeEntry(workspace, { taskId: control.id, startedAt: "2026-09-21T07:00:00.000Z", endedAt: "2026-09-21T09:00:00.000Z", note: "Mätning" }, "owner", "", "Ägare");
  const entry = created.controls[0].timeEntries[0];
  assert.equal(entry.durationSec, 7200);
  assert.equal(created.timeEntryEvents[0].next?.taskTitle, "Kontroll med tid");

  const moved = saveLocalWorkflowTimeEntry(created, { id: entry.id, taskId: task.id, startedAt: entry.startedAt, endedAt: entry.endedAt!, note: "Mätning" }, "owner", "", "Ägare");
  assert.equal(moved.controls[0].timeEntries.length, 0);
  assert.equal(moved.workflowTasks[0].timeEntries[0].id, entry.id, "the entry keeps its id when it changes task");
  const back = saveLocalWorkflowTimeEntry(moved, { id: entry.id, taskId: control.id, startedAt: entry.startedAt, endedAt: entry.endedAt!, note: "Mätning" }, "owner", "", "Ägare");
  assert.equal(back.controls[0].timeEntries[0].id, entry.id);
  assert.equal(back.workflowTasks[0].timeEntries.length, 0);
  assert.deepEqual(back.timeEntryEvents.map((event) => event.action), ["UPDATED", "UPDATED", "CREATED"]);

  const reloaded = parseLocalWorkspace(JSON.parse(JSON.stringify(back)), "control-time");
  assert.equal(reloaded.controls[0].timeEntries.length, 1, "control time survives the file");
  const older = JSON.parse(JSON.stringify(back));
  delete older.controls[0].timeEntries;
  assert.deepEqual(parseLocalWorkspace(older, "control-time").controls[0].timeEntries, [], "older files read as controls without time");

  const removed = removeLocalWorkflowTimeEntry(back, entry.id, "owner", "", "Ägare");
  assert.equal(removed.controls[0].timeEntries.length, 0);
  assert.equal(removed.timeEntryEvents[0].action, "DELETED");

  // A deleted control takes no new time.
  const deleted = { ...back, controls: back.controls.map((item) => ({ ...item, deletedAt: "2026-09-22T00:00:00.000Z" })) };
  assert.throws(() => saveLocalWorkflowTimeEntry(deleted, { taskId: control.id, startedAt: "2026-09-21T07:00:00.000Z", endedAt: "2026-09-21T08:00:00.000Z", note: "" }, "owner"), /hittades inte/);
});
