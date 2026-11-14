import { timeEntryInOrganization } from "@/lib/workflow/timer-server";
import { organizationModuleOn } from "@/lib/workflow/modules";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { context, failure, requireCloudStorage } from "@/lib/kfid/server";
import { canViewTeam, hasWorkflowPermission, workflowSubjectForTask, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { canReadPlannedActivity } from "@/lib/workflow/planned-activity-access";
import { activitiesInUse, capacityWeek } from "@/lib/workflow/capacity-summary";
import { summarizeOverviewKpis, type OverviewKpiProject, type OverviewKpiTask } from "@/lib/workflow/overview-kpis";
import { isMineProject } from "@/lib/workflow/project-filters";
import { summarizeProjectStatus } from "@/lib/workflow/project-status";
import { expectedWeeklyWorkMinutes } from "@/lib/workflow/work-schedule";

export const dynamic = "force-dynamic";

/**
 * Read-only key figures for the overview. Everything is filtered by tenant and module read permission
 * before it is counted. Team figures (including other members' reported time) exist only for those who may see Teamet
 * (company admins or team:read, 2026-10-28); the module filtering is the same for them. Everyone gets "mine" with
 * the same rule as Mina uppgifter. Queries are bounded to what the figures need.
 */
export async function GET() {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const can = (subject: WorkflowPermissionSubject) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "read");
    const week = capacityWeek();
    const team = canViewTeam(ctx);
    const memberScope = team ? {} : { userId: ctx.user.id };
    const [members, workflowTasks, projects, projectMinutes, timeEntries, activities] = await Promise.all([
      prisma.organizationMember.findMany({
        where: { organizationId: ctx.organizationId, isActive: true, ...memberScope, user: { is: { isActive: true } } },
        select: { userId: true, weeklyWorkMinutes: true, noFixedHours: true },
      }),
      prisma.workflowTask.findMany({
        where: { organizationId: ctx.organizationId },
        select: { id: true, kind: true, formArea: true, status: true, progress: true, dueDate: true, completedAt: true, updatedAt: true, assignedToUserId: true, createdBy: true, projectId: true },
      }),
      can("projects") && organizationModuleOn(ctx.organization, "projects")
        ? prisma.project.findMany({
            where: { organizationId: ctx.organizationId },
            select: {
              id: true, archivedAt: true, closedAt: true, startDate: true, dueDate: true, timeBudgetMinutes: true, responsibleUserId: true, createdBy: true,
              // Status uses every linked task and all planning, whatever the viewer may read: one status for everyone.
              workflowTasks: { select: { id: true, status: true, assignedToUserId: true, createdBy: true } },
              plannedActivities: { where: { deletedAt: null }, select: { status: true, endsAt: true, workflowTaskId: true } },
            },
          })
        : Promise.resolve([]),
      prisma.$queryRaw<{ projectId: string; seconds: bigint | number | null }[]>(Prisma.sql`
        -- Time on work orders counts toward the project, and the project's own time (Projekttid, 2026-10-26); the sum starts
        -- from the company's own work orders and projects (quality check 2026-10-05).
        select "projectId", sum(seconds) as seconds from (
          select t."projectId", e."durationSec" as seconds
          from "WorkflowTask" t join "WorkflowTimeEntry" e on e."taskId" = t.id
          where t."organizationId" = ${ctx.organizationId} and t."projectId" is not null
          union all
          select p.id, e."durationSec"
          from "Project" p join "WorkflowTimeEntry" e on e."projectId" = p.id
          where p."organizationId" = ${ctx.organizationId}
        ) owned group by 1`),
      // Företagets moduler (0.39.0): the figures stop counting what the company has turned off.
      !organizationModuleOn(ctx.organization, "time") ? [] : prisma.workflowTimeEntry.findMany({
        where: { startedAt: { gte: week.startsAt, lt: week.endsAt }, AND: [timeEntryInOrganization(ctx.organizationId)], ...(team ? {} : { userId: ctx.user.id }) },
        select: { userId: true, startedAt: true, endedAt: true, durationSec: true },
      }),
      !organizationModuleOn(ctx.organization, "planning") ? [] : prisma.plannedActivity.findMany({
        where: { organizationId: ctx.organizationId, deletedAt: null, startsAt: { lt: week.endsAt }, endsAt: { gt: week.startsAt } },
        include: {
          workflowTask: { select: { kind: true, formArea: true, status: true, projectId: true } },
          assignments: { select: { plannedMinutes: true, startsAt: true, endsAt: true, member: { select: { userId: true } } } },
        },
      }).then((rows) => activitiesInUse(rows, ctx.organization)),
    ]);
    // "Mina" also holds the jobs the person is booked on (Mina jobb, 2026-10-09), so Hem counts what the list shows (2026-10-12).
    const bookedRows = await prisma.plannedActivity.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null, workflowTaskId: { not: null }, status: { not: "CANCELED" }, OR: [{ assignedToUserId: ctx.user.id }, { assignments: { some: { member: { userId: ctx.user.id } } } }] },
      select: { workflowTaskId: true },
    });
    const booked = new Set(bookedRows.map((row) => row.workflowTaskId));
    const readableTasks = workflowTasks.filter((task) => can(workflowSubjectForTask(task.kind, task.formArea)));
    const tasks: (OverviewKpiTask & { projectId: string | null })[] = [
      ...readableTasks.map((task) => ({
        kind: task.kind as "WORK_ORDER" | "RISK_ASSESSMENT" | "FORM",
        status: task.status,
        progress: task.progress,
        dueDate: task.dueDate,
        completedAt: task.completedAt?.toISOString() ?? null,
        isMine: task.assignedToUserId === ctx.user.id || (!task.assignedToUserId && task.createdBy === ctx.user.id) || booked.has(task.id),
        projectId: task.projectId,
      })),
    ];
    const reported = new Map(projectMinutes.map((row) => [row.projectId, Math.round(Number(row.seconds ?? 0) / 60)]));
    const projectRows: OverviewKpiProject[] = projects.map((project) => {
      return {
        status: summarizeProjectStatus({ archivedAt: project.archivedAt, closedAt: project.closedAt, startDate: project.startDate, dueDate: project.dueDate, tasks: project.workflowTasks, activities: project.plannedActivities }),
        timeBudgetMinutes: project.timeBudgetMinutes,
        reportedMinutes: reported.get(project.id) ?? 0,
        // Mina projekt by the same rule as the project list (lib/workflow/project-filters.ts, dashboard etapp 3).
        isMine: isMineProject(project, ctx.user.id, project.workflowTasks.map((task) => ({ assignedToUserId: task.assignedToUserId, createdBy: task.createdBy, booked: booked.has(task.id) }))),
      };
    });
    const now = Date.now();
    const input = {
      currentUserId: ctx.user.id,
      // Ingen fast arbetstid (2026-10-30): no weekly target (0).
      members: members.map((member) => ({ id: member.userId, weeklyWorkMinutes: expectedWeeklyWorkMinutes(ctx.organization.weeklyWorkMinutes, member) })),
      tasks,
      projects: projectRows,
      timeEntries: timeEntries.map((entry) => ({
        userId: entry.userId,
        startedAt: entry.startedAt.toISOString(),
        durationSec: entry.durationSec + (!entry.endedAt ? Math.max(0, Math.floor((now - entry.startedAt.getTime()) / 1000)) : 0),
      })),
      activities: activities.filter((activity) => canReadPlannedActivity(ctx.workflowPermissions, ctx.admin, activity)).map((activity) => ({
        startsAt: activity.startsAt.toISOString(),
        endsAt: activity.endsAt.toISOString(),
        assignedToUserId: activity.assignedToUserId,
        assignedToUserIds: activity.assignments.map((assignment) => assignment.member.userId),
        assignments: activity.assignments.map((assignment) => ({ userId: assignment.member.userId, plannedMinutes: assignment.plannedMinutes, startsAt: assignment.startsAt?.toISOString() ?? null, endsAt: assignment.endsAt?.toISOString() ?? null })),
        status: activity.status as "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELED",
        projectId: activity.projectId,
        workflowTask: activity.workflowTask ? { status: activity.workflowTask.status } : null,
      })),
    };
    return NextResponse.json({
      canViewTeam: team,
      team: team ? summarizeOverviewKpis({ ...input, scope: "team" }) : null,
      mine: summarizeOverviewKpis({ ...input, scope: "mine" }),
    });
  } catch (error) {
    return failure(error);
  }
}
