import { addSwedishDays, swedishDayKey } from "@/lib/swedish-time";
import { capacityWeek, plannedMinutesForUserInWindow, type CapacityActivity } from "./capacity-summary";
import type { ProjectStatus } from "./project-status";

/**
 * Key figures for the overview dashboard (Daniel 2026-09-26), shared by Cloud and Local.
 * The caller passes data that is already tenant- and permission-filtered and decides the scope:
 * "team" (company admin, or the Local file owner) or "mine" (the same rule as Mina uppgifter).
 * Planned and reported time stay separate values; nothing here is stored or mutated.
 */
export type OverviewKpiTask = {
  kind: "WORK_ORDER" | "RISK_ASSESSMENT" | "FORM" | "CONTROL";
  status: string;
  dueDate: string;
  completedAt: string | null;
  isMine: boolean;
};
export type OverviewKpiProject = {
  /** From the shared project status function, so the key figure matches the "Pågående" tab. */
  status: Pick<ProjectStatus, "state" | "ongoing" | "overdue">;
  timeBudgetMinutes: number;
  reportedMinutes: number;
  isMine: boolean;
};
export type OverviewKpiTimeEntry = { userId: string; startedAt: string; durationSec: number };
export type OverviewKpiMember = { id: string; weeklyWorkMinutes: number };

export type OverviewKpis = {
  openTasks: number;
  inProgressTasks: number;
  needsActionTasks: number;
  overdueTasks: number;
  dueSoonTasks: number;
  completedLast30Days: number;
  /** Neither closed nor archived – the same projects as the "Pågående" tab in Mina projekt. */
  ongoingProjects: number;
  readyToCloseProjects: number;
  overdueProjects: number;
  overBudgetProjects: number;
  reportedMinutes: number;
  plannedMinutes: number;
  weeklyTargetMinutes: number;
  people: number;
};

const minutes = (durationSec: number) => (Number.isFinite(durationSec) ? Math.max(0, Math.round(durationSec / 60)) : 0);

export function summarizeOverviewKpis(input: {
  scope: "team" | "mine";
  currentUserId: string;
  now?: Date;
  members: OverviewKpiMember[];
  tasks: OverviewKpiTask[];
  projects: OverviewKpiProject[];
  timeEntries: OverviewKpiTimeEntry[];
  activities: CapacityActivity[];
}): OverviewKpis {
  const now = input.now ?? new Date();
  const today = swedishDayKey(now);
  const soon = swedishDayKey(addSwedishDays(now, 6));
  const monthAgo = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const week = capacityWeek(now);
  const people = input.scope === "team" ? input.members : input.members.filter((member) => member.id === input.currentUserId);
  const peopleIds = new Set(people.map((member) => member.id));
  const tasks = input.tasks.filter((task) => input.scope === "team" || task.isMine);
  const open = tasks.filter((task) => task.status !== "COMPLETED");
  const ongoingProjects = input.projects.filter((project) => project.status.ongoing && (input.scope === "team" || project.isMine));
  return {
    openTasks: open.length,
    inProgressTasks: open.filter((task) => ["IN_PROGRESS", "PAUSED"].includes(task.status)).length,
    needsActionTasks: open.filter((task) => task.status === "NEEDS_ACTION").length,
    // A control's date is not a due date (same rule as notifications), so only tasks with a due date count.
    overdueTasks: open.filter((task) => task.kind !== "CONTROL" && task.dueDate && task.dueDate < today).length,
    dueSoonTasks: open.filter((task) => task.kind !== "CONTROL" && task.dueDate && task.dueDate >= today && task.dueDate <= soon).length,
    completedLast30Days: tasks.filter((task) => task.status === "COMPLETED" && task.completedAt && new Date(task.completedAt).getTime() >= monthAgo).length,
    ongoingProjects: ongoingProjects.length,
    readyToCloseProjects: ongoingProjects.filter((project) => project.status.state === "READY_TO_CLOSE").length,
    overdueProjects: ongoingProjects.filter((project) => project.status.overdue).length,
    overBudgetProjects: ongoingProjects.filter((project) => project.timeBudgetMinutes > 0 && project.reportedMinutes > project.timeBudgetMinutes).length,
    reportedMinutes: input.timeEntries.reduce((sum, entry) => {
      const startedAt = new Date(entry.startedAt);
      if (!peopleIds.has(entry.userId) || startedAt < week.startsAt || startedAt >= week.endsAt) return sum;
      return sum + minutes(entry.durationSec);
    }, 0),
    plannedMinutes: people.reduce((sum, member) => sum + plannedMinutesForUserInWindow({ activities: input.activities, userId: member.id, startsAt: week.startsAt, endsAt: week.endsAt }), 0),
    weeklyTargetMinutes: people.reduce((sum, member) => sum + Math.max(0, Math.round(member.weeklyWorkMinutes || 0)), 0),
    people: people.length,
  };
}
