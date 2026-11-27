import assert from "node:assert/strict";
import test from "node:test";
import { CLOUD_WORK_SCHEDULE_IMPORT_POLICY, DEFAULT_WEEKLY_WORK_MINUTES, effectiveWeeklyWorkMinutes, expectedWorkMinutesSoFar, weeklyWorkRemainingMinutes, workdaysSoFar, weeklyWorkMinutesSchema } from "../lib/workflow/work-schedule";
import { createLocalWorkspace, saveLocalWorkSchedule } from "../features/kfid/local-workspace-store";

test("organization default and voluntary member override resolve predictably", () => {
  assert.equal(DEFAULT_WEEKLY_WORK_MINUTES, 2_400);
  assert.equal(effectiveWeeklyWorkMinutes(2_400, null), 2_400);
  assert.equal(effectiveWeeklyWorkMinutes(2_400, 1_800), 1_800);
  assert.equal(weeklyWorkRemainingMinutes(1_050, 2_400, 1_800), 750);
});

test("expected time so far counts only the workdays Monday–Friday up to and including today (2026-11-22)", () => {
  // The week 2026-11-16 (Monday) – 2026-11-22 (Sunday).
  const week = { from: "2026-11-16", to: "2026-11-22", weeklyMinutes: 2_400 };
  assert.equal(expectedWorkMinutesSoFar({ ...week, today: "2026-11-16" }), 480, "Monday morning: Monday only, 8 h, not 40 h");
  assert.equal(expectedWorkMinutesSoFar({ ...week, today: "2026-11-18" }), 1_440, "Wednesday: Monday–Wednesday, 24 h");
  assert.equal(expectedWorkMinutesSoFar({ ...week, today: "2026-11-21" }), 2_400, "Saturday: Monday–Friday, the weekend adds nothing");
  assert.equal(expectedWorkMinutesSoFar({ ...week, today: "2026-11-22" }), 2_400, "Sunday: Monday–Friday");
  assert.equal(expectedWorkMinutesSoFar({ ...week, today: "2026-12-02" }), 2_400, "a past week: to its end");
  assert.equal(expectedWorkMinutesSoFar({ ...week, today: "2026-11-13" }), 0, "a week ahead expects nothing yet");
  assert.equal(expectedWorkMinutesSoFar({ ...week, today: "2026-11-18", weeklyMinutes: 1_800 }), 1_080, "the person's own week: 6 h a day");
  assert.equal(expectedWorkMinutesSoFar({ ...week, today: "2026-11-18", weeklyMinutes: 0 }), 0, "no fixed hours");
  assert.equal(workdaysSoFar("2026-11-01", "2026-11-30", "2026-11-30"), 21, "November 2026 has 21 workdays");
});

test("work schedule accepts a full week boundary and rejects impossible values", () => {
  assert.equal(weeklyWorkMinutesSchema.parse(7 * 24 * 60), 10_080);
  assert.throws(() => weeklyWorkMinutesSchema.parse(-1));
  assert.throws(() => weeklyWorkMinutesSchema.parse(10_081));
});

test("Cloud reimport fails closed for Local work schedule values", () => {
  assert.deepEqual(CLOUD_WORK_SCHEDULE_IMPORT_POLICY, { organization: "PRESERVED", memberOverride: "PRESERVED" });
});

test("a Local personal schedule change has a portable version timestamp and append-only event", () => {
  const workspace = createLocalWorkspace({ id: "schedule-org", name: "Schema QA" });
  const saved = saveLocalWorkSchedule(workspace, { scope: "MEMBER", minutes: 2_100 }, "Local QA");
  assert.equal(saved.localIdentity.weeklyWorkMinutes, 2_100);
  assert.equal(saved.workScheduleEvents[0].scope, "MEMBER");
  assert.equal(saved.workScheduleEvents[0].nextMinutes, 2_100);
  assert.equal(saved.updatedAt, saved.workScheduleEvents[0].createdAt);
});
