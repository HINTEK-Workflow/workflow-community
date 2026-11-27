import { timeSeries, type DailyCount } from "@/lib/kfid/analytics";
import { swedishDayKey } from "@/lib/swedish-time";
import { isDraftStatus } from "./work-order-link";

/**
 * Statistik efter arbetsordermodellen (2026-10-28: "Skilj arbetsordrar, uppgifter och rondtillfällen. Undvik
 * dubbelräkning av protokoll och riskbedömningar. Räkna inte utkast som färdigställda arbeten."). Every task counts once,
 * in exactly one measure:
 * - Arbetsordrar: kind WORK_ORDER (0.24.0's work order per round occurrence too – it is a work order).
 * - Uppgifter: a protocol, a control or a risk assessment in a work order – never counted as a work order. A task from
 *   before the work-order model that started without one (Local files) stays a task, so history keeps its meaning.
 * - Rondtillfällen: a protocol carrying the round marker (data.details.values.round.scheduleId, form-schedule taskRound).
 * - Utkast (no work order, Planerad or Utgår) count nowhere: nothing was done (lib/workflow/work-order-link.ts).
 * Utgått (CANCELLED) is created but never completed, and is counted on its own. Cloud's SQL (app/api/task-statistics)
 * applies the same rules in PostgreSQL; the demo counts with countTaskStatistics below.
 */
export const TASK_STATISTICS_MEASURES = ["WORK_ORDER", "TASK", "ROUND"] as const;
export type TaskStatisticsMeasure = (typeof TASK_STATISTICS_MEASURES)[number];
/** The filter: ALL (every measure), one measure, or a task kind across tasks and round occurrences. */
export const TASK_STATISTICS_TYPES = ["ALL", "WORK_ORDER", "TASK", "ROUND", "KFID", "RISK_ASSESSMENT", "FORM"] as const;
export type TaskStatisticsType = (typeof TASK_STATISTICS_TYPES)[number];
export type TaskStatisticsKind = "KFID" | "WORK_ORDER" | "RISK_ASSESSMENT" | "FORM";
export type TaskStatisticsBucket = "day" | "week" | "month";

export const taskStatisticsTypeLabel: Record<TaskStatisticsKind, string> = {
  KFID: "Kontroll före idrifttagning",
  WORK_ORDER: "Arbetsorder",
  RISK_ASSESSMENT: "Riskbedömning",
  FORM: "Formulär",
};
export const taskStatisticsMeasureLabel: Record<TaskStatisticsMeasure, string> = { WORK_ORDER: "Arbetsordrar", TASK: "Uppgifter i arbetsordrar", ROUND: "Rondtillfällen" };

export type TaskStatisticsPoint = { date: string; created: number; completed: number; target: number; cumulativeCreated: number; cumulativeCompleted: number; cumulativeTarget: number };
/** Per utförare (2026-10-28): grouped by the user id; `userId` null is the one "Ej tilldelad" bucket. */
export type TaskStatisticsPerformer = { userId: string | null; name: string; created: number; completed: number };
export type TaskStatisticsCounts = { created: number; completed: number; cancelled: number };
export type TaskStatisticsMeasures = Record<"workOrders" | "tasks" | "rounds", TaskStatisticsCounts>;
export const UNASSIGNED_PERFORMER = "Ej tilldelad";

/** A control or risk assessment made as a form counts as a control or risk assessment (2026-09-27). */
export function taskStatisticsKind(kind: string, formArea?: string | null): TaskStatisticsKind {
  if (kind === "FORM" && formArea === "kfid") return "KFID";
  if (kind === "FORM" && formArea === "risk-assessment") return "RISK_ASSESSMENT";
  return kind === "WORK_ORDER" || kind === "RISK_ASSESSMENT" ? kind : "FORM";
}

/** The one measure a task counts in, or null for a draft (counted nowhere). */
export function taskStatisticsMeasure(task: { kind: string; status: string; workOrderId?: string | null; round?: boolean }): TaskStatisticsMeasure | null {
  if (task.kind === "WORK_ORDER") return "WORK_ORDER";
  if (!task.workOrderId && isDraftStatus(task.status)) return null;
  return task.round ? "ROUND" : "TASK";
}

/** A round occurrence: a protocol with the round marker (as the SQL's jsonb_typeof(...scheduleId) = 'string'). */
export function hasRoundMarker(kind: string, data: unknown) {
  const round = (data as { details?: { values?: { round?: { scheduleId?: unknown } | null } } } | null)?.details?.values?.round;
  return kind === "FORM" && typeof round?.scheduleId === "string";
}

export function matchesTaskStatisticsType(type: TaskStatisticsType, measure: TaskStatisticsMeasure, kind: TaskStatisticsKind) {
  if (type === "ALL") return true;
  if (type === "WORK_ORDER" || type === "TASK" || type === "ROUND") return measure === type;
  return measure !== "WORK_ORDER" && kind === type;
}

export function taskStatisticsBucket(from: string, to: string, requested: "auto" | TaskStatisticsBucket): TaskStatisticsBucket {
  if (requested !== "auto") return requested;
  const days = (Date.parse(to) - Date.parse(from)) / 86400000;
  return days <= 62 ? "day" : days <= 210 ? "week" : "month";
}

/**
 * Combines Swedish-day counts of created and completed tasks into one series. The target is the company's own goal
 * (completed per month, spread evenly over the days of each month) – 0 when none applies, which draws no line.
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

/**
 * The company's work-order goal against the work orders completed in the period, whatever the type filter shows.
 * `perMonth` null = no goal set: no target and no percent.
 */
export function summarizeWorkOrderGoal(input: { completed: DailyCount[]; from: string; to: string; perMonth: number | null }) {
  const completed = input.completed.reduce((sum, row) => sum + row.count, 0);
  if (!input.perMonth) return { perMonth: null, periodTarget: null, completed, percent: null };
  const periodTarget = Math.round(timeSeries([], input.from, input.to, "month", input.perMonth).reduce((sum, row) => sum + row.target, 0) * 10) / 10;
  return { perMonth: input.perMonth, periodTarget, completed, percent: periodTarget ? Math.round((completed / periodTarget) * 100) : 0 };
}

export const emptyTaskStatisticsMeasures = (): TaskStatisticsMeasures => ({
  workOrders: { created: 0, completed: 0, cancelled: 0 }, tasks: { created: 0, completed: 0, cancelled: 0 }, rounds: { created: 0, completed: 0, cancelled: 0 },
});
export const measureKey: Record<TaskStatisticsMeasure, keyof TaskStatisticsMeasures> = { WORK_ORDER: "workOrders", TASK: "tasks", ROUND: "rounds" };

export type TaskStatisticsSource = {
  id: string; kind: string; formArea?: string | null; status: string; workOrderId?: string | null; round: boolean; title: string;
  assignedToUserId: string | null; assignedToName: string; createdAt: string | Date; completedAt: string | Date | null;
};
export type TaskStatisticsItem = { id: string; kind: TaskStatisticsKind; taskKind: string; measure: TaskStatisticsMeasure; title: string; status: string; performer: string; createdDay: string; completedDay: string | null; createdAt: string };

/**
 * The whole count from task rows (the demo; Cloud does the same in SQL). Days are Swedish calendar days of the stored
 * instants, so a task completed 00:30 Swedish time on the first of a month counts in that month, across summer and
 * winter time. `names` gives each user's current name (else the name stored on the task).
 */
export function countTaskStatistics(input: { rows: readonly TaskStatisticsSource[]; from: string; to: string; type: TaskStatisticsType; names?: ReadonlyMap<string, string> }) {
  const inPeriod = (day: string | null): day is string => Boolean(day && day >= input.from && day <= input.to);
  const measures = emptyTaskStatisticsMeasures();
  const created = new Map<string, number>(), completed = new Map<string, number>(), workOrdersCompleted = new Map<string, number>();
  const performers = new Map<string, TaskStatisticsPerformer>();
  const items: TaskStatisticsItem[] = [];
  let cancelled = 0;
  for (const row of input.rows) {
    const measure = taskStatisticsMeasure(row);
    if (!measure) continue;
    const kind = taskStatisticsKind(row.kind, row.formArea);
    const createdAt = row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt;
    const createdDay = swedishDayKey(createdAt);
    const completedDay = row.status === "COMPLETED" && row.completedAt ? swedishDayKey(row.completedAt) : null;
    const counts = measures[measureKey[measure]];
    if (inPeriod(createdDay)) { counts.created++; if (row.status === "CANCELLED") counts.cancelled++; }
    if (inPeriod(completedDay)) { counts.completed++; if (measure === "WORK_ORDER") workOrdersCompleted.set(completedDay, (workOrdersCompleted.get(completedDay) ?? 0) + 1); }
    if (!matchesTaskStatisticsType(input.type, measure, kind) || !(inPeriod(createdDay) || inPeriod(completedDay))) continue;
    const userId = row.assignedToUserId || null;
    const name = userId ? input.names?.get(userId) || row.assignedToName || "Okänd användare" : UNASSIGNED_PERFORMER;
    const performer = performers.get(userId ?? "") ?? { userId, name, created: 0, completed: 0 };
    if (inPeriod(createdDay)) {
      created.set(createdDay, (created.get(createdDay) ?? 0) + 1);
      performer.created++;
      if (row.status === "CANCELLED") cancelled++;
      items.push({ id: row.id, kind, taskKind: row.kind, measure, title: row.title, status: row.status, performer: name, createdDay, completedDay, createdAt });
    }
    if (inPeriod(completedDay)) { completed.set(completedDay, (completed.get(completedDay) ?? 0) + 1); performer.completed++; }
    performers.set(userId ?? "", performer);
  }
  const daily = (map: Map<string, number>): DailyCount[] => [...map].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date));
  return {
    created: daily(created),
    completed: daily(completed),
    workOrdersCompleted: daily(workOrdersCompleted),
    cancelled,
    measures,
    performers: [...performers.values()].sort((a, b) => b.completed - a.completed || b.created - a.created || a.name.localeCompare(b.name, "sv") || (a.userId ?? "").localeCompare(b.userId ?? "")).slice(0, 30),
    items: items.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)),
  };
}
