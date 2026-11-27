import { saveLocalWorkflowTaskRecord, type LocalWorkspaceDocument } from "@/features/kfid/local-workspace-store";
import { SelfInspectionError } from "@/lib/self-inspection/model";
import {
  createOrderRefusal, documentAfterOrderSave, documentWithEntryOrder, orderForRow, storedOrderFacts, workOrderFromDeviation,
  type DeviationActor, type DeviationOrderFacts, type DeviationRow,
} from "@/lib/self-inspection/deviation-link";

/**
 * Avvikelse ↔ arbetsorder in Local (2026-10-10): the same rules as Cloud (lib/self-inspection/deviation-link.ts) on
 * the open .hwf file. The file's owner is the only person in it, so whoever finishes or links is the owner.
 */

/** The work order of a protocol row in the file, as the rules read it (rule 1 for a new log entry). */
export const localOrderForRow = (workspace: Pick<LocalWorkspaceDocument, "workflowTasks">, owner: DeviationActor) => (row: DeviationRow): DeviationOrderFacts | null =>
  storedOrderFacts(orderForRow(workspace.workflowTasks, row), () => owner);

/** After a task is saved in the file: a new order from a row takes the row's entries; a finished order closes them. */
export function localWorkspaceAfterOrderSave(workspace: LocalWorkspaceDocument, input: { taskId: string; previousStatus: string | null; owner: DeviationActor }): LocalWorkspaceDocument {
  const order = workspace.workflowTasks.find((task) => task.id === input.taskId);
  if (!order) return workspace;
  const selfInspection = documentAfterOrderSave(workspace.selfInspection, { order, previousStatus: input.previousStatus, by: input.owner, now: new Date().toISOString() });
  return selfInspection === workspace.selfInspection ? workspace : { ...workspace, selfInspection };
}

/** "Skapa arbetsorder" on a log entry in the file: the order is saved with the file's rules and linked in the same change. */
export function localWorkOrderFromDeviation(workspace: LocalWorkspaceDocument, deviationId: string): LocalWorkspaceDocument {
  const entry = workspace.selfInspection.deviations.find((item) => item.id === deviationId);
  if (!entry) throw new SelfInspectionError(404, "Avvikelsen hittades inte.");
  const refusal = createOrderRefusal(entry, true);
  if (refusal) throw new SelfInspectionError(409, refusal);
  const protocol = entry.source ? workspace.workflowTasks.find((task) => task.id === entry.source!.taskId) : undefined;
  const project = protocol?.projectId ? workspace.projects.find((item) => item.id === protocol.projectId) : undefined;
  const projectOpen = Boolean(project && !project.archivedAt && !project.closedAt);
  const customerId = protocol?.customerId ?? project?.customerId ?? null;
  // The file's owner may do everything, so the entry's responsible person (the owner or someone named in the file) is Ansvarig by name.
  const assignee = entry.responsibleName?.trim() ? { id: null, name: entry.responsibleName } : null;
  const draft = workOrderFromDeviation(entry, protocol ? { kind: protocol.kind, projectId: projectOpen ? protocol.projectId : null, customerId, facilityId: customerId ? protocol.facilityId ?? null : null } : null, assignee);
  const result = saveLocalWorkflowTaskRecord(workspace, draft);
  return { ...result.workspace, selfInspection: documentWithEntryOrder(result.workspace.selfInspection, entry.id, result.task.id, new Date().toISOString()) };
}
