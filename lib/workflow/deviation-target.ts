import { formLeafBlocks, type FormDocument, type FormValues } from "./form-document";

/**
 * The form block a deviation target lives in (2026-10-06, `&row=` on the way back from a finished work order): a
 * table row's id, a checklist point (`checklist:<key>:<item>`) or a field (`field:<key>`). Nivå 1 på mobil shows one part
 * of the form per screen, so "Följ upp raden" first opens the part with this block (simulation 2026-10-10, telefon fynd
 * 3: the job's menu opened instead). Null when the form has no such row, point or field.
 */
export function formTargetBlockId(document: FormDocument, values: FormValues, target: string | null | undefined): string | null {
  if (!target) return null;
  const [kind, key] = target.split(":");
  for (const block of formLeafBlocks(document)) {
    if (kind === "checklist" && block.type === "checklist" && block.key === key) return block.id;
    if (kind === "field" && block.type === "field" && block.key === key) return block.id;
    if (block.type === "table" && (values.tables[block.key] ?? []).some((row) => row.id === target)) return block.id;
  }
  return null;
}

/**
 * The work order made from the target (a table row's own `workOrderId`, or the one kept by a checklist point's or field's
 * target id), or null when the deviation was only logged. The toast "Arbetsordern är utförd" belongs to the first case.
 */
export function formTargetWorkOrderId(values: FormValues, target: string | null | undefined): string | null {
  if (!target) return null;
  const direct = values.workOrders?.[target];
  if (direct) return direct;
  for (const rows of Object.values(values.tables)) {
    const row = rows.find((item) => item.id === target);
    if (row?.workOrderId) return row.workOrderId;
  }
  return null;
}
