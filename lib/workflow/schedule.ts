import { z } from "zod";
import { addSwedishDays, swedishDayKey } from "@/lib/swedish-time";
import { hasProjectFrame, type ProjectFrame } from "./project-frame";

/**
 * Tidplan (Gantt v1, 2026-10-09; docs/proposals/projekt-forbattring-2026-10-09.md 6.4): the pure date and geometry
 * rules behind the project's time plan – Swedish workdays and public holidays (Easter rule), moving a job in whole
 * workdays, lateness, the period's checks against the project's frame, the consequences of a move, the time axis and
 * the phone's list by week. Shared by the server, the demo and the page. Days are Swedish calendar days, "YYYY-MM-DD".
 *
 * A job's period is Start (plannedStartDate) → Klart senast (dueDate); "Klart senast" is the period's end (decision 2).
 */

const DAY_MS = 86_400_000;
export const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const toIndex = (day: string) => Math.floor(Date.parse(`${day}T12:00:00Z`) / DAY_MS);
const fromIndex = (index: number) => new Date(index * DAY_MS).toISOString().slice(0, 10);
export const isDayKey = (value: string) => DAY_KEY.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) && fromIndex(toIndex(value)) === value;

/** A day moved by whole calendar days. */
export const addDays = (day: string, days: number) => fromIndex(toIndex(day) + days);
/** Calendar days from `from` to `to` (negative when `to` is earlier). */
export const daysBetween = (from: string, to: string) => toIndex(to) - toIndex(from);
/** 0 = Monday … 6 = Sunday. */
export const weekdayOf = (day: string) => (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
export const mondayOf = (day: string) => addDays(day, -weekdayOf(day));

/** Easter Sunday of a year (the Gregorian computus, "Meeus/Jones/Butcher"). */
export function easterSunday(year: number) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const holidayCache = new Map<number, Map<string, string>>();
/**
 * Swedish public holidays and the eves that are ordinarily days off (midsommarafton, julafton, nyårsafton), by day.
 * Weekend holidays are included too, so their names can be shown.
 */
export function swedishHolidays(year: number): Map<string, string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const easter = easterSunday(year);
  const firstIn = (from: string, weekday: number) => { let day = from; while (weekdayOf(day) !== weekday) day = addDays(day, 1); return day; };
  const midsummerEve = firstIn(`${year}-06-19`, 4);
  const entries: [string, string][] = [
    [`${year}-01-01`, "Nyårsdagen"], [`${year}-01-06`, "Trettondedag jul"],
    [addDays(easter, -2), "Långfredagen"], [easter, "Påskdagen"], [addDays(easter, 1), "Annandag påsk"],
    [`${year}-05-01`, "Första maj"], [addDays(easter, 39), "Kristi himmelsfärdsdag"], [addDays(easter, 49), "Pingstdagen"],
    [`${year}-06-06`, "Sveriges nationaldag"], [midsummerEve, "Midsommarafton"], [addDays(midsummerEve, 1), "Midsommardagen"],
    [firstIn(`${year}-10-31`, 5), "Alla helgons dag"],
    [`${year}-12-24`, "Julafton"], [`${year}-12-25`, "Juldagen"], [`${year}-12-26`, "Annandag jul"], [`${year}-12-31`, "Nyårsafton"],
  ];
  const map = new Map(entries);
  holidayCache.set(year, map);
  return map;
}
export const holidayName = (day: string) => swedishHolidays(Number(day.slice(0, 4))).get(day) ?? "";
/** A workday: Monday–Friday and not a holiday or one of the eves that are days off. */
export const isWorkday = (day: string) => weekdayOf(day) < 5 && !holidayName(day);

/**
 * Signed workdays from `from` to `to`: the workdays in (from, to] when `to` is later, minus those in [to, from) when it
 * is earlier – so `shiftWorkdays(from, workdayOffset(from, to))` is `to` whenever `to` is a workday.
 */
export function workdayOffset(from: string, to: string) {
  if (to === from) return 0;
  return to > from ? workdaysIn(addDays(from, 1), to) : -workdaysIn(to, addDays(from, -1));
}
/** Workdays from `from` to `to`, both included. */
export function workdaysIn(from: string, to: string) {
  if (to < from) return 0;
  let count = 0;
  for (let day = from; day <= to; day = addDays(day, 1)) if (isWorkday(day)) count += 1;
  return count;
}
/** A day moved by whole workdays: `n` workdays later (or earlier when negative), landing on a workday. */
export function shiftWorkdays(day: string, n: number) {
  if (!n) return day;
  const step = n > 0 ? 1 : -1;
  let left = Math.abs(n);
  let current = day;
  while (left > 0) { current = addDays(current, step); if (isWorkday(current)) left -= 1; }
  return current;
}
/** The nearest workday in a direction (the day itself when it is one). */
export function snapToWorkday(day: string, direction: 1 | -1) {
  let current = day;
  for (let guard = 0; guard < 30 && !isWorkday(current); guard += 1) current = addDays(current, direction);
  return current;
}

/**
 * A job's period. `effectiveStart` (Start for all jobs, plan 1M): the day an older job without a stored Start counts from –
 * the day it was created (lib/workflow/job-planning.ts effectiveStartDate); sent by the server, never stored.
 */
export type SchedulePeriod = { plannedStartDate: string; dueDate: string; effectiveStart?: string };
export type ScheduleJob = SchedulePeriod & {
  id: string; title: string; kind: string; status: string; progress: number; workOrderId?: string | null;
  /** Etapp (plan 1M): the job's stage label, "" = none. */
  stage?: string;
  /** Hinder (plan 1M): what the job waits for, while an obstacle is reported (lib/workflow/obstacles.ts). */
  obstacle?: { reason: string; text: string; since: string } | null;
  /** The Swedish day a finished job was finished (YYYY-MM-DD); its bar ends there, not at Klart senast. */
  completedDay?: string;
  estimatedMinutes: number | null; assignedToName?: string; version?: number; canEdit?: boolean;
  /** Börjar efter (steg 4): the jobs in the same project this one starts after (finish-to-start). */
  predecessorIds?: string[];
};

/**
 * The job's drawn period: Start → Klart senast, or the start day alone without an end; null only when there is no start at
 * all (every job has one since plan 1M: its own, or the day it was created). A finished job ends the day it was finished
 * (simulation 0.6.3: a job done on 10 Oct was drawn to its Klart senast 9 Nov).
 */
export function jobPeriod(job: SchedulePeriod & { status?: string; completedDay?: string | null }): { start: string; end: string } | null {
  const start = job.plannedStartDate || job.effectiveStart || "";
  if (!start) return null;
  if (job.status === "COMPLETED" && job.completedDay && isDayKey(job.completedDay)) return { start, end: job.completedDay < start ? start : job.completedDay };
  return { start, end: job.dueDate && job.dueDate >= start ? job.dueDate : start };
}

/**
 * The rows of the time plan's diagram: the jobs with a start day – all of them since plan 1M. The few without one (an
 * older record without a creation day) are listed once, under Utan datum.
 */
export function datedJobs<T extends SchedulePeriod>(jobs: readonly T[]): { dated: T[]; undated: T[] } {
  const dated: T[] = [], undated: T[] = [];
  for (const job of jobs) (jobPeriod(job) ? dated : undated).push(job);
  return { dated, undated };
}

const FINISHED = new Set(["COMPLETED", "CANCELLED"]);
/** The unfinished jobs without Klart senast: drawn as their start day only, so the plan says so under Utan datum. */
export const jobsWithoutDue = <T extends { dueDate: string; status: string }>(jobs: readonly T[]): T[] => jobs.filter((job) => !job.dueDate && !FINISHED.has(job.status));

/** Workdays the job is late: not finished and Klart senast passed (at least 1 once the day has passed). */
export function lateWorkdays(job: { status: string; dueDate: string }, today: string) {
  if (FINISHED.has(job.status) || !job.dueDate || job.dueDate >= today) return 0;
  return Math.max(1, workdaysIn(addDays(job.dueDate, 1), today));
}

export type ScheduleState = "planned" | "active" | "blocked" | "late" | "done" | "cancelled";
export const SCHEDULE_STATE_LABELS: Record<ScheduleState, string> = {
  planned: "Planerad", active: "Pågår", blocked: "Hinder", late: "Förfallen", done: "Färdigställd", cancelled: "Utgår",
};
export function scheduleState(job: { status: string; dueDate: string }, today: string): ScheduleState {
  if (job.status === "CANCELLED") return "cancelled";
  if (job.status === "COMPLETED") return "done";
  if (lateWorkdays(job, today)) return "late";
  if (job.status === "NEEDS_ACTION") return "blocked";
  if (job.status === "IN_PROGRESS" || job.status === "PAUSED") return "active";
  return "planned";
}

/**
 * The checks of a new period: valid days, Start on or before Klart senast, and both inside the project's frame. `frame`
 * is true when the only problem is the frame, which a project manager or administrator may override with a reason.
 */
export function schedulePeriodError(period: SchedulePeriod, frame: Partial<ProjectFrame> | null | undefined): { message: string; frame: boolean } | null {
  for (const [day, label] of [[period.plannedStartDate, "Start"], [period.dueDate, "Klart senast"]] as const)
    if (day && !isDayKey(day)) return { message: `${label} är inte ett giltigt datum.`, frame: false };
  if (period.plannedStartDate && period.dueDate && period.plannedStartDate > period.dueDate)
    return { message: "Start måste vara före eller samma dag som Klart senast.", frame: false };
  if (hasProjectFrame(frame)) {
    const outside = [[period.plannedStartDate, "Start"], [period.dueDate, "Klart senast"]].filter(([day]) => day && (day < frame.startDate || day > frame.dueDate)).map(([, label]) => label);
    if (outside.length) return { message: `${outside.join(" och ")} måste ligga inom projektets tidsram (${frame.startDate}–${frame.dueDate}).`, frame: true };
  }
  return null;
}

/** Moving the whole bar by a dragged number of calendar days: in whole workdays, keeping the length in workdays. */
export function movePeriod(period: SchedulePeriod, calendarDays: number): SchedulePeriod {
  const drawn = jobPeriod(period);
  if (!drawn || !calendarDays) return period;
  const direction = calendarDays > 0 ? 1 : -1;
  const target = snapToWorkday(addDays(drawn.start, calendarDays), direction);
  const n = workdayOffset(drawn.start, target);
  if (!n) return period;
  return { plannedStartDate: shiftWorkdays(drawn.start, n), dueDate: period.dueDate ? shiftWorkdays(drawn.end, n) : "" };
}
/** Dragging the bar's end: only Klart senast changes, onto a workday and never before Start. */
export function resizePeriodEnd(period: SchedulePeriod, calendarDays: number): SchedulePeriod {
  const drawn = jobPeriod(period);
  if (!drawn || !calendarDays) return period;
  const target = snapToWorkday(addDays(drawn.end, calendarDays), calendarDays > 0 ? 1 : -1);
  return { ...period, dueDate: target < drawn.start ? drawn.start : target };
}

/**
 * A booking as the time plan draws it. `canMove` (sent by the server for the job's own bookings): whether this person may
 * move it with the job ("Flytta även bokningarna"); a booking that is Genomförd is never moved.
 */
export type ScheduleBooking = { id: string; taskId: string | null; title: string; kind: string; startDay: string; endDay: string; people: string; status?: string; canMove?: boolean };
export type MoveConsequences = { bookingsOutside: ScheduleBooking[]; passesProjectEnd: boolean; beforeProjectStart: boolean; milestonesPassed: ScheduleBooking[] };
/** What a new period means before it is saved: the job's bookings left outside it, the project's frame and milestones passed. */
export function moveConsequences(job: { id: string }, next: SchedulePeriod, bookings: readonly ScheduleBooking[], project: Partial<ProjectFrame>, previous?: SchedulePeriod): MoveConsequences {
  const period = jobPeriod(next);
  const own = bookings.filter((booking) => booking.taskId === job.id && booking.kind !== "DEADLINE");
  const before = previous ? jobPeriod(previous) : null;
  return {
    bookingsOutside: period ? own.filter((booking) => booking.startDay < period.start || booking.endDay > period.end) : [],
    passesProjectEnd: Boolean(period && project.dueDate && period.end > project.dueDate),
    beforeProjectStart: Boolean(period && project.startDate && period.start < project.startDate),
    milestonesPassed: period ? bookings.filter((booking) => booking.kind === "DEADLINE" && booking.startDay < period.end && !(before && booking.startDay < before.end)) : [],
  };
}

export type ScheduleZoom = "week" | "month";
/** Pixels per day: the week scale shows days, the month scale weeks. */
export const DAY_WIDTH: Record<ScheduleZoom, number> = { week: 36, month: 12 };
/** The width of a day when the days should fill `room` pixels: never narrower than the scale's own, rounded down so no scroll bar appears. */
export const fittedDayWidth = (zoom: ScheduleZoom, days: number, room: number) => Math.max(DAY_WIDTH[zoom], days > 0 ? Math.floor((room / days) * 100) / 100 : 0);
const MIN_DAYS: Record<ScheduleZoom, number> = { week: 28, month: 84 };
const MAX_DAYS = 730;

/** The time axis: from the Monday before the earliest of frame, jobs and today to the Sunday after the latest. */
export function scheduleRange(input: { frame?: Partial<ProjectFrame> | null; jobs: readonly (SchedulePeriod & { status?: string; completedDay?: string | null })[]; today: string; zoom: ScheduleZoom }) {
  const days = [input.today, input.frame?.startDate, input.frame?.dueDate, ...input.jobs.flatMap((job) => { const period = jobPeriod(job); return period ? [period.start, period.end] : []; })]
    .filter((day): day is string => Boolean(day && isDayKey(day))).sort();
  let from = mondayOf(addDays(days[0], -3));
  let to = addDays(mondayOf(addDays(days[days.length - 1], 3)), 6);
  if (daysBetween(from, to) + 1 < MIN_DAYS[input.zoom]) to = addDays(from, MIN_DAYS[input.zoom] - 1);
  if (daysBetween(from, to) + 1 > MAX_DAYS) { from = mondayOf(addDays(input.today, -MAX_DAYS / 2)); to = addDays(from, MAX_DAYS - 1); }
  return { from, to, days: daysBetween(from, to) + 1 };
}

/** A bar's left edge and width in pixels on the axis; clipped to the axis, null when wholly outside. */
export function barGeometry(range: { from: string; days: number }, start: string, end: string, dayWidth: number) {
  const first = Math.max(0, daysBetween(range.from, start));
  const last = Math.min(range.days - 1, daysBetween(range.from, end));
  if (last < 0 || first > range.days - 1 || last < first) return null;
  return { left: first * dayWidth, width: (last - first + 1) * dayWidth };
}

const MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
/** ISO week number of a day. */
export function isoWeek(day: string) {
  const thursday = addDays(day, 3 - weekdayOf(day));
  const firstThursday = addDays(`${thursday.slice(0, 4)}-01-04`, 3 - weekdayOf(`${thursday.slice(0, 4)}-01-04`));
  return Math.floor(daysBetween(firstThursday, thursday) / 7) + 1;
}
export const shortDay = (day: string) => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;

export type AxisGroup = { label: string; offset: number; span: number };
export type AxisCell = { key: string; label: string; offset: number; span: number; off: boolean; title: string };
/**
 * The axis header: on the week scale weeks above and days below; on the month scale months above and weeks below.
 * Offsets and spans are in days. `offDays` are the non-working days to tone down.
 */
export function scheduleAxis(range: { from: string; days: number }, zoom: ScheduleZoom) {
  const groups: AxisGroup[] = [];
  const cells: AxisCell[] = [];
  const offDays: { offset: number; title: string }[] = [];
  const push = (label: string, offset: number) => { const last = groups[groups.length - 1]; if (last && last.label === label) last.span += 1; else groups.push({ label, offset, span: 1 }); };
  for (let offset = 0; offset < range.days; offset += 1) {
    const day = addDays(range.from, offset);
    const holiday = holidayName(day);
    if (!isWorkday(day)) offDays.push({ offset, title: holiday || (weekdayOf(day) === 5 ? "Lördag" : "Söndag") });
    if (zoom === "week") {
      push(`v. ${isoWeek(day)}`, offset);
      cells.push({ key: day, label: String(Number(day.slice(8, 10))), offset, span: 1, off: !isWorkday(day), title: [shortDay(day), holiday].filter(Boolean).join(" · ") });
    } else {
      push(`${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`, offset);
      if (weekdayOf(day) === 0) cells.push({ key: day, label: `v. ${isoWeek(day)}`, offset, span: Math.min(7, range.days - offset), off: false, title: `Vecka ${isoWeek(day)}, från ${shortDay(day)}` });
    }
  }
  return { groups, cells, offDays };
}

/** The month or week over a stretch of the axis, as much of it as fits: "sep 2026", then "sep", then nothing (2026-11-02). */
export function axisGroupLabel(label: string, width: number) {
  const room = width - 12; // The cell's padding.
  const fits = (text: string) => text.length * 7 <= room;
  if (fits(label)) return label;
  const short = label.replace(/ [0-9]{4}$/, "");
  return short !== label && fits(short) ? short : "";
}

export type WeekGroup<T> = { monday: string; label: string; jobs: T[] };
/**
 * The phone's time plan (390 px): the dated jobs grouped by the week they start, earliest first; a job that started in
 * an earlier week and is still running is listed under the current week, so "Denna vecka" shows all ongoing work.
 */
export function jobsByWeek<T extends ScheduleJob>(jobs: readonly T[], today: string): { weeks: WeekGroup<T>[]; undated: T[] } {
  const thisMonday = mondayOf(today);
  const weeks = new Map<string, T[]>();
  const undated: T[] = [];
  for (const job of jobs) {
    const period = jobPeriod(job);
    if (!period) { undated.push(job); continue; }
    const ongoing = period.start < thisMonday && period.end >= thisMonday && !FINISHED.has(job.status);
    const monday = ongoing ? thisMonday : mondayOf(period.start);
    weeks.set(monday, [...(weeks.get(monday) ?? []), job]);
  }
  const label = (monday: string) => `${monday === thisMonday ? "Denna vecka · " : ""}Vecka ${isoWeek(monday)} (${shortDay(monday)}–${shortDay(addDays(monday, 6))})`;
  return {
    weeks: [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([monday, items]) => ({ monday, label: label(monday), jobs: [...items].sort((a, b) => (jobPeriod(a)?.start ?? "").localeCompare(jobPeriod(b)?.start ?? "")) })),
    undated,
  };
}

/** "Uppskattad tid" in hours, as the form asks (0.5 h steps are enough); null when not set. */
export const minutesFromHours = (hours: string) => {
  const value = Number(hours.replace(",", "."));
  return hours.trim() === "" || !Number.isFinite(value) || value < 0 ? null : Math.round(value * 60);
};
export const hoursText = (minutes: number | null | undefined) => minutes === null || minutes === undefined ? "" : `${Math.round((minutes / 60) * 10) / 10}`.replace(".", ",");

/** A booking (PlannedActivity) as the time plan draws it: its first and last Swedish day; ending at midnight belongs to the day before. */
export function scheduleBookingOf(activity: { id: string; workflowTaskId: string | null; title: string; kind: string; startsAt: string | Date; endsAt: string | Date; assignedToName: string }): ScheduleBooking {
  const startDay = swedishDayKey(activity.startsAt);
  const lastDay = swedishDayKey(new Date(new Date(activity.endsAt).getTime() - 1));
  return { id: activity.id, taskId: activity.workflowTaskId, title: activity.title, kind: activity.kind, startDay, endDay: lastDay < startDay ? startDay : lastDay, people: activity.assignedToName };
}

/** The project history's line for a changed time plan. */
export function scheduleChangeSummary(title: string, next: SchedulePeriod & { estimatedMinutes: number | null }) {
  const parts = [next.plannedStartDate ? `start ${next.plannedStartDate}` : "utan start", next.dueDate ? `klart senast ${next.dueDate}` : "utan Klart senast"];
  if (next.estimatedMinutes !== null) parts.push(`uppskattat ${hoursText(next.estimatedMinutes)} h`);
  return `Tidplanen för ${title || "jobbet"} ändrades: ${parts.join(", ")}`;
}

/** The time plan's change of one job (server, demo): Start, Klart senast, Uppskattad tid and, outside the frame, a reason. */
export const scheduleInputSchema = z.object({
  taskId: z.string().min(1).max(100),
  version: z.number().int().positive(),
  plannedStartDate: z.string().max(10).refine((value) => value === "" || isDayKey(value), "Start är inte ett giltigt datum."),
  dueDate: z.string().max(10).refine((value) => value === "" || isDayKey(value), "Klart senast är inte ett giltigt datum."),
  estimatedMinutes: z.number().int().min(0).max(600_000).nullable(),
  frameExceptionReason: z.string().trim().max(500).optional(),
  /** "Flytta även bokningarna": the job's bookings move as many workdays as its Start (all or none, server-checked). */
  moveBookings: z.boolean().optional(),
  /** "Flytta efterföljande jobb" (plan 1M): the jobs that start after this one (in a chain) move as many workdays as it does. */
  moveFollowers: z.boolean().optional(),
  /** Börjar efter (steg 4): the job's predecessors in the same project; left out = unchanged. */
  predecessorIds: z.array(z.string().min(1).max(100)).max(20).optional(),
});
export type ScheduleInput = z.infer<typeof scheduleInputSchema>;

// ---------- The job's own fields (steg 2), bookings moved with the job and Börjar efter (steg 4) ----------

/** The largest estimate a job takes: 10 000 hours, as the database's check. */
export const MAX_ESTIMATED_MINUTES = 600_000;

/**
 * Start and Uppskattad tid saved with the job itself (the editor, API v1 and MCP – the normal save; Cloud, Local and the
 * demo): a valid estimate, Start on or before Klart senast, and a new or changed Start inside the project's frame. Klart
 * senast keeps its own frame check (taskDueDateError). An exception from the frame, with a reason, is made in the
 * project's Tidplan. Unchanged older values are left as they are (decision 15). Returns the message or null.
 */
export function taskScheduleError(
  next: { plannedStartDate?: string; dueDate: string; estimatedMinutes?: number | null; projectId?: string | null },
  previous: { plannedStartDate?: string | null; dueDate?: string; projectId?: string | null } | null | undefined,
  frame: Partial<ProjectFrame> | null | undefined,
): string | null {
  const minutes = next.estimatedMinutes;
  if (minutes !== undefined && minutes !== null && (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_ESTIMATED_MINUTES))
    return "Uppskattad tid måste vara mellan 0 och 10 000 timmar.";
  const start = next.plannedStartDate ?? previous?.plannedStartDate ?? "";
  if (start && !isDayKey(start)) return "Start är inte ett giltigt datum.";
  const startChanged = !previous || (previous.plannedStartDate ?? "") !== start || (previous.projectId ?? null) !== (next.projectId ?? null);
  const periodChanged = startChanged || (previous?.dueDate ?? "") !== next.dueDate;
  if (periodChanged && start && next.dueDate && start > next.dueDate) return "Start måste vara före eller samma dag som Klart senast.";
  if (startChanged && start && hasProjectFrame(frame) && (start < frame.startDate || start > frame.dueDate))
    return `Start måste ligga inom projektets tidsram (${frame.startDate}–${frame.dueDate}). Ett undantag med motivering görs i projektets Tidplan.`;
  return null;
}

/** How many workdays the job's bookings move with it: Start's move in workdays (0 without a Start before and after). */
export function bookingShiftWorkdays(previous: Pick<SchedulePeriod, "plannedStartDate" | "effectiveStart">, next: Pick<SchedulePeriod, "plannedStartDate">) {
  const from = previous.plannedStartDate || previous.effectiveStart || "";
  if (!from || !next.plannedStartDate) return 0;
  return workdayOffset(from, next.plannedStartDate);
}

/**
 * A booking's times moved by whole workdays: its first and its last Swedish day each move `n` workdays and the clock
 * times stay (summer and winter time included). An end at midnight belongs to the day before, as everywhere in planning.
 */
export function shiftBookingTimes(times: { startsAt: string | Date; endsAt: string | Date }, n: number): { startsAt: Date; endsAt: Date } {
  const startsAt = new Date(times.startsAt);
  const endsAt = new Date(times.endsAt);
  if (!n) return { startsAt, endsAt };
  const startDay = swedishDayKey(startsAt);
  const lastDay = swedishDayKey(new Date(endsAt.getTime() - 1));
  const startDays = daysBetween(startDay, shiftWorkdays(startDay, n));
  const endDays = daysBetween(lastDay, shiftWorkdays(lastDay, n));
  const movedStart = addSwedishDays(startsAt, startDays);
  const movedEnd = addSwedishDays(endsAt, endDays);
  // A booking that would turn around keeps its length from the moved start.
  return movedEnd > movedStart ? { startsAt: movedStart, endsAt: movedEnd } : { startsAt: movedStart, endsAt: addSwedishDays(endsAt, startDays) };
}

/** The job's bookings that "Flytta även bokningarna" moves: not milestones, not Genomförd or Inställd. */
export const movableBooking = (booking: { kind: string; status?: string }) => booking.kind !== "DEADLINE" && booking.status !== "COMPLETED" && booking.status !== "CANCELED";

/** One booking for messages: "Anna 14 okt" or "Anna 14 okt–16 okt". */
export const bookingText = (booking: Pick<ScheduleBooking, "people" | "title" | "startDay" | "endDay">) =>
  `${booking.people || booking.title} ${booking.startDay === booking.endDay ? shortDay(booking.startDay) : `${shortDay(booking.startDay)}–${shortDay(booking.endDay)}`}`;

/** The refusal of a move with its bookings when this person may not move some of them: the whole move is refused. */
export function bookingMoveRefusal(blocked: readonly Pick<ScheduleBooking, "people" | "title" | "startDay" | "endDay">[]) {
  if (!blocked.length) return null;
  return `Bokningarna kan inte flyttas med: ${blocked.map(bookingText).join(", ")}. Andras bokningar flyttas bara av projektansvarig, projektets ställföreträdare eller en företagsadministratör. Välj Flytta bara jobbet, eller be någon av dem flytta bokningarna.`;
}

/** At most this many predecessors per job ("Börjar efter"); the input schema and the database say the same. */
export const MAX_PREDECESSORS = 20;

/**
 * Börjar efter (steg 4, finish-to-start): the checks of a job's predecessors – jobs of the same project (the list given is
 * the project's jobs within the company), never the job itself, and no circle through the other jobs' predecessors.
 */
export function predecessorError(jobId: string, predecessorIds: readonly string[], projectJobs: readonly { id: string; predecessorIds?: readonly string[] | null }[]): string | null {
  const byId = new Map(projectJobs.map((job) => [job.id, job]));
  if (new Set(predecessorIds).size !== predecessorIds.length) return "Samma jobb står två gånger under Börjar efter.";
  if (predecessorIds.length > MAX_PREDECESSORS) return `Ett jobb kan börja efter högst ${MAX_PREDECESSORS} andra jobb.`;
  if (predecessorIds.includes(jobId)) return "Ett jobb kan inte börja efter sig självt.";
  if (predecessorIds.some((id) => !byId.has(id))) return "Börjar efter kan bara peka på jobb i samma projekt.";
  // A circle: one of the predecessors (or one of theirs) already starts after this job.
  const seen = new Set<string>();
  const stack = [...predecessorIds];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === jobId) return "Börjar efter skulle ge en cirkel: ett av jobben börjar redan efter det här jobbet.";
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(byId.get(id)?.predecessorIds ?? []));
  }
  return null;
}

export type DependencyJob = SchedulePeriod & { id: string; title: string; status: string; predecessorIds?: readonly string[] | null };
export type DependencyConflict = { jobId: string; predecessorId: string; predecessorTitle: string; predecessorEnd: string };
/**
 * The jobs that start before a predecessor is done – on or before its Klart senast (finish-to-start). A warning only,
 * never a block; a finished or cancelled job neither holds anything up nor is held up.
 */
export function dependencyConflicts(jobs: readonly DependencyJob[]): DependencyConflict[] {
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const conflicts: DependencyConflict[] = [];
  for (const job of jobs) {
    const period = jobPeriod(job);
    if (!period || FINISHED.has(job.status)) continue;
    for (const id of job.predecessorIds ?? []) {
      const before = byId.get(id);
      const end = before && !FINISHED.has(before.status) ? jobPeriod(before)?.end ?? before.dueDate : "";
      if (before && end && period.start <= end) conflicts.push({ jobId: job.id, predecessorId: id, predecessorTitle: before.title, predecessorEnd: end });
    }
  }
  return conflicts;
}

/** "Påverkas av försening": the unfinished jobs with a late predecessor (not finished after its Klart senast). */
export function delayedByPredecessor(jobs: readonly DependencyJob[], today: string): Set<string> {
  const late = new Set(jobs.filter((job) => lateWorkdays(job, today)).map((job) => job.id));
  return new Set(jobs.filter((job) => !FINISHED.has(job.status) && (job.predecessorIds ?? []).some((id) => late.has(id))).map((job) => job.id));
}

// ---------- Flytta efterföljande (plan 1M) ----------

/**
 * The jobs that start after `jobId` (Börjar efter, finish-to-start), directly and in a chain – the ones "Flytta efterföljande
 * jobb" moves. Finished and cancelled jobs are not moved (the chain goes on past them). Each job once, nearest first; a circle (refused on save anyway) cannot loop.
 */
export function followingJobIds(jobId: string, jobs: readonly { id: string; status: string; predecessorIds?: readonly string[] | null }[]): string[] {
  const found: string[] = [];
  const seen = new Set<string>([jobId]);
  let frontier = [jobId];
  while (frontier.length) {
    const next: string[] = [];
    for (const job of jobs) {
      if (seen.has(job.id) || !(job.predecessorIds ?? []).some((id) => frontier.includes(id))) continue;
      seen.add(job.id);
      next.push(job.id);
      if (!FINISHED.has(job.status)) found.push(job.id);
    }
    frontier = next;
  }
  return found;
}

/**
 * How many workdays a changed period moves the jobs after it: Start's move, or – when only Klart senast changed – its move.
 * 0 when nothing moved or the dates needed are missing.
 */
export function followerShiftWorkdays(previous: SchedulePeriod, next: SchedulePeriod): number {
  const from = previous.plannedStartDate || previous.effectiveStart || "";
  if (from && next.plannedStartDate && next.plannedStartDate !== from) return workdayOffset(from, next.plannedStartDate);
  if (previous.dueDate && next.dueDate && previous.dueDate !== next.dueDate) return workdayOffset(previous.dueDate, next.dueDate);
  return 0;
}

/** A following job's period moved `n` workdays: Start and Klart senast each move, so its length in workdays stays. */
export function shiftJobPeriod(job: SchedulePeriod, n: number): SchedulePeriod {
  const drawn = jobPeriod(job);
  if (!drawn || !n) return { plannedStartDate: job.plannedStartDate, dueDate: job.dueDate };
  return { plannedStartDate: shiftWorkdays(drawn.start, n), dueDate: job.dueDate ? shiftWorkdays(job.dueDate >= drawn.start ? job.dueDate : drawn.end, n) : "" };
}

/** What "Flytta efterföljande jobb" would do: each following job's old and new period. */
export function followerMoves<T extends SchedulePeriod & { id: string; status: string; predecessorIds?: readonly string[] | null }>(job: { id: string }, previous: SchedulePeriod, next: SchedulePeriod, jobs: readonly T[]): { job: T; from: SchedulePeriod; to: SchedulePeriod }[] {
  const n = followerShiftWorkdays(previous, next);
  if (!n) return [];
  const byId = new Map(jobs.map((item) => [item.id, item]));
  return followingJobIds(job.id, jobs).flatMap((id) => {
    const item = byId.get(id);
    return item ? [{ job: item, from: item, to: shiftJobPeriod(item, n) }] : [];
  });
}

export type FollowerPlan<T> = {
  /** The following jobs and their new periods, nearest first. */
  moves: { job: T; from: SchedulePeriod; to: SchedulePeriod }[];
  /** Following jobs this person may not change: the whole move is refused (all or none). */
  locked: T[];
  /** A move that is wrong whatever the frame says (a new Start after Klart senast): the message. */
  invalid: string | null;
  /** The moves that would end outside the project's frame – they need the same exception with a reason as the job itself. */
  outsideFrame: { job: T; to: SchedulePeriod }[];
};
/**
 * "Flytta efterföljande jobb" (plan 1M), the one rule for the server, the demo and the dialog: the jobs after `jobId` move as
 * many workdays as the job did, with the same checks as any period (never a circle – the chain is walked once; the project's
 * frame; the lock on jobs the person may not edit). `jobs` carry their effective Start in `plannedStartDate`.
 */
export function planFollowerMoves<T extends SchedulePeriod & { id: string; title: string; status: string; predecessorIds?: readonly string[] | null }>(input: {
  jobId: string; previous: SchedulePeriod; next: SchedulePeriod; jobs: readonly T[]; frame: Partial<ProjectFrame> | null | undefined; canEdit: (job: T) => boolean;
}): FollowerPlan<T> {
  const moves = followerMoves({ id: input.jobId }, input.previous, input.next, input.jobs).map((move) => ({ job: move.job, from: move.from, to: move.to }));
  const plan: FollowerPlan<T> = { moves, locked: moves.filter((move) => !input.canEdit(move.job)).map((move) => move.job), invalid: null, outsideFrame: [] };
  for (const move of moves) {
    const problem = schedulePeriodError(move.to, input.frame);
    if (problem && !problem.frame) plan.invalid ??= `${move.job.title || "Utan rubrik"}: ${problem.message}`;
    else if (problem) plan.outsideFrame.push({ job: move.job, to: move.to });
  }
  return plan;
}
