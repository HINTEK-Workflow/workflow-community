import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { isRiskAssessmentTask, riskCheckOf, riskExceptionOn, riskExceptionRefusal, riskStepApplies, riskStepExempt, riskStepRefusal, riskStepRequired, riskStepState, stampRiskStep, type RiskStepContext, type RiskStepState } from "./risk-step";

/**
 * Riskbedömning som steg in Cloud (2026-10-08): the context the rule in ./risk-step.ts needs, read inside the
 * caller's company (organizationId on every query), and the gates the task route calls when the time starts and when a
 * task is completed. The work order a task belongs to (Fas 2's `workOrderId`) is read when the row has one.
 */
type Db = Prisma.TransactionClient | typeof prisma;
export type RiskStepTask = { id?: string; kind: string; formArea?: string | null; formTemplateId?: string | null; status: string; data: unknown; workOrderId?: string | null };
const workOrderIdOf = (task: unknown) => { const value = (task as { workOrderId?: unknown } | null)?.workOrderId; return typeof value === "string" && value ? value : null; };

export async function loadRiskStepContext(organizationId: string, task: RiskStepTask, db: Db = prisma, depth = 0): Promise<RiskStepContext> {
  if (!(depth === 0 ? riskStepApplies({ ...task, workOrderId: workOrderIdOf(task) }) : riskStepRequired(task))) return { extended: null, workOrder: null };
  const extendedId = riskCheckOf(task.data)?.extendedTaskId;
  const extended = extendedId ? await db.workflowTask.findFirst({ where: { id: extendedId, organizationId }, select: { id: true, title: true, status: true, kind: true } }) : null;
  const parentId = depth === 0 ? workOrderIdOf(task) : null;
  let workOrder: RiskStepContext["workOrder"] = null;
  if (parentId) {
    const row = await db.workflowTask.findFirst({ where: { id: parentId, organizationId, kind: "WORK_ORDER" } });
    if (row) {
      // An older work order (created before the step) or one whose step is done counts as done for the tasks under it.
      const done = !riskStepRequired(row) || riskStepState(row, await loadRiskStepContext(organizationId, row, db, 1)).done;
      workOrder = { id: row.id, title: row.title, status: row.status, done, ...(riskStepRequired(row) && riskCheckOf(row.data)?.exception ? { exception: true } : {}) };
    }
  }
  return { extended, workOrder };
}

/** Whether the company allows Arbetet är redan utfört (Inställningar → Arbetssätt; on unless turned off). Read within the company. */
export async function readRiskExceptionAllowed(organizationId: string, db: Db = prisma): Promise<boolean> {
  const row = await db.workspaceSettings.findUnique({ where: { organizationId }, select: { profile: true } });
  return riskExceptionOn(row?.profile);
}

export async function riskStepOf(organizationId: string, task: RiskStepTask, db: Db = prisma): Promise<{ state: RiskStepState; context: RiskStepContext }> {
  const context = await loadRiskStepContext(organizationId, task, db);
  return { state: riskStepState(task, context), context };
}

/** Throws 409 with the reason when the time may not start, or the task not be completed, before the risk step is done. */
export async function requireRiskStep(organizationId: string, task: RiskStepTask, action: "start" | "complete", db: Db = prisma) {
  if (!riskStepApplies({ ...task, workOrderId: workOrderIdOf(task) }) || task.status === "COMPLETED") return;
  const { state } = await riskStepOf(organizationId, task, db);
  const refusal = riskStepRefusal(state, action);
  if (refusal) throw new ApiError(409, refusal);
}

/**
 * The save of a task: refuses an exception the company has turned off, stamps the step (the flag on a new task, who confirmed or
 * made the exception and when), checks that a linked extended risk assessment is one of the company's own, and refuses completion
 * until the step is done. `task.data` is replaced in place.
 */
export async function applyRiskStepOnSave(organizationId: string, actor: { id: string; name?: string | null; email?: string | null }, task: { id?: string; kind: string; status: string; data: object }, form: { formArea: string | null; formTemplateId: string | null }, db: Db = prisma) {
  const stored = task.id ? await db.workflowTask.findFirst({ where: { id: task.id, organizationId } }) : null;
  // Only a work order gets the step (Arbetsordern styr, 2026-10-26); its tasks inherit it.
  const exempt = riskStepExempt({ kind: task.kind, formArea: form.formArea, data: task.data });
  void isRiskAssessmentTask;
  // The company's choice is read only when this save carries an exception, so an ordinary save asks nothing more.
  if (riskCheckOf(task.data)?.exception) {
    const refusal = riskExceptionRefusal(task.data, stored?.data ?? null, await readRiskExceptionAllowed(organizationId, db));
    if (refusal) throw new ApiError(409, refusal);
  }
  task.data = stampRiskStep(task.data, { created: !task.id, stored: stored?.data ?? null, exempt, actor: { id: actor.id, name: actor.name?.trim() || actor.email || "" }, now: new Date().toISOString() });
  const linked = riskCheckOf(task.data)?.extendedTaskId;
  if (linked && linked !== riskCheckOf(stored?.data)?.extendedTaskId) {
    const row = await db.workflowTask.findFirst({ where: { id: linked, organizationId }, select: { kind: true, formArea: true, data: true } });
    if (!row || !isRiskAssessmentTask(row)) throw new ApiError(400, "Den kopplade riskbedömningen hittades inte i företaget.");
  }
  if (task.status === "COMPLETED" && stored?.status !== "COMPLETED")
    await requireRiskStep(organizationId, { ...task, formArea: form.formArea, formTemplateId: form.formTemplateId, status: stored?.status ?? "PLANNED", workOrderId: workOrderIdOf(task) ?? workOrderIdOf(stored) }, "complete", db);
}
