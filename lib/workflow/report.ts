import type { WorkflowTaskKind, WorkflowTaskStatus } from "./task-model";
import type { FormDocument, FormValues } from "./form-document";
import { createFormProtocolPdf } from "./form-report";
import { createTaskReportPdf } from "./task-report";
import type { ReportBranding } from "@/lib/kfid/report-branding";

export const workflowReportSectionKeys = [
  "summary", "time", "execution", "materials", "deviations", "risks",
  "riskMatrix", "approval", "images", "attachments",
] as const;
export type WorkflowReportSection = (typeof workflowReportSectionKeys)[number];
export type WorkflowReportOptions = Record<WorkflowReportSection, boolean>;

export const defaultWorkflowReportOptions: WorkflowReportOptions = {
  summary: true,
  time: true,
  execution: true,
  materials: true,
  deviations: true,
  risks: true,
  riskMatrix: true,
  approval: true,
  images: true,
  attachments: true,
};

type Risk = { hazard: string; likelihood: number; consequence: number; protectiveMeasure: string; residualLikelihood: number; residualConsequence: number };
type Material = { name: string; quantity: string; unit: string };
export type WorkflowReportTask = {
  id: string;
  kind: WorkflowTaskKind;
  /** A protocol's permission area (2026-09-27): forms, kfid or risk-assessment. */
  formArea?: string | null;
  /** The task's own save version, as the page shows it (the report used the template's, which the page never shows). */
  version?: number;
  title: string;
  description: string;
  status: WorkflowTaskStatus;
  progress: number;
  projectId?: string | null;
  projectName?: string;
  /** The project's fixed fields (2026-09-26), printed read-only with the task. */
  projectFields?: (readonly [string, string])[];
  customerName?: string;
  siteName?: string;
  /** The task's customer facility (decision 11), when linked. */
  facilityName?: string;
  assignedToName: string;
  dueDate: string;
  totalDurationSec: number;
  data:
    | { kind: "WORK_ORDER"; details: { executionNotes: string; deviations: string; materials: Material[]; signature: { name: string; confirmed: boolean; signedAt: string | null }; closeNotes: string } }
    | { kind: "RISK_ASSESSMENT"; details: { risks: Risk[]; generalMeasures: string; approval: { name: string; confirmed: boolean; approvedAt: string | null } } }
    | { kind: "FORM"; details: { templateName: string; templateVersion: number; document: FormDocument; values: FormValues } };
  /** The id lets a protocol place a picture in its object card; pictures placed there are not printed again under Bilder. */
  attachments: { id?: string; filename: string; mimeType: string; bytes?: Uint8Array }[];
};

/**
 * A task or project report. A single form protocol is drawn like the control's report (2026-09-27); work orders,
 * older risk assessments and a project report's own pages are drawn in the same look (2026-09-30), in the company's
 * report colours and with its logo when they are passed. `createdAt` is only passed by the reference tests so their
 * PDFs are the same every time.
 */
export async function createWorkflowPdfReport(input: { company: string; title?: string; projectName?: string; projectFields?: (readonly [string, string])[]; tasks: WorkflowReportTask[]; options: WorkflowReportOptions; fontBytes: Uint8Array; createdAt?: Date; branding?: Partial<ReportBranding> | null; logoBytes?: Uint8Array | null; blank?: boolean;
  /** A project report whose protocols follow as their own PDFs (in the control's look) still counts every chosen task. */
  taskCount?: number }) {
  const identity = { company: input.company, branding: input.branding, logoBytes: input.logoBytes };
  if (!input.projectName && input.tasks.length === 1 && input.tasks[0].data.kind === "FORM")
    return createFormProtocolPdf({ identity, fontBytes: input.fontBytes, task: input.tasks[0], options: input.options, createdAt: input.createdAt, blank: input.blank });
  return createTaskReportPdf({ identity, fontBytes: input.fontBytes, tasks: input.tasks, options: input.options, createdAt: input.createdAt, title: input.title, projectName: input.projectName, projectFields: input.projectFields, taskCount: input.taskCount });
}
