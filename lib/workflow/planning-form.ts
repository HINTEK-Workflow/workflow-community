import { foldText } from "@/lib/search/normalize";
import { isTaskClosed } from "./task-cancel";
import { shortDay } from "./schedule";
import { swedishDayKey } from "@/lib/swedish-time";

/**
 * A job's dates in a few words (2026-11-02), in Att boka and under the booking's times: a lone date always says which it is, since
 * Klart senast is not where a job starts.
 */
export function jobPeriodLabel(job: { plannedStartDate?: string | null; dueDate?: string | null }) {
  const start = job.plannedStartDate || ""; const due = job.dueDate || "";
  if (start && due) return start === due ? shortDay(start) : `${shortDay(start)} – ${shortDay(due)}`;
  return due ? `Klart senast ${shortDay(due)}` : start ? `Start ${shortDay(start)}` : "";
}

/**
 * Ny planering (simulation 0.6.3): rules of the booking form, apart from React so they can be tested.
 */

const HOUR_MS = 3_600_000;

/**
 * Slut follows Start: moving the start moves the end by the same amount, so the booking keeps its length (the
 * simulation set Start to 12 Oct 07:00 and Slut stayed on 10 Oct 09:00). Without a length to keep – no valid pair yet –
 * an end that is missing or no longer after the start becomes one hour after it; a later end is left alone. Returns the
 * new end as epoch milliseconds, or null to leave the end as it is.
 */
export function endFollowingStart(previous: { start: number; end: number }, nextStart: number, rememberedLength: number | null = null): number | null {
  if (!Number.isFinite(nextStart)) return null;
  const length = Number.isFinite(previous.start) && Number.isFinite(previous.end) && previous.end > previous.start ? previous.end - previous.start : rememberedLength;
  if (length !== null && length > 0) return nextStart + length;
  if (!Number.isFinite(previous.end) || previous.end <= nextStart) return nextStart + HOUR_MS;
  return null;
}

export type PlanningJobOption = { id: string; label: string };
export type PlanningJobGroup = { label: string; options: PlanningJobOption[] };
type JobLike = { id: string; title: string; status: string; dueDate?: string | null; createdAt?: string | Date | null };

/** From how many jobs the list gets a search field above it. */
export const PLANNING_JOB_SEARCH_FROM = 9;

/**
 * The form's job list (simulation 0.6.3: about 200 jobs in no order, finished ones and duplicates among them, without a
 * search): open jobs only – the one already linked is always kept –, grouped by kind and sorted by title; two jobs with
 * the same title are told apart by Klart senast, else the day it was made, and a number when that is the same too (resa 4,
 * 2026-11-06: forty "Larm: TEMP_HIGH" alike); a search narrows the list by title (Swedish letters folded).
 */
export function planningJobGroups<T extends JobLike>(jobs: readonly T[], options: { kindLabel: (job: T) => string; selectedId?: string | null; query?: string }): PlanningJobGroup[] {
  const query = foldText(options.query ?? "").trim();
  const kept = jobs.filter((job) => job.id === options.selectedId || (!isTaskClosed(job.status) && (!query || foldText(job.title).includes(query))));
  const titleCount = new Map<string, number>();
  for (const job of kept) titleCount.set(foldText(job.title.trim()), (titleCount.get(foldText(job.title.trim())) ?? 0) + 1);
  const groups = new Map<string, PlanningJobOption[]>();
  const sorted = [...kept].sort((left, right) => (left.title || "").localeCompare(right.title || "", "sv") || (left.dueDate ?? "").localeCompare(right.dueDate ?? "") || String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")));
  const made = (job: T) => { const value = job.createdAt ? new Date(job.createdAt) : null; return value && !Number.isNaN(value.getTime()) ? swedishDayKey(value) : ""; };
  const told = (job: T) => job.dueDate ? `Klart senast ${shortDay(job.dueDate)}` : made(job) ? `skapad ${shortDay(made(job))}` : "";
  // Twins with the same Klart senast (or day made) also get a number, in the list's order.
  const seen = new Map<string, number>();
  const sameTold = new Map<string, number>();
  for (const job of sorted) if ((titleCount.get(foldText(job.title.trim())) ?? 0) > 1) sameTold.set(foldText(job.title.trim()) + "|" + told(job), (sameTold.get(foldText(job.title.trim()) + "|" + told(job)) ?? 0) + 1);
  for (const job of sorted) {
    const kind = options.kindLabel(job);
    const twin = (titleCount.get(foldText(job.title.trim())) ?? 0) > 1;
    const key = foldText(job.title.trim()) + "|" + told(job);
    const number = twin && (sameTold.get(key) ?? 0) > 1 ? (seen.get(key) ?? 0) + 1 : 0;
    if (number) seen.set(key, number);
    const apart = twin ? [told(job), number ? `nr ${number}` : ""].filter(Boolean).join(" ") : "";
    const label = `${job.title.trim() || "Utan rubrik"}${apart ? ` · ${apart}` : ""}${isTaskClosed(job.status) ? (job.status === "COMPLETED" ? " (färdigställd)" : " (utgår)") : ""}`;
    groups.set(kind, [...(groups.get(kind) ?? []), { id: job.id, label }]);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right, "sv")).map(([label, list]) => ({ label, options: list }));
}

/** What a job gives the form. */
export type JobFillJob = { title: string; assignedToUserId?: string | null; plannedStartDate?: string | null; createdAt?: string | Date | null };
/** What the person has changed by hand: never overwritten. */
export type JobFillTouched = { people: boolean; start: boolean };

/**
 * Boka från jobbet (2026-11-02): the day a booking of the job starts: the job's Start when it is today or later, otherwise
 * today (a booking is not made in the past). A job without a stored Start counts from the day it was made, so it also gets today.
 */
export function jobStartDay(job: Pick<JobFillJob, "plannedStartDate">, today: string) {
  return job.plannedStartDate && job.plannedStartDate >= today ? job.plannedStartDate : today;
}

/**
 * The person a booking of the job is for: the job's responsible when among the people that can be chosen. Someone who may not book
 * others gets themself, since the server would refuse anyone else (canChangeOthersBookings).
 */
export function jobPeople(job: Pick<JobFillJob, "assignedToUserId">, input: { memberIds: readonly string[]; selfId: string; mayBookOthers: boolean;
  /** The people picked in Tilldela (`bookPeople`, 2026-11-07): ticked when the person may book others, otherwise not. */
  chosen?: readonly string[] }) {
  const picked = input.mayBookOthers ? (input.chosen ?? []).filter((id) => input.memberIds.includes(id)) : [];
  if (picked.length) return [...new Set(picked)];
  const person = input.mayBookOthers ? job.assignedToUserId : input.selfId;
  return person && input.memberIds.includes(person) ? [person] : [];
}

const jobName = (job: Pick<JobFillJob, "title">) => job.title.slice(0, 200);

/**
 * Picking a job in the form fills in what the job knows, and what the person typed wins (2026-11-02): Namn when empty or still
 * the previous job's title; Bokad personal unless the person ticked or unticked anyone; the day unless the person changed Start or the
 * form was opened from a day (`dayChosen`). Only what should change is returned. A new booking only; an existing one is never filled.
 */
export function jobFill(job: JobFillJob, input: {
  previous?: Pick<JobFillJob, "title"> | null;
  title: string;
  touched: JobFillTouched;
  dayChosen?: boolean;
  memberIds: readonly string[];
  selfId: string;
  mayBookOthers: boolean;
  today: string;
}) {
  const fill: { title?: string; assignedToUserIds?: string[]; startDay?: string } = {};
  if (!input.title.trim() || (input.previous && input.title === jobName(input.previous))) fill.title = jobName(job);
  if (!input.touched.people) fill.assignedToUserIds = jobPeople(job, input);
  if (!input.touched.start && !input.dayChosen) fill.startDay = jobStartDay(job, input.today);
  return fill;
}
