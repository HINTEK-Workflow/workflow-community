import { swedishDayKey } from "@/lib/swedish-time";
import { CounterBuffer, type CounterRow } from "./buffer";
import { LANDING_REF_DAY_LIMIT, featureForRequest, pageKey, type AnalyticsKind } from "./catalog";
import { notCounted, type CountingSubject } from "./exclusion";
import { getAnalyticsSettings } from "./settings";
import { writeCounters } from "./store";

/**
 * Counting in the app (2026-10-07): a page view or a function used adds one to a counter held in memory, and the
 * counters are written to the database every few seconds. Counting never waits, never throws and never changes what a
 * request answers; if the database is unavailable the counts of that moment are simply lost. No person, company,
 * address or browser is involved – see lib/analytics/catalog.ts.
 */
const FLUSH_EVERY_MS = 20_000;
type Holder = { buffer: CounterBuffer; timer: ReturnType<typeof setInterval> | null; flushing: boolean };
const holder: Holder = ((globalThis as { __wfAnalytics?: Holder }).__wfAnalytics ??= { buffer: new CounterBuffer(), timer: null, flushing: false });

/** Writes what has been counted, unless the counting is switched off (then it is dropped). */
export async function flushAnalytics() {
  if (holder.flushing) return;
  holder.flushing = true;
  const rows: CounterRow[] = holder.buffer.drain();
  try {
    if (!rows.length) return;
    const settings = await getAnalyticsSettings();
    if (!settings.usage) return;
    try { await writeCounters(rows); } catch { holder.buffer.restore(rows); }
  } catch {
    // Counting must never be the reason for a problem.
  } finally {
    holder.flushing = false;
  }
}

function ensureTimer() {
  if (holder.timer) return;
  holder.timer = setInterval(() => { void flushAnalytics(); }, FLUSH_EVERY_MS);
  // The timer alone never keeps a process alive.
  holder.timer.unref?.();
}

function count(kind: AnalyticsKind, key: string) {
  try {
    if (holder.buffer.add(swedishDayKey(new Date()), kind, key)) ensureTimer();
  } catch {
    // never throws
  }
}

/**
 * A page of the app was opened (`view` is one the app has already accepted). `who`: the installation's own people and a
 * browser the owner switched off are not counted (lib/analytics/exclusion.ts).
 */
export function recordPageView(view: string | null | undefined, taskType?: string | null, who?: CountingSubject | null) {
  if (notCounted(who)) return;
  const key = pageKey(view, taskType);
  if (key) count("page", key);
}

/** A function was used; keys outside the list are ignored. `who` as for recordPageView (a request context carries it). */
export function recordFeature(key: string, who?: CountingSubject | null) {
  if (notCounted(who)) return;
  count("feature", key);
}

/** A step in the public demo (fixed keys only, lib/analytics/catalog.ts); nothing about the visitor. */
export function recordDemoEvent(key: string, who?: CountingSubject | null) {
  if (!notCounted(who)) count("demo", key);
}

// The referring domains seen today, so a day can never hold more than LANDING_REF_DAY_LIMIT of them (the rest: ref:other).
const referrers: { day: string; seen: Set<string> } = ((globalThis as { __wfLandingRefs?: { day: string; seen: Set<string> } }).__wfLandingRefs ??= { day: "", seen: new Set() });

/** Something on the public website (fixed keys, lib/analytics/catalog.ts): a page, a button, a device group or a referrer. */
export function recordLandingEvent(key: string, who?: CountingSubject | null) {
  if (notCounted(who)) return;
  try {
    let counted = key;
    if (key.startsWith("ref:") && key !== "ref:none" && key !== "ref:other") {
      const today = swedishDayKey(new Date());
      if (referrers.day !== today) { referrers.day = today; referrers.seen = new Set(); }
      if (!referrers.seen.has(key) && referrers.seen.size >= LANDING_REF_DAY_LIMIT) counted = "ref:other";
      else referrers.seen.add(key);
    }
    count("landing", counted);
  } catch {
    // never throws
  }
}

/** A changing request: counted as the function its address belongs to, unless `who` is not counted. */
export function recordRequestUsage(request: Request, who?: CountingSubject | null) {
  try {
    if (notCounted(who ?? { cookie: request.headers.get("cookie") })) return;
    recordUsage(request.method, new URL(request.url).pathname);
  } catch {
    // never throws
  }
}

/** The same from a method and a path (context() reads them from the headers the proxy sets). */
export function recordUsage(method: string, pathname: string) {
  try {
    const key = featureForRequest(method, pathname);
    if (key) count("feature", key);
  } catch {
    // never throws
  }
}

/** Drops what has been counted but not yet written (after "Nollställ", so nothing old is written back). */
export function discardPendingCounts() {
  holder.buffer.clear();
}
