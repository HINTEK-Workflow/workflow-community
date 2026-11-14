import type { WorkflowTaskKind, WorkflowTaskStatus } from "./task-model";
import type { FormDocument, FormValues } from "./form-document";
// The PDF engine (pdf-lib, fontkit) is loaded only when a report is drawn, so screens that import the report options
// do not carry it in the startup bundle (quality check 2026-10-05, F9).
import type { ReportBranding } from "@/lib/kfid/report-branding";
import type { CatalogueSnapshot } from "@/lib/catalogue/snapshot";
import type { StoreRef } from "./store-ref";
import type { KitSender } from "./report-kit";
import type { ReportFontBytes } from "./report-fonts";
import type { PdfTemplateOverride } from "@/lib/pdf-templates/model";

export const workflowReportSectionKeys = [
  "summary", "time", "execution", "materials", "deviations", "risks",
  "riskMatrix", "approval", "images", "attachments", "prices",
] as const;
export type WorkflowReportSection = (typeof workflowReportSectionKeys)[number];
export type WorkflowReportOptions = Record<WorkflowReportSection, boolean>;

/**
 * Protokollnummer (2026-11-01, beslut 6): "P-" and the end of the protocol's id, so a protocol has one fixed number
 * from the start, on every copy, and two protocols do not share one. It says nothing about the order they were made in; a
 * running number would need its own column.
 */
export const protocolNumberOf = (taskId: string) => {
  // The demo's made-up protocols (demo-task-290) get a readable number instead of a cut word (kundresa 2026-11-07, M16: "P-OTASK290").
  const demo = /^demo-[a-z-]*?(\d+)$/.exec(taskId);
  return demo ? `P-DEMO-${demo[1]}` : `P-${taskId.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase()}`;
};

/**
 * `prices` (Priser på materialraden, 2026-10-09; utgifterna 2026-11-04): every amount in a work order report – the material
 * rows' price to the customer, the expenses' à-pris, belopp and sum and a car cost's rate, the sums with the work (never the
 * purchase price or the markup: the report is the customer's). Off unless the person ticks "Visa priser", and the server
 * allows it only to someone who may see prices. Without it the report says what was used and how much, in no amounts.
 */
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
  prices: false,
};

type Risk = { hazard: string; likelihood: number; consequence: number; protectiveMeasure: string; residualLikelihood: number; residualConsequence: number };
type Material = { id?: string; name: string; quantity: string; unit: string; kind?: "material" | "expense"; unitPrice?: string; amount?: string; carCost?: unknown; catalogue?: CatalogueSnapshot; markupPercent?: string; articleNo?: string; articleSource?: string; manufacturerArticleNo?: string; storeRef?: StoreRef };
export type WorkflowReportTask = {
  /** Kommentarer (beslut 14, 2026-11-01): only those chosen "Med i kundrapporten", a work order's. */
  customerComments?: readonly { authorName: string; body: string; createdAt: string }[];
  /** Beslut 8 (2026-11-01): the seconds at the company's hourly rate and the types with their own price; left out = all the task's time at the hourly rate. */
  billedLabour?: { standardSec: number; own: { name: string; seconds: number; rate: number | null }[] };
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
  /** Hör till arbetsorder (Fas 2): the title of the work order the task belongs to, printed as "Hör till arbetsorder" (Fas 4B). */
  workOrderTitle?: string;
  /**
   * Protokollmallen (beslut 6): a protocol with a number is printed by the shared template – the number and template version
   * in the heading, the box with customer, project, place and work order, the final verdict and the signature block. A
   * blank form and a preview have none and print the form alone.
   */
  protocolNumber?: string;
  /** When the task was finished. */
  completedAt?: string | null;
  /** Kundens kvittens (beslut 6): name and time, on the work order, printed also on the protocols it holds. */
  customerReceipt?: { name: string; at: string | null } | null;
  /** The project's fixed fields (2026-09-26), printed read-only with the task. */
  projectFields?: (readonly [string, string])[];
  customerName?: string;
  /** The task's customer facility (decision 11), when linked. */
  facilityName?: string;
  assignedToName: string;
  dueDate: string;
  totalDurationSec: number;
  data:
    | { kind: "WORK_ORDER"; details: { executionNotes: string; deviations: string; materials: Material[]; signature: { name: string; confirmed: boolean; signedAt: string | null }; closeNotes: string; waitingOn?: string; customerReceipt?: { name: string; at: string | null } } }
    | { kind: "RISK_ASSESSMENT"; details: { risks: Risk[]; generalMeasures: string; approval: { name: string; confirmed: boolean; approvedAt: string | null } } }
    | { kind: "FORM"; details: { templateName: string; templateVersion: number; document: FormDocument; values: FormValues } };
  /**
   * Underhåll (2026-10-30): a work order's maintenance items (not Utgår), each with its machine part's name and its
   * facts (lib/workflow/maintenance.ts maintenanceFactsSchema); printed under Underhåll. Cloud only.
   */
  maintenanceItems?: { partName: string; facts: unknown }[];
  /**
   * Avvikelser (kundresa 2026-11-07, M22): the entries in the company's deviation log taken from this protocol that are not
   * done, listed in the protocol's summary so an open deviation is never hidden. Cloud only.
   */
  loggedDeviations?: { number: number; title: string; status: string }[];
  /** The id lets a protocol place a picture in its object card; pictures placed there are not printed again under Bilder. */
  /** `receipt` (Kvitto, 2026-11-04): a picture of a receipt shows amounts, so without "Visa priser" it is neither printed nor listed. */
  attachments: { id?: string; filename: string; mimeType: string; bytes?: Uint8Array; receipt?: boolean }[];
};

/** Without "Visa priser" a picture marked as a receipt is dropped (not drawn, not listed); everything else stays. Every report goes through here. */
export function reportTasksWithoutReceipts<T extends Pick<WorkflowReportTask, "attachments">>(tasks: T[], options: Pick<WorkflowReportOptions, "prices">): T[] {
  if (options.prices) return tasks;
  return tasks.map((task) => task.attachments.some((item) => item.receipt) ? { ...task, attachments: task.attachments.filter((item) => !item.receipt) } : task);
}

/**
 * A task or project report. A single form protocol is drawn like the control's report (2026-09-27); work orders,
 * older risk assessments and a project report's own pages are drawn in the same look (2026-09-30), in the company's
 * report colours and with its logo when they are passed. `createdAt` is only passed by the reference tests so their
 * PDFs are the same every time.
 */
export async function createWorkflowPdfReport(input: { company: string; title?: string; projectName?: string; projectFields?: (readonly [string, string])[]; projectComments?: readonly { authorName: string; body: string; createdAt: string }[]; tasks: WorkflowReportTask[]; options: WorkflowReportOptions; fontBytes: ReportFontBytes; createdAt?: Date; branding?: Partial<ReportBranding> | null; logoBytes?: Uint8Array | null; blank?: boolean;
  /** The sender box of a customer document (beslut 5); absent = no box. */
  sender?: KitSender | null;
  /** A mark after the code on the first page instead of the draft mark, e.g. the editor's preview (never on a saved document). */
  mark?: string;
  /** A project report whose protocols follow as their own PDFs (in the control's look) still counts every chosen task. */
  taskCount?: number;
  /** The company's hourly rate: the work in the total when "Visa priser" is chosen (report-server: workflowReportHourlyRate). */
  hourlyRate?: number | null;
  /** PDF-mallar (2026-11-03): the product owner's texts (lib/pdf-templates); absent = the defaults. */
  templates?: readonly PdfTemplateOverride[] | null }) {
  const identity = { company: input.company, branding: input.branding, logoBytes: input.logoBytes, sender: input.sender, templates: input.templates };
  const tasks = reportTasksWithoutReceipts(input.tasks, input.options);
  if (!input.projectName && tasks.length === 1 && tasks[0].data.kind === "FORM") {
    const { createFormProtocolPdf } = await import("./form-report");
    return createFormProtocolPdf({ identity, fontBytes: input.fontBytes, task: tasks[0], options: input.options, createdAt: input.createdAt, blank: input.blank, mark: input.mark });
  }
  const { createTaskReportPdf } = await import("./task-report");
  return createTaskReportPdf({ identity, fontBytes: input.fontBytes, tasks, projectComments: input.projectComments, options: input.options, createdAt: input.createdAt, title: input.title, projectName: input.projectName, projectFields: input.projectFields, taskCount: input.taskCount, hourlyRate: input.hourlyRate });
}
