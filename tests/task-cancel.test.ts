import assert from "node:assert/strict";
import test from "node:test";
import { bookingOnCancelledJob, cancelTaskError, isTaskClosed, isTaskOpen, restoredTaskStatus, restoreTaskError, tasksForProgress } from "../lib/workflow/task-cancel";
import { savedTaskStatus } from "../lib/workflow/task-status-rule";
import { workStateMatches, workStateOf } from "../lib/workflow/work-list";
import { workOrderMatches } from "../lib/workflow/work-orders";
import { projectCompletion } from "../lib/workflow/project-progress";
import { summarizeProjectStatus } from "../lib/workflow/project-status";
import { summarizeOverviewKpis } from "../lib/workflow/overview-kpis";
import { buildOverviewWork } from "../lib/workflow/overview-work";
import { taskNotifications } from "../lib/workflow/task-notifications";
import { summarizeAvailability } from "../lib/workflow/availability-summary";
import { groupProjectJobs, JOB_STEP_LABELS } from "../lib/workflow/project-jobs";
import { workOrderLinkError } from "../lib/workflow/work-order-link";
import { readFileSync } from "node:fs";
import { progressTone } from "../features/workflow/indicator-tone";
import { keyMayRun, TOOL_CATALOG, toolInputSchema } from "../lib/tools/catalog";
import { ASSISTANT_READ_TOOLS } from "../lib/ai/assistant-tools";
import { createLocalWorkspace, saveLocalPlannedActivity, setLocalWorkflowTaskCancelled } from "../features/kfid/local-workspace-store";
import { saveLocalWorkflowTaskRecord } from "./helpers/timer-clock";

// Utgår (2026-10-09): a job that will not be done, with a reason, kept read-only and never open, late or remaining.

test("Utgår needs a short reason and an open job", () => {
  assert.equal(cancelTaskError({ status: "PLANNED" }, "Kunden avbeställde"), null);
  assert.equal(cancelTaskError({ status: "IN_PROGRESS" }, "Ingår i AO 12"), null);
  assert.match(cancelTaskError({ status: "PLANNED" }, "  ")!, /orsak/i);
  assert.match(cancelTaskError({ status: "PLANNED" }, "ab")!, /minst 3/);
  assert.match(cancelTaskError({ status: "PLANNED" }, "x".repeat(501))!, /högst 500/);
  assert.match(cancelTaskError({ status: "COMPLETED" }, "Görs inte")!, /färdigställt/);
  assert.match(cancelTaskError({ status: "CANCELLED" }, "Görs inte")!, /redan/);
});

test("Återuppta only lifts a job that has utgått, and gives back a status time does not contradict", () => {
  assert.equal(restoreTaskError({ status: "CANCELLED" }), null);
  assert.ok(restoreTaskError({ status: "PLANNED" }));
  assert.equal(restoredTaskStatus("PLANNED"), "PLANNED");
  assert.equal(restoredTaskStatus("NEEDS_ACTION"), "NEEDS_ACTION");
  assert.equal(restoredTaskStatus("IN_PROGRESS"), "PAUSED", "Utgår stopped the time, so Pågår comes back as Pausad");
  assert.equal(restoredTaskStatus("PAUSED"), "PAUSED");
  assert.equal(restoredTaskStatus(null), "PLANNED");
  assert.equal(restoredTaskStatus("COMPLETED"), "PLANNED");
});

test("a save never sets or lifts Utgår", () => {
  assert.equal(savedTaskStatus({ requested: "CANCELLED", stored: "PLANNED" }), "PLANNED");
  assert.equal(savedTaskStatus({ requested: "CANCELLED", stored: "IN_PROGRESS" }), "IN_PROGRESS");
  assert.equal(savedTaskStatus({ requested: "CANCELLED", stored: null }), "PLANNED", "a new task is never created as Utgår");
});

test("closed and open statuses", () => {
  assert.equal(isTaskClosed("CANCELLED"), true);
  assert.equal(isTaskClosed("COMPLETED"), true);
  assert.equal(isTaskOpen("NEEDS_ACTION"), true);
  assert.equal(isTaskOpen("CANCELLED"), false);
});

test("Mina jobb and Arbetsorder list Utgått apart, never among the open ones", () => {
  const cancelled = { status: "CANCELLED", progress: 40 };
  assert.equal(workStateOf(cancelled), "cancelled");
  const entry = { state: workStateOf(cancelled), status: cancelled.status };
  assert.equal(workStateMatches(entry, "open"), false);
  assert.equal(workStateMatches(entry, "active"), false);
  assert.equal(workStateMatches(entry, "action"), false);
  assert.equal(workStateMatches(entry, "done"), false);
  assert.equal(workStateMatches(entry, "cancelled"), true);
  assert.equal(workStateMatches(entry, "all"), true);
  assert.equal(workOrderMatches({ status: "CANCELLED", progress: 0 }, "open"), false);
  assert.equal(workOrderMatches({ status: "CANCELLED", progress: 0 }, "cancelled"), true);
  assert.equal(workOrderMatches({ status: "NEEDS_ACTION", progress: 0 }, "cancelled"), false);
});

test("project progress leaves Utgått jobs out of the percentage", () => {
  assert.equal(projectCompletion([{ status: "COMPLETED", progress: 100 }, { status: "CANCELLED", progress: 10 }]), 100);
  assert.equal(projectCompletion([{ status: "IN_PROGRESS", progress: 50 }, { status: "CANCELLED", progress: 0 }]), 50);
  assert.equal(tasksForProgress([{ status: "CANCELLED" }, { status: "PLANNED" }]).length, 1);
});

test("Utgått jobs never keep a project open and count as done for Klar att avsluta", () => {
  const now = new Date("2026-10-09T10:00:00.000Z");
  const status = summarizeProjectStatus({ now, tasks: [{ status: "COMPLETED" }, { status: "CANCELLED" }] });
  assert.equal(status.state, "READY_TO_CLOSE");
  const open = summarizeProjectStatus({ now, tasks: [{ status: "CANCELLED" }, { status: "PLANNED" }] });
  assert.equal(open.closeBlocker, "1 uppgift återstår");
  // A booking ahead on a job that has utgått does not hold the project open.
  const booked = summarizeProjectStatus({ now, tasks: [{ id: "t1", status: "CANCELLED" }], activities: [{ status: "PLANNED", endsAt: "2026-10-20T10:00:00.000Z", workflowTaskId: "t1" }] } as Parameters<typeof summarizeProjectStatus>[0]);
  assert.equal(booked.state, "READY_TO_CLOSE");
});

test("key figures, the overview list and notices ignore Utgått jobs", () => {
  const now = new Date("2026-10-09T10:00:00.000Z");
  const kpis = summarizeOverviewKpis({
    scope: "team", currentUserId: "u1", now, members: [], projects: [], timeEntries: [], activities: [],
    tasks: [
      { kind: "WORK_ORDER", status: "CANCELLED", dueDate: "2026-10-01", completedAt: null, isMine: true },
      { kind: "WORK_ORDER", status: "NEEDS_ACTION", dueDate: "2026-10-01", completedAt: null, isMine: true },
    ],
  });
  assert.equal(kpis.openTasks, 1);
  assert.equal(kpis.overdueTasks, 1);
  assert.equal(kpis.needsActionTasks, 1);
  const [item] = buildOverviewWork({ today: "2026-10-09", projects: [], tasks: [{ id: "t1", title: "Byte", kind: "WORK_ORDER", status: "CANCELLED", progress: 30, dueDate: "2026-10-01", updatedAt: now.toISOString() }] });
  assert.equal(item.status, "Utgått");
  assert.equal(item.overdue, false);
  assert.equal(item.needsAction, false);
  assert.deepEqual(taskNotifications([{ id: "t1", title: "Byte", kind: "WORK_ORDER", status: "CANCELLED", dueDate: "2026-10-01" }], "2026-10-09"), []);
});

test("bookings on a job that has utgått never clash", () => {
  const booking = (id: string, status?: string) => ({ id, title: id, startsAt: "2026-10-12T08:00:00.000Z", endsAt: "2026-10-12T10:00:00.000Z", status: "PLANNED" as const, assignedToUserId: "a", assignedToUserIds: ["a"], workflowTask: status ? { status } : null });
  assert.equal(summarizeAvailability([booking("A"), booking("B")]).conflicts.length, 1);
  assert.equal(summarizeAvailability([booking("A"), booking("B", "CANCELLED")]).conflicts.length, 0);
  assert.equal(bookingOnCancelledJob({ workflowTask: { status: "CANCELLED" } }), true);
  assert.equal(bookingOnCancelledJob({}), false);
});

test("the project page shows Utgått jobs after the open ones, and a cancelled work order takes no new tasks", () => {
  const grouped = groupProjectJobs([{ id: "a", kind: "FORM", status: "CANCELLED" }, { id: "b", kind: "FORM", status: "PLANNED" }]);
  assert.deepEqual(grouped.standalone.map((task) => task.id), ["b", "a"]);
  assert.equal(JOB_STEP_LABELS.cancelled, "Utgått");
  const order = { id: "wo", kind: "WORK_ORDER", status: "CANCELLED", projectId: null, customerId: null };
  assert.match(workOrderLinkError({ kind: "FORM", workOrderId: "wo", projectId: null, customerId: null } as Parameters<typeof workOrderLinkError>[0], order as Parameters<typeof workOrderLinkError>[1])!, /utgått/);
});

test("an Utgått job's progress bar is grey, never green or red", () => {
  assert.equal(progressTone({ percent: 40, cancelled: true }), "neutral");
  assert.equal(progressTone({ percent: 40, attention: true, cancelled: true }), "neutral");
  assert.equal(progressTone({ percent: 40 }), "info");
});

test("API and MCP: cancel_task needs a reason, restore_task only the job, both write with tasks:write / mcp:write", () => {
  for (const name of ["cancel_task", "restore_task"] as const) {
    assert.equal(TOOL_CATALOG[name].effect, "update");
    assert.equal(TOOL_CATALOG[name].apiScope, "tasks:write");
    assert.equal(keyMayRun("API", ["tasks:write"], name), true);
    assert.equal(keyMayRun("API", ["tasks:read", "projects:write"], name), false);
    assert.equal(keyMayRun("MCP", ["mcp:write"], name), true);
    assert.equal(keyMayRun("MCP", ["mcp:read", "mcp:delete"], name), false);
  }
  const cancel = TOOL_CATALOG.cancel_task.input;
  assert.equal(cancel.safeParse({ taskId: "t1", reason: "Kunden avbeställde" }).success, true);
  assert.equal(cancel.safeParse({ taskId: "t1" }).success, false, "the reason is required");
  assert.equal(cancel.safeParse({ taskId: "t1", reason: "  ab " }).success, false, "at least 3 characters");
  assert.equal(cancel.safeParse({ taskId: "t1", reason: "x".repeat(501) }).success, false, "at most 500 characters");
  assert.deepEqual((toolInputSchema("cancel_task") as { required: string[] }).required.sort(), ["reason", "taskId"]);
  assert.equal(TOOL_CATALOG.restore_task.input.safeParse({ taskId: "t1" }).success, true);
  assert.equal(TOOL_CATALOG.restore_task.input.safeParse({}).success, false);
  // Never offered to Workflow AI's chat, which only reads.
  assert.equal((ASSISTANT_READ_TOOLS as readonly string[]).includes("cancel_task"), false);
  assert.equal((ASSISTANT_READ_TOOLS as readonly string[]).includes("restore_task"), false);
});

test("the tools run the tasks route's own cancel and restore, which check the job's edit permission like the buttons", () => {
  const registry = readFileSync("lib/tools/registry.ts", "utf8");
  assert.match(registry, /cancel_task: async[\s\S]{0,200}callRoute\(tasksRoute\.POST, "POST", "\/api\/workflow-tasks", \{ action: "cancel", id: taskId, reason \}\)/);
  assert.match(registry, /restore_task: async[\s\S]{0,200}callRoute\(tasksRoute\.POST, "POST", "\/api\/workflow-tasks", \{ action: "restore", id: taskId \}\)/);
  const route = readFileSync("app/api/workflow-tasks/route.ts", "utf8");
  assert.match(route, /input\.action === "cancel" \|\| input\.action === "restore"[\s\S]{0,400}requireWorkflowPermission\(ctx, workflowSubjectForTask\(task\.kind, task\.formArea\), "edit"\)[\s\S]{0,200}cancelTaskError\(task, input\.reason\) : restoreTaskError\(task\)/);
});

test("Local refuses new planning on a job that has utgått, like Cloud, and its bookings carry the job's status", () => {
  const empty = createLocalWorkspace({ id: "org-local", name: "Lokala AB" });
  const { workspace, task } = saveLocalWorkflowTaskRecord(empty, { version: 0, kind: "WORK_ORDER", title: "Byte av armatur", description: "", status: "PLANNED", projectId: null, customerId: null, assignedToUserId: null, assignedToName: "", dueDate: "", data: { kind: "WORK_ORDER", details: { executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "" } } });
  const booking = { title: "Bokning", kind: "TASK", status: "PLANNED", startsAt: "2026-10-12T08:00:00.000Z", endsAt: "2026-10-12T10:00:00.000Z", projectId: null, workflowTaskId: task.id, controlId: null, assignedToUserId: null };
  assert.doesNotThrow(() => saveLocalPlannedActivity(workspace, booking));
  const cancelled = setLocalWorkflowTaskCancelled(workspace, task.id, { cancel: true, reason: "Kunden avbeställde" });
  assert.throws(() => saveLocalPlannedActivity(cancelled, booking), /utgått/);
  assert.doesNotThrow(() => saveLocalPlannedActivity(cancelled, { ...booking, status: "CANCELED" }), "a cancelled booking may still be saved");
  const local = readFileSync("features/kfid/local-workspace.tsx", "utf8");
  assert.match(local, /plannedActivities: workspace\.plannedActivities\.map\(\(activity\) => \(\{ \.\.\.activity, workflowTask: localBookedJob\(activity\.workflowTaskId\) \}\)\)/);
  assert.match(local, /projectId: activity\.projectId, workflowTask: localBookedJob\(activity\.workflowTaskId\)/);
});
