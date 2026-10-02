import { z } from "zod";
import { evaluateFormula, formulaReferences, FormulaCycleError, FormulaError, orderByDependencies, parseFormula, type FormulaNode, type FormulaValue } from "./form-formula";

/**
 * A form (2026-09-26, design v2): versioned data – blocks and formulas – drawn and computed by one shared engine.
 * Never code, never HTML: text is rendered as text and only the known block types below exist.
 *
 * Schema 2 (the approved editor, 2026-09-26) is additive: sections, a Hel/Halv width per block, visibility in the
 * task and the PDF, page breaks, date and time, default values, hard validation and more. Every new property has a
 * default, so a published schema 1 version parses unchanged and is never rewritten.
 */
export const FORM_LIMITS = { blocks: 300, columns: 40, rows: 500, options: 50, checklistItems: 200, text: 5000, label: 200 } as const;

const key = z.string().trim().toLowerCase().regex(/^[a-zåäö][a-zåäö0-9_]{0,39}$/, "Kortnamn får innehålla små bokstäver, siffror och understreck och börja med en bokstav.");
const id = z.string().min(1).max(60);
const label = z.string().trim().min(1, "Ange en etikett.").max(FORM_LIMITS.label);
const optionalText = (max: number) => z.string().trim().max(max).default("");
const formula = z.string().trim().min(1, "Ange en formel.").max(500);
const options = z.array(z.string().trim().min(1).max(120)).max(FORM_LIMITS.options).default([]);
const number = z.number().finite().nullable().default(null);
// Layout (schema 2): a controlled 12-column grid (2026-09-26: dense like a paper protocol). Blocks snap to
// fixed widths, never free positions, so the form always stacks on a phone and packs the same way in the PDF.
export const FORM_WIDTHS = ["quarter", "third", "half", "two_thirds", "three_quarters", "full"] as const;
export type FormWidth = (typeof FORM_WIDTHS)[number];
export const FORM_WIDTH_SPAN: Record<FormWidth, number> = { quarter: 3, third: 4, half: 6, two_thirds: 8, three_quarters: 9, full: 12 };
export const FORM_WIDTH_LABEL: Record<FormWidth, string> = { quarter: "¼", third: "⅓", half: "½", two_thirds: "⅔", three_quarters: "¾", full: "Hel" };
const width = z.enum(FORM_WIDTHS).default("full");
const visibility = z.object({ task: z.boolean().default(true), pdf: z.boolean().default(true) }).default({ task: true, pdf: true });

export const FIELD_INPUTS = ["text", "textarea", "number", "date", "datetime", "choice", "yesno"] as const;
/**
 * Column inputs. "check" is a tick box (true/false, like the control's "Testknapp OK"); "assessment" is the row's
 * Godkänd: decided by a condition, by hand or – with a Ja/nej field such as Autobedömning – either (2026-09-27,
 * built backwards from Kontroll före idrifttagning).
 */
export const COLUMN_INPUTS = ["text", "number", "choice", "yesno", "formula", "textarea", "date", "images", "check", "assessment", "scale"] as const;
/**
 * Table layouts: a grid of rows, one card per row ("objekt") where each card carries its own fields and pictures, or
 * compact measurement rows like the control's Isolation and Kontinuitet.
 */
export const TABLE_LAYOUTS = ["grid", "cards", "rows"] as const;
/** How a row's Godkänd is decided: by its condition, by hand, or by the condition only while a Ja/nej field is Ja. */
export const ASSESSMENT_MODES = ["auto", "manual", "switch"] as const;
/** Where a field's first value comes from when the task has it (the control's customer picker, 2026-09-27). */
export const FIELD_PREFILLS = ["none", "customer", "contact", "email", "facility", "project", "assignee", "user", "today"] as const;
/** A column in the PDF: shown, left out, or joined to the column before it ("24 / 26 ms"). */
export const COLUMN_PDF = ["show", "hide", "join"] as const;
/** A section in the PDF: with its heading, without it (like the control's Grunduppgifter), or as a chapter page (Stöd vid bedömning). */
export const SECTION_PDF_STYLES = ["standard", "untitled", "chapter"] as const;
const scalar = z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.null()]).default(null);
/**
 * Levels of a computed value (2026-09-27, the risk assessment): from a value upwards the result gets a name and
 * a colour, e.g. 10–16 "Hög" in red. Shown as "15 · Hög" on screen and in the PDF.
 */
export const BAND_TONES = ["neutral", "success", "warning", "danger", "critical"] as const;
const bands = z.array(z.object({ from: z.number().finite(), label: z.string().trim().max(60).default(""), tone: z.enum(BAND_TONES).default("neutral") })).max(10).default([]);
export type FormBand = z.infer<typeof bands>[number];
/**
 * Villkorad visning (2026-09-28): a block or section is shown only while a field's answer meets the condition, e.g.
 * "Turbintyp = Kaplan" or "Reservkraft finns = Ja". An empty key means always shown. Conditions only read fields, never
 * formulas, so they can never form a cycle with a computed value. A hidden block asks for nothing, is not printed and
 * its answers count as empty in formulas.
 */
export const CONDITION_OPS = ["eq", "neq", "filled", "empty", "gt", "gte", "lt", "lte"] as const;
const conditionSchema = z.object({ key: z.string().trim().max(40).default(""), op: z.enum(CONDITION_OPS).default("eq"), value: z.string().trim().max(200).default("") });
const showIf = conditionSchema.default({ key: "", op: "eq", value: "" });
export type FormCondition = z.infer<typeof conditionSchema>;
// A number that links to one of the form's configurable limits (2026-09-28) and whether its history is drawn as a trend.
const limitKey = z.string().trim().max(40).default("");
const trend = z.boolean().default(false);

const fieldBlock = z.object({
  id, type: z.literal("field"), key, label, input: z.enum(FIELD_INPUTS), required: z.boolean().default(false), help: optionalText(500), unit: optionalText(20),
  // Number: the approved interval. A value outside it is a deviation (marked, never blocking).
  min: number, max: number, options, multiple: z.boolean().default(false),
  // Ja/nej: whether "Ej aktuellt" is allowed and which answer is a deviation.
  allowNotApplicable: z.boolean().default(true), deviationOn: z.enum(["NONE", "YES", "NO"]).default("NONE"),
  // Val: the options that are deviations.
  deviationOptions: options,
  // Filled in when a protocol is created.
  defaultValue: z.union([z.string().max(2000), z.number().finite(), z.null()]).default(null),
  // Hard validation, unlike the approved interval: a value outside it stops completion.
  allowedMin: number, allowedMax: number, decimals: z.number().int().min(0).max(6).nullable().default(null), maxLength: z.number().int().min(1).max(2000).nullable().default(null),
  width, visibility,
  // Built backwards from the control (2026-09-27): filled in from the task's customer, project or user; a tinted
  // box in the PDF (the control's Projekt / anläggning); and, for Ja/nej, a switch among the moments (Autobedömning).
  prefill: z.enum(FIELD_PREFILLS).default("none"), highlight: z.boolean().default(false), momentSwitch: z.boolean().default(false),
  // Exactly like the originals in the task (2026-09-27): a placeholder in the field and a PDF label of its own.
  placeholder: optionalText(200), pdfLabel: optionalText(120),
  // 2026-09-28: shown only under a condition; a comment and a deviation of its own on this control point; a
  // configurable limit (per facility) instead of a fixed interval; its history drawn as a trend.
  showIf, remarks: z.boolean().default(false), limitKey, trend,
});
/** Where a column of an object card is shown on screen: in the card's body, as a badge in its title row, or as a note under a measurement row. */
export const COLUMN_PLACEMENTS = ["body", "header", "note"] as const;
/** A column's width in an object card on screen; "auto" is by kind of answer. */
export const CARD_WIDTHS = ["auto", "quarter", "half", "full"] as const;
const columnSchema = z.object({
  id, key, label, input: z.enum(COLUMN_INPUTS), required: z.boolean().default(false), unit: optionalText(20), options, min: number, max: number,
  formula: z.string().trim().max(500).default(""),
  // Val: the options that make the row a deviation (e.g. "Åtgärda omgående").
  deviationOptions: options,
  help: optionalText(300),
  // A formula column whose false result is a deviation in that row ("villkor för godkänt").
  passCondition: z.boolean().default(false),
  total: z.enum(["none", "sum", "min", "max", "avg"]).default("none"),
  // Built backwards from the control (2026-09-27): a value for new rows and for the example row, values that
  // count as not filled in ("Ej mätt"), a requirement that only applies while a Ja/nej field is Ja, suggestions, and
  // how the column is printed – its own heading, a relative width, left out or joined to the column before.
  defaultValue: scalar, exampleValue: scalar, notFilledOptions: options, requiredIf: z.string().trim().max(40).default(""),
  suggestions: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
  pdfLabel: z.string().trim().max(120).default(""), pdfWidth: z.number().positive().max(1000).nullable().default(null), pdf: z.enum(COLUMN_PDF).default("show"),
  // Godkänd: how it is decided and, for "switch", the Ja/nej field that turns the condition on.
  mode: z.enum(ASSESSMENT_MODES).default("auto"), switchKey: z.string().trim().max(40).default(""),
  // Levels of a formula column ("15 · Hög"). A "scale" column stores 1, 2, 3 … and uses `options` as the step names.
  bands,
  // The task view exactly like the originals (2026-09-27): a placeholder; in object cards a label of its own, a
  // width, a badge in the title row ("Före: 15 · Hög") and a named group of fields ("Före skyddsåtgärd"); in measurement
  // rows a CSS track of its own ("2.3fr", "4.5rem", "minmax(10rem,20%)") and the line it sits on (the RCD test's two lines).
  placeholder: optionalText(200), cardLabel: optionalText(120), cardWidth: z.enum(CARD_WIDTHS).default("auto"), placement: z.enum(COLUMN_PLACEMENTS).default("body"), group: optionalText(120),
  screenWidth: z.string().trim().max(60).default(""), line: z.union([z.literal(1), z.literal(2)]).default(1),
  // 2026-09-28: hard validation like a field's (a value outside stops completion), a configurable limit and a trend
  // (for tables with fixed rows: one series per row, e.g. "Lager 1").
  allowedMin: number, allowedMax: number, decimals: z.number().int().min(0).max(6).nullable().default(null), limitKey, trend,
});
const tableBlock = z.object({
  id, type: z.literal("table"), key, label, columns: z.array(columnSchema).min(1, "En tabell behöver minst en kolumn.").max(FORM_LIMITS.columns),
  // Fixed rows have labels from the form (L1–PE …); free rows are added by the person filling it in.
  rowMode: z.enum(["fixed", "free"]).default("free"), fixedRows: z.array(z.string().trim().min(1).max(120)).max(FORM_LIMITS.rows).default([]),
  required: z.boolean().default(false), help: optionalText(500), width, visibility,
  // Cards: each row is drawn as an object card with its fields and pictures together, on screen and in the PDF.
  layout: z.enum(TABLE_LAYOUTS).default("grid"), itemLabel: z.string().trim().max(60).default(""),
  // An example row that must be removed before completion, and the heading of each card in the PDF with the row's
  // values in braces, e.g. "{placering} · {profil} · typ {typ} · {markstrom} mA".
  allowExample: z.boolean().default(false), cardTitle: z.string().trim().max(200).default(""),
  // The task view exactly like the originals (2026-09-27): another layout on screen than in the PDF (the RCD test:
  // cards in the PDF, two-line rows on screen), the Kopiera button, the empty state's words and the plural of a card's name.
  taskLayout: z.enum(["same", ...TABLE_LAYOUTS]).default("same"), copyRows: z.boolean().default(true),
  emptyTitle: optionalText(200), emptyAction: optionalText(120), itemLabelPlural: optionalText(60),
  // A new protocol starts without a row (the risk assessment's "Inga risker identifierade ännu"); measurement rows always do.
  startEmpty: z.boolean().default(false),
  // The icon of the empty state (one of the card icons); empty = a clipboard.
  emptyIcon: z.string().trim().max(40).default(""),
  // 2026-09-28: shown only under a condition, and a "Skapa arbetsorder" on each row (a deviation followed up as a work order).
  showIf, workOrders: z.boolean().default(false),
});
/** How an Infokort is shown in the task: folded until opened, an open card, or a notice line. */
export const NOTE_STYLES = ["folded", "card", "notice"] as const;
/** Who signs (2026-09-28): the one who did the work, the one who reviewed it or the one who approved it – printed with the name and time. */
export const SIGNATURE_ROLES = ["other", "performer", "reviewer", "approver"] as const;
const leafBlock = z.discriminatedUnion("type", [
  z.object({ id, type: z.literal("heading"), text: z.string().trim().min(1).max(FORM_LIMITS.label), level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2), width, visibility, showIf }),
  z.object({ id, type: z.literal("text"), text: z.string().trim().max(FORM_LIMITS.text), width, visibility, showIf }),
  fieldBlock,
  // "check" draws the items as tick boxes, like the control's Visuell kontroll; "assessment" asks OK, Ej OK or Ej aktuellt.
  // 2026-09-28: a camera on every point (`photos`) and, for a point that is not OK, "Registrera brist" into a table of
  // deviations (`deviationTable`, the key of a table in the form).
  z.object({ id, type: z.literal("checklist"), key, label, items: z.array(z.object({ id, text: z.string().trim().min(1).max(300) })).min(1, "En checklista behöver minst en punkt.").max(FORM_LIMITS.checklistItems), required: z.boolean().default(true), help: optionalText(500), width, visibility, mode: z.enum(["assessment", "check"]).default("assessment"),
    showIf, photos: z.boolean().default(false), deviationTable: z.string().trim().max(40).default("") }),
  tableBlock,
  z.object({ id, type: z.literal("computed"), key, label, formula, unit: optionalText(20), passCondition: z.boolean().default(false), help: optionalText(500), width, visibility, bands, showIf, limitKey, trend }),
  // "Foto/bilaga": pictures only, or any attached file (2026-09-26, decision 5).
  // `pdfInline`: the pictures are printed in the form; otherwise each gets an attachment page after it (like the control).
  z.object({ id, type: z.literal("images"), key, label, minCount: z.number().int().min(0).max(50).default(0), help: optionalText(500), accept: z.enum(["images", "files"]).default("images"), width, visibility, pdfInline: z.boolean().default(true), showIf }),
  // `statement` is the text beside the tick box ("Jag har granskat riskerna …"); `placeholder` sits in the name field.
  // 2026-09-28: the signer's role, and a review that must be made by another person than the one who signed `distinctFrom`.
  z.object({ id, type: z.literal("signature"), key, label, required: z.boolean().default(true), help: optionalText(500), width, visibility, statement: optionalText(300), placeholder: optionalText(120),
    showIf, role: z.enum(SIGNATURE_ROLES).default("other"), distinctFrom: z.string().trim().max(40).default("") }),
  // A page break in the PDF; nothing is shown in the task.
  z.object({ id, type: z.literal("pagebreak") }),
  // Sammanfattning (2026-09-27): approved per moment, the deviations and their comment, how complete the
  // protocol is and the list of attachments – where the author puts it, like the control's Sammanfattning / avvikelser.
  z.object({ id, type: z.literal("summary"), label: z.string().trim().min(1).max(FORM_LIMITS.label).default("Sammanfattning / avvikelser"), help: optionalText(500), visibility, showIf }),
  // Riskmatris: a reference grid of the products of two scales coloured by the levels (the risk assessment's 5 × 5).
  // `tall`: the matrix spans two rows of the grid, so shorter blocks stack beside it (the risk assessment's Bedömningsstöd).
  z.object({ id, type: z.literal("matrix"), label: z.string().trim().min(1).max(FORM_LIMITS.label).default("Riskmatris 5 × 5"), size: z.number().int().min(2).max(10).default(5),
    xLabel: z.string().trim().max(60).default("Sannolikhet"), yLabel: z.string().trim().max(60).default("Konsekvens"), bands, visibility, width, tall: z.boolean().default(false), showIf }),
  // Infokort: a heading and a text, folded in the task (or an open card or a notice) and a card in the PDF (the control's Stöd vid bedömning).
  z.object({ id, type: z.literal("note"), title: z.string().trim().min(1).max(FORM_LIMITS.label), text: z.string().trim().max(FORM_LIMITS.text).default(""), visibility, width, style: z.enum(NOTE_STYLES).default("folded"), showIf }),
]);
const columnsBlock = z.object({ id, type: z.literal("columns"), columns: z.array(z.array(leafBlock).max(20)).min(2).max(3) });
const sectionBlock = z.object({
  id, type: z.literal("section"), title: z.string().trim().max(FORM_LIMITS.label).default(""), description: optionalText(1000),
  newPage: z.boolean().default(false), blocks: z.array(leafBlock).max(FORM_LIMITS.blocks).default([]),
  // A section that can be switched on and off in the protocol (the control's Isolation, Kontinuitet …), and its PDF style.
  optional: z.boolean().default(false), defaultOn: z.boolean().default(true), pdfStyle: z.enum(SECTION_PDF_STYLES).default("standard"),
  // Folded in the task until opened, like the risk assessment's Bedömningsstöd.
  collapsed: z.boolean().default(false),
  // Task view only (2026-09-27): the explanation behind the (i) of a moment, and a heading that differs from the PDF's.
  help: optionalText(1000), taskTitle: optionalText(200),
  // 2026-09-28: the whole section only under a condition (e.g. "Turbintyp = Kaplan").
  showIf,
});
export const formBlockSchema = z.union([leafBlock, columnsBlock, sectionBlock]);
/** The PDF's heading ("Kontrollprotokoll", "KFID-V1-2026.1") and whether the task's own facts open the report. */
const reportSchema = z.object({ title: z.string().trim().max(120).default(""), code: z.string().trim().max(60).default(""), taskFacts: z.boolean().default(true) });
/** The heading over the sections that can be switched on and off, whether at least one must be on, and where they are chosen. */
export const MOMENT_PLACEMENTS = ["top", "firstSection"] as const;
const momentsSchema = z.object({ label: z.string().trim().max(60).default("Moment"), requireOne: z.boolean().default(false), placement: z.enum(MOMENT_PLACEMENTS).default("top") });
/**
 * The task's own basic data (2026-09-27, the control's Grunduppgifter): in Workflow's own panel, or inside the
 * form's first section with the project, customer and place among the form's fields – then the task's title follows a
 * field (`titleKey`). `requiredMarks` shows an asterisk at required fields.
 */
export const TASK_LAYOUTS = ["panel", "inline"] as const;
// The heading of a new protocol ("Ny kontroll") and the line under it, exactly like the originals (2026-09-28).
const taskSchema = z.object({ layout: z.enum(TASK_LAYOUTS).default("panel"), titleKey: z.string().trim().max(40).default(""), requiredMarks: z.boolean().default(true), newTitle: optionalText(120), tagline: optionalText(200) });
/**
 * Configurable limits (2026-09-28): the form names each limit once – what it is, its unit, an alarm range and an inner
 * warning range, and where the value comes from ("Tillverkarens anvisning", "Vattendom") – usually without numbers.
 * Each facility (and, with `limitObjectKey`, each object at it, e.g. unit G1) gets its own values in a limit profile;
 * a protocol keeps a snapshot of the values it was filled in against. Outside the alarm range is a deviation, outside
 * the warning range only a warning.
 */
const limitNumbers = { low: number, high: number, warnLow: number, warnHigh: number };
const limitSchema = z.object({ key, label, unit: optionalText(20), ...limitNumbers, source: optionalText(300), help: optionalText(500) });
export type FormLimit = z.infer<typeof limitSchema>;
export const formLimitValueSchema = z.object({ ...limitNumbers, source: optionalText(300), origin: z.enum(["form", "facility", "object"]).default("form") });
export type FormLimitValue = z.infer<typeof formLimitValueSchema>;
export const formDocumentSchema = z.object({
  schema: z.union([z.literal(1), z.literal(2)]).default(1), blocks: z.array(formBlockSchema).max(FORM_LIMITS.blocks),
  report: reportSchema.default({ title: "", code: "", taskFacts: true }), moments: momentsSchema.default({ label: "Moment", requireOne: false, placement: "top" }),
  task: taskSchema.default({ layout: "panel", titleKey: "", requiredMarks: true, newTitle: "", tagline: "" }),
  limits: z.array(limitSchema).max(100).default([]),
  // The field that names the object limits are set for (e.g. "aggregat"); empty = one set per facility.
  limitObjectKey: z.string().trim().max(40).default(""),
})
  .refine((document) => formLeafBlocks(document).length <= FORM_LIMITS.blocks, `Ett formulär får ha högst ${FORM_LIMITS.blocks} block.`);

export type FormDocument = z.infer<typeof formDocumentSchema>;
export type FormBlock = z.infer<typeof formBlockSchema>;
export type FormLeafBlock = z.infer<typeof leafBlock>;
export type FormSection = z.infer<typeof sectionBlock>;
export type FormFieldBlock = z.infer<typeof fieldBlock>;
export type FormTableBlock = z.infer<typeof tableBlock>;
export type FormColumn = z.infer<typeof columnSchema>;

/** Every block in reading order, with the blocks inside sections and column rows flattened. */
export function formLeafBlocks(document: { blocks: FormBlock[] }): FormLeafBlock[] {
  return document.blocks.flatMap((block) => block.type === "columns" ? block.columns.flat() : block.type === "section" ? block.blocks : [block]);
}

/** Whether anything in the form can become a deviation; a form without any (the risk assessment) needs no deviation box. */
export function formCanDeviate(document: FormDocument) {
  return formLeafBlocks(document).some((block) => block.type === "checklist" || block.type === "summary"
    || (block.type === "computed" && block.passCondition)
    || (block.type === "field" && (block.min !== null || block.max !== null || block.deviationOptions.length > 0 || block.deviationOn !== "NONE"))
    || (block.type === "table" && block.columns.some((column) => column.input === "assessment" || column.passCondition || column.min !== null || column.max !== null || column.deviationOptions.length > 0)));
}

/** The level a value belongs to: the one with the highest start at or below the value. */
export function formBand(list: FormBand[], value: unknown): FormBand | null {
  if (typeof value !== "number") return null;
  return [...list].sort((a, b) => b.from - a.from).find((band) => value >= band.from) ?? null;
}

/** Whether a section is on: always, unless it can be switched off; then the protocol's choice or its default. */
export function formSectionActive(section: FormSection, values: { sections?: Record<string, boolean> }) {
  return !section.optional || (values.sections?.[section.id] ?? section.defaultOn);
}

type ShownValues = { sections?: Record<string, boolean>; fields?: Record<string, unknown> };
const answered = (value: unknown) => Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && String(value).trim() !== "";
const numeric = (value: unknown) => { const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim().replace(",", ".")); return String(value ?? "").trim() !== "" && Number.isFinite(parsed) ? parsed : null; };

/**
 * Whether a condition is met (villkorad visning). A field that is itself hidden counts as unanswered, so a chain of
 * conditions hides everything below a hidden answer. An unknown field never hides anything (validation reports it).
 */
export function formConditionMet(document: { blocks: FormBlock[] }, values: ShownValues, condition: FormCondition | undefined, seen: Set<string> = new Set()): boolean {
  if (!condition?.key) return true;
  const field = formLeafBlocks(document).find((block): block is FormFieldBlock => block.type === "field" && block.key === condition.key);
  if (!field || seen.has(field.id)) return true;
  const raw = formBlockShown(document, values, field, new Set([...seen, field.id])) ? values.fields?.[field.key] : null;
  const filled = answered(raw);
  if (condition.op === "filled") return filled;
  if (condition.op === "empty") return !filled;
  if (condition.op === "eq" || condition.op === "neq") {
    const target = condition.value.trim().toLowerCase();
    const answers = (Array.isArray(raw) ? raw : filled ? [raw] : []).map((item) => String(item).trim().toLowerCase());
    const match = answers.some((item) => item === target || (numeric(item) !== null && numeric(item) === numeric(target)));
    return condition.op === "eq" ? match : !match;
  }
  const value = numeric(raw);
  const limit = numeric(condition.value);
  if (value === null || limit === null) return false;
  return condition.op === "gt" ? value > limit : condition.op === "gte" ? value >= limit : condition.op === "lt" ? value < limit : value <= limit;
}

/** Whether a section is shown: switched on (a moment) and its condition met. */
export function formSectionShown(document: { blocks: FormBlock[] }, section: FormSection, values: ShownValues, seen: Set<string> = new Set()) {
  return formSectionActive(section, values) && formConditionMet(document, values, section.showIf, seen);
}

/** Whether a block is shown in the protocol: its own condition met and its section shown. */
export function formBlockShown(document: { blocks: FormBlock[] }, values: ShownValues, block: FormLeafBlock, seen: Set<string> = new Set()): boolean {
  if ("showIf" in block && !formConditionMet(document, values, block.showIf, seen)) return false;
  const section = document.blocks.find((item): item is FormSection => item.type === "section" && item.blocks.some((child) => child.id === block.id));
  return !section || formSectionShown(document, section, values, seen);
}

/** The blocks of the sections that are on and shown, in reading order: what counts in requirements, deviations and the PDF. */
export function formActiveLeafBlocks(document: { blocks: FormBlock[] }, values: ShownValues): FormLeafBlock[] {
  const own = (block: FormLeafBlock) => !("showIf" in block) || formConditionMet(document, values, block.showIf);
  return document.blocks.flatMap((block) => block.type === "columns" ? block.columns.flat().filter(own) : block.type === "section" ? (formSectionShown(document, block, values) ? block.blocks.filter(own) : []) : own(block) ? [block] : []);
}

/** The limit a number is judged by: the protocol's snapshot (from the facility's profile) or the form's own values. */
export function formLimitFor(document: FormDocument, values: { limits?: Record<string, FormLimitValue> }, limitKey: string): (FormLimitValue & { label: string; unit: string }) | null {
  if (!limitKey) return null;
  const limit = document.limits.find((item) => item.key === limitKey);
  if (!limit) return null;
  const own = values.limits?.[limitKey];
  return { ...(own ?? { low: limit.low, high: limit.high, warnLow: limit.warnLow, warnHigh: limit.warnHigh, source: limit.source, origin: "form" as const }), label: limit.label, unit: limit.unit };
}

/** A number against its limit: outside the alarm range is "alarm", outside the inner warning range "warning". */
export function formLimitLevel(limit: Pick<FormLimitValue, "low" | "high" | "warnLow" | "warnHigh"> | null, value: unknown): "ok" | "warning" | "alarm" | null {
  if (!limit || typeof value !== "number") return null;
  if ((limit.low !== null && value < limit.low) || (limit.high !== null && value > limit.high)) return "alarm";
  if ((limit.warnLow !== null && value < limit.warnLow) || (limit.warnHigh !== null && value > limit.warnHigh)) return "warning";
  return "ok";
}

/** A limit as text, "10–80 °C", "högst 4,5 mm/s" or "ej angivet". */
export function formLimitText(low: number | null, high: number | null, unit: string) {
  return low === null && high === null ? "ej angivet" : intervalText(low, high, unit);
}

/** The sections that can be switched on and off (the control's Kontrollmoment). */
export const formOptionalSections = (document: { blocks: FormBlock[] }) => document.blocks.filter((block): block is FormSection => block.type === "section" && block.optional);

type FormRow = { id: string; label: string; cells: Record<string, unknown>; example?: boolean };
/** A new row with the columns' default values, or – for the example row – their example values. */
export function newFormRow(table: FormTableBlock, id: string, options: { example?: boolean; label?: string } = {}) {
  const cells: Record<string, string | number | boolean> = {};
  for (const column of table.columns) {
    if (column.input === "formula" || column.input === "images" || (column.input === "assessment" && column.mode === "auto")) continue;
    const value = options.example && column.exampleValue !== null && column.exampleValue !== "" ? column.exampleValue : column.defaultValue;
    if (value !== null && value !== "") cells[column.key] = value;
  }
  return { id, label: options.label ?? "", cells, ...(options.example ? { example: true } : {}) };
}

/** Whether a cell is filled in: a value that is not one of the column's "not filled" options, a ticked box or pictures. */
export function formCellFilled(column: FormColumn, value: unknown) {
  if (column.input === "check" || column.input === "assessment") return value === true;
  if (Array.isArray(value)) return value.length > 0;
  if (value === undefined || value === null || String(value).trim() === "") return false;
  return !(typeof value === "string" && column.notFilledOptions.includes(value));
}

/** A row counts once something beyond the columns' default values has been entered (an added, untouched row does not). */
export function formRowStarted(table: FormTableBlock, row: FormRow) {
  return table.columns.some((column) => {
    if (column.input === "formula" || (column.input === "assessment" && column.mode === "auto")) return false;
    const value = row.cells[column.key];
    if (column.input === "check" || column.input === "assessment") return value === true && column.defaultValue !== true;
    if (Array.isArray(value)) return value.length > 0;
    if (value === undefined || value === null || String(value).trim() === "") return false;
    return column.defaultValue === null || String(value) !== String(column.defaultValue);
  });
}

/** Only short inputs sit side by side; tables, lists, long text and pictures always use the full width. */
export function formBlockCanBeNarrow(block: FormLeafBlock) {
  return (block.type === "field" && block.input !== "textarea") || block.type === "computed" || block.type === "signature" || block.type === "note" || block.type === "matrix";
}
export const formBlockWidth = (block: FormLeafBlock): FormWidth => "width" in block && formBlockCanBeNarrow(block) ? block.width : "full";

/**
 * Tidy rows (2026-09-30: "fält upplevs rörigt arrangerade"): blocks flow into rows of 12 columns as the grid places
 * them; a row of 2, 3 or 4 fields that leaves a gap is shared evenly (halves, thirds, quarters), so every row ends at the
 * same edge and the fields line up. Rows that already fill the width, a single block, or rows with other blocks than
 * fields keep the widths the form was built with.
 */
export function balancedFormWidths(blocks: { width: FormWidth; field: boolean }[]): FormWidth[] {
  const result = blocks.map((block) => block.width);
  let row: number[] = [];
  let used = 0;
  const even: Record<number, FormWidth> = { 2: "half", 3: "third", 4: "quarter" };
  const close = () => {
    if (row.length >= 2 && used < 12 && even[row.length] && row.every((index) => blocks[index].field)) for (const index of row) result[index] = even[row.length];
    row = [];
    used = 0;
  };
  blocks.forEach((block, index) => {
    const span = FORM_WIDTH_SPAN[block.width];
    if (used + span > 12) close();
    row.push(index);
    used += span;
  });
  close();
  return result;
}
export const formBlockSpan = (block: FormLeafBlock) => FORM_WIDTH_SPAN[formBlockWidth(block)];
/** The width nearest to a number of grid columns (the wider one on a tie), used when a block's edge is dragged. */
export function formWidthForSpan(span: number): FormWidth {
  return FORM_WIDTHS.reduce((best, item) => Math.abs(FORM_WIDTH_SPAN[item] - span) <= Math.abs(FORM_WIDTH_SPAN[best] - span) ? item : best, "quarter" as FormWidth);
}
export const formBlockVisible = (block: FormLeafBlock, where: "task" | "pdf") => !("visibility" in block) || block.visibility[where];

/** A row's name: its fixed label, else (for object cards) its first text value, else "Objekt 3" / "rad 3". */
export function formRowLabel(table: FormTableBlock, row: { label: string; cells: Record<string, unknown> }, index: number) {
  if (row.label) return row.label;
  const first = table.columns.find((column) => column.input === "text");
  const named = first ? row.cells[first.key] : null;
  if (typeof named === "string" && named.trim()) return named.trim();
  return `${table.layout === "cards" ? table.itemLabel || "Objekt" : "rad"} ${index + 1}`;
}

/** Attachment ids that the form places itself (picture blocks and object cards; a grid table only counts them), so the PDF does not print them twice. */
export function formPlacedImageIds(document: FormDocument, values: FormValues) {
  const ids = new Set<string>();
  for (const block of formLeafBlocks(document)) {
    if (block.type === "images" && formBlockVisible(block, "pdf")) for (const id of values.images[block.key] ?? []) ids.add(id);
    if (block.type === "checklist" && block.photos && formBlockVisible(block, "pdf")) for (const answer of Object.values(values.checklists[block.key] ?? {})) (answer.images ?? []).forEach((id) => ids.add(id));
    if (block.type === "table" && block.layout === "cards" && formBlockVisible(block, "pdf")) for (const column of block.columns.filter((item) => item.input === "images"))
      for (const row of values.tables[block.key] ?? []) { const cell = row.cells[column.key]; if (Array.isArray(cell)) cell.forEach((id) => ids.add(id)); }
  }
  return ids;
}

// ---------- values (a protocol's answers) ----------
const cell = z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.null(), z.array(z.string().max(120)).max(FORM_LIMITS.options)]);
export const formValuesSchema = z.object({
  fields: z.record(z.string(), cell).default({}),
  // A point's pictures (2026-09-28, `photos`): attachment ids, printed under the checklist.
  checklists: z.record(z.string(), z.record(z.string(), z.object({ state: z.enum(["OK", "NOT_OK", "NA"]).nullable().default(null), comment: optionalText(1000), images: z.array(z.string().min(1).max(100)).max(20).optional() }))).default({}),
  // `example`: a test row that shows how to fill in the table; it never counts and must be removed before completion.
  // `source`: the checklist point a deviation row was registered from; `workOrderId`: the work order made from the row.
  tables: z.record(z.string(), z.array(z.object({ id, label: optionalText(120), cells: z.record(z.string(), cell).default({}), example: z.boolean().optional(),
    source: z.object({ checklist: z.string().max(40), item: z.string().max(60) }).optional(), workOrderId: z.string().min(1).max(100).optional() })).max(FORM_LIMITS.rows)).default({}),
  images: z.record(z.string(), z.array(z.string().min(1).max(100)).max(50)).default({}),
  signatures: z.record(z.string(), z.object({ name: optionalText(160), confirmed: z.boolean().default(false), signedAt: z.iso.datetime().nullable().default(null) })).default({}),
  /** Required when the protocol has deviations, like the control's summary. */
  deviationComment: optionalText(10_000),
  /** Which sections that can be switched off are on, by section id; a missing section uses its default. */
  sections: z.record(z.string(), z.boolean()).default({}),
  /** A comment and a deviation of one's own on a field with `remarks` (2026-09-28), by field key. */
  remarks: z.record(z.string(), z.object({ comment: optionalText(1000), deviation: z.boolean().default(false) })).default({}),
  /** The limits the protocol was filled in against, by limit key: a snapshot of the facility's profile. */
  limits: z.record(z.string(), formLimitValueSchema).default({}),
  /** A round started from a schedule (2026-09-28): the schedule and the day it was due. */
  round: z.object({ scheduleId: z.string().min(1).max(100), occurrence: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).nullable().default(null),
});
export type FormValues = z.infer<typeof formValuesSchema>;
export const emptyFormValues = (): FormValues => formValuesSchema.parse({});

/** Fixed table rows appear from the start; free tables start with one empty row; default values are filled in. */
export function initialFormValues(document: FormDocument): FormValues {
  const values = emptyFormValues();
  for (const section of formOptionalSections(document)) values.sections[section.id] = section.defaultOn;
  for (const block of formLeafBlocks(document)) {
    // Measurement rows start empty like the control ("Lägg till din första rad"), as does a table that says so; other
    // free tables open with one row.
    if (block.type === "table") values.tables[block.key] = block.rowMode === "fixed"
      ? block.fixedRows.map((rowLabel, index) => newFormRow(block, `row-${index + 1}`, { label: rowLabel }))
      : block.layout === "rows" || block.taskLayout === "rows" || block.startEmpty ? [] : [newFormRow(block, "row-1")];
    if (block.type === "field" && block.defaultValue !== null && block.defaultValue !== "") {
      if (block.input === "choice" && block.multiple) values.fields[block.key] = block.options.includes(String(block.defaultValue)) ? [String(block.defaultValue)] : [];
      else values.fields[block.key] = block.input === "number" ? Number(String(block.defaultValue).replace(",", ".")) : block.defaultValue;
    }
  }
  return values;
}

// ---------- validation of a form document (on save and before publishing) ----------
export type FormIssue = { blockId?: string; message: string };

/** Checks keys, formulas, references and cycles. Returns every issue so the editor can show them together. */
export function validateFormDocument(input: unknown): { document: FormDocument | null; issues: FormIssue[] } {
  const parsed = formDocumentSchema.safeParse(input);
  if (!parsed.success) return { document: null, issues: parsed.error.issues.slice(0, 20).map((issue) => ({ message: `${issue.path.join(".")}: ${issue.message}` })) };
  const document = parsed.data;
  const issues: FormIssue[] = [];
  const keys = new Map<string, string>();
  const valued = new Set<string>();
  const yesno = new Set(formLeafBlocks(document).flatMap((block) => block.type === "field" && block.input === "yesno" ? [block.key] : []));
  const fieldKeys = new Set(formLeafBlocks(document).flatMap((block) => block.type === "field" ? [block.key] : []));
  const tableKeys = new Set(formLeafBlocks(document).flatMap((block) => block.type === "table" ? [block.key] : []));
  const signatureKeys = new Set(formLeafBlocks(document).flatMap((block) => block.type === "signature" ? [block.key] : []));
  const limitKeys = new Set<string>();
  for (const limit of document.limits) {
    if (limitKeys.has(limit.key)) issues.push({ message: `Gränsvärdet ${limit.key} finns två gånger.` });
    limitKeys.add(limit.key);
    if (limit.low !== null && limit.high !== null && limit.low > limit.high) issues.push({ message: `${limit.label}: den nedre larmgränsen är större än den övre.` });
    if (limit.warnLow !== null && limit.warnHigh !== null && limit.warnLow > limit.warnHigh) issues.push({ message: `${limit.label}: den nedre varningsgränsen är större än den övre.` });
  }
  if (document.limitObjectKey && !fieldKeys.has(document.limitObjectKey)) issues.push({ message: `Gränsvärden per objekt använder fältet ${document.limitObjectKey}, som inte finns.` });
  // Conditions read a field that exists and is not the block itself.
  const conditionIssue = (blockId: string, name: string, condition: FormCondition, ownKey?: string) => {
    if (!condition.key) return;
    if (!fieldKeys.has(condition.key)) issues.push({ blockId, message: `${name}: villkoret använder fältet ${condition.key}, som inte finns.` });
    else if (condition.key === ownKey) issues.push({ blockId, message: `${name}: ett fält kan inte visas på villkor av sig självt.` });
    else if (["eq", "neq", "gt", "gte", "lt", "lte"].includes(condition.op) && !condition.value) issues.push({ blockId, message: `${name}: ange värdet i villkoret.` });
  };
  for (const section of document.blocks) if (section.type === "section") conditionIssue(section.id, section.title || "Avsnitt", section.showIf);
  // A section hidden by a field of its own could never be shown again.
  for (const section of document.blocks) if (section.type === "section" && section.showIf.key && section.blocks.some((block) => block.type === "field" && block.key === section.showIf.key))
    issues.push({ blockId: section.id, message: `${section.title || "Avsnittet"}: visas på villkor av ett fält i samma avsnitt och kan då aldrig visas. Flytta fältet till ett annat avsnitt.` });
  for (const block of formLeafBlocks(document)) {
    if ("showIf" in block) conditionIssue(block.id, "label" in block ? block.label : block.type === "note" ? block.title : "text" in block ? block.text.slice(0, 40) : "Blocket", block.showIf, "key" in block ? block.key : undefined);
    if ((block.type === "field" || block.type === "computed") && block.limitKey && !limitKeys.has(block.limitKey)) issues.push({ blockId: block.id, message: `${block.label}: gränsvärdet ${block.limitKey} finns inte.` });
    if (block.type === "field" && block.limitKey && block.input !== "number") issues.push({ blockId: block.id, message: `${block.label}: bara ett talfält kan ha gränsvärde.` });
    if (block.type === "checklist" && block.deviationTable && !tableKeys.has(block.deviationTable)) issues.push({ blockId: block.id, message: `${block.label}: tabellen för brister (${block.deviationTable}) finns inte.` });
    if (block.type === "signature" && block.distinctFrom && (!signatureKeys.has(block.distinctFrom) || block.distinctFrom === block.key)) issues.push({ blockId: block.id, message: `${block.label}: välj en annan signatur som granskningen ska jämföras med.` });
    if (block.type === "table") for (const column of block.columns) {
      if (column.limitKey && !limitKeys.has(column.limitKey)) issues.push({ blockId: block.id, message: `${block.label}, ${column.label}: gränsvärdet ${column.limitKey} finns inte.` });
      if (column.allowedMin !== null && column.allowedMax !== null && column.allowedMin > column.allowedMax) issues.push({ blockId: block.id, message: `${block.label}, ${column.label}: lägsta tillåtna värde är större än högsta.` });
    }
    if (!("key" in block)) continue;
    if (keys.has(block.key)) issues.push({ blockId: block.id, message: `Kortnamnet ${block.key} används redan.` });
    keys.set(block.key, block.id);
    if (block.type === "field" || block.type === "computed") valued.add(block.key);
    if (block.type === "field" && block.input === "choice" && !block.options.length) issues.push({ blockId: block.id, message: `${block.label}: ange minst ett alternativ.` });
    if (block.type === "field" && block.min !== null && block.max !== null && block.min > block.max) issues.push({ blockId: block.id, message: `${block.label}: min är större än max.` });
    if (block.type === "field" && block.allowedMin !== null && block.allowedMax !== null && block.allowedMin > block.allowedMax) issues.push({ blockId: block.id, message: `${block.label}: lägsta tillåtna värde är större än högsta.` });
    if (block.type === "field" && block.input === "choice" && block.deviationOptions.some((option) => !block.options.includes(option))) issues.push({ blockId: block.id, message: `${block.label}: ett avvikande alternativ finns inte bland alternativen.` });
    if (block.type === "field" && block.defaultValue !== null && block.defaultValue !== "") {
      const value = String(block.defaultValue);
      if (block.input === "number" && !Number.isFinite(Number(value.replace(",", ".")))) issues.push({ blockId: block.id, message: `${block.label}: standardvärdet är inte ett tal.` });
      if (block.input === "choice" && !block.options.includes(value)) issues.push({ blockId: block.id, message: `${block.label}: standardvärdet finns inte bland alternativen.` });
      if (block.input === "yesno" && !["YES", "NO", "NA"].includes(value)) issues.push({ blockId: block.id, message: `${block.label}: standardvärdet ska vara Ja, Nej eller Ej aktuellt.` });
    }
    if (block.type === "field" && block.momentSwitch && block.input !== "yesno") issues.push({ blockId: block.id, message: `${block.label}: bara ett Ja/nej-fält kan ligga bland momenten.` });
    if (block.type === "table") {
      const columnKeys = new Set<string>();
      if (block.rowMode === "fixed" && !block.fixedRows.length) issues.push({ blockId: block.id, message: `${block.label}: ange minst en fast rad.` });
      if (block.columns.filter((column) => column.input === "assessment").length > 1) issues.push({ blockId: block.id, message: `${block.label}: en tabell kan ha en Godkänd-kolumn.` });
      if (block.columns[0]?.pdf === "join") issues.push({ blockId: block.id, message: `${block.label}: den första kolumnen kan inte slås ihop med en kolumn före.` });
      for (const name of block.cardTitle.matchAll(/\{([^}]*)\}/g)) if (!block.columns.some((column) => column.key === name[1].trim())) issues.push({ blockId: block.id, message: `${block.label}: rubriken i PDF använder {${name[1]}}, som inte är en kolumn.` });
      for (const column of block.columns) {
        if (columnKeys.has(column.key)) issues.push({ blockId: block.id, message: `${block.label}: kolumnnamnet ${column.key} används två gånger.` });
        columnKeys.add(column.key);
        valued.add(`${block.key}.${column.key}`);
        if (column.input === "choice" && !column.options.length) issues.push({ blockId: block.id, message: `${block.label}, ${column.label}: ange minst ett alternativ.` });
        if (column.input === "formula" && !column.formula) issues.push({ blockId: block.id, message: `${block.label}, ${column.label}: ange en formel.` });
        if (column.input === "choice" && column.deviationOptions.some((option) => !column.options.includes(option))) issues.push({ blockId: block.id, message: `${block.label}, ${column.label}: ett avvikande alternativ finns inte bland alternativen.` });
        if (column.input === "choice" && column.notFilledOptions.some((option) => !column.options.includes(option))) issues.push({ blockId: block.id, message: `${block.label}, ${column.label}: ett alternativ som räknas som ej ifyllt finns inte bland alternativen.` });
        if (column.input === "choice" && typeof column.defaultValue === "string" && column.defaultValue && !column.options.includes(column.defaultValue)) issues.push({ blockId: block.id, message: `${block.label}, ${column.label}: standardvärdet finns inte bland alternativen.` });
        if (column.input === "assessment" && column.mode !== "manual" && !column.formula) issues.push({ blockId: block.id, message: `${block.label}, ${column.label}: ange villkoret för godkänt.` });
        if (column.input === "assessment" && column.mode === "switch" && !yesno.has(column.switchKey)) issues.push({ blockId: block.id, message: `${block.label}, ${column.label}: välj det Ja/nej-fält som slår på villkoret.` });
        if (column.requiredIf && !yesno.has(column.requiredIf)) issues.push({ blockId: block.id, message: `${block.label}, ${column.label}: kravet gäller ett Ja/nej-fält som inte finns.` });
      }
    }
  }
  try { compileForm(document); } catch (error) {
    // A cycle is shown on every block it passes through.
    if (error instanceof FormulaCycleError) for (const blockId of new Set(error.names.map((name) => blockIdForName(document, name)).filter((item): item is string => Boolean(item)))) issues.push({ blockId, message: error.message });
    else if (error instanceof FormulaError) issues.push({ message: error.message });
    else throw error;
  }
  for (const item of formulaIssues(document, valued)) issues.push(item);
  return { document, issues };
}

function blockIdForName(document: FormDocument, name: string) {
  const [blockKey] = name.split(".");
  return formLeafBlocks(document).find((block) => "key" in block && block.key === blockKey)?.id;
}

function formulaIssues(document: FormDocument, valued: Set<string>) {
  const issues: FormIssue[] = [];
  for (const block of formLeafBlocks(document)) {
    const check = (source: string, where: string, cells?: Set<string>) => {
      try {
        const references = formulaReferences(parseFormula(source));
        for (const ref of references.refs) if (!valued.has(ref)) issues.push({ blockId: block.id, message: `${where}: okänt kortnamn "${ref}".` });
        for (const name of references.cells) if (!cells) issues.push({ blockId: block.id, message: `${where}: [${name}] kan bara användas i en tabellkolumn.` });
          else if (!cells.has(name)) issues.push({ blockId: block.id, message: `${where}: kolumnen [${name}] finns inte i tabellen.` });
      } catch (error) {
        if (error instanceof FormulaError) issues.push({ blockId: block.id, message: `${where}: ${error.message}` });
        else throw error;
      }
    };
    if (block.type === "computed") check(block.formula, block.label);
    if (block.type === "table") {
      const cells = new Set(block.columns.map((column) => column.key));
      for (const column of block.columns.filter((item) => (item.input === "formula" || (item.input === "assessment" && item.mode !== "manual")) && item.formula)) check(column.formula, `${block.label}, ${column.label}`, cells);
    }
  }
  return issues;
}

type Compiled = { order: string[]; computed: Map<string, { node: FormulaNode; block: Extract<FormLeafBlock, { type: "computed" }> }>; columns: Map<string, { node: FormulaNode; table: FormTableBlock; column: FormColumn }> };

/** Parses every formula once and orders them so each is computed after what it depends on. Throws on a cycle. */
export function compileForm(document: FormDocument): Compiled {
  const computed: Compiled["computed"] = new Map();
  const columns: Compiled["columns"] = new Map();
  const dependencies = new Map<string, string[]>();
  for (const block of formLeafBlocks(document)) {
    if (block.type === "computed") {
      let node: FormulaNode;
      try { node = parseFormula(block.formula); } catch { continue; }
      computed.set(block.key, { node, block });
      dependencies.set(block.key, formulaReferences(node).refs);
    }
    if (block.type === "table") for (const column of block.columns) {
      // A Godkänd column decided by its condition is computed like a formula column.
      if (!((column.input === "formula" || (column.input === "assessment" && column.mode !== "manual")) && column.formula)) continue;
      let node: FormulaNode;
      try { node = parseFormula(column.formula); } catch { continue; }
      const name = `${block.key}.${column.key}`;
      columns.set(name, { node, table: block, column });
      const references = formulaReferences(node);
      dependencies.set(name, [...references.refs, ...references.cells.map((cellName) => `${block.key}.${cellName}`)]);
    }
  }
  return { order: orderByDependencies(dependencies), computed, columns };
}

// ---------- evaluation of a protocol ----------
/** `kind: "assessment"`: a row or point that is not approved; the summary counts these per moment instead of listing them. */
/** `kind: "limit"`: a value outside its configurable alarm range; `"remark"`: marked as a deviation by hand. */
export type FormDeviation = { blockId: string; key: string; label: string; rowId?: string; message: string; kind?: "assessment" | "limit" | "remark"; column?: string };
/** A value outside its warning range (2026-09-28): shown in amber and listed, never a deviation. */
export type FormAlert = { blockId: string; key: string; label: string; rowId?: string; column?: string; message: string };
export type FormEvaluation = {
  computed: Record<string, FormulaValue>;
  /** Formula column results per table row. */
  cells: Record<string, Record<string, Record<string, FormulaValue>>>;
  totals: Record<string, Record<string, FormulaValue>>;
  deviations: FormDeviation[];
  /** Formula problems (e.g. division by zero), shown as a note. */
  warnings: string[];
  alerts: FormAlert[];
};

const inputValue = (value: unknown, input: string): FormulaValue => {
  // Pictures count in formulas (e.g. objects with a thermal image); the attachment ids themselves are never exposed.
  if (input === "images") return Array.isArray(value) ? value.length : 0;
  if (input === "check") return value === true;
  if (value === undefined || value === null || value === "") return null;
  if (input === "number" || input === "scale") return typeof value === "number" ? value : Number.isFinite(Number(String(value).replace(",", "."))) ? Number(String(value).replace(",", ".")) : null;
  if (input === "yesno") return value === "YES" ? true : value === "NO" ? false : null;
  if (Array.isArray(value)) return value.join(", ");
  return typeof value === "boolean" || typeof value === "number" ? value : String(value);
};

export function evaluateForm(document: FormDocument, values: FormValues): FormEvaluation {
  const result: FormEvaluation = { computed: {}, cells: {}, totals: {}, deviations: [], warnings: [], alerts: [] };
  const blocks = formLeafBlocks(document);
  // Formulas see every block of switched-off moments; requirements, deviations and totals only count the sections that
  // are on. A block hidden by its condition (or its section's) is empty everywhere, formulas included.
  const active = new Set(formActiveLeafBlocks(document, values).map((block) => block.id));
  const conditioned = (block: FormLeafBlock) => {
    if ("showIf" in block && !formConditionMet(document, values, block.showIf)) return true;
    const section = document.blocks.find((item): item is FormSection => item.type === "section" && item.blocks.some((child) => child.id === block.id));
    return Boolean(section && !formConditionMet(document, values, section.showIf));
  };
  const hidden = new Set(blocks.filter(conditioned).map((block) => block.id));
  const tables = blocks.filter((block): block is FormTableBlock => block.type === "table");
  const rowsOf = (table: FormTableBlock) => hidden.has(table.id) ? [] : values.tables[table.key] ?? [];
  // An example row shows how to fill in the table; it never counts in lists, totals or deviations.
  const realRows = (table: FormTableBlock) => rowsOf(table).filter((row) => !row.example);
  const computedColumn = (column: FormColumn) => column.input === "formula" || column.input === "assessment";
  const cellValue = (table: FormTableBlock, row: FormValues["tables"][string][number], column: FormColumn): FormulaValue =>
    computedColumn(column) ? result.cells[table.key]?.[row.id]?.[column.key] ?? null : inputValue(row.cells[column.key], column.input);
  const warn = (message: string) => { if (!result.warnings.includes(message)) result.warnings.push(message); };
  const ref = (name: string): FormulaValue | undefined => {
    if (name in result.computed) return result.computed[name];
    const field = blocks.find((block): block is FormFieldBlock => block.type === "field" && block.key === name);
    if (field) return hidden.has(field.id) ? null : inputValue(values.fields[field.key], field.input);
    const [tableKey, columnKey] = name.split(".");
    const table = tables.find((block) => block.key === tableKey);
    const column = table?.columns.find((item) => item.key === columnKey);
    if (table && column) return realRows(table).map((row) => cellValue(table, row, column));
    if (blocks.some((block) => block.type === "computed" && block.key === name)) return null;
    return undefined;
  };
  // A Godkänd column: by hand, or by its condition – for "switch" only while its Ja/nej field is Ja.
  const byCondition = (column: FormColumn) => column.mode === "auto" || (column.mode === "switch" && values.fields[column.switchKey] === "YES");
  // By hand, a ticked box is approved and an unticked one is not assessed yet (null): docs/rapportprinciper.md says an
  // assessment that was not made is empty, never "Ej godkänd" (totalkontrollen F7, 2026-09-29).
  for (const table of tables) for (const column of table.columns.filter((item) => item.input === "assessment" && !byCondition(item)))
    for (const row of rowsOf(table)) ((result.cells[table.key] ??= {})[row.id] ??= {})[column.key] = row.cells[column.key] === true ? true : null;
  let compiled: Compiled;
  try { compiled = compileForm(document); } catch (error) { warn((error as Error).message); return result; }
  for (const name of compiled.order) {
    const computed = compiled.computed.get(name);
    if (computed) {
      if (hidden.has(computed.block.id)) { result.computed[name] = null; continue; }
      try { result.computed[name] = evaluateFormula(computed.node, { ref, warn }); } catch (error) { warn((error as Error).message); result.computed[name] = null; }
      continue;
    }
    const formulaColumn = compiled.columns.get(name);
    if (!formulaColumn) continue;
    const { table, column, node } = formulaColumn;
    if (column.input === "assessment" && !byCondition(column)) continue;
    for (const row of rowsOf(table)) {
      const cells = (result.cells[table.key] ??= {});
      const rowCells = (cells[row.id] ??= {});
      const cellScope = (cellName: string) => { const target = table.columns.find((item) => item.key === cellName); return target ? cellValue(table, row, target) : undefined; };
      try {
        const value = evaluateFormula(node, { ref, cell: cellScope, warn });
        // Godkänd is yes only when the condition is fulfilled; an incomplete row is not approved.
        rowCells[column.key] = column.input === "assessment" ? value === true : value;
      } catch (error) { warn((error as Error).message); rowCells[column.key] = column.input === "assessment" ? false : null; }
    }
  }
  // Column totals and deviations.
  for (const table of tables) {
    const counts = active.has(table.id);
    for (const column of table.columns) {
      const list = realRows(table).map((row) => cellValue(table, row, column)).filter((item): item is number => typeof item === "number");
      if (column.total !== "none") (result.totals[table.key] ??= {})[column.key] = !list.length ? null
        : column.total === "sum" ? list.reduce((sum, item) => sum + item, 0) : column.total === "min" ? Math.min(...list) : column.total === "max" ? Math.max(...list) : list.reduce((sum, item) => sum + item, 0) / list.length;
      if (!counts) continue;
      for (const row of realRows(table)) {
        const value = cellValue(table, row, column);
        const where = `${table.label}, ${formRowLabel(table, row, rowsOf(table).indexOf(row))}`;
        // Not approved by the condition, or not assessed by hand: either way the protocol needs a word on it before completion.
        if (column.input === "assessment" && formRowStarted(table, row) && value !== true) result.deviations.push({ blockId: table.id, key: table.key, rowId: row.id, label: table.label, message: `${where}: ${value === false ? "inte godkänd" : "inte bedömd"}.`, kind: "assessment" });
        if (column.input === "formula" && column.passCondition && value === false) result.deviations.push({ blockId: table.id, key: table.key, rowId: row.id, label: table.label, message: `${where}: ${column.label} är inte uppfyllt.` });
        if (column.input === "number" && typeof value === "number" && ((column.min !== null && value < column.min) || (column.max !== null && value > column.max)))
          result.deviations.push({ blockId: table.id, key: table.key, rowId: row.id, label: table.label, message: `${where}: ${column.label} ${value} ligger utanför ${intervalText(column.min, column.max, column.unit)}.` });
        if (column.input === "choice" && typeof value === "string" && column.deviationOptions.includes(value))
          result.deviations.push({ blockId: table.id, key: table.key, rowId: row.id, label: table.label, message: `${where}: ${column.label} – ${value}.` });
        if ((column.input === "number" || column.input === "formula") && column.limitKey) judgeLimit(table.id, table.key, `${where}: ${column.label}`, column.limitKey, value, row.id, column.key);
      }
    }
  }
  function judgeLimit(blockId: string, key: string, name: string, limitKey: string, value: FormulaValue, rowId?: string, column?: string) {
    const limit = formLimitFor(document, values, limitKey);
    const level = formLimitLevel(limit, value);
    if (!limit || !level || level === "ok" || typeof value !== "number") return;
    const shown = `${String(value).replace(".", ",")}${limit.unit ? ` ${limit.unit}` : ""}`;
    if (level === "alarm") result.deviations.push({ blockId, key, rowId, column, label: name, kind: "limit", message: `${name} ${shown} ligger utanför larmgränsen ${formLimitText(limit.low, limit.high, limit.unit)}.` });
    else result.alerts.push({ blockId, key, rowId, column, label: name, message: `${name} ${shown} ligger utanför varningsgränsen ${formLimitText(limit.warnLow, limit.warnHigh, limit.unit)}.` });
  }
  for (const block of blocks.filter((item) => active.has(item.id))) {
    if (block.type === "field" && block.remarks && values.remarks[block.key]?.deviation) {
      const comment = values.remarks[block.key].comment.trim();
      result.deviations.push({ blockId: block.id, key: block.key, label: block.label, kind: "remark", message: `${block.label}: avvikelse${comment ? ` – ${comment}` : ""}.` });
    }
    if (block.type === "field" && block.limitKey) judgeLimit(block.id, block.key, block.label, block.limitKey, inputValue(values.fields[block.key], block.input));
    if (block.type === "computed" && block.limitKey) judgeLimit(block.id, block.key, block.label, block.limitKey, result.computed[block.key] ?? null);
    if (block.type === "field") {
      const value = inputValue(values.fields[block.key], block.input);
      if (block.input === "number" && typeof value === "number" && ((block.min !== null && value < block.min) || (block.max !== null && value > block.max)))
        result.deviations.push({ blockId: block.id, key: block.key, label: block.label, message: `${block.label} ${value} ligger utanför ${intervalText(block.min, block.max, block.unit)}.` });
      if (block.input === "choice" && block.deviationOptions.length) {
        const answer = values.fields[block.key];
        const chosen = (Array.isArray(answer) ? answer : typeof answer === "string" && answer ? [answer] : []).filter((option) => block.deviationOptions.includes(option));
        if (chosen.length) result.deviations.push({ blockId: block.id, key: block.key, label: block.label, message: `${block.label}: ${chosen.join(", ")} är en avvikelse.` });
      }
      if (block.input === "yesno" && block.deviationOn !== "NONE" && values.fields[block.key] === block.deviationOn)
        result.deviations.push({ blockId: block.id, key: block.key, label: block.label, message: `${block.label}: svaret ${block.deviationOn === "YES" ? "Ja" : "Nej"} är en avvikelse.` });
    }
    if (block.type === "checklist") for (const item of block.items)
      if (values.checklists[block.key]?.[item.id]?.state === "NOT_OK") result.deviations.push({ blockId: block.id, key: block.key, rowId: item.id, label: block.label, message: `${block.label}: ${item.text} är inte OK.`, ...(block.mode === "check" ? { kind: "assessment" as const } : {}) });
    if (block.type === "computed" && block.passCondition && result.computed[block.key] === false)
      result.deviations.push({ blockId: block.id, key: block.key, label: block.label, message: `${block.label} är inte uppfyllt.` });
  }
  return result;
}

/**
 * Approved per moment for the summary (the control's "Isolation: 3/4 godkända"): every table with a Godkänd column and
 * every tick-box checklist in the sections that are on. Example rows do not count.
 */
export function formApprovalTotals(document: FormDocument, values: FormValues, evaluation = evaluateForm(document, values)) {
  const totals: { blockId: string; title: string; ok: number; total: number }[] = [];
  for (const block of formActiveLeafBlocks(document, values)) {
    if (block.type === "table") {
      const column = block.columns.find((item) => item.input === "assessment");
      if (!column) continue;
      const rows = (values.tables[block.key] ?? []).filter((row) => !row.example);
      totals.push({ blockId: block.id, title: block.label, ok: rows.filter((row) => evaluation.cells[block.key]?.[row.id]?.[column.key] === true).length, total: rows.length });
    }
    if (block.type === "checklist" && block.mode === "check")
      totals.push({ blockId: block.id, title: block.label, ok: block.items.filter((item) => values.checklists[block.key]?.[item.id]?.state === "OK").length, total: block.items.length });
  }
  return totals;
}

/**
 * What a written summary is made from (2026-10-02): the rules' summary, then every deviation with its row – the
 * summary itself only counts them ("0 av 1 godkända"), and a text about the result must be able to say which row it
 * was – and the person's own note. Only material for a writer; the field still gets the rules' summary as it is.
 */
export function formSummaryMaterial(document: FormDocument, values: FormValues, evaluation = evaluateForm(document, values)) {
  const rows = evaluation.deviations.filter((deviation) => deviation.kind !== "limit").slice(0, 20).map((deviation) => `• ${deviation.message}`);
  const note = values.deviationComment?.trim();
  return [formRuleSummary(document, values, evaluation), ...(rows.length ? ["", "Avvikelser:", ...rows] : []), ...(note ? ["", `Anteckning: ${note}`] : [])].join("\n");
}

/**
 * "Sammanställ resultat" (the control's, 2026-09-27): a first draft of the summary comment from the answers –
 * what was checked, approved per moment, the comments on the rows and each tick box's state. Edited freely afterwards.
 */
export function formRuleSummary(document: FormDocument, values: FormValues, evaluation = evaluateForm(document, values)) {
  const filled = (value: unknown) => value !== undefined && value !== null && String(value).trim() !== "";
  const subject = formLeafBlocks(document).find((block) => block.type === "field" && block.highlight && filled(values.fields[block.key]));
  const lines = [subject ? `Kontroll av ${String(values.fields[(subject as FormFieldBlock).key]).trim()}.` : `${document.report.title || "Protokoll"}.`];
  const active = formActiveLeafBlocks(document, values);
  for (const block of active) {
    if (block.type !== "table") continue;
    const column = block.columns.find((item) => item.input === "assessment");
    const rows = (values.tables[block.key] ?? []).filter((row) => !row.example);
    if (column) lines.push(`${block.label}: ${rows.filter((row) => evaluation.cells[block.key]?.[row.id]?.[column.key] === true).length} av ${rows.length} kontrollrader godkända.`);
  }
  for (const block of active) {
    if (block.type === "table") for (const [index, row] of (values.tables[block.key] ?? []).entries()) for (const column of block.columns.filter((item) => item.input === "textarea")) {
      const text = row.cells[column.key];
      if (typeof text === "string" && text.trim()) lines.push(`${block.label} — ${formRowLabel(block, row, index)}: ${text.trim()}`);
    }
    if (block.type === "checklist" && block.mode === "check") for (const item of block.items) lines.push(`${item.text}: ${values.checklists[block.key]?.[item.id]?.state === "OK" ? "kontrollerat" : "ej bekräftat"}.`);
    if (block.type === "checklist" && block.mode === "assessment") for (const item of block.items) {
      const answer = values.checklists[block.key]?.[item.id];
      if (answer?.state === "NOT_OK") lines.push(`${block.label} — ${item.text}: ej OK${answer.comment.trim() ? ` (${answer.comment.trim()})` : ""}.`);
    }
    if (block.type === "field" && block.remarks && values.remarks[block.key]?.comment.trim()) lines.push(`${block.label}: ${values.remarks[block.key].comment.trim()}`);
  }
  for (const item of evaluation.deviations.filter((deviation) => deviation.kind === "limit")) lines.push(`Larm: ${item.message}`);
  for (const alert of evaluation.alerts) lines.push(`Varning: ${alert.message}`);
  // A conclusion (2026-10-01: the summary said only "Kontrollprotokoll."): what was found, in one line.
  const deviations = evaluation.deviations.length;
  const unconfirmed = active.reduce((sum, block) => sum + (block.type === "checklist" && block.mode === "check" ? block.items.filter((item) => values.checklists[block.key]?.[item.id]?.state !== "OK").length : 0), 0);
  lines.push(lines.length === 1 ? "Inga kontrollpunkter är registrerade ännu."
    : deviations ? `Bedömning: ${deviations} ${deviations === 1 ? "avvikelse" : "avvikelser"} – åtgärdas och följs upp före slutligt godkännande.`
    : unconfirmed ? `Bedömning: inga avvikelser hittills, men ${unconfirmed} ${unconfirmed === 1 ? "punkt är" : "punkter är"} inte bekräftade.`
    : "Bedömning: inga avvikelser – de kontrollerade punkterna är godkända.");
  return lines.join("\n");
}

function intervalText(min: number | null, max: number | null, unit: string) {
  const suffix = unit ? ` ${unit}` : "";
  const show = (value: number) => String(value).replace(".", ",");
  return min !== null && max !== null ? `${show(min)}–${show(max)}${suffix}` : min !== null ? `minst ${show(min)}${suffix}` : `högst ${show(max ?? 0)}${suffix}`;
}

// ---------- completion and progression ----------
export type FormRequirement = { blockId: string; message: string; met: boolean };

/**
 * The same requirements drive the editor's guidance, completion on the server, progression and the report. Like the
 * control (2026-09-27), a table asks for its required values row by row and a checklist point by point, so the
 * degree of completion reads the same; switched-off sections ask for nothing.
 */
export function formCompletion(document: FormDocument, values: FormValues, options: { imageCount?: (key: string) => number } = {}) {
  const evaluation = evaluateForm(document, values);
  const requirements: FormRequirement[] = [];
  const add = (blockId: string, message: string, met: boolean) => requirements.push({ blockId, message, met });
  const filled = (value: unknown) => Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && String(value).trim() !== "";
  const optional = formOptionalSections(document);
  if (document.moments.requireOne && optional.length)
    add(optional[0].id, `Välj minst ett ${(document.moments.label || "moment").toLowerCase()}.`, optional.some((section) => formSectionActive(section, values)));
  // A block hidden in the task cannot be filled in there, so it never becomes a requirement.
  for (const block of formActiveLeafBlocks(document, values).filter((item) => formBlockVisible(item, "task"))) {
    if (block.type === "field" && block.required) add(block.id, `Fyll i ${block.label}.`, filled(values.fields[block.key]));
    if (block.type === "field" && filled(values.fields[block.key])) {
      const problem = fieldValidationMessage(block, values.fields[block.key]);
      if (problem) add(block.id, problem, false);
    }
    if (block.type === "checklist" && block.required) for (const item of block.items)
      add(block.id, `${block.label}: ${block.mode === "check" ? "registrera" : "bedöm"} ”${item.text}”.`, Boolean(values.checklists[block.key]?.[item.id]?.state));
    if (block.type === "table") {
      const all = values.tables[block.key] ?? [];
      const real = all.filter((row) => !row.example);
      const started = real.filter((row) => formRowStarted(block, row));
      // Fixed rows (L1–PE …) must all be measured. A free row that nobody started – the empty card or row a free table
      // opens with – is not a requirement; only rows with content need their required columns (2026-09-26, field use).
      const rows = block.rowMode === "fixed" ? real : started;
      if (block.required) add(block.id, `${block.label}: fyll i minst en rad.`, started.length > 0);
      if (block.allowExample) add(block.id, `${block.label}: ta bort exempelraden före slutförande.`, !all.some((row) => row.example));
      const columns = block.columns.filter((column) => column.required && column.input !== "formula" && column.input !== "assessment" && (!column.requiredIf || values.fields[column.requiredIf] === "YES"));
      const checked = block.columns.filter((column) => column.input === "number" && (column.allowedMin !== null || column.allowedMax !== null || column.decimals !== null));
      for (const row of rows) {
        const name = block.rowMode === "fixed" ? row.label : `${block.layout === "cards" ? block.itemLabel || "Objekt" : "rad"} ${all.indexOf(row) + 1}`;
        for (const column of columns) add(block.id, `${block.label}, ${name}: ${column.input === "images" ? "lägg till" : "fyll i"} ${column.label.toLowerCase()}.`, formCellFilled(column, row.cells[column.key]));
        for (const column of checked) {
          const value = row.cells[column.key];
          if (!filled(value)) continue;
          const problem = numberProblem(`${block.label}, ${name}: ${column.label}`, column.unit, value, column.allowedMin, column.allowedMax, column.decimals);
          if (problem) add(block.id, problem, false);
        }
      }
    }
    if (block.type === "images" && block.minCount > 0) {
      const count = options.imageCount ? options.imageCount(block.key) : (values.images[block.key] ?? []).length;
      add(block.id, `${block.label}: lägg till minst ${block.minCount} ${block.minCount === 1 ? "bild" : "bilder"}.`, count >= block.minCount);
    }
    if (block.type === "signature" && block.required) {
      const signature = values.signatures[block.key];
      add(block.id, `${block.label}: ange namn och bekräfta.`, Boolean(signature?.name.trim() && signature.confirmed));
    }
    // A review is made by someone else than the one who signed the work (2026-09-28).
    if (block.type === "signature" && block.distinctFrom) {
      const own = values.signatures[block.key]?.name.trim().toLowerCase();
      const other = values.signatures[block.distinctFrom]?.name.trim().toLowerCase();
      if (own && other && own === other) add(block.id, `${block.label}: ska göras av en annan person än den som signerat arbetet.`, false);
    }
  }
  if (evaluation.deviations.length) add("deviations", "Beskriv avvikelserna och vad som görs åt dem.", Boolean(values.deviationComment.trim()));
  const issues = requirements.filter((item) => !item.met);
  const percent = requirements.length ? Math.round((requirements.length - issues.length) / requirements.length * 100) : 0;
  return { evaluation, requirements, issues, ready: issues.length === 0, percent };
}

/** Hard validation of a filled-in field (schema 2). Returns what is wrong, or null. */
/** Hard validation of a number (a field or a table cell): a number, within the allowed range, with at most the decimals. */
function numberProblem(label: string, unit: string, value: unknown, allowedMin: number | null, allowedMax: number | null, decimals: number | null): string | null {
  const text = String(value).trim().replace(",", ".");
  const parsed = typeof value === "number" ? value : Number(text);
  if (!Number.isFinite(parsed) || text === "") return `${label}: ange ett tal.`;
  if ((allowedMin !== null && parsed < allowedMin) || (allowedMax !== null && parsed > allowedMax))
    return `${label}: ange ett värde ${allowedMin !== null && allowedMax !== null ? `mellan ${String(allowedMin).replace(".", ",")} och ${String(allowedMax).replace(".", ",")}` : allowedMin !== null ? `på minst ${String(allowedMin).replace(".", ",")}` : `på högst ${String(allowedMax).replace(".", ",")}`}${unit ? ` ${unit}` : ""}.`;
  if (decimals !== null && (String(parsed).split(".")[1]?.length ?? 0) > decimals) return `${label}: högst ${decimals} decimaler.`;
  return null;
}

export function fieldValidationMessage(block: FormFieldBlock, value: unknown): string | null {
  if (block.input === "number") {
    const problem = numberProblem(block.label, block.unit, value, block.allowedMin, block.allowedMax, block.decimals);
    if (problem) return problem;
  }
  if ((block.input === "text" || block.input === "textarea") && block.maxLength !== null && String(value).length > block.maxLength) return `${block.label}: högst ${block.maxLength} tecken.`;
  return null;
}

/** Progression like the controls: at most 95 % until the protocol is completed, then 100 %. */
export function formProgress(status: string, document: FormDocument, values: FormValues) {
  if (status === "COMPLETED") return 100;
  return Math.min(95, formCompletion(document, values).percent);
}

/** Whether anything has been filled in, so a planned protocol counts as started. */
export function formHasContent(values: FormValues) {
  const some = (value: unknown) => Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && String(value).trim() !== "";
  return Object.values(values.fields).some(some)
    || Object.values(values.checklists).some((items) => Object.values(items).some((item) => item.state || item.comment))
    || Object.values(values.tables).some((rows) => rows.some((row) => Object.values(row.cells).some(some)))
    || Object.values(values.signatures).some((item) => item.name || item.confirmed)
    || Object.values(values.remarks).some((item) => item.comment.trim() || item.deviation)
    || Object.values(values.checklists).some((items) => Object.values(items).some((item) => (item.images?.length ?? 0) > 0))
    || Boolean(values.deviationComment.trim());
}

const withoutKey = <T extends object>(item: T, key: keyof T) => { const rest = { ...item }; delete rest[key]; return rest; };

/**
 * A protocol's answers for "Spara som" (2026-09-27: a completed control is continued in a new one, never
 * changed): everything that was filled in, except the signatures (a new protocol is signed anew), the pictures (they
 * belong to the old protocol's attachments) and example rows.
 */
export function copyFormValues(values: FormValues): FormValues {
  const copy = structuredClone(values);
  copy.images = {};
  // A new protocol is judged against the limits and the round of its own day.
  copy.limits = {};
  copy.round = null;
  copy.checklists = Object.fromEntries(Object.entries(copy.checklists).map(([key, items]) => [key, Object.fromEntries(Object.entries(items).map(([itemId, item]) => [itemId, withoutKey(item, "images")]))]));
  copy.signatures = Object.fromEntries(Object.entries(copy.signatures).map(([key, signature]) => [key, { ...signature, confirmed: false, signedAt: null }]));
  copy.tables = Object.fromEntries(Object.entries(copy.tables).map(([key, rows]) => [key, rows.filter((row) => !row.example).map((row) => ({
    ...withoutKey(row, "workOrderId"), cells: Object.fromEntries(Object.entries(row.cells).filter(([, cell]) => !Array.isArray(cell))),
  }))]));
  return copy;
}
