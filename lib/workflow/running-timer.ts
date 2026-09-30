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

export type RunningTimer = {
  entryId: string;
  taskId: string;
  taskTitle: string;
  kind: "WORK_ORDER" | "RISK_ASSESSMENT" | "FORM" | "KFID";
  projectName: string | null;
  startedAt: string;
};

/** A time entry that was just stopped, returned so the client can warn about it. */
export type StoppedTimer = { entryId: string; taskId: string; taskTitle: string; startedAt: string; endedAt: string; durationSec: number };

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
