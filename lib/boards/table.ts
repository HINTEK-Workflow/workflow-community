import { z } from "zod";
import { formatNumber, statusStateOf, type EventsShape, type NumberShape, type SeriesShape, type Shape, type StatusShape, type TableColumnType, type TableShape } from "./shapes";
import type { DataRef, TableAggregate } from "./model";

/**
 * Egen tabell (Tavlor etapp 1, 2026-11-18): a table the company writes itself – "Dagens mål", "Veckans meddelande", "Produktion per
 * linje". Columns with a type, rows of values. A card reads it in any of the five shapes through its data choice (an aggregate of a
 * column, a label column and value columns, a name and a state column …). The same table can be read by many cards. Pure.
 */
export const TABLE_COLUMN_TYPES = ["text", "number", "date", "status"] as const satisfies readonly TableColumnType[];
export const COLUMN_TYPE_LABEL: Record<TableColumnType, string> = { text: "Text", number: "Tal", date: "Datum", status: "Status" };
export const MAX_COLUMNS = 12;
export const MAX_ROWS = 500;

export const tableColumnSchema = z.object({
  key: z.string().trim().regex(/^[a-z0-9_]{1,40}$/),
  label: z.string().trim().min(1, "Ge kolumnen ett namn.").max(60),
  type: z.enum(TABLE_COLUMN_TYPES),
  unit: z.string().trim().max(12).optional(),
});
export type TableColumn = z.infer<typeof tableColumnSchema>;
export const tableColumnsSchema = z.array(tableColumnSchema).min(1, "En tabell behöver minst en kolumn.").max(MAX_COLUMNS, `Högst ${MAX_COLUMNS} kolumner.`)
  .superRefine((columns, context) => {
    const keys = new Set<string>();
    for (const column of columns) {
      if (keys.has(column.key)) context.addIssue({ code: "custom", message: "Två kolumner har samma nyckel." });
      keys.add(column.key);
    }
  });

export type TableValue = string | number | null;
export type TableRow = { id: string; values: Record<string, TableValue> };

/** A column's key from its name: lower case letters, digits and underscores, unique among the others. */
export function columnKeyFor(label: string, taken: readonly string[]): string {
  const base = label.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "kolumn";
  let key = base;
  for (let n = 2; taken.includes(key); n += 1) key = `${base}_${n}`;
  return key;
}

/** One cell as stored: a number column keeps a number (a Swedish comma is read), a date YYYY-MM-DD, everything else text. */
export function cellValue(column: Pick<TableColumn, "type">, raw: unknown): TableValue {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim().slice(0, 500);
  if (!text) return null;
  if (column.type === "number") {
    const value = Number(text.replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(value) ? value : null;
  }
  if (column.type === "date") return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
  return text;
}

/** A row's values for the table's columns only, each read by its column's type. */
export function rowValues(columns: readonly TableColumn[], raw: unknown): Record<string, TableValue> {
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return Object.fromEntries(columns.map((column) => [column.key, cellValue(column, source[column.key])]));
}

const numbers = (rows: readonly TableRow[], key: string) => rows.map((row) => row.values[key]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));

export function aggregate(rows: readonly TableRow[], key: string | undefined, how: TableAggregate): number | null {
  if (how === "count") return rows.length;
  if (!key) return null;
  if (how === "last") {
    for (let index = rows.length - 1; index >= 0; index -= 1) { const value = rows[index].values[key]; if (typeof value === "number") return value; }
    return null;
  }
  const values = numbers(rows, key);
  if (!values.length) return null;
  if (how === "sum") return values.reduce((sum, value) => sum + value, 0);
  if (how === "avg") return values.reduce((sum, value) => sum + value, 0) / values.length;
  if (how === "min") return Math.min(...values);
  return Math.max(...values);
}

const text = (value: TableValue) => value === null ? "" : typeof value === "number" ? formatNumber(value, 2) : value;

/**
 * The table read in the shape a card wants. Returns null when the card's choice names columns the table does not have (the editor
 * then asks for a new choice) – never a guess.
 */
export function tableShape(columns: readonly TableColumn[], rows: readonly TableRow[], ref: Extract<DataRef, { kind: "table" }>, wanted: Shape["kind"]): Shape | null {
  const has = (key: string | undefined) => Boolean(key && columns.some((column) => column.key === key));
  const column = (key: string | undefined) => columns.find((item) => item.key === key);
  switch (wanted) {
    case "number": {
      const how = ref.aggregate ?? (ref.column ? "sum" : "count");
      if (how !== "count" && !has(ref.column)) return null;
      return { kind: "number", value: aggregate(rows, ref.column, how), unit: column(ref.column)?.unit } satisfies NumberShape;
    }
    case "series": {
      const values = (ref.valueColumns ?? []).filter(has);
      if (!has(ref.labelColumn) || !values.length) return null;
      return {
        kind: "series", labels: rows.map((row) => text(row.values[ref.labelColumn!])),
        series: values.map((key) => ({ name: column(key)!.label, values: rows.map((row) => typeof row.values[key] === "number" ? row.values[key] as number : null) })),
        unit: column(values[0])?.unit,
      } satisfies SeriesShape;
    }
    case "table": return {
      kind: "table", columns: columns.map((item) => ({ key: item.key, label: item.unit ? `${item.label} (${item.unit})` : item.label, type: item.type })),
      rows: rows.map((row) => ({ ...row.values })), total: rows.length,
    } satisfies TableShape;
    case "status": {
      if (!has(ref.nameColumn) || !has(ref.stateColumn)) return null;
      return { kind: "status", items: rows.slice(0, 60).map((row) => ({ name: text(row.values[ref.nameColumn!]) || "–", state: statusStateOf(row.values[ref.stateColumn!]), text: ref.textColumn ? text(row.values[ref.textColumn] ?? null) || undefined : undefined })) } satisfies StatusShape;
    }
    case "events": {
      if (!has(ref.titleColumn)) return null;
      const items = rows.map((row) => ({ at: has(ref.dateColumn) ? text(row.values[ref.dateColumn!]) : "", title: text(row.values[ref.titleColumn!]), level: "info" as const }))
        .filter((item) => item.title).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50);
      return { kind: "events", items } satisfies EventsShape;
    }
    // The newer cards' shapes (lib/boards/cards) never come from an own table.
    default: return null;
  }
}
