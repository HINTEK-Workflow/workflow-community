import { NextResponse } from "next/server";
import { organizationModuleOn } from "@/lib/workflow/modules";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { context, failure, requireCloudStorage } from "@/lib/kfid/server";
import { hasWorkflowPermission, workflowSubjectForTask, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { summarizeProjectStatus } from "@/lib/workflow/project-status";
import { buildOverviewWork, OVERVIEW_WORK_FILTERS, OVERVIEW_WORK_SORTS, selectOverviewWork } from "@/lib/workflow/overview-work";
import { swedishDayKey } from "@/lib/swedish-time";
import { projectPeople } from "@/lib/workflow/project-people";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  filter: z.enum(OVERVIEW_WORK_FILTERS).default("all"),
  sort: z.enum(OVERVIEW_WORK_SORTS).default("updated"),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

/**
 * Översikt's "Projekt och uppgifter" (2026-09-26: fetch only what is shown): the server builds the list with
 * the shared rules in lib/workflow/overview-work.ts and sends one page of ten, the three most urgent items and the
 * counts per filter. Only modules the member may read are included; project status counts all of a project's work.
 */
export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const input = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const can = (subject: WorkflowPermissionSubject) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "read");
    const organizationId = ctx.organizationId;
    const [projects, tasks] = await Promise.all([
      prisma.project.findMany({
        where: { organizationId },
        select: { id: true, name: true, updatedAt: true, startDate: true, dueDate: true, archivedAt: true, closedAt: true, responsibleUserId: true, responsibleName: true,
          plannedActivities: { where: { deletedAt: null }, select: { status: true, endsAt: true, workflowTaskId: true } } },
      }),
      prisma.workflowTask.findMany({ where: { organizationId }, select: { id: true, title: true, kind: true, formArea: true, status: true, progress: true, dueDate: true, updatedAt: true, projectId: true, assignedToUserId: true, assignedToName: true } }),
    ]);
    const projectName = new Map(projects.map((project) => [project.id, project.name]));
    const readableTasks = tasks.filter((task) => can(workflowSubjectForTask(task.kind, task.formArea)));
    const items = buildOverviewWork({
      today: swedishDayKey(new Date()),
      projects: can("projects") && organizationModuleOn(ctx.organization, "projects") ? projects.map((project) => {
        const own = tasks.filter((task) => task.projectId === project.id);
        const readable = readableTasks.filter((task) => task.projectId === project.id);
        const visible = readable.map((task) => ({ status: task.status, progress: task.progress }));
        return {
          id: project.id, name: project.name, updatedAt: project.updatedAt.toISOString(), dueDate: project.dueDate,
          status: summarizeProjectStatus({ archivedAt: project.archivedAt, closedAt: project.closedAt, startDate: project.startDate, dueDate: project.dueDate, tasks: own, activities: project.plannedActivities }),
          tasks: visible,
          // Name badges (2026-10-22): the responsible person and who has the jobs the member may read.
          people: projectPeople(project, readable),
        };
      }) : [],
      tasks: readableTasks.map((task) => ({ id: task.id, title: task.title, kind: task.kind, status: task.status, progress: task.progress, dueDate: task.dueDate, updatedAt: task.updatedAt.toISOString(),
        projectName: task.projectId ? projectName.get(task.projectId) : undefined })),
    });
    return NextResponse.json(selectOverviewWork(items, { filter: input.filter, sort: input.sort, page: input.page }), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}
