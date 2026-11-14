import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/server";
import { articleHitById } from "@/lib/catalogue/server";
import { createPurchase, type PurchaseCaller } from "@/lib/purchases/server";
import {
  canWithdraw, countChange, isLow, itemTotal, maintenanceAccess, nextFreeNumber, nextSeriesStart, parseQuantity, partDepth, partPath, PART_LIMIT, pickLocation, quantityText, rootOf, roundQuantity, STORE_LOCATION_KINDS, STORE_LOCATION_LIMIT, storeFigures,
  storeLocationInputSchema, storeLocationNames, storeLocationProblem, storeOwnName, subtreeIds, suggestedOrderQuantity, withdrawal,
  type MaintenanceCaller, type StoreLocationKind, type StoreLocationRow,
} from "./model";
import { audit, decimal, requireMaintenance, type Db } from "./server";
import { readPriceSettings } from "@/lib/quotes/server";
import { rowSourceKey } from "@/lib/invoice-basis/model";
import { publishTaskChange } from "@/lib/workflow/live-bus";
import type { MaterialRow } from "@/lib/workflow/expenses";
import { rowsAfterReturn, storeReturnRow, storeWithdrawalRow, storeRowOf } from "@/lib/workflow/store-rows";

/**
 * Förrådet (2026-10-30): store locations (a store room or a service van), articles from the article register with a
 * balance per location, spare parts linked to machine parts, withdrawals straight onto a work order, receipts, inventory
 * count and a log. A balance only changes together with its log row, in one transaction, and never goes below zero (a
 * conditional update and a CHECK in the database). Company-bound throughout.
 *
 * Sedan 2026-10-31 är förvaringen ett träd (Förråd › Skåp › Hylla › Hyllplats, så djupt man vill) och varje förråd har en egen
 * nummerserie: en ny artikel får nästa lediga nummer ur serien. Grossistens nummer och leverantör (articleNo, supplierName) är
 * raden "Beställs som" och blandas aldrig med det egna numret. Äldre rader får serie och nummer när någon använder dem.
 */

const id = z.string().trim().min(1).max(100);
const quantityInput = z.union([z.string().trim().max(20), z.number()]);
const NOT_FOUND = "Artikeln hittades inte i förrådet.";
const LOCATION_NOT_FOUND = "Förrådsplatsen hittades inte.";

export type StoreLocationView = {
  id: string; parentId: string | null;
  /** The whole way from the top, for logs and choices. */
  name: string;
  /** The place's own name. */
  label: string;
  kind: StoreLocationKind; isActive: boolean;
  /** Only at the top: where its series starts and the next free number (null until the store has a series). */
  seriesStart: number | null; nextNumber: number | null;
};
export type StoreItemView = {
  id: string; name: string; unit: string; ownNumber: number | null; homeStoreId: string | null; shelfText: string; articleNo: string; supplierName: string; fromRegister: boolean; unitPrice: number | null; minQuantity: number | null; total: number; low: boolean;
  balances: Record<string, number>; parts: number;
};

export async function getStore(caller: MaintenanceCaller, options: { q?: string; low?: boolean } = {}) {
  const access = requireMaintenance(caller, "read");
  const q = (options.q ?? "").trim().slice(0, 100);
  const number = /^\d{1,9}$/.test(q) ? Number(q) : null;
  const [locations, items, numbers] = await Promise.all([
    prisma.storeLocation.findMany({ where: { organizationId: caller.organizationId }, orderBy: [{ position: "asc" }, { name: "asc" }], take: STORE_LOCATION_LIMIT, select: { id: true, parentId: true, name: true, label: true, kind: true, isActive: true, seriesStart: true } }),
    prisma.storeItem.findMany({
      where: { organizationId: caller.organizationId, ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { articleNo: { contains: q, mode: "insensitive" } }, { supplierName: { contains: q, mode: "insensitive" } }, { shelfText: { contains: q, mode: "insensitive" } }, ...(number === null ? [] : [{ ownNumber: number }])] } : {}) },
      orderBy: { name: "asc" }, take: 500,
      select: { id: true, name: true, unit: true, ownNumber: true, homeStoreId: true, shelfText: true, articleNo: true, supplierName: true, articleRef: true, unitPrice: true, minQuantity: true, balances: { select: { locationId: true, quantity: true } }, _count: { select: { parts: true } } },
    }),
    usedNumbers(prisma, caller.organizationId),
  ]);
  const views = items.map((item): StoreItemView => {
    const balances = item.balances.map((row) => ({ locationId: row.locationId, quantity: decimal(row.quantity) ?? 0 }));
    const total = itemTotal(balances);
    const min = decimal(item.minQuantity);
    return { id: item.id, name: item.name, unit: item.unit, ownNumber: item.ownNumber, homeStoreId: item.homeStoreId, shelfText: item.shelfText, articleNo: item.articleNo, supplierName: item.supplierName, fromRegister: Boolean(item.articleRef),
      unitPrice: access.prices ? decimal(item.unitPrice) : null, minQuantity: min, total, low: isLow(total, min),
      balances: Object.fromEntries(balances.map((row) => [row.locationId, row.quantity])), parts: item._count.parts };
  });
  return {
    locations: locations.map((row): StoreLocationView => ({ ...row, label: storeOwnName(row), kind: (STORE_LOCATION_KINDS as readonly string[]).includes(row.kind) ? row.kind as StoreLocationKind : "STORE", seriesStart: row.parentId ? null : row.seriesStart, nextNumber: !row.parentId && row.seriesStart !== null ? nextFreeNumber(row.seriesStart, numbers) : null })),
    items: options.low ? views.filter((item) => item.low) : views,
    canEdit: access.edit, canOrder: access.edit,
  };
}

// ---------- locations ----------

const isUnique = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
const uniqueOn = (error: unknown, field: string) => isUnique(error) && JSON.stringify((error as Prisma.PrismaClientKnownRequestError).meta?.target ?? "").includes(field);
function locationConflict(error: unknown) {
  if (uniqueOn(error, "seriesStart")) return new ApiError(409, "Ett annat förråd har redan den nummerserien.");
  if (isUnique(error)) return new ApiError(409, "Det finns redan en förrådsplats med det namnet här.");
  return error;
}

const usedNumbers = async (db: Db, organizationId: string, from = 1) => (await db.storeItem.findMany({ where: { organizationId, ownNumber: { gte: from } }, select: { ownNumber: true }, orderBy: { ownNumber: "asc" }, take: 20_000 })).map((row) => row.ownNumber);

async function locationRows(db: Db, organizationId: string): Promise<(StoreLocationRow & { seriesStart: number | null; kind: string })[]> {
  return db.storeLocation.findMany({ where: { organizationId }, take: STORE_LOCATION_LIMIT, select: { id: true, parentId: true, name: true, label: true, seriesStart: true, kind: true } });
}

/** The full way of every row that changed (after a rename or a move): name is what logs, work orders and the unique index read. */
async function writeLocationNames(tx: Prisma.TransactionClient, organizationId: string) {
  const rows = await locationRows(tx, organizationId);
  const names = storeLocationNames(rows);
  for (const row of rows) {
    const name = names.get(row.id);
    if (name && name !== row.name) await tx.storeLocation.updateMany({ where: { id: row.id, organizationId }, data: { name, label: storeOwnName(row) } });
  }
}

export async function createLocation(caller: MaintenanceCaller, raw: unknown) {
  requireMaintenance(caller, "edit");
  const input = storeLocationInputSchema.parse(raw);
  try {
    return await prisma.$transaction(async (tx) => {
      const rows = await locationRows(tx, caller.organizationId);
      if (rows.length >= STORE_LOCATION_LIMIT) throw new ApiError(422, `Högst ${STORE_LOCATION_LIMIT} förrådsplatser.`);
      const parentId = input.parentId ?? null;
      const problem = storeLocationProblem(rows, null, parentId);
      if (problem) throw new ApiError(422, problem);
      const parent = parentId ? rows.find((row) => row.id === parentId) ?? null : null;
      // A store at the top gets the next free series at once; one under another follows its top store's kind.
      const seriesStart = parent ? null : input.seriesStart ?? nextSeriesStart(rows.map((row) => row.seriesStart));
      const row = await tx.storeLocation.create({
        data: { organizationId: caller.organizationId, parentId, name: parent ? `${parent.name} › ${input.name}` : input.name, label: input.name, kind: parent ? parent.kind : input.kind, seriesStart, isActive: input.isActive, position: rows.length },
        select: { id: true },
      });
      await audit(tx, caller, "maintenance_location_created", `Förråd: ny förrådsplats ${input.name}.`);
      return row;
    });
  } catch (error) {
    throw locationConflict(error);
  }
}

export async function updateLocation(caller: MaintenanceCaller, locationId: string, raw: unknown) {
  requireMaintenance(caller, "edit");
  const input = storeLocationInputSchema.parse(raw);
  try {
    await prisma.$transaction(async (tx) => {
      const rows = await locationRows(tx, caller.organizationId);
      const current = rows.find((row) => row.id === locationId);
      if (!current) throw new ApiError(404, LOCATION_NOT_FOUND);
      const parentId = input.parentId === undefined ? current.parentId : input.parentId;
      const problem = storeLocationProblem(rows, locationId, parentId);
      if (problem) throw new ApiError(422, problem);
      const parent = parentId ? rows.find((row) => row.id === parentId) ?? null : null;
      await tx.storeLocation.updateMany({
        where: { id: locationId, organizationId: caller.organizationId },
        data: { parentId, label: input.name, name: parent ? `${parent.name} › ${input.name}` : input.name, kind: parent ? parent.kind : input.kind, isActive: input.isActive,
          // The series belongs to the store at the top; a changed start never renumbers an article.
          seriesStart: parent ? null : input.seriesStart === undefined || input.seriesStart === null ? current.seriesStart : input.seriesStart },
      });
      await writeLocationNames(tx, caller.organizationId);
    });
  } catch (error) {
    throw locationConflict(error);
  }
  return { ok: true };
}

/** A location with a log is never removed (its rows would lose their place); it is paused. An empty, unused one goes. */
export async function deleteLocation(caller: MaintenanceCaller, locationId: string) {
  requireMaintenance(caller, "edit");
  return prisma.$transaction(async (tx) => {
    const location = await tx.storeLocation.findFirst({ where: { id: locationId, organizationId: caller.organizationId }, select: { id: true, name: true } });
    if (!location) throw new ApiError(404, LOCATION_NOT_FOUND);
    if (await tx.storeLocation.count({ where: { organizationId: caller.organizationId, parentId: locationId } })) throw new ApiError(409, "Ta bort eller flytta platserna under först.");
    if (await tx.storeItem.count({ where: { organizationId: caller.organizationId, homeStoreId: locationId } })) throw new ApiError(409, "Artiklar har fått sina nummer från förrådet. Pausa det i stället.");
    if (await tx.storeTransaction.count({ where: { organizationId: caller.organizationId, locationId } })) throw new ApiError(409, "Platsen har en logg. Pausa den i stället.");
    await tx.storeBalance.deleteMany({ where: { organizationId: caller.organizationId, locationId, quantity: 0 } });
    if (await tx.storeBalance.count({ where: { organizationId: caller.organizationId, locationId } })) throw new ApiError(409, "Platsen har saldo. Inventera den till noll först.");
    await tx.storeLocation.deleteMany({ where: { id: locationId, organizationId: caller.organizationId } });
    await audit(tx, caller, "maintenance_location_removed", `Förråd: tog bort förrådsplatsen ${location.name}.`);
    return { ok: true };
  });
}

// ---------- items ----------

const articleCommon = {
  /** The store whose series gives the number (a place under it counts as the store); left out = the company's first store. */
  storeId: id.nullable().optional(),
  shelfText: z.string().trim().max(120).default(""),
};
/** An article from the register (the search hit's id, read again here) or an own article (name and unit, and how it is ordered). */
export const storeArticleInputSchema = z.union([
  z.object({ articleRef: id, ...articleCommon }),
  z.object({ name: z.string().trim().min(1, "Skriv en benämning.").max(200), unit: z.string().trim().max(20).default("st"), articleNo: z.string().trim().max(60).default(""), supplierName: z.string().trim().max(120).default(""), ...articleCommon }),
]);

/**
 * The next free number in a store's series: the store's row is locked first, so two new articles at the same moment take one number
 * each (and the unique index holds whatever happens). A store without a series gets the next free one here. No store: no number yet.
 */
async function numberFromSeries(tx: Prisma.TransactionClient, organizationId: string, storeId: string | null | undefined) {
  const rows = await locationRows(tx, organizationId);
  const shaped = rows.map((row) => ({ id: row.id, parentId: row.parentId, name: row.name }));
  if (storeId && !rows.some((row) => row.id === storeId)) throw new ApiError(404, LOCATION_NOT_FOUND);
  const topId = storeId ? rootOf(shaped, storeId) : (await tx.storeLocation.findFirst({ where: { organizationId, parentId: null, isActive: true }, orderBy: [{ position: "asc" }, { name: "asc" }], select: { id: true } }))?.id ?? null;
  if (!topId) return { ownNumber: null, homeStoreId: null };
  await tx.$queryRaw`SELECT id FROM "StoreLocation" WHERE id = ${topId} AND "organizationId" = ${organizationId} FOR UPDATE`;
  // Read after the lock: someone may have given the store its series while this one waited.
  let start = (await tx.storeLocation.findFirst({ where: { id: topId, organizationId }, select: { seriesStart: true } }))?.seriesStart ?? null;
  if (start === null) {
    start = nextSeriesStart(rows.map((row) => row.seriesStart));
    await tx.storeLocation.updateMany({ where: { id: topId, organizationId }, data: { seriesStart: start } });
  }
  return { ownNumber: nextFreeNumber(start, await usedNumbers(tx, organizationId, start)), homeStoreId: topId };
}

/** The store's item for an article: the existing one, or a new one with the article's name, unit and number copied and an own number. */
export async function ensureStoreItem(tx: Prisma.TransactionClient, caller: MaintenanceCaller, raw: unknown) {
  const input = storeArticleInputSchema.parse(raw);
  if ("articleRef" in input) {
    const existing = await tx.storeItem.findFirst({ where: { organizationId: caller.organizationId, articleRef: input.articleRef }, select: { id: true, ownNumber: true } });
    if (existing) {
      // Added once before the numbers came: it gets its number now, and the same article never gets a second row.
      if (existing.ownNumber === null) await tx.storeItem.updateMany({ where: { id: existing.id, organizationId: caller.organizationId }, data: await numberFromSeries(tx, caller.organizationId, input.storeId) });
      return { id: existing.id, created: false };
    }
    const hit = await articleHitById(caller.organizationId, input.articleRef);
    if (!hit) throw new ApiError(404, "Artikeln finns inte i artikelregistret.");
    const own = await tx.catalogueArticle.findFirst({ where: { id: input.articleRef, organizationId: caller.organizationId }, select: { id: true } });
    const row = await tx.storeItem.create({
      data: { organizationId: caller.organizationId, articleRef: input.articleRef, articleId: own?.id ?? null, name: hit.name.slice(0, 200), unit: (hit.unit || "st").slice(0, 20), shelfText: input.shelfText,
        articleNo: (hit.supplierArticleNo || hit.eNumber || "").slice(0, 60), supplierName: (hit.supplierName || "").slice(0, 120), ...(await numberFromSeries(tx, caller.organizationId, input.storeId)), createdById: caller.userId },
      select: { id: true },
    });
    return { id: row.id, created: true };
  }
  const row = await tx.storeItem.create({ data: { organizationId: caller.organizationId, name: input.name, unit: input.unit || "st", articleNo: input.articleNo, supplierName: input.supplierName, shelfText: input.shelfText, ...(await numberFromSeries(tx, caller.organizationId, input.storeId)), createdById: caller.userId }, select: { id: true } });
  return { id: row.id, created: true };
}

const TRY_AGAIN = "Någon annan lade till en artikel samtidigt. Försök igen.";

export async function addStoreItem(caller: MaintenanceCaller, raw: unknown) {
  requireMaintenance(caller, "edit");
  try {
    return await prisma.$transaction(async (tx) => {
      const made = await ensureStoreItem(tx, caller, raw);
      const row = await tx.storeItem.findFirstOrThrow({ where: { id: made.id, organizationId: caller.organizationId }, select: { id: true, name: true, ownNumber: true } });
      if (made.created) await audit(tx, caller, "maintenance_store_item_added", `Förråd: ny artikel ${row.ownNumber ?? ""} ${row.name}.`.replace("  ", " "));
      return { ...row, created: made.created };
    });
  } catch (error) {
    if (isUnique(error)) throw new ApiError(409, TRY_AGAIN);
    throw error;
  }
}

/** An article added before the numbers came gets the next number on request. A number once given is never changed here. */
export async function assignStoreNumber(caller: MaintenanceCaller, itemId: string, raw: unknown) {
  requireMaintenance(caller, "edit");
  const input = z.object({ storeId: id.nullable().optional() }).parse(raw ?? {});
  try {
    return await prisma.$transaction(async (tx) => {
      const item = await tx.storeItem.findFirst({ where: { id: itemId, organizationId: caller.organizationId }, select: { id: true, ownNumber: true } });
      if (!item) throw new ApiError(404, NOT_FOUND);
      if (item.ownNumber !== null) throw new ApiError(409, "Artikeln har redan ett eget nummer.");
      const number = await numberFromSeries(tx, caller.organizationId, input.storeId);
      if (number.ownNumber === null) throw new ApiError(409, "Lägg till ett förråd först.");
      await tx.storeItem.updateMany({ where: { id: itemId, organizationId: caller.organizationId }, data: number });
      return { ownNumber: number.ownNumber };
    });
  } catch (error) {
    if (isUnique(error)) throw new ApiError(409, TRY_AGAIN);
    throw error;
  }
}

const storeItemFields = z.object({
  minQuantity: quantityInput.nullable().optional(),
  shelfText: z.string().trim().max(120).optional(),
  articleNo: z.string().trim().max(60).optional(),
  supplierName: z.string().trim().max(120).optional(),
  // Only an own article: name, unit and price come from the register otherwise.
  name: z.string().trim().min(1, "Skriv en benämning.").max(200).optional(),
  unit: z.string().trim().min(1).max(20).optional(),
  unitPrice: quantityInput.nullable().optional(),
});

/** Lägsta saldo, hyllan som text and "Beställs som". Everything left out stays as it is; the own number is never changed here. */
export async function updateStoreItem(caller: MaintenanceCaller, itemId: string, raw: unknown) {
  const access = requireMaintenance(caller, "edit");
  const input = storeItemFields.parse(raw);
  const quantityOr = (value: string | number | null | undefined, problem: string) => {
    if (value === undefined) return undefined;
    if (value === null || value === "") return null;
    const parsed = parseQuantity(value, { allowZero: true });
    if (parsed === null) throw new ApiError(422, problem);
    return parsed;
  };
  const minQuantity = quantityOr(input.minQuantity, "Lägsta saldo ska vara ett antal.");
  const unitPrice = quantityOr(input.unitPrice, "Priset ska vara ett belopp.");
  const item = await prisma.storeItem.findFirst({ where: { id: itemId, organizationId: caller.organizationId }, select: { articleRef: true } });
  if (!item) throw new ApiError(404, NOT_FOUND);
  const own = !item.articleRef;
  await prisma.storeItem.updateMany({
    where: { id: itemId, organizationId: caller.organizationId },
    data: { minQuantity, shelfText: input.shelfText, articleNo: input.articleNo, supplierName: input.supplierName, ...(own ? { name: input.name, unit: input.unit, ...(access.prices ? { unitPrice } : {}) } : {}) },
  });
  return { ok: true };
}

/** An item that never moved is removed with its zero balances and part links; one with a log stays. */
export async function deleteStoreItem(caller: MaintenanceCaller, itemId: string) {
  requireMaintenance(caller, "edit");
  return prisma.$transaction(async (tx) => {
    const item = await tx.storeItem.findFirst({ where: { id: itemId, organizationId: caller.organizationId }, select: { id: true, name: true } });
    if (!item) throw new ApiError(404, NOT_FOUND);
    if (await tx.storeTransaction.count({ where: { organizationId: caller.organizationId, itemId } })) throw new ApiError(409, "Artikeln har en logg i förrådet och kan inte tas bort.");
    await tx.storeItem.deleteMany({ where: { id: itemId, organizationId: caller.organizationId } });
    await audit(tx, caller, "maintenance_store_item_removed", `Förråd: tog bort ${item.name}.`);
    return { ok: true };
  });
}

/** A spare part on a machine part: an article (from the register or own) and how many usually go. */
export async function linkSparePart(caller: MaintenanceCaller, partId: string, raw: unknown) {
  requireMaintenance(caller, "edit");
  const input = z.object({ article: z.unknown().optional(), itemId: id.optional(), quantity: quantityInput.default(1) }).parse(raw);
  const quantity = parseQuantity(input.quantity);
  if (quantity === null) throw new ApiError(422, "Ange ett antal större än noll.");
  return prisma.$transaction(async (tx) => {
    const part = await tx.machinePart.findFirst({ where: { id: partId, organizationId: caller.organizationId }, select: { id: true } });
    if (!part) throw new ApiError(404, "Delen hittades inte.");
    const item = input.itemId ? await tx.storeItem.findFirst({ where: { id: input.itemId, organizationId: caller.organizationId }, select: { id: true } }) : await ensureStoreItem(tx, caller, input.article);
    if (!item) throw new ApiError(404, NOT_FOUND);
    if (await tx.machinePartArticle.count({ where: { organizationId: caller.organizationId, partId } }) >= 100) throw new ApiError(422, "Högst 100 reservdelar per del.");
    await tx.machinePartArticle.upsert({
      where: { partId_itemId: { partId, itemId: item.id } },
      create: { organizationId: caller.organizationId, partId, itemId: item.id, quantity, createdById: caller.userId },
      update: { quantity },
    });
    return { itemId: item.id };
  }).catch((error) => { throw isUnique(error) ? new ApiError(409, TRY_AGAIN) : error; });
}

export async function unlinkSparePart(caller: MaintenanceCaller, linkId: string) {
  requireMaintenance(caller, "edit");
  const removed = await prisma.machinePartArticle.deleteMany({ where: { id: linkId, organizationId: caller.organizationId } });
  if (!removed.count) throw new ApiError(404, "Reservdelen hittades inte.");
  return { ok: true };
}

// ---------- moves ----------

async function readItemAndLocation(db: Db, caller: MaintenanceCaller, itemId: string, locationId: string) {
  const [item, location] = await Promise.all([
    db.storeItem.findFirst({ where: { id: itemId, organizationId: caller.organizationId }, select: { id: true, name: true, unit: true, articleRef: true } }),
    db.storeLocation.findFirst({ where: { id: locationId, organizationId: caller.organizationId }, select: { id: true, name: true, isActive: true } }),
  ]);
  if (!item) throw new ApiError(404, NOT_FOUND);
  if (!location) throw new ApiError(404, LOCATION_NOT_FOUND);
  return { item, location };
}

const balanceOf = async (db: Db, itemId: string, locationId: string) => decimal((await db.storeBalance.findUnique({ where: { itemId_locationId: { itemId, locationId } }, select: { quantity: true } }))?.quantity) ?? 0;

/** Inleverans: more of an article on a location (a delivered purchase, a found box). */
export async function receive(caller: MaintenanceCaller, raw: unknown) {
  requireMaintenance(caller, "edit");
  const input = z.object({ itemId: id, locationId: id, quantity: quantityInput, note: z.string().trim().max(300).default("") }).parse(raw);
  const quantity = parseQuantity(input.quantity);
  if (quantity === null) throw new ApiError(422, "Ange ett antal större än noll.");
  return prisma.$transaction(async (tx) => {
    const { location } = await readItemAndLocation(tx, caller, input.itemId, input.locationId);
    if (!location.isActive) throw new ApiError(409, "Förrådsplatsen är pausad.");
    const row = await tx.storeBalance.upsert({
      where: { itemId_locationId: { itemId: input.itemId, locationId: input.locationId } },
      create: { organizationId: caller.organizationId, itemId: input.itemId, locationId: input.locationId, quantity },
      update: { quantity: { increment: quantity } }, select: { quantity: true },
    });
    const after = decimal(row.quantity) ?? 0;
    await tx.storeTransaction.create({ data: { organizationId: caller.organizationId, itemId: input.itemId, locationId: input.locationId, kind: "RECEIPT", change: quantity, balanceAfter: after, note: input.note, userId: caller.userId } });
    return { balance: after };
  });
}

/**
 * Inventering: the counted balance replaces the old one, and the log keeps the difference and who counted. Conditional on
 * the balance read, so a withdrawal at the same moment is never lost (the person counts again). Audited.
 */
export async function count(caller: MaintenanceCaller, raw: unknown) {
  requireMaintenance(caller, "edit");
  const input = z.object({ itemId: id, locationId: id, counted: quantityInput, note: z.string().trim().max(300).default("") }).parse(raw);
  const counted = parseQuantity(input.counted, { allowZero: true });
  if (counted === null) throw new ApiError(422, "Ange det räknade antalet (noll eller mer).");
  return prisma.$transaction(async (tx) => {
    const { item, location } = await readItemAndLocation(tx, caller, input.itemId, input.locationId);
    const existing = await tx.storeBalance.findUnique({ where: { itemId_locationId: { itemId: item.id, locationId: location.id } }, select: { id: true, quantity: true } });
    const before = decimal(existing?.quantity) ?? 0;
    const change = countChange(before, counted);
    if (existing) {
      const updated = await tx.storeBalance.updateMany({ where: { id: existing.id, quantity: existing.quantity }, data: { quantity: counted } });
      if (!updated.count) throw new ApiError(409, "Saldot ändrades medan du räknade. Läs in och räkna igen.");
    } else {
      await tx.storeBalance.create({ data: { organizationId: caller.organizationId, itemId: item.id, locationId: location.id, quantity: counted } });
    }
    await tx.storeTransaction.create({ data: { organizationId: caller.organizationId, itemId: item.id, locationId: location.id, kind: "COUNT", change, balanceAfter: counted, note: input.note, userId: caller.userId } });
    await audit(tx, caller, "maintenance_store_count", `Förråd: inventerade ${item.name} på ${location.name}: ${quantityText(before)} → ${quantityText(counted)} ${item.unit}.`);
    return { balance: counted, change };
  });
}

/**
 * Uttag (decided 2026-10-30: a spare part is drawn from the store as soon as it is put on the work order): the balance drops
 * at once and the log keeps who, when, which work order (and item) and the article's price then (for the machine's cost).
 * Without a location the first one with enough is taken. Only onto an open work order of the company.
 */
export async function withdraw(caller: MaintenanceCaller, raw: unknown) {
  const access = maintenanceAccess(caller);
  if (!access.cloud || !canWithdraw(access)) throw new ApiError(403, "Du saknar behörighet att ta ut reservdelar till arbetsordrar.");
  const input = z.object({ itemId: id, locationId: id.optional(), quantity: quantityInput, workOrderId: id, maintenanceItemId: id.nullable().optional(), note: z.string().trim().max(300).default("") }).parse(raw);
  const quantity = parseQuantity(input.quantity);
  if (quantity === null) throw new ApiError(422, "Ange ett antal större än noll.");
  const order = await prisma.workflowTask.findFirst({ where: { id: input.workOrderId, organizationId: caller.organizationId, kind: "WORK_ORDER" }, select: { id: true, status: true, title: true, machinePartId: true } });
  if (!order) throw new ApiError(404, "Arbetsordern hittades inte.");
  if (order.status === "COMPLETED" || order.status === "CANCELLED") throw new ApiError(409, "Arbetsordern är avslutad. Öppna den igen först.");
  const item = input.maintenanceItemId ? await prisma.maintenanceItem.findFirst({ where: { id: input.maintenanceItemId, organizationId: caller.organizationId }, select: { id: true, partId: true, workOrderId: true } }) : null;
  if (input.maintenanceItemId && (!item || item.workOrderId !== order.id)) throw new ApiError(409, "Underhållsposten hör inte till arbetsordern.");
  const article = await prisma.storeItem.findFirst({ where: { id: input.itemId, organizationId: caller.organizationId }, select: { id: true, name: true, unit: true, articleRef: true, articleNo: true, supplierName: true, unitPrice: true, balances: { select: { locationId: true, quantity: true, location: { select: { isActive: true, position: true, name: true } } } } } });
  if (!article) throw new ApiError(404, NOT_FOUND);
  const balances = article.balances.filter((row) => row.location.isActive).sort((a, b) => a.location.position - b.location.position || a.location.name.localeCompare(b.location.name, "sv")).map((row) => ({ locationId: row.locationId, quantity: decimal(row.quantity) ?? 0 }));
  const locationId = input.locationId ?? pickLocation(balances, quantity);
  if (!locationId) throw new ApiError(409, `${article.name} är slut i förrådet. Beställ först.`);
  const check = withdrawal(balances.find((row) => row.locationId === locationId)?.quantity ?? 0, quantity);
  if (!check.ok) throw new ApiError(409, check.problem);
  const hit = article.articleRef ? await articleHitById(caller.organizationId, article.articleRef).catch(() => null) : null;
  // An own article without the register has its own price, for the machine's cost.
  const unitPrice = hit?.price?.unitPrice ?? decimal(article.unitPrice);
  const { markupPercent } = await readPriceSettings(caller.organizationId);
  const done = await prisma.$transaction(async (tx) => {
    // The work order is locked first, as in returnWithdrawal, so the two never wait for each other the other way round.
    await tx.$queryRaw`SELECT id FROM "WorkflowTask" WHERE id = ${order.id} AND "organizationId" = ${caller.organizationId} FOR UPDATE`;
    const { location } = await readItemAndLocation(tx, caller, article.id, locationId);
    const updated = await tx.storeBalance.updateMany({ where: { organizationId: caller.organizationId, itemId: article.id, locationId, quantity: { gte: quantity } }, data: { quantity: { decrement: quantity } } });
    if (!updated.count) throw new ApiError(409, "Saldot räcker inte längre. Läs in förrådet igen.");
    const after = await balanceOf(tx, article.id, locationId);
    const row = await tx.storeTransaction.create({
      data: { organizationId: caller.organizationId, itemId: article.id, locationId, kind: "WITHDRAWAL", change: -quantity, balanceAfter: after, unitPrice, workOrderId: order.id, maintenanceItemId: item?.id ?? null,
        machinePartId: item?.partId ?? order.machinePartId ?? null, note: input.note, userId: caller.userId },
      select: { id: true },
    });
    // The same moment the part is on the work order's material (2026-10-30): a locked row only the store changes.
    const materialRow = storeWithdrawalRow({ id: randomUUID(), transactionId: row.id, locationName: location.name, quantity, hit, markupPercent,
      article: { name: article.name, unit: article.unit, articleNo: article.articleNo, supplierName: article.supplierName } });
    const version = await writeOrderRows(tx, caller, order.id, (rows) => [...rows, materialRow], `Från förrådet: ${quantityText(quantity)} ${article.unit} ${article.name} (${location.name}).`, { open: true });
    return { id: row.id, balance: after, version, text: `${quantityText(quantity)} ${article.unit} ${article.name} lades på ${order.title} och drogs från ${location.name}.` };
  });
  await announceOrderChange(caller, order.id, done.version);
  return { id: done.id, balance: done.balance, text: done.text };
}

/** The most material rows a work order holds (lib/workflow/task-model.ts). */
const ORDER_ROWS_MAX = 200;
const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});
const rowsOf = (data: unknown) => { const rows = record(record(data).details).materials; return (Array.isArray(rows) ? rows : []) as MaterialRow[]; };

/**
 * Writes the work order's material rows in the store's own transaction: the order's row is locked first, so a save of the
 * order at the same moment meets a newer version (and merges, as with any other change), and the change gets its own
 * version in the history. `open`: refused on a finished or cancelled order. Returns the new version, or null when nothing
 * changed (the order is gone, or the rows are the same).
 */
async function writeOrderRows(tx: Prisma.TransactionClient, caller: MaintenanceCaller, orderId: string, change: (rows: MaterialRow[]) => MaterialRow[], note: string, options: { open: boolean }) {
  await tx.$queryRaw`SELECT id FROM "WorkflowTask" WHERE id = ${orderId} AND "organizationId" = ${caller.organizationId} FOR UPDATE`;
  const task = await tx.workflowTask.findFirst({ where: { id: orderId, organizationId: caller.organizationId, kind: "WORK_ORDER" }, select: { version: true, title: true, description: true, status: true, progress: true, data: true, completedAt: true } });
  if (!task) return null;
  if (options.open && (task.status === "COMPLETED" || task.status === "CANCELLED")) throw new ApiError(409, "Arbetsordern är avslutad. Öppna den igen först.");
  const data = record(task.data);
  const details = record(data.details);
  const rows = rowsOf(task.data);
  const next = change(rows);
  if (next.length === rows.length && next.every((row, index) => row === rows[index])) return null;
  if (next.length > ORDER_ROWS_MAX) throw new ApiError(422, `Arbetsordern har redan ${ORDER_ROWS_MAX} materialrader.`);
  const nextData = { ...data, details: { ...details, materials: next } };
  const version = task.version + 1;
  await tx.workflowTask.updateMany({ where: { id: orderId, organizationId: caller.organizationId, version: task.version }, data: { data: nextData as Prisma.InputJsonValue, version: { increment: 1 }, updatedBy: caller.userId } });
  await tx.workflowTaskRevision.create({ data: { taskId: orderId, version, createdBy: caller.userId,
    snapshot: { title: task.title, description: task.description, status: task.status, progress: task.progress, data: nextData, completedAt: task.completedAt?.toISOString() ?? null, note } as Prisma.InputJsonValue } });
  return version;
}

/** An open page of the work order reads the new version at once (the live sync, lib/workflow/live-bus.ts). */
async function announceOrderChange(caller: MaintenanceCaller, orderId: string, version: number | null) {
  if (version === null) return;
  const user = await prisma.user.findUnique({ where: { id: caller.userId }, select: { name: true, email: true } }).catch(() => null);
  publishTaskChange(orderId, { version, byUserId: caller.userId, byName: user?.name || user?.email || "", reason: "save" });
}

/**
 * Åter: a withdrawal made by mistake goes back to its location (once), with its own log row. Its row on the work order goes
 * with it – or, when an invoice basis has already taken the row, a negative row is added so the next basis credits it
 * (lib/workflow/store-rows.ts). A finished work order is opened again first, as for a withdrawal.
 */
export async function returnWithdrawal(caller: MaintenanceCaller, transactionId: string) {
  const access = maintenanceAccess(caller);
  if (!access.cloud || !canWithdraw(access)) throw new ApiError(403, "Du saknar behörighet att lämna tillbaka reservdelar.");
  const done = await prisma.$transaction(async (tx) => {
    const move = await tx.storeTransaction.findFirst({ where: { id: transactionId, organizationId: caller.organizationId, kind: "WITHDRAWAL" }, include: { location: { select: { name: true } } } });
    if (!move) throw new ApiError(404, "Uttaget hittades inte.");
    // The work order first (its row is locked): a return and a save, or two returns, at the same moment wait for each other.
    if (move.workOrderId) await tx.$queryRaw`SELECT id FROM "WorkflowTask" WHERE id = ${move.workOrderId} AND "organizationId" = ${caller.organizationId} FOR UPDATE`;
    if (await tx.storeTransaction.count({ where: { organizationId: caller.organizationId, kind: "RETURN", note: `ret:${move.id}` } })) throw new ApiError(409, "Uttaget är redan tillbakalämnat.");
    const quantity = roundQuantity(-(decimal(move.change) ?? 0));
    const row = await tx.storeBalance.upsert({
      where: { itemId_locationId: { itemId: move.itemId, locationId: move.locationId } },
      create: { organizationId: caller.organizationId, itemId: move.itemId, locationId: move.locationId, quantity },
      update: { quantity: { increment: quantity } }, select: { quantity: true },
    });
    const back = await tx.storeTransaction.create({ data: { organizationId: caller.organizationId, itemId: move.itemId, locationId: move.locationId, kind: "RETURN", change: quantity, balanceAfter: decimal(row.quantity) ?? 0,
      workOrderId: move.workOrderId, maintenanceItemId: move.maintenanceItemId, machinePartId: move.machinePartId, note: `ret:${move.id}`, userId: caller.userId }, select: { id: true } });
    if (!move.workOrderId) return { orderId: null, version: null };
    const orderId = move.workOrderId;
    const order = await tx.workflowTask.findFirst({ where: { id: orderId, organizationId: caller.organizationId }, select: { data: true } });
    const own = storeRowOf(rowsOf(order?.data), move.id);
    // Already on an invoice basis: the row stays (it is billed) and a negative row credits it on the next one.
    const billed = own ? await tx.invoiceBasisSource.count({ where: { organizationId: caller.organizationId, sourceKey: rowSourceKey(orderId, own.id) } }) > 0 : false;
    const version = await writeOrderRows(tx, caller, orderId,
      (current) => rowsAfterReturn(current, { withdrawalId: move.id, billed, returnRow: (withdrawal) => storeReturnRow({ id: randomUUID(), transactionId: back.id, locationName: move.location.name, withdrawal, quantity }) }),
      `Tillbaka till förrådet: ${own?.name ?? "reservdel"} (${move.location.name}).`, { open: true });
    return { orderId, version };
  });
  if (done.orderId) await announceOrderChange(caller, done.orderId, done.version);
  return { ok: true };
}

/** The log of one article (latest first, bounded). */
export async function storeLog(caller: MaintenanceCaller, itemId: string) {
  requireMaintenance(caller, "read");
  const item = await prisma.storeItem.findFirst({ where: { id: itemId, organizationId: caller.organizationId }, select: { id: true, name: true, unit: true } });
  if (!item) throw new ApiError(404, NOT_FOUND);
  const rows = await prisma.storeTransaction.findMany({
    where: { organizationId: caller.organizationId, itemId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100,
    select: { id: true, kind: true, change: true, balanceAfter: true, note: true, userId: true, createdAt: true, location: { select: { name: true } }, workOrder: { select: { id: true, title: true } } },
  });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.userId))] } }, select: { id: true, name: true, email: true } });
  const who = new Map(users.map((user) => [user.id, user.name || user.email || ""]));
  return {
    item,
    rows: rows.map((row) => ({ id: row.id, kind: row.kind, change: decimal(row.change) ?? 0, balanceAfter: decimal(row.balanceAfter) ?? 0, note: row.note.startsWith("ret:") ? "" : row.note,
      locationName: row.location.name, workOrder: row.workOrder, byName: who.get(row.userId) ?? "", at: row.createdAt.toISOString() })),
  };
}

/**
 * Beställ: an ordinary purchase (lib/purchases) with the article, as a draft the person checks and orders. The purchase's
 * own rules apply (who may make purchases, prices). Suggests up to twice the minimum.
 */
export async function orderItem(caller: MaintenanceCaller, itemId: string, raw: unknown) {
  requireMaintenance(caller, "read");
  const input = z.object({ quantity: quantityInput.optional() }).parse(raw ?? {});
  const item = await prisma.storeItem.findFirst({ where: { id: itemId, organizationId: caller.organizationId }, select: { name: true, unit: true, articleRef: true, articleNo: true, supplierName: true, minQuantity: true, balances: { select: { quantity: true } } } });
  if (!item) throw new ApiError(404, NOT_FOUND);
  const total = itemTotal(item.balances.map((row) => ({ quantity: decimal(row.quantity) ?? 0 })));
  const quantity = input.quantity !== undefined ? parseQuantity(input.quantity) : suggestedOrderQuantity(total, decimal(item.minQuantity));
  if (quantity === null) throw new ApiError(422, "Ange ett antal större än noll.");
  const purchaseCaller: PurchaseCaller = { organizationId: caller.organizationId, userId: caller.userId, admin: caller.admin, permissions: caller.permissions, storageMode: caller.storageMode };
  const line = { name: item.name, quantity: quantityText(quantity), unit: item.unit, supplierName: item.supplierName, articleNo: item.articleNo, ...(item.articleRef ? { pickedArticleId: item.articleRef } : {}) };
  return createPurchase(purchaseCaller, { title: `Förråd: ${item.name}`.slice(0, 200), lines: [line] });
}

// ---------- the cards (2026-10-31): a store or a place, and an article ----------

const CARD_MOVES = 2000;
const VALUE_ARTICLES = 200;

/** The price per article for the store's value: the register's latest, else an own article's own. At most VALUE_ARTICLES are looked up. */
async function articlePrices(organizationId: string, items: readonly { id: string; articleRef: string | null; unitPrice: number | null }[]) {
  const prices = new Map<string, number | null>();
  const wanted = items.filter((item) => item.articleRef).slice(0, VALUE_ARTICLES);
  for (const item of items) if (!item.articleRef) prices.set(item.id, item.unitPrice);
  for (let start = 0; start < wanted.length; start += 8) {
    await Promise.all(wanted.slice(start, start + 8).map(async (item) => {
      const hit = await articleHitById(organizationId, item.articleRef!).catch(() => null);
      prices.set(item.id, hit?.price?.unitPrice ?? item.unitPrice);
    }));
  }
  return { prices, truncated: items.filter((item) => item.articleRef).length > VALUE_ARTICLES };
}

const moveSelect = { id: true, itemId: true, kind: true, change: true, balanceAfter: true, unitPrice: true, note: true, userId: true, createdAt: true, item: { select: { name: true, unit: true } }, location: { select: { name: true } }, workOrder: { select: { id: true, title: true } } } satisfies Prisma.StoreTransactionSelect;
type MoveRow = Prisma.StoreTransactionGetPayload<{ select: typeof moveSelect }>;

async function eventRows(rows: readonly MoveRow[]) {
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.userId))] } }, select: { id: true, name: true, email: true } });
  const who = new Map(users.map((user) => [user.id, user.name || user.email || ""]));
  return rows.map((row) => ({ id: row.id, kind: row.kind, itemId: row.itemId, itemName: row.item.name, unit: row.item.unit, change: decimal(row.change) ?? 0, balanceAfter: decimal(row.balanceAfter) ?? 0, note: row.note.startsWith("ret:") ? "" : row.note,
    locationName: row.location.name, workOrder: row.workOrder, byName: who.get(row.userId) ?? "", at: row.createdAt.toISOString() }));
}

/** What the moves cost per work order, most first (what was drawn, net of what came back); only for someone who may see prices. */
function costPerOrder(rows: readonly MoveRow[], prices: boolean) {
  if (!prices) return [];
  const orders = new Map<string, { id: string; title: string; value: number; moves: number }>();
  for (const row of rows) {
    if (!row.workOrder || (row.kind !== "WITHDRAWAL" && row.kind !== "RETURN")) continue;
    const price = decimal(row.unitPrice);
    const entry = orders.get(row.workOrder.id) ?? { id: row.workOrder.id, title: row.workOrder.title, value: 0, moves: 0 };
    entry.value = roundQuantity(entry.value + (price === null ? 0 : -(decimal(row.change) ?? 0) * price));
    entry.moves += row.kind === "WITHDRAWAL" ? 1 : -1;
    orders.set(row.workOrder.id, entry);
  }
  return [...orders.values()].sort((a, b) => b.value - a.value).slice(0, 30);
}

const figureMoves = (rows: readonly MoveRow[]) => rows.map((row) => ({ itemId: row.itemId, kind: row.kind, change: decimal(row.change) ?? 0, unitPrice: decimal(row.unitPrice), at: row.createdAt }));

/**
 * The card for a store or a place in it, the places under it included (no id: the whole company): the figure boxes (Artiklar, Lågt
 * saldo, Lagervärde, Uttag senaste 90 dagar), the balance per place, the latest moves and the cost per work order. Amounts only for
 * someone who may see prices.
 */
export async function storePlaceCard(caller: MaintenanceCaller, locationId: string | null, now = new Date()) {
  const access = requireMaintenance(caller, "read");
  const organizationId = caller.organizationId;
  const rows = await locationRows(prisma, organizationId);
  if (locationId && !rows.some((row) => row.id === locationId)) throw new ApiError(404, LOCATION_NOT_FOUND);
  const shaped = rows.map((row) => ({ id: row.id, parentId: row.parentId, name: row.name }));
  const ids = locationId ? subtreeIds(shaped, locationId) : rows.map((row) => row.id);
  const [balances, moves] = await Promise.all([
    prisma.storeBalance.findMany({ where: { organizationId, locationId: { in: ids } }, take: 5000, select: { itemId: true, locationId: true, quantity: true, location: { select: { name: true } },
      item: { select: { id: true, name: true, unit: true, ownNumber: true, articleRef: true, unitPrice: true, minQuantity: true, balances: { select: { quantity: true } } } } } }),
    prisma.storeTransaction.findMany({ where: { organizationId, locationId: { in: ids } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: CARD_MOVES, select: moveSelect }),
  ]);
  const items = new Map(balances.map((row) => [row.item.id, row.item]));
  const lowItems = new Set([...items.values()].filter((item) => isLow(itemTotal(item.balances.map((balance) => ({ quantity: decimal(balance.quantity) ?? 0 }))), decimal(item.minQuantity))).map((item) => item.id));
  const priced = access.prices ? await articlePrices(organizationId, [...items.values()].map((item) => ({ id: item.id, articleRef: item.articleRef, unitPrice: decimal(item.unitPrice) }))) : null;
  const figures = storeFigures({ balances: balances.map((row) => ({ itemId: row.itemId, quantity: decimal(row.quantity) ?? 0 })), lowItems, prices: priced?.prices ?? null, moves: figureMoves(moves), now });
  return {
    figures, valueTruncated: priced?.truncated ?? false, pricesVisible: access.prices,
    balances: balances.map((row) => ({ itemId: row.itemId, itemName: row.item.name, unit: row.item.unit, ownNumber: row.item.ownNumber, locationId: row.locationId, locationName: row.location.name, quantity: decimal(row.quantity) ?? 0 }))
      .sort((a, b) => a.locationName.localeCompare(b.locationName, "sv") || a.itemName.localeCompare(b.itemName, "sv")),
    events: await eventRows(moves.slice(0, 50)),
    costOrders: costPerOrder(moves, access.prices),
    movesTruncated: moves.length >= CARD_MOVES,
  };
}

/** The article's own card: the store's number, "Beställs som", the balance per place with the total, the parts it fits, the latest moves. */
export async function storeArticleCard(caller: MaintenanceCaller, itemId: string, now = new Date()) {
  const access = requireMaintenance(caller, "read");
  const organizationId = caller.organizationId;
  const item = await prisma.storeItem.findFirst({ where: { id: itemId, organizationId },
    select: { id: true, name: true, unit: true, ownNumber: true, homeStoreId: true, shelfText: true, articleNo: true, supplierName: true, articleRef: true, unitPrice: true, minQuantity: true, homeStore: { select: { name: true } },
      balances: { select: { locationId: true, quantity: true, location: { select: { name: true, isActive: true } } } }, parts: { take: 50, select: { partId: true, quantity: true, part: { select: { name: true } } } } } });
  if (!item) throw new ApiError(404, NOT_FOUND);
  const [moves, all] = await Promise.all([
    prisma.storeTransaction.findMany({ where: { organizationId, itemId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: CARD_MOVES, select: moveSelect }),
    prisma.machinePart.findMany({ where: { organizationId }, select: { id: true, parentId: true, name: true }, take: PART_LIMIT }),
  ]);
  const balances = item.balances.map((row) => ({ locationId: row.locationId, locationName: row.location.name, isActive: row.location.isActive, quantity: decimal(row.quantity) ?? 0 })).sort((a, b) => a.locationName.localeCompare(b.locationName, "sv"));
  const total = itemTotal(balances);
  const min = decimal(item.minQuantity);
  const priced = access.prices ? await articlePrices(organizationId, [{ id: item.id, articleRef: item.articleRef, unitPrice: decimal(item.unitPrice) }]) : null;
  const figures = storeFigures({ balances: balances.map((row) => ({ itemId: item.id, quantity: row.quantity })), lowItems: new Set(isLow(total, min) ? [item.id] : []), prices: priced?.prices ?? null, moves: figureMoves(moves), now });
  return {
    item: { id: item.id, name: item.name, unit: item.unit, ownNumber: item.ownNumber, homeStoreId: item.homeStoreId, homeStoreName: item.homeStore?.name ?? "", shelfText: item.shelfText, articleNo: item.articleNo, supplierName: item.supplierName, fromRegister: Boolean(item.articleRef),
      unitPrice: access.prices ? priced?.prices.get(item.id) ?? null : null, ownPrice: access.prices ? decimal(item.unitPrice) : null, minQuantity: min, total, low: isLow(total, min) },
    balances, figures, pricesVisible: access.prices,
    parts: item.parts.map((row) => ({ id: row.partId, name: row.part.name, path: partPath(all, row.partId).join(" › "), level: partDepth(all, row.partId), quantity: decimal(row.quantity) ?? 1 })),
    events: await eventRows(moves.slice(0, 50)),
    costOrders: costPerOrder(moves, access.prices),
    canEdit: access.edit, canOrder: access.edit,
  };
}
