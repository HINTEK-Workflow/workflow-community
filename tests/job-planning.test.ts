import assert from "node:assert/strict";
import test from "node:test";
import { defaultStartDate, effectiveStartDate, groupByStage, normalizeStage, stageSuggestions, stageSummary, startForNewJob, STAGE_MAX_LENGTH, projectShift } from "../lib/workflow/job-planning";
import { datedJobs, followerMoves, followerShiftWorkdays, followingJobIds, jobPeriod, jobsByWeek, jobsWithoutDue, planFollowerMoves, shiftJobPeriod, type ScheduleJob } from "../lib/workflow/schedule";
import { workflowTaskInputSchema } from "../lib/workflow/task-model";

test("effectiveStartDate: the stored Start, else the Swedish day the job was created", () => {
  assert.equal(effectiveStartDate({ plannedStartDate: "2026-10-14", createdAt: "2026-10-01T10:00:00Z" }), "2026-10-14");
  assert.equal(effectiveStartDate({ plannedStartDate: "", createdAt: "2026-10-01T10:00:00Z" }), "2026-10-01");
  // Late evening UTC is already the next day in Sweden (summer time, UTC+2).
  assert.equal(effectiveStartDate({ plannedStartDate: "", createdAt: new Date("2026-10-01T22:30:00Z") }), "2026-10-02");
  assert.equal(effectiveStartDate({ plannedStartDate: "", createdAt: "2026-01-15T23:30:00Z" }), "2026-01-16");
});

test("the default Start is today, kept inside the project's frame and never after Klart senast", () => {
  assert.equal(defaultStartDate({ today: "2026-10-11" }), "2026-10-11");
  assert.equal(defaultStartDate({ today: "2026-10-11", frame: { startDate: "2026-11-01", dueDate: "2026-12-01" } }), "2026-11-01");
  assert.equal(defaultStartDate({ today: "2026-10-11", frame: { startDate: "2026-08-01", dueDate: "2026-09-01" } }), "2026-09-01");
  assert.equal(defaultStartDate({ today: "2026-10-11", dueDate: "2026-10-05" }), "2026-10-05");
  assert.equal(defaultStartDate({ today: "2026-10-11", dueDate: "2026-10-20", frame: { startDate: "2026-10-01", dueDate: "2026-10-31" } }), "2026-10-11");
  // A chosen Start is used as given.
  assert.equal(startForNewJob({ chosen: "2026-10-20", today: "2026-10-11" }), "2026-10-20");
  assert.equal(startForNewJob({ chosen: "", today: "2026-10-11" }), "2026-10-11");
  assert.equal(startForNewJob({ today: "2026-10-11" }), "2026-10-11");
});

test("every job is drawn: an older job without a Start counts from its creation day", () => {
  const job: ScheduleJob = { id: "a", title: "Gammalt", kind: "WORK_ORDER", status: "PLANNED", progress: 0, plannedStartDate: "", effectiveStart: "2026-10-01", dueDate: "2026-10-09", estimatedMinutes: null };
  assert.deepEqual(jobPeriod(job), { start: "2026-10-01", end: "2026-10-09" });
  assert.equal(datedJobs([job]).undated.length, 0);
  // Without Klart senast the bar is its start day alone, and the job is listed under Utan datum (as a note).
  const open = { ...job, id: "b", dueDate: "" };
  assert.deepEqual(jobPeriod(open), { start: "2026-10-01", end: "2026-10-01" });
  assert.deepEqual(jobsWithoutDue([job, open, { ...open, id: "c", status: "COMPLETED" }]).map((item) => item.id), ["b"]);
  // Nothing at all to draw from: truly undated.
  assert.equal(jobPeriod({ plannedStartDate: "", dueDate: "2026-10-09" }), null);
  // The phone's weeks list it under the week it started.
  const { weeks, undated } = jobsByWeek([job], "2026-10-09");
  assert.equal(undated.length, 0);
  assert.equal(weeks.length, 1);
});

test("Etapp: trimmed, collapsed, at most 60 characters, input schema agrees", () => {
  assert.equal(normalizeStage("  Fas   1  "), "Fas 1");
  assert.equal(normalizeStage(null), "");
  assert.equal(normalizeStage("x".repeat(100)).length, STAGE_MAX_LENGTH);
  const base = { kind: "FORM" as const, title: "T", data: { kind: "FORM" as const, details: { templateId: "t", templateVersion: 1, templateName: "N", document: { schema: 2, blocks: [] }, values: {} } } };
  assert.equal(workflowTaskInputSchema.safeParse({ ...base, stage: "Fas 1" }).success, true);
  assert.equal(workflowTaskInputSchema.safeParse({ ...base, stage: "x".repeat(61) }).success, false);
  assert.equal(workflowTaskInputSchema.safeParse(base).success, true);
});

test("stage suggestions come from the project's stages once each, in order of appearance", () => {
  assert.deepEqual(stageSuggestions([{ stage: "Förberedelse" }, { stage: "" }, { stage: "förberedelse" }, { stage: "Installation" }, {}]), ["Förberedelse", "Installation"]);
});

test("jobs are grouped by stage in order of earliest Start, 'Utan etapp' last and only when some job has a stage", () => {
  const jobs = [
    { id: "1", stage: "Installation", plannedStartDate: "2026-10-12" },
    { id: "2", stage: "", plannedStartDate: "2026-10-01" },
    { id: "3", stage: "Förberedelse", plannedStartDate: "2026-10-05" },
    { id: "4", stage: "installation", plannedStartDate: "2026-10-20" },
    { id: "5", plannedStartDate: "", createdAt: "2026-10-02T08:00:00Z" },
  ];
  const { grouped, groups } = groupByStage(jobs);
  assert.equal(grouped, true);
  assert.deepEqual(groups.map((group) => [group.label, group.jobs.map((job) => job.id)]), [["Förberedelse", ["3"]], ["Installation", ["1", "4"]], ["Utan etapp", ["2", "5"]]]);
  const plain = groupByStage(jobs.map((job) => ({ ...job, stage: "" })));
  assert.equal(plain.grouped, false);
  assert.deepEqual(plain.groups.map((group) => group.jobs.length), [5]);
});

test("a stage's summary row: period from the earliest Start to the latest Klart senast, weighted completion, x of y jobs", () => {
  const summary = stageSummary([
    { status: "COMPLETED", progress: 100, plannedStartDate: "2026-10-05", dueDate: "2026-10-09", estimatedMinutes: 60, completedDay: "2026-10-08" },
    { status: "IN_PROGRESS", progress: 50, plannedStartDate: "2026-10-08", dueDate: "2026-10-16", estimatedMinutes: 180 },
    { status: "CANCELLED", progress: 0, plannedStartDate: "2026-09-01", dueDate: "2026-09-02", estimatedMinutes: 600 },
    { status: "PLANNED", progress: 0, plannedStartDate: "", effectiveStart: "2026-10-12", dueDate: "" },
  ]);
  assert.equal(summary.start, "2026-10-05");
  assert.equal(summary.end, "2026-10-16");
  assert.equal(summary.jobCount, 3);
  assert.equal(summary.doneCount, 1);
  // (100*60 + 50*180 + 0*average(120)) / (60+180+120) = 15000/360 = 41.67
  assert.equal(summary.progress, 42);
  assert.deepEqual(stageSummary([]), { start: "", end: "", progress: 0, jobCount: 0, doneCount: 0 });
});

// ---------- Flytta efterföljande ----------

const j = (id: string, start: string, due: string, predecessorIds: string[] = [], status = "PLANNED") => ({ id, title: id, status, plannedStartDate: start, dueDate: due, predecessorIds });

test("the jobs that start after a job are found in a chain, once each, past finished ones", () => {
  const jobs = [j("a", "2026-10-12", "2026-10-14"), j("b", "2026-10-15", "2026-10-16", ["a"]), j("c", "2026-10-19", "2026-10-20", ["b"]), j("d", "2026-10-21", "2026-10-22", ["b", "c"]), j("x", "2026-10-12", "2026-10-13"), j("done", "2026-10-15", "2026-10-15", ["a"], "COMPLETED"), j("e", "2026-10-16", "2026-10-19", ["done"])];
  assert.deepEqual(followingJobIds("a", jobs).sort(), ["b", "c", "d", "e"]);
  assert.deepEqual(followingJobIds("x", jobs), []);
  // A circle (refused on save) cannot loop.
  assert.deepEqual(followingJobIds("p", [j("p", "2026-10-12", "", ["q"]), j("q", "2026-10-12", "", ["p"])]), ["q"]);
});

test("the followers move as many workdays as the job, keeping their length", () => {
  const before = { plannedStartDate: "2026-10-12", dueDate: "2026-10-14" };
  assert.equal(followerShiftWorkdays(before, { plannedStartDate: "2026-10-14", dueDate: "2026-10-16" }), 2);
  assert.equal(followerShiftWorkdays(before, { plannedStartDate: "2026-10-12", dueDate: "2026-10-16" }), 2);
  assert.equal(followerShiftWorkdays(before, before), 0);
  assert.deepEqual(shiftJobPeriod({ plannedStartDate: "2026-10-15", dueDate: "2026-10-16" }, 3), { plannedStartDate: "2026-10-20", dueDate: "2026-10-21" });
  assert.deepEqual(shiftJobPeriod({ plannedStartDate: "2026-10-15", dueDate: "" }, -2), { plannedStartDate: "2026-10-13", dueDate: "" });
  const jobs = [j("a", "2026-10-12", "2026-10-14"), j("b", "2026-10-15", "2026-10-16", ["a"]), j("c", "2026-10-19", "2026-10-20", ["b"])];
  const moves = followerMoves({ id: "a" }, before, { plannedStartDate: "2026-10-14", dueDate: "2026-10-16" }, jobs);
  assert.deepEqual(moves.map((move) => [move.job.id, move.to.plannedStartDate, move.to.dueDate]), [["b", "2026-10-19", "2026-10-20"], ["c", "2026-10-21", "2026-10-22"]]);
});

test("planFollowerMoves: locked jobs refuse the whole move, the frame needs an exception", () => {
  const jobs = [j("a", "2026-10-12", "2026-10-14"), j("b", "2026-10-15", "2026-10-16", ["a"]), j("c", "2026-10-19", "2026-10-30", ["b"])];
  const base = { jobId: "a", previous: { plannedStartDate: "2026-10-12", dueDate: "2026-10-14" }, next: { plannedStartDate: "2026-10-14", dueDate: "2026-10-16" }, jobs };
  const open = planFollowerMoves({ ...base, frame: { startDate: "2026-10-01", dueDate: "2026-12-31" }, canEdit: () => true });
  assert.equal(open.moves.length, 2);
  assert.equal(open.locked.length, 0);
  assert.equal(open.outsideFrame.length, 0);
  const locked = planFollowerMoves({ ...base, frame: null, canEdit: (job) => job.id !== "c" });
  assert.deepEqual(locked.locked.map((job) => job.id), ["c"]);
  const tight = planFollowerMoves({ ...base, frame: { startDate: "2026-10-01", dueDate: "2026-10-31" }, canEdit: () => true });
  assert.deepEqual(tight.outsideFrame.map((move) => move.job.id), ["c"]);
  assert.equal(tight.invalid, null);
});

// ---------- Flytta allt (2026-11-02) ----------
test("Flytta allt moves the whole bar: B1, -14 days no longer leaves Start after Klart senast", () => {
  const job = { id: "1", status: "PLANNED", plannedStartDate: "2026-11-10", dueDate: "2026-11-19", createdAt: "2026-10-01T10:00:00.000Z" };
  const { moves, kept } = projectShift([job], -14);
  assert.deepEqual(moves.map((move) => [move.plannedStartDate, move.dueDate]), [["2026-10-27", "2026-11-05"]]);
  assert.equal(kept.size, 0);
});

test("Flytta allt: a job without a stored Start gets one, one without Klart senast moves its Start, and a broken one is mended", () => {
  const [old] = projectShift([{ id: "o", status: "PLANNED", plannedStartDate: "", dueDate: "2026-11-19", createdAt: "2026-11-02T10:00:00.000Z" }], 7).moves;
  assert.deepEqual([old.plannedStartDate, old.dueDate], ["2026-11-09", "2026-11-26"]);
  const [noDue] = projectShift([{ id: "n", status: "PLANNED", plannedStartDate: "2026-11-10", dueDate: "", createdAt: "2026-10-01T10:00:00.000Z" }], 7).moves;
  assert.deepEqual([noDue.plannedStartDate, noDue.dueDate], ["2026-11-17", ""]);
  const [broken] = projectShift([{ id: "b", status: "PLANNED", plannedStartDate: "2026-11-10", dueDate: "2026-11-05", createdAt: "2026-10-01T10:00:00.000Z" }], 3).moves;
  assert.deepEqual([broken.plannedStartDate, broken.dueDate], ["2026-11-08", "2026-11-08"], "the earlier move's damage");
});

test("Flytta allt: only open jobs, and a round's or a plan's work order with its tasks keeps its dates", () => {
  const job = (id: string, fields: Record<string, unknown> = {}) => ({ id, status: "PLANNED", plannedStartDate: "2026-11-10", dueDate: "2026-11-19", createdAt: "2026-10-01T10:00:00.000Z", ...fields });
  const { moves, kept } = projectShift([
    job("open"), job("going", { status: "IN_PROGRESS" }), job("done", { status: "COMPLETED" }), job("gone", { status: "CANCELLED" }),
    job("holder", { roundScheduleId: "s" }), job("protocol", { workOrderId: "holder" }), job("plan", { maintenancePlanId: "p" }),
  ], 5);
  assert.deepEqual(moves.map((move) => move.job.id), ["open", "going"]);
  assert.deepEqual([...kept].sort(), ["holder", "plan", "protocol"]);
});
