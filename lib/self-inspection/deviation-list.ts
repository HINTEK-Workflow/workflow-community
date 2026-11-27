import { sortListItems, type ListSortKey } from "@/lib/list-filter";

/**
 * Avvikelser in the shared toppvisning (2026-10-31): the list's sort. Nummer (the newest first) is the default, so
 * the list keeps the order it had; Senast ändrad, Närmaste datum (Klart senast, undated last) and Namn A–Ö beside it.
 */
export const DEVIATION_SORTS = ["number", "updated", "due", "title"] as const satisfies readonly ListSortKey[];
export type DeviationSort = (typeof DEVIATION_SORTS)[number];

type SortableDeviation = { id: string; number: number; title: string; updatedAt: string; dueDate: string };

export function sortDeviations<T extends SortableDeviation>(items: readonly T[], sort: DeviationSort): T[] {
  const newest = { value: (item: T) => item.number, direction: "desc" as const };
  return sortListItems(items, sort === "updated" ? [{ value: (item: T) => item.updatedAt, direction: "desc" as const }, newest]
    : sort === "due" ? [{ value: (item: T) => item.dueDate }, newest]
    : sort === "title" ? [{ value: (item: T) => item.title }, newest]
    : [newest]);
}
