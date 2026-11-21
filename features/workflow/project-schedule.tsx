"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useFittedDayWidth } from "@/features/workflow/use-fitted-day-width";
import { AlertTriangle, CalendarClock, CalendarPlus, CornerDownRight, Diamond, OctagonAlert, GanttChart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DisabledReason } from "@/components/ui/disabled-reason";
import { api } from "@/features/kfid/api";
import { CollapsibleSection, DialogActions, Field, Modal, Panel } from "@/features/kfid/ui";
import { Segmented } from "@/features/workflow/work-list";
import { taskHref } from "@/features/workflow/next-steps";
import { indicatorBadge, indicatorBar, indicatorText, type IndicatorTone } from "@/features/workflow/indicator-tone";
import { cn } from "@/lib/utils";
import { ListEmpty, ListGroup, ListRow } from "@/components/native";
import { useNativeMode } from "@/features/workflow/use-detail-level";
import { typeOfTaskKind } from "@/lib/workflow/native-mode";
import { groupProjectJobs } from "@/lib/workflow/project-jobs";
import { groupByStage, stageSummary, type StageGroup } from "@/lib/workflow/job-planning";
import { obstacleText } from "@/lib/workflow/obstacles";
import {
  barGeometry, bookingShiftWorkdays, datedJobs, bookingText, daysBetween, delayedByPredecessor, dependencyConflicts, followerMoves, followerShiftWorkdays, hoursText, jobsWithoutDue, movableBooking, jobPeriod, jobsByWeek, lateWorkdays, minutesFromHours, moveConsequences, movePeriod,
  axisGroupLabel, resizePeriodEnd, SCHEDULE_STATE_LABELS, scheduleAxis, schedulePeriodError, scheduleRange, scheduleState, shortDay, workdaysIn,
  type DependencyConflict, type ScheduleBooking, type ScheduleJob, type SchedulePeriod, type ScheduleState, type ScheduleZoom,
} from "@/lib/workflow/schedule";

/**
 * Tidplan (Gantt v1, 2026-10-09; docs/proposals/projekt-forbattring-2026-10-09.md 6.4): the project's jobs as
 * bars from Start to Klart senast on a time axis (week or month scale), with today's line, the project's frame, toned
 * weekends and holidays, booked days as a thin band under each bar and milestones as diamonds. Read first: a person who
 * may edit a job drags its bar (whole workdays) or its end, or opens it with a click or Enter, and sees the consequences
 * before anything is saved; the server checks the same rules again. Phones get a plain list by week instead of bars.
 *
 * Plan 1M (2026-10-11): every job has a Start (an older one counts from the day it was created), so every job is a bar;
 * jobs are grouped by Etapp with a summary bar per stage; a reported obstacle marks the job's row and bar; the project's
 * end and the bookings of the kind Milstolpe are diamonds; and "Flytta efterföljande jobb" moves the jobs that start after.
 */
type ScheduleResponse = {
  today: string;
  project: { id: string; startDate: string; dueDate: string; locked: boolean; canFrameException: boolean };
  jobs: (ScheduleJob & { version: number; canEdit: boolean })[];
  bookings: ScheduleBooking[];
};
type Job = ScheduleResponse["jobs"][number];
/** The dialog's draft; moveBookings = "Flytta även bokningarna", moveFollowers = "Flytta efterföljande jobb", predecessorIds = Börjar efter (steg 4). */
type Draft = { job: Job; period: SchedulePeriod; hours: string; reason: string; dragged: boolean; moveBookings: boolean; moveFollowers: boolean; predecessorIds: string[] };

const STATE_TONE: Record<ScheduleState, IndicatorTone> = { planned: "neutral", active: "info", blocked: "warning", late: "danger", done: "success", cancelled: "neutral" };
const ROW = 44;
/** The day the job counts from: its own Start, or the day it was created. */
const startOf = (job: SchedulePeriod) => job.plannedStartDate || job.effectiveStart || "";
const samePredecessors = (left: readonly string[], right: readonly string[] | undefined) => left.length === (right ?? []).length && left.every((id) => (right ?? []).includes(id));
/** Börjar efter: the warnings per job – starts before a predecessor is done, or waits for a late one. Never a block. */
function dependencyNotes(jobs: readonly Job[], today: string) {
  const conflicts = new Map<string, DependencyConflict[]>();
  for (const conflict of dependencyConflicts(jobs)) conflicts.set(conflict.jobId, [...(conflicts.get(conflict.jobId) ?? []), conflict]);
  return { conflicts, delayed: delayedByPredecessor(jobs, today) };
}
const conflictText = (conflict: DependencyConflict) => `Börjar innan ${conflict.predecessorTitle || "föregångaren"} är klar (${shortDay(conflict.predecessorEnd)})`;
const kindLabel = (kind: string) => kind === "WORK_ORDER" ? "Arbetsorder" : kind === "RISK_ASSESSMENT" ? "Riskbedömning" : "Formulär";
const periodText = (period: SchedulePeriod) => {
  const drawn = jobPeriod(period);
  if (!drawn) return period.dueDate ? `Klart senast ${shortDay(period.dueDate)}` : "Utan datum";
  return drawn.start === drawn.end ? shortDay(drawn.start) : `${shortDay(drawn.start)} – ${shortDay(drawn.end)}`;
};
const stageSummaryText = (group: { start: string; end: string; doneCount: number; jobCount: number }) =>
  [group.start ? (group.end && group.end !== group.start ? `${shortDay(group.start)} – ${shortDay(group.end)}` : shortDay(group.start)) : "", `${group.doneCount} av ${group.jobCount} jobb`].filter(Boolean).join(" · ");
const summaryOf = (jobs: readonly Job[]) => stageSummary(jobs);

/**
 * A job without Klart senast is drawn as its start day only, so the row says what its Start and bookings are and that the
 * end is missing (plan 1M: Utan datum is only for these).
 */
const undatedNote = (job: Job, bookings: readonly ScheduleBooking[]) => {
  const own = bookings.filter((booking) => booking.taskId === job.id && booking.kind !== "DEADLINE").sort((a, b) => a.startDay.localeCompare(b.startDay));
  const last = own.reduce((day, booking) => booking.endDay > day ? booking.endDay : day, "");
  const booked = own.length ? `Bokad ${shortDay(own[0].startDay)}${last !== own[0].startDay ? `–${shortDay(last)}` : ""}` : "";
  const start = startOf(job);
  return [kindLabel(job.kind), job.assignedToName, start ? `Start ${shortDay(start)}` : "", booked, job.dueDate ? "" : "Saknar Klart senast, så stapeln visar bara startdagen"].filter(Boolean).join(" · ");
};
/** The period a job without Klart senast starts from in the dialog: Klart senast is set next to its start. */
const datePeriodOf = (job: Job): SchedulePeriod => ({ plannedStartDate: startOf(job), dueDate: job.dueDate, effectiveStart: job.effectiveStart });

export function ProjectSchedule({ projectId, onChanged }: { projectId: string; onChanged?: () => void }) {
  const [data, setData] = useState<ScheduleResponse | null>(null);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState<ScheduleZoom>("week");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [reads, setReads] = useState(0);
  const load = useCallback(() => setReads((count) => count + 1), []);
  // Nivå 1 på mobil: the weeks as grouped rows (the screen's top bar is the title); no bars on a phone.
  const native = useNativeMode();
  useEffect(() => {
    let alive = true;
    api<ScheduleResponse>(`/api/project-schedule?projectId=${encodeURIComponent(projectId)}`).then(
      (result) => { if (alive) { setData(result); setError(""); } },
      (cause) => { if (alive) setError(cause instanceof Error ? cause.message : "Tidplanen kunde inte läsas."); },
    );
    return () => { alive = false; };
  }, [projectId, reads]);

  const open = (job: Job, period: SchedulePeriod = datePeriodOf(job), dragged = false) => {
    setSaveError("");
    setDraft({ job, period, hours: hoursText(job.estimatedMinutes), reason: "", dragged, moveBookings: false, moveFollowers: false, predecessorIds: job.predecessorIds ?? [] });
  };
  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setSaveError("");
    try {
      await api("/api/project-schedule", { method: "POST", body: JSON.stringify({
        taskId: draft.job.id, version: draft.job.version, plannedStartDate: draft.period.plannedStartDate, dueDate: draft.period.dueDate,
        estimatedMinutes: minutesFromHours(draft.hours), ...(draft.reason.trim() ? { frameExceptionReason: draft.reason.trim() } : {}),
        ...(draft.moveBookings && bookingShiftWorkdays(draft.job, draft.period) ? { moveBookings: true } : {}),
        ...(draft.moveFollowers && followerShiftWorkdays(datePeriodOf(draft.job), draft.period) ? { moveFollowers: true } : {}),
        ...(samePredecessors(draft.predecessorIds, draft.job.predecessorIds) ? {} : { predecessorIds: draft.predecessorIds }),
      }) });
      setDraft(null);
      load();
      onChanged?.();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Tidplanen kunde inte sparas.");
    } finally {
      setSaving(false);
    }
  };

  const { dated } = datedJobs(data?.jobs ?? []);
  // Utan datum (plan 1M): only the jobs without Klart senast, drawn as their start day (and the few without any day).
  const undated = jobsWithoutDue(data?.jobs ?? []);
  const dialog = draft && data ? <ScheduleDialog draft={draft} data={data} saving={saving} error={saveError} onChange={setDraft} onCancel={() => setDraft(null)} onSave={() => void save()} /> : null;
  if (native) return <div data-testid="project-schedule" className="space-y-1">
    {error ? <p role="alert" className="notice text-sm text-destructive">{error}</p> : null}
    {!data && !error ? <ListGroup><ListEmpty>Hämtar tidplanen…</ListEmpty></ListGroup> : null}
    {data ? <NativeStages data={data} /> : null}
    {data ? <NativeWeekList data={data} /> : null}
    {undated.length && data ? <ListGroup title="Utan datum" testId="schedule-undated">
      {undated.map((job) => <ListRow key={job.id} href={taskHref(job)} type={typeOfTaskKind(job.kind)} title={job.title || "Utan rubrik"}
        subtitle={undatedNote(job, data.bookings)}
        accessory={job.canEdit ? <Button type="button" size="sm" variant="outline" onClick={() => open(job, setEndFor(job, data.today))} data-testid="schedule-set-date"><CalendarPlus />Sätt datum</Button> : undefined} />)}
    </ListGroup> : null}
    {dialog}
  </div>;
  return <Panel icon={GanttChart} title="Tidplan" description="Projektets jobb på en tidsaxel. Bokad personal syns som ett band under stapeln."
    actions={data?.jobs.length ? <span className="max-sm:hidden"><Segmented label="Skala" value={zoom} onChange={setZoom} testId="schedule-zoom" options={[{ value: "week", label: "Vecka" }, { value: "month", label: "Månad" }]} /></span> : undefined}>
    <div data-testid="project-schedule" className="space-y-4">
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {!data && !error ? <p role="status" className="text-sm text-muted-foreground">Hämtar tidplanen…</p> : null}
      {data && !data.jobs.length ? <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Projektet har inga jobb än.</p> : null}
      {data && data.jobs.length ? <>
        {dated.length ? <div className="max-sm:hidden"><Timeline data={data} jobs={dated} zoom={zoom} onOpen={open} /></div> : null}
        <div className="sm:hidden"><WeekList data={data} /></div>
        {undated.length ? <section aria-label="Utan datum" data-testid="schedule-undated">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">Utan datum<span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{undated.length}</span></h3>
          <div className="divide-y overflow-hidden rounded-xl border bg-card">
            {undated.map((job) => <div key={job.id} className="flex items-center gap-3 px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <Link href={taskHref(job)} className="line-clamp-1 text-sm font-semibold hover:text-primary">{job.title || "Utan rubrik"}</Link>
                <p className="text-xs text-muted-foreground">{undatedNote(job, data.bookings)}</p>
              </div>
              {job.canEdit ? <Button type="button" size="sm" variant="outline" onClick={() => open(job, setEndFor(job, data.today))} data-testid="schedule-set-date"><CalendarPlus />Sätt datum</Button> : null}
            </div>)}
          </div>
        </section> : null}
      </> : null}
    </div>
    {dialog}
  </Panel>;
}

/** "Sätt datum" for a job without Klart senast: its Start kept (or today for a very old one) and Klart senast set from it. */
function setEndFor(job: Job, today: string): SchedulePeriod {
  const start = startOf(job) || today;
  return { plannedStartDate: start, dueDate: job.dueDate || (start < today ? today : start), effectiveStart: job.effectiveStart };
}

type TimelineRow = { stage: StageGroup<Job> } | { job: Job; nested: boolean };

/** The bars. Rows follow the project's jobs: stage by stage, each work order with its tasks indented under it, then the standalone tasks. */
function Timeline({ data, jobs, zoom, onOpen }: { data: ScheduleResponse; /** The dated jobs: the rows. */ jobs: Job[]; zoom: ScheduleZoom; onOpen: (job: Job, period?: SchedulePeriod, dragged?: boolean) => void }) {
  const frame = { startDate: data.project.startDate, dueDate: data.project.dueDate };
  const range = useMemo(() => scheduleRange({ frame, jobs: data.jobs, today: data.today, zoom }), [data, zoom]); // eslint-disable-line react-hooks/exhaustive-deps
  const scroller = useRef<HTMLDivElement | null>(null);
  const dayWidth = useFittedDayWidth(scroller, zoom, range.days);
  const axis = useMemo(() => scheduleAxis(range, zoom), [range, zoom]);
  const rows = useMemo<TimelineRow[]>(() => {
    const jobRows = (list: Job[]) => {
      const { workOrders, standalone } = groupProjectJobs(list);
      return [...workOrders.flatMap((group) => [{ job: group.order, nested: false }, ...group.linked.map((job) => ({ job, nested: true }))]), ...standalone.map((job) => ({ job, nested: false }))];
    };
    const { grouped, groups } = groupByStage(jobs);
    return groups.flatMap((group) => grouped ? [{ stage: group }, ...jobRows(group.jobs)] : jobRows(group.jobs));
  }, [jobs]);
  // The project's end is always a milestone, with the bookings of the kind Milstolpe (plan 1M).
  const milestones = useMemo(() => [
    ...data.bookings.filter((booking) => booking.kind === "DEADLINE").map((booking) => ({ key: booking.id, day: booking.startDay, title: booking.title })),
    ...(data.project.dueDate ? [{ key: "project-end", day: data.project.dueDate, title: "Projektets slutdatum" }] : []),
  ], [data]);
  const notes = useMemo(() => dependencyNotes(data.jobs, data.today), [data]);
  const width = range.days * dayWidth;
  const x = (day: string) => daysBetween(range.from, day) * dayWidth;
  const todayOffset = daysBetween(range.from, data.today);
  // Today in view when the plan opens or the scale changes.
  useEffect(() => { if (scroller.current) scroller.current.scrollLeft = Math.max(0, x(data.today) - 160); }, [zoom, range.from]); // eslint-disable-line react-hooks/exhaustive-deps
  const framed = Boolean(frame.startDate && frame.dueDate);
  const jobOf = (row: TimelineRow) => "job" in row ? row.job : null;
  return <div className="overflow-hidden rounded-xl border bg-card" data-testid="schedule-timeline" data-zoom={zoom}>
    <div className="flex">
      <div className="w-60 shrink-0 border-r">
        <div className="flex h-12 items-end border-b bg-muted/40 px-3.5 pb-1.5 text-xs font-medium text-muted-foreground">Jobb</div>
        {milestones.length ? <div className="flex h-7 items-center border-b px-3.5 text-xs text-muted-foreground">Milstolpar</div> : null}
        {rows.map((row) => "stage" in row
          ? <StageLabel key={`stage-${row.stage.stage}`} group={row.stage} />
          : <JobLabel key={row.job.id} job={row.job} nested={row.nested} today={data.today} conflicts={notes.conflicts.get(row.job.id) ?? []} delayed={notes.delayed.has(row.job.id)} />)}
      </div>
      {/* The timeline scrolls sideways; it takes focus so a keyboard can scroll it too (the objective analysis 2026-10-24). */}
      <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto" tabIndex={0} role="region" aria-label="Tidslinje">
        <div className="relative" style={{ width }}>
          {/* Toned weekends and holidays, the project's frame and today's line lie under the rows. */}
          {axis.offDays.map((off) => <div key={off.offset} aria-hidden="true" title={off.title} className="absolute bottom-0 top-12 bg-muted/70" style={{ left: off.offset * dayWidth, width: dayWidth }} />)}
          {framed ? <div aria-hidden="true" data-testid="schedule-frame" className="absolute bottom-0 top-12 border-x-2 border-dashed border-primary/40 bg-primary/[0.04]" style={{ left: x(frame.startDate), width: (daysBetween(frame.startDate, frame.dueDate) + 1) * dayWidth }} /> : null}
          {/* Today: the line under the header and today's date marked in the header itself – a label over the axis covered the
              dates beside it (QA 2026-10-10). */}
          <div aria-hidden="true" data-testid="schedule-today" className="absolute bottom-0 top-12 z-10 w-0.5 bg-primary" style={{ left: x(data.today) + dayWidth / 2 - 1 }} />
          <div className="relative h-12 border-b bg-muted/40 text-xs text-muted-foreground">
            {axis.groups.map((group) => <div key={`${group.label}-${group.offset}`} className="absolute top-0 flex h-6 items-center truncate border-l px-1.5 font-medium text-foreground/80" style={{ left: group.offset * dayWidth, width: group.span * dayWidth }} title={group.label}>{axisGroupLabel(group.label, group.span * dayWidth)}</div>)}
            {axis.cells.map((cell) => { const today = todayOffset >= cell.offset && todayOffset < cell.offset + cell.span; return <div key={cell.key} title={today ? `I dag · ${cell.title}` : cell.title} data-today={today || undefined} className={cn("absolute bottom-0 flex h-6 items-center justify-center border-l tabular-nums", !cell.off && "text-foreground/80", today && "font-semibold text-primary")} style={{ left: cell.offset * dayWidth, width: cell.span * dayWidth }}>{today && cell.span === 1 ? <span className="rounded-full bg-primary px-1.5 leading-5 text-primary-foreground">{cell.label}</span> : cell.label}{today ? <span className="sr-only"> (i dag)</span> : null}</div>; })}
          </div>
          {milestones.length ? <div className="relative h-7 border-b">
            {milestones.map((milestone) => <span key={milestone.key} title={`${milestone.title} · ${shortDay(milestone.day)}`} data-testid="schedule-milestone" className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-amber-600 dark:text-amber-400" style={{ left: x(milestone.day) + dayWidth / 2 }}><Diamond className="size-3.5 fill-current" aria-label={`Milstolpe: ${milestone.title} ${shortDay(milestone.day)}`} /></span>)}
          </div> : null}
          {rows.map((row) => "stage" in row
            ? <StageBarRow key={`stage-${row.stage.stage}`} group={row.stage} range={range} dayWidth={dayWidth} />
            : <BarRow key={row.job.id} job={row.job} data={data} range={range} dayWidth={dayWidth} onOpen={onOpen} />)}
          <DependencyArrows rows={rows.map(jobOf)} conflicts={notes.conflicts} range={range} dayWidth={dayWidth} top={48 + (milestones.length ? 28 : 0)} width={width} />
        </div>
      </div>
    </div>
  </div>;
}

/** A stage's name and summary in the label column: "Installation" with its period, "x av y jobb" and completion. */
function StageLabel({ group }: { group: StageGroup<Job> }) {
  const summary = summaryOf(group.jobs);
  return <div className="flex flex-col justify-center border-b bg-muted/60 px-3.5" style={{ height: ROW }} data-testid="schedule-stage-label" data-stage={group.stage}>
    <p className="truncate text-sm font-semibold">{group.label}</p>
    <p className="truncate text-xs text-muted-foreground">{stageSummaryText(summary)} · {summary.progress} %</p>
  </div>;
}

/** The stage's summary bar: from its earliest Start to its latest Klart senast, filled by the weighted completion. */
function StageBarRow({ group, range, dayWidth }: { group: StageGroup<Job>; range: { from: string; days: number }; dayWidth: number }) {
  const summary = summaryOf(group.jobs);
  const geometry = summary.start ? barGeometry(range, summary.start, summary.end || summary.start, dayWidth) : null;
  return <div className="relative border-b bg-muted/60" style={{ height: ROW }} data-testid="schedule-stage-row" data-stage={group.stage}>
    {geometry ? <div role="img" aria-label={`${group.label}: ${stageSummaryText(summary)}, ${summary.progress} % klart`} title={`${group.label} · ${stageSummaryText(summary)} · ${summary.progress} %`} data-testid="schedule-stage-bar" data-start={summary.start} data-end={summary.end}
      className="absolute top-3.5 h-3 overflow-hidden rounded-sm border-x-2 border-primary/70 bg-primary/15" style={{ left: geometry.left + 1, width: Math.max(8, geometry.width - 2) }}>
      <span aria-hidden="true" className="absolute inset-y-0 left-0 bg-primary/55" style={{ width: `${summary.progress}%` }} />
    </div> : null}
  </div>;
}

function JobLabel({ job, nested, today, conflicts, delayed }: { job: Job; nested: boolean; today: string; conflicts: DependencyConflict[]; delayed: boolean }) {
  const late = lateWorkdays(job, today);
  const warning = !late && conflicts.length ? conflictText(conflicts[0]) : !late && delayed ? "Påverkas av förfallet jobb" : "";
  const obstacle = job.obstacle;
  return <div className={cn("flex items-center gap-1.5 border-b px-3.5", nested && "pl-6")} style={{ height: ROW }} data-testid="schedule-row-label">
    {nested ? <CornerDownRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" /> : null}
    <div className="min-w-0">
      <Link href={taskHref(job)} className="block truncate text-sm font-medium hover:text-primary">{job.title || "Utan rubrik"}</Link>
      <p className={cn("truncate text-xs", late ? cn("font-medium", indicatorText("danger")) : obstacle || warning ? cn("font-medium", indicatorText("warning")) : "text-muted-foreground")} title={obstacle ? obstacleText(obstacle) : warning || undefined} data-testid={obstacle ? "schedule-obstacle" : warning ? "schedule-dependency-warning" : undefined}>
        {late ? `Förfallet ${late} ${late === 1 ? "arbetsdag" : "arbetsdagar"}${obstacle ? ` · ${obstacleText(obstacle)}` : ""}` : obstacle ? `Hinder: ${obstacleText(obstacle)}` : warning || [periodText(job), job.estimatedMinutes !== null ? `${hoursText(job.estimatedMinutes)} h` : ""].filter(Boolean).join(" · ")}
      </p>
    </div>
  </div>;
}

/**
 * Börjar efter (steg 4): thin arrows from each predecessor's end to the job's start, over the bars; dashed amber when the
 * job starts before the predecessor is done (a warning, never a block). A row can be a stage's summary row (null here).
 */
function DependencyArrows({ rows, conflicts, range, dayWidth, top, width }: { rows: (Job | null)[]; conflicts: Map<string, DependencyConflict[]>; range: { from: string; days: number }; dayWidth: number; top: number; width: number }) {
  const markerId = useId().replace(/:/g, "");
  const index = new Map(rows.flatMap((job, at) => job ? [[job.id, at] as const] : []));
  const bar = (job: Job) => { const period = jobPeriod(job); return period ? barGeometry(range, period.start, period.end, dayWidth) : null; };
  const arrows = rows.flatMap((job) => !job ? [] : (job.predecessorIds ?? []).flatMap((id) => {
    const before = rows[index.get(id) ?? -1];
    const from = before ? bar(before) : null;
    const to = bar(job);
    if (!before || !from || !to) return [];
    const x1 = from.left + from.width - 1, y1 = index.get(id)! * ROW + 20;
    const x2 = to.left + 1, y2 = index.get(job.id)! * ROW + 20;
    const row = index.get(job.id)! * ROW;
    const lane = y2 > y1 ? row + 3 : row + 37;
    const d = x2 - x1 >= 12 ? `M${x1} ${y1} H${x1 + 6} V${y2} H${x2}` : `M${x1} ${y1} H${x1 + 6} V${lane} H${x2 - 6} V${y2} H${x2}`;
    return [{ key: `${id}-${job.id}`, d, conflict: Boolean(conflicts.get(job.id)?.some((item) => item.predecessorId === id)) }];
  }));
  if (!arrows.length) return null;
  return <svg aria-hidden="true" data-testid="schedule-dependencies" className="pointer-events-none absolute left-0 z-[5] overflow-visible" style={{ top, width, height: rows.length * ROW }}>
    <defs>
      <marker id={`${markerId}-ok`} viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L6,3 L0,6 z" className="fill-muted-foreground" /></marker>
      <marker id={`${markerId}-warn`} viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L6,3 L0,6 z" className="fill-amber-500" /></marker>
    </defs>
    {arrows.map((arrow) => <path key={arrow.key} d={arrow.d} fill="none" strokeWidth={1.25} data-testid="schedule-dependency" data-conflict={arrow.conflict ? "true" : undefined}
      className={arrow.conflict ? "stroke-amber-500" : "stroke-muted-foreground/70"} strokeDasharray={arrow.conflict ? "3 2" : undefined} markerEnd={`url(#${markerId}-${arrow.conflict ? "warn" : "ok"})`} />)}
  </svg>;
}

/** One job's bar; an editable bar moves with the pointer in whole days and its right edge changes only Klart senast. */
function BarRow({ job, data, range, dayWidth, onOpen }: { job: Job; data: ScheduleResponse; range: { from: string; days: number }; dayWidth: number; onOpen: (job: Job, period?: SchedulePeriod, dragged?: boolean) => void }) {
  const [preview, setPreview] = useState<SchedulePeriod | null>(null);
  const drag = useRef<{ x: number; mode: "move" | "end"; moved: boolean } | null>(null);
  const shown = preview ?? job;
  const period = jobPeriod(shown);
  const geometry = period ? barGeometry(range, period.start, period.end, dayWidth) : null;
  const state = scheduleState(job, data.today);
  const tone = STATE_TONE[state];
  const late = lateWorkdays(job, data.today);
  const booked = data.bookings.filter((booking) => booking.taskId === job.id && booking.kind !== "DEADLINE");
  const editable = job.canEdit;
  const obstacle = job.obstacle;
  const next = (clientX: number) => {
    const current = drag.current;
    if (!current) return job;
    const days = Math.round((clientX - current.x) / dayWidth);
    return current.mode === "move" ? movePeriod(job, days) : resizePeriodEnd(job, days);
  };
  const onPointerDown = (event: React.PointerEvent<HTMLElement>, mode: "move" | "end") => {
    if (!editable || event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, mode, moved: false };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    if (Math.abs(event.clientX - drag.current.x) > 3) drag.current.moved = true;
    if (drag.current.moved) setPreview(next(event.clientX));
  };
  const onPointerUp = (event: React.PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current) return;
    const result = next(event.clientX);
    drag.current = null;
    setPreview(null);
    if (!current.moved) { onOpen(job); return; }
    if (result.plannedStartDate !== startOf(job) || result.dueDate !== job.dueDate) onOpen(job, { ...result, effectiveStart: job.effectiveStart }, true);
  };
  const label = `${job.title || "Utan rubrik"}: ${periodText(job)}, ${SCHEDULE_STATE_LABELS[state]}${late ? `, förfallet ${late} arbetsdagar` : ""}${obstacle ? `, hinder: ${obstacleText(obstacle)}` : ""}, ${job.progress} % klart`;
  return <div className="relative border-b" style={{ height: ROW }} data-testid="schedule-row" data-task-id={job.id} data-state={state} data-obstacle={obstacle ? obstacle.reason : undefined}>
    {booked.map((booking) => {
      const band = barGeometry(range, booking.startDay, booking.endDay, dayWidth);
      return band ? <span key={booking.id} data-testid="schedule-booking" title={`Bokad: ${booking.people || booking.title} · ${booking.startDay === booking.endDay ? shortDay(booking.startDay) : `${shortDay(booking.startDay)} – ${shortDay(booking.endDay)}`}`}
        className="absolute bottom-1 h-1 rounded-full bg-primary/60" style={{ left: band.left + 1, width: Math.max(4, band.width - 2) }} /> : null;
    })}
    {geometry ? <div role={editable ? "button" : "img"} tabIndex={editable ? 0 : undefined} aria-label={editable ? `${label}. Ändra tidplanen` : label} title={label}
      data-testid="schedule-bar" data-start={startOf(shown)} data-end={shown.dueDate}
      onPointerDown={(event) => onPointerDown(event, "move")} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { drag.current = null; setPreview(null); }}
      onKeyDown={(event) => { if (editable && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onOpen(job); } }}
      className={cn("absolute top-2 flex h-6 items-center overflow-hidden rounded-md border text-[11px] font-semibold shadow-xs", indicatorBadge(tone), state === "cancelled" && "opacity-50 line-through",
        obstacle && "border-dashed border-amber-500",
        editable ? "cursor-grab touch-none select-none outline-none focus-visible:ring-3 focus-visible:ring-ring/40 active:cursor-grabbing" : "cursor-default", preview && "ring-2 ring-primary/50")}
      style={{ left: geometry.left + 1, width: Math.max(8, geometry.width - 2) }}>
      <span aria-hidden="true" className={cn("absolute inset-y-0 left-0 opacity-20", indicatorBar(tone))} style={{ width: `${job.progress}%` }} />
      {obstacle ? <OctagonAlert aria-hidden="true" className="relative ml-1 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" /> : null}
      {geometry.width > 44 ? <span className="relative truncate px-1.5 tabular-nums">{late ? `+${late} d` : `${job.progress} %`}</span> : null}
      {editable ? <span aria-hidden="true" data-testid="schedule-bar-end" title="Dra för att ändra Klart senast" onPointerDown={(event) => onPointerDown(event, "end")} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-foreground/10 hover:bg-foreground/25" /> : null}
    </div> : null}
  </div>;
}

/** The phone's time plan (390 px): the dated jobs by week, with period, state and lateness; no dragging on a small screen. */
function WeekList({ data }: { data: ScheduleResponse }) {
  const { weeks } = jobsByWeek(data.jobs, data.today);
  const notes = dependencyNotes(data.jobs, data.today);
  const stages = groupByStage(data.jobs);
  if (!weeks.length) return <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Inga jobb har datum än.</p>;
  return <div className="space-y-4" data-testid="schedule-weeks">
    {stages.grouped ? <section aria-label="Etapper" data-testid="schedule-stages">
      <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">Etapper</h3>
      <div className="divide-y overflow-hidden rounded-xl border bg-card">
        {stages.groups.map((group) => { const summary = summaryOf(group.jobs); return <div key={group.stage || "none"} className="flex items-center justify-between gap-3 px-3.5 py-2.5" data-testid="schedule-stage-row-mobile">
          <div className="min-w-0"><p className="truncate text-sm font-semibold">{group.label}</p><p className="truncate text-xs text-muted-foreground">{stageSummaryText(summary)}</p></div>
          <span className="shrink-0 text-xs font-semibold tabular-nums">{summary.progress} %</span>
        </div>; })}
      </div>
    </section> : null}
    {weeks.map((week) => <section key={week.monday} aria-label={week.label}>
      <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">{week.label}</h3>
      <div className="divide-y overflow-hidden rounded-xl border bg-card">
        {week.jobs.map((job) => {
          const state = scheduleState(job, data.today);
          const late = lateWorkdays(job, data.today);
          const conflict = notes.conflicts.get(job.id)?.[0];
          const warning = late ? "" : conflict ? conflictText(conflict) : notes.delayed.has(job.id) ? "Påverkas av förfallet jobb" : "";
          return <Link key={job.id} href={taskHref(job)} data-testid="schedule-week-row" className="flex min-w-0 items-center gap-3 px-3.5 py-2.5 hover:bg-secondary/40">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{job.title || "Utan rubrik"}</p>
              <p className={cn("truncate text-xs", late ? cn("font-medium", indicatorText("danger")) : "text-muted-foreground")}>{late ? `Förfallet ${late} ${late === 1 ? "arbetsdag" : "arbetsdagar"} · ` : ""}{job.stage ? `${job.stage} · ` : ""}{periodText(job)}{job.estimatedMinutes !== null ? ` · ${hoursText(job.estimatedMinutes)} h` : ""}</p>
              {job.obstacle ? <p className={cn("truncate text-xs font-medium", indicatorText("warning"))} data-testid="schedule-obstacle">Hinder: {obstacleText(job.obstacle)}</p> : null}
              {warning ? <p className={cn("truncate text-xs font-medium", indicatorText("warning"))} data-testid="schedule-dependency-warning">{warning}</p> : null}
            </div>
            <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium", indicatorBadge(STATE_TONE[state]))}>{SCHEDULE_STATE_LABELS[state]}</span>
          </Link>;
        })}
      </div>
    </section>)}
  </div>;
}

/** Level 1 on a phone: the stages as rows (period, "x av y jobb", completion), only when the project's jobs have stages. */
function NativeStages({ data }: { data: ScheduleResponse }) {
  const stages = groupByStage(data.jobs);
  if (!stages.grouped) return null;
  return <ListGroup title="Etapper" testId="schedule-stages">
    {stages.groups.map((group) => { const summary = summaryOf(group.jobs); return <ListRow key={group.stage || "none"} type="project" title={group.label} subtitle={stageSummaryText(summary)} value={`${summary.progress} %`} testId="schedule-stage-row-mobile" />; })}
  </ListGroup>;
}

/** The same weeks as rows of the phone's own lists (Nivå 1 på mobil): the job, its period and state; a late one in red. */
function NativeWeekList({ data }: { data: ScheduleResponse }) {
  const { weeks } = jobsByWeek(data.jobs, data.today);
  const notes = dependencyNotes(data.jobs, data.today);
  if (!weeks.length) return <ListGroup><ListEmpty>Inga jobb har datum än.</ListEmpty></ListGroup>;
  return <div data-testid="schedule-weeks">
    {weeks.map((week) => <ListGroup key={week.monday} title={week.label}>
      {week.jobs.map((job) => {
        const state = scheduleState(job, data.today);
        const late = lateWorkdays(job, data.today);
        const conflict = notes.conflicts.get(job.id)?.[0];
        const warning = late ? "" : conflict ? conflictText(conflict) : notes.delayed.has(job.id) ? "Påverkas av förfallet jobb" : "";
        const period = `${job.stage ? `${job.stage} · ` : ""}${periodText(job)}${job.estimatedMinutes !== null ? ` · ${hoursText(job.estimatedMinutes)} h` : ""}`;
        const note = [late ? `Förfallet ${late} ${late === 1 ? "arbetsdag" : "arbetsdagar"}` : "", job.obstacle ? `Hinder: ${obstacleText(job.obstacle)}` : late ? "" : warning].filter(Boolean).join(" · ");
        return <ListRow key={job.id} href={taskHref(job)} type={typeOfTaskKind(job.kind)} title={job.title || "Utan rubrik"} testId="schedule-week-row"
          subtitle={note ? `${note} · ${period}` : period}
          subtitleTone={late || warning || job.obstacle ? "danger" : undefined} pill={job.obstacle ? { label: "Hinder", tone: "warning" } : { label: SCHEDULE_STATE_LABELS[state], tone: STATE_TONE[state] }} />;
      })}
    </ListGroup>)}
  </div>;
}

/** Ändra tidplan: the new period and estimate, what it means (Konsekvenser), and the frame's exception when needed. */
function ScheduleDialog({ draft, data, saving, error, onChange, onCancel, onSave }: { draft: Draft; data: ScheduleResponse; saving: boolean; error: string; onChange: (draft: Draft) => void; onCancel: () => void; onSave: () => void }) {
  const id = useId();
  const [pickOpen, setPickOpen] = useState(false);
  const { job, period } = draft;
  const frame = { startDate: data.project.startDate, dueDate: data.project.dueDate };
  const before = datePeriodOf(job);
  const changed = period.plannedStartDate !== before.plannedStartDate || period.dueDate !== before.dueDate;
  const problem = changed ? schedulePeriodError(period, frame) : null;
  const consequences = moveConsequences(job, period, data.bookings, frame, before);
  const hoursInvalid = draft.hours.trim() !== "" && minutesFromHours(draft.hours) === null;
  const blocked = problem && !problem.frame ? problem.message
    : problem && !data.project.canFrameException ? `${problem.message} Bara projektansvarig eller en företagsadministratör kan göra undantag.`
    : problem && !draft.reason.trim() ? "Skriv en motivering till undantaget från projektets tidsram."
    : hoursInvalid ? "Ange uppskattad tid i timmar, till exempel 16 eller 1,5."
    : "";
  const drawn = jobPeriod(period);
  const set = (values: Partial<SchedulePeriod>) => onChange({ ...draft, period: { ...period, ...values } });
  // Flytta även bokningarna: as many workdays as Start moves; only when this person may move every one of them.
  const shift = bookingShiftWorkdays({ plannedStartDate: before.plannedStartDate }, period);
  const ownBookings = data.bookings.filter((booking) => booking.taskId === job.id && movableBooking(booking));
  const notMovable = ownBookings.filter((booking) => !booking.canMove);
  const offerMove = shift !== 0 && ownBookings.length > 0;
  const moving = offerMove && draft.moveBookings && !notMovable.length;
  const moveReason = notMovable.length ? `Du kan inte flytta ${notMovable.map(bookingText).join(", ")}. Andras bokningar flyttas av projektansvarig, ställföreträdaren eller en administratör.` : "";
  // Flytta efterföljande jobb (plan 1M): the jobs that start after this one, in a chain, as many workdays as it moves; off at first.
  const asDated = data.jobs.map((item) => ({ ...item, plannedStartDate: startOf(item) }));
  const followers = changed ? followerMoves(job, before, period, asDated) : [];
  const followerShift = followerShiftWorkdays(before, period);
  const lockedFollowers = followers.filter((move) => !move.job.canEdit);
  const movingFollowers = followers.length > 0 && draft.moveFollowers && !lockedFollowers.length;
  const followerReason = lockedFollowers.length ? `Du får inte ändra ${lockedFollowers.map((move) => move.job.title || "Utan rubrik").join(", ")}. Be projektansvarig flytta dem.` : "";
  // Börjar efter (steg 4): the warnings with the new period and predecessors – shown, never blocking.
  const movedTo = new Map(movingFollowers ? followers.map((move) => [move.job.id, move.to] as const) : []);
  const simulated = data.jobs.map((item) => item.id === job.id ? { ...item, ...period, predecessorIds: draft.predecessorIds } : movedTo.has(item.id) ? { ...item, ...movedTo.get(item.id)! } : item);
  const conflicts = dependencyConflicts(simulated);
  const titleOf = (jobId: string) => data.jobs.find((item) => item.id === jobId)?.title || "Utan rubrik";
  const candidates = data.jobs.filter((item) => item.id !== job.id);
  const days = (n: number) => `${Math.abs(n)} ${Math.abs(n) === 1 ? "arbetsdag" : "arbetsdagar"} ${n > 0 ? "framåt" : "bakåt"}`;
  const notes = [
    ...(moving ? [`${ownBookings.length === 1 ? "Bokningen" : `${ownBookings.length} bokningar`} flyttas ${days(shift)} med jobbet.`] : consequences.bookingsOutside.map((booking) => `Bokningen ${bookingText(booking)} hamnar utanför jobbets period och flyttas inte.`)),
    ...(movingFollowers ? [`${followers.length === 1 ? "Efterföljande jobb" : `${followers.length} efterföljande jobb`} (${followers.map((move) => move.job.title || "Utan rubrik").join(", ")}) flyttas ${days(followerShift)} med jobbet.`] : []),
    ...conflicts.filter((conflict) => conflict.jobId === job.id).map((conflict) => `${conflictText(conflict)}.`),
    ...conflicts.filter((conflict) => conflict.predecessorId === job.id).map((conflict) => `Efterföljande jobb ${titleOf(conflict.jobId)} börjar innan det här jobbet är klart.`),
    ...consequences.milestonesPassed.map((booking) => `Milstolpen ${booking.title} (${shortDay(booking.startDay)}) passeras.`),
    ...(consequences.passesProjectEnd ? [`Jobbet slutar efter projektets slutdatum ${shortDay(frame.dueDate)}.`] : []),
    ...(consequences.beforeProjectStart ? [`Jobbet börjar före projektets start ${shortDay(frame.startDate)}.`] : []),
  ];
  return <Modal open size="form" onOpenChange={(open) => { if (!open) onCancel(); }} title={draft.dragged ? "Flytta jobbet" : "Ändra tidplan"}>
    <div className="space-y-4" data-testid="schedule-dialog">
      <div>
        <p className="text-sm font-semibold">{job.title || "Utan rubrik"}</p>
        {draft.dragged ? <p className="text-xs text-muted-foreground">Från {periodText(before)} till <strong className="text-foreground">{periodText(period)}</strong></p> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${id}-start`} label="Start" type="date" value={period.plannedStartDate} onChange={(value) => { if (value) set({ plannedStartDate: value }); }} />
        <Field id={`${id}-due`} label="Klart senast" type="date" value={period.dueDate} onChange={(value) => set({ dueDate: value })} />
        <Field id={`${id}-hours`} label="Uppskattad tid (h)" value={draft.hours} onChange={(value) => onChange({ ...draft, hours: value })} hint={drawn ? `${workdaysIn(drawn.start, drawn.end)} arbetsdagar` : undefined} />
      </div>
      {offerMove ? <div className="space-y-1" data-testid="schedule-move-bookings">
        <label className="flex items-start gap-2 text-sm">
          <Checkbox className="mt-0.5" checked={moving} disabled={Boolean(notMovable.length)} aria-describedby={moveReason ? `${id}-move-reason` : undefined} onCheckedChange={(checked) => onChange({ ...draft, moveBookings: checked === true })} data-testid="schedule-move-bookings-check" />
          <span>Flytta även bokningarna ({ownBookings.length}) {days(shift)}</span>
        </label>
        <DisabledReason id={`${id}-move-reason`} reason={moveReason} className="pl-6" />
      </div> : null}
      {followers.length ? <div className="space-y-1" data-testid="schedule-move-followers">
        <label className="flex items-start gap-2 text-sm">
          <Checkbox className="mt-0.5" checked={movingFollowers} disabled={Boolean(lockedFollowers.length)} aria-describedby={followerReason ? `${id}-follower-reason` : undefined} onCheckedChange={(checked) => onChange({ ...draft, moveFollowers: checked === true })} data-testid="schedule-move-followers-check" />
          <span>Flytta efterföljande jobb ({followers.length}) {days(followerShift)}</span>
        </label>
        <DisabledReason id={`${id}-follower-reason`} reason={followerReason} className="pl-6" />
      </div> : null}
      {candidates.length ? <CollapsibleSection title="Börjar efter" testId="schedule-predecessors" open={pickOpen} onOpenChange={setPickOpen}
        summary={draft.predecessorIds.length ? draft.predecessorIds.map(titleOf).join(", ") : "Inget annat jobb"}>
        <fieldset className="max-h-40 space-y-2 overflow-y-auto" aria-label="Jobb som ska vara klara först">
          {candidates.map((item) => <label key={item.id} className="flex items-start gap-2 text-sm">
            <Checkbox className="mt-0.5" checked={draft.predecessorIds.includes(item.id)} data-testid="schedule-predecessor-option"
              onCheckedChange={(checked) => onChange({ ...draft, predecessorIds: checked === true ? [...draft.predecessorIds, item.id] : draft.predecessorIds.filter((value) => value !== item.id) })} />
            <span className="min-w-0"><span className="block truncate">{item.title || "Utan rubrik"}</span><span className="block text-xs text-muted-foreground">{periodText(item)}</span></span>
          </label>)}
        </fieldset>
        <p className="text-xs text-muted-foreground">Jobbet ska börja när de valda jobben är klara. Tidplanen varnar om det är planerat att börja tidigare.</p>
      </CollapsibleSection> : null}
      {notes.length ? <section aria-label="Konsekvenser" data-testid="schedule-consequences" className={cn("rounded-lg border p-3 text-xs", indicatorBadge("warning"))}>
        <p className="mb-1 flex items-center gap-1.5 font-semibold"><AlertTriangle className="size-3.5" />Konsekvenser</p>
        <ul className="list-disc space-y-0.5 pl-4">{notes.map((note) => <li key={note}>{note}</li>)}</ul>
      </section> : null}
      {problem?.frame && data.project.canFrameException ? <Field id={`${id}-reason`} label="Motivering för undantag från projektets tidsram" value={draft.reason} onChange={(value) => onChange({ ...draft, reason: value })} hint={problem.message} /> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <DisabledReason id={`${id}-blocked`} reason={blocked} />
      <DialogActions cancel={{ onClick: onCancel }} primary={{ label: moving ? "Flytta jobb och bokningar" : draft.dragged ? "Flytta jobbet" : "Spara tidplan", onClick: onSave, disabled: Boolean(blocked), busy: saving, busyLabel: "Sparar…", testId: "schedule-save" }}>
        <span className="mr-auto inline-flex items-center gap-1.5 self-center text-xs text-muted-foreground"><CalendarClock className="size-3.5" />Hela arbetsdagar. Helger räknas inte.</span>
      </DialogActions>
    </div>
  </Modal>;
}
