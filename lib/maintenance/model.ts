import { z } from "zod";
import { parseAmount } from "@/lib/workflow/expenses";
import { maintenanceDowntimeMinutes, maintenanceFactsSchema, MARKING_MAX_LENGTH } from "@/lib/workflow/maintenance";
import { hasWorkflowPermission, type WorkflowPermissionProfile } from "@/lib/workflow/permissions";
import { roundOre } from "@/lib/workflow/material-prices";
import { RUN_HOURS_MAX } from "@/lib/machine/run-hours";

/**
 * Underhåll (2026-10-30, the design proposal app/design-lab/arbetsorder-hallare, view underhall): the rules of the
 * maintenance module without a database – who may do what, the machine tree, the store's balances and withdrawals, and the
 * cost and downtime per machine. Shared by the server (./server.ts), the pages (features/maintenance/) and the unit tests.
 * Cloud only, like the machine connection. Words are our own plain Swedish; nothing from a manufacturer or a standard.
 */

// ---------- access ----------

export type MaintenanceCaller = { organizationId: string; userId: string; admin: boolean; permissions: WorkflowPermissionProfile; storageMode: string };

/**
 * read: the menu item Underhåll, the tree, the store and the costs' hours. edit: change the tree, the store and items.
 * An item held by a work order is also read and filled in with the work order's own rights (it is a part of the order, like
 * a task), so a technician with Arbetsordrar can do the job without the module right. Withdrawing a spare part onto a work
 * order needs the right to change the work order. Amounts follow the price right (lib/workflow/material-prices.ts).
 */
export function maintenanceAccess(caller: Pick<MaintenanceCaller, "admin" | "permissions" | "storageMode">) {
  const can = (subject: "maintenance" | "work-order" | "catalogue" | "quotes", action: "read" | "edit") => caller.admin || hasWorkflowPermission(caller.permissions, subject, action);
  const cloud = caller.storageMode === "HINTEK_CLOUD";
  return {
    cloud,
    read: cloud && can("maintenance", "read"),
    edit: cloud && can("maintenance", "edit"),
    workOrderRead: cloud && can("work-order", "read"),
    workOrderEdit: cloud && can("work-order", "edit"),
    prices: caller.admin || can("catalogue", "read") || can("quotes", "read"),
  };
}
export type MaintenanceAccess = ReturnType<typeof maintenanceAccess>;

/** An item may be read by whoever reads the module, or – when a work order holds it – whoever reads work orders. */
export const canReadItem = (access: MaintenanceAccess, item: { workOrderId: string | null }) => access.read || (Boolean(item.workOrderId) && access.workOrderRead);
/** And changed by whoever edits the module, or – when a work order holds it – whoever edits work orders. */
export const canEditItem = (access: MaintenanceAccess, item: { workOrderId: string | null }) => access.edit || (Boolean(item.workOrderId) && access.workOrderEdit);
/** A spare part is drawn onto a work order by whoever may change that work order and see the store. */
export const canWithdraw = (access: MaintenanceAccess) => access.workOrderEdit && (access.read || access.edit);

// ---------- the machine tree ----------

export const PART_STATUSES = ["IN_SERVICE", "SERVICE_SOON", "OUT_OF_SERVICE", "DECOMMISSIONED"] as const;
export type PartStatus = (typeof PART_STATUSES)[number];
export const PART_STATUS_LABELS: Record<PartStatus, string> = { IN_SERVICE: "I drift", SERVICE_SOON: "Service snart", OUT_OF_SERVICE: "Ur drift", DECOMMISSIONED: "Avvecklad" };
export const PART_STATUS_TONES: Record<PartStatus, "success" | "warning" | "danger" | "neutral"> = { IN_SERVICE: "success", SERVICE_SOON: "warning", OUT_OF_SERVICE: "danger", DECOMMISSIONED: "neutral" };
export const partStatusOf = (value: string): PartStatus => (PART_STATUSES as readonly string[]).includes(value) ? value as PartStatus : "IN_SERVICE";

/** As deep as the place tree draws (PLACE_MAX_DEPTH). */
export const PART_MAX_DEPTH = 12;
export const PART_LIMIT = 5000;
export const PART_IMAGE_LIMIT = 30;

const id = z.string().trim().min(1).max(100);
export const partInputSchema = z.object({
  parentId: id.nullable().default(null),
  /** Only a root (a machine): the place it stands on; null = Utan plats, left out = unchanged on a save. */
  placeId: id.nullable().optional(),
  /** Only a root: the customer that owns the tree; null = the company's own (Eget). */
  customerId: id.nullable().default(null),
  name: z.string().trim().min(1, "Skriv ett namn.").max(120),
  partType: z.string().trim().max(80).default(""),
  marking: z.string().trim().max(MARKING_MAX_LENGTH).default(""),
  status: z.enum(PART_STATUSES).default("IN_SERVICE"),
  notes: z.string().trim().max(2000).default(""),
  /** Null = none; left out on a save = unchanged (a machine may have moved them since the form was opened). */
  runHours: z.number().min(0).max(RUN_HOURS_MAX).nullable().optional(),
  isActive: z.boolean().default(true),
});
export type PartInput = z.output<typeof partInputSchema>;

export type PartListItem = {
  id: string; parentId: string | null; placeId: string | null; customerId: string | null; ownerName: string; name: string; partType: string; marking: string;
  status: PartStatus; isActive: boolean; mainImageId: string | null; openItems: number;
  /** Open fault reports on the part itself: corrective items with Felanmäld set, and operator reports waiting for approval. */
  reported: number;
};

export type PartRow = { id: string; parentId: string | null; name: string };

/** The names from the root down to the part's parent ("Fabriken › Linje 2 › Press 4"); a missing or looping parent ends it. */
export function partPath(parts: readonly PartRow[], partId: string): string[] {
  const byId = new Map(parts.map((part) => [part.id, part]));
  const names: string[] = [];
  const seen = new Set<string>([partId]);
  let current = byId.get(partId)?.parentId ?? null;
  while (current && !seen.has(current) && names.length < PART_MAX_DEPTH) {
    seen.add(current);
    const part = byId.get(current);
    if (!part) break;
    names.unshift(part.name);
    current = part.parentId;
  }
  return names;
}

/** The part and every part under it (for costs, downtime and events of a whole machine). */
export function subtreeIds(parts: readonly PartRow[], partId: string): string[] {
  const children = new Map<string, string[]>();
  for (const part of parts) if (part.parentId) children.set(part.parentId, [...(children.get(part.parentId) ?? []), part.id]);
  const out: string[] = [];
  const stack = [partId];
  const seen = new Set<string>();
  while (stack.length) {
    const next = stack.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    out.push(next);
    stack.push(...(children.get(next) ?? []));
  }
  return out;
}

/** The root of a part (its tree), or the part itself when it is a root. */
export function rootOf(parts: readonly PartRow[], partId: string): string {
  const byId = new Map(parts.map((part) => [part.id, part]));
  let current = partId;
  const seen = new Set<string>();
  while (!seen.has(current)) {
    seen.add(current);
    const parent = byId.get(current)?.parentId;
    if (!parent || !byId.has(parent)) return current;
    current = parent;
  }
  return current;
}

/** Every part's root in one pass, for a whole tree (rootOf reads the tree each time). A looping parent ends at the part itself. */
export function rootsOf(parts: readonly PartRow[]): Map<string, string> {
  const byId = new Map(parts.map((part) => [part.id, part]));
  const roots = new Map<string, string>();
  for (const part of parts) {
    const way: string[] = [];
    let current: PartRow | undefined = part;
    let root: string | undefined;
    while (current) {
      root = roots.get(current.id);
      if (root) break;
      if (way.includes(current.id)) { root = current.id; break; }
      way.push(current.id);
      const parent: PartRow | undefined = current.parentId ? byId.get(current.parentId) : undefined;
      if (!parent) { root = current.id; break; }
      current = parent;
    }
    for (const id of way) roots.set(id, root ?? part.id);
  }
  return roots;
}

/** How deep a part sits (a root is 0). */
export const partDepth = (parts: readonly PartRow[], partId: string) => partPath(parts, partId).length;

/**
 * Whether `parentId` may hold `partId`: in the same company (the caller checks), not the part itself or anything under it,
 * and the result not deeper than the tree draws. Returns the reason in words, or "".
 */
export function moveProblem(parts: readonly PartRow[], partId: string | null, parentId: string | null): string {
  if (!parentId) return "";
  if (!parts.some((part) => part.id === parentId)) return "Den överordnade delen hittades inte.";
  if (partId && subtreeIds(parts, partId).includes(parentId)) return "En del kan inte ligga under sig själv.";
  const below = partId ? Math.max(0, ...subtreeIds(parts, partId).map((id) => partDepth(parts, id) - partDepth(parts, partId))) : 0;
  if (partDepth(parts, parentId) + 1 + below >= PART_MAX_DEPTH) return `Trädet kan ha högst ${PART_MAX_DEPTH} nivåer.`;
  return "";
}

// ---------- the store ----------

export const STORE_LOCATION_KINDS = ["STORE", "VEHICLE"] as const;
export type StoreLocationKind = (typeof STORE_LOCATION_KINDS)[number];
export const STORE_LOCATION_KIND_LABELS: Record<StoreLocationKind, string> = { STORE: "Förråd", VEHICLE: "Servicebil" };
export const STORE_TRANSACTION_LABELS: Record<"WITHDRAWAL" | "RETURN" | "RECEIPT" | "COUNT", string> = { WITHDRAWAL: "Uttag", RETURN: "Åter", RECEIPT: "Inleverans", COUNT: "Inventering" };
/** The largest own number and series start a person can set. */
export const STORE_NUMBER_MAX = 999_000_000;
/** Quantities have four decimals in the database; larger amounts than this are typing mistakes. */
export const QUANTITY_MAX = 1_000_000;

/** Four decimals, so 0.1 + 0.2 never shows as 0.30000000000000004. */
export const roundQuantity = (value: number) => Math.round(Number((value * 10_000).toPrecision(12))) / 10_000 + 0;

/** A quantity a person typed ("1,5", "2"): a number above zero (or zero and above with `allowZero`), else null. */
export function parseQuantity(text: string | number, options: { allowZero?: boolean } = {}): number | null {
  const value = typeof text === "number" ? text : parseAmount(String(text).trim());
  if (value === null || !Number.isFinite(value) || value > QUANTITY_MAX) return null;
  if (options.allowZero ? value < 0 : value <= 0) return null;
  return roundQuantity(value);
}

/** "1,5" – a quantity as a person reads it. */
export const quantityText = (value: number) => roundQuantity(value).toLocaleString("sv-SE", { maximumFractionDigits: 4 });

/** A withdrawal from one location: the balance after, or why it cannot be done. Never below zero (decision: draw directly). */
export function withdrawal(balance: number, quantity: number): { ok: true; after: number } | { ok: false; problem: string } {
  if (!(quantity > 0)) return { ok: false, problem: "Ange ett antal större än noll." };
  if (roundQuantity(balance) < roundQuantity(quantity)) return { ok: false, problem: balance > 0 ? `Det finns bara ${quantityText(balance)} på platsen.` : "Det finns inget kvar på platsen. Beställ först." };
  return { ok: true, after: roundQuantity(balance - quantity) };
}

/** Inventering: the counted balance replaces the old one; the change is what the log records. */
export const countChange = (balance: number, counted: number) => roundQuantity(counted - balance);

/** The location to draw from when none is chosen: the first (in the given order) that has enough, else the one with most. */
export function pickLocation(balances: readonly { locationId: string; quantity: number }[], quantity: number): string | null {
  const enough = balances.find((row) => roundQuantity(row.quantity) >= roundQuantity(quantity));
  if (enough) return enough.locationId;
  const most = [...balances].sort((a, b) => b.quantity - a.quantity)[0];
  return most && most.quantity > 0 ? most.locationId : null;
}

export const itemTotal = (balances: readonly { quantity: number }[]) => roundQuantity(balances.reduce((sum, row) => sum + row.quantity, 0));
/** Lågt: the total is under the item's minimum. No minimum, never low. */
export const isLow = (total: number, minQuantity: number | null) => minQuantity !== null && minQuantity > 0 && roundQuantity(total) < roundQuantity(minQuantity);
/** How many "Beställ" suggests: up to twice the minimum (at least one). */
export const suggestedOrderQuantity = (total: number, minQuantity: number | null) => Math.max(1, roundQuantity((minQuantity ?? 1) * 2 - Math.max(0, total)));

export const storeLocationInputSchema = z.object({
  /** The place's own name; the row's full way ("Fabriken › Skåp 1") is written by the server. */
  name: z.string().trim().min(1, "Skriv ett namn.").max(80),
  /** The place above; left out on a save = unchanged. */
  parentId: id.nullable().optional(),
  kind: z.enum(STORE_LOCATION_KINDS).default("STORE"),
  /** Only at the top: where the store's number series starts; left out or null = the next free series. */
  seriesStart: z.number().int().min(1).max(STORE_NUMBER_MAX).nullable().optional(),
  isActive: z.boolean().default(true),
});

// ---------- the store's tree and numbers (2026-10-31) ----------

/** Förråd › Skåp › Hylla › Hyllplats by depth, as deep as anyone wants; the deepest name keeps going. */
export const STORE_LEVEL_NAMES = ["Förråd", "Skåp", "Hylla", "Hyllplats"] as const;
export const storeLevelName = (depth: number, kind: string = "STORE") => depth <= 0 && kind === "VEHICLE" ? "Servicebil" : STORE_LEVEL_NAMES[Math.min(Math.max(0, depth), STORE_LEVEL_NAMES.length - 1)];
export const STORE_LOCATION_MAX_DEPTH = 8;
export const STORE_LOCATION_LIMIT = 500;
/** One store's series (100000, 200000 …): the next store starts on the next whole hundred thousand. */
export const STORE_SERIES_STEP = 100_000;

export type StoreLocationRow = { id: string; parentId: string | null; name: string; label?: string };
/** A row's own name; an older row has none and its full way is its name. */
export const storeOwnName = (row: { name: string; label?: string }) => row.label || row.name;

/** The next series for a new store: the first whole hundred thousand above every series taken. */
export const nextSeriesStart = (taken: readonly (number | null)[]) => (Math.floor(Math.max(0, ...taken.map((start) => start ?? 0)) / STORE_SERIES_STEP) + 1) * STORE_SERIES_STEP;

/** The first number at or above the series' start that no article of the company has. */
export function nextFreeNumber(start: number, used: readonly (number | null)[]) {
  const taken = new Set(used);
  let next = start;
  while (taken.has(next)) next += 1;
  return next;
}

/** Every row's full way from the top ("Fabriken › Skåp 1 › Hylla 2"); a looping parent ends the walk. */
export function storeLocationNames(rows: readonly StoreLocationRow[]): Map<string, string> {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const names = new Map<string, string>();
  for (const row of rows) {
    const way: string[] = [];
    const seen = new Set<string>();
    let current: StoreLocationRow | undefined = row;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      way.unshift(storeOwnName(current));
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    names.set(row.id, way.join(" › "));
  }
  return names;
}

/** Whether a store place may lie under `parentId`: not under itself, and not deeper than the tree draws. The reason, or "". */
export function storeLocationProblem(rows: readonly StoreLocationRow[], rowId: string | null, parentId: string | null): string {
  if (!parentId) return "";
  const shaped = rows.map((row) => ({ id: row.id, parentId: row.parentId, name: row.name }));
  if (!shaped.some((row) => row.id === parentId)) return "Förrådsplatsen ovanför hittades inte.";
  if (rowId && subtreeIds(shaped, rowId).includes(parentId)) return "En plats kan inte ligga under sig själv.";
  const below = rowId ? Math.max(0, ...subtreeIds(shaped, rowId).map((id) => partDepth(shaped, id) - partDepth(shaped, rowId))) : 0;
  if (partDepth(shaped, parentId) + 1 + below >= STORE_LOCATION_MAX_DEPTH) return `Förvaringen kan ha högst ${STORE_LOCATION_MAX_DEPTH} nivåer.`;
  return "";
}

export type StoreFigureBalance = { itemId: string; quantity: number };
export type StoreFigureMove = { itemId: string; kind: string; change: number; unitPrice: number | null; at: Date };
/**
 * The figure boxes of a store's card or an article's: how many articles there are, how many are under their minimum (the whole
 * article's total, not this place's), the store's value at the given prices (null when the reader may not see prices, or none
 * is known) and what was drawn in the last 90 days, net of what came back.
 */
export function storeFigures(input: { balances: readonly StoreFigureBalance[]; lowItems: ReadonlySet<string>; prices: ReadonlyMap<string, number | null> | null; moves: readonly StoreFigureMove[]; now: Date }) {
  const items = new Set(input.balances.map((row) => row.itemId));
  let value: number | null = null;
  if (input.prices) for (const row of input.balances) {
    const price = input.prices.get(row.itemId);
    if (price === null || price === undefined) continue;
    value = roundOre((value ?? 0) + row.quantity * price);
  }
  const since = input.now.getTime() - 90 * 86_400_000;
  const recent = input.moves.filter((move) => move.at.getTime() >= since && (move.kind === "WITHDRAWAL" || move.kind === "RETURN"));
  const costOf = (rows: readonly StoreFigureMove[]) => roundOre(rows.reduce((sum, move) => sum + (move.unitPrice === null ? 0 : -move.change * move.unitPrice), 0));
  return {
    articles: items.size,
    low: [...items].filter((item) => input.lowItems.has(item)).length,
    value,
    withdrawals90: recent.filter((move) => move.kind === "WITHDRAWAL").length - recent.filter((move) => move.kind === "RETURN").length,
    withdrawalCost90: input.prices ? costOf(recent) : null,
    withdrawalCostTotal: input.prices ? costOf(input.moves.filter((move) => move.kind === "WITHDRAWAL" || move.kind === "RETURN")) : null,
  };
}

// ---------- the maintenance item ----------

export const ITEM_STATUSES = ["OPEN", "DONE", "CANCELLED"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = { OPEN: "Öppen", DONE: "Klar", CANCELLED: "Utgår" };
export const ITEM_SOURCES = ["MANUAL", "MACHINE_ALARM", "OPERATOR", "PLAN"] as const;
export type ItemSource = (typeof ITEM_SOURCES)[number];
export const ITEM_SOURCE_LABELS: Record<ItemSource, string> = { MANUAL: "", MACHINE_ALARM: "Maskinlarm", OPERATOR: "Felanmälan", PLAN: "Underhållsplan" };

/** The item's fields: the maintenance facts of lib/workflow/maintenance.ts (what a paused order waits for stays on the order). */
export const itemFieldsSchema = maintenanceFactsSchema;
export type ItemFields = z.output<typeof itemFieldsSchema>;
export const itemInputSchema = itemFieldsSchema.extend({
  partId: id,
  workOrderId: id.nullable().default(null),
  status: z.enum(ITEM_STATUSES).default("OPEN"),
});
export type ItemInput = z.output<typeof itemInputSchema>;

/** "Underhåll · Hydraulpump": an item's line in the work order's list. */
export const itemTitle = (partName: string) => `Underhåll · ${partName}`;

/** Åter i drift before Ur drift is refused (an item is stored per machine and summed). */
export function itemTimeProblem(fields: Pick<ItemFields, "stoppedAt" | "restoredAt">) {
  if (fields.restoredAt && !fields.stoppedAt) return "Fyll i Ur drift före Åter i drift.";
  if (fields.stoppedAt && fields.restoredAt && Date.parse(fields.restoredAt) < Date.parse(fields.stoppedAt)) return "Åter i drift ligger före stoppet.";
  return "";
}

// ---------- downtime and cost per machine ----------

export type DowntimeItem = { stoppedAt: string | null; restoredAt: string | null };
/**
 * Stillestånd (from the items, never stored): minutes of finished stops, and – for a stop still going on – the minutes up
 * to `now`, separately. `since` cuts the period: a stop that began before it counts from `since`.
 */
export function downtimeSummary(items: readonly DowntimeItem[], now: Date, since: Date | null = null) {
  let done = 0, ongoing = 0, stops = 0, open = 0;
  const from = since?.getTime() ?? -Infinity;
  for (const item of items) {
    if (!item.stoppedAt) continue;
    const start = Math.max(Date.parse(item.stoppedAt), from);
    if (item.restoredAt) {
      const end = Date.parse(item.restoredAt);
      const whole = maintenanceDowntimeMinutes(item);
      if (whole === null || end <= from) continue;
      done += Math.max(0, Math.round((end - start) / 60_000));
      stops += 1;
    } else {
      const minutes = Math.round((now.getTime() - start) / 60_000);
      if (minutes > 0) { ongoing += minutes; open += 1; }
    }
  }
  return { minutes: done, stops, ongoingMinutes: ongoing, ongoingStops: open };
}

/**
 * Which part a work order's cost belongs to: its own part (machinePartId) when it has one, else the part of its oldest
 * maintenance item. Each work order counts once, so a machine's sum never takes the same order twice.
 */
export function attributeWorkOrders(orders: readonly { id: string; machinePartId: string | null; itemParts: readonly string[] }[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const order of orders) {
    const part = order.machinePartId ?? order.itemParts[0] ?? null;
    if (part) result.set(order.id, part);
  }
  return result;
}

export type OrderCost = { orderId: string; partId: string; title: string; label: string; status: string; hours: number; material: number; purchases: number; downtimeMinutes: number };
export type CostTotals = { hours: number; time: number | null; material: number; withdrawals: number; purchases: number; total: number; orders: number };

/**
 * The sum for a machine (the part and everything under it): hours on its work orders, the work orders' material at purchase
 * price, withdrawals from the store at their price then, and purchases made for the work orders (only lines added to the
 * purchase directly – a line picked from the work order's material row is already counted there). Time in kronor needs the
 * company's hourly rate; without it `time` is null, the total is without time and the page says so.
 */
export function costTotals(input: { orders: readonly Pick<OrderCost, "hours" | "material" | "purchases">[]; withdrawals: readonly { quantity: number; unitPrice: number | null }[]; hourlyRate: number | null }): CostTotals {
  const hours = roundQuantity(input.orders.reduce((sum, order) => sum + order.hours, 0));
  const material = roundOre(input.orders.reduce((sum, order) => sum + order.material, 0));
  const purchases = roundOre(input.orders.reduce((sum, order) => sum + order.purchases, 0));
  const withdrawals = roundOre(input.withdrawals.reduce((sum, row) => sum + (row.unitPrice === null ? 0 : row.quantity * row.unitPrice), 0));
  const time = input.hourlyRate === null ? null : roundOre(hours * input.hourlyRate);
  return { hours, time, material, withdrawals, purchases, total: roundOre((time ?? 0) + material + withdrawals + purchases), orders: input.orders.length };
}

/** "3 h 30 min" from seconds (time on a work order). */
export const hoursOf = (seconds: number) => roundQuantity(seconds / 3600);
