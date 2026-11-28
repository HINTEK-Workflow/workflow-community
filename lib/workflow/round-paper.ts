import { formatFormulaValue } from "./form-formula";
import type { FormDocument, FormLeafBlock, FormTableBlock } from "./form-document";

/**
 * Rondprotokoll på papper (0.92.0), utan databas: när tjänsten inte nås ska ronden kunna fortsätta på papper. Från en driftrond
 * skrivs ett blad ut med rondens punkter – formulärets kontrollpunkter i ordning – med tomma rutor att kryssa, rader för värde och
 * kommentar, och datum och signatur längst ned. Har ronden flera punkter i platsträdet (som QR-etiketterna) får varje vald punkt
 * ett eget blad. Bara formulärets egna texter och gränser skrivs ut (de som företaget själv har lagt i formuläret), aldrig något
 * annat. Det som fylls i på papperet förs in i Workflow efteråt; bladet sparar ingenting.
 */

/** One row to fill in by hand. */
export type PaperRow =
  | { kind: "check"; id: string; label: string; help: string }
  | { kind: "yesno"; id: string; label: string; help: string; notApplicable: boolean }
  | { kind: "choice"; id: string; label: string; help: string; options: string[] }
  | { kind: "value"; id: string; label: string; help: string; unit: string; range: string }
  | { kind: "text"; id: string; label: string; help: string; lines: number }
  | { kind: "table"; id: string; label: string; help: string; columns: { label: string; unit: string }[]; rows: string[] };

export type PaperSection = { id: string; title: string; rows: PaperRow[] };
export type PaperSignature = { label: string };
export type PaperModel = { sections: PaperSection[]; signatures: PaperSignature[]; rowCount: number };

/** Empty rows a free table gets on paper: enough to write in, few enough to fit. */
export const PAPER_FREE_TABLE_ROWS = 4;
/** A table's columns that make sense to write in by hand (no formulas, pictures or labels made from other columns). */
const HAND_COLUMNS = new Set(["text", "number", "choice", "yesno", "textarea", "date", "check", "assessment", "scale"]);

const numberText = (value: number) => formatFormulaValue(value);
/** The form's own approved interval ("Godkänt 2–5 bar"), only when the form has one; never a limit from anywhere else. */
export function paperRange(min: number | null, max: number | null, unit: string): string {
  const suffix = unit ? ` ${unit}` : "";
  if (min !== null && max !== null) return `Godkänt ${numberText(min)}–${numberText(max)}${suffix}`;
  if (min !== null) return `Godkänt minst ${numberText(min)}${suffix}`;
  if (max !== null) return `Godkänt högst ${numberText(max)}${suffix}`;
  return "";
}

function tableRow(block: FormTableBlock): PaperRow | null {
  const columns = block.columns.filter((column) => HAND_COLUMNS.has(column.input) && column.pdf !== "hide" && !column.labelFor).map((column) => ({ label: column.pdfLabel || column.label, unit: column.unit }));
  if (!columns.length) return null;
  const rows = block.rowMode === "fixed" && block.fixedRows.length ? [...block.fixedRows] : Array.from({ length: PAPER_FREE_TABLE_ROWS }, () => "");
  return { kind: "table", id: block.id, label: block.label, help: block.help, columns, rows };
}

/** One block as rows on paper; what cannot be filled in by hand (formulas, pictures, summaries, info cards) is left out. */
function rowsOf(block: FormLeafBlock): PaperRow[] {
  if ("visibility" in block && block.visibility && block.visibility.task === false) return [];
  switch (block.type) {
    case "checklist": return block.items.map((item) => ({ kind: "check" as const, id: `${block.id}:${item.id}`, label: item.text, help: "" }));
    case "field": {
      const label = block.pdfLabel || block.label;
      if (block.input === "yesno") return [{ kind: "yesno", id: block.id, label, help: block.help, notApplicable: block.allowNotApplicable }];
      if (block.input === "choice") return [{ kind: "choice", id: block.id, label, help: block.help, options: [...block.options] }];
      if (block.input === "number") return [{ kind: "value", id: block.id, label, help: block.help, unit: block.unit, range: paperRange(block.min, block.max, block.unit) }];
      return [{ kind: "text", id: block.id, label, help: block.help, lines: block.input === "textarea" ? 2 : 1 }];
    }
    case "table": { const row = tableRow(block); return row ? [row] : []; }
    default: return [];
  }
}

/**
 * The paper protocol of a round's form: its sections in order (an untitled part keeps the form's name as heading), each with the
 * rows to fill in; signatures from the form's own signature blocks, and always one for the person who did the round.
 */
export function paperModel(document: Pick<FormDocument, "blocks">, formName: string): PaperModel {
  const sections: PaperSection[] = [];
  const signatures: PaperSignature[] = [];
  let loose: PaperSection | null = null;
  const take = (block: FormLeafBlock, into: PaperSection) => {
    if (block.type === "signature") { if (!("visibility" in block) || block.visibility.task !== false) signatures.push({ label: block.label }); return; }
    if (block.type === "heading" && into.rows.length === 0 && !into.title) { into.title = block.text; return; }
    into.rows.push(...rowsOf(block));
  };
  for (const block of document.blocks) {
    if (block.type === "section") {
      loose = null;
      const section: PaperSection = { id: block.id, title: block.taskTitle || block.title, rows: [] };
      for (const inner of block.blocks) take(inner, section);
      sections.push(section);
      continue;
    }
    if (!loose) { loose = { id: `loose-${sections.length}`, title: "", rows: [] }; sections.push(loose); }
    if (block.type === "columns") for (const inner of block.columns.flat()) take(inner, loose);
    else take(block, loose);
  }
  const kept = sections.filter((section) => section.rows.length);
  if (kept.length && !kept[0].title) kept[0].title = formName;
  if (!signatures.length) signatures.push({ label: "Utförd av" });
  return { sections: kept, signatures, rowCount: kept.reduce((sum, section) => sum + section.rows.length, 0) };
}

/** The sheets to print: one per chosen point, or one for the round when it has no points (or none is chosen). */
export function paperSheets<T extends { id: string }>(points: readonly T[], chosen: ReadonlySet<string>): (T | null)[] {
  const picked = points.filter((point) => chosen.has(point.id));
  return picked.length ? picked : [null];
}

/** The footer's second line on every sheet, as the documents' footer has it: what the sheet is, "Blad n av N" and when it was printed. */
export function paperFooterLine(input: { sheet: number; sheets: number; printedAt: string }): string {
  return [`Rondprotokoll på papper · Blad ${input.sheet} av ${input.sheets}`, `Utskrivet ${input.printedAt} i Workflow. För in resultatet i Workflow när tjänsten fungerar igen.`].join(" · ");
}
