import { countByFilter, listSearchMatches, sortListItems, type ListSortKey } from "@/lib/list-filter";
import { occurrenceHandled, type ScheduleOccurrenceState } from "./form-schedule";
import type { WorkListScope } from "./work-list";

/**
 * Driftronder in the shared toppvisning (2026-10-31): Mina | Alla (a round has a responsible), chips with counts,
 * a search, the sort and Rader | Kort. The rounds are all read at once (the company's rounds, bounded by the server), so the
 * page filters, counts and sorts them here with these rules.
 */
// Alla last (Lika är rätt, 2026-11-13), as on Arbetsordrar and Inköp: right after Mina | Alla the word stood twice.
export const ROUND_FILTERS = ["attention", "today", "missed", "paused", "all"] as const;
export type RoundFilter = (typeof ROUND_FILTERS)[number];
export const ROUND_FILTER_LABEL: Record<RoundFilter, string> = { all: "Alla", attention: "Behöver åtgärd", today: "Idag", missed: "Missade", paused: "Pausade" };
export const ROUND_SORTS = ["due", "title", "updated"] as const satisfies readonly ListSortKey[];
export type RoundSort = (typeof ROUND_SORTS)[number];

/** What the rules read of a round (ScheduleView has it all). */
export type RoundListEntry = {
  id: string; title: string; active: boolean; assignedToUserId?: string | null; assignedToName?: string; templateName?: string; ruleText?: string; updatedAt?: string;
  overview: { today: Pick<ScheduleOccurrenceState, "state"> | null; missed: number; notDone?: number; openDeviations?: number; current: { date: string } | null; next: string | null };
};

/**
 * Behöver åtgärd (the dashboard's `&attention=1`, 2026-10-28): an active round with a missed or Ej utfört occasion, a fault
 * without a work order, or today's occasion not handled yet.
 */
export function roundNeedsAttention(round: RoundListEntry) {
  const { overview } = round;
  return round.active && Boolean(overview.missed || overview.notDone || overview.openDeviations || (overview.today && !occurrenceHandled(overview.today)));
}

export function roundMatches(round: RoundListEntry, filter: RoundFilter) {
  switch (filter) {
    case "all": return true;
    case "attention": return roundNeedsAttention(round);
    case "today": return round.active && Boolean(round.overview.today && !occurrenceHandled(round.overview.today));
    case "missed": return round.active && round.overview.missed > 0;
    case "paused": return !round.active;
  }
}

/** Mina: the rounds I am responsible for. */
export const isMyRound = (round: Pick<RoundListEntry, "assignedToUserId">, personId: string) => Boolean(personId) && round.assignedToUserId === personId;

/** The day a round is next to be done: the occasion to do now, else the next one; none for a paused or ended round. */
export const roundDueDay = (round: RoundListEntry) => round.active ? round.overview.current?.date ?? round.overview.next ?? null : null;

/**
 * The list as shown: scope, search, chips' counts (with the same scope and search) and the order – Närmaste datum (undated
 * last), Namn A–Ö or Senast ändrad; the name breaks ties.
 */
export function listRounds<T extends RoundListEntry>(rounds: readonly T[], input: { scope: WorkListScope | null; personId: string; filter: RoundFilter; q: string; sort: RoundSort; where?: (round: T) => string }) {
  const base = rounds.filter((round) => (input.scope !== "mine" || isMyRound(round, input.personId))
    && listSearchMatches(input.q, [round.title, round.templateName, round.ruleText, round.assignedToName, input.where?.(round)]));
  const counts = countByFilter(base, ROUND_FILTERS, roundMatches);
  const byName = { value: (round: T) => round.title };
  const items = sortListItems(base.filter((round) => roundMatches(round, input.filter)),
    input.sort === "title" ? [byName] : input.sort === "updated" ? [{ value: (round: T) => round.updatedAt ?? "", direction: "desc" as const }, byName] : [{ value: roundDueDay }, byName]);
  return { items, counts };
}
