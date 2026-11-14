import { addSwedishDays, swedishClock, swedishDayKey } from "@/lib/swedish-time";
import { isLateTask } from "@/lib/workflow/late-tasks";
import { occurrenceOverdue, roundReminderFor, scheduleOccurrences, type ScheduleOccurrenceState, type ScheduleView } from "@/lib/workflow/form-schedule";
import { myDayJobHref } from "@/lib/workflow/my-day";
import { ME_ROWS, PLANNING_HREF, projectHref, ROUNDS_ATTENTION_HREF, TIME_REPORT_HREF, type MeTabData, type PlanItem, type PlanState, type TimeLine } from "./me";

/**
 * The pure rules of Översiktens Jag (dashboard etapp 6, 2026-10-28): Min plan from real sources only, Ej utfört
 * per round and the week's reported time. The server (lib/overview/me-server.ts) reads the rows; the tests read these.
 */
const inRange = (day: string, range: { from: string; to: string }) => day >= range.from && day <= range.to;

export type PlanWorkOrder = { id: string; title: string; status: string; dueDate: string | null; plannedStartDate: string | null };
export type PlanActivity = { id: string; title: string; status: string; startsAt: Date | string; endsAt: Date | string; workflowTask: { id: string; kind: string; title: string; status: string } | null;
  /** A booking without a job is time on its project (projekttid), when it has one. */
  projectId?: string | null };
/** The job a post's time goes on (2026-10-29: older posts too – to write time or continue): a job, or a project's own time. */
const projectJob = (id: string) => ({ id, kind: "PROJECT" });
export type PlanProject = { id: string; name: string; dueDate: string; closedAt?: Date | string | null; archivedAt?: Date | string | null };

/**
 * Min plan: my work orders (on their Start, else Klart senast), my bookings (a booking of a work order is that work order,
 * with its time), my rounds' occurrences and my projects' end dates – nothing else. A work order with a booking in the
 * month is shown by its bookings only, so it is never there twice.
 */
export function buildPlan(input: {
  range: { from: string; to: string };
  today: string;
  user: { id: string; admin: boolean };
  workOrders: readonly PlanWorkOrder[];
  activities: readonly PlanActivity[];
  rounds: readonly ScheduleView[];
  projects: readonly PlanProject[];
}): PlanItem[] {
  const { range, today } = input;
  const items: PlanItem[] = [];
  const booked = new Set<string>();
  for (const activity of input.activities) {
    if (activity.status === "CANCELED") continue;
    const task = activity.workflowTask;
    const workOrder = task?.kind === "WORK_ORDER";
    if (workOrder) booked.add(task.id);
    const startsAt = new Date(activity.startsAt);
    const endsAt = new Date(activity.endsAt);
    const first = swedishDayKey(startsAt);
    // The last day it covers (an end at midnight belongs to the day before).
    const last = swedishDayKey(new Date(endsAt.getTime() - 1));
    const done = activity.status === "COMPLETED" || task?.status === "COMPLETED";
    let day = first < range.from ? range.from : first;
    for (let guard = 0; day <= last && day <= range.to && guard < 62; guard += 1) {
      const single = first === last;
      items.push({
        id: `activity:${activity.id}:${day}`, date: day, kind: workOrder ? "work-order" : "activity",
        title: activity.title || task?.title || "Planerad aktivitet",
        href: task ? myDayJobHref(task.id, task.kind) : activity.projectId ? projectHref(activity.projectId) : PLANNING_HREF,
        ...(single ? { start: swedishClock(startsAt), end: swedishClock(endsAt) } : {}),
        state: done ? "done" : "planned",
        ...(task ? { job: { id: task.id, kind: task.kind } } : activity.projectId ? { job: projectJob(activity.projectId) } : {}),
      });
      day = swedishDayKey(addSwedishDays(new Date(`${day}T12:00:00Z`), 1));
    }
  }
  for (const order of input.workOrders) {
    if (booked.has(order.id) || order.status === "CANCELLED") continue;
    const day = order.plannedStartDate || order.dueDate || "";
    if (!day || !inRange(day, range)) continue;
    items.push({
      id: `work-order:${order.id}`, date: day, kind: "work-order", title: order.title, href: myDayJobHref(order.id, "WORK_ORDER"), job: { id: order.id, kind: "WORK_ORDER" },
      state: order.status === "COMPLETED" ? "done" : isLateTask({ status: order.status, dueDate: order.dueDate }, today) ? "missed" : "planned",
    });
  }
  for (const view of input.rounds) {
    if (!view.active || !roundReminderFor(view, input.user)) continue;
    const known = new Map<string, ScheduleOccurrenceState>();
    for (const item of [...view.overview.history, ...(view.overview.today ? [view.overview.today] : []), ...view.overview.upcoming]) known.set(item.date, item);
    for (const day of scheduleOccurrences(view.rule, range.from, range.to, 62)) {
      const occurrence = known.get(day);
      const state: PlanState = !occurrence ? "planned" : occurrence.state === "done" ? "done" : occurrence.state === "not_done" ? "not_done" : occurrenceOverdue(occurrence) ? "missed" : "planned";
      // The occurrence's protocol, else the work order that holds its day; a day no work order holds has nowhere to put time.
      const job = occurrence?.taskId ? { id: occurrence.taskId, kind: "FORM" } : occurrence?.workOrderId ? { id: occurrence.workOrderId, kind: "WORK_ORDER" } : null;
      items.push({ id: `round:${view.id}:${day}`, date: day, kind: "round", title: view.title, href: job ? myDayJobHref(job.id, job.kind) : "/?view=rounds", ...(view.rule.time ? { start: view.rule.time } : {}), state,
        ...(job ? { job } : {}) });
    }
  }
  for (const project of input.projects) {
    if (!project.dueDate || !inRange(project.dueDate, range) || project.archivedAt) continue;
    items.push({ id: `milestone:${project.id}`, date: project.dueDate, kind: "milestone", title: project.name, href: projectHref(project.id), job: projectJob(project.id),
      state: project.closedAt ? "done" : project.dueDate < today ? "missed" : "planned" });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? "99:99").localeCompare(b.start ?? "99:99") || a.title.localeCompare(b.title, "sv") || (a.id < b.id ? -1 : 1));
}

/** Ej utfört per round I am responsible for (the bell's rule), the most first. */
export function notDoneSummary(views: readonly ScheduleView[], user: { id: string; admin: boolean }, limit = ME_ROWS): NonNullable<MeTabData["notDone"]> {
  const rows = views.filter((view) => view.active && view.overview.notDone > 0 && roundReminderFor(view, user))
    .map((view) => ({ id: `not-done:${view.id}`, title: view.title, count: view.overview.notDone, detail: `${view.overview.notDone} ej utförda`, href: ROUNDS_ATTENTION_HREF }))
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title, "sv"));
  return { count: rows.reduce((sum, row) => sum + row.count, 0), rows: rows.slice(0, limit), href: ROUNDS_ATTENTION_HREF };
}

/** A time entry with what it was on: the work order (and the task it was written in) or the project. */
export type TimeEntryLine = { id: string; startedAt: Date | string; endedAt: Date | string | null; durationSec: number; title: string; kind: string | null; ownerId: string };

/** One entry as a line: a work order's or a project's page, its clock from–to and its minutes (a running one up to now). */
export function timeLine(entry: TimeEntryLine, now = new Date()): TimeLine {
  const started = new Date(entry.startedAt);
  const running = entry.endedAt ? 0 : Math.max(0, Math.floor((now.getTime() - started.getTime()) / 1000));
  return {
    id: entry.id, title: entry.title, href: !entry.ownerId ? TIME_REPORT_HREF : entry.kind ? myDayJobHref(entry.ownerId, entry.kind) : projectHref(entry.ownerId),
    start: swedishClock(started), end: entry.endedAt ? swedishClock(new Date(entry.endedAt)) : null, minutes: Math.round((entry.durationSec + running) / 60),
    ...(entry.ownerId ? entry.kind ? { taskId: entry.ownerId } : { projectId: entry.ownerId } : {}),
  };
}

/** Today's entries in time order (Swedish day). */
export function todayLines(entries: readonly TimeEntryLine[], today: string, now = new Date()): TimeLine[] {
  return entries.filter((entry) => swedishDayKey(new Date(entry.startedAt)) === today)
    .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()).map((entry) => timeLine(entry, now));
}

/**
 * The week's reported time (Monday–Sunday, Swedish days): each entry on the day it started, a running one up to now – the
 * same rule as the old key figure (app/api/overview-kpis). `ordinaryMinutes` is the person's ordinary working time.
 */
export function weekSummary(entries: readonly { startedAt: Date | string; endedAt: Date | string | null; durationSec: number }[], weekStart: Date, ordinaryMinutes: number, now = new Date()): MeTabData["week"] {
  const days = Array.from({ length: 7 }, (_, index) => ({ date: swedishDayKey(addSwedishDays(weekStart, index)), minutes: 0 }));
  const seconds = new Map<string, number>();
  for (const entry of entries) {
    const started = new Date(entry.startedAt);
    const running = entry.endedAt ? 0 : Math.max(0, Math.floor((now.getTime() - started.getTime()) / 1000));
    const day = swedishDayKey(started);
    seconds.set(day, (seconds.get(day) ?? 0) + entry.durationSec + running);
  }
  for (const day of days) day.minutes = Math.round((seconds.get(day.date) ?? 0) / 60);
  return { from: days[0].date, reportedMinutes: days.reduce((sum, day) => sum + day.minutes, 0), ordinaryMinutes, days, href: TIME_REPORT_HREF };
}
