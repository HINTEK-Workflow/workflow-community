import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recordFeature } from "@/lib/analytics/record";
import { verifyTaskReferences } from "@/lib/kfid/task-references-server";
import { requireWorkflowPermission, type Context } from "@/lib/kfid/server";
import { canViewTeam, hasWorkflowPermission, normalizeWorkflowPermissionProfile } from "@/lib/workflow/permissions";
import { recordAssignment } from "@/lib/workflow/task-assignment-notice";
import { applyRiskStepOnSave } from "@/lib/workflow/risk-step-server";
import { workflowTaskInputSchema, workflowTaskProgress } from "@/lib/workflow/task-model";
import { startForNewJob } from "@/lib/workflow/job-planning";
import { deviationItem } from "@/lib/maintenance/server";
import { swedishDayKey } from "@/lib/swedish-time";
import { requireSavedTaskLevels } from "./levels-server";
import { SelfInspectionError, type SelfInspectionView } from "./model";
import {
  closePatch, createOrderRefusal, deviationItemFacts, deviationOrderAssignee, linkPatch, mayReadDeviation, withDeviationOrders, workOrderFromDeviation,
  type DeviationActor, type DeviationOrderFacts, type DeviationPatch, type DeviationRow,
} from "./deviation-link";

/**
 * Avvikelse ↔ arbetsorder in Cloud (2026-10-10): the rules of ./deviation-link.ts on the tables. Everything is read
 * and written inside the caller's company (organizationId on every query); the database's composite key and trigger
 * refuse a link to a work order of another company, or to a task that is not a work order, even if this were bypassed.
 */
type Db = Prisma.TransactionClient | typeof prisma;
const iso = (value: Date | null) => value ? value.toISOString() : null;

/** Rights to the work orders behind the log: the reader's own permissions (an admin has all). */
export const workOrderRights = (ctx: Pick<Context, "admin" | "workflowPermissions">) => ({
  read: ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, "work-order", "read"),
  create: ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, "work-order", "create"),
});

function entryData(patch: DeviationPatch): Prisma.SelfInspectionDeviationUncheckedUpdateManyInput {
  return {
    ...(patch.status ? { status: patch.status } : {}), ...(patch.action !== undefined ? { action: patch.action } : {}),
    ...(patch.closedAt !== undefined ? { closedAt: patch.closedAt ? new Date(patch.closedAt) : null } : {}),
    ...(patch.closedById !== undefined ? { closedById: patch.closedById } : {}), ...(patch.closedByName !== undefined ? { closedByName: patch.closedByName } : {}),
    ...(patch.workOrderId ? { workOrderId: patch.workOrderId } : {}),
  };
}

/** Who finished a work order, by the name the person has: the one who saved it last (a finished order is locked). */
async function finishedBy(db: Db, organizationId: string, userId: string | null): Promise<DeviationActor | null> {
  if (!userId) return null;
  const member = await db.organizationMember.findFirst({ where: { organizationId, userId }, select: { user: { select: { id: true, name: true, email: true } } } });
  return member ? { id: member.user.id, name: member.user.name?.trim() || member.user.email } : null;
}

/** Rule 2: the entry's responsible person as the order's Ansvarig, when the person may work with work orders (deviationOrderAssignee). */
async function orderAssignee(organizationId: string, userId: string): Promise<{ id: string; name: string } | null> {
  const member = await prisma.organizationMember.findFirst({ where: { organizationId, userId }, select: { isActive: true, role: true, workflowPermissions: true, user: { select: { id: true, name: true, email: true } } } });
  if (!member) return null;
  const permissions = normalizeWorkflowPermissionProfile(member.workflowPermissions);
  return deviationOrderAssignee({ id: member.user.id, name: member.user.name?.trim() || member.user.email, active: member.isActive, admin: member.role === "OWNER" || member.role === "ADMIN",
    readOrders: hasWorkflowPermission(permissions, "work-order", "read"), editOrders: hasWorkflowPermission(permissions, "work-order", "edit") });
}

/** The work order made from a protocol row (the latest, if several), as the rules read it. */
export async function cloudOrderForRow(db: Db, organizationId: string, row: DeviationRow): Promise<DeviationOrderFacts | null> {
  const order = await db.workflowTask.findFirst({
    where: { organizationId, kind: "WORK_ORDER", AND: [{ data: { path: ["details", "source", "taskId"], equals: row.taskId } }, { data: { path: ["details", "source", "rowId"], equals: row.rowId } }] },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }], select: { id: true, title: true, status: true, completedAt: true, updatedBy: true },
  });
  if (!order) return null;
  return { id: order.id, title: order.title, status: order.status, completedAt: iso(order.completedAt), completedBy: order.status === "COMPLETED" ? await finishedBy(db, organizationId, order.updatedBy) : null };
}

/**
 * In the work order's own transaction (app/api/workflow-tasks): a new order made from a protocol row takes the row's entries
 * (rule 1), and an order that has just been finished closes its entries (rule 3) – whether or not the person may otherwise
 * keep the log: it follows from the order. Returns how many entries changed.
 */
export async function linkDeviationsOnOrderSave(tx: Prisma.TransactionClient, input: {
  organizationId: string; order: { id: string; kind: string; title: string; status: string; data: unknown }; created: boolean; by: DeviationActor; now: Date;
}): Promise<number> {
  const { organizationId, order } = input;
  if (order.kind !== "WORK_ORDER") return 0;
  let changed = 0;
  const source = (order.data as { details?: { source?: { taskId?: string; rowId?: string } } } | null)?.details?.source;
  if (input.created && source?.taskId && source.rowId) {
    const entries = await tx.selfInspectionDeviation.findMany({ where: { organizationId, sourceTaskId: source.taskId, sourceRowId: source.rowId, workOrderId: null }, select: { id: true, status: true, action: true, closedAt: true } });
    for (const entry of entries) {
      const patch = linkPatch({ ...entry, status: entry.status as "OPEN", closedAt: iso(entry.closedAt) }, order.id);
      if (patch) changed += (await tx.selfInspectionDeviation.updateMany({ where: { id: entry.id, organizationId, workOrderId: null }, data: entryData(patch) })).count;
    }
  }
  if (order.status === "COMPLETED") {
    // A near miss or an accident without its investigation stays open (closePatch, 2026-10-30), so its fields are read too.
    const entries = await tx.selfInspectionDeviation.findMany({ where: { organizationId, workOrderId: order.id, status: { not: "DONE" } }, select: { id: true, status: true, action: true, closedAt: true, type: true, occurredAt: true, whatHappened: true, cause: true } });
    for (const entry of entries) {
      const patch = closePatch({ ...entry, status: entry.status as "OPEN", closedAt: iso(entry.closedAt), occurredAt: iso(entry.occurredAt) }, order, input.by, input.now.toISOString());
      if (patch) changed += (await tx.selfInspectionDeviation.updateMany({ where: { id: entry.id, organizationId, status: { not: "DONE" } }, data: entryData(patch) })).count;
    }
  }
  return changed;
}

/**
 * Rule 2 – "Skapa arbetsorder" on a log entry: the right to create work orders and to read the entry; checked like any new
 * work order (references, levels, risk step), created and linked in one transaction. The entry becomes Pågår.
 */
export async function createWorkOrderFromDeviation(ctx: Context, deviationId: string, now = new Date()): Promise<{ id: string }> {
  requireWorkflowPermission(ctx, "work-order", "create");
  const organizationId = ctx.organizationId;
  const entry = await prisma.selfInspectionDeviation.findFirst({ where: { id: deviationId, organizationId } });
  if (!entry || !mayReadDeviation({ id: ctx.user.id, admin: ctx.admin, team: canViewTeam(ctx) }, { type: entry.type, reportedById: entry.reportedById, responsibleId: entry.responsibleUserId }))
    throw new SelfInspectionError(404, "Avvikelsen hittades inte.");
  const refusal = createOrderRefusal({ status: entry.status as "OPEN", workOrderId: entry.workOrderId }, true);
  if (refusal) throw new SelfInspectionError(409, refusal);
  // The protocol the entry was taken from, when it still exists: its customer, open project and place.
  const protocol = entry.sourceTaskId ? await prisma.workflowTask.findFirst({ where: { id: entry.sourceTaskId, organizationId },
    select: { kind: true, projectId: true, customerId: true, facilityId: true, project: { select: { customerId: true, archivedAt: true, closedAt: true } } } }) : null;
  const projectOpen = Boolean(protocol?.projectId && protocol.project && !protocol.project.archivedAt && !protocol.project.closedAt);
  const customerId = protocol?.customerId ?? protocol?.project?.customerId ?? null;
  const assignee = entry.responsibleUserId ? await orderAssignee(organizationId, entry.responsibleUserId) : null;
  const source = { number: entry.number, kind: entry.kind === "IMPROVEMENT" ? "IMPROVEMENT" as const : "DEVIATION" as const, title: entry.title, description: entry.description,
    category: entry.category === "IMMEDIATE" ? "IMMEDIATE" as const : "ROUTINE" as const, source: entry.sourceTaskId ? { taskId: entry.sourceTaskId, title: entry.sourceTitle, rowId: entry.sourceRowId } : null, type: entry.type, action: entry.action };
  const draft = workOrderFromDeviation(source,
  protocol ? { kind: protocol.kind as "FORM", projectId: projectOpen ? protocol.projectId : null, customerId, facilityId: customerId ? protocol.facilityId : null } : null, assignee);
  let task = workflowTaskInputSchema.parse(draft);
  // The same checks as a new work order saved from its page (app/api/workflow-tasks).
  await verifyTaskReferences(organizationId, task, { canReadWorkOrders: workOrderRights(ctx).read });
  try {
    await requireSavedTaskLevels(organizationId, ctx.user, { task, formTemplateId: null, documented: false });
  } catch (issue) {
    // The responsible person's level is too low for the order: it is made without Ansvarig rather than not at all.
    if (!task.assignedToUserId) throw issue;
    task = { ...task, assignedToUserId: null, assignedToName: "" };
    await requireSavedTaskLevels(organizationId, ctx.user, { task, formTemplateId: null, documented: false });
  }
  await applyRiskStepOnSave(organizationId, ctx.user, task, { formArea: null, formTemplateId: null });
  const frameRow = task.projectId ? await prisma.project.findFirst({ where: { id: task.projectId, organizationId }, select: { startDate: true, dueDate: true } }) : null;
  const projectFrame = frameRow ? { startDate: frameRow.startDate ?? "", dueDate: frameRow.dueDate ?? "" } : null;
  const progress = workflowTaskProgress(task);
  const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.workflowTask.create({
      data: { organizationId, projectId: task.projectId, customerId: task.customerId, facilityId: task.facilityId, kind: "WORK_ORDER", title: task.title, description: task.description,
        assignedToUserId: task.assignedToUserId, assignedToName: task.assignedToName, status: task.status, progress, dueDate: task.dueDate, plannedStartDate: startForNewJob({ today: swedishDayKey(now), dueDate: task.dueDate, frame: projectFrame }), data: json(task.data), createdBy: ctx.user.id, updatedBy: ctx.user.id, revisions: { create: { version: 1, snapshot: json(task), createdBy: ctx.user.id } } },
      select: { id: true },
    });
    // "Tilldelad dig": the responsible person who got the order is told, as for any new work order.
    await recordAssignment(tx, { organizationId, taskId: row.id, previousUserId: null, nextUserId: task.assignedToUserId, actorId: ctx.user.id });
    // The entry itself (once: a second press finds it linked), then any other entry of the same row without an order.
    const own = linkPatch({ status: entry.status as "OPEN", action: entry.action, closedAt: iso(entry.closedAt), workOrderId: null }, row.id);
    const linked = await tx.selfInspectionDeviation.updateMany({ where: { id: entry.id, organizationId, workOrderId: null, status: { not: "DONE" } }, data: entryData(own!) });
    if (!linked.count) throw new SelfInspectionError(409, "Avvikelsen har ändrats. Läs in loggen igen.");
    if (entry.sourceTaskId && entry.sourceRowId) await linkDeviationsOnOrderSave(tx, { organizationId, order: { id: row.id, kind: "WORK_ORDER", title: task.title, status: task.status, data: task.data }, created: true, by: { id: ctx.user.id, name: ctx.user.name?.trim() || ctx.user.email }, now });
    // Underhåll (2026-10-30): a maintenance item when the protocol is on a machine part, otherwise only the order.
    await deviationItem(tx, { organizationId, userId: ctx.user.id, workOrderId: row.id, sourceTaskId: entry.sourceTaskId, facts: deviationItemFacts(source, now) });
    if (task.projectId) await tx.projectEvent.create({ data: { organizationId, projectId: task.projectId, kind: "UPDATED", summary: `Arbetsordern ${task.title} skapades från avvikelse ${entry.number} i avvikelseloggen`.slice(0, 500), taskId: row.id, actorName: ctx.user.name || ctx.user.email, createdBy: ctx.user.id } });
    return row;
  });
  recordFeature("task_created_WORK_ORDER");
  return created;
}

/** The log's view with each entry's work order (title and status for those who may read work orders). */
export async function withCloudDeviationOrders(ctx: Context, view: SelfInspectionView): Promise<SelfInspectionView> {
  const ids = [...new Set(view.deviations.flatMap((item) => item.workOrderId ? [item.workOrderId] : []))];
  const orders = ids.length ? await prisma.workflowTask.findMany({ where: { organizationId: ctx.organizationId, kind: "WORK_ORDER", id: { in: ids } }, select: { id: true, title: true, status: true } }) : [];
  return withDeviationOrders(view, new Map(orders.map((order) => [order.id, { title: order.title, status: order.status }])), workOrderRights(ctx));
}
