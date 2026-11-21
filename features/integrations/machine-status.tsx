"use client";
import { useCallback, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RowsSkeleton, ShowMore } from "@/features/kfid/ui";
import { api } from "@/features/kfid/api";
import { formatSwedish } from "@/lib/swedish-time";
import { useLoadEffect } from "@/lib/use-load-effect";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { MACHINE_SEVERITY_LABELS, MACHINE_SEVERITY_TONE, machineEventLine, type MachineStatus } from "@/lib/machine/place-status";
import { DEFAULT_KEY_FIGURE_PERIOD, KEY_FIGURE_PERIODS, type KeyFigurePeriod } from "@/lib/machine/key-figures";

/**
 * Integrationsmotorn E1 (2026-10-24, "status … och en flik Händelser"): the status row for the machines and their
 * Händelser. Since Underhåll (2026-10-30) they belong to a machine part in the maintenance module's own tree, never to
 * a place in the customer's place tree: the part's tabs Händelser and Översikt (features/maintenance/). What the server gives
 * a member who may read Underhåll; the list is read when it is opened.
 */
const when = (value: string) => formatSwedish(value, { dateStyle: "short", timeStyle: "short" });

export function MachineStatusRow({ status, eventsOpen = false, onEvents, figuresOpen = false, onKeyFigures }: { status: MachineStatus; eventsOpen?: boolean; onEvents?: () => void; figuresOpen?: boolean; onKeyFigures?: () => void }) {
  const facts = [
    status.sources ? `${status.sources} ${status.sources === 1 ? "källa" : "källor"}` : "",
    status.state && status.stateAt ? `${status.state === "running" ? "I drift" : "Stoppad"} sedan ${when(status.stateAt)}` : "",
    status.lastHeardAt ? `senast hörd ${when(status.lastHeardAt)}` : "",
  ].filter(Boolean).join(" · ");
  return <section className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Maskiner" data-testid="part-machine-status">
    <h4 className="text-xs font-semibold text-muted-foreground">Maskiner</h4>
    <Badge variant="outline" className={indicatorBadge(status.tone)} data-testid="part-machine-state">{status.label}</Badge>
    {facts ? <span className="text-xs text-muted-foreground">{facts}</span> : null}
    {onEvents ? <Button type="button" variant="ghost" size="sm" className="-my-1 text-primary touch:h-11" aria-expanded={eventsOpen} onClick={onEvents} data-testid="part-machine-events-link">{eventsOpen ? "Dölj händelser" : "Händelser"}</Button> : null}
    {onKeyFigures ? <Button type="button" variant="ghost" size="sm" className="-my-1 text-primary touch:h-11" aria-expanded={figuresOpen} onClick={onKeyFigures} data-testid="part-machine-figures-link">{figuresOpen ? "Dölj nyckeltal" : "Nyckeltal"}</Button> : null}
  </section>;
}

type EventRow = { id: string; occurredAt: string; type: string; code: string; severity: string; state: string | null; text: string; sourceName: string; below: string };

/** Fliken Händelser: what the machines on the part (and below it) have sent, newest first, a page at a time, under their status. */
export function PartMachineEvents({ partId }: { partId: string }) {
  const [data, setData] = useState<{ events: EventRow[]; total: number; page: number; status: MachineStatus | null } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (page = 1) => {
    setBusy(true);
    try { setData(await api(`/api/maintenance?part=events&id=${encodeURIComponent(partId)}&page=${page}`, { cache: "no-store" })); setError(""); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }, [partId]);
  useLoadEffect(load);
  return <section aria-label="Händelser" className="space-y-2" data-testid="part-events-section">
    {data?.status ? <MachineStatusRow status={data.status} /> : null}
    {error ? <p role="alert" className="notice mt-1.5 text-destructive" data-testid="part-events-error">{error}</p>
      : !data ? <RowsSkeleton rows={2} dense label="Hämtar händelserna…" />
      : !data.events.length ? <p className="mt-1 text-sm text-muted-foreground" data-testid="part-events-empty">Inga händelser från maskinkopplingen. Koppla en källa eller signal till delen under Kopplingar → Maskiner.</p>
      : <ul className="mt-1.5 divide-y" data-testid="part-events">{data.events.map((event) => <li key={event.id} className="grid gap-1 py-2 text-sm sm:grid-cols-[8.5rem_5.5rem_minmax(0,1fr)] sm:items-start" data-testid="part-event">
        <span className="tabular-nums text-xs text-muted-foreground">{when(event.occurredAt)}</span>
        <span><Badge variant="outline" className={indicatorBadge(MACHINE_SEVERITY_TONE[event.severity] ?? "neutral")}>{MACHINE_SEVERITY_LABELS[event.severity] ?? event.severity}</Badge></span>
        <span className="min-w-0 [overflow-wrap:anywhere]"><span className="font-medium">{machineEventLine(event)}</span>
          <span className="block text-xs text-muted-foreground">{[event.sourceName, event.below ? `under ${event.below}` : ""].filter(Boolean).join(" · ")}</span></span>
      </li>)}</ul>}
    {data ? <ShowMore shown={data.events.length} total={data.total} busy={busy} onMore={() => void load(data.page + 1)} /> : null}
  </section>;
}

type FigureRow = { key: string; label: string; value: string; hint: string; missing: boolean };
type FiguresAnswer = { figures: { periodDays: number; coverageDays: number; partialPeriod: boolean }; rows: FigureRow[]; truncated: boolean };
const PERIOD_LABEL: Record<KeyFigurePeriod, string> = { 30: "30 dagar", 90: "90 dagar", 365: "12 månader", 730: "24 månader" };

/**
 * Integrationsmotorn E6: the machines' key figures for the part and what lies below it – alarms, automatic orders, downtime
 * from the machine's own run state, time to acknowledge and to finish, repair time (MTTR), failure rate and time between
 * failures (MTBF). A figure that cannot be counted says why ("För lite data") instead of showing zero.
 */
export function PartMachineKeyFigures({ partId }: { partId: string }) {
  const [period, setPeriod] = useState<KeyFigurePeriod>(DEFAULT_KEY_FIGURE_PERIOD);
  const [data, setData] = useState<FiguresAnswer | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setData(await api(`/api/maintenance?part=kpi&id=${encodeURIComponent(partId)}&days=${period}`, { cache: "no-store" })); setError(""); }
    catch (cause) { setError((cause as Error).message); }
  }, [partId, period]);
  useLoadEffect(load);
  return <section aria-label="Nyckeltal" data-testid="part-figures-section">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="text-xs font-semibold text-muted-foreground">Nyckeltal</h4>
      <select className="form-select h-8 w-auto text-xs" aria-label="Period" value={period} onChange={(event) => setPeriod(Number(event.target.value) as KeyFigurePeriod)} data-testid="part-figures-period">
        {KEY_FIGURE_PERIODS.map((days) => <option key={days} value={days}>{PERIOD_LABEL[days]}</option>)}
      </select>
    </div>
    {error ? <p role="alert" className="notice mt-1.5 text-destructive" data-testid="part-figures-error">{error}</p>
      : !data ? <RowsSkeleton rows={2} dense label="Räknar nyckeltalen…" />
      : <>
        <dl className="mt-1.5 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2" data-testid="part-figures">
          {data.rows.map((row) => <div key={row.key} className="min-w-0" data-testid="part-figure">
            <dt className="text-xs text-muted-foreground">{row.label}</dt>
            <dd className={row.missing ? "text-muted-foreground" : "font-medium tabular-nums"} data-testid={`part-figure-${row.key}`}>{row.value}</dd>
            <dd className="text-[11px] text-muted-foreground">{row.hint}</dd>
          </div>)}
        </dl>
        {data.figures.partialPeriod ? <p className="mt-1.5 text-xs text-muted-foreground" data-testid="part-figures-partial">Underlaget är {data.figures.coverageDays.toLocaleString("sv-SE")} dagar, kortare än perioden.</p> : null}
        {data.truncated ? <p className="mt-1 text-xs text-muted-foreground">Bara de senaste händelserna räknades.</p> : null}
      </>}
  </section>;
}
