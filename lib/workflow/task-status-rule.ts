import { waitingReasonOf } from "./maintenance";
import type { WorkflowTaskStatus } from "./task-model";

/**
 * Pågår and Pausad follow the time (2026-10-08): Starta sets Pågår, Pausa sets Pausad, so the manual Status list
 * no longer competes with the timer. The list offers what time does not drive – Planerad and Behöver åtgärdas (and, on a
 * work order, "Väntar på …", a pause with a reason) – plus the task's current status, so an older manual value stays
 * readable and is kept on save. Slutförd is reached through completion, never through the list. Cloud, Local and demo.
 */
export const TIME_DRIVEN_STATUSES = ["IN_PROGRESS", "PAUSED"] as const satisfies readonly WorkflowTaskStatus[];

export const isTimeDrivenStatus = (status: string) => (TIME_DRIVEN_STATUSES as readonly string[]).includes(status);

const MANUAL_STATUSES: WorkflowTaskStatus[] = ["PLANNED", "NEEDS_ACTION"];

/** The choices in the Status list, the current status first when time (or completion) set it. */
export function manualStatusChoices(current: WorkflowTaskStatus): WorkflowTaskStatus[] {
  return MANUAL_STATUSES.includes(current) ? MANUAL_STATUSES : [current, ...MANUAL_STATUSES];
}

/**
 * The status a save of an existing task stores. A save never moves a saved task into or between Pågår and Pausad:
 * asking for a time-driven status other than the stored one keeps the stored status (documentation may still lift
 * Planerad to Pågår afterwards, as before). The exception is a work order paused because it waits for something
 * (`waiting`), which is a manual choice. A new task (`stored` null) has no time yet and keeps what it was created
 * with, so imports and API callers work as before; every other status passes through, so no data is rewritten.
 */
export function savedTaskStatus(input: { requested: WorkflowTaskStatus; stored: WorkflowTaskStatus | null; waiting?: boolean }): WorkflowTaskStatus {
  const { requested, stored } = input;
  // Utgår (2026-10-09) is never set or lifted by a save: only the cancel/restore action changes it.
  if (requested === "CANCELLED" && stored !== "CANCELLED") return stored ?? "PLANNED";
  if (stored === null || !isTimeDrivenStatus(requested) || requested === stored) return requested;
  if (requested === "PAUSED" && input.waiting) return requested;
  return stored;
}

/** `savedTaskStatus` for a whole task as sent to a save; `stored` is the saved task's status, or null for a new task. */
export function savedStatusForTask(task: { status: WorkflowTaskStatus; data: { kind: string; details?: unknown } }, stored: string | null | undefined) {
  const details = task.data.kind === "WORK_ORDER" ? task.data.details : undefined;
  return savedTaskStatus({ requested: task.status, stored: (stored as WorkflowTaskStatus | null | undefined) ?? null, waiting: Boolean(waitingReasonOf(task.status, details)) });
}
