import { swedishParts } from "@/lib/swedish-time";

/** The ISO week number of a Swedish day (the clock card's "vecka 47", the measures' week labels). Pure. */
export function isoWeekOf(value: Date | string | number): number {
  const parts = swedishParts(value);
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}
