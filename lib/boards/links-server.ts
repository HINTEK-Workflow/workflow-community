import { createHash, randomBytes } from "node:crypto";
import { hashLinkCode, linkCodeMatches, readLinkSession, signLinkSession } from "./link-session";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { keyRing } from "@/lib/security/key-ring";
import { RATE_RULES, hitRateLimit } from "@/lib/security/rate-limit";
import { boardsAccess } from "./access";
import { layoutHasPersonalData } from "./privacy";
import { readLayout } from "./model";
import type { BoardsCaller } from "./server";
import {
  LINK_CODE_TRIES, LINK_DEFAULT_DAYS, LINK_LOCK_MINUTES, LINK_SESSION_HOURS, linkCodeSchema, linkRefusal, linkShowsNames, linkState, readPlaylistItems, targetSchema, type AccessTarget,
} from "./screens";
import { organizationShows, targetFeed, targetLayouts, viewerOrganization } from "./viewer-server";

/**
 * Delningslänkar (Tavlor och skärmar etapp 2, 2026-11-18; plan 6.2–6.4, frågorna 8–9): a secret link to one board or playlist, with an
 * end date (90 days by default; "until further notice" only for boards without personal data) and an optional code of 6–10 digits.
 * The secret is in the address's #-part and reaches the server only in a POST; the link's session is a signed cookie for /visa
 * (12 hours, renewed while used) bound to the link's current secret, so a renewed link ends every old session. Only hashes are stored.
 */
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const audit = (caller: BoardsCaller, action: string, detail: string) =>
  prisma.administrationEvent.create({ data: { organizationId: caller.organizationId, actorId: caller.userId, action, detail: detail.slice(0, 500) } }).catch(() => undefined);
const requirePublish = (caller: BoardsCaller) => { if (!boardsAccess(caller).publish) throw new ApiError(403, "Du saknar behörighet att dela tavlor."); };

// The session cookie and the code: lib/boards/link-session.ts, with the installation's key ring.
const ringSecrets = () => { const ring = keyRing(); return [ring.current, ...ring.previous]; };
const sign = (accessId: string, tokenHash: string, expiresAt: number) => signLinkSession(keyRing().current, accessId, tokenHash, expiresAt);
export const linkSessionEnds = (now = Date.now()) => now + LINK_SESSION_HOURS * 3600_000;

// ---------- the admin's side ----------

async function targetHasPersonalData(organizationId: string, target: { boardId: string | null; playlistId: string | null }) {
  return (await targetLayouts(organizationId, target)).some(layoutHasPersonalData);
}

async function requireTarget(caller: BoardsCaller, target: AccessTarget) {
  if (target.boardId) {
    const board = await prisma.board.findFirst({ where: { id: target.boardId, organizationId: caller.organizationId, deletedAt: null }, select: { publishedVersionId: true } });
    if (!board) throw new ApiError(404, "Tavlan finns inte.");
    if (!board.publishedVersionId) throw new ApiError(409, "Tavlan är inte publicerad. Publicera den först.");
  } else {
    const playlist = await prisma.boardPlaylist.findFirst({ where: { id: target.playlistId!, organizationId: caller.organizationId, deletedAt: null }, select: { items: true } });
    if (!playlist || !readPlaylistItems(playlist.items).length) throw new ApiError(404, "Spellistan finns inte.");
  }
  return { boardId: target.boardId ?? null, playlistId: target.playlistId ?? null };
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Ge länken ett namn, till exempel vem den är till.").max(60),
  target: targetSchema,
  /** YYYY-MM-DD, the last day the link works; null = until further notice. */
  until: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  code: linkCodeSchema.nullable().optional(),
});
const endOfDay = (day: string) => new Date(`${day}T23:59:59`);
export const defaultLinkUntil = (now = new Date()) => new Date(now.getTime() + LINK_DEFAULT_DAYS * 86_400_000).toISOString().slice(0, 10);

export async function createLink(caller: BoardsCaller, input: unknown, now = new Date()) {
  requirePublish(caller);
  const data = createSchema.parse(input);
  const target = await requireTarget(caller, data.target);
  const expiresAt = data.until ? endOfDay(data.until) : null;
  const refusal = linkRefusal({ expiresAt, personal: await targetHasPersonalData(caller.organizationId, target), now });
  if (refusal) throw new ApiError(400, refusal);
  const secret = randomBytes(32).toString("base64url");
  const row = await prisma.boardAccess.create({ data: { organizationId: caller.organizationId, kind: "link", name: data.name, ...target, tokenHash: sha(secret), codeHash: data.code ? hashLinkCode(data.code) : null, expiresAt, createdById: caller.userId } });
  await audit(caller, "board_link_created", `Länken ${data.name} skapades${expiresAt ? ` och gäller till ${data.until}` : " och gäller tills vidare"}${data.code ? ", med kod" : ""}.`);
  return { id: row.id, secret };
}

async function linkRow(caller: BoardsCaller, id: string) {
  const row = await prisma.boardAccess.findFirst({ where: { id, organizationId: caller.organizationId, kind: "link" } });
  if (!row) throw new ApiError(404, "Länken finns inte.");
  return row;
}

export async function listLinks(caller: BoardsCaller, now = new Date()) {
  requirePublish(caller);
  const rows = await prisma.boardAccess.findMany({ where: { organizationId: caller.organizationId, kind: "link" }, orderBy: { createdAt: "desc" }, take: 500 });
  const [boards, playlists] = await Promise.all([
    prisma.board.findMany({ where: { organizationId: caller.organizationId, id: { in: rows.flatMap((row) => row.boardId ? [row.boardId] : []) } }, select: { id: true, name: true } }),
    prisma.boardPlaylist.findMany({ where: { organizationId: caller.organizationId, id: { in: rows.flatMap((row) => row.playlistId ? [row.playlistId] : []) } }, select: { id: true, name: true } }),
  ]);
  return { items: rows.map((row) => ({
    id: row.id, name: row.name, state: linkState(row, now), code: Boolean(row.codeHash), names: linkShowsNames(row),
    expiresAt: row.expiresAt?.toISOString() ?? null, lastUsedAt: row.lastUsedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(),
    shows: boards.find((board) => board.id === row.boardId)?.name ?? (playlists.find((item) => item.id === row.playlistId) ? `Spellista: ${playlists.find((item) => item.id === row.playlistId)!.name}` : "–"),
  })) };
}

export async function revokeLink(caller: BoardsCaller, id: string) {
  requirePublish(caller);
  const row = await linkRow(caller, id);
  await prisma.boardAccess.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
  await audit(caller, "board_link_revoked", `Länken ${row.name} spärrades.`);
  return { ok: true };
}

/** Förnya: a new secret with the same settings; the old address and every open session stop at once. */
export async function renewLink(caller: BoardsCaller, id: string) {
  requirePublish(caller);
  const row = await linkRow(caller, id);
  const secret = randomBytes(32).toString("base64url");
  await prisma.boardAccess.update({ where: { id: row.id }, data: { tokenHash: sha(secret), revokedAt: null, failedCodes: 0, lockedUntil: null } });
  await audit(caller, "board_link_renewed", `Länken ${row.name} fick en ny adress.`);
  return { id: row.id, secret };
}

export async function setLinkCode(caller: BoardsCaller, id: string, code: string | null) {
  requirePublish(caller);
  const row = await linkRow(caller, id);
  const value = code === null ? null : linkCodeSchema.parse(code);
  if (!value) {
    // Without a code a link shows no names (plan 6.2); a board with names still needs its end date, which the link keeps.
    if (!row.expiresAt && await targetHasPersonalData(caller.organizationId, row)) throw new ApiError(400, "Tavlan visar namn, så länken behöver ett slutdatum.");
  }
  await prisma.boardAccess.update({ where: { id: row.id }, data: { codeHash: value ? hashLinkCode(value) : null, failedCodes: 0, lockedUntil: null } });
  await audit(caller, "board_link_code", value ? `Länken ${row.name} fick en ny kod.` : `Koden på länken ${row.name} togs bort.`);
  return { ok: true };
}

export async function deleteLink(caller: BoardsCaller, id: string) {
  requirePublish(caller);
  const row = await linkRow(caller, id);
  await prisma.boardAccess.delete({ where: { id: row.id } });
  await audit(caller, "board_link_removed", `Länken ${row.name} togs bort.`);
  return { ok: true };
}

// ---------- the visitor's side (no sign-in) ----------

export type OpenAnswer = { ok: true; session: string; name: string } | { ok: false; status: 401 | 403 | 423 | 429; error: string; needCode?: boolean };

/** Opens a link from its secret (and code): the signed session for the cookie, or why not. Five wrong codes lock it 15 minutes. */
export async function openLink(secret: unknown, code: unknown, ip: string, now = new Date()): Promise<OpenAnswer> {
  const hit = await hitRateLimit(RATE_RULES.boardLinkIp, ip);
  if (!hit.allowed) return { ok: false, status: 429, error: "För många försök. Vänta en kvart och försök igen." };
  if (typeof secret !== "string" || !/^[A-Za-z0-9_-]{40,60}$/.test(secret)) return { ok: false, status: 403, error: "Länken fungerar inte. Be den som delade den om en ny." };
  const row = await prisma.boardAccess.findUnique({ where: { tokenHash: sha(secret) } });
  const organization = row ? await viewerOrganization(row.organizationId) : null;
  if (!row || row.kind !== "link" || !organizationShows(organization)) return { ok: false, status: 403, error: "Länken fungerar inte. Be den som delade den om en ny." };
  const state = linkState(row, now);
  if (state === "revoked" || state === "expired") return { ok: false, status: 403, error: state === "expired" ? "Länken har gått ut." : "Länken är spärrad." };
  if (state === "locked") return { ok: false, status: 423, error: "För många fel koder. Försök igen om en kvart.", needCode: true };
  if (row.codeHash) {
    if (typeof code !== "string" || !code.trim()) return { ok: false, status: 401, error: "Skriv koden du har fått.", needCode: true };
    if (!linkCodeMatches(code.trim().slice(0, 20), row.codeHash)) {
      const failed = row.failedCodes + 1;
      const lock = failed >= LINK_CODE_TRIES;
      await prisma.boardAccess.update({ where: { id: row.id }, data: lock ? { failedCodes: 0, lockedUntil: new Date(now.getTime() + LINK_LOCK_MINUTES * 60_000) } : { failedCodes: failed } });
      return { ok: false, status: lock ? 423 : 401, error: lock ? "För många fel koder. Försök igen om en kvart." : "Fel kod. Försök igen.", needCode: true };
    }
  }
  await prisma.boardAccess.update({ where: { id: row.id }, data: { failedCodes: 0, lastUsedAt: now } });
  return { ok: true, session: sign(row.id, row.tokenHash, linkSessionEnds(now.getTime())), name: row.name };
}

async function linkOfSession(value: string | undefined, now = new Date()) {
  const session = readLinkSession(value, ringSecrets(), now.getTime());
  if (!session) return null;
  const row = await prisma.boardAccess.findUnique({ where: { id: session.accessId } });
  if (!row || row.kind !== "link" || !session.macOf(row.tokenHash) || linkState(row, now) === "revoked" || linkState(row, now) === "expired") return null;
  const organization = await viewerOrganization(row.organizationId);
  if (!organization || !organizationShows(organization)) return null;
  return { row, organization, session };
}

/** What a link shows now; a session past half its time gets a renewed cookie (`session`). */
export async function linkFeed(value: string | undefined, now = new Date()) {
  const found = await linkOfSession(value, now);
  if (!found) throw new ApiError(401, "Öppna länken igen.");
  const { row, organization, session } = found;
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > 60_000) await prisma.boardAccess.update({ where: { id: row.id }, data: { lastUsedAt: now } }).catch(() => undefined);
  const feed = await targetFeed(organization, row, { namesAllowed: linkShowsNames(row), tag: "link", now });
  const renew = session.expiresAt - now.getTime() < (LINK_SESSION_HOURS * 3600_000) / 2 ? sign(row.id, row.tokenHash, linkSessionEnds(now.getTime())) : null;
  return { feed: { ...feed, name: row.name }, renew };
}

export async function linkImageLayouts(value: string | undefined) {
  const found = await linkOfSession(value);
  if (!found) throw new ApiError(401, "Öppna länken igen.");
  return { organizationId: found.organization.id, layouts: (await targetLayouts(found.organization.id, found.row)).map((layout) => readLayout(layout)) };
}
