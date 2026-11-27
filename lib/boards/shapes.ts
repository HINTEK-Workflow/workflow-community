/**
 * Tavlor (2026-11-18, docs/beslut/tavlor-och-skarmar.md): the five shapes every data source gives its data in. A card knows only the
 * shape it draws and its own settings, never where the data came from, so any card can show any source of the right shape. The
 * server counts everything (lib/boards/feed-server.ts) and sends these finished values; a screen or a link never sees more.
 * Pure, so the server, the editor, the player and the tests read the same.
 */
import { CARD_SHAPE_KINDS, type CardShape } from "./cards/shapes";

export const SHAPES = ["number", "series", "table", "events", "status", ...CARD_SHAPE_KINDS] as const;
export type ShapeKind = (typeof SHAPES)[number];

/**
 * Tal: one value with its unit, and an optional target and comparison (the previous period). `history` is the trend (
 * 2026-11-19: "Viktigt att få med trender också"): the measure's value for the last periods, the current one last; `better` says
 * which way is good for the measure (lib/boards/metric-shapes.ts), none where it is unclear.
 */
export type NumberShape = { kind: "number"; value: number | null; unit?: string; target?: number | null; previous?: number | null; note?: string; history?: { labels: string[]; values: (number | null)[] }; better?: "up" | "down" };
/** Serie: one or more lines (or bars) over the same labels – days, weeks or categories. */
export type SeriesShape = { kind: "series"; labels: string[]; series: { name: string; values: (number | null)[] }[]; unit?: string };
export type TableColumnType = "text" | "number" | "date" | "status";
/** Tabell: typed columns and rows of plain values. */
export type TableShape = { kind: "table"; columns: { key: string; label: string; type: TableColumnType }[]; rows: Record<string, string | number | null>[]; total?: number };
export type EventLevel = "info" | "warning" | "error";
/** Händelser: something that happened, newest first. */
export type EventsShape = { kind: "events"; items: { at: string; title: string; level: EventLevel; detail?: string }[] };
export type StatusState = "ok" | "warning" | "error" | "unknown";
/** Status: a lamp per thing (a machine, a line, a system). */
export type StatusShape = { kind: "status"; items: { name: string; state: StatusState; text?: string }[] };

export type Shape = NumberShape | SeriesShape | TableShape | EventsShape | StatusShape | CardShape;

/** What a card receives: the shape, or why there is nothing to show. `at` is when the figures were counted; `label` is the source's name. */
export type CardData =
  | { ok: true; at: string; data: Shape; label?: string }
  | { ok: false; at: string; reason: CardDataProblem; label?: string };
/**
 * Why a card has no data: the source is gone, the viewer (or the publisher) may not see it, the company has turned the module off,
 * or the counting failed. The player shows one calm line per reason, never a raw error.
 */
export type CardDataProblem = "missing" | "forbidden" | "module_off" | "failed" | "not_available";

export const PROBLEM_TEXT: Record<CardDataProblem, string> = {
  missing: "Datakällan finns inte längre.",
  forbidden: "Du saknar behörighet att se det här.",
  module_off: "Modulen är avstängd för företaget.",
  failed: "Uppgifterna kunde inte hämtas just nu.",
  not_available: "Inte tillgängligt längre.",
};

export const STATUS_STATE_LABEL: Record<StatusState, string> = { ok: "OK", warning: "Varning", error: "Fel", unknown: "Okänt" };
/** The plain words a table cell may use for a state (Egen tabell's status column), read leniently. */
export function statusStateOf(value: unknown): StatusState {
  const text = String(value ?? "").trim().toLowerCase();
  if (["ok", "grön", "gron", "green", "i drift", "igång", "igang", "klar"].includes(text)) return "ok";
  if (text === "warning" || text === "error" || text === "unknown") return text;
  if (["varning", "gul", "yellow", "warning", "väntar", "vantar"].includes(text)) return "warning";
  if (["fel", "röd", "rod", "red", "error", "stopp", "stoppad", "larm"].includes(text)) return "error";
  return "unknown";
}

/** A number for a card: Swedish grouping and comma, with at most `decimals` decimals; "–" for nothing. */
export function formatNumber(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  return new Intl.NumberFormat("sv-SE", { maximumFractionDigits: decimals, minimumFractionDigits: 0 }).format(value);
}

/**
 * A chart's value axis (filmed 2026-11-20: "1, 75, 5, 25, 0" where 0,75 was meant): even steps (1, 2, 2,5 or 5 times a power of
 * ten) from zero or below to the largest value, and the decimals the step needs, so every tick reads whole in Swedish (0,25 · 0,5 ·
 * 0,75) and the axis can be made wide enough for its longest tick. Pure, so the tests read the same as the card.
 */
export function axisTicks(values: readonly (number | null | undefined)[], count = 5): { ticks: number[]; decimals: number; labels: string[] } {
  const known = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const low = Math.min(0, ...known);
  let high = Math.max(0, ...known);
  if (high === low) high = low + 1;
  const rough = (high - low) / Math.max(1, count - 1);
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= rough * (1 - 1e-9))!;
  const stepText = String(Number(step.toPrecision(12)));
  const decimals = Math.min(6, stepText.includes(".") ? stepText.split(".")[1]!.length : 0);
  const first = Math.floor(low / step + 1e-9) * step;
  const ticks: number[] = [];
  for (let index = 0; index < 50; index += 1) {
    const tick = Number((first + index * step).toFixed(decimals));
    ticks.push(tick);
    if (tick >= high - step * 1e-9) break;
  }
  return { ticks, decimals, labels: ticks.map((tick) => formatNumber(tick, decimals)) };
}

/**
 * The font size (CSS) for a short text in a narrow box that is a size container (container-type inline-size): as large as `maxEm`
 * but never so large that its longest word is wider than the box (about `letterEm` a letter), so a word is never broken in the
 * middle ("Förfa llna", filmed 2026-11-20); words still wrap between them.
 */
export function wordFitSize(text: string, maxEm: number, letterEm = 0.62): string {
  const longest = Math.max(1, ...text.split(/\s+/).map((word) => word.length));
  return `min(${maxEm}em, ${Number((100 / (letterEm * longest)).toFixed(2))}cqi)`;
}

/** The change against the previous value as a whole percent, or null when there is nothing to compare with. */
export function changePercent(value: number | null | undefined, previous: number | null | undefined): number | null {
  if (value === null || value === undefined || previous === null || previous === undefined || !Number.isFinite(value) || !Number.isFinite(previous) || previous === 0) return null;
  return Math.round(((value - previous) / Math.abs(previous)) * 100);
}

/**
 * The company's own limits on a card (green/yellow/red). Workflow ships no limit values (the copyright rule, "företagen äger sina
 * gränsvärden"): with neither limit set the card has no colour. `higherIsBetter` says which way is good.
 */
export type Thresholds = { good: number | null; bad: number | null; higherIsBetter: boolean };
export type Tone = "success" | "warning" | "danger" | "neutral";
export function toneFor(value: number | null | undefined, limits: Thresholds | null | undefined): Tone {
  if (!limits || value === null || value === undefined || !Number.isFinite(value)) return "neutral";
  const { good, bad, higherIsBetter } = limits;
  if (good === null && bad === null) return "neutral";
  const better = (a: number, b: number) => (higherIsBetter ? a >= b : a <= b);
  if (good !== null && better(value, good)) return "success";
  if (bad !== null && better(bad, value)) return "danger";
  return good !== null && bad !== null ? "warning" : "neutral";
}

/** Share of a target as 0–100 (a gauge), or null without a positive target. */
export function shareOf(value: number | null | undefined, target: number | null | undefined): number | null {
  if (value === null || value === undefined || !target || target <= 0 || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round((value / target) * 100)));
}
