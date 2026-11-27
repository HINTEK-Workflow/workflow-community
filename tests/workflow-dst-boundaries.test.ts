import assert from "node:assert/strict";
import test from "node:test";
import { fromSwedishDateTimeInput, toSwedishDateTimeInput } from "../lib/swedish-time";

test("a nonexistent Swedish wall-clock time is rejected instead of silently moved", () => {
  assert.equal(fromSwedishDateTimeInput("2027-03-28T02:30"), null);
});

test("the repeated autumn wall-clock time has a stable round trip", () => {
  const value = fromSwedishDateTimeInput("2026-10-25T02:30");
  assert.ok(value);
  assert.equal(value.toISOString(), "2026-10-25T01:30:00.000Z");
  assert.equal(toSwedishDateTimeInput(value), "2026-10-25T02:30");
});
