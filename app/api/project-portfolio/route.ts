import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { context, failure, requireCloudStorage, requireWorkflowPermission } from "@/lib/kfid/server";
import { quotedMinutesByProject } from "@/lib/quotes/portfolio-server";
import { hasWorkflowPermission, workflowSubjectForTask, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { canReadPlannedActivity } from "@/lib/workflow/planned-activity-access";
import { jobObstacle, OBSTACLE_TASK_SELECT } from "@/lib/workflow/planning-adapters";
import { summarizeProjectStatus } from "@/lib/workflow/project-status";
import { summarizePortfolio, type PortfolioBooking, type PortfolioJob } from "@/lib/workflow/project-portfolio";
import { customerDisplayName } from "@/lib/workflow/project-customer";

export const dynamic = "force-dynamic";

const PROJECT_LIMIT = 400;
const BOOKING_LIMIT = 4000;

/**
 * Projektportföljen (plan 1M, 2026-10-11): one row per project – customer, responsible, status, whether the time
 * frame is followed, completion, Budget · Offererat · Uppskattat · Bokat · Rapporterat, obstacles, the next milestone and
 * the end date – and the list of obstacles and delays across projects, for Projektstatistik and Planering. Read only,
 * bounded to the company and to the projects, jobs and bookings the person may read (Projekt – läsa; a job only with the
 * right for its type). The figures are the project page's own (lib/workflow/project-portfolio.ts); no purchase price or
 * markup is read here. `?state=ongoing|closed|all` (default ongoing); archived projects are never listed.
 */
export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    requireWorkflowPermission(ctx, "projects", "read");
    const state = z.enum(["ongoing", "closed", "all"]).catch("ongoing").parse(new URL(request.url).searchParams.get("state") ?? "ongoing");
    const can = (subject: WorkflowPermissionSubject, action: "read") => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, action);
    const projects = await prisma.project.findMany({
      where: { organizationId: ctx.organizationId, archivedAt: null, ...(state === "ongoing" ? { closedAt: null } : state === "closed" ? { closedAt: { not: null } } : {}) },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: PROJECT_LIMIT,
      select: {
        id: true, name: true, startDate: true, dueDate: true, responsibleName: true, timeBudgetMinutes: true, archivedAt: true, closedAt: true,
        customer: { select: { name: true, company: true, customerType: true } },
        // Status counts every job and all planning, whatever the viewer may read, so a project has one status for everyone.
        plannedActivities: { where: { deletedAt: null }, select: { status: true, endsAt: true, workflowTaskId: true } },
        workflowTasks: { select: { id: true, status: true, kind: true, formArea: true, title: true, progress: true, dueDate: true, plannedStartDate: true, createdAt: true, estimatedMinutes: true, ...OBSTACLE_TASK_SELECT } },
      },
    });
    const ids = projects.map((project) => project.id);
    const [finished, running, projectTime, bookings, quoted] = await Promise.all([
      ids.length ? prisma.workflowTimeEntry.groupBy({ by: ["taskId"], where: { endedAt: { not: null }, task: { organizationId: ctx.organizationId, projectId: { in: ids } } }, _sum: { durationSec: true } }) : [],
      ids.length ? prisma.workflowTimeEntry.findMany({ where: { endedAt: null, task: { organizationId: ctx.organizationId, projectId: { in: ids } } }, select: { taskId: true, startedAt: true } }) : [],
      // Projekttid (2026-10-26): the projects' own time, finished and running.
      ids.length ? prisma.workflowTimeEntry.findMany({ where: { project: { is: { organizationId: ctx.organizationId, id: { in: ids } } } }, select: { projectId: true, startedAt: true, endedAt: true, durationSec: true } }) : [],
      ids.length ? prisma.plannedActivity.findMany({
        where: { organizationId: ctx.organizationId, deletedAt: null, status: { not: "CANCELED" }, OR: [{ projectId: { in: ids } }, { workflowTask: { is: { projectId: { in: ids } } } }] },
        orderBy: { startsAt: "asc" }, take: BOOKING_LIMIT,
        select: {
          id: true, title: true, kind: true, status: true, startsAt: true, endsAt: true, projectId: true, workflowTaskId: true, assignedToUserId: true,
          workflowTask: { select: { kind: true, formArea: true, projectId: true, status: true } },
          assignments: { select: { plannedMinutes: true, startsAt: true, endsAt: true, member: { select: { userId: true } } } },
        },
      }) : [],
      quotedMinutesByProject({ organizationId: ctx.organizationId, userId: ctx.user.id, admin: ctx.admin, permissions: ctx.workflowPermissions, storageMode: ctx.organization.storageMode }, ids),
    ]);
    const seconds = new Map(finished.map((row) => [row.taskId, row._sum.durationSec ?? 0] as const));
    const now = new Date();
    for (const entry of running) seconds.set(entry.taskId, (seconds.get(entry.taskId) ?? 0) + Math.max(0, Math.floor((now.getTime() - entry.startedAt.getTime()) / 1000)));
    const projectSeconds = new Map<string, number>();
    for (const entry of projectTime) if (entry.projectId) projectSeconds.set(entry.projectId, (projectSeconds.get(entry.projectId) ?? 0) + (entry.endedAt ? entry.durationSec : Math.max(0, Math.floor((now.getTime() - entry.startedAt.getTime()) / 1000))));
    const readableJob = (task: { kind: string; formArea: string | null }) => can(workflowSubjectForTask(task.kind, task.formArea), "read");
    const canSee = (activity: (typeof bookings)[number]) => canReadPlannedActivity(ctx.workflowPermissions, ctx.admin, activity);
    const portfolio = summarizePortfolio({
      now,
      projects: projects.map((project) => {
        const jobs: PortfolioJob[] = project.workflowTasks.filter(readableJob).map((task) => ({
          id: task.id, title: task.title, kind: task.kind, status: task.status, progress: task.progress, dueDate: task.dueDate, plannedStartDate: task.plannedStartDate,
          createdAt: task.createdAt, estimatedMinutes: task.estimatedMinutes, totalDurationSec: seconds.get(task.id) ?? 0, obstacle: jobObstacle(task),
        }));
        const jobIds = new Set(project.workflowTasks.map((task) => task.id));
        const own: PortfolioBooking[] = bookings.filter((activity) => (activity.projectId === project.id || (activity.workflowTaskId && jobIds.has(activity.workflowTaskId))) && canSee(activity)).map((activity) => ({
          id: activity.id, title: activity.title, kind: activity.kind, status: activity.status as PortfolioBooking["status"], startsAt: activity.startsAt.toISOString(), endsAt: activity.endsAt.toISOString(),
          projectId: project.id, workflowTaskId: activity.workflowTaskId, assignedToUserId: activity.assignedToUserId, workflowTask: activity.workflowTask,
          assignments: activity.assignments.map((item) => ({ userId: item.member.userId, plannedMinutes: item.plannedMinutes, startsAt: item.startsAt?.toISOString() ?? null, endsAt: item.endsAt?.toISOString() ?? null })),
        }));
        return {
          id: project.id, name: project.name, customerName: customerDisplayName(project.customer), responsibleName: project.responsibleName,
          startDate: project.startDate ?? "", dueDate: project.dueDate ?? "", timeBudgetMinutes: project.timeBudgetMinutes, quotedMinutes: quoted.get(project.id) ?? null,
          status: summarizeProjectStatus({ archivedAt: project.archivedAt, closedAt: project.closedAt, startDate: project.startDate, dueDate: project.dueDate, tasks: project.workflowTasks, activities: project.plannedActivities, now }),
          jobs, bookings: own, projectTimeSec: projectSeconds.get(project.id) ?? 0,
        };
      }),
    });
    return NextResponse.json(portfolio, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}
