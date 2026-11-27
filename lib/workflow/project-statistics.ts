import { timeSeries } from "@/lib/kfid/analytics";
import type { ProjectState, ProjectStatus } from "./project-status";
import type { TaskStatisticsBucket } from "./task-statistics";

/**
 * Project statistics on Översikt (2026-09-27: "the customer should feel secure about the organisation"):
 * projects started and closed per period, closed on time, the current status spread, per responsible and a paged
 * list. The status is the shared project status; nothing here reads task content.
 */
export const PROJECT_STATISTICS_LIST_FILTERS = ["period", "ongoing", "overdue", "closed"] as const;
export type ProjectStatisticsListFilter = (typeof PROJECT_STATISTICS_LIST_FILTERS)[number];

export type ProjectStatisticsInput = {
  id: string;
  name: string;
  responsibleName: string;
  startDate: string;
  dueDate: string;
  /** Swedish day the project was created; used as start when the project has no start date. */
  createdDay: string;
  closedDay: string | null;
  archivedDay: string | null;
  status: ProjectStatus;
  tasksTotal: number;
  tasksDone: number;
};

export type ProjectStatisticsPoint = { date: string; started: number; closed: number; cumulativeStarted: number; cumulativeClosed: number };

const startedDay = (project: ProjectStatisticsInput) => project.startDate || project.createdDay;
const inPeriod = (day: string | null, from: string, to: string) => Boolean(day) && day! >= from && day! <= to;
/** Closed on time: closed on or before the end date. Projects without an end date are not counted either way. */
const closedOnTime = (project: ProjectStatisticsInput) => Boolean(project.closedDay && project.dueDate) && project.closedDay! <= project.dueDate;

const countByDay = (days: string[]) => [...days.reduce((map, day) => map.set(day, (map.get(day) ?? 0) + 1), new Map<string, number>())].map(([date, count]) => ({ date, count }));

const STATE_ORDER: ProjectState[] = ["PLANNED", "IN_PROGRESS", "READY_TO_CLOSE", "CLOSED", "ARCHIVED"];

export function summarizeProjectStatistics(input: {
  projects: ProjectStatisticsInput[];
  from: string;
  to: string;
  bucket: TaskStatisticsBucket;
  filter?: ProjectStatisticsListFilter;
  page?: number;
  pageSize?: number;
}) {
  const { projects, from, to } = input;
  const started = projects.map(startedDay).filter((day) => inPeriod(day, from, to));
  const closed = projects.filter((project) => inPeriod(project.closedDay, from, to));
  const startedSeries = timeSeries(countByDay(started), from, to, input.bucket, 0);
  const closedSeries = timeSeries(countByDay(closed.map((project) => project.closedDay!)), from, to, input.bucket, 0);
  const series: ProjectStatisticsPoint[] = startedSeries.map((row, index) => ({
    date: row.date,
    started: row.count,
    closed: closedSeries[index]?.count ?? 0,
    cumulativeStarted: row.cumulative,
    cumulativeClosed: closedSeries[index]?.cumulative ?? 0,
  }));
  const withEnd = closed.filter((project) => project.dueDate);
  const onTime = withEnd.filter(closedOnTime).length;
  const ongoing = projects.filter((project) => project.status.ongoing);
  const overdue = ongoing.filter((project) => project.status.overdue);

  // Current spread of every project; overdue is shown on top of its state, not as a separate state.
  const statuses = STATE_ORDER.map((state) => {
    const matching = projects.filter((project) => project.status.state === state);
    return { state, label: matching[0]?.status.label ?? labelFor(state), count: matching.length, overdue: matching.filter((project) => project.status.overdue).length };
  });

  const byResponsible = new Map<string, { name: string; ongoing: number; overdue: number; closed: number; closedOnTime: number }>();
  for (const project of projects) {
    const isClosed = inPeriod(project.closedDay, from, to);
    if (!project.status.ongoing && !isClosed) continue;
    const name = project.responsibleName || "Ingen ansvarig";
    const row = byResponsible.get(name) ?? { name, ongoing: 0, overdue: 0, closed: 0, closedOnTime: 0 };
    if (project.status.ongoing) row.ongoing += 1;
    if (project.status.overdue) row.overdue += 1;
    if (isClosed) { row.closed += 1; if (closedOnTime(project)) row.closedOnTime += 1; }
    byResponsible.set(name, row);
  }
  const responsible = [...byResponsible.values()].sort((a, b) => b.overdue - a.overdue || b.ongoing - a.ongoing || b.closed - a.closed || a.name.localeCompare(b.name, "sv")).slice(0, 30);

  // The list: overdue first, then ongoing by nearest end date, then closed by latest closing.
  const filter = input.filter ?? "period";
  const listed = projects.filter((project) => {
    if (filter === "ongoing") return project.status.ongoing;
    if (filter === "overdue") return project.status.overdue;
    if (filter === "closed") return inPeriod(project.closedDay, from, to);
    const end = project.closedDay ?? project.archivedDay;
    return startedDay(project) <= to && (!end || end >= from);
  }).sort((a, b) => Number(b.status.overdue) - Number(a.status.overdue) || Number(b.status.ongoing) - Number(a.status.ongoing)
    || (a.status.ongoing ? (a.dueDate || "9999").localeCompare(b.dueDate || "9999") : (b.closedDay ?? "").localeCompare(a.closedDay ?? ""))
    || a.name.localeCompare(b.name, "sv"));
  const pageSize = input.pageSize ?? 10;
  const pages = Math.max(1, Math.ceil(listed.length / pageSize));
  const page = Math.min(pages, Math.max(1, Math.floor(input.page ?? 1)));

  return {
    series,
    kpis: {
      started: started.length,
      closed: closed.length,
      closedWithEnd: withEnd.length,
      closedOnTime: onTime,
      onTimePercent: withEnd.length ? Math.round((onTime / withEnd.length) * 100) : null,
      ongoing: ongoing.length,
      overdue: overdue.length,
    },
    statuses,
    responsible,
    list: {
      items: listed.slice((page - 1) * pageSize, page * pageSize).map((project) => ({
        id: project.id, name: project.name, responsibleName: project.responsibleName, startDate: startedDay(project), dueDate: project.dueDate,
        closedDay: project.closedDay, state: project.status.state, label: project.status.label, overdue: project.status.overdue,
        onTime: project.closedDay && project.dueDate ? closedOnTime(project) : null, tasksTotal: project.tasksTotal, tasksDone: project.tasksDone,
      })),
      page,
      pages,
      total: listed.length,
    },
  };
}

function labelFor(state: ProjectState): ProjectStatus["label"] {
  return ({ PLANNED: "Planerat", IN_PROGRESS: "Pågår", READY_TO_CLOSE: "Klar att avsluta", CLOSED: "Avslutat", ARCHIVED: "Arkiverat" } as const)[state];
}
