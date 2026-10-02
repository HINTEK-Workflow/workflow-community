"use client";

import type { CSSProperties, ReactNode } from "react";
import { ClipboardList, Copy, ExternalLink, LoaderCircle, Plus, RotateCw, Trash2, Wrench } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formBand, formLimitFor, formLimitLevel, formRowLabel, newFormRow, supersededRowIds, type FormColumn, type FormDocument, type FormEvaluation, type FormTableBlock, type FormValues } from "@/lib/workflow/form-document";
import { formatFormulaValue, formatResultValue } from "@/lib/workflow/form-formula";
import { bandClass, CameraButton, ImagePicker, LimitHint, ScaleSelect, SuggestionChips, YesNo, type FormAttachment, type FormMedia } from "./form-inputs";
import type { FormActions } from "./form-renderer";
import { FormIcon } from "./form-card";
import { indicatorBadge, indicatorText } from "./indicator-tone";

type TableRow = FormValues["tables"][string][number];
/** The person's own settings that the control already has (2026-09-27): new rows on top and the example row button. */
export type FormRowOptions = { rowsOnTop?: boolean; showExamples?: boolean };
/** A unique id for a row added by the person filling in the form. */
const newRowId = (count: number) => `row-${Date.now().toString(36)}-${count}`;
// Relative column widths of measurement rows on screen, the control's own by kind of answer, unless the column says.
const WEIGHT: Record<FormColumn["input"], number> = { text: 2.3, textarea: 2.4, number: 1, choice: 1.05, yesno: 1.4, formula: 1, date: 1.2, images: 1, check: 0.8, assessment: 0.8, scale: 1.4 };
const TRACK = /^(\d+(\.\d+)?(fr|rem|px|%)|minmax\([^()]{1,40}\)|auto)$/;

/** The layout on screen: the PDF's, or the table's own choice for the task (the RCD test: cards in the PDF, two-line rows on screen). */
export const tableScreenLayout = (block: FormTableBlock) => block.taskLayout === "same" ? block.layout : block.taskLayout;
export const tableItemName = (block: FormTableBlock) => block.itemLabel || "Objekt";
export const tableItemPlural = (block: FormTableBlock) => block.itemLabelPlural || tableItemName(block).toLowerCase();
export const tableHasExample = (block: FormTableBlock, values: FormValues) => (values.tables[block.key] ?? []).some((row) => row.example);

/**
 * A new row with the columns' default values – or, for "Kopiera", another row's values except its pictures and free
 * texts (an observation belongs to one object) – placed first with "nya rader överst", like the control.
 */
export function addTableRow(block: FormTableBlock, values: FormValues, rowOptions?: FormRowOptions, copyFrom?: TableRow, remeasure = false): FormValues {
  const rows = values.tables[block.key] ?? [];
  const fresh = newFormRow(block, newRowId(rows.length + 1)) as TableRow;
  // Ommätning (2026-10-02, decision 2.1): the identifying columns (object, place, test voltage…) come along;
  // the measured result starts empty so the new value is the person's own, not a copy of the old one.
  if (copyFrom) for (const [key, value] of Object.entries(copyFrom.cells)) { const input = block.columns.find((column) => column.key === key)?.input ?? ""; if (["images", "textarea"].includes(input)) continue; if (remeasure && ["number", "assessment", "formula"].includes(input)) continue; fresh.cells[key] = value as string; }
  if (remeasure && copyFrom) fresh.remeasures = copyFrom.id;
  return { ...values, tables: { ...values.tables, [block.key]: rowOptions?.rowsOnTop ? [fresh, ...rows] : [...rows, fresh] } };
}
export function addExampleRow(block: FormTableBlock, values: FormValues, rowOptions?: FormRowOptions): FormValues {
  const rows = values.tables[block.key] ?? [];
  const row = newFormRow(block, newRowId(rows.length + 1), { example: true }) as TableRow;
  return { ...values, tables: { ...values.tables, [block.key]: rowOptions?.rowsOnTop ? [row, ...rows] : [...rows, row] } };
}

type TableProps = {
  block: FormTableBlock; values: FormValues; evaluation: FormEvaluation; onChange: (values: FormValues) => void; readOnly: boolean; attachments: FormAttachment[]; media?: FormMedia;
  labelOverride?: ReactNode; deviationKeys: Set<string>; rowOptions?: FormRowOptions;
  /** The table is named like its section, so its own heading is only for screen readers (2026-09-27). */
  quietLabel?: boolean;
  /** The section's panel carries the heading and the add button (the control's measurement panels), so the table draws none. */
  chrome?: "panel";
  /** Whether required columns are marked with an asterisk. */
  marks?: boolean;
  /** The form, for its configurable limits (2026-09-28). */
  document?: FormDocument;
  actions?: FormActions;
};

/**
 * A table (2026-09-26/27): a grid of rows, object cards where each row is one object with its fields, results
 * and pictures together, or compact measurement rows exactly like the control's – with Godkänd, tick boxes, scales,
 * example rows and suggestions.
 */
export function FormTable(props: TableProps) {
  const { block, values, evaluation, onChange, readOnly, labelOverride, rowOptions, quietLabel, chrome, marks = true } = props;
  const rows = values.tables[block.key] ?? [];
  const setRows = (next: TableRow[]) => onChange({ ...values, tables: { ...values.tables, [block.key]: next } });
  const setCell = (rowId: string, key: string, value: FormValues["fields"][string]) => setRows(rows.map((item) => item.id === rowId ? { ...item, cells: { ...item.cells, [key]: value } } : item));
  const addRow = (copyFrom?: TableRow) => onChange(addTableRow(block, values, rowOptions, copyFrom));
  // Ommätning: a new row that replaces a failing one's result, kept for the record but excluded from totals and
  // deviations once it is pointed at (decision 2.1, lib/workflow/form-document.ts supersededRowIds).
  const addRemeasure = (copyFrom: TableRow) => onChange(addTableRow(block, values, rowOptions, copyFrom, true));
  const addExample = () => onChange(addExampleRow(block, values, rowOptions));
  const context: CellContext = { ...props, rows, setRows, setCell, marks };
  const layout = tableScreenLayout(block);
  const quiet = Boolean(quietLabel || chrome);
  const title = <p className={cn("text-sm font-semibold", quiet && "sr-only")}>{labelOverride ?? block.label}{block.required && marks ? <span aria-hidden="true" className="text-destructive"> *</span> : null}</p>;
  // Object cards show their help in the empty state, like the risk assessment; other layouts under the heading.
  const heading = <>{title}{block.help && !quiet && layout !== "cards" ? <p className="text-xs text-muted-foreground">{block.help}</p> : null}</>;
  const canAdd = block.rowMode === "free" && !readOnly;
  const examples = rows.flatMap((row, index) => row.example ? [index + 1] : []);
  const exampleNotice = examples.length ? <p className={cn("rounded-lg border px-3 py-2 text-xs", indicatorBadge("warning"))} data-testid="form-example-notice">Exempeldata i rad {examples.join(", ")} – exempelraden räknas inte och måste tas bort före slutförande. Ersätt den med verkliga värden.</p> : null;
  const exampleButton = canAdd && block.allowExample && rowOptions?.showExamples && !examples.length && !chrome
    ? <Button type="button" size="sm" variant="outline" onClick={addExample}><ClipboardList />Exempelrad</Button> : null;
  const totals = evaluation.totals[block.key];
  // One list of suggestions per column, shared by all rows.
  const suggestionLists = block.columns.filter((column) => column.suggestions.length && ["text", "number"].includes(column.input)).map((column) => <datalist key={column.id} id={`form-${block.id}-${column.key}-suggestions`}>{column.suggestions.map((item) => <option key={item} value={item} />)}</datalist>);
  const totalsLine = totals ? <p className="text-xs text-muted-foreground">{block.columns.filter((column) => column.key in totals).map((column) => `${column.label}: ${formatFormulaValue(totals[column.key], column.unit) || "–"}`).join(" · ")}</p> : null;
  const itemName = tableItemName(block);

  if (layout === "rows") return <div className="form-rows @container min-w-0 space-y-2" id={`form-${block.id}`} data-testid="form-rows">
    {chrome ? null : <div className="flex flex-wrap items-end justify-between gap-2"><div className="min-w-0">{heading}</div>
      {canAdd ? <div className="flex gap-1.5">{exampleButton}<Button type="button" size="sm" variant="outline" onClick={() => addRow()} aria-label={`Lägg till rad i ${block.label}`}><Plus />Lägg till rad<span className="ml-0.5 rounded-full bg-secondary px-1.5 text-[11px]">{rows.length}</span></Button></div> : null}
    </div>}
    {exampleNotice}{suggestionLists}
    {rows.length ? <MeasurementRows context={context} onCopy={addRow} onRemeasure={canAdd ? addRemeasure : undefined} /> : <p className="py-6 text-center text-sm text-muted-foreground">{block.emptyTitle || "Inga rader ännu. Lägg till din första rad."}</p>}
    {totalsLine}
  </div>;

  if (layout === "cards") {
    return <div className="min-w-0 space-y-3" id={`form-${block.id}`} data-testid="form-cards">
      {heading}
      {exampleNotice}{suggestionLists}
      {rows.map((row, index) => <ObjectCard key={row.id} context={context} row={row} index={index} canAdd={canAdd} onCopy={addRow} />)}
      {!rows.length ? <div className="rounded-xl border border-dashed bg-muted/20 px-5 py-6 text-center" data-testid="form-cards-empty">
        {block.emptyIcon ? <FormIcon icon={block.emptyIcon} className="mx-auto size-7 text-primary" /> : <ClipboardList className="mx-auto size-7 text-primary" />}
        <p className="mt-3 text-sm font-semibold">{block.emptyTitle || `Inga ${tableItemPlural(block)} ännu`}</p>
        {block.help ? <p className="mx-auto mt-1 max-w-lg text-xs leading-5 text-muted-foreground">{block.help}</p> : null}
        {canAdd ? <Button type="button" className="mt-3" size="sm" onClick={() => addRow()}><Plus />{block.emptyAction || `Lägg till ${itemName.toLowerCase()}`}</Button> : null}
      </div> : null}
      {totalsLine}
      {canAdd && rows.length && !chrome ? <div className="flex flex-wrap gap-1.5"><Button type="button" size="sm" variant="outline" onClick={() => addRow()}><Plus />Lägg till {itemName.toLowerCase()}</Button>{exampleButton}</div> : null}
    </div>;
  }

  return <div className="min-w-0 space-y-2">{heading}
    {exampleNotice}{suggestionLists}
    <div className="overflow-x-auto rounded-lg border" id={`form-${block.id}`}>
      <table className="w-full min-w-[32rem] border-collapse text-sm tabular-nums">
        <thead><tr className="bg-[var(--panel-header)] text-left text-xs">{block.rowMode === "fixed" ? <th className="border-b px-3 py-2 font-semibold">Rad</th> : null}{block.columns.map((column) => <th key={column.id} className="border-b px-3 py-2 font-semibold" title={column.help || undefined}>{column.label}{column.unit ? ` (${column.unit})` : ""}</th>)}{canAdd ? <th className="w-10 border-b" aria-label="Åtgärder" /> : null}</tr></thead>
        <tbody>{rows.map((row, rowIndex) => {
          const rowDeviation = props.deviationKeys.has(`${block.key}:${row.id}`);
          return <tr key={row.id} className={cn("border-b last:border-b-0", rowDeviation && indicatorBadge("danger"), row.example && indicatorBadge("warning"))} data-example={row.example || undefined}>
            {block.rowMode === "fixed" ? <th scope="row" className="px-3 py-1.5 text-left font-medium">{row.label}</th> : null}
            {block.columns.map((column) => { const judged = cellLimit(context, row, column); return <td key={column.id} className={cn(column.input === "formula" ? "px-3 py-1.5" : "px-2 py-1", judged?.level === "alarm" && indicatorBadge("danger"), judged?.level === "warning" && indicatorBadge("warning"))} title={judged?.level === "alarm" ? "Utanför larmgränsen" : judged?.level === "warning" ? "Utanför varningsgränsen" : undefined}>{cellControl(context, row, rowIndex, column, true)}</td>; })}
            {canAdd ? <td className="px-1"><Button type="button" size="icon" variant="ghost" aria-label={`Ta bort rad ${rowIndex + 1}`} onClick={() => setRows(rows.filter((item) => item.id !== row.id))}><Trash2 /></Button></td> : null}
          </tr>;
        })}</tbody>
        {totals ? <tfoot><tr className="bg-muted/40 text-xs font-semibold">{block.rowMode === "fixed" ? <td className="px-3 py-2">Summering</td> : null}{block.columns.map((column, index) => <td key={column.id} className="px-3 py-2">{column.key in totals ? formatFormulaValue(totals[column.key], column.unit) || "–" : index === 0 && block.rowMode === "free" ? "Summering" : ""}</td>)}{canAdd ? <td /> : null}</tr></tfoot> : null}
      </table>
    </div>
    {canAdd && !chrome ? <div className="flex flex-wrap gap-1.5"><Button type="button" size="sm" variant="outline" onClick={() => addRow()} aria-label={`Lägg till rad i ${block.label}`}><Plus />Lägg till rad</Button>{exampleButton}</div> : null}
  </div>;
}

type CellContext = TableProps & { rows: TableRow[]; setRows: (next: TableRow[]) => void; setCell: (rowId: string, key: string, value: FormValues["fields"][string]) => void; marks: boolean };

/** Godkänd of a row: decided by the condition (shown, not editable) or ticked by hand. */
function assessmentState(context: CellContext, row: TableRow, column: FormColumn) {
  const byCondition = column.mode === "auto" || (column.mode === "switch" && context.values.fields[column.switchKey] === "YES");
  return { byCondition, approved: context.evaluation.cells[context.block.key]?.[row.id]?.[column.key] === true };
}

/** The result shown on an object card: Godkänd or a deviation. */
function RowResult({ context, row }: { context: CellContext; row: TableRow }) {
  const column = context.block.columns.find((item) => item.input === "assessment");
  if (column) {
    const { approved } = assessmentState(context, row, column);
    return <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", indicatorBadge(approved ? "success" : "neutral"))}>{approved ? "Godkänd" : "Ej godkänd"}</span>;
  }
  return context.deviationKeys.has(`${context.block.key}:${row.id}`) ? <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", indicatorBadge("danger"))}>Avvikelse</span> : null;
}

/** A formula column's result with its level as text and colour ("15 · Hög"). */
function formulaResult(context: CellContext, row: TableRow, column: FormColumn) {
  const result = context.evaluation.cells[context.block.key]?.[row.id]?.[column.key] ?? null;
  return { result, band: formBand(column.bands, result), text: formatResultValue(result, column.unit, column.passCondition) };
}

/** One cell's input by its kind; the label is the column's, with the row, for screen readers. */
function cellControl(context: CellContext, row: TableRow, index: number, column: FormColumn, compact: boolean, id?: string): ReactNode {
  const { block, readOnly, setCell } = context;
  const label = `${block.label}, ${formRowLabel(block, row, index)}, ${column.label}`;
  const cell = row.cells[column.key];
  if (column.input === "formula") {
    const { result, band, text } = formulaResult(context, row, column);
    if (band) return <span aria-label={label} className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold", bandClass(band))}>{text}{band.label ? ` · ${band.label}` : ""}</span>;
    return <span aria-label={label} className={cn("font-semibold", column.passCondition && result === true && indicatorText("success"), column.passCondition && result === false && indicatorText("danger"))}>{text || "–"}</span>;
  }
  if (column.input === "assessment") {
    const { byCondition, approved } = assessmentState(context, row, column);
    return <label className="inline-flex items-center gap-2 text-xs">
      <Checkbox id={id} aria-label={label} checked={approved} disabled={readOnly || byCondition} className={byCondition && !readOnly ? "measurement-auto-result" : undefined} onCheckedChange={(checked) => setCell(row.id, column.key, checked === true)} />
      <span className={cn(compact && "@3xl:sr-only", approved ? indicatorText("success") : "text-muted-foreground")}>{byCondition ? (approved ? "Godkänd" : "Ej godkänd") : "Godkänd"}</span>
    </label>;
  }
  if (column.input === "check") return <label className={cn("inline-flex items-center gap-2", compact ? "h-9 text-xs" : "h-10 text-sm text-foreground")}><Checkbox id={id} aria-label={label} checked={cell === true} disabled={readOnly} onCheckedChange={(checked) => setCell(row.id, column.key, checked === true)} /><span className={cn(compact && "@3xl:sr-only")}>{column.label}</span></label>;
  if (column.input === "scale") return <ScaleSelect id={id} label={label} value={cell} steps={column.options} compact={compact} disabled={readOnly} onChange={(next) => setCell(row.id, column.key, next)} />;
  if (column.input === "choice") return <select id={id} aria-label={label} className={cn("form-select", compact && "h-9")} value={typeof cell === "string" ? cell : ""} disabled={readOnly} onChange={(event) => setCell(row.id, column.key, event.target.value || null)}><option value="">{compact ? "–" : "Välj"}</option>{column.options.map((option) => <option key={option} value={option}>{option}</option>)}</select>;
  if (column.input === "yesno") return <YesNo compact={compact} label={label} value={typeof cell === "string" ? cell : null} allowNotApplicable disabled={readOnly} onChange={(next) => setCell(row.id, column.key, next)} />;
  if (column.input === "textarea") return <div className="grid gap-1">
    <textarea id={id} aria-label={label} className={cn("form-textarea", compact ? "min-h-9 py-1.5" : "min-h-16")} rows={compact ? 1 : 2} placeholder={column.placeholder || undefined} value={typeof cell === "string" ? cell : ""} disabled={readOnly} onChange={(event) => setCell(row.id, column.key, event.target.value)} />
    {!compact ? <SuggestionChips suggestions={column.suggestions} disabled={readOnly} onPick={(value) => setCell(row.id, column.key, value)} /> : null}
  </div>;
  if (column.input === "images") return <ImagePicker compact={compact} label={label} accept="images" selected={Array.isArray(cell) ? cell : []} attachments={context.attachments} media={context.media} readOnly={readOnly} onChange={(next) => setCell(row.id, column.key, next)} />;
  const list = column.suggestions.length ? `form-${block.id}-${column.key}-suggestions` : undefined;
  return <Input id={id} aria-label={label} list={list} placeholder={column.placeholder || undefined} className={compact ? "h-9" : undefined} type={column.input === "date" ? "date" : "text"} inputMode={column.input === "number" ? "decimal" : undefined} value={cell === null || cell === undefined || Array.isArray(cell) ? "" : String(cell)} disabled={readOnly} onChange={(event) => setCell(row.id, column.key, event.target.value)} />;
}

const cellLabel = (column: FormColumn) => `${column.label}${column.unit && column.input !== "formula" ? ` (${column.unit})` : ""}`;

/**
 * One object card (the risk assessment's risk, the thermography's object): the number and name, badges with the
 * results the author put in the title row ("Före: 15 · Hög → Efter: 5 · Måttlig"), then the fields – in named groups
 * ("Före skyddsåtgärd") where the author grouped them – with the widths the author chose.
 */
function ObjectCard({ context, row, index, canAdd, onCopy }: { context: CellContext; row: TableRow; index: number; canAdd: boolean; onCopy: (row: TableRow) => void }) {
  const { block, rows, setRows, marks, readOnly } = context;
  const name = formRowLabel(block, row, index);
  const rowDeviation = context.deviationKeys.has(`${block.key}:${row.id}`);
  const header = block.columns.filter((column) => column.placement === "header" && column.input === "formula");
  const body = block.columns.filter((column) => column.placement === "body");
  const span = (column: FormColumn) => {
    const width = column.cardWidth === "auto" ? (column.input === "textarea" ? "full" : column.input === "images" ? "images" : ["text", "choice", "scale"].includes(column.input) ? "text" : "quarter") : column.cardWidth;
    return width === "full" ? "col-span-2 @3xl:col-span-4" : width === "half" ? "col-span-2" : width === "images" ? "col-span-2 @md:col-span-1 @3xl:col-span-2" : width === "text" ? "col-span-2 @md:col-span-1" : "col-span-1";
  };
  const mark = (column: FormColumn) => column.required && marks ? <span aria-hidden="true" className="text-destructive"> *</span> : null;
  // Consecutive columns with the same group name share one framed group, like the risk assessment's Före/Efter.
  const items: ({ kind: "column"; column: FormColumn } | { kind: "group"; name: string; columns: FormColumn[] })[] = [];
  for (const column of body) {
    const last = items.at(-1);
    if (column.group && last?.kind === "group" && last.name === column.group) last.columns.push(column);
    else if (column.group) items.push({ kind: "group", name: column.group, columns: [column] });
    else items.push({ kind: "column", column });
  }
  return <article aria-label={name} data-testid="form-card" data-example={row.example || undefined} className={cn("rounded-xl border bg-card p-3 transition-colors focus-within:border-primary/40 sm:p-4", rowDeviation && "border-destructive/50", row.example && indicatorBadge("warning"))}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-secondary-foreground" aria-hidden="true">{index + 1}</span><span className="truncate">{name}</span></h3>
      <div className="flex flex-wrap items-center gap-1.5">
        {header.map((column, position) => {
          const { band, text } = formulaResult(context, row, column);
          return <span key={column.id} className="contents">
            {position ? <span className="text-muted-foreground" aria-hidden="true">→</span> : null}
            <span className={cn("rounded-full border px-2.5 py-1 text-xs font-medium", bandClass(band))} aria-label={`${column.label}: ${text}${band?.label ? ` ${band.label}` : ""}`}>{column.cardLabel || column.label}: {text || "–"}{band?.label ? ` · ${band.label}` : ""}</span>
          </span>;
        })}
        <RowResult context={context} row={row} />
        {row.source ? <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground" title="Registrerad från en kontrollpunkt">Från kontrollpunkt</span> : null}
        {canAdd && block.copyRows ? <Button type="button" size="sm" variant="ghost" onClick={() => onCopy(row)} aria-label={`Kopiera ${name}`}><Copy />Kopiera</Button> : null}
        {canAdd ? <Button type="button" size="icon" variant="ghost" aria-label={`Ta bort ${name}`} onClick={() => setRows(rows.filter((item) => item.id !== row.id))}><Trash2 /></Button> : null}
      </div>
    </div>
    <div className="@container"><div className="mt-3 grid grid-cols-2 gap-3 @3xl:grid-cols-4">
      {items.map((item) => item.kind === "group"
        ? <fieldset key={item.name} className="col-span-2 min-w-0 rounded-lg border bg-muted/30 px-3 pb-3 pt-1"><legend className="px-1 text-xs font-semibold text-foreground">{item.name}</legend>
          {/* The group's fields are laid out like the card's others (2026-10-01, Handlingsplan): the label above,
              the field under it, and a check box level with the inputs beside it with its own label only. */}
          <div className="grid grid-cols-2 items-start gap-x-3 gap-y-3">{item.columns.map((column) => <div key={column.id} className="field-stack min-w-0">
            {column.input === "check" ? <span aria-hidden="true">&nbsp;</span> : <span>{column.cardLabel || cellLabel(column)}{mark(column)}</span>}
            {column.input === "formula" ? <div className="flex h-10 items-center rounded-[9px] border bg-muted/30 px-3 text-sm">{cellControl(context, row, index, column, false)}</div> : cellControl(context, row, index, column, false)}
          </div>)}</div>
        </fieldset>
        : <div key={item.column.id} className={cn("field-stack", span(item.column))}>
          {/* A check box carries its own label beside it; the empty line keeps it level with the inputs (2026-09-29). */}
          {item.column.input === "check" ? <span aria-hidden="true">&nbsp;</span> : <span>{item.column.cardLabel || cellLabel(item.column)}{mark(item.column)}</span>}
          {item.column.input === "formula" ? <div className="flex h-10 items-center rounded-[9px] border bg-muted/30 px-3 text-sm">{cellControl(context, row, index, item.column, false)}</div> : cellControl(context, row, index, item.column, false)}
          {item.column.help && !readOnly ? <span data-detail-min="2" className="text-[11px] font-normal text-muted-foreground">{item.column.help}</span> : null}
          {(() => { const judged = cellLimit(context, row, item.column); return judged?.limit ? <LimitHint limit={judged.limit} level={judged.level} /> : null; })()}
        </div>)}
    </div></div>
    <WorkOrderFooter context={context} row={row} index={index} />
  </article>;
}

/**
 * Measurement rows (2026-09-27) drawn with the control's own classes, so they look exactly like the control:
 * on a wide form one compact line per row under shared column headings – number and camera first, Godkänd and delete
 * last – and on a phone every value with its label. A table whose columns sit on two lines (the RCD test) draws the
 * control's two-line rows with the labels above each value and the note under them.
 */
function MeasurementRows({ context, onCopy, onRemeasure }: { context: CellContext; onCopy: (row: TableRow) => void; /** Undefined where new rows cannot be added (fixed rowMode or read-only): decision 2.1 needs a new row. */ onRemeasure?: (row: TableRow) => void }) {
  const { block, rows, setRows, readOnly, marks } = context;
  // Ommätning (decision 2.1): which rows a later row already replaced, and which row (if any) is itself a remeasurement.
  const superseded = supersededRowIds(rows);
  const inputs = block.columns.filter((column) => column.input !== "images" && column.input !== "assessment" && column.placement !== "note");
  const camera = block.columns.find((column) => column.input === "images");
  const assessment = block.columns.find((column) => column.input === "assessment");
  const notes = block.columns.filter((column) => column.placement === "note" && column.input === "formula");
  const twoLine = inputs.some((column) => column.line === 2);
  const track = (column: FormColumn) => TRACK.test(column.screenWidth) ? column.screenWidth : `minmax(0,${WEIGHT[column.input]}fr)`;
  const tools = readOnly ? "0" : block.copyRows ? "4.5rem" : "2rem";
  const first = inputs.filter((column) => column.line !== 2);
  const second = inputs.filter((column) => column.line === 2);
  const single = { "--measurement-columns": ["3.5rem", ...first.map(track), ...(assessment ? ["3.75rem"] : []), tools].join(" ") } as CSSProperties;
  const top = { "--line-columns": ["3.5rem", ...first.map(track)].join(" ") } as CSSProperties;
  const bottom = { "--line-columns": ["3.5rem", ...second.map(track), ...(assessment ? ["3.75rem"] : []), tools].join(" ") } as CSSProperties;
  const cell = (row: TableRow, index: number, column: FormColumn) => {
    const id = `form-${block.id}-${row.id}-${column.key}`;
    if (column.input === "check") {
      const label = `${block.label}, ${formRowLabel(block, row, index)}, ${column.label}`;
      return <label key={column.id} className="measurement-check"><span>{column.label}</span>
        <Checkbox aria-label={label} checked={row.cells[column.key] === true} disabled={readOnly} onCheckedChange={(checked) => context.setCell(row.id, column.key, checked === true)} />
      </label>;
    }
    // A free text on a measurement row is one line, like the control's Kommentar.
    const compactColumn = column.input === "textarea" ? { ...column, input: "text" as const } : column;
    const judged = cellLimit(context, row, column);
    return <div key={column.id} data-limit={judged?.level ?? undefined} title={judged?.level === "alarm" ? "Utanför larmgränsen" : judged?.level === "warning" ? "Utanför varningsgränsen" : undefined} className={cn("grid min-w-0 gap-1.5 rounded-[10px]", ["text", "textarea"].includes(column.input) && "measurement-wide", judged?.level === "alarm" && "ring-2 ring-red-500/70", judged?.level === "warning" && "ring-2 ring-amber-500/70")}>
      <label htmlFor={id} className="field-label text-xs font-medium">{cellLabel(column)}{column.required && marks ? <span aria-hidden="true" className="text-destructive"> *</span> : null}</label>
      {cellControl(context, row, index, compactColumn, true, id)}
    </div>;
  };
  const approval = (row: TableRow, index: number) => {
    if (!assessment) return null;
    const { byCondition, approved } = assessmentState(context, row, assessment);
    return <label className="measurement-check"><span className={approved ? "text-emerald-700" : "text-muted-foreground"}>{assessment.label}</span>
      <Checkbox aria-label={`${assessment.label}, rad ${index + 1}`} checked={approved} className={byCondition && !readOnly ? "measurement-auto-result" : undefined} disabled={byCondition || readOnly} onCheckedChange={(checked) => context.setCell(row.id, assessment.key, checked === true)} />
    </label>;
  };
  const remove = (row: TableRow, index: number) => readOnly ? <span /> : <div className="measurement-remove flex items-center gap-0.5">
    {block.copyRows ? <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={`Kopiera rad ${index + 1}`} title="Kopiera raden" onClick={() => onCopy(row)}><Copy className="size-4" /></Button> : null}
    <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={`Ta bort rad ${index + 1}`} onClick={() => setRows(rows.filter((item) => item.id !== row.id))}><Trash2 className="size-5 text-muted-foreground" /></Button>
  </div>;
  return <div className="measurement-list" data-testid="form-row-list">
    {!twoLine ? <div className="measurement-head measurement-grid" style={single} aria-hidden="true">
      <span />{first.map((column) => <span key={column.id} title={column.help || undefined}>{cellLabel(column)}</span>)}{assessment ? <span className="text-center">{assessment.label}</span> : null}<span />
    </div> : null}
    {rows.map((row, index) => {
      const rowDeviation = context.deviationKeys.has(`${block.key}:${row.id}`);
      const isSuperseded = superseded.has(row.id);
      const remeasureOf = row.remeasures ? rows.findIndex((item) => item.id === row.remeasures) : -1;
      const toolsCell = <div className="measurement-tools">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground" aria-label={`Rad ${index + 1}`}>{index + 1}</span>
        {camera ? <RowCamera context={context} row={row} column={camera} index={index} /> : null}
      </div>;
      return <fieldset key={row.id} disabled={readOnly || isSuperseded} data-example={row.example || undefined} data-testid="form-row" aria-label={`${block.label}, rad ${index + 1}${row.example ? ", exempeldata" : ""}${isSuperseded ? ", ersatt av en ommätning" : ""}`}
        className={cn("measurement-row", twoLine && "measurement-rcd", rowDeviation && !assessment && !isSuperseded && indicatorBadge("danger"), isSuperseded && "opacity-60")}>
        {twoLine ? <>
          <div className="rcd-top" style={top}>{toolsCell}{first.map((column) => cell(row, index, column))}</div>
          <div className="rcd-bottom" style={bottom}><span className="rcd-indent" />{second.map((column) => cell(row, index, column))}{approval(row, index)}{remove(row, index)}</div>
        </> : <div className="measurement-grid" style={single}>{toolsCell}{first.map((column) => cell(row, index, column))}{approval(row, index)}{remove(row, index)}</div>}
        {notes.map((column) => { const { text } = formulaResult(context, row, column); return text ? <p key={column.id} className="rcd-guidance text-xs leading-5 text-muted-foreground">{text}</p> : null; })}
        {isSuperseded ? <p className="text-xs font-medium text-muted-foreground" data-testid="form-row-superseded">Ersatt av en ommätning (rad {rows.findIndex((item) => item.remeasures === row.id) + 1}).</p> : remeasureOf >= 0 ? <p className="text-xs text-muted-foreground">Ommätning av rad {remeasureOf + 1}.</p> : null}
        {!isSuperseded && rowDeviation && onRemeasure && !row.example ? <Button type="button" size="sm" variant="outline" className="measurement-remeasure" onClick={() => onRemeasure(row)}><RotateCw />Ommätning</Button> : null}
      </fieldset>;
    })}
  </div>;
}

/** The row's camera: takes or chooses a picture and places it on the row in one step, with the number of pictures. */
function RowCamera({ context, row, column, index }: { context: CellContext; row: TableRow; column: FormColumn; index: number }) {
  const selected = Array.isArray(row.cells[column.key]) ? row.cells[column.key] as string[] : [];
  if (!context.media?.upload || context.readOnly) return selected.length ? <span className="text-xs text-muted-foreground">{selected.length} {selected.length === 1 ? "bild" : "bilder"}</span> : null;
  // A button, not a label (2026-09-28): the measurement row hides its field labels on a wide screen, which hid the camera.
  return <CameraButton label={`${column.label} för rad ${index + 1}`} count={selected.length} onUpload={async (file) => { const id = await context.media!.upload!(file); if (id) context.setCell(row.id, column.key, [...selected, id]); }} />;
}

/**
 * The work order of a deviation card (2026-09-28): the card's last line (2026-09-29: not among the card's tools),
 * after the remark, the action and the responsible person it is made from. The card becomes a work order in the same
 * project, linked back here; once made, the line says so and opens it.
 */
function WorkOrderFooter({ context, row, index }: { context: CellContext; row: TableRow; index: number }) {
  const [busy, setBusy] = useState(false);
  const { block, actions, readOnly } = context;
  if (!block.workOrders || row.example) return null;
  const footer = (text: string, action: ReactNode) => <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
    <p className="flex items-center gap-2 text-xs text-muted-foreground"><Wrench className="size-3.5" />{text}</p>{action}
  </div>;
  // The work order's state follows it here (2026-09-30), so the protocol shows what has been done about the row.
  const state = row.workOrderId ? actions?.workOrderStatus?.(row.workOrderId) : undefined;
  if (row.workOrderId) return footer(state ? `Arbetsorder: ${state.label}${state.status === "COMPLETED" ? " – åtgärden är utförd" : ""}` : "Arbetsorder skapad av anmärkningen.", <Button type="button" size="sm" variant="outline" onClick={() => actions?.openWorkOrder?.(row.workOrderId!)} disabled={!actions?.openWorkOrder} data-testid="form-row-work-order" data-status={state?.status}><ExternalLink />Öppna arbetsorder</Button>);
  if (readOnly || !actions?.createWorkOrder) return null;
  const create = async () => {
    const texts = block.columns.filter((column) => ["text", "textarea", "choice", "date"].includes(column.input)).map((column) => {
      const value = row.cells[column.key];
      return typeof value === "string" && value.trim() ? `${column.label}: ${value.trim()}` : null;
    }).filter(Boolean);
    setBusy(true);
    try {
      // The row's own responsible person and date follow into the work order (simulation 2026-10-02).
      const named = (key: string) => { const value = row.cells[key]; return typeof value === "string" ? value.trim() : ""; };
      const due = named("klart");
      const id = await actions.createWorkOrder!({ title: `Åtgärda: ${formRowLabel(block, row, index)}`.slice(0, 200), description: texts.join("\n").slice(0, 4000), assignedToName: named("ansvarig").slice(0, 120), dueDate: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : "" });
      if (id) context.setRows(context.rows.map((item) => item.id === row.id ? { ...item, workOrderId: id } : item));
    } finally { setBusy(false); }
  };
  if (actions.canCreateWorkOrder === false) return footer("Spara protokollet först, så kan arbetsordern kopplas till raden.", <Button type="button" size="sm" variant="outline" disabled title="Spara protokollet först"><Wrench />Skapa arbetsorder</Button>);
  return footer("Åtgärden kan utföras som en arbetsorder i samma projekt.", <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void create()}>{busy ? <LoaderCircle className="animate-spin" /> : <Wrench />}Skapa arbetsorder</Button>);
}

/** A cell's configurable limit: the level and a short text, shown under the value. */
function cellLimit(context: CellContext, row: TableRow, column: FormColumn) {
  if (!column.limitKey || !context.document) return null;
  const limit = formLimitFor(context.document, context.values, column.limitKey);
  const value = column.input === "formula" ? context.evaluation.cells[context.block.key]?.[row.id]?.[column.key] : row.cells[column.key];
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() && Number.isFinite(Number(value.replace(",", "."))) ? Number(value.replace(",", ".")) : null;
  return { limit, level: formLimitLevel(limit, number) };
}
