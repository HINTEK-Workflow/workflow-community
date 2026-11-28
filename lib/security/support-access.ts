import { prisma } from "@/lib/db";
import { recordSecurityEvent } from "@/lib/security/security-log";
import { openSupportGrant, supportAccessExpiry, SUPPORT_ACCESS_HOURS_LABEL, SUPPORT_PART_LABEL, supportGrantState, type SupportAccessHours, type SupportPart } from "@/lib/security/access-rules";

/**
 * Supportåtkomst med medgivande (K2.3, beslut 2026-11-28): the database part. The company's admin opens and closes a grant;
 * the installation's support reads through lib/security/support-reads.ts only while a grant of THAT company is open. Every
 * function takes the company from its caller's verified context (the admin's active company, or the company the support
 * view names and whose open grant is looked up here) – never from a grant id alone, so one company's grant never opens another.
 */
type HeaderSource = Headers | null | undefined;

const grantSelect = { id: true, organizationId: true, grantedById: true, hours: true, createdAt: true, expiresAt: true, revokedAt: true, revokedById: true, expiryLoggedAt: true } as const;

/** The company's open grant, or null. Expired grants are written to the history once on the way (see logExpired). */
export async function activeSupportGrant(organizationId: string, now = new Date()) {
  await logExpired(organizationId, now);
  const grants = await prisma.supportAccessGrant.findMany({ where: { organizationId, revokedAt: null, expiresAt: { gt: now } }, select: grantSelect, take: 5 });
  return openSupportGrant(grants, now);
}

/**
 * The end of a grant that ran out is written to the company's history and security log once: the row is claimed atomically
 * (expiryLoggedAt), so two requests at the same moment write one line.
 */
export async function logExpired(organizationId: string, now = new Date()) {
  const ended = await prisma.supportAccessGrant.findMany({ where: { organizationId, revokedAt: null, expiryLoggedAt: null, expiresAt: { lte: now } }, select: { id: true, hours: true, grantedById: true }, take: 20 });
  for (const grant of ended) {
    const { count } = await prisma.supportAccessGrant.updateMany({ where: { id: grant.id, organizationId, expiryLoggedAt: null }, data: { expiryLoggedAt: now } });
    if (!count) continue;
    // The history names the admin who gave the access: the end is the consequence of that admin's choice of length.
    await prisma.administrationEvent.create({ data: { organizationId, actorId: grant.grantedById, action: "support_access_expired", detail: "Supportåtkomsten har gått ut. Supporten kan inte längre läsa företagets uppgifter." } }).catch(() => undefined);
    await recordSecurityEvent({ type: "support_access_expired", organizationId, platform: false, detail: SUPPORT_ACCESS_HOURS_LABEL[grant.hours as SupportAccessHours] ?? "" });
  }
}

/** Opens a grant for the given length. An open grant is replaced (closed as revoked by the same admin) so there is only one. */
export async function grantSupportAccess(input: { organizationId: string; actorId: string; hours: SupportAccessHours; headers?: HeaderSource }, now = new Date()) {
  const expiresAt = supportAccessExpiry(input.hours, now);
  const grant = await prisma.$transaction(async (tx) => {
    await tx.supportAccessGrant.updateMany({ where: { organizationId: input.organizationId, revokedAt: null, expiresAt: { gt: now } }, data: { revokedAt: now, revokedById: input.actorId } });
    const created = await tx.supportAccessGrant.create({ data: { organizationId: input.organizationId, grantedById: input.actorId, hours: input.hours, createdAt: now, expiresAt }, select: grantSelect });
    await tx.administrationEvent.create({ data: { organizationId: input.organizationId, actorId: input.actorId, action: "support_access_granted", detail: `Gav supporten läsåtkomst i ${SUPPORT_ACCESS_HOURS_LABEL[input.hours]}, till ${expiresAt.toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" })}.` } });
    return created;
  });
  await recordSecurityEvent({ type: "support_access_granted", actorId: input.actorId, organizationId: input.organizationId, platform: false, detail: SUPPORT_ACCESS_HOURS_LABEL[input.hours], headers: input.headers });
  return grant;
}

/** Closes the company's open grant at once. False when none was open. */
export async function revokeSupportAccess(input: { organizationId: string; actorId: string; headers?: HeaderSource }, now = new Date()) {
  const { count } = await prisma.supportAccessGrant.updateMany({ where: { organizationId: input.organizationId, revokedAt: null, expiresAt: { gt: now } }, data: { revokedAt: now, revokedById: input.actorId } });
  if (!count) return false;
  await prisma.administrationEvent.create({ data: { organizationId: input.organizationId, actorId: input.actorId, action: "support_access_revoked", detail: "Återkallade supportens läsåtkomst. Supporten kan inte längre läsa företagets uppgifter." } });
  await recordSecurityEvent({ type: "support_access_revoked", actorId: input.actorId, organizationId: input.organizationId, platform: false, headers: input.headers });
  return true;
}

/**
 * One line for each read support made. The grant is the one open in this company, looked up again inside the same call, so a
 * read is never logged against – or let through by – another company's grant. The first read of a grant also goes to the
 * security log. Returns false when no grant is open (the caller then refuses the read).
 */
export async function logSupportRead(input: { organizationId: string; userId: string; part: SupportPart; detail: string; headers?: HeaderSource }, now = new Date()) {
  const grant = await activeSupportGrant(input.organizationId, now);
  if (!grant || grant.organizationId !== input.organizationId || supportGrantState(grant, now) !== "active") return null;
  const before = await prisma.supportAccessRead.count({ where: { grantId: grant.id, organizationId: input.organizationId } });
  await prisma.supportAccessRead.create({ data: { organizationId: input.organizationId, grantId: grant.id, userId: input.userId, part: input.part, detail: input.detail.slice(0, 200), createdAt: now } });
  if (!before) await recordSecurityEvent({ type: "support_access_used", actorId: input.userId, organizationId: input.organizationId, platform: false, detail: SUPPORT_PART_LABEL[input.part], headers: input.headers });
  return grant;
}

/** For the company's admin: the open grant, the latest grants and every read in them, newest first, bounded. */
export async function supportAccessForCompany(organizationId: string, now = new Date()) {
  const open = await activeSupportGrant(organizationId, now);
  const [grants, reads] = await Promise.all([
    prisma.supportAccessGrant.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 10, select: grantSelect }),
    prisma.supportAccessRead.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, grantId: true, userId: true, part: true, detail: true, createdAt: true } }),
  ]);
  const people = await prisma.user.findMany({ where: { id: { in: [...new Set([...grants.flatMap((grant) => [grant.grantedById, grant.revokedById]), ...reads.map((read) => read.userId)].filter((id): id is string => Boolean(id)))] } }, select: { id: true, name: true, email: true } });
  const nameOf = (id: string | null) => (id ? people.find((person) => person.id === id)?.name || people.find((person) => person.id === id)?.email || "Borttagen användare" : null);
  return {
    open: open ? { id: open.id, hours: open.hours, createdAt: open.createdAt.toISOString(), expiresAt: open.expiresAt.toISOString(), grantedBy: nameOf(open.grantedById) } : null,
    grants: grants.map((grant) => ({ id: grant.id, hours: grant.hours, createdAt: grant.createdAt.toISOString(), expiresAt: grant.expiresAt.toISOString(), state: supportGrantState(grant, now), grantedBy: nameOf(grant.grantedById), revokedAt: grant.revokedAt?.toISOString() ?? null })),
    // Support is Workflow's people: named as support, with the person's name, so the company sees who read.
    reads: reads.map((read) => ({ id: read.id, grantId: read.grantId, part: read.part, label: SUPPORT_PART_LABEL[read.part as SupportPart] ?? read.part, detail: read.detail, at: read.createdAt.toISOString(), by: nameOf(read.userId) })),
  };
}
