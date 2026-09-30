"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bar, CartesianGrid, ComposedChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis, Brush } from "recharts";
import { AlarmClock, CalendarCheck2, ChevronLeft, ChevronRight, FolderKanban, FolderPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Panel } from "@/features/kfid/ui";
import { api } from "@/features/kfid/api";
import type { ProjectStatisticsListFilter, ProjectStatisticsPoint } from "@/lib/workflow/project-statistics";
import type { ProjectState } from "@/lib/workflow/project-status";
import { indicatorBadge, indicatorBar, indicatorText, progressTone, type IndicatorTone } from "./indicator-tone";

type ProjectStatisticsData = {
  series: ProjectStatisticsPoint[];
  kpis: { started: number; closed: number; closedWithEnd: number; closedOnTime: number; onTimePercent: number | null; ongoing: number; overdue: number };
  statuses: { state: ProjectState; label: string; count: number; overdue: number }[];
  responsible: { name: string; ongoing: number; overdue: number; closed: number; closedOnTime: number }[];
  list: {
    items: { id: string; name: string; responsibleName: string; startDate: string; dueDate: string; closedDay: string | null; state: ProjectState; label: string; overdue: boolean; onTime: boolean | null; tasksTotal: number; tasksDone: number; progress: number }[];
    page: number;
    pages: number;
    total: number;
  };
};

const stateTone: Record<ProjectState, IndicatorTone> = { PLANNED: "neutral", IN_PROGRESS: "warning", READY_TO_CLOSE: "success", CLOSED: "success", ARCHIVED: "neutral" };
const stateBar: Record<ProjectState, string> = { PLANNED: "bg-muted-foreground/50", IN_PROGRESS: "bg-amber-500", READY_TO_CLOSE: "bg-emerald-400", CLOSED: "bg-emerald-600", ARCHIVED: "bg-muted-foreground/25" };
const listFilters: [ProjectStatisticsListFilter, string][] = [["period", "Aktiva i perioden"], ["ongoing", "Pågående nu"], ["overdue", "Försenade"], ["closed", "Avslutade i perioden"]];

/**
 * The "Projekt" tab of Statistik (Daniel 2026-09-27): how the organisation's projects progress over time, so a
 * company admin can see at a glance that the work is under control. Uses the same period as the task tab.
 */
export function ProjectStatistics({ from, to, bucket }: { from: string; to: string; bucket: string }) {
  const [filter, setFilter] = useState<ProjectStatisticsListFilter>("period");
  const [page, setPage] = useState(1);
  const [cumulative, setCumulative] = useState(false);
  const [data, setData] = useState<ProjectStatisticsData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Start a new server request when the filters change.
    setLoading(true);
    const query = new URLSearchParams({ from, to, bucket, filter, page: String(page) });
    void api<ProjectStatisticsData>(`/api/project-statistics?${query}`, { signal: abort.signal })
      .then((result) => { setData(result); setError(""); })
      .catch((e) => { if (!abort.signal.aborted) setError((e as Error).message); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [from, to, bucket, filter, page]);
  // A new period starts the list from the first page.
  const [period, setPeriod] = useState(`${from}|${to}`);
  if (period !== `${from}|${to}`) { setPeriod(`${from}|${to}`); setPage(1); }
  const total = data ? data.statuses.reduce((sum, row) => sum + row.count, 0) : 0;
  return (
    <div className="space-y-5">
      {error ? <p role="alert" className="notice text-destructive">{error}</p> : null}
      {loading && !data ? <p role="status" className="page-description">Hämtar projektstatistik…</p> : null}
      {data ? (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" data-testid="project-statistics-kpis">
            {[
              { label: "Startade", value: data.kpis.started, detail: "Projekt med start i perioden", icon: FolderPlus, tone: "sky" },
              { label: "Avslutade", value: data.kpis.closed, detail: "Projekt avslutade i perioden", icon: CalendarCheck2, tone: "emerald" },
              { label: "Klara i tid", value: data.kpis.onTimePercent === null ? "–" : `${data.kpis.onTimePercent}%`, detail: data.kpis.closedWithEnd ? `${data.kpis.closedOnTime} av ${data.kpis.closedWithEnd} före slutdatum` : "Inga avslutade med slutdatum", icon: AlarmClock, tone: "amber" },
              { label: "Pågående nu", value: data.kpis.ongoing, detail: data.kpis.overdue ? `${data.kpis.overdue} försenade` : "Inga försenade", icon: FolderKanban, tone: "violet", danger: data.kpis.overdue > 0 },
            ].map((tile) => (
              <div key={tile.label} className={`stat-card stat-${tile.tone}`}>
                <span className="stat-icon"><tile.icon className="size-5" /></span>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{tile.label}</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{typeof tile.value === "number" ? tile.value.toLocaleString("sv-SE") : tile.value}</p>
                  <p className={`truncate text-xs ${tile.danger ? `font-medium ${indicatorText("danger")}` : "text-muted-foreground"}`}>{tile.detail}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="grid gap-5 xl:grid-cols-3">
            <div className="min-w-0 xl:col-span-2">
              <Panel
                title="Startade och avslutade över tid"
                description="Start räknas från projektets startdatum, annars när det skapades."
                actions={<label className="flex items-center gap-2 text-sm"><Checkbox checked={cumulative} onCheckedChange={(value) => setCumulative(value === true)} />Ackumulerat</label>}
              >
                <div className="h-72 min-w-0 overflow-hidden" aria-busy={loading}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={data.series} margin={{ top: 15, right: 10, left: -15, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 12 }} minTickGap={30} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                      <Tooltip contentStyle={{ background: "var(--card)", color: "var(--foreground)", border: "1px solid var(--border)", borderRadius: 8 }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar name="Startade" dataKey={cumulative ? "cumulativeStarted" : "started"} fill="var(--primary)" fillOpacity={0.35} radius={[4, 4, 0, 0]} />
                      <Bar name="Avslutade" dataKey={cumulative ? "cumulativeClosed" : "closed"} fill="#10b981" radius={[4, 4, 0, 0]} />
                      {data.series.length > 16 ? <Brush dataKey="date" height={24} stroke="var(--primary)" /> : null}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
            </div>
            <Panel title="Status just nu" description={`${total} projekt totalt`}>
              <ul className="space-y-3" aria-label="Projekt per status">
                {data.statuses.map((row) => (
                  <li key={row.state}>
                    <div className="mb-1.5 flex justify-between gap-2 text-sm">
                      <span className="truncate">{row.label}{row.overdue ? <span className={`ml-1.5 text-xs font-medium ${indicatorText("danger")}`}>{row.overdue} försenade</span> : null}</span>
                      <span className="shrink-0 font-semibold tabular-nums">{row.count}</span>
                    </div>
                    <div className="h-2 rounded-full bg-secondary"><div className={`h-2 rounded-full ${stateBar[row.state]}`} style={{ width: `${total ? (row.count / total) * 100 : 0}%` }} /></div>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
          <div className="grid gap-5 xl:grid-cols-3">
            <div className="min-w-0 xl:col-span-2">
              <Panel title="Projekt" description={`${data.list.total} projekt · försenade först`}>
                <div className="mb-3 grid grid-cols-2 gap-1 sm:flex sm:flex-wrap" role="group" aria-label="Filtrera projektlistan">
                  {listFilters.map(([value, label]) => (
                    <Button key={value} size="sm" variant={filter === value ? "secondary" : "ghost"} aria-pressed={filter === value} className="justify-center" onClick={() => { setFilter(value); setPage(1); }}>{label}</Button>
                  ))}
                </div>
                {data.list.items.length ? (
                  <ul className="divide-y" aria-label="Projekt i statistiken">
                    {data.list.items.map((item) => (
                      <li key={item.id} className="grid gap-2 py-3 first:pt-0 sm:grid-cols-[minmax(0,1fr)_11rem] sm:items-center sm:gap-4">
                        <div className="min-w-0">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <Link className="truncate text-sm font-medium hover:text-primary" href={`/?view=project&projectId=${encodeURIComponent(item.id)}`}>{item.name}</Link>
                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${indicatorBadge(item.overdue ? "danger" : stateTone[item.state])}`}>{item.overdue ? "Försenat" : item.label}</span>
                          </div>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {item.responsibleName || "Ingen ansvarig"} · {item.startDate}–{item.dueDate || "inget slutdatum"}
                            {item.closedDay ? ` · avslutat ${item.closedDay}` : ""}
                            {item.onTime === true ? " · i tid" : item.onTime === false ? " · efter slutdatum" : ""}
                          </p>
                        </div>
                        <div>
                          <div className="flex items-baseline justify-between gap-2 text-xs"><span className={`font-semibold ${item.progress === 100 ? indicatorText("success") : ""}`}>{item.progress}%</span><span className="text-muted-foreground">{item.tasksDone} av {item.tasksTotal} uppgifter</span></div>
                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${indicatorBar(progressTone({ percent: item.progress, attention: item.overdue }))}`} style={{ width: `${item.progress}%` }} /></div>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : <p className="py-4 text-sm text-muted-foreground">Inga projekt matchar urvalet.</p>}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">Sida {data.list.page} av {data.list.pages}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button size="sm" variant="outline" disabled={loading || data.list.page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft />Föregående</Button>
                    <Button size="sm" variant="outline" disabled={loading || data.list.page >= data.list.pages} onClick={() => setPage((value) => value + 1)}>Nästa<ChevronRight /></Button>
                  </div>
                </div>
              </Panel>
            </div>
            <Panel title="Per ansvarig" description="Pågående nu och avslutade i perioden">
              {data.responsible.length ? (
                <ul className="space-y-3" aria-label="Projekt per ansvarig">
                  {data.responsible.map((row) => (
                    <li key={row.name} className="text-sm">
                      <div className="flex justify-between gap-2">
                        <span className="truncate">{row.name}</span>
                        <span className="shrink-0 tabular-nums"><strong>{row.ongoing}</strong> <span className="text-muted-foreground">pågående</span></span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {row.overdue ? <span className={`font-medium ${indicatorText("danger")}`}>{row.overdue} försenade · </span> : null}
                        {row.closed} avslutade{row.closed ? `, ${row.closedOnTime} i tid` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted-foreground">Inga pågående eller avslutade projekt.</p>}
            </Panel>
          </div>
        </>
      ) : null}
    </div>
  );
}
