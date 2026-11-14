import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { summarizeProjectStatus } from "./project-status";
import { projectAttention, type ProjectAttention } from "./project-filters";

/**
 * Reported minutes per project as the key figures count them: time on the project's jobs and the project's own time
 * (Projekttid, 2026-10-26), summed from the company's own jobs and projects (quality check 2026-10-05).
 */
export async function projectReportedMinutes(organizationId: string, projectIds?: readonly string[]) {
  if (projectIds && !projectIds.length) return new Map<string, number>();
  const only = (column: Prisma.Sql) => projectIds ? Prisma.sql`and ${column} in (${Prisma.join(projectIds)})` : Prisma.empty;
  const rows = await prisma.$queryRaw<{ projectId: string; seconds: bigint | number | null }[]>(Prisma.sql`
    select "projectId", sum(seconds) as seconds from (
      select t."projectId", e."durationSec" as seconds
      from "WorkflowTask" t join "WorkflowTimeEntry" e on e."taskId" = t.id
      where t."organizationId" = ${organizationId} and t."projectId" is not null ${only(Prisma.sql`t."projectId"`)}
      union all
      select p.id, e."durationSec"
      from "Project" p join "WorkflowTimeEntry" e on e."projectId" = p.id
      where p."organizationId" = ${organizationId} ${only(Prisma.sql`p.id`)}
    ) owned group by 1`);
  return new Map(rows.map((row) => [row.projectId, Math.round(Number(row.seconds ?? 0) / 60)]));
}

/**
 * The ids of the ongoing projects (within `where`) that need the given attention (dashboard etapp 3, 2026-10-28), by
 * the key figure's rule: status from summarizeProjectStatus over every job and all planning, budget against reported time.
 */
export async function projectIdsNeedingAttention(organizationId: string, where: Prisma.ProjectWhereInput, attention: ProjectAttention) {
  const projects = await prisma.project.findMany({
    where: { AND: [{ organizationId, archivedAt: null, closedAt: null }, where] },
    select: {
      id: true, archivedAt: true, closedAt: true, startDate: true, dueDate: true, timeBudgetMinutes: true,
      workflowTasks: { select: { id: true, status: true } },
      plannedActivities: { where: { deletedAt: null }, select: { status: true, endsAt: true, workflowTaskId: true } },
    },
  });
  const reported = attention === "overBudget" ? await projectReportedMinutes(organizationId, projects.map((project) => project.id)) : new Map<string, number>();
  return projects.filter((project) => projectAttention({
    status: summarizeProjectStatus({ archivedAt: project.archivedAt, closedAt: project.closedAt, startDate: project.startDate, dueDate: project.dueDate, tasks: project.workflowTasks, activities: project.plannedActivities }),
    timeBudgetMinutes: project.timeBudgetMinutes, reportedMinutes: reported.get(project.id) ?? 0,
  }, attention)).map((project) => project.id);
}
