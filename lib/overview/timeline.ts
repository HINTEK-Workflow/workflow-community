import type { PlanItem } from "./me";

/**
 * Dagens tidslinje (2026-10-29): where each timed post of a day stands. Pure, so the page and the tests read the same
 * rule. A post without an end (a round's start) lasts half an hour; posts that overlap form a group and share its width,
 * each in the first free lane.
 */
export type PlacedPost = { item: PlanItem; from: number; to: number; lane: number; lanes: number };

export const clockMinutes = (clock: string) => { const [hour, minute] = clock.split(":").map(Number); return hour * 60 + minute; };

/** The timeline always shows this many hours; "Hela dygnet" lets the person scroll through all 24 (2026-10-29). */
export const TIMELINE_HOURS = 8;

/**
 * The first hour of the eight shown – the working day: 07, or the first post's hour when the day's work starts earlier or
 * reaches past the window. Never past 16, so the window ends at midnight at most. Work at other times is seen with Hela dygnet.
 */
export function timelineStart(placed: readonly Pick<PlacedPost, "from" | "to">[]): number {
  let start = 7;
  if (placed.length) {
    const first = Math.min(...placed.map((post) => post.from));
    const last = Math.max(...placed.map((post) => post.to));
    if (first < start * 60 || last > (start + TIMELINE_HOURS) * 60) start = Math.floor(first / 60);
  }
  return Math.max(0, Math.min(24 - TIMELINE_HOURS, start));
}

/** The posts that fall wholly outside the window (they are seen with Hela dygnet). */
export const outsideWindow = (placed: readonly Pick<PlacedPost, "from" | "to">[], start: number) =>
  placed.filter((post) => post.to <= start * 60 || post.from >= (start + TIMELINE_HOURS) * 60).length;

export function placeTimed(items: readonly PlanItem[]): PlacedPost[] {
  const timed = items.filter((item) => item.start).map((item): PlacedPost => {
    const from = clockMinutes(item.start!);
    const end = item.end ? clockMinutes(item.end) : from + 30;
    return { item, from, to: Math.max(from + 15, end > from ? end : from + 30), lane: 0, lanes: 1 };
  }).sort((a, b) => a.from - b.from || b.to - a.to);
  let group: PlacedPost[] = [];
  let groupEnd = -1;
  const close = () => { const lanes = Math.max(1, ...group.map((placed) => placed.lane + 1)); for (const placed of group) placed.lanes = lanes; group = []; };
  for (const placed of timed) {
    if (placed.from >= groupEnd) { close(); groupEnd = -1; }
    const busy = new Set(group.filter((other) => other.to > placed.from).map((other) => other.lane));
    let lane = 0;
    while (busy.has(lane)) lane += 1;
    placed.lane = lane;
    group.push(placed);
    groupEnd = Math.max(groupEnd, placed.to);
  }
  close();
  return timed;
}
