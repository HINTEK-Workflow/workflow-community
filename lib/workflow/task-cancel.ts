import { z } from "zod";

/**
 * Utgår (2026-10-09): a job – work order, protocol or risk assessment – that will not be done is set to Utgår with
 * a short reason instead of being deleted. It is kept read-only with its history, counts as neither open, late nor
 * remaining anywhere (key figures, Mina jobb, project progress and "klart att avsluta", notices, planning, project
 * status), is listed under "Utgått" and can be restored (Återuppta) by the same people. Its report is never finished.
 * Cloud, Local and the demo share these rules.
 */
export const CANCELLED_STATUS = "CANCELLED" as const;
/** The statuses that end a job: neither counts as open, late or remaining. */
export const CLOSED_TASK_STATUSES = ["COMPLETED", CANCELLED_STATUS] as const;

export const isTaskCancelled = (status: string | null | undefined) => status === CANCELLED_STATUS;
export const isTaskClosed = (status: string | null | undefined) => status === "COMPLETED" || status === CANCELLED_STATUS;
export const isTaskOpen = (status: string | null | undefined) => !isTaskClosed(status);

export const CANCEL_REASON_MAX = 500;
/** The reason is required and short: a few words up to a sentence or two. */
export const cancelReasonSchema = z.string().trim().min(3, "Skriv en kort orsak (minst 3 tecken).").max(CANCEL_REASON_MAX, `Orsaken får vara högst ${CANCEL_REASON_MAX} tecken.`);

export const TASK_CANCEL_LABEL = "Utgår";
export const TASK_CANCELLED_LABEL = "Utgått";

/** Why a job cannot be set to Utgår now, or null when it can. */
export function cancelTaskError(task: { status: string }, reason: string): string | null {
  if (isTaskCancelled(task.status)) return "Jobbet har redan utgått.";
  if (task.status === "COMPLETED") return "Ett färdigställt jobb kan inte utgå. Återöppna det först.";
  const parsed = cancelReasonSchema.safeParse(reason);
  return parsed.success ? null : parsed.error.issues[0]?.message ?? "Skriv en kort orsak.";
}

/** Why a job cannot be restored (Återuppta) now, or null when it can. */
export function restoreTaskError(task: { status: string }): string | null {
  return isTaskCancelled(task.status) ? null : "Jobbet har inte utgått.";
}

/**
 * The status a restored job gets: the one it had before Utgår, except that Pågår becomes Pausad, since setting Utgår
 * stopped every running timer. Unknown or missing values give Planerad.
 */
export function restoredTaskStatus(previous: string | null | undefined): "PLANNED" | "PAUSED" | "NEEDS_ACTION" {
  if (previous === "IN_PROGRESS" || previous === "PAUSED") return "PAUSED";
  if (previous === "NEEDS_ACTION") return "NEEDS_ACTION";
  return "PLANNED";
}

/** Project progress and "N uppgifter återstår" leave Utgått jobs out (they are done for the project but not 100 %). */
export const tasksForProgress = <T extends { status: string }>(tasks: readonly T[]) => tasks.filter((task) => !isTaskCancelled(task.status));

/** A booking whose job has utgått: kept, but it no longer counts in clashes or planned load (2026-10-09). */
export const bookingOnCancelledJob = (activity: { workflowTask?: { status?: string | null } | null }) => isTaskCancelled(activity.workflowTask?.status);
