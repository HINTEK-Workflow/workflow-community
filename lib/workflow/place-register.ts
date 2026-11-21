import { z } from "zod";
import type { ListSortKey } from "@/lib/list-filter";
import { placeKindOf, placePath, type FacilityItem } from "./customer-facility";
import { OPERATING_STATES } from "./maintenance";

/**
 * The register of places as cards (2026-10-06, Underhåll stage 3: "kort och flikar i stället för en lång
 * lista"): the customer card's Anläggningar tab and the company-wide Alla objekt. One filter, one order and one page
 * size for Cloud (in PostgreSQL), Local and the demo (these pure functions on the places they hold). Alla objekt has the
 * shared toppvisning (2026-10-31): Nivå and Driftstatus as chips with counts, the search, the sort and Rader | Kort.
 */
export const PLACE_REGISTER_PAGE = 12;
export const PLACE_LEVELS = ["top", "objects", "all"] as const;
export type PlaceLevel = (typeof PLACE_LEVELS)[number];
export const PLACE_LEVEL_LABELS: Record<PlaceLevel, string> = { top: "Anläggningar", objects: "Objekt", all: "Alla nivåer" };

/** The toppvisning (2026-10-31): the sort uses the lists' own words; Driftstatus as chips, "all" for no choice. */
export const PLACE_SORTS = ["title", "updated"] as const satisfies readonly ListSortKey[];
export type PlaceSort = (typeof PLACE_SORTS)[number];
export const PLACE_STATE_FILTERS = ["all", ...OPERATING_STATES] as const;
export type PlaceStateFilter = (typeof PLACE_STATE_FILTERS)[number];

export const placeRegisterFilterSchema = z.object({
  level: z.enum(PLACE_LEVELS).default("top"),
  objectType: z.string().trim().max(80).default(""),
  state: z.union([z.literal(""), z.enum(OPERATING_STATES)]).default(""),
  q: z.string().trim().max(100).default(""),
  sort: z.enum(PLACE_SORTS).default("title"),
});
export type PlaceRegisterFilter = z.infer<typeof placeRegisterFilterSchema>;
export const emptyPlaceRegisterFilter = (): PlaceRegisterFilter => ({ level: "top", objectType: "", state: "", q: "", sort: "title" });
/** A maintenance filter only makes sense below the top level, so choosing one shows every level. */
export const placeRegisterNarrowed = (filter: PlaceRegisterFilter) => Boolean(filter.objectType || filter.state);

type RegisterPlace = Pick<FacilityItem, "id" | "name" | "isActive"> & Partial<FacilityItem> & { updatedAt?: string | Date | null };

export function placeRegisterMatches(place: RegisterPlace, filter: PlaceRegisterFilter) {
  const kind = placeKindOf(place);
  if (filter.level === "top" && place.parentId) return false;
  if (filter.level === "objects" && kind !== "OBJECT") return false;
  if (filter.objectType && (place.objectType ?? "").toLocaleLowerCase("sv-SE") !== filter.objectType.toLocaleLowerCase("sv-SE")) return false;
  if (filter.state && place.operatingState !== filter.state) return false;
  const needle = filter.q.toLocaleLowerCase("sv-SE");
  if (needle && ![place.name, place.objectType, place.manufacturer, place.model, place.serialNumber, place.description]
    .some((value) => (value ?? "").toLocaleLowerCase("sv-SE").includes(needle))) return false;
  return true;
}

/** Active first, then by name – the same order as the server's Alla objekt. */
export function comparePlaces<T extends { place: RegisterPlace; path: string }>(left: T, right: T) {
  return Number(right.place.isActive) - Number(left.place.isActive)
    || left.place.name.localeCompare(right.place.name, "sv-SE", { sensitivity: "base" })
    || left.path.localeCompare(right.path, "sv-SE", { sensitivity: "base" })
    || left.place.id.localeCompare(right.place.id);
}

const stamp = (place: RegisterPlace) => place.updatedAt ? new Date(place.updatedAt).getTime() : 0;

/** Local, the demo and the customer card: filter, order and page in memory. Each item has its way and child count. */
export function listPlaceRegister<T extends RegisterPlace & { customerId: string }>(places: readonly T[], filter: PlaceRegisterFilter, page = 1, limit = PLACE_REGISTER_PAGE) {
  const children = new Map<string, number>();
  for (const place of places) if (place.parentId) children.set(place.parentId, (children.get(place.parentId) ?? 0) + 1);
  const matching = places.filter((place) => placeRegisterMatches(place, filter))
    .map((place) => ({ place, path: placePath(places, place.id), children: children.get(place.id) ?? 0 }))
    .sort(filter.sort === "updated" ? (left, right) => stamp(right.place) - stamp(left.place) || comparePlaces(left, right) : comparePlaces);
  const current = Math.max(1, page);
  return { items: matching.slice(0, current * limit), total: matching.length, page: current, pages: Math.max(1, Math.ceil(matching.length / limit)) };
}

/**
 * The level a choice of Driftstatus lands on: a maintenance filter on the top level would hide everything, so choosing one
 * shows every level. The state chips count what a click on them shows.
 */
export const placeStateLevel = (level: PlaceLevel): PlaceLevel => level === "top" ? "all" : level;

/** The chips' counts with the other filters applied: every place that matches, never only the page that was read. */
export function placeRegisterCounts(places: readonly RegisterPlace[], filter: PlaceRegisterFilter) {
  const count = (next: PlaceRegisterFilter) => places.reduce((sum, place) => sum + (placeRegisterMatches(place, next) ? 1 : 0), 0);
  return {
    level: Object.fromEntries(PLACE_LEVELS.map((level) => [level, count({ ...filter, level })])) as Record<PlaceLevel, number>,
    state: Object.fromEntries(PLACE_STATE_FILTERS.map((state) => [state, state === "all" ? count({ ...filter, state: "" }) : count({ ...filter, state, level: placeStateLevel(filter.level) })])) as Record<PlaceStateFilter, number>,
  };
}

/** The company's own object types, for the filter and the field's suggestions. */
export function objectTypeOptions(places: readonly { objectType?: string }[]) {
  const seen = new Map<string, string>();
  for (const place of places) {
    const value = place.objectType?.trim();
    if (value && !seen.has(value.toLocaleLowerCase("sv-SE"))) seen.set(value.toLocaleLowerCase("sv-SE"), value);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "sv-SE"));
}
