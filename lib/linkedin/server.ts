import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { openCompanyKey, sealCompanyKey } from "@/lib/integrations/company-keys";
import { ApiError } from "@/lib/kfid/errors";
import {
  authorizationUrl, exchangeCode, fetchTransport, hasOrganizationScopes, LINKEDIN_VERSION, LinkedInError, organizationName, organizationUrn, PERSON_ID,
  personUrn, postingOrganizations, refreshAccessToken, scopesFor, statusFromToken, uploadImage, userInfo, createPost as createLinkedInPost,
  type LinkedInStatus, type LinkedInTransport, type ScopeSet, type TokenSet,
} from "./api";

/**
 * LinkedIn (2026-11-11) on the server: a company's own LinkedIn app, the member who connected it and where its posts go – the
 * member's own profile, or a company page the member administers (once LinkedIn has approved the app for the Community
 * Management API). Built like Facebook och Instagram (lib/meta/server.ts): every function takes the company the API checked,
 * and every row read or written is that company's.
 *
 * - The client secret and the tokens are sealed with the company's own data key and never returned.
 * - Koppla LinkedIn is LinkedIn's 3-legged OAuth: a single-use state (its hash stored, ten minutes, bound to the company and
 *   the person who pressed) is sent along, and the answer is accepted only for that person in that company.
 * - Nothing is ever posted automatically. Publicera and Testpublicering are an admin's press under Inlägg, and both are refused
 *   until the admin has switched publishing on (publishingApproved, off by default; a new connection switches it off).
 * - A token is never assumed to keep working: LinkedIn is asked (userinfo) when the card is opened (at most every six hours),
 *   on Kontrollera and every night; a refresh token, when LinkedIn gives one, renews the access token a week before it ends.
 * - The audit is the company's own and names what was done – never a text of a post, never a key.
 */
export type Actor = { userId: string; organizationId: string };
const KEY = { secret: "linkedin-client-secret", access: "linkedin-access-token", refresh: "linkedin-refresh-token" } as const;
const CHECK_EVERY_MS = 6 * 60 * 60_000;
const SOON_MS = 7 * 24 * 60 * 60_000;
const STATE_MS = 10 * 60_000;

let transportOverride: LinkedInTransport | null = null;
export function setLinkedInTransportForTests(transport: LinkedInTransport | null) { transportOverride = transport; }
const transport = () => transportOverride ?? fetchTransport;

const row = (organizationId: string) => prisma.linkedInConnection.findUnique({ where: { organizationId } });
type Row = NonNullable<Awaited<ReturnType<typeof row>>>;

async function openKey(organizationId: string, keyId: string, stored: string | null | undefined) {
  if (!stored) return null;
  try { return await openCompanyKey(organizationId, keyId, stored); } catch { return null; }
}

async function audit(actor: Actor, action: string, detail: string) {
  await prisma.administrationEvent.create({ data: { actorId: actor.userId, organizationId: actor.organizationId, action, detail: detail.slice(0, 500) } });
}

/** The address LinkedIn sends the browser back to; the admin registers it in the app's Auth tab. */
export const linkedInRedirectUri = (appUrl = env.APP_URL) => `${new URL(appUrl).origin}/api/linkedin/callback`;

// ---------- the view ----------

export type LinkedInOrganizationChoice = { id: string; name: string };
export type { LinkedInStatus };
export type LinkedInView = {
  clientId: string | null; clientSecretStored: boolean; connected: boolean; keysUnreadable: boolean;
  scopeSet: ScopeSet; scopes: string[]; organizationScopes: boolean;
  member: { id: string; name: string } | null;
  author: { type: "person" | "organization"; id: string; name: string } | null;
  organizations: LinkedInOrganizationChoice[];
  status: LinkedInStatus; statusMessage: string | null;
  accessTokenExpiresAt: string | null; refreshTokenExpiresAt: string | null; refreshable: boolean; checkedAt: string | null;
  publishingApproved: boolean; publishingApprovedAt: string | null;
  redirectUri: string; apiVersion: string;
};

const organizationsOf = (value: Prisma.JsonValue | null | undefined): LinkedInOrganizationChoice[] => (Array.isArray(value) ? value : []).flatMap((item) => {
  const entry = item as { id?: unknown; name?: unknown };
  return typeof entry?.id === "string" && /^\d{1,20}$/.test(entry.id) ? [{ id: entry.id, name: typeof entry.name === "string" ? entry.name : entry.id }] : [];
});

const scopeSetOf = (value: string | null | undefined): ScopeSet => (value === "organization" ? "organization" : "personal");

export async function linkedInView(organizationId: string): Promise<LinkedInView> {
  const found = await row(organizationId);
  const [secret, access] = found ? await Promise.all([openKey(organizationId, KEY.secret, found.clientSecretCipher), openKey(organizationId, KEY.access, found.accessTokenCipher)]) : [null, null];
  const unreadable = Boolean(found && ((found.clientSecretCipher && !secret) || (found.accessTokenCipher && !access)));
  const status: LinkedInStatus = !found || !found.clientId || !found.clientSecretCipher ? "missing" : !found.accessTokenCipher ? "unchecked" : unreadable ? "invalid" : (found.status as LinkedInStatus);
  const author = found?.accessTokenCipher && found.authorId ? { type: found.authorType === "organization" ? "organization" as const : "person" as const, id: found.authorId, name: found.authorName ?? found.authorId } : null;
  return {
    clientId: found?.clientId ?? null, clientSecretStored: Boolean(found?.clientSecretCipher), connected: Boolean(found?.accessTokenCipher), keysUnreadable: unreadable,
    scopeSet: scopeSetOf(found?.scopeSet), scopes: found?.scopes ?? [], organizationScopes: hasOrganizationScopes(found?.scopes ?? []),
    member: found?.memberId ? { id: found.memberId, name: found.memberName ?? found.memberId } : null,
    author, organizations: organizationsOf(found?.organizations),
    status, statusMessage: unreadable ? "Nycklarna kan inte läsas längre. Klistra in Client Secret igen och tryck Koppla LinkedIn." : status === "unchecked" ? null : found?.statusMessage ?? null,
    accessTokenExpiresAt: found?.accessTokenExpiresAt?.toISOString() ?? null, refreshTokenExpiresAt: found?.refreshTokenExpiresAt?.toISOString() ?? null,
    refreshable: Boolean(found?.refreshTokenCipher), checkedAt: found?.checkedAt?.toISOString() ?? null,
    publishingApproved: Boolean(found?.publishingApproved), publishingApprovedAt: found?.publishingApprovedAt?.toISOString() ?? null,
    redirectUri: linkedInRedirectUri(), apiVersion: LINKEDIN_VERSION,
  };
}

// ---------- the keys ----------

const CLIENT_ID = /^[A-Za-z0-9]{8,40}$/;
const CLIENT_SECRET = /^[A-Za-z0-9._=+/-]{8,200}$/;

/**
 * Saves the app's Client ID and Client Secret and what Koppla LinkedIn asks for. A new Client ID is another app: the tokens go
 * and publishing is switched off. `clientSecret: null` removes the secret.
 */
export async function saveLinkedInKeys(actor: Actor, input: { clientId?: string; clientSecret?: string | null; scopeSet?: ScopeSet }) {
  const { organizationId } = actor;
  const found = await row(organizationId);
  const clientId = input.clientId?.trim();
  if (clientId !== undefined && clientId && !CLIENT_ID.test(clientId)) throw new ApiError(400, "Client ID ser inte rätt ut. Kopiera det från appens Auth-flik hos LinkedIn.");
  const clientSecret = typeof input.clientSecret === "string" ? input.clientSecret.trim() : input.clientSecret;
  if (clientSecret && !CLIENT_SECRET.test(clientSecret)) throw new ApiError(400, "Client Secret ser inte rätt ut. Kopiera det från appens Auth-flik hos LinkedIn.");
  const data: Prisma.LinkedInConnectionUncheckedUpdateInput = { updatedById: actor.userId };
  const changes: string[] = [];
  if (clientId !== undefined && clientId !== (found?.clientId ?? "")) {
    Object.assign(data, { clientId: clientId || null, ...disconnected() });
    changes.push("Client ID");
  }
  if (clientSecret === null) { data.clientSecretCipher = null; changes.push("Client Secret togs bort"); }
  else if (clientSecret) { data.clientSecretCipher = await sealCompanyKey(organizationId, KEY.secret, clientSecret); changes.push("Client Secret byttes"); }
  if (input.scopeSet && input.scopeSet !== scopeSetOf(found?.scopeSet)) { data.scopeSet = input.scopeSet; changes.push(input.scopeSet === "organization" ? "behörighet för företagssida" : "behörighet för egen profil"); }
  if (found) await prisma.linkedInConnection.update({ where: { id: found.id }, data });
  else await prisma.linkedInConnection.create({ data: { ...(data as Prisma.LinkedInConnectionUncheckedCreateInput), organizationId } });
  if (changes.length) await audit(actor, "linkedin_connection", `Kopplingen till LinkedIn ändrades: ${changes.join(", ")}.`);
  return linkedInView(organizationId);
}

const disconnected = () => ({
  accessTokenCipher: null, accessTokenExpiresAt: null, refreshTokenCipher: null, refreshTokenExpiresAt: null, scopes: [], memberId: null, memberName: null,
  authorType: "person", authorId: null, authorName: null, organizations: Prisma.DbNull, status: "unchecked", statusMessage: null, checkedAt: null, publishingApproved: false,
}) satisfies Prisma.LinkedInConnectionUncheckedUpdateInput;

async function app(organizationId: string, found: Row | null) {
  const clientSecret = await openKey(organizationId, KEY.secret, found?.clientSecretCipher);
  if (!found?.clientId || !clientSecret) throw new ApiError(409, "Fyll i Client ID och Client Secret och tryck Spara först.");
  return { clientId: found.clientId, clientSecret };
}

// ---------- Koppla LinkedIn ----------

const stateHash = (state: string) => createHash("sha256").update(state).digest("hex");
const STATE = /^[A-Za-z0-9_-]{43}$/;

/** Koppla LinkedIn: a single-use state for this person in this company, and the address the browser goes to. */
export async function startLinkedInAuthorization(actor: Actor): Promise<{ url: string }> {
  const found = await row(actor.organizationId);
  const keys = await app(actor.organizationId, found);
  const state = randomBytes(32).toString("base64url");
  const scopes = scopesFor(scopeSetOf(found!.scopeSet));
  await prisma.linkedInConnection.update({ where: { id: found!.id }, data: { pendingStateHash: stateHash(state), pendingUserId: actor.userId, pendingExpiresAt: new Date(Date.now() + STATE_MS), pendingScopes: scopes } });
  await audit(actor, "linkedin_connection", "Koppla LinkedIn påbörjades.");
  return { url: authorizationUrl({ clientId: keys.clientId, redirectUri: linkedInRedirectUri(), state, scopes }) };
}

/** What the callback says on the page (Kopplingar shows a short text for each). */
export type LinkedInCallbackResult = "ok" | "choose" | "action" | "cancelled" | "expired" | "failed";

/**
 * LinkedIn's answer: accepted only with a state this person started in this company, unused and not older than ten minutes.
 * The state is spent whatever happens. The code is exchanged, LinkedIn says who the member is and – with the page scopes –
 * which company pages the member may post as. A new connection switches publishing off.
 */
export async function completeLinkedInAuthorization(actor: Actor, input: { state: string | null; code: string | null; error: string | null }): Promise<{ result: LinkedInCallbackResult; message: string }> {
  const { organizationId } = actor;
  const found = input.state && STATE.test(input.state) ? await prisma.linkedInConnection.findUnique({ where: { pendingStateHash: stateHash(input.state) } }) : null;
  if (!found || found.organizationId !== organizationId || found.pendingUserId !== actor.userId) return { result: "expired", message: "Svaret från LinkedIn hörde inte till den här kopplingen. Tryck Koppla LinkedIn igen." };
  const pendingScopes = found.pendingScopes;
  const fresh = Boolean(found.pendingExpiresAt && found.pendingExpiresAt.getTime() > Date.now());
  // Spent at once: the same answer never counts twice.
  await prisma.linkedInConnection.update({ where: { id: found.id }, data: { pendingStateHash: null, pendingUserId: null, pendingExpiresAt: null, pendingScopes: [] } });
  if (!fresh) return { result: "expired", message: "Det tog för lång tid. Tryck Koppla LinkedIn igen." };
  if (input.error) {
    await audit(actor, "linkedin_connection", "Koppla LinkedIn avbröts hos LinkedIn.");
    return { result: "cancelled", message: input.error.startsWith("user_cancelled") ? "Kopplingen avbröts hos LinkedIn." : "LinkedIn godkände inte kopplingen. Kontrollera appens produkter och adressen under Auth." };
  }
  if (!input.code || input.code.length > 2000) return { result: "failed", message: "LinkedIn skickade ingen kod. Tryck Koppla LinkedIn igen." };
  try {
    const keys = await app(organizationId, found);
    const tokens = await exchangeCode(transport(), keys, { code: input.code, redirectUri: linkedInRedirectUri() });
    // LinkedIn names the granted scopes; when it does not, the asked ones were all granted (the member accepts all or none).
    const scopes = tokens.scopes.length ? tokens.scopes : pendingScopes;
    const member = await userInfo(transport(), tokens.accessToken);
    const data = await connectionData(organizationId, found, tokens, scopes, member);
    await prisma.linkedInConnection.update({ where: { id: found.id }, data: { ...data, publishingApproved: false, updatedById: actor.userId } });
    await audit(actor, "linkedin_connection", `LinkedIn kopplades (${data.authorType === "organization" ? `företagssida id ${data.authorId}` : data.authorId ? "egen profil" : "välj var inläggen ska"}).`);
    const status = data.status as LinkedInStatus;
    return { result: status === "ok" ? "ok" : status === "choose" ? "choose" : "action", message: status === "ok" ? "LinkedIn är kopplat." : data.statusMessage ?? "LinkedIn är kopplat." };
  } catch (error) {
    await audit(actor, "linkedin_connection", "Koppla LinkedIn misslyckades.");
    return { result: "failed", message: error instanceof LinkedInError || error instanceof ApiError ? error.message : "Kopplingen till LinkedIn misslyckades." };
  }
}

/** The connection's columns from a new token: the member, the pages, where posts go and the status. */
async function connectionData(organizationId: string, found: Row, tokens: TokenSet, scopes: string[], member: { id: string; name: string }) {
  const scopeSet = scopeSetOf(found.scopeSet);
  const pages = hasOrganizationScopes(scopes) ? await organizationsWithNames(tokens.accessToken) : [];
  const personal = scopes.includes("w_member_social") && PERSON_ID.test(member.id);
  // Where posts go: the one company page, the member's own profile, or a choice.
  const keep = found.memberId === member.id && found.authorId ? (found.authorType === "organization" ? pages.find((page) => page.id === found.authorId) ?? null : personal ? "person" : null) : null;
  const target = keep ?? (pages.length === 1 && scopeSet === "organization" ? pages[0] : pages.length > 1 ? null : personal ? "person" : null);
  const known = statusFromToken({ expiresAt: tokens.expiresAt, refreshable: Boolean(tokens.refreshToken), refreshExpiresAt: tokens.refreshExpiresAt, scopeSet, scopes });
  const choose = !target && (pages.length > 1 || (pages.length > 0 && personal));
  return {
    accessTokenCipher: await sealCompanyKey(organizationId, KEY.access, tokens.accessToken), accessTokenExpiresAt: tokens.expiresAt,
    refreshTokenCipher: tokens.refreshToken ? await sealCompanyKey(organizationId, KEY.refresh, tokens.refreshToken) : null, refreshTokenExpiresAt: tokens.refreshExpiresAt,
    scopes, memberId: member.id, memberName: member.name.slice(0, 200),
    authorType: target && target !== "person" ? "organization" : "person",
    authorId: target === "person" ? member.id : target ? target.id : null,
    authorName: target === "person" ? member.name.slice(0, 200) : target ? target.name.slice(0, 200) : null,
    organizations: pages as unknown as Prisma.InputJsonValue,
    status: choose ? "choose" : !target ? "action" : known.status,
    statusMessage: choose ? "Välj var inläggen ska publiceras." : !target ? "Token får inte publicera. Lägg till Share on LinkedIn i appen och tryck Koppla LinkedIn igen." : known.message,
    checkedAt: new Date(),
  } satisfies Prisma.LinkedInConnectionUncheckedUpdateInput;
}

async function organizationsWithNames(token: string): Promise<LinkedInOrganizationChoice[]> {
  const ids = (await postingOrganizations(transport(), token)).slice(0, 25);
  return Promise.all(ids.map(async (id) => ({ id, name: (await organizationName(transport(), token, id)).slice(0, 200) })));
}

/** Chooses where posts go: "person" (the member's own profile) or one of the company pages LinkedIn listed. */
export async function chooseLinkedInAuthor(actor: Actor, choice: string) {
  const found = await row(actor.organizationId);
  if (!found?.accessTokenCipher || !found.memberId) throw new ApiError(409, "Koppla LinkedIn först.");
  const pages = organizationsOf(found.organizations);
  const page = choice === "person" ? null : pages.find((item) => item.id === choice);
  if (choice !== "person" && !page) throw new ApiError(404, "Sidan finns inte bland dem du administrerar.");
  if (choice === "person" && !found.scopes.includes("w_member_social")) throw new ApiError(409, "Token får inte publicera på din profil.");
  const known = statusFromToken({ expiresAt: found.accessTokenExpiresAt, refreshable: Boolean(found.refreshTokenCipher), refreshExpiresAt: found.refreshTokenExpiresAt, scopeSet: scopeSetOf(found.scopeSet), scopes: found.scopes });
  const same = (page ? found.authorType === "organization" && found.authorId === page.id : found.authorType === "person" && found.authorId === found.memberId);
  await prisma.linkedInConnection.update({ where: { id: found.id }, data: {
    authorType: page ? "organization" : "person", authorId: page ? page.id : found.memberId, authorName: page ? page.name : found.memberName,
    status: known.status, statusMessage: known.message, publishingApproved: same ? found.publishingApproved : false, updatedById: actor.userId,
  } });
  await audit(actor, "linkedin_connection", page ? `Företagssidan för inlägg på LinkedIn valdes (id ${page.id}).` : "Den egna profilen valdes för inlägg på LinkedIn.");
  return linkedInView(actor.organizationId);
}

async function invalidate(organizationId: string, message: string) {
  await prisma.linkedInConnection.updateMany({ where: { organizationId }, data: { status: "invalid", statusMessage: message, checkedAt: new Date() } });
}

/** A working access token: renewed with the refresh token a week before it ends (when LinkedIn gave one). */
async function accessToken(organizationId: string, found: Row): Promise<string | null> {
  const token = await openKey(organizationId, KEY.access, found.accessTokenCipher);
  if (!token) return null;
  const soon = found.accessTokenExpiresAt && found.accessTokenExpiresAt.getTime() - Date.now() < SOON_MS;
  if (!soon || !found.refreshTokenCipher) return token;
  const refresh = await openKey(organizationId, KEY.refresh, found.refreshTokenCipher);
  if (!refresh) return token;
  const tokens = await refreshAccessToken(transport(), await app(organizationId, found), refresh);
  await prisma.linkedInConnection.update({ where: { id: found.id }, data: {
    accessTokenCipher: await sealCompanyKey(organizationId, KEY.access, tokens.accessToken), accessTokenExpiresAt: tokens.expiresAt,
    ...(tokens.refreshToken ? { refreshTokenCipher: await sealCompanyKey(organizationId, KEY.refresh, tokens.refreshToken), refreshTokenExpiresAt: tokens.refreshExpiresAt } : {}),
  } });
  return tokens.accessToken;
}

/**
 * Kontrollera: asks LinkedIn who the token belongs to (userinfo) and, with the page scopes, which pages the member may post as;
 * renews the token when it can. `ifStale` makes it the check on opening: only when the last one is older than six hours.
 */
export async function checkLinkedIn(organizationId: string, options: { ifStale?: boolean } = {}): Promise<{ ok: boolean; message: string }> {
  const found = await row(organizationId);
  if (!found?.clientId || !found.clientSecretCipher || !found.accessTokenCipher) return { ok: false, message: "Fyll i Client ID och Client Secret och tryck Koppla LinkedIn först." };
  if (options.ifStale && found.checkedAt && Date.now() - found.checkedAt.getTime() < CHECK_EVERY_MS) return { ok: found.status === "ok", message: found.statusMessage ?? "" };
  try {
    const token = await accessToken(organizationId, found);
    if (!token) return { ok: false, message: "Nycklarna kan inte läsas längre. Tryck Koppla LinkedIn igen." };
    const current = (await row(organizationId))!;
    const member = await userInfo(transport(), token);
    if (current.memberId && member.id !== current.memberId) { await invalidate(organizationId, "Token hör till en annan LinkedIn-medlem. Tryck Koppla LinkedIn igen."); return { ok: false, message: "Token hör till en annan LinkedIn-medlem." }; }
    const pages = hasOrganizationScopes(current.scopes) ? await organizationsWithNames(token) : organizationsOf(current.organizations);
    const known = statusFromToken({ expiresAt: current.accessTokenExpiresAt, refreshable: Boolean(current.refreshTokenCipher), refreshExpiresAt: current.refreshTokenExpiresAt, scopeSet: scopeSetOf(current.scopeSet), scopes: current.scopes });
    const lostPage = current.authorType === "organization" && current.authorId && !pages.some((page) => page.id === current.authorId);
    const status: LinkedInStatus = lostPage || !current.authorId ? "choose" : known.status;
    const message = lostPage ? "Du är inte längre administratör för sidan. Välj var inläggen ska publiceras." : status === "choose" ? "Välj var inläggen ska publiceras." : known.message;
    await prisma.linkedInConnection.update({ where: { id: current.id }, data: {
      status, statusMessage: message, memberName: member.name.slice(0, 200), organizations: pages as unknown as Prisma.InputJsonValue, checkedAt: new Date(),
      ...(lostPage ? { authorId: null, authorName: null, publishingApproved: false } : {}),
    } });
    return { ok: status === "ok", message: message ?? "Kopplingen fungerar." };
  } catch (error) {
    if (error instanceof LinkedInError && error.kind === "token") { await invalidate(organizationId, error.message); return { ok: false, message: error.message }; }
    return { ok: false, message: error instanceof LinkedInError || error instanceof ApiError ? error.message : "Kopplingen kunde inte kontrolleras." };
  }
}

export async function removeLinkedInConnection(actor: Actor) {
  const removed = await prisma.linkedInConnection.deleteMany({ where: { organizationId: actor.organizationId } });
  if (removed.count) await audit(actor, "linkedin_connection", "Kopplingen till LinkedIn togs bort. Inläggen i Workflow finns kvar.");
  return linkedInView(actor.organizationId);
}

/** Publicering på/av: on only with a chosen author and a token that works. */
export async function setLinkedInPublishing(actor: Actor, on: boolean) {
  const found = await row(actor.organizationId);
  if (!found?.accessTokenCipher) throw new ApiError(409, "Koppla LinkedIn först.");
  if (on && (!found.authorId || found.status === "invalid" || found.status === "choose")) throw new ApiError(409, "Kopplingen måste fungera och det vara valt var inläggen ska innan publicering kan slås på.");
  if (found.publishingApproved === on) return linkedInView(actor.organizationId);
  await prisma.linkedInConnection.update({ where: { id: found.id }, data: on
    ? { publishingApproved: true, publishingApprovedAt: new Date(), publishingApprovedById: actor.userId }
    : { publishingApproved: false } });
  await audit(actor, "linkedin_publishing", on ? "Publicering till LinkedIn slogs på." : "Publicering till LinkedIn stängdes av.");
  return linkedInView(actor.organizationId);
}

/** For the Kopplingar list: is something connected, and does it work. */
export async function linkedInStatusLine(organizationId: string) {
  const view = await linkedInView(organizationId);
  return { status: view.status, author: view.author?.name ?? null, publishingApproved: view.publishingApproved, message: view.statusMessage };
}

// ---------- publishing (called by Inlägg, lib/meta/server.ts) ----------

export type LinkedInOutcome = { ok: boolean; id?: string | null; message: string };

/** Why LinkedIn cannot be used for a post now, or null (the same guard as Meta's: switched on, connected, an author). */
export async function linkedInPublishBlock(organizationId: string): Promise<{ status: number; message: string } | null> {
  const found = await row(organizationId);
  if (!found?.publishingApproved) return { status: 403, message: "Publicering till LinkedIn är avstängd. Slå på den under Kopplingar → Webb och sociala medier." };
  if (!found.accessTokenCipher || !found.authorId) return { status: 409, message: "Välj var inläggen ska under Kopplingar → LinkedIn först." };
  if (found.status === "invalid") return { status: 409, message: found.statusMessage ?? "Kopplingen till LinkedIn fungerar inte. Tryck Koppla LinkedIn igen." };
  return null;
}
export const linkedInPublishingOn = async (organizationId: string) => Boolean((await row(organizationId))?.publishingApproved);

/**
 * One post to LinkedIn. `test`: the token is asked who it belongs to and the picture is uploaded (LinkedIn shows an image no post
 * uses nowhere) – no post is made. `live`: the picture and then the post. A token error marks the connection invalid.
 */
export async function publishToLinkedIn(organizationId: string, input: { commentary: string; image: Uint8Array; altText: string }, mode: "test" | "live"): Promise<LinkedInOutcome> {
  const found = await row(organizationId);
  if (!found?.accessTokenCipher || !found.authorId) return { ok: false, message: "Välj var inläggen ska under Kopplingar först." };
  try {
    const token = await accessToken(organizationId, found);
    if (!token) return { ok: false, message: "Nycklarna kan inte läsas längre. Tryck Koppla LinkedIn igen." };
    const author = found.authorType === "organization" ? organizationUrn(found.authorId) : personUrn(found.authorId);
    if (mode === "test") {
      const member = await userInfo(transport(), token);
      if (found.memberId && member.id !== found.memberId) return { ok: false, message: "Token hör till en annan LinkedIn-medlem. Tryck Koppla LinkedIn igen." };
      await uploadImage(transport(), token, author, input.image);
      return { ok: true, message: `LinkedIn tog emot bilden för ${found.authorName ?? "kontot"} (inget inlägg gjordes, bilden syns inte).` };
    }
    const image = await uploadImage(transport(), token, author, input.image);
    const id = await createLinkedInPost(transport(), token, { author, commentary: input.commentary, image: { id: image, altText: input.altText } });
    return { ok: true, id, message: "Publicerat på LinkedIn." };
  } catch (error) {
    if (error instanceof LinkedInError && error.kind === "token") await invalidate(organizationId, error.message);
    return { ok: false, message: error instanceof LinkedInError || error instanceof ApiError ? error.message : "Något gick fel." };
  }
}

/** For the tests: the hash a state is stored as. */
export const stateHashForTests = stateHash;
