import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { keyRing } from "@/lib/security/key-ring";
import { clientIp } from "@/lib/security/client-ip";
import { coarseClient, ipHash, SECURITY_EVENT_TYPES, type SecurityEventType } from "@/lib/security/security-log-core";
import { pruneSecurityEvents } from "@/lib/traceability/retention-server";
import { SIGN_IN_METHOD_LABELS } from "@/lib/auth/session-rules";

export { SECURITY_EVENT_TYPES, type SecurityEventType } from "@/lib/security/security-log-core";

type HeaderSource = Headers | Record<string, string | string[] | undefined>;

// The current secret of the key ring (2026-10-25): an address's hash changes with a rotation, as it does each new year.
const secret = () => keyRing().current;

/**
 * The caller's address and browser, minimised. The IP goes through lib/security/client-ip.ts (the one place that
 * decides which proxy headers to trust) and is stored only as a keyed hash.
 */
export function requestFingerprint(headers: HeaderSource | null | undefined, now = new Date()) {
  if (!headers) return { client: "", ipHash: null as string | null };
  const userAgent = headers instanceof Headers ? headers.get("user-agent") : (([] as (string | undefined)[]).concat(headers["user-agent"])[0] ?? null);
  return { client: coarseClient(userAgent), ipHash: ipHash(clientIp(headers), secret(), now) };
}

export type SecurityEventInput = {
  type: SecurityEventType;
  userId?: string | null;
  actorId?: string | null;
  /** Only for company events: API keys, the company's rule and an admin's sign-out of a member. */
  organizationId?: string | null;
  /** Installation-level, visible to the superadmin. Unset: true when the person is a superadmin. */
  platform?: boolean;
  /** Fixed words from the code only, never free text from a person. */
  detail?: string;
  headers?: HeaderSource | null;
};

/** Writes one event. Never throws: a log that cannot be written must not stop a sign-in. */
export async function recordSecurityEvent(input: SecurityEventInput) {
  try {
    const platform = input.platform ?? (input.userId
      ? (await prisma.user.findUnique({ where: { id: input.userId }, select: { role: true } }))?.role === "SUPERADMIN"
      : false);
    const fingerprint = requestFingerprint(input.headers);
    await prisma.securityEvent.create({ data: {
      type: input.type, userId: input.userId ?? null, actorId: input.actorId ?? null, organizationId: input.organizationId ?? null,
      platform, client: fingerprint.client, ipHash: fingerprint.ipHash, detail: (input.detail ?? "").slice(0, 120),
    } });
  } catch (error) {
    console.warn(`Security log could not be written (${input.type}, ${error instanceof Error ? error.name : "Unknown"}).`);
  }
}

const PAGE = 50;
const select = { id: true, type: true, userId: true, actorId: true, client: true, detail: true, createdAt: true } as const;
type Row = { id: string; type: string; userId: string | null; actorId: string | null; client: string; detail: string; createdAt: Date };

/** Names for the people in a page of events – only people the viewer may already see (the caller passes them). */
function present(rows: Row[], names: Map<string, string>) {
  return rows.slice(0, PAGE).map((row) => ({
    // The keyed IP hash never leaves the server; it is there for investigating a series of tries.
    id: row.id, type: row.type, label: SECURITY_EVENT_TYPES[row.type as SecurityEventType] ?? row.type,
    detail: row.type === "login_ok" ? SIGN_IN_METHOD_LABELS[row.detail] ?? row.detail : row.detail, client: row.client,
    at: row.createdAt.toISOString(),
    person: row.userId ? names.get(row.userId) ?? "Borttagen användare" : null,
    actor: row.actorId && row.actorId !== row.userId ? names.get(row.actorId) ?? "Administratör" : null,
  }));
}
const page = (rows: Row[], names: Map<string, string>) => ({ events: present(rows, names), next: rows.length > PAGE ? rows[PAGE - 1].createdAt.toISOString() : null });
const before = (cursor?: string | null) => (cursor && !Number.isNaN(Date.parse(cursor)) ? { createdAt: { lt: new Date(cursor) } } : {});

/** Min säkerhetslogg: the person's own events, newest first, 50 at a time. */
export async function personalSecurityLog(userId: string, cursor?: string | null) {
  const rows = await prisma.securityEvent.findMany({ where: { userId, ...before(cursor) }, orderBy: { createdAt: "desc" }, take: PAGE + 1, select });
  const actors = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.actorId).filter((id): id is string => Boolean(id && id !== userId)))] } }, select: { id: true, name: true, email: true } });
  return page(rows, new Map([...actors.map((user) => [user.id, user.name || user.email] as const)]));
}

/**
 * The company's security log for its admin: the company's own events, and the personal events (sign-ins, two-factor,
 * password, sessions) of its current members from the day they joined – never anything from before, never another
 * company's events, never people who are not members.
 */
export async function companySecurityLog(organizationId: string, cursor?: string | null) {
  const members = await prisma.organizationMember.findMany({ where: { organizationId }, select: { userId: true, createdAt: true, user: { select: { name: true, email: true } } } });
  const rows = await prisma.securityEvent.findMany({
    where: { ...before(cursor), OR: [
      { organizationId },
      ...members.map((member) => ({ organizationId: null, userId: member.userId, createdAt: { gte: member.createdAt } })),
    ] },
    orderBy: { createdAt: "desc" }, take: PAGE + 1, select,
  });
  return page(rows, new Map(members.map((member) => [member.userId, member.user.name || member.user.email] as const)));
}

/**
 * The superadmin's view: installation-level events only (superadmin accounts and the installation's rules) – metadata,
 * never a customer's members or business data.
 */
export async function platformSecurityLog(cursor?: string | null) {
  const rows = await prisma.securityEvent.findMany({ where: { platform: true, ...before(cursor) }, orderBy: { createdAt: "desc" }, take: PAGE + 1, select });
  const people = await prisma.user.findMany({ where: { role: "SUPERADMIN", id: { in: [...new Set(rows.flatMap((row) => [row.userId, row.actorId]).filter((id): id is string => Boolean(id)))] } }, select: { id: true, name: true, email: true } });
  return page(rows, new Map(people.map((user) => [user.id, user.name || user.email] as const)));
}

/**
 * Nightly: events older than their retention, and session rows ended or unused for longer than a session can live + 30 days.
 * Spårbarhet (K3, 2026-11-27): the log is chained, so its rows leave through the chain's retention (lib/traceability/
 * retention-server.ts): a person's events without a company after 12 months, a company's after the company's log retention.
 */
export async function pruneSecurityLog(now = new Date(), sessionMaxAgeHours = env.SESSION_MAX_AGE_HOURS, options: { dryRun?: boolean } = {}) {
  const sessionsBefore = new Date(now.getTime() - (sessionMaxAgeHours * 3600_000 + 30 * 86_400_000));
  const securityEvents = await pruneSecurityEvents(now, { dryRun: options.dryRun });
  const sessionsWhere = { OR: [{ revokedAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } }, { lastSeenAt: { lt: sessionsBefore } }] } satisfies Prisma.UserSessionWhereInput;
  // Passkey ceremonies never finished (2026-10-11); they expire after five minutes.
  const challengesWhere = { expiresAt: { lt: now } } satisfies Prisma.WebAuthnChallengeWhereInput;
  // Operatörernas inloggningar (2026-10-30): a row lives at most 24 hours; it goes 30 days after it started (counted with the sessions).
  const operatorWhere = { createdAt: { lt: new Date(now.getTime() - 31 * 86_400_000) } } satisfies Prisma.OperatorSessionWhereInput;
  // Torrkörning (T5, 2026-10-24): the same rows counted, nothing deleted.
  const [userSessions, passkeyChallenges, operatorSessions] = options.dryRun ? await Promise.all([
    prisma.userSession.count({ where: sessionsWhere }), prisma.webAuthnChallenge.count({ where: challengesWhere }), prisma.operatorSession.count({ where: operatorWhere }),
  ]) : (await Promise.all([
    prisma.userSession.deleteMany({ where: sessionsWhere }), prisma.webAuthnChallenge.deleteMany({ where: challengesWhere }), prisma.operatorSession.deleteMany({ where: operatorWhere }),
  ])).map((result) => result.count);
  return { securityEvents, sessions: userSessions + operatorSessions, passkeyChallenges };
}
