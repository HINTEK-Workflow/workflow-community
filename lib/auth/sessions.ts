import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { requestFingerprint, recordSecurityEvent } from "@/lib/security/security-log";
import { sessionNeedsTouch, sessionRowEnded } from "@/lib/auth/session-rules";

type HeaderSource = Headers | Record<string, string | string[] | undefined>;

const maxAgeSeconds = () => env.SESSION_MAX_AGE_HOURS * 3600;

/** A new session row at sign-in; its id goes into the JWT as `sid`. */
export async function startSession(userId: string, method: string, headers?: HeaderSource | null) {
  const fingerprint = requestFingerprint(headers);
  const row = await prisma.userSession.create({ data: { userId, method, client: fingerprint.client, ipHash: fingerprint.ipHash }, select: { id: true } });
  return row.id;
}

/** Whether the token's session still holds; touches lastSeenAt now and then. */
export async function sessionStillValid(sid: string, userId: string, now = Date.now()) {
  const row = await prisma.userSession.findUnique({ where: { id: sid }, select: { userId: true, revokedAt: true, lastSeenAt: true } });
  if (sessionRowEnded(row, userId, maxAgeSeconds(), now)) return false;
  if (row && sessionNeedsTouch(row.lastSeenAt, now))
    await prisma.userSession.updateMany({ where: { id: sid, revokedAt: null }, data: { lastSeenAt: new Date(now) } }).catch(() => undefined);
  return true;
}

export async function sessionReauthAt(sid: string | undefined, userId: string) {
  if (!sid) return null;
  const row = await prisma.userSession.findUnique({ where: { id: sid }, select: { userId: true, reauthAt: true } });
  return row?.userId === userId ? row.reauthAt : null;
}

export async function markReauthenticated(sid: string | undefined, userId: string) {
  if (!sid) return false;
  const { count } = await prisma.userSession.updateMany({ where: { id: sid, userId, revokedAt: null }, data: { reauthAt: new Date() } });
  return count > 0;
}

/** Mina inställningar → Aktiva inloggningar: the sessions that still hold, newest use first. */
export async function listSessions(userId: string, currentSid?: string) {
  const since = new Date(Date.now() - maxAgeSeconds() * 1000);
  const rows = await prisma.userSession.findMany({
    where: { userId, revokedAt: null, lastSeenAt: { gte: since } },
    orderBy: { lastSeenAt: "desc" }, take: 30,
    select: { id: true, method: true, client: true, createdAt: true, lastSeenAt: true },
  });
  return rows.map((row) => ({ id: row.id, method: row.method, client: row.client || "Okänd enhet", createdAt: row.createdAt.toISOString(), lastSeenAt: row.lastSeenAt.toISOString(), current: row.id === currentSid }));
}

/** Ends one of the person's own sessions. */
export async function revokeSession(userId: string, sessionId: string, headers?: HeaderSource | null) {
  const { count } = await prisma.userSession.updateMany({ where: { id: sessionId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
  if (count) await recordSecurityEvent({ type: "session_revoked", userId, actorId: userId, detail: "En inloggning", headers });
  return count > 0;
}

/**
 * Logga ut överallt: every session of the person ends – the rows, and through sessionsRevokedAt also tokens that have
 * no row. `by` is an administrator when it is not the person; the event then belongs to that company too.
 */
export async function revokeAllSessions(userId: string, by: { actorId: string; organizationId?: string | null; headers?: HeaderSource | null }) {
  const now = new Date();
  await prisma.$transaction([
    prisma.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } }),
    prisma.user.update({ where: { id: userId }, data: { sessionsRevokedAt: now } }),
  ]);
  const byAdmin = by.actorId !== userId;
  await recordSecurityEvent({ type: "sessions_revoked_all", userId, actorId: by.actorId, organizationId: byAdmin ? by.organizationId ?? null : null, detail: byAdmin ? "Av administratör" : "", headers: by.headers });
}
