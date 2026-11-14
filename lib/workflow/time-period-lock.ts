import type { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/kfid/errors";
import { lockedPeriodMessage, lockedTouch, touchedPeriods, type TimeTouch } from "./time-periods";

/**
 * Tidsperiod (2026-10-30): the lock every write of time goes through. `touches` are the person and start of each entry
 * before and after the change (a moved entry touches both months). Each (company, person, month) is serialised with an advisory
 * lock held to the end of the transaction – the same key as sending in (lib/workflow/time-periods-server.ts), so time cannot
 * slip into a month while it is being sent in. A SUBMITTED or APPROVED month refuses the change with a Swedish 409.
 * Needs an interactive transaction (`prisma.$transaction(async (tx) => …)`).
 */
export const timePeriodLockKey = (organizationId: string, userId: string, period: string) => `time-period:${organizationId}:${userId}:${period}`;

export async function lockTimePeriod(tx: Prisma.TransactionClient, organizationId: string, userId: string, period: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${timePeriodLockKey(organizationId, userId, period)}))`;
}

export async function assertTimeOpen(tx: Prisma.TransactionClient, organizationId: string, touches: readonly TimeTouch[], actorUserId: string) {
  const keys = touchedPeriods(touches);
  if (!keys.length) return;
  for (const key of keys) await lockTimePeriod(tx, organizationId, key.userId, key.period);
  const rows = await tx.timePeriod.findMany({
    where: { organizationId, OR: keys.map((key) => ({ userId: key.userId, period: key.period })) },
    select: { userId: true, period: true, status: true },
  });
  const found = lockedTouch(touches, (userId, period) => rows.find((row) => row.userId === userId && row.period === period)?.status);
  if (found) throw new ApiError(409, lockedPeriodMessage(found.period, found.status, found.userId === actorUserId));
}

type ReplacedEntry = { userId: string; startedAt: Date | string; endedAt: Date | string | null; durationSec: number; note: string };
const iso = (value: Date | string | null) => (value === null ? "" : new Date(value).toISOString());
const signature = (entry: ReplacedEntry) => [entry.userId, iso(entry.startedAt), iso(entry.endedAt), entry.durationSec, entry.note].join("|");

/**
 * A whole owner's time replaced at once (Återimport från Local, lib/kfid/cloud-import.ts): only the entries that really differ
 * are changes, so a file that brings a locked month back unchanged passes, and one that changes it is refused.
 */
export async function assertReplacedTimeOpen(tx: Prisma.TransactionClient, organizationId: string, before: readonly ReplacedEntry[], after: readonly ReplacedEntry[], actorUserId: string) {
  const remaining = new Map<string, number>();
  for (const entry of before) remaining.set(signature(entry), (remaining.get(signature(entry)) ?? 0) + 1);
  const changed: ReplacedEntry[] = [];
  for (const entry of after) {
    const left = remaining.get(signature(entry)) ?? 0;
    if (left > 0) remaining.set(signature(entry), left - 1);
    else changed.push(entry);
  }
  for (const entry of before) {
    const left = remaining.get(signature(entry)) ?? 0;
    if (left > 0) { changed.push(entry); remaining.set(signature(entry), left - 1); }
  }
  await assertTimeOpen(tx, organizationId, changed, actorUserId);
}
