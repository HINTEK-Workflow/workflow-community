/**
 * PDF-mallar (2026-11-03: "När pdf:erna sedan är klara vill jag kunna redigera dem på samma sätt som jag gör med
 * landningsidan och egenkontrollprogrammet i en editor. under produktionsadmin. Dessa skall automatiskt uppdaterad när
 * workflow uppdateras om det är något som ändras som måste komma med men som inte jag har ändrat"). The product owner
 * changes the documents' TEXTS, which blocks are SHOWN and their ORDER within a group – never the layout, which stays with
 * the design system (docs/rapportprinciper.md).
 *
 * Every document type has declarative default blocks in code (./catalog.ts) with stable ids. Each block's default text has
 * a version (a hash of the text). The owner's changes are stored as overrides (PdfTemplateOverride), each remembering the
 * version of the default it was made against (`basedOnVersion`). Resolution is defaults overlaid by overrides:
 *   - a block without an override always follows the current default, so an upgrade of Workflow reaches it by itself;
 *   - a block with its own text keeps it, but when the default changed since `basedOnVersion` it is flagged
 *     ("Förvalet ändrades") until the owner keeps the text, takes the new default or merges by hand;
 *   - a required block (legal or content-bearing) can never be hidden, and when its default changed the new default
 *     wins over the owner's text ("Lagkrav uppdaterades");
 *   - a block that is new in an upgrade appears at its default place; an override of a block that is gone is ignored
 *     (and archived by the server).
 * Texts are plain text drawn as PDF text; the only markup is a whitelisted placeholder set per block ({företag}, {datum} …).
 * Pure functions, no database and no Node API, so the generators use them in Cloud, Local and the browser alike; without
 * any override every document reads exactly as before (the locked reference PDFs).
 */

export type PdfBlockKind = "title" | "kind" | "section" | "label" | "column" | "paragraph" | "note" | "band" | "signature" | "footer" | "legal";

export type PdfBlockDef = {
  /** Stable id within the document type; never reused for another meaning. */
  id: string;
  kind: PdfBlockKind;
  /** The editor's short name for the block. */
  name: string;
  /** The default text (Swedish, plain text). */
  text: string;
  /** The placeholders the text may use here. */
  placeholders?: readonly string[];
  /** The placeholders the text must keep. */
  needs?: readonly string[];
  /** Legally or content-required: never hidden; a changed default wins over the owner's text. */
  required?: boolean;
  /** Part of the drawing itself (a column label, a label beside a value): its text may change, it cannot be hidden, and a changed default only flags the owner's text. */
  always?: boolean;
  /** The text itself is fixed (a legal wording): neither changed nor hidden. */
  locked?: boolean;
  /** The text is set in the document's own editor (say where): shown here, neither changed nor hidden, so nothing is edited twice. */
  elsewhere?: string;
  /** Hidden unless the owner shows it. */
  hidden?: boolean;
  /** The group whose blocks the owner may reorder among themselves. */
  group?: string;
  /** The part of the page it belongs to, for the editor's overview; by kind when left out. */
  area?: string;
  /** When the block is printed at all (the editor's hint). */
  when?: string;
  /** The longest text allowed; by kind when left out. */
  max?: number;
};

export type PdfDocumentDef = {
  type: string;
  /** The editor's name of the document type. */
  name: string;
  /** One short line on what the document is. */
  description: string;
  /** What each placeholder of the document stands for. */
  placeholders: Readonly<Record<string, string>>;
  /** The reorderable groups and their names. */
  groups?: Readonly<Record<string, string>>;
  /** The document's content has its own editor (2026-11-05: no double editing); here it is only seen beside the others. */
  contentIn?: { text: string; href: string; link: string };
  blocks: readonly PdfBlockDef[];
};

/** One stored change of the product owner. Null fields follow the default. */
export type PdfTemplateOverride = {
  documentType: string;
  blockId: string;
  text: string | null;
  visible: boolean | null;
  orderIndex: number | null;
  /** The version of the default text when the owner last edited or confirmed this block. */
  basedOnVersion: string;
};

/** default: follows the default · custom: the owner's own · changed: the default changed since · legal: a required block's new default won. */
export type PdfBlockState = "default" | "custom" | "changed" | "legal";

export type ResolvedPdfBlock = {
  def: PdfBlockDef;
  version: string;
  text: string;
  visible: boolean;
  /** The block's place within its group (0 …); 0 outside groups. */
  order: number;
  state: PdfBlockState;
  override: PdfTemplateOverride | null;
};

/**
 * The editor's click targets (2026-11-04: "PDF:erna kan jag inte alls redigera med en editor"): the real generator
 * draws the real document, and each word a template block printed reports where it landed, so a click on the page finds the
 * block without a second imitation of the layout. While a trace is on, `pdfTexts` puts one private-use character before every
 * word of a block's text; the kit measures and draws without them and reports the rectangles. Only the editor's example
 * preview passes a trace: a real document never has one, and without it not a character differs.
 */
export type PdfTraceTarget = {
  /** The document type and the block. */
  doc: string; id: string;
  /** The page (0 …) and the rectangle in PDF points: x from the left edge, y from the bottom edge up to the rectangle's lower side. */
  page: number; x: number; y: number; width: number; height: number;
  /** The drawn text's look, so the field over it looks the same. */
  size: number; bold: boolean; color: string; align: "left" | "right" | "center";
  /** Drawn in a footer strip, which a merged document draws again. */
  footer?: boolean;
};
const TRACE_FIRST = 0xe000;
const TRACE_LAST = 0xf8ff;
const TRACE_MARK = /[\ue000-\uf8ff]/g;
/** A text as drawn: without the trace's marks. */
export const untraced = (text: string) => text.replace(TRACE_MARK, "");
/** The first block mark in a word, or null. */
export function traceMarkIn(word: string): number | null {
  for (let index = 0; index < word.length; index++) {
    const code = word.charCodeAt(index);
    if (code >= TRACE_FIRST && code <= TRACE_LAST) return code;
  }
  return null;
}
export class PdfTrace {
  readonly targets: PdfTraceTarget[] = [];
  private readonly marks: { doc: string; id: string }[] = [];
  private readonly known = new Map<string, number>();
  mark(doc: string, id: string): string {
    const key = `${doc}:${id}`;
    let code = this.known.get(key);
    if (code === undefined) {
      code = TRACE_FIRST + this.marks.length;
      if (code > TRACE_LAST) throw new Error("Spårningen har slut på tecken.");
      this.known.set(key, code);
      this.marks.push({ doc, id });
    }
    return String.fromCharCode(code);
  }
  block(code: number) { return this.marks[code - TRACE_FIRST] ?? null; }
}
/** The overrides as the generators receive them; the editor's preview hangs its trace on them, so it travels every path they do. */
export type PdfTemplates = readonly PdfTemplateOverride[] & { readonly trace?: PdfTrace };
export const tracedTemplates = (overrides: readonly PdfTemplateOverride[] | null | undefined, trace: PdfTrace): PdfTemplates => Object.assign([...(overrides ?? [])], { trace });
export const traceOf = (templates: readonly PdfTemplateOverride[] | null | undefined): PdfTrace | null => (templates as PdfTemplates | null | undefined)?.trace ?? null;

export type ResolvedPdfDocument = { def: PdfDocumentDef; blocks: ResolvedPdfBlock[]; flagged: number; legal: number };

const MAX_BY_KIND: Record<PdfBlockKind, number> = { title: 40, kind: 60, section: 80, label: 80, column: 40, paragraph: 600, note: 300, band: 60, signature: 60, footer: 120, legal: 300 };
const MULTILINE: ReadonlySet<PdfBlockKind> = new Set(["paragraph", "note", "legal"]);
export const blockMax = (def: PdfBlockDef) => def.max ?? MAX_BY_KIND[def.kind];
export const blockMayHide = (def: PdfBlockDef) => !def.required && !def.locked && !def.always && !def.elsewhere;
export const blockMayEdit = (def: PdfBlockDef) => !def.locked && !def.elsewhere;
export const blockMultiline = (def: PdfBlockDef) => MULTILINE.has(def.kind);
const AREA_BY_KIND: Record<PdfBlockKind, string> = { title: "Sidhuvud", kind: "Sidhuvud", band: "Märken", section: "Rubriker", label: "Etiketter", column: "Kolumner", paragraph: "Texter", note: "Noter", signature: "Signering", footer: "Sidfot", legal: "Lagtext" };
export const blockArea = (def: PdfBlockDef) => def.area ?? AREA_BY_KIND[def.kind];

/** A short, stable hash of a text (cyrb53): the default's version. Not a security measure, only a change marker. */
export function textVersion(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `t${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
}
export const blockVersion = (def: PdfBlockDef) => textVersion(def.text);

const TOKEN = /\{([^{}]*)\}/g;
/** The placeholders a text uses, in order (each once). */
export function placeholdersIn(text: string): string[] {
  return [...new Set([...text.matchAll(TOKEN)].map((match) => match[1]!))];
}

/**
 * Why a text cannot be saved for this block, or null when it can: not empty, not too long, one line where the block is one,
 * no control characters, braces only around a placeholder the block allows, and every placeholder it needs kept.
 */
export function validateBlockText(def: PdfBlockDef, text: string): string | null {
  if (def.locked && text !== def.text) return "Texten är ett lagkrav och kan inte ändras.";
  if (!text.trim()) return "Texten får inte vara tom. Dölj blocket i stället.";
  if (text.length > blockMax(def)) return `Högst ${blockMax(def)} tecken.`;
  if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(text)) return "Texten innehåller otillåtna tecken.";
  if (!blockMultiline(def) && text.includes("\n")) return "Texten ska stå på en rad.";
  if (/\n{3,}/.test(text)) return "Högst en tom rad i följd.";
  const outside = text.replace(TOKEN, "");
  if (outside.includes("{") || outside.includes("}")) return "En klammer står utan platshållare.";
  const allowed = new Set(def.placeholders ?? []);
  const unknown = placeholdersIn(text).filter((name) => !allowed.has(name));
  if (unknown.length) return `Okänd platshållare: ${unknown.map((name) => `{${name}}`).join(", ")}.`;
  const used = placeholdersIn(text);
  const missing = (def.needs ?? []).filter((name) => !used.includes(name));
  if (missing.length) return `Platshållaren ${missing.map((name) => `{${name}}`).join(", ")} måste stå kvar.`;
  return null;
}

/** Why an override cannot be stored for this block, or null. `groupSize` is the number of blocks in the block's group. */
export function validateOverride(def: PdfBlockDef, override: Pick<PdfTemplateOverride, "text" | "visible" | "orderIndex">, groupSize: number): string | null {
  if (override.text !== null) {
    if (def.elsewhere) return def.elsewhere;
    if (!blockMayEdit(def)) return "Texten är ett lagkrav och kan inte ändras.";
    const error = validateBlockText(def, override.text);
    if (error) return error;
  }
  if (override.visible === false && def.elsewhere) return def.elsewhere;
  if (override.visible === false && !blockMayHide(def)) return "Blocket krävs och kan inte döljas.";
  if (override.orderIndex !== null) {
    if (!def.group) return "Blocket kan inte flyttas.";
    if (!Number.isInteger(override.orderIndex) || override.orderIndex < 0 || override.orderIndex >= groupSize) return "Ogiltig plats i gruppen.";
  }
  return null;
}

/** Defaults overlaid by overrides; overrides of other documents and of blocks that are gone are ignored. */
export function resolvePdfDocument(def: PdfDocumentDef, overrides: readonly PdfTemplateOverride[] | null | undefined): ResolvedPdfDocument {
  const own = new Map((overrides ?? []).filter((item) => item.documentType === def.type).map((item) => [item.blockId, item]));
  const groupIndex = new Map<string, number>();
  const blocks = def.blocks.map((block): ResolvedPdfBlock => {
    const version = blockVersion(block);
    const override = own.get(block.id) ?? null;
    const index = block.group ? (groupIndex.get(block.group) ?? 0) : 0;
    if (block.group) groupIndex.set(block.group, index + 1);
    let text = block.text;
    let state: PdfBlockState = "default";
    if (override?.text != null && blockMayEdit(block)) {
      const current = override.basedOnVersion === version;
      const valid = validateBlockText(block, override.text) === null;
      if (current && valid) { text = override.text; state = "custom"; }
      // A required block's new default wins (Lagkrav uppdaterades); the owner's text waits in the editor.
      else if (block.required) state = "legal";
      // The owner's text stays while it still fits the block; a text an upgrade made invalid falls back to the default.
      else { text = valid ? override.text : block.text; state = "changed"; }
    }
    const visible = blockMayHide(block) ? override?.visible ?? !block.hidden : true;
    return { def: block, version, text, visible, order: index, state, override };
  });
  // The order within each group: the owner's places first by their index, the rest at their default places.
  for (const group of new Set(def.blocks.map((block) => block.group).filter((item): item is string => Boolean(item)))) {
    const members = blocks.filter((block) => block.def.group === group);
    const sorted = [...members].sort((a, b) => (a.override?.orderIndex ?? a.order) - (b.override?.orderIndex ?? b.order) || a.order - b.order);
    sorted.forEach((block, place) => { block.order = place; });
  }
  return { def, blocks, flagged: blocks.filter((block) => block.state === "changed").length, legal: blocks.filter((block) => block.state === "legal").length };
}

/** Fills the placeholders; a value that is not given becomes empty. */
export function fillPlaceholders(text: string, values: Readonly<Record<string, string | number | null | undefined>> = {}): string {
  return text.replace(TOKEN, (_match, name: string) => {
    const value = values[name];
    return value === null || value === undefined ? "" : String(value);
  });
}

export type PdfTextValues = Readonly<Record<string, string | number | null | undefined>>;
/** What a generator reads: a block's text with its values, whether it is shown, and a group's shown blocks in order. */
export type PdfTexts = {
  text(id: string, values?: PdfTextValues): string;
  shown(id: string): boolean;
  order(group: string): string[];
};

export function pdfTextsOf(def: PdfDocumentDef, overrides: readonly PdfTemplateOverride[] | null | undefined): PdfTexts {
  const resolved = resolvePdfDocument(def, overrides);
  const trace = traceOf(overrides);
  const byId = new Map(resolved.blocks.map((block) => [block.def.id, block]));
  const get = (id: string) => {
    const block = byId.get(id);
    if (!block) throw new Error(`PDF-mallen ${def.type} saknar blocket ${id}.`);
    return block;
  };
  return {
    text: (id, values) => {
      const text = fillPlaceholders(get(id).text, values);
      if (!trace) return text;
      const mark = trace.mark(def.type, id);
      return text.replace(/\S+/g, (word) => mark + word);
    },
    shown: (id) => get(id).visible,
    order: (group) => resolved.blocks.filter((block) => block.def.group === group).sort((a, b) => a.order - b.order).filter((block) => block.visible).map((block) => block.def.id),
  };
}

/** Whether a catalogue is sound: unique ids, defaults that pass their own rules, declared placeholders and groups. */
export function catalogueProblems(docs: readonly PdfDocumentDef[]): string[] {
  const problems: string[] = [];
  const types = new Set<string>();
  for (const doc of docs) {
    if (types.has(doc.type)) problems.push(`${doc.type}: dubbel dokumenttyp`);
    types.add(doc.type);
    const ids = new Set<string>();
    for (const block of doc.blocks) {
      if (ids.has(block.id)) problems.push(`${doc.type}.${block.id}: dubbelt id`);
      ids.add(block.id);
      if (!/^[a-z][a-z0-9.-]*$/.test(block.id)) problems.push(`${doc.type}.${block.id}: ogiltigt id`);
      const error = validateBlockText({ ...block, locked: false }, block.text);
      if (error) problems.push(`${doc.type}.${block.id}: ${error}`);
      for (const name of block.placeholders ?? []) if (!(name in doc.placeholders)) problems.push(`${doc.type}.${block.id}: {${name}} saknar beskrivning`);
      for (const name of block.needs ?? []) if (!(block.placeholders ?? []).includes(name)) problems.push(`${doc.type}.${block.id}: {${name}} krävs men är inte tillåten`);
      if (block.group && !(block.group in (doc.groups ?? {}))) problems.push(`${doc.type}.${block.id}: gruppen ${block.group} saknas`);
      if ((block.required || block.always) && block.hidden) problems.push(`${doc.type}.${block.id}: krävs men dold`);
    }
  }
  return problems;
}
