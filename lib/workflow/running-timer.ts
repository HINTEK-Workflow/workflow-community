import { swedishDayKey } from "@/lib/swedish-time";

/**
 * A running timer that has gone on for long is most likely forgotten (2026-09-26, decision 6 and 17):
 * more than 12 hours, or past midnight Swedish time. Used for the top bar marker and the warning when it stops.
 */
export const LONG_TIMER_SECONDS = 12 * 60 * 60;
/**
 * A timer stopped within the first minute (a start and pause by mistake) leaves no time entry: it would otherwise show as
 * 0 min in Rapporterad tid and the CSV (totalkontrollen F10, 2026-09-29). Same rule in Cloud and Local.
 */
export const MIN_TIME_ENTRY_SECONDS = 60;

/**
 * A running timer. Time runs on a work order or a project (Arbetsordern styr, 2026-10-26): `taskId` is the owner's
 * id – the work order's, or the project's when `kind` is PROJECT (then `projectId` too). RISK_ASSESSMENT and FORM are
 * only read from an older Local file before it is upgraded.
 */
export type RunningTimer = {
  entryId: string;
  taskId: string;
  taskTitle: string;
  kind: "WORK_ORDER" | "RISK_ASSESSMENT" | "FORM" | "PROJECT";
  projectName: string | null;
  projectId?: string | null;
  startedAt: string;
};

/** A time entry that was just stopped, returned so the client can warn about it; `projectId` when it was project time. */
export type StoppedTimer = { entryId: string; taskId: string; taskTitle: string; projectId?: string; startedAt: string; endedAt: string; durationSec: number };

export function timerNeedsAttention(startedAt: string | Date, now: string | Date = new Date()) {
  const start = new Date(startedAt);
  const end = new Date(now);
  return end.getTime() - start.getTime() > LONG_TIMER_SECONDS * 1000 || swedishDayKey(start) !== swedishDayKey(end);
}

export function timerElapsedSeconds(startedAt: string | Date, now: Date) {
  return Math.max(0, Math.floor((now.getTime() - new Date(startedAt).getTime()) / 1000));
}

/** 0:05:09, 12:00:00 – hours are not zero-padded. */
export function formatTimerClock(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${Math.floor(safe / 3600)}:${pad(Math.floor((safe % 3600) / 60))}:${pad(safe % 60)}`;
}

/** 35 h 53 min */
export function formatTimerDuration(seconds: number) {
  const minutes = Math.round(Math.max(0, seconds) / 60);
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** The page of what a running timer runs on: the work order, or the project. */
export function runningTimerTaskHref(timer: Pick<RunningTimer, "taskId" | "kind">): string {
  if (timer.kind === "PROJECT") return `/?view=project&projectId=${encodeURIComponent(timer.taskId)}`;
  return `/?view=workflow_task&taskId=${encodeURIComponent(timer.taskId)}&taskType=${timer.kind}`;
}

/** Where the timer runs, in words: "Arbetsorder · Projekt: X", "Arbetsorder" or "Projekttid · X". */
export function runningTimerPlace(timer: Pick<RunningTimer, "kind" | "projectName" | "taskTitle">): string {
  if (timer.kind === "PROJECT") return `Projekttid · ${timer.taskTitle}`;
  return timer.projectName ? `Arbetsorder · Projekt: ${timer.projectName}` : "Arbetsorder";
}

/**
 * Svar 3 (2026-10-24): the Tid tile on Hem opens the job whose time is running (the running timer's task); without a
 * running time it opens Tid as before.
 */
export function homeTimeTileHref(running: Pick<RunningTimer, "taskId" | "kind"> | null | undefined, idleHref: string): string {
  return running ? runningTimerTaskHref(running) : idleHref;
}
