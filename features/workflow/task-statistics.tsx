"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, Brush } from "recharts";
import { BarChart3, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, PlusCircle, RefreshCw, Target, TrendingUp, ListChecks, Users, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/list-filter-bar";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Panel, useOpenWhenReady } from "@/features/kfid/ui";
import { StatisticsSkeleton } from "@/components/skeleton";
import { api } from "@/features/kfid/api";
import { swedishDayKey } from "@/lib/swedish-time";
import { taskStatisticsMeasureLabel, taskStatisticsTypeLabel, type TaskStatisticsKind, type TaskStatisticsMeasure, type TaskStatisticsMeasures, type TaskStatisticsPerformer, type TaskStatisticsPoint, type TaskStatisticsType } from "@/lib/workflow/task-statistics";
import { indicatorBadge, indicatorText, statusTone } from "./indicator-tone";
import { ProjectStatistics } from "./project-statistics";

type TaskStatisticsData = {
  bucket: string;
  series: TaskStatisticsPoint[];
  performers: TaskStatisticsPerformer[];
  kpis: { created: number; completed: number; cancelled: number; target: number; periodTarget: number; targetPercent: number; averageCompletedPerMonth: number; members: number };
  measures: TaskStatisticsMeasures;
  /** The company's work-order goal (Inställningar → Arbetssätt → Mål); perMonth null = none set. */
  goal: { perMonth: number | null; periodTarget: number | null; completed: number; percent: number | null };
  recent: { items: { id: string; kind: TaskStatisticsKind; taskKind?: string; measure?: TaskStatisticsMeasure; title: string; status: string; performer: string; createdDay: string; completedDay: string | null }[]; page: number; pages: number; total: number };
};

// What the chosen type is called in the tiles' texts (2026-10-28: arbetsordrar, uppgifter and rondtillfällen apart).
const typeNames: Record<TaskStatisticsType, string> = {
  ALL: "arbetsordrar, uppgifter och rondtillfällen", WORK_ORDER: "arbetsordrar", TASK: "uppgifter i arbetsordrar", ROUND: "rondtillfällen",
  KFID: "kontroller före idrifttagning", RISK_ASSESSMENT: "riskbedömningar", FORM: "formulär",
};

const statusLabel: Record<string, string> = { COMPLETED: "Färdigställd", DRAFT: "Utkast", PLANNED: "Planerad", IN_PROGRESS: "Pågår", NEEDS_ACTION: "Behöver åtgärdas", PAUSED: "Pausad", CANCELLED: "Utgått" };
// The link follows the real kind: a control made as a form opens as a protocol (2026-09-27).
const taskHref = (item: TaskStatisticsData["recent"]["items"][number]) => `/?view=workflow_task&taskId=${encodeURIComponent(item.id)}&taskType=${item.taskKind ?? item.kind}`;

/**
 * Task statistics for company admins (2026-09-26): created and completed per period – work orders, tasks in work
 * orders and round occurrences apart (2026-10-28) – against the company's own goal (Mål) and per performer (by user
 * id). Folded by default at the bottom of the overview.
 * The shared Panel (2026-10-24): the whole header opens and folds it, only the arrow at the right; the numbers are
 * read when the person asks for them and the card opens in one sweep once they are here (useOpenWhenReady).
 */
export function TaskStatistics({ projects = true, cards = false, mine = false }: {
  projects?: boolean;
  /**
   * Översikten (2026-10-29: "separata kort"): the period is its own card and the figures, the chart and the lists are cards of
   * their own beside it. Folded since 2026-11-02 (the fold rule, docs/design-standard.md): the first card opens them and they are read then.
   */
  cards?: boolean;
  /** Jag: only the viewer's own tasks (/api/task-statistics?mine=1) – no goal, no performers, no projects. */
  mine?: boolean;
} = {}) {
  const today = swedishDayKey(new Date());
  const [tab, setTab] = useState<"tasks" | "projects">("tasks");
  const withProjects = projects && !mine;
  const [filters, setFilters] = useState({ from: `${Number(today.slice(0, 4)) - 1}-${today.slice(5, 7)}-01`, to: today, type: (mine ? "ALL" : "WORK_ORDER") as TaskStatisticsType, bucket: "auto", page: 1 });
  const [cumulative, setCumulative] = useState(false);
  const [data, setData] = useState<TaskStatisticsData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const fold = useOpenWhenReady(Boolean(data || error), cards ? (mine ? "overview-statistics-mine" : "overview-statistics") : undefined);
  // Asked for once, the numbers follow the filters; folding and opening again shows them at once without a new read.
  const [started, setStarted] = useState(false);
  if (fold.asked && !started) setStarted(true);
  useEffect(() => {
    if (!started || tab !== "tasks") return;
    const abort = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Start a new server request when the filters change.
    setLoading(true);
    const query = new URLSearchParams(Object.fromEntries(Object.entries(filters).map(([key, value]) => [key, String(value)])));
    if (mine) query.set("mine", "1");
    void api<TaskStatisticsData>(`/api/task-statistics?${query}`, { signal: abort.signal })
      .then((result) => { setData(result); setError(""); })
      .catch((e) => { if (!abort.signal.aborted) setError((e as Error).message); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [started, tab, filters, mine]);
  const typeName = typeNames[filters.type];
  const controls = <>
        {/* Tasks and projects share the period (2026-09-27); the task type only applies to tasks. */}
        {/* The Projekt tab needs the project right, as /api/project-statistics (2026-10-28). */}
        {/* The shared segmented control (ärende #8, 2026-11-26). */}
        {withProjects ? <div className={cards ? "mb-4" : undefined}><Segmented label="Visa statistik för" value={tab} onChange={setTab} options={[{ value: "tasks", label: "Uppgifter" }, { value: "projects", label: "Projekt" }]} /></div> : null}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-1 text-xs text-muted-foreground">Från datum
            <Input type="date" aria-label="Statistik från datum" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value, page: 1 }))} />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">Till datum
            <Input type="date" aria-label="Statistik till datum" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value, page: 1 }))} />
          </label>
          {tab === "tasks" ? <label className="space-y-1 text-xs text-muted-foreground">Visa
            <select className="form-select" aria-label="Statistik för uppgiftstyp" value={filters.type} onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value as TaskStatisticsType, page: 1 }))}>
              <option value="WORK_ORDER">Arbetsordrar</option>
              <option value="TASK">Uppgifter i arbetsordrar</option>
              <option value="ROUND">Rondtillfällen</option>
              <option value="KFID">Kontroller före idrifttagning</option>
              <option value="RISK_ASSESSMENT">Riskbedömningar</option>
              <option value="FORM">Formulär</option>
              <option value="ALL">Allt</option>
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
  </>;
  const body = <>
        {/* The project tab is read once the card is open, in the background, so switching to it shows it whole at once. */}
        {withProjects && (data || error) ? <div hidden={tab !== "projects"}><ProjectStatistics from={filters.from} to={filters.to} bucket={filters.bucket} /></div> : null}
        {tab === "tasks" && error ? <p role="alert" className="notice text-destructive">{error}</p> : null}
        {tab === "tasks" && loading && !data ? <StatisticsSkeleton /> : null}
        {tab === "tasks" && data ? (
          <>
            <div className={`grid gap-3 ${mine ? "sm:grid-cols-3" : "grid-cols-2 xl:grid-cols-4"}`} data-testid="task-statistics-kpis">
              {[
                { label: mine ? "Tilldelade" : "Skapade", value: data.kpis.created.toLocaleString("sv-SE"), detail: data.kpis.cancelled ? `Varav ${data.kpis.cancelled.toLocaleString("sv-SE")} utgått` : mine ? "Dina i perioden" : `Nya ${typeName} i perioden`, icon: PlusCircle, tone: "sky" },
                { label: "Färdigställda", value: data.kpis.completed.toLocaleString("sv-SE"), detail: mine ? "Av dig i perioden" : `Färdigställda ${typeName} i perioden`, icon: CheckCircle2, tone: "emerald" },
                // The company's own goal (2026-10-28), always on work orders; no goal set, no target.
                data.goal.perMonth === null
                  ? { label: "Mot mål", value: "–", detail: "Inget mål satt", icon: Target, tone: "amber" }
                  : { label: "Mot mål", value: `${data.goal.percent ?? 0}%`, detail: `${data.goal.completed.toLocaleString("sv-SE")} av ${(data.goal.periodTarget ?? 0).toLocaleString("sv-SE")} arbetsordrar (${data.goal.perMonth} per månad)`, icon: Target, tone: "amber" },
                { label: "Färdigställda per månad", value: data.kpis.averageCompletedPerMonth.toLocaleString("sv-SE"), detail: mine ? "I snitt under perioden" : `${data.kpis.members} aktiva användare`, icon: TrendingUp, tone: "violet" },
              ].filter((tile) => !mine || tile.label !== "Mot mål").map((tile) => (
                <div key={tile.label} className={`stat-card min-w-0 stat-${tile.tone}`}>
                  <span className="stat-icon"><tile.icon className="size-5" /></span>
                  <div className="min-w-0 max-w-full">
                    <p className="text-xs text-muted-foreground">{tile.label}</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums">{tile.value}</p>
                    <p className="truncate text-xs text-muted-foreground">{tile.detail}</p>
                  </div>
                </div>
              ))}
            </div>
            {/* Each task counts once, in its own measure (2026-10-28): a protocol in a work order is not a work order. */}
            <ul className="grid gap-3 sm:grid-cols-3" aria-label="Arbetsordrar, uppgifter och rondtillfällen" data-testid="task-statistics-measures">
              {([["workOrders", "WORK_ORDER", ClipboardList], ["tasks", "TASK", ClipboardCheck], ["rounds", "ROUND", RefreshCw]] as const).map(([key, measure, Icon]) => (
                <li key={key} className="flex items-center gap-3 rounded-lg border bg-card p-3">
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="truncate text-xs text-muted-foreground">{taskStatisticsMeasureLabel[measure]}</p>
                    <p className="text-sm tabular-nums"><strong>{data.measures[key].completed.toLocaleString("sv-SE")}</strong> <span className="text-muted-foreground">färdigställda av {data.measures[key].created.toLocaleString("sv-SE")}{data.measures[key].cancelled ? `, ${data.measures[key].cancelled.toLocaleString("sv-SE")} utgått` : ""}</span></p>
                  </div>
                </li>
              ))}
            </ul>
            <Panel
              title="Skapade och färdigställda över tid"
              description={mine ? "Dina uppgifter, efter när de skapades och färdigställdes." : data.goal.perMonth === null ? "Inget mål satt." : filters.type === "WORK_ORDER" ? `Målet är ${data.goal.perMonth} färdigställda arbetsordrar per månad.` : "Målet visas för arbetsordrar."}
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
                    <Bar name="Färdigställda" dataKey={cumulative ? "cumulativeCompleted" : "completed"} fill="#10b981" radius={[4, 4, 0, 0]} />
                    {data.kpis.target ? <Line name="Mål (färdigställda)" dataKey={cumulative ? "cumulativeTarget" : "target"} stroke="#f59e0b" strokeDasharray="5 5" dot={false} /> : null}
                    {data.series.length > 16 ? <Brush dataKey="date" height={24} stroke="var(--primary)" /> : null}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <div className="grid gap-5 xl:grid-cols-3">
              <div className={`min-w-0 ${mine ? "xl:col-span-3" : "xl:col-span-2"}`}>
                <Panel icon={ListChecks} title={mine ? "Mina uppgifter i perioden" : "Uppgifter i perioden"} description={`${data.recent.total} skapade ${typeName}`}>
                  {data.recent.items.length ? (
                    <ul className="divide-y" aria-label="Uppgifter i perioden">
                      {data.recent.items.map((item) => (
                        <li key={`${item.kind}-${item.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 first:pt-0">
                          <div className="min-w-0 flex-1">
                            <Link className="block truncate text-sm font-medium hover:text-primary" href={taskHref(item)}>{item.title}</Link>
                            <p className="truncate text-xs text-muted-foreground">{item.measure === "ROUND" ? "Rondtillfälle" : taskStatisticsTypeLabel[item.kind]} · {item.performer} · skapad {item.createdDay}{item.completedDay ? ` · färdigställd ${item.completedDay}` : ""}</p>
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
                </Panel>
              </div>
              {mine ? null : <Panel icon={Users} title="Per utförare" description="Skapade och färdigställda i perioden">
                {data.performers.length ? (
                  <ul className="space-y-3" aria-label="Uppgifter per utförare">
                    {data.performers.map((performer) => (
                      <li key={performer.userId ?? ""}>
                        <div className="mb-1.5 flex justify-between gap-2 text-sm">
                          <span className="truncate">{performer.name}</span>
                          <span className="shrink-0 tabular-nums"><strong className={indicatorText("success")}>{performer.completed}</strong> <span className="text-muted-foreground">/ {performer.created} skapade</span></span>
                        </div>
                        <div className="h-2 rounded-full bg-secondary"><div className="h-2 rounded-full bg-emerald-500" style={{ width: `${(performer.completed / Math.max(data.kpis.completed, 1)) * 100}%` }} /></div>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-muted-foreground">Ingen data i vald period.</p>}
              </Panel>}
            </div>
          </>
        ) : null}
  </>;
  if (cards) return (
    <section id="task-statistics" className="space-y-5 [html[data-detail='2']_&]:space-y-3" data-testid="task-statistics" aria-label={mine ? "Min statistik" : "Statistik"}>
      <Panel icon={BarChart3} title={mine ? "Min statistik" : "Statistik"} description={mine ? "Dina uppgifter per period: tilldelade och färdigställda." : "Uppgifter och projekt per period: skapat, färdigställt, i tid, mot mål och per person."}
        collapsible collapsed={fold.collapsed} onCollapsedChange={fold.onCollapsedChange} opening={fold.opening}>
        {controls}
      </Panel>
      {fold.open ? body : null}
    </section>
  );
  return (
    <Panel icon={BarChart3} title="Statistik" description="Uppgifter och projekt per period: skapat, färdigställt, i tid, mot mål och per person."
      className="task-statistics" collapsible collapsed={fold.collapsed} onCollapsedChange={fold.onCollapsedChange} opening={fold.opening}>
      <div id="task-statistics" className="space-y-5" data-testid="task-statistics">
        {controls}
        {body}
      </div>
    </Panel>
  );
}
