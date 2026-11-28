import { z } from "zod";
import type { PlacePosition } from "@/lib/workflow/place-position";

/**
 * Kartnål på plats och maskin i Underhåll (0.92.0), utan databas. En plats i Underhålls platsträd och en maskin (en rot i
 * maskinträdet) kan ha en valfri position i WGS 84 – satt på samma Lantmäterikarta som kundregistrets platser, via vår egen
 * server, eller inklistrad. En maskin utan egen position står där dess plats är ("Samma som platsen"), och en plats utan egen
 * position där platsen ovanför är. Delarna under en maskin har aldrig en egen position: de följer sin maskin.
 */

export type Positioned = { latitude: number | null; longitude: number | null };
export type PositionedPlace = { id: string; parentId: string | null; name: string } & Positioned;

const coordinate = (min: number, max: number) => z.number().finite().min(min).max(max).nullable().optional();
/** The two fields as a save sends them: null = no position (Samma som platsen), left out = unchanged. */
export const positionFields = { latitude: coordinate(-90, 90), longitude: coordinate(-180, 180) };
export const POSITION_PAIR_PROBLEM = "Ange både latitud och longitud, eller ingen av dem.";

/** Both or neither: a latitude without its longitude (or the other way round) is refused, also when one is only left out. */
export function positionProblem(value: { latitude?: number | null; longitude?: number | null }): string {
  const lat = value.latitude, lon = value.longitude;
  if (lat === undefined && lon === undefined) return "";
  if (lat === undefined || lon === undefined) return POSITION_PAIR_PROBLEM;
  if ((lat === null) !== (lon === null)) return POSITION_PAIR_PROBLEM;
  return "";
}

export const positionOf = (row: Partial<Positioned> | null | undefined): PlacePosition | null =>
  row && typeof row.latitude === "number" && typeof row.longitude === "number" ? { latitude: row.latitude, longitude: row.longitude } : null;

/**
 * The position a save leaves on the row: a part under a machine never has one; a save that leaves the fields out keeps what the
 * row has; otherwise what was sent (null clears it).
 */
export function nextPosition(current: Positioned, input: { latitude?: number | null; longitude?: number | null }, isRoot: boolean): Positioned {
  if (!isRoot) return { latitude: null, longitude: null };
  if (input.latitude === undefined || input.longitude === undefined) return { latitude: current.latitude, longitude: current.longitude };
  return { latitude: input.latitude, longitude: input.longitude };
}

/** The place's own position, else the nearest one above it; `placeId` names the place it came from. A loop or a missing parent ends the walk. */
export function placePositionUp(places: readonly PositionedPlace[], placeId: string | null | undefined): (PlacePosition & { placeId: string; placeName: string; own: boolean }) | null {
  const byId = new Map(places.map((place) => [place.id, place]));
  const seen = new Set<string>();
  let current = placeId ? byId.get(placeId) : undefined;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    const position = positionOf(current);
    if (position) return { ...position, placeId: current.id, placeName: current.name, own: current.id === placeId };
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return null;
}

export type MachinePosition = PlacePosition & { from: "machine" | "place"; placeName: string };

/** Where a machine is: its own pin, else its place's (or the nearest place above with one), else nowhere. */
export function machinePosition(machine: Positioned & { placeId: string | null }, places: readonly PositionedPlace[]): MachinePosition | null {
  const own = positionOf(machine);
  if (own) return { ...own, from: "machine", placeName: "" };
  const place = placePositionUp(places, machine.placeId);
  return place ? { latitude: place.latitude, longitude: place.longitude, from: "place", placeName: place.placeName } : null;
}

/** The words under a machine's position: its own pin, or the place it takes it from. */
export function machinePositionText(position: MachinePosition | null): string {
  if (!position) return "Ingen position. Sätt en kartnål på maskinen eller dess plats.";
  return position.from === "machine" ? "Egen kartnål." : `Samma som platsen ${position.placeName}.`;
}

/** The machines (roots) with a position, as pins: each with its own pin or its place's. */
export function machinePins<T extends Positioned & { id: string; parentId: string | null; placeId: string | null; name: string }>(machines: readonly T[], places: readonly PositionedPlace[]) {
  return machines.flatMap((machine) => {
    if (machine.parentId) return [];
    const position = machinePosition(machine, places);
    return position ? [{ id: machine.id, latitude: position.latitude, longitude: position.longitude, label: position.from === "machine" ? machine.name : `${machine.name} · ${position.placeName}`, muted: position.from === "place" }] : [];
  });
}
