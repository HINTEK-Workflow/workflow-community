import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, context, failure, requireCloudStorage } from "@/lib/kfid/server";
import { callerOf, requireMaintenance } from "@/lib/maintenance/server";
import { mayReadDeviation } from "@/lib/self-inspection/incidents";
import { deviationViewerOf } from "@/lib/self-inspection/server";
import { CHANGE_ENTITY_TYPES, type ChangeEntityType } from "@/lib/traceability/record-changes";
import { readChanges } from "@/lib/traceability/record-changes-server";
import { hasWorkflowPermission, workflowSubjectForTask } from "@/lib/workflow/permissions";

export const dynamic = "force-dynamic";

/**
 * Ändringshistorik (K3.2, 2026-11-27): one record's change history, read by whoever may read the record – the same
 * rule as the record's own page: a task by its type's right, a deviation by the deviation log's rule (a near miss or an
 * accident only for the reporter, admins and Teamet), a plan or a machine by Underhåll's right. A record the person may not
 * read answers as one that does not exist. Bound to the session's company; read only (GET, no Origin needed).
 */
const query = z.object({
  type: z.enum(CHANGE_ENTITY_TYPES),
  id: z.string().min(1).max(100),
  after: z.string().min(1).max(100).nullish(),
});

const NOT_FOUND = "Posten hittades inte.";

async function requireReadable(ctx: Awaited<ReturnType<typeof context>>, type: ChangeEntityType, id: string) {
  const organizationId = ctx.organizationId;
  if (type === "TASK") {
    const task = await prisma.workflowTask.findFirst({ where: { id, organizationId }, select: { kind: true, formArea: true } });
    if (!task || !(ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, workflowSubjectForTask(task.kind, task.formArea), "read"))) throw new ApiError(404, NOT_FOUND);
    return;
  }
  if (type === "DEVIATION") {
    const entry = await prisma.selfInspectionDeviation.findFirst({ where: { id, organizationId }, select: { type: true, reportedById: true, responsibleUserId: true } });
    if (!entry || !mayReadDeviation(deviationViewerOf(ctx), { type: entry.type, reportedById: entry.reportedById, responsibleId: entry.responsibleUserId })) throw new ApiError(404, NOT_FOUND);
    return;
  }
  requireMaintenance(callerOf(ctx), "read");
  const found = type === "MACHINE"
    ? await prisma.machinePart.findFirst({ where: { id, organizationId }, select: { id: true } })
    : await prisma.maintenancePlan.findFirst({ where: { id, organizationId }, select: { id: true } });
  if (!found) throw new ApiError(404, NOT_FOUND);
}

export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const url = new URL(request.url);
    const input = query.parse({ type: url.searchParams.get("type"), id: url.searchParams.get("id"), after: url.searchParams.get("after") });
    await requireReadable(ctx, input.type, input.id);
    const page = await readChanges({
      organizationId: ctx.organizationId, entityType: input.type, entityId: input.id, after: input.after ?? null,
      canReadWorkOrders: ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, "work-order", "read"),
    });
    return NextResponse.json(page, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}
