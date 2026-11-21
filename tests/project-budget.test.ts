import assert from "node:assert/strict";
import test from "node:test";
import { summarizeProjectBudget } from "../lib/workflow/project-budget";

test("project budget uses reported workflow time and never planned activity time", () => {
  assert.deepEqual(summarizeProjectBudget(480, 90 * 60), {
    budgetMinutes: 480,
    reportedMinutes: 90,
    remainingMinutes: 390,
    overBudgetMinutes: 0,
    percentUsed: 19,
    hasBudget: true,
    isOverBudget: false,
    isHighUsage: false,
  });
});

test("high usage warns from 85 percent until the budget is exceeded", () => {
  assert.equal(summarizeProjectBudget(600, 509 * 60).isHighUsage, false);
  assert.equal(summarizeProjectBudget(600, 510 * 60).isHighUsage, true);
  assert.equal(summarizeProjectBudget(600, 600 * 60).isHighUsage, true);
  assert.equal(summarizeProjectBudget(600, 601 * 60).isHighUsage, false, "Over budget is its own, stronger state");
});

test("project budget clearly reports an exceeded budget", () => {
  const summary = summarizeProjectBudget(60, 91 * 60);
  assert.equal(summary.isOverBudget, true);
  assert.equal(summary.remainingMinutes, 0);
  assert.equal(summary.overBudgetMinutes, 31);
  assert.equal(summary.percentUsed, 100);
});

test("missing, invalid and fractional inputs are safe for the UI", () => {
  assert.deepEqual(summarizeProjectBudget(undefined, 59), {
    budgetMinutes: 0,
    reportedMinutes: 1,
    remainingMinutes: 0,
    overBudgetMinutes: 0,
    percentUsed: 0,
    hasBudget: false,
    isOverBudget: false,
    isHighUsage: false,
  });
  assert.equal(summarizeProjectBudget(Number.NaN, Number.NaN).reportedMinutes, 0);
});
