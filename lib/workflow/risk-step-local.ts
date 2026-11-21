import { riskCheckOf, riskStepApplies, riskStepRefusal, riskStepRequired, riskStepState, type RiskStepContext } from "./risk-step";
import { jobStepOf, type JobStep } from "./project-jobs";

/**
 * Riskbedömning som steg in a Local file and in the demo (2026-10-08): the same rule as Cloud, with the context read
 * from the tasks at hand.
 */
type StoredTask = { id: string; kind: string; title: string; status: string; data: unknown; formArea?: string | null; workOrderId?: string | null };
type TaskInput = Omit<StoredTask, "id" | "title"> & { id?: string };

export function localRiskStepContext(tasks: readonly StoredTask[], task: TaskInput, depth = 0): RiskStepContext {
  const extendedId = riskCheckOf(task.data)?.extendedTaskId;
  const found = extendedId ? tasks.find((item) => item.id === extendedId) : undefined;
  const parent = depth === 0 && task.workOrderId ? tasks.find((item) => item.id === task.workOrderId && item.kind === "WORK_ORDER") : undefined;
  return {
    extended: found ? { id: found.id, title: found.title, status: found.status, kind: found.kind } : null,
    workOrder: parent ? { id: parent.id, title: parent.title, status: parent.status,
      done: !riskStepRequired(parent) || riskStepState(parent, localRiskStepContext(tasks, parent, 1)).done, ...(riskStepRequired(parent) && riskCheckOf(parent.data)?.exception ? { exception: true } : {}) } : null,
  };
}

/** The refusal for starting the time or completing, or null. */
export function localRiskStepRefusal(tasks: readonly StoredTask[], task: TaskInput, action: "start" | "complete"): string | null {
  if (!riskStepApplies(task) || task.status === "COMPLETED") return null;
  return riskStepRefusal(riskStepState(task, localRiskStepContext(tasks, task)), action);
}

/**
 * The job's current step on the project page (Fas 4B) in a Local file and the demo: the same flow as the task page, with
 * the risk step read from the tasks at hand as above.
 */
export function localJobStep(tasks: readonly StoredTask[], task: StoredTask & { data: Parameters<typeof jobStepOf>[0]["data"] }): JobStep {
  const riskDone = !riskStepApplies(task) ? null : task.status === "COMPLETED" ? true : riskStepState(task, localRiskStepContext(tasks, task)).done;
  return jobStepOf(task, riskDone);
}
