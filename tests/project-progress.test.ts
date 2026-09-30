import assert from "node:assert/strict";
import { test } from "node:test";
import { controlProgress, projectCompletion, summarizeFrameAdherence } from "../lib/workflow/project-progress";
import { plannedMinutesByTask } from "../lib/workflow/capacity-summary";

test("a control stays at 95 % until it is completed", () => {
  assert.equal(controlProgress("DRAFT", 100), 95);
  assert.equal(controlProgress("DRAFT", 40), 40);
  assert.equal(controlProgress("DRAFT", undefined), 0);
  assert.equal(controlProgress("COMPLETED", 60), 100);
});

test("project completion is the plain average and a completed task counts as 100 %", () => {
  assert.equal(projectCompletion([]), 0);
  assert.equal(projectCompletion([{ status: "COMPLETED", progress: 0 }, { status: "IN_PROGRESS", progress: 50 }]), 75);
});

test("följer tidsramen compares the share completed with the share of the frame used", () => {
  // Stockholm noon on 2026-09-11: day 11 of a 30-day frame, 37 % of the frame used.
  const now = new Date("2026-09-11T10:00:00.000Z");
  const frame = { startDate: "2026-09-01", dueDate: "2026-09-30", now };
  assert.deepEqual(summarizeFrameAdherence({ ...frame, completion: 30 }), { state: "ON_TRACK", label: "Följer tidsramen", elapsedPercent: 37, completionPercent: 30 });
  assert.equal(summarizeFrameAdherence({ ...frame, completion: 26 }).state, "BEHIND");
  assert.equal(summarizeFrameAdherence({ ...frame, completion: 27 }).state, "ON_TRACK", "within the tolerance of 10 points");
  assert.equal(summarizeFrameAdherence({ ...frame, completion: 100 }).state, "DONE");
  assert.equal(summarizeFrameAdherence({ startDate: "2026-10-01", dueDate: "2026-10-31", now, completion: 0 }).state, "NOT_STARTED");
  assert.equal(summarizeFrameAdherence({ startDate: "2026-08-01", dueDate: "2026-09-10", now, completion: 90 }).state, "OVERDUE");
  assert.equal(summarizeFrameAdherence({ startDate: "", dueDate: "2026-09-30", now, completion: 10 }).state, "NO_FRAME");
  // The last day of the frame counts as fully used; a one-day frame on its day is 100 % used.
  assert.equal(summarizeFrameAdherence({ startDate: "2026-09-11", dueDate: "2026-09-11", now, completion: 95 }).elapsedPercent, 100);
});

test("planned time per task counts completed planning but never canceled or deleted planning", () => {
  const base = { assignedToUserId: null, projectId: "p", controlId: null };
  const totals = plannedMinutesByTask([
    { ...base, workflowTaskId: "t1", status: "PLANNED", startsAt: "2026-09-10T06:00:00.000Z", endsAt: "2026-09-10T08:00:00.000Z" },
    { ...base, workflowTaskId: "t1", status: "COMPLETED", startsAt: "2026-09-09T06:00:00.000Z", endsAt: "2026-09-09T07:00:00.000Z" },
    { ...base, workflowTaskId: "t1", status: "CANCELED", startsAt: "2026-09-08T06:00:00.000Z", endsAt: "2026-09-08T07:00:00.000Z" },
    { ...base, workflowTaskId: "t1", status: "PLANNED", deletedAt: "2026-09-08T00:00:00.000Z", startsAt: "2026-09-08T06:00:00.000Z", endsAt: "2026-09-08T07:00:00.000Z" },
    // Two members on one hour each count separately, and one member with 30 minutes of their own.
    { ...base, workflowTaskId: null, controlId: "c1", status: "IN_PROGRESS", startsAt: "2026-09-10T06:00:00.000Z", endsAt: "2026-09-10T07:00:00.000Z",
      assignments: [{ userId: "a", plannedMinutes: null, startsAt: null, endsAt: null }, { userId: "b", plannedMinutes: 30, startsAt: null, endsAt: null }] },
  ]);
  assert.equal(totals.get("t1"), 180);
  assert.equal(totals.get("c1"), 90);
});
