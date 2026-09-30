import { evaluateForm, formDocumentSchema, formLeafBlocks, formLimitFor, formValuesSchema, type FormDocument, type FormLimitValue, type FormValues } from "./form-document";

/**
 * Numeric history and trends (2026-09-28): a number marked `trend` in a form – a field, a computed value or, in a
 * table with fixed rows, a column per row ("Lagertemperatur · Lager 1") – is followed over the earlier protocols of the
 * same form at the same facility. Each protocol is read with its own copy of the form, so the series survives new
 * versions. The same pure function serves Cloud (server), Local (the open file) and the demo.
 */
export type FormTrendKey = { key: string; label: string; unit: string; limitKey: string };
export type FormTrendPoint = { taskId: string; date: string; value: number };
export type FormTrendSeries = FormTrendKey & { points: FormTrendPoint[]; limit: (FormLimitValue & { label: string; unit: string }) | null };

export const FORM_TREND_LIMIT = 30;

/** The numbers of a form that are followed as trends. */
export function formTrendKeys(document: FormDocument): FormTrendKey[] {
  const keys: FormTrendKey[] = [];
  for (const block of formLeafBlocks(document)) {
    if (block.type === "field" && block.input === "number" && block.trend) keys.push({ key: block.key, label: block.label, unit: block.unit, limitKey: block.limitKey });
    if (block.type === "computed" && block.trend) keys.push({ key: block.key, label: block.label, unit: block.unit, limitKey: block.limitKey });
    if (block.type === "table" && block.rowMode === "fixed") for (const column of block.columns.filter((item) => item.trend && (item.input === "number" || item.input === "formula")))
      for (const row of block.fixedRows) keys.push({ key: `${block.key}.${column.key}@${row}`, label: `${column.label} · ${row}`, unit: column.unit, limitKey: column.limitKey });
  }
  return keys;
}

const toNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value
  : typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value.replace(",", "."))) ? Number(value.replace(",", ".")) : null;

/** One protocol's value for a trend key, read with the protocol's own form. */
export function formTrendValue(document: FormDocument, values: FormValues, key: string, evaluation = evaluateForm(document, values)): number | null {
  const [path, rowLabel] = key.split("@");
  const [blockKey, columnKey] = path.split(".");
  const block = formLeafBlocks(document).find((item) => "key" in item && item.key === blockKey);
  if (!block) return null;
  if (block.type === "field") return toNumber(values.fields[block.key]);
  if (block.type === "computed") return toNumber(evaluation.computed[block.key]);
  if (block.type === "table" && columnKey) {
    const row = (values.tables[block.key] ?? []).find((item) => item.label === rowLabel && !item.example);
    const column = block.columns.find((item) => item.key === columnKey);
    if (!row || !column) return null;
    return toNumber(column.input === "formula" ? evaluation.cells[block.key]?.[row.id]?.[column.key] : row.cells[column.key]);
  }
  return null;
}

type Source = { id: string; status?: string; completedAt?: string | Date | null; updatedAt?: string | Date; data: unknown };

/** The day a protocol is about: its first date field, else when it was completed or last saved. */
export function formProtocolDate(document: FormDocument, values: FormValues, fallback: string) {
  const field = formLeafBlocks(document).find((block) => block.type === "field" && (block.input === "date" || block.input === "datetime"));
  const value = field && field.type === "field" ? values.fields[field.key] : null;
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 16) : fallback;
}

/**
 * The series for a form: the keys of the current form, their values in the given protocols (oldest first, at most
 * `FORM_TREND_LIMIT`), and – for the limit band – the limits of the current protocol.
 */
export function formTrendSeries(document: FormDocument, current: FormValues | null, protocols: Source[]): FormTrendSeries[] {
  const keys = formTrendKeys(document);
  if (!keys.length) return [];
  const read = protocols.flatMap((task) => {
    const details = (task.data as { details?: { document?: unknown; values?: unknown } } | null)?.details;
    const parsedDocument = formDocumentSchema.safeParse(details?.document);
    const parsedValues = formValuesSchema.safeParse(details?.values ?? {});
    if (!parsedDocument.success || !parsedValues.success) return [];
    const fallback = task.completedAt ?? task.updatedAt ?? "";
    const date = formProtocolDate(parsedDocument.data, parsedValues.data, typeof fallback === "string" ? fallback.slice(0, 16) : fallback.toISOString().slice(0, 16));
    return [{ id: task.id, date, document: parsedDocument.data, values: parsedValues.data, evaluation: evaluateForm(parsedDocument.data, parsedValues.data) }];
  }).sort((a, b) => a.date.localeCompare(b.date)).slice(-FORM_TREND_LIMIT);
  return keys.map((item) => ({
    ...item,
    limit: current ? formLimitFor(document, current, item.limitKey) : formLimitFor(document, {}, item.limitKey),
    points: read.flatMap((protocol) => {
      const value = formTrendValue(protocol.document, protocol.values, item.key, protocol.evaluation);
      return value === null ? [] : [{ taskId: protocol.id, date: protocol.date, value }];
    }),
  }));
}
