import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/server";
import { type MaintenanceCaller, PART_LIMIT } from "./model";
import { PLACE_LIMIT, placeInputSchema, placeLevelOf, placeProblem, placeSubtree, type PlaceListItem, type PlaceRow } from "./place-model";
import { audit, requireMaintenance, type Db } from "./server";
import { capRefusal, effectiveCap, PLACE_CAP_DEFAULT } from "./caps";
import { nextPosition } from "./location";

/**
 * Platserna i Underhåll (2026-10-31): the company's own tree Ort › Anläggning › Område › Avdelning, apart from the customer
 * register. Every query is bound to the caller's company, and the database checks it again (composite keys, migration
 * 20261101230000_maintenance_place_tree). The route (app/api/maintenance) checks the session, Cloud write access and Origin; this
 * file checks the rights. Nothing here ever needs a customer.
 */
const NOT_FOUND = "Platsen hittades inte.";
const DUPLICATE = "Det finns redan en plats med det namnet här.";
const isUnique = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export async function placesOf(db: Db, organizationId: string): Promise<PlaceListItem[]> {
  const rows = await db.maintenancePlace.findMany({ where: { organizationId }, orderBy: { name: "asc" }, take: PLACE_LIMIT, select: { id: true, parentId: true, name: true, level: true, notes: true, version: true, latitude: true, longitude: true } });
  return rows.map((row) => ({ ...row, level: placeLevelOf(row.level) }));
}

async function placeRows(db: Db, organizationId: string): Promise<PlaceRow[]> {
  return db.maintenancePlace.findMany({ where: { organizationId }, take: PLACE_LIMIT, select: { id: true, parentId: true, name: true, level: true } });
}

/** The unique index cannot see two places at the top with one name (their parent is NULL); the words are the same as for siblings. */
async function checkName(db: Db, organizationId: string, placeId: string | null, input: { parentId: string | null; name: string }) {
  if (input.parentId) return;
  const same = await db.maintenancePlace.findFirst({ where: { organizationId, parentId: null, name: { equals: input.name, mode: "insensitive" }, ...(placeId ? { NOT: { id: placeId } } : {}) }, select: { id: true } });
  if (same) throw new ApiError(409, DUPLICATE);
}

export async function createPlace(caller: MaintenanceCaller, raw: unknown) {
  requireMaintenance(caller, "edit");
  const input = placeInputSchema.parse(raw);
  try {
    return await prisma.$transaction(async (tx) => {
      const rows = await placeRows(tx, caller.organizationId);
      // Justerbart tak (0.92.0): the company's own cap when the product owner has set one, else today's PLACE_LIMIT.
      const company = await tx.organization.findUnique({ where: { id: caller.organizationId }, select: { maintenancePlaceCap: true } });
      const refusal = capRefusal("place", rows.length, effectiveCap(company?.maintenancePlaceCap, PLACE_CAP_DEFAULT));
      if (refusal) throw new ApiError(422, refusal);
      const problem = placeProblem(rows, null, input);
      if (problem) throw new ApiError(422, problem);
      await checkName(tx, caller.organizationId, null, input);
      const position = nextPosition({ latitude: null, longitude: null }, input, true);
      const row = await tx.maintenancePlace.create({ data: { organizationId: caller.organizationId, parentId: input.parentId, name: input.name, level: input.level, notes: input.notes, ...position, createdById: caller.userId, updatedById: caller.userId }, select: { id: true, version: true } });
      await audit(tx, caller, "maintenance_place_created", `Underhåll: ny plats ${input.name}.`);
      return row;
    });
  } catch (error) {
    if (isUnique(error)) throw new ApiError(409, DUPLICATE);
    throw error;
  }
}

export async function updatePlace(caller: MaintenanceCaller, id: string, version: number, raw: unknown) {
  requireMaintenance(caller, "edit");
  const input = placeInputSchema.parse(raw);
  try {
    return await prisma.$transaction(async (tx) => {
      const rows = await placeRows(tx, caller.organizationId);
      if (!rows.some((row) => row.id === id)) throw new ApiError(404, NOT_FOUND);
      const problem = placeProblem(rows, id, input);
      if (problem) throw new ApiError(422, problem);
      await checkName(tx, caller.organizationId, id, input);
      // Kartnål (0.92.0): left out (a drag in the tree) keeps the pin; null removes it.
      const position = input.latitude === undefined || input.longitude === undefined ? {} : { latitude: input.latitude, longitude: input.longitude };
      const updated = await tx.maintenancePlace.updateMany({ where: { id, organizationId: caller.organizationId, version }, data: { parentId: input.parentId, name: input.name, level: input.level, notes: input.notes, ...position, updatedById: caller.userId, version: { increment: 1 } } });
      if (!updated.count) throw new ApiError(409, "Platsen har ändrats av någon annan. Läs in den igen.");
      return { id, version: version + 1 };
    });
  } catch (error) {
    if (isUnique(error)) throw new ApiError(409, DUPLICATE);
    throw error;
  }
}

/** Removed only when nothing stands on it: no place under it and no machine on it. A machine is moved first, so nothing is lost. */
export async function deletePlace(caller: MaintenanceCaller, id: string) {
  requireMaintenance(caller, "edit");
  return prisma.$transaction(async (tx) => {
    const place = await tx.maintenancePlace.findFirst({ where: { id, organizationId: caller.organizationId }, select: { id: true, name: true } });
    if (!place) throw new ApiError(404, NOT_FOUND);
    const [children, machines] = await Promise.all([
      tx.maintenancePlace.count({ where: { organizationId: caller.organizationId, parentId: id } }),
      tx.machinePart.count({ where: { organizationId: caller.organizationId, placeId: id } }),
    ]);
    if (children) throw new ApiError(409, "Ta bort eller flytta platserna under först.");
    if (machines) throw new ApiError(409, "Flytta maskinerna på platsen först.");
    await tx.maintenancePlace.deleteMany({ where: { id, organizationId: caller.organizationId } });
    await audit(tx, caller, "maintenance_place_removed", `Underhåll: tog bort platsen ${place.name}.`);
    return { ok: true };
  });
}

/**
 * The machines a place holds, for the cost that sums upward (part → machine → place): every part under every machine on the place
 * and the places under it. `placeId` null: all the company's machines. "Utan plats" is reached through `withoutPlace`.
 */
export async function partsAtPlace(caller: MaintenanceCaller, choice: { placeId: string | null; withoutPlace?: boolean }) {
  requireMaintenance(caller, "read");
  const organizationId = caller.organizationId;
  const [places, parts] = await Promise.all([
    placeRows(prisma, organizationId),
    prisma.machinePart.findMany({ where: { organizationId }, select: { id: true, parentId: true, placeId: true, name: true }, take: PART_LIMIT }),
  ]);
  if (choice.placeId && !places.some((place) => place.id === choice.placeId)) throw new ApiError(404, NOT_FOUND);
  const wanted = choice.placeId ? new Set(placeSubtree(places, choice.placeId)) : null;
  const known = new Set(places.map((place) => place.id));
  const roots = parts.filter((part) => !part.parentId && (wanted ? part.placeId !== null && wanted.has(part.placeId) : choice.withoutPlace ? !part.placeId || !known.has(part.placeId) : true));
  return { parts, roots: roots.map((root) => root.id) };
}
