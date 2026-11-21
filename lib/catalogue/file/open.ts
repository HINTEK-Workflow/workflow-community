import { CsvStream, decodeChunks, detectEncoding, LineStream, sniffLayout, textStart, type Separator, type TextEncodingName } from "./text";
import { cleanStarts, fixedHeaders, splitFixed, suggestFixedStarts } from "./fixed-width";
import { looksLikeZip, openXlsx, XlsxError, type XlsxSheet } from "./xlsx";
import { CATALOGUE_FIELDS } from "@/lib/catalogue/fields";
import { normalizeHeader } from "@/lib/import/detect";
import { KNOWN_FIXED_VARIANTS, rebateLinesReason, type PriceKind } from "@/lib/catalogue/price-kind";
import type { WholesalerId } from "@/lib/wholesale/model";
import { recognizePriceList, type ENumberRule } from "@/lib/catalogue/known-files";

/**
 * A price file opened for reading (prisfil 2026-10-12): what it is (Excel, separated columns, fixed width), its
 * headings and the first rows (for the column suggestion and the Import page), and its rows as a stream. Nothing reads
 * the whole file into one grid: a supplier's list of 300 000 rows passes one row at a time.
 */
export const MAX_PRICE_COLUMNS = 60;
const MAX_CELL = 2000;
/** Rows kept in memory to recognise the columns and to show on the page. */
export const PRICE_SAMPLE_ROWS = 1000;

/** How the person (or the saved profile) wants the file read; everything is optional and suggested when absent. */
export type PriceFileFormat = {
  /** Whether the first row with content is the headings: "auto" decides from the content. */
  header?: "auto" | "yes" | "no";
  /** Fixed width: the first character of each column (1-based). */
  fixedStarts?: number[];
  /** Excel: the sheet to read; otherwise the first sheet with content. */
  sheet?: string;
};

export type PriceFileInfo = {
  kind: "xlsx" | "delimited" | "fixed";
  encoding?: TextEncodingName;
  separator?: Separator;
  lineLength?: number;
  fixedStarts?: number[];
  /** The starts suggested from the characters (fixed width), so the page can offer them again. */
  suggestedStarts?: number[];
  sheet?: string;
  sheets?: string[];
  /** Whether the first row was read as headings, and whether the content alone pointed that way. */
  hasHeader: boolean;
  headerGuess: boolean;
  headers: string[];
  /** The layout as one key, to recognise the supplier's file again (the headings, or the shape when there are none). */
  fingerprint: string;
  /** A wholesaler layout the import knows (2026-10-13 natt): its columns, price scale and kind are used at once. */
  variant?: { id: string; label: string; wholesaler: WholesalerId; fields: Record<string, number>; priceScale: 1 | 100 | 1000; priceKind: PriceKind; eNumber?: ENumberRule };
  /** Why the lines read as a discount file rather than a price list (fixed width), when they do. */
  rebate?: string;
};

export type PriceRecord = {
  /** The row as a person finds it: the row number in Excel, otherwise the n:th line with content. */
  line: number;
  cells: string[];
  /** How many cells the row really had (trailing empty ones not counted), to find shifted rows. */
  width: number;
};

export type PriceFile = {
  name: string;
  info: PriceFileInfo;
  /** The first data rows (at most PRICE_SAMPLE_ROWS), with the headings' width. */
  sample: string[][];
  /** Every data row from the start, one at a time. */
  rows: () => AsyncGenerator<PriceRecord>;
};

export class PriceFileError extends Error {}

/** A cell as text: whitespace folded, at most 2 000 characters (as the rest of the Import page). */
const cellText = (value: string | undefined) => (value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_CELL);
const filled = (cells: readonly string[]) => cells.filter((value) => value && value.trim()).length;
const widthOf = (cells: readonly string[]) => { let width = cells.length; while (width > 0 && !(cells[width - 1] ?? "").trim()) width--; return width; };

/** Headings made unique ("Pris", "Pris (2)") and named when empty, so a mapping can name each column. */
export function uniqueHeaders(raw: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((value, index) => {
    const base = cellText(value).slice(0, 200) || `Kolumn ${index + 1}`;
    const count = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), count);
    return count > 1 ? `${base} (${count})` : base;
  });
}

const ALIASES = new Set(CATALOGUE_FIELDS.flatMap((field) => field.aliases.map(normalizeHeader)));
const looksNumeric = (value: string) => /^-?[\d\s]+(?:[.,]\d+)?$/.test(value.trim()) && /\d/.test(value);

/**
 * Whether a first row is headings (prisfil 2026-10-12; a supplier's discount file has none): a known heading counts
 * for, a text above a column of numbers counts for, and a number in a column of numbers counts against.
 */
export function looksLikeHeader(first: readonly string[], rows: readonly (readonly string[])[]): boolean {
  let score = 0;
  first.forEach((value, column) => {
    const text = value.trim();
    if (!text) return;
    if (ALIASES.has(normalizeHeader(text))) { score += 2; return; }
    const values = rows.slice(0, 200).map((row) => (row[column] ?? "").trim()).filter(Boolean);
    if (!values.length) return;
    const numeric = values.filter(looksNumeric).length / values.length;
    if (numeric >= 0.7) score += looksNumeric(text) ? -1 : 1;
  });
  return score >= 0 && first.some((value) => value.trim() && !looksNumeric(value));
}

type RawRows = () => AsyncGenerator<{ line: number; cells: string[] }>;

/** Rows of the chosen source with the header decided: the headings, the sample and the data rows. */
async function frame(name: string, base: Omit<PriceFileInfo, "hasHeader" | "headerGuess" | "headers" | "fingerprint">, raw: RawRows, format: PriceFileFormat, fixed: boolean): Promise<PriceFile> {
  // The first rows: the header candidate is the first with at least two filled cells (a title line above is skipped).
  const head: { line: number; cells: string[] }[] = [];
  for await (const row of raw()) { head.push(row); if (head.length > PRICE_SAMPLE_ROWS + 20) break; }
  const headerIndex = Math.max(0, head.findIndex((row) => filled(row.cells) >= 2));
  const candidate = head[headerIndex]?.cells.map((value) => cellText(value)) ?? [];
  const after = head.slice(headerIndex + 1).map((row) => row.cells.map((value) => cellText(value)));
  const headerGuess = !fixed && candidate.length > 0 && looksLikeHeader(candidate, after);
  const hasHeader = format.header === "yes" ? true : format.header === "no" ? false : headerGuess;
  const dataStart = hasHeader ? headerIndex + 1 : 0;
  let headers: string[];
  if (fixed) headers = fixedHeaders(base.fixedStarts ?? [1], base.lineLength ?? 1);
  else if (hasHeader) headers = uniqueHeaders(candidate.slice(0, widthOf(candidate) || candidate.length).slice(0, MAX_PRICE_COLUMNS));
  else {
    const width = Math.min(MAX_PRICE_COLUMNS, Math.max(1, ...head.slice(0, 200).map((row) => widthOf(row.cells))));
    headers = Array.from({ length: width }, (_, index) => `Kolumn ${index + 1}`);
  }
  const shape = (cells: string[]) => headers.map((_, index) => cellText(cells[index]));
  const sample = head.slice(dataStart).filter((row) => filled(row.cells)).slice(0, PRICE_SAMPLE_ROWS).map((row) => shape(row.cells));
  const skipBefore = hasHeader ? head[headerIndex]?.line ?? 0 : (head[0]?.line ?? 1) - 1;
  const fingerprint = fixed ? `fast:${base.lineLength}` : hasHeader ? headers.map(normalizeHeader).join("|").slice(0, 2000) : `utan-rubrik:${headers.length}`;
  // Kända prislistor (2026-10-14): a wholesaler's list with headings is read the right way at once.
  const known = !fixed && hasHeader ? recognizePriceList(headers) : null;
  const variant = known ? { variant: { id: known.id, label: known.label, wholesaler: known.wholesaler, priceScale: 1 as const, priceKind: "BASE" as const, eNumber: known.eNumber,
    // The optional fields (förpackning, multipel, status – 2026-10-15) only when the file has the heading.
    fields: Object.fromEntries([...Object.entries(known.fields), ...Object.entries(known.optional ?? {})]
      .map(([field, heading]) => [field, headers.findIndex((header) => normalizeHeader(header) === normalizeHeader(heading))] as const)
      .filter(([field, index]) => index >= 0 || field in known.fields)) } } : {};
  return {
    name,
    info: { ...base, hasHeader, headerGuess, headers, fingerprint, ...variant },
    sample,
    rows: async function* () {
      for await (const row of raw()) {
        if (row.line <= skipBefore || !filled(row.cells)) continue;
        yield { line: row.line, cells: shape(row.cells), width: widthOf(row.cells) };
      }
    },
  };
}

/** A table already in memory (the API's and the tests' rows) as a price file: the headings as given, rows from line 2. */
export function priceFileFromGrid(name: string, headers: string[], rows: string[][]): PriceFile {
  const shape = (cells: string[]) => headers.map((_, index) => cellText(cells[index]));
  return {
    name,
    info: { kind: "delimited", hasHeader: true, headerGuess: true, headers, fingerprint: headers.map(normalizeHeader).join("|").slice(0, 2000) },
    sample: rows.slice(0, PRICE_SAMPLE_ROWS).map(shape),
    rows: async function* () {
      let line = 1;
      for (const row of rows) { line++; if (filled(row)) yield { line, cells: shape(row), width: widthOf(row) }; }
    },
  };
}

/** Whether a file name or the bytes are a workbook. */
export const isWorkbookName = (name: string) => /\.(xlsx|xlsm)$/i.test(name);

/**
 * Opens a price file: Excel by its zip content, otherwise text (CSV, TSV, TXT) by its layout. A text file that is
 * neither separated columns nor fixed width is not a table (PriceFileError).
 */
export async function openPriceFile(bytes: Uint8Array, name: string, format: PriceFileFormat = {}): Promise<PriceFile> {
  if (!bytes.length) throw new PriceFileError(`${name} är tom.`);
  if (looksLikeZip(bytes)) {
    let book;
    try { book = await openXlsx(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)); }
    catch (error) { throw new PriceFileError(error instanceof XlsxError ? `${name}: ${error.message}` : `${name} kunde inte läsas som Excel (xlsx).`); }
    const sheet: XlsxSheet = (format.sheet ? book.sheets.find((item) => item.name === format.sheet) : undefined)
      ?? book.sheets.find((item) => item.size > 600) ?? book.sheets[0];
    const raw: RawRows = () => book.rows(sheet, MAX_PRICE_COLUMNS);
    return frame(name, { kind: "xlsx", sheet: sheet.name, sheets: book.sheets.map((item) => item.name) }, raw, format, false);
  }
  const { encoding, bom } = detectEncoding(bytes);
  const start = textStart(bytes, encoding, bom);
  if (start.includes("\u0000")) throw new PriceFileError(`${name} är inte en textfil.`);
  const sniffed = sniffLayout(start, name);
  // Positions given by the person (or the saved profile) make it a fixed-width file, whatever the sniffing said.
  const layout = format.fixedStarts?.length && sniffed.kind !== "fixed"
    ? { kind: "fixed" as const, lineLength: Math.max(1, ...start.split(/\r\n|\r|\n/).slice(0, 2000).map((line) => line.length)) }
    : sniffed;
  if (layout.kind === "text") throw new PriceFileError(`${name} ser inte ut som en tabell (inga kolumner med avgränsare och inte fast bredd).`);
  if (layout.kind === "delimited") {
    const raw: RawRows = async function* () {
      const parser = new CsvStream(layout.separator);
      for (const piece of decodeChunks(bytes, encoding, bom)) yield* parser.feed(piece);
      yield* parser.end();
    };
    return frame(name, { kind: "delimited", encoding, separator: layout.separator }, raw, format, false);
  }
  const lines = spreadLines(bytes, encoding, bom, layout.lineLength);
  // A known wholesaler layout gives its own positions (2026-10-13 natt: Ahlsell's text file was split in the wrong places).
  const known = KNOWN_FIXED_VARIANTS.find((variant) => variant.lineLength === layout.lineLength && variant.matches(lines));
  const suggestedStarts = known ? known.starts : suggestFixedStarts(lines, layout.lineLength);
  const starts = format.fixedStarts?.length ? cleanStarts(format.fixedStarts, layout.lineLength) : suggestedStarts;
  const variant = known && JSON.stringify(starts) === JSON.stringify(known.starts)
    ? { id: known.id, label: known.label, wholesaler: known.wholesaler, fields: known.fields, priceScale: known.priceScale, priceKind: known.priceKind, ...(known.eNumber ? { eNumber: known.eNumber } : {}) } : undefined;
  const rebate = known ? undefined : rebateLinesReason(lines) ?? undefined;
  const raw: RawRows = async function* () {
    const reader = new LineStream();
    for (const piece of decodeChunks(bytes, encoding, bom)) for (const line of reader.feed(piece)) yield { line: line.line, cells: splitFixed(line.text, starts) };
    for (const line of reader.end()) yield { line: line.line, cells: splitFixed(line.text, starts) };
  };
  // A fixed-width file has no headings by default; the person can say that the first line is one.
  return frame(name, { kind: "fixed", encoding, lineLength: layout.lineLength, fixedStarts: starts, suggestedStarts, ...(variant ? { variant } : {}), ...(rebate ? { rebate } : {}) }, raw, { ...format, header: format.header === "yes" ? "yes" : "no" }, true);
}

/**
 * Lines from eight places spread over the file (the start of a sorted list is rarely typical of the rest): whole lines
 * of the expected length only, at most 4 000.
 */
function spreadLines(bytes: Uint8Array, encoding: TextEncodingName, bom: number, lineLength: number): string[] {
  const lines: string[] = [];
  const window = 48 * 1024;
  for (let part = 0; part < 8; part++) {
    const offset = bom + Math.floor(((bytes.length - bom) * part) / 8);
    const text = new TextDecoder(encoding).decode(bytes.subarray(offset, Math.min(bytes.length, offset + window)));
    const parts = text.split(/\r\n|\r|\n/);
    // The first piece may start in the middle of a line, the last may be cut off.
    const whole = parts.slice(part === 0 ? 0 : 1, -1).filter((line) => line.length === lineLength);
    lines.push(...whole.slice(0, 500));
  }
  return lines.slice(0, 4000);
}

/** Whether a text file reads as a table (separated columns or fixed width), from its first characters. */
export function textIsTable(bytes: Uint8Array, name: string): boolean {
  const { encoding, bom } = detectEncoding(bytes);
  const start = textStart(bytes, encoding, bom, 64 * 1024);
  return !start.includes("\u0000") && sniffLayout(start, name).kind !== "text";
}
