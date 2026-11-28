import { z } from "zod";
import type { PartStatus } from "./model";
import { positionFields, positionProblem } from "./location";

/**
 * Underhåll i två träd (2026-10-31), utan databas. Träd 1 "Platser": Ort › Anläggning › Område › Avdelning, ett eget
 * träd skilt från kundregistret, bara de nivåer företaget behöver. Träd 2 "Utrustning": Maskin › Komponent › Del (delar kan ha
 * delar): MachinePart, där nivån följer djupet. Varje maskin står på en plats; utan plats visas den under Utan plats. Sämsta
 * status syns uppåt: en felanmäld del gör maskinen Felanmäld (med antal) och platsen visar att något där har fel, medan delarna
 * behåller sin egen status. "Reservdel" gäller bara förrådet och "Objekt" används inte som nivånamn.
 */

export const PLACE_LEVELS = ["CITY", "SITE", "AREA", "DEPARTMENT"] as const;
export type PlaceLevel = (typeof PLACE_LEVELS)[number];
export const PLACE_LEVEL_LABELS: Record<PlaceLevel, string> = { CITY: "Ort", SITE: "Anläggning", AREA: "Område", DEPARTMENT: "Avdelning" };
export const placeLevelOf = (value: string): PlaceLevel => (PLACE_LEVELS as readonly string[]).includes(value) ? value as PlaceLevel : "SITE";
export const PLACE_LIMIT = 2000;

/** The choice "Alla platser" and the machines that stand on no place: values in the address, never rows. */
export const PLACE_ALL = "all";
export const PLACE_NONE = "none";

const id = z.string().trim().min(1).max(100);
export const placeInputSchema = z.object({
  parentId: id.nullable().default(null),
  name: z.string().trim().min(1, "Skriv ett namn.").max(120),
  level: z.enum(PLACE_LEVELS).default("SITE"),
  notes: z.string().trim().max(2000).default(""),
  /** Kartnål (0.92.0): null = none (the place above's is shown), left out = unchanged (a drag in the tree sends none). */
  ...positionFields,
}).superRefine((value, context) => { const problem = positionProblem(value); if (problem) context.addIssue({ code: "custom", path: ["latitude"], message: problem }); });
export type PlaceInput = z.output<typeof placeInputSchema>;

export type PlaceRow = { id: string; parentId: string | null; name: string; level: string };
export type PlaceListItem = PlaceRow & { level: PlaceLevel; notes: string; version: number; latitude: number | null; longitude: number | null };

const levelIndex = (level: string) => PLACE_LEVELS.indexOf(placeLevelOf(level));

/** The levels a new place may have under `parent`: every level deeper than the parent's (a level may be skipped). */
export const placeLevelsUnder = (parent: { level: string } | null): PlaceLevel[] => parent ? PLACE_LEVELS.slice(levelIndex(parent.level) + 1) : [...PLACE_LEVELS];
/** The level a new place starts on: the next one under the parent; at the top, Anläggning (Ort is only for those who need it). */
export const nextPlaceLevel = (parent: { level: string } | null): PlaceLevel | null => parent ? placeLevelsUnder(parent)[0] ?? null : "SITE";

/** The names from the top down to the place, the place's own last; a missing or looping parent ends it. */
export function placePath(places: readonly PlaceRow[], placeId: string | null | undefined): string[] {
  const byId = new Map(places.map((place) => [place.id, place]));
  const names: string[] = [];
  const seen = new Set<string>();
  let current = placeId ? byId.get(placeId) : undefined;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return names;
}

/** The place and every place under it. */
export function placeSubtree(places: readonly PlaceRow[], placeId: string): string[] {
  const children = new Map<string, string[]>();
  for (const place of places) if (place.parentId) children.set(place.parentId, [...(children.get(place.parentId) ?? []), place.id]);
  const out: string[] = [];
  const seen = new Set<string>();
  const stack = [placeId];
  while (stack.length) {
    const next = stack.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    out.push(next);
    stack.push(...(children.get(next) ?? []));
  }
  return out;
}

/**
 * Whether the place may have this parent and level: not under itself, always deeper than the parent, and every place under it
 * still deeper than it. The reason in words, or "".
 */
export function placeProblem(places: readonly PlaceRow[], placeId: string | null, input: { parentId: string | null; level: string }): string {
  const parent = input.parentId ? places.find((place) => place.id === input.parentId) ?? null : null;
  if (input.parentId && !parent) return "Den överordnade platsen hittades inte.";
  if (placeId && input.parentId && placeSubtree(places, placeId).includes(input.parentId)) return "En plats kan inte ligga under sig själv.";
  if (parent && levelIndex(input.level) <= levelIndex(parent.level)) return `En ${PLACE_LEVEL_LABELS[placeLevelOf(input.level)].toLowerCase()} kan inte ligga under en ${PLACE_LEVEL_LABELS[placeLevelOf(parent.level)].toLowerCase()}.`;
  if (placeId && places.some((place) => place.parentId === placeId && levelIndex(place.level) <= levelIndex(input.level))) return "Platserna under ska ligga på en lägre nivå. Flytta dem först.";
  return "";
}

// ---------- Utrustning: the level follows the depth ----------

export const partLevelName = (depth: number) => depth <= 0 ? "Maskin" : depth === 1 ? "Komponent" : "Del";
/** What a new row under a part of this depth is called. */
export const childLevelName = (depth: number) => partLevelName(depth + 1);

// ---------- the worst status upwards ----------

export const WORST_STATUSES = ["OUT_OF_SERVICE", "REPORTED", "SERVICE_SOON", "IN_SERVICE", "DECOMMISSIONED"] as const;
export type WorstStatus = (typeof WORST_STATUSES)[number];
export type StatusTone = "success" | "warning" | "danger" | "neutral";

export type RollupPart = { id: string; parentId: string | null; status: PartStatus; isActive: boolean; reported: number };
export type PartRollup = {
  /** Open fault reports on the part itself and everything under it. */
  reported: number;
  /** Parts out of service, the part itself included. */
  outOfService: number;
  serviceSoon: number;
  worst: WorstStatus;
};

const worstOf = (row: { reported: number; outOfService: number; serviceSoon: number }, own: PartStatus): WorstStatus =>
  row.outOfService ? "OUT_OF_SERVICE" : row.reported ? "REPORTED" : row.serviceSoon ? "SERVICE_SOON" : own === "DECOMMISSIONED" ? "DECOMMISSIONED" : "IN_SERVICE";

/**
 * Each part's sum of itself and everything under it. A paused or decommissioned part shows its own status on its own card but
 * tells nothing upwards: it is not in use. A looping parent ends the walk.
 */
export function partRollups(parts: readonly RollupPart[]): Map<string, PartRollup> {
  const byId = new Map(parts.map((part) => [part.id, part]));
  const children = new Map<string, RollupPart[]>();
  for (const part of parts) if (part.parentId && byId.has(part.parentId)) children.set(part.parentId, [...(children.get(part.parentId) ?? []), part]);
  const done = new Map<string, PartRollup>();
  const walk = (part: RollupPart, path: Set<string>): PartRollup => {
    const known = done.get(part.id);
    if (known) return known;
    const sum = { reported: part.reported, outOfService: part.status === "OUT_OF_SERVICE" ? 1 : 0, serviceSoon: part.status === "SERVICE_SOON" ? 1 : 0 };
    path.add(part.id);
    for (const child of children.get(part.id) ?? []) {
      if (path.has(child.id)) continue;
      const below = walk(child, path);
      if (!child.isActive || child.status === "DECOMMISSIONED") continue;
      sum.reported += below.reported;
      sum.outOfService += below.outOfService;
      sum.serviceSoon += below.serviceSoon;
    }
    path.delete(part.id);
    const result = { ...sum, worst: worstOf(sum, part.status) };
    done.set(part.id, result);
    return result;
  };
  for (const part of parts) walk(part, new Set());
  return done;
}

export type PlaceRollup = { machines: number; reported: number; outOfService: number; serviceSoon: number; worst: WorstStatus };
const noMachines = (): PlaceRollup => ({ machines: 0, reported: 0, outOfService: 0, serviceSoon: 0, worst: "IN_SERVICE" });

/** A place's sum of the machines on it and on every place under it. Keyed by place id, PLACE_ALL and PLACE_NONE as well. */
export function placeRollups(places: readonly PlaceRow[], machines: readonly { id: string; placeId: string | null; isActive: boolean; status: PartStatus; rollup: PartRollup }[]): Map<string, PlaceRollup> {
  const byId = new Map(places.map((place) => [place.id, place]));
  const out = new Map<string, PlaceRollup>(places.map((place) => [place.id, noMachines()]));
  out.set(PLACE_ALL, noMachines());
  out.set(PLACE_NONE, noMachines());
  const add = (key: string, machine: (typeof machines)[number]) => {
    const row = out.get(key)!;
    row.machines += 1;
    if (!machine.isActive || machine.status === "DECOMMISSIONED") return;
    row.reported += machine.rollup.reported;
    row.outOfService += machine.rollup.outOfService;
    row.serviceSoon += machine.rollup.serviceSoon;
    row.worst = worstOf(row, "IN_SERVICE");
  };
  for (const machine of machines) {
    add(PLACE_ALL, machine);
    if (!machine.placeId || !byId.has(machine.placeId)) { add(PLACE_NONE, machine); continue; }
    const seen = new Set<string>();
    let current = byId.get(machine.placeId);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      add(current.id, machine);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }
  return out;
}

/** The short words a rollup shows: at most two, the worst first. Nothing when all is well. */
export function rollupBadges(row: { reported: number; outOfService: number; serviceSoon: number }): { label: string; tone: StatusTone }[] {
  const badges: { label: string; tone: StatusTone }[] = [];
  if (row.outOfService) badges.push({ label: row.outOfService > 1 ? `Ur drift (${row.outOfService})` : "Ur drift", tone: "danger" });
  if (row.reported) badges.push({ label: row.reported > 1 ? `Felanmäld (${row.reported})` : "Felanmäld", tone: "warning" });
  if (!badges.length && row.serviceSoon) badges.push({ label: row.serviceSoon > 1 ? `Service snart (${row.serviceSoon})` : "Service snart", tone: "warning" });
  return badges;
}

/** The choice in the place tree: from the address when it is known, else the place of the chosen machine, else every place. */
export function placeChoice(param: string | null, places: readonly { id: string }[], machinePlaceId: string | null | undefined): string {
  const known = (id: string | null | undefined) => places.some((place) => place.id === id);
  if (param && (param === PLACE_ALL || param === PLACE_NONE || known(param))) return param;
  if (machinePlaceId === undefined) return PLACE_ALL;
  return machinePlaceId && known(machinePlaceId) ? machinePlaceId : PLACE_NONE;
}

/** The machines at a choice in the place tree: everything (PLACE_ALL), those on no place (PLACE_NONE), or the place and below. */
export function machinesAt<T extends { parentId: string | null; placeId: string | null }>(parts: readonly T[], places: readonly PlaceRow[], choice: string): T[] {
  const machines = parts.filter((part) => !part.parentId);
  if (choice === PLACE_ALL) return machines;
  const known = new Set(places.map((place) => place.id));
  if (choice === PLACE_NONE) return machines.filter((part) => !part.placeId || !known.has(part.placeId));
  const wanted = new Set(placeSubtree(places, choice));
  return machines.filter((part) => part.placeId !== null && wanted.has(part.placeId));
}
