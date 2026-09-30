"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, Brush } from "recharts";
import { ArrowUpRight, BarChart3, CheckCircle2, ChevronLeft, ChevronRight, PlusCircle, Target, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Panel } from "@/features/kfid/ui";
import { api } from "@/features/kfid/api";
import { swedishDayKey } from "@/lib/swedish-time";
import { taskStatisticsTypeLabel, type TaskStatisticsPerformer, type TaskStatisticsPoint, type TaskStatisticsType } from "@/lib/workflow/task-statistics";
import { indicatorBadge, indicatorText, statusTone } from "./indicator-tone";
import { ProjectStatistics } from "./project-statistics";

type TaskStatisticsData = {
  bucket: string;
  series: TaskStatisticsPoint[];
  performers: TaskStatisticsPerformer[];
  kpis: { created: number; completed: number; target: number; periodTarget: number; targetPercent: number; averageCompletedPerMonth: number; members: number };
  recent: { items: { id: string; kind: Exclude<TaskStatisticsType, "ALL">; taskKind?: string; title: string; status: string; performer: string; createdDay: string; completedDay: string | null }[]; page: number; pages: number; total: number };
};

const statusLabel: Record<string, string> = { COMPLETED: "Slutförd", DRAFT: "Utkast", PLANNED: "Planerad", IN_PROGRESS: "Pågår", NEEDS_ACTION: "Behöver åtgärdas", PAUSED: "Pausad" };
// The link follows the real kind: a control made as a form opens as a protocol (Daniel 2026-09-27).
const taskHref = (item: TaskStatisticsData["recent"]["items"][number]) => (item.taskKind ?? item.kind) === "KFID"
  ? `/?view=new&id=${encodeURIComponent(item.id)}` : `/?view=workflow_task&taskId=${encodeURIComponent(item.id)}&taskType=${item.taskKind ?? item.kind}`;

/**
 * Task statistics for company admins (Daniel 2026-09-26): controls, work orders and risk assessments created and
 * completed per period, against V1's target level and per performer. Folded by default at the bottom of the overview.
 */
export function TaskStatistics() {
  const today = swedishDayKey(new Date());
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"tasks" | "projects">("tasks");
  const [filters, setFilters] = useState({ from: `${Number(today.slice(0, 4)) - 1}-${today.slice(5, 7)}-01`, to: today, type: "ALL" as TaskStatisticsType, bucket: "auto", page: 1 });
  const [cumulative, setCumulative] = useState(false);
  const [data, setData] = useState<TaskStatisticsData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open || tab !== "tasks") return;
    const abort = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Start a new server request when the filters change.
    setLoading(true);
    const query = new URLSearchParams(Object.fromEntries(Object.entries(filters).map(([key, value]) => [key, String(value)])));
    void api<TaskStatisticsData>(`/api/task-statistics?${query}`, { signal: abort.signal })
      .then((result) => { setData(result); setError(""); })
      .catch((e) => { if (!abort.signal.aborted) setError((e as Error).message); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [open, tab, filters]);
  const typeName = filters.type === "ALL" ? "uppgifter" : taskStatisticsTypeLabel[filters.type].toLowerCase();
  return (
    <section aria-labelledby="task-statistics-heading" className="rounded-xl border bg-card shadow-xs">
      <div className={`panel-header flex flex-wrap items-center justify-between gap-3 rounded-t-xl px-5 py-4 ${open ? "border-b" : "rounded-b-xl"}`}>
        <div className="flex min-w-0 items-center gap-3">
          <span className="panel-icon" aria-hidden="true"><BarChart3 className="size-4" /></span>
          <div className="min-w-0">
            <h2 id="task-statistics-heading" className="section-title">Statistik</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Uppgifter och projekt per period: skapat, slutfört, i tid, mot mål och per person.</p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" aria-expanded={open} aria-controls="task-statistics" onClick={() => setOpen((value) => !value)}>
          <ChevronRight className={open ? "rotate-90 transition-transform" : "transition-transform"} />{open ? "Dölj statistik" : "Visa statistik"}
        </Button>
      </div>
      <div id="task-statistics" hidden={!open} className="space-y-5 p-5">
        {/* Tasks and projects share the period (Daniel 2026-09-27); the task type only applies to tasks. */}
        <div className="flex w-fit gap-1 rounded-full border bg-card p-1" role="group" aria-label="Visa statistik för">
          {([["tasks", "Uppgifter"], ["projects", "Projekt"]] as const).map(([value, label]) => (
            <Button key={value} type="button" size="sm" className="h-7 rounded-full" variant={tab === value ? "default" : "ghost"} aria-pressed={tab === value} onClick={() => setTab(value)}>{label}</Button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-1 text-xs text-muted-foreground">Från datum
            <Input type="date" aria-label="Statistik från datum" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value, page: 1 }))} />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">Till datum
            <Input type="date" aria-label="Statistik till datum" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value, page: 1 }))} />
          </label>
          {tab === "tasks" ? <label className="space-y-1 text-xs text-muted-foreground">Uppgiftstyp
            <select className="form-select" aria-label="Statistik för uppgiftstyp" value={filters.type} onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value as TaskStatisticsType, page: 1 }))}>
              <option value="ALL">Alla uppgiftstyper</option>
              <option value="KFID">Kontroller före idrifttagning</option>
              <option value="WORK_ORDER">Arbetsorder</option>
              <option value="RISK_ASSESSMENT">Riskbedömningar</option>
              <option value="FORM">Formulär</option>
            </select>
          </label> : null}
          <label className="space-y-1 text-xs text-muted-foreground">Gruppering
            <select className="form-select" aria-label="Gruppera statistik" value={filters.bucket} onChange={(e) => setFilters((f) => ({ ...f, bucket: e.target.value }))}>
              <option value="auto">Automatisk</option>
              <option value="day">Dag</option>
              <option value="week">Vecka</option>
              <option value="month">Månad</option>
            </select>
          </label>
        </div>
        {open && tab === "projects" ? <ProjectStatistics from={filters.from} to={filters.to} bucket={filters.bucket} /> : null}
        {tab === "tasks" && error ? <p role="alert" className="notice text-destructive">{error}</p> : null}
        {tab === "tasks" && loading && !data ? <p role="status" className="page-description">Hämtar statistik…</p> : null}
        {tab === "tasks" && data ? (
          <>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" data-testid="task-statistics-kpis">
              {[
                { label: "Skapade", value: data.kpis.created.toLocaleString("sv-SE"), detail: `Nya ${typeName} i perioden`, icon: PlusCircle, tone: "sky" },
                { label: "Slutförda", value: data.kpis.completed.toLocaleString("sv-SE"), detail: `Slutförda ${typeName} i perioden`, icon: CheckCircle2, tone: "emerald" },
                { label: "Mot mål", value: `${data.kpis.targetPercent}%`, detail: `Mål ${data.kpis.periodTarget.toLocaleString("sv-SE")} (${data.kpis.target} per månad)`, icon: Target, tone: "amber" },
                { label: "Slutförda per månad", value: data.kpis.averageCompletedPerMonth.toLocaleString("sv-SE"), detail: `${data.kpis.members} aktiva användare`, icon: TrendingUp, tone: "violet" },
              ].map((tile) => (
                <div key={tile.label} className={`stat-card stat-${tile.tone}`}>
                  <span className="stat-icon"><tile.icon className="size-5" /></span>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">{tile.label}</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums">{tile.value}</p>
                    <p className="truncate text-xs text-muted-foreground">{tile.detail}</p>
                  </div>
                </div>
              ))}
            </div>
            <Panel
              title="Skapade och slutförda över tid"
              description="Målet är V1:s nivå: två slutförda uppgifter per aktiv användare och månad."
              actions={
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={cumulative} onCheckedChange={(value) => setCumulative(value === true)} />
                  Ackumulerat
                </label>
              }
            >
              <div className="h-72 min-w-0 overflow-hidden" aria-busy={loading}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data.series} margin={{ top: 15, right: 10, left: -15, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} minTickGap={30} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip contentStyle={{ background: "var(--card)", color: "var(--foreground)", border: "1px solid var(--border)", borderRadius: 8 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar name="Skapade" dataKey={cumulative ? "cumulativeCreated" : "created"} fill="var(--primary)" fillOpacity={0.35} radius={[4, 4, 0, 0]} />
                    <Bar name="Slutförda" dataKey={cumulative ? "cumulativeCompleted" : "completed"} fill="#10b981" radius={[4, 4, 0, 0]} />
                    <Line name="Mål (slutförda)" dataKey={cumulative ? "cumulativeTarget" : "target"} stroke="#f59e0b" strokeDasharray="5 5" dot={false} />
                    {data.series.length > 16 ? <Brush dataKey="date" height={24} stroke="var(--primary)" /> : null}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <div className="grid gap-5 xl:grid-cols-3">
              <div className="min-w-0 xl:col-span-2">
                <Panel title="Uppgifter i perioden" description={`${data.recent.total} skapade ${typeName}`}>
                  {data.recent.items.length ? (
                    <ul className="divide-y" aria-label="Uppgifter i perioden">
                      {data.recent.items.map((item) => (
                        <li key={`${item.kind}-${item.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 first:pt-0">
                          <div className="min-w-0 flex-1">
                            <Link className="block truncate text-sm font-medium hover:text-primary" href={taskHref(item)}>{item.title}</Link>
                            <p className="truncate text-xs text-muted-foreground">{taskStatisticsTypeLabel[item.kind]} · {item.performer} · skapad {item.createdDay}{item.completedDay ? ` · slutförd ${item.completedDay}` : ""}</p>
                          </div>
                          <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${indicatorBadge(statusTone(item.status))}`}>{statusLabel[item.status] ?? item.status}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="py-4 text-sm text-muted-foreground">Inga {typeName} skapades under vald period.</p>}
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">Sida {data.recent.page} av {data.recent.pages}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <Button size="sm" variant="outline" disabled={loading || data.recent.page <= 1} onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}><ChevronLeft />Föregående</Button>
                      <Button size="sm" variant="outline" disabled={loading || data.recent.page >= data.recent.pages} onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}>Nästa<ChevronRight /></Button>
                    </div>
                  </div>
                  {filters.type === "KFID" || filters.type === "ALL" ? (
                    <Button asChild size="sm" variant="ghost" className="mt-2"><Link href="/?view=controls">Öppna kontrollarkivet<ArrowUpRight /></Link></Button>
                  ) : null}
                </Panel>
              </div>
              <Panel title="Per utförare" description="Skapade och slutförda i perioden">
                {data.performers.length ? (
                  <ul className="space-y-3" aria-label="Uppgifter per utförare">
                    {data.performers.map((performer) => (
                      <li key={performer.name}>
                        <div className="mb-1.5 flex justify-between gap-2 text-sm">
                          <span className="truncate">{performer.name}</span>
                          <span className="shrink-0 tabular-nums"><strong className={indicatorText("success")}>{performer.completed}</strong> <span className="text-muted-foreground">/ {performer.created} skapade</span></span>
                        </div>
                        <div className="h-2 rounded-full bg-secondary"><div className="h-2 rounded-full bg-emerald-500" style={{ width: `${(performer.completed / Math.max(data.kpis.completed, 1)) * 100}%` }} /></div>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-muted-foreground">Ingen data i vald period.</p>}
              </Panel>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
