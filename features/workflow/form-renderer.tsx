"use client";

import { Fragment, useMemo, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, ClipboardList, ImagePlus, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/features/kfid/ui";
import { cn } from "@/lib/utils";
import { balancedFormWidths, evaluateForm, formBand, formBlockVisible, formBlockWidth, formCompletion, formConditionMet, formLeafBlocks, formLimitFor, formLimitLevel, formRuleSummary, formSummaryMaterial, formSectionShown, type FormBlock, type FormDocument, type FormEvaluation, type FormLeafBlock, type FormSection, type FormValues, type FormWidth } from "@/lib/workflow/form-document";
import { formatResultValue } from "@/lib/workflow/form-formula";
import type { FormPrefill } from "@/lib/workflow/form-prefill";
import { CheckChecklist, MatrixBlock, MomentsPanel, NoteBlock, SummaryBlock, type FormCompletionSummary } from "./form-blocks";
import { AssessmentChecklist } from "./form-checklist";
import { bandClass, FieldRemark, ImagePicker, LimitHint, SignatureBlock, YesNo, type FormAttachment, type FormMedia } from "./form-inputs";
import { addExampleRow, addTableRow, FormTable, tableHasExample, tableItemName, tableScreenLayout, type FormRowOptions } from "./form-table";
import { clientExtensions } from "@ee/client";
import { indicatorBadge, indicatorText } from "./indicator-tone";

const { SummaryAssist } = clientExtensions;

export type { FormMedia } from "./form-inputs";
export type { FormRowOptions } from "./form-table";

/**
 * The form grid (2026-09-26): the real 12-column widths from a form width of 32rem, one column on a phone, measured on the
 * form's own width. Classes are written out so Tailwind finds them.
 */
export const FORM_GRID = "grid grid-cols-12 gap-x-4 gap-y-4";
export const FORM_SPAN_CLASS: Record<FormWidth, string> = {
  quarter: "col-span-12 @lg:col-span-3",
  third: "col-span-12 @lg:col-span-4",
  half: "col-span-12 @lg:col-span-6",
  two_thirds: "col-span-12 @lg:col-span-8",
  three_quarters: "col-span-12 @lg:col-span-9",
  full: "col-span-12",
};

/**
 * The task's own basic data drawn inside the form's first section (2026-09-27, the control's Grunduppgifter):
 * the project choice on top, the place after the fields, and controls beside the fields that start from the task (the
 * customer picker beside Kontaktperson).
 */
export type FormTaskInline = {
  top?: ReactNode; after?: ReactNode; beside?: Partial<Record<FormPrefill, ReactNode>>;
  /** The task's Bilder och dokument, drawn before the section with the summary like the control's (2026-09-28). */
  beforeSummary?: ReactNode;
  /** The control's Historik and Färdigställ at the foot of the summary's panel. */
  summaryFooter?: ReactNode;
};

/** Whether a section holds the form's own summary shown in the task – the control's Sammanfattning. */
export const sectionHasSummary = (section: FormSection) => section.blocks.some((block) => block.type === "summary" && formBlockVisible(block, "task"));

type LeafProps = {
  values: FormValues; evaluation: FormEvaluation; onChange: (values: FormValues) => void; readOnly?: boolean; attachments?: FormAttachment[]; media?: FormMedia;
  document?: FormDocument; rowOptions?: FormRowOptions; completion?: FormCompletionSummary;
  /** The section's heading: a table, checklist or summary with the same name is not titled twice, like in the PDF. */
  sectionTitle?: string;
  /** The block's heading and actions belong to the section's panel (the control's measurement panels). */
  quiet?: boolean;
  chrome?: "panel";
  /** Whether required fields carry an asterisk. */
  marks?: boolean;
  actions?: FormActions;
};

/** A work order made from a deviation (2026-09-28): returns the new work order's id, or null when nothing was made. */
export type FormActions = { createWorkOrder?: (input: { title: string; description: string }) => Promise<string | null>; openWorkOrder?: (id: string) => void;
  /** The state of a row's work order (2026-09-30), shown on the row: "Arbetsorder: Slutförd". */
  workOrderStatus?: (id: string) => { status: string; label: string } | undefined };

/** The block a section is about – named like the section, or its only table, checklist or summary. Its heading is the panel's. */
export function sectionMainBlock(section: FormSection): FormLeafBlock | null {
  const leaves = section.blocks.filter((block) => block.type !== "pagebreak" && block.type !== "images" && formBlockVisible(block, "task") && !(block.type === "field" && block.momentSwitch && block.input === "yesno"));
  const named = leaves.find((block) => "label" in block && (block.label === section.title || (section.taskTitle && block.label === section.taskTitle)));
  if (named) return named;
  return leaves.length === 1 && ["table", "checklist", "summary"].includes(leaves[0].type) ? leaves[0] : null;
}

/**
 * Draws a form from its document and answers (2026-09-26, design v2): the same renderer for a protocol, the
 * builder's preview and "Testa". Formulas are computed by the shared engine while typing; text is shown as text.
 * Every input has the id `form-<blockId>` so the completion guidance can move focus to it. Sections that can be switched
 * off are chosen at the top and hidden while off; folded sections open on a click (2026-09-27).
 *
 * With `panels` every section is one of Workflow's panels with the light blue header, exactly like the original editors
 * (2026-09-27): the block a section is about lends it its heading, description and actions – add row with the
 * count and the section's picture for measurement rows, "Lägg till …" for object cards, "Sammanställ resultat" for the
 * summary – and the moments can sit inside the first section, like the control's Kontrollmoment.
 */
export function FormRenderer({ document, values, onChange, readOnly = false, attachments = [], media, rowOptions, panels = false, inline, title, actions }: {
  document: FormDocument; values: FormValues; onChange: (values: FormValues) => void; readOnly?: boolean; attachments?: FormAttachment[]; media?: FormMedia; rowOptions?: FormRowOptions; panels?: boolean; inline?: FormTaskInline;
  /** What the protocol can do outside the form: make a work order of a deviation row (2026-09-28). */
  actions?: FormActions;
  /** The panel heading for blocks outside any section (a schema 1 form): the form's name. */
  title?: string;
}) {
  const evaluation = useMemo(() => evaluateForm(document, values), [document, values]);
  const completion = useMemo(() => panels ? formCompletion(document, values) : undefined, [panels, document, values]);
  const marks = document.task.requiredMarks;
  const leafProps: LeafProps = { values, evaluation, onChange, readOnly, attachments, media, document, rowOptions, completion, marks, actions };
  const leaf = (block: FormLeafBlock, sectionTitle?: string, quiet = false, chrome?: "panel") => <FormLeaf block={block} {...leafProps} sectionTitle={sectionTitle} quiet={quiet} chrome={chrome} />;
  // Schema 2: blocks flow in the 12-column grid measured on the form's own width, so a narrow preview stacks like a phone.
  // A Ja/nej placed among the moments is drawn there, not again in its section.
  const grid = (blocks: FormLeafBlock[], key: string, sectionTitle?: string, quietId: string | null = null, chromeId: string | null = null, beside?: FormTaskInline["beside"], skip: string[] = []) => {
    const shown = blocks.filter((block) => block.type !== "pagebreak" && formBlockVisible(block, "task") && !(block.type === "field" && block.momentSwitch && block.input === "yesno") && !skip.includes(block.id) && (!("showIf" in block) || formConditionMet(document, values, block.showIf)));
    const widths = balancedFormWidths(shown.map((block) => ({ width: formBlockWidth(block), field: block.type === "field" || block.type === "computed" })));
    return shown.length ? <div key={key} className={FORM_GRID}>{shown.map((block, index) => {
      const extra = block.type === "field" && block.prefill !== "none" ? beside?.[block.prefill] : null;
      const content = leaf(block, sectionTitle, quietId === block.id, chromeId === block.id ? "panel" : undefined);
      return <div key={block.id} className={cn("min-w-0", FORM_SPAN_CLASS[widths[index]], block.type === "matrix" && block.tall && "@lg:row-span-2", (block.type === "matrix" || block.type === "note") && "self-start", block.type === "computed" && "@lg:self-end")}>
        {extra ? <div className="flex items-end gap-1"><div className="min-w-0 flex-1">{content}</div>{extra}</div> : content}
      </div>;
    })}</div> : null;
  };
  // Consecutive top-level blocks of a schema 1 form share one grid; column rows keep their own columns.
  const groups: (FormBlock | FormLeafBlock[])[] = [];
  for (const block of document.blocks) {
    if (block.type === "columns" || block.type === "section") groups.push(block);
    else if (Array.isArray(groups.at(-1))) (groups.at(-1) as FormLeafBlock[]).push(block);
    else groups.push([block]);
  }
  const firstSection = document.blocks.find((block): block is FormSection => block.type === "section");
  const momentsInside = document.moments.placement === "firstSection" && Boolean(firstSection);
  const moments = <MomentsPanel document={document} values={values} onChange={onChange} readOnly={readOnly} bare={momentsInside} />;
  const renderGroup = (group: FormBlock | FormLeafBlock[], index: number) => {
    if (Array.isArray(group)) return panels ? <Panel key={`group-${index}`} title={title || document.report.title || "Formulär"}>{grid(group, `group-${index}`)}</Panel> : grid(group, `group-${index}`);
    if (group.type === "columns") return <div key={group.id} className={cn("grid gap-4", group.columns.length === 3 ? "@2xl:grid-cols-3" : "@xl:grid-cols-2")}>{group.columns.map((column, columnIndex) => <div key={columnIndex} className="grid min-w-0 content-start gap-4">{column.filter((block) => formBlockVisible(block, "task")).map((block) => <div key={block.id}>{leaf(block)}</div>)}</div>)}</div>;
    if (group.type === "section") {
      if (!formSectionShown(document, group, values)) return null;
      const first = group.id === firstSection?.id;
      if (panels) {
        const summary = sectionHasSummary(group);
        const panel = <SectionPanel key={group.id} section={group} first={first} inline={inline} moments={momentsInside && first ? moments : null} grid={grid} leafProps={leafProps} footer={summary ? inline?.summaryFooter : undefined} />;
        return summary && inline?.beforeSummary ? <Fragment key={group.id}>{inline.beforeSummary}{panel}</Fragment> : panel;
      }
      const content = grid(group.blocks, group.id, group.title);
      if (!content) return null;
      if (!group.title && !group.description) return content;
      if (group.collapsed) return <details key={group.id} className="group rounded-xl border bg-card" data-testid="form-section-folded">
        <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3"><span className="min-w-0 flex-1"><span className="block text-base font-semibold tracking-tight">{group.taskTitle || group.title}</span>{group.description ? <span className="mt-0.5 block text-xs text-muted-foreground">{group.description}</span> : null}</span><ChevronDown className="mt-1 size-4 text-muted-foreground transition-transform group-open:rotate-180" /></summary>
        <div className="border-t p-4">{content}</div>
      </details>;
      return <section key={group.id} aria-label={group.title || undefined} className="space-y-4">
        {group.title ? <h3 className="border-b pb-2 text-base font-semibold tracking-tight">{group.taskTitle || group.title}</h3> : null}
        {group.description ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{group.description}</p> : null}
        {content}
      </section>;
    }
    return <div key={group.id}>{leaf(group)}</div>;
  };
  // A form with its own Sammanfattning shows the deviations there; otherwise they are listed at the end.
  const ownSummary = formLeafBlocks(document).some((block) => block.type === "summary" && formBlockVisible(block, "task"));
  const alertsOnly = !evaluation.deviations.length && evaluation.alerts.length && !ownSummary ? <section aria-label="Varningar" className={cn("space-y-1 rounded-xl border p-4 text-sm", indicatorBadge("warning"))} data-testid="form-alerts"><p className="font-semibold">{evaluation.alerts.length === 1 ? "1 varning" : `${evaluation.alerts.length} varningar`}</p><ul className="list-disc space-y-1 pl-5">{evaluation.alerts.map((item) => <li key={`${item.blockId}-${item.rowId ?? ""}-${item.column ?? ""}`}>{item.message}</li>)}</ul></section> : null;
  const deviations = evaluation.deviations.length && !ownSummary ? <section aria-label="Avvikelser" className={cn("space-y-2 rounded-xl border p-4", indicatorBadge("danger"))} data-testid="form-deviations">
    <p className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="size-4" />{evaluation.deviations.length === 1 ? "1 avvikelse" : `${evaluation.deviations.length} avvikelser`}</p>
    <ul className="list-disc space-y-1 pl-5 text-sm">{evaluation.deviations.map((item) => <li key={`${item.blockId}-${item.rowId ?? ""}-${item.message}`}>{item.message}</li>)}</ul>
    {evaluation.alerts.length ? <ul className={cn("list-disc space-y-1 pl-5 text-sm", indicatorText("warning"))}>{evaluation.alerts.map((item) => <li key={`${item.blockId}-${item.rowId ?? ""}-${item.column ?? ""}`}>Varning: {item.message}</li>)}</ul> : null}
    <label className="block space-y-1.5 text-xs font-medium">Kommentar till avvikelserna (krävs för att slutföra)<textarea id="form-deviations" className="form-textarea bg-card" value={values.deviationComment} disabled={readOnly} onChange={(event) => onChange({ ...values, deviationComment: event.target.value })} /></label>
  </section> : null;

  return <div className="@container space-y-6" data-testid="form-renderer">
    {!momentsInside ? (panels && (document.blocks.some((block) => block.type === "section" && block.optional)) ? <Panel title={document.moments.label || "Moment"} description={document.moments.requireOne ? "Välj minst ett." : undefined}><MomentsPanel document={document} values={values} onChange={onChange} readOnly={readOnly} bare /></Panel> : moments) : null}
    {groups.map(renderGroup)}
    {!formLeafBlocks(document).length ? <p className="text-sm text-muted-foreground">Formuläret har inget innehåll ännu.</p> : null}
    {deviations ? (panels ? <Panel title="Avvikelser">{deviations}</Panel> : deviations) : null}
    {alertsOnly ? (panels ? <Panel title="Varningar">{alertsOnly}</Panel> : alertsOnly) : null}
    {evaluation.warnings.length ? <p className="text-xs text-muted-foreground">{evaluation.warnings.join(" ")}</p> : null}
  </div>;
}

/**
 * What a section's panel is made of (the task and the builder's sheet draw the same thing, 2026-10-01): the
 * block the section is about, whether it is measurement rows or object cards, the moment's picture block that becomes
 * the round button in the header, and the panel's title and description.
 */
export function sectionPanelChrome(section: FormSection, values: FormValues) {
  const main = sectionMainBlock(section);
  const rowsTable = main?.type === "table" && tableScreenLayout(main) === "rows" ? main : null;
  const cardsTable = main?.type === "table" && tableScreenLayout(main) === "cards" ? main : null;
  // A moment's picture block (printed after the protocol) is not a block in the task: a measurement panel takes it from
  // the round picture button in its header, like the control's; other moments leave pictures to Bilder och dokument.
  const sectionImages = section.optional ? section.blocks.find((block): block is Extract<FormLeafBlock, { type: "images" }> => block.type === "images" && !block.pdfInline && formBlockVisible(block, "task")) : undefined;
  const rows = rowsTable ? values.tables[rowsTable.key] ?? [] : [];
  const description = rowsTable ? undefined : section.description || (main && "help" in main ? main.help : "") || undefined;
  const title = section.taskTitle || section.title || (main && "label" in main ? main.label : "") || "Avsnitt";
  // The panel carries the heading of the block the section is about and, for measurement rows, object cards and the
  // summary, its actions too; a plain table keeps its own add button under the rows.
  const chromed = rowsTable ?? cardsTable ?? (main?.type === "summary" ? main : null);
  return { main, rowsTable, cardsTable, sectionImages, rows, description, title, chromed };
}

/**
 * One section as a Workflow panel, exactly like the original editors: the light blue header with the title and
 * description, the actions of the block the section is about, and the content – with the task's own controls and the
 * moments inside the first section when the form says so.
 */
function SectionPanel({ section, first, inline, moments, grid, leafProps, footer }: {
  section: FormSection; first: boolean; inline?: FormTaskInline; moments: ReactNode;
  grid: (blocks: FormLeafBlock[], key: string, sectionTitle?: string, quietId?: string | null, chromeId?: string | null, beside?: FormTaskInline["beside"], skip?: string[]) => ReactNode;
  leafProps: LeafProps;
  /** Drawn after the content inside the panel (the control's Historik and Färdigställ under the summary). */
  footer?: ReactNode;
}) {
  const { values, onChange, readOnly, media, rowOptions, document } = leafProps;
  const chrome = sectionPanelChrome(section, values);
  const { main, rowsTable, cardsTable, sectionImages, rows, description, title, chromed } = chrome;
  const headerImages = sectionImages && rowsTable && media?.upload && !readOnly ? sectionImages : undefined;
  const leadingActions = rowsTable && !readOnly ? <div className="measurement-actions">
    <Button type="button" size="icon" variant="outline" className="measurement-action" title={`Lägg till rad – ${rows.length} rader`} aria-label={`Lägg till rad i ${rowsTable.label}`} onClick={() => onChange(addTableRow(rowsTable, values, rowOptions))}>
      <Plus /><span className="measurement-count" aria-label={`${rows.length} rader`}>{rows.length}</span>
    </Button>
    {headerImages ? <SectionImageButton block={headerImages} title={section.title} values={values} onChange={onChange} media={media!} /> : null}
    {rowsTable.allowExample && rowOptions?.showExamples ? <Button type="button" size="icon" variant="outline" className="measurement-action" title="Lägg till test-/exempelrad" aria-label={`Lägg till test-/exempelrad i ${rowsTable.label}`} disabled={tableHasExample(rowsTable, values)} onClick={() => onChange(addExampleRow(rowsTable, values, rowOptions))}><ClipboardList /></Button> : null}
  </div> : undefined;
  const actions = cardsTable && !readOnly && (values.tables[cardsTable.key] ?? []).length
    ? <Button type="button" size="sm" variant="outline" onClick={() => onChange(addTableRow(cardsTable, values, rowOptions))}><Plus />Lägg till {tableItemName(cardsTable).toLowerCase()}</Button>
    : main?.type === "summary" && !readOnly && document
      ? <span className="inline-flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => onChange({ ...values, deviationComment: formRuleSummary(document, values) })}><RefreshCw />Sammanställ resultat</Button>
        {/* HINTEK AI writes from the rules' summary, where the company's AI is on (2026-10-01). */}
        {SummaryAssist ? <SummaryAssist draft={formSummaryMaterial(document, values)} label={document.report.title || "Protokollet"} current={values.deviationComment ?? ""} onText={(text) => onChange({ ...values, deviationComment: text })} /> : null}
      </span>
      : undefined;
  const content = grid(section.blocks, section.id, section.title, main?.id ?? null, chromed?.id ?? null, first ? inline?.beside : undefined, sectionImages ? [sectionImages.id] : []);
  if (!content && !moments && !(first && (inline?.top || inline?.after))) return null;
  return <Panel title={title} description={description} collapsible={section.optional || section.collapsed} defaultCollapsed={section.collapsed} className={rowsTable ? "measurement-panel" : undefined} leadingActions={leadingActions} actions={actions}>
    {first && inline?.top ? <div className="mb-4">{inline.top}</div> : null}
    {content}
    {first && inline?.after ? <div className="mt-4">{inline.after}</div> : null}
    {moments}
    {footer}
  </Panel>;
}

/** The round picture button in a measurement panel's header: uploads and places the file in the section's picture block. */
function SectionImageButton({ block, title, values, onChange, media }: { block: Extract<FormLeafBlock, { type: "images" }>; title: string; values: FormValues; onChange: (values: FormValues) => void; media: FormMedia }) {
  return <label className="measurement-action inline-flex cursor-pointer items-center justify-center rounded-full border" title="Lägg till sektionsbild">
    <ImagePlus />
    <input type="file" className="sr-only" accept={block.accept === "files" ? "image/jpeg,image/png,image/webp,application/pdf,text/plain,.docx,.xlsx" : "image/jpeg,image/png,image/webp"} aria-label={`Lägg till bild för ${title}`}
      onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; void media.upload!(file).then((id) => { if (id) onChange({ ...values, images: { ...values.images, [block.key]: [...(values.images[block.key] ?? []), id] } }); }); }} />
  </label>;
}

/**
 * One block as the person filling in the form sees it. The builder's canvas draws the same component, inert and with
 * empty answers, so the editor looks like the finished form.
 */
export function FormLeaf({ block, values, evaluation, onChange, readOnly = false, attachments = [], media, labelOverride, document, rowOptions, completion, sectionTitle, quiet = false, chrome, marks = true, actions }: LeafProps & {
  block: FormLeafBlock;
  /** The builder puts an editable label here, in the same place as in the finished form. */
  labelOverride?: React.ReactNode;
}) {
  const deviationKeys = new Set(evaluation.deviations.map((item) => `${item.key}:${item.rowId ?? ""}`));
  const quietLabel = quiet || (!labelOverride && Boolean(sectionTitle) && "label" in block && block.label === sectionTitle);
  const set = (patch: Partial<FormValues>) => onChange({ ...values, ...patch });
  const setField = (key: string, value: FormValues["fields"][string]) => set({ fields: { ...values.fields, [key]: value } });
  const mark = (required: boolean) => required && marks ? <span aria-hidden="true" className="text-destructive"> *</span> : null;

  switch (block.type) {
    case "pagebreak": return <p className="border-t border-dashed pt-1 text-center text-xs text-muted-foreground">Ny sida i PDF</p>;
    case "heading": {
      const Tag = block.level === 1 ? "h2" : block.level === 2 ? "h3" : "h4";
      return <Tag className={cn("font-semibold tracking-tight", block.level === 1 ? "text-lg" : block.level === 2 ? "text-base" : "text-sm")}>{labelOverride ?? block.text}</Tag>;
    }
    case "text": return <p className="whitespace-pre-wrap text-sm text-muted-foreground">{labelOverride ?? block.text}</p>;
    case "note": return <NoteBlock block={block} label={labelOverride} />;
    case "matrix": return <MatrixBlock block={block} label={labelOverride} />;
    case "summary": return <SummaryBlock block={block} document={document} values={values} evaluation={evaluation} completion={completion} onChange={onChange} readOnly={readOnly} label={labelOverride ?? block.label} quietLabel={quietLabel} />;
    case "field": {
      const value = values.fields[block.key];
      const deviation = deviationKeys.has(`${block.key}:`);
      const label = <span className="text-xs font-medium text-muted-foreground">{labelOverride ?? block.label}{mark(block.required)}{block.unit ? ` (${block.unit})` : ""}</span>;
      let control: React.ReactNode;
      if (block.input === "textarea") control = <textarea id={`form-${block.id}`} className="form-textarea" placeholder={block.placeholder || undefined} value={typeof value === "string" ? value : ""} disabled={readOnly} onChange={(event) => setField(block.key, event.target.value)} />;
      else if (block.input === "choice" && block.multiple) {
        const selected = Array.isArray(value) ? value : [];
        control = <div id={`form-${block.id}`} className="flex flex-wrap gap-3">{block.options.map((option) => <label key={option} className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={readOnly} checked={selected.includes(option)} onChange={(event) => setField(block.key, event.target.checked ? [...selected, option] : selected.filter((item) => item !== option))} />{option}</label>)}</div>;
      } else if (block.input === "choice") control = <select id={`form-${block.id}`} className="form-select" value={typeof value === "string" ? value : ""} disabled={readOnly} onChange={(event) => setField(block.key, event.target.value || null)}><option value="">{block.placeholder || "Välj"}</option>{block.options.map((option) => <option key={option} value={option}>{option}</option>)}</select>;
      else if (block.input === "yesno") control = <YesNo id={`form-${block.id}`} value={typeof value === "string" ? value : null} allowNotApplicable={block.allowNotApplicable} deviationOn={block.deviationOn} disabled={readOnly} onChange={(next) => setField(block.key, next)} label={block.label} />;
      else control = <Input id={`form-${block.id}`} type={block.input === "date" ? "date" : block.input === "datetime" ? "datetime-local" : "text"} inputMode={block.input === "number" ? "decimal" : undefined} placeholder={block.placeholder || undefined} aria-invalid={deviation || undefined} value={value === null || value === undefined ? "" : String(value)} disabled={readOnly} onChange={(event) => setField(block.key, event.target.value)} />;
      const limit = document && block.limitKey ? formLimitFor(document, values, block.limitKey) : null;
      const numeric = typeof value === "number" ? value : value === "" || value === null || value === undefined || Array.isArray(value) ? null : Number(String(value).replace(",", "."));
      const level = limit ? formLimitLevel(limit, numeric !== null && Number.isFinite(numeric) ? numeric : null) : null;
      return <div className="field-stack">{block.input === "yesno" || (block.input === "choice" && block.multiple) ? <span>{label}</span> : <label htmlFor={`form-${block.id}`}>{label}</label>}{control}{block.help ? <span data-detail-min="2" className="text-xs font-normal text-muted-foreground">{block.help}</span> : null}
        {limit ? <LimitHint limit={limit} level={level} /> : null}
        {deviation && !limit ? <span className={cn("text-xs font-medium", indicatorText("danger"))}>Avvikelse</span> : null}
        {block.remarks ? <FieldRemark label={block.label} value={values.remarks[block.key]} readOnly={readOnly} onChange={(remark) => set({ remarks: { ...values.remarks, [block.key]: remark } })} /> : null}</div>;
    }
    case "checklist": {
      if (block.mode === "check") return <CheckChecklist block={block} values={values} onChange={onChange} readOnly={readOnly} label={labelOverride ?? block.label} quietLabel={quietLabel} />;
      return <AssessmentChecklist block={block} document={document} values={values} onChange={onChange} readOnly={readOnly} attachments={attachments} media={media} label={labelOverride ?? block.label} quietLabel={quietLabel} rowOptions={rowOptions} />;
    }
    case "table": return <FormTable block={block} document={document} values={values} evaluation={evaluation} onChange={onChange} readOnly={readOnly} attachments={attachments} media={media} labelOverride={labelOverride} deviationKeys={deviationKeys} rowOptions={rowOptions} quietLabel={quietLabel} chrome={chrome} marks={marks} actions={actions} />;
    case "computed": {
      const result = evaluation.computed[block.key] ?? null;
      const bad = block.passCondition && result === false;
      const band = formBand(block.bands, result);
      const limit = document && block.limitKey ? formLimitFor(document, values, block.limitKey) : null;
      const level = formLimitLevel(limit, result);
      return <div className="grid gap-1"><div className={cn("flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5", bad || level === "alarm" ? indicatorBadge("danger") : level === "warning" ? indicatorBadge("warning") : "bg-muted/30")} aria-live="polite"><span className="text-sm">{labelOverride ?? block.label}</span>
        {band ? <strong className={cn("rounded-full border px-2 py-0.5 text-sm", bandClass(band))}>{formatResultValue(result, block.unit, block.passCondition)}{band.label ? ` · ${band.label}` : ""}</strong>
          : <strong className={cn("text-sm", typeof result === "string" && /avvik/i.test(result) && indicatorText("danger"))}>{formatResultValue(result, block.unit, block.passCondition) || "–"}</strong>}</div>{limit ? <LimitHint limit={limit} level={level} /> : null}</div>;
    }
    case "images": {
      const selected = values.images[block.key] ?? [];
      return <fieldset id={`form-${block.id}`} className="min-w-0"><legend className="text-sm font-semibold">{labelOverride ?? block.label}{block.minCount ? ` (minst ${block.minCount})` : ""}</legend>{block.help ? <p className="text-xs text-muted-foreground">{block.help}</p> : null}
        <ImagePicker label={block.label} accept={block.accept} selected={selected} attachments={attachments} media={media} readOnly={readOnly} onChange={(next) => set({ images: { ...values.images, [block.key]: next } })} />
      </fieldset>;
    }
    case "signature": {
      // The name and the statement side by side, exactly like the risk assessment's and work order's approval.
      return <SignatureBlock block={block} label={labelOverride ?? block.label} required={mark(block.required)} value={values.signatures[block.key]} readOnly={readOnly} onChange={(signature) => set({ signatures: { ...values.signatures, [block.key]: signature } })} />;
    }
  }
}
