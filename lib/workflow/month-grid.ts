import { addDays, isoWeek, mondayOf } from "./schedule";

/**
 * The calendar's month grid (2026-10-12): seven columns Monday–Sunday, a week number per row, today framed, a value
 * (seconds, a count) per day and a chosen day. Days are Swedish calendar days, "YYYY-MM-DD" (see lib/workflow/schedule.ts).
 */
export type MonthCell = { key: string; day: number; inMonth: boolean; today: boolean; selected: boolean; value: number };
export type MonthWeek = { week: number; days: MonthCell[] };

const pad = (value: number) => String(value).padStart(2, "0");
export const monthKeyOf = (day: string) => day.slice(0, 7);
/** The first day of the month `offset` months from the month of `day`. */
export function monthStart(day: string, offset = 0): string {
  const index = Number(day.slice(0, 4)) * 12 + (Number(day.slice(5, 7)) - 1) + offset;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}-01`;
}

/** `fixedWeeks` (2026-10-28): always six rows – the days after the month fill them – so the grid keeps its height from month to month. */
export function monthGrid({ anchor, today, selected, values = {}, fixedWeeks = false }: { anchor: string; today: string; selected?: string | null; values?: Record<string, number>; fixedWeeks?: boolean }): { month: string; weeks: MonthWeek[] } {
  const first = monthStart(anchor);
  const month = monthKeyOf(first);
  const weeks: MonthWeek[] = [];
  for (let start = mondayOf(first); ; start = addDays(start, 7)) {
    const days = Array.from({ length: 7 }, (_, offset): MonthCell => {
      const key = addDays(start, offset);
      return { key, day: Number(key.slice(8, 10)), inMonth: monthKeyOf(key) === month, today: key === today, selected: key === selected, value: values[key] ?? 0 };
    });
    weeks.push({ week: isoWeek(days[0]!.key), days });
    if (monthKeyOf(addDays(start, 7)) !== month && addDays(start, 7) > first && (!fixedWeeks || weeks.length >= 6)) break;
  }
  return { month, weeks };
}

/** Seconds as short hours for a small cell: "6,5", "0,3", "" for nothing. */
export function hoursShort(seconds: number): string {
  if (!(seconds > 0)) return "";
  const hours = Math.round((seconds / 3600) * 10) / 10;
  return String(hours === 0 ? 0.1 : hours).replace(".", ",");
}

const MONTH_NAMES = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
/** "Oktober 2026" for the grid’s heading. */
export function monthTitle(day: string): string {
  const name = MONTH_NAMES[Number(day.slice(5, 7)) - 1]!;
  return `${name[0]!.toUpperCase()}${name.slice(1)} ${day.slice(0, 4)}`;
}
