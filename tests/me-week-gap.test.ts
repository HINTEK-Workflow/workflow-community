import assert from "node:assert/strict";
import test from "node:test";
import { hours, weekGap } from "../features/overview/me-tab";

// Resa 4 (2026-11-06): "Idag 0,0 h" for two minutes, and "Mån saknar 8 h" on a Friday when Monday to Thursday all lacked time.
const week = (minutes: number[]) => ({ ordinaryMinutes: 2400, days: minutes.map((value, index) => ({ date: `2026-11-0${index + 2}`, minutes: value })) });

test("Jag: hours have a decimal only when they need one", () => {
  assert.equal(hours(2), "0");
  assert.equal(hours(0), "0");
  assert.equal(hours(90), "1,5");
  assert.equal(hours(480), "8");
});

test("Jag: every past workday that lacks time is named, with the hours together", () => {
  assert.equal(weekGap(week([0, 0, 0, 0, 0, 0, 0]), "2026-11-06"), "Mån–Tors saknar 32 h");
  assert.equal(weekGap(week([0, 480, 300, 480, 0, 0, 0]), "2026-11-06"), "Mån, Ons saknar 11 h");
  assert.equal(weekGap(week([270, 480, 480, 480, 0, 0, 0]), "2026-11-06"), "Mån saknar 3,5 h");
  assert.equal(weekGap(week([480, 480, 480, 480, 0, 0, 0]), "2026-11-06"), null);
});
