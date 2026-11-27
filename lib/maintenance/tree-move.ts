import { moveProblem, type PartRow } from "./model";
import { PLACE_ALL, PLACE_NONE, placeProblem, type PlaceRow } from "./place-model";

/**
 * Hela trädet i Underhåll (2026-11-02): platser, maskiner och delar i ett träd, utan databas. Dra och släpp är ett
 * komplement till Flytta och går genom samma regler och samma åtgärder (`update_part`, `update_place`), så det som sägs här sägs
 * också av servern. Flytta finns kvar för pekskärm och tangentbord.
 */

export type WholeTreeKind = "place" | "machine" | "part" | "none";
export type WholeTreeItem = { id: string; parentId: string | null; name: string; treeKind: WholeTreeKind };

type TreePart = { id: string; parentId: string | null; placeId: string | null; name: string };

/** A machine lies under its place, or under Utan plats (a row of its own) when it has none; a part lies under what it lies under. */
export function wholeTreeParent(part: Pick<TreePart, "parentId" | "placeId">, placeIds: ReadonlySet<string>) {
  if (part.parentId) return part.parentId;
  return part.placeId && placeIds.has(part.placeId) ? part.placeId : PLACE_NONE;
}

/** The places that hold something shown (search and Driftstatus): a place with nothing to show leaves the tree while filtering. */
export function placesHolding<T extends { id: string; parentId: string | null }>(places: readonly T[], placeIds: Iterable<string | null>): T[] {
  const byId = new Map(places.map((place) => [place.id, place]));
  const keep = new Set<string>();
  for (const id of placeIds) {
    let current = id ? byId.get(id) : undefined;
    while (current && !keep.has(current.id)) {
      keep.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }
  return places.filter((place) => keep.has(place.id));
}

/** Everything above a row in the tree, nearest first: what must be folded out for the row to be seen. */
export function treeAncestors(rows: readonly { id: string; parentId: string | null }[], id: string): string[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let parent = byId.get(id)?.parentId ?? null;
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    out.push(parent);
    parent = byId.get(parent)?.parentId ?? null;
  }
  return out;
}

export type TreeDrop =
  | { act: "same" }
  | { act: "refuse"; reason: string }
  | { act: "part"; parentId: string | null; placeId: string | null }
  | { act: "place"; parentId: string | null };

/**
 * What a row dropped on another row means, by the rules Flytta and the server use:
 * - a machine or part on a place, or on Utan plats: it becomes a machine there;
 * - a machine or part on a machine or part: it lies under it, its place gone (it follows its machine);
 * - a place on a place: it lies under it, on Alla platser: at the top. Its level stays, so a level that does not fit says so.
 */
export function planTreeDrop(input: { parts: readonly (PartRow & Pick<TreePart, "placeId">)[]; places: readonly PlaceRow[]; dragged: WholeTreeItem; targetId: string }): TreeDrop {
  const { parts, places, dragged, targetId } = input;
  if (dragged.id === targetId) return { act: "same" };
  const targetPlace = places.find((place) => place.id === targetId) ?? null;
  const targetPart = parts.find((part) => part.id === targetId) ?? null;
  if (dragged.treeKind === "place") {
    const place = places.find((row) => row.id === dragged.id);
    if (!place) return { act: "refuse", reason: "Platsen hittades inte." };
    if (targetPart) return { act: "refuse", reason: "En plats kan inte ligga under en maskin." };
    if (targetId === PLACE_NONE) return { act: "refuse", reason: "Utan plats är till för maskiner." };
    const parentId = targetId === PLACE_ALL ? null : targetPlace ? targetPlace.id : undefined;
    if (parentId === undefined) return { act: "refuse", reason: "Platsen hittades inte." };
    if (place.parentId === parentId) return { act: "same" };
    const problem = placeProblem(places, place.id, { parentId, level: place.level });
    return problem ? { act: "refuse", reason: problem } : { act: "place", parentId };
  }
  const part = parts.find((row) => row.id === dragged.id);
  if (!part) return { act: "refuse", reason: "Delen hittades inte." };
  if (targetId === PLACE_ALL) return { act: "refuse", reason: "Välj en plats att flytta till." };
  if (targetId === PLACE_NONE || targetPlace) {
    const placeId = targetPlace?.id ?? null;
    return !part.parentId && part.placeId === placeId ? { act: "same" } : { act: "part", parentId: null, placeId };
  }
  if (!targetPart) return { act: "refuse", reason: "Den överordnade delen hittades inte." };
  if (part.parentId === targetPart.id) return { act: "same" };
  const problem = moveProblem(parts, part.id, targetPart.id);
  return problem ? { act: "refuse", reason: problem } : { act: "part", parentId: targetPart.id, placeId: null };
}

/**
 * The body of `update_part` for a move: the part's own fields as they are, the customer only on a machine, and no run hours, since
 * a save that leaves them out keeps them. Flytta and a drop send the same.
 */
export function moveBody(part: { customerId: string | null; name: string; partType: string; marking: string; status: string; notes: string; isActive: boolean }, target: { parentId: string | null; placeId: string | null }) {
  return { parentId: target.parentId, placeId: target.placeId, customerId: target.parentId ? null : part.customerId, name: part.name, partType: part.partType, marking: part.marking, status: part.status, notes: part.notes, isActive: part.isActive };
}
