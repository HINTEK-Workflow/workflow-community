import { countByFilter, listSearchMatches } from "@/lib/list-filter";
import { PART_STATUS_LABELS, PART_STATUSES, type PartStatus } from "@/lib/maintenance/model";

/**
 * Sök och Driftstatus i maskinträdet (2026-10-31, toppvisningen): a filter that fits a tree. A part that matches is
 * shown together with the parts above it, so it keeps its place in the tree; the chips count the parts that match the
 * search themselves, not the parts above them. Display only, on the tree already read.
 */
export const PART_FILTERS = ["all", "REPORTED", ...PART_STATUSES] as const;
export type PartFilter = (typeof PART_FILTERS)[number];
export const PART_FILTER_LABEL: Record<PartFilter, string> = { all: "Alla", REPORTED: "Felanmäld", ...PART_STATUS_LABELS };

type TreePart = { id: string; parentId: string | null; name: string; partType: string; marking: string; status: PartStatus; reported?: number };

export const partStatusMatches = (part: { status: PartStatus; reported?: number }, filter: PartFilter) => filter === "all" || (filter === "REPORTED" ? (part.reported ?? 0) > 0 : part.status === filter);

export function filterPartTree<T extends TreePart>(parts: readonly T[], input: { filter: PartFilter; q: string }) {
  const found = input.q.trim() ? parts.filter((part) => listSearchMatches(input.q, [part.name, part.partType, part.marking])) : parts;
  const counts = countByFilter(found, PART_FILTERS, partStatusMatches);
  const filtering = input.filter !== "all" || Boolean(input.q.trim());
  if (!filtering) return { shown: parts, counts, filtering, matched: new Set<string>() };
  const byId = new Map(parts.map((part) => [part.id, part]));
  const keep = new Set<string>();
  const matched = new Set<string>();
  for (const part of found) {
    if (!partStatusMatches(part, input.filter)) continue;
    matched.add(part.id);
    // Upwards until a part already kept: that part's own way up is kept too, and it also ends a looping parent.
    let current: T | undefined = part;
    while (current && !keep.has(current.id)) {
      keep.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }
  return { shown: parts.filter((part) => keep.has(part.id)), counts, filtering, matched };
}
