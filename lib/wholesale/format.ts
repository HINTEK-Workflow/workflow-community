import type { WholesalerId } from "./model";
import { profileOf } from "./profiles";
import type { ExportLine } from "./prepare";

/**
 * Formatting of prepared lines for the chosen wholesaler (2026-10-12). Only the profile decides column order,
 * separator, header and line ending; nothing is validated here (prepare.ts did that) and no row is changed.
 * Article numbers are written exactly as they are: no apostrophe, no formula, leading zeros kept (the text is text).
 */

/** The recommended largest order at Ahlsell: a recommendation, not a verified hard limit. */
export const AHLSELL_RECOMMENDED_LINES = 400;

export type ExportPart = { index: number; of: number; lines: ExportLine[]; from: number; to: number };

/** The lines in numbered parts of at most the profile's recommended size; one part when the profile has no limit. Nothing is dropped. */
export function splitParts(lines: readonly ExportLine[], wholesaler: WholesalerId): ExportPart[] {
  const max = profileOf(wholesaler).recommendedMaxLines;
  if (!max || lines.length <= max) return [{ index: 1, of: 1, lines: [...lines], from: lines.length ? 1 : 0, to: lines.length }];
  const of = Math.ceil(lines.length / max);
  return Array.from({ length: of }, (_, i) => ({ index: i + 1, of, lines: lines.slice(i * max, (i + 1) * max), from: i * max + 1, to: Math.min(lines.length, (i + 1) * max) }));
}

const cells = (line: ExportLine, wholesaler: WholesalerId): [string, string] | [string, string] => {
  const columns = profileOf(wholesaler).columns;
  const value = { article: line.identifier, quantity: String(line.quantity) };
  return [value[columns[0]], value[columns[1]]];
};

/** The text of Kopiera: one article per line, no header (except Rexel's template header, as in its CSV). */
export function formatText(lines: readonly ExportLine[], wholesaler: WholesalerId): string {
  const profile = profileOf(wholesaler);
  const body = lines.map((line) => cells(line, wholesaler).join(profile.separator));
  return [...(profile.header ? [profile.header] : []), ...body].join(profile.lineBreak) + (profile.header ? profile.lineBreak : "");
}

/** The Rexel CSV file's text: the template's header, semicolon, CRLF after every line, no empty example line. */
export function formatCsv(lines: readonly ExportLine[], wholesaler: WholesalerId): string {
  const profile = profileOf(wholesaler);
  if (!profile.csv) throw new Error(`${profile.label} har ingen CSV-export.`);
  return formatText(lines, wholesaler);
}

/** Column cells of the Excel sheet, in the profile's order: the identifier is text, the quantity a number. */
export function sheetRows(lines: readonly ExportLine[], wholesaler: WholesalerId): { header: readonly [string, string] | null; rows: { article: string; quantity: number }[]; articleColumn: 1 | 2 } {
  const profile = profileOf(wholesaler);
  return { header: profile.xlsxHeader, rows: lines.map((line) => ({ article: line.identifier, quantity: line.quantity })), articleColumn: profile.columns[0] === "article" ? 1 : 2 };
}

/** File name without ending: "inkop-ahlsell-offert-o-0012-del-1-av-2". */
export function exportFileName(wholesaler: WholesalerId, source: string, part?: { index: number; of: number }): string {
  const slug = source.toLocaleLowerCase("sv-SE").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return ["inkop", wholesaler, slug, part && part.of > 1 ? `del-${part.index}-av-${part.of}` : ""].filter(Boolean).join("-");
}
