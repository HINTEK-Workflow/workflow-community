import assert from "node:assert/strict";
import test from "node:test";
import { summarizeTaskStatistics, taskStatisticsBucket } from "../lib/workflow/task-statistics";
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
  const item = (id: string, overrides: Partial<{ needsAction: boolean; overdue: boolean; status: "Planerat" | "Pågår" | "Slutfört" | "Behöver åtgärdas"; dueDate?: string; updatedAt: string }>) => ({ id, needsAction: false, overdue: false, status: "Pågår" as const, updatedAt: "2026-09-01T00:00:00Z", ...overrides });
  const urgent = mostUrgentWork([
    item("done-recent", { status: "Slutfört", updatedAt: "2026-09-26T00:00:00Z" }),
    item("open-late-due", { dueDate: "2026-12-01" }),
    item("open-recent", { updatedAt: "2026-09-25T00:00:00Z" }),
    item("overdue", { overdue: true, dueDate: "2026-09-01" }),
    item("open-soon-due", { dueDate: "2026-09-30" }),
    item("needs-action", { needsAction: true, status: "Behöver åtgärdas" }),
  ]);
  assert.deepEqual(urgent.map((row) => row.id), ["overdue", "needs-action", "open-soon-due"]);
  assert.deepEqual(mostUrgentWork([item("done", { status: "Slutfört" }), item("open", {})]).map((row) => row.id), ["open", "done"]);
});
