"use client";

import { useSyncExternalStore } from "react";
import { Eye, FileDown, FileSpreadsheet, FileText } from "lucide-react";
import { defaultWorkflowReportOptions, type WorkflowReportOptions, type WorkflowReportSection } from "@/lib/workflow/report";
import type { WorkflowTaskKind } from "@/lib/workflow/task-model";
import { ExportMenu, type ExportFormat } from "./export-menu";

export type ProjectReportChoice = { id: string; kind: WorkflowTaskKind; title: string; status: string };

// Short names that fit one line in the Exportera window (2026-10-01: "strukturera och snygga till texten").
const labels: Record<WorkflowReportSection, string> = {
  summary: "Sammanfattning",
  time: "Tid",
  execution: "Utförande",
  materials: "Material och utgifter",
  deviations: "Avvikelser",
  risks: "Risker",
  riskMatrix: "Riskmatris",
  approval: "Signering",
  images: "Bilder",
  attachments: "Bilagor",
  prices: "Visa priser",
};

/** "Visa priser" (2026-10-09) is offered only to someone who may see prices, and is off until ticked. */
function relevantSections(kind: WorkflowTaskKind | undefined, prices: boolean) {
  if (kind === "FORM") return ["summary", "time", "execution", "deviations", "approval", "images", "attachments"] as WorkflowReportSection[];
  if (kind === "WORK_ORDER") return ["summary", "time", "execution", "materials", ...(prices ? ["prices"] : []), "deviations", "approval", "images", "attachments"] as WorkflowReportSection[];
  if (kind === "RISK_ASSESSMENT") return ["summary", "time", "risks", "riskMatrix", "execution", "approval", "images", "attachments"] as WorkflowReportSection[];
  return (Object.keys(labels) as WorkflowReportSection[]).filter((section) => prices || section !== "prices");
}

/**
 * The demo (2026-11-06) draws the PDF of a job or a control itself; Excel, the empty templates, the archive and the project
 * report need the server, so they stay grey with the reason. Read after hydration, so the server's render and the first one agree.
 */
const noSubscribe = () => () => undefined;
const inDemo = () => Boolean((window as typeof window & { __workflowDemo?: boolean }).__workflowDemo);
export const DEMO_REPORT_PDF_ONLY = "I demon finns rapporten som PDF. Excel och mallar finns i Workflow.";
export const DEMO_PROJECT_REPORT = "Projektrapporten finns i Workflow. I demon går det att ta ut PDF på en uppgift eller kontroll.";

/** A protocol's report can also be the empty form ("tom mall") or an Excel workbook, like the control (2026-09-27). */
export type ReportVariant = "pdf" | "blank" | "xlsx" | "xlsx-blank";

const kindLabel = (kind: ProjectReportChoice["kind"]) => kind === "WORK_ORDER" ? "Arbetsorder" : kind === "FORM" ? "Formulär" : "Riskbedömning";

/**
 * The report of a task or a project, in the shared Exportera window (2026-10-01): the parts to include, for a project
 * the tasks, and the formats – Förhandsgranska and PDF everywhere, a protocol also Excel and its empty templates.
 */
export function ReportOptionsButton({ kind, choices, disabled, onExport, preview = true, archivable, prices = false }: {
  /** The person may see prices: "Visa priser" is offered (off from the start); the server decides again. */
  prices?: boolean;
  kind?: WorkflowTaskKind; choices?: ProjectReportChoice[]; disabled?: boolean;
  /** `archive`: the person ticked "Spara i rapportarkivet" (only for PDF and Excel of the answers; never a preview or an empty template). */
  onExport: (options: WorkflowReportOptions, selected: ProjectReportChoice[], variant?: ReportVariant, show?: boolean, archive?: boolean) => void | Promise<void>;
  /** Whether Förhandsgranska is offered (opens the PDF in a new tab). */
  preview?: boolean;
  /** Offers "Spara i rapportarkivet" (2026-10-07): in Cloud, where the archive is kept. */
  archivable?: boolean;
}) {
  const demo = useSyncExternalStore(noSubscribe, inDemo, () => false);
  const sections = relevantSections(kind, prices);
  const optionsOf = (picked: Record<string, boolean>): WorkflowReportOptions => ({ ...defaultWorkflowReportOptions, ...Object.fromEntries(sections.map((section) => [section, picked[section] ?? defaultWorkflowReportOptions[section]])) });
  const chosen = (ids: string[]) => choices?.filter((choice) => ids.includes(choice.id)) ?? [];
  const offered: ExportFormat[] = [
    ...(preview && !choices ? [{ id: "preview", label: "Förhandsgranska", icon: Eye, run: ({ sections: picked, selected }) => onExport(optionsOf(picked), chosen(selected), "pdf", true) } satisfies ExportFormat] : []),
    { id: "pdf", label: "PDF", icon: FileDown, primary: true, run: ({ sections: picked, selected, archive }) => onExport(optionsOf(picked), chosen(selected), "pdf", false, archive) },
    ...(kind === "FORM" && !choices ? [
      { id: "xlsx", label: "Excel", icon: FileSpreadsheet, run: ({ sections: picked, archive }) => onExport(optionsOf(picked), [], "xlsx", false, archive) },
      { id: "blank", label: "PDF-mall", icon: FileText, ignoresSelection: true, run: ({ sections: picked }) => onExport(optionsOf(picked), [], "blank") },
      { id: "xlsx-blank", label: "Excel-mall", icon: FileSpreadsheet, ignoresSelection: true, run: ({ sections: picked }) => onExport(optionsOf(picked), [], "xlsx-blank") },
    ] satisfies ExportFormat[] : []),
  ];
  const formats = demo ? offered.map((format) => format.id === "preview" || (format.id === "pdf" && !choices) ? format : { ...format, disabled: true, hint: choices ? DEMO_PROJECT_REPORT : DEMO_REPORT_PDF_ONLY }) : offered;
  return <ExportMenu
    label={choices ? "Projektrapport" : "Exportera"}
    title={choices ? "Exportera projektrapport" : "Exportera rapport"}
    description={choices ? "Alla uppgifter är förvalda. Pågående uppgifter märks som utkast i rapporten." : "Rapporten innehåller de delar du väljer. Ett osparat utkast sparas först."}
    choices={choices?.map((choice) => ({ id: choice.id, title: choice.title, detail: `${kindLabel(choice.kind)} · ${choice.status === "COMPLETED" ? "Färdigställd" : "Utkast"}` }))}
    choicesLabel="Uppgifter"
    sections={sections.map((section) => ({ key: section, label: labels[section], defaultOn: defaultWorkflowReportOptions[section] }))}
    formats={formats}
    disabled={disabled}
    archivable={archivable && !demo}
    testId={choices ? "project-report-menu" : "report-menu"}
  />;
}
