import { formLeafBlocks } from "@/lib/workflow/form-document";
import { formFlow, riskFlow, workOrderFlow, type Flow } from "@/lib/workflow/task-flow";
import { workflowTaskCompletion, type workflowTaskDataSchema } from "@/lib/workflow/task-model";
import type { z } from "zod";
import { isTaskCancelled, isTaskClosed } from "@/lib/workflow/task-cancel";

/**
 * Samlad bild (2026-10-08, Fas 4B): the project page shows its jobs – each work order with the tasks that belong to
 * it (`workOrderId`) nested under it, and the standalone tasks in their own group – with each job's current step. The step
 * is read from the same progress line as the task page (task-flow), never from rules of its own.
 */

/** The steps of the core model, as the project page names them. */
export type JobStepKey = "order" | "risk" | "work" | "sign" | "complete" | "done" | "cancelled";
export type JobStep = { key: JobStepKey; label: string };
export const JOB_STEP_LABELS: Record<JobStepKey, string> = {
  order: "Beställning",
  risk: "Riskbedömning",
  work: "Utförande",
  sign: "Signering",
  complete: "Klar att färdigställa",
  done: "Färdigställd",
  // Utgår (2026-10-09): a job that will not be done.
  cancelled: "Utgått",
};
const step = (key: JobStepKey): JobStep => ({ key, label: JOB_STEP_LABELS[key] });

/** A flow step's key (work order, risk assessment and protocol lines) as one of the core model's steps. */
const FLOW_KEY_TO_JOB: Record<string, JobStepKey> = {
  order: "order", basics: "order", plan: "order",
  risk: "risk",
  work: "work", fill: "work", moments: "work", risks: "work", measure: "work", summary: "work",
  sign: "sign", approval: "sign",
  complete: "complete",
};

/** The core model's step for a flow: where its line stands now. */
export function jobStepOfFlow(flow: Flow): JobStep {
  if (flow.done) return step("done");
  return step(FLOW_KEY_TO_JOB[flow.current?.key ?? "complete"] ?? "work");
}

type TaskData = z.infer<typeof workflowTaskDataSchema>;
/**
 * The step of a stored task, from its data and the same flows the task page draws. `riskDone` is the job's risk step
 * (risk-step.ts): null when the task has no such step, so the line leaves it out as on the task page.
 */
export function jobStepOf(task: { title: string; status: string; data: TaskData }, riskDone: boolean | null): JobStep {
  if (task.status === "COMPLETED") return step("done");
  if (isTaskCancelled(task.status)) return step("cancelled");
  const riskStep = riskDone === null ? undefined : { met: riskDone, hint: "" };
  const base = { saved: true, title: task.title, status: task.status };
  if (task.data.kind === "WORK_ORDER") {
    const details = task.data.details;
    return jobStepOfFlow(workOrderFlow({ ...base, assigned: false, dueDate: "", timerRunning: false, totalDurationSec: 0, executionNotes: details.executionNotes, signatureName: details.signature.name, signatureConfirmed: details.signature.confirmed, riskStep }));
  }
  if (task.data.kind === "RISK_ASSESSMENT") {
    const details = task.data.details;
    return jobStepOfFlow(riskFlow({ ...base, risks: details.risks, approvalName: details.approval.name, approvalConfirmed: details.approval.confirmed }));
  }
  const completion = workflowTaskCompletion(task);
  const signatureBlocks = formLeafBlocks(task.data.details.document).filter((block) => block.type === "signature").map((block) => block.id);
  return jobStepOfFlow(formFlow({ ...base, issues: completion.issues, requirements: completion.requirements, signatureBlocks, riskStep }));
}

/** What the grouping needs of a task. */
export type JobTask = { id: string; kind: string; status: string; workOrderId?: string | null };
export type JobGroup<T extends JobTask> = { order: T; linked: T[] };

/**
 * The project's jobs: each work order with the tasks that belong to it, and the tasks that stand alone. A task whose work
 * order is not among the tasks (not readable, or in another project) stands alone, so nothing is ever hidden. Open jobs
 * come before completed ones; otherwise the order given (the newest change first) is kept.
 */
export function groupProjectJobs<T extends JobTask>(tasks: readonly T[]): { workOrders: JobGroup<T>[]; standalone: T[] } {
  const orders = new Map<string, JobGroup<T>>();
  for (const task of tasks) if (task.kind === "WORK_ORDER") orders.set(task.id, { order: task, linked: [] });
  const standalone: T[] = [];
  for (const task of tasks) {
    if (task.kind === "WORK_ORDER") continue;
    const group = task.workOrderId ? orders.get(task.workOrderId) : undefined;
    if (group) group.linked.push(task);
    else standalone.push(task);
  }
  const openFirst = <X,>(items: X[], done: (item: X) => boolean) => [...items.filter((item) => !done(item)), ...items.filter(done)];
  const isDone = (task: T) => isTaskClosed(task.status);
  return {
    workOrders: openFirst([...orders.values()].map((group) => ({ order: group.order, linked: openFirst(group.linked, isDone) })), (group) => isDone(group.order)),
    standalone: openFirst(standalone, isDone),
  };
}

/** How many jobs a group shows before "Visa fler" (bounded lists, 2026-10-07). */
export const JOB_LIST_PAGE = 8;
