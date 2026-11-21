import { WORK_LIST_SCOPES, WORK_LIST_VIEWS, type WorkListScope, type WorkListView } from "./workflow/work-list";

/**
 * Den gemensamma toppvisningen (2026-10-31, Documents/filterrad-inventering-2026-10-31.md): every register list has the
 * same filter bar as Uppgifter – row 1 Mina | Alla and status chips with counts, row 2 search, extra filters, sort and
 * Rader | Kort. These are the pure parts the pages, the server and the demo share; the bar itself is
 * components/list-filter-bar.tsx.
 */

/** The sort words every list uses (one word per meaning, 2026-10-31: "samma ord: Senast ändrad, Namn A–Ö"). */
export const LIST_SORT_LABEL = {
  updated: "Senast ändrad",
  due: "Närmaste datum",
  title: "Namn A–Ö",
  number: "Nummer",
  articleNo: "Artikelnummer",
  name: "Benämning A–Ö",
  balance: "Lägst saldo",
  address: "Adress",
  email: "E-post",
} as const;
export type ListSortKey = keyof typeof LIST_SORT_LABEL;
export const listSortOptions = <S extends ListSortKey>(sorts: readonly S[]) => sorts.map((value) => ({ value, label: LIST_SORT_LABEL[value] }));

/** A sort from the address or the device's memory, kept only when the list offers it; else the list's first. */
export function parseListSort<S extends string>(raw: string | null | undefined, allowed: readonly S[]): S {
  return raw != null && (allowed as readonly string[]).includes(raw) ? raw as S : allowed[0];
}

/** A chip's or a phone choice's text: "Öppna (12)", or the label alone while the count is unknown or not given. */
export const listChipText = (label: string, count: number | null | undefined) => count === null || count === undefined ? label : `${label} (${count})`;

/** How many items each filter would show (the chips' counts), with the same rule as the list itself. */
export function countByFilter<T, F extends string>(items: readonly T[], filters: readonly F[], matches: (item: T, filter: F) => boolean): Record<F, number> {
  return Object.fromEntries(filters.map((filter) => [filter, items.reduce((sum, item) => sum + (matches(item, filter) ? 1 : 0), 0)])) as Record<F, number>;
}

/** A search over a list kept in memory: every word in one of the item's texts, Swedish case-insensitive. */
export function listSearchMatches(query: string, texts: readonly (string | null | undefined)[]) {
  const words = query.trim().toLocaleLowerCase("sv-SE").split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = texts.filter(Boolean).map((text) => text!.toLocaleLowerCase("sv-SE"));
  return words.every((word) => haystack.some((text) => text.includes(word)));
}

type SortValue = string | number | null | undefined;
/**
 * One sort key of a list in memory: text in Swedish order (Å Ä Ö last, case ignored), numbers and ISO days as they are;
 * an empty value ("" or null) always last whatever the direction, so undated items never come first under Närmaste datum.
 */
export function compareListValues(a: SortValue, b: SortValue, direction: "asc" | "desc" = "asc") {
  const emptyA = a === null || a === undefined || a === "", emptyB = b === null || b === undefined || b === "";
  if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1;
  const order = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "sv-SE", { sensitivity: "base", numeric: true });
  return direction === "asc" ? order : -order;
}

/** A list sorted by its keys in turn (the first that differs decides), without changing the input. */
export function sortListItems<T>(items: readonly T[], keys: readonly { value: (item: T) => SortValue; direction?: "asc" | "desc" }[]): T[] {
  return [...items].sort((a, b) => {
    for (const key of keys) {
      const order = compareListValues(key.value(a), key.value(b), key.direction);
      if (order) return order;
    }
    return 0;
  });
}

/**
 * A page of a list ordered as two sets one after the other (Närmaste datum: the dated items first, the undated after), as
 * skip/take for each set: the server reads each set with its own order and joins them without reading anything twice.
 */
export function splitPage(firstCount: number, skip: number, take: number) {
  const first = { skip: Math.min(skip, firstCount), take: Math.max(0, Math.min(take, firstCount - skip)) };
  const second = { skip: Math.max(0, skip - firstCount), take: take - first.take };
  return { first, second };
}

/** View, sort and Mina | Alla remembered per person, list and device (as the work lists' useWorkListPrefs). */
export type ListPrefs<S extends string> = { view?: WorkListView; sort?: S; scope?: WorkListScope };
export const listPrefKey = (list: string, personId: string) => `hintek.list.${list}.${personId || "local"}`;
export function parseListPrefs<S extends string>(raw: string | null | undefined, sorts: readonly S[]): ListPrefs<S> {
  try {
    const value = JSON.parse(raw ?? "null") as Record<string, unknown> | null;
    if (!value || typeof value !== "object") return {};
    return {
      ...(WORK_LIST_VIEWS.includes(value.view as WorkListView) ? { view: value.view as WorkListView } : {}),
      ...((sorts as readonly unknown[]).includes(value.sort) ? { sort: value.sort as S } : {}),
      ...(WORK_LIST_SCOPES.includes(value.scope as WorkListScope) ? { scope: value.scope as WorkListScope } : {}),
    };
  } catch {
    return {};
  }
}
