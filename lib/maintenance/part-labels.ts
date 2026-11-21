import { prisma } from "@/lib/db";
import { PART_LIMIT, partPath, rootOf } from "./model";
import { placePath } from "./place-model";

/** A machine part as other pages name it: its name, the way down to it from its place ("Fabriken › Linje 2") and whether it is active. */
export type PartLabel = { id: string; name: string; path: string; isActive: boolean };

/**
 * Names of machine parts for the machine connection's pages (sources, signals, alarm responsibility) and the work order:
 * company-bound, one read of the tree. Unknown ids are left out.
 */
export async function partLabels(organizationId: string, ids: readonly (string | null)[]): Promise<Map<string, PartLabel>> {
  const wanted = new Set(ids.filter((id): id is string => Boolean(id)));
  if (!wanted.size) return new Map();
  const [all, places] = await Promise.all([
    prisma.machinePart.findMany({ where: { organizationId }, select: { id: true, parentId: true, placeId: true, name: true, isActive: true }, take: PART_LIMIT }),
    prisma.maintenancePlace.findMany({ where: { organizationId }, select: { id: true, parentId: true, name: true, level: true }, take: 2000 }),
  ]);
  const placeOf = (partId: string) => placePath(places, all.find((part) => part.id === rootOf(all, partId))?.placeId);
  return new Map(all.filter((part) => wanted.has(part.id)).map((part) => [part.id, { id: part.id, name: part.name, path: [...placeOf(part.id), ...partPath(all, part.id)].join(" › "), isActive: part.isActive }]));
}
