import assert from "node:assert/strict";
import test from "node:test";
import { isLateStart, isLateTask, LATE_STATE_LABEL, lateStateOf } from "../lib/workflow/late-tasks";
import { workStateMatches, workStateOf } from "../lib/workflow/work-list";
import { withoutAssignedDueSoon, type TaskNotification } from "../lib/workflow/task-notifications";
import { FORTNOX_CONNECTION_READY } from "../lib/quotes/accounting";
import { OFFERED_EXTERNAL_PROVIDERS } from "../lib/integrations/key-catalog";

const today = "2026-11-01";

// Beslut 15 (2026-11-01): one rule for each word.
test("Förfallen: the end date has passed on an open job", () => {
  assert.equal(LATE_STATE_LABEL.overdue, "Förfallen");
  assert.equal(lateStateOf({ status: "PLANNED", dueDate: "2026-10-31" }, today), "overdue");
  assert.equal(lateStateOf({ status: "IN_PROGRESS", dueDate: "2026-10-31", progress: 40 }, today), "overdue", "also when it is under way");
  assert.equal(lateStateOf({ status: "PLANNED", dueDate: today }, today), null, "the last day itself is not late");
  for (const status of ["COMPLETED", "CANCELLED"]) assert.equal(isLateTask({ status, dueDate: "2026-10-01" }, today), false, status);
});

test("Försenad start: the start date has passed and nobody has begun", () => {
  assert.equal(LATE_STATE_LABEL.late_start, "Försenad start");
  const job = { status: "PLANNED", plannedStartDate: "2026-10-30", dueDate: "2026-11-20", progress: 0 };
  assert.equal(lateStateOf(job, today), "late_start");
  assert.equal(isLateStart({ ...job, plannedStartDate: today }, today), false, "starting today is not late");
  assert.equal(isLateStart({ ...job, plannedStartDate: "" }, today), false, "no start date");
  assert.equal(isLateStart({ ...job, progress: 10 }, today), false, "progress means it has begun");
  assert.equal(isLateStart({ ...job, startedAt: "2026-10-30T08:00:00Z" }, today), false, "time means it has begun");
  for (const status of ["IN_PROGRESS", "PAUSED", "NEEDS_ACTION", "COMPLETED", "CANCELLED"]) assert.equal(isLateStart({ ...job, status }, today), false, status);
});

test("a job past both dates is Förfallen, never both", () => {
  const job = { status: "PLANNED", plannedStartDate: "2026-10-01", dueDate: "2026-10-15" };
  assert.equal(lateStateOf(job, today), "overdue");
  assert.equal(isLateStart(job, today), false);
});

test("the lists' filters use the same rules, so a figure and its list have as many rows", () => {
  const jobs = [
    { id: "late-start", status: "PLANNED", progress: 0, plannedStartDate: "2026-10-30", dueDate: "2026-11-20" },
    { id: "overdue", status: "IN_PROGRESS", progress: 20, plannedStartDate: "2026-10-01", dueDate: "2026-10-20" },
    { id: "both-dates", status: "PLANNED", progress: 0, plannedStartDate: "2026-10-01", dueDate: "2026-10-20" },
    { id: "coming", status: "PLANNED", progress: 0, plannedStartDate: "2026-11-05", dueDate: "2026-11-20" },
    { id: "done", status: "COMPLETED", progress: 100, plannedStartDate: "2026-10-01", dueDate: "2026-10-20" },
    { id: "marked", status: "NEEDS_ACTION", progress: 0, plannedStartDate: "2026-10-30", dueDate: "" },
    { id: "waiting", status: "PAUSED", progress: 10, plannedStartDate: "", dueDate: "", waitingOn: "MATERIAL" },
    { id: "paused", status: "PAUSED", progress: 10, plannedStartDate: "", dueDate: "" },
  ];
  const list = (filter: "late_start" | "overdue" | "blocked") => jobs.filter((job) => workStateMatches({ ...job, state: workStateOf(job) }, filter, today)).map((job) => job.id);
  assert.deepEqual(list("late_start"), ["late-start"]);
  assert.deepEqual(list("overdue"), ["overdue", "both-dates"]);
  assert.deepEqual(list("blocked"), ["marked", "waiting"], "Behöver åtgärdas, or Pausad and waiting for something");
  for (const job of jobs) assert.equal(workStateMatches({ ...job, state: workStateOf(job) }, "overdue", today), lateStateOf(job, today) === "overdue", job.id);
});

// TE13 (användartest 2026-10-31): a new job gives one notice.
test("Snart förfallande waits while Tilldelad dig is unread; what is pressing is always told", () => {
  const notice = (id: string, over: Partial<TaskNotification>): TaskNotification => ({ id, title: id, kind: "WORK_ORDER", href: `/${id}`, dueDate: "2026-11-03", deadline: null, needsAction: false, ...over });
  const assigned = [notice("a", { kind: "ASSIGNED" })];
  const kept = withoutAssignedDueSoon([
    notice("a", { deadline: "DUE_SOON" }), notice("b", { deadline: "DUE_SOON" }),
    notice("a", { id: "a-late", deadline: "OVERDUE" }), notice("a", { id: "a-action", deadline: "DUE_SOON", needsAction: true }), notice("a", { id: "a-urgent", deadline: "DUE_SOON", urgent: true }),
  ], assigned);
  assert.deepEqual(kept.map((item) => item.id), ["b", "a-late", "a-action", "a-urgent"]);
});

// Beslut 16 (2026-11-01): one condition, and it is off until a real connection exists.
test("Fortnox is hidden by one condition and no new key can be added", () => {
  assert.equal(FORTNOX_CONNECTION_READY, false);
  assert.ok(!(OFFERED_EXTERNAL_PROVIDERS as readonly string[]).includes("fortnox"));
});
