"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownRight, ArrowUpRight, CircleAlert, ImageIcon, Info, TriangleAlert } from "lucide-react";
import { indicatorBar, indicatorText, type IndicatorTone } from "@/features/workflow/indicator-tone";
import { CARD_ACCENT_COLOR, cardDefinition, cardHeading, defaultSourceRef, type BoardCard } from "@/lib/boards/model";
import { isSourceCardType } from "@/lib/boards/cards";
import { axisTicks, changePercent, formatNumber, PROBLEM_TEXT, shareOf, STATUS_STATE_LABEL, statusStateOf, toneFor, type CardData, type EventsShape, type NumberShape, type SeriesShape, type StatusShape, type StatusState, type TableShape } from "@/lib/boards/shapes";
import { formatSwedish, swedishClock } from "@/lib/swedish-time";
import { isoWeekOf } from "@/lib/boards/week";
import { cn } from "@/lib/utils";
import { CARD_ICON } from "./card-icons";
import { defaultChartOf, SourceCardBody } from "./cards";
import { betterOf, changeTone, Sparkline } from "./cards/trend";

/**
 * Tavlans kort (Tavlor och skärmar, 2026-11-18; docs/ui-system.md "Tavlans kort"): one card of a board, drawn from its type and the
 * finished data the server sent – the same drawing in the editor, on the board's page, in Presentera, on a connected screen and
 * behind a shared link. The card is a size container (app/globals.css .board-card), so its text follows its own size and the board
 * looks alike from an iPad to a 4K screen. Lists show only the rows that fit whole and say how many there are (2026-11-19, nothing
 * runs out of the card); a chart's axes and lines grow with the card. Every graphic has words for a screen reader. Nothing here
 * fetches anything from a third party: pictures come through Workflow's own routes (`BoardImages`).
 */
export type BoardImageUrl = (id: string) => string;
const ImageUrlContext = createContext<BoardImageUrl>(() => "");
export function BoardImages({ url, children }: { url: BoardImageUrl; children: ReactNode }) {
  return <ImageUrlContext.Provider value={url}>{children}</ImageUrlContext.Provider>;
}
/** The address of a board's picture or file where the board is shown (the app, a screen or a link). */
export const useBoardImageUrl = () => useContext(ImageUrlContext);

const TONE: Record<"success" | "warning" | "danger" | "neutral", IndicatorTone> = { success: "success", warning: "warning", danger: "danger", neutral: "neutral" };
const STATE_TONE: Record<StatusState, IndicatorTone> = { ok: "success", warning: "warning", error: "danger", unknown: "neutral" };
export const CHART_COLORS = ["var(--primary)", "var(--type-round)", "var(--type-quote)", "var(--type-calendar)", "var(--type-time)", "var(--type-customer)"] as const;
/** The card's own colour (Färg), else the app's blue. */
const accentOf = (card: BoardCard) => CARD_ACCENT_COLOR[card.settings.accent ?? "primary"];

/** Whether the card's figures are older than the card's own limit (no limit: never old). */
export const isStale = (data: CardData | undefined, staleMinutes: number | undefined, now: number) =>
  Boolean(data && staleMinutes && now - new Date(data.at).getTime() > staleMinutes * 60_000);

export type Shown = { shown: number; total: number };

export function BoardCardView({ card, data, sourceLabel, editing = false, now }: {
  card: BoardCard;
  data?: CardData;
  /** The measure's or the table's name, for a card without a title of its own. */
  sourceLabel?: string | null;
  /** In the editor: an empty card says what to choose instead of showing nothing. */
  editing?: boolean;
  now: number;
}) {
  const definition = cardDefinition(card.type);
  const heading = cardHeading(card, sourceLabel) || (definition.shapes.length ? definition.label : "");
  const stale = isStale(data, card.settings.staleMinutes, now);
  const takesData = definition.shapes.length > 0;
  const Icon = CARD_ICON[definition.icon];
  const [shown, setShown] = useState<Shown | null>(null);
  const accent = accentOf(card);
  const tinted = card.settings.emphasis === "tinted";
  let body: ReactNode;
  if (takesData && !(card.data ?? defaultSourceRef(card.type))) body = <Placeholder text={editing ? "Välj vad kortet ska visa." : "Kortet visar inget ännu."} />;
  else if (takesData && !data) body = <div className="h-full animate-pulse rounded-md bg-muted/60 motion-reduce:animate-none" aria-label="Hämtar…" />;
  else if (takesData && data && !data.ok) body = <Placeholder text={PROBLEM_TEXT[data.reason]} warn />;
  else if (data?.ok) body = <ShapeBody card={card} data={data.data} onShown={setShown} />;
  else body = <PlainBody card={card} editing={editing} now={now} />;
  const more = data?.ok && shown && shown.shown < shown.total ? ` · Visar ${shown.shown} av ${shown.total}` : "";
  // The box around the card is the size container its own text follows (a container's units never measure the container itself).
  return <div className="board-card-box size-full min-h-0 min-w-0"><section className={cn("board-card flex h-full min-h-0 min-w-0 flex-col gap-[0.4em] overflow-hidden rounded-lg border bg-card p-[0.75em] text-card-foreground", stale && "opacity-60 grayscale")}
    style={{ "--card-accent": accent, ...(tinted ? { background: "color-mix(in srgb, var(--card-accent) 9%, var(--card))", borderColor: "color-mix(in srgb, var(--card-accent) 35%, var(--border))" } : {}) } as CSSProperties}
    data-text-size={card.settings.textSize && card.settings.textSize !== "normal" ? card.settings.textSize : undefined}
    aria-label={heading || definition.label} data-card-type={card.type} data-testid="board-card">
    {heading && card.type !== "clock" ? <header className="flex min-w-0 items-center gap-[0.4em]">
      {Icon ? <Icon className="size-[1em] shrink-0 text-[var(--card-accent)]" aria-hidden="true" /> : null}
      <h3 className={cn("board-card-title truncate font-semibold", tinted && "text-[var(--card-accent)]")} title={heading}>{heading}</h3>
    </header> : null}
    <div className="relative min-h-0 flex-1">{body}</div>
    {takesData && data ? <p className="board-card-foot truncate text-muted-foreground" data-testid="board-card-at">{stale ? "Gammal data · " : ""}Uppdaterad {swedishClock(data.at)}{more}</p> : null}
  </section></div>;
}

export function Placeholder({ text, warn = false }: { text: string; warn?: boolean }) {
  return <div className="flex h-full items-center justify-center gap-[0.4em] rounded-md border border-dashed p-[0.5em] text-center text-[0.85em] text-muted-foreground">
    {warn ? <TriangleAlert className="size-[1.1em] shrink-0" aria-hidden="true" /> : <Info className="size-[1.1em] shrink-0" aria-hidden="true" />}<span>{text}</span>
  </div>;
}

/**
 * How many of a list's items fit whole in its box (`[data-fit-item]` in reading order); the rest are hidden, never cut in half.
 * Measured again whenever the box changes size, so a list on a 4K screen shows more rows than on an iPad.
 */
export function useFitCount(box: RefObject<HTMLElement | null>, count: number) {
  const [fit, setFit] = useState(count);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () => {
      const limit = element.getBoundingClientRect().bottom + 0.5;
      let fitting = 0;
      for (const item of element.querySelectorAll<HTMLElement>("[data-fit-item]")) {
        if (item.getBoundingClientRect().bottom > limit) break;
        fitting += 1;
      }
      setFit(fitting);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [box, count]);
  return fit;
}

export function useReportShown(fit: number, count: number, total: number, onShown?: (shown: Shown | null) => void) {
  useEffect(() => { onShown?.(count ? { shown: Math.min(fit, count), total: Math.max(total, count) } : null); }, [fit, count, total, onShown]);
}

/** The card's font size in pixels (it follows the card's size), for the parts drawn in pixels such as a chart's axis. */
function useFontPx(element: RefObject<HTMLElement | null>) {
  const [px, setPx] = useState(14);
  useLayoutEffect(() => {
    const target = element.current;
    if (!target) return;
    const read = () => setPx(Number.parseFloat(getComputedStyle(target).fontSize) || 14);
    read();
    const observer = new ResizeObserver(read);
    observer.observe(target);
    return () => observer.disconnect();
  }, [element]);
  return px;
}

function ShapeBody({ card, data, onShown }: { card: BoardCard; data: NonNullable<Extract<CardData, { ok: true }>["data"]>; onShown: (shown: Shown | null) => void }) {
  // The newer cards (features/boards/cards): a chart, a table or events are drawn by the shared parts below, the rest by their own.
  if (isSourceCardType(card.type)) {
    if (data.kind === "series" && data.series.length && data.labels.length) return <ChartBody card={{ ...card, settings: { chart: defaultChartOf(card), ...card.settings } }} data={data} />;
    if (data.kind === "table") return <TableBody data={data} onShown={onShown} />;
    if (data.kind === "events") return <EventsBody data={data} onShown={onShown} />;
    return <SourceCardBody card={card} data={data} onShown={onShown} />;
  }
  switch (card.type) {
    case "kpi": return data.kind === "number" ? <KpiBody card={card} data={data} /> : null;
    case "gauge": return data.kind === "number" ? <GaugeBody card={card} data={data} /> : null;
    case "chart": return data.kind === "series" ? <ChartBody card={card} data={data} /> : null;
    case "table": return data.kind === "table" ? <TableBody data={data} onShown={onShown} /> : null;
    case "status": return data.kind === "status" ? <StatusBody data={data} onShown={onShown} /> : null;
    case "events": return data.kind === "events" ? <EventsBody data={data} onShown={onShown} /> : null;
    default: return null;
  }
}

function KpiBody({ card, data }: { card: BoardCard; data: NumberShape }) {
  const decimals = card.settings.decimals ?? (Number.isInteger(data.value ?? 0) ? 0 : 1);
  const tone = toneFor(data.value, card.settings.limits);
  const absolute = card.settings.changeAs === "absolute";
  const change = card.settings.compare === "none" ? null : absolute ? (data.value !== null && data.previous !== null && data.previous !== undefined ? Math.round((data.value - data.previous) * 10 ** decimals) / 10 ** decimals : null) : changePercent(data.value, data.previous);
  // Green or red after which way is good for the measure (or the company's own limits); neutral where neither is good (Trend, 2026-11-19).
  const better = betterOf(card, data);
  const changeColor = changeTone(change, better);
  const target = card.settings.target ?? data.target ?? null;
  const unit = card.settings.unit || data.unit;
  const TrendIcon = (change ?? 0) >= 0 ? ArrowUpRight : ArrowDownRight;
  const hasLine = change !== null || target !== null;
  // The body is its own size container (app/globals.css .board-kpi): the figure takes what the change line leaves, never less, so on
  // the smallest card the figure stays whole and the line shortens with an ellipsis instead (filmed 2026-11-20: "2 840" cut off).
  return <div className="board-kpi flex h-full min-w-0 flex-col justify-center" data-line={hasLine ? "" : undefined}>
    <p className={cn("board-figure truncate font-bold tabular-nums", tone !== "neutral" && indicatorText(TONE[tone]))} data-testid="board-figure">
      {formatNumber(data.value, decimals)}{unit ? <span className="board-figure-unit font-semibold text-muted-foreground"> {unit}</span> : null}
    </p>
    {hasLine ? <div className="board-kpi-line mt-[0.375em] flex min-h-0 min-w-0 items-center gap-x-[0.6em] overflow-hidden whitespace-nowrap text-[0.8em] text-muted-foreground">
      {change !== null ? <span className={cn("inline-flex min-w-0 items-center gap-[0.15em] font-semibold", changeColor && indicatorText(changeColor))} data-testid="board-change">
        <TrendIcon className="size-[1em] shrink-0" aria-hidden="true" /><span className="min-w-0 truncate">{change > 0 ? "+" : ""}{absolute ? `${formatNumber(change, decimals)}${unit ? ` ${unit}` : ""}` : `${change} %`}{data.note ? ` mot ${data.note.toLowerCase()}` : ""}</span>
      </span> : null}
      {target !== null ? <span className="min-w-0 shrink-[2] truncate">Mål {formatNumber(target, decimals)}{unit ? ` ${unit}` : ""}</span> : null}
    </div> : null}
    {/* The curve takes only the room left over: it shrinks to nothing on a small card and never pushes the figure out. */}
    {card.settings.trend !== "none" && data.history ? <div className="relative min-h-0 overflow-hidden" style={{ flex: "0 1 min(7em, 38cqh)" }}>
      <div className="absolute inset-x-0 bottom-0 top-[0.3em]"><Sparkline history={data.history} better={better} unit={unit} decimals={decimals} /></div>
    </div> : null}
  </div>;
}

function GaugeBody({ card, data }: { card: BoardCard; data: NumberShape }) {
  const target = card.settings.target ?? data.target ?? null;
  const share = shareOf(data.value, target);
  const tone = toneFor(data.value, card.settings.limits);
  const unit = card.settings.unit || data.unit;
  const color = tone === "success" ? "#10b981" : tone === "warning" ? "#f59e0b" : tone === "danger" ? "#dc2626" : "var(--card-accent)";
  const radius = 42;
  const length = 2 * Math.PI * radius;
  return <div className="flex h-full items-center justify-center">
    <div className="relative aspect-square h-full max-h-full max-w-full" role="img" aria-label={share === null ? "Inget mål är satt." : `${share} procent av målet ${formatNumber(target)}${unit ? ` ${unit}` : ""}.`}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--muted)" strokeWidth="10" />
        <circle cx="50" cy="50" r={radius} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" strokeDasharray={length} strokeDashoffset={length * (1 - (share ?? 0) / 100)} />
      </svg>
      <div className="board-gauge absolute inset-0 flex flex-col items-center justify-center text-center" aria-hidden="true">
        <span className="board-gauge-figure font-bold tabular-nums leading-none">{share === null ? "–" : `${share} %`}</span>
        <span className="mt-[0.2em] max-w-[80%] truncate text-[0.75em] text-muted-foreground">{formatNumber(data.value, card.settings.decimals ?? 0)}{target !== null ? ` av ${formatNumber(target, card.settings.decimals ?? 0)}` : ""}{unit ? ` ${unit}` : ""}</span>
      </div>
    </div>
  </div>;
}

function ChartBody({ card, data }: { card: BoardCard; data: SeriesShape }) {
  const box = useRef<HTMLDivElement | null>(null);
  const px = useFontPx(box);
  const rows = data.labels.map((label, index) => Object.fromEntries([["label", label], ...data.series.map((series, s) => [`s${s}`, series.values[index]])]));
  const kind = card.settings.chart ?? "bar";
  const target = card.settings.target ?? null;
  // The axis follows the card's text (a 4K screen gets larger figures), and its width the longest figure on it.
  const tick = Math.max(9, Math.round(px * 0.72));
  // Our own even ticks (0 · 0,25 · 0,5 …) in Swedish, so a small count never shows "75" for 0,75 or loses its first digits.
  const scale = axisTicks([...data.series.flatMap((series) => series.values), target]);
  const longest = Math.max(1, ...scale.labels.map((label) => label.length));
  const axisWidth = Math.ceil(tick * (0.62 * longest + 0.9));
  const stroke = Math.max(2, Math.round(px * 0.16));
  const colors = [accentOf(card), ...CHART_COLORS.filter((color) => color !== accentOf(card))];
  const axis = { tick: { fontSize: tick, fill: "var(--muted-foreground)" }, stroke: "var(--border)" };
  const tooltip = <Tooltip formatter={(value) => typeof value === "number" ? formatNumber(value, 2) : value} contentStyle={{ background: "var(--card)", color: "var(--foreground)", border: "1px solid var(--border)", borderRadius: 8, fontSize: Math.max(12, tick) }} />;
  const margin = { top: Math.round(tick * 0.5), right: Math.round(tick * 0.6), left: 0, bottom: 0 };
  const children = <>
    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
    <XAxis dataKey="label" {...axis} minTickGap={tick} interval="preserveStartEnd" height={Math.ceil(tick * 2)} />
    <YAxis {...axis} width={axisWidth} ticks={scale.ticks} domain={[scale.ticks[0]!, scale.ticks.at(-1)!]} interval={0} tickFormatter={(value: number) => formatNumber(value, scale.decimals)} />
    {tooltip}
    {target !== null ? <ReferenceLine y={target} stroke="#f59e0b" strokeWidth={Math.max(1.5, stroke * 0.6)} strokeDasharray="5 5" /> : null}
  </>;
  const caption = `${cardHeading(card) || "Diagram"}: ${data.series.map((series) => series.name).join(", ")}`;
  // The words for a screen reader come first, so the hidden table never reaches below the card (it would count as overflow).
  return <div className="relative h-full min-h-0" ref={box}>
    <table className="sr-only"><caption>{caption}</caption>
      <thead><tr><th scope="col">Etikett</th>{data.series.map((series) => <th key={series.name} scope="col">{series.name}</th>)}</tr></thead>
      <tbody>{data.labels.map((label, index) => <tr key={`${label}-${index}`}><th scope="row">{label}</th>{data.series.map((series) => <td key={series.name}>{formatNumber(series.values[index], 2)}</td>)}</tr>)}</tbody>
    </table>
    <div className="h-full" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        {kind === "line" ? <LineChart data={rows} margin={margin}>{children}{data.series.map((series, s) => <Line key={s} name={series.name} dataKey={`s${s}`} stroke={colors[s % colors.length]} strokeWidth={stroke} dot={false} isAnimationActive={false} />)}</LineChart>
          : kind === "area" ? <AreaChart data={rows} margin={margin}>{children}{data.series.map((series, s) => <Area key={s} name={series.name} dataKey={`s${s}`} stroke={colors[s % colors.length]} fill={colors[s % colors.length]} fillOpacity={0.2} strokeWidth={stroke} isAnimationActive={false} />)}</AreaChart>
          : <BarChart data={rows} margin={margin}>{children}{data.series.map((series, s) => <Bar key={s} name={series.name} dataKey={`s${s}`} fill={colors[s % colors.length]} radius={[Math.round(tick / 3), Math.round(tick / 3), 0, 0]} isAnimationActive={false} />)}</BarChart>}
      </ResponsiveContainer>
    </div>
  </div>;
}

function cellText(value: string | number | null, type: string) {
  if (value === null || value === "") return "–";
  if (typeof value === "number") return formatNumber(value, 2);
  if (type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return formatSwedish(`${value}T12:00:00`, { day: "numeric", month: "short" });
  return value;
}

function TableBody({ data, onShown }: { data: TableShape; onShown: (shown: Shown | null) => void }) {
  const box = useRef<HTMLDivElement | null>(null);
  const fit = useFitCount(box, data.rows.length);
  useReportShown(fit, data.rows.length, data.total ?? data.rows.length, onShown);
  if (!data.rows.length) return <Placeholder text="Inget att visa just nu." />;
  return <div className="h-full overflow-hidden" ref={box}>
    <table className="w-full table-fixed border-collapse text-[0.85em]">
      <thead><tr className="border-b text-left text-muted-foreground">{data.columns.map((column) => <th key={column.key} scope="col" className={cn("truncate px-[0.4em] py-[0.25em] font-medium", column.type === "number" && "text-right")}>{column.label}</th>)}</tr></thead>
      <tbody>{data.rows.map((row, index) => <tr key={index} data-fit-item="" className={cn("border-b last:border-0", index >= fit && "invisible")} aria-hidden={index >= fit ? true : undefined}>
        {data.columns.map((column) => column.type === "status"
          ? <td key={column.key} className="px-[0.4em] py-[0.3em]"><StateDot state={String(row[column.key] ?? "")} /></td>
          : <td key={column.key} className={cn("truncate px-[0.4em] py-[0.3em]", column.type === "number" && "text-right tabular-nums")} title={String(row[column.key] ?? "")}>{cellText(row[column.key] ?? null, column.type)}</td>)}
      </tr>)}</tbody>
    </table>
  </div>;
}

function StateDot({ state }: { state: string }) {
  const value = statusStateOf(state);
  return <span className="inline-flex items-center gap-[0.35em]"><span className={cn("size-[0.75em] rounded-full", indicatorBar(STATE_TONE[value]))} aria-hidden="true" />{STATUS_STATE_LABEL[value]}</span>;
}

function StatusBody({ data, onShown }: { data: StatusShape; onShown: (shown: Shown | null) => void }) {
  const box = useRef<HTMLUListElement | null>(null);
  const fit = useFitCount(box, data.items.length);
  useReportShown(fit, data.items.length, data.items.length, onShown);
  if (!data.items.length) return <Placeholder text="Inget att visa just nu." />;
  return <ul ref={box} className="grid h-full content-start gap-[0.35em] overflow-hidden [grid-template-columns:repeat(auto-fill,minmax(min(100%,9em),1fr))]" aria-label="Status">
    {data.items.map((item, index) => <li key={`${item.name}-${index}`} data-fit-item="" className={cn("flex min-w-0 items-center gap-[0.5em] rounded-md border px-[0.5em] py-[0.35em]", index >= fit && "invisible")} aria-hidden={index >= fit ? true : undefined}>
      <span className={cn("size-[0.9em] shrink-0 rounded-full", indicatorBar(STATE_TONE[item.state]))} aria-hidden="true" />
      <span className="min-w-0"><span className="block truncate font-medium">{item.name}</span><span className="block truncate text-[0.75em] text-muted-foreground">{item.text || STATUS_STATE_LABEL[item.state]}</span></span>
      <span className="sr-only">{STATUS_STATE_LABEL[item.state]}</span>
    </li>)}
  </ul>;
}

function EventsBody({ data, onShown }: { data: EventsShape; onShown: (shown: Shown | null) => void }) {
  const box = useRef<HTMLOListElement | null>(null);
  const fit = useFitCount(box, data.items.length);
  useReportShown(fit, data.items.length, data.items.length, onShown);
  if (!data.items.length) return <Placeholder text="Inget har hänt ännu." />;
  return <ol ref={box} className="h-full space-y-[0.35em] overflow-hidden" aria-label="Händelser">
    {data.items.map((item, index) => {
      const Icon = item.level === "error" ? CircleAlert : item.level === "warning" ? TriangleAlert : Info;
      const tone: IndicatorTone = item.level === "error" ? "danger" : item.level === "warning" ? "warning" : "info";
      const when = /^\d{4}-\d{2}-\d{2}T/.test(item.at) ? formatSwedish(item.at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : item.at;
      return <li key={index} data-fit-item="" className={cn("flex min-w-0 items-start gap-[0.5em]", index >= fit && "invisible")} aria-hidden={index >= fit ? true : undefined}>
        <Icon className={cn("mt-[0.15em] size-[1em] shrink-0", indicatorText(tone))} aria-hidden="true" />
        <span className="min-w-0 flex-1"><span className="block truncate font-medium">{item.title}</span><span className="block truncate text-[0.75em] text-muted-foreground">{[when, item.detail].filter(Boolean).join(" · ")}</span></span>
      </li>;
    })}
  </ol>;
}

function PlainBody({ card, editing, now }: { card: BoardCard; editing: boolean; now: number }) {
  const imageUrl = useContext(ImageUrlContext);
  if (card.type === "text") {
    const heading = card.settings.heading?.trim();
    const text = card.settings.body?.trim();
    if (!heading && !text) return <Placeholder text={editing ? "Skriv en rubrik eller en text." : ""} />;
    return <div className={cn("flex h-full min-w-0 flex-col justify-center gap-[0.3em] overflow-hidden", card.settings.align === "center" && "items-center text-center")}>
      {heading ? <p className={cn("text-[1.5em] font-bold leading-tight [overflow-wrap:anywhere]", card.settings.emphasis === "tinted" && "text-[var(--card-accent)]")}>{heading}</p> : null}
      {text ? <p className="board-card-text whitespace-pre-line [overflow-wrap:anywhere]" data-large={card.settings.large ? "" : undefined}>{text}</p> : null}
    </div>;
  }
  if (card.type === "image") {
    if (!card.settings.imageId) return <div className="flex h-full items-center justify-center rounded-md border border-dashed text-muted-foreground"><ImageIcon className="size-[2em]" aria-hidden="true" /><span className="sr-only">{editing ? "Välj en bild." : "Ingen bild."}</span></div>;
    // eslint-disable-next-line @next/next/no-img-element -- the board's own picture through Workflow's own route, any size
    return <img src={imageUrl(card.settings.imageId)} alt={card.settings.alt ?? ""} className={cn("size-full rounded-md", card.settings.fit === "cover" ? "object-cover" : "object-contain")} />;
  }
  if (card.type === "clock") return <ClockBody card={card} now={now} />;
  return null;
}

/** The clock follows Swedish time and ticks by itself (every second with seconds shown, else every 15 seconds). */
function ClockBody({ card }: { card: BoardCard; now: number }) {
  const seconds = Boolean(card.settings.showSeconds);
  const [time, setTime] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setTime(Date.now()), seconds ? 1000 : 15_000);
    return () => window.clearInterval(timer);
  }, [seconds]);
  const date = new Date(time);
  const clock = formatSwedish(date, { hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}) });
  const day = formatSwedish(date, { weekday: "long", day: "numeric", month: "long" });
  return <div className="flex h-full min-w-0 flex-col items-center justify-center text-center" role="timer" aria-label={`Klockan är ${clock}`}>
    <p className="board-clock font-bold tabular-nums" data-seconds={seconds ? "" : undefined} suppressHydrationWarning>{clock}</p>
    {card.settings.showDate !== false || card.settings.showWeek ? <p className="board-clock-date mt-[0.2em] max-w-full truncate text-muted-foreground first-letter:uppercase" suppressHydrationWarning>
      {[card.settings.showDate !== false ? day : "", card.settings.showWeek ? `vecka ${isoWeekOf(date)}` : ""].filter(Boolean).join(" · ")}
    </p> : null}
  </div>;
}
