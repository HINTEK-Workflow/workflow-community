"use client";

import { useId } from "react";
import { CheckField, Field } from "@/features/kfid/ui";
import { EditorSegmented } from "@/components/editor-ribbon";
import { indicatorText } from "@/features/workflow/indicator-tone";
import { CHART_KIND_LABEL, CHART_KINDS, type BoardCard } from "@/lib/boards/model";
import { PERIOD_LABEL, type Period } from "@/lib/boards/period";
import { formatNumber, type NumberShape } from "@/lib/boards/shapes";
import { TREND_COUNT, TREND_MAX_METRICS, TREND_METRICS, trendPeriod } from "@/lib/boards/cards/trend";
import type { SourceOf } from "@/lib/boards/cards";
import type { MetricOption } from "../boards-api";
import { cn } from "@/lib/utils";

/**
 * Trender (2026-11-19: "Viktigt att få med trender också"): the small curve under a figure, the figure's own trend choices and
 * the Trend card's choices. The curve's colour follows whether its last step went the measure's good way (green) or not (red); a
 * measure where up or down is neither stays in the card's colour.
 */
export type Better = NumberShape["better"];

/** Which way is good for the figure: the company's own limits first, else the measure's own way. */
export const betterOf = (card: BoardCard, data: NumberShape): Better => card.settings.limits && (card.settings.limits.good !== null || card.settings.limits.bad !== null) ? (card.settings.limits.higherIsBetter ? "up" : "down") : data.better;

/** The tone of a change: good, bad or none. */
export const changeTone = (change: number | null, better: Better) => !change || !better ? null : (change > 0) === (better === "up") ? "success" as const : "danger" as const;

export function Sparkline({ history, better, unit, decimals = 1 }: { history: NonNullable<NumberShape["history"]>; better: Better; unit?: string; decimals?: number }) {
  const points = history.values.map((value, index) => ({ value, index })).filter((point): point is { value: number; index: number } => typeof point.value === "number" && Number.isFinite(point.value));
  if (points.length < 2) return null;
  const min = Math.min(...points.map((point) => point.value));
  const max = Math.max(...points.map((point) => point.value));
  const span = max - min || 1;
  const width = 100;
  const height = 30;
  const x = (index: number) => (index / Math.max(1, history.values.length - 1)) * width;
  const y = (value: number) => height - 2 - ((value - min) / span) * (height - 4);
  const path = points.map((point, index) => `${index ? "L" : "M"}${x(point.index).toFixed(2)},${y(point.value).toFixed(2)}`).join(" ");
  const last = points.at(-1)!;
  const before = points.at(-2)!;
  const tone = changeTone(last.value - before.value, better);
  const words = history.labels.map((label, index) => `${label}: ${formatNumber(history.values[index], decimals)}${unit ? ` ${unit}` : ""}`).join(", ");
  return <div className={cn("board-sparkline size-full min-h-0", tone ? indicatorText(tone) : "text-[var(--card-accent)]")} role="img" aria-label={`Trend: ${words}`} data-testid="board-sparkline">
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="size-full overflow-visible" aria-hidden="true">
      <path d={`${path} L${x(last.index).toFixed(2)},${height} L${x(points[0]!.index).toFixed(2)},${height} Z`} fill="currentColor" opacity="0.12" />
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  </div>;
}

/** The figure's trend choices, under its period and comparison. */
export function TrendFields({ card, onChange }: { card: BoardCard; onChange: (card: BoardCard) => void }) {
  const id = useId();
  const set = (patch: Partial<BoardCard["settings"]>) => onChange({ ...card, settings: { ...card.settings, ...patch } });
  return <>
    <CheckField id={`${id}-trend`} label="Visa trend" description="En liten kurva över de senaste perioderna under talet." testId="card-trend"
      checked={card.settings.trend !== "none"} onChange={(value) => set({ trend: value ? undefined : "none" })} />
    {card.settings.compare !== "none" ? <div className="grid gap-1.5">
      <span className="field-label text-xs font-medium">Visa ändringen som</span>
      <EditorSegmented label="Visa ändringen som" value={card.settings.changeAs ?? "percent"} onChange={(changeAs) => set({ changeAs: changeAs === "percent" ? undefined : changeAs })} testId="card-change-as"
        options={[{ value: "percent", label: "Procent" }, { value: "absolute", label: "Antal" }]} />
    </div> : null}
  </>;
}

const num = (text: string): number | null => { const value = Number(text.replace(",", ".").replace(/\s/g, "")); return text.trim() && Number.isFinite(value) ? value : null; };

/** Mållinje och diagramtyp, shared by the Trend card and Mätvärde. */
export function ChartLookFields({ card, onChange, defaultKind = "line" }: { card: BoardCard; onChange: (card: BoardCard) => void; defaultKind?: (typeof CHART_KINDS)[number] }) {
  const id = useId();
  const set = (patch: Partial<BoardCard["settings"]>) => onChange({ ...card, settings: { ...card.settings, ...patch } });
  return <>
    <EditorSegmented label="Diagram" value={card.settings.chart ?? defaultKind} onChange={(chart) => set({ chart })} options={CHART_KINDS.map((value) => ({ value, label: CHART_KIND_LABEL[value] }))} testId="card-chart-kind" />
    <Field id={`${id}-target`} label="Mållinje" type="number" value={card.settings.target === null || card.settings.target === undefined ? "" : String(card.settings.target)} onChange={(value) => set({ target: num(value) })}
      help="En streckad linje i diagrammet. Tomt: ingen. Målet är ert eget." />
  </>;
}

/** Trend: the measures (one or a few), the period and how many periods back. */
export function TrendSettings({ card, source, metrics, onSource, onChange }: { card: BoardCard; source: SourceOf<"trend">; metrics: MetricOption[]; onSource: (source: SourceOf<"trend">) => void; onChange: (card: BoardCard) => void }) {
  const id = useId();
  const offered = metrics.filter((metric) => TREND_METRICS.includes(metric.key));
  const chosen = source.metrics.filter((key) => offered.some((metric) => metric.key === key));
  const period = trendPeriod(chosen.length ? chosen : source.metrics, source.period);
  const periods = (offered.find((metric) => metric.key === chosen[0])?.periods ?? ["week"]).filter((value) => chosen.every((key) => offered.find((metric) => metric.key === key)?.periods.includes(value)));
  const toggle = (key: MetricOption["key"], on: boolean) => {
    const next = on ? [...chosen, key].slice(0, TREND_MAX_METRICS) : chosen.filter((item) => item !== key);
    if (next.length) onSource({ ...source, metrics: next });
  };
  if (!offered.length) return <p className="text-xs text-muted-foreground">Det finns inga mått med perioder som du har rätt att se.</p>;
  return <div className="space-y-3">
    <fieldset className="grid gap-1.5" data-testid="card-trend-metrics"><legend className="field-label text-xs font-medium">Mått</legend>
      {offered.map((metric) => <CheckField key={metric.key} id={`${id}-m-${metric.key}`} label={metric.label} checked={chosen.includes(metric.key)} onChange={(on) => toggle(metric.key, on)}
        disabled={!chosen.includes(metric.key) && chosen.length >= TREND_MAX_METRICS} />)}
      <p className="text-xs text-muted-foreground">Högst {TREND_MAX_METRICS} mått i samma diagram. Välj mått med samma enhet för att jämföra dem.</p>
    </fieldset>
    <Field id={`${id}-period`} label="Period" value={period} onChange={(value) => onSource({ ...source, period: value as Period })} options={periods} optionLabels={PERIOD_LABEL}
      help="Varje punkt är en hel period. Den sista är den pågående." />
    <Field id={`${id}-count`} label="Antal perioder" value={String(source.count ?? TREND_COUNT[period])} onChange={(value) => onSource({ ...source, count: Number(value) === TREND_COUNT[period] ? undefined : Number(value) })}
      options={["4", "6", "8", "12", "16", "24"].includes(String(TREND_COUNT[period])) ? ["4", "6", "8", "12", "16", "24"] : [String(TREND_COUNT[period]), "4", "6", "8", "12", "16", "24"]} />
    <ChartLookFields card={card} onChange={onChange} />
  </div>;
}
