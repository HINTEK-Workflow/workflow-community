import { addSwedishDays, startOfSwedishDay, startOfSwedishMonth, swedishDate, swedishDayKey, swedishMonday, swedishParts } from "@/lib/swedish-time";

/**
 * Perioden ett kort räknar (Tavlor, 2026-11-19: "kunna skapa och redigera bättre på varje kort"): a measure that counts over
 * time lets the card choose its period, and a figure can be compared with the period before. Calendar periods follow Swedish time
 * (a week starts on Monday); the period runs from its start up to now, and the one before is the whole period before it. Pure, so the
 * server, the demo and the tests count the same.
 */
export const PERIODS = ["today", "week", "month", "30d", "year"] as const;
export type Period = (typeof PERIODS)[number];
export const isPeriod = (value: unknown): value is Period => (PERIODS as readonly unknown[]).includes(value);

export const PERIOD_LABEL: Record<Period, string> = { today: "I dag", week: "Den här veckan", month: "Den här månaden", "30d": "Senaste 30 dagarna", year: "I år" };
/** The period before, as the comparison under a figure names it. */
export const PREVIOUS_PERIOD_LABEL: Record<Period, string> = { today: "I går", week: "Förra veckan", month: "Förra månaden", "30d": "30 dagarna före", year: "Förra året" };

export type PeriodRange = { from: Date; to: Date; previousFrom: Date; previousTo: Date };

export function periodRange(period: Period, now: Date): PeriodRange {
  switch (period) {
    case "today": { const from = startOfSwedishDay(now); return { from, to: addSwedishDays(from, 1), previousFrom: addSwedishDays(from, -1), previousTo: from }; }
    case "week": { const from = swedishMonday(now); return { from, to: addSwedishDays(from, 7), previousFrom: addSwedishDays(from, -7), previousTo: from }; }
    case "month": { const from = startOfSwedishMonth(now); return { from, to: startOfSwedishMonth(now, 1), previousFrom: startOfSwedishMonth(now, -1), previousTo: from }; }
    case "30d": { const to = addSwedishDays(startOfSwedishDay(now), 1); const from = addSwedishDays(to, -30); return { from, to, previousFrom: addSwedishDays(from, -30), previousTo: from }; }
    case "year": { const year = swedishParts(now).year; const from = swedishDate(year, 1, 1); return { from, to: swedishDate(year + 1, 1, 1), previousFrom: swedishDate(year - 1, 1, 1), previousTo: from }; }
  }
}

/** The same range as Swedish day keys (YYYY-MM-DD, `to` not included), for rows that keep a date and no time. */
export function periodDays(period: Period, now: Date) {
  const range = periodRange(period, now);
  return { from: swedishDayKey(range.from), to: swedishDayKey(range.to), previousFrom: swedishDayKey(range.previousFrom), previousTo: swedishDayKey(range.previousTo) };
}

/** Whether a moment (or a Swedish day key) is inside [from, to). */
export const inRange = (value: Date | string | null | undefined, from: Date | string, to: Date | string) => {
  if (!value) return false;
  if (typeof value === "string" && typeof from === "string" && typeof to === "string") return value >= from && value < to;
  const time = new Date(value).getTime();
  return time >= new Date(from).getTime() && time < new Date(to).getTime();
};
