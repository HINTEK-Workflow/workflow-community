/**
 * Spelarens regler (Tavlor och skärmar, 2026-11-18): small pure rules the player in the browser follows, tested without a browser.
 * The player tries again by itself after a lost connection, waiting 2, 4, 8 … seconds and at most a minute, for ever.
 */
export const RETRY_MAX_MS = 60_000;
export function nextRetryDelay(failures: number): number {
  const step = Math.max(1, Math.min(10, Math.floor(failures)));
  return Math.min(RETRY_MAX_MS, 1000 * 2 ** step);
}

/** The next nightly reload after `now` at the hour chosen (local time of the device), as a time in milliseconds. */
export function nextNightlyReload(now: Date, hour: number): number {
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime();
}
