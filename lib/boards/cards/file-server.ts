import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { read } from "@/lib/kfid/storage";
import type { MetricCaller } from "../metrics-server";
import { BOARD_FILE_MAX_BYTES, BOARD_FILE_MIMES, boardFileKind, CSV_MIME, PDF_MIME, sheetSeries, sheetTable, SHEET_MAX_ROWS, XLSX_MIME, type PdfSource, type SheetSource } from "./file";
import type { SourceResult } from "./server";

/**
 * Filkorten på servern. The files are the boards' own (kept with the boards' pictures in Workflow's private file storage, only the
 * company's own rows); a PDF is sent to the browser through the board's file route, a CSV or Excel file is read here with the
 * Import page's reader (lib/import/extract.ts) and kept read while the server runs – a stored file never changes.
 */
type Parsed = { headers: string[]; rows: string[][] };
const globalCache = globalThis as typeof globalThis & { __boardSheetCache?: Map<string, Parsed> };
const parsedFiles: Map<string, Parsed> = globalCache.__boardSheetCache ??= new Map();

async function fileRow(organizationId: string, id: string) {
  return prisma.boardImage.findFirst({ where: { id, organizationId, mimeType: { in: [...BOARD_FILE_MIMES] } }, select: { id: true, filename: true, mimeType: true, storagePath: true } });
}

export async function readPdf(viewer: MetricCaller, source: PdfSource): Promise<SourceResult> {
  const row = await fileRow(viewer.organizationId, source.fileId);
  if (!row || row.mimeType !== PDF_MIME) return { ok: false, reason: "missing" };
  return { ok: true, data: { kind: "document", fileId: row.id, name: row.filename, mimeType: row.mimeType }, label: row.filename };
}

async function parsedSheet(organizationId: string, id: string): Promise<(Parsed & { name: string }) | null> {
  const row = await fileRow(organizationId, id);
  if (!row || boardFileKind(row.mimeType) !== "sheet") return null;
  const key = `${organizationId}:${row.id}`;
  let parsed = parsedFiles.get(key);
  if (!parsed) {
    const bytes = new Uint8Array(await read(row.storagePath));
    // Loaded when a sheet is read (server-only modules; the boards' server code is also loaded by the database tests).
    const { extractFile } = await import("@/lib/import/extract");
    const extracted = await extractFile(new File([bytes], row.filename, { type: row.mimeType }), { maxRows: SHEET_MAX_ROWS });
    parsed = { headers: extracted.headers ?? [], rows: extracted.rows ?? [] };
    parsedFiles.set(key, parsed);
    if (parsedFiles.size > 50) parsedFiles.delete(parsedFiles.keys().next().value!);
  }
  return { ...parsed, name: row.filename };
}

export async function readSheet(viewer: MetricCaller, source: SheetSource): Promise<SourceResult> {
  const sheet = await parsedSheet(viewer.organizationId, source.fileId);
  if (!sheet) return { ok: false, reason: "missing" };
  if (source.view === "chart") {
    const series = sheetSeries(sheet.headers, sheet.rows, source);
    return series ? { ok: true, data: series, label: sheet.name } : { ok: false, reason: "missing" };
  }
  return { ok: true, data: sheetTable(sheet.headers, sheet.rows), label: sheet.name };
}

/** The sheet's column names, for the card's choice of label and values. */
export async function sheetColumns(organizationId: string, id: string) {
  const sheet = await parsedSheet(organizationId, id);
  if (!sheet) throw new ApiError(404, "Filen finns inte.");
  return { columns: sheetTable(sheet.headers, sheet.rows.slice(0, 50)).columns.map((column) => ({ label: column.label, number: column.type === "number" })) };
}

/** The company's files for the file cards, newest first. */
export async function listBoardFiles(organizationId: string) {
  const rows = await prisma.boardImage.findMany({ where: { organizationId, mimeType: { in: [...BOARD_FILE_MIMES] } }, orderBy: { createdAt: "desc" }, take: 200, select: { id: true, filename: true, mimeType: true, size: true, createdAt: true } });
  return rows.map((row) => ({ id: row.id, name: row.filename, kind: boardFileKind(row.mimeType)!, size: row.size, createdAt: row.createdAt.toISOString() }));
}

/**
 * An uploaded file checked as other attachments are (lib/workflow/attachment-file.ts: at most 10 MB, a PDF must be a PDF, an Excel
 * file a zip); a CSV file must be text. Returns the bytes as they are stored and the file's type.
 */
export async function prepareBoardFile(file: File) {
  if (!file.size || file.size > BOARD_FILE_MAX_BYTES) throw new ApiError(400, "Välj en fil på högst 10 MB.");
  const lower = file.name.toLowerCase();
  if (/\.(csv|tsv)$/.test(lower)) {
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.includes(0)) throw new ApiError(400, "CSV-filen kunde inte läsas som text.");
    return { buffer, mimeType: CSV_MIME, extension: "csv" };
  }
  if (!/\.(pdf|xlsx)$/.test(lower)) throw new ApiError(400, "Välj en PDF-, CSV- eller Excelfil (xlsx).");
  const { prepareAttachmentFile } = await import("@/lib/workflow/attachment-file");
  const prepared = await prepareAttachmentFile(lower.endsWith(".pdf") ? new File([await file.arrayBuffer()], file.name, { type: PDF_MIME }) : file);
  if (prepared.extension !== "pdf" && prepared.extension !== "xlsx") throw new ApiError(400, "Välj en PDF-, CSV- eller Excelfil (xlsx).");
  return { buffer: prepared.buffer, mimeType: prepared.extension === "pdf" ? PDF_MIME : XLSX_MIME, extension: prepared.extension };
}
