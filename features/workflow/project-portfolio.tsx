"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CircleAlert, Diamond, Briefcase, GanttChart } from "lucide-react";
import { api } from "@/features/kfid/api";
import { useWorkspaceData } from "@/features/kfid/use-workspace-data";
import { DelayedSkeleton, RowsSkeleton, SkeletonText } from "@/components/skeleton";
import { Panel } from "@/features/kfid/ui";
import { ListEmpty, ListGroup, ListRow, ListSkeleton, NativeSegmented } from "@/components/native";
import { Segmented } from "@/features/workflow/work-list";
import { useFittedDayWidth } from "@/features/workflow/use-fitted-day-width";
import { taskHref } from "@/features/workflow/next-steps";
import { indicatorBadge, indicatorBar, indicatorText, PILL_FIXED_WIDTH, type IndicatorTone } from "@/features/workflow/indicator-tone";
import { useNativeMode } from "@/features/workflow/use-detail-level";
import { cn } from "@/lib/utils";
import { effortHours } from "@/lib/workflow/project-effort";
import type { Portfolio, PortfolioIssue, PortfolioRow } from "@/lib/workflow/project-portfolio";
import { axisGroupLabel, barGeometry, daysBetween, scheduleAxis, scheduleRange, shortDay, type ScheduleZoom } from "@/lib/workflow/schedule";

/**
 * Portföljen (plan 1M, 2026-10-11): the table with one row per project, the list of obstacles and delays and the
 * plan over several projects – shared by Projektstatistik and Planering (Alla projekt). Read only: the numbers come
 * from the server (`/api/project-portfolio`, the project page's own figures), a click opens the project. Wide screens get
 * the table, narrower ones a card per project, and level 1 on a phone a short list in the app's style.
 */
export const projectHref = (id: string) => `/?view=project&projectId=${encodeURIComponent(id)}`;

/** The portfolio of every project that is not archived; the table filters Pågående / Avslutade itself. */
// Through the workspace's memory cache (stabil sidladdning steg 7): Planering and Projektstatistik show the portfolio read
// on the other at once and read it again.
export function usePortfolio() {
  const read = useWorkspaceData<Portfolio>("/api/project-portfolio?state=all", (signal) => api<Portfolio>("/api/project-portfolio?state=all", { cache: "no-store", signal }));
  return { data: read.data ?? null, error: read.error };
}

const dateText = (day: string, today: string) => !day ? "–" : day.slice(0, 4) === today.slice(0, 4) ? shortDay(day) : `${shortDay(day)} ${day.slice(0, 4)}`;
const hours = (minutes: number | null) => minutes === null ? "–" : effortHours(minutes);
const statusTone = (row: PortfolioRow): IndicatorTone => row.overdue ? "danger" : row.state === "READY_TO_CLOSE" ? "success" : row.state === "IN_PROGRESS" ? "info" : "neutral";
const statusLabel = (row: PortfolioRow) => row.overdue ? "Förfallet" : row.statusLabel;
const frameTone = (row: PortfolioRow): IndicatorTone => row.frame.state === "ON_TRACK" || row.frame.state === "DONE" ? "success" : row.frame.state === "BEHIND" ? "warning" : row.frame.state === "OVERDUE" ? "danger" : "neutral";
const daysText = (days: number) => `${days} ${days === 1 ? "dag" : "dagar"}`;

/** `column`: the table's status column, where every pill has one width (PILL_FIXED_WIDTH); a card's pill keeps its own. */
function StatusBadge({ row, column = false }: { row: PortfolioRow; column?: boolean }) {
  return <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold", column && PILL_FIXED_WIDTH, indicatorBadge(statusTone(row)))}>{statusLabel(row)}</span>;
}

function Progress({ row, className }: { row: PortfolioRow; className?: string }) {
  return <div className={cn("min-w-0", className)}>
    <span className="block whitespace-nowrap text-xs font-semibold tabular-nums">{row.completion} %</span>
    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`${row.name}: ${row.completion} procent klart`} aria-valuenow={row.completion} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full", indicatorBar(row.completion >= 100 ? "success" : "info"))} style={{ width: `${row.completion}%` }} />
    </div>
    <span className="mt-1 block whitespace-nowrap text-[11px] text-muted-foreground">{row.jobsDone} av {row.jobsTotal} jobb</span>
  </div>;
}

function Obstacles({ row }: { row: PortfolioRow }) {
  return row.obstacles ? <span className={cn("inline-flex items-center gap-1 font-semibold", indicatorText("warning"))}><AlertTriangle aria-hidden="true" className="size-3.5" />{row.obstacles}</span> : <span className="text-muted-foreground">–</span>;
}

/** The table on a wide screen. A row opens the project; the name is the link for the keyboard. */
function Table({ rows, today }: { rows: PortfolioRow[]; today: string }) {
  const router = useRouter();
  const number = "px-2 py-2 text-right tabular-nums";
  return <div className="hidden overflow-x-auto rounded-xl border bg-card @5xl:block" data-testid="portfolio-table">
    <table className="w-full text-xs">
      <thead className="bg-muted/40 text-left text-[11px] font-medium text-muted-foreground">
        <tr>
          <th scope="col" className="px-3 py-2">Projekt</th>
          <th scope="col" className="px-2 py-2">Ansvarig</th>
          <th scope="col" className="px-2 py-2">Status</th>
          <th scope="col" className="w-28 px-2 py-2">Färdigt</th>
          <th scope="col" className="px-2 py-2 text-right" title="Projektets tidsbudget">Budget</th>
          <th scope="col" className="px-2 py-2 text-right" title="Arbetstimmar i de godkända offertversionerna">Offererat</th>
          <th scope="col" className="px-2 py-2 text-right" title="Summan av jobbens uppskattade tid">Uppskattat</th>
          <th scope="col" className="px-2 py-2 text-right" title="Personalens bokningar på jobben">Bokat</th>
          <th scope="col" className="px-2 py-2 text-right" title="Faktisk tid">Rapporterat</th>
          <th scope="col" className="px-2 py-2 text-center">Hinder</th>
          <th scope="col" className="px-2 py-2">Nästa milstolpe</th>
          <th scope="col" className="px-3 py-2">Slutdatum</th>
        </tr>
      </thead>
      <tbody className="divide-y">
        {rows.map((row) => <tr key={row.id} data-testid="portfolio-row" data-project-id={row.id} data-attention={row.overdue || row.lateJobs > 0 ? "late" : row.obstacles ? "obstacle" : undefined}
          onClick={(event) => { if (!(event.target as HTMLElement).closest("a")) router.push(projectHref(row.id)); }} className="cursor-pointer align-top hover:bg-secondary/40">
          <td className="max-w-56 px-3 py-2">
            <Link href={projectHref(row.id)} className="block truncate text-sm font-semibold hover:text-primary hover:underline">{row.name}</Link>
            <span className="block truncate text-muted-foreground">{row.customer || "Ingen kund"}</span>
          </td>
          <td className="max-w-24 truncate px-2 py-2" title={row.responsible || undefined}>{row.responsible || "–"}</td>
          <td className="whitespace-nowrap px-2 py-2"><StatusBadge row={row} column /><span className={cn("mt-1 block text-[11px]", indicatorText(frameTone(row)))} data-testid="portfolio-frame">{row.frame.label}</span></td>
          <td className="px-2 py-2"><Progress row={row} /></td>
          <td className={number}>{hours(row.budgetMinutes)}</td>
          <td className={number}>{hours(row.quotedMinutes)}</td>
          <td className={number}>{row.effort.estimatedJobs ? effortHours(row.effort.estimatedMinutes) : "–"}</td>
          <td className={number}>{effortHours(row.effort.bookedMinutes)}</td>
          <td className={number}>{effortHours(row.effort.reportedMinutes)}</td>
          <td className="px-2 py-2 text-center"><Obstacles row={row} /></td>
          <td className="max-w-28 px-2 py-2">{row.nextMilestone ? <><span className="block font-medium">{dateText(row.nextMilestone.day, today)}</span><span className="block truncate text-muted-foreground">{row.nextMilestone.title}</span></> : "–"}</td>
          <td className="whitespace-nowrap px-3 py-2">{dateText(row.endDate, today)}</td>
        </tr>)}
      </tbody>
    </table>
  </div>;
}

/** Narrower screens: one card per project with the same figures. */
function Cards({ rows, today }: { rows: PortfolioRow[]; today: string }) {
  return <ul className="grid gap-3 @3xl:grid-cols-2 @5xl:hidden" data-testid="portfolio-cards">
    {rows.map((row) => <li key={row.id}>
      <Link href={projectHref(row.id)} data-testid="portfolio-card" data-project-id={row.id} className="block space-y-3 rounded-xl border bg-card p-3.5 hover:bg-secondary/40">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><p className="truncate text-sm font-semibold">{row.name}</p><p className="truncate text-xs text-muted-foreground">{[row.customer || "Ingen kund", row.responsible].filter(Boolean).join(" · ")}</p></div>
          <StatusBadge row={row} />
        </div>
        <Progress row={row} />
        <dl className="grid grid-cols-5 gap-1.5 text-center text-[11px]">
          {([["Budget", hours(row.budgetMinutes)], ["Offererat", hours(row.quotedMinutes)], ["Uppskattat", row.effort.estimatedJobs ? effortHours(row.effort.estimatedMinutes) : "–"], ["Bokat", effortHours(row.effort.bookedMinutes)], ["Rapporterat", effortHours(row.effort.reportedMinutes)]] as const).map(([label, value]) => <div key={label} className="rounded-md bg-muted/50 px-1 py-1.5"><dt className="truncate text-[10px] text-muted-foreground">{label}</dt><dd className="mt-0.5 text-xs font-semibold tabular-nums">{value}</dd></div>)}
        </dl>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className={indicatorText(frameTone(row))}>{row.frame.label}</span>
          {row.obstacles ? <span className={cn("inline-flex items-center gap-1 font-semibold", indicatorText("warning"))}><AlertTriangle aria-hidden="true" className="size-3.5" />{row.obstacles} hinder</span> : null}
          {row.nextMilestone ? <span>Nästa milstolpe {dateText(row.nextMilestone.day, today)}</span> : null}
          <span>Slut {dateText(row.endDate, today)}</span>
        </p>
      </Link>
    </li>)}
  </ul>;
}

/** Level 1 on a phone: the app's list, delayed first. The heavy figures are on the project page. */
function NativeList({ rows, today }: { rows: PortfolioRow[]; today: string }) {
  const attention = rows.filter((row) => row.overdue || row.lateJobs > 0 || row.obstacles > 0);
  const rest = rows.filter((row) => !attention.includes(row));
  const rowOf = (row: PortfolioRow) => <ListRow key={row.id} type="project" title={row.name} href={projectHref(row.id)} testId="native-portfolio-row"
    subtitle={[row.customer, `${row.completion} % · ${row.jobsDone} av ${row.jobsTotal} jobb`, row.lateJobs ? `${row.lateJobs} ${row.lateJobs === 1 ? "förfallet jobb" : "förfallna jobb"}` : "", row.obstacles ? `${row.obstacles} hinder` : "", row.endDate ? `slut ${dateText(row.endDate, today)}` : ""].filter(Boolean).join(" · ")}
    // Red only when the project itself is late; a late job is told in words (audit 2026-10-12: red "52 %" read as a warning).
    subtitleTone={row.overdue ? "danger" : undefined} pill={{ label: statusLabel(row), tone: statusTone(row) }} />;
  return <>
    {attention.length ? <ListGroup title="Kräver uppmärksamhet" testId="native-portfolio-attention" alignPills>{attention.map(rowOf)}</ListGroup> : null}
    <ListGroup title={attention.length ? "Övriga projekt" : undefined} testId="native-portfolio-rest" alignPills>{rest.length ? rest.map(rowOf) : attention.length ? null : <ListEmpty>Inga projekt.</ListEmpty>}</ListGroup>
  </>;
}

/** The portfolio table with its filter (Pågående / Avslutade). */
export function PortfolioTable({ portfolio, error, filter, onFilter }: { portfolio: Portfolio | null; error: string; filter: "ongoing" | "closed"; onFilter: (value: "ongoing" | "closed") => void }) {
  const native = useNativeMode();
  const rows = useMemo(() => (portfolio?.rows ?? []).filter((row) => filter === "ongoing" ? row.ongoing : !row.ongoing), [portfolio, filter]);
  const today = portfolio?.today ?? "";
  const filterControl = <Segmented label="Visa projekt" value={filter} onChange={onFilter} testId="portfolio-filter" options={[{ value: "ongoing", label: "Pågående" }, { value: "closed", label: "Avslutade" }]} />;
  if (native) return <div data-testid="portfolio">
    {error ? <p role="alert" className="notice text-sm text-destructive">{error}</p> : null}
    <NativeSegmented label="Visa projekt" value={filter} onChange={onFilter} testId="portfolio-filter" options={[["ongoing", "Pågående"], ["closed", "Avslutade"]]} />
    {/* The rows' own grey shape while the projects are read (steg 6), where the list will be. */}
    {!portfolio && !error ? <DelayedSkeleton><ListSkeleton rows={5} title={false} label="Hämtar projekten…" /></DelayedSkeleton> : null}
    {portfolio ? <NativeList rows={rows} today={today} /> : null}
  </div>;
  return <Panel icon={Briefcase} title="Projektportfölj" description="Ett projekt per rad. Förfallna och projekt med hinder först." actions={filterControl}>
    <div className="@container space-y-3" data-testid="portfolio">
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {!portfolio && !error ? <DelayedSkeleton><RowsSkeleton rows={5} label="Hämtar projekten…" /></DelayedSkeleton> : null}
      {portfolio && !rows.length ? <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground" data-testid="portfolio-empty">{filter === "ongoing" ? "Inga pågående projekt." : "Inga avslutade projekt."}</p> : null}
      {rows.length ? <><Table rows={rows} today={today} /><Cards rows={rows} today={today} /></> : null}
    </div>
  </Panel>;
}

/** Obstacles and delays across projects (or one project's): the reason and how many days. */
export function PortfolioIssues({ issues, projectId, title = "Hinder och förfallet", showProject = true }: { issues: PortfolioIssue[]; projectId?: string; title?: string; showProject?: boolean }) {
  const native = useNativeMode();
  const shown = projectId ? issues.filter((issue) => issue.projectId === projectId) : issues;
  const line = (issue: PortfolioIssue) => [showProject ? issue.projectName : "", issue.text].filter(Boolean).join(" · ");
  if (native) return <ListGroup title={title} testId="native-portfolio-issues">
    {shown.length ? shown.map((issue) => <ListRow key={issue.key} type="project" icon={issue.kind === "OBSTACLE" ? AlertTriangle : CircleAlert} title={issue.title || "Utan rubrik"} subtitle={`${issue.reason} · ${daysText(issue.days)} · ${line(issue)}`} href={taskHref({ id: issue.taskId, kind: issue.taskKind })} subtitleTone={issue.kind === "LATE" ? "danger" : undefined} />)
      : <ListEmpty>Inga hinder och inget förfallet.</ListEmpty>}
  </ListGroup>;
  return <Panel title={title} description="Jobb med ett hinder eller som passerat Klart senast.">
    <div data-testid="portfolio-issues">
      {shown.length ? <ul className="divide-y overflow-hidden rounded-xl border bg-card">
        {shown.map((issue) => <li key={issue.key} data-testid="portfolio-issue" data-kind={issue.kind}>
          <Link href={taskHref({ id: issue.taskId, kind: issue.taskKind })} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5 hover:bg-secondary/40">
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{issue.title || "Utan rubrik"}</span><span className="block truncate text-xs text-muted-foreground">{line(issue)}</span></span>
            <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold", indicatorBadge(issue.kind === "LATE" ? "danger" : "warning"))}>{issue.reason}</span>
            <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{daysText(issue.days)}</span>
          </Link>
        </li>)}
      </ul> : <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground" data-testid="portfolio-issues-empty">Inga hinder och inget förfallet.</p>}
    </div>
  </Panel>;
}

const ROW = 52;

/** The plan's own grey shape while the projects are read: the same box, header and row height as the timeline. */
function GanttSkeleton({ rows }: { rows: number }) {
  return <div aria-busy="true">
    <span role="status" className="sr-only">Hämtar projekten…</span>
    <div aria-hidden="true" className="max-sm:hidden overflow-hidden rounded-xl border bg-card">
      <div className="h-12 border-b bg-muted/40" />
      {Array.from({ length: rows }, (_, index) => <div key={index} className="flex items-center gap-4 border-b px-3.5" style={{ height: ROW }}>
        <span className="w-48 shrink-0 text-sm"><SkeletonText className={["w-3/5", "w-1/2", "w-2/5"][index % 3]} /></span>
        <span className="native-skeleton h-6 rounded-md" style={{ width: `${30 + ((index * 17) % 40)}%` }} />
      </div>)}
    </div>
    <div aria-hidden="true" className="sm:hidden"><RowsSkeleton rows={Math.min(rows, 6)} /></div>
  </div>;
}
/**
 * The plan over several projects (Alla projekt): a bar per project from start to end date, filled by the completion,
 * milestones as diamonds, a warning mark where an obstacle was reported, a line for today and Vecka / Månad like the
 * project's own Tidplan. Read only: a click opens the project. Phones get the list instead of bars.
 */
export function PortfolioGantt({ portfolio, error, expectedRows = 0 }: { portfolio: Portfolio | null; error: string;
  /** Ongoing projects the workspace already knows (stabil sidladdning): the plan's grey shape has a row for each, so the
   * cards under it do not jump when the portfolio comes (CLS 0,11 on Planering with ten projects, 2026-10-23). */
  expectedRows?: number }) {
  const native = useNativeMode();
  const [zoom, setZoom] = useState<ScheduleZoom>("month");
  const rows = useMemo(() => (portfolio?.rows ?? []).filter((row) => row.ongoing), [portfolio]);
  const drawn = rows.filter((row) => row.bar);
  const undated = rows.filter((row) => !row.bar);
  const today = portfolio?.today ?? "";
  const range = useMemo(() => scheduleRange({ jobs: drawn.map((row) => ({ plannedStartDate: row.bar!.start, dueDate: row.bar!.end })), today: today || "2026-01-01", zoom }), [drawn, today, zoom]);
  const axis = useMemo(() => scheduleAxis(range, zoom), [range, zoom]);
  const scroller = useRef<HTMLDivElement | null>(null);
  const dayWidth = useFittedDayWidth(scroller, zoom, range.days);
  const x = (day: string) => daysBetween(range.from, day) * dayWidth;
  // Today in view when it lies beyond the first screen; otherwise the plan starts at its left edge so no bar is cut.
  useEffect(() => { const box = scroller.current; if (box && today) { const target = daysBetween(range.from, today) * dayWidth; box.scrollLeft = target > box.clientWidth * 0.6 ? Math.max(0, target - 160) : 0; } }, [zoom, range.from, range.days, today, dayWidth, portfolio]);
  if (native) return null;
  const zoomControl = <span className="max-sm:hidden"><Segmented label="Skala" value={zoom} onChange={setZoom} testId="portfolio-zoom" options={[{ value: "week", label: "Vecka" }, { value: "month", label: "Månad" }]} /></span>;
  const todayOffset = today ? daysBetween(range.from, today) : -1;
  const width = range.days * dayWidth;
  return <Panel icon={GanttChart} title="Tidplan över projekten" description="Ett projekt per rad, från start till slut. Stapeln visar hur mycket som är klart, och romben är en milstolpe." actions={drawn.length ? zoomControl : undefined}>
    <div className="space-y-4" data-testid="portfolio-gantt">
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {!portfolio && !error ? <DelayedSkeleton>{expectedRows > 0 ? <GanttSkeleton rows={expectedRows} /> : <RowsSkeleton rows={4} dense label="Hämtar projekten…" />}</DelayedSkeleton> : null}
      {portfolio && !drawn.length ? <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Inga pågående projekt med datum än.</p> : null}
      {drawn.length ? <>
        <div className="max-sm:hidden overflow-hidden rounded-xl border bg-card" data-testid="portfolio-timeline" data-zoom={zoom}>
          <div className="flex">
            <div className="w-56 shrink-0 border-r">
              <div className="flex h-12 items-end border-b bg-muted/40 px-3.5 pb-1.5 text-xs font-medium text-muted-foreground">Projekt</div>
              {drawn.map((row) => <div key={row.id} className="flex flex-col justify-center border-b px-3.5" style={{ height: ROW }} data-testid="portfolio-gantt-label">
                <Link href={projectHref(row.id)} className="block truncate text-sm font-medium hover:text-primary">{row.name}</Link>
                <p className="truncate text-xs text-muted-foreground">{[row.customer, row.obstacles ? `${row.obstacles} hinder` : ""].filter(Boolean).join(" · ") || statusLabel(row)}</p>
              </div>)}
            </div>
            <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto" tabIndex={0} role="region" aria-label="Tidslinje">
              <div className="relative" style={{ width }}>
                {axis.offDays.map((off) => <div key={off.offset} aria-hidden="true" title={off.title} className="absolute bottom-0 top-12 bg-muted/70" style={{ left: off.offset * dayWidth, width: dayWidth }} />)}
                {today ? <div aria-hidden="true" data-testid="portfolio-today" className="absolute bottom-0 top-12 z-10 w-0.5 bg-primary" style={{ left: x(today) + dayWidth / 2 - 1 }} /> : null}
                <div className="relative h-12 border-b bg-muted/40 text-xs text-muted-foreground">
                  {axis.groups.map((group) => <div key={`${group.label}-${group.offset}`} className="absolute top-0 flex h-6 items-center truncate border-l px-1.5 font-medium text-foreground/80" style={{ left: group.offset * dayWidth, width: group.span * dayWidth }} title={group.label}>{axisGroupLabel(group.label, group.span * dayWidth)}</div>)}
                  {axis.cells.map((cell) => { const now = todayOffset >= cell.offset && todayOffset < cell.offset + cell.span; return <div key={cell.key} title={now ? `I dag · ${cell.title}` : cell.title} data-today={now || undefined}
                    className={cn("absolute bottom-0 flex h-6 items-center justify-center border-l tabular-nums", !cell.off && "text-foreground/80", now && "bg-primary/10 font-semibold text-primary")} style={{ left: cell.offset * dayWidth, width: cell.span * dayWidth }}>{cell.label}</div>; })}
                </div>
                {drawn.map((row) => {
                  const geometry = barGeometry(range, row.bar!.start, row.bar!.end, dayWidth);
                  const tone: IndicatorTone = row.overdue || row.lateJobs ? "danger" : row.completion >= 100 ? "success" : row.frame.state === "BEHIND" || row.obstacles ? "warning" : "info";
                  const label = `${row.name}: ${shortDay(row.bar!.start)} – ${shortDay(row.bar!.end)}, ${row.completion} % klart${row.obstacles ? `, ${row.obstacles} hinder` : ""}`;
                  return <div key={row.id} className="relative border-b" style={{ height: ROW }} data-testid="portfolio-gantt-row" data-project-id={row.id}>
                    {geometry ? <Link href={projectHref(row.id)} aria-label={label} title={label} data-testid="portfolio-bar" data-start={row.bar!.start} data-end={row.bar!.end}
                      className={cn("absolute top-3 flex h-6 items-center overflow-hidden rounded-md border text-[11px] font-semibold shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/40", indicatorBadge(tone))}
                      style={{ left: geometry.left + 1, width: Math.max(8, geometry.width - 2) }}>
                      <span aria-hidden="true" className={cn("absolute inset-y-0 left-0 opacity-30", indicatorBar(tone))} style={{ width: `${row.completion}%` }} />
                      {geometry.width > 44 ? <span className="relative truncate px-1.5 tabular-nums">{row.completion} %</span> : null}
                    </Link> : null}
                    {row.milestones.filter((milestone) => daysBetween(range.from, milestone.day) >= 0 && daysBetween(range.from, milestone.day) < range.days).map((milestone, index) => <span key={`${milestone.day}-${index}`} title={`${milestone.title} · ${shortDay(milestone.day)}`} data-testid="portfolio-milestone"
                      className="absolute bottom-1 -translate-x-1/2 text-amber-600 dark:text-amber-400" style={{ left: x(milestone.day) + dayWidth / 2 }}><Diamond aria-hidden="true" className="size-3.5 fill-current" /></span>)}
                    {row.obstacles && row.obstacleSince && daysBetween(range.from, row.obstacleSince) >= 0 && daysBetween(range.from, row.obstacleSince) < range.days
                      ? <span title={`${row.obstacles} hinder sedan ${shortDay(row.obstacleSince)}`} data-testid="portfolio-obstacle" className={cn("absolute top-0.5 -translate-x-1/2", indicatorText("warning"))} style={{ left: x(row.obstacleSince) + dayWidth / 2 }}><AlertTriangle aria-hidden="true" className="size-3.5 fill-amber-100 dark:fill-amber-950" /></span> : null}
                  </div>;
                })}
              </div>
            </div>
          </div>
        </div>
        <div className="sm:hidden" data-testid="portfolio-gantt-list">
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">{drawn.map((row) => <li key={row.id}><Link href={projectHref(row.id)} className="block px-3.5 py-2.5"><p className="truncate text-sm font-semibold">{row.name}</p><p className="truncate text-xs text-muted-foreground">{shortDay(row.bar!.start)} – {shortDay(row.bar!.end)} · {row.completion} % klart{row.obstacles ? ` · ${row.obstacles} hinder` : ""}</p></Link></li>)}</ul>
        </div>
      </> : null}
      {undated.length ? <section aria-label="Utan datum" data-testid="portfolio-undated"><h3 className="mb-2 text-sm font-semibold">Utan datum</h3>
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">{undated.map((row) => <li key={row.id}><Link href={projectHref(row.id)} className="block px-3.5 py-2.5 text-sm hover:bg-secondary/40"><span className="font-semibold">{row.name}</span><span className="text-xs text-muted-foreground"> · saknar start- eller slutdatum, så ingen stapel ritas</span></Link></li>)}</ul></section> : null}
    </div>
  </Panel>;
}
