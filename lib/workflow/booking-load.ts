import { addSwedishDays, startOfSwedishDay, swedishDayKey, swedishParts } from "@/lib/swedish-time";

/**
 * Bokningar som stämmer med verkligheten (projektförslaget 2026-10-09, steg 1, avsnitt 6.3). A booking loads a person
 * per working day, never 24 hours a day:
 *
 * - without hours: each working day inside the booking takes the day's working time (weekly working time / 5), or the
 *   booked part of that day when it is shorter (a booking 08–12 takes 4 h). Mon 07:00 – Fri 16:00 is 40 h, not 105 h.
 * - with hours: the hours are spread evenly over the booking's working days (16 h Mon–Fri = 3.2 h a day), nothing at
 *   night, at weekends or on Swedish public holidays.
 * - a booking that lies only on weekend days or holidays was put there on purpose, so those days count instead.
 *
 * Pure and read-only: planned time never creates or changes reported time.
 */

export const DEFAULT_WEEKLY_WORK_MINUTES = 40 * 60;

/** The working time of one working day: the weekly working time over five days (40 h ⇒ 8 h). */
export function dailyWorkMinutes(weeklyWorkMinutes: number | null | undefined) {
  const weekly = Number.isFinite(weeklyWorkMinutes) ? Math.max(0, Number(weeklyWorkMinutes)) : DEFAULT_WEEKLY_WORK_MINUTES;
  return Math.round(weekly / 5);
}

const pad = (value: number) => String(value).padStart(2, "0");
const key = (date: Date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
const utc = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day));
const plusDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);
/** The first date from `from` (inclusive) that falls on `weekday` (0 = Sunday … 6 = Saturday, as Date.getUTCDay). */
const firstWeekday = (from: Date, weekday: number) => plusDays(from, (weekday - from.getUTCDay() + 7) % 7);

/** Easter Sunday (Gregorian, the anonymous algorithm). */
function easterSunday(year: number) {
  const a = year % 19; const b = Math.floor(year / 100); const c = year % 100;
  const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25); const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30; const i = Math.floor(c / 4); const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7; const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(year, month, day);
}

const holidayCache = new Map<number, Set<string>>();
/**
 * Swedish public holidays as YYYY-MM-DD, plus midsommarafton, julafton and nyårsafton, which are days off in practice
 * (and under the usual collective agreements). Company closing days and "klämdagar" are not included.
 */
export function swedishHolidayKeys(year: number) {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const easter = easterSunday(year);
  const days = new Set([
    key(utc(year, 1, 1)), key(utc(year, 1, 6)),
    key(plusDays(easter, -2)), key(easter), key(plusDays(easter, 1)),
    key(utc(year, 5, 1)), key(plusDays(easter, 39)), key(plusDays(easter, 49)), key(utc(year, 6, 6)),
    key(firstWeekday(utc(year, 6, 19), 5)), key(firstWeekday(utc(year, 6, 20), 6)),
    key(firstWeekday(utc(year, 10, 31), 6)),
    key(utc(year, 12, 24)), key(utc(year, 12, 25)), key(utc(year, 12, 26)), key(utc(year, 12, 31)),
  ]);
  holidayCache.set(year, days);
  return days;
}

/** A Swedish working day: Monday to Friday and not a holiday (see swedishHolidayKeys). */
export function isSwedishWorkday(value: Date | string) {
  const parts = swedishParts(value);
  return parts.weekday < 5 && !swedishHolidayKeys(parts.year).has(swedishDayKey(value));
}

export type BookingDay = {
  /** The Swedish day, YYYY-MM-DD. */
  day: string;
  /** The part of the day the booking covers. */
  startsAt: Date;
  endsAt: Date;
  /** The load this day, in minutes. */
  minutes: number;
};

/** Never more than about ten years of days for one booking, whatever the input. */
const MAX_DAYS = 3700;
const cache = new Map<string, BookingDay[]>();

/**
 * One booking's load per Swedish day. `plannedMinutes` null means "no hours given": each counted day takes the day's
 * working time or the booked part of the day, whichever is shorter.
 */
export function bookingLoadByDay(input: { startsAt: string | Date; endsAt: string | Date; plannedMinutes: number | null; dailyWorkMinutes: number }): BookingDay[] {
  const start = new Date(input.startsAt); const end = new Date(input.endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return [];
  const daily = Math.max(0, Math.round(input.dailyWorkMinutes));
  const planned = input.plannedMinutes === null || !Number.isFinite(input.plannedMinutes) ? null : Math.max(0, Math.round(input.plannedMinutes));
  const cacheKey = `${start.getTime()}|${end.getTime()}|${planned ?? "-"}|${daily}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const segments: { day: string; startsAt: Date; endsAt: Date; workday: boolean }[] = [];
  let dayStart = startOfSwedishDay(start);
  for (let guard = 0; dayStart < end && guard < MAX_DAYS; guard += 1) {
    const next = addSwedishDays(dayStart, 1);
    const from = start > dayStart ? start : dayStart; const to = end < next ? end : next;
    if (to > from) segments.push({ day: swedishDayKey(dayStart), startsAt: from, endsAt: to, workday: isSwedishWorkday(dayStart) });
    dayStart = next;
  }
  const workdays = segments.filter((segment) => segment.workday);
  const counted = workdays.length ? workdays : segments;
  let result: BookingDay[];
  if (planned === null) {
    result = counted.map(({ day, startsAt, endsAt }) => ({ day, startsAt, endsAt, minutes: Math.min(daily, Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000)) }));
  } else {
    // Whole minutes that add up exactly: the remainder goes to the first days.
    const base = Math.floor(planned / Math.max(1, counted.length)); const remainder = planned - base * counted.length;
    result = counted.map(({ day, startsAt, endsAt }, index) => ({ day, startsAt, endsAt, minutes: base + (index < remainder ? 1 : 0) }));
  }
  if (cache.size > 5_000) cache.clear();
  cache.set(cacheKey, result);
  return result;
}

/** The share of a booking's daily load that falls inside a window (a calendar day, a week), in minutes. */
export function bookingMinutesInWindow(days: BookingDay[], windowStart: Date, windowEnd: Date) {
  let total = 0;
  for (const day of days) {
    const from = Math.max(day.startsAt.getTime(), windowStart.getTime());
    const to = Math.min(day.endsAt.getTime(), windowEnd.getTime());
    if (to <= from) continue;
    const length = day.endsAt.getTime() - day.startsAt.getTime();
    total += length ? (day.minutes * (to - from)) / length : 0;
  }
  return Math.round(total);
}

/**
 * A booking "med klockslag": no hours given and within one Swedish day (08–12). Two such bookings that overlap are a
 * clash; a booking over several days, or one given in hours, only clashes when a day holds more than its working time.
 */
export function isClockBooking(input: { startsAt: string | Date; endsAt: string | Date; plannedMinutes: number | null }) {
  const start = new Date(input.startsAt); const end = new Date(input.endsAt);
  if (input.plannedMinutes !== null || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return false;
  return swedishDayKey(start) === swedishDayKey(new Date(end.getTime() - 1));
}
