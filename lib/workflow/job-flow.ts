import { formLeafBlocks, type FormDocument, type FormValues } from "./form-document";
import { formFlow, riskFlow, workOrderFlow, workOrderFromQuote, type Flow, type RiskFlowStep } from "./task-flow";
import { workflowTaskCompletion } from "./task-model";

/**
 * A stored job's flow as the task page builds it (lib/workflow/task-flow.ts), for places that show a job without opening
 * it – Hem's "Fortsätt: …" on a phone at level 1 says the next step with the same rules as the job itself.
 */
export type StoredJob = {
  id: string;
  title: string;
  status: string;
  assignedToUserId?: string | null;
  assignedToName?: string;
  dueDate?: string;
  timerRunning?: boolean;
  totalDurationSec?: number;
  data:
    | { kind: "WORK_ORDER"; details: { executionNotes: string; signature: { name: string; confirmed: boolean }; materials?: unknown[]; quote?: { quoteId: string } | null } }
    | { kind: "RISK_ASSESSMENT"; details: { risks: { hazard: string; protectiveMeasure: string; likelihood: number; consequence: number; residualLikelihood: number; residualConsequence: number }[]; generalMeasures?: string; approval: { name: string; confirmed: boolean } } }
    | { kind: "FORM"; details: { document: FormDocument; values: FormValues } };
};

export function storedJobFlow(task: StoredJob, riskStep?: RiskFlowStep): Flow {
  const base = { saved: true, title: task.title, status: task.status };
  if (task.data.kind === "WORK_ORDER") {
    const details = task.data.details;
    return workOrderFlow({ ...base, assigned: Boolean(task.assignedToUserId || task.assignedToName?.trim()), dueDate: task.dueDate ?? "", timerRunning: Boolean(task.timerRunning), totalDurationSec: task.totalDurationSec ?? 0,
      executionNotes: details.executionNotes, signatureName: details.signature.name, signatureConfirmed: details.signature.confirmed, riskStep,
      fromQuote: workOrderFromQuote(details as Parameters<typeof workOrderFromQuote>[0]) });
  }
  if (task.data.kind === "RISK_ASSESSMENT") {
    const details = task.data.details;
    return riskFlow({ ...base, risks: details.risks, approvalName: details.approval.name, approvalConfirmed: details.approval.confirmed });
  }
  const completion = workflowTaskCompletion({ title: task.title, status: task.status, data: task.data } as Parameters<typeof workflowTaskCompletion>[0]);
  return formFlow({ ...base, issues: completion.issues, requirements: completion.requirements,
    signatureBlocks: formLeafBlocks(task.data.details.document).filter((block) => block.type === "signature").map((block) => block.id), riskStep });
}
