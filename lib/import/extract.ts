import "server-only";
import { inflateRawSync } from "node:zlib";
import ExcelJS from "exceljs";
import { ApiError } from "@/lib/kfid/server";
import type { ExtractedFile } from "@/lib/import/detect";
import { pdfText } from "@/lib/import/pdf-text";

export const MAX_IMPORT_BYTES = 10_000_000;
const MAX_ROWS = 1000;
const MAX_COLUMNS = 60;
const MAX_CELL = 2000;
const MAX_TEXT = 60_000;

const cell = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_CELL);

/** A spreadsheet: the sheet named like control points, otherwise the first one with content. The first row is the header. */
async function readWorkbook(buffer: Buffer, name: string): Promise<ExtractedFile> {
  const book = new ExcelJS.Workbook();
  try { await book.xlsx.load(buffer as unknown as ArrayBuffer); } catch { throw new ApiError(400, `${name} kunde inte läsas som Excel (xlsx).`); }
  const sheet = book.worksheets.find((item) => /kontrollpunkt/i.test(item.name)) ?? book.worksheets.find((item) => item.rowCount > 0) ?? book.worksheets[0];
  if (!sheet) throw new ApiError(400, `${name} saknar blad.`);
  const grid: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    if (grid.length > MAX_ROWS) return;
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (item, index) => {
      if (index > MAX_COLUMNS) return;
      // Dates come as Date objects; keep ÅÅÅÅ-MM-DD (and the time when it is set) so the rules can read them.
      const value = item.value;
      cells[index - 1] = value instanceof Date ? (value.getUTCHours() || value.getUTCMinutes() ? value.toISOString().slice(0, 16).replace("T", " ") : value.toISOString().slice(0, 10))
        : typeof value === "object" && value && "result" in value ? cell((value as { result: unknown }).result)
        : typeof value === "object" && value && "richText" in value ? cell((value as { richText: { text: string }[] }).richText.map((part) => part.text).join(""))
        : cell(item.text ?? value);
    });
    grid.push(cells);
  });
  return table(grid, name, sheet.name);
}

function table(grid: string[][], name: string, sheetName?: string): ExtractedFile {
  // The header is the first row with at least two filled cells; rows above it (a title line) are skipped.
  const headerIndex = grid.findIndex((row) => row.filter((value) => value && value.trim()).length >= 2);
  if (headerIndex < 0) return { name, mimeType: "text/csv", size: 0, kind: "table", headers: [], rows: [], sheet: sheetName };
  const headers = grid[headerIndex].map((value, index) => (value && value.trim()) || `Kolumn ${index + 1}`);
  const rows = grid.slice(headerIndex + 1, headerIndex + 1 + MAX_ROWS).map((row) => headers.map((_, index) => cell(row[index])));
  return { name, mimeType: "text/csv", size: 0, kind: "table", headers, rows: rows.filter((row) => row.some(Boolean)), sheet: sheetName };
}

/** CSV with ; , or tab, quotes honoured, BOM removed. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const first = clean.split(/\r?\n/)[0] ?? "";
  const separator = (first.match(/\t/g)?.length ?? 0) > 0 ? "\t" : (first.match(/;/g)?.length ?? 0) >= (first.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = []; let value = ""; let quoted = false;
  for (let index = 0; index < clean.length; index++) {
    const char = clean[index];
    if (quoted) {
      if (char === "\"" && clean[index + 1] === "\"") { value += "\""; index++; }
      else if (char === "\"") quoted = false;
      else value += char;
    } else if (char === "\"") quoted = true;
    else if (char === separator) { row.push(value); value = ""; }
    else if (char === "\n" || char === "\r") { if (char === "\r" && clean[index + 1] === "\n") index++; row.push(value); rows.push(row); row = []; value = ""; }
    else value += char;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  return rows.filter((item) => item.some((part) => part.trim())).slice(0, MAX_ROWS + 5);
}

// ---------- docx: a zip with word/document.xml ----------
function findEntry(buffer: Buffer, wanted: string): Buffer | null {
  // The central directory is found from the end-of-central-directory record.
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) return null;
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let entry = 0; entry < count && offset + 46 <= buffer.length; entry++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) return null;
    const method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (name === wanted) {
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const data = buffer.subarray(start, start + compressed);
      if (method === 0) return Buffer.from(data);
      if (method === 8) { try { return inflateRawSync(data, { maxOutputLength: 20_000_000 }); } catch { return null; } }
      return null;
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

const decodeXml = (text: string) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** The text of a Word document: paragraphs as lines, tabs between table cells. Nothing else is kept. */
export function docxText(buffer: Buffer): string | null {
  const xml = findEntry(buffer, "word/document.xml")?.toString("utf8");
  if (!xml) return null;
  const body = xml.replace(/<w:tab\/>/g, "\t").replace(/<\/w:p>/g, "\n").replace(/<\/w:tc>/g, "\t").replace(/<w:br\/>/g, "\n").replace(/<[^>]+>/g, "");
  return decodeXml(body).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Reads an uploaded file into what the rules and the AI can work with. */
export async function extractFile(file: File): Promise<ExtractedFile> {
  if (!file.size) throw new ApiError(400, `${file.name} är tom.`);
  if (file.size > MAX_IMPORT_BYTES) throw new ApiError(413, `${file.name} är för stor (högst 10 MB).`);
  const buffer = Buffer.from(await file.arrayBuffer());
  const name = file.name.slice(0, 200);
  const lower = name.toLowerCase();
  const base = { name, mimeType: file.type || "application/octet-stream", size: file.size };
  if (/\.(xlsx|xlsm)$/.test(lower) || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return { ...(await readWorkbook(buffer, name)), ...base };
  if (/\.(csv|tsv)$/.test(lower) || file.type === "text/csv") return { ...table(parseCsv(buffer.toString("utf8")), name), ...base };
  if (/\.(json|hwf|kfid)$/.test(lower) || file.type === "application/json") {
    const text = buffer.toString("utf8").slice(0, 5_000_000);
    try { return { ...base, kind: "json", json: JSON.parse(text) }; } catch { throw new ApiError(400, `${name} är inte giltig JSON.`); }
  }
  if (/\.docx$/.test(lower)) {
    const text = docxText(buffer);
    return text ? { ...base, kind: "text", text: text.slice(0, MAX_TEXT) } : { ...base, kind: "binary" };
  }
  if (/\.(txt|md)$/.test(lower) || file.type.startsWith("text/")) {
    if (buffer.includes(0)) return { ...base, kind: "binary" };
    return { ...base, kind: "text", text: buffer.toString("utf8").replace(/^﻿/, "").slice(0, MAX_TEXT) };
  }
  // A PDF report gives its text (2026-10-01); a scan or an encrypted PDF stays an attachment.
  if (/\.pdf$/.test(lower) || file.type === "application/pdf") {
    const text = pdfText(buffer);
    return text ? { ...base, kind: "text", text: text.slice(0, MAX_TEXT) } : { ...base, kind: "binary" };
  }
  if (/\.(pdf|png|jpe?g|webp|heic)$/.test(lower) || /^(image\/|application\/pdf)/.test(file.type)) return { ...base, kind: "binary" };
  throw new ApiError(400, `${name}: filtypen stöds inte. Välj Excel, CSV, Word, text, JSON, PDF eller bild.`);
}
