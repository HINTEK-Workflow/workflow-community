import { isTaskOpen } from "./task-cancel";

/**
 * Förfallen och Försenad start, one rule each (2026-11-01, beslut 15; the words: docs/begreppslista.md). Hem, Översikt,
 * the key figures, the lists' filters and Teamet all use these, so the same job has the same word everywhere.
 * - Förfallen: an open job whose slutdatum (Klart senast) has passed. A finished or utgått job is never förfallen.
 * - Försenad start: an open job whose startdatum has passed and that has not been started: no time, no progress, and not yet
 *   förfallen (a job past its end date is Förfallen, never both).
 */
export const LATE_STATE_LABEL = { overdue: "Förfallen", late_start: "Försenad start" } as const;
export type LateState = keyof typeof LATE_STATE_LABEL;

export type LateFacts = { status: string; dueDate?: string | null; plannedStartDate?: string | null; progress?: number | null; startedAt?: Date | string | null };

export function isLateTask(task: { status: string; dueDate?: string | null }, today: string) {
  return isTaskOpen(task.status) && Boolean(task.dueDate) && task.dueDate! < today;
}

/** Statuses that mean the work has begun or is held up; the rest of the open ones have not been started. */
const UNDER_WAY = new Set(["IN_PROGRESS", "PAUSED", "NEEDS_ACTION"]);

export function isLateStart(task: LateFacts, today: string) {
  if (!isTaskOpen(task.status) || UNDER_WAY.has(task.status) || (task.progress ?? 0) > 0 || task.startedAt) return false;
  return Boolean(task.plannedStartDate) && task.plannedStartDate! < today && !isLateTask(task, today);
}

/** Which of the two a job is now, or null. */
export function lateStateOf(task: LateFacts, today: string): LateState | null {
  return isLateTask(task, today) ? "overdue" : isLateStart(task, today) ? "late_start" : null;
}

export function countLateTasks(tasks: readonly { status: string; dueDate?: string | null }[], today: string) {
  return tasks.filter((task) => isLateTask(task, today)).length;
}
