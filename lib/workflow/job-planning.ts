import { swedishDayKey } from "@/lib/swedish-time";
import { projectCompletion } from "./project-progress";
import { type ProjectFrame, hasProjectFrame, shiftDay } from "./project-frame";
import { isTaskOpen } from "./task-cancel";
import { isDayKey, jobPeriod } from "./schedule";

/**
 * Jobbets planering (2026-10-11, plan 1M): every job has a Start, and a job can belong to an Etapp (a stage). Pure
 * rules shared by Cloud, Local, the demo, the API/MCP and the pages – no database, no React.
 *
 * Start is forced: a job that gets none starts today (the day it is created or linked to a project), moved only as far as
 * the project's frame and the job's Klart senast need. A job saved before this rule has none stored; it is counted from the
 * day it was created and nothing is rewritten (`effectiveStartDate`).
 */

/**
 * The day a job counts as starting: its Start, or – for an older job without one – the Swedish day it was created.
 * YYYY-MM-DD in Europe/Stockholm; nothing is stored.
 */
export function effectiveStartDate(task: { plannedStartDate: string; createdAt: string | Date }): string {
  if (task.plannedStartDate && isDayKey(task.plannedStartDate)) return task.plannedStartDate;
  return swedishDayKey(task.createdAt);
}

/**
 * The Start a new job gets when none is chosen: today, but inside the project's frame and never after Klart senast, so the
 * default itself is never refused. `frame` is the project's frame, when the job belongs to a project.
 */
export function defaultStartDate(input: { today: string; dueDate?: string; frame?: Partial<ProjectFrame> | null }): string {
  let start = input.today;
  if (hasProjectFrame(input.frame)) {
    if (start < input.frame.startDate) start = input.frame.startDate;
    if (start > input.frame.dueDate) start = input.frame.dueDate;
  }
  if (input.dueDate && isDayKey(input.dueDate) && start > input.dueDate) start = input.dueDate;
  return start;
}

/** Start for a job being created or linked to a project: the chosen one, else the default. */
/**
 * "Koppla till projekt" moved Klart senast to the project's end and could leave Start after it (found at the release of
 * 0.35.0): Start follows along, so the job is never saved with a Start after its Klart senast. Nothing to change otherwise.
 */
export function startFollowingDue(start: string | null | undefined, due: string | null | undefined): { plannedStartDate?: string } {
  return start && due && start > due ? { plannedStartDate: due } : {};
}

/**
 * Start when a job joins a project (Koppla till projekt, Flytta arbetsorder hit): inside the project's frame, as a Start chosen
 * on the job must be, and never after Klart senast. Nothing to change otherwise, and a job without a Start is startForNewJob's.
 */
export function startOnProjectLink(input: { start: string | null | undefined; due: string | null | undefined; frame?: Partial<ProjectFrame> | null }): { plannedStartDate?: string } {
  if (!input.start) return {};
  let start = input.start;
  if (hasProjectFrame(input.frame)) {
    if (start < input.frame.startDate) start = input.frame.startDate;
    if (start > input.frame.dueDate) start = input.frame.dueDate;
  }
  if (input.due && start > input.due) start = input.due;
  return start === input.start ? {} : { plannedStartDate: start };
}

export const startForNewJob = (input: { chosen?: string | null; today: string; dueDate?: string; frame?: Partial<ProjectFrame> | null }) =>
  input.chosen && isDayKey(input.chosen) ? input.chosen : defaultStartDate(input);

/**
 * The dates a work order has after joining a project. A finished one keeps them. A round's work order keeps its period, also
 * outside the project's frame: the period must cover the round's occurrences, and its dates are changed in the order, where
 * that is checked. Any other open job takes the chosen Klart senast, and its Start follows startOnProjectLink.
 */
export function datesOnProjectLink(job: { plannedStartDate?: string | null; dueDate: string; roundScheduleId?: string | null }, input: { open: boolean; chosenDue: string; today: string; frame: Partial<ProjectFrame> | null }): { dueDate: string; plannedStartDate?: string } {
  if (!input.open || job.roundScheduleId) return { dueDate: job.dueDate };
  const dueDate = input.chosenDue || job.dueDate;
  if (!job.plannedStartDate) return { dueDate, plannedStartDate: startForNewJob({ today: input.today, dueDate, frame: input.frame }) };
  return { dueDate, ...startOnProjectLink({ start: job.plannedStartDate, due: dueDate, frame: input.frame }) };
}

/** A job whose dates are owned elsewhere: a round's work order keeps its period (2026-11-01), a maintenance plan's its day. */
export const holdsOwnPeriod = (job: { roundScheduleId?: string | null; maintenancePlanId?: string | null }) => Boolean(job.roundScheduleId || job.maintenancePlanId);

/**
 * Flytta allt (decision 5; 2026-11-02: Start moves too): what a project's move by whole calendar days does to its jobs. Only
 * open jobs move, each with its whole bar: Start (an older job without one gets it, counted from its creation day) and Klart senast,
 * which stays empty when empty. A Start already after Klart senast is mended by startFollowingDue. `kept` holds the jobs that keep
 * their dates (holdsOwnPeriod and the tasks in such a work order); their bookings stay too. The same in Cloud, the demo and Local.
 */
export function projectShift<T extends { id: string; status: string; plannedStartDate?: string | null; dueDate: string; createdAt: string | Date; workOrderId?: string | null; roundScheduleId?: string | null; maintenancePlanId?: string | null }>(jobs: readonly T[], days: number) {
  const holders = new Set(jobs.filter(holdsOwnPeriod).map((job) => job.id));
  const kept = new Set(jobs.filter((job) => holders.has(job.id) || (job.workOrderId && holders.has(job.workOrderId))).map((job) => job.id));
  const moves = jobs.filter((job) => isTaskOpen(job.status) && !kept.has(job.id)).map((job) => {
    const dueDate = job.dueDate ? shiftDay(job.dueDate, days) : "";
    const start = shiftDay(effectiveStartDate({ plannedStartDate: job.plannedStartDate ?? "", createdAt: job.createdAt }), days);
    return { job, dueDate, plannedStartDate: startFollowingDue(start, dueDate).plannedStartDate ?? start };
  });
  return { moves, kept };
}

// ---------- Etapp ----------

/** The longest stage label; the input schema, the editor and the database column's use agree. */
export const STAGE_MAX_LENGTH = 60;

/** A stage label as it is stored: trimmed, inner whitespace collapsed, at most STAGE_MAX_LENGTH characters. */
export const normalizeStage = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim().slice(0, STAGE_MAX_LENGTH);

/** Two labels are the same stage when they differ only in case ("Fas 1" and "fas 1"). */
const stageKey = (value: string) => normalizeStage(value).toLocaleLowerCase("sv-SE");

/** The stages already used in a project, once each in the order they first appear – the editor's suggestions. */
export function stageSuggestions(jobs: readonly { stage?: string | null }[]): string[] {
  const seen = new Map<string, string>();
  for (const job of jobs) {
    const stage = normalizeStage(job.stage);
    if (stage && !seen.has(stageKey(stage))) seen.set(stageKey(stage), stage);
  }
  return [...seen.values()];
}

export const NO_STAGE_LABEL = "Utan etapp";

/** What the stage rules read of a job; the start is its own Start, or the day sent as `effectiveStart`, or its creation day. */
export type StageJob = { stage?: string | null; plannedStartDate?: string; effectiveStart?: string; dueDate?: string; status?: string; createdAt?: string | Date; completedDay?: string };
const jobStart = (job: StageJob) => job.plannedStartDate || job.effectiveStart || (job.createdAt !== undefined ? swedishDayKey(job.createdAt) : "");
export type StageGroup<T> = { /** "" = the jobs without a stage. */ stage: string; label: string; jobs: T[] };

/**
 * The jobs grouped by stage: the stages in order of their earliest Start, the jobs without one last under "Utan etapp" –
 * and only when some job has a stage; if none has, one group without a heading (the list looks as before).
 */
export function groupByStage<T extends StageJob>(jobs: readonly T[]): { grouped: boolean; groups: StageGroup<T>[] } {
  const startOf = (job: T) => jobStart(job) || "9999-12-31";
  const named = new Map<string, { label: string; jobs: T[] }>();
  const without: T[] = [];
  for (const job of jobs) {
    const stage = normalizeStage(job.stage);
    if (!stage) { without.push(job); continue; }
    const entry = named.get(stageKey(stage)) ?? { label: stage, jobs: [] };
    entry.jobs.push(job);
    named.set(stageKey(stage), entry);
  }
  if (!named.size) return { grouped: false, groups: [{ stage: "", label: "", jobs: [...jobs] }] };
  const earliest = (list: T[]) => list.reduce((day, job) => { const start = startOf(job); return start < day ? start : day; }, "9999-12-31");
  const groups: StageGroup<T>[] = [...named.values()]
    .sort((a, b) => earliest(a.jobs).localeCompare(earliest(b.jobs)) || a.label.localeCompare(b.label, "sv"))
    .map((entry) => ({ stage: entry.label, label: entry.label, jobs: entry.jobs }));
  if (without.length) groups.push({ stage: "", label: NO_STAGE_LABEL, jobs: without });
  return { grouped: true, groups };
}

export type StageSummary = {
  /** Earliest Start → latest Klart senast (or the latest end when a job has none); "" when no job has a date. */
  start: string; end: string;
  /** Completion in percent, weighted by Uppskattad tid as the project's (projectCompletion); Utgår left out. */
  progress: number; jobCount: number; doneCount: number;
};

/** The summary row of one stage: its period, weighted completion and "x av y jobb" (Utgår jobs are not counted). */
export function stageSummary(jobs: readonly (StageJob & { progress: number; estimatedMinutes?: number | null })[]): StageSummary {
  const counted = jobs.filter((job) => job.status !== "CANCELLED");
  let start = "", end = "";
  for (const job of counted) {
    const from = jobStart(job);
    const period = from ? jobPeriod({ plannedStartDate: from, dueDate: job.dueDate ?? "", status: job.status, completedDay: job.completedDay }) : null;
    const first = period?.start ?? "";
    // The stage's end is the latest Klart senast (a finished job's drawn bar may end earlier, but the plan was its date).
    const last = job.dueDate && job.dueDate >= first ? job.dueDate : period?.end ?? first;
    if (first && (!start || first < start)) start = first;
    if (last && last > end) end = last;
  }
  return {
    start, end,
    progress: projectCompletion(counted.map((job) => ({ status: job.status ?? "PLANNED", progress: job.progress, estimatedMinutes: job.estimatedMinutes }))),
    jobCount: counted.length,
    doneCount: counted.filter((job) => job.status === "COMPLETED").length,
  };
}
