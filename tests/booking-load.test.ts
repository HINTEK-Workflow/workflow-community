import assert from "node:assert/strict";
import test from "node:test";
import { bookingLoadByDay, dailyWorkMinutes, isClockBooking, isSwedishWorkday, swedishHolidayKeys } from "../lib/workflow/booking-load";
import { capacityInWindow, capacityWeek, plannedMinutesForUserInWindow } from "../lib/workflow/capacity-summary";
import { conflictLine, summarizeAvailability } from "../lib/workflow/availability-summary";
import { summarizeProjectStatus } from "../lib/workflow/project-status";
import { bookedTaskIdsForUser, bookingChangeRefusal, bookingPeriodLabel, canChangeOthersBookings, planningDelegateSummary, taskBookingLine, upcomingTaskBookings } from "../lib/workflow/bookings";

// Projektförslaget 2026-10-09, avsnitt 10, steg 1. Week of Monday 2026-10-12 (no holidays), Swedish summer time ends 25/10.
const week = { anchor: new Date("2026-10-14T12:00:00+02:00"), timeEntries: [] };
const monToFri = { startsAt: "2026-10-12T07:00:00+02:00", endsAt: "2026-10-16T16:00:00+02:00" };
const person = (id: string, startsAt: string, endsAt: string, plannedMinutes: number | null = null, title = id) => ({
  id, title, startsAt, endsAt, status: "PLANNED" as const, projectId: "p", assignedToUserId: null, assignedToUserIds: ["anna"],
  assignments: [{ userId: "anna", plannedMinutes, startsAt: null, endsAt: null }],
});

test("Hours away that fill the person's day count as a whole day: a clash, no overload, and Teamet's Krock the same (2026-11-02)", () => {
  const sick = { userId: "anna", from: "2026-10-14", to: "2026-10-14", status: "APPROVED", hours: { start: "07:00", end: "17:00" }, label: "Sjuk" } as const;
  const absences = [sick];
  const week = capacityWeek(new Date("2026-10-14T12:00:00+02:00"));
  // A Monday-to-Friday booking, also one with typed hours: it never had a clock time to overlap.
  for (const [activity, day] of [[person("vecka", monToFri.startsAt, monToFri.endsAt), 480], [person("timmar", monToFri.startsAt, monToFri.endsAt, 20 * 60), 240]] as const) {
    const { conflicts } = summarizeAvailability([activity], { absences });
    assert.deepEqual(conflicts.map((conflict) => [conflict.kind, conflict.minutes]), [["absence", day]]);
    assert.equal(capacityInWindow({ ...week, person: { id: "anna", weeklyWorkMinutes: 2400 }, activities: [activity], absences }).conflictMinutes, day);
  }
  assert.match(conflictLine(summarizeAvailability([person("vecka", monToFri.startsAt, monToFri.endsAt)], { absences }).conflicts[0]), /^Frånvarande 14 okt: 8 h bokat \(Sjuk\)$/);
  // A 20 h week has a 4 h day, so 07:00-12:00 is the whole day.
  const morning = [{ ...sick, hours: { start: "07:00", end: "12:00" } }];
  assert.deepEqual(summarizeAvailability([person("vecka", monToFri.startsAt, monToFri.endsAt)], { absences: morning, weeklyWorkMinutesFor: () => 1200 }).conflicts.map((conflict) => [conflict.kind, conflict.minutes]), [["absence", 240]]);
  // Two absences that fill the day together: said once.
  const parts = [{ ...sick, hours: { start: "07:00", end: "12:00" } }, { ...sick, hours: { start: "12:00", end: "17:00" } }];
  assert.deepEqual(summarizeAvailability([person("vecka", monToFri.startsAt, monToFri.endsAt)], { absences: parts }).conflicts.map((conflict) => [conflict.kind, conflict.minutes]), [["absence", 480]]);
});

test("A booking on a weekend day inside an absence is a clash as well, not only 'för mycket' (2026-11-02)", () => {
  const away = { userId: "anna", from: "2026-10-12", to: "2026-10-18", status: "APPROVED", hours: null } as const;
  const saturday = person("lördag", "2026-10-17T08:00:00+02:00", "2026-10-17T12:00:00+02:00");
  const { conflicts } = summarizeAvailability([saturday], { absences: [away] });
  assert.deepEqual(conflicts.map((conflict) => [conflict.kind, conflict.minutes]), [["absence", 240]]);
  const figures = capacityInWindow({ ...capacityWeek(week.anchor), person: { id: "anna", weeklyWorkMinutes: 2400 }, activities: [saturday], absences: [away] });
  assert.equal(figures.availableMinutes, 0);
  assert.equal(figures.conflictMinutes, 240);
});

test("kriterium 1: Mon 07:00 – Fri 16:00 without hours is 40 h for a 40 h week, not 105 h", () => {
  const summary = capacityInWindow({ ...capacityWeek(week.anchor), person: { id: "anna", weeklyWorkMinutes: 2_400 }, activities: [person("vecka", monToFri.startsAt, monToFri.endsAt)] });
  assert.equal(summary.plannedMinutes, 40 * 60);
  assert.equal(summary.overplannedMinutes, 0);
  // A personal 30 h week gives 6 h a day.
  assert.equal(capacityInWindow({ ...capacityWeek(week.anchor), person: { id: "anna", weeklyWorkMinutes: 1_800 }, activities: [person("vecka", monToFri.startsAt, monToFri.endsAt)] }).plannedMinutes, 30 * 60);
});

test("kriterium 2: 16 h over the week is 3.2 h per working day and nothing at night or at the weekend", () => {
  const activities = [person("vecka", monToFri.startsAt, monToFri.endsAt, 16 * 60)];
  const days = bookingLoadByDay({ ...monToFri, plannedMinutes: 16 * 60, dailyWorkMinutes: 480 });
  assert.deepEqual(days.map((day) => [day.day, day.minutes]), [["2026-10-12", 192], ["2026-10-13", 192], ["2026-10-14", 192], ["2026-10-15", 192], ["2026-10-16", 192]]);
  const window = (from: string, to: string) => plannedMinutesForUserInWindow({ activities, userId: "anna", startsAt: new Date(from), endsAt: new Date(to) });
  assert.equal(window("2026-10-12T00:00:00+02:00", "2026-10-13T00:00:00+02:00"), 192);
  // Over a long weekend booking (Fri 07 – Mon 16) the hours stay on Friday and Monday.
  const weekend = bookingLoadByDay({ startsAt: "2026-10-16T07:00:00+02:00", endsAt: "2026-10-19T16:00:00+02:00", plannedMinutes: 600, dailyWorkMinutes: 480 });
  assert.deepEqual(weekend.map((day) => [day.day, day.minutes]), [["2026-10-16", 300], ["2026-10-19", 300]]);
});

test("kriterium 3: hours that fit are no clash; two clock bookings 08–12 and 10–14 are", () => {
  const fits = summarizeAvailability([
    person("vecka", monToFri.startsAt, monToFri.endsAt, 16 * 60),
    person("jobb", "2026-10-14T10:00:00+02:00", "2026-10-14T12:00:00+02:00"),
  ]);
  assert.deepEqual(fits.conflicts, []);
  const clock = summarizeAvailability([
    person("första", "2026-10-14T08:00:00+02:00", "2026-10-14T12:00:00+02:00"),
    person("andra", "2026-10-14T10:00:00+02:00", "2026-10-14T14:00:00+02:00"),
  ]);
  assert.equal(clock.conflicts.length, 1);
  assert.equal(clock.conflicts[0].kind, "overlap");
  assert.equal(clock.conflicts[0].minutes, 120);
  // A meeting inside a full clock day is one clash (the overlap), not also a day with too many hours.
  const meeting = summarizeAvailability([
    person("dag", "2026-10-14T07:00:00+02:00", "2026-10-14T16:00:00+02:00"),
    person("möte", "2026-10-14T10:00:00+02:00", "2026-10-14T11:00:00+02:00"),
  ]);
  assert.deepEqual(meeting.conflicts.map((conflict) => conflict.kind), ["overlap"]);
});

test("a day with more booked hours than its working time is a clash, with every booking that day", () => {
  const summary = summarizeAvailability([
    person("vecka", monToFri.startsAt, monToFri.endsAt),
    person("jobb", "2026-10-14T10:00:00+02:00", "2026-10-14T12:00:00+02:00"),
  ]);
  assert.equal(summary.conflicts.length, 1);
  const [conflict] = summary.conflicts;
  assert.equal(conflict.kind, "overload");
  assert.equal(conflict.bookedMinutes, 600);
  assert.equal(conflict.workMinutes, 480);
  assert.equal(conflict.minutes, 120);
  assert.deepEqual(conflict.activities.map((item) => item.activityId).sort(), ["jobb", "vecka"]);
  // The person's own working time: 32 h over the week and a 2 h job is 8.4 h on Wednesday – too much for 8 h days,
  // fine for a 50 h week (10 h days).
  const heavy = [person("vecka", monToFri.startsAt, monToFri.endsAt, 32 * 60), person("jobb", "2026-10-14T10:00:00+02:00", "2026-10-14T12:00:00+02:00")];
  assert.equal(summarizeAvailability(heavy).conflicts.length, 1);
  assert.deepEqual(summarizeAvailability(heavy, { weeklyWorkMinutesFor: () => 3_000 }).conflicts, []);
});

test("Swedish holidays and weekends are not working days unless the booking lies only there", () => {
  const holidays = swedishHolidayKeys(2026);
  for (const day of ["2026-01-01", "2026-01-06", "2026-04-03", "2026-04-05", "2026-04-06", "2026-05-01", "2026-05-14", "2026-05-24", "2026-06-06", "2026-06-19", "2026-06-20", "2026-10-31", "2026-12-24", "2026-12-25", "2026-12-26", "2026-12-31"])
    assert.ok(holidays.has(day), day);
  assert.equal(isSwedishWorkday("2026-04-03T10:00:00+02:00"), false); // Långfredagen
  assert.equal(isSwedishWorkday("2026-04-07T10:00:00+02:00"), true);
  assert.equal(isSwedishWorkday("2026-10-17T10:00:00+02:00"), false); // Saturday
  // Easter week: Thu 2 April – Tue 7 April has two working days (Thu, Tue).
  assert.deepEqual(bookingLoadByDay({ startsAt: "2026-04-02T07:00:00+02:00", endsAt: "2026-04-07T16:00:00+02:00", plannedMinutes: null, dailyWorkMinutes: 480 }).map((day) => day.day), ["2026-04-02", "2026-04-07"]);
  // A Saturday job 09–13 was put there on purpose and counts.
  assert.deepEqual(bookingLoadByDay({ startsAt: "2026-10-17T09:00:00+02:00", endsAt: "2026-10-17T13:00:00+02:00", plannedMinutes: null, dailyWorkMinutes: 480 }).map((day) => day.minutes), [240]);
  assert.equal(dailyWorkMinutes(2_400), 480);
  assert.equal(isClockBooking({ startsAt: "2026-10-14T08:00:00+02:00", endsAt: "2026-10-14T12:00:00+02:00", plannedMinutes: null }), true);
  assert.equal(isClockBooking({ ...monToFri, plannedMinutes: null }), false);
  assert.equal(isClockBooking({ startsAt: "2026-10-14T08:00:00+02:00", endsAt: "2026-10-14T12:00:00+02:00", plannedMinutes: 120 }), false);
});

test("kriterium 6: a booking on a completed job does not hold the project open", () => {
  const now = new Date("2026-10-09T12:00:00+02:00");
  const base = { startDate: "2026-10-01", dueDate: "2026-10-30", now };
  const nextWeek = { status: "PLANNED", endsAt: "2026-10-16T16:00:00+02:00", workflowTaskId: "job-1" };
  assert.equal(summarizeProjectStatus({ ...base, tasks: [{ id: "job-1", status: "COMPLETED" }], activities: [nextWeek] }).state, "READY_TO_CLOSE");
  assert.equal(summarizeProjectStatus({ ...base, tasks: [{ id: "job-1", status: "IN_PROGRESS" }], activities: [nextWeek] }).state, "IN_PROGRESS");
  // A booking without a job (a meeting) still holds the project open.
  assert.equal(summarizeProjectStatus({ ...base, tasks: [{ id: "job-1", status: "COMPLETED" }], activities: [{ ...nextWeek, workflowTaskId: null }] }).state, "IN_PROGRESS");
});

test("kriterium 4 and 5: the jobs I am booked on, and the job's Bokad line", () => {
  const bookings = [
    { workflowTaskId: "job-1", status: "PLANNED", startsAt: "2026-10-13T07:00:00+02:00", endsAt: "2026-10-13T16:00:00+02:00", assignments: [{ userId: "anna" }, { userId: "erik" }] },
    { workflowTaskId: "job-2", status: "CANCELED", startsAt: "2026-10-13T07:00:00+02:00", endsAt: "2026-10-13T16:00:00+02:00", assignments: [{ userId: "anna" }] },
    { workflowTaskId: "job-3", status: "PLANNED", startsAt: "2026-10-13T07:00:00+02:00", endsAt: "2026-10-13T16:00:00+02:00", assignments: [{ userId: "anna" }], deletedAt: "2026-10-08T10:00:00Z" },
    { workflowTaskId: "job-4", status: "PLANNED", startsAt: "2026-10-13T07:00:00+02:00", endsAt: "2026-10-13T16:00:00+02:00", assignedToUserId: "anna" },
  ];
  assert.deepEqual([...bookedTaskIdsForUser(bookings, "anna")].sort(), ["job-1", "job-4"]);
  assert.deepEqual([...bookedTaskIdsForUser(bookings, "erik")], ["job-1"]);
  const names = new Map([["anna", "Anna"], ["erik", "Erik"]]);
  const now = new Date("2026-10-09T12:00:00+02:00");
  assert.equal(taskBookingLine(upcomingTaskBookings(bookings, "job-1", now), (id) => names.get(id)), "Bokad: tis 13/10 07–16 · Anna, Erik");
  assert.equal(taskBookingLine(upcomingTaskBookings(bookings, "job-2", now)), "Ingen bokning");
  assert.equal(taskBookingLine(upcomingTaskBookings(bookings, "job-1", new Date("2026-10-14T00:00:00+02:00"))), "Ingen bokning");
  assert.equal(bookingPeriodLabel(monToFri.startsAt, monToFri.endsAt), "mån 12/10 07 – fre 16/10 16");
  assert.equal(bookingPeriodLabel("2026-10-13T07:30:00+02:00", "2026-10-13T16:00:00+02:00"), "tis 13/10 07:30–16");
});

test("others' bookings: admin, the project's responsible person or its stand-in; own bookings always", () => {
  const project = { responsibleUserId: "lisa", planningDelegateUserId: "erik" };
  // Own booking, before and after.
  assert.equal(bookingChangeRefusal({ admin: false, userId: "anna", before: ["anna"], after: ["anna"], project }), null);
  assert.equal(bookingChangeRefusal({ admin: false, userId: "anna", before: [], after: [], project: null }), null);
  // Booking someone else, removing someone else, or moving a shared booking.
  assert.match(bookingChangeRefusal({ admin: false, userId: "anna", before: [], after: ["anna", "olle"], project }) ?? "", /projektansvarig/);
  assert.match(bookingChangeRefusal({ admin: false, userId: "anna", before: ["olle"], after: [], project }) ?? "", /projektansvarig/);
  assert.equal(bookingChangeRefusal({ admin: false, userId: "lisa", before: ["olle"], after: ["olle"], project }), null);
  assert.equal(bookingChangeRefusal({ admin: false, userId: "erik", before: ["olle"], after: ["olle"], project }), null);
  assert.equal(bookingChangeRefusal({ admin: true, userId: "anna", before: ["olle"], after: ["olle"], project }), null);
  // Without a project, others' bookings are an admin's.
  assert.match(bookingChangeRefusal({ admin: false, userId: "lisa", before: ["olle"], after: ["olle"], project: null }) ?? "", /administratör/);
  // Taken back: the former stand-in no longer has the right.
  assert.equal(canChangeOthersBookings({ admin: false, userId: "erik", project: { responsibleUserId: "lisa", planningDelegateUserId: null } }), false);
  assert.equal(planningDelegateSummary("", "Erik"), "Rätten att ändra andras bokningar lämnades över till Erik (ställföreträdare)");
  assert.equal(planningDelegateSummary("Erik", ""), "Rätten att ändra andras bokningar togs tillbaka från Erik");
});

// ---------- Frånvaro i krockarna (2026-11-02) ----------
const booked = (id: string, startsAt: string, endsAt: string, plannedMinutes: number | null = null) => ({
  id, title: id, startsAt, endsAt, status: "PLANNED" as const, assignedToUserId: "anna", assignments: [{ userId: "anna", startsAt: null, endsAt: null, plannedMinutes }],
});
const semester = { userId: "anna", from: "2026-11-03", to: "2026-11-05", hours: null, label: "Semester" };

test("a booking on whole days away is an absence clash with its booked time, and no overload as well", () => {
  const { conflicts } = summarizeAvailability([booked("Vecka", "2026-11-02T07:00:00+01:00", "2026-11-06T16:00:00+01:00"), booked("Mer", "2026-11-04T07:00:00+01:00", "2026-11-04T16:00:00+01:00")], { absences: [semester] });
  assert.deepEqual(conflicts.map((conflict) => [conflict.kind, conflict.first.title, conflict.minutes]), [["absence", "Vecka", 24 * 60], ["absence", "Mer", 8 * 60]]);
  assert.equal(conflictLine(conflicts[0]), "Frånvarande 3–5 nov: 24 h bokat (Semester)");
});

test("the words of an absence clash: one day, over a month, and only the word the viewer may see", () => {
  const line = (absence: Partial<typeof semester>) => conflictLine(summarizeAvailability([booked("Vecka", "2026-10-26T07:00:00+01:00", "2026-11-06T16:00:00+01:00")], { absences: [{ ...semester, ...absence }] }).conflicts[0]);
  assert.equal(line({ from: "2026-11-03", to: "2026-11-03" }), "Frånvarande 3 nov: 8 h bokat (Semester)");
  assert.equal(line({ from: "2026-10-30", to: "2026-11-02" }), "Frånvarande 30 okt–2 nov: 16 h bokat (Semester)");
  assert.equal(line({ label: "Frånvarande" }), "Frånvarande 3–5 nov: 24 h bokat");
});

test("some hours away only hit a clock booking that overlaps them", () => {
  const dentist = { userId: "anna", from: "2026-11-03", to: "2026-11-03", hours: { start: "10:00", end: "12:00" }, label: "Tandläkare" };
  const hit = summarizeAvailability([booked("Möte", "2026-11-03T11:00:00+01:00", "2026-11-03T13:00:00+01:00")], { absences: [dentist] }).conflicts;
  assert.deepEqual(hit.map((conflict) => [conflict.kind, conflict.minutes]), [["absence", 60]]);
  assert.deepEqual(summarizeAvailability([booked("Möte", "2026-11-03T13:00:00+01:00", "2026-11-03T14:00:00+01:00")], { absences: [dentist] }).conflicts, []);
  // A week's hours are no clock booking: they are not at a certain time.
  assert.deepEqual(summarizeAvailability([booked("Vecka", "2026-11-02T07:00:00+01:00", "2026-11-06T16:00:00+01:00", 600)], { absences: [dentist] }).conflicts, []);
});

test("some hours away shorten the day the overload check compares with, and the same minutes are not said twice", () => {
  const dentist = { userId: "anna", from: "2026-11-03", to: "2026-11-03", hours: { start: "10:00", end: "12:00" }, label: "Tandläkare" };
  const hours = (minutes: number) => booked("Timmar", "2026-11-03T07:00:00+01:00", "2026-11-04T00:00:00+01:00", minutes);
  assert.deepEqual(summarizeAvailability([hours(6 * 60)], { absences: [dentist] }).conflicts, [], "6 h fits a day with 2 h away");
  const over = summarizeAvailability([hours(7 * 60)], { absences: [dentist] }).conflicts;
  assert.deepEqual(over.map((conflict) => [conflict.kind, conflict.minutes, conflict.workMinutes]), [["overload", 60, 6 * 60]]);
  const day = summarizeAvailability([booked("Dagen", "2026-11-03T07:00:00+01:00", "2026-11-03T16:00:00+01:00")], { absences: [dentist] }).conflicts;
  assert.deepEqual(day.map((conflict) => conflict.kind), ["absence"], "a whole clock day: only the absence line");
});

test("an absence that does not count says nothing; one over a weekend names a booking put there on purpose", () => {
  assert.deepEqual(summarizeAvailability([booked("Dag", "2026-11-03T07:00:00+01:00", "2026-11-03T16:00:00+01:00")], { absences: [{ ...semester, status: "APPLIED" }] }).conflicts, []);
  assert.deepEqual(summarizeAvailability([booked("Lördag", "2026-11-07T07:00:00+01:00", "2026-11-07T16:00:00+01:00")], { absences: [{ ...semester, from: "2026-11-07", to: "2026-11-08" }] }).conflicts.map((conflict) => conflict.kind), ["absence"]);
  assert.deepEqual(summarizeAvailability([booked("Dag", "2026-11-03T07:00:00+01:00", "2026-11-03T16:00:00+01:00")], { absences: [{ ...semester, userId: "bo" }] }).conflicts, []);
});

test("Ingen fast arbetstid: no overload, but overlaps and absence still warn", () => {
  const options = { noFixedHoursFor: () => true };
  assert.deepEqual(summarizeAvailability([booked("Timmar", "2026-11-03T07:00:00+01:00", "2026-11-04T00:00:00+01:00", 12 * 60)], options).conflicts, []);
  assert.deepEqual(summarizeAvailability([booked("A", "2026-11-03T08:00:00+01:00", "2026-11-03T10:00:00+01:00"), booked("B", "2026-11-03T09:00:00+01:00", "2026-11-03T11:00:00+01:00")], options).conflicts.map((conflict) => conflict.kind), ["overlap"]);
  assert.deepEqual(summarizeAvailability([booked("Dag", "2026-11-03T07:00:00+01:00", "2026-11-03T16:00:00+01:00")], { ...options, absences: [semester] }).conflicts.map((conflict) => conflict.kind), ["absence"]);
});
