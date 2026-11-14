import assert from "node:assert/strict";
import test from "node:test";
import {
  axisGroupLabel, barGeometry, easterSunday, holidayName, isDayKey, isoWeek, isWorkday, jobPeriod, jobsByWeek, lateWorkdays, minutesFromHours, hoursText,
  moveConsequences, movePeriod, resizePeriodEnd, scheduleAxis, schedulePeriodError, scheduleRange, scheduleState, shiftWorkdays,
  weekdayOf, workdayOffset, workdaysIn, type ScheduleJob,
} from "../lib/workflow/schedule";

const job = (values: Partial<ScheduleJob>): ScheduleJob => ({ id: "j1", title: "Jobb", kind: "WORK_ORDER", status: "PLANNED", progress: 0, plannedStartDate: "", dueDate: "", estimatedMinutes: null, ...values });

test("the month over a short stretch of the axis shows as much as fits, so it never runs into the next month", () => {
  assert.equal(axisGroupLabel("okt 2026", 500), "okt 2026");
  assert.equal(axisGroupLabel("sep 2026", 55), "sep");
  assert.equal(axisGroupLabel("sep 2026", 18), "");
  assert.equal(axisGroupLabel("v. 40", 200), "v. 40");
  assert.equal(axisGroupLabel("v. 40", 20), "");
});

test("Easter and the Swedish holidays follow the Easter rule", () => {
  assert.equal(easterSunday(2024), "2024-03-31");
  assert.equal(easterSunday(2025), "2025-04-20");
  assert.equal(easterSunday(2026), "2026-04-05");
  assert.equal(holidayName("2026-04-03"), "Långfredagen");
  assert.equal(holidayName("2026-04-06"), "Annandag påsk");
  assert.equal(holidayName("2026-05-14"), "Kristi himmelsfärdsdag");
  assert.equal(holidayName("2026-06-19"), "Midsommarafton");
  assert.equal(holidayName("2026-10-31"), "Alla helgons dag");
  assert.equal(holidayName("2026-12-24"), "Julafton");
  assert.equal(holidayName("2026-10-12"), "");
});

test("workdays skip weekends and holidays", () => {
  assert.equal(weekdayOf("2026-10-12"), 0);
  assert.equal(isWorkday("2026-10-09"), true);
  assert.equal(isWorkday("2026-10-10"), false);
  assert.equal(isWorkday("2026-12-24"), false);
  assert.equal(workdaysIn("2026-10-12", "2026-10-18"), 5);
  // Christmas week 2026: Mon 21, Tue 22, Wed 23 work; 24–26 off; Sun 27.
  assert.equal(workdaysIn("2026-12-21", "2026-12-27"), 3);
  assert.equal(shiftWorkdays("2026-10-09", 1), "2026-10-12");
  assert.equal(shiftWorkdays("2026-10-12", -1), "2026-10-09");
  assert.equal(shiftWorkdays("2026-12-23", 1), "2026-12-28");
  for (const [from, to] of [["2026-10-09", "2026-10-15"], ["2026-10-15", "2026-10-06"], ["2026-12-21", "2027-01-04"]])
    assert.equal(shiftWorkdays(from, workdayOffset(from, to)), to);
});

test("a dragged bar moves in whole workdays and keeps its length", () => {
  const period = { plannedStartDate: "2026-10-12", dueDate: "2026-10-16" };
  const moved = movePeriod(period, 3);
  assert.deepEqual(moved, { plannedStartDate: "2026-10-15", dueDate: "2026-10-21" });
  assert.equal(workdaysIn(moved.plannedStartDate, moved.dueDate), workdaysIn(period.plannedStartDate, period.dueDate));
  // Dropped on a Saturday it goes on to Monday.
  assert.equal(movePeriod(period, 5).plannedStartDate, "2026-10-19");
  assert.deepEqual(movePeriod(period, 0), period);
  // Dragging the end changes only Klart senast, onto a workday, never before Start.
  assert.deepEqual(resizePeriodEnd(period, 2), { plannedStartDate: "2026-10-12", dueDate: "2026-10-19" });
  assert.deepEqual(resizePeriodEnd(period, -10), { plannedStartDate: "2026-10-12", dueDate: "2026-10-12" });
  // A job without a start has no bar.
  assert.equal(jobPeriod({ plannedStartDate: "", dueDate: "2026-10-16" }), null);
  assert.deepEqual(jobPeriod({ plannedStartDate: "2026-10-12", dueDate: "" }), { start: "2026-10-12", end: "2026-10-12" });
});

test("lateness counts workdays after Klart senast and never for finished jobs", () => {
  assert.equal(lateWorkdays({ status: "IN_PROGRESS", dueDate: "2026-10-06" }, "2026-10-09"), 3);
  assert.equal(lateWorkdays({ status: "IN_PROGRESS", dueDate: "2026-10-09" }, "2026-10-10"), 1);
  assert.equal(lateWorkdays({ status: "COMPLETED", dueDate: "2026-10-01" }, "2026-10-09"), 0);
  assert.equal(lateWorkdays({ status: "CANCELLED", dueDate: "2026-10-01" }, "2026-10-09"), 0);
  assert.equal(scheduleState({ status: "PLANNED", dueDate: "2026-10-01" }, "2026-10-09"), "late");
  assert.equal(scheduleState({ status: "NEEDS_ACTION", dueDate: "2026-10-20" }, "2026-10-09"), "blocked");
  assert.equal(scheduleState({ status: "PAUSED", dueDate: "" }, "2026-10-09"), "active");
});

test("the period is checked against itself and the project's frame", () => {
  const frame = { startDate: "2026-10-01", dueDate: "2026-10-31" };
  assert.equal(schedulePeriodError({ plannedStartDate: "2026-10-05", dueDate: "2026-10-09" }, frame), null);
  assert.deepEqual(schedulePeriodError({ plannedStartDate: "2026-10-10", dueDate: "2026-10-09" }, frame)?.frame, false);
  assert.equal(schedulePeriodError({ plannedStartDate: "2026-09-28", dueDate: "2026-10-09" }, frame)?.frame, true);
  assert.equal(schedulePeriodError({ plannedStartDate: "2026-02-30", dueDate: "" }, null)?.frame, false);
  assert.equal(isDayKey("2026-02-30"), false);
  assert.equal(schedulePeriodError({ plannedStartDate: "2026-09-28", dueDate: "" }, null), null);
});

test("the consequences name bookings left outside, milestones and the project's end", () => {
  const bookings = [
    { id: "b1", taskId: "j1", title: "Anna", kind: "TASK", startDay: "2026-10-13", endDay: "2026-10-13", people: "Anna" },
    { id: "b2", taskId: "j1", title: "Erik", kind: "TASK", startDay: "2026-10-16", endDay: "2026-10-16", people: "Erik" },
    { id: "m1", taskId: null, title: "Besiktning", kind: "DEADLINE", startDay: "2026-10-19", endDay: "2026-10-19", people: "" },
  ];
  const previous = { plannedStartDate: "2026-10-12", dueDate: "2026-10-16" };
  const result = moveConsequences({ id: "j1" }, movePeriod(previous, 3), bookings, { startDate: "2026-10-01", dueDate: "2026-10-20" }, previous);
  assert.deepEqual(result.bookingsOutside.map((booking) => booking.id), ["b1"]);
  assert.deepEqual(result.milestonesPassed.map((booking) => booking.id), ["m1"]);
  assert.equal(result.passesProjectEnd, true);
  assert.equal(result.beforeProjectStart, false);
});

test("the axis spans frame, jobs and today from Monday to Sunday", () => {
  const range = scheduleRange({ frame: { startDate: "2026-10-07", dueDate: "2026-10-30" }, jobs: [{ plannedStartDate: "2026-11-02", dueDate: "2026-11-06" }], today: "2026-10-09", zoom: "week" });
  assert.equal(weekdayOf(range.from), 0);
  assert.equal(weekdayOf(range.to), 6);
  assert.ok(range.from <= "2026-10-04" || range.from === "2026-10-05");
  assert.ok(range.to >= "2026-11-06");
  assert.equal(range.days % 7, 0);
  const month = scheduleRange({ jobs: [], today: "2026-10-09", zoom: "month" });
  assert.ok(month.days >= 84);
  assert.deepEqual(barGeometry({ from: "2026-10-05", days: 28 }, "2026-10-07", "2026-10-09", 36), { left: 72, width: 108 });
  assert.equal(barGeometry({ from: "2026-10-05", days: 28 }, "2026-12-01", "2026-12-02", 36), null);
  const axis = scheduleAxis({ from: "2026-10-05", days: 14 }, "week");
  assert.deepEqual(axis.groups.map((group) => [group.label, group.span]), [["v. 41", 7], ["v. 42", 7]]);
  assert.equal(axis.offDays.length, 4);
  assert.equal(scheduleAxis({ from: "2026-10-05", days: 14 }, "month").cells.length, 2);
  assert.equal(isoWeek("2026-01-01"), 1);
  assert.equal(isoWeek("2027-01-01"), 53);
});

test("the phone lists the jobs by week with ongoing work under this week", () => {
  const jobs = [
    job({ id: "a", plannedStartDate: "2026-09-28", dueDate: "2026-10-14", status: "IN_PROGRESS" }),
    job({ id: "b", plannedStartDate: "2026-10-20", dueDate: "2026-10-22" }),
    job({ id: "c", plannedStartDate: "2026-09-21", dueDate: "2026-09-25", status: "COMPLETED" }),
    job({ id: "d" }),
  ];
  const { weeks, undated } = jobsByWeek(jobs, "2026-10-09");
  assert.deepEqual(weeks.map((week) => [week.monday, week.jobs.map((item) => item.id)]), [["2026-09-21", ["c"]], ["2026-10-05", ["a"]], ["2026-10-19", ["b"]]]);
  assert.match(weeks[1].label, /^Denna vecka · Vecka 41/);
  assert.deepEqual(undated.map((item) => item.id), ["d"]);
});

test("estimated time is entered in hours and kept in minutes", () => {
  assert.equal(minutesFromHours("16"), 960);
  assert.equal(minutesFromHours("1,5"), 90);
  assert.equal(minutesFromHours(""), null);
  assert.equal(minutesFromHours("-2"), null);
  assert.equal(hoursText(90), "1,5");
  assert.equal(hoursText(null), "");
});
