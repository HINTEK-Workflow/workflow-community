import assert from "node:assert/strict";
import test from "node:test";
import { absenceInputSchema, absenceLabel, absentShare, affectedWork, firstDayBack, mayRegisterAbsence, suggestReplacements, type Absence } from "../lib/workflow/absence";

const absence = (over: Partial<Absence> = {}): Absence => ({ id: "a", userId: "u", type: "SICK", note: "", from: "2026-10-30", to: "2026-10-30", hours: null, createdBy: "u", createdAt: "", handled: [], ...over });
const day = (iso: string) => iso.slice(0, 10);

test("Frånvaro: who may register, and who sees the type", () => {
  assert.equal(mayRegisterAbsence({ id: "u", admin: false, team: false }, "u"), true, "oneself");
  assert.equal(mayRegisterAbsence({ id: "u", admin: false, team: false }, "v"), false, "not someone else without Teamet");
  assert.equal(mayRegisterAbsence({ id: "u", admin: false, team: true }, "v"), true, "the supervisor (Teamet)");
  assert.equal(absenceLabel({ id: "x", admin: false, team: false }, absence()), "Frånvarande", "a colleague sees no reason");
  assert.equal(absenceLabel({ id: "x", admin: false, team: true }, absence({ type: "LEAVE", hours: { start: "10:00", end: "12:00" } })), "Ledig 10:00–12:00");
  assert.equal(absenceLabel({ id: "u", admin: false, team: false }, absence({ type: "OTHER", note: "Flytt" })), "Flytt");
});

test("Frånvaro: the input is checked", () => {
  assert.equal(absenceInputSchema.safeParse({ userId: "u", type: "SICK", from: "2026-10-30", to: "2026-10-29" }).success, false, "Till before Från");
  assert.equal(absenceInputSchema.safeParse({ userId: "u", type: "OTHER", from: "2026-10-30", to: "2026-10-30" }).success, false, "an own reason needs its text");
  assert.equal(absenceInputSchema.safeParse({ userId: "u", type: "SICK", from: "2026-10-30", to: "2026-10-31", hours: { start: "10:00", end: "12:00" } }).success, false, "hours are one day");
  assert.equal(absenceInputSchema.safeParse({ userId: "u", type: "LEAVE", from: "2026-10-30", to: "2026-10-30", hours: { start: "12:00", end: "10:00" } }).success, false, "the end after the start");
  assert.equal(absenceInputSchema.safeParse({ userId: "u", type: "VAB", from: "2026-10-30", to: "2026-10-30" }).success, true);
});

test("Frånvaro: only workdays take capacity, half a day is half; postponed work goes to the first workday back", () => {
  // Fri 30 Oct – Mon 2 Nov: Friday and Monday are workdays.
  // The deduction from a week is capacityInWindow's (tests/capacity-summary.test.ts); here the share of one day.
  const span = [absence({ from: "2026-10-30", to: "2026-11-02" })];
  assert.deepEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"].map((day) => absentShare(span, "u", day)), [1, 0, 0, 1], "weekdays only");
  assert.equal(absentShare(span, "other", "2026-10-30"), 0);
  const hours = (start: string, end: string) => absence({ from: "2026-10-28", to: "2026-10-28", hours: { start, end } });
  assert.equal(absentShare([hours("10:00", "12:00")], "u", "2026-10-28"), 0.25, "two hours take their share of the day");
  assert.equal(absentShare([hours("10:00", "12:00"), hours("14:00", "15:00")], "u", "2026-10-28"), 0.375, "two absences the same day add up (2026-11-02)");
  assert.equal(absentShare([hours("10:00", "12:00"), hours("11:00", "13:00")], "u", "2026-10-28"), 0.375, "a shared hour counts once");
  assert.equal(absentShare([hours("07:00", "12:00")], "u", "2026-10-28", 240), 1, "never more than the whole day");
  assert.equal(absentShare([hours("10:00", "12:00"), absence({ from: "2026-10-28", to: "2026-10-28" })], "u", "2026-10-28"), 1, "a whole day beside it");
  assert.equal(firstDayBack(absence({ to: "2026-10-30" })), "2026-11-02", "after a Friday comes Monday");
});

test("Frånvaro: the work it touches, from today on; Låt vänta takes a row away; replacements by free time", () => {
  const rows = affectedWork({
    absences: [absence({ from: "2026-10-30", to: "2026-11-02" })], today: "2026-10-29", swedishDay: day,
    bookings: [
      { id: "b1", title: "Jordfel", startsAt: "2026-10-30T07:00:00.000Z", endsAt: "2026-10-30T09:00:00.000Z", userIds: ["u"], status: "PLANNED", href: "/b1" },
      { id: "b2", title: "Annans", startsAt: "2026-10-30T07:00:00.000Z", endsAt: "2026-10-30T09:00:00.000Z", userIds: ["v"], status: "PLANNED", href: "/b2" },
      { id: "b3", title: "Senare", startsAt: "2026-11-05T07:00:00.000Z", endsAt: "2026-11-05T09:00:00.000Z", userIds: ["u"], status: "PLANNED", href: "/b3" },
    ],
    workOrders: [{ id: "w1", title: "Klart måndag", status: "PLANNED", assignedToUserId: "u", dueDate: "2026-11-02", plannedStartDate: "", href: "/w1" },
      { id: "w2", title: "Klar redan", status: "COMPLETED", assignedToUserId: "u", dueDate: "2026-11-02", plannedStartDate: "", href: "/w2" }],
  });
  assert.deepEqual(rows.map((row) => [row.kind, row.id, row.day, row.backOn]), [["booking", "b1", "2026-10-30", "2026-11-03"], ["work-order", "w1", "2026-11-02", "2026-11-03"]]);
  const waited = affectedWork({ absences: [absence({ from: "2026-10-30", to: "2026-11-02", handled: ["booking:b1:u"] })], today: "2026-10-29", swedishDay: day,
    bookings: [{ id: "b1", title: "Jordfel", startsAt: "2026-10-30T07:00:00.000Z", endsAt: "2026-10-30T09:00:00.000Z", userIds: ["u"], status: "PLANNED", href: "/b1" }], workOrders: [] });
  assert.equal(waited.length, 0);
  // Some hours (the dentist 10–12): only a booking whose time overlaps them is touched, and no work order.
  const clock = (iso: string) => iso.slice(11, 16);
  const dentist = affectedWork({ absences: [absence({ type: "LEAVE", hours: { start: "10:00", end: "12:00" } })], today: "2026-10-29", swedishDay: day, swedishClock: clock,
    bookings: [{ id: "m", title: "Morgon", startsAt: "2026-10-30T07:00:00.000Z", endsAt: "2026-10-30T09:00:00.000Z", userIds: ["u"], status: "PLANNED", href: "/" },
      { id: "n", title: "Mitt på dagen", startsAt: "2026-10-30T09:30:00.000Z", endsAt: "2026-10-30T11:00:00.000Z", userIds: ["u"], status: "PLANNED", href: "/" }],
    workOrders: [{ id: "w", title: "Klart fredag", status: "PLANNED", assignedToUserId: "u", dueDate: "2026-10-30", plannedStartDate: "", href: "/" }] });
  assert.deepEqual(dentist.map((row) => row.id), ["n"]);
  assert.deepEqual(suggestReplacements([
    { id: "u", name: "U", freeMinutes: 480, away: true, mayDo: true }, { id: "a", name: "A", freeMinutes: 60, away: false, mayDo: true },
    { id: "b", name: "B", freeMinutes: 300, away: false, mayDo: true }, { id: "c", name: "C", freeMinutes: 480, away: false, mayDo: false },
  ], "u").map((person) => person.id), ["b", "a"], "not the absent one, not one without the right, most free first");
});

test("Frånvaro: a work order with a booking in the absence is listed once, as the booking (resa 4, 2026-11-06)", () => {
  const rows = affectedWork({
    absences: [absence({ from: "2026-11-09", to: "2026-11-10" })], today: "2026-11-06", swedishDay: day,
    bookings: [{ id: "b", title: "Byte av brytare fack 3", startsAt: "2026-11-09T06:00:00.000Z", endsAt: "2026-11-09T14:00:00.000Z", userIds: ["u"], status: "PLANNED", href: "/w", workOrderId: "w" }],
    workOrders: [{ id: "w", title: "Byte av brytare fack 3", status: "PLANNED", assignedToUserId: "u", dueDate: "2026-11-09", plannedStartDate: "", href: "/w" },
      { id: "x", title: "Utan bokning", status: "PLANNED", assignedToUserId: "u", dueDate: "2026-11-10", plannedStartDate: "", href: "/x" }],
  });
  assert.deepEqual(rows.map((row) => [row.kind, row.id]), [["booking", "b"], ["work-order", "x"]]);
});
