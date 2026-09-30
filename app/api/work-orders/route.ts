import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { context, failure, requireCloudStorage, requireWorkflowPermission } from "@/lib/kfid/server";
import { WORK_ITEM_FILTERS, type WorkItemFilter } from "@/lib/workflow/work-items";
import { WORK_ORDER_PAGE_SIZE, WORK_ORDER_SCOPES } from "@/lib/workflow/work-orders";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  scope: z.enum(WORK_ORDER_SCOPES).default("mine"),
  filter: z.enum(WORK_ITEM_FILTERS).default("open"),
  q: z.string().trim().max(100).default(""),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

const statusWhere: Record<WorkItemFilter, Prisma.WorkflowTaskWhereInput> = {
  open: { status: { not: "COMPLETED" } },
  active: { OR: [{ status: { in: ["IN_PROGRESS", "PAUSED"] } }, { status: "PLANNED", progress: { gt: 0 } }] },
  planned: { status: "PLANNED", progress: 0 },
  action: { status: "NEEDS_ACTION" },
  done: { status: "COMPLETED" },
  all: {},
};

/**
 * Mina arbetsordrar (2026-09-26): a bounded, server-paged list of work orders with status, customer,
 * responsible, planned date and project. Tenant, module read permission and Cloud storage are checked on the server.
 */
export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    requireWorkflowPermission(ctx, "work-order", "read");
    const input = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const base: Prisma.WorkflowTaskWhereInput = {
      organizationId: ctx.organizationId, kind: "WORK_ORDER",
      ...(input.scope === "mine" ? { OR: [{ assignedToUserId: ctx.user.id }, { assignedToUserId: null, createdBy: ctx.user.id }] } : {}),
      ...(input.q ? { AND: [{ OR: [
        { title: { contains: input.q, mode: "insensitive" } }, { assignedToName: { contains: input.q, mode: "insensitive" } },
        { customer: { OR: [{ name: { contains: input.q, mode: "insensitive" } }, { company: { contains: input.q, mode: "insensitive" } }] } },
        { project: { name: { contains: input.q, mode: "insensitive" } } },
      ] }] } : {}),
    };
    const where = (filter: WorkItemFilter): Prisma.WorkflowTaskWhereInput => ({ AND: [base, statusWhere[filter]] });
    const [countList, rows] = await Promise.all([
      Promise.all(WORK_ITEM_FILTERS.map((filter) => prisma.workflowTask.count({ where: where(filter) }))),
      prisma.workflowTask.findMany({
        where: where(input.filter), orderBy: [{ updatedAt: "desc" }, { id: "asc" }], skip: (input.page - 1) * WORK_ORDER_PAGE_SIZE, take: WORK_ORDER_PAGE_SIZE,
        select: {
          id: true, title: true, status: true, progress: true, assignedToName: true, dueDate: true, projectId: true, updatedAt: true,
          customer: { select: { name: true, company: true } }, project: { select: { name: true } },
          // Only the next planned occasion is read, not the task's whole planning.
          plannedActivities: { where: { deletedAt: null, endsAt: { gte: new Date() } }, orderBy: { startsAt: "asc" }, take: 1, select: { startsAt: true } },
        },
      }),
    ]);
    const counts = Object.fromEntries(WORK_ITEM_FILTERS.map((filter, index) => [filter, countList[index]]));
    const total = counts[input.filter];
    return NextResponse.json({
      items: rows.map((row) => ({
        id: row.id, title: row.title, status: row.status, progress: row.progress, customerName: row.customer?.company || row.customer?.name || "",
        assignedToName: row.assignedToName, dueDate: row.dueDate, plannedAt: row.plannedActivities[0]?.startsAt.toISOString() ?? null,
        projectId: row.projectId, projectName: row.project?.name ?? "", updatedAt: row.updatedAt.toISOString(),
      })),
      total, page: input.page, pages: Math.max(1, Math.ceil(total / WORK_ORDER_PAGE_SIZE)), counts,
    });
  } catch (error) {
    return failure(error);
  }
}
