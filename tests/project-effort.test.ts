import assert from "node:assert/strict";
import test from "node:test";
import { projectCompletion } from "../lib/workflow/project-progress";
import { datesOnProjectLink, startFollowingDue, startOnProjectLink } from "../lib/workflow/job-planning";
import { effortLine, projectEffort, unbookedText } from "../lib/workflow/project-effort";
import {
  bookingMoveRefusal, bookingShiftWorkdays, delayedByPredecessor, dependencyConflicts, movableBooking, predecessorError, shiftBookingTimes,
  taskScheduleError, type DependencyJob,
} from "../lib/workflow/schedule";
import { workflowTaskInputSchema } from "../lib/workflow/task-model";
import { swedishParts } from "../lib/swedish-time";

/** Projektförslaget 2026-10-09 steg 2 (Start, Uppskattad tid, tre tal, viktad procent) and steg 4 (Börjar efter). */

test("linking to a project: a Start after the moved Klart senast follows it, otherwise nothing changes", () => {
  assert.deepEqual(startFollowingDue("2026-11-05", "2026-10-31"), { plannedStartDate: "2026-10-31" });
  assert.deepEqual(startFollowingDue("2026-10-20", "2026-10-31"), {});
  assert.deepEqual(startFollowingDue("2026-10-31", "2026-10-31"), {});
  assert.deepEqual(startFollowingDue("", "2026-10-31"), {});
  assert.deepEqual(startFollowingDue("2026-11-05", ""), {});
});

test("Start and Uppskattad tid on the job follow the time plan's rules", () => {
  const frame = { startDate: "2026-10-01", dueDate: "2026-10-31" };
  assert.equal(taskScheduleError({ plannedStartDate: "2026-10-12", dueDate: "2026-10-16", estimatedMinutes: 960 }, null, frame), null);
  assert.equal(taskScheduleError({ plannedStartDate: "2026-10-20", dueDate: "2026-10-16" }, null, frame), "Start måste vara före eller samma dag som Klart senast.");
  assert.match(taskScheduleError({ plannedStartDate: "2026-09-28", dueDate: "2026-10-16" }, null, frame) ?? "", /inom projektets tidsram \(2026-10-01–2026-10-31\)/);
  assert.match(taskScheduleError({ dueDate: "", estimatedMinutes: -5 }, null, null) ?? "", /Uppskattad tid/);
  // Left out = unchanged: an older Start outside the frame stays (decision 15), but Klart senast moved before it is refused.
  const previous = { plannedStartDate: "2026-09-28", dueDate: "2026-10-16", projectId: "p" };
  assert.equal(taskScheduleError({ dueDate: "2026-10-20", projectId: "p" }, previous, frame), null);
  assert.equal(taskScheduleError({ dueDate: "2026-09-25", projectId: "p" }, previous, frame), "Start måste vara före eller samma dag som Klart senast.");
  // A job without a project, or without Start, has nothing more to check.
  assert.equal(taskScheduleError({ plannedStartDate: "2026-12-01", dueDate: "" }, null, null), null);
});

test("the task input takes Start and Uppskattad tid and stays optional for older callers", () => {
  const base = { kind: "WORK_ORDER", title: "Jobb", data: { kind: "WORK_ORDER", details: { executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "" } } };
  const older = workflowTaskInputSchema.parse(base);
  assert.equal(older.plannedStartDate, undefined);
  assert.equal(older.estimatedMinutes, undefined);
  const planned = workflowTaskInputSchema.parse({ ...base, plannedStartDate: "2026-10-12", estimatedMinutes: 960 });
  assert.equal(planned.plannedStartDate, "2026-10-12");
  assert.equal(planned.estimatedMinutes, 960);
  assert.equal(workflowTaskInputSchema.safeParse({ ...base, plannedStartDate: "12/10" }).success, false);
  assert.equal(workflowTaskInputSchema.safeParse({ ...base, estimatedMinutes: 1.5 }).success, false);
});

test("bookings move with the job by the same number of workdays, the clock kept", () => {
  assert.equal(bookingShiftWorkdays({ plannedStartDate: "2026-10-12" }, { plannedStartDate: "2026-10-15" }), 3);
  assert.equal(bookingShiftWorkdays({ plannedStartDate: "" }, { plannedStartDate: "2026-10-15" }), 0);
  // Tue 13 Oct 07:00–16:00 three workdays on: Fri 16 Oct, same hours.
  const moved = shiftBookingTimes({ startsAt: "2026-10-13T05:00:00.000Z", endsAt: "2026-10-13T14:00:00.000Z" }, 3);
  assert.deepEqual([swedishParts(moved.startsAt).day, swedishParts(moved.startsAt).hour, swedishParts(moved.endsAt).hour], [16, 7, 16]);
  // Thu 22 Oct → two workdays on is Mon 26 Oct (over the weekend), across the change to winter time on 25 Oct.
  const winter = shiftBookingTimes({ startsAt: "2026-10-22T05:00:00.000Z", endsAt: "2026-10-22T14:00:00.000Z" }, 2);
  assert.deepEqual([swedishParts(winter.startsAt).day, swedishParts(winter.startsAt).hour, swedishParts(winter.endsAt).hour], [26, 7, 16]);
  // Mon–Fri over a week keeps its first and last workday; backwards too.
  const week = shiftBookingTimes({ startsAt: "2026-10-12T05:00:00.000Z", endsAt: "2026-10-16T14:00:00.000Z" }, -1);
  assert.deepEqual([swedishParts(week.startsAt).day, swedishParts(week.endsAt).day], [9, 15]);
  // Milestones and Genomförd/Inställd bookings never move.
  assert.equal(movableBooking({ kind: "TASK", status: "PLANNED" }), true);
  assert.equal(movableBooking({ kind: "DEADLINE", status: "PLANNED" }), false);
  assert.equal(movableBooking({ kind: "TASK", status: "COMPLETED" }), false);
  assert.equal(bookingMoveRefusal([]), null);
  assert.match(bookingMoveRefusal([{ people: "Anna", title: "Arbete", startDay: "2026-10-13", endDay: "2026-10-13" }]) ?? "", /^Bokningarna kan inte flyttas med: Anna 13 okt\. Andras bokningar/);
});

test("Börjar efter: same project, not itself, no circle", () => {
  const jobs = [{ id: "a", predecessorIds: [] }, { id: "b", predecessorIds: ["a"] }, { id: "c", predecessorIds: ["b"] }];
  assert.equal(predecessorError("c", ["a", "b"], jobs), null);
  assert.equal(predecessorError("a", ["a"], jobs), "Ett jobb kan inte börja efter sig självt.");
  assert.equal(predecessorError("a", ["x"], jobs), "Börjar efter kan bara peka på jobb i samma projekt.");
  assert.match(predecessorError("a", ["c"], jobs) ?? "", /cirkel/);
  assert.equal(predecessorError("a", ["b", "b"], jobs), "Samma jobb står två gånger under Börjar efter.");
});

test("a job that starts before its predecessor is done is warned about, and late predecessors mark their successors", () => {
  const job = (values: Partial<DependencyJob> & { id: string }): DependencyJob => ({ title: values.id.toUpperCase(), status: "PLANNED", plannedStartDate: "", dueDate: "", predecessorIds: [], ...values });
  const jobs = [
    job({ id: "a", plannedStartDate: "2026-10-05", dueDate: "2026-10-09", status: "IN_PROGRESS" }),
    job({ id: "b", plannedStartDate: "2026-10-09", dueDate: "2026-10-14", predecessorIds: ["a"] }),
    job({ id: "c", plannedStartDate: "2026-10-15", dueDate: "2026-10-16", predecessorIds: ["b"] }),
    job({ id: "d", plannedStartDate: "2026-10-01", dueDate: "2026-10-02", predecessorIds: ["e"] }),
    job({ id: "e", plannedStartDate: "2026-10-05", dueDate: "2026-10-06", status: "COMPLETED" }),
  ];
  assert.deepEqual(dependencyConflicts(jobs), [{ jobId: "b", predecessorId: "a", predecessorTitle: "A", predecessorEnd: "2026-10-09" }]);
  assert.deepEqual([...delayedByPredecessor(jobs, "2026-10-12")], ["b"]);
});

test("the project's completion is weighted by Uppskattad tid when a job has it, and unchanged otherwise", () => {
  assert.equal(projectCompletion([{ status: "COMPLETED", progress: 0 }, { status: "IN_PROGRESS", progress: 50 }]), 75);
  assert.equal(projectCompletion([{ status: "COMPLETED", progress: 0, estimatedMinutes: 60 }, { status: "IN_PROGRESS", progress: 50, estimatedMinutes: 540 }]), 55);
  // A job without an estimate weighs as the average estimate (here 300).
  assert.equal(projectCompletion([{ status: "COMPLETED", progress: 0, estimatedMinutes: 60 }, { status: "IN_PROGRESS", progress: 50, estimatedMinutes: 540 }, { status: "PLANNED", progress: 0 }]), 37);
  assert.equal(projectCompletion([{ status: "IN_PROGRESS", progress: 40, estimatedMinutes: 600 }, { status: "CANCELLED", progress: 0, estimatedMinutes: 6000 }]), 40);
});

test("Uppskattat · Bokat · Rapporterat for the project, with what is not booked", () => {
  const effort = projectEffort([
    { id: "a", status: "IN_PROGRESS", progress: 50, estimatedMinutes: 960, totalDurationSec: 5 * 3600 },
    { id: "b", status: "COMPLETED", progress: 100, estimatedMinutes: null, totalDurationSec: 3600 },
    { id: "c", status: "CANCELLED", progress: 0, estimatedMinutes: 600, totalDurationSec: 0 },
  ], new Map([["a", 480], ["c", 600]]));
  assert.equal(effort.estimatedMinutes, 960);
  assert.equal(effort.bookedMinutes, 480);
  assert.equal(effort.reportedMinutes, 360);
  assert.equal(effort.jobs, 2);
  assert.equal(effort.completedJobs, 1);
  assert.equal(effort.weighted, true);
  assert.equal(effortLine(effort), "Uppskattat 16 h · Bokat 8 h · Rapporterat 6 h");
  assert.equal(unbookedText(effort), "8 h är inte bokade");
  const none = projectEffort([{ id: "a", status: "PLANNED", progress: 0 }], new Map());
  assert.equal(effortLine(none), "Uppskattat – · Bokat 0 h · Rapporterat 0 h");
  assert.equal(unbookedText(none), "");
  assert.equal(none.weighted, false);
});

test("Local keeps Start and Uppskattad tid through a save, an untouched save and the file (.hwf) read back", async () => {
  const { createLocalWorkspace, parseLocalWorkspace, saveLocalWorkflowTaskRecord } = await import("../features/kfid/local-workspace-store");
  const base = { version: 0, kind: "WORK_ORDER", title: "Laddboxar", description: "", status: "PLANNED", projectId: null, customerId: null, assignedToUserId: null, assignedToName: "", dueDate: "2026-10-16",
    data: { kind: "WORK_ORDER", details: { executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "" } } };
  const workspace = createLocalWorkspace({ id: "org-local", name: "Lokala AB" });
  const first = saveLocalWorkflowTaskRecord(workspace, { ...base, plannedStartDate: "2026-10-12", estimatedMinutes: 960 });
  assert.deepEqual([first.task.plannedStartDate, first.task.estimatedMinutes], ["2026-10-12", 960]);
  // A save from an older caller (no fields) keeps them.
  const second = saveLocalWorkflowTaskRecord(first.workspace, { ...base, id: first.task.id, version: first.task.version, title: "Laddboxar plan –1" });
  assert.deepEqual([second.task.plannedStartDate, second.task.estimatedMinutes], ["2026-10-12", 960]);
  const read = parseLocalWorkspace(JSON.parse(JSON.stringify(second.workspace)), "org-local");
  assert.deepEqual([read.workflowTasks[0].plannedStartDate, read.workflowTasks[0].estimatedMinutes], ["2026-10-12", 960]);
  assert.throws(() => saveLocalWorkflowTaskRecord(second.workspace, { ...base, id: first.task.id, version: second.task.version, plannedStartDate: "2026-10-20" }), /Start måste vara före/);
});

test("Koppla till projekt: a round's work order keeps its period; other open jobs take the chosen dates; a finished one keeps them", () => {
  const frame = { startDate: "2026-11-01", dueDate: "2026-12-31" };
  const input = { open: true, chosenDue: "2026-12-31", today: "2026-11-15", frame };
  const holder = { plannedStartDate: "2026-11-01", dueDate: "2027-10-31", roundScheduleId: "r1" };
  assert.deepEqual(datesOnProjectLink(holder, input), { dueDate: "2027-10-31" }, "the period is not cut to the frame");
  assert.deepEqual(datesOnProjectLink({ ...holder, plannedStartDate: "2026-10-01" }, input), { dueDate: "2027-10-31" }, "nor moved into it");
  assert.deepEqual(datesOnProjectLink({ plannedStartDate: "2027-01-05", dueDate: "2027-02-01" }, input), { dueDate: "2026-12-31", plannedStartDate: "2026-12-31" });
  assert.deepEqual(datesOnProjectLink({ plannedStartDate: "2026-11-20", dueDate: "2026-12-10" }, { ...input, chosenDue: "" }), { dueDate: "2026-12-10" });
  assert.deepEqual(datesOnProjectLink({ plannedStartDate: "", dueDate: "2026-12-10" }, { ...input, chosenDue: "" }), { dueDate: "2026-12-10", plannedStartDate: "2026-11-15" }, "no Start: today inside the frame");
  assert.deepEqual(datesOnProjectLink({ plannedStartDate: "2026-10-01", dueDate: "2026-10-10" }, { ...input, open: false }), { dueDate: "2026-10-10" });
});

test("Koppla till projekt: Start comes inside the frame and never after Klart senast; nothing else moves", () => {
  const frame = { startDate: "2026-11-01", dueDate: "2026-12-31" };
  assert.deepEqual(startOnProjectLink({ start: "2026-10-05", due: "2026-12-10", frame }), { plannedStartDate: "2026-11-01" }, "before the frame");
  assert.deepEqual(startOnProjectLink({ start: "2027-01-05", due: "2026-12-31", frame }), { plannedStartDate: "2026-12-31" }, "after the frame");
  assert.deepEqual(startOnProjectLink({ start: "2026-11-20", due: "2026-12-10", frame }), {}, "inside: untouched");
  assert.deepEqual(startOnProjectLink({ start: "2026-11-05", due: "2026-10-31" }), { plannedStartDate: "2026-10-31" }, "the release finding: a passed Klart senast");
  assert.deepEqual(startOnProjectLink({ start: "2026-10-05", due: "2026-10-20", frame }), { plannedStartDate: "2026-10-20" }, "Klart senast left outside the frame by choice: never Start after it");
  assert.deepEqual(startOnProjectLink({ start: "", due: "2026-10-20", frame }), {}, "no Start: startForNewJob decides");
});
