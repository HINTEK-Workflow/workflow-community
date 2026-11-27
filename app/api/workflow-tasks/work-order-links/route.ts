import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, context, failure, requireCloudStorage } from "@/lib/kfid/server";
import { hasWorkflowPermission, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { readableTaskWhere } from "@/lib/workflow/task-access";
import { workflowTaskProgress, workflowTaskDataSchema } from "@/lib/workflow/task-model";
import { linkedTaskFormName, WORK_ORDER_LINK_LIST_LIMIT, WORK_ORDER_OPTION_LIMIT } from "@/lib/workflow/work-order-link";
import { CLOSED_TASK_STATUSES } from "@/lib/workflow/task-cancel";
import { ownWorkOrderWhere } from "@/lib/kfid/work-order-link-server";
import { FORM_PERMISSION_AREAS } from "@/lib/workflow/permissions";
import { roundOfProtocolValues } from "@/lib/workflow/round-work-orders";
import { customerTitle } from "@/lib/kfid/customer-name";

export const dynamic = "force-dynamic";

const identifier = z.string().min(1).max(100);
const query = z.object({
  linked: identifier.optional(),
  q: z.string().trim().max(100).default(""),
  projectId: identifier.optional(),
  customerId: identifier.optional(),
  // An existing task without a project can only take an order without one (its project changes through the project).
  standalone: z.enum(["1"]).optional(),
  // The order the task already belongs to, shown even when it is completed.
  include: identifier.optional(),
});

/**
 * Arbetsorder (Fas 2 2026-10-08; Arbetsordern styr 2026-10-26/27), read side, bounded:
 * - `?linked=<work order>`: the tasks in the order (Uppgifter), within what the person may read, each with the time
 *   reported from it on the order and – a round occurrence – its day.
 * - otherwise: the open work orders the choice offers, filtered by project and customer, at most 50. Work orders need read
 *   on Arbetsorder; a person who may create tasks without it gets the ones they are responsible for or booked on
 *   (fråga 8a, 2026-10-27), and the save checks the same. Everything is read within the company.
 */
export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const input = query.parse(Object.fromEntries(new URL(request.url).searchParams));
    const can = (subject: WorkflowPermissionSubject) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "read");
    if (input.linked) {
      if (!can("work-order")) throw new ApiError(403, "Du saknar behörighet att läsa arbetsordrar.");
      const order = await prisma.workflowTask.findFirst({ where: { id: input.linked, organizationId: ctx.organizationId, kind: "WORK_ORDER" }, select: { id: true } });
      if (!order) throw new ApiError(404, "Arbetsordern hittades inte.");
      const rows = await prisma.workflowTask.findMany({
        where: { organizationId: ctx.organizationId, workOrderId: order.id, AND: [readableTaskWhere(can)] },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: WORK_ORDER_LINK_LIST_LIMIT + 1,
        select: { id: true, kind: true, title: true, status: true, progress: true, dueDate: true, assignedToName: true, data: true },
      });
      // Rapporterad från (2026-10-27): the time on the order reported from each task (a round occurrence's own time).
      const shown = rows.slice(0, WORK_ORDER_LINK_LIST_LIMIT);
      const sourced = shown.length ? await prisma.workflowTimeEntry.groupBy({ by: ["sourceTaskId"], where: { taskId: order.id, sourceTaskId: { in: shown.map((row) => row.id) }, endedAt: { not: null } }, _sum: { durationSec: true } }) : [];
      return NextResponse.json({
        tasks: shown.map(({ data, ...row }) => {
          const parsed = workflowTaskDataSchema.safeParse(data);
          const round = roundOfProtocolValues(data);
          return { ...row, progress: parsed.success ? workflowTaskProgress({ ...row, data: parsed.data } as Parameters<typeof workflowTaskProgress>[0]) : row.progress,
            durationSec: sourced.find((item) => item.sourceTaskId === row.id)?._sum.durationSec ?? 0, ...(round ? { occurrence: round.occurrence } : {}), ...(linkedTaskFormName(data) ? { formName: linkedTaskFormName(data) } : {}) };
        }),
        hasMore: rows.length > WORK_ORDER_LINK_LIST_LIMIT,
      }, { headers: { "Cache-Control": "private, no-store" } });
    }
    // Fråga 8a: without read on work orders, a person who may create a task chooses among their own work orders.
    const ownOnly = !can("work-order");
    if (ownOnly && !(ctx.admin || (["risk-assessment", ...FORM_PERMISSION_AREAS] as WorkflowPermissionSubject[]).some((subject) => hasWorkflowPermission(ctx.workflowPermissions, subject, "create"))))
      return NextResponse.json({ options: [] });
    const own = ownOnly ? [ownWorkOrderWhere(ctx.user.id)] : [];
    // The shared Grunduppgifter come along (2026-10-30), so the page can show what a draft takes before it is linked.
    const select = { id: true, kind: true, title: true, status: true, createdAt: true, projectId: true, customerId: true, facilityId: true, assignedToUserId: true, assignedToName: true, plannedStartDate: true, dueDate: true, roundScheduleId: true, project: { select: { name: true } }, customer: { select: { name: true, company: true, customerType: true } } } as const;
    const [rows, included] = await Promise.all([
      prisma.workflowTask.findMany({
        where: {
          organizationId: ctx.organizationId, kind: "WORK_ORDER", status: { notIn: [...CLOSED_TASK_STATUSES] },
          ...(input.q ? { title: { contains: input.q, mode: "insensitive" as const } } : {}),
          AND: [
            input.projectId ? { OR: [{ projectId: input.projectId }, { projectId: null }] } : input.standalone ? { projectId: null } : {},
            input.customerId ? { OR: [{ customerId: input.customerId }, { customerId: null }] } : {},
            { OR: [{ projectId: null }, { project: { is: { archivedAt: null, closedAt: null } } }] },
            ...own,
          ],
        },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: WORK_ORDER_OPTION_LIMIT, select,
      }),
      input.include ? prisma.workflowTask.findFirst({ where: { id: input.include, organizationId: ctx.organizationId, kind: "WORK_ORDER", AND: own }, select }) : Promise.resolve(null),
    ]);
    const all = included && !rows.some((row) => row.id === included.id) ? [included, ...rows] : rows;
    return NextResponse.json({
      options: all.map(({ project, customer, createdAt, ...row }) => ({ ...row, createdAt: createdAt.toISOString(), projectName: project?.name ?? "", customerName: customer ? customerTitle(customer) : "" })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}
