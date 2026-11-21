import assert from "node:assert/strict";
import test from "node:test";
import { capacityInWindow, capacityRows, capacityWeek, assignmentLoadMinutes, formatCapacityMinutes, plannedMinutesForUserInWindow, unassignedMinutesInWindow, type CapacityActivity, type CapacityData } from "../lib/workflow/capacity-summary";

test("capacity clips a booking to the visible week and flags overplanning", () => {
  const anchor = new Date("2026-09-23T12:00:00+02:00");
  const week = capacityWeek(anchor);
  // Friday the week before 08:00 – Monday 12:00 without hours: Friday and Monday are working days, one in this week.
  const clipped = capacityInWindow({
    ...week, person: { id: "member-1", weeklyWorkMinutes: 2_400 },
    activities: [{ assignedToUserId: "member-1", projectId: "project-a", status: "PLANNED", startsAt: "2026-09-18T08:00:00+02:00", endsAt: "2026-09-21T12:00:00+02:00" }],
  });
  assert.equal(week.startsAt.toISOString(), "2026-09-20T22:00:00.000Z");
  assert.equal(clipped.plannedMinutes, 480);
  // Hours given beyond the week's working time are overplanning.
  const over = capacityInWindow({
    ...week, person: { id: "member-1", weeklyWorkMinutes: 400 },
    activities: [{ assignedToUserId: null, projectId: "project-a", status: "PLANNED", startsAt: "2026-09-21T07:00:00+02:00", endsAt: "2026-09-22T16:00:00+02:00",
      assignments: [{ userId: "member-1", plannedMinutes: 600, startsAt: null, endsAt: null }] }],
  });
  assert.equal(over.plannedMinutes, 600);
  assert.equal(over.overplannedMinutes, 200);
  assert.equal(over.plannedPercent, 100);
});

test("a shared activity consumes the full interval for each selected member while unallocated work stays separate", () => {
  const week = capacityWeek(new Date("2026-09-23T12:00:00"));
  const input = {
    ...week,
    activities: [
      { assignedToUserId: null, assignedToUserIds: ["member-1", "member-2"], projectId: "project-a", status: "PLANNED" as const, startsAt: "2026-09-22T08:00:00.000Z", endsAt: "2026-09-22T10:00:00.000Z" },
      { assignedToUserId: null, assignedToUserIds: [], projectId: "project-a", status: "PLANNED" as const, startsAt: "2026-09-23T08:00:00.000Z", endsAt: "2026-09-23T09:30:00.000Z" },
    ],
  };
  assert.equal(capacityInWindow({ ...input, person: { id: "member-1", weeklyWorkMinutes: 2_400 } }).plannedMinutes, 120);
  assert.equal(capacityInWindow({ ...input, person: { id: "member-2", weeklyWorkMinutes: 2_400 } }).plannedMinutes, 120);
  assert.equal(unassignedMinutesInWindow(input.activities, week.startsAt, week.endsAt), 90);
});

test("individual allocations consume each member's own minutes", () => {
  const activities = [{
    assignedToUserId: null, assignedToUserIds: ["member-a", "member-b"], projectId: "project-a", status: "PLANNED" as const,
    startsAt: "2026-09-22T08:00:00.000Z", endsAt: "2026-09-22T12:00:00.000Z",
    assignments: [
      { userId: "member-a", plannedMinutes: 90, startsAt: null, endsAt: null },
      { userId: "member-b", plannedMinutes: null, startsAt: null, endsAt: null },
    ],
  }];
  const base = { ...capacityWeek(new Date("2026-09-23T12:00:00")), activities };
  assert.equal(capacityInWindow({ ...base, person: { id: "member-a", weeklyWorkMinutes: 2_400 } }).plannedMinutes, 90);
  assert.equal(capacityInWindow({ ...base, person: { id: "member-b", weeklyWorkMinutes: 2_400 } }).plannedMinutes, 240);
});

test("an individual interval takes precedence for capacity and can be shorter than the shared activity", () => {
  const summary = capacityInWindow({
    ...capacityWeek(new Date("2026-09-23T12:00:00")), person: { id: "member-a", weeklyWorkMinutes: 2_400 },
    activities: [{ assignedToUserId: null, assignedToUserIds: ["member-a"], projectId: "project-a", status: "PLANNED", startsAt: "2026-09-22T08:00:00.000Z", endsAt: "2026-09-22T12:00:00.000Z", assignments: [{ userId: "member-a", plannedMinutes: 60, startsAt: "2026-09-22T09:00:00.000Z", endsAt: "2026-09-22T10:00:00.000Z" }] }],
  });
  assert.equal(summary.plannedMinutes, 60);
});

test("calendar capacity uses the same allocation rules for an individual displayed day", () => {
  const activities = [{
    assignedToUserId: null, assignedToUserIds: ["member-a", "member-b"], projectId: "project-a", status: "PLANNED" as const,
    startsAt: "2026-09-22T08:00:00.000Z", endsAt: "2026-09-23T08:00:00.000Z",
    assignments: [
      { userId: "member-a", plannedMinutes: 120, startsAt: null, endsAt: null },
      { userId: "member-b", plannedMinutes: null, startsAt: "2026-09-22T10:00:00.000Z", endsAt: "2026-09-22T12:00:00.000Z" },
    ],
  }];
  // Swedish calendar days; the 120 given minutes are spread over the booking's two working days.
  const firstDay = { startsAt: new Date("2026-09-22T00:00:00+02:00"), endsAt: new Date("2026-09-23T00:00:00+02:00") };
  const secondDay = { startsAt: new Date("2026-09-23T00:00:00+02:00"), endsAt: new Date("2026-09-24T00:00:00+02:00") };
  assert.equal(plannedMinutesForUserInWindow({ activities, userId: "member-a", ...firstDay }), 60);
  assert.equal(plannedMinutesForUserInWindow({ activities, userId: "member-a", ...secondDay }), 60);
  assert.equal(plannedMinutesForUserInWindow({ activities, userId: "member-b", ...firstDay }), 120);
});

test("Kapacitet: one row per person with fixed hours, booked against the time available, absence named and deducted, and bookings without anyone given once", () => {
  const anchor = new Date("2026-11-04T10:00:00.000Z");
  const data: CapacityData = {
    members: [
      { id: "anna", name: "Anna", weeklyWorkMinutes: 2_400 },
      { id: "bo", name: "Bo", weeklyWorkMinutes: 60 },
      { id: "hour", name: "Timanställd", weeklyWorkMinutes: 2_400, noFixedHours: true },
    ],
    activities: [
      { id: "1", title: "A", startsAt: "2026-11-03T08:00:00.000Z", endsAt: "2026-11-03T10:00:00.000Z", assignedToUserId: "anna", status: "PLANNED", projectId: null },
      { id: "2", title: "B", startsAt: "2026-11-03T08:00:00.000Z", endsAt: "2026-11-03T10:00:00.000Z", assignedToUserId: "bo", assignments: [{ userId: "bo", plannedMinutes: 120, startsAt: null, endsAt: null }], status: "PLANNED", projectId: null },
      { id: "3", title: "C", startsAt: "2026-11-04T08:00:00.000Z", endsAt: "2026-11-04T09:00:00.000Z", assignedToUserId: null, status: "PLANNED", projectId: null },
    ],
    absences: [
      { userId: "anna", label: "Semester", from: "2026-11-05", to: "2026-11-06" },
      { userId: "anna", label: "Förra veckan", from: "2026-10-26", to: "2026-10-27" },
    ],
  };
  const { rows, unassignedMinutes } = capacityRows(data, anchor);
  assert.deepEqual(rows.map((row) => row.id), ["anna", "bo"], "Ingen fast arbetstid has no capacity");
  assert.equal(rows[0].plannedMinutes, 120);
  assert.equal(rows[0].availableMinutes, 24 * 60, "away Thursday and Friday");
  assert.equal(rows[0].remainingPlannedMinutes, 22 * 60);
  assert.deepEqual(rows[0].absences.map((absence) => absence.label), ["Semester"], "only absence in the week");
  assert.equal(rows[1].overplannedMinutes, 60);
  assert.equal(rows[1].plannedPercent, 100);
  assert.equal(unassignedMinutes, 60);
  assert.equal(formatCapacityMinutes(150), "2 h 30 min");
  assert.equal(formatCapacityMinutes(120), "2 h");
});

// ---------- En räkning av kapacitet (2026-11-02) ----------
const WEEKLY = 40 * 60;
const anna = { id: "anna", weeklyWorkMinutes: WEEKLY };
const monToFri = (monday: string, friday: string, extra: Partial<CapacityActivity> = {}): CapacityActivity => ({
  assignedToUserId: "anna", projectId: null, status: "PLANNED", startsAt: `${monday}T07:00:00+01:00`, endsAt: `${friday}T16:00:00+01:00`, ...extra,
});
const week = capacityWeek(new Date("2026-11-04T12:00:00+01:00"));
const thisWeek = monToFri("2026-11-02", "2026-11-06");
const count = (activities: CapacityActivity[], absences: Parameters<typeof capacityInWindow>[0]["absences"] = [], person: Parameters<typeof capacityInWindow>[0]["person"] = anna, window = week) =>
  capacityInWindow({ person, activities, absences, ...window });
const away = (from: string, to = from, hours: { start: string; end: string } | null = null, status?: string) => ({ userId: "anna", from, to, hours, status });

test("B3: away all week gives no available time, and what is booked is a clash", () => {
  const oneHour: CapacityActivity = { assignedToUserId: "anna", projectId: null, status: "PLANNED", startsAt: "2026-11-05T08:00:00+01:00", endsAt: "2026-11-05T09:00:00+01:00", assignments: [{ userId: "anna", plannedMinutes: 60, startsAt: null, endsAt: null }] };
  const result = count([thisWeek, oneHour], [away("2026-11-02", "2026-11-08")]);
  assert.deepEqual(result, { plannedMinutes: 41 * 60, availableMinutes: 0, conflictMinutes: 41 * 60, remainingPlannedMinutes: 0, overplannedMinutes: 41 * 60, plannedPercent: 100 });
});

test("whole days away take their own days, a week boundary splits them, and a weekend day takes nothing", () => {
  const thuFri = count([thisWeek], [away("2026-11-05", "2026-11-06")]);
  assert.equal(thuFri.plannedMinutes, 40 * 60);
  assert.equal(thuFri.availableMinutes, 24 * 60);
  assert.equal(thuFri.overplannedMinutes, 16 * 60);
  assert.equal(thuFri.conflictMinutes, 16 * 60);
  const span = [away("2026-10-30", "2026-11-02")];
  assert.equal(count([], span).availableMinutes, 32 * 60, "the Monday");
  assert.equal(count([], span, anna, capacityWeek(new Date("2026-10-28T12:00:00+01:00"))).availableMinutes, 32 * 60, "the Friday");
  assert.equal(count([], [away("2026-11-07", "2026-11-08")]).availableMinutes, 40 * 60, "a weekend holds no capacity to begin with");
});

test("some hours away take their share, two of them add up, and never more than the whole day", () => {
  assert.equal(count([], [away("2026-11-03", "2026-11-03", { start: "10:00", end: "12:00" }), away("2026-11-03", "2026-11-03", { start: "14:00", end: "15:00" })]).availableMinutes, 37 * 60);
  assert.equal(count([], [away("2026-11-03", "2026-11-03", { start: "10:00", end: "12:00" }), away("2026-11-03", "2026-11-03", { start: "11:00", end: "13:00" })]).availableMinutes, 37 * 60, "a shared hour counts once");
  assert.equal(count([], [away("2026-11-03", "2026-11-03", { start: "07:00", end: "12:00" })], { id: "anna", weeklyWorkMinutes: 20 * 60 }).availableMinutes, 16 * 60, "a 20 h week has a 4 h day, so a morning is the whole day");
  const partial = count([thisWeek], [away("2026-11-03", "2026-11-03", { start: "10:00", end: "12:00" })]);
  assert.equal(partial.conflictMinutes, 0, "Krock is whole days away");
});

test("only an approved absence counts", () => {
  for (const status of ["APPLIED", "REJECTED", "WITHDRAWN"]) assert.equal(count([], [away("2026-11-03", "2026-11-03", null, status)]).availableMinutes, 40 * 60, status);
  assert.equal(count([], [away("2026-11-03", "2026-11-03", null, "APPROVED")]).availableMinutes, 32 * 60);
});

test("a holiday neither loads nor gives capacity", () => {
  const christmas = capacityWeek(new Date("2026-12-22T12:00:00+01:00"));
  const booking = monToFri("2026-12-21", "2026-12-25");
  const plain = count([booking], [], anna, christmas);
  assert.equal(plain.plannedMinutes, 24 * 60);
  assert.equal(plain.availableMinutes, 24 * 60);
  assert.equal(plain.remainingPlannedMinutes, 0);
  assert.equal(count([], [away("2026-12-21", "2026-12-27")], anna, christmas).availableMinutes, 0);
  assert.equal(count([], [away("2026-12-21")], anna, christmas).availableMinutes, 16 * 60);
});

test("what counts as booked: not on a job that has utgått, but on a färdigställd one until it is removed", () => {
  assert.equal(count([{ ...thisWeek, workflowTask: { status: "CANCELLED" } }]).plannedMinutes, 0, "B2");
  assert.equal(count([thisWeek]).plannedMinutes, 40 * 60);
  assert.equal(count([{ ...thisWeek, workflowTask: { status: "COMPLETED" } }]).plannedMinutes, 40 * 60, "Färdigställ asks: Nej, behåll");
  assert.equal(count([{ ...thisWeek, status: "COMPLETED" }]).plannedMinutes, 0);
  assert.equal(count([{ ...thisWeek, status: "CANCELED" }]).plannedMinutes, 0);
});

test("B5: a one-hour booking counts one hour, and every person with their own weekly time", () => {
  const oneHour: CapacityActivity = { assignedToUserId: "anna", projectId: null, status: "PLANNED", startsAt: "2026-11-03T08:00:00+01:00", endsAt: "2026-11-03T09:00:00+01:00" };
  assert.equal(count([oneHour]).plannedMinutes, 60);
  assert.equal(count([thisWeek], [], { id: "anna", weeklyWorkMinutes: 30 * 60 }).plannedMinutes, 30 * 60);
  assert.equal(count([thisWeek], [], { id: "anna", weeklyWorkMinutes: 30 * 60 }).availableMinutes, 30 * 60);
});

test("Ingen fast arbetstid has no available time and is never too much; a clash still counts", () => {
  const result = count([thisWeek], [away("2026-11-02")], { id: "anna", weeklyWorkMinutes: WEEKLY, noFixedHours: true });
  assert.equal(result.plannedMinutes, 40 * 60);
  assert.equal(result.availableMinutes, null);
  assert.equal(result.overplannedMinutes, 0);
  assert.equal(result.remainingPlannedMinutes, 0);
  assert.equal(result.conflictMinutes, 8 * 60);
});

test("the percent is never an empty bar beside too much", () => {
  assert.equal(count([]).plannedPercent, 0);
  assert.equal(count([thisWeek], [away("2026-11-02", "2026-11-08")]).plannedPercent, 100);
  assert.equal(count([thisWeek], [away("2026-11-05", "2026-11-06")]).plannedPercent, 100);
  assert.equal(count([{ ...thisWeek, endsAt: "2026-11-03T16:00:00+01:00" }]).plannedPercent, 40);
});

test("one day is a window too: the calendar's day figure", () => {
  const monday = { startsAt: week.startsAt, endsAt: new Date(week.startsAt.getTime() + 86_400_000) };
  assert.equal(count([thisWeek], [], anna, monday).plannedMinutes, 8 * 60);
  assert.equal(count([thisWeek], [], anna, monday).availableMinutes, 8 * 60);
  assert.equal(count([thisWeek], [away("2026-11-02")], anna, monday).availableMinutes, 0);
});

test("Belastning says the real number (B5, 2026-11-02)", () => {
  const booking = (startsAt: string, endsAt: string, plannedMinutes: number | null = null) => ({ assignedToUserId: "anna", projectId: null, status: "PLANNED" as const, startsAt, endsAt, assignments: [{ userId: "anna", plannedMinutes, startsAt: null, endsAt: null }] });
  assert.equal(assignmentLoadMinutes(booking("2026-11-03T09:00:00+01:00", "2026-11-03T10:00:00+01:00"), "anna", 2_400), 60, "a 1 h booking is 1 h");
  assert.equal(assignmentLoadMinutes(booking("2026-11-02T07:00:00+01:00", "2026-11-06T16:00:00+01:00"), "anna", 2_400), 2_400, "Monday to Friday is the week");
  assert.equal(assignmentLoadMinutes(booking("2026-11-02T07:00:00+01:00", "2026-11-06T16:00:00+01:00"), "anna", 1_200), 1_200, "with the person's own week");
  assert.equal(assignmentLoadMinutes(booking("2026-11-02T07:00:00+01:00", "2026-11-06T16:00:00+01:00", 480), "anna", 2_400), 480, "given hours");
  assert.equal(assignmentLoadMinutes({ ...booking("2026-11-03T09:00:00+01:00", "2026-11-03T10:00:00+01:00"), status: "COMPLETED" }, "anna", 2_400), 60, "whatever its status");
  assert.equal(assignmentLoadMinutes(booking("2026-11-03T09:00:00+01:00", "2026-11-03T10:00:00+01:00"), "bo", 2_400), 0);
});
