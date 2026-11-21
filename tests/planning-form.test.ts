import assert from "node:assert/strict";
import test from "node:test";
import { endFollowingStart, jobFill, jobPeople, jobPeriodLabel, jobStartDay, planningJobGroups } from "../lib/workflow/planning-form";
import { bookJobHref } from "../lib/workflow/bookings";
import { datedJobs, jobPeriod } from "../lib/workflow/schedule";

const at = (text: string) => Date.parse(text);
const HOUR = 3_600_000;

// Simulation 0.6.3: Start set to 12 Oct 07:00, Slut stayed on 10 Oct 09:00.
test("Ny planering: Slut follows Start and the booking keeps its length", () => {
  const previous = { start: at("2026-10-10T07:00:00Z"), end: at("2026-10-10T15:00:00Z") };
  assert.equal(endFollowingStart(previous, at("2026-10-12T07:00:00Z")), at("2026-10-12T15:00:00Z"));
  assert.equal(endFollowingStart(previous, at("2026-10-10T06:00:00Z")), at("2026-10-10T14:00:00Z"), "earlier as well");
  // No valid pair (the end was before the start): the remembered length, else one hour.
  const broken = { start: at("2026-10-12T07:00:00Z"), end: at("2026-10-10T09:00:00Z") };
  assert.equal(endFollowingStart(broken, at("2026-10-12T08:00:00Z")), at("2026-10-12T09:00:00Z"));
  assert.equal(endFollowingStart(broken, at("2026-10-12T08:00:00Z"), 2 * HOUR), at("2026-10-12T10:00:00Z"));
  assert.equal(endFollowingStart({ start: Number.NaN, end: at("2026-10-20T09:00:00Z") }, at("2026-10-12T08:00:00Z")), null, "a later end without a length is left alone");
  assert.equal(endFollowingStart(previous, Number.NaN), null, "a start being typed changes nothing");
});

// Simulation 0.6.3: the job list was ~200 jobs in no order, finished ones and duplicates among them, without a search.
test("The job list: open jobs grouped by kind, sorted, twins told apart, searchable", () => {
  const jobs = [
    { id: "a", title: "Byt armatur", status: "PLANNED", kind: "Arbetsorder", dueDate: "2026-10-20" },
    { id: "b", title: "Åtgärda central", status: "COMPLETED", kind: "Arbetsorder", dueDate: "" },
    { id: "c", title: "Byt armatur", status: "IN_PROGRESS", kind: "Arbetsorder", dueDate: "2026-10-12" },
    { id: "d", title: "Kontroll kök", status: "PLANNED", kind: "Kontroll före idrifttagning", dueDate: "" },
    { id: "e", title: "Ångra mig", status: "CANCELLED", kind: "Arbetsorder", dueDate: "" },
  ];
  const groups = planningJobGroups(jobs, { kindLabel: (job) => job.kind });
  assert.deepEqual(groups.map((group) => group.label), ["Arbetsorder", "Kontroll före idrifttagning"]);
  assert.deepEqual(groups[0].options.map((option) => option.id), ["c", "a"], "sorted by title, twins by Klart senast; finished and cancelled left out");
  assert.equal(groups[0].options[0].label, "Byt armatur · Klart senast 12 okt");
  const linked = planningJobGroups(jobs, { kindLabel: (job) => job.kind, selectedId: "b" });
  assert.ok(linked[0].options.some((option) => option.id === "b" && option.label === "Åtgärda central (färdigställd)"), "the linked job is always kept");
  assert.deepEqual(planningJobGroups(jobs, { kindLabel: (job) => job.kind, query: "KÖK" }).flatMap((group) => group.options.map((option) => option.id)), ["d"]);
  assert.deepEqual(planningJobGroups(jobs, { kindLabel: (job) => job.kind, query: "atgarda" }).length, 0, "a finished job is not found by the search");
});

// Simulation 0.6.3: a job was both in the diagram and under Utan datum; a finished job was drawn to its Klart senast.
test("Tidplan: only dated jobs are rows, and a finished job ends the day it was finished", () => {
  const { dated, undated } = datedJobs([{ plannedStartDate: "2026-10-05", dueDate: "2026-11-09" }, { plannedStartDate: "", dueDate: "2026-11-09" }]);
  assert.equal(dated.length, 1);
  assert.equal(undated.length, 1);
  assert.deepEqual(jobPeriod({ plannedStartDate: "2026-10-05", dueDate: "2026-11-09", status: "COMPLETED", completedDay: "2026-10-10" }), { start: "2026-10-05", end: "2026-10-10" });
  assert.deepEqual(jobPeriod({ plannedStartDate: "2026-10-05", dueDate: "2026-10-07", status: "COMPLETED", completedDay: "2026-10-10" }), { start: "2026-10-05", end: "2026-10-10" }, "finished late: drawn to the day it was done");
  assert.deepEqual(jobPeriod({ plannedStartDate: "2026-10-05", dueDate: "2026-11-09", status: "COMPLETED", completedDay: "2026-10-01" }), { start: "2026-10-05", end: "2026-10-05" }, "never before its start");
  assert.deepEqual(jobPeriod({ plannedStartDate: "2026-10-05", dueDate: "2026-11-09", status: "IN_PROGRESS", completedDay: "" }), { start: "2026-10-05", end: "2026-11-09" });
  assert.deepEqual(jobPeriod({ plannedStartDate: "2026-10-05", dueDate: "2026-11-09", status: "COMPLETED" }), { start: "2026-10-05", end: "2026-11-09" }, "without a known day, as before");
});

// Boka från jobbet (2026-11-02).
const fillInput = { title: "", touched: { people: false, start: false }, memberIds: ["anna", "bo"], selfId: "bo", mayBookOthers: true, today: "2026-11-02" };
const job = { title: "Byte av brytare", assignedToUserId: "anna", plannedStartDate: "2026-11-17" };

test("Boka: the address opens the form on both displays and keeps the job apart from the shell's taskId", () => {
  assert.equal(bookJobHref("a b"), "/?view=planning&new=1&step=ny&bookTaskId=a%20b");
});

test("A job's dates in words: a lone date says which it is", () => {
  assert.equal(jobPeriodLabel({ plannedStartDate: "2026-11-17", dueDate: "2026-11-19" }), "17 nov – 19 nov");
  assert.equal(jobPeriodLabel({ plannedStartDate: "2026-11-17", dueDate: "2026-11-17" }), "17 nov");
  assert.equal(jobPeriodLabel({ plannedStartDate: "", dueDate: "2026-11-11" }), "Klart senast 11 nov");
  assert.equal(jobPeriodLabel({ plannedStartDate: "2026-11-17", dueDate: "" }), "Start 17 nov");
  assert.equal(jobPeriodLabel({}), "");
});

test("Boka: the day is the job's Start when it is today or later, otherwise today", () => {
  assert.equal(jobStartDay(job, "2026-11-02"), "2026-11-17");
  assert.equal(jobStartDay({ plannedStartDate: "2026-11-02" }, "2026-11-02"), "2026-11-02");
  assert.equal(jobStartDay({ plannedStartDate: "2026-10-20" }, "2026-11-02"), "2026-11-02", "not in the past");
  assert.equal(jobStartDay({ plannedStartDate: "" }, "2026-11-02"), "2026-11-02", "no stored Start");
});

test("Boka: the job's responsible when among the members; someone who may not book others gets themself", () => {
  assert.deepEqual(jobPeople(job, fillInput), ["anna"]);
  assert.deepEqual(jobPeople({ assignedToUserId: "gone" }, fillInput), []);
  assert.deepEqual(jobPeople({ assignedToUserId: null }, fillInput), []);
  assert.deepEqual(jobPeople(job, { ...fillInput, mayBookOthers: false }), ["bo"]);
  assert.deepEqual(jobPeople(job, { ...fillInput, mayBookOthers: false, selfId: "not-a-member" }), []);
});

test("Picking a job fills in what it knows", () => {
  assert.deepEqual(jobFill(job, fillInput), { title: "Byte av brytare", assignedToUserIds: ["anna"], startDay: "2026-11-17" });
  assert.equal(jobFill({ ...job, title: "x".repeat(300) }, fillInput).title?.length, 200, "at most what the field holds");
});

test("Picking a job never overwrites what the person typed", () => {
  assert.equal(jobFill(job, { ...fillInput, title: "Min rubrik" }).title, undefined);
  assert.equal(jobFill(job, { ...fillInput, title: "Förra jobbet", previous: { title: "Förra jobbet" } }).title, "Byte av brytare", "still the previous job's title");
  assert.equal(jobFill(job, { ...fillInput, title: "Ändrad", previous: { title: "Förra jobbet" } }).title, undefined);
  assert.equal(jobFill(job, { ...fillInput, touched: { people: true, start: false } }).assignedToUserIds, undefined);
  assert.equal(jobFill(job, { ...fillInput, touched: { people: false, start: true } }).startDay, undefined);
  assert.equal(jobFill(job, { ...fillInput, dayChosen: true }).startDay, undefined, "a click on a day keeps that day");
});

test("The job list: twins without Klart senast are told apart by the day made, then by a number (resa 4, 2026-11-06)", () => {
  const jobs = [
    { id: "a", title: "Larm: TEMP_HIGH", status: "PLANNED", dueDate: "", createdAt: "2026-10-27T08:00:00.000Z" },
    { id: "b", title: "Larm: TEMP_HIGH", status: "PLANNED", dueDate: "", createdAt: "2026-10-27T09:00:00.000Z" },
    { id: "c", title: "Larm: TEMP_HIGH", status: "PLANNED", dueDate: "", createdAt: "2026-10-29T09:00:00.000Z" },
    { id: "d", title: "Ensam", status: "PLANNED", dueDate: "", createdAt: "2026-10-29T09:00:00.000Z" },
  ];
  const labels = planningJobGroups(jobs, { kindLabel: () => "Arbetsorder" })[0].options.map((option) => option.label);
  assert.deepEqual(labels, ["Ensam", "Larm: TEMP_HIGH · skapad 27 okt nr 1", "Larm: TEMP_HIGH · skapad 27 okt nr 2", "Larm: TEMP_HIGH · skapad 29 okt"]);
});
