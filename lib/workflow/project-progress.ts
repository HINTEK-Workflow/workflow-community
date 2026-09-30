import { swedishDayKey } from "@/lib/swedish-time";

/** Calendar day number for a YYYY-MM-DD key, independent of time zone. */
const dayNumber = (key: string) => { const [year, month, day] = key.split("-").map(Number); return Date.UTC(year, month - 1, day) / 86_400_000; };

/**
 * Progression in two separate measures (2026-09-26, decision 9): how complete the work is, and whether it
 * follows the project's time frame. Budget stays a third, separate value. Pure functions shared by Cloud, Local and
 * the demo.
 */

/**
 * A control's progression: its checklist completeness, but at most 95 % until it is completed, like work orders and
 * risk assessments. The checklist's own "kompletteringsgrad" in the control and its report stays unchanged.
 */
export function controlProgress(status: string, checklistPercent: number | null | undefined) {
  if (status === "COMPLETED") return 100;
  return Math.max(0, Math.min(95, Math.round(checklistPercent ?? 0)));
}

/** Completion of a project: the plain average of its tasks' progression (a completed task is always 100 %). */
export function projectCompletion(tasks: { status: string; progress: number }[]) {
  if (!tasks.length) return 0;
  return Math.round(tasks.reduce((sum, task) => sum + (task.status === "COMPLETED" ? 100 : task.progress), 0) / tasks.length);
}

export type FrameAdherenceState = "NO_FRAME" | "NOT_STARTED" | "ON_TRACK" | "BEHIND" | "OVERDUE" | "DONE";

export type FrameAdherence = {
  state: FrameAdherenceState;
  label: string;
  /** Share of the frame's days that have started, 0–100 (Swedish calendar days, both ends included). */
  elapsedPercent: number;
  completionPercent: number;
};

/** How far completion may trail the elapsed share of the frame before the project counts as behind. */
export const FRAME_ADHERENCE_TOLERANCE = 10;

/**
 * "Följer tidsramen": the share completed compared with the share of the frame used. Behind means more than
 * FRAME_ADHERENCE_TOLERANCE percentage points behind; after the end date an unfinished project is overdue. Advisory
 * only – nothing is blocked or changed.
 */
export function summarizeFrameAdherence(input: { startDate?: string; dueDate?: string; completion: number; now?: Date }): FrameAdherence {
  const completionPercent = Math.max(0, Math.min(100, Math.round(input.completion)));
  const today = swedishDayKey(input.now ?? new Date());
  if (!input.startDate || !input.dueDate) return { state: "NO_FRAME", label: "Tidsram saknas", elapsedPercent: 0, completionPercent };
  const totalDays = dayNumber(input.dueDate) - dayNumber(input.startDate) + 1;
  const elapsedDays = Math.max(0, Math.min(totalDays, dayNumber(today) - dayNumber(input.startDate) + 1));
  const elapsedPercent = totalDays > 0 ? Math.round((elapsedDays / totalDays) * 100) : 100;
  if (completionPercent >= 100) return { state: "DONE", label: "Klart", elapsedPercent, completionPercent };
  if (today < input.startDate) return { state: "NOT_STARTED", label: "Inte startat", elapsedPercent: 0, completionPercent };
  if (today > input.dueDate) return { state: "OVERDUE", label: "Försenat", elapsedPercent: 100, completionPercent };
  return completionPercent + FRAME_ADHERENCE_TOLERANCE >= elapsedPercent
    ? { state: "ON_TRACK", label: "Följer tidsramen", elapsedPercent, completionPercent }
    : { state: "BEHIND", label: "Ligger efter", elapsedPercent, completionPercent };
}
