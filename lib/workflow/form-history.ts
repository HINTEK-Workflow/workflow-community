import { evaluateForm, formDocumentSchema, formValuesSchema } from "./form-document";

/**
 * Earlier protocols of the same form for the same facility (or customer) – "följ upp tidigare kontroller" (
 * 2026-09-26). The summary is computed from each protocol's own document, so it works after the form changed or was
 * deleted. At most a handful are shown; this is a follow-up aid, not a report archive.
 */
export const FORM_HISTORY_LIMIT = 5;

export type FormHistoryItem = { id: string; title: string; status: string; date: string; deviations: number; nextDate: string | null };

type Source = { id: string; title: string; status: string; completedAt?: string | Date | null; updatedAt?: string | Date; data: unknown };

export function formHistoryItem(task: Source): FormHistoryItem {
  const details = (task.data as { details?: { document?: unknown; values?: unknown } } | null)?.details;
  const document = formDocumentSchema.safeParse(details?.document);
  const values = formValuesSchema.safeParse(details?.values ?? {});
  let deviations = 0;
  let nextDate: string | null = null;
  if (document.success && values.success) {
    const evaluation = evaluateForm(document.data, values.data);
    deviations = evaluation.deviations.length;
    // A computed date such as "Nästa kontroll senast" (EDATUM) is shown as the next date.
    nextDate = Object.values(evaluation.computed).find((value): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) ?? null;
  }
  const date = task.completedAt ?? task.updatedAt ?? "";
  return { id: task.id, title: task.title, status: task.status, date: typeof date === "string" ? date : date.toISOString(), deviations, nextDate };
}

/** Local and the demo: the same selection as the server on tasks already in memory. */
export function selectFormHistory(tasks: (Source & { kind: string; customerId: string | null; facilityId?: string | null })[], input: { taskId?: string; templateId: string; customerId: string | null; facilityId: string | null }) {
  if (!input.customerId && !input.facilityId) return [];
  return tasks
    .filter((task) => task.kind === "FORM" && task.id !== input.taskId && (task.data as { details?: { templateId?: string } }).details?.templateId === input.templateId
      && (input.facilityId ? task.facilityId === input.facilityId : task.customerId === input.customerId))
    .sort((a, b) => String(b.completedAt ?? b.updatedAt ?? "").localeCompare(String(a.completedAt ?? a.updatedAt ?? "")))
    .slice(0, FORM_HISTORY_LIMIT)
    .map(formHistoryItem);
}
