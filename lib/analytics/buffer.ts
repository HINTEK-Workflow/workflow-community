import { validCounter, type AnalyticsKind } from "./catalog";

/**
 * The small counter behind the in-app statistics (2026-10-07). Counting a page view or a function is a sum in
 * memory – no database call, no wait, nothing that can fail – and the sums are written out in one go every few seconds.
 * Nothing about who did it is ever kept: only day, kind, key and a count.
 */
export type CounterRow = { day: string; kind: AnalyticsKind; key: string; count: number };

/** The most different counters held between two writes; a burst of odd keys can never grow memory without bound. */
export const BUFFER_LIMIT = 500;

export class CounterBuffer {
  private readonly sums = new Map<string, CounterRow>();
  constructor(private readonly limit = BUFFER_LIMIT) {}

  /** Adds `count` to a counter of the day; keys outside the closed lists and anything past the limit are ignored. Never throws. */
  add(day: string, kind: AnalyticsKind, key: string, count = 1) {
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !validCounter(kind, key) || !Number.isInteger(count) || count < 1) return false;
      const id = `${day}|${kind}|${key}`;
      const current = this.sums.get(id);
      if (current) current.count += count;
      else if (this.sums.size < this.limit) this.sums.set(id, { day, kind, key, count });
      else return false;
      return true;
    } catch {
      return false;
    }
  }

  get size() { return this.sums.size; }
  clear() { this.sums.clear(); }

  /** Takes everything counted so far and starts over. */
  drain(): CounterRow[] {
    const rows = [...this.sums.values()];
    this.sums.clear();
    return rows;
  }

  /** Puts rows back after a failed write, adding to anything counted meanwhile. */
  restore(rows: CounterRow[]) {
    for (const row of rows) this.add(row.day, row.kind, row.key, row.count);
  }
}
