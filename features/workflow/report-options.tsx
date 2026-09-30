"use client";

import { useMemo, useState } from "react";
import { FileText } from "lucide-react";
import { Popover } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { defaultWorkflowReportOptions, type WorkflowReportOptions, type WorkflowReportSection } from "@/lib/workflow/report";
import type { WorkflowTaskKind } from "@/lib/workflow/task-model";

export type ProjectReportChoice = { id: string; kind: WorkflowTaskKind | "COMMISSIONING_CONTROL"; title: string; status: string };

const labels: Record<WorkflowReportSection, string> = {
  summary: "Sammanfattning och grunduppgifter",
  time: "Tidrapportering",
  execution: "Utförande och åtgärder",
  materials: "Material",
  deviations: "Avvikelser och avslut",
  risks: "Identifierade risker",
  riskMatrix: "Riskmatris 5 × 5",
  approval: "Signering och godkännande",
  images: "Bilder",
  attachments: "Bilagelista",
};

function relevantSections(kind?: WorkflowTaskKind) {
  if (kind === "FORM") return ["summary", "time", "execution", "deviations", "approval", "images", "attachments"] as WorkflowReportSection[];
  if (kind === "WORK_ORDER") return ["summary", "time", "execution", "materials", "deviations", "approval", "images", "attachments"] as WorkflowReportSection[];
  if (kind === "RISK_ASSESSMENT") return ["summary", "time", "risks", "riskMatrix", "execution", "approval", "images", "attachments"] as WorkflowReportSection[];
  return Object.keys(labels) as WorkflowReportSection[];
}

/** A protocol's report can also be the empty form ("tom mall") or an Excel workbook, like the control (2026-09-27). */
export type ReportVariant = "pdf" | "blank" | "xlsx" | "xlsx-blank";

export function ReportOptionsButton({ kind, choices, disabled, onExport }: { kind?: WorkflowTaskKind; choices?: ProjectReportChoice[]; disabled?: boolean; onExport: (options: WorkflowReportOptions, selected: ProjectReportChoice[], variant?: ReportVariant) => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState(defaultWorkflowReportOptions);
  const [selectedIds, setSelectedIds] = useState(() => new Set(choices?.map((choice) => choice.id) ?? []));
  const sections = relevantSections(kind);
  const selected = useMemo(() => choices?.filter((choice) => selectedIds.has(choice.id)) ?? [], [choices, selectedIds]);
  const canExport = sections.some((section) => options[section]) && (!choices || selected.length > 0);
  const toggleChoice = (id: string, checked: boolean) => setSelectedIds((current) => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next; });
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild>
      <Button type="button" variant="outline" disabled={disabled} onPointerEnter={() => !disabled && setOpen(true)}><FileText />{choices ? "Skapa projektrapport" : "Exportera PDF"}</Button>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content align="end" sideOffset={8} className="z-50 w-[min(22rem,calc(100vw-2rem))] rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg" onPointerEnter={() => setOpen(true)}>
        <Popover.Arrow className="fill-border" />
        <p className="text-sm font-semibold">{choices ? "Projektrapport" : "Välj innehåll"}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{choices ? "Alla uppgifter är förvalda. Pågående uppgifter märks som utkast." : "Rapporten innehåller bara de delar du väljer."}</p>
        {choices && <fieldset className="mt-4"><legend className="text-xs font-semibold">Uppgifter</legend><div className="mt-2 max-h-40 space-y-2 overflow-y-auto pr-1">{choices.map((choice) => <label key={`${choice.kind}-${choice.id}`} className="flex items-start gap-2 rounded-lg border p-2.5 text-xs"><Checkbox checked={selectedIds.has(choice.id)} onCheckedChange={(checked) => toggleChoice(choice.id, checked === true)} /><span className="min-w-0"><span className="block truncate font-medium">{choice.title}</span><span className="mt-0.5 block text-muted-foreground">{choice.kind === "COMMISSIONING_CONTROL" ? "Kontroll före idrifttagning" : choice.kind === "WORK_ORDER" ? "Arbetsorder" : choice.kind === "FORM" ? "Formulär" : "Riskbedömning"} · {choice.status === "COMPLETED" ? "Slutförd" : "Utkast"}</span></span></label>)}</div></fieldset>}
        <fieldset className="mt-4"><legend className="text-xs font-semibold">Innehåll</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{sections.map((section) => <label key={section} className="flex items-start gap-2 text-xs leading-5"><Checkbox checked={options[section]} onCheckedChange={(checked) => setOptions((current) => ({ ...current, [section]: checked === true }))} /><span>{labels[section]}</span></label>)}</div></fieldset>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {kind === "FORM" && !choices ? (["blank", "xlsx"] as const).map((variant) => <Button key={variant} type="button" variant="outline" disabled={busy} onClick={async () => { setBusy(true); try { await onExport(options, selected, variant); setOpen(false); } finally { setBusy(false); } }}>{variant === "blank" ? "Tom mall (PDF)" : "Excel"}</Button>) : null}
          <Button type="button" disabled={busy || !canExport} onClick={async () => { setBusy(true); try { await onExport(options, selected, "pdf"); setOpen(false); } finally { setBusy(false); } }}>{busy ? "Skapar…" : "PDF"}</Button>
        </div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
