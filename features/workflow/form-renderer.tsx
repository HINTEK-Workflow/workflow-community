"use client";

import { plural } from "@/lib/plural";
import { Fragment, useMemo, useRef, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, ClipboardCheck, ClipboardList, ImagePlus, Plus, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/features/kfid/ui";
import { NativeActions } from "@/components/native";
import { useNativeMode } from "./use-detail-level";
import { cn } from "@/lib/utils";
import { FINAL_VERDICT_LABELS, decimalText, formWithoutStaleVerdict, balancedFormWidths, evaluateForm, formApprovalResult, formBand, formBlockVisible, formBlockWidth, formConditionMet, formLeafBlocks, formFieldLacksLimit, formLimitFor, formLimitLevel, formNotApprovedText, formRuleSummary, formSummaryMaterial, formSectionShown, type FormBlock, type FormDocument, type FormEvaluation, type FormLeafBlock, type FormSection, type FormValues, type FormWidth } from "@/lib/workflow/form-document";
import { formCompletionShown } from "@/lib/workflow/task-model";
import { formatResultValue } from "@/lib/workflow/form-formula";
import type { FormPrefill } from "@/lib/workflow/form-prefill";
import { CheckChecklist, MatrixBlock, MomentsPanel, NoteBlock, SummaryBlock, type FormCompletionSummary } from "./form-blocks";
import { AssessmentChecklist } from "./form-checklist";
import { bandClass, FieldRemark, ImagePicker, LimitHint, SignatureBlock, YesNo, type FormAttachment, type FormMedia } from "./form-inputs";
import { addExampleRow, addTableRow, FormTable, tableHasExample, tableItemName, tableScreenLayout, type FormRowOptions } from "./form-table";
import { clientExtensions } from "@ee/client";
import { announce } from "@/lib/workflow/toast";
import { focusTarget } from "./flow-guide";
import { formRowElementId } from "./form-row-id";
import { indicatorBadge, indicatorText } from "./indicator-tone";
import { DeviationOrder, fieldTarget } from "./deviation-order";
import type { MaintenancePriority } from "@/lib/workflow/maintenance";
import { IconButton } from "@/components/ui/icon-button";
import { ChatOfferSlot } from "@/features/ai/chat-offer-slot";

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
export type FormActions = { /** False until the protocol has been saved once: an order made before would have no link back (2026-10-02). */ canCreateWorkOrder?: boolean; createWorkOrder?: (input: { title: string; description: string; assignedToName?: string; dueDate?: string;
  /** The row's fault and severity, for the order's maintenance facts (Underhåll, 2026-10-06); `priority` when the form judged the row itself. */
  deviation?: { fault?: string; severity?: string; severityOptions?: string[]; seriousOptions?: string[]; priority?: MaintenancePriority };
  /** The row, point or field the order is made from (2026-10-06), so the finished order leads back to it. */
  targetId?: string }) => Promise<string | null>; openWorkOrder?: (id: string) => void;
  /** The state of a row's work order (2026-09-30), shown on the row: "Arbetsorder: Slutförd". */
  workOrderStatus?: (id: string) => { status: string; label: string } | undefined;
  /** Egenkontroll (etapp 2): a deviation to the programme's deviation log, linked back to the row; the number it got. */
  logDeviation?: (input: { title: string; description: string; targetId: string }) => Promise<number | null>;
  /** The deviation already logged from a row, point or field. */
  loggedDeviation?: (targetId: string) => { id?: string; number: number; status: string } | undefined;
  /** Warnings under a field (who inspects, etapp 2); never blocking. */
  fieldNotes?: (field: { key: string; prefill: string }) => string[];
  /** A field whose value comes from the task's chosen place (Plats, 2026-10-07): read-only, with a way to change the place. */
  fieldLock?: (field: { key: string; prefill: string }) => { note: string; action?: { label: string; onClick: () => void } } | undefined;
  /** The instrument register (etapp 3), offered beside a field that is filled from it. */
  instruments?: { id: string; name: string; serialNumber: string; calibratedAt: string | null; overdue: boolean }[];
  /** What the project's planning protocol says about the control's moments (2026-10-07), shown under them. */
  momentsNote?: string;
  /**
   * Why nothing can be added while the protocol is locked (kundresan 2026-11-07, H3: a draft without a work order): a free table's
   * add button is then shown grey with this reason and the way on, instead of an invitation without a button.
   */
  lockedAdd?: { reason: string; action?: { label: string; href: string } } };

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
/** The fields a chosen instrument fills: type, serial number and calibration date (etapp 3). */
function instrumentFields(document: FormDocument, instrument: NonNullable<FormActions["instruments"]>[number]) {
  const fields: FormValues["fields"] = {};
  for (const block of formLeafBlocks(document)) {
    if (block.type !== "field") continue;
    if (block.prefill === "instrument") fields[block.key] = instrument.name;
    else if (block.prefill === "instrumentSerial") fields[block.key] = instrument.serialNumber;
    else if (block.prefill === "instrumentCalibration" && instrument.calibratedAt) fields[block.key] = instrument.calibratedAt;
  }
  return fields;
}
function InstrumentPicker({ instruments, onPick }: { instruments: NonNullable<FormActions["instruments"]>; onPick: (instrument: NonNullable<FormActions["instruments"]>[number]) => void }) {
  return <select className="form-select" aria-label="Välj ur instrumentregistret" data-testid="form-instrument-picker" value="" onChange={(event) => { const chosen = instruments.find((item) => item.id === event.target.value); if (chosen) onPick(chosen); }}>
    <option value="">Välj ur instrumentregistret…</option>
    {instruments.map((item) => <option key={item.id} value={item.id}>{item.name}{item.serialNumber ? ` · S/N ${item.serialNumber}` : ""}{item.overdue ? " · kalibrering förfallen" : ""}</option>)}
  </select>;
}

export function FormRenderer({ document, values, onChange: changeValues, readOnly = false, attachments = [], media, rowOptions, panels = false, inline, title, actions, part, afterBasics, lockedNote }: {
  /** Why the fields are locked, at the top of every section's panel (kundresa 2026-11-07, M20: the reason stood only at the top of the page). */
  lockedNote?: ReactNode;
  document: FormDocument; values: FormValues; onChange: (values: FormValues) => void; readOnly?: boolean; attachments?: FormAttachment[]; media?: FormMedia; rowOptions?: FormRowOptions; panels?: boolean; inline?: FormTaskInline;
  /**
   * The job's risk step (2026-10-08) in the protocol's own order (simulation 2026-10-10, dator fynd 20): after the
   * moments when the form has them, else after the form's Grunduppgifter when it draws the task's own, else first – the
   * same order as the progress line (Grunduppgifter → moments → Riskbedömning → the work).
   */
  afterBasics?: ReactNode;
  /** What the protocol can do outside the form: make a work order of a deviation row (2026-09-28). */
  actions?: FormActions;
  /** The panel heading for blocks outside any section (a schema 1 form): the form's name. */
  title?: string;
  /**
   * Nivå 1 på mobil (2026-10-09, en skärm per del): only these top-level groups (formParts in
   * lib/workflow/native-mode.ts); the moments with the first part, the deviations and warnings with the last.
   */
  part?: { keys: readonly string[]; first: boolean; last: boolean };
}) {
  const evaluation = useMemo(() => evaluateForm(document, values), [document, values]);
  const completion = useMemo(() => panels ? formCompletionShown(document, values) : undefined, [panels, document, values]);
  // The final verdict is given on what the protocol says: a changed value takes it away, here and on the server (beslut 6).
  const onChange = (next: FormValues) => changeValues(formWithoutStaleVerdict(values, next));
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
  const moments = <MomentsPanel document={document} values={values} onChange={onChange} readOnly={readOnly} bare={momentsInside} note={actions?.momentsNote} />;
  const hasMoments = document.blocks.some((block) => block.type === "section" && block.optional);
  const firstShown = Boolean(panels && firstSection && formSectionShown(document, firstSection, values));
  const basicsAt = !afterBasics || part ? "none" : hasMoments && !momentsInside ? "moments" : (hasMoments || inline) && firstShown ? "first" : "top";
  const renderGroup = (group: FormBlock | FormLeafBlock[], index: number) => {
    if (part && !part.keys.includes(Array.isArray(group) ? group[0]?.id ?? "" : group.id)) return null;
    if (Array.isArray(group)) return panels ? <Panel key={`group-${index}`} title={title || document.report.title || "Formulär"}>{lockedNote ? <div className="mb-4">{lockedNote}</div> : null}{grid(group, `group-${index}`)}</Panel> : grid(group, `group-${index}`);
    if (group.type === "columns") return <div key={group.id} className={cn("grid gap-4", group.columns.length === 3 ? "@2xl:grid-cols-3" : "@xl:grid-cols-2")}>{group.columns.map((column, columnIndex) => <div key={columnIndex} className="grid min-w-0 content-start gap-4">{column.filter((block) => formBlockVisible(block, "task")).map((block) => <div key={block.id}>{leaf(block)}</div>)}</div>)}</div>;
    if (group.type === "section") {
      if (!formSectionShown(document, group, values)) return null;
      const first = group.id === firstSection?.id;
      if (panels) {
        const summary = sectionHasSummary(group);
        const panel = <SectionPanel key={group.id} section={group} first={first} inline={inline} moments={momentsInside && first ? moments : null} grid={grid} leafProps={leafProps} footer={summary ? inline?.summaryFooter : undefined} lockedNote={lockedNote} />;
        if (first && basicsAt === "first") return <Fragment key={group.id}>{panel}{afterBasics}</Fragment>;
        return summary && inline?.beforeSummary ? <Fragment key={group.id}>{inline.beforeSummary}{panel}</Fragment> : panel;
      }
      const content = grid(group.blocks, group.id, group.title);
      if (!content) return null;
      if (!group.title && !group.description) return content;
      if (group.collapsed) return <details key={group.id} className="group rounded-xl border bg-card" data-testid="form-section-folded">
        <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3"><span className="min-w-0 flex-1"><span className="block text-base font-semibold tracking-tight">{group.taskTitle || group.title}</span>{group.description ? <span className="mt-0.5 block text-xs text-muted-foreground">{group.description}</span> : null}</span><ChevronDown className="mt-1 size-4 text-muted-foreground -rotate-90 group-open:rotate-0" /></summary>
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
  const shownDeviations = evaluation.deviations.filter((item) => item.kind !== "assessment");
  const deviations = shownDeviations.length && !ownSummary ? <section aria-label="Avvikelser" className={cn("space-y-2 rounded-xl border p-4", indicatorBadge("danger"))} data-testid="form-deviations">
    <p className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="size-4" />{shownDeviations.length === 1 ? "1 avvikelse" : `${shownDeviations.length} avvikelser`}</p>
    <ul className="list-disc space-y-1 pl-5 text-sm">{shownDeviations.map((item) => <li key={`${item.blockId}-${item.rowId ?? ""}-${item.message}`}>{item.message}</li>)}</ul>
    {evaluation.alerts.length ? <ul className={cn("list-disc space-y-1 pl-5 text-sm", indicatorText("warning"))}>{evaluation.alerts.map((item) => <li key={`${item.blockId}-${item.rowId ?? ""}-${item.column ?? ""}`}>Varning: {item.message}</li>)}</ul> : null}
    <label className="block space-y-1.5 text-xs font-medium">Kommentar till avvikelserna (krävs för att slutföra)<textarea id="form-deviations" className="form-textarea bg-card" value={values.deviationComment} disabled={readOnly} onChange={(event) => onChange({ ...values, deviationComment: event.target.value })} /></label>
  </section> : null;

  return <div className="@container space-y-6" data-testid="form-renderer">
    {basicsAt === "top" ? afterBasics : null}
    {!momentsInside && (!part || part.first) ? (panels && (document.blocks.some((block) => block.type === "section" && block.optional)) ? <Panel title={document.moments.label || "Moment"} description={document.moments.requireOne ? "Välj minst ett." : undefined}><MomentsPanel document={document} values={values} onChange={onChange} readOnly={readOnly} bare note={actions?.momentsNote} /></Panel> : moments) : null}
    {basicsAt === "moments" ? afterBasics : null}
    {groups.map(renderGroup)}
    {!formLeafBlocks(document).length ? <p className="text-sm text-muted-foreground">Formuläret har inget innehåll ännu.</p> : null}
    {deviations && (!part || part.last) ? (panels ? <Panel icon={AlertTriangle} title="Avvikelser">{deviations}</Panel> : deviations) : null}
    {alertsOnly && (!part || part.last) ? (panels ? <Panel icon={TriangleAlert} title="Varningar">{alertsOnly}</Panel> : alertsOnly) : null}
    {evaluation.warnings.length && (!part || part.last) ? <p className="text-xs text-muted-foreground">{evaluation.warnings.join(" ")}</p> : null}
    {panels && (!part || part.last) ? <Panel icon={ClipboardCheck} title="Slutomdöme" description="Ditt samlade omdöme, som står i protokollet. Ändras ett värde behöver du ange omdömet igen.">
      <label className="block max-w-sm space-y-1.5 text-xs font-medium text-muted-foreground">Slutomdöme
        <select className="form-select" value={values.finalVerdict?.choice ?? ""} disabled={readOnly} data-testid="form-final-verdict" onChange={(event) => {
          const { finalVerdict: _earlier, ...rest } = values;
          void _earlier;
          const choice = event.target.value as keyof typeof FINAL_VERDICT_LABELS | "";
          changeValues(choice ? { ...rest, finalVerdict: { choice, by: "", at: null } } : rest);
        }}>
          <option value="">Inte angivet</option>
          {(Object.keys(FINAL_VERDICT_LABELS) as (keyof typeof FINAL_VERDICT_LABELS)[]).map((choice) => <option key={choice} value={choice}>{FINAL_VERDICT_LABELS[choice]}</option>)}
        </select>
      </label>
    </Panel> : null}
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
function SectionPanel({ section, first, inline, moments, grid, leafProps, footer, lockedNote }: {
  section: FormSection; first: boolean; inline?: FormTaskInline; moments: ReactNode; lockedNote?: ReactNode;
  grid: (blocks: FormLeafBlock[], key: string, sectionTitle?: string, quietId?: string | null, chromeId?: string | null, beside?: FormTaskInline["beside"], skip?: string[]) => ReactNode;
  leafProps: LeafProps;
  /** Drawn after the content inside the panel (the control's Historik and Färdigställ under the summary). */
  footer?: ReactNode;
}) {
  const { values, onChange, readOnly, media, rowOptions, document } = leafProps;
  const chrome = sectionPanelChrome(section, values);
  const { main, rowsTable, cardsTable, sectionImages, rows, description, title, chromed } = chrome;
  const headerImages = sectionImages && rowsTable && media?.upload && !readOnly ? sectionImages : undefined;
  // Nivå 1 på mobil (QA 2026-10-10): no round icon buttons with a number and no fold arrows on a part's screen – the
  // section's actions are rows with words over its content, and the section is always open.
  const native = useNativeMode();
  const leadingActions = rowsTable && !readOnly && !native ? <div className="measurement-actions">
    <Button type="button" size="icon" variant="outline" className="measurement-action" title={`Lägg till rad – ${plural(rows.length, "rad", "rader")}`} aria-label={`Lägg till rad i ${rowsTable.label} – ${plural(rows.length, "rad", "rader")}`} onClick={() => onChange(addTableRow(rowsTable, values, rowOptions))}>
      {/* The count shown is in the name too ("… – 2 rader"), WCAG 2.5.3 (granskningen 2026-11-24). */}
      <Plus /><span className="measurement-count">{rows.length}</span>
    </Button>
    {headerImages ? <SectionImageButton block={headerImages} title={section.title} values={values} onChange={onChange} media={media!} /> : null}
    {rowsTable.allowExample && rowOptions?.showExamples ? <IconButton label={`Lägg till test-/exempelrad i ${rowsTable.label}`} title="Lägg till test-/exempelrad" variant="outline" className="measurement-action" disabled={tableHasExample(rowsTable, values)} onClick={() => onChange(addExampleRow(rowsTable, values, rowOptions))}><ClipboardList /></IconButton> : null}
  </div> : undefined;
  const actions = cardsTable && !readOnly && (values.tables[cardsTable.key] ?? []).length
    ? <Button type="button" size="sm" variant="outline" onClick={() => onChange(addTableRow(cardsTable, values, rowOptions))}><Plus />Lägg till {tableItemName(cardsTable).toLowerCase()}</Button>
    : main?.type === "summary" && !readOnly && document
      ? <span className="inline-flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => summarize(document, values, onChange)}><RefreshCw />Sammanställ resultat</Button>
        {/* Skriv med AI is the agent's offer in the chat (2026-11-21: "så det känns lite mer som att allt kommer från
            AI-chatten"); the text still lands in this field. */}
        {SummaryAssist ? <ChatOfferSlot offer={{ id: `summary:${document.report.title || "protokoll"}`, agentId: "summary", priority: 2, title: "Skriv sammanfattningen",
          text: "Workflow AI kan skriva om Sammanställ resultat till en färdig text i protokollet.",
          node: <SummaryAssist draft={formSummaryMaterial(document, values)} label={document.report.title || "Protokollet"} current={values.deviationComment ?? ""} onText={(text) => onChange({ ...values, deviationComment: text })} /> }} /> : null}
      </span>
      : undefined;
  const nativeRows = native && !readOnly && (rowsTable || actions) ? <div className="mb-3"><NativeActions testId="form-section-actions">
    {rowsTable ? <Button type="button" variant="ghost" aria-label={`Lägg till rad i ${rowsTable.label}`} onClick={() => onChange(addTableRow(rowsTable, values, rowOptions))}>
      <Plus />Lägg till rad<span className="ml-auto text-sm font-normal text-muted-foreground">{rows.length} {rows.length === 1 ? "rad" : "rader"}</span>
    </Button> : null}
    {rowsTable && headerImages ? <SectionImageButton row block={headerImages} title={section.title} values={values} onChange={onChange} media={media!} /> : null}
    {rowsTable?.allowExample && rowOptions?.showExamples ? <Button type="button" variant="ghost" disabled={tableHasExample(rowsTable, values)} onClick={() => onChange(addExampleRow(rowsTable, values, rowOptions))}><ClipboardList />Lägg till exempelrad</Button> : null}
    {actions}
  </NativeActions></div> : null;
  const content = grid(section.blocks, section.id, section.title, main?.id ?? null, chromed?.id ?? null, first ? inline?.beside : undefined, sectionImages ? [sectionImages.id] : []);
  if (!content && !moments && !(first && (inline?.top || inline?.after))) return null;
  return <Panel title={title} description={description} collapsible={!native && (section.optional || section.collapsed)} defaultCollapsed={!native && section.collapsed} className={rowsTable ? "measurement-panel" : undefined} leadingActions={leadingActions} actions={nativeRows ? undefined : actions}>
    {nativeRows}
    {lockedNote && content ? <div className="mb-4">{lockedNote}</div> : null}
    {first && inline?.top ? <div className="mb-4">{inline.top}</div> : null}
    {content}
    {first && inline?.after ? <div className="mt-4">{inline.after}</div> : null}
    {moments}
    {footer}
  </Panel>;
}

/**
 * Sammanställ resultat (2026-10-05: it could be clicked past a protocol that was not approved and nothing said
 * so): the rules' summary goes in the field, and rows that are not approved are named in a toast with the way to the
 * first of them – the same rows that keep Färdigställ waiting until they are measured again or described.
 */
function summarize(document: FormDocument, values: FormValues, onChange: (values: FormValues) => void) {
  const evaluation = evaluateForm(document, values);
  onChange({ ...values, deviationComment: formRuleSummary(document, values, evaluation) });
  const { notApproved } = formApprovalResult(document, values, evaluation);
  if (!notApproved.length) return;
  const first = notApproved[0];
  announce(`Sammanställt. ${notApproved.length === 1 ? "En kontrollrad är" : `${notApproved.length} kontrollrader är`} inte godkänd${notApproved.length === 1 ? "" : "a"}: ${formNotApprovedText(notApproved, 3)}. Åtgärda och för in den nya mätningen, eller beskriv åtgärden i sammanfattningen.`, true,
    [{ label: "Gå till raden", run: () => { focusTarget(formRowElementId(first.blockId, first.rowId)); } }]);
}

/** The round picture button in a measurement panel's header: uploads and places the file in the section's picture block. */
function SectionImageButton({ block, title, values, onChange, media, row = false }: { block: Extract<FormLeafBlock, { type: "images" }>; title: string; values: FormValues; onChange: (values: FormValues) => void; media: FormMedia;
  /** Nivå 1: a row with words (Lägg till bild) instead of the round icon. */
  row?: boolean }) {
  const input = useRef<HTMLInputElement | null>(null);
  const count = (values.images[block.key] ?? []).length;
  const field = <input ref={input} type="file" className="sr-only" tabIndex={row ? -1 : undefined} accept={block.accept === "files" ? "image/jpeg,image/png,image/webp,application/pdf,text/plain,.docx,.xlsx" : "image/jpeg,image/png,image/webp"} aria-label={`Lägg till bild för ${title}`}
    onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; void media.upload!(file).then((id) => { if (id) onChange({ ...values, images: { ...values.images, [block.key]: [...(values.images[block.key] ?? []), id] } }); }); }} />;
  if (row) return <><Button type="button" variant="ghost" onClick={() => input.current?.click()}><ImagePlus />Lägg till bild{count ? <span className="ml-auto text-sm font-normal text-muted-foreground">{count} {count === 1 ? "bild" : "bilder"}</span> : null}</Button>{field}</>;
  return <label className="measurement-action inline-flex cursor-pointer items-center justify-center rounded-full border" title="Lägg till sektionsbild">
    <ImagePlus />
    {field}
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
      const lock = !readOnly && block.prefill !== "none" ? actions?.fieldLock?.(block) : undefined;
      let control: React.ReactNode;
      if (lock) control = <Input id={`form-${block.id}`} type="text" readOnly aria-readonly="true" data-testid="form-locked-field" className="bg-muted/40" value={value === null || value === undefined ? "" : String(value)} />;
      else if (block.input === "textarea") control = <textarea id={`form-${block.id}`} className="form-textarea" placeholder={block.placeholder || undefined} value={typeof value === "string" ? value : ""} disabled={readOnly} onChange={(event) => setField(block.key, event.target.value)} />;
      else if (block.input === "choice" && block.multiple) {
        const selected = Array.isArray(value) ? value : [];
        control = <div id={`form-${block.id}`} className="flex flex-wrap gap-3">{block.options.map((option) => <label key={option} className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={readOnly} checked={selected.includes(option)} onChange={(event) => setField(block.key, event.target.checked ? [...selected, option] : selected.filter((item) => item !== option))} />{option}</label>)}</div>;
      } else if (block.input === "choice") control = <select id={`form-${block.id}`} className="form-select" value={typeof value === "string" ? value : ""} disabled={readOnly} onChange={(event) => setField(block.key, event.target.value || null)}><option value="">{block.placeholder || "Välj"}</option>{block.options.map((option) => <option key={option} value={option}>{option}</option>)}{typeof value === "string" && value && !block.options.includes(value) ? <option value={value}>{value}</option> : null}</select>;
      else if (block.input === "yesno") control = <YesNo id={`form-${block.id}`} value={typeof value === "string" ? value : null} allowNotApplicable={block.allowNotApplicable} deviationOn={block.deviationOn} disabled={readOnly} onChange={(next) => setField(block.key, next)} label={block.label} />;
      else control = <Input id={`form-${block.id}`} type={block.input === "date" ? "date" : block.input === "datetime" ? "datetime-local" : "text"} inputMode={block.input === "number" ? "decimal" : undefined} placeholder={block.placeholder || undefined} aria-invalid={deviation || undefined} value={value === null || value === undefined ? "" : typeof value === "number" ? decimalText(value) : String(value)} disabled={readOnly} onChange={(event) => setField(block.key, event.target.value)} />;
      const limit = document && block.limitKey ? formLimitFor(document, values, block.limitKey) : null;
      const numeric = typeof value === "number" ? value : value === "" || value === null || value === undefined || Array.isArray(value) ? null : Number(String(value).replace(",", "."));
      const level = limit ? formLimitLevel(limit, numeric !== null && Number.isFinite(numeric) ? numeric : null) : null;
      // A field with a deviation can become a work order (2026-10-06), linked back to the field.
      const target = fieldTarget(block.key);
      const linked = values.workOrders?.[target];
      const fault = evaluation.deviations.filter((item) => item.key === block.key && !item.rowId).map((item) => item.message).join(" ") || `${block.label}: avvikelse.`;
      return <div className="field-stack" data-deviation-target={target}>{block.input === "yesno" || (block.input === "choice" && block.multiple) ? <span>{label}</span> : <label htmlFor={`form-${block.id}`}>{label}</label>}{control}{block.help ? <span className="text-xs font-normal text-muted-foreground">{block.help}</span> : null}
        {limit || (block.limitKey && document) ? <LimitHint limit={limit} level={level} measured={Boolean(document) && formFieldLacksLimit(document!, values, block)} /> : null}
        {lock ? <span className="text-xs font-normal text-muted-foreground" data-testid="form-field-lock">{lock.note}{lock.action ? <> · <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" onClick={lock.action.onClick}>{lock.action.label}</button></> : null}</span> : null}
        {/* Instrumentkoppling (2026-10-11): the chosen instrument's id is kept beside the text, with whether its calibration was overdue. */}
        {block.prefill === "instrument" && actions?.instruments?.length && !readOnly && document ? <InstrumentPicker instruments={actions.instruments} onPick={(instrument) => set({ fields: { ...values.fields, ...instrumentFields(document, instrument) }, instruments: { ...(values.instruments ?? {}), [block.key]: { id: instrument.id, overdue: instrument.overdue } } })} /> : null}
        {block.prefill === "instrument" && values.instruments?.[block.key]?.overdue ? <span className="text-xs font-medium text-amber-800 dark:text-amber-200" data-testid="form-instrument-overdue">Kalibrering förfallen</span> : null}
        {actions?.fieldNotes?.(block).map((note) => <span key={note} className="text-xs font-medium text-amber-800 dark:text-amber-200" data-testid="form-field-note">{note}</span>)}
        {deviation && !limit ? <span className={cn("text-xs font-medium", indicatorText("danger"))}>Avvikelse</span> : null}
        {(deviation && actions) || linked ? <div className="flex flex-wrap"><DeviationOrder actions={actions} readOnly={readOnly} targetId={target} existing={linked} title={`Åtgärda: ${block.label}`} description={fault} fault={fault}
          onLinked={(id) => set({ workOrders: { ...(values.workOrders ?? {}), [target]: id } })} /></div> : null}
        {block.remarks ? <FieldRemark label={block.label} value={values.remarks[block.key]} readOnly={readOnly} onChange={(remark) => set({ remarks: { ...values.remarks, [block.key]: remark } })} /> : null}</div>;
    }
    case "checklist": {
      if (block.mode === "check") return <CheckChecklist block={block} values={values} onChange={onChange} readOnly={readOnly} label={labelOverride ?? block.label} quietLabel={quietLabel} />;
      return <AssessmentChecklist block={block} document={document} values={values} onChange={onChange} readOnly={readOnly} attachments={attachments} media={media} label={labelOverride ?? block.label} quietLabel={quietLabel} rowOptions={rowOptions} actions={actions} />;
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
