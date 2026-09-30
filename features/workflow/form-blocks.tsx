"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { formApprovalTotals, formBand, formConditionMet, formOptionalSections, formSectionActive, type FormDocument, type FormEvaluation, type FormFieldBlock, type FormLeafBlock, type FormRequirement, type FormValues } from "@/lib/workflow/form-document";
import { ContextHelp } from "./context-help";
import { bandClass } from "./form-inputs";
import { indicatorBadge, indicatorText } from "./indicator-tone";

/**
 * The moments of a form (the control's Kontrollmoment, 2026-09-27): every section that can be switched on and
 * off, and the Ja/nej switches placed among them (Autobedömning), as tick cards exactly like the control's – with the
 * (i) that explains each moment. `bare` draws the cards without a heading, inside the form's first section.
 */
export function MomentsPanel({ document, values, onChange, readOnly, bare = false }: { document: FormDocument; values: FormValues; onChange: (values: FormValues) => void; readOnly: boolean; bare?: boolean }) {
  const sections = formOptionalSections(document).filter((section) => formConditionMet(document, values, section.showIf));
  const switches = document.blocks.flatMap((block) => block.type === "section" ? block.blocks : []).filter((block): block is FormFieldBlock => block.type === "field" && block.momentSwitch && block.input === "yesno");
  if (!sections.length && !switches.length) return null;
  const card = (key: string, index: number, label: string, help: string, checked: boolean, toggle: (checked: boolean) => void) =>
    <div key={key} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5", checked ? "border-primary/25 bg-secondary" : "bg-background")}>
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
        <Checkbox checked={checked} disabled={readOnly} onCheckedChange={(value) => toggle(value === true)} />
        <span className="text-xs font-medium">{label}</span>
      </label>
      {help ? <ContextHelp label={label} text={help} align={index < 2 ? "left" : "right"} /> : null}
    </div>;
  const cards = [
    ...sections.map((section, index) => card(`moment-${section.id}`, index, section.title || "Avsnitt", section.help || section.description, formSectionActive(section, values), (checked) => onChange({ ...values, sections: { ...values.sections, [section.id]: checked } }))),
    ...switches.map((field, index) => card(`moment-${field.id}`, sections.length + index, field.label, field.help, values.fields[field.key] === "YES", (checked) => onChange({ ...values, fields: { ...values.fields, [field.key]: checked ? "YES" : "NO" } }))),
  ];
  const label = document.moments.label || "Moment";
  const grid = <div className="control-moments grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-label={label}>{cards}</div>;
  if (bare) return <section aria-label={label} className="mt-4" data-testid="form-moments">{grid}</section>;
  return <section aria-label={label} className="space-y-2" data-testid="form-moments">
    <h3 className="text-sm font-semibold">{label}{document.moments.requireOne ? <span className="ml-2 text-xs font-normal text-muted-foreground">Välj minst ett</span> : null}</h3>
    {grid}
  </section>;
}

/** Tick boxes, two by two exactly like the control's Visuell kontroll: ticked is OK, unticked after a tick is not OK. */
export function CheckChecklist({ block, values, onChange, readOnly, label, quietLabel = false }: { block: Extract<FormLeafBlock, { type: "checklist" }>; values: FormValues; onChange: (values: FormValues) => void; readOnly: boolean; label: React.ReactNode; quietLabel?: boolean }) {
  const answers = values.checklists[block.key] ?? {};
  return <fieldset id={`form-${block.id}`} className="min-w-0"><legend className={cn("mb-2 text-sm font-semibold", quietLabel && "sr-only")}>{label}</legend>
    {block.help && !quietLabel ? <p className="mb-3 text-xs text-muted-foreground">{block.help}</p> : null}
    <div className="grid gap-4 sm:grid-cols-2">{block.items.map((item) => {
      const state = answers[item.id]?.state ?? null;
      return <label key={item.id} className="flex items-center gap-3 py-1.5 text-sm">
        <Checkbox checked={state === "OK"} disabled={readOnly} onCheckedChange={(checked) => onChange({ ...values, checklists: { ...values.checklists, [block.key]: { ...answers, [item.id]: { state: checked === true ? "OK" : "NOT_OK", comment: answers[item.id]?.comment ?? "" } } } })} />
        <span className={cn(state === "NOT_OK" && indicatorText("danger"))}>{item.text}</span>
      </label>;
    })}</div>
  </fieldset>;
}

export type FormCompletionSummary = { requirements: FormRequirement[]; issues: FormRequirement[]; ready: boolean; percent: number; warnings?: string[] };

/**
 * Sammanfattning exactly like the control's (2026-09-27): approved per moment as pills ("Isolation: 3/4"), the
 * completion card with the requirements left, then the comment – where the author placed it. The form then shows no
 * separate deviation box at the end.
 */
export function SummaryBlock({ block, document, values, evaluation, completion, onChange, readOnly, label, quietLabel = false }: {
  block: Extract<FormLeafBlock, { type: "summary" }>; document?: FormDocument; values: FormValues; evaluation: FormEvaluation; completion?: FormCompletionSummary; onChange: (values: FormValues) => void; readOnly: boolean; label: React.ReactNode; quietLabel?: boolean;
}) {
  const totals = document ? formApprovalTotals(document, values, evaluation) : [];
  const others = evaluation.deviations.filter((item) => item.kind !== "assessment");
  const deviating = evaluation.deviations.length > 0;
  return <section aria-label={block.label} className="space-y-4" data-testid="form-summary">
    <h3 className={cn("text-sm font-semibold", quietLabel && "sr-only")}>{label}</h3>
    {totals.length ? <div className="flex flex-wrap gap-2">{totals.map((item) => <span key={item.blockId} className={cn("rounded-full px-3 py-1 text-xs font-medium", item.total && item.total === item.ok ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800")}>{item.title}: {item.ok}/{item.total}</span>)}</div> : null}
    {completion ? <CompletionCard completion={completion} /> : null}
    {others.length ? <div className={cn("space-y-1 rounded-lg border p-3 text-sm", indicatorBadge("danger"))}><p className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-4" />{others.length === 1 ? "1 avvikelse" : `${others.length} avvikelser`}</p><ul className="list-disc pl-5">{others.map((item) => <li key={`${item.blockId}-${item.rowId ?? ""}-${item.message}`}>{item.message}</li>)}</ul></div> : null}
    <label htmlFor="form-deviations" className="sr-only">{block.label} / kommentarer</label>
    <textarea id="form-deviations" className="form-textarea min-h-40" value={values.deviationComment} disabled={readOnly} placeholder={deviating ? "Beskriv avvikelserna och vad som görs åt dem." : undefined} onChange={(event) => onChange({ ...values, deviationComment: event.target.value })} />
    {deviating ? <p className="text-xs text-muted-foreground">Kommentaren krävs vid avvikelser.</p> : null}
  </section>;
}

/** "Redo att färdigställa": requirements met, the percentage, a bar and the details on request – the control's completion card. */
function CompletionCard({ completion }: { completion: FormCompletionSummary }) {
  const [expanded, setExpanded] = useState(false);
  const done = completion.requirements.length - completion.issues.length;
  const warnings = completion.warnings ?? [];
  return <div className="completion-card rounded-xl border bg-muted/30 p-4" data-testid="form-completion">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-sm font-medium">Redo att färdigställa</p>
        <p className="mt-1 text-xs text-muted-foreground">{done} av {completion.requirements.length} krav uppfyllda{!completion.ready && ` · ${completion.issues.length} återstår`}.</p>
      </div>
      <span className={cn("rounded-full px-3 py-1 text-xs font-semibold", completion.ready ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800")}>{completion.ready ? 100 : completion.percent}%</span>
    </div>
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary"><div className={cn("h-full rounded-full", completion.ready ? "bg-emerald-600" : "bg-amber-500")} style={{ width: `${completion.ready ? 100 : completion.percent}%` }} /></div>
    {completion.issues.length || warnings.length ? <Button type="button" variant="ghost" size="sm" className="mt-2 -ml-2" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}><ChevronDown className={expanded ? "rotate-180" : ""} />{expanded ? "Dölj detaljer" : "Visa detaljer"}</Button> : null}
    {expanded && completion.issues.length ? <div className="mt-4 text-sm text-destructive">
      <p className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4" />Måste kompletteras</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">{completion.issues.slice(0, 6).map((issue) => <li key={`${issue.blockId}:${issue.message}`}>{issue.message}</li>)}</ul>
      {completion.issues.length > 6 ? <p className="mt-2 text-xs">Ytterligare {completion.issues.length - 6} uppgifter saknas.</p> : null}
    </div> : null}
    {expanded && warnings.length ? <div className="mt-4 text-sm text-amber-800 dark:text-amber-300"><p className="font-medium">Bra att kontrollera</p><ul className="mt-2 list-disc space-y-1 pl-5 text-xs">{warnings.slice(0, 4).map((warning) => <li key={warning}>{warning}</li>)}</ul></div> : null}
  </div>;
}

const NUMBERED = /^\d+\s*[–-]\s+/;

/**
 * Infokort: a heading and a text – folded until opened (the control's Stöd vid bedömning), an open card whose numbered
 * lines become a list with circled numbers (the risk assessment's scales), or a notice line ("Så bedöms risken: …").
 */
export function NoteBlock({ block, label }: { block: Extract<FormLeafBlock, { type: "note" }>; label?: React.ReactNode }) {
  const lines = block.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (block.style === "notice") return <div className="notice" data-testid="form-note"><strong>{label ?? block.title}:</strong> {block.text}</div>;
  if (block.style === "card") {
    const listed = lines.length > 0 && lines.every((line) => NUMBERED.test(line));
    return <div className="h-full rounded-xl border bg-muted/20 p-4" data-testid="form-note">
      <h3 className="text-sm font-semibold">{label ?? block.title}</h3>
      {listed ? <ol className="mt-3 space-y-2">{lines.map((line, index) => <li key={index} className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"><span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-card font-semibold text-foreground ring-1 ring-border">{index + 1}</span>{line.replace(NUMBERED, "")}</li>)}</ol>
        : <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{block.text}</p>}
    </div>;
  }
  return <details className="group rounded-xl border bg-card" data-testid="form-note">
    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm font-semibold"><span className="h-5 w-1 rounded-full bg-primary" aria-hidden="true" /><span className="min-w-0 flex-1">{label ?? block.title}</span><ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" /></summary>
    <p className="whitespace-pre-wrap border-t px-4 py-3 text-xs leading-5 text-muted-foreground">{block.text}</p>
  </details>;
}

/** Riskmatris: the products of the two scales, coloured by the levels, with the levels below – the risk assessment's own. */
export function MatrixBlock({ block, label }: { block: Extract<FormLeafBlock, { type: "matrix" }>; label?: React.ReactNode }) {
  const steps = Array.from({ length: block.size }, (_, index) => index + 1);
  const legend = [...block.bands].sort((a, b) => a.from - b.from).filter((band) => band.label);
  return <div className="w-fit max-w-full rounded-xl border bg-card p-4" data-testid="form-matrix">
    <h3 className="text-sm font-semibold">{label ?? block.label}</h3>
    <p className="mt-1 text-[11px] text-muted-foreground">{block.yLabel} lodrätt · {block.xLabel.toLowerCase()} vågrätt</p>
    <div className="mt-3 grid w-fit gap-1 text-center text-[11px]" style={{ gridTemplateColumns: `1.25rem repeat(${block.size}, 2.15rem)` }} role="img" aria-label={`${block.label}: ${block.yLabel} gånger ${block.xLabel.toLowerCase()}`}>
      <span />{steps.map((x) => <span key={`x-${x}`} className="py-0.5">{x}</span>)}
      {[...steps].reverse().flatMap((y) => [<span key={`y-${y}`} className="flex items-center justify-center font-medium">{y}</span>, ...steps.map((x) => <span key={`${x}-${y}`} className={cn("flex size-[2.15rem] items-center justify-center rounded border font-semibold", bandClass(formBand(block.bands, x * y)))} title={`${formBand(block.bands, x * y)?.label ?? ""}: ${x * y}`}>{x * y}</span>)])}
    </div>
    {legend.length ? <div className="mt-3 flex flex-wrap gap-1.5">{legend.map((band) => <span key={band.label} className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", bandClass(band))}>{band.label}</span>)}</div> : null}
  </div>;
}
