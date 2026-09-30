import { FIELD_INPUTS, formBlockCanBeNarrow, formDocumentSchema, formLeafBlocks, type FormBlock, type FormColumn, type FormCondition, type FormDocument, type FormLeafBlock, type FormSection } from "./form-document";

/**
 * The form editor's document operations (Daniel 2026-09-26, the approved editor). Pure functions: drag and drop, the
 * block buttons and the keyboard shortcuts all call the same operations, so they behave identically and are tested
 * once. The editor always works on a schema 2 document whose top level holds only sections.
 */

export type EditorDocument = { schema: 2; blocks: FormSection[]; report: FormDocument["report"]; moments: FormDocument["moments"]; task: FormDocument["task"]; limits: FormDocument["limits"]; limitObjectKey: string };

/** The form's own settings: the PDF heading and the moments that can be switched on and off (Daniel 2026-09-27). */
export const defaultDocumentSettings = (): Pick<EditorDocument, "report" | "moments" | "task" | "limits" | "limitObjectKey"> => ({ report: { title: "", code: "", taskFacts: true }, moments: { label: "Moment", requireOne: false, placement: "top" }, task: { layout: "panel", titleKey: "", requiredMarks: true, newTitle: "", tagline: "" }, limits: [], limitObjectKey: "" });

export const newId = () => Math.random().toString(36).slice(2, 10);
/** Always shown: the empty condition of villkorad visning. */
export const noCondition = (): FormCondition => ({ key: "", op: "eq", value: "" });

export const emptySection = (title = ""): FormSection => ({ id: newId(), type: "section", title, description: "", newPage: false, blocks: [], optional: false, defaultOn: true, pdfStyle: "standard", collapsed: false, help: "", taskTitle: "", showIf: noCondition() });
export const emptyEditorDocument = (): EditorDocument => ({ schema: 2, blocks: [emptySection()], ...defaultDocumentSettings() });

/**
 * Reads any stored document as an editor document, in memory only. Schema 1: a level 2 heading at the top level starts
 * a section with that title, blocks before it land in an untitled section, and a column row becomes blocks with the
 * width ½ (two columns) or ⅓ (three) in reading order (row by row). A published version is never rewritten by this.
 */
export function normalizeFormDocument(input: unknown): EditorDocument {
  const document = formDocumentSchema.parse(input);
  const sections: FormSection[] = [];
  // An implicit section gets a stable id, so comparing a draft with a published schema 1 version shows no false change.
  const current = () => sections.at(-1) ?? (sections.push({ ...emptySection(), id: "avsnitt-1" }), sections[0]);
  for (const block of document.blocks) {
    if (block.type === "section") sections.push(block);
    else if (block.type === "heading" && block.level === 2) sections.push({ ...emptySection(block.text), id: block.id });
    else if (block.type === "columns") {
      const width = block.columns.length === 3 ? "third" : "half";
      for (let row = 0; row < Math.max(...block.columns.map((column) => column.length)); row++)
        for (const column of block.columns) {
          const leaf = column[row];
          if (leaf) current().blocks.push(formBlockCanBeNarrow(leaf) && "width" in leaf ? { ...leaf, width } as FormLeafBlock : leaf);
        }
    } else current().blocks.push(block);
  }
  if (!sections.length) sections.push({ ...emptySection(), id: "avsnitt-1" });
  return { schema: 2, blocks: sections, report: document.report, moments: document.moments, task: document.task, limits: document.limits, limitObjectKey: document.limitObjectKey };
}

// ---------- the block library ----------
export const LIBRARY_TYPES = [
  "section", "heading", "text", "note", "pagebreak",
  "text_field", "long_text", "number", "measurement", "datetime", "yesno", "single_choice", "multiple_choice", "checklist", "table", "attachment", "signature", "computed", "summary", "matrix",
] as const;
export type LibraryType = (typeof LIBRARY_TYPES)[number];

export const LIBRARY: { type: LibraryType; label: string; hint: string; group: "Struktur" | "Fält" | "Resultat" }[] = [
  { type: "section", label: "Avsnitt", hint: "grupp med rubrik", group: "Struktur" },
  { type: "heading", label: "Rubrik", hint: "underrubrik", group: "Struktur" },
  { type: "text", label: "Hjälptext", hint: "instruktion", group: "Struktur" },
  { type: "note", label: "Infokort", hint: "rubrik och text, hopfällt", group: "Struktur" },
  { type: "pagebreak", label: "Sidbrytning", hint: "ny sida i PDF", group: "Struktur" },
  { type: "text_field", label: "Textfält", hint: "en rad", group: "Fält" },
  { type: "long_text", label: "Lång text", hint: "flera rader", group: "Fält" },
  { type: "number", label: "Tal", hint: "decimaler", group: "Fält" },
  { type: "measurement", label: "Mätvärde", hint: "tal med enhet", group: "Fält" },
  { type: "datetime", label: "Datum och tid", hint: "datum", group: "Fält" },
  { type: "yesno", label: "Ja/nej", hint: "kontrollpunkt", group: "Fält" },
  { type: "single_choice", label: "Enval", hint: "ett alternativ", group: "Fält" },
  { type: "multiple_choice", label: "Flerval", hint: "flera alternativ", group: "Fält" },
  { type: "checklist", label: "Checklista", hint: "OK · Ej OK · Ej aktuellt", group: "Fält" },
  { type: "table", label: "Tabell", hint: "rader och kolumner", group: "Fält" },
  { type: "attachment", label: "Foto/bilaga", hint: "bilder eller filer", group: "Fält" },
  { type: "signature", label: "Signatur", hint: "namn och bekräftelse", group: "Resultat" },
  { type: "computed", label: "Formel", hint: "beräknat värde", group: "Resultat" },
  { type: "summary", label: "Sammanfattning", hint: "godkända, avvikelser och kommentar", group: "Resultat" },
  { type: "matrix", label: "Riskmatris", hint: "5 × 5 med nivåer", group: "Resultat" },
];

const slug = (text: string) => text.toLowerCase().normalize("NFC").replace(/[^a-zåäö0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^[^a-zåäö]+/, "").slice(0, 30) || "falt";

/** Every short name in use: block keys and, for tables, their column keys are separate namespaces. */
export function usedKeys(document: Pick<FormDocument, "blocks">, exceptBlockId?: string) {
  return new Set(formLeafBlocks(document).flatMap((block) => "key" in block && block.id !== exceptBlockId ? [block.key] : []));
}

/** A short name made from a label, unique in the document: "Uppmätt värde" → uppmatt_varde, then uppmatt_varde_2. */
export function uniqueKey(document: Pick<FormDocument, "blocks">, base: string, exceptBlockId?: string) {
  const used = usedKeys(document, exceptBlockId);
  const root = slug(base);
  let key = root;
  for (let index = 2; used.has(key); index++) key = `${root.slice(0, 26)}_${index}`;
  return key;
}

export function newColumn(label: string, input: FormColumn["input"], taken: string[]): FormColumn {
  let key = slug(label);
  for (let index = 2; taken.includes(key); index++) key = `${slug(label)}_${index}`;
  return {
    id: newId(), key, label, input, required: false, unit: "", options: [], min: null, max: null, formula: "", deviationOptions: [], help: "", passCondition: false, total: "none",
    defaultValue: null, exampleValue: null, notFilledOptions: [], requiredIf: "", suggestions: [], pdfLabel: "", pdfWidth: null, pdf: "show", mode: "auto", switchKey: "", bands: [],
    placeholder: "", cardLabel: "", cardWidth: "auto", placement: "body", group: "", screenWidth: "", line: 1,
    allowedMin: null, allowedMax: null, decimals: null, limitKey: "", trend: false,
  };
}

const layout = { width: "full" as const, visibility: { task: true, pdf: true }, showIf: noCondition() };

function field(document: Pick<FormDocument, "blocks">, input: (typeof FIELD_INPUTS)[number], label: string, extra: Partial<Extract<FormLeafBlock, { type: "field" }>> = {}): FormLeafBlock {
  return {
    id: newId(), type: "field", key: uniqueKey(document, label), label, input, required: false, help: "", unit: "", min: null, max: null,
    options: [], multiple: false, allowNotApplicable: true, deviationOn: "NONE", deviationOptions: [], defaultValue: null,
    allowedMin: null, allowedMax: null, decimals: null, maxLength: null, prefill: "none", highlight: false, momentSwitch: false, placeholder: "", pdfLabel: "", remarks: false, limitKey: "", trend: false, ...layout, ...extra,
  };
}

/** A new block from the library with sensible defaults and a unique short name. */
export function createBlock(type: Exclude<LibraryType, "section">, document: Pick<FormDocument, "blocks">): FormLeafBlock {
  const id = newId();
  switch (type) {
    case "heading": return { id, type: "heading", text: "Rubrik", level: 3, ...layout };
    case "text": return { id, type: "text", text: "Skriv en instruktion till den som fyller i formuläret.", ...layout };
    case "pagebreak": return { id, type: "pagebreak" };
    // Short fields start at a third of the sheet, like the three-column header of a protocol.
    case "text_field": return field(document, "text", "Textfält", { width: "third" });
    case "long_text": return field(document, "textarea", "Kommentar");
    case "number": return field(document, "number", "Tal", { width: "third" });
    case "measurement": return field(document, "number", "Mätvärde", { unit: "V", width: "third" });
    case "datetime": return field(document, "datetime", "Datum och tid", { width: "third" });
    case "yesno": return field(document, "yesno", "Kontrollpunkt", { width: "third" });
    case "single_choice": return field(document, "choice", "Enval", { options: ["Alternativ 1", "Alternativ 2"], width: "third" });
    case "multiple_choice": return field(document, "choice", "Flerval", { options: ["Alternativ 1", "Alternativ 2"], multiple: true });
    case "checklist": return { id, type: "checklist", key: uniqueKey(document, "Checklista"), label: "Checklista", items: [{ id: newId(), text: "Punkt 1" }, { id: newId(), text: "Punkt 2" }], required: true, help: "", mode: "assessment", photos: false, deviationTable: "", ...layout };
    case "table": return { id, type: "table", key: uniqueKey(document, "Tabell"), label: "Tabell", rowMode: "free", fixedRows: [], required: false, help: "", columns: [newColumn("Mätpunkt", "text", []), newColumn("Värde", "number", ["matpunkt"])], layout: "grid", itemLabel: "", allowExample: false, cardTitle: "", taskLayout: "same", copyRows: true, emptyTitle: "", emptyAction: "", itemLabelPlural: "", startEmpty: false, emptyIcon: "", workOrders: false, ...layout };
    case "attachment": return { id, type: "images", key: uniqueKey(document, "Bilder"), label: "Bilder", minCount: 0, help: "", accept: "images", pdfInline: true, ...layout };
    case "signature": return { id, type: "signature", key: uniqueKey(document, "Signatur"), label: "Utförd av", required: true, help: "", statement: "", placeholder: "", role: "other", distinctFrom: "", ...layout, width: "half" };
    case "computed": return { id, type: "computed", key: uniqueKey(document, "Resultat"), label: "Resultat", formula: "1 + 1", unit: "", passCondition: false, help: "", bands: [], limitKey: "", trend: false, ...layout, width: "third" };
    case "note": return { id, type: "note", title: "Infokort", text: "Skriv stöd för den som fyller i, t.ex. gränsvärden eller hur något bedöms.", visibility: layout.visibility, showIf: noCondition(), width: "full", style: "folded" };
    case "summary": return { id, type: "summary", label: "Sammanfattning / avvikelser", help: "", visibility: layout.visibility, showIf: noCondition() };
    case "matrix": return { id, type: "matrix", label: "Riskmatris 5 × 5", size: 5, xLabel: "Sannolikhet", yLabel: "Konsekvens", visibility: layout.visibility, showIf: noCondition(), width: "full", tall: false, bands: [
      { from: 1, label: "Låg", tone: "success" }, { from: 5, label: "Måttlig", tone: "warning" }, { from: 10, label: "Hög", tone: "danger" }, { from: 17, label: "Mycket hög", tone: "critical" },
    ] };
  }
}

// ---------- locating and changing blocks ----------
export type BlockLocation = { section: number; index: number };

/** Where a block is: its section and its index there. A section itself has index -1. */
export function locate(document: EditorDocument, id: string): BlockLocation | null {
  for (let section = 0; section < document.blocks.length; section++) {
    if (document.blocks[section].id === id) return { section, index: -1 };
    const index = document.blocks[section].blocks.findIndex((block) => block.id === id);
    if (index >= 0) return { section, index };
  }
  return null;
}

export function findEditorBlock(document: EditorDocument, id: string | null): FormSection | FormLeafBlock | null {
  if (!id) return null;
  const at = locate(document, id);
  if (!at) return null;
  return at.index < 0 ? document.blocks[at.section] : document.blocks[at.section].blocks[at.index];
}

const withSection = (document: EditorDocument, section: number, change: (blocks: FormLeafBlock[]) => FormLeafBlock[]): EditorDocument =>
  ({ ...document, blocks: document.blocks.map((item, index) => index === section ? { ...item, blocks: change(item.blocks) } : item) });

/** Inserts a block at a place (clamped). Without a place it goes last in the last section. */
export function insertBlock(document: EditorDocument, block: FormLeafBlock, at?: { sectionId: string; index?: number }): EditorDocument {
  const section = at ? Math.max(0, document.blocks.findIndex((item) => item.id === at.sectionId)) : document.blocks.length - 1;
  return withSection(document, section, (blocks) => {
    const index = Math.max(0, Math.min(at?.index ?? blocks.length, blocks.length));
    return [...blocks.slice(0, index), block, ...blocks.slice(index)];
  });
}

/** Where a block added from the library lands: after the selected block, last in the selected section, otherwise last. */
export function insertionPoint(document: EditorDocument, selectedId: string | null): { sectionId: string; index: number } {
  const at = selectedId ? locate(document, selectedId) : null;
  if (!at) { const last = document.blocks.at(-1)!; return { sectionId: last.id, index: last.blocks.length }; }
  const section = document.blocks[at.section];
  return { sectionId: section.id, index: at.index < 0 ? section.blocks.length : at.index + 1 };
}

export function insertSection(document: EditorDocument, section: FormSection, afterId?: string | null): EditorDocument {
  // A new form's empty, untitled section is taken over by the first Avsnitt, so no empty section is left above it.
  if (document.blocks.length === 1 && !document.blocks[0].blocks.length && !document.blocks[0].title.trim()) return { ...document, blocks: [section] };
  const at = afterId ? locate(document, afterId) : null;
  const index = at ? at.section + 1 : document.blocks.length;
  // A section added after a block in the middle of a section takes the blocks below it along, like a new chapter.
  if (at && at.index >= 0) {
    const source = document.blocks[at.section];
    const moved = source.blocks.slice(at.index + 1);
    const blocks = [...document.blocks];
    blocks[at.section] = { ...source, blocks: source.blocks.slice(0, at.index + 1) };
    blocks.splice(index, 0, { ...section, blocks: [...section.blocks, ...moved] });
    return { ...document, blocks };
  }
  return { ...document, blocks: [...document.blocks.slice(0, index), section, ...document.blocks.slice(index)] };
}

/**
 * Moves a block one step. At the edge of a section it continues into the neighbouring section, so the buttons can
 * reach every place drag and drop can. A section moves past the neighbouring section.
 */
export function moveBlock(document: EditorDocument, id: string, delta: -1 | 1): EditorDocument {
  const at = locate(document, id);
  if (!at) return document;
  if (at.index < 0) {
    const target = at.section + delta;
    if (target < 0 || target >= document.blocks.length) return document;
    const blocks = [...document.blocks];
    [blocks[at.section], blocks[target]] = [blocks[target], blocks[at.section]];
    return { ...document, blocks };
  }
  const section = document.blocks[at.section];
  const target = at.index + delta;
  if (target >= 0 && target < section.blocks.length) return withSection(document, at.section, (blocks) => {
    const next = [...blocks];
    [next[at.index], next[target]] = [next[target], next[at.index]];
    return next;
  });
  const neighbour = document.blocks[at.section + delta];
  if (!neighbour) return document;
  return moveBlockTo(document, id, neighbour.id, delta < 0 ? neighbour.blocks.length : 0);
}

/** Moves a block to a section and an index there (drag and drop, "Flytta till avsnitt"). */
export function moveBlockTo(document: EditorDocument, id: string, sectionId: string, index: number): EditorDocument {
  const at = locate(document, id);
  if (!at || at.index < 0) return document;
  const block = document.blocks[at.section].blocks[at.index];
  const removed = withSection(document, at.section, (blocks) => blocks.filter((item) => item.id !== id));
  // Moving down inside the same section: the index counts the block itself, which is no longer there.
  const sameSection = document.blocks[at.section].id === sectionId;
  return insertBlock(removed, block, { sectionId, index: sameSection && index > at.index ? index - 1 : index });
}

/** Moves a section to an index among the sections (dragging a section by its handle). */
export function moveSectionTo(document: EditorDocument, id: string, index: number): EditorDocument {
  const from = document.blocks.findIndex((item) => item.id === id);
  if (from < 0) return document;
  const blocks = document.blocks.filter((item) => item.id !== id);
  blocks.splice(Math.max(0, Math.min(index > from ? index - 1 : index, blocks.length)), 0, document.blocks[from]);
  return { ...document, blocks };
}

/** A copy with new ids and unique short names, placed right after the original. */
export function duplicateBlock(document: EditorDocument, id: string): { document: EditorDocument; newId: string | null } {
  const at = locate(document, id);
  if (!at) return { document, newId: null };
  let working: Pick<FormDocument, "blocks"> = document;
  const copyLeaf = (block: FormLeafBlock): FormLeafBlock => {
    const copy = structuredClone(block) as FormLeafBlock;
    copy.id = newId();
    if (copy.type === "checklist") copy.items = copy.items.map((item) => ({ ...item, id: newId() }));
    if (copy.type === "table") copy.columns = copy.columns.map((column) => ({ ...column, id: newId() }));
    if ("key" in copy) {
      copy.key = uniqueKey(working, copy.key);
      copy.label = `${copy.label} (kopia)`.slice(0, 200);
    }
    working = { blocks: [...working.blocks, copy] };
    return copy;
  };
  if (at.index < 0) {
    const source = document.blocks[at.section];
    const section: FormSection = { ...source, id: newId(), title: source.title ? `${source.title} (kopia)`.slice(0, 200) : "", blocks: source.blocks.map(copyLeaf) };
    const blocks = [...document.blocks];
    blocks.splice(at.section + 1, 0, section);
    return { document: { ...document, blocks }, newId: section.id };
  }
  const copy = copyLeaf(document.blocks[at.section].blocks[at.index]);
  return { document: withSection(document, at.section, (blocks) => [...blocks.slice(0, at.index + 1), copy, ...blocks.slice(at.index + 1)]), newId: copy.id };
}

/** Removes a block, or a section with its blocks. The document always keeps at least one section. */
export function removeBlock(document: EditorDocument, id: string): EditorDocument {
  const at = locate(document, id);
  if (!at) return document;
  if (at.index < 0) {
    const blocks = document.blocks.filter((item) => item.id !== id);
    return { ...document, blocks: blocks.length ? blocks : [emptySection()] };
  }
  return withSection(document, at.section, (blocks) => blocks.filter((item) => item.id !== id));
}

export function updateBlock(document: EditorDocument, id: string, patch: Partial<FormLeafBlock> | Partial<FormSection>): EditorDocument {
  return {
    ...document,
    blocks: document.blocks.map((section) => section.id === id
      ? { ...section, ...(patch as Partial<FormSection>), type: "section", blocks: section.blocks }
      : { ...section, blocks: section.blocks.map((block) => block.id === id ? { ...block, ...patch, type: block.type, id: block.id } as FormLeafBlock : block) }),
  };
}

/** A copy of a document with fresh ids everywhere, for "Spara som kopia". */
export function cloneWithNewIds(document: EditorDocument): EditorDocument {
  return { ...document, blocks: document.blocks.map((section) => ({ ...structuredClone(section), id: newId(), blocks: section.blocks.map((block) => ({ ...structuredClone(block), id: newId() }) as FormLeafBlock) })) };
}

// ---------- undo and redo ----------
export type EditorHistory<T> = { past: T[]; present: T; future: T[]; group: string | null; at: number };
export const HISTORY_LIMIT = 100;
export const HISTORY_GROUP_MS = 800;

export const createHistory = <T>(present: T): EditorHistory<T> => ({ past: [], present, future: [], group: null, at: 0 });

/**
 * Records a change. Typing in the same property (the same `group`) within 800 ms is one step, so Ångra takes back a
 * word rather than a letter. A new change clears what could be redone.
 */
export function recordHistory<T>(history: EditorHistory<T>, next: T, group: string | null = null, now = Date.now()): EditorHistory<T> {
  if (next === history.present) return history;
  if (group && group === history.group && now - history.at < HISTORY_GROUP_MS) return { ...history, present: next, future: [], at: now };
  return { past: [...history.past, history.present].slice(-HISTORY_LIMIT), present: next, future: [], group, at: now };
}

export function undoHistory<T>(history: EditorHistory<T>): EditorHistory<T> {
  if (!history.past.length) return history;
  return { past: history.past.slice(0, -1), present: history.past.at(-1)!, future: [history.present, ...history.future], group: null, at: 0 };
}

export function redoHistory<T>(history: EditorHistory<T>): EditorHistory<T> {
  if (!history.future.length) return history;
  return { past: [...history.past, history.present], present: history.future[0], future: history.future.slice(1), group: null, at: 0 };
}

/** The editor's top level is sections only; anything else is normalized first. */
export const isEditorDocument = (document: FormDocument): document is EditorDocument => document.schema === 2 && document.blocks.every((block: FormBlock) => block.type === "section");
