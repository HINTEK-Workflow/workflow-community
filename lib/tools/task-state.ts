import * as planningRoute from "@/app/api/planned-activities/route";
import * as riskStepRoute from "@/app/api/workflow-tasks/risk-step/route";
import * as workRoute from "@/app/api/self-inspection/work/route";
import { deviationClosedText, deviationHref, deviationLinkText } from "@/lib/self-inspection/deviation-link";
import { DEVIATION_KINDS, DEVIATION_STATUSES, type DeviationKind, type DeviationStatus } from "@/lib/self-inspection/model";
import type { WorkContext } from "@/lib/self-inspection/work";
import { prisma } from "@/lib/db";
import { context } from "@/lib/kfid/server";
import { checkLevel, type LevelAction } from "@/lib/self-inspection/levels";
import { openLevelGate } from "@/lib/self-inspection/levels-server";
import { swedishDayKey } from "@/lib/swedish-time";
import { callRoute } from "@/lib/tools/call-route";
import { jobState, type JobState, type JobStateInput } from "@/lib/workflow/job-state";
export { withJobState } from "@/lib/workflow/job-state";
import { hasWorkflowPermission, workflowSubjectForTask } from "@/lib/workflow/permissions";
import { riskStepRefusal, type RiskStepContext, type RiskStepState } from "@/lib/workflow/risk-step";

type Input = Record<string, unknown>;
const q = (value: unknown) => encodeURIComponent(String(value ?? ""));

export type LinkedDeviation = {
  id: string; number: number; kind: DeviationKind; kindLabel: string; status: DeviationStatus; statusLabel: string;
  /** Åtgärdad: when and by whom (as the log keeps them); null and "" while open. */
  closedAt: string | null; closedByName: string;
  /** "Avvikelse 3 i avvikelseloggen · Pågår" and "Åtgärdad 2026-10-10 av …" as the work order's page shows them. */
  text: string; closedText: string;
  url: string;
};

/**
 * Avvikelselänken for get_task (plan 1J, 2026-10-11): the deviation-log entries a work order fixes, read through the
 * work route exactly as the order's page reads them – so only an entry the reader may read (the log's own rule: an admin,
 * the person who reported it or is responsible for it) is ever listed. Left out for other kinds of task and whenever the
 * route refuses (Local, no programme), rather than failing the tool.
 */
export async function linkedDeviationsFor(task: Input): Promise<LinkedDeviation[] | undefined> {
  if (task.kind !== "WORK_ORDER" || !task.id) return undefined;
  try {
    const result = await callRoute(workRoute.GET, "GET", `/api/self-inspection/work?taskId=${q(task.id)}`) as unknown as Pick<WorkContext, "orderDeviations">;
    return (result.orderDeviations ?? []).map((entry) => ({
      id: entry.id, number: entry.number, kind: entry.kind, kindLabel: DEVIATION_KINDS[entry.kind], status: entry.status, statusLabel: DEVIATION_STATUSES[entry.status],
      closedAt: entry.closedAt, closedByName: entry.closedByName, text: deviationLinkText(entry), closedText: deviationClosedText(entry), url: deviationHref(entry.id),
    }));
  } catch {
    return undefined;
  }
}

/**
 * Jobbets läge for get_task (Workflow AI-planen steg 3, 2026-10-09): the job as read by the tasks route, plus what the
 * page itself reads beside it – the risk step (the risk-step route, the same read and visibility as the page), the
 * coming bookings (the planning route with its read permission) and the level rule for the reader (the gate the routes
 * use). Everything inside the caller's own session and company; a part that cannot be read is left out rather than
 * failing the tool. The rules are in lib/workflow/job-state.ts.
 */
export async function jobStateFor(task: Input): Promise<JobState | null> {
  try {
    const ctx = await context();
    const id = String(task.id);
    const workOrderId = typeof task.workOrderId === "string" && task.workOrderId ? task.workOrderId : null;
    const [risk, bookings, levels, workOrderRisk, project] = await Promise.all([
      callRoute(riskStepRoute.GET, "GET", `/api/workflow-tasks/risk-step?taskId=${q(id)}`).then((result) => result as unknown as { state: RiskStepState; context: RiskStepContext }),
      callRoute(planningRoute.GET, "GET", `/api/planned-activities?forTask=${q(id)}&upcoming=1`).then((result) => (result.activities as JobStateInput["bookings"]) ?? []).catch(() => null),
      levelMessages(ctx, task, workOrderId).catch(() => null),
      // The work order's own risk step, for the refusal Starta tid gives (the time runs on it); only when the reader may read it.
      workOrderId ? callRoute(riskStepRoute.GET, "GET", `/api/workflow-tasks/risk-step?taskId=${q(workOrderId)}`).then((result) => (result as unknown as { state: RiskStepState }).state).catch(() => null) : Promise.resolve(null),
      typeof task.projectId === "string" && task.projectId ? prisma.project.findFirst({ where: { id: task.projectId, organizationId: ctx.organizationId }, select: { archivedAt: true, closedAt: true } }) : Promise.resolve(null),
    ]);
    const owner = workOrderId ? risk.context.workOrder : null;
    return jobState({
      task: task as unknown as JobStateInput["task"],
      risk: risk.state,
      timeOwner: owner ? { title: owner.title, status: owner.status, riskDone: owner.done, refusal: workOrderRisk ? riskStepRefusal(workOrderRisk, "start") : null } : null,
      level: levels,
      mayEdit: ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, workflowSubjectForTask(String(task.kind), (task.formArea as string | null | undefined) ?? null), "edit"),
      projectFrozen: project?.archivedAt ? "archived" : project?.closedAt ? "closed" : null,
      bookings,
      today: swedishDayKey(new Date()),
    });
  } catch {
    return null;
  }
}

/** The level rule's message for the reader per action (null = allowed), as the routes' gate decides it. */
async function levelMessages(ctx: Awaited<ReturnType<typeof context>>, task: Input, workOrderId: string | null) {
  const gate = await openLevelGate(ctx.organizationId);
  if (!gate.enforced) return { work: null, start: null, complete: null };
  const subject = await gate.risk({ kind: String(task.kind), formTemplateId: (task.formTemplateId as string | null | undefined) ?? null, data: task.data });
  const responsibleId = (task.assignedToUserId as string | null | undefined) ?? null;
  const ask = (action: LevelAction, target = subject, responsible = responsibleId) => {
    const decision = checkLevel({ directory: gate.directory, subject: target, action, person: { id: ctx.user.id }, self: true,
      responsible: responsible ? { id: responsible, name: responsible === responsibleId ? String(task.assignedToName ?? "") : undefined } : null });
    return decision.allowed ? null : decision.message;
  };
  // Starting the time asks the work order too when the time runs on it (the timer route), with its own responsible person.
  let start = ask("start");
  if (!start && workOrderId) {
    const order = await prisma.workflowTask.findFirst({ where: { id: workOrderId, organizationId: ctx.organizationId }, select: { kind: true, formTemplateId: true, assignedToUserId: true } });
    if (order) start = ask("start", await gate.risk({ kind: order.kind, formTemplateId: order.formTemplateId }), order.assignedToUserId);
  }
  return { work: ask("work"), start, complete: ask("complete") };
}
