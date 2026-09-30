import assert from "node:assert/strict";
import test from "node:test";
import { mondayFor, summarizeReportedWeek } from "../lib/workflow/time-summary";
import { swedishDate, swedishParts } from "../lib/swedish-time";

test("reported week groups time by the Swedish Monday through Sunday", () => {
  const summary = summarizeReportedWeek([
    { startedAt: "2026-09-21T07:00:00.000Z", durationSec: 3_600 },
    { startedAt: "2026-09-24T08:00:00.000Z", durationSec: 5_400 },
    { startedAt: "2026-09-27T08:00:00.000Z", durationSec: 1_800 },
    // 23:30 UTC on Sunday is already Monday in Sweden and belongs to the next week.
    { startedAt: "2026-09-27T23:30:00.000Z", durationSec: 900 },
  ], swedishDate(2026, 9, 24, 12));
  assert.equal(summary.days[0].seconds, 3_600);
  assert.equal(summary.days[3].seconds, 5_400);
  assert.equal(summary.days[6].seconds, 1_800);
  assert.equal(summary.totalSeconds, 10_800);
  assert.equal(summary.weekdayPeakSeconds, 5_400);
});

test("reported week handles a Sunday anchor and corrupt duration safely", () => {
  const sunday = swedishDate(2026, 9, 27, 12);
  assert.equal(swedishParts(mondayFor(sunday)).day, 21);
  const summary = summarizeReportedWeek([{ startedAt: "2026-09-24T08:00:00.000Z", durationSec: Number.NaN }], sunday);
  assert.equal(summary.totalSeconds, 0);
  assert.equal(summary.weekdayPeakSeconds, 60);
});
