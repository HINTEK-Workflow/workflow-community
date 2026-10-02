import { rgb } from "pdf-lib";
import { formatDurationSeconds } from "@/lib/workflow/duration";
import { formatSwedish } from "@/lib/swedish-time";
import { formRowStarted, evaluateForm, formApprovalTotals, formBand, formCanDeviate, formBlockSpan, formBlockVisible, formCompletion, formConditionMet, formLeafBlocks, formLimitFor, formLimitText, formRowLabel, formSectionActive, formSectionShown, type FormBlock, type FormColumn, type FormDocument, type FormEvaluation, type FormLeafBlock, type FormBand, type FormTableBlock, type FormValues } from "./form-document";
import { formatFormulaValue, formatResultValue, type FormulaValue } from "./form-formula";
import { REPORT_TONES, assessmentCell, checkpointCell, CONTENT_WIDTH, createReportKit, MARGIN, wrap, type KitAttachment, type KitColor, type KitColumn, type KitIdentity, type ReportKit } from "./report-kit";
import type { WorkflowReportOptions, WorkflowReportTask } from "./report";

/**
 * A protocol from a form, drawn like the Kontroll före idrifttagning report (2026-09-27: the control's report is
 * the model for every form report): the same heading, fact boxes, measurement tables, cards, tick boxes, summary box,
 * list of attachments, chapter pages, pictures on their own pages and footer, in the company's report colours with its
 * logo. Everything is drawn from the protocol's own copy of the form and computed with the shared engine; nothing in
 * the form is executed. `blank` prints the protocol as an empty form to fill in by hand (the control's "tom mall").
 */
type FormDetails = Extract<WorkflowReportTask["data"], { kind: "FORM" }>["details"];
type Attachment = WorkflowReportTask["attachments"][number];
type Row = FormValues["tables"][string][number];

const danger = rgb(0.62, 0.16, 0.14);
// Level colours as in today's risk report: green, yellow, orange and red fills; red text for high levels.
const BAND_FILL: Record<FormBand["tone"], ReturnType<typeof rgb>> = { neutral: rgb(1, 1, 1), success: rgb(0.82, 0.96, 0.88), warning: rgb(1, 0.95, 0.75), danger: rgb(1, 0.88, 0.76), critical: rgb(0.99, 0.83, 0.83) };
// Room for what follows a heading: a row of fact boxes or a table header with one row, and the summary box.
const SECTION_KEEP = 50;
const SUMMARY_KEEP = 72;
const bandTone = (band: FormBand | null) => band && (band.tone === "danger" || band.tone === "critical") ? danger : undefined;
/** A computed value with its level, e.g. "15 · Hög". */
const withBand = (text: string, band: FormBand | null) => band?.label && text ? `${text} · ${band.label}` : text;
const draft = rgb(0.62, 0.38, 0.02);
/** A checkpoint to tick by hand in the blank form, like the control's ☐ for Godkänd. */
const BLANK_CHECKPOINT = "☐ OK ☐ Ej OK ☐ Ej akt.";
const reportTime = (value: string | Date) => formatSwedish(value, { dateStyle: "short", timeStyle: "short" });
const statusLabel = (status: WorkflowReportTask["status"]) => ({ PLANNED: "Planerad", IN_PROGRESS: "Pågår", PAUSED: "Pausad", NEEDS_ACTION: "Behöver åtgärdas", COMPLETED: "Slutförd" } as const)[status];

/** A form answer as text: Ja/Nej/Ej aktuellt, lists joined, date and time without the T. */
export function formAnswer(value: unknown, unit = "") {
  if (Array.isArray(value)) return value.join(", ") || "–";
  if (value === "YES") return "Ja";
  if (value === "NO") return "Nej";
  if (value === "NA") return "Ej aktuellt";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return value.replace("T", " ").slice(0, 16);
  return formatFormulaValue((value ?? null) as FormulaValue, unit) || "–";
}

/** An answer for the PDF; an empty one is left to the kit, which prints the control's long dash. */
const answer = (value: unknown, unit = "") => { const text = formAnswer(value, unit); return text === "–" ? "" : text; };

// Relative widths of table columns in the PDF, by kind of answer, unless the column sets its own.
const WEIGHT_POINTS = 60;
const COLUMN_WEIGHT: Record<FormColumn["input"], number> = { text: 1.5, textarea: 2, number: 1, choice: 1.2, yesno: 0.8, formula: 1, date: 1, images: 0.8, check: 0.8, assessment: 0.6, scale: 1 };

type Context = {
  kit: ReportKit; document: FormDocument; values: FormValues; evaluation: FormEvaluation; options: WorkflowReportOptions; blank: boolean;
  attachments: Attachment[]; placed: Set<string>; listed: (KitAttachment & { number: number; id?: string })[]; attachmentsListed: boolean; completion: number;
};

export async function createFormProtocolPdf(input: { identity: KitIdentity; fontBytes: Uint8Array; task: WorkflowReportTask; options: WorkflowReportOptions; createdAt?: Date; blank?: boolean }) {
  const { task, options } = input;
  if (task.data.kind !== "FORM") throw new Error("Rapporten gäller bara formulärprotokoll.");
  const details: FormDetails = task.data.details;
  const { document, values } = details;
  const blank = input.blank === true;
  const createdAt = input.createdAt ?? new Date();
  const title = document.report.title || "Protokoll";
  const code = task.version && !blank ? `${document.report.code ? `${document.report.code} · ` : ""}Version ${task.version}` : document.report.code || `Version ${details.templateVersion}`;
  const kit = await createReportKit({ identity: input.identity, fontBytes: input.fontBytes, overline: details.templateName.toUpperCase(), continuation: `${title} · fortsättning` });
  kit.pdf.setTitle(blank ? `${details.templateName} – tom mall` : `${details.templateName} – ${task.title}`);
  kit.pdf.setAuthor(input.identity.company || "HINTEK Workflow");
  kit.pdf.setCreator("HINTEK Workflow");
  kit.pdf.setProducer("HINTEK Workflow");
  kit.pdf.setSubject(`${details.templateName} · ${code}`);
  kit.pdf.setCreationDate(createdAt);

  const evaluation = evaluateForm(document, values);
  const labels = attachmentLabels(document, values);
  const context: Context = {
    kit, document, values, evaluation, options, blank, attachments: task.attachments, placed: new Set(), attachmentsListed: false,
    listed: task.attachments.map((item, index) => ({ filename: item.filename, mimeType: item.mimeType, bytes: item.bytes, label: (item.id && labels.get(item.id)) || "Bilaga", number: index + 1, id: item.id })),
    completion: formCompletion(document, values).percent,
  };

  kit.firstPage(title, code);
  // An unfinished protocol is marked on the first page (reports mark drafts clearly), without moving anything.
  if (task.status !== "COMPLETED" && !blank) kit.text("· ÖGONBLICKSBILD – EJ SLUTFÖRT", MARGIN + kit.font.widthOfTextAtSize(`${code} `, 7), 763, { size: 7, color: draft });

  if (options.summary && document.report.taskFacts) {
    const show = (value: string) => blank ? "" : value;
    kit.factBoxes([
      { label: "Uppgift", value: show(task.title), soft: true },
      { label: "Projekt", value: show(task.projectName || "Fristående uppgift") },
      { label: "Kund", value: show(task.customerName || "Ingen kund") },
      ...(task.facilityName ? [{ label: "Anläggning", value: show(task.facilityName) }] : []),
      ...(task.siteName ? [{ label: "Plats", value: show(task.siteName) }] : []),
      { label: "Ansvarig", value: show(task.assignedToName || "Inte tilldelad") },
      ...(task.dueDate ? [{ label: "Klart senast", value: show(task.dueDate) }] : []),
      { label: "Status", value: show(`${statusLabel(task.status)} · ${task.status === "COMPLETED" ? 100 : task.progress}% klart`) },
      ...(options.time ? [{ label: "Rapporterad tid", value: show(formatDurationSeconds(task.totalDurationSec)) }] : []),
      ...(task.description ? [{ label: "Beskrivning", value: show(task.description), span: 12 }] : []),
    ]);
    if (task.projectFields?.length) {
      kit.blockTitle("Projektets uppgifter");
      kit.factBoxes(task.projectFields.map(([label, value]) => ({ label, value: show(value), span: value.length > 60 ? 12 : value.length > 28 ? 8 : 4 })));
    }
  }

  if (options.execution) {
    let loose: FormLeafBlock[] = [];
    const flush = async () => { if (loose.length) await drawLeaves(context, loose, ""); loose = []; };
    for (const block of document.blocks) {
      if (block.type === "section") { await flush(); if (blank ? formSectionActive(block, values) : formSectionShown(document, block, values)) await drawSection(context, block); }
      else if (block.type === "columns") { await flush(); await drawLeaves(context, interleave(block), ""); }
      else loose.push(block);
    }
    await flush();
  }

  // The limits the protocol was judged by (2026-09-28): values, where they come from and whether they are the facility's.
  if (options.execution && document.limits.length) drawLimits(context);

  // A form without its own Sammanfattning gets one after the form, like the control.
  const placedSummary = options.execution && formLeafBlocks(document).some((block) => block.type === "summary" && formBlockVisible(block, "pdf"));
  if (options.deviations && !placedSummary && formCanDeviate(document)) drawSummary(context, "Sammanfattning / avvikelser");
  if (!context.attachmentsListed && options.attachments && !blank) kit.attachmentList(context.listed, attachmentsNote(context));
  if (options.images && !blank) await kit.attachmentPages(context.listed.filter((item) => !item.id || !context.placed.has(item.id)));

  // The footer shows the protocol's own date, like the control ("odaterad" while it is empty).
  const dateField = formLeafBlocks(document).find((block) => block.type === "field" && (block.input === "date" || block.input === "datetime"));
  const dateValue = dateField && dateField.type === "field" ? values.fields[dateField.key] : null;
  const date = dateField ? (typeof dateValue === "string" && dateValue ? dateValue.slice(0, 10) : "odaterad") : formatSwedish(createdAt, { dateStyle: "short" });
  kit.footer(`${code} · ${date}`);
  return kit.pdf.save();
}

/** Where each attached file sits in the form, for the list of attachments: the row, the object card or the picture block. */
function attachmentLabels(document: FormDocument, values: FormValues) {
  const labels = new Map<string, string>();
  for (const section of document.blocks) for (const block of section.type === "section" ? section.blocks : section.type === "columns" ? section.columns.flat() : [section]) {
    // Pictures printed after the protocol are named after their section, like the control ("Visuell kontroll").
    if (block.type === "images") for (const id of values.images[block.key] ?? []) labels.set(id, !block.pdfInline && section.type === "section" && section.title ? section.title : block.label);
    if (block.type === "table") for (const [index, row] of (values.tables[block.key] ?? []).entries())
      for (const column of block.columns.filter((item) => item.input === "images")) {
        const cell = row.cells[column.key];
        if (Array.isArray(cell)) for (const id of cell) labels.set(id, block.layout === "cards"
          ? `${block.label} · ${formRowLabel(block, row, index)} · ${column.label}`
          : `${block.label} · Rad ${index + 1}${rowName(block, row) ? ` (${rowName(block, row)})` : ""}`);
      }
  }
  return labels;
}

/** A row's own name: its fixed label or its first text value, like the control's "Rad 2 (Grupp 2 – uttag kök)". */
/**
 * The column that names a card in the PDF: the first free-standing text column, else the first long text (the risk
 * assessment's "Risk eller fara"). A column in a group ("Handlingsplan: Ansvarig för åtgärd") is a detail, never the
 * name (totalkontrollen F4, 2026-09-29).
 */
function nameColumnOf(table: FormTableBlock) {
  return table.columns.find((column) => column.input === "text" && !column.group && column.pdf !== "hide")
    ?? table.columns.find((column) => column.input === "textarea" && !column.group && column.pdf !== "hide");
}
function rowName(table: FormTableBlock, row: Row) {
  if (row.label) return row.label;
  const first = nameColumnOf(table);
  const value = first ? row.cells[first.key] : null;
  if (typeof value !== "string") return "";
  const text = value.trim().replace(/\s+/g, " ");
  return text.length > 90 ? `${text.slice(0, 87).replace(/\s+\S*$/, "")}…` : text;
}

function interleave(block: Extract<FormBlock, { type: "columns" }>): FormLeafBlock[] {
  const out: FormLeafBlock[] = [];
  for (let row = 0; row < Math.max(...block.columns.map((column) => column.length)); row++)
    for (const column of block.columns) if (column[row]) out.push("width" in column[row] ? { ...column[row], width: block.columns.length === 3 ? "third" : "half" } as FormLeafBlock : column[row]);
  return out;
}

/** Room kept under a section heading (2026-09-28): the first card of object cards, else a table header with a row. */
function sectionKeep(context: Context, section: Extract<FormBlock, { type: "section" }>) {
  const shown = section.blocks.filter((block) => formBlockVisible(block, "pdf") && block.type !== "pagebreak");
  // Leading help texts and headings travel with the heading, so they count too.
  const lead = shown.findIndex((block) => block.type !== "text" && block.type !== "heading");
  const leadRoom = shown.slice(0, Math.max(0, lead)).reduce((sum, block) => sum + (block.type === "text" ? wrap(context.kit.font, block.text, 7.4, CONTENT_WIDTH).length * 10 + 8 : 22), 0);
  const first = lead < 0 ? undefined : shown[lead];
  if (first?.type === "table" && first.layout === "cards") { const rows = tableRows(context, first); return leadRoom + (rows[0] ? Math.max(116, objectCard(context, first, rows[0], 0).keep + (first.label !== section.title ? 24 : 0)) : 116); }
  return leadRoom + (first?.type === "table" ? 55 : SECTION_KEEP);
}

async function drawSection(context: Context, section: Extract<FormBlock, { type: "section" }>) {
  const { kit } = context;
  if (section.pdfStyle === "chapter") kit.chapter(section.title, section.description);
  else {
    if (section.newPage && kit.y < 740) kit.addPage();
    if (section.title && section.pdfStyle !== "untitled") kit.blockTitle(section.title, section.description || undefined, sectionKeep(context, section));
    else if (section.description && section.pdfStyle !== "untitled") kit.paragraph(section.description);
  }
  await drawLeaves(context, section.blocks, section.title);
}

type Fact = { label: string; value: string; span: number; tone?: KitColor; soft?: boolean };

/** A simple block as a fact box, or null when the block is drawn in its own way. */
function fact(context: Context, block: FormLeafBlock): Fact | null {
  const { values, evaluation, blank } = context;
  const span = formBlockSpan(block);
  if (block.type === "field") {
    const deviation = evaluation.deviations.some((item) => item.key === block.key && !item.rowId);
    const warning = evaluation.alerts.some((item) => item.key === block.key && !item.rowId);
    const remark = block.remarks ? values.remarks[block.key] : undefined;
    const value = [answer(values.fields[block.key]), remark?.comment.trim() ? `Kommentar: ${remark.comment.trim()}` : "", remark?.deviation ? "AVVIKELSE" : ""].filter(Boolean).join(" · ");
    return { label: `${block.pdfLabel || block.label}${block.unit ? ` (${block.unit})` : ""}`, value: blank ? "" : value, span, tone: blank ? undefined : deviation ? danger : warning ? draft : undefined, soft: block.highlight };
  }
  if (block.type === "computed") {
    const deviation = evaluation.deviations.some((item) => item.key === block.key);
    const value = evaluation.computed[block.key] ?? null;
    const band = formBand(block.bands, value);
    return { label: block.label, value: blank ? "" : withBand(formatResultValue(value, block.unit, block.passCondition), band), span, tone: blank ? undefined : deviation ? danger : bandTone(band) };
  }
  if (block.type === "signature") {
    const signature = values.signatures[block.key];
    return { label: block.label, value: blank ? "" : `${signature?.name || "—"} · ${signature?.confirmed ? `bekräftad${signature.signedAt ? ` ${reportTime(signature.signedAt)}` : ""}` : "inte bekräftad"}`, span };
  }
  return null;
}

async function drawLeaves(context: Context, blocks: FormLeafBlock[], sectionTitle: string) {
  const { kit, options, values } = context;
  // A block hidden by its condition is not printed – except in a blank form, where every block is there to fill in by hand.
  // The list of attachments follows the section with the summary, after its signatures (2026-09-30), like the control.
  let summaryHere = false;
  const shown = blocks.filter((block) => formBlockVisible(block, "pdf") && (block.type !== "signature" || options.approval) && (block.type !== "summary" || options.deviations) && (context.blank || !("showIf" in block) || formConditionMet(context.document, values, block.showIf)));
  for (let index = 0; index < shown.length; index++) {
    const block = shown[index];
    const first = fact(context, block);
    if (first) {
      // Consecutive simple blocks share rows of fact boxes, like the control's Grunduppgifter.
      const facts = [first];
      while (index + 1 < shown.length) {
        const next = fact(context, shown[index + 1]);
        if (!next) break;
        facts.push(next);
        index++;
      }
      kit.factBoxes(facts.map((item) => ({ label: item.label, value: item.value, span: item.span, tone: item.tone, soft: item.soft })));
      continue;
    }
    // A block named like its section is not titled twice.
    const heading = (label: string, keep = 60) => { if (label && label !== sectionTitle) kit.subTitle(label, 10, keep); };
    if (block.type === "pagebreak") { if (kit.y < 740) kit.addPage(); }
    else if (block.type === "heading") kit.subTitle(block.text, block.level === 1 ? 11.5 : block.level === 2 ? 10 : 9);
    else if (block.type === "text") kit.paragraph(block.text);
    else if (block.type === "matrix") {
      heading(block.label, 60 + block.size * 24);
      const sorted = [...block.bands].sort((a, b) => a.from - b.from);
      kit.matrix({ size: block.size, xLabel: block.xLabel, yLabel: block.yLabel, fill: (value) => BAND_FILL[formBand(block.bands, value)?.tone ?? "neutral"],
        legend: sorted.filter((band) => band.label).map((band) => ({ label: band.label, color: BAND_FILL[band.tone] })) });
    }
    else if (block.type === "note") kit.infoCard(block.title, block.text.split(/\r?\n/).filter((line) => line.trim()));
    else if (block.type === "summary") { if (block.label !== sectionTitle) kit.blockTitle(block.label, undefined, SUMMARY_KEEP); drawSummaryBox(context); summaryHere = true; }
    else if (block.type === "checklist" && block.mode === "check") {
      heading(block.label);
      kit.checkBoxes(block.items.map((item) => ({ label: item.text, checked: !context.blank && values.checklists[block.key]?.[item.id]?.state === "OK" })));
    } else if (block.type === "checklist") {
      heading(block.label);
      const answers = values.checklists[block.key] ?? {};
      kit.table(block.label, widths([["item", "Kontrollpunkt", 3], ["state", "Bedömning", context.blank ? 1.5 : 1, true], ["comment", "Kommentar", 2]]),
        block.items.map((item) => { const answered = context.blank ? undefined : answers[item.id]; return [item.text, context.blank ? BLANK_CHECKPOINT : checkpointCell(answered?.state).text, answered?.comment || ""]; }),
        [], block.items.map((item) => [undefined, context.blank ? undefined : checkpointCell(answers[item.id]?.state).tone, undefined]));
      // A point's pictures (2026-09-28) right under the checklist, captioned with the point.
      const chosen = options.images && !context.blank ? block.items.flatMap((item) => pictures(context, answers[item.id]?.images ?? []).map((picture) => ({ picture, caption: `${item.text} · ${picture.filename}` }))) : [];
      if (chosen.length) { kit.y += 4; await kit.imageRow(chosen.map(({ picture, caption }) => ({ bytes: picture.bytes!, caption }))); chosen.forEach(({ picture }) => picture.id && context.placed.add(picture.id)); }
    } else if (block.type === "table" && block.layout === "cards") {
      const rows = tableRows(context, block);
      heading(block.label, rows[0] ? objectCard(context, block, rows[0], 0).keep : 20);
      await drawCards(context, block);
    } else if (block.type === "table") { heading(block.label); drawGrid(context, block); }
    else if (block.type === "images") {
      const chosen = pictures(context, values.images[block.key] ?? []);
      if (block.pdfInline && options.images && chosen.length && !context.blank) {
        heading(block.label);
        await kit.imageRow(chosen.map((item) => ({ bytes: item.bytes!, caption: item.filename })));
        chosen.forEach((item) => item.id && context.placed.add(item.id));
      } else if (block.pdfInline && (context.blank || (values.images[block.key] ?? []).length)) kit.paragraph(`${block.label}: ${block.accept === "files" ? "se bilagor" : "se bilder"} nedan.`);
    }
  }
  // A form with limits lists its attachments after Gränsvärden, at the very end.
  if (summaryHere && !context.document.limits.length) drawAttachmentList(context);
}

/** Column widths in points from relative weights, filling the content width. */
function widths(columns: [key: string, label: string, weight: number, center?: boolean][]): KitColumn[] {
  const total = columns.reduce((sum, item) => sum + item[2], 0);
  return columns.map(([key, label, weight, center]) => ({ key, label, width: weight / total * CONTENT_WIDTH, center }));
}

/** The rows to print: the protocol's rows, or – with none – an empty one (two in a blank form), like the control. */
function tableRows(context: Context, table: FormTableBlock): Row[] {
  const rows = context.values.tables[table.key] ?? [];
  if (rows.length) return rows;
  return Array.from({ length: context.blank ? 2 : 1 }, (_, index) => ({ id: `tom-${index + 1}`, label: "", cells: {} }));
}

/**
 * A cell as text (docs/rapportprinciper.md): a Godkänd as Godkänd / Ej godkänd – empty while the row has nothing to judge –
 * a tick box as the fact Ja/Nej, a formula with its unit, pictures counted.
 */
function cellText(context: Context, table: FormTableBlock, row: Row, column: FormColumn) {
  if (context.blank) return column.input === "assessment" ? "☐" : "";
  if (column.input === "assessment") return assessmentCell(judgedValue(context.evaluation, table, row, column.key)).text;
  if (column.input === "check") return row.cells[column.key] === true ? "Ja" : "Nej";
  if (column.input === "formula") { const value = context.evaluation.cells[table.key]?.[row.id]?.[column.key] ?? null; return withBand(formatResultValue(value, column.unit, column.passCondition), formBand(column.bands, value)); }
  if (column.input === "scale") { const step = Number(row.cells[column.key]); return Number.isInteger(step) && step >= 1 ? `${step}${column.options[step - 1] ? ` · ${column.options[step - 1]}` : ""}` : ""; }
  if (column.input === "images") { const cell = row.cells[column.key]; return Array.isArray(cell) && cell.length ? `${cell.length} ${cell.length === 1 ? "bild" : "bilder"}` : ""; }
  return answer(row.cells[column.key]);
}

/** Whether a row has anything to judge: a placeholder row or an untouched row is not assessed ("—", never "Ej godkänd"). */
const rowJudged = (table: FormTableBlock, row: Row) => !row.id.startsWith("tom-") && formRowStarted(table, row);
/** Approved, not approved, or not assessed (null): an untouched row, or an unticked Godkänd by hand (F7, 2026-09-29). */
const judgedValue = (evaluation: FormEvaluation, table: FormTableBlock, row: Row, key: string) => {
  const value = evaluation.cells[table.key]?.[row.id]?.[key];
  return rowJudged(table, row) && typeof value === "boolean" ? value : null;
};

/** Printed columns: hidden ones left out and "join" columns merged into the one before ("24 / 26 ms"). */
function printedColumns(table: FormTableBlock) {
  const groups: { columns: FormColumn[]; label: string }[] = [];
  for (const column of table.columns) {
    if (column.pdf === "hide") continue;
    if (column.pdf === "join" && groups.length) { groups.at(-1)!.columns.push(column); continue; }
    groups.push({ columns: [column], label: column.pdfLabel || `${column.label}${column.unit && column.input !== "formula" ? ` (${column.unit})` : ""}` });
  }
  return groups;
}

/** A free row nobody wrote anything in is left out of the grid, so a forgotten extra row does not print as "— —". */
const emptyFreeRow = (table: FormTableBlock, row: Row) => table.rowMode === "free" && !row.label && !row.example
  && Object.values(row.cells).every((value) => value === null || value === undefined || value === "" || value === false || (Array.isArray(value) && !value.length));

function drawGrid(context: Context, table: FormTableBlock) {
  const { kit, evaluation } = context;
  const filled = tableRows(context, table).filter((row) => context.blank || !emptyFreeRow(table, row));
  const rows = filled.length ? filled : tableRows({ ...context, values: { ...context.values, tables: { ...context.values.tables, [table.key]: [] } } }, table);
  const fixed = table.rowMode === "fixed";
  const groups = printedColumns(table);
  // A pdfWidth is in points and a weight is a share (2026-09-30: Automatisk frånkoppling printed its columns one
  // letter wide beside a 54 pt Godkänd). When a table mixes them, a weight counts as WEIGHT_POINTS points.
  const scale = groups.some((group) => group.columns[0].pdfWidth) ? WEIGHT_POINTS : 1;
  const columns: KitColumn[] = widths([
    ...(fixed ? [["__row", "Rad", scale] as [string, string, number]] : []),
    ...groups.map((group) => [group.columns[0].key, group.label, group.columns[0].pdfWidth ?? COLUMN_WEIGHT[group.columns[0].input] * scale, group.columns[0].input === "assessment" || (group.columns[0].input === "formula" && group.columns[0].passCondition)] as [string, string, number, boolean]),
  ]);
  // The example text goes in the comment column: the first long text, else the last text column.
  const commentKey = (table.columns.find((column) => column.input === "textarea" && column.pdf !== "hide") ?? table.columns.filter((column) => column.input === "text" && column.pdf !== "hide").at(-1))?.key;
  const body = rows.map((row, index) => [...(fixed ? [row.label || `Rad ${index + 1}`] : []), ...groups.map((group) => {
    const text = group.columns.map((column) => cellText(context, table, row, column) || (group.columns.length > 1 ? "—" : "")).join(" / ");
    return group.columns[0].key === commentKey && row.example && !context.blank ? `EXEMPELDATA – ${text || "—"}` : text;
  })]);
  // A row is coloured for a measured deviation; a row that is only not approved says so in its Godkänd cell, in colour.
  const tones = rows.map((row) => !context.blank && evaluation.deviations.some((item) => item.key === table.key && item.rowId === row.id && item.kind !== "assessment") ? danger : undefined);
  const judged = groups.findIndex((group) => group.columns[0].input === "assessment") + (fixed ? 1 : 0);
  const cellTones = rows.map((row) => judged < (fixed ? 1 : 0) || context.blank ? undefined : Object.assign([], { [judged]: assessmentCell(judgedValue(evaluation, table, row, groups[judged - (fixed ? 1 : 0)].columns[0].key)).tone }) as (typeof danger | undefined)[]);
  const totals = evaluation.totals[table.key];
  if (totals && !context.blank) body.push([...(fixed ? ["Summering"] : []), ...groups.map((group, index) => group.columns[0].key in totals ? formatFormulaValue(totals[group.columns[0].key], group.columns[0].unit) : !fixed && index === 0 ? "Summering" : "")]);
  // No word broken in the middle: narrow columns get room from wide ones, a very wide table prints smaller (2026-09-30).
  const fitted = kit.fitColumns(columns, body);
  kit.table(table.label, fitted.columns, body, tones, cellTones, fitted.sizes);
}

const pictures = (context: Context, ids: string[]) => ids.map((id) => context.attachments.find((item) => item.id === id)).filter((item): item is Attachment => Boolean(item?.bytes && item.mimeType.startsWith("image/")));

/** A card value like the control's: the value and its unit, Ja/Nej for a tick box, the long dash when empty. */
function metricText(context: Context, table: FormTableBlock, row: Row, column: FormColumn) {
  const text = cellText(context, table, row, column);
  if (!text || context.blank || column.input === "check" || column.input === "formula" || !column.unit) return text;
  return `${text} ${column.unit}`;
}

/** The card's heading from the form's template ("{placering} · {profil} · typ {typ}"), or the object's name. */
function cardTitle(context: Context, table: FormTableBlock, row: Row, index: number) {
  const itemLabel = table.itemLabel || "Objekt";
  if (context.blank) return `${itemLabel} ${index + 1}`;
  if (table.cardTitle) return table.cardTitle.replace(/\{([^}]*)\}/g, (_, key: string) => {
    const column = table.columns.find((item) => item.key === key.trim());
    return (column ? cellText(context, table, row, column) : "") || "—";
  });
  const name = rowName(table, row);
  return `${itemLabel} ${index + 1}${name ? `: ${name}` : ""}`;
}

/** One object card: its title, values, result, comment and pictures, and the height it needs with its first pictures. */
function objectCard(context: Context, table: FormTableBlock, row: Row, index: number) {
  const { kit, evaluation, options } = context;
  const titled = new Set([...table.cardTitle.matchAll(/\{([^}]*)\}/g)].map((match) => match[1].trim()));
  const nameColumn = nameColumnOf(table);
  const named = !table.cardTitle && Boolean(rowName(table, row)) && !row.label;
  // A long text that already names the card is still printed in full below, where it is labelled.
  const assessment = table.columns.find((column) => column.input === "assessment");
  const texts = table.columns.filter((column) => column.input === "textarea" && column.pdf !== "hide");
  const groups = printedColumns(table).filter((group) => {
    const column = group.columns[0];
    return !["textarea", "images", "assessment"].includes(column.input) && !titled.has(column.key) && !(named && column === nameColumn);
  });
  const deviation = !context.blank && evaluation.deviations.some((item) => item.key === table.key && item.rowId === row.id && item.kind !== "assessment");
  // The card always names its judgement (2026-09-30: "texten Godkänd saknas på JFB"): a row not judged yet
  // says "Godkänd: —" in grey – never "Ej godkänd" – and the blank template has a box to tick.
  const judged = assessment && !context.blank ? assessmentCell(judgedValue(evaluation, table, row, assessment.key)) : null;
  const unjudged = judged !== null && !judged.text;
  const comment = texts.length ? texts.map((column) => `${column.label}: ${context.blank ? "" : answer(row.cells[column.key]) || "—"}`).join("\n") : null;
  const card = {
    title: cardTitle(context, table, row, index),
    result: context.blank && assessment ? `${assessment.label} ☐` : judged ? (unjudged ? `${assessment!.label}: —` : judged.text) : deviation ? "Avvikelse" : "",
    metrics: groups.map((group) => ({
      label: group.label,
      value: context.blank ? "" : group.columns.length > 1
        ? `${group.columns.map((column) => cellText(context, table, row, column) || "—").join(" / ")}${group.columns[0].unit ? ` ${group.columns[0].unit}` : ""}`
        : metricText(context, table, row, group.columns[0]),
      tone: context.blank || group.columns[0].input !== "formula" ? undefined : bandTone(formBand(group.columns[0].bands, evaluation.cells[table.key]?.[row.id]?.[group.columns[0].key] ?? null)),
    })),
    comment,
  };
  const layout = { valueLines: 2, resultTone: assessment ? (judged ? (unjudged ? REPORT_TONES.muted : judged.tone) : undefined) : danger, commentLines: comment ? Math.min(8, comment.split("\n").reduce((sum, paragraph) => sum + wrap(kit.font, paragraph, 6.8, CONTENT_WIDTH - 16).length, 0)) : 2 };
  const images = options.images && !context.blank ? table.columns.filter((column) => column.input === "images" && column.pdf !== "hide").flatMap((column) => {
    const cell = row.cells[column.key];
    return pictures(context, Array.isArray(cell) ? cell : []).map((item) => ({ item, caption: `${column.label} · ${item.filename}` }));
  }) : [];
  // An object's first pictures stay on the same page as its card.
  return { card, layout, images, keep: kit.cardHeight(card, layout).height + 13 + (images.length ? 190 : 0) };
}

/**
 * Object cards drawn as the control's cards: the title bar with the result, the values seven to a row, free texts as
 * the comment and the pictures right below, so value and picture are read together.
 */
async function drawCards(context: Context, table: FormTableBlock) {
  const { kit } = context;
  for (const [index, row] of tableRows(context, table).entries()) {
    const { card, layout, images, keep } = objectCard(context, table, row, index);
    if (images.length) kit.ensure(keep);
    kit.card(card, layout);
    if (images.length) {
      kit.y += 7;
      await kit.imageRow(images.map(({ item, caption }) => ({ bytes: item.bytes!, caption })));
      images.forEach(({ item }) => item.id && context.placed.add(item.id));
    }
  }
}

/**
 * Sammanfattning / avvikelser: approved per moment (the control's "Isolation: 3/4 godkända"), other deviations, the
 * comment and the degree of completion – or an empty box in a blank form.
 */
function drawSummaryBox(context: Context) {
  const { kit, document, values, evaluation, blank } = context;
  if (blank) { kit.textBox([""]); return; }
  const totals = formApprovalTotals(document, values, evaluation);
  const others = evaluation.deviations.filter((item) => item.kind !== "assessment");
  const shown = others.slice(0, 8);
  kit.textBox([
    ...totals.map((item) => `${item.title}: ${item.ok}/${item.total} godkända`),
    ...(others.length && !totals.length ? [`${others.length === 1 ? "1 avvikelse" : `${others.length} avvikelser`}:`] : []),
    ...shown.map((item) => `• ${item.message}`),
    ...(others.length > shown.length ? [`… och ${others.length - shown.length} till, markerade ovan.`] : []),
    ...evaluation.alerts.slice(0, 6).map((item) => `• Varning: ${item.message}`),
    values.deviationComment || (!totals.length && !others.length ? "Inga avvikelser." : "Inga ytterligare kommentarer."),
    `Kompletteringsgrad: ${context.completion}%`,
  ]);
}

function drawSummary(context: Context, title: string) {
  context.kit.blockTitle(title, undefined, SUMMARY_KEEP);
  drawSummaryBox(context);
}

const ORIGIN_TEXT = { form: "Formuläret", facility: "Anläggningen", object: "Objektet" } as const;

/** Gränsvärden: each limit with its alarm and warning range, its source and whether it is the form's or the facility's. */
function drawLimits(context: Context) {
  const { kit, document, values, blank } = context;
  const resolved = document.limits.map((limit) => formLimitFor(document, blank ? {} : values, limit.key));
  // No level set for the facility (2026-09-30: two pages of "ej angivet"): one line instead of the table.
  if (!blank && resolved.every((value) => !value || [value.low, value.high, value.warnLow, value.warnHigh].every((number) => number === null || number === undefined))) {
    kit.blockTitle("Gränsvärden", undefined, 30);
    kit.paragraph(`Inga larm- eller varningsnivåer var angivna för anläggningen när protokollet fylldes i, så ${document.limits.length === 1 ? "värdet" : "värdena"} har inte bedömts mot gränsvärden.`);
    return;
  }
  kit.blockTitle("Gränsvärden", "Larm- och varningsnivåer som protokollet bedömts mot.", SECTION_KEEP);
  kit.table("Gränsvärden", widths([["name", "Storhet", 2.2], ["alarm", "Larm", 1.4], ["warning", "Varning", 1.4], ["source", "Källa", 2.2], ["origin", "Gäller från", 1]]),
    document.limits.map((limit) => {
      const value = formLimitFor(document, blank ? {} : values, limit.key);
      return [`${limit.label}${limit.unit ? ` (${limit.unit})` : ""}`, value ? formLimitText(value.low, value.high, limit.unit) : "", value ? formLimitText(value.warnLow, value.warnHigh, limit.unit) : "", value?.source || limit.source, value ? ORIGIN_TEXT[value.origin] : ""];
    }));
}

/**
 * What the list says about the files (2026-09-30): the control's "… följer efter protokollet" while every file follows,
 * and where they are when pictures were already printed in the protocol.
 */
function attachmentsNote(context: Context) {
  const total = context.listed.length;
  const following = context.listed.filter((item) => !item.id || !context.placed.has(item.id)).length;
  if (following === total) return undefined;
  if (!following) return total === 1 ? "Bilden visas i protokollet ovan." : "Bilderna visas i protokollet ovan.";
  return `${following} av ${total} filer följer efter protokollet; övriga visas ovan.`;
}

/** The numbered list of attachments, right after the summary like the control; never in a blank form. */
function drawAttachmentList(context: Context) {
  if (context.attachmentsListed || !context.options.attachments || context.blank) return;
  context.kit.attachmentList(context.listed, attachmentsNote(context));
  context.attachmentsListed = true;
}
