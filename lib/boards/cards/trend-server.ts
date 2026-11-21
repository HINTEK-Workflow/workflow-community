import { metricAccess, metricDefinition, metricPeriod, type MetricKey } from "../metrics";
import { countMetric, type MetricCaller } from "../metrics-server";
import { METRIC_BETTER } from "../metric-shapes";
import type { NumberShape, SeriesShape } from "../shapes";
import type { Period } from "../period";
import type { BoardCard, MetricRef } from "../model";
import { isTrendMetric, periodLabel, TREND_COUNT, trendMoments, trendPeriod, type TrendSource } from "./trend";
import type { SourceResult } from "./server";

/**
 * Trender på servern: a measure counted again for each of the periods before the current one, with the same rule and right as the
 * figure (countMetric). A past period does not change often, so its value is kept ten minutes per company, viewer and period; the
 * current period is always counted fresh.
 */
const PAST_TTL_MS = 10 * 60_000;
const globalCache = globalThis as typeof globalThis & { __boardTrendCache?: Map<string, { at: number; value: number | null }> };
const cache: Map<string, { at: number; value: number | null }> = globalCache.__boardTrendCache ??= new Map();

const valueOf = (shape: { kind: string; value?: number | null }) => shape.kind === "number" ? shape.value ?? null : null;

/** The measure's value for each period, oldest first; null when the viewer may not read it. */
export async function metricHistory(viewer: MetricCaller, key: MetricKey, period: Period, now: Date, count = TREND_COUNT[period], current?: number | null) {
  const moments = trendMoments(period, now, count);
  const stamp = Date.now();
  const values = await Promise.all(moments.map(async (moment, index) => {
    const last = index === moments.length - 1;
    if (last && current !== undefined) return current;
    const cacheKey = `${viewer.organizationId}:${viewer.userId}:${viewer.admin ? 1 : 0}:${key}:${period}:${moment.toISOString().slice(0, 10)}`;
    const kept = !last ? cache.get(cacheKey) : undefined;
    if (kept && stamp - kept.at < PAST_TTL_MS) return kept.value;
    const result = await countMetric(viewer, key, moment, period);
    const value = result.ok ? valueOf(result.data as NumberShape) : null;
    if (!last) cache.set(cacheKey, { at: stamp, value });
    return value;
  }));
  if (cache.size > 5000) for (const [cacheKey, entry] of cache) if (stamp - entry.at > PAST_TTL_MS) cache.delete(cacheKey);
  return { labels: moments.map((moment) => periodLabel(period, moment)), values };
}

/** A figure with its trend (unless the card turned it off) and which way is good for its measure. */
export async function withTrend(viewer: MetricCaller, ref: MetricRef, card: Pick<BoardCard, "type" | "settings">, shape: NumberShape, now: Date): Promise<NumberShape> {
  const better = METRIC_BETTER[ref.metric];
  const out: NumberShape = better ? { ...shape, better } : shape;
  const period = metricPeriod(ref.metric, ref.period);
  if (card.type !== "kpi" || card.settings.trend === "none" || !period || !isTrendMetric(ref.metric)) return out;
  return { ...out, history: await metricHistory(viewer, ref.metric, period, now, TREND_COUNT[period], shape.value) };
}

export async function readTrend(viewer: MetricCaller, source: TrendSource, now: Date): Promise<SourceResult> {
  const keys = source.metrics.filter(isTrendMetric);
  if (!keys.length) return { ok: false, reason: "missing" };
  for (const key of keys) { const access = metricAccess(key, viewer); if (access !== "ok") return { ok: false, reason: access }; }
  const period = trendPeriod(keys, source.period);
  const count = source.count ?? TREND_COUNT[period];
  const histories = await Promise.all(keys.map((key) => metricHistory(viewer, key, period, now, count)));
  const units = [...new Set(keys.map((key) => metricDefinition(key).unit ?? ""))];
  const data: SeriesShape = { kind: "series", labels: histories[0]!.labels, series: keys.map((key, index) => ({ name: metricDefinition(key).label, values: histories[index]!.values })), ...(units.length === 1 && units[0] ? { unit: units[0] } : {}) };
  return { ok: true, data, label: keys.length === 1 ? metricDefinition(keys[0]!).label : undefined };
}
