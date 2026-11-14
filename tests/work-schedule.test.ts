import assert from "node:assert/strict";
import test from "node:test";
import { CLOUD_WORK_SCHEDULE_IMPORT_POLICY, DEFAULT_WEEKLY_WORK_MINUTES, effectiveWeeklyWorkMinutes, weeklyWorkRemainingMinutes, weeklyWorkMinutesSchema } from "../lib/workflow/work-schedule";
import { createLocalWorkspace, saveLocalWorkSchedule } from "../features/kfid/local-workspace-store";

test("organization default and voluntary member override resolve predictably", () => {
  assert.equal(DEFAULT_WEEKLY_WORK_MINUTES, 2_400);
  assert.equal(effectiveWeeklyWorkMinutes(2_400, null), 2_400);
  assert.equal(effectiveWeeklyWorkMinutes(2_400, 1_800), 1_800);
  assert.equal(weeklyWorkRemainingMinutes(1_050, 2_400, 1_800), 750);
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
