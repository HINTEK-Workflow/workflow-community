import { z } from "zod";
import { formCompletion, formDocumentSchema, formHasContent, formValuesSchema, type FormDocument, type FormValues } from "./form-document";

export const workflowTaskKinds = ["WORK_ORDER", "RISK_ASSESSMENT", "FORM"] as const;
export const workflowTaskStatuses = ["PLANNED", "IN_PROGRESS", "PAUSED", "NEEDS_ACTION", "COMPLETED"] as const;
export type WorkflowTaskKind = (typeof workflowTaskKinds)[number];
export type WorkflowTaskStatus = (typeof workflowTaskStatuses)[number];
/**
 * Attachments per task. A protocol places pictures per object (a thermography round has a thermal image and a photo
 * for every object), so it may hold more than a work order or a risk assessment (2026-09-26).
 */
export const workflowTaskAttachmentLimit = (kind: string) => kind === "FORM" ? 60 : 15;

const text = (max: number) => z.string().trim().max(max).default("");
const materialSchema = z.object({ id: z.uuid(), name: z.string().trim().min(1).max(160), quantity: z.string().trim().max(40).default(""), unit: z.string().trim().max(40).default("") });
const riskSchema = z.object({
  id: z.uuid(),
  hazard: text(500),
  likelihood: z.number().int().min(1).max(5),
  consequence: z.number().int().min(1).max(5),
  protectiveMeasure: text(1000),
  residualLikelihood: z.number().int().min(1).max(5),
  residualConsequence: z.number().int().min(1).max(5),
});

export const workOrderDataSchema = z.object({
  executionNotes: text(10_000),
  deviations: text(10_000),
  materials: z.array(materialSchema).max(200).default([]),
  signature: z.object({ name: text(160), confirmed: z.boolean().default(false), signedAt: z.iso.datetime().nullable().default(null) }).default({ name: "", confirmed: false, signedAt: null }),
  closeNotes: text(5000),
  // The task a work order was made from (2026-09-30, the guided flow): a protocol's deviation row or another task.
  // Only a link for "Tillbaka till …"; the server reads it within the company and the reader's permissions.
  source: z.object({ taskId: z.string().min(1).max(100), title: z.string().trim().max(200).default(""), kind: z.enum(["WORK_ORDER", "RISK_ASSESSMENT", "FORM"]).optional(), rowId: z.string().max(100).optional() }).optional(),
});

export const riskAssessmentDataSchema = z.object({
  risks: z.array(riskSchema).max(200).default([]),
  generalMeasures: text(10_000),
  approval: z.object({ name: text(160), confirmed: z.boolean().default(false), approvedAt: z.iso.datetime().nullable().default(null) }).default({ name: "", confirmed: false, approvedAt: null }),
});

/**
 * A protocol from a published form (2026-09-26): the template version it was created from, a copy of that
 * version's document (so it opens offline and never changes with the template; the server always replaces the copy
 * with the stored version) and the answers.
 */
export const formTaskDataSchema = z.object({
  templateId: z.string().min(1).max(100),
  templateVersion: z.number().int().positive(),
  templateName: text(200),
  /** The form's publisher as shown on the protocol (2026-09-27); set by the server from the stored version. */
  publisherName: z.string().max(300).optional(),
  document: formDocumentSchema,
  values: formValuesSchema,
});

export type FormTaskDetails = z.infer<typeof formTaskDataSchema>;

export const workflowTaskDataSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("WORK_ORDER"), details: workOrderDataSchema }),
  z.object({ kind: z.literal("RISK_ASSESSMENT"), details: riskAssessmentDataSchema }),
  z.object({ kind: z.literal("FORM"), details: formTaskDataSchema }),
]);

export const workflowTaskInputSchema = z.object({
  id: z.string().min(1).max(100).optional(),
  version: z.number().int().nonnegative().default(0),
  kind: z.enum(workflowTaskKinds),
  title: z.string().trim().min(1).max(200),
  description: text(5000),
  status: z.enum(workflowTaskStatuses).default("PLANNED"),
  projectId: z.string().min(1).max(100).nullable().default(null),
  customerId: z.string().min(1).max(100).nullable().default(null),
  // Optional customer facility (decision 11); it must belong to the task's customer. Additive for older files.
  facilityId: z.string().min(1).max(100).nullable().default(null),
  siteId: z.string().min(1).max(100).nullable().default(null),
  departmentId: z.string().min(1).max(100).nullable().default(null),
  assignedToUserId: z.string().min(1).max(100).nullable().default(null),
  assignedToName: text(160),
  dueDate: z.union([z.literal(""), z.iso.date()]).default(""),
  data: workflowTaskDataSchema,
}).superRefine((value, context) => {
  if (value.kind !== value.data.kind) context.addIssue({ code: "custom", path: ["data", "kind"], message: "Uppgiftstypen stämmer inte." });
  if (value.departmentId && !value.siteId) context.addIssue({ code: "custom", path: ["departmentId"], message: "Välj plats före avdelning." });
});

type TaskData = z.infer<typeof workflowTaskDataSchema>;
type CompletionTask = {
  title: string;
  status: string;
  data: {
    kind: "WORK_ORDER";
    details: Pick<z.infer<typeof workOrderDataSchema>, "executionNotes" | "signature">;
  } | {
    kind: "RISK_ASSESSMENT";
    details: Omit<z.infer<typeof riskAssessmentDataSchema>, "risks"> & {
      risks: Omit<z.infer<typeof riskSchema>, "id">[];
    };
  } | {
    kind: "FORM";
    details: { document: FormDocument; values: FormValues };
  };
};

/** One set of requirements for completion, guidance, progress and reports. */
export function workflowTaskCompletion(input: CompletionTask) {
  const requirements: { field: string; message: string; met: boolean; weight: number }[] = [];
  const add = (field: string, message: string, met: boolean, weight: number) => requirements.push({ field, message, met, weight });
  const filled = (value: string) => Boolean(value.trim());
  const rating = (value: number) => Number.isInteger(value) && value >= 1 && value <= 5;
  add("task-title", "Ange en rubrik.", filled(input.title), 0);
  if (input.data.kind === "FORM") {
    // Forms use their own requirements from the template: filled required blocks, signatures and a deviation comment.
    const form = formCompletion(input.data.details.document, input.data.details.values);
    const all = [...requirements, ...form.requirements.map((item) => ({ field: `form-${item.blockId}`, message: item.message, met: item.met, weight: 0 }))];
    const issues = all.filter((item) => !item.met);
    return { requirements: all, issues, ready: issues.length === 0, progress: Math.min(95, form.percent) };
  }
  if (input.data.kind === "WORK_ORDER") {
    const { executionNotes, signature } = input.data.details;
    add("task-execution", "Beskriv det utförda arbetet.", filled(executionNotes), 70);
    add("task-signature-name", "Ange namn på den som signerar.", filled(signature.name), 10);
    add("task-signature-confirmed", "Bekräfta signeringen av arbetsordern.", signature.confirmed, 15);
  } else {
    const { risks, approval } = input.data.details;
    if (!risks.length) add("task-add-risk", "Lägg till minst en dokumenterad risk.", false, 70);
    risks.forEach((risk, index) => {
      const weight = 17.5 / risks.length;
      add(`task-risk-${index}-hazard`, `Risk ${index + 1}: beskriv risken eller faran.`, filled(risk.hazard), weight);
      add(`task-risk-${index}-measure`, `Risk ${index + 1}: beskriv skyddsåtgärden.`, filled(risk.protectiveMeasure), weight);
      add(`task-risk-${index}-before`, `Risk ${index + 1}: bedöm sannolikhet och konsekvens före åtgärd (1–5).`, rating(risk.likelihood) && rating(risk.consequence), weight);
      add(`task-risk-${index}-after`, `Risk ${index + 1}: bedöm sannolikhet och konsekvens efter åtgärd (1–5).`, rating(risk.residualLikelihood) && rating(risk.residualConsequence), weight);
    });
    add("task-approval-name", "Ange namn på den som godkänner.", filled(approval.name), 10);
    add("task-approval-confirmed", "Bekräfta godkännandet av riskbedömningen.", approval.confirmed, 15);
  }
  const issues = requirements.filter((item) => !item.met);
  return { requirements, issues, ready: issues.length === 0, progress: Math.min(95, Math.round(requirements.reduce((sum, item) => sum + (item.met ? item.weight : 0), 0))) };
}

export function workflowTaskProgress(input: CompletionTask) {
  // Completed historical records retain their original status until reopened.
  return input.status === "COMPLETED" ? 100 : workflowTaskCompletion(input).progress;
}

// The description is the order text, written when the task is made: it is not documentation of work done, so a new
// work order stays Planerad (2026-10-02, the simulation: "Planerade (0)" on the morning of a full plan).
export function workflowTaskHasDocumentation(input: Pick<z.infer<typeof workflowTaskInputSchema>, "data">) {
  if (input.data.kind === "FORM") return formHasContent(input.data.details.values);
  const details = input.data.details;
  return Boolean(("executionNotes" in details
    ? details.executionNotes.trim() || details.signature.confirmed || details.signature.name.trim()
    : details.risks.length || details.approval.confirmed || details.approval.name.trim()));
}

/** Timestamps are assigned by the persistence boundary, never trusted from a client. */
export function stampWorkflowTaskApproval(data: TaskData, now: string): TaskData {
  if (data.kind === "FORM") return { ...data, details: { ...data.details, values: { ...data.details.values, signatures: Object.fromEntries(Object.entries(data.details.values.signatures).map(([key, signature]) => [key, { ...signature, signedAt: signature.confirmed ? now : null }])) } } };
  return data.kind === "WORK_ORDER"
    ? { ...data, details: { ...data.details, signature: { ...data.details.signature, signedAt: data.details.signature.confirmed ? now : null } } }
    : { ...data, details: { ...data.details, approval: { ...data.details.approval, approvedAt: data.details.approval.confirmed ? now : null } } };
}

export function resetWorkflowTaskApproval(data: TaskData): TaskData {
  if (data.kind === "FORM") return { ...data, details: { ...data.details, values: { ...data.details.values, signatures: Object.fromEntries(Object.entries(data.details.values.signatures).map(([key, signature]) => [key, { ...signature, confirmed: false, signedAt: null }])) } } };
  return data.kind === "WORK_ORDER"
    ? { ...data, details: { ...data.details, signature: { ...data.details.signature, confirmed: false, signedAt: null } } }
    : { ...data, details: { ...data.details, approval: { ...data.details.approval, confirmed: false, approvedAt: null } } };
}
