import { z } from "zod";
import { addSwedishDays, formatSwedish, startOfSwedishMonth, swedishDate, swedishParts } from "@/lib/swedish-time";
import { METRIC_KEYS, METRICS, type MetricKey } from "../metrics";
import { PERIODS, periodRange, type Period } from "../period";
import { isoWeekOf } from "../week";

/**
 * Trender (2026-11-19: "Viktigt att få med trender också"): a measure that counts over a period is counted again for the
 * periods before it, so a figure can show a small curve and the Trend card a line over time. The periods are whole calendar periods
 * (the current one up to now), counted with exactly the same rule as the figure itself – on the server and in the demo. Pure.
 */
export const TREND_COUNT: Record<Period, number> = { today: 14, week: 8, month: 12, "30d": 6, year: 5 };
export const TREND_MAX_METRICS = 4;
export const trendSourceSchema = z.object({
  type: z.literal("trend"),
  metrics: z.array(z.enum(METRIC_KEYS)).min(1).max(TREND_MAX_METRICS),
  period: z.enum(PERIODS).optional(),
  count: z.number().int().min(3).max(24).optional(),
});
export type TrendSource = z.infer<typeof trendSourceSchema>;

/** The measures a trend can follow: those that count over a period. */
export const TREND_METRICS: readonly MetricKey[] = METRICS.filter((metric) => metric.shape === "number" && metric.compares && metric.periods?.length).map((metric) => metric.key);
export const isTrendMetric = (key: MetricKey) => TREND_METRICS.includes(key);

/** The period a trend counts: the card's choice when every chosen measure offers it, else the first measure's own. */
export function trendPeriod(keys: readonly MetricKey[], wanted?: Period | null): Period {
  const offered = keys.map((key) => METRICS.find((metric) => metric.key === key)?.periods ?? []);
  if (wanted && offered.every((periods) => periods.includes(wanted))) return wanted;
  const first = METRICS.find((metric) => metric.key === keys[0]);
  return first?.period ?? first?.periods?.[0] ?? "week";
}

/** A moment inside the period `back` periods before the current one (0 = the current). */
export function periodMoment(period: Period, now: Date, back: number): Date {
  switch (period) {
    case "today": return addSwedishDays(now, -back);
    case "week": return addSwedishDays(now, -7 * back);
    case "month": return startOfSwedishMonth(now, -back);
    case "30d": return addSwedishDays(now, -30 * back);
    case "year": return swedishDate(swedishParts(now).year - back, 7, 1);
  }
}

/** The period's short name under the curve: "v. 47", "nov", "19 nov", "2026". */
export function periodLabel(period: Period, moment: Date): string {
  const range = periodRange(period, moment);
  switch (period) {
    case "today": return formatSwedish(range.from, { day: "numeric", month: "short" });
    case "week": return `v. ${isoWeekOf(range.from)}`;
    case "month": return formatSwedish(range.from, { month: "short" }).replace(".", "");
    case "30d": return formatSwedish(addSwedishDays(range.to, -1), { day: "numeric", month: "short" });
    case "year": return String(swedishParts(range.from).year);
  }
}

/** The moments of the periods to count, oldest first, the current period last. */
export function trendMoments(period: Period, now: Date, count = TREND_COUNT[period]) {
  return Array.from({ length: count }, (_, index) => periodMoment(period, now, count - 1 - index));
}
