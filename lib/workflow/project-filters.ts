import type { Prisma } from "@prisma/client";
import type { ProjectStatus } from "./project-status";
import { isMyProject, isMyWork } from "./work-list";

/**
 * Projects that need attention (dashboard etapp 3, 2026-10-28: "Samma beräkningsregel i nyckeltal och lista"): the
 * project key figure counts with these, and Projekt's Status filter lists with them, in Cloud (/api/projects), Local and
 * the demo. All three are ongoing projects only (the "Pågående" tab), with the status from summarizeProjectStatus.
 */
export const PROJECT_ATTENTION = ["overdue", "overBudget", "readyToClose"] as const;
export type ProjectAttention = (typeof PROJECT_ATTENTION)[number];
export const PROJECT_ATTENTION_LABEL: Record<ProjectAttention, string> = { overdue: "Förfallna", overBudget: "Över budget", readyToClose: "Klara att avsluta" };

export type ProjectAttentionInput = { status: Pick<ProjectStatus, "state" | "ongoing" | "overdue">; timeBudgetMinutes: number; reportedMinutes: number };

/** Over its time budget: a budget is set and the reported time (work orders' and the project's own) passes it. */
export const isProjectOverBudget = (project: Pick<ProjectAttentionInput, "timeBudgetMinutes" | "reportedMinutes">) =>
  project.timeBudgetMinutes > 0 && project.reportedMinutes > project.timeBudgetMinutes;

export function projectAttention(project: ProjectAttentionInput, attention: ProjectAttention) {
  if (!project.status.ongoing) return false;
  switch (attention) {
    case "overdue": return project.status.overdue;
    case "overBudget": return isProjectOverBudget(project);
    case "readyToClose": return project.status.state === "READY_TO_CLOSE";
  }
}

/**
 * "Mina projekt" in one rule for the list and the key figure (dashboard etapp 3): I am responsible, I created it, or a job in
 * it is mine – assigned to me, created by me when nobody is assigned, or booked on me (Mina jobb, 2026-10-09).
 */
export type MyProjectTask = { assignedToUserId?: string | null; createdBy?: string | null; booked?: boolean };
export function isMineProject(project: { responsibleUserId?: string | null; createdBy?: string | null }, userId: string, tasks: readonly MyProjectTask[]) {
  return isMyProject(project, userId, tasks.some((task) => task.booked === true || isMyWork(task, userId)));
}

/** Booked on the person: the booking itself or one of its assignments, not removed and not cancelled (Mina jobb, 2026-10-09). */
export const bookedActivityWhere = (userId: string): Prisma.PlannedActivityWhereInput => ({ deletedAt: null, status: { not: "CANCELED" }, OR: [{ assignedToUserId: userId }, { assignments: { some: { member: { userId } } } }] });

/** The same rule as a database condition (Cloud's project list). */
export function myProjectWhere(userId: string): Prisma.ProjectWhereInput {
  const booked = bookedActivityWhere(userId);
  return { OR: [
    { responsibleUserId: userId }, { createdBy: userId },
    { workflowTasks: { some: { OR: [{ assignedToUserId: userId }, { assignedToUserId: null, createdBy: userId }, { plannedActivities: { some: booked } }] } } },
  ] };
}
