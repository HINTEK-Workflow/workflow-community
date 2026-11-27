import { countByFilter, sortListItems, type ListSortKey } from "@/lib/list-filter";

/**
 * Förrådets artiklar in the shared toppvisning (2026-10-31): chips Alla | Lågt saldo | Slut with counts instead of
 * the box "Bara lågt saldo", the standard search, the sort and Rader | Kort. The store's articles are read at once (at most
 * 500, the search on the server), so the chips and the sort work on what was read. Sedan 2026-10-31 visar listan det som ligger på
 * vald plats i förvaringen, och sorteringen Artikelnummer följer förrådets eget nummer.
 */
export const STORE_FILTERS = ["all", "low", "out"] as const;
export type StoreFilter = (typeof STORE_FILTERS)[number];
export const STORE_FILTER_LABEL: Record<StoreFilter, string> = { all: "Alla", low: "Lågt saldo", out: "Slut" };
export const STORE_SORTS = ["name", "articleNo", "balance"] as const satisfies readonly ListSortKey[];
export type StoreSort = (typeof STORE_SORTS)[number];

type StoreEntry = { id: string; name: string; articleNo: string; ownNumber?: number | null; total: number; low: boolean };

/** Lågt saldo: under the article's lowest balance (the server's `low`); Slut: nothing left anywhere. */
export function storeItemMatches(item: StoreEntry, filter: StoreFilter) {
  if (filter === "low") return item.low;
  if (filter === "out") return item.total <= 0;
  return true;
}

/**
 * What lies at a chosen place in the store's tree: a balance row there or on a place under it (also zero: it has been there), or an
 * article numbered from a store in the choice that has no balance anywhere yet. Null: the whole store.
 */
export function itemsAtLocations<T extends { balances: Record<string, number>; homeStoreId?: string | null }>(items: readonly T[], locationIds: readonly string[] | null): readonly T[] {
  if (!locationIds) return items;
  const wanted = new Set(locationIds);
  return items.filter((item) => Object.keys(item.balances).some((id) => wanted.has(id)) || (!Object.keys(item.balances).length && item.homeStoreId != null && wanted.has(item.homeStoreId)));
}

/** The articles as shown and the chips' counts: Benämning A–Ö, Artikelnummer (none last) or Lägst saldo first. */
export function listStoreItems<T extends StoreEntry>(items: readonly T[], input: { filter: StoreFilter; sort: StoreSort }) {
  const byName = { value: (item: T) => item.name };
  const keys = input.sort === "articleNo" ? [{ value: (item: T) => item.ownNumber ?? null }, { value: (item: T) => item.articleNo }, byName] : input.sort === "balance" ? [{ value: (item: T) => item.total }, byName] : [byName];
  return { items: sortListItems(items.filter((item) => storeItemMatches(item, input.filter)), keys), counts: countByFilter(items, STORE_FILTERS, storeItemMatches) };
}
