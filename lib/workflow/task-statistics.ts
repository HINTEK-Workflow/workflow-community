import { timeSeries, type DailyCount } from "@/lib/kfid/analytics";

/** Task types covered by the overview's task statistics. `ALL` combines them. */
export const TASK_STATISTICS_TYPES = ["ALL", "KFID", "WORK_ORDER", "RISK_ASSESSMENT", "FORM"] as const;
export type TaskStatisticsType = (typeof TASK_STATISTICS_TYPES)[number];
export type TaskStatisticsBucket = "day" | "week" | "month";

export const taskStatisticsTypeLabel: Record<Exclude<TaskStatisticsType, "ALL">, string> = {
  KFID: "Kontroll före idrifttagning",
  WORK_ORDER: "Arbetsorder",
  RISK_ASSESSMENT: "Riskbedömning",
  FORM: "Formulär",
};

export type TaskStatisticsPoint = { date: string; created: number; completed: number; target: number; cumulativeCreated: number; cumulativeCompleted: number; cumulativeTarget: number };
export type TaskStatisticsPerformer = { name: string; created: number; completed: number };

export function taskStatisticsBucket(from: string, to: string, requested: "auto" | TaskStatisticsBucket): TaskStatisticsBucket {
  if (requested !== "auto") return requested;
  const days = (Date.parse(to) - Date.parse(from)) / 86400000;
  return days <= 62 ? "day" : days <= 210 ? "week" : "month";
}

/**
 * Combines Swedish-day counts of created and completed tasks into one series. The target is expressed as
 * completed tasks per month (V1's level: two per active user and month) and spread evenly over the days.
 */
export function summarizeTaskStatistics(input: { created: DailyCount[]; completed: DailyCount[]; from: string; to: string; bucket: TaskStatisticsBucket; monthlyTarget: number }) {
  const created = timeSeries(input.created, input.from, input.to, input.bucket, input.monthlyTarget);
  const completed = timeSeries(input.completed, input.from, input.to, input.bucket, input.monthlyTarget);
  const series: TaskStatisticsPoint[] = created.map((row, index) => ({
    date: row.date,
    created: row.count,
    completed: completed[index]?.count ?? 0,
    target: row.target,
    cumulativeCreated: row.cumulative,
    cumulativeCompleted: completed[index]?.cumulative ?? 0,
    cumulativeTarget: row.cumulativeTarget,
  }));
  const monthly = timeSeries(input.completed, input.from, input.to, "month", input.monthlyTarget);
  const totalCreated = input.created.reduce((sum, row) => sum + row.count, 0);
  const totalCompleted = input.completed.reduce((sum, row) => sum + row.count, 0);
  const periodTarget = Math.round(monthly.reduce((sum, row) => sum + row.target, 0) * 10) / 10;
  return {
    series,
    kpis: {
      created: totalCreated,
      completed: totalCompleted,
      target: input.monthlyTarget,
      periodTarget,
      targetPercent: periodTarget ? Math.round((totalCompleted / periodTarget) * 100) : 0,
      averageCompletedPerMonth: monthly.length ? Math.round((totalCompleted / monthly.length) * 10) / 10 : 0,
    },
  };
}
