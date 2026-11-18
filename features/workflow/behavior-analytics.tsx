"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useRouter, useSearchParams } from "next/navigation";
import { AppWindow, Cookie, Eye, Globe, type LucideIcon, MousePointerClick, MonitorSmartphone, PlayCircle, Route, ShieldCheck, Trash2, UserCheck, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { Panel } from "@/features/kfid/ui";
import { GrowBar, Sparkline, Trend } from "@/features/overview/viz";
import { StatisticsSkeleton } from "@/components/skeleton";
import { addReportDays, changePercent, periodTotals, type PeriodTotals, type RankedRow, type Report } from "@/lib/analytics/report";
import { demoInsights, type Insights, rankByCount, siteInsights } from "@/lib/analytics/insights";
import type { AnalyticsSettings } from "@/lib/analytics/settings-model";
import { formatSwedish, swedishDayKey } from "@/lib/swedish-time";
import { useLoadEffect } from "@/lib/use-load-effect";
import { ListToolbar, PageHeader } from "@/components/page-shell";
import { DownloadButton } from "@/components/ui/download-button";
import { InPageTabs, type InPageTab } from "@/features/workflow/in-page-tabs";
import type { FunnelStep } from "@/lib/analytics/catalog";

type ComparedReport = Report & { previous: PeriodTotals & { from: string; to: string } };
/** Egna besök (2026-11-16): whether this browser is switched off, the shared domain it then holds for, and the own company. */
type OwnVisits = { browserExcluded: boolean; sharedDomain: string | null; company: string };
type Data = { settings: AnalyticsSettings; funnelAvailable: boolean; retentionChoices: number[]; today: string; first: string | null; report: ComparedReport; own: OwnVisits };

const PRESETS = [{ days: 7, label: "7 dagar" }, { days: 30, label: "30 dagar" }, { days: 90, label: "90 dagar" }, { days: 365, label: "12 månader" }] as const;
/**
 * The two parts of the page (2026-11-14: "Det skall vara en tydlig skillnad mellan demo och kundernas statistik"):
 * the public website with the demo, and the logged-in companies in the app. The chosen part stays in the address (?tab=).
 */
type Part = "web" | "app";
const PARTS: readonly InPageTab<Part>[] = [{ key: "web", label: "Webbplats och demo", icon: Globe }, { key: "app", label: "Kunderna i appen", icon: AppWindow }];
const partOf = (value: string | null): Part => (value === "app" ? "app" : "web");
/** The funnel's steps in plain words (the catalog's short names stay in the CSV). */
const STEP_TEXT: Record<FunnelStep, string> = { landing: "Besökte startsidan", pricing: "Tittade på priserna", register: "Gick till Skapa konto", checkout: "Gick till betalningen" };
const number = (value: number) => value.toLocaleString("sv-SE");
const day = (value: string) => formatSwedish(`${value}T12:00:00`, { day: "numeric", month: "short" });
const percentText = (value: number | null) => (value === null ? "–" : `${value.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} %`);
const signed = (value: number, unit: string) => `${value > 0 ? "+" : value < 0 ? "−" : "±"}${Math.abs(value).toLocaleString("sv-SE", { maximumFractionDigits: 1 })}${unit}`;

/** One series of a time chart: its key in the rows, its name and its colour (the two shared chart colours). */
type Series = { key: string; name: string; color: "var(--viz-1)" | "var(--viz-2)" };
type Point = { name: string } & Record<string, number | string>;

/**
 * A count over time (the app's Recharts look, as Uppgiftsstatistik): one axis, a recessive grid, a legend with two series
 * or more, a tooltip on hover and, under it, the same figures as a table. Fixed height, so nothing moves when it draws.
 */
function TimeChart({ rows, series, kind, label, testId, tableTestId, unit, height = "h-64" }: {
  rows: Point[]; series: Series[]; kind: "bar" | "line"; label: string; testId: string; tableTestId: string; unit: string; height?: string;
}) {
  const axis = { tick: { fontSize: 12, fill: "var(--muted-foreground)" }, tickLine: false } as const;
  const tooltip = <Tooltip cursor={kind === "bar" ? { fill: "var(--muted)", opacity: 0.5 } : { stroke: "var(--border)" }} contentStyle={{ background: "var(--card)", color: "var(--foreground)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />;
  const grid = <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />;
  const legend = series.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null;
  const margin = { top: 12, right: 8, left: -18, bottom: 0 };
  return <>
    <div className={`${height} min-w-0 overflow-hidden`} role="img" aria-label={label} data-testid={testId}>
      <ResponsiveContainer width="100%" height="100%">
        {kind === "bar" ? <BarChart data={rows} margin={margin} barGap={2}>
          {grid}<XAxis dataKey="name" {...axis} minTickGap={24} /><YAxis allowDecimals={false} {...axis} axisLine={false} />{tooltip}{legend}
          {series.map((item) => <Bar key={item.key} name={item.name} dataKey={item.key} fill={item.color} radius={[4, 4, 0, 0]} maxBarSize={18} />)}
        </BarChart> : <LineChart data={rows} margin={margin}>
          {grid}<XAxis dataKey="name" {...axis} minTickGap={24} /><YAxis allowDecimals={false} {...axis} axisLine={false} />{tooltip}{legend}
          {series.map((item) => <Line key={item.key} type="monotone" name={item.name} dataKey={item.key} stroke={item.color} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }} />)}
        </LineChart>}
      </ResponsiveContainer>
    </div>
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-xs font-medium text-primary">Visa som tabell</summary>
      <div className="mt-2 max-h-72 overflow-auto rounded-lg border">
        <table className="w-full text-left text-xs" data-testid={tableTestId}>
          <caption className="sr-only">{label}</caption>
          <thead className="sticky top-0 bg-secondary"><tr><th scope="col" className="px-3 py-2">{unit}</th>{series.map((item) => <th key={item.key} scope="col" className="px-3 py-2 text-right">{item.name}</th>)}</tr></thead>
          <tbody>{rows.map((row) => <tr key={row.name} className="border-t"><th scope="row" className="px-3 py-1.5 font-normal">{row.name}</th>{series.map((item) => <td key={item.key} className="px-3 py-1.5 text-right tabular-nums">{number(Number(row[item.key]) || 0)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  </>;
}

/** A ranked list: the label, the count and its share, with a thin bar (the overview's GrowBar). */
function RankedList({ title, rows, testId, color = "bg-[var(--viz-1)]", empty = "Inget under perioden." }: { title: string; rows: RankedRow[]; testId: string; color?: string; empty?: string }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return <div className="min-w-0" data-testid={testId}>
    <h3 className="mb-3 text-sm font-semibold">{title}</h3>
    {total ? <ul className="space-y-3">
      {rows.map((row) => <li key={row.key}>
        <div className="mb-1 flex justify-between gap-3 text-sm"><span className="min-w-0 truncate">{row.label}</span><span className="shrink-0 tabular-nums"><strong>{number(row.count)}</strong> <span className="text-xs text-muted-foreground">{percentText(row.share)}</span></span></div>
        <GrowBar value={row.count} max={max} fill={color} />
      </li>)}
    </ul> : <p className="text-sm text-muted-foreground">{empty}</p>}
  </div>;
}

/** The period in a few plain lines and what they may mean (2026-11-16), above the lists. */
function InsightLines({ insights, testId }: { insights: Insights; testId: string }) {
  if (!insights.facts.length) return null;
  return <div className="rounded-lg border bg-muted/40 p-3 text-sm" data-testid={testId}>
    <ul className="list-disc space-y-1 pl-5">{insights.facts.map((line) => <li key={line}>{line}</li>)}</ul>
    {insights.meaning.length ? <p className="mt-2 text-xs text-muted-foreground"><strong className="text-foreground">Vad det kan betyda:</strong> {insights.meaning.join(" ")}</p> : null}
  </div>;
}

type Tile = { label: string; value: string; detail: string; icon: LucideIcon; tone: string; testId: string; change: ReactNode; spark?: number[] };

const noChange = <span className="text-xs text-muted-foreground">–</span>;
/** The change against the period before in percent; "Ny" when the period before had nothing. */
function change(now: number, before: number): ReactNode {
  const value = changePercent(now, before);
  if (value === null) return now > 0 ? <Trend value={1} text="Ny" good="up" /> : noChange;
  return <Trend value={value} text={signed(value, " %")} good="up" />;
}
/** A share's change in percentage points. */
function changePoints(now: number | null, before: number | null): ReactNode {
  if (now === null || before === null) return noChange;
  const points = Math.round((now - before) * 10) / 10;
  return <Trend value={points} text={signed(points, " p")} good="up" />;
}

function KpiTile({ tile }: { tile: Tile }) {
  const Icon = tile.icon;
  return <div className={`stat-card stat-${tile.tone} !items-start`} data-testid={tile.testId}>
    <span className="stat-icon"><Icon className="size-5" /></span>
    <div className="min-w-0 flex-1">
      <p className="truncate text-xs text-muted-foreground">{tile.label}</p>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1"><span className="text-2xl font-semibold tabular-nums">{tile.value}</span><span title="Mot perioden före">{tile.change}</span></p>
      <p className="truncate text-xs text-muted-foreground">{tile.detail}</p>
      {/* Always the same height, so a tile without a line keeps the row even. */}
      <div className="mt-2 h-6 text-[var(--viz-1)]" aria-hidden="true">{tile.spark && tile.spark.length > 1 && tile.spark.some(Boolean) ? <Sparkline values={tile.spark} height={24} label={`${tile.label} per dag`} /> : null}</div>
    </div>
  </div>;
}

/**
 * Beteendeanalys (2026-10-07, förnyad 2026-11-11), under Installation: the public pages, the open demo and
 * the app, counted as anonymous sums per day on the own server. Key figures with the change against the period before,
 * trends per day or week, the funnel with its conversion, the ways into the demo and the most used parts. Two tabs since
 * 2026-11-14: Webbplats och demo (public visitors) and Kunderna i appen (logged-in companies), each with its own tiles. Charts follow
 * the data-viz rules: one axis, a legend for two series, recessive grid, text in ordinary ink, a table under every chart.
 */
export function BehaviorAnalytics({ notify }: { notify: (text: string, error?: boolean) => void }) {
  const [confirm, confirmCard] = useConfirm();
  const router = useRouter();
  const searchParams = useSearchParams();
  const part = partOf(searchParams.get("tab"));
  // A step of its own, as every tab row (2026-11-02): Tillbaka goes to the part before.
  const selectPart = (next: Part) => router.push(next === "web" ? "/?view=behavior_analytics" : `/?view=behavior_analytics&tab=${next}`, { scroll: false });
  const [range, setRange] = useState(() => { const today = swedishDayKey(new Date()); return { from: addReportDays(today, -29), to: today }; });
  const [bucket, setBucket] = useState<"day" | "week">("day");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<Data>(`/api/superadmin/analytics?from=${range.from}&to=${range.to}`, { cache: "no-store" }));
      setError("");
    } catch (issue) { setError((issue as Error).message); }
    finally { setLoading(false); }
  }, [range.from, range.to]);
  useLoadEffect(load);
  const save = async (patch: Record<string, unknown>, done: string) => {
    setBusy(true);
    try { await api("/api/superadmin/analytics", { method: "POST", body: JSON.stringify(patch) }); notify(done); await load(); }
    catch (issue) { notify((issue as Error).message, true); }
    finally { setBusy(false); }
  };
  const reset = async () => {
    if (!(await confirm({ title: "Nollställ beteendeanalysen?", message: "Alla räknare raderas: sidvisningar, använda funktioner, webbplatsen, demobesök, stegen från startsidan och svaren om kakor. Det går inte att ångra. Exportera först om du vill spara dem.", confirmLabel: "Nollställ", tone: "danger" }))) return;
    await save({ reset: true }, "Beteendeanalysen är nollställd.");
  };
  const report = data?.report;
  const unit = bucket === "day" ? "Dag" : "Vecka";
  const per = bucket === "day" ? "dag" : "vecka";
  const appRows = useMemo<Point[]>(() => !report ? [] : bucket === "day" ? report.daily.map((point) => ({ name: day(point.date), pages: point.pages, features: point.features }))
    : report.weekly.map((point) => ({ name: `${point.label} (${day(point.date)})`, pages: point.pages, features: point.features })), [report, bucket]);
  const publicRows = useMemo<Point[]>(() => !report ? [] : (bucket === "day" ? report.publicDaily : report.publicWeekly).map((point) => ({
    name: bucket === "day" ? day(point.date) : `${point.label} (${day(point.date)})`, landing: point.landing, register: point.register, statistics: point.statistics, necessary: point.necessary, demoStarts: point.demoStarts, landingViews: point.landingViews,
  })), [report, bucket]);
  const csvHref = `/api/superadmin/analytics?format=csv&from=${range.from}&to=${range.to}`;
  const today = data?.today ?? swedishDayKey(new Date());
  const now = report ? periodTotals(report) : null;
  const before = report?.previous;
  const funnel = Boolean(data?.funnelAvailable);
  const webTiles: Tile[] = now && before && report ? [
    ...(funnel ? [{ label: "Sidvisningar på webbplatsen", value: number(now.landingViews), detail: "startsidan och undersidorna", icon: MonitorSmartphone, tone: "sky", testId: "kpi-site", change: change(now.landingViews, before.landingViews), spark: report.publicDaily.map((point) => point.landingViews) }] : []),
    { label: "Demostarter", value: number(now.demoStarts), detail: "besök som öppnade demon", icon: PlayCircle, tone: "emerald", testId: "kpi-demo", change: change(now.demoStarts, before.demoStarts), spark: report.publicDaily.map((point) => point.demoStarts) },
    ...(funnel ? [
      { label: "Besök på startsidan", value: number(now.landing), detail: "som tillåtit statistik", icon: Globe, tone: "sky", testId: "kpi-landing", change: change(now.landing, before.landing), spark: report.publicDaily.map((point) => point.landing) },
      { label: "Till Skapa konto", value: number(now.register), detail: now.registerRate === null ? "besök som tillåtit statistik" : `${percentText(now.registerRate)} av besöken på startsidan`, icon: UserPlus, tone: "violet", testId: "kpi-register", change: change(now.register, before.register), spark: report.publicDaily.map((point) => point.register) },
      { label: "Tillåter statistik", value: percentText(now.consentRate), detail: `${number(now.statistics)} av ${number(now.statistics + now.necessary)} svar`, icon: UserCheck, tone: "amber", testId: "kpi-consent", change: changePoints(now.consentRate, before.consentRate), spark: report.publicDaily.map((point) => point.statistics) },
    ] : []),
  ] : [];
  const appTiles: Tile[] = now && before && report ? [
    { label: "Sidvisningar i appen", value: number(now.pageViews), detail: "inloggade i alla företag", icon: Eye, tone: "sky", testId: "kpi-pages", change: change(now.pageViews, before.pageViews), spark: report.daily.map((point) => point.pages) },
    { label: "Använda funktioner", value: number(now.featureUses), detail: "skapa, skicka, hämta och mer", icon: MousePointerClick, tone: "emerald", testId: "kpi-features", change: change(now.featureUses, before.featureUses), spark: report.daily.map((point) => point.features) },
  ] : [];
  const funnelMax = Math.max(1, ...(report?.funnel.steps.map((step) => step.count) ?? [1]));

  return <div className="analytics-viz space-y-6" data-testid="behavior-analytics">
    {/* The two series colours of the shared chart palette (blue, orange), stepped for the dark surface; checked with the data-viz validator. */}
    <style>{`.analytics-viz{--viz-1:#2a78d6;--viz-2:#eb6834}html[data-theme="dark"] .analytics-viz{--viz-1:#3987e5;--viz-2:#d95926}`}</style>
    {confirmCard}
    <PageHeader title="Beteendeanalys" description="Hur webbplatsen, demon och appen används, räknat som anonyma summor per dag på den egna servern." />
    {error ? <p role="alert" className="notice text-destructive">{error}</p> : null}

    <ListToolbar label="Period">
      <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Period">
        <div className="flex flex-wrap gap-1 rounded-full border bg-card p-1">
          {PRESETS.map((preset) => {
            const active = range.to === today && range.from === addReportDays(today, -(preset.days - 1));
            return <Button key={preset.days} type="button" size="sm" className="h-7 rounded-full" variant={active ? "default" : "ghost"} aria-pressed={active}
              onClick={() => setRange({ from: addReportDays(today, -(preset.days - 1)), to: today })}>{preset.label}</Button>;
          })}
        </div>
        <label className="space-y-1 text-xs text-muted-foreground">Från<Input type="date" aria-label="Från datum" value={range.from} max={range.to} onChange={(event) => event.target.value && setRange((current) => ({ ...current, from: event.target.value }))} /></label>
        <label className="space-y-1 text-xs text-muted-foreground">Till<Input type="date" aria-label="Till datum" value={range.to} min={range.from} max={data?.today} onChange={(event) => event.target.value && setRange((current) => ({ ...current, to: event.target.value }))} /></label>
        <div className="flex gap-1 rounded-full border bg-card p-1" role="group" aria-label="Gruppering">
          {([["day", "Dagar"], ["week", "Veckor"]] as const).map(([value, label]) => <Button key={value} type="button" size="sm" className="h-7 rounded-full" variant={bucket === value ? "default" : "ghost"} aria-pressed={bucket === value} onClick={() => setBucket(value)}>{label}</Button>)}
        </div>
      </div>
      {/* The line keeps its height before the figures come, so nothing under it moves. */}
      <p className="min-h-4 text-xs text-muted-foreground" data-testid="analytics-own">{data ? `Egna besök räknas inte. ${data.own.browserExcluded ? "Den här webbläsaren räknas inte." : "Den här webbläsaren räknas (ändra under Insamling)."}` : " "}</p>
      <p className="min-h-4 text-xs text-muted-foreground" data-testid="analytics-period">{report ? `${day(report.from)} – ${day(report.to)}, jämfört med ${day(report.previous.from)} – ${day(report.previous.to)}.` : " "}</p>
    </ListToolbar>

    {!report ? (!error ? <StatisticsSkeleton label="Hämtar beteendeanalysen…" /> : null) : <div aria-busy={loading || undefined}>
      <InPageTabs label="Statistik för" tabs={PARTS} current={part} onSelect={selectPart} idBase="analytics" testId="analytics-tabs" />
      <div role="tabpanel" id="analytics-panel" aria-labelledby={`analytics-tab-${part}`} className="space-y-6" data-testid={`analytics-part-${part}`}>
        <div className={`grid grid-cols-2 gap-3 ${(part === "web" ? webTiles : appTiles).length > 4 ? "lg:grid-cols-3 2xl:grid-cols-5" : "xl:grid-cols-4"}`} data-testid="analytics-kpis">
          {(part === "web" ? webTiles : appTiles).map((tile) => <KpiTile key={tile.testId} tile={tile} />)}
        </div>

        {part === "web" ? <>
          {funnel ? <div data-testid="analytics-site-panel"><Panel title="Webbplatsen" icon={MonitorSmartphone} description="Räknat per sidvisning och knapptryck utan kaka, så ingen känns igen mellan besöken.">
            {report.landing.hasData ? <div className="space-y-6" data-testid="analytics-site">
              <InsightLines insights={siteInsights(report.landing)} testId="analytics-site-insights" />
              <TimeChart rows={publicRows} kind="bar" unit={unit} label={`Sidvisningar på webbplatsen per ${per}`} testId="analytics-site-chart" tableTestId="analytics-site-table" height="h-56"
                series={[{ key: "landingViews", name: "Sidvisningar", color: "var(--viz-1)" }]} />
              <div className="@container"><div className="grid gap-6 @2xl:grid-cols-2 @5xl:grid-cols-3">
                <RankedList title="Mest visade sidor" rows={report.landing.pages} testId="analytics-site-pages" />
                <RankedList title="Mest tryckta knappar" rows={rankByCount(report.landing.clicks)} testId="analytics-site-clicks" color="bg-[var(--viz-2)]" />
                <RankedList title="Varifrån besökarna kom" rows={report.landing.sources} testId="analytics-site-sources" />
                <RankedList title="Skärm" rows={report.landing.devices} testId="analytics-site-devices" color="bg-[var(--viz-2)]" />
              </div></div>
              <p className="text-sm" data-testid="analytics-site-newsletter">Nyhetsbrevet: <strong className="tabular-nums">{number(report.landing.newsletter.requested)}</strong> anmälningar, <strong className="tabular-nums">{number(report.landing.newsletter.confirmed)}</strong> bekräftade.</p>
              <p className="text-xs text-muted-foreground">Bara webbplatsens namn sparas, aldrig hela adressen. Besök inom webbplatsen räknas inte som en väg in.</p>
            </div> : <p className="text-sm text-muted-foreground" data-testid="analytics-site-empty">Inget har räknats på webbplatsen under perioden. Det räknas från 16 nov 2026.</p>}
          </Panel></div> : null}

          {funnel && data ? <>
            <div data-testid="analytics-public"><Panel title="Från startsidan till betalning" icon={Route} description="Bara besök som har tillåtit statistik räknas, en gång per steg.">
              {!data.settings.funnel ? <p className="notice mb-4 text-sm" data-testid="analytics-funnel-off">Mätningen av startsidan är avstängd. Slå på den under Insamling längst ned.</p> : null}
              {report.funnel.hasData ? <ol className="space-y-4" data-testid="analytics-funnel-steps">
                {report.funnel.steps.map((step) => <li key={step.step} data-testid={`funnel-${step.step}`}>
                  <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
                    <span className="font-medium">{STEP_TEXT[step.step]}</span>
                    <span className="tabular-nums"><strong>{number(step.count)}</strong>{step.ofPrevious !== null ? <span className="ml-2 text-xs text-muted-foreground">{percentText(step.ofPrevious)} av förra steget · {percentText(step.ofFirst)} av alla</span> : null}</span>
                  </div>
                  <GrowBar value={step.count} max={funnelMax} className="h-3" fill="bg-[var(--viz-1)]" />
                </li>)}
              </ol> : <p className="text-sm text-muted-foreground" data-testid="funnel-empty">Ingen har tillåtit statistik under perioden.</p>}
              {report.funnel.hasData ? <p className="mt-4 text-xs text-muted-foreground">Gick hela vägen till betalningen: <strong className="tabular-nums text-foreground">{percentText(report.funnel.conversion)}</strong> av besöken på startsidan.</p> : null}
            </Panel></div>

            <div data-testid="analytics-consent"><Panel title="Svar på frågan om kakor" icon={Cookie} description="Svaren räknas utan kaka, så de visar bara hur många som valde vad.">
              {report.consent.statistics + report.consent.necessary ? <>
                <p className="mb-2 text-xs text-muted-foreground">{number(report.consent.statistics)} valde Tillåt statistik och {number(report.consent.necessary)} valde Bara nödvändiga.</p>
                <TimeChart rows={publicRows} kind="line" unit={unit} label={`Svar på frågan om kakor per ${per}`} testId="analytics-consent-chart" tableTestId="analytics-public-table"
                  series={[{ key: "statistics", name: "Tillåt statistik", color: "var(--viz-1)" }, { key: "necessary", name: "Bara nödvändiga", color: "var(--viz-2)" }]} />
              </> : <p className="text-sm text-muted-foreground" data-testid="consent-empty">Ingen har svarat på frågan om kakor under perioden.</p>}
            </Panel></div>
          </> : null}

          <div data-testid="analytics-demo-panel"><Panel title="Demon" icon={PlayCircle} description="Räknat per besök utan kaka och IP-adress, så ingen känns igen mellan besöken.">
            {report.demo.hasData ? <div className="space-y-6" data-testid="analytics-demo">
              <InsightLines insights={demoInsights(report.demo)} testId="analytics-demo-insights" />
              <TimeChart rows={publicRows} kind="bar" unit={unit} label={`Demostarter per ${per}`} testId="analytics-demo-chart" tableTestId="analytics-demo-table" height="h-56"
                series={[{ key: "demoStarts", name: "Demostarter", color: "var(--viz-2)" }]} />
              <div className="@container"><div className="grid gap-6 @2xl:grid-cols-2 @5xl:grid-cols-3">
                <RankedList title="Hur demon startades" rows={report.demo.starts.rows} testId="analytics-demo-ways" color="bg-[var(--viz-2)]" />
                <RankedList title="Varifrån besökarna kom" rows={report.demo.sources} testId="analytics-demo-sources" color="bg-[var(--viz-2)]" empty="Inget under perioden. Det räknas från 11 nov 2026." />
                <RankedList title="Ungefärlig tid i demon" rows={report.demo.time} testId="analytics-demo-time" />
                <RankedList title="Sidor i demon" rows={report.demo.views} testId="analytics-demo-views" />
                <RankedList title="Vad besökarna gjorde" rows={report.demo.flows} testId="analytics-demo-flows" />
                <RankedList title="Skärm" rows={report.demo.devices} testId="analytics-demo-devices" color="bg-[var(--viz-2)]" empty="Inget under perioden. Det räknas från 16 nov 2026." />
              </div></div>
              <p className="text-xs text-muted-foreground">Bara typen av webbplats sparas, aldrig adressen, och tiden räknas tills sidan lämnas eller döljs.</p>
            </div> : <p className="text-sm text-muted-foreground" data-testid="analytics-demo-empty">Ingen har öppnat demon under perioden.</p>}
          </Panel></div>
        </> : <div data-testid="analytics-app"><Panel title="Sidor och funktioner" icon={AppWindow} description="Inloggade användare i alla företag, räknat utan person eller företag.">
          {report.hasData ? <div className="space-y-6">
            <TimeChart rows={appRows} kind="bar" unit={unit} label={`Sidvisningar och använda funktioner per ${per}`} testId="analytics-chart" tableTestId="analytics-table"
              series={[{ key: "pages", name: "Sidvisningar", color: "var(--viz-1)" }, { key: "features", name: "Använda funktioner", color: "var(--viz-2)" }]} />
            <div className="@container"><div className="grid gap-6 @2xl:grid-cols-2">
              <RankedList title="Mest besökta sidor" rows={report.pages} testId="analytics-top-pages" />
              <RankedList title="Mest använda funktioner" rows={report.features} testId="analytics-top-features" color="bg-[var(--viz-2)]" />
            </div></div>
          </div> : <p className="text-sm text-muted-foreground" data-testid="analytics-empty">Inget har räknats i appen under perioden.</p>}
        </Panel></div>}
      </div>
    </div>}

    <Panel title="Insamling" description="Vad som räknas, hur länge det sparas och hur du tar ut eller nollställer det." icon={ShieldCheck}>
      {!data ? <p role="status" className="text-sm text-muted-foreground">Hämtar inställningarna…</p> : <div className="space-y-4">
        <label className="flex items-start gap-3 text-sm" htmlFor="analytics-usage">
          <Checkbox id="analytics-usage" data-testid="analytics-usage" checked={data.settings.usage} disabled={busy}
            onCheckedChange={(checked) => void save({ usage: checked === true }, checked === true ? "Räkningen i appen är påslagen." : "Räkningen i appen är avstängd.")} />
          <span><span className="font-medium">Räkna appen, demon och webbplatsen</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">Anonyma summor per dag, utan kaka. Inget om person eller webbläsare sparas, så samtycke behövs inte.</span></span>
        </label>
        {data.funnelAvailable ? <label className="flex items-start gap-3 text-sm" htmlFor="analytics-funnel">
          <Checkbox id="analytics-funnel" data-testid="analytics-funnel" checked={data.settings.funnel} disabled={busy}
            onCheckedChange={(checked) => void save({ funnel: checked === true }, checked === true ? "Mätningen av startsidan är påslagen." : "Mätningen av startsidan är avstängd.")} />
          <span><span className="font-medium">Mät startsidan: vägen till betalning och svaren om kakor</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">Vägen mäts bara efter Tillåt statistik, och kakan wf-stat minns bara vilka steg besöket har nått.</span></span>
        </label> : null}
        {/* Egna besök (2026-11-15/16): the own company is never counted; this browser on the owner's own press. */}
        <label className="flex items-start gap-3 text-sm" htmlFor="analytics-browser">
          <Checkbox id="analytics-browser" data-testid="analytics-browser" checked={data.own.browserExcluded} disabled={busy}
            onCheckedChange={(checked) => void save({ browser: checked === true ? "exclude" : "include" }, checked === true ? "Den här webbläsaren räknas inte längre." : "Den här webbläsaren räknas igen.")} />
          <span><span className="font-medium">Räkna inte den här webbläsaren</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">
            {data.own.sharedDomain ? `Gäller appen och ${data.own.sharedDomain}.` : "Gäller appens adress."} Sätter kakan wf-no-stats i webbläsaren. Superadmin och alla i {data.own.company} räknas aldrig i appen.</span></span>
        </label>
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-xs text-muted-foreground">Räknarna sparas
            <select className="form-select" aria-label="Lagringstid för räknarna" data-testid="analytics-retention" value={data.settings.retentionMonths} disabled={busy}
              onChange={(event) => void save({ retentionMonths: Number(event.target.value) }, "Lagringstiden är sparad.")}>
              {data.retentionChoices.map((months) => <option key={months} value={months}>{months} månader{months === 14 ? " (standard)" : ""}</option>)}
            </select>
          </label>
          <DownloadButton href={csvHref} download data-testid="analytics-export">Exportera CSV</DownloadButton>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void reset()} data-testid="analytics-reset"><Trash2 />Nollställ</Button>
        </div>
        <p className="text-xs text-muted-foreground">Äldre räknare rensas av nattjobbet. {data.first ? `Första räkningen: ${formatSwedish(`${data.first}T12:00:00`, { dateStyle: "long" })}.` : "Inget har räknats ännu."}</p>
      </div>}
    </Panel>
  </div>;
}
