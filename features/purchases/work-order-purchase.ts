"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/features/kfid/api";
import { purchaseLineFromRow, workOrderPurchaseRows, workOrderPurchaseTitle, type PurchaseListItem, type PurchaseStatus, type WorkOrderPurchasePick } from "@/lib/purchases/model";
import type { PurchaseRef } from "@/lib/purchases/ref";
import type { MaterialRow } from "@/lib/workflow/expenses";

/**
 * Skapa inköp på arbetsordern (2026-11-18; the 2026-10-26 decision stands: no question while searching articles).
 * One button makes a purchase of the work order's material rows – "Material – <title>", with the work order, and the
 * server gives it the order's project and customer – or adds the rows not yet in the order's open draft. Every row put in
 * gets a `purchaseRef` (origin), so it is never added twice and the purchase follows the rows after each save, as the
 * snabbval's purchase did. Only the existing /api/purchases actions are used (add_lines, sync), so the server checks the
 * right, the company and the Origin exactly as there. Nothing here decides who may: a refusal is said as it comes.
 */
export type LinkedPurchase = { id: string; label: string; title: string; status: PurchaseStatus };

/**
 * The work order's purchases, for the links on the order. `allowed` is true only once the server has answered that the
 * person may make purchases; null while unknown (an unsaved order, still loading, Local) and false when refused.
 */
export function useWorkOrderPurchases(workOrderId: string | null, enabled: boolean) {
  const [state, setState] = useState<{ key: string; purchases: LinkedPurchase[]; allowed: boolean | null }>({ key: "", purchases: [], allowed: null });
  const [round, setRound] = useState(0);
  const key = enabled && workOrderId ? `${workOrderId}:${round}` : "";
  useEffect(() => {
    if (!key || !workOrderId) return;
    let current = true;
    // The list answers only for someone who may make purchases (requirePurchases, as add_lines); canEdit says the same.
    api<{ items: PurchaseListItem[]; canEdit?: boolean }>(`/api/purchases?workOrderId=${encodeURIComponent(workOrderId)}&filter=all`, { cache: "no-store" })
      .then((result) => { if (current) setState({ key, allowed: result.canEdit !== false, purchases: result.items.filter((item) => item.status !== "CANCELLED").map((item) => ({ id: item.id, label: item.label, title: item.title, status: item.status })) }); })
      .catch((cause) => { if (current) setState({ key, purchases: [], allowed: (cause as { status?: number }).status === 403 ? false : null }); });
    return () => { current = false; };
  }, [key, workOrderId]);
  const reload = useCallback(() => setRound((value) => value + 1), []);
  return state.key === key && key ? { purchases: state.purchases, allowed: state.allowed, reload } : { purchases: [] as LinkedPurchase[], allowed: null, reload };
}

export type WorkOrderPurchaseResult = {
  purchaseId: string | null; label: string; existing: boolean; added: number;
  /** The row's id → the ref it gets on the work order. */
  refs: Map<string, PurchaseRef>;
  leftOut: WorkOrderPurchasePick<unknown>["leftOut"];
};

/** Makes the work order's purchase, or adds to its open draft. The work order must be saved (it has an id). */
export async function makeWorkOrderPurchase(order: { id: string; title: string; projectId: string | null; rows: readonly MaterialRow[] }): Promise<WorkOrderPurchaseResult> {
  const pick = workOrderPurchaseRows(order.rows);
  const drafts = await api<{ items: PurchaseListItem[] }>(`/api/purchases?workOrderId=${encodeURIComponent(order.id)}&filter=draft`, { cache: "no-store" });
  const draft = drafts.items.find((item) => item.status === "DRAFT" && item.workOrder?.id === order.id) ?? null;
  const refs = new Map<string, PurchaseRef>();
  if (!pick.rows.length) {
    const label = draft?.label ?? order.rows.find((row) => row.purchaseRef?.label)?.purchaseRef?.label ?? "";
    return { purchaseId: draft?.id ?? order.rows.find((row) => row.purchaseRef)?.purchaseRef?.purchaseId ?? null, label, existing: Boolean(draft), added: 0, refs, leftOut: pick.leftOut };
  }
  let id = draft?.id ?? null, label = draft?.label ?? "";
  // The API takes 50 lines a call: the first call makes the purchase when there is no draft, the rest add to it.
  for (let start = 0; start < pick.rows.length; start += 50) {
    const chunk = pick.rows.slice(start, start + 50);
    const result = await api<{ id: string; label: string; revision: number; lineIds: string[] }>("/api/purchases", { method: "POST", body: JSON.stringify({
      action: "add_lines", id, lines: chunk.map((row) => purchaseLineFromRow(row)),
      create: { title: workOrderPurchaseTitle(order.title), projectId: order.projectId, workOrderId: order.id },
      source: { kind: "work_order", id: order.id },
    }) });
    id = result.id; label = result.label;
    chunk.forEach((row, index) => { const lineId = result.lineIds[index]; if (lineId) refs.set(row.id, { purchaseId: result.id, label: result.label, revision: result.revision, lineId, origin: true }); });
  }
  return { purchaseId: id, label, existing: Boolean(draft), added: refs.size, refs, leftOut: pick.leftOut };
}
