import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { hasWorkflowPermission, type WorkflowPermissionProfile } from "@/lib/workflow/permissions";
import { isRiskAssessmentTask } from "@/lib/workflow/risk-step";
import { requireSavedTaskLevels } from "@/lib/self-inspection/levels-server";
import { duplicateRiskAssessmentError, WORK_ORDER_REQUIRED, inheritFromWorkOrder, tasksFollowingWorkOrder, workOrderLinkError, type WorkOrderLinkTarget, type WorkOrderLinkTask } from "@/lib/workflow/work-order-link";

/**
 * Fråga 8 (2026-10-27, svar a): the work orders a person who may create tasks may put a task in without the right
 * to read work orders – the ones they are responsible for (Ansvarig) or booked on in the planning (tilldelad). Within the
 * company; used by the choice of work orders and by the link check below.
 */
export const ownWorkOrderWhere = (userId: string): Prisma.WorkflowTaskWhereInput => ({ OR: [{ assignedToUserId: userId }, { plannedActivities: { some: { assignedToUserId: userId } } }] });

/**
 * Arbetsordern styr (2026-10-26, changed 2026-10-27), Cloud. Called from verifyTaskReferences before the project
 * and customer checks: a task (anything but a work order) names a work order of the company – or none while it is a draft
 * (the route checks its status once it is known); it always takes the order's project and customer, and its place among
 * that customer's places. A linked task may move to another work order but is never let go. A work order holds one risk
 * assessment (punkt 2). The work order is read within the company only; the database's composite key, trigger and CHECK
 * refuse a started task without a work order, a link into another company or to something that is not a work order even
 * if this were bypassed.
 *
 * Mutates `input` (projectId, customerId, facilityId) the way the route then stores it.
 */
export async function linkWorkOrder(organizationId: string, input: WorkOrderLinkTask & { id?: string | null; data?: unknown }, { canReadWorkOrders = true, userId = null, formArea = null }: { canReadWorkOrders?: boolean; userId?: string | null; formArea?: string | null } = {}) {
  if (input.kind === "WORK_ORDER") return;
  const [workOrder, previous] = await Promise.all([
    input.workOrderId ? prisma.workflowTask.findFirst({ where: { id: input.workOrderId, organizationId }, select: SHARED_ORDER_SELECT }) : Promise.resolve(null),
    input.id ? prisma.workflowTask.findFirst({ where: { id: input.id, organizationId }, select: { workOrderId: true } }) : Promise.resolve(null),
  ]);
  const changed = (previous?.workOrderId ?? null) !== (input.workOrderId ?? null);
  // A new or changed link names a work order, so the person must be able to read work orders – or it is one of their own
  // (fråga 8a); a kept one is not asked again.
  // A work order not found in the company is left to the "hittades inte" below, so another company's is never told apart.
  if (changed && input.workOrderId && workOrder && !canReadWorkOrders) {
    const own = userId ? await prisma.workflowTask.findFirst({ where: { id: workOrder.id, organizationId, ...ownWorkOrderWhere(userId) }, select: { id: true } }) : null;
    if (!own) throw new ApiError(403, "Du kan bara lägga uppgiften i en arbetsorder som du är ansvarig för eller tilldelad.");
  }
  const inherited = inheritFromWorkOrder(input, workOrder, { isNew: !input.id });
  input.projectId = inherited.projectId;
  input.customerId = inherited.customerId;
  input.facilityId = inherited.facilityId ?? null;
  // Grunduppgifter är gemensamma (2026-10-30): the responsible person and the dates are the work order's too.
  if (input.workOrderId && workOrder) Object.assign(input, { assignedToUserId: inherited.assignedToUserId ?? null, assignedToName: inherited.assignedToName ?? "", ...(inherited.plannedStartDate !== undefined ? { plannedStartDate: inherited.plannedStartDate ?? "" } : {}), ...(inherited.dueDate !== undefined ? { dueDate: inherited.dueDate } : {}) });
  const error = workOrderLinkError(input, workOrder, { changed, previousWorkOrderId: previous?.workOrderId ?? null });
  if (error) throw new ApiError(workOrder?.status === "COMPLETED" || workOrder?.status === "CANCELLED" || previous?.workOrderId ? 409 : 400, error);
  // En riskbedömning per arbete (punkt 2): a risk assessment going into a work order that already has one is refused.
  if (changed && workOrder && isRiskAssessmentTask({ kind: input.kind, formArea, data: input.data })) {
    const inside = await prisma.workflowTask.findMany({ where: { organizationId, workOrderId: workOrder.id, kind: { in: ["RISK_ASSESSMENT", "FORM"] }, ...(input.id ? { id: { not: input.id } } : {}) }, select: { kind: true, formArea: true, data: true, title: true, status: true }, take: 200 });
    const duplicate = duplicateRiskAssessmentError(inside.filter((item) => isRiskAssessmentTask(item)));
    if (duplicate) throw new ApiError(409, duplicate);
  }
}

/** What a work order's tasks take from it (2026-10-30: Grunduppgifter are the same data). */
const SHARED_ORDER_SELECT = { id: true, kind: true, title: true, status: true, projectId: true, customerId: true, facilityId: true, assignedToUserId: true, assignedToName: true, plannedStartDate: true, dueDate: true, roundScheduleId: true } as const;

/**
 * After a work order's Grunduppgifter changed (customer, place, project, responsible person, dates), its tasks follow – they
 * are the same data (2026-10-30). Inside the save's transaction; a finished task is never rewritten. Returns the
 * tasks changed with their new versions, so the caller can tell open pages.
 */
export async function followWorkOrder(tx: Prisma.TransactionClient, organizationId: string, order: WorkOrderLinkTarget, actorId: string): Promise<{ id: string; version: number }[]> {
  const inside = await tx.workflowTask.findMany({ where: { organizationId, workOrderId: order.id, status: { notIn: ["COMPLETED", "CANCELLED"] } }, select: { id: true, kind: true, projectId: true, customerId: true, facilityId: true, workOrderId: true, assignedToUserId: true, assignedToName: true, plannedStartDate: true, dueDate: true } });
  const changed: { id: string; version: number }[] = [];
  for (const next of tasksFollowingWorkOrder(order, inside)) {
    const row = await tx.workflowTask.update({ where: { id: next.id }, data: { projectId: next.projectId, customerId: next.customerId, facilityId: next.facilityId ?? null, assignedToUserId: next.assignedToUserId ?? null, assignedToName: next.assignedToName ?? "", plannedStartDate: next.plannedStartDate ?? "", dueDate: next.dueDate ?? "", version: { increment: 1 }, updatedBy: actorId }, select: { id: true, version: true } });
    changed.push(row);
  }
  return changed;
}

/**
 * Krävd nivå (2026-10-07) with shared Grunduppgifter: a new responsible person of a work order becomes the responsible person
 * of its open tasks, so each of them must take that task's class like a responsible person chosen on the task itself. Read
 * before the save; throws the task's refusal.
 */
export async function requireFollowingLevels(organizationId: string, actor: { id: string }, order: { id: string; assignedToUserId: string | null; assignedToName: string }) {
  if (!order.assignedToUserId) return;
  const inside = await prisma.workflowTask.findMany({ where: { organizationId, workOrderId: order.id, status: { notIn: ["COMPLETED", "CANCELLED"] }, NOT: { assignedToUserId: order.assignedToUserId } }, select: { id: true, kind: true, status: true, formTemplateId: true, data: true }, take: 200 });
  for (const task of inside)
    await requireSavedTaskLevels(organizationId, actor, { task: { id: task.id, kind: task.kind, status: task.status, assignedToUserId: order.assignedToUserId, assignedToName: order.assignedToName, data: task.data }, formTemplateId: task.formTemplateId, documented: false });
}

type TimeActor = { admin: boolean; workflowPermissions: WorkflowPermissionProfile };

/**
 * Tid på arbetsordern: the work order a timer or a time entry of a task is recorded on – the task itself when it is the
 * work order. The person needs edit on the task they work in (checked by the caller) and read on work orders, whose title
 * the page and Tidrapport show. Returns the owner's id; the caller reads it within the company.
 */
export function timeOwnerFor(ctx: TimeActor, task: { id: string; kind: string; workOrderId?: string | null }) {
  if (task.kind === "WORK_ORDER") return task.id;
  if (!task.workOrderId) throw new ApiError(409, WORK_ORDER_REQUIRED);
  if (!(ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, "work-order", "read")))
    throw new ApiError(403, "Tiden räknas på arbetsordern som uppgiften hör till, och du saknar behörighet att läsa arbetsordrar.");
  return task.workOrderId;
}

/**
 * The timer's two tasks: the one the person works in (`clicked`) and the work order the time is recorded on (`owner`).
 * Both are read within the caller's company only.
 */
export async function loadTimeOwner(ctx: TimeActor & { organizationId: string }, taskId: string) {
  const clicked = await prisma.workflowTask.findFirst({ where: { id: taskId, organizationId: ctx.organizationId } });
  if (!clicked) throw new ApiError(404, "Uppgiften hittades inte.");
  const ownerId = timeOwnerFor(ctx, clicked);
  const owner = ownerId === clicked.id ? clicked : await prisma.workflowTask.findFirst({ where: { id: ownerId, organizationId: ctx.organizationId, kind: "WORK_ORDER" } });
  if (!owner) throw new ApiError(404, "Arbetsordern hittades inte.");
  return { clicked, owner };
}
