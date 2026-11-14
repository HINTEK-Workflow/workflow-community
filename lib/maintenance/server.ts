import { customerTitle } from "@/lib/kfid/customer-name";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, type Context } from "@/lib/kfid/server";
import {
  canEditItem, canReadItem, canWithdraw, itemFieldsSchema, itemInputSchema, itemTimeProblem, itemTotal, isLow, maintenanceAccess, moveProblem, PART_LIMIT, partDepth, partInputSchema, partPath, partStatusOf, rootOf,
  subtreeIds, type ItemFields, type PartListItem, type ItemSource, type ItemStatus, type MaintenanceCaller,
} from "./model";
import { maintenanceDowntimeMinutes } from "@/lib/workflow/maintenance";
import { jobOnPartWhere, NO_JOB_ON_MACHINE } from "@/lib/kfid/job-access";
import { placePath } from "./place-model";
import { signalLabel } from "@/lib/machine/signals";

/**
 * Underhåll (2026-10-30) on the server: the machine tree and the maintenance items. The store is ./store-server.ts,
 * the cost and downtime per machine ./cost-server.ts. Every query is bound to the caller's company (and the database checks
 * it again: composite keys and same-company triggers, migration 20261031090000_maintenance_module). The route
 * (app/api/maintenance) checks the session, Cloud write access and Origin; this file checks the rights.
 */

export type Db = Prisma.TransactionClient | typeof prisma;
export const decimal = (value: Prisma.Decimal | null | undefined) => value === null || value === undefined ? null : Number(value.toString());

export const callerOf = (ctx: Context): MaintenanceCaller => ({ organizationId: ctx.organizationId, userId: ctx.user.id, admin: ctx.admin, permissions: ctx.workflowPermissions, storageMode: ctx.organization.storageMode });

/** The module itself (menu item Underhåll): Cloud and the right. A Local company never gets here (the menu hides it). */
export function requireMaintenance(caller: MaintenanceCaller, need: "read" | "edit") {
  const access = maintenanceAccess(caller);
  if (!access.cloud) throw new ApiError(409, "Underhåll finns bara med serverlagring.");
  if (!access[need]) throw new ApiError(403, need === "read" ? "Du saknar behörighet att se Underhåll." : "Du saknar behörighet att ändra i Underhåll.");
  return access;
}

export async function audit(db: Db, caller: MaintenanceCaller, action: string, detail: string) {
  await db.administrationEvent.create({ data: { actorId: caller.userId, organizationId: caller.organizationId, action, detail: detail.slice(0, 500) } });
}

const NOT_FOUND = "Delen hittades inte.";
const STALE = "Delen har ändrats av någon annan. Läs in den igen.";

// ---------- the tree ----------

export type { PartListItem } from "./model";

/** All parts of the company (bounded), light enough for the tree; the part page reads the rest. */
export async function listParts(caller: MaintenanceCaller): Promise<{ parts: PartListItem[]; truncated: boolean }> {
  requireMaintenance(caller, "read");
  return partsOf(prisma, caller.organizationId);
}

/**
 * Open fault reports per part (the worst status upwards, 2026-10-31): a corrective item still open with Felanmäld set, and an
 * operator's report waiting for approval (it has no item yet). A closed item no longer counts.
 */
export async function reportedPerPart(db: Db, organizationId: string): Promise<Map<string, number>> {
  const [items, waiting] = await Promise.all([
    db.maintenanceItem.groupBy({ by: ["partId"], where: { organizationId, status: "OPEN", type: "CORRECTIVE", reportedAt: { not: null } }, _count: { _all: true } }),
    db.operatorFaultReport.groupBy({ by: ["machineNodeId"], where: { organizationId, status: "pending" }, _count: { _all: true } }),
  ]);
  const out = new Map<string, number>();
  for (const row of items) out.set(row.partId, row._count._all);
  for (const row of waiting) out.set(row.machineNodeId, (out.get(row.machineNodeId) ?? 0) + row._count._all);
  return out;
}

export async function partsOf(db: Db, organizationId: string) {
  const [rows, reported] = await Promise.all([db.machinePart.findMany({
    where: { organizationId }, orderBy: [{ position: "asc" }, { name: "asc" }], take: PART_LIMIT + 1,
    select: { id: true, parentId: true, placeId: true, customerId: true, name: true, partType: true, marking: true, status: true, isActive: true, customer: { select: { name: true, company: true } },
      images: { where: { isMain: true }, select: { id: true }, take: 1 }, _count: { select: { maintenanceItems: { where: { status: "OPEN" } } } } },
  }), reportedPerPart(db, organizationId)]);
  const parts = rows.slice(0, PART_LIMIT).map((row): PartListItem => ({
    id: row.id, parentId: row.parentId, placeId: row.placeId, customerId: row.customerId, ownerName: customerTitle(row.customer), name: row.name, partType: row.partType,
    marking: row.marking, status: partStatusOf(row.status), isActive: row.isActive, mainImageId: row.images[0]?.id ?? null, openItems: row._count.maintenanceItems, reported: reported.get(row.id) ?? 0,
  }));
  return { parts, truncated: rows.length > PART_LIMIT };
}

/** The customers a tree can belong to (Eget företag is "no customer"); only for someone who may change the tree. */
export async function ownerChoices(caller: MaintenanceCaller) {
  if (!maintenanceAccess(caller).edit) return [];
  const rows = await prisma.customer.findMany({ where: { organizationId: caller.organizationId, deletedAt: null, ownCompany: false }, orderBy: [{ company: "asc" }, { name: "asc" }], take: 500, select: { id: true, name: true, company: true } });
  return rows.map((row) => ({ id: row.id, name: row.company || row.name }));
}

async function readPart(db: Db, organizationId: string, id: string) {
  const row = await db.machinePart.findFirst({ where: { id, organizationId } });
  if (!row) throw new ApiError(404, NOT_FOUND);
  return row;
}

async function checkPlacement(db: Db, caller: MaintenanceCaller, partId: string | null, input: { parentId: string | null; customerId: string | null; placeId?: string | null }) {
  const all = await db.machinePart.findMany({ where: { organizationId: caller.organizationId }, select: { id: true, parentId: true, name: true }, take: PART_LIMIT + 1 });
  if (!partId && all.length >= PART_LIMIT) throw new ApiError(422, `Högst ${PART_LIMIT} delar per företag.`);
  const problem = moveProblem(all, partId, input.parentId);
  if (problem) throw new ApiError(422, problem);
  if (input.customerId) {
    if (input.parentId) throw new ApiError(422, "Bara en maskin kan ha en kund som ägare.");
    const customer = await db.customer.findFirst({ where: { id: input.customerId, organizationId: caller.organizationId, deletedAt: null }, select: { id: true } });
    if (!customer) throw new ApiError(404, "Kunden hittades inte.");
  }
  if (input.placeId) {
    if (input.parentId) throw new ApiError(422, "Bara en maskin står på en plats. Delarna följer sin maskin.");
    const place = await db.maintenancePlace.findFirst({ where: { id: input.placeId, organizationId: caller.organizationId }, select: { id: true } });
    if (!place) throw new ApiError(404, "Platsen hittades inte.");
  }
}

export async function createPart(caller: MaintenanceCaller, raw: unknown) {
  requireMaintenance(caller, "edit");
  const input = partInputSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    await checkPlacement(tx, caller, null, input);
    const row = await tx.machinePart.create({
      data: { organizationId: caller.organizationId, parentId: input.parentId, placeId: input.parentId ? null : input.placeId ?? null, customerId: input.parentId ? null : input.customerId, name: input.name, partType: input.partType, marking: input.marking,
        status: input.status, notes: input.notes, runHours: input.runHours ?? null, runHoursAt: input.runHours === null || input.runHours === undefined ? null : new Date(), runHoursOrigin: input.runHours === null || input.runHours === undefined ? null : "person", isActive: input.isActive, createdById: caller.userId, updatedById: caller.userId },
      select: { id: true, version: true },
    });
    if (!input.parentId) await audit(tx, caller, "maintenance_tree_created", `Underhåll: ny maskin ${input.name}.`);
    return row;
  });
}

export async function updatePart(caller: MaintenanceCaller, id: string, version: number, raw: unknown) {
  requireMaintenance(caller, "edit");
  const input = partInputSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const current = await readPart(tx, caller.organizationId, id);
    // A save that names no place keeps the one it has; a part moved in under another leaves its place, it follows its machine.
    const placeId = input.parentId ? null : input.placeId === undefined ? current.placeId : input.placeId;
    const moved = current.parentId !== input.parentId || current.placeId !== placeId;
    if (moved || current.customerId !== input.customerId) await checkPlacement(tx, caller, id, { ...input, placeId });
    // Left out: unchanged. A person's value is the part's from then on; a machine value that waited has had its answer.
    const runHours = input.runHours === undefined ? current.runHours : input.runHours;
    const runHoursChanged = current.runHours !== runHours;
    const runHoursAnswered = runHoursChanged || runHours === current.runHoursHeld;
    const updated = await tx.machinePart.updateMany({
      where: { id, organizationId: caller.organizationId, version },
      data: { parentId: input.parentId, placeId, customerId: input.parentId ? null : input.customerId, name: input.name, partType: input.partType, marking: input.marking, status: input.status, notes: input.notes,
        runHours, ...(runHoursChanged ? { runHoursAt: runHours === null ? null : new Date(), runHoursOrigin: runHours === null ? null : "person" } : {}), ...(runHoursAnswered ? { runHoursHeld: null, runHoursHeldAt: null, runHoursHeldReason: null } : {}), isActive: input.isActive, updatedById: caller.userId, version: { increment: 1 } },
    });
    if (!updated.count) throw new ApiError(409, STALE);
    if (current.isActive !== input.isActive) await audit(tx, caller, "maintenance_part_paused", `Underhåll: ${input.name} ${input.isActive ? "aktiv igen" : "pausad"}.`);
    if (moved) await audit(tx, caller, "maintenance_part_moved", `Underhåll: flyttade ${input.name}.`);
    // Hours are never lowered in silence, also not by a person. A new counter: each plan on run hours keeps the hours it has left.
    if (current.runHours !== null && runHours !== null && runHours < current.runHours) {
      await tx.maintenancePlan.updateMany({ where: { organizationId: caller.organizationId, partId: id, unit: "RUN_HOURS", nextRunHours: { not: null } }, data: { nextRunHours: { decrement: current.runHours - runHours } } });
      await audit(tx, caller, "maintenance_run_hours_lowered", `Underhåll: ${input.name}: drifttimmarna sänktes från ${current.runHours} till ${runHours}.`);
    }
    return { id, version: version + 1 };
  });
}

/**
 * A part is removed only when nothing hangs on it: nothing under it, no maintenance items, no store log rows, no work orders.
 * Otherwise it is paused (isActive false), so its history stays. Its pictures go with it.
 */
export async function deletePart(caller: MaintenanceCaller, id: string): Promise<{ removedFiles: string[] }> {
  requireMaintenance(caller, "edit");
  return prisma.$transaction(async (tx) => {
    const part = await readPart(tx, caller.organizationId, id);
    const refusal = await partRemovalRefusal(tx, caller.organizationId, id);
    if (refusal) throw new ApiError(409, refusal);
    return removePartRow(tx, caller, part);
  });
}

/** Ta bort's rule, in words, or null: what hangs on the part. Also lib/maintenance/remove-unplaced.ts goes by it. */
export async function partRemovalRefusal(db: Db, organizationId: string, id: string): Promise<string | null> {
  if (await db.machinePart.count({ where: { organizationId, parentId: id } })) return "Ta bort eller flytta delarna under först.";
  return partHistoryRefusal(db, organizationId, id);
}

export async function partHistoryRefusal(db: Db, organizationId: string, id: string): Promise<string | null> {
  const [items, moves, orders] = await Promise.all([
    db.maintenanceItem.count({ where: { organizationId, partId: id } }),
    db.storeTransaction.count({ where: { organizationId, machinePartId: id } }),
    db.workflowTask.count({ where: { organizationId, machinePartId: id } }),
  ]);
  return items || moves || orders ? "Delen har historik (poster, uttag eller arbetsordrar). Pausa den i stället." : null;
}

/** The removal itself, after the rule: the row (its pictures' rows follow it), the company's history line, and the files to remove afterwards. */
export async function removePartRow(tx: Db, caller: MaintenanceCaller, part: { id: string; name: string }): Promise<{ removedFiles: string[] }> {
  const files = await tx.machinePartImage.findMany({ where: { organizationId: caller.organizationId, partId: part.id }, select: { storagePath: true } });
  await tx.machinePart.deleteMany({ where: { id: part.id, organizationId: caller.organizationId } });
  await audit(tx, caller, "maintenance_part_removed", `Underhåll: tog bort ${part.name}.`);
  return { removedFiles: files.map((file) => file.storagePath) };
}

// ---------- the part page ----------

export type SpareView = {
  linkId: string; itemId: string; name: string; unit: string; ownNumber: number | null; articleNo: string; supplierName: string; quantity: number; total: number; low: boolean; minQuantity: number | null;
  balances: { locationId: string; locationName: string; quantity: number }[];
};
export type ItemListRow = {
  id: string; partId: string; partName: string; status: ItemStatus; source: ItemSource; type: string; priority: string; fault: string; reportedAt: string | null; stoppedAt: string | null; restoredAt: string | null;
  downtimeMinutes: number | null; workOrder: { id: string; title: string; status: string } | null; createdAt: string;
};

const itemListSelect = {
  id: true, partId: true, status: true, source: true, type: true, priority: true, fault: true, reportedAt: true, stoppedAt: true, restoredAt: true, createdAt: true,
  part: { select: { name: true } }, workOrder: { select: { id: true, title: true, status: true } },
} satisfies Prisma.MaintenanceItemSelect;
type ItemListPayload = Prisma.MaintenanceItemGetPayload<{ select: typeof itemListSelect }>;
const iso = (value: Date | null) => value?.toISOString() ?? null;
export function itemListRow(row: ItemListPayload): ItemListRow {
  const times = { stoppedAt: iso(row.stoppedAt), restoredAt: iso(row.restoredAt) };
  return {
    id: row.id, partId: row.partId, partName: row.part.name, status: row.status as ItemStatus, source: row.source as ItemSource, type: row.type, priority: row.priority, fault: row.fault,
    reportedAt: iso(row.reportedAt), ...times, downtimeMinutes: maintenanceDowntimeMinutes(times), workOrder: row.workOrder, createdAt: row.createdAt.toISOString(),
  };
}

export async function sparesOf(db: Db, organizationId: string, partId: string): Promise<SpareView[]> {
  const links = await db.machinePartArticle.findMany({
    where: { organizationId, partId }, orderBy: { createdAt: "asc" }, take: 100,
    select: { id: true, quantity: true, item: { select: { id: true, name: true, unit: true, ownNumber: true, articleNo: true, supplierName: true, minQuantity: true, balances: { select: { locationId: true, quantity: true, location: { select: { name: true, isActive: true, position: true } } } } } } },
  });
  return links.map((link) => {
    const balances = link.item.balances.filter((row) => row.location.isActive).sort((a, b) => a.location.position - b.location.position || a.location.name.localeCompare(b.location.name, "sv"))
      .map((row) => ({ locationId: row.locationId, locationName: row.location.name, quantity: decimal(row.quantity) ?? 0 }));
    const total = itemTotal(balances);
    const min = decimal(link.item.minQuantity);
    return { linkId: link.id, itemId: link.item.id, name: link.item.name, unit: link.item.unit, ownNumber: link.item.ownNumber, articleNo: link.item.articleNo, supplierName: link.item.supplierName, quantity: decimal(link.quantity) ?? 1, total, low: isLow(total, min), minQuantity: min, balances };
  });
}

export async function getPart(caller: MaintenanceCaller, id: string) {
  const access = requireMaintenance(caller, "read");
  const part = await prisma.machinePart.findFirst({ where: { id, organizationId: caller.organizationId }, include: { customer: { select: { name: true, company: true } } } });
  if (!part) throw new ApiError(404, NOT_FOUND);
  const [all, places] = await Promise.all([
    prisma.machinePart.findMany({ where: { organizationId: caller.organizationId }, select: { id: true, parentId: true, placeId: true, name: true }, take: PART_LIMIT }),
    prisma.maintenancePlace.findMany({ where: { organizationId: caller.organizationId }, select: { id: true, parentId: true, name: true, level: true }, take: 2000 }),
  ]);
  const below = subtreeIds(all, id);
  const machine = all.find((row) => row.id === rootOf(all, id));
  const [images, spares, items, signals, sources, workOrders, feed] = await Promise.all([
    prisma.machinePartImage.findMany({ where: { organizationId: caller.organizationId, partId: id }, orderBy: [{ isMain: "desc" }, { createdAt: "asc" }], select: { id: true, filename: true, isMain: true } }),
    sparesOf(prisma, caller.organizationId, id),
    prisma.maintenanceItem.findMany({ where: { organizationId: caller.organizationId, partId: { in: below } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 30, select: itemListSelect }),
    prisma.machineSignal.findMany({ where: { organizationId: caller.organizationId, machinePartId: id }, orderBy: { key: "asc" }, take: 50, select: { id: true, key: true, name: true, source: { select: { name: true } } } }),
    prisma.machineSource.findMany({ where: { organizationId: caller.organizationId, machinePartId: id }, orderBy: { name: "asc" }, take: 20, select: { id: true, name: true } }),
    openWorkOrdersOf(prisma, caller.organizationId, below),
    prisma.machineSignal.findFirst({ where: { organizationId: caller.organizationId, machinePartId: id, runHoursFeed: true, status: "active" }, select: { key: true, name: true, source: { select: { name: true } } } }),
  ]);
  return {
    part: {
      id: part.id, parentId: part.parentId, placeId: part.placeId, customerId: part.customerId, ownerName: customerTitle(part.customer), name: part.name, partType: part.partType, marking: part.marking,
      status: partStatusOf(part.status), notes: part.notes, runHours: part.runHours, runHoursAt: iso(part.runHoursAt), runHoursOrigin: part.runHoursOrigin === "machine" ? "machine" as const : "person" as const,
      /** The signal that feeds the hours, and a machine value it does not use (only while the signal still feeds them). */
      runHoursFeed: feed ? { signalName: signalLabel(feed), sourceName: feed.source.name } : null,
      runHoursHeld: feed && part.runHoursHeld !== null ? { value: part.runHoursHeld, reason: part.runHoursHeldReason ?? "lower", at: iso(part.runHoursHeldAt) } : null,
      isActive: part.isActive, version: part.version, path: partPath(all, id),
      /** Maskin 0, Komponent 1, Del 2 and deeper. */
      depth: partDepth(all, id),
      /** The place of the part's machine, from the top ([] = Utan plats). */
      placePath: placePath(places, machine?.placeId),
      machinePlaceId: machine?.placeId ?? null,
    },
    images: images.map((image) => ({ id: image.id, name: image.filename, isMain: image.isMain })),
    spares, items: items.map(itemListRow),
    signals: signals.map((signal) => ({ id: signal.id, name: signal.name || signal.key, sourceName: signal.source.name })),
    sources, workOrders,
    canEdit: access.edit, canWithdraw: canWithdraw(access), canOrder: access.edit, pricesVisible: access.prices,
  };
}

/**
 * Maskinen via jobbet (beslut 10, 2026-11-01): for someone with an open job on exactly this part, or the module's read
 * right. The part's name and place in the tree, its history and its spare parts; no notes, images, balances per location, costs,
 * signals or links to other work orders. lib/kfid/job-access.ts says what a job is.
 */
export async function jobPartCard(caller: MaintenanceCaller, id: string) {
  const access = maintenanceAccess(caller);
  if (!access.cloud) throw new ApiError(403, NO_JOB_ON_MACHINE);
  const job = access.read ? null : await prisma.workflowTask.findFirst({ where: jobOnPartWhere(caller.organizationId, caller.userId, id), select: { id: true } });
  if (!access.read && !job) throw new ApiError(403, NO_JOB_ON_MACHINE);
  const part = await prisma.machinePart.findFirst({ where: { id, organizationId: caller.organizationId }, select: { id: true, name: true, partType: true, marking: true, status: true, customer: { select: { name: true, company: true } } } });
  if (!part) throw new ApiError(access.read ? 404 : 403, access.read ? NOT_FOUND : NO_JOB_ON_MACHINE);
  const [all, places, items, spares] = await Promise.all([
    prisma.machinePart.findMany({ where: { organizationId: caller.organizationId }, select: { id: true, parentId: true, placeId: true, name: true }, take: PART_LIMIT }),
    prisma.maintenancePlace.findMany({ where: { organizationId: caller.organizationId }, select: { id: true, parentId: true, name: true, level: true }, take: 2000 }),
    prisma.maintenanceItem.findMany({ where: { organizationId: caller.organizationId, partId: id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20, select: { id: true, status: true, type: true, fault: true, createdAt: true, restoredAt: true } }),
    sparesOf(prisma, caller.organizationId, id),
  ]);
  return {
    part: { id: part.id, name: part.name, partType: part.partType, marking: part.marking, status: partStatusOf(part.status), ownerName: customerTitle(part.customer), path: [...placePath(places, all.find((row) => row.id === rootOf(all, id))?.placeId), ...partPath(all, id)] },
    history: items.map((item) => ({ id: item.id, status: item.status as ItemStatus, type: item.type, fault: item.fault, createdAt: item.createdAt.toISOString(), restoredAt: iso(item.restoredAt) })),
    spares: spares.map((spare) => ({ itemId: spare.itemId, name: spare.name, unit: spare.unit, ownNumber: spare.ownNumber, articleNo: spare.articleNo, quantity: spare.quantity, total: spare.total })),
  };
}
export type JobPartCard = Awaited<ReturnType<typeof jobPartCard>>;

/** Open work orders on the part (and below): its own, or holding an item on it – where a spare part can be put. */
export async function openWorkOrdersOf(db: Db, organizationId: string, partIds: string[]) {
  const rows = await db.workflowTask.findMany({
    where: { organizationId, kind: "WORK_ORDER", status: { notIn: ["COMPLETED", "CANCELLED"] }, OR: [{ machinePartId: { in: partIds } }, { maintenanceItems: { some: { partId: { in: partIds } } } }] },
    orderBy: { updatedAt: "desc" }, take: 20, select: { id: true, title: true, status: true },
  });
  return rows;
}

// ---------- images (bytes in lib/kfid/storage.ts, the route app/api/maintenance/images) ----------

export async function requireImageUpload(caller: MaintenanceCaller, partId: string) {
  requireMaintenance(caller, "edit");
  const part = await readPart(prisma, caller.organizationId, partId);
  if (await prisma.machinePartImage.count({ where: { organizationId: caller.organizationId, partId } }) >= 30) throw new ApiError(400, "Högst 30 bilder per del.");
  return part;
}
export async function readableImage(caller: MaintenanceCaller, imageId: string) {
  requireMaintenance(caller, "read");
  const image = await prisma.machinePartImage.findFirst({ where: { id: imageId, organizationId: caller.organizationId } });
  if (!image) throw new ApiError(404, "Bilden hittades inte.");
  return image;
}
/** A new picture becomes the main picture when the part has none. */
export async function addImage(caller: MaintenanceCaller, partId: string, file: { filename: string; storagePath: string; mimeType: string; size: number }) {
  return prisma.$transaction(async (tx) => {
    const hasMain = await tx.machinePartImage.count({ where: { organizationId: caller.organizationId, partId, isMain: true } });
    return tx.machinePartImage.create({ data: { organizationId: caller.organizationId, partId, isMain: !hasMain, ...file, createdById: caller.userId }, select: { id: true, isMain: true } });
  });
}
export async function setMainImage(caller: MaintenanceCaller, imageId: string) {
  requireMaintenance(caller, "edit");
  const image = await readableImage(caller, imageId);
  await prisma.$transaction(async (tx) => {
    await tx.machinePartImage.updateMany({ where: { organizationId: caller.organizationId, partId: image.partId, isMain: true }, data: { isMain: false } });
    await tx.machinePartImage.updateMany({ where: { id: image.id, organizationId: caller.organizationId }, data: { isMain: true } });
  });
  return { ok: true };
}
/** Removing the main picture makes the oldest remaining one the main picture. Returns the file to remove. */
export async function removeImage(caller: MaintenanceCaller, imageId: string) {
  requireMaintenance(caller, "edit");
  const image = await readableImage(caller, imageId);
  await prisma.$transaction(async (tx) => {
    await tx.machinePartImage.deleteMany({ where: { id: image.id, organizationId: caller.organizationId } });
    if (image.isMain) {
      const next = await tx.machinePartImage.findFirst({ where: { organizationId: caller.organizationId, partId: image.partId }, orderBy: { createdAt: "asc" }, select: { id: true } });
      if (next) await tx.machinePartImage.updateMany({ where: { id: next.id, organizationId: caller.organizationId }, data: { isMain: true } });
    }
  });
  return image.storagePath;
}

// ---------- maintenance items ----------

const itemSelect = { ...itemListSelect, criticality: true, marking: true, cause: true, causeNote: true, workOrderId: true, version: true, reportedById: true, machineAlarmOrderId: true } satisfies Prisma.MaintenanceItemSelect;
type ItemPayload = Prisma.MaintenanceItemGetPayload<{ select: typeof itemSelect }>;

export type ItemView = ItemListRow & ItemFields & {
  version: number; workOrderId: string | null; partPath: string[]; canEdit: boolean; canWithdraw: boolean; pricesVisible: boolean;
  withdrawals: { id: string; itemName: string; unit: string; quantity: number; locationName: string; at: string; byName: string; kind: string; returned: boolean }[];
  spares: SpareView[];
  /** Open work orders on the part where the item can be held (the holder integrates the final choice). */
  workOrders: { id: string; title: string; status: string }[];
};

async function readItem(db: Db, caller: MaintenanceCaller, id: string) {
  const row = await db.maintenanceItem.findFirst({ where: { id, organizationId: caller.organizationId }, select: itemSelect });
  const access = maintenanceAccess(caller);
  if (!row || !access.cloud || !canReadItem(access, row)) throw new ApiError(404, "Underhållsposten hittades inte.");
  return { row, access };
}

async function names(ids: string[]) {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (!wanted.length) return new Map<string, string>();
  const users = await prisma.user.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true, email: true } });
  return new Map(users.map((user) => [user.id, user.name || user.email || ""]));
}

async function itemView(caller: MaintenanceCaller, row: ItemPayload, access: ReturnType<typeof maintenanceAccess>): Promise<ItemView> {
  const [all, moves, spares, workOrders] = await Promise.all([
    prisma.machinePart.findMany({ where: { organizationId: caller.organizationId }, select: { id: true, parentId: true, name: true }, take: PART_LIMIT }),
    prisma.storeTransaction.findMany({ where: { organizationId: caller.organizationId, maintenanceItemId: row.id }, orderBy: { createdAt: "asc" }, take: 100,
      select: { id: true, kind: true, change: true, note: true, createdAt: true, userId: true, item: { select: { name: true, unit: true } }, location: { select: { name: true } } } }),
    sparesOf(prisma, caller.organizationId, row.partId),
    openWorkOrdersOf(prisma, caller.organizationId, [row.partId]),
  ]);
  const who = await names(moves.map((move) => move.userId));
  const returned = new Set(moves.filter((move) => move.kind === "RETURN").map((move) => move.note.replace(/^ret:/, "")));
  return {
    ...itemListRow(row), criticality: row.criticality as ItemFields["criticality"], marking: row.marking, cause: row.cause as ItemFields["cause"], causeNote: row.causeNote,
    type: row.type as ItemFields["type"], priority: row.priority as ItemFields["priority"],
    version: row.version, workOrderId: row.workOrderId, partPath: [...partPath(all, row.partId), row.part.name],
    canEdit: canEditItem(access, row), canWithdraw: Boolean(row.workOrderId) && canWithdraw(access) && row.workOrder?.status !== "COMPLETED" && row.workOrder?.status !== "CANCELLED", pricesVisible: access.prices,
    withdrawals: moves.filter((move) => move.kind === "WITHDRAWAL").map((move) => ({ id: move.id, itemName: move.item.name, unit: move.item.unit, quantity: -(decimal(move.change) ?? 0), locationName: move.location.name, at: move.createdAt.toISOString(), byName: who.get(move.userId) ?? "", kind: move.kind, returned: returned.has(move.id) })),
    spares, workOrders: row.workOrder && !workOrders.some((order) => order.id === row.workOrder!.id) ? [row.workOrder, ...workOrders] : workOrders,
  };
}

export async function getItem(caller: MaintenanceCaller, id: string) {
  const { row, access } = await readItem(prisma, caller, id);
  return itemView(caller, row, access);
}

/** The items a work order holds (for its task list): with the work order's own read right. */
export async function itemsOfWorkOrder(caller: MaintenanceCaller, workOrderId: string) {
  const access = maintenanceAccess(caller);
  if (!access.cloud || !(access.read || access.workOrderRead)) throw new ApiError(403, "Du saknar behörighet att se arbetsordern.");
  const order = await prisma.workflowTask.findFirst({ where: { id: workOrderId, organizationId: caller.organizationId, kind: "WORK_ORDER" }, select: { id: true, machinePartId: true } });
  if (!order) throw new ApiError(404, "Arbetsordern hittades inte.");
  const rows = await prisma.maintenanceItem.findMany({ where: { organizationId: caller.organizationId, workOrderId }, orderBy: { createdAt: "asc" }, take: 50, select: itemListSelect });
  return { items: rows.map(itemListRow), machinePartId: order.machinePartId, canCreate: access.edit || access.workOrderEdit };
}

async function checkItemLinks(db: Db, caller: MaintenanceCaller, input: { partId: string; workOrderId: string | null }) {
  const part = await db.machinePart.findFirst({ where: { id: input.partId, organizationId: caller.organizationId }, select: { id: true, name: true, isActive: true } });
  if (!part) throw new ApiError(404, NOT_FOUND);
  if (input.workOrderId) {
    const order = await db.workflowTask.findFirst({ where: { id: input.workOrderId, organizationId: caller.organizationId, kind: "WORK_ORDER" }, select: { id: true, status: true } });
    if (!order) throw new ApiError(404, "Arbetsordern hittades inte.");
  }
  return part;
}

const toDate = (value: string | null) => value ? new Date(value) : null;
const fieldData = (fields: ItemFields) => ({
  type: fields.type, priority: fields.priority, criticality: fields.criticality, marking: fields.marking, fault: fields.fault, cause: fields.cause, causeNote: fields.causeNote,
  reportedAt: toDate(fields.reportedAt), stoppedAt: toDate(fields.stoppedAt), restoredAt: toDate(fields.restoredAt),
});

/**
 * A new item: on a work order with the module's or the work order's edit right, without one (a draft) only with the module's.
 * `source` is MANUAL from the pages; the machine alarm and the operator's report use their own (createItemAs).
 */
export async function createItem(caller: MaintenanceCaller, raw: unknown) {
  const input = itemInputSchema.parse(raw);
  const access = maintenanceAccess(caller);
  if (!access.cloud || !canEditItem(access, input)) throw new ApiError(403, "Du saknar behörighet att skapa underhållsposter.");
  return createItemAs(prisma, caller, input, "MANUAL");
}

export async function createItemAs(db: Db, caller: Pick<MaintenanceCaller, "organizationId" | "userId">, input: ReturnType<typeof itemInputSchema.parse>, source: ItemSource, extra: { machineAlarmOrderId?: string | null; reportedById?: string | null } = {}) {
  const problem = itemTimeProblem(input);
  if (problem) throw new ApiError(422, problem);
  await checkItemLinks(db, caller as MaintenanceCaller, input);
  return db.maintenanceItem.create({
    data: { organizationId: caller.organizationId, partId: input.partId, workOrderId: input.workOrderId, ...fieldData(input), status: input.status, source, machineAlarmOrderId: extra.machineAlarmOrderId ?? null,
      reportedById: extra.reportedById ?? null, completedAt: input.status === "DONE" ? new Date() : null, createdById: caller.userId, updatedById: caller.userId },
    select: { id: true, version: true },
  });
}

/**
 * Avvikelse → arbetsorder (2026-10-30): when the protocol the deviation came from is on a machine part, the new work
 * order is on the same part and holds a maintenance item with the deviation's facts (avhjälpande, the fault, the priority,
 * Felanmäld now). Without a part nothing is made: the work order alone carries the deviation in its description. In the
 * transaction that creates the order; bound to the company.
 */
export async function deviationItem(db: Db, input: { organizationId: string; userId: string; workOrderId: string; sourceTaskId: string | null | undefined; facts: ItemFields }) {
  if (!input.sourceTaskId) return null;
  const source = await db.workflowTask.findFirst({ where: { id: input.sourceTaskId, organizationId: input.organizationId }, select: { machinePartId: true } });
  if (!source?.machinePartId) return null;
  await db.workflowTask.updateMany({ where: { id: input.workOrderId, organizationId: input.organizationId, machinePartId: null }, data: { machinePartId: source.machinePartId } });
  return createItemAs(db, input, itemInputSchema.parse({ ...input.facts, partId: source.machinePartId, workOrderId: input.workOrderId }), "MANUAL");
}

/** The item's fields, its status and which work order holds it; the part never changes (make a new item for another part). */
export async function updateItem(caller: MaintenanceCaller, id: string, version: number, raw: unknown) {
  const { row, access } = await readItem(prisma, caller, id);
  const input = itemFieldsSchema.extend({ status: itemInputSchema.shape.status, workOrderId: itemInputSchema.shape.workOrderId }).parse(raw);
  if (!canEditItem(access, row) || !canEditItem(access, input)) throw new ApiError(403, "Du saknar behörighet att ändra underhållsposten.");
  const problem = itemTimeProblem(input);
  if (problem) throw new ApiError(422, problem);
  if (input.workOrderId !== row.workOrderId) await checkItemLinks(prisma, caller, { partId: row.partId, workOrderId: input.workOrderId });
  const updated = await prisma.maintenanceItem.updateMany({
    where: { id, organizationId: caller.organizationId, version },
    data: { ...fieldData(input), status: input.status, workOrderId: input.workOrderId, completedAt: input.status === "DONE" ? (row.status === "DONE" ? undefined : new Date()) : null, updatedById: caller.userId, version: { increment: 1 } },
  });
  if (!updated.count) throw new ApiError(409, "Underhållsposten har ändrats av någon annan. Läs in den igen.");
  return { id, version: version + 1 };
}

/** Removed only without withdrawals (they would lose their reason); otherwise set it to Utgår. */
export async function deleteItem(caller: MaintenanceCaller, id: string) {
  const { row, access } = await readItem(prisma, caller, id);
  if (!canEditItem(access, row)) throw new ApiError(403, "Du saknar behörighet att ta bort underhållsposten.");
  if (row.source === "MACHINE_ALARM") throw new ApiError(409, "En post från ett maskinlarm tas inte bort. Sätt den till Utgår.");
  if (await prisma.storeTransaction.count({ where: { organizationId: caller.organizationId, maintenanceItemId: id } })) throw new ApiError(409, "Posten har uttag ur förrådet. Sätt den till Utgår i stället.");
  await prisma.$transaction(async (tx) => {
    await tx.maintenanceItem.deleteMany({ where: { id, organizationId: caller.organizationId } });
    await audit(tx, caller, "maintenance_item_removed", `Underhåll: tog bort en underhållspost på ${row.part.name}.`);
  });
  return { ok: true };
}

/**
 * Felanmälan (for the operator page, built by its own agent): a corrective item on one machine part, reported now by the
 * caller, as a draft without a work order (the holder makes or picks the work order). With `stopped` the machine is out of
 * service from now: the item's Ur drift is set and the part's status becomes Ur drift. Needs the module's read right –
 * an operator sees their machines and reports on them, nothing more.
 */
export async function reportFault(caller: MaintenanceCaller, raw: unknown) {
  requireMaintenance(caller, "read");
  const input = itemFieldsSchema.pick({ priority: true, fault: true }).extend({ partId: itemInputSchema.shape.partId, stopped: z.boolean().default(false) }).parse(raw);
  const now = new Date().toISOString();
  return prisma.$transaction(async (tx) => {
    const created = await createItemAs(tx, caller, itemInputSchema.parse({ partId: input.partId, workOrderId: null, type: "CORRECTIVE", priority: input.priority, fault: input.fault, reportedAt: now, stoppedAt: input.stopped ? now : null }), "OPERATOR", { reportedById: caller.userId });
    if (input.stopped) await tx.machinePart.updateMany({ where: { id: input.partId, organizationId: caller.organizationId }, data: { status: "OUT_OF_SERVICE", updatedById: caller.userId, version: { increment: 1 } } });
    return created;
  });
}
