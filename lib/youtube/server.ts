import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { openCompanyKey, sealCompanyKey } from "@/lib/integrations/company-keys";
import { ApiError } from "@/lib/kfid/errors";
import {
  authorizationUrl, codeChallenge, exchangeCode, fetchTransport, localBase, myChannels, myPlaylists, refreshAccessToken, revokeToken, SCOPES, tokenProblem, videoCategories, YOUTUBE_SCOPE,
  YouTubeError, type Choice, type TokenSet, type YouTubeTransport,
} from "./api";

/**
 * YouTube (2026-11-20) on the server: a company's own Google API project, the Google account that connected it and the channel
 * its films go to. Built like LinkedIn (lib/linkedin/server.ts): every function takes the company the API checked, and every row
 * read or written is that company's.
 *
 * - The client secret, the tokens and the open sign-in's PKCE verifier are sealed with the company's own data key and never
 *   returned.
 * - Koppla YouTube is Google's OAuth 2.0 for web server apps with PKCE: a single-use state (its hash stored, ten minutes, bound to
 *   the company and the person who pressed) is sent along, and the answer is accepted only for that person in that company.
 * - The access token lives an hour; it is renewed with the refresh token five minutes before it ends, also in the upload job.
 * - Nothing is uploaded automatically. Publicera and Schemalägg are an admin's press under Filmer, and both are refused until the
 *   admin has switched publishing on (publishingApproved, off by default; a new connection switches it off).
 * - Google's audit: while the API project has not passed it, YouTube keeps every uploaded film private. The upload job notes it
 *   (privateLocked) when YouTube answers so, and the card says it plainly.
 * - The audit log is the company's own and names what was done – never a key, a token or a film's text.
 */
export type Actor = { userId: string; organizationId: string };
const KEY = { secret: "youtube-client-secret", access: "youtube-access-token", refresh: "youtube-refresh-token", verifier: "youtube-pkce-verifier" } as const;
const CHECK_EVERY_MS = 6 * 60 * 60_000;
const RENEW_BEFORE_MS = 5 * 60_000;
const STATE_MS = 10 * 60_000;

let transportOverride: YouTubeTransport | null = null;
export function setYouTubeTransportForTests(transport: YouTubeTransport | null) { transportOverride = transport; }
export const youTubeTransport = () => transportOverride ?? fetchTransport;

const row = (organizationId: string) => prisma.youTubeConnection.findUnique({ where: { organizationId } });
type Row = NonNullable<Awaited<ReturnType<typeof row>>>;

async function openKey(organizationId: string, keyId: string, stored: string | null | undefined) {
  if (!stored) return null;
  try { return await openCompanyKey(organizationId, keyId, stored); } catch { return null; }
}

async function audit(actor: Actor, action: string, detail: string) {
  await prisma.administrationEvent.create({ data: { actorId: actor.userId, organizationId: actor.organizationId, action, detail: detail.slice(0, 500) } });
}

/** The address Google sends the browser back to; the admin registers it under the OAuth client's Authorized redirect URIs. */
export const youTubeRedirectUri = (appUrl = env.APP_URL) => `${new URL(appUrl).origin}/api/youtube/callback`;

// ---------- the view ----------

export type YouTubeStatus = "missing" | "unchecked" | "choose" | "ok" | "action" | "invalid";
export type YouTubeView = {
  clientId: string | null; clientSecretStored: boolean; connected: boolean; keysUnreadable: boolean;
  scopes: string[]; channel: Choice | null; channels: Choice[]; playlists: Choice[]; categories: Choice[];
  status: YouTubeStatus; statusMessage: string | null; checkedAt: string | null; accessTokenExpiresAt: string | null; refreshable: boolean;
  privateLocked: boolean; privateLockedAt: string | null;
  publishingApproved: boolean; publishingApprovedAt: string | null;
  redirectUri: string; scope: string; standIn: boolean;
};

const choicesOf = (value: Prisma.JsonValue | null | undefined): Choice[] => (Array.isArray(value) ? value : []).flatMap((item) => {
  const entry = item as { id?: unknown; name?: unknown };
  return typeof entry?.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(entry.id) ? [{ id: entry.id, name: typeof entry.name === "string" ? entry.name : entry.id }] : [];
});

export async function youTubeView(organizationId: string): Promise<YouTubeView> {
  const found = await row(organizationId);
  const [secret, access] = found ? await Promise.all([openKey(organizationId, KEY.secret, found.clientSecretCipher), openKey(organizationId, KEY.access, found.accessTokenCipher)]) : [null, null];
  const unreadable = Boolean(found && ((found.clientSecretCipher && !secret) || (found.accessTokenCipher && !access)));
  const status: YouTubeStatus = !found || !found.clientId || !found.clientSecretCipher ? "missing" : !found.accessTokenCipher ? "unchecked" : unreadable ? "invalid" : (found.status as YouTubeStatus);
  return {
    clientId: found?.clientId ?? null, clientSecretStored: Boolean(found?.clientSecretCipher), connected: Boolean(found?.accessTokenCipher), keysUnreadable: unreadable,
    scopes: found?.scopes ?? [], channel: found?.accessTokenCipher && found.channelId ? { id: found.channelId, name: found.channelName ?? found.channelId } : null,
    channels: choicesOf(found?.channels), playlists: choicesOf(found?.playlists), categories: choicesOf(found?.categories),
    status, statusMessage: unreadable ? "Nycklarna kan inte läsas längre. Klistra in klienthemligheten igen och tryck Koppla YouTube." : status === "unchecked" ? null : found?.statusMessage ?? null,
    checkedAt: found?.checkedAt?.toISOString() ?? null, accessTokenExpiresAt: found?.accessTokenExpiresAt?.toISOString() ?? null, refreshable: Boolean(found?.refreshTokenCipher),
    privateLocked: Boolean(found?.privateLocked), privateLockedAt: found?.privateLockedAt?.toISOString() ?? null,
    publishingApproved: Boolean(found?.publishingApproved), publishingApprovedAt: found?.publishingApprovedAt?.toISOString() ?? null,
    redirectUri: youTubeRedirectUri(), scope: YOUTUBE_SCOPE, standIn: Boolean(localBase()),
  };
}

// ---------- the keys ----------

const CLIENT_ID = /^\d{4,30}-[A-Za-z0-9_]{8,64}\.apps\.googleusercontent\.com$/;
const CLIENT_SECRET = /^[A-Za-z0-9_-]{10,100}$/;

const disconnected = () => ({
  accessTokenCipher: null, accessTokenExpiresAt: null, refreshTokenCipher: null, scopes: [], channels: Prisma.DbNull, channelId: null, channelName: null,
  playlists: Prisma.DbNull, categories: Prisma.DbNull, status: "unchecked", statusMessage: null, checkedAt: null, publishingApproved: false,
}) satisfies Prisma.YouTubeConnectionUncheckedUpdateInput;

/**
 * Saves the OAuth client's id and secret. A new client id is another API project: the tokens go and publishing is switched off.
 * `clientSecret: null` removes the secret.
 */
export async function saveYouTubeKeys(actor: Actor, input: { clientId?: string; clientSecret?: string | null }) {
  const { organizationId } = actor;
  const found = await row(organizationId);
  const clientId = input.clientId?.trim();
  if (clientId && !CLIENT_ID.test(clientId)) throw new ApiError(400, "Klient-id ser inte rätt ut. Det slutar på .apps.googleusercontent.com och finns under Google Cloud › API:er och tjänster › Inloggningsuppgifter.");
  const clientSecret = typeof input.clientSecret === "string" ? input.clientSecret.trim() : input.clientSecret;
  if (clientSecret && !CLIENT_SECRET.test(clientSecret)) throw new ApiError(400, "Klienthemligheten ser inte rätt ut. Kopiera den från OAuth-klienten i Google Cloud.");
  const data: Prisma.YouTubeConnectionUncheckedUpdateInput = { updatedById: actor.userId };
  const changes: string[] = [];
  if (clientId !== undefined && clientId !== (found?.clientId ?? "")) { Object.assign(data, { clientId: clientId || null, ...disconnected() }); changes.push("klient-id"); }
  if (clientSecret === null) { data.clientSecretCipher = null; changes.push("klienthemligheten togs bort"); }
  else if (clientSecret) { data.clientSecretCipher = await sealCompanyKey(organizationId, KEY.secret, clientSecret); changes.push("klienthemligheten byttes"); }
  if (found) await prisma.youTubeConnection.update({ where: { id: found.id }, data });
  else await prisma.youTubeConnection.create({ data: { ...(data as Prisma.YouTubeConnectionUncheckedCreateInput), organizationId } });
  if (changes.length) await audit(actor, "youtube_connection", `Kopplingen till YouTube ändrades: ${changes.join(", ")}.`);
  return youTubeView(organizationId);
}

async function app(organizationId: string, found: Row | null) {
  const clientSecret = await openKey(organizationId, KEY.secret, found?.clientSecretCipher);
  if (!found?.clientId || !clientSecret) throw new ApiError(409, "Fyll i klient-id och klienthemlighet och tryck Spara först.");
  return { clientId: found.clientId, clientSecret };
}

// ---------- Koppla YouTube ----------

const stateHash = (state: string) => createHash("sha256").update(state).digest("hex");
const STATE = /^[A-Za-z0-9_-]{43}$/;

/** Koppla YouTube: a single-use state and PKCE verifier for this person in this company, and the address the browser goes to. */
export async function startYouTubeAuthorization(actor: Actor): Promise<{ url: string }> {
  const found = await row(actor.organizationId);
  const keys = await app(actor.organizationId, found);
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  await prisma.youTubeConnection.update({ where: { id: found!.id }, data: {
    pendingStateHash: stateHash(state), pendingVerifierCipher: await sealCompanyKey(actor.organizationId, KEY.verifier, verifier), pendingUserId: actor.userId, pendingExpiresAt: new Date(Date.now() + STATE_MS),
  } });
  await audit(actor, "youtube_connection", "Koppla YouTube påbörjades.");
  return { url: authorizationUrl({ clientId: keys.clientId, redirectUri: youTubeRedirectUri(), state, codeChallenge: codeChallenge(verifier) }) };
}

export type YouTubeCallbackResult = "ok" | "choose" | "action" | "cancelled" | "expired" | "failed";

/**
 * Google's answer: accepted only with a state this person started in this company, unused and not older than ten minutes. The
 * state is spent whatever happens. The code is exchanged with the secret and the verifier; Google then says which channels the
 * account has. A new connection switches publishing off.
 */
export async function completeYouTubeAuthorization(actor: Actor, input: { state: string | null; code: string | null; error: string | null }): Promise<{ result: YouTubeCallbackResult; message: string }> {
  const { organizationId } = actor;
  const found = input.state && STATE.test(input.state) ? await prisma.youTubeConnection.findUnique({ where: { pendingStateHash: stateHash(input.state) } }) : null;
  if (!found || found.organizationId !== organizationId || found.pendingUserId !== actor.userId) return { result: "expired", message: "Svaret från Google hörde inte till den här kopplingen. Tryck Koppla YouTube igen." };
  const fresh = Boolean(found.pendingExpiresAt && found.pendingExpiresAt.getTime() > Date.now());
  const verifier = await openKey(organizationId, KEY.verifier, found.pendingVerifierCipher);
  // Spent at once: the same answer never counts twice.
  await prisma.youTubeConnection.update({ where: { id: found.id }, data: { pendingStateHash: null, pendingVerifierCipher: null, pendingUserId: null, pendingExpiresAt: null } });
  if (!fresh || !verifier) return { result: "expired", message: "Det tog för lång tid. Tryck Koppla YouTube igen." };
  if (input.error) {
    await audit(actor, "youtube_connection", "Koppla YouTube avbröts hos Google.");
    return { result: "cancelled", message: input.error === "access_denied" ? "Kopplingen avbröts hos Google." : "Google godkände inte kopplingen. Kontrollera OAuth-klienten och omdirigeringsadressen." };
  }
  if (!input.code || input.code.length > 2000) return { result: "failed", message: "Google skickade ingen kod. Tryck Koppla YouTube igen." };
  try {
    const keys = await app(organizationId, found);
    const tokens = await exchangeCode(youTubeTransport(), keys, { code: input.code, redirectUri: youTubeRedirectUri(), codeVerifier: verifier });
    const data = await connectionData(organizationId, found, tokens);
    await prisma.youTubeConnection.update({ where: { id: found.id }, data: { ...data, publishingApproved: false, updatedById: actor.userId } });
    await audit(actor, "youtube_connection", `YouTube kopplades (${data.channelId ? `kanalen ${data.channelId}` : "välj kanal"}).`);
    const status = data.status as YouTubeStatus;
    return { result: status === "ok" ? "ok" : status === "choose" ? "choose" : "action", message: data.statusMessage ?? "YouTube är kopplat." };
  } catch (error) {
    await audit(actor, "youtube_connection", "Koppla YouTube misslyckades.");
    return { result: "failed", message: error instanceof YouTubeError || error instanceof ApiError ? error.message : "Kopplingen till YouTube misslyckades." };
  }
}

async function connectionData(organizationId: string, found: Row, tokens: TokenSet) {
  const channels = (await myChannels(youTubeTransport(), tokens.accessToken)).slice(0, 25);
  const keep = channels.find((channel) => channel.id === found.channelId) ?? (channels.length === 1 ? channels[0] : null);
  const [playlists, categories] = keep ? await Promise.all([myPlaylists(youTubeTransport(), tokens.accessToken), videoCategories(youTubeTransport(), tokens.accessToken).catch(() => [])]) : [[], []];
  const scopes = tokens.scopes.length ? tokens.scopes : [...SCOPES];
  const problem = tokenProblem({ scopes, refreshable: Boolean(tokens.refreshToken ?? found.refreshTokenCipher) });
  const status: YouTubeStatus = !channels.length ? "action" : !keep ? "choose" : problem ? "action" : "ok";
  return {
    accessTokenCipher: await sealCompanyKey(organizationId, KEY.access, tokens.accessToken), accessTokenExpiresAt: tokens.expiresAt,
    // Google gives the refresh token at the first consent; prompt=consent asks for a new one each time.
    refreshTokenCipher: tokens.refreshToken ? await sealCompanyKey(organizationId, KEY.refresh, tokens.refreshToken) : found.refreshTokenCipher,
    scopes, channels: channels as unknown as Prisma.InputJsonValue,
    channelId: keep?.id ?? null, channelName: keep?.name ?? null,
    playlists: playlists as unknown as Prisma.InputJsonValue, categories: categories as unknown as Prisma.InputJsonValue,
    status, statusMessage: !channels.length ? "Google-kontot har ingen YouTube-kanal. Skapa en kanal på youtube.com och tryck Koppla YouTube igen."
      : !keep ? "Välj vilken kanal filmerna ska till." : problem,
    checkedAt: new Date(),
  } satisfies Prisma.YouTubeConnectionUncheckedUpdateInput;
}

/** Chooses the channel among those Google listed. */
export async function chooseYouTubeChannel(actor: Actor, channelId: string) {
  const found = await row(actor.organizationId);
  if (!found?.accessTokenCipher) throw new ApiError(409, "Koppla YouTube först.");
  const channel = choicesOf(found.channels).find((item) => item.id === channelId);
  if (!channel) throw new ApiError(404, "Kanalen finns inte bland Google-kontots kanaler.");
  await prisma.youTubeConnection.update({ where: { id: found.id }, data: {
    channelId: channel.id, channelName: channel.name, status: "unchecked", publishingApproved: found.channelId === channel.id ? found.publishingApproved : false, updatedById: actor.userId,
  } });
  await audit(actor, "youtube_connection", `Kanalen för filmer på YouTube valdes (${channel.id}).`);
  await checkYouTube(actor.organizationId);
  return youTubeView(actor.organizationId);
}

async function invalidate(organizationId: string, message: string) {
  await prisma.youTubeConnection.updateMany({ where: { organizationId }, data: { status: "invalid", statusMessage: message, checkedAt: new Date() } });
}

/** A working access token: renewed with the refresh token five minutes before it ends. A refused renewal marks the connection invalid. */
export async function youTubeAccessToken(organizationId: string): Promise<string> {
  const found = await row(organizationId);
  if (!found?.accessTokenCipher) throw new ApiError(409, "Koppla YouTube under Kopplingar först.");
  const token = await openKey(organizationId, KEY.access, found.accessTokenCipher);
  if (!token) throw new ApiError(409, "Nycklarna kan inte läsas längre. Tryck Koppla YouTube igen.");
  const soon = !found.accessTokenExpiresAt || found.accessTokenExpiresAt.getTime() - Date.now() < RENEW_BEFORE_MS;
  if (!soon) return token;
  const refresh = await openKey(organizationId, KEY.refresh, found.refreshTokenCipher);
  if (!refresh) {
    if (found.accessTokenExpiresAt && found.accessTokenExpiresAt.getTime() > Date.now()) return token;
    await invalidate(organizationId, "Inloggningen hos Google har gått ut. Tryck Koppla YouTube igen.");
    throw new ApiError(409, "Inloggningen hos Google har gått ut. Tryck Koppla YouTube igen.");
  }
  try {
    const tokens = await refreshAccessToken(youTubeTransport(), await app(organizationId, found), refresh);
    await prisma.youTubeConnection.update({ where: { id: found.id }, data: {
      accessTokenCipher: await sealCompanyKey(organizationId, KEY.access, tokens.accessToken), accessTokenExpiresAt: tokens.expiresAt,
      ...(tokens.refreshToken ? { refreshTokenCipher: await sealCompanyKey(organizationId, KEY.refresh, tokens.refreshToken) } : {}),
    } });
    return tokens.accessToken;
  } catch (error) {
    if (error instanceof YouTubeError && error.kind === "token") await invalidate(organizationId, error.message);
    throw error;
  }
}

/**
 * Kontrollera: renews the token when it is about to end, asks Google for the account's channels, and reads the chosen channel's
 * playlists and the categories. `ifStale` makes it the check on opening: only when the last one is older than six hours.
 */
export async function checkYouTube(organizationId: string, options: { ifStale?: boolean } = {}): Promise<{ ok: boolean; message: string }> {
  const found = await row(organizationId);
  if (!found?.clientId || !found.clientSecretCipher || !found.accessTokenCipher) return { ok: false, message: "Fyll i klient-id och klienthemlighet och tryck Koppla YouTube först." };
  if (options.ifStale && found.checkedAt && found.status !== "unchecked" && Date.now() - found.checkedAt.getTime() < CHECK_EVERY_MS) return { ok: found.status === "ok", message: found.statusMessage ?? "" };
  try {
    const token = await youTubeAccessToken(organizationId);
    const current = (await row(organizationId))!;
    const channels = (await myChannels(youTubeTransport(), token)).slice(0, 25);
    const chosen = channels.find((channel) => channel.id === current.channelId) ?? null;
    const [playlists, categories] = chosen ? await Promise.all([myPlaylists(youTubeTransport(), token), videoCategories(youTubeTransport(), token).catch(() => choicesOf(current.categories))]) : [[], []];
    const lost = Boolean(current.channelId && !chosen);
    const problem = tokenProblem({ scopes: current.scopes, refreshable: Boolean(current.refreshTokenCipher) });
    const status: YouTubeStatus = !channels.length ? "action" : !chosen ? "choose" : problem ? "action" : "ok";
    const message = !channels.length ? "Google-kontot har ingen YouTube-kanal." : lost ? "Kanalen hör inte längre till Google-kontot. Välj kanal igen." : !chosen ? "Välj vilken kanal filmerna ska till." : problem;
    await prisma.youTubeConnection.update({ where: { id: current.id }, data: {
      status, statusMessage: message, channels: channels as unknown as Prisma.InputJsonValue, checkedAt: new Date(),
      ...(chosen ? { channelName: chosen.name, playlists: playlists as unknown as Prisma.InputJsonValue, categories: categories as unknown as Prisma.InputJsonValue } : {}),
      ...(lost ? { channelId: null, channelName: null, publishingApproved: false } : {}),
    } });
    return { ok: status === "ok", message: message ?? "Kopplingen fungerar." };
  } catch (error) {
    if (error instanceof YouTubeError && error.kind === "token") { await invalidate(organizationId, error.message); return { ok: false, message: error.message }; }
    return { ok: false, message: error instanceof YouTubeError || error instanceof ApiError ? error.message : "Kopplingen kunde inte kontrolleras." };
  }
}

/** Ta bort kopplingen: Workflow's access is taken back at Google (when it can be) and the row goes. The films in Workflow stay. */
export async function removeYouTubeConnection(actor: Actor) {
  const found = await row(actor.organizationId);
  if (!found) return youTubeView(actor.organizationId);
  const token = (await openKey(actor.organizationId, KEY.refresh, found.refreshTokenCipher)) ?? (await openKey(actor.organizationId, KEY.access, found.accessTokenCipher));
  let revoked = false;
  if (token) revoked = await revokeToken(youTubeTransport(), token).then(() => true, () => false);
  await prisma.youTubeConnection.deleteMany({ where: { organizationId: actor.organizationId } });
  await audit(actor, "youtube_connection", `Kopplingen till YouTube togs bort${token ? (revoked ? " och åtkomsten återkallades hos Google" : "; åtkomsten kunde inte återkallas hos Google") : ""}. Filmerna i Workflow finns kvar.`);
  return youTubeView(actor.organizationId);
}

/** Publicering på/av: on only with a chosen channel and a token that works. */
export async function setYouTubePublishing(actor: Actor, on: boolean) {
  const found = await row(actor.organizationId);
  if (!found?.accessTokenCipher) throw new ApiError(409, "Koppla YouTube först.");
  if (on && (!found.channelId || found.status === "invalid" || found.status === "choose")) throw new ApiError(409, "Innan publicering kan slås på måste kopplingen fungera och kanalen vara vald.");
  if (found.publishingApproved === on) return youTubeView(actor.organizationId);
  await prisma.youTubeConnection.update({ where: { id: found.id }, data: on
    ? { publishingApproved: true, publishingApprovedAt: new Date(), publishingApprovedById: actor.userId }
    : { publishingApproved: false } });
  await audit(actor, "youtube_publishing", on ? "Publicering till YouTube slogs på." : "Publicering till YouTube stängdes av.");
  return youTubeView(actor.organizationId);
}

/** For the Kopplingar list: is something connected, and does it work. */
export async function youTubeStatusLine(organizationId: string) {
  const view = await youTubeView(organizationId);
  return { status: view.status, channel: view.channel?.name ?? null, publishingApproved: view.publishingApproved, privateLocked: view.privateLocked, message: view.statusMessage };
}

/** Why films cannot go to YouTube now, or null: switched on, connected, a channel, a token that works. */
export async function youTubePublishBlock(organizationId: string): Promise<string | null> {
  const found = await row(organizationId);
  if (!found?.accessTokenCipher) return "Koppla YouTube under Kopplingar → Webb och sociala medier först.";
  if (!found.channelId || found.status === "choose") return "Välj kanal under Kopplingar → YouTube först.";
  if (found.status === "invalid") return found.statusMessage ?? "Kopplingen till YouTube fungerar inte. Tryck Koppla YouTube igen.";
  if (!found.publishingApproved) return "Publicering till YouTube är avstängd. Slå på den under Kopplingar → Webb och sociala medier.";
  return null;
}

/** The chosen channel (the upload job checks that the film goes where the admin chose). */
export const youTubeChannelId = async (organizationId: string) => (await row(organizationId))?.channelId ?? null;

/** An upload asked for Olistad or Offentlig and YouTube kept it private: Google's audit is not passed yet. */
export async function markPrivateLocked(organizationId: string, locked: boolean) {
  await prisma.youTubeConnection.updateMany({ where: { organizationId, privateLocked: !locked }, data: { privateLocked: locked, privateLockedAt: locked ? new Date() : null } });
}

/** A token error from the upload job or an action: the connection says so on the card. */
export async function youTubeTokenFailed(organizationId: string, message: string) { await invalidate(organizationId, message); }

/** For the tests: the hash a state is stored as. */
export const stateHashForTests = stateHash;
