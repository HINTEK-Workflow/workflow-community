/**
 * How many AI model answers one person may ask for per minute (plan 2026-10-01, fas 0). A protection in the
 * background, not a setting: ordinary use never reaches it, a runaway script or a stuck button does. Answers from the
 * rules are free and not counted.
 */
export const AI_CALLS_PER_MINUTE = 20;
const WINDOW_MS = 60_000;
const windows = new Map<string, { start: number; count: number }>();

/** Counts one AI call for the person; false when the minute's allowance is used up. */
export function allowAiCall(userId: string, now = Date.now()): boolean {
  // Old windows are dropped as new ones come in, so the map never grows with people who have left.
  if (windows.size > 5_000) for (const [key, value] of windows) if (now - value.start >= WINDOW_MS) windows.delete(key);
  const window = windows.get(userId);
  if (!window || now - window.start >= WINDOW_MS) { windows.set(userId, { start: now, count: 1 }); return true; }
  if (window.count >= AI_CALLS_PER_MINUTE) return false;
  window.count += 1;
  return true;
}

export const AI_RATE_LIMIT_REASON = "Du har ställt många AI-frågor på kort tid. Vänta en minut och försök igen.";
