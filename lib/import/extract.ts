import "server-only";
import { inflateRawSync } from "node:zlib";
import ExcelJS from "exceljs";
import { ApiError } from "@/lib/kfid/server";
import type { ExtractedFile } from "@/lib/import/detect";
import { pdfText } from "@/lib/import/pdf-text";
import { xlsxUnpackProblem } from "@/lib/catalogue/file/xlsx";
import { cell, decodeText, MAX_COLUMNS, MAX_TABLE_ROWS, parseCsv, table } from "@/lib/import/csv";

export { decodeText, parseCsv } from "@/lib/import/csv";

export const MAX_IMPORT_BYTES = 10_000_000;
/**
 * A table (CSV, TSV, Excel) may be larger than other files (prisfil 2026-10-08): a supplier's full price list. How
 * many of its rows are kept is the caller's choice – 1 000 for most kinds of import, more for Artiklar och priser.
 */
export const MAX_TABLE_IMPORT_BYTES = 20_000_000;
const MAX_TEXT = 60_000;

/** A spreadsheet: the sheet named like control points, otherwise the first one with content. The first row is the header. */
async function readWorkbook(buffer: Buffer, name: string, maxRows: number): Promise<ExtractedFile> {
  // A zip bomb stops here, before ExcelJS unpacks the whole workbook in memory (granskningen 2026-11-24).
  const unpackProblem = await xlsxUnpackProblem(buffer);
  if (unpackProblem) throw new ApiError(400, `${name}: ${unpackProblem}`);
  const book = new ExcelJS.Workbook();
  try { await book.xlsx.load(buffer as unknown as ArrayBuffer); } catch { throw new ApiError(400, `${name} kunde inte läsas som Excel (xlsx).`); }
  const sheet = book.worksheets.find((item) => /kontrollpunkt/i.test(item.name)) ?? book.worksheets.find((item) => item.rowCount > 0) ?? book.worksheets[0];
  if (!sheet) throw new ApiError(400, `${name} saknar blad.`);
  const grid: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    if (grid.length > maxRows + 5) return;
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
  return table(grid, name, maxRows, sheet.name);
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

const isWorkbook = (lower: string, type: string) => /\.(xlsx|xlsm)$/.test(lower) || type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const isDelimited = (lower: string, type: string) => /\.(csv|tsv)$/.test(lower) || type === "text/csv";

/** Whether a file is read as a table, and so may be up to MAX_TABLE_IMPORT_BYTES. */
export const isTableFile = (file: Pick<File, "name" | "type">) => isWorkbook(file.name.toLowerCase(), file.type) || isDelimited(file.name.toLowerCase(), file.type);

/**
 * Reads an uploaded file into what the rules and the AI can work with. A table keeps at most `maxRows` rows (1 000
 * unless the caller asks for more, prisfil 2026-10-08); `rowCount` says how many were kept and `truncated` that the
 * file had more.
 */
export async function extractFile(file: File, options: { maxRows?: number } = {}): Promise<ExtractedFile> {
  if (!file.size) throw new ApiError(400, `${file.name} är tom.`);
  const tableFile = isTableFile(file);
  if (file.size > (tableFile ? MAX_TABLE_IMPORT_BYTES : MAX_IMPORT_BYTES)) throw new ApiError(413, tableFile ? `${file.name} är för stor (högst 20 MB för Excel och CSV).` : `${file.name} är för stor (högst 10 MB).`);
  const maxRows = Math.max(1, Math.floor(options.maxRows ?? MAX_TABLE_ROWS));
  const buffer = Buffer.from(await file.arrayBuffer());
  const name = file.name.slice(0, 200);
  const lower = name.toLowerCase();
  const base = { name, mimeType: file.type || "application/octet-stream", size: file.size };
  if (isWorkbook(lower, file.type)) return { ...(await readWorkbook(buffer, name, maxRows)), ...base };
  if (isDelimited(lower, file.type)) return { ...table(parseCsv(decodeText(buffer), maxRows), name, maxRows), ...base };
  if (/\.(json|hwf|kfid)$/.test(lower) || file.type === "application/json") {
    const text = buffer.toString("utf8").slice(0, 5_000_000);
    try { return { ...base, kind: "json", json: JSON.parse(text) }; } catch { throw new ApiError(400, `${name} är inte giltig JSON.`); }
  }
  if (/\.docx$/.test(lower)) {
    const text = docxText(buffer);
    return text ? { ...base, kind: "text", text: text.slice(0, MAX_TEXT) } : { ...base, kind: "binary" };
  }
  if (/\.(txt|md)$/.test(lower) || file.type.startsWith("text/")) {
    const utf16 = buffer.length >= 2 && ((buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff));
    if (!utf16 && buffer.includes(0)) return { ...base, kind: "binary" };
    return { ...base, kind: "text", text: decodeText(buffer).slice(0, MAX_TEXT) };
  }
  // A PDF report gives its text (2026-10-01); a scan or an encrypted PDF stays an attachment.
  if (/\.pdf$/.test(lower) || file.type === "application/pdf") {
    const text = pdfText(buffer);
    return text ? { ...base, kind: "text", text: text.slice(0, MAX_TEXT) } : { ...base, kind: "binary" };
  }
  if (/\.(pdf|png|jpe?g|webp|heic)$/.test(lower) || /^(image\/|application\/pdf)/.test(file.type)) return { ...base, kind: "binary" };
  throw new ApiError(400, `${name}: filtypen stöds inte. Välj Excel, CSV, Word, text, JSON, PDF eller bild.`);
}
