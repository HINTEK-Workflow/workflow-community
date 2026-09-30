"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, ArrowUpRight, ChevronDown, ClipboardCheck, FolderKanban, LayoutList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Panel, ShowMore } from "./ui";
import { indicatorBadge, indicatorBar, indicatorText, progressTone, statusTone } from "@/features/workflow/indicator-tone";
import { api } from "./api";
import { OverviewKpiDashboard } from "@/features/workflow/overview-kpis";
import { TaskStatistics } from "@/features/workflow/task-statistics";
import { swedishDayKey } from "@/lib/swedish-time";
import { buildOverviewWork, selectOverviewWork, type OverviewWorkFilter, type OverviewWorkItem, type OverviewWorkSort } from "@/lib/workflow/overview-work";
import type { OverviewKpis } from "@/lib/workflow/overview-kpis";
import { summarizeProjectStatus, type ProjectStatus } from "@/lib/workflow/project-status";
import type { ControlItem } from "./types";
export type ProjectOverview = {
  id: string;
  name: string;
  description: string;
  dueDate: string;
  updatedAt: string;
  archivedAt?: string | null;
  closedAt?: string | null;
  /** Computed by the shared project status function; Local computes it from the open file. */
  status?: ProjectStatus;
  controls: {
    id: string;
    title: string;
    status: string;
    updatedAt: string;
    completion?: number;
  }[];
  workflowTasks?: GenericTaskOverview[];
};
export type GenericTaskOverview = { id: string; title: string; kind: "WORK_ORDER" | "RISK_ASSESSMENT" | "FORM"; status: string; progress: number; dueDate?: string; updatedAt: string; projectId: string | null };
export type WorkflowOverviewData = { controls: ControlItem[]; projects: ProjectOverview[]; workflowTasks: GenericTaskOverview[] };
type WorkItem = OverviewWorkItem;

const updatedLabel = (value: string) =>
  new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Stockholm",
  }).format(new Date(value));

function WorkCard({ item }: { item: WorkItem }) {
  return (
    <div className="workflow-card flex min-w-0 flex-col gap-2.5 p-3.5">
      <div className="flex min-w-0 items-start gap-3">
        <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${item.kind === "PROJECT" ? "bg-secondary text-primary" : "bg-feature-control-soft text-feature-control"}`}>
          {item.kind === "PROJECT" ? <FolderKanban className="size-4" /> : <ClipboardCheck className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <Link href={item.href} className="block truncate text-sm font-semibold hover:text-primary">{item.title}</Link>
          <p className="truncate text-xs text-muted-foreground">{item.kind === "PROJECT" ? "Projekt" : item.taskType}{item.projectName ? ` · ${item.projectName}` : ""}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className={indicatorBadge(statusTone(item.status))}>{item.status}</Badge>
        {item.dueDate ? <span className={`text-xs ${item.overdue ? `font-medium ${indicatorText("danger")}` : "text-muted-foreground"}`}>{item.overdue ? "Förfallen " : "Slutdatum "}{item.dueDate}</span> : null}
      </div>
      <div>
        <div className="flex items-baseline justify-between gap-3 text-xs"><span className={`font-semibold ${item.progress === 100 ? indicatorText("success") : ""}`}>{item.progress}%</span><span className="truncate text-muted-foreground">{item.remaining}</span></div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${indicatorBar(progressTone({ percent: item.progress, attention: item.needsAction || item.overdue }))}`} style={{ width: `${item.progress}%` }} /></div>
      </div>
    </div>
  );
}

const relativeUpdated = (value: string) => {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "ändrad nyss";
  if (minutes < 60) return `ändrad för ${minutes} min sedan`;
  if (minutes < 24 * 60) return `ändrad för ${Math.round(minutes / 60)} h sedan`;
  if (minutes < 7 * 24 * 60) { const days = Math.round(minutes / 1440); return `ändrad för ${days} ${days === 1 ? "dag" : "dagar"} sedan`; }
  return `ändrad ${updatedLabel(value)}`;
};

/**
 * One compact row in "Senast ändrat": icon, title, type/project, status, when, progression and the next step. Status,
 * bar and action sit in fixed columns so they line up whatever the text length (2026-09-29, F19).
 */
function LatestRow({ item }: { item: WorkItem }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3.5 py-2.5 sm:grid-cols-[minmax(0,1fr)_9rem_8rem_9rem]">
      <div className="flex min-w-0 items-center gap-3">
        <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${item.kind === "PROJECT" ? "bg-secondary text-primary" : "bg-feature-control-soft text-feature-control"}`}>
          {item.kind === "PROJECT" ? <FolderKanban className="size-4" /> : <ClipboardCheck className="size-4" />}
        </span>
        <div className="min-w-0">
          <Link href={item.href} className="block truncate text-sm font-medium hover:text-primary">{item.title}</Link>
          <p className="truncate text-xs text-muted-foreground">{item.kind === "PROJECT" ? "Projekt" : item.taskType}{item.projectName ? ` · ${item.projectName}` : ""} · {relativeUpdated(item.updatedAt)}</p>
        </div>
      </div>
      <div className="hidden sm:block"><Badge variant="outline" className={indicatorBadge(statusTone(item.status))}>{item.status}</Badge></div>
      <div className="hidden sm:block">
        <div className="flex items-baseline justify-between text-xs"><span className={`font-semibold ${item.progress === 100 ? indicatorText("success") : ""}`}>{item.progress}%</span></div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${indicatorBar(progressTone({ percent: item.progress, attention: item.needsAction || item.overdue }))}`} style={{ width: `${item.progress}%` }} /></div>
      </div>
      <Button asChild size="sm" variant="ghost" className="justify-self-end"><Link href={item.href} aria-label={`${item.action}: ${item.title}`}>{item.action}<ArrowUpRight /></Link></Button>
    </li>
  );
}

type WorkPage = ReturnType<typeof selectOverviewWork>;

/** Local: the same list built from the open file with the shared rules (no network). */
function localOverviewWork(data: WorkflowOverviewData, today: string) {
  const projectOf = new Map(data.projects.flatMap((project) => [...project.controls.map((control) => [control.id, project.name] as const), ...(project.workflowTasks ?? []).map((task) => [task.id, project.name] as const)]));
  const controlProgress = (control: ProjectOverview["controls"][number]) => control.status === "COMPLETED" ? 100 : control.completion ?? 0;
  return buildOverviewWork({
    today,
    projects: data.projects.map((project) => {
      const tasks = [...project.controls.map((control) => ({ status: control.status, progress: controlProgress(control) })), ...(project.workflowTasks ?? []).map((task) => ({ status: task.status, progress: task.progress }))];
      return { id: project.id, name: project.name, updatedAt: project.updatedAt, dueDate: project.dueDate, tasks,
        status: project.status ?? summarizeProjectStatus({ archivedAt: project.archivedAt, closedAt: project.closedAt, dueDate: project.dueDate, tasks }) };
    }),
    controls: data.controls.map((control) => ({ id: control.id, title: control.title, status: control.status, updatedAt: control.updatedAt, lastOpenedAt: control.lastOpenedAt,
      projectName: projectOf.get(control.id), percent: control.status === "COMPLETED" ? 100 : Math.min(95, control.completion?.percent ?? 0), errors: control.completion?.errors ?? 0 })),
    tasks: [...data.projects.flatMap((project) => project.workflowTasks ?? []), ...data.workflowTasks].map((task) => ({ ...task, projectName: projectOf.get(task.id) })),
  });
}

export function WorkOverview({ localData }: { localData?: WorkflowOverviewData }) {
  const [filter, setFilter] = useState<OverviewWorkFilter>("all"),
    [sort, setSort] = useState<OverviewWorkSort>("updated"),
    // Folded by default: three compact cards; "Visa alla" opens the full list (2026-09-26).
    [expanded, setExpanded] = useState(false),
    [localShown, setLocalShown] = useState(1),
    [remote, setRemote] = useState<WorkPage | null>(null),
    [moreBusy, setMoreBusy] = useState(false),
    [loading, setLoading] = useState(!localData),
    [error, setError] = useState("");
  // Cloud reads one page of ten, the three most urgent items and the counts from the server (bounded reads).
  useEffect(() => {
    if (localData) return;
    const abort = new AbortController();
    api<WorkPage>(`/api/overview-work?filter=${filter}&sort=${sort}&page=1`, { signal: abort.signal })
      .then((page) => { setRemote(page); setError(""); })
      .catch((e) => { if (!abort.signal.aborted) setError((e as Error).message); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [localData, filter, sort]);
  const today = swedishDayKey(new Date());
  const localItems = useMemo(() => localData ? localOverviewWork(localData, today) : null, [localData, today]);
  const localPages = localItems ? Array.from({ length: localShown }, (_, index) => selectOverviewWork(localItems, { filter, sort, page: index + 1 })) : null;
  const page: WorkPage | null = localPages ? { ...localPages[localPages.length - 1], items: localPages.flatMap((item) => item.items) } : remote;
  const items = page?.items ?? [];
  const total = page?.total ?? 0;
  const counts = page?.counts ?? { all: 0, projects: 0, tasks: 0, action: 0 };
  const urgent = page?.urgent ?? [];
  const needsAction = counts.action;
  // The folded list reads the default page (all, latest changed) and skips what the focus cards already show.
  const latest = filter === "all" && sort === "updated"
    ? items.filter((item) => !urgent.some((shown) => shown.kind === item.kind && shown.id === item.id)).slice(0, 5)
    : [];
  async function showMore() {
    if (localData) { setLocalShown((value) => value + 1); return; }
    if (!remote) return;
    setMoreBusy(true);
    try {
      const next = await api<WorkPage>(`/api/overview-work?filter=${filter}&sort=${sort}&page=${remote.page + 1}`);
      setRemote({ ...next, items: [...remote.items, ...next.items.filter((item) => !remote.items.some((known) => known.kind === item.kind && known.id === item.id))] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMoreBusy(false);
    }
  }
  const choose = (next: OverviewWorkFilter) => { setFilter(next); setLocalShown(1); };
  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="notice text-destructive">
          {error}
        </p>
      )}
      <Panel
        title="Projekt och uppgifter"
        description={expanded ? "Samlad progression från verkliga projekt och uppgifter." : needsAction ? `I fokus och senast ändrat · ${needsAction} behöver åtgärdas` : "I fokus och senast ändrat"}
        className="dashboard-work-panel"
        leadingActions={<span className="panel-icon" aria-hidden="true"><LayoutList className="size-4" /></span>}
        actions={counts.all > urgent.length || expanded ? (
          <Button type="button" size="sm" variant="outline" aria-expanded={expanded} aria-controls="overview-work-list" onClick={() => {
            // Folding returns to the default list so "Senast ändrat" is always the latest of everything.
            if (expanded) { setFilter("all"); setSort("updated"); setLocalShown(1); }
            setExpanded((value) => !value);
          }}>
            <ChevronDown className={expanded ? "rotate-180 transition-transform" : "transition-transform"} />{expanded ? "Visa färre" : `Visa alla (${counts.all})`}
          </Button>
        ) : undefined}
      >
        {loading && !localData ? (
          <p role="status" className="py-5 text-sm text-muted-foreground">
            Hämtar senaste arbete…
          </p>
        ) : !counts.all ? (
          <div className="py-6 text-center">
            <p className="text-sm font-medium">Inga projekt eller uppgifter ännu.</p>
            <p className="mt-1 text-xs text-muted-foreground">Skapa ett projekt eller en uppgift för att börja arbeta.</p>
          </div>
        ) : !expanded ? (
          // Folded (2026-09-27): what needs attention first, then the latest changed work, each item once.
          <div className="space-y-5">
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">I fokus</h3>
              <div className="grid gap-3 md:grid-cols-3" data-testid="overview-top-work">
                {urgent.map((item) => <WorkCard key={`${item.kind}-${item.id}`} item={item} />)}
              </div>
            </div>
            {latest.length ? (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Senast ändrat</h3>
                <ul className="divide-y rounded-xl border" data-testid="overview-latest-work" aria-label="Senast ändrade projekt och uppgifter">
                  {latest.map((item) => <LatestRow key={`${item.kind}-${item.id}`} item={item} />)}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <div id="overview-work-list">
            <div className="mb-4 flex flex-col gap-3 rounded-xl border bg-muted/25 p-2.5 lg:flex-row lg:items-center lg:justify-between">
              <div className="grid grid-cols-2 gap-1 sm:flex sm:flex-wrap" role="group" aria-label="Filtrera projekt och uppgifter">
                {([
                  ["all", `Alla (${counts.all})`],
                  ["projects", `Projekt (${counts.projects})`],
                  ["tasks", `Uppgifter (${counts.tasks})`],
                  ["action", `Behöver åtgärdas (${counts.action})`],
                ] as const).map(([value, label]) => (
                  <Button key={value} size="sm" variant={filter === value ? "secondary" : "ghost"} aria-pressed={filter === value} className="justify-center" onClick={() => choose(value)}>
                    {label}
                  </Button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <label className="shrink-0 text-xs font-medium text-muted-foreground" htmlFor="work-sort">Sortera</label>
                <select id="work-sort" className="form-select min-w-0 flex-1 sm:w-48 sm:flex-none" value={sort} onChange={(event) => { setSort(event.target.value as OverviewWorkSort); setLocalShown(1); }}>
                  <option value="updated">Senast ändrad</option>
                  <option value="progress">Mest kvar</option>
                  <option value="due">Närmaste slutdatum</option>
                </select>
              </div>
            </div>
            {items.length ? (
              <div aria-live="polite">
                <div className="mb-2 hidden grid-cols-[minmax(0,1fr)_12rem_14rem_8rem] gap-4 rounded-lg bg-muted/35 px-4 py-2.5 text-xs font-medium text-muted-foreground lg:grid">
                  <span>Objekt</span>
                  <span>Typ och status</span>
                  <span>Progression</span>
                  <span className="text-right">Åtgärd</span>
                </div>
                <div className="grid gap-2">
                  {items.map((item) => (
                    <div key={`${item.kind}-${item.id}`} className="workflow-card grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_12rem_14rem_8rem] lg:gap-4">
                      <div className="col-span-2 flex min-w-0 items-center gap-3 lg:col-span-1">
                        <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${item.kind === "PROJECT" ? "bg-secondary text-primary" : "bg-feature-control-soft text-feature-control"}`}>
                          {item.kind === "PROJECT" ? <FolderKanban className="size-4" /> : <ClipboardCheck className="size-4" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold">{item.title}</p>
                          <p className="mt-1 truncate text-xs text-muted-foreground">{item.projectName ? `Projekt: ${item.projectName} · ` : ""}Senast ändrad {updatedLabel(item.updatedAt)}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{item.kind === "PROJECT" ? "Projekt" : item.taskType ?? "Uppgift"}</Badge>
                        <Badge variant="outline" className={indicatorBadge(statusTone(item.status))}>{item.status}</Badge>
                      </div>
                      <div className="order-last col-span-2 min-w-0 lg:order-none lg:col-span-1">
                        <div className="flex items-baseline justify-between gap-3"><p className={`text-sm font-semibold ${item.progress === 100 ? indicatorText("success") : "text-foreground"}`}>{item.progress}%</p><p className="truncate text-xs text-muted-foreground">{item.remaining}</p></div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${indicatorBar(progressTone({ percent: item.progress, attention: item.needsAction || item.overdue }))}`} style={{ width: `${item.progress}%` }} /></div>
                      </div>
                      <div className="flex justify-end">
                        <Button asChild size="sm" variant="outline">
                          <Link href={item.href}>
                            {item.action}
                            <ArrowUpRight />
                          </Link>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
                <ShowMore shown={items.length} total={total} busy={moreBusy} onMore={() => void showMore()} />
              </div>
            ) : (
              <div className="py-6 text-center">
                <p className="text-sm font-medium">Inget matchar filtret.</p>
                <p className="mt-1 text-xs text-muted-foreground">Välj ett annat filter för att se arbetet.</p>
              </div>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}

export function Analytics({ admin, projectCount = 0 }: { admin: boolean; projectCount?: number }) {
  const [kpis, setKpis] = useState<{ team: OverviewKpis | null; mine: OverviewKpis } | null>(null),
    [kpiError, setKpiError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    api<{ team: OverviewKpis | null; mine: OverviewKpis }>("/api/overview-kpis", { signal: abort.signal })
      .then((result) => { setKpis(result); setKpiError(""); })
      .catch((e) => { if (!abort.signal.aborted) setKpiError((e as Error).message); });
    return () => abort.abort();
  }, []);
  // Order (2026-09-26): key figures → folded projects and tasks → task statistics at the bottom.
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between gap-4">
        <div>
          <h1 className="page-title">Översikt</h1>
          <p className="page-description mt-2">
            Följ projektens progression och fortsätt där arbetet stannade.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline"><Link href="/?view=projects">{projectCount} projekt</Link></Button>
          <Button asChild variant="outline"><Link href="/?view=new_project"><Plus />Nytt projekt</Link></Button>
          <Button asChild><Link href="/?view=new_task"><Plus />Ny uppgift</Link></Button>
        </div>
      </div>
      <OverviewKpiDashboard key={kpis ? "ready" : "loading"} team={kpis?.team ?? null} mine={kpis?.mine ?? null} loading={!kpis} error={kpiError} />
      <WorkOverview />
      {admin ? <TaskStatistics /> : null}
    </div>
  );
}
