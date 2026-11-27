import { saveLocalWorkflowTaskRecord, type LocalWorkspaceDocument } from "../../features/kfid/local-workspace-store";

// Arbetsordern styr (2026-10-26): a task cannot exist without a work order. Tests about something else start a
// task in a plain work order made here (no project, no customer, its risk step confirmed).
const emptyOrder = { executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "" };
const RISK_DONE = { level: "simplified", answers: { deenergized: "yes", competence: "yes", height: "yes", others: "yes", special: "yes" }, confirmedBy: "QA", confirmedAt: "2026-10-08T06:00:00.000Z" };

/** A Local file with a new work order in it, and the order's id. */
export function withLocalWorkOrder(workspace: LocalWorkspaceDocument, fields: { title?: string; projectId?: string | null; customerId?: string | null; facilityId?: string | null } = {}) {
  const saved = saveLocalWorkflowTaskRecord(workspace, { version: 0, kind: "WORK_ORDER", title: fields.title ?? "Arbetsorder", projectId: fields.projectId ?? null, customerId: fields.customerId ?? null, facilityId: fields.facilityId ?? null,
    data: { kind: "WORK_ORDER", details: emptyOrder, riskCheck: RISK_DONE } });
  return { workspace: saved.workspace, workOrderId: saved.task.id };
}
