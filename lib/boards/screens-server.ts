import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { requestFingerprint } from "@/lib/security/security-log";
import { RATE_RULES, clearRateLimit, hitRateLimit, rateLimitState } from "@/lib/security/rate-limit";
import { boardsAccess } from "./access";
import { forgetBoardFeeds } from "./feed-server";
import type { BoardsCaller } from "./server";
import {
  formatPairCode, normalizePairCode, pairCodeFrom, PAIR_CODE_LENGTH, PAIR_MINUTES, PAIR_POLL_SECONDS, readScreenSettings, SCREEN_COMMANDS, screenOnline, screenSettingsSchema, screenTooQuiet, targetSchema, type AccessTarget,
} from "./screens";
import { organizationShows, targetFeed, targetLayouts, viewerOrganization } from "./viewer-server";

/**
 * Kopplade skärmar (Tavlor och skärmar etapp 2, 2026-11-18; plan 7, fråga 7): the pairing request of a screen, its approval inside
 * Workflow, the screen key it gets in exchange, its feed and the admin's list. The screen key is 256 random bits and only its hash is
 * stored; it shows only what the screen was given and can never reach /api (lib/boards/guard.ts). Approving needs the right Skärmar,
 * a recent sign-in and a name and a board or playlist – the person cannot just click OK (plan 6.3, the risk of code phishing).
 */
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const audit = (caller: BoardsCaller, action: string, detail: string) =>
  prisma.administrationEvent.create({ data: { organizationId: caller.organizationId, actorId: caller.userId, action, detail: detail.slice(0, 500) } }).catch(() => undefined);
const requireScreens = (caller: BoardsCaller, manage = false) => {
  const rights = boardsAccess(caller);
  if (!(manage ? rights.manageScreens : rights.screens)) throw new ApiError(403, manage ? "Du saknar behörighet att koppla och ändra skärmar." : "Du saknar behörighet att se skärmarna.");
};
type HeaderSource = Headers | null;

// ---------- the screen's side (no sign-in) ----------

const deviceInfoSchema = z.object({ width: z.number().int().min(0).max(20_000).optional(), height: z.number().int().min(0).max(20_000).optional(), version: z.string().max(30).optional() }).partial();

/** A new pairing request: the code to show, and the screen's own secret for its cookie. */
export async function startPairing(headers: HeaderSource, info: unknown, ip: string) {
  const hit = await hitRateLimit(RATE_RULES.screenPairIp, ip);
  if (!hit.allowed) throw new ApiError(429, "För många kopplingar från det här nätet. Vänta en stund och försök igen.");
  const device = deviceInfoSchema.safeParse(info ?? {});
  const fingerprint = requestFingerprint(headers);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = pairCodeFrom(randomBytes(PAIR_CODE_LENGTH * 2));
    if (code.length !== PAIR_CODE_LENGTH) continue;
    const secret = randomBytes(32).toString("base64url");
    try {
      const row = await prisma.screenPairing.create({ data: {
        userCodeHash: sha(code), deviceSecretHash: sha(secret), expiresAt: new Date(Date.now() + PAIR_MINUTES * 60_000),
        requestInfo: { client: fingerprint.client, ...(device.success ? device.data : {}) }, networkHash: fingerprint.ipHash,
      }, select: { expiresAt: true } });
      return { code: formatPairCode(code), secret, expiresAt: row.expiresAt.toISOString(), interval: PAIR_POLL_SECONDS };
    } catch { /* the same code or secret twice: draw again */ }
  }
  throw new ApiError(503, "Det gick inte att skapa en kod just nu. Försök igen.");
}

/** The screen asks for its answer; once approved it gets its screen key (the raw token, for the cookie) exactly once. */
export async function pollPairing(secret: string | undefined, now = new Date()): Promise<{ status: "pending" | "slow_down" | "expired" } | { status: "ready"; token: string }> {
  if (!secret || secret.length > 100) return { status: "expired" };
  const row = await prisma.screenPairing.findUnique({ where: { deviceSecretHash: sha(secret) } });
  if (!row || row.status === "done" || row.expiresAt.getTime() <= now.getTime() && row.status !== "approved") return { status: "expired" };
  if (row.lastPollAt && now.getTime() - row.lastPollAt.getTime() < (PAIR_POLL_SECONDS - 1) * 1000) return { status: "slow_down" };
  await prisma.screenPairing.update({ where: { id: row.id }, data: { lastPollAt: now } });
  if (row.status !== "approved" || !row.screenId || !row.organizationId) return { status: "pending" };
  const screen = await prisma.screen.findFirst({ where: { id: row.screenId, organizationId: row.organizationId }, select: { accessId: true } });
  if (!screen) return { status: "expired" };
  const token = randomBytes(32).toString("base64url");
  // One exchange only: the pairing is done in the same step as the key is set, so a second poll gets nothing.
  const done = await prisma.screenPairing.updateMany({ where: { id: row.id, status: "approved" }, data: { status: "done" } });
  if (!done.count) return { status: "expired" };
  await prisma.boardAccess.update({ where: { id: screen.accessId }, data: { tokenHash: sha(token), revokedAt: null } });
  // The screen has just asked and gets its key: it is heard from now (filmed 2026-11-20: the list said "inte hörd av ännu" while the
  // TV already showed the board), and its first fetch of the board follows within seconds.
  await prisma.screen.update({ where: { id: row.screenId }, data: { lastSeenAt: now, ...(row.networkHash ? { lastNetworkHash: row.networkHash } : {}) } }).catch(() => undefined);
  return { status: "ready", token };
}

/** The screen of a screen key, if it may show anything now (not blocked, not quiet for 30 days, the company shows boards). */
async function screenOfToken(token: string | undefined, now = new Date()) {
  if (!token || token.length > 100) return null;
  const access = await prisma.boardAccess.findUnique({ where: { tokenHash: sha(token) }, include: { screen: true } });
  const screen = access?.screen;
  if (!access || access.kind !== "screen" || access.revokedAt || !screen || screen.status !== "active") return null;
  if (screenTooQuiet(screen.lastSeenAt, screen.approvedAt, now)) {
    await prisma.screen.update({ where: { id: screen.id }, data: { status: "disconnected" } }).catch(() => undefined);
    return null;
  }
  const organization = await viewerOrganization(access.organizationId);
  if (!organization || !organizationShows(organization)) throw new ApiError(423, "Tavlor och skärmar är avstängt för företaget just nu.");
  return { access, screen, organization };
}

/** What a connected screen shows now, and a one-time order (reload, identify) taken with it. Touches "last seen" once a minute. */
export async function screenFeed(token: string | undefined, info: unknown, headers: HeaderSource, now = new Date()) {
  const found = await screenOfToken(token, now);
  if (!found) throw new ApiError(401, "Skärmen är inte kopplad.");
  const { access, screen, organization } = found;
  const command = screen.command as { kind?: string; at?: string } | null;
  const device = deviceInfoSchema.safeParse(info ?? {});
  const touch = !screen.lastSeenAt || now.getTime() - screen.lastSeenAt.getTime() > 60_000 || command;
  if (touch) await prisma.screen.update({ where: { id: screen.id }, data: {
    lastSeenAt: now, lastNetworkHash: requestFingerprint(headers).ipHash, command: command ? Prisma.DbNull : undefined,
    ...(device.success && Object.keys(device.data).length ? { deviceInfo: { ...(screen.deviceInfo as object), ...device.data, client: requestFingerprint(headers).client } } : {}),
  } }).catch(() => undefined);
  const feed = await targetFeed(organization, access, { namesAllowed: true, tag: "screen", now });
  return { ...feed, screen: { name: screen.name, settings: readScreenSettings(screen.settings) }, command: command?.kind && (SCREEN_COMMANDS as readonly string[]).includes(command.kind) ? command.kind : null };
}

export async function screenImageLayouts(token: string | undefined) {
  const found = await screenOfToken(token);
  if (!found) throw new ApiError(401, "Skärmen är inte kopplad.");
  return { organizationId: found.organization.id, layouts: await targetLayouts(found.organization.id, found.access) };
}

// ---------- the admin's side ----------

/** What the admin sees about a code before approving: when it was asked for, the browser, the screen size, and whether it is on the same network. */
export async function pairingInfo(caller: BoardsCaller, rawCode: string, headers: HeaderSource, now = new Date()) {
  requireScreens(caller, true);
  const state = await rateLimitState(RATE_RULES.screenCodeUser, caller.userId);
  if (state !== "open") throw new ApiError(429, "För många fel koder. Vänta en kvart och försök igen.");
  const code = normalizePairCode(rawCode);
  const row = code ? await prisma.screenPairing.findUnique({ where: { userCodeHash: sha(code) } }) : null;
  if (!row || row.status !== "pending" || row.expiresAt.getTime() <= now.getTime()) {
    await hitRateLimit(RATE_RULES.screenCodeUser, caller.userId);
    throw new ApiError(404, "Koden finns inte eller har gått ut. Kontrollera koden på skärmen.");
  }
  await clearRateLimit(RATE_RULES.screenCodeUser, caller.userId);
  const info = (row.requestInfo ?? {}) as { client?: string; width?: number; height?: number };
  const mine = requestFingerprint(headers).ipHash;
  return { code: formatPairCode(code!), askedAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(), client: info.client || "Okänd webbläsare",
    size: info.width && info.height ? `${info.width} × ${info.height}` : null, sameNetwork: Boolean(mine && row.networkHash && mine === row.networkHash) };
}

async function requireTarget(caller: BoardsCaller, target: AccessTarget) {
  if (target.boardId) {
    const board = await prisma.board.findFirst({ where: { id: target.boardId, organizationId: caller.organizationId, deletedAt: null }, select: { publishedVersionId: true } });
    if (!board) throw new ApiError(404, "Tavlan finns inte.");
    if (!board.publishedVersionId) throw new ApiError(409, "Tavlan är inte publicerad. Publicera den först.");
  } else {
    const playlist = await prisma.boardPlaylist.findFirst({ where: { id: target.playlistId!, organizationId: caller.organizationId, deletedAt: null }, select: { id: true } });
    if (!playlist) throw new ApiError(404, "Spellistan finns inte.");
  }
  return { boardId: target.boardId ?? null, playlistId: target.playlistId ?? null };
}

const approveSchema = z.object({
  code: z.string().trim().min(8).max(12),
  name: z.string().trim().min(1, "Ge skärmen ett namn.").max(60),
  placeName: z.string().trim().max(80).default(""),
  target: targetSchema,
  settings: screenSettingsSchema.default({ theme: "dark", reloadHour: 3, burnIn: false, distance: null, inches: null }),
  /** "Det här är skärmen …": a screen whose cookie was lost keeps its settings. */
  screenId: z.string().trim().max(60).optional(),
});

export async function approvePairing(caller: BoardsCaller, input: unknown, now = new Date()) {
  requireScreens(caller, true);
  const data = approveSchema.parse(input);
  const code = normalizePairCode(data.code);
  const row = code ? await prisma.screenPairing.findUnique({ where: { userCodeHash: sha(code) } }) : null;
  if (!row || row.status !== "pending" || row.expiresAt.getTime() <= now.getTime()) throw new ApiError(404, "Koden finns inte eller har gått ut. Kontrollera koden på skärmen.");
  const target = await requireTarget(caller, data.target);
  const pending = `pending:${randomBytes(24).toString("hex")}`;
  const screenId = await prisma.$transaction(async (tx) => {
    let id: string;
    if (data.screenId) {
      const screen = await tx.screen.findFirst({ where: { id: data.screenId, organizationId: caller.organizationId }, select: { id: true, accessId: true } });
      if (!screen) throw new ApiError(404, "Skärmen finns inte.");
      await tx.boardAccess.update({ where: { id: screen.accessId }, data: { tokenHash: pending, revokedAt: null, ...target, name: data.name } });
      await tx.screen.update({ where: { id: screen.id }, data: { name: data.name, placeName: data.placeName, settings: data.settings, status: "active", approvedById: caller.userId, approvedAt: now, lastSeenAt: null } });
      id = screen.id;
    } else {
      const access = await tx.boardAccess.create({ data: { organizationId: caller.organizationId, kind: "screen", name: data.name, ...target, tokenHash: pending, createdById: caller.userId } });
      const screen = await tx.screen.create({ data: { organizationId: caller.organizationId, accessId: access.id, name: data.name, placeName: data.placeName, settings: data.settings, approvedById: caller.userId, approvedAt: now, deviceInfo: row.requestInfo as Prisma.InputJsonValue } });
      id = screen.id;
    }
    const approved = await tx.screenPairing.updateMany({ where: { id: row.id, status: "pending" }, data: { status: "approved", organizationId: caller.organizationId, screenId: id, approvedAt: now } });
    if (!approved.count) throw new ApiError(409, "Koden har redan använts.");
    return id;
  });
  await audit(caller, "screen_approved", `Skärmen ${data.name} kopplades${data.screenId ? " igen" : ""}.`);
  return { id: screenId };
}

export async function listScreens(caller: BoardsCaller, now = Date.now()) {
  requireScreens(caller);
  const rows = await prisma.screen.findMany({ where: { organizationId: caller.organizationId, status: { not: "removed" } }, orderBy: { name: "asc" }, take: 500, include: { access: { select: { boardId: true, playlistId: true, revokedAt: true } } } });
  const [boards, playlists] = await Promise.all([
    prisma.board.findMany({ where: { organizationId: caller.organizationId, id: { in: rows.flatMap((row) => row.access.boardId ? [row.access.boardId] : []) } }, select: { id: true, name: true, deletedAt: true } }),
    prisma.boardPlaylist.findMany({ where: { organizationId: caller.organizationId, id: { in: rows.flatMap((row) => row.access.playlistId ? [row.access.playlistId] : []) } }, select: { id: true, name: true, deletedAt: true } }),
  ]);
  const shows = (row: (typeof rows)[number]) => {
    const board = boards.find((item) => item.id === row.access.boardId);
    const playlist = playlists.find((item) => item.id === row.access.playlistId);
    return board ? (board.deletedAt ? "Borttagen tavla" : board.name) : playlist ? (playlist.deletedAt ? "Borttagen spellista" : `Spellista: ${playlist.name}`) : "–";
  };
  return {
    items: rows.map((row) => {
      const device = (row.deviceInfo ?? {}) as { width?: number; height?: number; version?: string; client?: string };
      const status = row.access.revokedAt || row.status === "revoked" ? "revoked" : row.status === "disconnected" ? "disconnected" : screenOnline(row.lastSeenAt, now) ? "online" : "offline";
      return { id: row.id, name: row.name, placeName: row.placeName, status, lastSeenAt: row.lastSeenAt?.toISOString() ?? null, shows: shows(row),
        target: { boardId: row.access.boardId, playlistId: row.access.playlistId }, settings: readScreenSettings(row.settings),
        size: device.width && device.height ? `${device.width} × ${device.height}` : null, client: device.client ?? null, version: device.version ?? null };
    }),
    canManage: boardsAccess(caller).manageScreens,
  };
}

const updateSchema = z.object({ name: z.string().trim().min(1, "Ge skärmen ett namn.").max(60), placeName: z.string().trim().max(80).default(""), target: targetSchema, settings: screenSettingsSchema });

async function screenRow(caller: BoardsCaller, id: string) {
  const row = await prisma.screen.findFirst({ where: { id, organizationId: caller.organizationId, status: { not: "removed" } } });
  if (!row) throw new ApiError(404, "Skärmen finns inte.");
  return row;
}

export async function updateScreen(caller: BoardsCaller, id: string, input: unknown) {
  requireScreens(caller, true);
  const data = updateSchema.parse(input);
  const row = await screenRow(caller, id);
  const target = await requireTarget(caller, data.target);
  await prisma.$transaction([
    prisma.screen.update({ where: { id: row.id }, data: { name: data.name, placeName: data.placeName, settings: data.settings } }),
    prisma.boardAccess.update({ where: { id: row.accessId }, data: { ...target, name: data.name } }),
  ]);
  if (target.boardId) forgetBoardFeeds({ boardId: target.boardId });
  await audit(caller, "screen_changed", `Skärmen ${data.name} ändrades.`);
  return { ok: true };
}

export async function commandScreen(caller: BoardsCaller, id: string, kind: string) {
  requireScreens(caller, true);
  if (!(SCREEN_COMMANDS as readonly string[]).includes(kind)) throw new ApiError(400, "Okänd åtgärd.");
  const row = await screenRow(caller, id);
  await prisma.screen.update({ where: { id: row.id }, data: { command: { kind, at: new Date().toISOString() } } });
  return { ok: true };
}

/** Spärra: the screen key stops at the next fetch (within seconds); the screen can be connected again with a new code. */
export async function revokeScreen(caller: BoardsCaller, id: string) {
  requireScreens(caller, true);
  const row = await screenRow(caller, id);
  await prisma.$transaction([
    prisma.boardAccess.update({ where: { id: row.accessId }, data: { revokedAt: new Date() } }),
    prisma.screen.update({ where: { id: row.id }, data: { status: "revoked" } }),
  ]);
  await audit(caller, "screen_revoked", `Skärmen ${row.name} spärrades.`);
  return { ok: true };
}

export async function deleteScreen(caller: BoardsCaller, id: string) {
  requireScreens(caller, true);
  const row = await screenRow(caller, id);
  await prisma.boardAccess.delete({ where: { id: row.accessId } });
  await audit(caller, "screen_removed", `Skärmen ${row.name} togs bort.`);
  return { ok: true };
}
