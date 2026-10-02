"use client";

import { Eye, FileDown, FileSpreadsheet, FileText } from "lucide-react";
import { defaultWorkflowReportOptions, type WorkflowReportOptions, type WorkflowReportSection } from "@/lib/workflow/report";
import type { WorkflowTaskKind } from "@/lib/workflow/task-model";
import { ExportMenu, type ExportFormat } from "./export-menu";

export type ProjectReportChoice = { id: string; kind: WorkflowTaskKind | "COMMISSIONING_CONTROL"; title: string; status: string };

// Short names that fit one line in the Exportera window (2026-10-01: "strukturera och snygga till texten").
const labels: Record<WorkflowReportSection, string> = {
  summary: "Sammanfattning",
  time: "Tid",
  execution: "Utförande",
  materials: "Material",
  deviations: "Avvikelser",
  risks: "Risker",
  riskMatrix: "Riskmatris",
  approval: "Signering",
  images: "Bilder",
  attachments: "Bilagor",
};

function relevantSections(kind?: WorkflowTaskKind) {
  if (kind === "FORM") return ["summary", "time", "execution", "deviations", "approval", "images", "attachments"] as WorkflowReportSection[];
  if (kind === "WORK_ORDER") return ["summary", "time", "execution", "materials", "deviations", "approval", "images", "attachments"] as WorkflowReportSection[];
  if (kind === "RISK_ASSESSMENT") return ["summary", "time", "risks", "riskMatrix", "execution", "approval", "images", "attachments"] as WorkflowReportSection[];
  return Object.keys(labels) as WorkflowReportSection[];
}

/** A protocol's report can also be the empty form ("tom mall") or an Excel workbook, like the control (2026-09-27). */
export type ReportVariant = "pdf" | "blank" | "xlsx" | "xlsx-blank";

const kindLabel = (kind: ProjectReportChoice["kind"]) => kind === "COMMISSIONING_CONTROL" ? "Kontroll före idrifttagning" : kind === "WORK_ORDER" ? "Arbetsorder" : kind === "FORM" ? "Formulär" : "Riskbedömning";

/**
 * The report of a task or a project, in the shared Exportera window (2026-10-01): the parts to include, for a project
 * the tasks, and the formats – Förhandsgranska and PDF everywhere, a protocol also Excel and its empty templates.
 */
export function ReportOptionsButton({ kind, choices, disabled, onExport, preview = true }: {
  kind?: WorkflowTaskKind; choices?: ProjectReportChoice[]; disabled?: boolean;
  onExport: (options: WorkflowReportOptions, selected: ProjectReportChoice[], variant?: ReportVariant, show?: boolean) => void | Promise<void>;
  /** Whether Förhandsgranska is offered (opens the PDF in a new tab). */
  preview?: boolean;
}) {
  const sections = relevantSections(kind);
  const optionsOf = (picked: Record<string, boolean>): WorkflowReportOptions => ({ ...defaultWorkflowReportOptions, ...Object.fromEntries(sections.map((section) => [section, picked[section] ?? true])) });
  const chosen = (ids: string[]) => choices?.filter((choice) => ids.includes(choice.id)) ?? [];
  const formats: ExportFormat[] = [
    ...(preview && !choices ? [{ id: "preview", label: "Förhandsgranska", icon: Eye, run: ({ sections: picked, selected }) => onExport(optionsOf(picked), chosen(selected), "pdf", true) } satisfies ExportFormat] : []),
    { id: "pdf", label: "PDF", icon: FileDown, primary: true, run: ({ sections: picked, selected }) => onExport(optionsOf(picked), chosen(selected), "pdf") },
    ...(kind === "FORM" && !choices ? [
      { id: "xlsx", label: "Excel", icon: FileSpreadsheet, run: ({ sections: picked }) => onExport(optionsOf(picked), [], "xlsx") },
      { id: "blank", label: "PDF-mall", icon: FileText, ignoresSelection: true, run: ({ sections: picked }) => onExport(optionsOf(picked), [], "blank") },
      { id: "xlsx-blank", label: "Excel-mall", icon: FileSpreadsheet, ignoresSelection: true, run: ({ sections: picked }) => onExport(optionsOf(picked), [], "xlsx-blank") },
    ] satisfies ExportFormat[] : []),
  ];
  return <ExportMenu
    label={choices ? "Projektrapport" : "Exportera"}
    title={choices ? "Exportera projektrapport" : "Exportera rapport"}
    description={choices ? "Alla uppgifter är förvalda. Pågående uppgifter märks som utkast i rapporten." : "Rapporten innehåller de delar du väljer. Ett osparat utkast sparas först."}
    choices={choices?.map((choice) => ({ id: choice.id, title: choice.title, detail: `${kindLabel(choice.kind)} · ${choice.status === "COMPLETED" ? "Slutförd" : "Utkast"}` }))}
    choicesLabel="Uppgifter"
    sections={sections.map((section) => ({ key: section, label: labels[section] }))}
    formats={formats}
    disabled={disabled}
    testId={choices ? "project-report-menu" : "report-menu"}
  />;
}
