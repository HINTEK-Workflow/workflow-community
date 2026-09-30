import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, context, failure, requireAdmin, requireCloudStorage } from "@/lib/kfid/server";
import { normalizeControl, validateForCompletion } from "@/lib/kfid/model";
import { controlProgress, projectCompletion } from "@/lib/workflow/project-progress";
import { summarizeProjectStatus } from "@/lib/workflow/project-status";
import { PROJECT_STATISTICS_LIST_FILTERS, summarizeProjectStatistics } from "@/lib/workflow/project-statistics";
import { taskStatisticsBucket } from "@/lib/workflow/task-statistics";
import { swedishDayKey } from "@/lib/swedish-time";

export const dynamic = "force-dynamic";

/**
 * Read-only project statistics for company admins, beside the task statistics on Översikt: started and closed per
 * period, closed on time, the current status spread, per responsible and a paged list. Project status counts all
 * of a project's work (the shared rule); only the ten listed projects get their progression computed.
 */
export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    requireAdmin(ctx);
    const params = new URL(request.url).searchParams;
    const today = swedishDayKey(new Date());
    const defaultStart = `${Number(today.slice(0, 4)) - 1}-${today.slice(5, 7)}-01`;
    const from = z.iso.date().parse(params.get("from") || defaultStart);
    const to = z.iso.date().parse(params.get("to") || today);
    const days = (Date.parse(to) - Date.parse(from)) / 86400000;
    if (days < 0 || days > 1826) throw new ApiError(400, "Välj ett datumintervall på högst fem år, med start före slut.");
    const bucket = taskStatisticsBucket(from, to, z.enum(["auto", "day", "week", "month"]).parse(params.get("bucket") || "auto"));
    const filter = z.enum(PROJECT_STATISTICS_LIST_FILTERS).parse(params.get("filter") || "period");
    const page = z.coerce.number().int().min(1).max(10000).parse(params.get("page") || 1);
    const organizationId = ctx.organizationId;

    const projects = await prisma.project.findMany({
      where: { organizationId },
      select: {
        id: true, name: true, responsibleName: true, startDate: true, dueDate: true, createdAt: true, archivedAt: true, closedAt: true,
        workflowTasks: { select: { status: true, progress: true } },
        controls: { where: { deletedAt: null }, select: { status: true } },
        plannedActivities: { where: { deletedAt: null }, select: { status: true, endsAt: true } },
      },
    });
    const summary = summarizeProjectStatistics({
      from, to, bucket, filter, page,
      projects: projects.map((project) => {
        const tasks = [...project.workflowTasks, ...project.controls];
        return {
          id: project.id, name: project.name, responsibleName: project.responsibleName, startDate: project.startDate, dueDate: project.dueDate,
          createdDay: swedishDayKey(project.createdAt), closedDay: project.closedAt ? swedishDayKey(project.closedAt) : null,
          archivedDay: project.archivedAt ? swedishDayKey(project.archivedAt) : null,
          status: summarizeProjectStatus({ archivedAt: project.archivedAt, closedAt: project.closedAt, startDate: project.startDate, dueDate: project.dueDate, tasks, activities: project.plannedActivities }),
          tasksTotal: tasks.length, tasksDone: tasks.filter((task) => task.status === "COMPLETED").length,
        };
      }),
    });

    // Progression for the listed projects only: open controls need their content, the rest is already known.
    const listedIds = summary.list.items.map((item) => item.id);
    const openControls = listedIds.length ? await prisma.control.findMany({
      where: { organizationId, projectId: { in: listedIds }, deletedAt: null, status: { not: "COMPLETED" } },
      select: { projectId: true, status: true, data: true, _count: { select: { attachments: true } } },
    }) : [];
    const byId = new Map(projects.map((project) => [project.id, project]));
    const items = summary.list.items.map((item) => {
      const project = byId.get(item.id)!;
      const controls = [
        ...project.controls.filter((control) => control.status === "COMPLETED").map(() => ({ status: "COMPLETED", progress: 100 })),
        ...openControls.filter((control) => control.projectId === item.id).map((control) => ({
          status: control.status,
          progress: controlProgress(control.status, validateForCompletion(normalizeControl(control.data), { attachmentCount: control._count.attachments }).progress.percent),
        })),
      ];
      return { ...item, progress: projectCompletion([...project.workflowTasks, ...controls]) };
    });

    return NextResponse.json({ from, to, bucket, filter, ...summary, list: { ...summary.list, items } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}
