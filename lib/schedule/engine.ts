import { LOCK_MS, settle, STOPPED_HALF_WAY, type RunOutcome, type ScheduleItem } from "./model";

/**
 * Schemalägg (2026-11-11): the job's engine – which items are due, the claim, the attempt and its outcome – with the database,
 * the publishing and the mail given from outside (lib/schedule/server.ts gives the real ones; the tests their own). The claim is
 * a conditional change (scheduled → running, only while still due); only the run that made it publishes, so two runs at the same
 * minute, or Publicera nu while the job runs, never publish an item twice. An item still running after LOCK_MS stopped half-way
 * and fails with STOPPED_HALF_WAY: it is never tried again by itself, because it may already be published.
 */
export type ScheduleStore = {
  /** Running items whose lock has run out. */
  stale(now: Date): Promise<ScheduleItem[]>;
  /** Scheduled items whose next attempt is due, oldest first. */
  due(now: Date, limit: number): Promise<ScheduleItem[]>;
  /** scheduled → running with a lock, only while the item is still scheduled and due; the claimed item, or null. */
  claim(id: string, now: Date, lockedUntil: Date): Promise<ScheduleItem | null>;
  /** running → the outcome's state; false when the item is no longer the one claimed. */
  finish(id: string, data: { status: string; nextAttemptAt: Date | null; lastError: string | null; result: string | null; publishedAt: Date | null; lockedUntil: null }, from: "running"): Promise<boolean>;
  /** The failure mail went out (once per item). */
  mailed(id: string, now: Date): Promise<void>;
};

export type ScheduleRunDeps = {
  store: ScheduleStore;
  /** Why the admin who scheduled the item may not publish now (left the company, no longer admin, write access stopped), or null. */
  authorize(item: ScheduleItem, now: Date): Promise<string | null>;
  /** Publishes the item as `actorId` (the scheduler, or the person who pressed Publicera nu). */
  publish(item: ScheduleItem, actorId: string): Promise<RunOutcome>;
  /** Tells the company's admins that the item failed. */
  notify(item: ScheduleItem, reason: string): Promise<void>;
  audit(item: ScheduleItem, detail: string): Promise<void>;
};

export type ScheduleRunResult = { due: number; published: number; retried: number; failed: number; skipped: number; stale: number; lost: number };

async function fail(deps: ScheduleRunDeps, item: ScheduleItem, reason: string, now: Date) {
  if (!item.failureMailedAt) {
    try { await deps.notify(item, reason); await deps.store.mailed(item.id, now); } catch { /* the item still shows Misslyckades with its reason */ }
  }
}

/** One claimed item: the check of the scheduler, the attempt and its outcome. */
async function attempt(deps: ScheduleRunDeps, item: ScheduleItem, now: Date, actorId: string | null): Promise<RunOutcome> {
  const refusal = actorId ? null : await deps.authorize(item, now).catch(() => "Behörigheten kunde inte kontrolleras.");
  if (refusal) return { kind: "fail", message: refusal };
  try { return await deps.publish(item, actorId ?? item.scheduledById); }
  catch (error) { return { kind: "retry", message: error instanceof Error && error.message ? error.message.slice(0, 300) : "Något gick fel." }; }
}

/** Claims and runs one item; `actorId` is set for Publicera nu (that person's own press, already checked by the API). */
export async function runClaimed(deps: ScheduleRunDeps, id: string, now = new Date(), actorId: string | null = null): Promise<{ claimed: boolean; outcome?: RunOutcome; status?: string }> {
  const item = await deps.store.claim(id, now, new Date(now.getTime() + LOCK_MS));
  if (!item) return { claimed: false };
  const outcome = await attempt(deps, item, now, actorId);
  const next = settle(outcome, item.attempts, now);
  const finished = await deps.store.finish(item.id, { status: next.status, nextAttemptAt: next.nextAttemptAt, lastError: next.error, result: next.result, publishedAt: next.status === "published" ? now : null, lockedUntil: null }, "running");
  if (!finished) return { claimed: true, outcome };
  await deps.audit(item, next.status === "published" ? `Schemalagd publicering klar: ${item.title || item.targetId}.`
    : next.status === "scheduled" ? `Schemalagd publicering försöks igen: ${outcome.message}`
    : next.status === "cancelled" ? `Schemalagd publicering behövdes inte: ${outcome.message}`
    : `Schemalagd publicering misslyckades: ${outcome.message}`).catch(() => undefined);
  if (next.status === "failed") await fail(deps, item, outcome.message, now);
  return { claimed: true, outcome, status: next.status };
}

/** The job: stale items first, then every due item, one at a time. One item's failure never stops the rest. */
export async function runDueWith(deps: ScheduleRunDeps, now = new Date(), limit = 50): Promise<ScheduleRunResult> {
  const result: ScheduleRunResult = { due: 0, published: 0, retried: 0, failed: 0, skipped: 0, stale: 0, lost: 0 };
  for (const item of await deps.store.stale(now)) {
    const done = await deps.store.finish(item.id, { status: "failed", nextAttemptAt: null, lastError: STOPPED_HALF_WAY, result: null, publishedAt: null, lockedUntil: null }, "running");
    if (!done) continue;
    result.stale += 1;
    await deps.audit(item, `Schemalagd publicering misslyckades: ${STOPPED_HALF_WAY}`).catch(() => undefined);
    await fail(deps, item, STOPPED_HALF_WAY, now);
  }
  const due = await deps.store.due(now, limit);
  result.due = due.length;
  for (const item of due) {
    try {
      const run = await runClaimed(deps, item.id, now);
      if (!run.claimed) { result.lost += 1; continue; }
      if (run.status === "published") result.published += 1;
      else if (run.status === "scheduled") result.retried += 1;
      else if (run.status === "cancelled") result.skipped += 1;
      else result.failed += 1;
    } catch { result.failed += 1; }
  }
  return result;
}
