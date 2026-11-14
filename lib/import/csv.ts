import type { ExtractedFile } from "@/lib/import/detect";

/**
 * Reading text files on the Import page (prisfil 2026-10-08). Pure, so it can be tested without the server.
 *
 * Price files exported from suppliers' portals are often Windows-1252 (ISO-8859-1), not UTF-8: decoded as UTF-8 every
 * å, ä and ö becomes "�". A file is therefore read as UTF-8 when it is valid UTF-8 (with or without a byte order mark),
 * as UTF-16 when it starts with that byte order mark, and otherwise as Windows-1252 – which also covers ISO-8859-1.
 */
export function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes.subarray(3));
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** The ordinary limit of rows read from a table; Artiklar och priser reads more (MAX_CATALOGUE_ROWS). */
export const MAX_TABLE_ROWS = 1000;
export const MAX_COLUMNS = 60;
const MAX_CELL = 2000;

/** A cell as text: whitespace folded, at most 2 000 characters. */
export const cell = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_CELL);

/** The header and at most `maxRows` rows of a grid; `rowCount` is how many were kept, `truncated` that the file had more. */
export function table(grid: string[][], name: string, maxRows: number, sheetName?: string): ExtractedFile {
  // The header is the first row with at least two filled cells; rows above it (a title line) are skipped.
  const headerIndex = grid.findIndex((row) => row.filter((value) => value && value.trim()).length >= 2);
  if (headerIndex < 0) return { name, mimeType: "text/csv", size: 0, kind: "table", headers: [], rows: [], rowCount: 0, sheet: sheetName };
  const headers = grid[headerIndex].slice(0, MAX_COLUMNS).map((value, index) => (value ?? "").trim().slice(0, 200) || `Kolumn ${index + 1}`);
  const body = grid.slice(headerIndex + 1);
  const rows = body.slice(0, maxRows).map((row) => headers.map((_, index) => cell(row[index]))).filter((row) => row.some(Boolean));
  return { name, mimeType: "text/csv", size: 0, kind: "table", headers, rows, rowCount: rows.length, truncated: body.length > maxRows, sheet: sheetName };
}

/** CSV with ; , or tab, quoted fields honoured, BOM removed. At most `maxRows` rows (plus a few for a title above the header). */
export function parseCsv(text: string, maxRows = MAX_TABLE_ROWS): string[][] {
  const clean = text.replace(/^﻿/, "");
  const first = clean.slice(0, 10_000).split(/\r?\n/)[0] ?? "";
  const separator = (first.match(/\t/g)?.length ?? 0) > 0 ? "\t" : (first.match(/;/g)?.length ?? 0) >= (first.match(/,/g)?.length ?? 0) ? ";" : ",";
  const limit = maxRows + 5;
  const rows: string[][] = [];
  let row: string[] = []; let value = ""; let quoted = false;
  const push = () => { if (row.some((part) => part.trim())) rows.push(row); row = []; };
  for (let index = 0; index < clean.length && rows.length < limit; index++) {
    const char = clean[index];
    if (quoted) {
      if (char === "\"" && clean[index + 1] === "\"") { value += "\""; index++; }
      else if (char === "\"") quoted = false;
      else value += char;
    // A quote opens a quoted field only at the start of the field; inside a value it is a character, as in an inch
    // mark (”Rör 1/2"”) – otherwise one such name would swallow the rows after it (prisfil 2026-10-08).
    } else if (char === "\"" && value === "") quoted = true;
    else if (char === separator) { row.push(value); value = ""; }
    else if (char === "\n" || char === "\r") { if (char === "\r" && clean[index + 1] === "\n") index++; row.push(value); value = ""; push(); }
    else value += char;
  }
  if ((value || row.length) && rows.length < limit) { row.push(value); push(); }
  return rows;
}
