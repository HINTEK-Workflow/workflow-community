import assert from "node:assert/strict";
import test from "node:test";
import { isInSwedishMonth, movePlannedActivityToDay, movePlanningCalendar, planningActivitiesForDay, planningCalendarDays, planningCalendarTitle, planningDefaultInterval, shortNames } from "../lib/workflow/planning-calendar-summary";
import { swedishDate, swedishParts } from "../lib/swedish-time";

// All expectations use Swedish time so the tests pass on any host time zone.
const activity = (id: string, startsAt: string, endsAt: string) => ({ id, title: id, startsAt, endsAt, status: "PLANNED" as const, assignedToUserId: "member-a", assignedToUserIds: ["member-a"] });
const clock = (value: Date | string) => { const parts = swedishParts(value); return [parts.month, parts.day, parts.hour, parts.minute]; };

test("calendar derives the Swedish day, Monday-first week and a complete six-week month grid", () => {
  const anchor = swedishDate(2026, 10, 14, 12);
  assert.equal(planningCalendarDays(anchor, "day").length, 1);
  const week = planningCalendarDays(anchor, "week");
  assert.equal(week.length, 7);
  assert.equal(swedishParts(week[0]).weekday, 0);
  assert.deepEqual(clock(week[0]), [10, 12, 0, 0], "Week starts at Swedish midnight on Monday");
  const month = planningCalendarDays(anchor, "month");
  assert.equal(month.length, 42);
  assert.equal(isInSwedishMonth(month[0], anchor), false);
  assert.equal(isInSwedishMonth(month[10], anchor), true);
  assert.match(planningCalendarTitle(anchor, "month"), /oktober 2026/i);
  // Only the first letter is raised (QA 2026-10-10: CSS capitalize gave "5 Okt.–11 Okt.").
  assert.equal(planningCalendarTitle(anchor, "month"), "Oktober 2026");
  assert.match(planningCalendarTitle(anchor, "week"), /^12 okt[.]?–18 okt[.]?$/);
  assert.match(planningCalendarTitle(anchor, "day"), /^Onsdag 14 oktober 2026$/);
});

test("calendar navigation advances by the selected presentation range", () => {
  const anchor = swedishDate(2026, 10, 14, 12);
  assert.equal(swedishParts(movePlanningCalendar(anchor, "day", 1)).day, 15);
  assert.equal(swedishParts(movePlanningCalendar(anchor, "week", -1)).day, 7);
  assert.equal(swedishParts(movePlanningCalendar(anchor, "month", 1)).month, 11);
});

test("calendar date defaults are a Swedish 08:00–09:00 interval", () => {
  const interval = planningDefaultInterval(swedishDate(2026, 10, 14, 12));
  assert.deepEqual(clock(interval.startsAt), [10, 14, 8, 0]);
  assert.deepEqual(clock(interval.endsAt), [10, 14, 9, 0]);
  assert.equal(interval.endsAt.getTime() - interval.startsAt.getTime(), 60 * 60 * 1000);
  assert.equal(interval.startsAt.toISOString(), "2026-10-14T06:00:00.000Z");
});

test("a planning for today starts at the next whole hour once 08:00 has passed", () => {
  const now = swedishDate(2026, 10, 18, 18, 20);
  const interval = planningDefaultInterval(swedishDate(2026, 10, 18, 12), now);
  assert.deepEqual(clock(interval.startsAt), [10, 18, 19, 0]);
  assert.deepEqual(clock(interval.endsAt), [10, 18, 20, 0]);
  assert.deepEqual(clock(planningDefaultInterval(swedishDate(2026, 10, 19, 12), now).startsAt), [10, 19, 8, 0]);
  assert.deepEqual(clock(planningDefaultInterval(swedishDate(2026, 10, 18, 12), swedishDate(2026, 10, 18, 6)).startsAt), [10, 18, 8, 0]);
});

test("calendar includes activities that overlap a Swedish day and excludes adjacent or malformed intervals", () => {
  const day = swedishDate(2026, 10, 14, 12);
  const activities = [
    activity("Pågår över midnatt", "2026-10-13T21:00:00.000Z", "2026-10-13T23:00:00.000Z"),
    activity("Under dagen", "2026-10-14T09:00:00.000Z", "2026-10-14T10:00:00.000Z"),
    activity("Angränsande", "2026-10-14T22:00:00.000Z", "2026-10-14T23:00:00.000Z"),
    activity("Trasig", "not-a-date", "2026-10-14T10:00:00.000Z"),
  ];
  assert.deepEqual(planningActivitiesForDay(activities, day).map((item) => item.id), ["Pågår över midnatt", "Under dagen"]);
});

test("drag-and-drop moves whole Swedish days and keeps time of day, duration and individual intervals", () => {
  const startsAt = swedishDate(2026, 10, 23, 9); const endsAt = swedishDate(2026, 10, 23, 11, 30);
  const moved = movePlannedActivityToDay({ startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), assignments: [
    { userId: "a", plannedMinutes: 60, startsAt: swedishDate(2026, 10, 23, 10).toISOString(), endsAt: swedishDate(2026, 10, 23, 11).toISOString() },
    { userId: "b", plannedMinutes: null, startsAt: null, endsAt: null },
  ] }, swedishDate(2026, 10, 26, 15, 45));
  assert.ok(moved);
  // Across the October daylight-saving change the Swedish clock time is kept.
  assert.deepEqual(clock(moved.startsAt), [10, 26, 9, 0]);
  assert.deepEqual(clock(moved.endsAt), [10, 26, 11, 30]);
  assert.deepEqual(clock(moved.assignments[0].startsAt!), [10, 26, 10, 0]);
  assert.equal(moved.assignments[0].plannedMinutes, 60);
  assert.deepEqual(moved.assignments[1], { userId: "b", plannedMinutes: null, startsAt: null, endsAt: null });
  assert.equal(movePlannedActivityToDay({ startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), assignments: [] }, swedishDate(2026, 10, 23, 20)), null, "Dropping on the same day is not a change");
  assert.equal(movePlannedActivityToDay({ startsAt: "not-a-date", endsAt: endsAt.toISOString(), assignments: [] }, swedishDate(2026, 10, 26)), null);
});

test("Borta: the shortest name that is unique among the company's people (2026-11-02)", () => {
  const names = shortNames([{ id: "1", name: "Anna Andersson" }, { id: "2", name: "Anna Berg" }, { id: "3", name: "Bo Ek" }, { id: "4", name: "Cia Ek" }, { id: "5", name: "Cia Ekman" }, { id: "6", name: "QA" }]);
  assert.equal(names.get("1"), "Anna A.");
  assert.equal(names.get("2"), "Anna B.");
  assert.equal(names.get("3"), "Bo");
  assert.equal(names.get("4"), "Cia Ek", "the initial collides too: the whole name");
  assert.equal(names.get("5"), "Cia Ekman");
  assert.equal(names.get("6"), "QA");
});
