import { fromSwedishDateTimeInput, swedishDayKey } from "@/lib/swedish-time";

/**
 * Innehållsserie (2026-11-11), pure: the slots of a series – a period from a start day, the weekdays and one clock time,
 * all in Swedish time. The defaults (decided 2026-11-11): a month, Monday, Wednesday and Friday at 08:00. A slot whose time does not exist
 * (02:00–02:59 the night summer time starts) or has already passed is left out.
 */
export const SERIES_PERIODS = [
  { key: "2w", label: "2 veckor" },
  { key: "1m", label: "1 månad" },
  { key: "2m", label: "2 månader" },
  { key: "3m", label: "3 månader" },
] as const;
export type SeriesPeriod = (typeof SERIES_PERIODS)[number]["key"];
export const DEFAULT_SERIES = { period: "1m" as SeriesPeriod, weekdays: [0, 2, 4], time: "08:00" };
export const WEEKDAY_SHORT = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"] as const;
export const SERIES_MAX_SLOTS = 60;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const pad = (value: number) => String(value).padStart(2, "0");
const keyOf = (utc: Date) => `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}`;
const utcDay = (key: string) => { const match = DAY.exec(key); return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null; };

/** The last day of a period that starts on `startDay` (both included): two weeks, or the same day a month later minus one. */
export function seriesEndDay(startDay: string, period: SeriesPeriod): string | null {
  const start = utcDay(startDay);
  if (!start || keyOf(start) !== startDay) return null;
  if (period === "2w") return keyOf(new Date(start.getTime() + 13 * 86_400_000));
  const months = period === "1m" ? 1 : period === "2m" ? 2 : 3;
  const year = start.getUTCFullYear(), month = start.getUTCMonth() + months, day = start.getUTCDate();
  // 31 January + a month is the last of February, not 3 March.
  const lastOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const end = new Date(Date.UTC(year, month, Math.min(day, lastOfMonth)));
  return keyOf(new Date(end.getTime() - 86_400_000));
}

export type SeriesSlot = { day: string; weekday: number; at: Date };
export type SeriesPlan = { startDay: string; endDay: string; weekdays: readonly number[]; time: string };

/** Why the plan cannot be used, or null. */
export function seriesPlanProblem(plan: SeriesPlan): string | null {
  const start = utcDay(plan.startDay), end = utcDay(plan.endDay);
  if (!start || keyOf(start) !== plan.startDay || !end || keyOf(end) !== plan.endDay) return "Välj en giltig startdag.";
  if (end.getTime() < start.getTime()) return "Perioden slutar innan den börjar.";
  if (end.getTime() - start.getTime() > 100 * 86_400_000) return "En serie kan vara högst tre månader.";
  if (!plan.weekdays.length || plan.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) return "Välj minst en veckodag.";
  if (!TIME.test(plan.time)) return "Välj ett klockslag.";
  return null;
}

/** Every slot of the plan, in order; past times and times that do not exist are left out, at most SERIES_MAX_SLOTS. */
export function seriesSlots(plan: SeriesPlan, now = new Date()): SeriesSlot[] {
  if (seriesPlanProblem(plan)) return [];
  const start = utcDay(plan.startDay)!, end = utcDay(plan.endDay)!;
  const days = new Set(plan.weekdays);
  const slots: SeriesSlot[] = [];
  for (let time = start.getTime(); time <= end.getTime() && slots.length < SERIES_MAX_SLOTS; time += 86_400_000) {
    const date = new Date(time);
    const weekday = (date.getUTCDay() + 6) % 7;
    if (!days.has(weekday)) continue;
    const day = keyOf(date);
    const at = fromSwedishDateTimeInput(`${day}T${plan.time}`);
    if (!at || at.getTime() <= now.getTime() + 60_000) continue;
    slots.push({ day, weekday, at });
  }
  return slots;
}

/** The next Monday after today in Swedish time (a series' default start). */
export function nextMonday(now = new Date()): string {
  const today = utcDay(swedishDayKey(now))!;
  const weekday = (today.getUTCDay() + 6) % 7;
  return keyOf(new Date(today.getTime() + (7 - weekday) * 86_400_000));
}
