import { z } from "zod";
import { normalizePostalCode } from "@/lib/postal-code";
import { placeObjectFields, type PlaceObjectData } from "./maintenance";

/**
 * Customer facilities (2026-09-26, decision 11/D9 B): a property, switchgear or other object under a customer.
 * Projects, work orders, risk assessments and controls may be linked to one. Shared by Cloud, Local and the demo.
 *
 * Platser (2026-10-04: "gör inte plats oändligt krångligt"): the facilities are a tree under the customer with
 * optional levels. Each place has a kind from a short list, a name and a marking; the address belongs to the top level
 * (the facility) and is inherited downwards. Every place keeps the customer's id, so a link to any place is checked
 * the same way as a link to a facility always was.
 */
export const PLACE_KINDS = ["FACILITY", "BUILDING", "SPACE", "OBJECT", "OTHER"] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];
export const PLACE_KIND_LABELS: Record<PlaceKind, string> = {
  FACILITY: "Anläggning",
  BUILDING: "Byggnad/avdelning",
  SPACE: "Utrymme",
  OBJECT: "Objekt",
  OTHER: "Annat",
};
export const PLACE_KIND_HINTS: Record<PlaceKind, string> = {
  FACILITY: "Fastighet, fabrik",
  BUILDING: "Hus, hall, fabriksavdelning",
  SPACE: "Plan, rum, linje, station",
  OBJECT: "Elcentral, maskin, apparat",
  OTHER: "Något annat",
};
/**
 * Adress och objekt (2026-10-14, flera nivåer igen 2026-10-15): the top level is the address (FACILITY, carries the
 * street address); everything below it is an object (OBJECT), and an object may hold sub-objects in several levels. The
 * older kinds (byggnad, utrymme, annat) are still read and named, but a saved place gets one of the two.
 */
export function nextPlaceKind(parent: PlaceKind | null | undefined): PlaceKind {
  return parent ? "OBJECT" : "FACILITY";
}
export const PLACE_MAX_DEPTH = 12;
export const PLACE_SEPARATOR = " › ";

const coordinate = (min: number, max: number) => z.number().finite().min(min).max(max).nullable().default(null);
// The plain object (for files and replies that extend it; Zod refuses to extend a refined schema) and the checked input.
export const customerFacilityBaseSchema = z.object({
  name: z.string().trim().min(1, "Ange platsens namn.").max(160),
  kind: z.enum(PLACE_KINDS).default("FACILITY"),
  // The marking (code) moved to the work order (2026-10-24); an older file's or caller's code is left out by the parse.
  parentId: z.string().min(1).max(100).nullable().default(null),
  address: z.string().trim().max(200).default(""),
  postalCode: z.string().trim().max(20).default("").transform(normalizePostalCode),
  city: z.string().trim().max(120).default(""),
  description: z.string().trim().max(2000).default(""),
  latitude: coordinate(-90, 90),
  longitude: coordinate(-180, 180),
  // Object data (Underhåll stage 2, 2026-10-06): all optional with defaults, so older files and replies parse.
  ...placeObjectFields,
});
export const customerFacilityInputSchema = customerFacilityBaseSchema.superRefine((value, context) => {
  if ((value.latitude === null) !== (value.longitude === null)) context.addIssue({ code: "custom", path: ["latitude"], message: "Ange både latitud och longitud, eller ingen av dem." });
});
export type CustomerFacilityInput = z.input<typeof customerFacilityInputSchema>;
/** An object carries no address of its own (it is read from the address above); the kind follows the level. */
export function normalizeFacilityInput(input: z.output<typeof customerFacilityInputSchema>) {
  return input.parentId ? { ...input, kind: "OBJECT" as const, address: "", postalCode: "", city: "" } : { ...input, kind: "FACILITY" as const };
}

export type FacilityItem = {
  id: string;
  customerId: string;
  /** Older files and replies have no tree: missing means the top level. */
  parentId?: string | null;
  kind?: string;
  latitude?: number | null;
  longitude?: number | null;
  name: string;
  address: string;
  postalCode: string;
  city: string;
  description: string;
  isActive: boolean;
} & Partial<PlaceObjectData>;
type PlaceLike = Pick<FacilityItem, "id" | "name"> & Partial<Pick<FacilityItem, "parentId" | "kind" | "address" | "postalCode" | "city" | "latitude" | "longitude">>;

export const placeKindOf = (place: { kind?: string | null }): PlaceKind => (PLACE_KINDS as readonly string[]).includes(place.kind ?? "") ? place.kind as PlaceKind : "FACILITY";

/** The place's name as shown (the marking that once followed it moved to the work order, 2026-10-24). */
export function placeName(place: Pick<PlaceLike, "name">) {
  return place.name;
}

/** The chain from the top level down to the place itself; a missing or looping parent ends the chain. */
export function placeChain<T extends PlaceLike>(places: readonly T[], id: string | null | undefined): T[] {
  const byId = new Map(places.map((place) => [place.id, place]));
  const chain: T[] = [];
  let current = id ? byId.get(id) : undefined;
  while (current && chain.length < PLACE_MAX_DEPTH && !chain.includes(current)) {
    chain.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain;
}

/** "Volvo Cars › Torslandaverken › Måleriet › Linje 3 › Elcentral E12", for fields, lists and reports. */
export function placePath(places: readonly PlaceLike[], id: string | null | undefined, customerName?: string) {
  const chain = placeChain(places, id);
  return [customerName, ...chain.map(placeName)].filter(Boolean).join(PLACE_SEPARATOR);
}

/** The address that applies to a place: its own on the top level, else the nearest one above it. */
export function placeAddress<T extends PlaceLike>(places: readonly T[], id: string | null | undefined) {
  const chain = placeChain(places, id);
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const place = chain[index];
    if (place.address || place.postalCode || place.city) return { address: place.address ?? "", postalCode: place.postalCode ?? "", city: place.city ?? "" };
  }
  return { address: "", postalCode: "", city: "" };
}

/** The place's position, or the nearest one above it (an object inside a mapped facility is at least there). */
export function placePosition(places: readonly PlaceLike[], id: string | null | undefined) {
  const chain = placeChain(places, id);
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const place = chain[index];
    if (typeof place.latitude === "number" && typeof place.longitude === "number") return { latitude: place.latitude, longitude: place.longitude, own: index === chain.length - 1 };
  }
  return null;
}

/** The place and everything below it, for a place's history. */
export function placeWithDescendants(places: readonly PlaceLike[], id: string) {
  const ids = new Set([id]);
  let added = true;
  while (added) {
    added = false;
    for (const place of places) if (place.parentId && ids.has(place.parentId) && !ids.has(place.id)) { ids.add(place.id); added = true; }
  }
  return ids;
}

/** Places as a tree in the order they are shown: each parent followed by its children, by name. */
export function placeTree<T extends PlaceLike>(places: readonly T[]): { place: T; depth: number }[] {
  const ids = new Set(places.map((place) => place.id));
  const children = new Map<string | null, T[]>();
  for (const place of places) {
    const parent = place.parentId && ids.has(place.parentId) ? place.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), place]);
  }
  const rows: { place: T; depth: number }[] = [];
  const visit = (parent: string | null, depth: number) => {
    for (const place of (children.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name, "sv"))) {
      if (rows.some((row) => row.place.id === place.id) || depth >= PLACE_MAX_DEPTH) continue;
      rows.push({ place, depth });
      visit(place.id, depth + 1);
    }
  };
  visit(null, 0);
  return rows;
}

/** A parent that keeps the tree whole: the same customer, not the place itself or below it, and not too deep. */
export function placeParentError(places: readonly (PlaceLike & { customerId: string })[], input: { id?: string; customerId: string; parentId: string | null }) {
  if (!input.parentId) return null;
  const parent = places.find((place) => place.id === input.parentId);
  if (!parent || parent.customerId !== input.customerId) return "Den överordnade platsen hör till en annan kund.";
  if (input.id && placeWithDescendants(places, input.id).has(input.parentId)) return "En plats kan inte ligga under sig själv.";
  // Several levels (2026-10-15): an object may lie under an address or under another object. An address that has
  // objects stays an address, and the place with everything under it must fit within PLACE_MAX_DEPTH levels.
  const own = input.id ? places.find((place) => place.id === input.id) : undefined;
  if (own && !own.parentId && places.some((place) => place.parentId === own.id)) return "Adressen har objekt. Flytta eller ta bort dem först.";
  if (placeChain(places, input.parentId).length + (input.id ? placeSubtreeHeight(places, input.id) : 1) > PLACE_MAX_DEPTH) return `Platserna kan ligga i högst ${PLACE_MAX_DEPTH} nivåer.`;
  return null;
}

/** A place and every place under it, in the order given (the points a round's QR labels may stand at, 2026-10-22). */
export function placeSubtree<T extends Pick<PlaceLike, "id" | "parentId">>(places: readonly T[], rootId: string): T[] {
  const ids = new Set([rootId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const place of places) if (place.parentId && ids.has(place.parentId) && !ids.has(place.id)) { ids.add(place.id); grew = true; }
  }
  return places.filter((place) => ids.has(place.id));
}

/** How many levels a place and everything under it take: 1 for a place with nothing under it. */
export function placeSubtreeHeight(places: readonly PlaceLike[], id: string): number {
  const children = new Map<string, string[]>();
  for (const place of places) if (place.parentId) children.set(place.parentId, [...(children.get(place.parentId) ?? []), place.id]);
  const seen = new Set<string>();
  const height = (current: string): number => {
    if (seen.has(current)) return 0;
    seen.add(current);
    return 1 + Math.max(0, ...(children.get(current) ?? []).map(height));
  };
  return height(id);
}

/** Why a place cannot be removed (2026-10-14), or null when nothing points to it. */
export function placeInUseMessage(uses: { children?: number; projects?: number; workflowTasks?: number; controls?: number; formSchedules?: number; limitProfiles?: number; quotes?: number }) {
  if (uses.children) return `Platsen har ${uses.children} objekt under sig. Ta bort eller flytta dem först.`;
  const work = (uses.projects ?? 0) + (uses.workflowTasks ?? 0) + (uses.controls ?? 0) + (uses.quotes ?? 0);
  const parts = [work ? `${work} ${work === 1 ? "projekt, jobb eller offert" : "projekt, jobb eller offerter"}` : "", uses.formSchedules ? `${uses.formSchedules} ${uses.formSchedules === 1 ? "driftrond" : "driftronder"}` : "", uses.limitProfiles ? "gränsvärden" : ""].filter(Boolean);
  return parts.length ? `Platsen används av ${parts.join(", ")}. Pausa den i stället, så finns den kvar i rapporterna.` : null;
}

/** The address a place belongs to: itself on the top level, otherwise the top of its way. */
export function placeAddressId<T extends PlaceLike>(places: readonly T[], id: string): string {
  return placeChain(places, id)[0]?.id ?? id;
}

/** The name as compared for duplicates: trimmed, lower-case, one space between words, å/ä/ö kept (they are letters). */
export function normalizePlaceName(name: string) {
  return name.trim().toLocaleLowerCase("sv").replace(/\s+/g, " ");
}

/**
 * Dubbletter (2026-10-08): the same customer's places on the same level cannot share a name. Returns the active
 * place that already has the name – under the same parent (or both on the top level) – or null. The place itself is
 * never its own duplicate, so renaming with the same spelling passes; a paused place does not block a new one.
 */
export function duplicatePlace<T extends PlaceLike & { customerId: string; isActive?: boolean }>(places: readonly T[], input: { id?: string | null; customerId: string; parentId: string | null | undefined; name: string }): T | null {
  const wanted = normalizePlaceName(input.name);
  if (!wanted) return null;
  // Since the marking left the place (2026-10-24) two objects on the same level need names of their own ("Pump 1", "Pump 2").
  return places.find((place) => place.id !== input.id && place.customerId === input.customerId && (place.parentId ?? null) === (input.parentId ?? null)
    && place.isActive !== false && normalizePlaceName(place.name) === wanted) ?? null;
}
export const DUPLICATE_PLACE_MESSAGE = "Det finns redan en plats med det namnet här. Välj den i stället, eller ge den nya ett annat namn.";

/** "Ställverk 1, Strömgatan 1, 123 45 Elstad" – the name followed by the address, for lists, tasks and reports. */
export function facilityLabel(facility: Pick<FacilityItem, "name" | "address" | "postalCode" | "city">) {
  const place = [facility.postalCode, facility.city].filter(Boolean).join(" ");
  // A place named after its street ("Garage Elvägen 4" at Elvägen 4, or "Testvägen 12") does not repeat the street
  // (QA 2026-10-10: "Testvägen 12, Testvägen 12, 123 41 Elstad").
  const street = facility.address?.trim() ?? "";
  const named = Boolean(street && facility.name && normalizePlaceName(facility.name).includes(normalizePlaceName(street)));
  return [facility.name, named ? "" : street, place].filter(Boolean).join(", ");
}

/**
 * What reports, project facts and lists show for a place: the whole way as its name and the inherited address, in the
 * shape a single facility always had – so everything that printed a facility prints the place without changes.
 */
export function placeSummary(places: readonly PlaceLike[], id: string | null | undefined) {
  if (!id || !placeChain(places, id).length) return null;
  return { id, name: placePath(places, id), ...placeAddress(places, id), position: placePosition(places, id) };
}

/** The place's whole way with the inherited address, for reports and prefilled form fields. */
export function placeLabel(places: readonly PlaceLike[], id: string | null | undefined) {
  const chain = placeChain(places, id);
  if (!chain.length) return "";
  const address = placeAddress(places, id);
  return facilityLabel({ name: chain.map(placeName).join(PLACE_SEPARATOR), ...address });
}

/**
 * A link to a facility must match the item's customer, and a paused facility cannot be newly linked. An existing
 * link to a facility that was paused later is kept. Returns an error message, or null when the link is allowed.
 */
export function facilityLinkError(facility: Pick<FacilityItem, "customerId" | "isActive"> | null | undefined, input: { customerId: string | null | undefined; previousFacilityId?: string | null; facilityId: string }) {
  if (!facility) return "Platsen hittades inte.";
  if (!input.customerId || facility.customerId !== input.customerId) return "Platsen tillhör en annan kund. Välj kundens plats eller ingen.";
  if (!facility.isActive && input.previousFacilityId !== input.facilityId) return "Platsen är pausad och kan inte väljas.";
  return null;
}

/** A place with the places under it, for the tree that folds (Anläggningar, 2026-10-15). `descendants` counts every level below. */
export type PlaceNode<T> = { place: T; children: PlaceNode<T>[]; descendants: number };

/**
 * The customer's places as nested nodes, in the same order as placeTree (by name, a place whose parent is missing on the
 * top level, never deeper than PLACE_MAX_DEPTH and never a place twice).
 */
export function placeForest<T extends PlaceLike>(places: readonly T[]): PlaceNode<T>[] {
  const ids = new Set(places.map((place) => place.id));
  const children = new Map<string | null, T[]>();
  for (const place of places) {
    const parent = place.parentId && ids.has(place.parentId) ? place.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), place]);
  }
  const seen = new Set<string>();
  const build = (parent: string | null, depth: number): PlaceNode<T>[] => (children.get(parent) ?? [])
    .slice().sort((a, b) => a.name.localeCompare(b.name, "sv"))
    .filter((place) => !seen.has(place.id) && depth < PLACE_MAX_DEPTH && (seen.add(place.id), true))
    .map((place) => { const below = build(place.id, depth + 1); return { place, children: below, descendants: below.reduce((sum, node) => sum + 1 + node.descendants, 0) }; });
  return build(null, 0);
}
