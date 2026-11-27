import assert from "node:assert/strict";
import test from "node:test";
import { clockOfMinutes, DEFAULT_WORKDAY, expectedWeeklyWorkMinutes, minutesOfClock, workdayInput, workdaySchema } from "../lib/workflow/work-schedule";
import { otherDayInputs, rangeForLength } from "../lib/workflow/time-types";
import { timeGaps } from "../lib/overview/team-followup";
import { ABSENCE_RETENTION_DEFAULT_MONTHS, absenceExpired, absenceRetentionCutoff, absenceRetentionMonthsOf, absenceRetentionMonthsSchema } from "../lib/absence/retention";
import { payrollSettingsSchema, readPayrollSettings } from "../lib/payroll/settings";
import { TOOL_CATALOG, toolInputSchema } from "../lib/tools/catalog";

// Arbetstid (2026-10-30): the company's workday, Ingen fast arbetstid, report_time's type and the absence retention.

test("the company's workday: 07:00–16:00 from the start, start before end, within the day", () => {
  assert.deepEqual(DEFAULT_WORKDAY, { startMinutes: 420, endMinutes: 960 });
  assert.deepEqual(workdaySchema.parse({ startMinutes: 390, endMinutes: 930 }), { startMinutes: 390, endMinutes: 930 });
  assert.equal(workdaySchema.safeParse({ startMinutes: 960, endMinutes: 420 }).success, false, "end before start");
  assert.equal(workdaySchema.safeParse({ startMinutes: 480, endMinutes: 480 }).success, false, "no length");
  assert.equal(workdaySchema.safeParse({ startMinutes: -1, endMinutes: 480 }).success, false);
  assert.equal(workdaySchema.safeParse({ startMinutes: 0, endMinutes: 1441 }).success, false);
  assert.equal(workdaySchema.safeParse({ startMinutes: 420.5, endMinutes: 960 }).success, false, "whole minutes");
  assert.equal(workdaySchema.safeParse({ startMinutes: 960, endMinutes: 420 }).error?.issues[0]?.message, "Arbetsdagen måste sluta efter att den börjar.");
});

test("clock text and minutes go both ways", () => {
  assert.equal(clockOfMinutes(420), "07:00");
  assert.equal(clockOfMinutes(965), "16:05");
  assert.equal(clockOfMinutes(1440), "24:00");
  assert.equal(minutesOfClock("07:00"), 420);
  assert.equal(minutesOfClock("7:30"), 450);
  assert.equal(minutesOfClock("24:00"), 1440);
  assert.equal(minutesOfClock("24:01"), null);
  assert.equal(minutesOfClock("12:60"), null);
  assert.equal(minutesOfClock(""), null);
});

test("the workday as typed in Arbetstid says what is wrong", () => {
  assert.deepEqual(workdayInput("06:30", "15:00"), { workday: { startMinutes: 390, endMinutes: 900 }, problem: "" });
  assert.equal(workdayInput("16:00", "07:00").problem, "Arbetsdagen måste sluta efter att den börjar.");
  assert.equal(workdayInput("", "07:00").problem, "Ange start och slut.");
});

test("time on another day starts at the company's workday start; today still counts back from now", () => {
  assert.deepEqual(otherDayInputs("2026-10-28", 420), { start: "2026-10-28T07:00", end: "2026-10-28T08:00" });
  assert.deepEqual(otherDayInputs("2026-10-28", 390), { start: "2026-10-28T06:30", end: "2026-10-28T07:30" });
  // Never past the day's end.
  assert.deepEqual(otherDayInputs("2026-10-28", 1439), { start: "2026-10-28T23:59", end: "2026-10-28T23:59" });
  const now = new Date("2026-10-30T14:00:00.000Z");
  assert.deepEqual(rangeForLength({ start: null, end: null, hours: 1, anchor: "now", now }), { start: new Date("2026-10-30T13:00:00.000Z"), end: now });
});

test("Ingen fast arbetstid: no expected time and no capacity; otherwise own hours, else the company's", () => {
  assert.equal(expectedWeeklyWorkMinutes(2400, { weeklyWorkMinutes: null }), 2400);
  assert.equal(expectedWeeklyWorkMinutes(2400, { weeklyWorkMinutes: 1920 }), 1920);
  assert.equal(expectedWeeklyWorkMinutes(2400, { weeklyWorkMinutes: 1920, noFixedHours: false }), 1920);
  assert.equal(expectedWeeklyWorkMinutes(2400, { weeklyWorkMinutes: 1920, noFixedHours: true }), 0);
  assert.equal(expectedWeeklyWorkMinutes(2400, { weeklyWorkMinutes: null, noFixedHours: true }), 0);
});

test("a person with no expected time is never missing time in Teamet", () => {
  const days = ["2026-10-26", "2026-10-27"];
  const rows = timeGaps({
    days, entries: [], swedishDay: (value) => String(value).slice(0, 10),
    members: [
      { id: "fixed", name: "Fast", dayMinutes: expectedWeeklyWorkMinutes(2400, { weeklyWorkMinutes: null }) / 5 },
      { id: "hourly", name: "Timanställd", dayMinutes: expectedWeeklyWorkMinutes(2400, { weeklyWorkMinutes: null, noFixedHours: true }) / 5 },
    ],
  });
  assert.deepEqual(rows.map((row) => row.userId), ["fixed"]);
});

test("absence retention: 1–120 months, 12 from the start, a stored odd value falls back", () => {
  assert.equal(ABSENCE_RETENTION_DEFAULT_MONTHS, 12);
  assert.equal(absenceRetentionMonthsSchema.parse(1), 1);
  assert.equal(absenceRetentionMonthsSchema.parse(120), 120);
  assert.equal(absenceRetentionMonthsSchema.safeParse(0).success, false);
  assert.equal(absenceRetentionMonthsSchema.safeParse(121).success, false);
  assert.equal(absenceRetentionMonthsSchema.safeParse(6.5).success, false);
  assert.equal(absenceRetentionMonthsOf(24), 24);
  assert.equal(absenceRetentionMonthsOf(null), 12);
  assert.equal(absenceRetentionMonthsOf(500), 12);
});

test("absence retention: what ended before the cutoff day goes, the rest stays", () => {
  const now = new Date("2026-10-30T02:00:00.000Z");
  const cutoff = absenceRetentionCutoff(12, now);
  assert.equal(cutoff.day, "2025-10-30");
  assert.equal(cutoff.instant.toISOString(), "2025-10-30T02:00:00.000Z");
  assert.equal(absenceExpired({ to: "2025-10-29" }, cutoff.day), true);
  assert.equal(absenceExpired({ to: "2025-10-30" }, cutoff.day), false, "the cutoff day itself is kept");
  assert.equal(absenceExpired({ to: "2026-01-10" }, cutoff.day), false);
  // Within the month: 31 March minus one month is the last of February.
  assert.equal(absenceRetentionCutoff(1, new Date("2026-03-31T10:00:00.000Z")).day, "2026-02-28");
});

test("payroll settings carry the retention; left out means unchanged", () => {
  const base = { system: "none", mode: "manual", importedEditable: false };
  assert.equal(payrollSettingsSchema.parse(base).absenceRetentionMonths, undefined);
  assert.equal(payrollSettingsSchema.parse({ ...base, absenceRetentionMonths: 36 }).absenceRetentionMonths, 36);
  assert.equal(payrollSettingsSchema.safeParse({ ...base, absenceRetentionMonths: 0 }).success, false);
  assert.equal(readPayrollSettings(null).absenceRetentionMonths, 12);
  assert.equal(readPayrollSettings(null, 24).absenceRetentionMonths, 24);
});

test("report_time takes an optional time type", () => {
  const input = TOOL_CATALOG.report_time.input;
  const base = { workOrderId: "wo-1", startedAt: "2026-10-30T07:00:00Z", endedAt: "2026-10-30T08:00:00Z" };
  assert.equal(input.safeParse(base).success, true, "without a type: the standard type");
  assert.equal(input.safeParse({ ...base, timeTypeId: "type-1" }).success, true);
  assert.equal(input.safeParse({ ...base, timeTypeId: "" }).success, false);
  const schema = toolInputSchema("report_time") as { properties?: Record<string, { description?: string }> };
  assert.ok(schema.properties?.timeTypeId?.description, "the field has a short description");
});
