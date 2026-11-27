import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { riskCheckOf } from "./risk-step";
import { CLOSED_TASK_STATUSES } from "./task-cancel";
import { orderRoundSafetyRefusal, roundSafetyRefusal, roundSafetyRequired, roundSafetyState, roundSafetyWorkGate, stampRoundSafety, workOrderRiskUpdatedAt, type RoundSafetyRisk } from "./round-safety";
import { roundOfProtocolValues } from "./round-work-orders";

/**
 * Säkerhetsavstämning (2026-10-27, punkt 4) in Cloud: the work order's risk assessment the check is made against,
 * read within the caller's company, the stamp on save and the gates for Starta tid and Färdigställ. The rule:
 * lib/workflow/round-safety.ts.
 */
type Db = Prisma.TransactionClient | typeof prisma;

async function loadOrder(organizationId: string, workOrderId: string | null | undefined, db: Db) {
  if (!workOrderId) return null;
  return db.workflowTask.findFirst({ where: { id: workOrderId, organizationId, kind: "WORK_ORDER" }, select: { id: true, title: true, data: true, roundScheduleId: true, roundOccurrence: true } });
}

/** The work order's risk assessment as the check needs it: when it was last confirmed or completed. */
export async function loadRoundSafetyRisk(organizationId: string, workOrderId: string | null | undefined, db: Db = prisma): Promise<RoundSafetyRisk | null> {
  const order = await loadOrder(organizationId, workOrderId, db);
  if (!order) return null;
  const extendedId = riskCheckOf(order.data)?.extendedTaskId;
  const extended = extendedId ? await db.workflowTask.findFirst({ where: { id: extendedId, organizationId }, select: { status: true, completedAt: true, updatedAt: true } }) : null;
  return { workOrderId: order.id, title: order.title, updatedAt: workOrderRiskUpdatedAt(order, extended) };
}

/**
 * The save of a protocol: a new one started from the round in the round's work order gets the check; who confirmed, when
 * and against which risk assessment are set here. `task.data` is replaced in place.
 */
export async function applyRoundSafetyOnSave(organizationId: string, actor: { id: string; name?: string | null; email?: string | null }, task: { id?: string; kind: string; workOrderId?: string | null; data: object }, db: Db = prisma) {
  if (task.kind !== "FORM") return;
  const stored = task.id ? await db.workflowTask.findFirst({ where: { id: task.id, organizationId }, select: { data: true } }) : null;
  const order = await loadOrder(organizationId, task.workOrderId, db);
  const inRoundOrder = Boolean(order?.roundScheduleId && !order.roundOccurrence && roundOfProtocolValues(task.data));
  const check = order ? riskCheckOf(order.data) : null;
  task.data = stampRoundSafety(task.data, {
    created: !task.id, stored: stored?.data ?? null, inRoundOrder,
    actor: { id: actor.id, name: actor.name?.trim() || actor.email || "" }, now: new Date().toISOString(),
    risk: order ? { workOrderId: order.id, riskConfirmedAt: check?.confirmedAt ?? null, extendedTaskId: check?.extendedTaskId ?? null } : null,
  });
}

/** The status a saved protocol gets; throws 409 when the save would start the work before the check is done. */
export async function roundSafetyOnSave(organizationId: string, task: { kind: string; data: unknown; workOrderId?: string | null }, input: { chosen: string; documented: boolean; stored: { status: string; data: unknown } | null }, db: Db = prisma) {
  const risk = roundSafetyRequired(task) ? await loadRoundSafetyRisk(organizationId, task.workOrderId, db) : null;
  const gate = roundSafetyWorkGate(task, risk, input);
  if (gate.refusal) throw new ApiError(409, gate.refusal);
  return gate.status;
}

/** Throws 409 when Starta tid on a round's work order would pass an open occurrence whose check is not done. */
export async function requireOrderRoundSafety(organizationId: string, order: { id: string; roundScheduleId?: string | null }, db: Db = prisma) {
  if (!order.roundScheduleId) return;
  // Open ones only, and all of them: one work order gathers every occurrence of a period of up to five years, so a limit on the
  // rows read would soon hold only finished occurrences and the gate would stop refusing.
  const occurrences = await db.workflowTask.findMany({
    where: { organizationId, workOrderId: order.id, kind: "FORM", status: { notIn: [...CLOSED_TASK_STATUSES] }, data: { path: ["roundSafetyStep"], equals: true } },
    orderBy: { createdAt: "asc" }, select: { kind: true, title: true, status: true, data: true },
  });
  const refusal = orderRoundSafetyRefusal(occurrences, await loadRoundSafetyRisk(organizationId, order.id, db));
  if (refusal) throw new ApiError(409, refusal);
}

/** Throws 409 with the reason when the time may not start, or the occurrence not be completed, before the check is done. */
export async function requireRoundSafety(organizationId: string, task: { kind: string; status: string; data: unknown; workOrderId?: string | null }, action: "start" | "complete", db: Db = prisma) {
  if (!roundSafetyRequired(task) || task.status === "COMPLETED") return;
  const state = roundSafetyState(task, await loadRoundSafetyRisk(organizationId, task.workOrderId, db));
  const refusal = roundSafetyRefusal(state, action);
  if (refusal) throw new ApiError(409, refusal);
}
