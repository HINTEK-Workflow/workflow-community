import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/server";
import { hourlyRateOf } from "@/lib/overview/economy-model";
import { PLACE_ALL, PLACE_NONE } from "./place-model";
import { readPriceSettings } from "@/lib/quotes/server";
import { type MaterialRow } from "@/lib/workflow/expenses";
import { roundOre, workOrderTotals } from "@/lib/workflow/material-prices";
import { withoutStoreRows } from "@/lib/workflow/store-rows";
import { attributeWorkOrders, costTotals, downtimeSummary, hoursOf, PART_LIMIT, subtreeIds, type MaintenanceAccess, type OrderCost } from "./model";
import { partsAtPlace } from "./place-server";
import { decimal, requireMaintenance } from "./server";
import type { MaintenanceCaller } from "./model";

/**
 * Kostnad och stillestånd per maskin (2026-10-30): computed when read, never stored, for the part and everything
 * under it. A work order counts for one part only (lib/maintenance/model.ts attributeWorkOrders). Amounts only for someone
 * who may see prices; the hours and the downtime for everyone who reads the module.
 */
const ORDER_LIMIT = 500;
const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});

export async function partCost(caller: MaintenanceCaller, partId: string, now = new Date()) {
  const access = requireMaintenance(caller, "read");
  const all = await prisma.machinePart.findMany({ where: { organizationId: caller.organizationId }, select: { id: true, parentId: true, name: true }, take: PART_LIMIT });
  if (!all.some((part) => part.id === partId)) throw new ApiError(404, "Delen hittades inte.");
  return costOf(caller, access, all, subtreeIds(all, partId), now);
}

/**
 * Kostnaden summeras uppåt (2026-10-31): del → maskin → plats. The place's sum is the same sum as for a machine, over every
 * part on every machine on the place and the places under it, so a work order still counts once. PLACE_ALL gives the whole company's
 * machines and PLACE_NONE those on no place.
 */
export async function placeCost(caller: MaintenanceCaller, choice: string, now = new Date()) {
  const access = requireMaintenance(caller, "read");
  const { parts, roots } = await partsAtPlace(caller, choice === PLACE_ALL ? { placeId: null } : choice === PLACE_NONE ? { placeId: null, withoutPlace: true } : { placeId: choice });
  return costOf(caller, access, parts, roots.flatMap((root) => subtreeIds(parts, root)), now);
}

async function costOf(caller: MaintenanceCaller, access: MaintenanceAccess, all: readonly { id: string; parentId: string | null; name: string }[], ids: string[], now: Date) {
  const organizationId = caller.organizationId;
  const names = new Map(all.map((part) => [part.id, part.name]));

  const orders = await prisma.workflowTask.findMany({
    where: { organizationId, kind: "WORK_ORDER", OR: [{ machinePartId: { in: ids } }, { maintenanceItems: { some: { partId: { in: ids } } } }] },
    orderBy: { createdAt: "desc" }, take: ORDER_LIMIT,
    select: { id: true, title: true, status: true, machinePartId: true, data: true, maintenanceItems: { orderBy: { createdAt: "asc" }, select: { partId: true, stoppedAt: true, restoredAt: true } } },
  });
  const owner = attributeWorkOrders(orders.map((order) => ({ id: order.id, machinePartId: order.machinePartId, itemParts: order.maintenanceItems.map((item) => item.partId) })));
  const mine = orders.filter((order) => ids.includes(owner.get(order.id) ?? ""));
  const orderIds = mine.map((order) => order.id);

  const [time, purchaseLines, moves, items, settings] = await Promise.all([
    orderIds.length ? prisma.workflowTimeEntry.groupBy({ by: ["taskId"], where: { taskId: { in: orderIds } }, _sum: { durationSec: true } }) : Promise.resolve([]),
    orderIds.length ? prisma.purchaseLine.findMany({
      where: { organizationId, purchase: { workOrderId: { in: orderIds }, status: { not: "CANCELLED" } }, OR: [{ sourceKind: null }, { sourceKind: { not: "work_order" } }] },
      select: { quantity: true, unitPrice: true, purchase: { select: { workOrderId: true } } },
    }) : Promise.resolve([]),
    prisma.storeTransaction.findMany({ where: { organizationId, machinePartId: { in: ids }, kind: { in: ["WITHDRAWAL", "RETURN"] } }, select: { change: true, unitPrice: true } }),
    prisma.maintenanceItem.findMany({ where: { organizationId, partId: { in: ids }, status: { not: "CANCELLED" } }, select: { stoppedAt: true, restoredAt: true } }),
    access.prices ? readPriceSettings(organizationId) : Promise.resolve(null),
  ]);
  const seconds = new Map(time.map((row) => [row.taskId ?? "", row._sum.durationSec ?? 0]));
  const bought = new Map<string, number>();
  for (const line of purchaseLines) {
    const quantity = decimal(line.quantity) ?? 0;
    const price = decimal(line.unitPrice);
    if (price === null || !line.purchase.workOrderId) continue;
    bought.set(line.purchase.workOrderId, roundOre((bought.get(line.purchase.workOrderId) ?? 0) + quantity * price));
  }
  const iso = (value: Date | null) => value?.toISOString() ?? null;
  const rows: OrderCost[] = mine.map((order) => {
    const materials = (record(record(order.data).details).materials ?? []) as MaterialRow[];
    // The store's rows on the order (Uttag ur förrådet) are counted once, as the store's withdrawals below.
    const totals = Array.isArray(materials) ? workOrderTotals(withoutStoreRows(materials.filter((row) => row && typeof row === "object" && typeof row.name === "string"))) : null;
    const downtime = downtimeSummary(order.maintenanceItems.filter((item) => ids.includes(item.partId)).map((item) => ({ stoppedAt: iso(item.stoppedAt), restoredAt: iso(item.restoredAt) })), now);
    const partOf = owner.get(order.id)!;
    return {
      orderId: order.id, partId: partOf, title: order.title, label: names.get(partOf) ?? "", status: order.status, hours: hoursOf(seconds.get(order.id) ?? 0),
      material: totals ? roundOre(totals.material.purchase + totals.expenses.total) : 0, purchases: bought.get(order.id) ?? 0, downtimeMinutes: downtime.minutes,
    };
  });
  const hourlyRate = settings ? hourlyRateOf(settings.hourlyRate) : null;
  const totals = costTotals({ orders: rows, withdrawals: moves.map((move) => ({ quantity: -(decimal(move.change) ?? 0), unitPrice: decimal(move.unitPrice) })), hourlyRate });
  const times = items.map((item) => ({ stoppedAt: iso(item.stoppedAt), restoredAt: iso(item.restoredAt) }));
  const yearStart = new Date(`${new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric" }).format(now)}-01-01T00:00:00+01:00`);
  const prices = access.prices;
  const hide = <T extends object>(row: T, keys: (keyof T)[]) => prices ? row : Object.fromEntries(Object.entries(row).map(([key, value]) => [key, keys.includes(key as keyof T) ? null : value])) as { [K in keyof T]: T[K] | null };
  return {
    totals: hide(totals, ["time", "material", "withdrawals", "purchases", "total"]),
    orders: rows.slice(0, 50).map((row) => hide(row, ["material", "purchases"])),
    truncated: orders.length >= ORDER_LIMIT,
    downtime: { year: downtimeSummary(times, now, yearStart), all: downtimeSummary(times, now) },
    pricesVisible: prices, hourlyRateMissing: prices && hourlyRate === null,
  };
}

