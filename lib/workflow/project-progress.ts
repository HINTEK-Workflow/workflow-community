import { swedishDayKey } from "@/lib/swedish-time";
import { tasksForProgress } from "./task-cancel";

/** Calendar day number for a YYYY-MM-DD key, independent of time zone. */
const dayNumber = (key: string) => { const [year, month, day] = key.split("-").map(Number); return Date.UTC(year, month - 1, day) / 86_400_000; };

/**
 * Progression in two separate measures (2026-09-26, decision 9): how complete the work is, and whether it
 * follows the project's time frame. Budget stays a third, separate value. Pure functions shared by Cloud, Local and
 * the demo.
 */

/**
 * Completion of a project: the average of its tasks' progression (a completed task is always 100 %). Utgått jobs are left
 * out (2026-10-09). Weighted by Uppskattad tid when at least one job has an estimate (projektförslaget steg 2,
 * 2026-10-09): a job without one weighs as the average estimate; without any estimate it is the plain average as before.
 */
export function projectCompletion(all: { status: string; progress: number; estimatedMinutes?: number | null }[]) {
  const tasks = tasksForProgress(all);
  if (!tasks.length) return 0;
  const value = (task: (typeof tasks)[number]) => task.status === "COMPLETED" ? 100 : task.progress;
  const estimated = tasks.map((task) => task.estimatedMinutes).filter((minutes): minutes is number => typeof minutes === "number" && minutes > 0);
  if (!estimated.length) return Math.round(tasks.reduce((sum, task) => sum + value(task), 0) / tasks.length);
  const average = estimated.reduce((sum, minutes) => sum + minutes, 0) / estimated.length;
  const weight = (task: (typeof tasks)[number]) => typeof task.estimatedMinutes === "number" && task.estimatedMinutes > 0 ? task.estimatedMinutes : average;
  const total = tasks.reduce((sum, task) => sum + weight(task), 0);
  return Math.round(tasks.reduce((sum, task) => sum + value(task) * weight(task), 0) / total);
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
  if (today > input.dueDate) return { state: "OVERDUE", label: "Förfallet", elapsedPercent: 100, completionPercent };
  return completionPercent + FRAME_ADHERENCE_TOLERANCE >= elapsedPercent
    ? { state: "ON_TRACK", label: "Följer tidsramen", elapsedPercent, completionPercent }
    : { state: "BEHIND", label: "Ligger efter", elapsedPercent, completionPercent };
}
