import { addSwedishDays, swedishDayKey } from "@/lib/swedish-time";
import { capacityInWindow, capacityWeek, plannedMinutesForUserInWindow, type CapacityActivity } from "./capacity-summary";
import type { ProjectStatus } from "./project-status";
import { completedFrom, recentDoneFrom, workStateMatches, workStateOf } from "./work-list";
import type { WorkItemFilter } from "./work-items";
import { projectAttention, type ProjectAttention } from "./project-filters";
import { listHref } from "@/lib/url-filters";

/**
 * Key figures for the overview dashboard (2026-09-26), shared by Cloud and Local.
 * The caller passes data that is already tenant- and permission-filtered and decides the scope:
 * "team" (company admin, or the Local file owner) or "mine" (the same rule as Mina uppgifter).
 * Planned and reported time stay separate values; nothing here is stored or mutated.
 */
export type OverviewKpiTask = {
  kind: "WORK_ORDER" | "RISK_ASSESSMENT" | "FORM";
  status: string;
  dueDate: string;
  completedAt: string | null;
  /** The job's progress, so "pågår" is the list's Pågår (a planned job with progress is under way); missing counts as 0. */
  progress?: number | null;
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
  /** The one capacity count's available time this week (2026-11-02), what planned time is compared with; a holiday holds none. */
  availableMinutes: number;
  /** The plain weekly time, what reported time is compared with: another measure. */
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
  const doneFrom = recentDoneFrom(now);
  const week = capacityWeek(now);
  const people = input.scope === "team" ? input.members : input.members.filter((member) => member.id === input.currentUserId);
  const peopleIds = new Set(people.map((member) => member.id));
  const tasks = input.tasks.filter((task) => input.scope === "team" || task.isMine);
  // Dashboard etapp 3 (2026-10-28): every task figure counts with the job list's own filter rule (workStateMatches), so
  // the tile's list shows exactly the jobs it counts. Utgått jobs (2026-10-09) are neither open, late nor due.
  const entries = tasks.map((task) => ({ ...task, state: workStateOf(task) }));
  const count = (filter: WorkItemFilter) => entries.filter((entry) => workStateMatches(entry, filter, today)).length;
  const open = entries.filter((entry) => workStateMatches(entry, "open", today));
  const ongoingProjects = input.projects.filter((project) => project.status.ongoing && (input.scope === "team" || project.isMine));
  return {
    openTasks: open.length,
    inProgressTasks: count("active"),
    needsActionTasks: count("action"),
    overdueTasks: count("overdue"),
    dueSoonTasks: open.filter((task) => task.dueDate && task.dueDate >= today && task.dueDate <= soon).length,
    completedLast30Days: entries.filter((entry) => workStateMatches(entry, "done", today) && completedFrom(entry, doneFrom)).length,
    ongoingProjects: ongoingProjects.length,
    readyToCloseProjects: ongoingProjects.filter((project) => projectAttention(project, "readyToClose")).length,
    overdueProjects: ongoingProjects.filter((project) => projectAttention(project, "overdue")).length,
    overBudgetProjects: ongoingProjects.filter((project) => projectAttention(project, "overBudget")).length,
    reportedMinutes: input.timeEntries.reduce((sum, entry) => {
      const startedAt = new Date(entry.startedAt);
      if (!peopleIds.has(entry.userId) || startedAt < week.startsAt || startedAt >= week.endsAt) return sum;
      return sum + minutes(entry.durationSec);
    }, 0),
    plannedMinutes: people.reduce((sum, member) => sum + plannedMinutesForUserInWindow({ activities: input.activities, userId: member.id, startsAt: week.startsAt, endsAt: week.endsAt, weeklyWorkMinutes: member.weeklyWorkMinutes }), 0),
    availableMinutes: people.reduce((sum, member) => sum + (capacityInWindow({ person: member, activities: input.activities, startsAt: week.startsAt, endsAt: week.endsAt }).availableMinutes ?? 0), 0),
    weeklyTargetMinutes: people.reduce((sum, member) => sum + Math.max(0, Math.round(member.weeklyWorkMinutes || 0)), 0),
    people: people.length,
  };
}

/**
 * The line under a key figure and whether it warns (MOB-16, 2026-10-18): a zero never alarms. "Förfallna" warns only about
 * what is late or due soon, never in red about "0 förfaller inom 7 dagar"; the project tile names only what is not zero.
 */
export function overdueDetail(kpis: Pick<OverviewKpis, "overdueTasks" | "dueSoonTasks">) {
  return { text: `${kpis.dueSoonTasks} förfaller inom 7 dagar`, tone: kpis.dueSoonTasks ? "warning" as const : null };
}
export function projectDetail(kpis: Pick<OverviewKpis, "readyToCloseProjects" | "overdueProjects" | "overBudgetProjects">) {
  const parts = [
    kpis.readyToCloseProjects ? `${kpis.readyToCloseProjects} ${kpis.readyToCloseProjects === 1 ? "klart" : "klara"} att avsluta` : "",
    kpis.overdueProjects ? `${kpis.overdueProjects} ${kpis.overdueProjects === 1 ? "förfallet" : "förfallna"}` : "",
    kpis.overBudgetProjects ? `${kpis.overBudgetProjects} över budget` : "",
  ].filter(Boolean);
  return { text: parts.length ? parts.join(" · ") : "Inget förfallet", tone: kpis.overdueProjects || kpis.overBudgetProjects ? "danger" as const : null };
}

/**
 * Where a key figure leads (dashboard etapp 3, 2026-10-28: "Varje nyckeltal ska öppna rätt lista med rätt filter"):
 * the existing job list or project list with the filter whose rule the figure counts with, Teamet as Alla and Jag as Mina.
 * The job figures count every kind, so the job list is opened with Typ Alla (also on a computer).
 */
export type OverviewKpiLink = "openTasks" | "needsActionTasks" | "overdueTasks" | "completedLast30Days" | "ongoingProjects" | ProjectAttention;
export function overviewKpiHref(kpi: OverviewKpiLink, scope: "team" | "mine", now: Date = new Date()) {
  const listScope = scope === "team" ? "all" : "mine";
  const jobs = (filter: WorkItemFilter, from?: string) => listHref("tasks", { type: "all", filter, scope: listScope, from });
  switch (kpi) {
    case "openTasks": return jobs("open");
    case "needsActionTasks": return jobs("action");
    case "overdueTasks": return jobs("overdue");
    case "completedLast30Days": return jobs("done", recentDoneFrom(now));
    case "ongoingProjects": return listHref("projects", { filter: "ongoing", scope: listScope });
    default: return listHref("projects", { filter: "ongoing", status: kpi, scope: listScope });
  }
}
