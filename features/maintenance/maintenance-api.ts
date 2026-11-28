"use client";

import { api } from "@/features/kfid/api";
import type { ItemFields, ItemSource, ItemStatus, PartListItem, PartStatus, StoreLocationKind } from "@/lib/maintenance/model";
import type { PlaceListItem } from "@/lib/maintenance/place-model";
import type { ChecklistRow, PlanFollowUp, PlanOccurrenceState } from "@/lib/maintenance/plan-model";

/** Förfallet och i tid (2026-11-27): the answer of ?part=follow_up (lib/maintenance/follow-up-server.ts). */
export type FollowUpRow = { kind: "order" | "item"; id: string; workOrderId: string | null; title: string; partName: string; planName: string; due: string; state: PlanOccurrenceState; daysLate: number; assignedToName: string };
export type FollowUp = { figures: PlanFollowUp; text: string; late: FollowUpRow[]; soon: FollowUpRow[]; plans: number; truncated: boolean };
/** Historik (2026-11-27): the answer of ?part=history. */
export type HistoryEntry = {
  kind: "order" | "item" | "deviation" | "finding"; id: string; at: string; title: string; line: string; status: string; tone: "success" | "info" | "warning" | "danger" | "neutral";
  workOrderId: string | null; itemId: string | null; deviationId: string | null;
  /** A brist from a driftrond (2026-11-27): its protocol, comment and photos (the protocol's attachment ids). */
  taskId?: string | null; comment?: string; images?: string[];
};
export type PartHistory = { entries: HistoryEntry[]; truncated: boolean };

/**
 * Underhåll's pages talk to /api/maintenance only (the server checks every call). The answers' shapes, as the pages read
 * them; the server's own types are in lib/maintenance/ (never imported into the browser bundle beyond the pure model).
 */
export type Spare = {
  linkId: string; itemId: string; name: string; unit: string; ownNumber: number | null; articleNo: string; supplierName: string; quantity: number; total: number; low: boolean; minQuantity: number | null;
  balances: { locationId: string; locationName: string; quantity: number }[];
};
export type ItemRow = {
  id: string; partId: string; partName: string; status: ItemStatus; source: ItemSource; type: string; priority: string; fault: string; reportedAt: string | null; stoppedAt: string | null; restoredAt: string | null;
  downtimeMinutes: number | null; workOrder: { id: string; title: string; status: string } | null; createdAt: string;
  /** Gör i driftronden (2026-11-27): the plan occurrence's day, and how far its checklist is. Older answers (the demo) may lack them. */
  planDue?: string | null; checklistText?: string;
};
export type PartDetail = {
  part: {
    id: string; parentId: string | null; placeId: string | null; customerId: string | null; ownerName: string; name: string; partType: string; marking: string; status: PartStatus; notes: string;
    runHours: number | null; runHoursAt: string | null; runHoursOrigin: "person" | "machine";
    runHoursFeed: { signalName: string; sourceName: string } | null; runHoursHeld: { value: number; reason: string; at: string | null } | null;
    isActive: boolean; version: number; path: string[];
    depth: number; placePath: string[]; machinePlaceId: string | null;
  };
  images: { id: string; name: string; isMain: boolean }[];
  spares: Spare[];
  items: ItemRow[];
  signals: { id: string; name: string; sourceName: string }[];
  sources: { id: string; name: string }[];
  workOrders: { id: string; title: string; status: string }[];
  canEdit: boolean; canWithdraw: boolean; canOrder: boolean; pricesVisible: boolean;
};
export type Tree = { parts: PartListItem[]; truncated: boolean; places: PlaceListItem[]; owners: { id: string; name: string }[]; canEdit: boolean };
export type ItemView = ItemRow & ItemFields & {
  version: number; workOrderId: string | null; partPath: string[]; canEdit: boolean; canWithdraw: boolean; pricesVisible: boolean;
  /** Vad som ska göras (2026-11-27): from the plan when the occurrence was made. */
  instruction?: string; checklist?: ChecklistRow[]; plan?: { id: string; name: string } | null;
  withdrawals: { id: string; itemName: string; unit: string; quantity: number; locationName: string; at: string; byName: string; kind: string; returned: boolean }[];
  spares: Spare[];
  workOrders: { id: string; title: string; status: string }[];
};
export type StoreItemRow = {
  id: string; name: string; unit: string; ownNumber: number | null; homeStoreId: string | null; shelfText: string; articleNo: string; supplierName: string; fromRegister: boolean; unitPrice: number | null; minQuantity: number | null; total: number; low: boolean;
  balances: Record<string, number>; parts: number;
};
export type StoreLocationRow = { id: string; parentId: string | null; name: string; label: string; kind: StoreLocationKind; isActive: boolean; seriesStart: number | null; nextNumber: number | null };
export type Store = { locations: StoreLocationRow[]; items: StoreItemRow[]; canEdit: boolean; canOrder: boolean };
export type StoreFigures = { articles: number; low: number; value: number | null; withdrawals90: number; withdrawalCost90: number | null; withdrawalCostTotal: number | null };
export type StoreEvent = { id: string; kind: "WITHDRAWAL" | "RETURN" | "RECEIPT" | "COUNT"; itemId: string; itemName: string; unit: string; change: number; balanceAfter: number; note: string; locationName: string; workOrder: { id: string; title: string } | null; byName: string; at: string };
export type StoreCostOrder = { id: string; title: string; value: number; moves: number };
export type StorePlaceCard = {
  figures: StoreFigures; valueTruncated: boolean; pricesVisible: boolean; movesTruncated: boolean;
  balances: { itemId: string; itemName: string; unit: string; ownNumber: number | null; locationId: string; locationName: string; quantity: number }[];
  events: StoreEvent[]; costOrders: StoreCostOrder[];
};
export type StoreArticleCard = {
  item: {
    id: string; name: string; unit: string; ownNumber: number | null; homeStoreId: string | null; homeStoreName: string; shelfText: string; articleNo: string; supplierName: string; fromRegister: boolean;
    unitPrice: number | null; ownPrice: number | null; minQuantity: number | null; total: number; low: boolean;
  };
  balances: { locationId: string; locationName: string; isActive: boolean; quantity: number }[];
  figures: StoreFigures; pricesVisible: boolean; canEdit: boolean; canOrder: boolean;
  parts: { id: string; name: string; path: string; level: number; quantity: number }[];
  events: StoreEvent[]; costOrders: StoreCostOrder[];
};
export type Cost = {
  totals: { hours: number; time: number | null; material: number | null; withdrawals: number | null; purchases: number | null; total: number | null; orders: number };
  orders: { orderId: string; partId: string; title: string; label: string; status: string; hours: number; material: number | null; purchases: number | null; downtimeMinutes: number }[];
  truncated: boolean;
  downtime: { year: { minutes: number; stops: number; ongoingMinutes: number; ongoingStops: number }; all: { minutes: number; stops: number; ongoingMinutes: number; ongoingStops: number } };
  pricesVisible: boolean; hourlyRateMissing: boolean;
};

export const maintenanceGet = <T,>(query: string) => api<T>(`/api/maintenance?${query}`, { cache: "no-store" }, { change: false });
export const maintenancePost = <T = Record<string, unknown>,>(body: Record<string, unknown>) => api<T>("/api/maintenance", { method: "POST", body: JSON.stringify(body) });
export const partImageUrl = (id: string) => `/api/maintenance/images/${encodeURIComponent(id)}`;

export async function uploadPartImage(partId: string, file: File) {
  const form = new FormData();
  form.set("partId", partId);
  form.set("file", file);
  return api<{ id: string; isMain: boolean }>("/api/maintenance/images", { method: "POST", body: form });
}

export const kronor = (value: number | null) => value === null ? "–" : `${Math.round(value).toLocaleString("sv-SE")} kr`;
export const hoursText = (hours: number) => `${hours.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} h`;
