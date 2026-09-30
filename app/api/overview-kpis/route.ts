import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { context, failure, requireCloudStorage } from "@/lib/kfid/server";
import { hasWorkflowPermission, workflowSubjectForTask, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { canReadPlannedActivity } from "@/lib/workflow/planned-activity-access";
import { capacityWeek } from "@/lib/workflow/capacity-summary";
import { normalizeControl, validateForCompletion } from "@/lib/kfid/model";
import { summarizeOverviewKpis, type OverviewKpiProject, type OverviewKpiTask } from "@/lib/workflow/overview-kpis";
import { summarizeProjectStatus } from "@/lib/workflow/project-status";

export const dynamic = "force-dynamic";

/**
 * Read-only key figures for the overview. Everything is filtered by tenant and module read permission
 * before it is counted. Team figures (including other members' reported time) exist only for company admins;
 * everyone gets "mine" with the same rule as Mina uppgifter. Queries are bounded to what the figures need.
 */
export async function GET() {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const can = (subject: WorkflowPermissionSubject) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "read");
    const week = capacityWeek();
    const memberScope = ctx.admin ? {} : { userId: ctx.user.id };
    const [members, workflowTasks, controls, projects, projectMinutes, timeEntries, activities] = await Promise.all([
      prisma.organizationMember.findMany({
        where: { organizationId: ctx.organizationId, isActive: true, ...memberScope, user: { is: { isActive: true } } },
        select: { userId: true, weeklyWorkMinutes: true },
      }),
      prisma.workflowTask.findMany({
        where: { organizationId: ctx.organizationId },
        select: { kind: true, formArea: true, status: true, dueDate: true, completedAt: true, updatedAt: true, assignedToUserId: true, createdBy: true, projectId: true },
      }),
      can("kfid")
        ? prisma.control.findMany({
            where: { organizationId: ctx.organizationId, deletedAt: null },
            select: { id: true, status: true, updatedAt: true, createdBy: true, performer: true, projectId: true },
          })
        : Promise.resolve([]),
      can("projects")
        ? prisma.project.findMany({
            where: { organizationId: ctx.organizationId },
            select: {
              id: true, archivedAt: true, closedAt: true, startDate: true, dueDate: true, timeBudgetMinutes: true, responsibleUserId: true,
              // Status uses every linked task and all planning, whatever the viewer may read: one status for everyone.
              workflowTasks: { select: { status: true } },
              controls: { where: { deletedAt: null }, select: { status: true } },
              plannedActivities: { where: { deletedAt: null }, select: { status: true, endsAt: true } },
            },
          })
        : Promise.resolve([]),
      prisma.$queryRaw<{ projectId: string; seconds: bigint | number | null }[]>(Prisma.sql`
        -- Time on tasks and (decision 13) on controls counts toward the project.
        select coalesce(t."projectId", c."projectId") as "projectId", sum(e."durationSec") as seconds
        from "WorkflowTimeEntry" e left join "WorkflowTask" t on t.id = e."taskId" left join "Control" c on c.id = e."controlId" and c."deletedAt" is null
        where coalesce(t."organizationId", c."organizationId") = ${ctx.organizationId} and coalesce(t."projectId", c."projectId") is not null
        group by 1`),
      prisma.workflowTimeEntry.findMany({
        where: { startedAt: { gte: week.startsAt, lt: week.endsAt }, OR: [{ task: { organizationId: ctx.organizationId } }, { control: { organizationId: ctx.organizationId, deletedAt: null } }], ...(ctx.admin ? {} : { userId: ctx.user.id }) },
        select: { userId: true, startedAt: true, endedAt: true, durationSec: true },
      }),
      prisma.plannedActivity.findMany({
        where: { organizationId: ctx.organizationId, deletedAt: null, startsAt: { lt: week.endsAt }, endsAt: { gt: week.startsAt } },
        include: {
          workflowTask: { select: { kind: true, formArea: true } }, control: { select: { id: true } },
          assignments: { select: { plannedMinutes: true, startsAt: true, endsAt: true, member: { select: { userId: true } } } },
        },
      }),
    ]);
    // An open control with remaining mandatory points needs action, as in the notifications (2026-09-26). Only open
    // controls are validated; completed ones are immutable.
    const openControlIds = controls.filter((control) => control.status !== "COMPLETED").map((control) => control.id);
    const openControlData = openControlIds.length ? await prisma.control.findMany({
      where: { id: { in: openControlIds }, organizationId: ctx.organizationId },
      select: { id: true, data: true, _count: { select: { attachments: true } } },
    }) : [];
    const controlNeedsAction = new Set(openControlData.filter((control) => validateForCompletion(normalizeControl(control.data), { attachmentCount: control._count.attachments }).errors.length).map((control) => control.id));
    const readableTasks = workflowTasks.filter((task) => can(workflowSubjectForTask(task.kind, task.formArea)));
    const tasks: (OverviewKpiTask & { projectId: string | null })[] = [
      ...readableTasks.map((task) => ({
        kind: task.kind as "WORK_ORDER" | "RISK_ASSESSMENT" | "FORM",
        status: task.status,
        dueDate: task.dueDate,
        completedAt: task.completedAt?.toISOString() ?? null,
        isMine: task.assignedToUserId === ctx.user.id || (!task.assignedToUserId && task.createdBy === ctx.user.id),
        projectId: task.projectId,
      })),
      ...controls.map((control) => ({
        kind: "CONTROL" as const,
        status: control.status === "COMPLETED" ? "COMPLETED" : controlNeedsAction.has(control.id) ? "NEEDS_ACTION" : "IN_PROGRESS",
        dueDate: "",
        completedAt: control.status === "COMPLETED" ? control.updatedAt.toISOString() : null,
        isMine: control.createdBy === ctx.user.id || control.performer === ctx.user.name || control.performer === ctx.user.email,
        projectId: control.projectId,
      })),
    ];
    const reported = new Map(projectMinutes.map((row) => [row.projectId, Math.round(Number(row.seconds ?? 0) / 60)]));
    const projectRows: OverviewKpiProject[] = projects.map((project) => {
      const own = tasks.filter((task) => task.projectId === project.id);
      return {
        status: summarizeProjectStatus({ archivedAt: project.archivedAt, closedAt: project.closedAt, startDate: project.startDate, dueDate: project.dueDate, tasks: [...project.workflowTasks, ...project.controls], activities: project.plannedActivities }),
        timeBudgetMinutes: project.timeBudgetMinutes,
        reportedMinutes: reported.get(project.id) ?? 0,
        isMine: project.responsibleUserId === ctx.user.id || own.some((task) => task.isMine),
      };
    });
    const now = Date.now();
    const input = {
      currentUserId: ctx.user.id,
      members: members.map((member) => ({ id: member.userId, weeklyWorkMinutes: member.weeklyWorkMinutes ?? ctx.organization.weeklyWorkMinutes })),
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
      })),
    };
    return NextResponse.json({
      canViewTeam: ctx.admin,
      team: ctx.admin ? summarizeOverviewKpis({ ...input, scope: "team" }) : null,
      mine: summarizeOverviewKpis({ ...input, scope: "mine" }),
    });
  } catch (error) {
    return failure(error);
  }
}
