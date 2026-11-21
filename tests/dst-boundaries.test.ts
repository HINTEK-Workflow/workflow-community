import assert from "node:assert/strict";
import test from "node:test";
import { addSwedishDays, fromSwedishDateTimeInput, startOfSwedishDay, swedishDate, swedishDayKey, swedishMonday, swedishParts } from "../lib/swedish-time";
import { summarizeReportedWeek } from "../lib/workflow/time-summary";
import { scheduleOccurrences } from "../lib/workflow/form-schedule";
import { isSwedishWorkday } from "../lib/workflow/booking-load";

// Granskning 2026-10-20: the two daylight-saving changes nearest in time, with fixed instants only (no real clock).
// 2026-10-25: 03:00 CEST -> 02:00 CET (a 25-hour day). 2027-03-28: 02:00 CET -> 03:00 CEST (a 23-hour day).
const HOUR = 3_600_000;
const iso = (value: Date) => value.toISOString();

test("the change days are 25 and 23 hours long, and the neighbouring days 24", () => {
  const length = (year: number, month: number, day: number) => (startOfSwedishDay(addSwedishDays(swedishDate(year, month, day, 12), 1)).getTime() - swedishDate(year, month, day).getTime()) / HOUR;
  assert.equal(length(2026, 10, 24), 24);
  assert.equal(length(2026, 10, 25), 25);
  assert.equal(length(2026, 10, 26), 24);
  assert.equal(length(2027, 3, 27), 24);
  assert.equal(length(2027, 3, 28), 23);
  assert.equal(length(2027, 3, 29), 24);
  assert.equal(iso(swedishDate(2026, 10, 25)), "2026-10-24T22:00:00.000Z");
  assert.equal(iso(swedishDate(2026, 10, 26)), "2026-10-25T23:00:00.000Z");
  assert.equal(iso(swedishDate(2027, 3, 28)), "2027-03-27T23:00:00.000Z");
  assert.equal(iso(swedishDate(2027, 3, 29)), "2027-03-28T22:00:00.000Z");
});

test("a night shift entered as clock times counts the real hours across both changes", () => {
  const hours = (date: string, from: string, to: string) => (fromSwedishDateTimeInput(`${date}T${to}`)!.getTime() - fromSwedishDateTimeInput(`${date}T${from}`)!.getTime()) / HOUR;
  assert.equal(hours("2026-10-25", "00:00", "06:00"), 7, "October: the clock shows 6 hours, 7 have passed");
  assert.equal(hours("2027-03-28", "00:00", "06:00"), 5, "March: the clock shows 6 hours, 5 have passed");
  assert.equal(hours("2026-10-24", "00:00", "06:00"), 6);
  // A clock time that does not exist in March (02:30) is refused, never moved an hour (2026-10-21; the review's own
  // assumption, that it is read as the moment the clock jumps past it, was overruled by the decision).
  assert.equal(fromSwedishDateTimeInput("2027-03-28T02:30"), null);
  assert.equal(swedishParts(fromSwedishDateTimeInput("2027-03-28T03:00")!).hour, 3);
});

test("whole days and weeks keep the clock time and the Monday across both changes", () => {
  for (const [y, m, d] of [[2026, 10, 23], [2027, 3, 26]] as const) {
    const friday = swedishDate(y, m, d, 7, 30);
    for (let step = 0; step <= 7; step += 1) assert.equal(swedishParts(addSwedishDays(friday, step)).hour, 7, `${y}-${m}-${d} + ${step} days`);
  }
  assert.equal(iso(swedishMonday(swedishDate(2026, 10, 25, 23, 59))), "2026-10-18T22:00:00.000Z", "Sunday 25 Oct belongs to the week from Monday 19 Oct (CEST)");
  assert.equal(iso(swedishMonday(swedishDate(2026, 10, 26, 0, 0))), "2026-10-25T23:00:00.000Z", "Monday 26 Oct 00:00 CET starts the next week");
  assert.equal(iso(swedishMonday(swedishDate(2027, 3, 28, 23, 0))), "2027-03-21T23:00:00.000Z");
  assert.equal(iso(swedishMonday(swedishDate(2027, 3, 29, 0, 30))), "2027-03-28T22:00:00.000Z");
});

test("reported time lands on the Swedish day it started, also in the extra and the missing hour", () => {
  const entries = [
    { startedAt: "2026-10-25T00:30:00.000Z", durationSec: 3600 }, // 02:30 CEST, the first 02:30
    { startedAt: "2026-10-25T01:30:00.000Z", durationSec: 3600 }, // 02:30 CET, the second 02:30
    { startedAt: "2026-10-25T22:59:00.000Z", durationSec: 600 }, // 23:59 CET Sunday
    { startedAt: "2026-10-25T23:00:00.000Z", durationSec: 900 }, // 00:00 CET Monday: next week
  ];
  const week = summarizeReportedWeek(entries, swedishDate(2026, 10, 21, 12));
  assert.deepEqual(week.days.map((day) => swedishDayKey(day.date)), ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
  assert.equal(week.days[6].seconds, 7800, "Sunday has both 02:30 entries and 23:59");
  assert.equal(week.totalSeconds, 7800, "Monday 00:00 is not in this week");
  const next = summarizeReportedWeek(entries, swedishDate(2026, 10, 26, 12));
  assert.equal(next.days[0].seconds, 900);
  const spring = summarizeReportedWeek([{ startedAt: "2027-03-28T00:59:00.000Z", durationSec: 60 }, { startedAt: "2027-03-28T01:00:00.000Z", durationSec: 120 }], swedishDate(2027, 3, 24, 12));
  assert.equal(spring.days[6].seconds, 180, "01:59 CET and 03:00 CEST are both Sunday 28 March");
});

test("round schedules give the same calendar days through both changes", () => {
  const daily = scheduleOccurrences({ frequency: "DAILY", interval: 1, weekdays: [], startDate: "2026-10-23", endDate: "" }, "2026-10-23", "2026-10-28");
  assert.deepEqual(daily, ["2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28"]);
  const sundays = scheduleOccurrences({ frequency: "WEEKLY", interval: 1, weekdays: [7], startDate: "2026-10-01", endDate: "" }, "2026-10-01", "2027-04-10");
  assert.ok(sundays.includes("2026-10-25") && sundays.includes("2027-03-28"));
  assert.ok(sundays.every((day) => new Date(`${day}T12:00:00Z`).getUTCDay() === 0), "every occurrence is a Sunday");
  assert.equal(sundays.length, 27);
  const everySecondDay = scheduleOccurrences({ frequency: "DAILY", interval: 2, weekdays: [], startDate: "2027-03-26", endDate: "" }, "2027-03-26", "2027-04-01");
  assert.deepEqual(everySecondDay, ["2027-03-26", "2027-03-28", "2027-03-30", "2027-04-01"]);
});

test("working days around the changes", () => {
  assert.equal(isSwedishWorkday("2026-10-23"), true);
  assert.equal(isSwedishWorkday("2026-10-25"), false);
  assert.equal(isSwedishWorkday("2026-10-26"), true);
  assert.equal(isSwedishWorkday(swedishDate(2026, 10, 26, 0, 30)), true, "Monday just after midnight, CET");
  assert.equal(isSwedishWorkday(swedishDate(2026, 10, 25, 23, 30)), false, "Sunday just before midnight");
  assert.equal(isSwedishWorkday("2027-03-26"), false, "Långfredag 2027");
  assert.equal(isSwedishWorkday("2027-03-29"), false, "Annandag påsk 2027");
  assert.equal(isSwedishWorkday("2027-03-30"), true);
});
