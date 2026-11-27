import { formatDurationSeconds } from "@/lib/workflow/duration";
import { formatSwedish } from "@/lib/swedish-time";
import { FINAL_VERDICT_LABELS, formFieldLacksLimit, formFilledIn, formProgress, formRowTechnicianJudged, technicianJudgedText, formRowStarted, formRowPending, evaluateForm, formApprovalResult, formBand, formCanDeviate, formBlockSpan, formBlockVisible, formCompletion, formConditionMet, formJudgesByLimits, formLeafBlocks, formLimitFor, formLimitText, formRowLabel, formSectionActive, formSectionShown, type FormBlock, type FormColumn, type FormDocument, type FormEvaluation, type FormLeafBlock, type FormBand, type FormTableBlock, type FormValues } from "./form-document";
import { formatFormulaValue, formatResultValue, type FormulaValue } from "./form-formula";
import { CONTINUED_ROOM, REPORT_TONES, assessmentCell, badgeOf, checkpointCell, CONTENT_WIDTH, continuationOf, createReportKit, mm, wrap, type KitAttachment, type KitCell, type KitColor, type KitColumn, type KitFact, type KitIdentity, type KitObject, type KitSignature, type ReportKit } from "./report-kit";
import type { ReportFontBytes } from "./report-fonts";
import type { WorkflowReportOptions, WorkflowReportTask } from "./report";
import { tempPlaceLabel, tempPlaceOf } from "./temp-place";
import { drawRiskStep } from "./risk-step-report";
import { pdfTexts } from "@/lib/pdf-templates/catalog";
import type { PdfTexts } from "@/lib/pdf-templates/model";

/**
 * A protocol from a form in the design Förslag B (2026-11-03; templates 09-kontrollprotokoll, 12-driftrond,
 * 10-skyddsrond, 11-riskbedömning and 08-egenkontroll for the blank form): the head with the company's logo, the protocol's
 * number and dates; the facts grid with customer, project, place and work order; the form's sections as plain headings with
 * facts grids, measurement tables (deviation rows tinted, the assessment as a status mark), object blocks, check lists, the
 * risk matrix; the summary as text; the final verdict in the one framed box; the signature block with the customer's
 * receipt; the list of attachments and the pictures. Everything is drawn from the protocol's own copy of the form and
 * computed with the shared engine; nothing in the form is executed. `blank` prints the form to fill in by hand: blank lines,
 * boxes to tick, ruled fields and a decision box.
 */
type FormDetails = Extract<WorkflowReportTask["data"], { kind: "FORM" }>["details"];
type Attachment = WorkflowReportTask["attachments"][number];
type Row = FormValues["tables"][string][number];

const danger = REPORT_TONES.fail;
/** The levels' order decides the colour: the lowest band green, then yellow, red, dark red (2026-11-03). */
const bandLevel = (bands: readonly FormBand[], band: FormBand | null) => {
  const sorted = [...bands].sort((a, b) => a.from - b.from);
  if (!band) return 1;
  const index = sorted.findIndex((item) => item === band);
  const steps = Math.max(1, sorted.length - 1);
  return Math.min(4, Math.max(1, 1 + Math.round((index / steps) * 3)));
};
const bandTone = (band: FormBand | null) => band && (band.tone === "danger" || band.tone === "critical") ? danger : undefined;
/** A computed value with its level, e.g. "15 · Hög". */
const withBand = (text: string, band: FormBand | null) => band?.label && text ? `${text} · ${band.label}` : text;
const draft = REPORT_TONES.warning;
const reportTime = (value: string | Date) => formatSwedish(value, { dateStyle: "short", timeStyle: "short" });
const reportDay = (value: string | Date) => formatSwedish(value, { dateStyle: "short" });
const statusLabel = (status: WorkflowReportTask["status"]) => ({ PLANNED: "Planerad", IN_PROGRESS: "Pågår", PAUSED: "Pausad", NEEDS_ACTION: "Behöver åtgärdas", COMPLETED: "Färdigställd", CANCELLED: "Utgått" } as const)[status];

/** A form answer as text: Ja/Nej/Ej aktuellt, lists joined, date and time without the T. */
export function formAnswer(value: unknown, unit = "") {
  if (Array.isArray(value)) return value.join(", ") || "–";
  if (value === "YES") return "Ja";
  if (value === "NO") return "Nej";
  if (value === "NA") return "Ej aktuellt";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return value.replace("T", " ").slice(0, 16);
  return formatFormulaValue((value ?? null) as FormulaValue, unit) || "–";
}

/** A number as typed with its decimal point, alone or with a unit ("0.4", "1.2 Vac"), in Swedish form; the stored value and all other text stay as they are. */
export const swedishDecimal = (text: string) => text.replace(/^(-?\d+)\.(\d+)(?=$|\s*[^\d\s.][^\s.]*$)/, "$1,$2");
/** An answer for the PDF; an empty one is left to the kit, which prints the long dash. */
const answer = (value: unknown, unit = "") => { const text = formAnswer(value, unit); return text === "–" ? "" : swedishDecimal(text); };

// Relative widths of table columns in the PDF, by kind of answer, unless the column sets its own.
const WEIGHT_POINTS = 60;
const COLUMN_WEIGHT: Record<FormColumn["input"], number> = { text: 1.5, textarea: 2, number: 1, choice: 1.2, yesno: 0.8, formula: 1, date: 1, images: 0.8, check: 0.8, assessment: 0.6, scale: 1 };
/** Facts and the signature right under them stay together up to this height; a taller run flows. */
const KEPT_FACTS = 200;
/** The word over a table's total row, by how the column is totalled: only a sum is a sum. */
const TOTAL_LABELS = { sum: "total.sum", min: "total.min", max: "total.max", avg: "total.avg" } as const;
/** A heading's first word, to see when the heading inside it only repeats it. */
const firstWord = (text: string) => text.trim().toLowerCase().split(/[\s/–-]+/)[0];

/** The family line of the head, from the template's name and area. */
export function formKind(templateName: string, formArea: string | null | undefined, blank: boolean, t: PdfTexts = pdfTexts("protocol")): string {
  const name = templateName.toLowerCase();
  const family = formArea === "risk-assessment" || name.includes("riskbedömning") ? "safety" : name.includes("skyddsrond") ? "safety" : /rond|tillsyn/.test(name) ? "round" : "control";
  if (blank) return t.text(`kind.blank.${family}`);
  return t.text(family === "safety" && name.includes("riskbedömning") ? "kind.risk" : `kind.${family}`);
}

type Context = {
  kit: ReportKit; document: FormDocument; values: FormValues; evaluation: FormEvaluation; options: WorkflowReportOptions; blank: boolean;
  attachments: Attachment[]; placed: Set<string>; listed: (KitAttachment & { number: number; id?: string })[]; attachmentsListed: boolean; completion: number;
  /** The linked place to name after the section with the facility field ("" = none or already shown), see placeFact. */
  place: string;
  /** Printed by the protocol template (beslut 6): the list of attachments then follows the signature block. */
  template: boolean;
  /** A blank form's decision box (Resultat) stands before the signature lines, as the template prints it. */
  blankDecisionDrawn?: boolean;
  /** PDF-mallar (2026-11-03): the protocol template's fixed texts, today's words by default. */
  t: PdfTexts;
  /** The form has no summary of its own, so one follows the form. */
  tailSummary?: boolean;
  /** The section Gränsvärden stands between the form and its end. */
  limitsInTail?: boolean;
  /** Room the summary's last lines keep under them for what ends the protocol. */
  summaryEnd?: number;
  /** Room the form's last table or blocks keep under them when no summary stands between them and the end. */
  endRoom?: number;
  /** Avvikelser in the log from this protocol that are not done (M22). */
  loggedDeviations?: WorkflowReportTask["loggedDeviations"];
};
/** The form's last block carries what ends the protocol, so the end is never alone on a page. */
type Tail = () => Promise<void>;

/** Measures a part of the protocol and leaves no trace of it: what was placed, listed or drawn once stays as it was. */
async function measured(context: Context, draw: () => void | Promise<void>) {
  const saved = { placed: new Set(context.placed), attachmentsListed: context.attachmentsListed, place: context.place, blankDecisionDrawn: context.blankDecisionDrawn, summaryEnd: context.summaryEnd, endRoom: context.endRoom };
  const result = await context.kit.measureAsync(draw);
  Object.assign(context, saved);
  return result;
}

export async function createFormProtocolPdf(input: { identity: KitIdentity; fontBytes: ReportFontBytes; task: WorkflowReportTask; options: WorkflowReportOptions; createdAt?: Date; blank?: boolean; /** A band under the head instead of the draft mark (the editor's preview). */ mark?: string }) {
  const { task, options } = input;
  if (task.data.kind !== "FORM") throw new Error("Rapporten gäller bara formulärprotokoll.");
  const details: FormDetails = task.data.details;
  const { document, values } = details;
  const blank = input.blank === true;
  const createdAt = input.createdAt ?? new Date();
  const t = pdfTexts("protocol", input.identity.templates);
  // A form without its own report heading is named by itself, not "Protokoll" (kundresa 2026-11-07, M17).
  const title = document.report.title || details.templateName.trim() || t.text("title");
  // Protokollmallen (2026-11-01, beslut 6): the head says the type, the protocol's fixed number and the template's
  // version; never the save counter. A blank form and a preview have no number and keep the form's own heading.
  const template = !blank && Boolean(task.protocolNumber);
  const code = template ? `${document.report.code ? `${document.report.code} · ` : ""}${task.protocolNumber} · ${t.text("footer.code", { version: details.templateVersion })}`
    : task.version && !blank ? `${document.report.code ? `${document.report.code} · ` : ""}${t.text("head.version", { version: task.version })}` : document.report.code || t.text("head.version", { version: details.templateVersion });
  // The protocol's own date, like the control ("odaterad" while it is empty).
  const dateField = formLeafBlocks(document).find((block) => block.type === "field" && (block.input === "date" || block.input === "datetime"));
  const dateValue = dateField && dateField.type === "field" ? values.fields[dateField.key] : null;
  const date = dateField ? (typeof dateValue === "string" && dateValue ? dateValue.slice(0, 10) : t.text("head.undated")) : reportDay(createdAt);
  const number = template ? `${document.report.code ? `${document.report.code} · ` : ""}${task.protocolNumber}` : document.report.code || (blank ? "" : task.version ? t.text("head.version", { version: task.version }) : "");
  const dates: (readonly [string, string])[] = blank ? []
    : [[t.text("head.template"), String(details.templateVersion)], template && task.status === "COMPLETED" && task.completedAt ? [t.text("head.protocol"), reportDay(task.completedAt)] as const : [t.text("head.date"), date] as const];
  // Every following page says what it continues: the number, or what the document is when it has none.
  const kit = await createReportKit({ identity: input.identity, fontBytes: input.fontBytes, createdAt, head: { kind: formKind(details.templateName, task.formArea, blank, t), title, number, dates, continuation: continuationOf(input.identity, template ? String(task.protocolNumber) : number || (blank ? t.text("head.blank") : task.title)) } });
  kit.pdf.setTitle(blank ? `${details.templateName} – tom mall` : `${details.templateName} – ${task.title}`);
  kit.pdf.setAuthor(input.identity.company || "Workflow");
  kit.pdf.setCreator("Workflow");
  kit.pdf.setProducer("Workflow");
  kit.pdf.setSubject(`${details.templateName} · ${code}`);
  kit.pdf.setCreationDate(createdAt);

  const evaluation = evaluateForm(document, values);
  const labels = attachmentLabels(document, values, t);
  const context: Context = {
    t,
    kit, document, values, evaluation, options, blank, attachments: task.attachments, placed: new Set(), attachmentsListed: false,
    listed: task.attachments.map((item, index) => ({ filename: item.filename, mimeType: item.mimeType, bytes: item.bytes, label: (item.id && labels.get(item.id)) || t.text("attach.label"), number: index + 1, id: item.id })),
    // One percent on the whole protocol (kundresa 2026-11-07, M22: "Kompletteringsgrad 100 %" beside "95 % klart"): the
    // status line and the summary read the same, capped at 95 % until the protocol is completed.
    completion: formProgress(task.status, document, values),
    loggedDeviations: blank ? [] : task.loggedDeviations,
    // Plats (2026-10-11): a report without the task facts (Kontroll före idrifttagning) names the linked place itself.
    place: !template && !blank && task.facilityName && !(options.summary && document.report.taskFacts) ? task.facilityName : "",
    template,
  };

  kit.firstPage();
  // An unfinished protocol is marked under the head (reports mark drafts clearly); a preview says what it is instead.
  if (input.mark) kit.band(input.mark);
  else if (task.status !== "COMPLETED" && !blank) kit.band(t.text("band.snapshot"));

  // The template's facts (beslut 6): customer, project, place and work order, the same four on every protocol, also on the
  // originals. No place or no work order is "—", not a negation; the fact stays.
  const tempPlace = tempPlaceOf(task.data) ? tempPlaceLabel(tempPlaceOf(task.data)) : "";
  const facts: KitFact[] = [];
  if (template && options.summary) facts.push(
    { label: t.text("fact.customer"), value: task.customerName || t.text("party.none") },
    { label: t.text("fact.project"), value: task.projectName || t.text("project.none") },
    { label: t.text("fact.place"), value: task.facilityName || tempPlace || "—" },
    { label: t.text("fact.order"), value: task.workOrderTitle || "—" },
  );
  if (options.summary && document.report.taskFacts) {
    const show = (value: string) => blank ? "" : value;
    facts.push(
      ...(template ? [] : [{ label: t.text("fact.task"), value: show(task.title), blank }]),
      ...(template ? [] : [{ label: t.text("fact.project"), value: show(task.projectName || t.text("project.none")), blank }]),
      // Hör till arbetsorder (Fas 4B): named on the protocol when it belongs to one.
      ...(!template && task.workOrderTitle ? [{ label: t.text("fact.belongs"), value: show(task.workOrderTitle), blank }] : []),
      ...(template ? [] : [{ label: t.text("fact.customer"), value: show(task.customerName || t.text("party.none")), blank }]),
      // The customer's place with its whole way (Platser, 2026-10-04).
      ...(!template && task.facilityName ? [{ label: t.text("fact.place"), value: show(task.facilityName), blank }] : []),
      ...(tempPlace && (!template || task.facilityName) ? [{ label: t.text("fact.temp-place"), value: show(tempPlace), blank }] : []),
      { label: t.text(template ? "fact.doer" : "fact.responsible"), value: show(task.assignedToName || t.text("doer.none")), blank },
      ...(task.dueDate ? [{ label: t.text("fact.due"), value: show(task.dueDate), blank }] : []),
      ...(blank ? [{ label: t.text("fact.date"), value: "", blank }] : [{ label: t.text("fact.status"), value: t.text("fact.status.value", { status: statusLabel(task.status), procent: context.completion }) }]),
      ...(options.time && !blank ? [{ label: t.text("fact.time"), value: formatDurationSeconds(task.totalDurationSec) }] : []),
      ...(task.description && !blank ? [{ label: t.text("fact.description"), value: task.description, span: 12, plain: true }] : []),
    );
  }
  if (facts.length) kit.facts(facts, { cols: 3 });
  if (options.summary && document.report.taskFacts) {
    // A round's points confirmed by scanning the QR label at the object (2026-10-04).
    const scans = values.round?.scans ?? [];
    if (scans.length && !blank) {
      kit.section(t.text("section.scans"), { keep: 30 });
      kit.facts(scans.map((scan) => ({ label: formatSwedish(scan.at, { dateStyle: "short", timeStyle: "short" }), value: [scan.place, scan.point ? t.text("scan.point", { punkt: scan.point }) : "", scan.by].filter(Boolean).join(" · "), span: 12, plain: true })), { cols: 3 });
    }
    if (task.projectFields?.length) {
      kit.section(t.text("section.project"), { keep: 30 });
      kit.facts(task.projectFields.map(([label, value]) => ({ label, value: blank ? "" : value, blank, span: value.length > 60 ? 12 : value.length > 28 ? 8 : 4 })), { cols: 3 });
    }
  }
  // Riskbedömning som steg (2026-10-08): the job's risk check, when it has one.
  if (options.summary) drawRiskStep(kit, task.data, { blank });

  // A form without its own Sammanfattning gets one after the form, like the control.
  const placedSummary = options.execution && formLeafBlocks(document).some((block) => block.type === "summary" && formBlockVisible(block, "pdf"));
  context.tailSummary = options.deviations && !placedSummary && formCanDeviate(document);
  context.limitsInTail = options.execution && document.limits.length > 0 && formJudgesByLimits(document);
  const end = async () => {
    if (template && options.approval) kit.keep(() => drawProtocolEnd(context, task));
    if (blank && options.approval) {
      // Measuring draws too: the decision box drawn once must still be there when the end is drawn for real.
      const drawn = context.blankDecisionDrawn;
      kit.keep(() => { context.blankDecisionDrawn = drawn; drawBlankEnd(context); });
    }
  };
  // What ends the protocol: everything flows from where it is, and the end keeps the summary's last lines with it.
  const tail: Tail = async () => {
    // The limits the protocol was judged by (2026-09-28): values, where they come from and whether they are the facility's.
    // Only a form that judges numbers by its limits gets the section; one whose limits only fill in the rows (Kontroll före
    // idrifttagning) keeps the original report – the values stand on the rows.
    if (context.limitsInTail && !context.tailSummary) {
      // The limits' short section stands with the end, so the end is not alone and the summary need not carry it.
      const limitsEnd = async () => { drawLimits(context); await end(); };
      const block = await measured(context, limitsEnd);
      if (!block.breaks && block.height <= CONTINUED_ROOM / 2) kit.makeRoom(block);
      await limitsEnd();
      return;
    }
    if (context.limitsInTail) drawLimits(context);
    if (context.tailSummary) {
      context.summaryEnd = (await measured(context, end)).height;
      drawSummary(context, t.text("summary.heading"));
      context.summaryEnd = 0;
    }
    await end();
  };
  const parts: ((end?: Tail) => Promise<void>)[] = [];
  if (options.execution) {
    let loose: FormLeafBlock[] = [];
    const flush = () => { if (loose.length) { const leaves = loose; parts.push((end) => drawLeaves(context, leaves, "", { tail: end })); } loose = []; };
    for (const block of document.blocks) {
      if (block.type === "section") { flush(); if (blank ? formSectionActive(block, values) : formSectionShown(document, block, values)) parts.push((end) => drawSection(context, block, end)); }
      else if (block.type === "columns") { flush(); parts.push((end) => drawLeaves(context, interleave(block), "", { tail: end })); }
      else loose.push(block);
    }
    flush();
  }
  for (const [index, part] of parts.entries()) await part(index === parts.length - 1 ? tail : undefined);
  if (!parts.length) await tail();
  if (!context.attachmentsListed && options.attachments && !blank) kit.attachmentList(context.listed, attachmentsNote(context));
  if (options.images && !blank) await kit.attachmentPages(context.listed.filter((item) => !item.id || !context.placed.has(item.id)));
  kit.footer({ note: template ? code : undefined });
  return kit.pdf.save();
}

/** Where each attached file sits in the form, for the list of attachments: the row, the object card or the picture block. */
function attachmentLabels(document: FormDocument, values: FormValues, t: PdfTexts) {
  const labels = new Map<string, string>();
  for (const section of document.blocks) for (const block of section.type === "section" ? section.blocks : section.type === "columns" ? section.columns.flat() : [section]) {
    // Pictures printed after the protocol are named after their section, like the control ("Visuell kontroll").
    if (block.type === "images") for (const id of values.images[block.key] ?? []) labels.set(id, !block.pdfInline && section.type === "section" && section.title ? section.title : block.label);
    if (block.type === "table") for (const [index, row] of (values.tables[block.key] ?? []).entries())
      for (const column of block.columns.filter((item) => item.input === "images")) {
        const cell = row.cells[column.key];
        if (Array.isArray(cell)) for (const id of cell) labels.set(id, block.layout === "cards"
          ? `${block.label} · ${formRowLabel(block, row, index)} · ${column.label}`
          : `${block.label} · ${t.text("attach.row", { rad: index + 1 })}${rowName(block, row) ? ` (${rowName(block, row)})` : ""}`);
      }
  }
  return labels;
}

/**
 * The column that names a card in the PDF: the first free-standing text column, else the first long text (the risk
 * assessment's "Risk eller fara"). A column in a group ("Handlingsplan: Ansvarig för åtgärd") is a detail, never the
 * name (totalkontrollen F4, 2026-09-29).
 */
function nameColumnOf(table: FormTableBlock) {
  return table.columns.find((column) => column.input === "text" && !column.group && column.pdf !== "hide")
    ?? table.columns.find((column) => column.input === "textarea" && !column.group && column.pdf !== "hide");
}
/** A row's own name: its fixed label or its first text value, like the control's "Rad 2 (Grupp 2 – uttag kök)". */
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

/** Room kept under a section heading (2026-09-28): the first object block, else a table heading with a row, else a facts row. */
function sectionKeep(context: Context, section: Extract<FormBlock, { type: "section" }>) {
  const shown = section.blocks.filter((block) => formBlockVisible(block, "pdf") && block.type !== "pagebreak");
  // Leading help texts and headings travel with the heading, so they count too.
  const lead = shown.findIndex((block) => block.type !== "text" && block.type !== "heading");
  const leadRoom = shown.slice(0, Math.max(0, lead)).reduce((sum, block) => sum + (block.type === "text" ? wrap(context.kit.font, block.text, 10, CONTENT_WIDTH).length * 14.5 + 7 : 20), 0);
  const first = lead < 0 ? undefined : shown[lead];
  if (first?.type === "summary") return leadRoom + summaryKeep(context);
  if (first && context.options.approval) {
    const run = factsWithSignature(context, shown, lead);
    if (run) return leadRoom + run;
  }
  if (first?.type === "table" && first.layout === "cards") return leadRoom + 20 + firstCardRoom(context, first);
  return leadRoom + (first?.type === "table" ? 72 : 40);
}

/** The height of a run of facts with signatures right under it, when they are kept together; zero otherwise. */
function factsWithSignature(context: Context, shown: readonly FormLeafBlock[], index: number) {
  if (context.blank) return 0;
  let next = index;
  const facts: KitFact[] = [];
  for (let item = fact(context, shown[next]); item; item = next < shown.length ? fact(context, shown[next]) : null) { facts.push(item); next++; if (next >= shown.length) break; }
  if (!facts.length || shown[next]?.type !== "signature") return 0;
  const items: KitSignature[] = [];
  for (; shown[next]?.type === "signature"; next++) items.push(signatureItem(context, shown[next] as Extract<FormLeafBlock, { type: "signature" }>));
  const { kit } = context;
  const height = kit.measure(() => { kit.facts(facts, { cols: 3 }); kit.signatures(items); }).height;
  return height <= KEPT_FACTS ? height : 0;
}

/** The room the first object block takes, so its heading goes to the next page with it, not before it. */
function firstCardRoom(context: Context, table: FormTableBlock) {
  const row = tableRows(context, table)[0];
  if (!row) return 90;
  const { card, cols } = objectOf(context, table, row, 0);
  return Math.min(CONTINUED_ROOM / 2, context.kit.measure(() => context.kit.drawObject(card, { cols, blank: context.blank })).height);
}

async function drawSection(context: Context, section: Extract<FormBlock, { type: "section" }>, tail?: Tail) {
  const { kit } = context;
  const titled = Boolean(section.title) && section.pdfStyle !== "untitled";
  const lead = () => {
    // A chapter starts a page of its own; its heading is an ordinary section heading (2026-11-04).
    if (section.pdfStyle === "chapter") kit.addPage();
    else if (section.newPage && kit.y < 740) kit.addPage();
    if (titled) kit.section(section.title, { note: section.description || undefined, keep: sectionKeep(context, section) });
    else if (section.description && section.pdfStyle !== "untitled") kit.paragraph(section.description, { color: kit.colors.muted, size: 9 });
  };
  await drawLeaves(context, section.blocks, section.title, { tail, lead, titled });
}

/**
 * Plats as the last fact of the grid that holds the facility field (2026-10-11): a typed "Projekt / anläggning" stays when a
 * place is chosen, so the place gets a fact of its own in the whole width – unless the field already says it (filled from
 * the place). Once per report, never in a blank form, and not where the task facts already show Plats.
 */
function placeFact(context: Context, blocks: readonly FormLeafBlock[]): KitFact | null {
  if (!context.place) return null;
  const field = blocks.find((block) => block.type === "field" && block.prefill === "facility");
  if (!field || field.type !== "field") return null;
  const text = String(context.values.fields[field.key] ?? "").trim();
  const place = context.place;
  context.place = "";
  return text.includes(place.trim()) ? null : { label: context.t.text("fact.place"), value: place, span: 12 };
}

/** A simple block as a fact, or null when the block is drawn in its own way. */
function fact(context: Context, block: FormLeafBlock): KitFact | null {
  const { values, evaluation, blank, t } = context;
  const span = formBlockSpan(block);
  if (block.type === "field") {
    const deviation = evaluation.deviations.some((item) => item.key === block.key && !item.rowId);
    const warning = evaluation.alerts.some((item) => item.key === block.key && !item.rowId);
    const remark = block.remarks ? values.remarks[block.key] : undefined;
    // Instrumentkoppling (2026-10-11): an instrument whose calibration was overdue when it was chosen says so.
    const overdue = block.prefill === "instrument" && Boolean(values.instruments?.[block.key]?.overdue);
    // A measured value whose limit has no value is not judged, and the protocol says so (kundresa 2026-11-07, M19).
    const noLimit = !blank && formFieldLacksLimit(context.document, values, block);
    const value = [answer(values.fields[block.key]), noLimit ? t.text("field.no-limit") : "", overdue ? t.text("field.overdue") : "", remark?.comment.trim() ? t.text("field.comment", { kommentar: remark.comment.trim() }) : "", remark?.deviation ? t.text("field.deviation") : ""].filter(Boolean).join(" · ");
    return { label: `${block.pdfLabel || block.label}${block.unit ? ` (${block.unit})` : ""}`, value: blank ? "" : value, span, blank, plain: block.input === "textarea", tone: blank ? undefined : deviation ? danger : warning || overdue || noLimit ? draft : undefined };
  }
  if (block.type === "computed") {
    const deviation = evaluation.deviations.some((item) => item.key === block.key);
    const value = evaluation.computed[block.key] ?? null;
    const band = formBand(block.bands, value);
    return { label: block.label, value: blank ? "" : withBand(formatResultValue(value, block.unit, block.passCondition), band), span, blank, tone: blank ? undefined : deviation ? danger : bandTone(band) };
  }
  return null;
}

/** Consecutive signature blocks become one signature block of the design. */
function signatureItem(context: Context, block: Extract<FormLeafBlock, { type: "signature" }>): KitSignature {
  const signature = context.values.signatures[block.key];
  if (context.blank || !signature?.name) return { label: block.label };
  return { label: block.label, name: signature.name, note: signature.confirmed ? (signature.signedAt ? context.t.text("sign.confirmed.at", { datum: reportTime(signature.signedAt) }) : context.t.text("sign.confirmed")) : context.t.text("sign.unconfirmed") };
}

/**
 * A section's blocks. With `tail` they are the form's last: they flow from where they are, and the end of the protocol keeps
 * with it the summary's last lines, or the last block with content when there is no summary. `lead` is what stands above the
 * blocks (the section's heading), drawn with them when the first block goes along.
 */
async function drawLeaves(context: Context, blocks: FormLeafBlock[], sectionTitle: string, parts: { tail?: Tail; lead?: () => void; titled?: boolean } = {}) {
  const { kit, options, values } = context;
  // A block hidden by its condition is not printed – except in a blank form, where every block is there to fill in by hand.
  // The list of attachments follows the section with the summary, after its signatures (2026-09-30), like the control.
  const shown = blocks.filter((block) => formBlockVisible(block, "pdf") && (block.type !== "signature" || options.approval) && (block.type !== "summary" || options.deviations) && (context.blank || !("showIf" in block) || formConditionMet(context.document, values, block.showIf)));
  const closing = () => {
    if (shown.some((block) => block.type === "summary") && !context.template && !(context.document.limits.length && formJudgesByLimits(context.document))) drawAttachmentList(context);
  };
  const { tail, lead } = parts;
  const titled = Boolean(parts.titled);
  if (!tail) {
    lead?.();
    await drawLeafRange(context, shown, 0, shown.length, sectionTitle, titled);
    closing();
    return;
  }
  const from = async (start: number) => {
    await drawLeafRange(context, shown, start, shown.length, sectionTitle, titled);
    closing();
    await tail();
  };
  const summary = shown.findIndex((block) => block.type === "summary");
  if (summary >= 0) {
    // The summary's last lines keep what follows them: the form's own signatures, and the end too unless the limits stand with it.
    const ownEnd = async () => { await drawLeafRange(context, shown, summary + 1, shown.length, sectionTitle, titled); closing(); };
    context.summaryEnd = (await measured(context, context.limitsInTail ? ownEnd : () => from(summary + 1))).height;
    lead?.();
    await drawLeafRange(context, shown, 0, summary + 1, sectionTitle, titled);
    context.summaryEnd = 0;
    await from(summary + 1);
    return;
  }
  if (context.tailSummary) {
    lead?.();
    await from(0);
    return;
  }
  // No summary at all: the last block with content goes along when it is short, else its last row or block does.
  let content = shown.length - 1;
  while (content > 0 && shown[content].type === "signature") content--;
  while (content > 0 && fact(context, shown[content]) && fact(context, shown[content - 1])) content--;
  const start = Math.max(0, content);
  const group = async () => { if (!start) lead?.(); await from(start); };
  const block = await measured(context, group);
  if (!block.breaks && block.height <= CONTINUED_ROOM / 2) {
    if (start) { lead?.(); await drawLeafRange(context, shown, 0, start, sectionTitle, titled); }
    kit.makeRoom(block);
    await group();
    return;
  }
  context.endRoom = (await measured(context, () => from(shown.length))).height;
  lead?.();
  await drawLeafRange(context, shown, 0, shown.length, sectionTitle, titled);
  context.endRoom = 0;
  closing();
  await tail();
}

async function drawLeafRange(context: Context, shown: FormLeafBlock[], from: number, to: number, sectionTitle: string, titled: boolean) {
  const { kit, options, values } = context;
  // What sums up a table or its blocks (its computed facts) stays with its last row.
  const summing = (index: number) => {
    const facts: KitFact[] = [];
    for (let next = index + 1; next < to && shown[next].type === "computed"; next++) facts.push(fact(context, shown[next])!);
    return (facts.length ? kit.measure(() => kit.facts(facts, { cols: 3 })).height : 0) + (index === to - 1 ? context.endRoom ?? 0 : 0);
  };
  for (let index = from; index < to; index++) {
    const block = shown[index];
    const first = fact(context, block);
    if (first) {
      // Consecutive simple blocks share the facts grid, like the control's Grunduppgifter.
      const facts = [first];
      const run = [block];
      while (index + 1 < to) {
        const next = fact(context, shown[index + 1]);
        if (!next) break;
        facts.push(next);
        run.push(shown[index + 1]);
        index++;
      }
      const place = placeFact(context, run);
      if (place) facts.push(place);
      // A signature right under its facts does not stand alone at the top of the next page.
      const kept = index + 1 < to && factsWithSignature(context, shown.slice(0, to), index - run.length + 1);
      if (kept) kit.makeRoom({ height: kept, breaks: 0 });
      kit.facts(facts, { cols: 3 });
      continue;
    }
    if (block.type === "signature") {
      if (context.blank && options.approval) drawBlankDecision(context);
      const items = [signatureItem(context, block)];
      while (index + 1 < to && shown[index + 1].type === "signature") { index++; items.push(signatureItem(context, shown[index] as Extract<FormLeafBlock, { type: "signature" }>)); }
      kit.signatures(items);
      continue;
    }
    // A block named like its section is not titled twice, nor one that only repeats the section's heading right under it.
    // A table named by the section's first word adds nothing ("Brister" under "Brister och åtgärder"); nor does the summary under a heading it starts ("Sammanfattning och signering").
    const repeats = (label: string) => label === sectionTitle || (titled && index === 0 && (block.type === "summary" ? firstWord(label) === firstWord(sectionTitle) : label.trim().toLowerCase() === firstWord(sectionTitle)));
    const heading = (label: string, keep = 40) => { if (label && !repeats(label)) kit.subTitle(label, keep); };
    if (block.type === "pagebreak") { if (kit.y < 740) kit.addPage(); }
    else if (block.type === "heading") { if (block.level === 1) kit.section(block.text); else kit.subTitle(block.text); }
    else if (block.type === "text") kit.paragraph(block.text, { color: kit.colors.muted, size: 9 });
    else if (block.type === "matrix") {
      const sorted = [...block.bands].sort((a, b) => a.from - b.from);
      const legend = sorted.filter((band) => band.label).map((band, index, all) => {
        const next = all[index + 1];
        return { level: bandLevel(block.bands, band), text: `${band.from}${next ? `–${next.from - 1}` : "+"} ${band.label}`, note: "" };
      });
      // The axes carry the initials of the form's own words, so the caption and the matrix say the same.
      const [rowLabel, colLabel] = [block.yLabel, block.xLabel].map((label) => label.trim().charAt(0).toUpperCase());
      kit.riskPanel({ size: block.size, levelOf: (s, k) => bandLevel(block.bands, formBand(block.bands, s * k)), caption: context.t.text("matrix.caption", { lodrätt: block.yLabel, vågrätt: block.xLabel.toLowerCase(), storlek: block.size }), legend, matrixTitle: block.label, legendTitle: context.t.text("matrix.legend"), cellText: (s, k) => String(s * k), rowLabel, colLabel });
    }
    else if (block.type === "note") kit.block(block.title, block.text.split(/\r?\n/).filter((line) => line.trim()));
    else if (block.type === "summary") { if (!repeats(block.label)) kit.section(block.label, { keep: summaryKeep(context) }); drawSummaryBox(context); }
    else if (block.type === "checklist" && block.mode === "check") {
      heading(block.label);
      kit.checkList(block.items.map((item) => ({ text: item.text, checked: !context.blank && values.checklists[block.key]?.[item.id]?.state === "OK" })));
    } else if (block.type === "checklist") {
      heading(block.label);
      const answers = values.checklists[block.key] ?? {};
      if (context.blank) {
        // The blank checklist to tick by hand (template 08): OK, Ej OK and Ej aktuellt as boxes, a column for remarks.
        const fixed = mm(8) + mm(12) * 3 + mm(52);
        kit.table({ title: block.label, hand: true, columns: [
          { key: "n", label: context.t.text("check.col.number"), width: mm(8), align: "center" }, { key: "item", label: context.t.text("check.col.item"), width: CONTENT_WIDTH - fixed },
          { key: "ok", label: context.t.text("check.col.ok"), width: mm(12), align: "center" }, { key: "nok", label: context.t.text("check.col.not-ok"), width: mm(12), align: "center" }, { key: "na", label: context.t.text("check.col.na"), width: mm(12), align: "center" }, { key: "note", label: context.t.text("check.col.note"), width: mm(52) }],
        rows: block.items.map((item, n) => [{ text: String(n + 1), muted: true }, item.text, { box: "off" }, { box: "off" }, { box: "off" }, ""]) });
      } else {
        const fixed = mm(26) + mm(52);
        kit.table({ title: block.label, dense: block.items.length > 8, columns: [{ key: "item", label: context.t.text("check.col.item"), width: CONTENT_WIDTH - fixed }, { key: "state", label: context.t.text("check.col.state"), width: mm(26) }, { key: "comment", label: context.t.text("check.col.comment"), width: mm(52) }],
          rows: block.items.map((item) => { const answered = answers[item.id]; const cell = checkpointCell(answered?.state); return { cells: [item.text, { text: cell.text, tone: cell.tone, badge: badgeOf(cell.tone, cell.text) }, answered?.comment || ""], dev: answered?.state === "NOT_OK" }; }) });
      }
      // A point's pictures (2026-09-28) right under the checklist, captioned with the point.
      const chosen = options.images && !context.blank ? block.items.flatMap((item) => pictures(context, answers[item.id]?.images ?? []).map((picture) => ({ picture, caption: `${item.text} · ${picture.filename}` }))) : [];
      if (chosen.length) { await kit.photos(chosen.map(({ picture, caption }) => ({ bytes: picture.bytes!, caption }))); chosen.forEach(({ picture }) => picture.id && context.placed.add(picture.id)); }
    } else if (block.type === "table" && block.layout === "cards") {
      heading(block.label, firstCardRoom(context, block));
      await drawCards(context, block, summing(index));
    } else if (block.type === "table") { heading(block.label, 72); drawGrid(context, block, summing(index)); }
    else if (block.type === "images") {
      const chosen = pictures(context, values.images[block.key] ?? []);
      if (block.pdfInline && options.images && chosen.length && !context.blank) {
        heading(block.label, 80);
        await kit.photos(chosen.map((item) => ({ bytes: item.bytes!, caption: item.filename })));
        chosen.forEach((item) => item.id && context.placed.add(item.id));
      } else if (block.pdfInline && (context.blank || (values.images[block.key] ?? []).length)) kit.paragraph(context.t.text("images.below", { etikett: block.label, fil: context.t.text(block.accept === "files" ? "images.files" : "images.pictures") }), { color: kit.colors.muted, size: 9 });
    }
  }
}

/** Column widths in points from relative weights, filling the content width. */
function widths(columns: [key: string, label: string, weight: number, align?: "right" | "center"][]): KitColumn[] {
  const total = columns.reduce((sum, item) => sum + item[2], 0);
  return columns.map(([key, label, weight, align]) => ({ key, label, width: weight / total * CONTENT_WIDTH, align }));
}

/** The rows to print: the protocol's rows, or – with none – an empty one (two in a blank form), like the control. */
function tableRows(context: Context, table: FormTableBlock): Row[] {
  const all = context.values.tables[table.key] ?? [];
  // Extra rows nobody started are not printed (R2-KTR-02); fixed rows (L1–PE …) always are.
  const rows = context.blank || table.rowMode === "fixed" ? all : all.filter((row) => row.example || formRowStarted(table, row));
  if (rows.length) return rows;
  return Array.from({ length: context.blank ? 2 : 1 }, (_, index) => ({ id: `tom-${index + 1}`, label: "", cells: {} }));
}

/**
 * A cell as text (docs/rapportprinciper.md): a Godkänd as Godkänd / Ej godkänd – empty while the row has nothing to judge –
 * a tick box as the fact Ja/Nej, a formula with its unit, pictures counted.
 */
function cellText(context: Context, table: FormTableBlock, row: Row, column: FormColumn) {
  if (context.blank) return "";
  if (column.input === "assessment") return rowAssessment(context, table, row, column.key).text;
  if (column.input === "check") return row.cells[column.key] === true ? "Ja" : "Nej";
  if (row.judged && formRowTechnicianJudged(table, column, row, context.evaluation)) return technicianJudgedText(row.judged.approved);
  if (column.input === "formula") { const value = context.evaluation.cells[table.key]?.[row.id]?.[column.key] ?? null; const pending = column.passCondition ? formRowPending(table, column, row, context.values, context.evaluation) : null; if (pending) return pending.text; return withBand(formatResultValue(value, column.unit, column.passCondition), formBand(column.bands, value)); }
  if (column.input === "scale") { const step = Number(row.cells[column.key]); return Number.isInteger(step) && step >= 1 ? `${step}${column.options[step - 1] ? ` · ${column.options[step - 1]}` : ""}` : ""; }
  if (column.input === "images") { const cell = row.cells[column.key]; return Array.isArray(cell) && cell.length ? (cell.length === 1 ? context.t.text("row.images.one") : context.t.text("row.images.many", { antal: cell.length })) : ""; }
  return answer(row.cells[column.key]);
}

/** Whether a row has anything to judge: a placeholder row or an untouched row is not assessed ("—", never "Ej godkänd"). */
const rowJudged = (table: FormTableBlock, row: Row) => !row.id.startsWith("tom-") && formRowStarted(table, row);
/** Approved, not approved, or not assessed (null): an untouched row, or an unticked Godkänd by hand (F7, 2026-09-29). */
const judgedValue = (evaluation: FormEvaluation, table: FormTableBlock, row: Row, key: string) => {
  const value = evaluation.cells[table.key]?.[row.id]?.[key];
  return rowJudged(table, row) && typeof value === "boolean" ? value : null;
};

/** A row's Godkänd cell: approved, not approved, or what it waits for. */
function rowAssessment(context: Context, table: FormTableBlock, row: Row, key: string): { text: string; tone?: KitColor } {
  // A row that is not judged yet (2026-10-06): what it waits for, in grey, never "Ej godkänd".
  const column = table.columns.find((item) => item.key === key);
  // Bedömd av tekniker (beslut 7): the row has no limit and the technician's word stands, in the word's colour.
  if (!context.blank && column && row.judged && formRowTechnicianJudged(table, column, row, context.evaluation)) return { text: technicianJudgedText(row.judged.approved), tone: row.judged.approved ? REPORT_TONES.pass : REPORT_TONES.fail };
  const pending = !context.blank && column && rowJudged(table, row) ? formRowPending(table, column, row, context.values, context.evaluation) : null;
  if (pending) return { text: pending.text, tone: REPORT_TONES.muted };
  return assessmentCell(judgedValue(context.evaluation, table, row, key));
}

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

/** A number-like column (numbers, formulas, dates) is right-aligned like the templates' figures. */
const numeric = (column: FormColumn) => column.input === "number" || column.input === "formula" || column.input === "date";

function drawGrid(context: Context, table: FormTableBlock, keepAfter = 0) {
  const { kit, evaluation } = context;
  const filled = tableRows(context, table).filter((row) => context.blank || !emptyFreeRow(table, row));
  const rows = filled.length ? filled : tableRows({ ...context, values: { ...context.values, tables: { ...context.values.tables, [table.key]: [] } } }, table);
  const fixed = table.rowMode === "fixed";
  const groups = printedColumns(table);
  // A pdfWidth is in points and a weight is a share (2026-09-30). When a table mixes them, a weight counts as WEIGHT_POINTS points.
  const scale = groups.some((group) => group.columns[0].pdfWidth) ? WEIGHT_POINTS : 1;
  const columns: KitColumn[] = widths([
    ...(fixed ? [["__row", context.t.text("col.row"), scale] as [string, string, number]] : []),
    ...groups.map((group) => [group.columns[0].key, group.label, group.columns[0].pdfWidth ?? COLUMN_WEIGHT[group.columns[0].input] * scale, group.columns[0].input === "assessment" ? undefined : numeric(group.columns[0]) ? "right" : undefined] as [string, string, number, "right" | undefined]),
  ]);
  // The example text goes in the comment column: the first long text, else the last text column.
  const commentKey = (table.columns.find((column) => column.input === "textarea" && column.pdf !== "hide") ?? table.columns.filter((column) => column.input === "text" && column.pdf !== "hide").at(-1))?.key;
  const judgedIndex = groups.findIndex((group) => group.columns[0].input === "assessment");
  const body = rows.map((row, index) => {
    const dev = !context.blank && evaluation.deviations.some((item) => item.key === table.key && item.rowId === row.id && item.kind !== "assessment");
    const cells: KitCell[] = [...(fixed ? [row.label || context.t.text("row.number", { rad: index + 1 })] : []), ...groups.map((group, g) => {
      if (g === judgedIndex) {
        if (context.blank) return { box: "off" as const, align: "center" as const };
        const judged = rowAssessment(context, table, row, group.columns[0].key);
        return { text: judged.text, tone: judged.tone, badge: badgeOf(judged.tone, judged.text) };
      }
      // A formula that is a pass condition is a judgement too: its word gets the colour and the status mark.
      if (group.columns.length === 1 && group.columns[0].input === "formula" && group.columns[0].passCondition && !context.blank) {
        const value = evaluation.cells[table.key]?.[row.id]?.[group.columns[0].key];
        const pending = formRowPending(table, group.columns[0], row, context.values, evaluation);
        if (pending) return { text: pending.text, tone: REPORT_TONES.muted, badge: "na" as const };
        if (typeof value === "boolean" && rowJudged(table, row)) { const judged = assessmentCell(value); return { text: judged.text, tone: judged.tone, badge: badgeOf(judged.tone, judged.text) }; }
      }
      const text = group.columns.map((column) => cellText(context, table, row, column) || (group.columns.length > 1 ? "—" : "")).join(" / ");
      const shown = group.columns[0].key !== commentKey || context.blank ? text : `${row.example ? `${context.t.text("row.example")} ` : ""}${text || (row.example ? "—" : "")}`.trim();
      // A measured deviation's value stands in bold, as the templates print the failing figure.
      return dev && numeric(group.columns[0]) ? { text: shown, bold: true, tone: danger } : shown;
    })];
    const failed = judgedIndex >= 0 && !context.blank && rowAssessment(context, table, row, groups[judgedIndex].columns[0].key).tone === REPORT_TONES.fail;
    return { cells, dev: dev || failed };
  });
  const totals = evaluation.totals[table.key];
  // The total row says what it is: "Summa" over a sum, "Lägsta" over a lowest value; mixed kinds keep the general word.
  const totalled = new Set(table.columns.filter((column) => column.key in (totals ?? {}) && column.total !== "none").map((column) => column.total as keyof typeof TOTAL_LABELS));
  const totalLabel = context.t.text(totalled.size === 1 ? TOTAL_LABELS[[...totalled][0]] : "total.mixed");
  const total = totals && !context.blank ? [...(fixed ? [totalLabel] : []), ...groups.map((group, index) => group.columns[0].key in totals ? formatFormulaValue(totals[group.columns[0].key], group.columns[0].unit) : !fixed && index === 0 ? totalLabel : "")] : undefined;
  // No word broken in the middle: narrow columns get room from wide ones, a very wide table prints smaller (2026-09-30).
  const dense = columns.length > 5;
  const fitted = kit.fitColumns(columns, body.map((row) => row.cells), dense);
  kit.table({ title: table.label, columns: fitted.columns, rows: body, total, dense, hand: context.blank, sizes: fitted.sizes, keepAfter });
}

const pictures = (context: Context, ids: string[]) => ids.map((id) => context.attachments.find((item) => item.id === id)).filter((item): item is Attachment => Boolean(item?.bytes && item.mimeType.startsWith("image/")));

/** A value of an object block like the control's: the value and its unit, Ja/Nej for a tick box, the long dash when empty. */
function metricText(context: Context, table: FormTableBlock, row: Row, column: FormColumn) {
  const text = cellText(context, table, row, column);
  if (!text || context.blank || column.input === "check" || column.input === "formula" || !column.unit) return text;
  return `${text} ${column.unit}`;
}

/** The block's heading from the form's template ("{placering} · {profil} · typ {typ}"), or the object's name. */
function cardTitle(context: Context, table: FormTableBlock, row: Row, index: number) {
  const itemLabel = table.itemLabel || context.t.text("card.item");
  if (context.blank) return `${itemLabel} ${index + 1}`;
  if (table.cardTitle) return table.cardTitle.replace(/\{([^}]*)\}/g, (_, key: string) => {
    const column = table.columns.find((item) => item.key === key.trim());
    return (column ? cellText(context, table, row, column) : "") || "—";
  });
  const name = rowName(table, row);
  return `${itemLabel} ${index + 1}${name ? `: ${name}` : ""}`;
}

/** One row of an object table as the kit's block. */
function objectOf(context: Context, table: FormTableBlock, row: Row, index: number): { card: KitObject; cols: 3 | 4 } {
  const { evaluation } = context;
  const titled = new Set([...table.cardTitle.matchAll(/\{([^}]*)\}/g)].map((match) => match[1].trim()));
  const nameColumn = nameColumnOf(table);
  const assessment = table.columns.find((column) => column.input === "assessment");
  const texts = table.columns.filter((column) => column.input === "textarea" && column.pdf !== "hide");
  const named = !table.cardTitle && Boolean(rowName(table, row)) && !row.label;
  const groups = printedColumns(table).filter((group) => {
    const column = group.columns[0];
    return !["textarea", "images", "assessment"].includes(column.input) && !titled.has(column.key) && !(named && column === nameColumn);
  });
  const deviation = !context.blank && evaluation.deviations.some((item) => item.key === table.key && item.rowId === row.id && item.kind !== "assessment");
  // The block always names its judgement (2026-09-30): a row not judged yet says "Godkänd: —" in grey – never
  // "Ej godkänd" – and the blank template has a box to tick.
  const judged = assessment && !context.blank ? rowAssessment(context, table, row, assessment.key) : null;
  const unjudged = judged !== null && !judged.text;
  const result: KitObject["result"] = context.blank && assessment ? { text: `${assessment.label}:`, box: "off" } : judged ? (unjudged ? { text: `${assessment!.label}: —`, tone: REPORT_TONES.muted } : judged) : deviation ? { text: context.t.text("card.deviation"), tone: danger } : null;
  const comment = texts.length ? texts.map((column) => `${column.label}: ${context.blank ? "" : answer(row.cells[column.key]) || "—"}`).join("\n") : null;
  return { cols: groups.length >= 4 ? 4 : 3, card: {
    title: cardTitle(context, table, row, index),
    result,
    metrics: groups.map((group) => ({
      label: group.label,
      value: context.blank ? "" : group.columns.length > 1
        ? `${group.columns.map((column) => cellText(context, table, row, column) || "—").join(" / ")}${group.columns[0].unit ? ` ${group.columns[0].unit}` : ""}`
        : metricText(context, table, row, group.columns[0]),
      tone: context.blank || group.columns[0].input !== "formula" ? undefined : bandTone(formBand(group.columns[0].bands, evaluation.cells[table.key]?.[row.id]?.[group.columns[0].key] ?? null)),
    })),
    comment,
  } };
}

/**
 * Object blocks (the older cards): a heading with the result word, the values as a dense facts grid, free texts as the
 * comment and the pictures right below, so value and picture are read together. A block stays whole; the last keeps
 * `keepAfter` under it for what sums up the blocks.
 */
async function drawCards(context: Context, table: FormTableBlock, keepAfter = 0) {
  const { kit, options } = context;
  const rows = tableRows(context, table);
  // A page that goes on with the blocks says so, like a table that continues there.
  const outer = kit.running;
  kit.running = kit.lastHeading || table.label;
  for (const [index, row] of rows.entries()) {
    const { card, cols } = objectOf(context, table, row, index);
    kit.object(card, { cols, blank: context.blank, keepAfter: index === rows.length - 1 ? keepAfter : 0 });
    const images = options.images && !context.blank ? table.columns.filter((column) => column.input === "images" && column.pdf !== "hide").flatMap((column) => {
      const cell = row.cells[column.key];
      return pictures(context, Array.isArray(cell) ? cell : []).map((item) => ({ item, caption: `${column.label} · ${item.filename}` }));
    }) : [];
    if (images.length) {
      await kit.photos(images.map(({ item, caption }) => ({ bytes: item.bytes!, caption })));
      images.forEach(({ item }) => item.id && context.placed.add(item.id));
    }
  }
  kit.running = outer;
}

/**
 * Sammanfattning / avvikelser: approved per moment (the control's "Isolation: 3/4 godkända"), other deviations, the
 * comment and the degree of completion – as plain lines; a ruled field in a blank form.
 */
function drawSummaryBox(context: Context) {
  const { kit, blank } = context;
  if (blank) { kit.handLines("", mm(21.6)); return; }
  kit.list(summaryLines(context), { color: summaryColor(context), keepAfter: context.summaryEnd });
}

const summaryColor = (context: Context) => (line: string) => line.startsWith(`• ${context.t.text("summary.warning")}`) ? draft : line.startsWith("•") ? danger : undefined;

function summaryLines(context: Context) {
  const { document, values, evaluation, t } = context;
  const pendingText = formCompletion(document, values).pendingText;
  // The same count as the screen (formApprovalResult): example rows count nowhere. The rows not approved are named in red, like other deviations.
  const { totals, notApproved } = formApprovalResult(document, values, evaluation);
  const others = [
    ...notApproved.filter((row) => row.state === false).map((row) => t.text("summary.not-approved", { tabell: row.table, rad: row.name })),
    ...evaluation.deviations.filter((item) => item.kind !== "assessment").map((item) => item.message),
  ];
  const shown = others.slice(0, 8);
  return [
    ...totals.map((item) => t.text("summary.approved", { titel: item.title, godkända: item.ok, antal: item.total })),
    ...(others.length && !totals.length ? [others.length === 1 ? t.text("summary.one") : t.text("summary.many", { antal: others.length })] : []),
    ...shown.map((item) => `• ${item}`),
    ...(others.length > shown.length ? [t.text("summary.more", { antal: others.length - shown.length })] : []),
    ...evaluation.alerts.slice(0, 6).map((item) => `• ${t.text("summary.warning")}: ${item.message}`),
    ...judgedRowLines(context),
    // Avvikelser in the log taken from this protocol that are not done (kundresa 2026-11-07, M22).
    ...(context.loggedDeviations ?? []).map((item) => `• ${t.text("summary.logged", { nr: item.number, titel: item.title, status: item.status === "IN_PROGRESS" ? t.text("summary.logged.in-progress") : t.text("summary.logged.open") })}`),
    // Nothing judged is filled in: "Ej ifyllt", never "Inga avvikelser", which reads as approved (kundresa 2026-11-07, M15).
    values.deviationComment || t.text(!others.length && !formFilledIn(document, values) ? "summary.empty" : !totals.length && !others.length ? "summary.none" : "summary.no-comment"),
    `${t.text("summary.completion", { procent: context.completion })}${pendingText ? ` · ${pendingText}` : ""}`,
  ];
}

/** What a summary's heading keeps under it: a short summary and the end stay whole; a long one needs only its first lines. */
function summaryKeep(context: Context) {
  const { kit } = context;
  const end = context.summaryEnd ?? 0;
  if (context.blank) return mm(21.6) + mm(4) + end;
  const lines = summaryLines(context);
  return lines.length <= 3 ? kit.measure(() => kit.list(lines)).height + end : 40;
}

/** The rows the technician judged because the limit was missing (beslut 7): who and when, for the one reading the protocol. */
function judgedRowLines(context: Context) {
  const { document, values, evaluation } = context;
  const lines: string[] = [];
  for (const block of formLeafBlocks(document)) {
    if (block.type !== "table") continue;
    for (const [index, row] of (values.tables[block.key] ?? []).entries()) {
      if (!row.judged || !block.columns.some((column) => formRowTechnicianJudged(block, column, row, evaluation))) continue;
      const who = [row.judged.by, row.judged.at ? reportTime(row.judged.at) : ""].filter(Boolean).join(", ");
      lines.push(`• ${context.t.text("summary.judged", { tabell: block.label, rad: formRowLabel(block, row, index) })} ${technicianJudgedText(row.judged.approved)}${who ? ` (${who})` : ""}.`);
    }
  }
  return lines;
}

/**
 * The end of the protocol template (2026-11-01, beslut 6): the technician's final verdict in the one framed box, then
 * the signature block with the customer's receipt. The verdict is a person's word; while none is given the protocol says so,
 * it never makes one up from the rows. A form with signature blocks of its own has printed them already.
 */
function drawProtocolEnd(context: Context, task: WorkflowReportTask) {
  const { kit, document, values, t } = context;
  const verdict = values.finalVerdict;
  const tone = verdict?.choice === "APPROVED" ? REPORT_TONES.pass : verdict?.choice === "REJECTED" ? REPORT_TONES.fail : verdict?.choice === "REMARK" ? REPORT_TONES.warning : REPORT_TONES.muted;
  kit.decision({ label: t.text("decision.label"), word: { text: verdict ? FINAL_VERDICT_LABELS[verdict.choice] : t.text("decision.none"), tone }, note: verdict ? [verdict.by ? t.text("decision.by", { namn: verdict.by }) : "", verdict.at ? reportTime(verdict.at) : ""].filter(Boolean).join(", ") : undefined });
  const ownSignatures = formLeafBlocks(document).some((block) => block.type === "signature" && formBlockVisible(block, "pdf"));
  // From the form's definition, never from what is filled in: a form with signature fields of its own has already signed above.
  kit.section(t.text(ownSignatures ? "section.signing.own" : "section.signing"), { keep: 70 });
  const finished = task.status === "COMPLETED" && task.completedAt ? t.text("sign.finished.at", { tid: reportTime(task.completedAt) }) : t.text("sign.not-finished");
  kit.signatures([
    ...(ownSignatures ? [{ label: t.text("sign.finished"), name: task.status === "COMPLETED" && task.completedAt ? reportTime(task.completedAt) : undefined, note: task.status === "COMPLETED" ? undefined : t.text("sign.not-finished") }] : [{ label: t.text("sign.technician"), name: task.assignedToName || undefined, note: task.assignedToName ? finished : t.text("sign.not-assigned", { status: finished }) }]),
    { label: t.text("sign.receipt"), name: task.customerReceipt?.name || undefined, note: task.customerReceipt?.name ? (task.customerReceipt.at ? t.text("sign.received", { tid: reportTime(task.customerReceipt.at) }) : t.text("sign.received.plain")) : t.text("sign.no-receipt") },
  ]);
}

/** A blank form's result to tick (template 08), drawn once – before the form's own signature lines or at the end. */
function drawBlankDecision(context: Context) {
  if (context.blankDecisionDrawn) return;
  context.blankDecisionDrawn = true;
  // The box stands free of the ruled lines above it.
  if (context.kit.last !== "page") context.kit.space(mm(7));
  context.kit.decision({ label: context.t.text("blank.decision"), choices: Object.values(FINAL_VERDICT_LABELS).map((text) => ({ text, checked: false })) });
}

/** The end of a blank form (template 08): the result to tick and two signature lines when the form has none of its own. */
function drawBlankEnd(context: Context) {
  const { kit, document, t } = context;
  drawBlankDecision(context);
  if (!formLeafBlocks(document).some((block) => block.type === "signature" && formBlockVisible(block, "pdf"))) kit.signatures([{ label: t.text("blank.sign.done") }, { label: t.text("blank.sign.review") }]);
}

function drawSummary(context: Context, title: string) {
  context.kit.section(title, { keep: summaryKeep(context) });
  drawSummaryBox(context);
}

const ORIGIN_TEXT = { form: "origin.form", facility: "origin.facility", object: "origin.object", company: "origin.company" } as const;

/** Gränsvärden: each limit with its alarm and warning range, its source and whether it is the form's or the facility's. */
function drawLimits(context: Context) {
  const { kit, document, values, blank, t } = context;
  const resolved = document.limits.map((limit) => formLimitFor(document, blank ? {} : values, limit.key));
  // No level set for the facility (2026-09-30: two pages of "ej angivet"): one line instead of the table.
  if (!blank && resolved.every((value) => !value || [value.low, value.high, value.warnLow, value.warnHigh].every((number) => number === null || number === undefined))) {
    kit.section(t.text("limits.heading"), { keep: 30 });
    // A form whose limits only fill in the rows' own limit fields (2026-10-06) judged the rows by those.
    kit.paragraph(t.text(formJudgesByLimits(document) ? (document.limits.length === 1 ? "limits.none.one" : "limits.none.many") : "limits.none.rows"));
    return;
  }
  kit.section(t.text("limits.heading"), { note: t.shown("limits.note") ? t.text("limits.note") : undefined, keep: 48 });
  const rows = document.limits.map((limit) => {
    const value = formLimitFor(document, blank ? {} : values, limit.key);
    return [`${limit.label}${limit.unit ? ` (${limit.unit})` : ""}`, value ? formLimitText(value.low, value.high, limit.unit) : "", value ? formLimitText(value.warnLow, value.warnHigh, limit.unit) : "", value?.source || limit.source, value ? t.text(ORIGIN_TEXT[value.origin]) : ""];
  });
  const fitted = kit.fitColumns(widths([["name", t.text("limits.col.name"), 2.2], ["alarm", t.text("limits.col.alarm"), 1.4], ["warning", t.text("limits.col.warning"), 1.4], ["source", t.text("limits.col.source"), 2.2], ["origin", t.text("limits.col.origin"), 1]]), rows, true);
  kit.table({ title: t.text("limits.heading"), dense: true, columns: fitted.columns, rows, sizes: fitted.sizes });
}

/**
 * What the list says about the files (2026-09-30): the control's "… följer efter protokollet" while every file follows,
 * and where they are when pictures were already printed in the protocol.
 */
function attachmentsNote(context: Context) {
  const total = context.listed.length;
  const following = context.listed.filter((item) => !item.id || !context.placed.has(item.id)).length;
  if (following === total) return undefined;
  if (!following) return context.t.text(total === 1 ? "attach.one-above" : "attach.all-above");
  return context.t.text("attach.some", { följer: following, antal: total });
}

/** The numbered list of attachments, right after the summary like the control; never in a blank form. */
function drawAttachmentList(context: Context) {
  if (context.attachmentsListed || !context.options.attachments || context.blank) return;
  context.kit.attachmentList(context.listed, attachmentsNote(context));
  context.attachmentsListed = true;
}
