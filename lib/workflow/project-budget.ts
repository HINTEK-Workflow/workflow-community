export type ProjectBudgetSummary = {
  budgetMinutes: number;
  reportedMinutes: number;
  remainingMinutes: number;
  overBudgetMinutes: number;
  percentUsed: number;
  hasBudget: boolean;
  isOverBudget: boolean;
  /** At least HIGH_BUDGET_USAGE_PERCENT used but not yet over budget. */
  isHighUsage: boolean;
};

export const HIGH_BUDGET_USAGE_PERCENT = 85;

/**
 * Calculates project budget status from persisted workflow time only.
 * Planned activities deliberately do not contribute to reported time.
 */
export function summarizeProjectBudget(timeBudgetMinutes: number | null | undefined, totalDurationSec: number) : ProjectBudgetSummary {
  const budgetMinutes = Number.isFinite(timeBudgetMinutes) ? Math.max(0, Math.round(timeBudgetMinutes ?? 0)) : 0;
  const reportedMinutes = Number.isFinite(totalDurationSec) ? Math.max(0, Math.round(totalDurationSec / 60)) : 0;
  const hasBudget = budgetMinutes > 0;
  const isOverBudget = hasBudget && reportedMinutes > budgetMinutes;
  const percentUsed = hasBudget ? Math.min(100, Math.round((reportedMinutes / budgetMinutes) * 100)) : 0;

  return {
    budgetMinutes,
    reportedMinutes,
    remainingMinutes: hasBudget ? Math.max(0, budgetMinutes - reportedMinutes) : 0,
    overBudgetMinutes: isOverBudget ? reportedMinutes - budgetMinutes : 0,
    percentUsed,
    hasBudget,
    isOverBudget,
    // Compare the exact ratio so a rounded 85 % display never triggers the warning early.
    isHighUsage: hasBudget && !isOverBudget && reportedMinutes * 100 >= budgetMinutes * HIGH_BUDGET_USAGE_PERCENT,
  };
}
