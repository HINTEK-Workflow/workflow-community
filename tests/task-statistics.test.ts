import assert from "node:assert/strict";
import test from "node:test";
import { countTaskStatistics, hasRoundMarker, summarizeTaskStatistics, summarizeWorkOrderGoal, taskStatisticsBucket, taskStatisticsMeasure, type TaskStatisticsSource } from "../lib/workflow/task-statistics";
import { companyGoalsOf, companyGoalsSchema, NO_COMPANY_GOALS, parseGoalInput, visibleCompanyGoals } from "../lib/workflow/company-goals";
import { mostUrgentWork } from "../lib/workflow/overview-work";

test("task statistics combine created and completed per bucket against the monthly target", () => {
  const result = summarizeTaskStatistics({
    created: [{ date: "2026-09-01", count: 2 }, { date: "2026-09-15", count: 1 }, { date: "2026-10-02", count: 3 }],
    completed: [{ date: "2026-09-20", count: 2 }, { date: "2026-10-03", count: 1 }],
    from: "2026-09-01",
    to: "2026-10-31",
    bucket: "month",
    monthlyTarget: 4,
  });
  assert.deepEqual(result.series.map((row) => [row.date, row.created, row.completed, row.target]), [["2026-09", 3, 2, 4], ["2026-10", 6 - 3, 1, 4]]);
  assert.equal(result.series[1].cumulativeCreated, 6);
  assert.equal(result.series[1].cumulativeCompleted, 3);
  assert.equal(result.kpis.created, 6);
  assert.equal(result.kpis.completed, 3);
  assert.equal(result.kpis.periodTarget, 8);
  assert.equal(result.kpis.targetPercent, 38);
  assert.equal(result.kpis.averageCompletedPerMonth, 1.5);
});

test("task statistics choose a readable bucket automatically", () => {
  assert.equal(taskStatisticsBucket("2026-09-01", "2026-09-30", "auto"), "day");
  assert.equal(taskStatisticsBucket("2026-05-01", "2026-09-30", "auto"), "week");
  assert.equal(taskStatisticsBucket("2025-09-01", "2026-09-30", "auto"), "month");
  assert.equal(taskStatisticsBucket("2025-09-01", "2026-09-30", "day"), "day");
});

test("the folded overview shows the three most urgent items first", () => {
  const item = (id: string, overrides: Partial<{ needsAction: boolean; overdue: boolean; status: "Planerat" | "Pågår" | "Färdigställt" | "Behöver åtgärdas"; dueDate?: string; updatedAt: string }>) => ({ id, needsAction: false, overdue: false, status: "Pågår" as const, updatedAt: "2026-09-01T00:00:00Z", ...overrides });
  const urgent = mostUrgentWork([
    item("done-recent", { status: "Färdigställt", updatedAt: "2026-09-26T00:00:00Z" }),
    item("open-late-due", { dueDate: "2026-12-01" }),
    item("open-recent", { updatedAt: "2026-09-25T00:00:00Z" }),
    item("overdue", { overdue: true, dueDate: "2026-09-01" }),
    item("open-soon-due", { dueDate: "2026-09-30" }),
    item("needs-action", { needsAction: true, status: "Behöver åtgärdas" }),
  ]);
  assert.deepEqual(urgent.map((row) => row.id), ["overdue", "needs-action", "open-soon-due"]);
  assert.deepEqual(mostUrgentWork([item("done", { status: "Färdigställt" }), item("open", {})]).map((row) => row.id), ["open", "done"]);
});

// ---------- Statistik efter arbetsordermodellen (2026-10-28) ----------

const source = (id: string, overrides: Partial<TaskStatisticsSource>): TaskStatisticsSource => ({
  id, kind: "FORM", formArea: null, status: "COMPLETED", workOrderId: "wo-1", round: false, title: id,
  assignedToUserId: null, assignedToName: "", createdAt: "2026-10-05T08:00:00Z", completedAt: "2026-10-20T08:00:00Z", ...overrides,
});
// One work order with three protocols, one risk assessment and one round occurrence, a draft and a cancelled work order.
const fixture: TaskStatisticsSource[] = [
  source("wo-1", { kind: "WORK_ORDER", workOrderId: null, assignedToUserId: "u-anna-1", assignedToName: "Anna Berg" }),
  source("protocol-1", { assignedToUserId: "u-anna-1", assignedToName: "Anna Berg" }),
  source("protocol-2", { formArea: "kfid", assignedToUserId: "u-anna-2", assignedToName: "Anna Berg" }),
  source("protocol-3", { status: "IN_PROGRESS", completedAt: null, assignedToUserId: "u-anna-2", assignedToName: "Anna Berg" }),
  source("risk-1", { kind: "RISK_ASSESSMENT" }),
  source("round-1", { round: true, assignedToUserId: "u-anna-1", assignedToName: "Anna Berg" }),
  source("draft-1", { workOrderId: null, status: "PLANNED", completedAt: null }),
  source("wo-cancelled", { kind: "WORK_ORDER", workOrderId: null, status: "CANCELLED", completedAt: null }),
];

test("statistics count work orders, tasks in work orders and round occurrences apart; drafts nowhere; Utgått never completed", () => {
  const all = countTaskStatistics({ rows: fixture, from: "2026-10-01", to: "2026-10-31", type: "ALL" });
  assert.deepEqual(all.measures, {
    workOrders: { created: 2, completed: 1, cancelled: 1 },
    tasks: { created: 4, completed: 3, cancelled: 0 },
    rounds: { created: 1, completed: 1, cancelled: 0 },
  });
  assert.ok(!all.items.some((item) => item.id === "draft-1"), "a draft is not created work");
  assert.equal(all.cancelled, 1);
  assert.deepEqual(all.workOrdersCompleted, [{ date: "2026-10-20", count: 1 }]);
  const workOrders = countTaskStatistics({ rows: fixture, from: "2026-10-01", to: "2026-10-31", type: "WORK_ORDER" });
  assert.deepEqual(workOrders.items.map((item) => item.id).sort(), ["wo-1", "wo-cancelled"], "protocols and risk assessments are never work orders");
  assert.deepEqual(workOrders.completed, [{ date: "2026-10-20", count: 1 }]);
  assert.equal(countTaskStatistics({ rows: fixture, from: "2026-10-01", to: "2026-10-31", type: "TASK" }).items.length, 4);
  assert.deepEqual(countTaskStatistics({ rows: fixture, from: "2026-10-01", to: "2026-10-31", type: "ROUND" }).items.map((item) => item.id), ["round-1"]);
  // A kind filter covers tasks and round occurrences of that kind, never a work order.
  assert.deepEqual(countTaskStatistics({ rows: fixture, from: "2026-10-01", to: "2026-10-31", type: "FORM" }).items.map((item) => item.id).sort(), ["protocol-1", "protocol-3", "round-1"]);
  assert.deepEqual(countTaskStatistics({ rows: fixture, from: "2026-10-01", to: "2026-10-31", type: "KFID" }).items.map((item) => item.id), ["protocol-2"]);
  assert.deepEqual(countTaskStatistics({ rows: fixture, from: "2026-10-01", to: "2026-10-31", type: "RISK_ASSESSMENT" }).items.map((item) => item.id), ["risk-1"]);
});

test("the measure rule: drafts are left out, a task started before the work-order model stays a task", () => {
  assert.equal(taskStatisticsMeasure({ kind: "WORK_ORDER", status: "PLANNED", workOrderId: null }), "WORK_ORDER");
  assert.equal(taskStatisticsMeasure({ kind: "FORM", status: "PLANNED", workOrderId: null }), null);
  assert.equal(taskStatisticsMeasure({ kind: "RISK_ASSESSMENT", status: "CANCELLED", workOrderId: null }), null);
  assert.equal(taskStatisticsMeasure({ kind: "FORM", status: "COMPLETED", workOrderId: null }), "TASK", "history keeps its meaning");
  assert.equal(taskStatisticsMeasure({ kind: "FORM", status: "PLANNED", workOrderId: "wo", round: true }), "ROUND");
  assert.equal(hasRoundMarker("FORM", { details: { values: { round: { scheduleId: "s1", occurrence: "2026-10-01" } } } }), true);
  assert.equal(hasRoundMarker("FORM", { details: { values: { round: null } } }), false);
  assert.equal(hasRoundMarker("WORK_ORDER", { details: { values: { round: { scheduleId: "s1" } } } }), false);
  assert.equal(hasRoundMarker("FORM", null), false);
});

test("per performer groups by user id: two people with the same name stay apart, no user is one Ej tilldelad", () => {
  const result = countTaskStatistics({ rows: fixture, from: "2026-10-01", to: "2026-10-31", type: "ALL", names: new Map([["u-anna-1", "Anna Berg"]]) });
  const anna = result.performers.filter((row) => row.name === "Anna Berg");
  assert.deepEqual(anna.map((row) => [row.userId, row.created, row.completed]), [["u-anna-1", 3, 3], ["u-anna-2", 2, 1]]);
  const unassigned = result.performers.filter((row) => row.userId === null);
  assert.equal(unassigned.length, 1);
  assert.deepEqual([unassigned[0].name, unassigned[0].created, unassigned[0].completed], ["Ej tilldelad", 2, 1]);
});

test("the company goal: none set gives no target, a set goal is spread over the period's months", () => {
  assert.deepEqual(summarizeWorkOrderGoal({ completed: [{ date: "2026-10-20", count: 3 }], from: "2026-10-01", to: "2026-10-31", perMonth: null }), { perMonth: null, periodTarget: null, completed: 3, percent: null });
  assert.deepEqual(summarizeWorkOrderGoal({ completed: [{ date: "2026-10-20", count: 3 }], from: "2026-10-01", to: "2026-11-30", perMonth: 4 }), { perMonth: 4, periodTarget: 8, completed: 3, percent: 38 });
  assert.deepEqual(summarizeWorkOrderGoal({ completed: [], from: "2026-10-01", to: "2026-10-31", perMonth: 10 }), { perMonth: 10, periodTarget: 10, completed: 0, percent: 0 });
  // No goal draws no target line in the series.
  const summary = summarizeTaskStatistics({ created: [], completed: [], from: "2026-10-01", to: "2026-10-31", bucket: "month", monthlyTarget: 0 });
  assert.deepEqual(summary.series.map((row) => row.target), [0]);
  assert.equal(summary.kpis.targetPercent, 0);
});

test("company goals are read field by field, validated and hidden from those who do not see Ekonomi", () => {
  assert.deepEqual(companyGoalsOf(null), NO_COMPANY_GOALS);
  assert.deepEqual(companyGoalsOf({}), NO_COMPANY_GOALS);
  assert.deepEqual(companyGoalsOf({ completedWorkOrdersPerMonth: 12, invoicedPerMonth: -5, quoteWinRatePercent: "x" }), { completedWorkOrdersPerMonth: 12, invoicedPerMonth: null, quoteWinRatePercent: null });
  assert.deepEqual(companyGoalsSchema.parse({ completedWorkOrdersPerMonth: 20, invoicedPerMonth: 250000, quoteWinRatePercent: 35.5 }), { completedWorkOrdersPerMonth: 20, invoicedPerMonth: 250000, quoteWinRatePercent: 35.5 });
  assert.deepEqual(companyGoalsSchema.parse({}), NO_COMPANY_GOALS);
  assert.equal(companyGoalsSchema.safeParse({ completedWorkOrdersPerMonth: 0 }).success, false);
  assert.equal(companyGoalsSchema.safeParse({ completedWorkOrdersPerMonth: 2.5 }).success, false);
  assert.equal(companyGoalsSchema.safeParse({ quoteWinRatePercent: 101 }).success, false);
  const goals = { completedWorkOrdersPerMonth: 20, invoicedPerMonth: 250000, quoteWinRatePercent: 35 };
  assert.deepEqual(visibleCompanyGoals(goals, { economy: false }), { completedWorkOrdersPerMonth: 20, invoicedPerMonth: null, quoteWinRatePercent: null });
  assert.deepEqual(visibleCompanyGoals(goals, { economy: true }), goals);
  assert.equal(parseGoalInput(""), null);
  assert.equal(parseGoalInput("250 000"), 250000);
  assert.equal(parseGoalInput("35,5 %"), 35.5);
  assert.equal(parseGoalInput("tio"), undefined);
});

test("statistics days are Swedish days across month and year boundaries and summer/winter time", () => {
  const at = (id: string, instant: string) => source(id, { kind: "WORK_ORDER", workOrderId: null, createdAt: instant, completedAt: instant });
  const rows = [
    at("new-year", "2026-12-31T23:30:00Z"), // 00:30 on 1 January 2027 (CET)
    at("old-year", "2026-12-31T22:30:00Z"), // 23:30 on 31 December (CET)
    at("summer-end-before", "2026-10-24T22:30:00Z"), // 00:30 on 25 October (CEST, +2)
    at("summer-end-after", "2026-10-25T23:30:00Z"), // 00:30 on 26 October (CET, +1)
    at("summer-start-before", "2026-03-28T23:30:00Z"), // 00:30 on 29 March (CET)
    at("summer-start-after", "2026-03-29T22:30:00Z"), // 00:30 on 30 March (CEST)
    at("month-start", "2026-09-30T22:30:00Z"), // 00:30 on 1 October (CEST)
  ];
  const days = (from: string, to: string) => countTaskStatistics({ rows, from, to, type: "WORK_ORDER" }).completed;
  assert.deepEqual(days("2027-01-01", "2027-01-31"), [{ date: "2027-01-01", count: 1 }]);
  assert.deepEqual(days("2026-12-01", "2026-12-31"), [{ date: "2026-12-31", count: 1 }]);
  assert.deepEqual(days("2026-10-25", "2026-10-26"), [{ date: "2026-10-25", count: 1 }, { date: "2026-10-26", count: 1 }]);
  assert.deepEqual(days("2026-03-29", "2026-03-30"), [{ date: "2026-03-29", count: 1 }, { date: "2026-03-30", count: 1 }]);
  assert.deepEqual(days("2026-09-01", "2026-09-30"), [], "00:30 on the first belongs to the new month");
  assert.deepEqual(days("2026-10-01", "2026-10-01"), [{ date: "2026-10-01", count: 1 }]);
  // The month buckets of a series across the year boundary.
  const series = summarizeTaskStatistics({ created: [], completed: days("2026-12-01", "2027-01-31"), from: "2026-12-01", to: "2027-01-31", bucket: "month", monthlyTarget: 2 });
  assert.deepEqual(series.series.map((row) => [row.date, row.completed, row.target]), [["2026-12", 1, 2], ["2027-01", 1, 2]]);
});

test("an empty company gives zeros, never an error", () => {
  const empty = countTaskStatistics({ rows: [], from: "2026-01-01", to: "2026-12-31", type: "ALL" });
  assert.deepEqual(empty.measures, { workOrders: { created: 0, completed: 0, cancelled: 0 }, tasks: { created: 0, completed: 0, cancelled: 0 }, rounds: { created: 0, completed: 0, cancelled: 0 } });
  assert.deepEqual([empty.created, empty.completed, empty.performers, empty.items, empty.cancelled], [[], [], [], [], 0]);
  const summary = summarizeTaskStatistics({ created: empty.created, completed: empty.completed, from: "2026-01-01", to: "2026-12-31", bucket: "month", monthlyTarget: 0 });
  assert.equal(summary.series.length, 12);
  assert.deepEqual([summary.kpis.created, summary.kpis.completed, summary.kpis.targetPercent, summary.kpis.averageCompletedPerMonth], [0, 0, 0, 0]);
  assert.equal(summarizeWorkOrderGoal({ completed: [], from: "2026-01-01", to: "2026-12-31", perMonth: null }).percent, null);
});
