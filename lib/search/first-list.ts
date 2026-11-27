/**
 * Sök på mobilen (2026-10-09): the first list is short – at most this many hits in all, and at most
 * FIRST_LIST_PER_GROUP of each kind – with "Visa alla träffar" for the rest; on a wider screen five per kind as before.
 */
export const FIRST_LIST_LIMIT = 8;
export const FIRST_LIST_PER_GROUP = 3;

/** The groups cut to at most `perGroup` hits each and `limit` in all, keeping each group's heading, order and count. */
export function firstList<G extends { hits: unknown[] }>(groups: G[], limit: number, perGroup = FIRST_LIST_PER_GROUP): G[] {
  let left = limit;
  return groups.map((group) => { const hits = group.hits.slice(0, Math.max(0, Math.min(left, perGroup))); left -= hits.length; return { ...group, hits }; }).filter((group) => group.hits.length > 0);
}

/** Whether the first list leaves anything out. */
export const firstListCuts = <G extends { hits: unknown[] }>(groups: G[], limit = FIRST_LIST_LIMIT, perGroup = FIRST_LIST_PER_GROUP) =>
  groups.reduce((sum, group) => sum + group.hits.length, 0) > firstList(groups, limit, perGroup).reduce((sum, group) => sum + group.hits.length, 0);
