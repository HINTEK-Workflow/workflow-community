import assert from "node:assert/strict";
import test from "node:test";
import { addSwedishDays, formatSwedish, fromSwedishDateInput, fromSwedishDateTimeInput, isSameSwedishDay, startOfSwedishDay, startOfSwedishMonth, swedishDate, swedishDayDifference, swedishDayKey, swedishMonday, swedishParts, toSwedishDateTimeInput } from "../lib/swedish-time";

const iso = (value: Date) => value.toISOString();

test("Swedish wall-clock times map to the right instants in winter, summer and on both DST changes", () => {
  assert.equal(iso(swedishDate(2026, 1, 15, 8)), "2026-01-15T07:00:00.000Z");
  assert.equal(iso(swedishDate(2026, 7, 1, 8)), "2026-07-01T06:00:00.000Z");
  assert.equal(iso(swedishDate(2026, 3, 29, 12)), "2026-03-29T10:00:00.000Z");
  assert.equal(iso(swedishDate(2026, 10, 25, 12)), "2026-10-25T11:00:00.000Z");
  assert.equal(iso(swedishDate(2026, 12, 32)), "2026-12-31T23:00:00.000Z", "Day overflow rolls into the next year");
});

test("Swedish calendar days do not follow UTC or the host time zone", () => {
  const lateEvening = new Date("2026-09-24T22:30:00Z");
  assert.equal(swedishDayKey(lateEvening), "2026-09-25");
  assert.deepEqual(swedishParts(lateEvening), { year: 2026, month: 9, day: 25, hour: 0, minute: 30, second: 0, weekday: 4 });
  assert.equal(iso(startOfSwedishDay(lateEvening)), "2026-09-24T22:00:00.000Z");
  assert.equal(isSameSwedishDay("2026-09-24T21:59:00Z", "2026-09-24T22:01:00Z"), false);
  assert.equal(iso(swedishMonday("2026-09-27T12:00:00Z")), "2026-09-20T22:00:00.000Z");
  assert.equal(iso(startOfSwedishMonth("2026-09-25T12:00:00Z", 1)), "2026-09-30T22:00:00.000Z");
});

test("moving whole days keeps the Swedish clock time across the October change", () => {
  const fridayMorning = swedishDate(2026, 10, 23, 9);
  const mondayMorning = addSwedishDays(fridayMorning, 3);
  assert.equal(iso(mondayMorning), "2026-10-26T08:00:00.000Z");
  assert.equal(swedishParts(mondayMorning).hour, 9);
  assert.equal(swedishDayDifference(fridayMorning, mondayMorning), 3);
  assert.equal(swedishDayDifference("2026-03-28T23:30:00Z", "2026-03-29T21:00:00Z"), 0, "Both instants are 29 March in Sweden");
});

test("form inputs are read and written as Swedish time", () => {
  assert.equal(toSwedishDateTimeInput("2026-06-30T22:30:00Z"), "2026-07-01T00:30");
  assert.equal(iso(fromSwedishDateTimeInput("2026-07-01T00:30")!), "2026-06-30T22:30:00.000Z");
  assert.equal(fromSwedishDateTimeInput("nonsense"), null);
  assert.equal(iso(fromSwedishDateInput("2026-01-01")!), "2025-12-31T23:00:00.000Z");
  assert.equal(formatSwedish("2026-09-24T22:30:00Z", { hour: "2-digit", minute: "2-digit" }), "00:30");
});
