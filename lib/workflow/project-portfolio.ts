import { swedishDayKey } from "@/lib/swedish-time";
import { plannedMinutesByTask, type CapacityActivity } from "./capacity-summary";
import { effectiveStartDate, type JobObstacle } from "./planning-adapters";
import { projectEffort, type ProjectEffort } from "./project-effort";
import { summarizeFrameAdherence, type FrameAdherenceState } from "./project-progress";
import type { ProjectState, ProjectStatus } from "./project-status";
import { isTaskClosed } from "./task-cancel";
import { isLateTask } from "./late-tasks";

/**
 * Projektportföljen (plan 1M, 2026-10-11): one row per project for Projektstatistik and Planering – customer,
 * responsible, status, whether the time frame is followed, completion, Budget · Offererat · Uppskattat · Bokat ·
 * Rapporterat, obstacles, the next milestone and the end date – and the list of obstacles and delays across projects.
 * Nothing is calculated here that the project page does not already show: the figures come from the same rules
 * (projectEffort, summarizeFrameAdherence, summarizeProjectStatus) over the same data. Pure, shared by the server's route
 * and the demo. No purchase prices or markups ever enter: the input has none.
 */
export type PortfolioJob = {
  id: string; title: string; kind: string; status: string; progress: number; dueDate: string; plannedStartDate: string; createdAt: string | Date;
  estimatedMinutes: number | null; totalDurationSec: number;
  /** The reported obstacle, from lib/workflow/planning-adapters.ts. */
  obstacle: JobObstacle | null;
};
export type PortfolioBooking = CapacityActivity & { id: string; title: string; kind: string; workflowTaskId: string | null; deletedAt?: string | null };
export type PortfolioProjectInput = {
  id: string; name: string; customerName: string; responsibleName: string; startDate: string; dueDate: string;
  timeBudgetMinutes: number | null;
  /** The agreed quote versions' Arbete hours in minutes; null when none or when the person may not read quotes. */
  quotedMinutes: number | null;
  /** The project's status, summarised over all of its jobs and planning (summarizeProjectStatus). */
  status: ProjectStatus;
  /** The jobs the person may read. */
  jobs: PortfolioJob[];
  /** The bookings the person may read (also the milestones). */
  bookings: PortfolioBooking[];
  /** The project's own time without a work order (Projekttid, 2026-10-26), in seconds. */
  projectTimeSec?: number;
};

export type PortfolioMilestone = { day: string; title: string };
export type PortfolioRow = {
  id: string; name: string; customer: string; responsible: string;
  state: ProjectState; statusLabel: string; ongoing: boolean; overdue: boolean;
  frame: { state: FrameAdherenceState; label: string };
  completion: number; jobsDone: number; jobsTotal: number;
  budgetMinutes: number | null; quotedMinutes: number | null;
  effort: ProjectEffort;
  obstacles: number; lateJobs: number;
  nextMilestone: PortfolioMilestone | null;
  milestones: PortfolioMilestone[];
  startDate: string; endDate: string;
  /** The bar on the multi-project plan: the project's frame, else the span of its jobs; null when it cannot be drawn. */
  bar: { start: string; end: string } | null;
  /** The first day an obstacle was reported, to mark on the bar; "" without. */
  obstacleSince: string;
};
export type PortfolioIssue = {
  key: string; projectId: string; projectName: string; taskId: string; taskKind: string; title: string; kind: "OBSTACLE" | "LATE";
  /** The obstacle's reason (väntar på material …) or "Förfallet". */
  reason: string; text: string; days: number;
};
export type Portfolio = { today: string; rows: PortfolioRow[]; issues: PortfolioIssue[] };

const dayNumber = (key: string) => { const [year, month, day] = key.split("-").map(Number); return Date.UTC(year, month - 1, day) / 86_400_000; };
const daysSince = (from: string, today: string) => Math.max(0, dayNumber(today) - dayNumber(from));
/** The Swedish calendar day of a date or timestamp (a plain day key passes through). */
const dayOf = (value: string | Date) => {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : swedishDayKey(date);
};
const isLate = (job: PortfolioJob, today: string) => isLateTask(job, today);

/** Delayed projects first, then those with obstacles, then the rest; each group by end date (no date last), then name. */
export function sortPortfolio(rows: readonly PortfolioRow[]): PortfolioRow[] {
  const tier = (row: PortfolioRow) => (row.overdue || row.lateJobs > 0 ? 0 : row.obstacles > 0 ? 1 : 2);
  return [...rows].sort((a, b) => tier(a) - tier(b)
    || (a.endDate ? 0 : 1) - (b.endDate ? 0 : 1) || a.endDate.localeCompare(b.endDate)
    || a.name.localeCompare(b.name, "sv-SE"));
}

export function summarizePortfolio(input: { projects: readonly PortfolioProjectInput[]; now?: Date }): Portfolio {
  const today = swedishDayKey(input.now ?? new Date());
  const rows: PortfolioRow[] = [];
  const issues: PortfolioIssue[] = [];
  for (const project of input.projects) {
    const active = project.bookings.filter((booking) => !booking.deletedAt && booking.status !== "CANCELED");
    const effort = projectEffort(project.jobs.map((job) => ({ id: job.id, status: job.status, progress: job.progress, estimatedMinutes: job.estimatedMinutes, totalDurationSec: job.totalDurationSec })), plannedMinutesByTask(active), { projectSeconds: project.projectTimeSec ?? 0 });
    // Milestones: the deadline bookings, and the project's end date is always one (plan 1M).
    const milestones: PortfolioMilestone[] = [
      ...active.filter((booking) => booking.kind === "DEADLINE").map((booking) => ({ day: dayOf(booking.startsAt), title: booking.title })).filter((item) => item.day),
      ...(project.dueDate ? [{ day: project.dueDate, title: "Projektets slutdatum" }] : []),
    ].sort((a, b) => a.day.localeCompare(b.day));
    const obstacleJobs = project.jobs.filter((job) => !isTaskClosed(job.status) && job.obstacle);
    const lateJobs = project.jobs.filter((job) => isLate(job, today));
    for (const job of obstacleJobs) issues.push({ key: `o-${job.id}`, projectId: project.id, projectName: project.name, taskId: job.id, taskKind: job.kind, title: job.title, kind: "OBSTACLE", reason: job.obstacle!.reason, text: job.obstacle!.text, days: daysSince(dayOf(job.obstacle!.since) || today, today) });
    for (const job of lateJobs) issues.push({ key: `l-${job.id}`, projectId: project.id, projectName: project.name, taskId: job.id, taskKind: job.kind, title: job.title, kind: "LATE", reason: "Förfallet", text: `Klart senast ${job.dueDate}`, days: daysSince(job.dueDate, today) });
    const startDays = project.jobs.map((job) => effectiveStartDate(job)).filter(Boolean).sort();
    const endDays = [...project.jobs.map((job) => job.dueDate), ...active.map((booking) => dayOf(booking.endsAt))].filter(Boolean).sort();
    const start = project.startDate || startDays[0] || "";
    const end = project.dueDate || endDays[endDays.length - 1] || "";
    const sinceDays = obstacleJobs.map((job) => dayOf(job.obstacle!.since)).filter(Boolean).sort();
    const adherence = summarizeFrameAdherence({ startDate: project.startDate, dueDate: project.dueDate, completion: effort.completion, now: input.now });
    rows.push({
      id: project.id, name: project.name, customer: project.customerName, responsible: project.responsibleName,
      state: project.status.state, statusLabel: project.status.label, ongoing: project.status.ongoing, overdue: project.status.overdue,
      frame: { state: adherence.state, label: adherence.label },
      completion: effort.completion, jobsDone: effort.completedJobs, jobsTotal: effort.jobs,
      budgetMinutes: project.timeBudgetMinutes ? project.timeBudgetMinutes : null, quotedMinutes: project.quotedMinutes,
      effort, obstacles: obstacleJobs.length, lateJobs: lateJobs.length,
      nextMilestone: milestones.find((item) => item.day >= today) ?? null, milestones,
      startDate: project.startDate, endDate: project.dueDate,
      bar: start && end && start <= end ? { start, end } : null,
      obstacleSince: sinceDays[0] ?? (obstacleJobs.length ? today : ""),
    });
  }
  // Longest delay first, obstacles before delays of the same age, then by project name (stable).
  issues.sort((a, b) => b.days - a.days || (a.kind === b.kind ? 0 : a.kind === "OBSTACLE" ? -1 : 1) || a.projectName.localeCompare(b.projectName, "sv-SE"));
  return { today, rows: sortPortfolio(rows), issues };
}
