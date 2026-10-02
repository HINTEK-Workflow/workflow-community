"use client";

import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, ChevronDown, ClipboardList, Copy, GripVertical, ImagePlus, Maximize2, Plus, RefreshCw, Settings2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { evaluateForm, formBlockCanBeNarrow, formBlockVisible, formBlockWidth, formCompletion, formLeafBlocks, formOptionalSections, formWidthForSpan, FORM_WIDTH_LABEL, FORM_WIDTH_SPAN, type FormEvaluation, type FormIssue, type FormLeafBlock, type FormSection, type FormValues, type FormWidth } from "@/lib/workflow/form-document";
import type { EditorDocument } from "@/lib/workflow/form-editor";
import { canvasValues } from "@/lib/workflow/form-sample";
import { MomentsPanel, type FormCompletionSummary } from "../form-blocks";
import { FORM_GRID, FORM_SPAN_CLASS, FormLeaf, sectionPanelChrome } from "../form-renderer";
import { tableItemName } from "../form-table";
import { blockName, blockTypeLabel } from "./labels";

export type CanvasActions = {
  select: (id: string) => void;
  move: (id: string, delta: -1 | 1) => void;
  duplicate: (id: string) => void;
  remove: (id: string) => void;
  openSettings: (id: string) => void;
  rename: (id: string, value: string) => void;
  resize: (id: string, width: FormWidth) => void;
};

const noop = () => undefined;

/**
 * The sheet (2026-09-26, panels since 2026-10-01): the form drawn exactly as the person filling it in will see
 * it – every section as one of Workflow's panels with the light blue header, the round add button of measurement
 * rows, "Lägg till …" for object cards and the summary's completion card – on a white page in the 12-column grid.
 * Blocks are compact – their tools float above them on hover and when selected – labels are edited in place, and the
 * right edge of a selected block is dragged to change its width. The panels' buttons are inert here.
 */
export function FormCanvas({ document, selectedId, issues, actions }: { document: EditorDocument; selectedId: string | null; issues: FormIssue[]; actions: CanvasActions }) {
  const values = useMemo(() => canvasValues(document), [document]);
  const evaluation = useMemo(() => evaluateForm(document, values), [document, values]);
  const completion = useMemo(() => formCompletion(document, values), [document, values]);
  const issueCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const issue of issues) if (issue.blockId) counts.set(issue.blockId, (counts.get(issue.blockId) ?? 0) + 1);
    return counts;
  }, [issues]);
  const momentsInside = document.moments.placement === "firstSection";
  const hasMoments = formOptionalSections(document).length > 0 || formLeafBlocks(document).some((block) => block.type === "field" && block.momentSwitch && block.input === "yesno");
  const moments = hasMoments ? <Inert><MomentsPanel document={document} values={values} onChange={noop} readOnly bare={momentsInside} /></Inert> : null;
  return <div className="@container space-y-5" data-testid="form-canvas">
    {moments && !momentsInside ? <section className="rounded-xl border bg-card shadow-xs" aria-label={document.moments.label || "Moment"} data-testid="canvas-moments">
      <div className="panel-header flex items-center gap-3 rounded-t-xl border-b px-5 py-4"><div><h3 className="section-title">{document.moments.label || "Moment"}</h3>{document.moments.requireOne ? <p className="mt-1 text-xs leading-5 text-muted-foreground">Välj minst ett.</p> : null}</div></div>
      <div className="panel-content p-5">{moments}</div>
    </section> : null}
    <SortableContext items={document.blocks.map((section) => section.id)} strategy={verticalListSortingStrategy}>
      {document.blocks.map((section, index) => <SectionView key={section.id} document={document} section={section} index={index} count={document.blocks.length} selectedId={selectedId}
        values={values} evaluation={evaluation} completion={completion} issueCount={issueCount} actions={actions} moments={momentsInside && index === 0 ? moments : null} />)}
    </SortableContext>
  </div>;
}

/** Looks exactly like the finished form but takes no input: the panel's buttons and the moments' tick cards. */
function Inert({ children, className }: { children: ReactNode; className?: string }) {
  return <div aria-hidden="true" className={cn("pointer-events-none select-none", className)}>{children}</div>;
}

function blockKeys(event: KeyboardEvent, id: string, actions: CanvasActions) {
  if (event.target !== event.currentTarget) return;
  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); actions.select(id); }
  else if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) { event.preventDefault(); actions.move(id, event.key === "ArrowUp" ? -1 : 1); }
  else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") { event.preventDefault(); actions.duplicate(id); }
  else if (event.key === "Delete") { event.preventDefault(); actions.remove(id); }
}

const tool = "flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40 [&_svg]:size-3.5";

/** The floating tools of a block or a section: drag handle, move, duplicate, delete and (on smaller screens) settings. */
function Tools({ id, name, type, actions, first, last, handle, visible }: { id: string; name: string; type: string; actions: CanvasActions; first: boolean; last: boolean; handle: ReactNode; visible: boolean }) {
  const stop = (run: () => void) => (event: React.MouseEvent) => { event.stopPropagation(); run(); };
  return <div className={cn("absolute -top-3.5 right-1 z-20 flex items-center rounded-md border bg-card px-0.5 shadow-sm transition-opacity",
    visible ? "opacity-100" : "pointer-events-none opacity-0 group-hover/item:pointer-events-auto group-hover/item:opacity-100 group-focus-within/item:pointer-events-auto group-focus-within/item:opacity-100")}>
    {handle}
    <span className="max-w-32 truncate px-1 text-[11px] font-medium text-muted-foreground">{type}</span>
    <button type="button" className={tool} aria-label={`Flytta ${name} upp`} disabled={first} onClick={stop(() => actions.move(id, -1))}><ArrowUp /></button>
    <button type="button" className={tool} aria-label={`Flytta ${name} ned`} disabled={last} onClick={stop(() => actions.move(id, 1))}><ArrowDown /></button>
    <button type="button" className={tool} aria-label={`Duplicera ${name}`} onClick={stop(() => actions.duplicate(id))}><Copy /></button>
    <button type="button" className={cn(tool, "text-destructive hover:text-destructive")} aria-label={`Ta bort ${name}`} onClick={stop(() => actions.remove(id))}><Trash2 /></button>
    <button type="button" className={cn(tool, "xl:hidden")} aria-label={`Inställningar för ${name}`} onClick={stop(() => actions.openSettings(id))}><Settings2 /></button>
  </div>;
}

/** Text edited in place on the sheet, in the look of the text it replaces. */
function InlineText({ value, onChange, label, multiline, className }: { value: string; onChange: (value: string) => void; label: string; multiline?: boolean; className?: string }) {
  const common = "pointer-events-auto w-full min-w-0 rounded border border-primary/40 bg-card px-1.5 py-0.5 text-inherit outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";
  return multiline
    ? <textarea aria-label={label} value={value} rows={Math.min(8, Math.max(2, value.split("\n").length))} onChange={(event) => onChange(event.target.value)} onClick={(event) => event.stopPropagation()} className={cn(common, "resize-y font-normal", className)} />
    : <input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} onClick={(event) => event.stopPropagation()} className={cn(common, className)} data-testid="inline-label" />;
}

/**
 * One section as the panel the task draws (the same chrome as the task's SectionPanel): title and description in the
 * light blue header, the round add and picture buttons for measurement rows, "Lägg till …" for object cards and
 * "Sammanställ resultat" for the summary – all inert – and the blocks in the grid below.
 */
function SectionView({ document, section, index, count, selectedId, values, evaluation, completion, issueCount, actions, moments }: {
  document: EditorDocument; section: FormSection; index: number; count: number; selectedId: string | null; values: FormValues; evaluation: FormEvaluation; completion: FormCompletionSummary; issueCount: Map<string, number>; actions: CanvasActions; moments: ReactNode;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: section.id, data: { kind: "section" } });
  const { setNodeRef: setBodyRef, isOver } = useDroppable({ id: `body:${section.id}`, data: { kind: "body", sectionId: section.id } });
  const selected = selectedId === section.id;
  const name = section.title ? `avsnittet ${section.title}` : `avsnitt ${index + 1}`;
  const handle = <button type="button" className={cn(tool, "cursor-grab touch-none active:cursor-grabbing")} aria-label={`Dra ${name}`} {...attributes} {...listeners}><GripVertical /></button>;
  const chrome = sectionPanelChrome(section, values);
  const { main, rowsTable, cardsTable, sectionImages, rows, chromed } = chrome;
  const untitled = !section.title && !(main && "label" in main && main.label);
  const first = index === 0;
  const notes = [
    section.newPage && "börjar på ny sida i PDF",
    section.optional && `moment som kan väljas bort${section.defaultOn ? ", påslaget från början" : ""}`,
    section.collapsed && "hopfällt",
    section.pdfStyle !== "standard" && (section.pdfStyle === "chapter" ? "eget kapitel i PDF" : "utan rubrik i PDF"),
  ].filter(Boolean) as string[];
  const leadingActions = rowsTable ? <Inert className="measurement-actions">
    <Button type="button" size="icon" variant="outline" className="measurement-action" tabIndex={-1} aria-label={`Lägg till rad i ${rowsTable.label}`}><Plus /><span className="measurement-count">{rows.length}</span></Button>
    {sectionImages ? <span className="measurement-action inline-flex items-center justify-center rounded-full border"><ImagePlus /></span> : null}
    {rowsTable.allowExample ? <Button type="button" size="icon" variant="outline" className="measurement-action" tabIndex={-1} aria-label="Lägg till exempelrad"><ClipboardList /></Button> : null}
  </Inert> : null;
  const panelActions = cardsTable ? <Button type="button" size="sm" variant="outline" tabIndex={-1}><Plus />Lägg till {tableItemName(cardsTable).toLowerCase()}</Button>
    : main?.type === "summary" ? <Button type="button" variant="outline" tabIndex={-1}><RefreshCw />Sammanställ resultat</Button> : null;
  const collapsible = section.optional || section.collapsed;
  return <section ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} aria-label={section.title || `Avsnitt ${index + 1}`} data-testid="form-section" data-section-id={section.id}
    className={cn("group/item relative rounded-xl border bg-card shadow-xs", rowsTable && "measurement-panel", isDragging && "z-30 opacity-70 shadow-lg", selected && "outline-2 outline-offset-4 outline-primary")}>
    <div role="group" tabIndex={0} aria-label={`Avsnitt: ${section.title || "utan rubrik"}`} onClick={() => actions.select(section.id)} onKeyDown={(event) => blockKeys(event, section.id, actions)}
      className="panel-header relative flex cursor-pointer flex-wrap items-center justify-between gap-3 rounded-t-xl border-b px-5 py-4 focus-visible:outline-2 focus-visible:outline-ring" data-testid="canvas-panel-header">
      <div className="panel-heading flex min-w-0 flex-1 items-center gap-3">
        {leadingActions}
        <div className="min-w-0 flex-1">
          {selected ? <InlineText label="Avsnittets rubrik" value={section.title} onChange={(value) => actions.rename(section.id, value)} className="section-title" />
            : <h3 className={cn("section-title", untitled && "font-normal text-muted-foreground")}>{chrome.title === "Avsnitt" && untitled ? "Avsnitt utan rubrik – klicka för att ge det en rubrik" : chrome.title}</h3>}
          {chrome.description ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{chrome.description}</p> : null}
          {notes.length || issueCount.get(section.id) ? <p className="mt-1 text-[11px] text-muted-foreground">{notes.join(" · ")}{issueCount.get(section.id) ? <span className="text-amber-700">{notes.length ? " · " : ""}{issueCount.get(section.id)} att rätta</span> : null}</p> : null}
        </div>
      </div>
      {panelActions || collapsible ? <Inert className="panel-actions flex shrink-0 flex-wrap items-center gap-2">{panelActions}{collapsible ? <span className={cn("flex size-9 items-center justify-center text-muted-foreground", rowsTable && "measurement-collapse")}>{rowsTable ? <Maximize2 className="size-4" /> : <ChevronDown className="size-4" />}</span> : null}</Inert> : null}
      <Tools id={section.id} name={name} type="Avsnitt" actions={actions} first={index === 0} last={index === count - 1} handle={handle} visible={selected} />
    </div>
    <div ref={setBodyRef} className={cn("panel-content rounded-b-xl p-5", isOver && "bg-secondary/50 outline-2 outline-dashed outline-primary/40")}>
      {first && document.task.layout === "inline" ? <p className="mb-4 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground" data-testid="canvas-inline-note">Uppgiftens projekt, kund och plats visas här i uppgiften (inställningen Uppgiftens fält i Grunduppgifter).</p> : null}
      <SortableContext items={section.blocks.map((block) => block.id)} strategy={rectSortingStrategy}>
        <div className={FORM_GRID} data-form-grid>
          {section.blocks.map((block, blockIndex) => <BlockView key={block.id} document={document} block={block} sectionId={section.id} sectionTitle={section.title} selected={selectedId === block.id} values={values} evaluation={evaluation} completion={completion}
            quiet={main?.id === block.id} chrome={chromed?.id === block.id ? "panel" : undefined} headerImage={Boolean(sectionImages && rowsTable && sectionImages.id === block.id)}
            issues={issueCount.get(block.id) ?? 0} actions={actions} first={index === 0 && blockIndex === 0} last={index === count - 1 && blockIndex === section.blocks.length - 1} />)}
        </div>
      </SortableContext>
      {!section.blocks.length ? <div className={cn("flex min-h-24 items-center justify-center rounded-lg border-2 border-dashed p-4 text-center text-sm text-muted-foreground", isOver && "border-primary text-primary")} data-testid="canvas-empty">
        Dra ett fält hit från raden ovanför, eller klicka på ett fält där.
      </div> : null}
      {moments}
    </div>
  </section>;
}

function BlockView({ document, block, sectionId, sectionTitle, selected, values, evaluation, completion, quiet, chrome, headerImage, issues, actions, first, last }: {
  document: EditorDocument; block: FormLeafBlock; sectionId: string; sectionTitle: string; selected: boolean; values: FormValues; evaluation: FormEvaluation; completion: FormCompletionSummary; quiet: boolean; chrome?: "panel"; headerImage: boolean; issues: number; actions: CanvasActions; first: boolean; last: boolean;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: block.id, data: { kind: "block", sectionId } });
  const wrapper = useRef<HTMLDivElement | null>(null);
  const [resizing, setResizing] = useState<FormWidth | null>(null);
  const name = blockName(block);
  const width = formBlockWidth(block);
  const hidden = [!formBlockVisible(block, "task") && "uppgiften", !formBlockVisible(block, "pdf") && "PDF:en"].filter(Boolean);
  const moment = block.type === "field" && block.momentSwitch && block.input === "yesno";
  // Villkorad visning (2026-09-28): the field it follows, named as on the sheet.
  const conditional = "showIf" in block && block.showIf.key ? block.showIf.key : "";
  const handle = <button type="button" className={cn(tool, "cursor-grab touch-none active:cursor-grabbing")} aria-label={`Dra ${name}`} {...attributes} {...listeners}><GripVertical /></button>;
  const editable = block.type === "heading" || block.type === "text" || block.type === "note" || "label" in block;
  // The block the panel is about has its name in the panel's header; its label is edited there, not twice.
  const label = !selected || !editable ? undefined : block.type === "heading" || block.type === "text"
    ? <InlineText label={block.type === "heading" ? "Rubrik" : "Hjälptext"} multiline={block.type === "text"} value={block.text} onChange={(value) => actions.rename(block.id, value)} />
    : block.type === "note" ? <InlineText label="Rubrik" value={block.title} onChange={(value) => actions.rename(block.id, value)} />
    : <InlineText label="Etikett" value={"label" in block ? block.label : ""} onChange={(value) => actions.rename(block.id, value)} />;

  // Dragging the right edge snaps the width to the grid: ¼, ⅓, ½, ⅔, ¾ or the whole row.
  const startResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    event.preventDefault(); event.stopPropagation();
    const grid = wrapper.current?.closest<HTMLElement>("[data-form-grid]");
    const box = wrapper.current?.getBoundingClientRect();
    if (!grid || !box) return;
    const column = (grid.getBoundingClientRect().width + 16) / 12;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    let current = width;
    const move = (moveEvent: PointerEvent) => {
      const span = Math.max(1, Math.min(12, Math.round((moveEvent.clientX - box.left + 16) / column)));
      const next = formWidthForSpan(span);
      if (next !== current) { current = next; setResizing(next); actions.resize(block.id, next); }
    };
    const up = () => { target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", up); target.removeEventListener("pointercancel", up); setResizing(null); };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  return <div ref={(node) => { setNodeRef(node); wrapper.current = node; }} style={{ transform: CSS.Translate.toString(transform), transition }}
    role="group" tabIndex={0} aria-label={`${blockTypeLabel(block)}: ${name}`} onClick={() => actions.select(block.id)} onKeyDown={(event) => blockKeys(event, block.id, actions)}
    className={cn("group/item relative min-w-0 cursor-pointer rounded-md p-1.5 outline-1 outline-transparent transition-[outline-color] hover:outline-border focus-visible:outline-2 focus-visible:outline-ring", FORM_SPAN_CLASS[width],
      isDragging && "z-30 bg-card opacity-70 shadow-lg", selected && "bg-secondary/30 outline-2 outline-primary hover:outline-primary", issues && !selected && "outline-amber-400")}
    data-testid="form-block" data-block-id={block.id}>
    <Tools id={block.id} name={name} type={`${blockTypeLabel(block)}${"key" in block ? ` · ${block.key}` : ""}`} actions={actions} first={first} last={last} handle={handle} visible={selected} />
    {/* The real block, read-only, with the chrome the task gives it: it looks like the finished form. Only the label being edited takes input. */}
    <div className="pointer-events-none select-none [&_:disabled]:cursor-default [&_:disabled]:bg-card [&_:disabled]:opacity-100">
      {/* A selected block shows its own heading again, so its label can be edited in place even when the panel carries it. */}
      <FormLeaf block={block} document={document} values={values} evaluation={evaluation} completion={completion} onChange={noop} readOnly labelOverride={label} sectionTitle={selected ? undefined : sectionTitle} quiet={quiet && !selected} chrome={selected ? undefined : chrome} marks={document.task.requiredMarks} rowOptions={{ showExamples: true }} />
    </div>
    {hidden.length || issues || moment || conditional || headerImage ? <p className="mt-1 text-[11px] text-muted-foreground">{moment ? "Visas som växel bland momenten. " : ""}{headerImage ? "Ritas som den runda bildknappen i panelens rubrik. " : ""}{conditional ? `Visas bara på villkor (fältet ${conditional}). ` : ""}{hidden.length ? `Döljs i ${hidden.join(" och ")}. ` : ""}{issues ? <span className="text-amber-700">{issues} att rätta.</span> : null}</p> : null}
    {selected && formBlockCanBeNarrow(block) ? <span aria-hidden="true" title="Dra för att ändra bredd" onPointerDown={startResize} onClick={(event) => event.stopPropagation()}
      className="absolute -right-2 top-1/2 z-20 flex h-10 w-3 -translate-y-1/2 cursor-ew-resize touch-none items-center justify-center rounded-full border bg-card shadow-sm hover:border-primary" data-testid="resize-handle">
      <span className="h-5 w-0.5 rounded bg-primary" />
    </span> : null}
    {resizing ? <span className="absolute -bottom-3 right-2 z-20 rounded bg-primary px-1.5 py-0.5 text-[11px] font-semibold text-primary-foreground">{FORM_WIDTH_LABEL[resizing]} ({FORM_WIDTH_SPAN[resizing]}/12)</span> : null}
  </div>;
}
