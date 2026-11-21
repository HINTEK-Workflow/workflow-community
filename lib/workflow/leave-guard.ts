/**
 * Osparat arbete, samma regel för alla vägar ut (2026-10-09): a link, a breadcrumb, Hem in the bottom bar and the
 * back and forward buttons all ask the open editor or view before leaving. An editor that autosaves saves first and
 * lets the person go; one that cannot save asks with the in-app card. Browser-only module state, no React.
 */
type LeaveGuard = () => Promise<boolean>;
const guards = new Set<LeaveGuard>();
/** Until when the way out that follows an answered Avbryt goes without a second question (see leaveWithoutAsking). */
let leavingUntil = 0;

/** Registers a guard; the returned function removes it. */
export function registerLeaveGuard(guard: LeaveGuard): () => void {
  // Something new to guard: an earlier Avbryt's moment of leaving without a question is over (2026-10-13 natt: a form
  // changed right after another one was cancelled could be left without the question).
  leavingUntil = 0;
  guards.add(guard);
  return () => { guards.delete(guard); };
}

/** True when every open editor and view lets the person leave (saved, or the person chose to leave without saving). */
export async function confirmLeave(): Promise<boolean> {
  if (leavingWithoutAsking()) return true;
  for (const guard of [...guards]) {
    if (!(await guard().catch(() => false))) return false;
  }
  return true;
}

export const hasLeaveGuards = () => guards.size > 0;

/**
 * Avbryt (2026-10-13: "Avbryt frågar alltid när något är ändrat"): the person has just answered "Kasta" on the
 * page's own question, so the way out that follows – back(), the browser step the back guard keeps, a push – must not
 * ask again. Lasts a moment, long enough for the step back to happen.
 */
export function leaveWithoutAsking(ms = 1500) { leavingUntil = Date.now() + ms; }
export const leavingWithoutAsking = () => Date.now() < leavingUntil;
