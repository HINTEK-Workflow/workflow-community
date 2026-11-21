import { z } from "zod";
import type { SeriesShape, TableShape } from "../shapes";

/**
 * Filkort (2026-11-19): a PDF, CSV or Excel file shown on a board. The file is uploaded once and kept among the boards' own
 * files in Workflow's private file storage (the same limits and checks as other attachments: at most 10 MB); the card points to it.
 * A PDF is drawn page by page in the browser; a CSV or Excel file is read on the server with the Import page's own reader and sent
 * as a finished table or chart. Pure.
 */
export const BOARD_FILE_MAX_BYTES = 10_000_000;
export const PDF_MIME = "application/pdf";
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const CSV_MIME = "text/csv";
export const BOARD_FILE_MIMES = [PDF_MIME, XLSX_MIME, CSV_MIME] as const;
export type BoardFileKind = "pdf" | "sheet";
export const boardFileKind = (mimeType: string): BoardFileKind | null => mimeType === PDF_MIME ? "pdf" : mimeType === XLSX_MIME || mimeType === CSV_MIME ? "sheet" : null;

const fileId = z.string().trim().min(1).max(60);
const header = z.string().trim().min(1).max(200);
export const pdfSourceSchema = z.object({
  type: z.literal("pdf"),
  fileId,
  /** The page shown; with `cycleSeconds` the first page of the round. */
  page: z.number().int().min(1).max(999).optional(),
  /** Bläddra: the next page after so many seconds; none: the chosen page only. */
  cycleSeconds: z.number().int().min(5).max(600).optional(),
});
export const sheetSourceSchema = z.object({
  type: z.literal("sheet"),
  fileId,
  view: z.enum(["table", "chart"]).optional(),
  /** The column whose cells name the chart's points (the file's own header text). */
  labelColumn: header.optional(),
  valueColumns: z.array(header).max(6).optional(),
});
export type PdfSource = z.infer<typeof pdfSourceSchema>;
export type SheetSource = z.infer<typeof sheetSourceSchema>;

export const SHEET_MAX_ROWS = 200;
export const SHEET_MAX_POINTS = 60;

/** A cell read as a number: Swedish or English decimals, spaces as thousands, a trailing % or unit word ignored; null otherwise. */
export function sheetNumber(value: string | null | undefined): number | null {
  const text = String(value ?? "").replace(/[\s ]/g, "").replace(/(kr|st|h|%)$/i, "");
  if (!/^[-+]?\d+([.,]\d+)?$/.test(text)) return null;
  const number = Number(text.replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

/** The file's header and rows as a table; a column whose filled cells are all numbers is a number column. */
export function sheetTable(headers: readonly string[], rows: readonly string[][]): TableShape {
  const columns = headers.map((label, index) => {
    const filled = rows.map((row) => row[index] ?? "").filter((cell) => cell.trim());
    const numeric = filled.length > 0 && filled.every((cell) => sheetNumber(cell) !== null);
    return { key: `c${index}`, label, type: numeric ? "number" as const : "text" as const };
  });
  return {
    kind: "table", columns,
    rows: rows.slice(0, SHEET_MAX_ROWS).map((row) => Object.fromEntries(columns.map((column, index) => [column.key, column.type === "number" ? sheetNumber(row[index]) : (row[index] ?? "")]))),
    total: rows.length,
  };
}

/** The chosen columns as a chart: the label column names the points, each value column is a line (or bars). */
export function sheetSeries(headers: readonly string[], rows: readonly string[][], source: Pick<SheetSource, "labelColumn" | "valueColumns">): SeriesShape | null {
  const table = sheetTable(headers, rows);
  const labelIndex = Math.max(0, source.labelColumn ? headers.indexOf(source.labelColumn) : table.columns.findIndex((column) => column.type === "text"));
  const chosen = (source.valueColumns ?? []).map((name) => headers.indexOf(name)).filter((index) => index >= 0 && index !== labelIndex);
  const values = chosen.length ? chosen : table.columns.flatMap((column, index) => column.type === "number" && index !== labelIndex ? [index] : []).slice(0, 3);
  if (!values.length) return null;
  const used = rows.slice(0, SHEET_MAX_POINTS);
  return {
    kind: "series",
    labels: used.map((row) => row[labelIndex] ?? ""),
    series: values.map((index) => ({ name: headers[index] ?? "", values: used.map((row) => sheetNumber(row[index])) })),
  };
}
