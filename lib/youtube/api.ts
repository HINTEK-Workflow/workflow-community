/**
 * YouTube (2026-11-20): every request the server makes to Google for YouTube goes through here. Server only – the browser is only
 * sent to Google's own sign-in page (the authorization address) by Koppla YouTube, and never loads anything from Google.
 *
 * Fixed hosts over https: accounts.google.com (the sign-in), oauth2.googleapis.com (tokens and revoking them) and
 * www.googleapis.com (the YouTube Data API v3 and its uploads). No redirects are followed, a time limit covers each request and
 * the answer's size is limited (the same protections as lib/linkedin/api.ts). The tests and the QA instance may point all four at
 * a loopback stand-in with YOUTUBE_API_BASE_URL (http://127.0.0.1:<port> or http://localhost:<port> only); any other value is
 * ignored, so an installation can never send the tokens anywhere but Google.
 *
 * The request shapes follow Google's documentation (read 2026-11-20):
 * - OAuth 2.0 for web server apps (with PKCE):  developers.google.com/identity/protocols/oauth2/web-server
 * - Scopes:                                      developers.google.com/youtube/v3/guides/auth/server-side-web-apps
 * - Resumable uploads:                           developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
 * - videos.insert / update / delete / list:      developers.google.com/youtube/v3/docs/videos
 * - thumbnails.set, playlists.list, playlistItems.insert, channels.list, videoCategories.list: …/youtube/v3/docs/<resource>
 * - Quota costs:                                 developers.google.com/youtube/v3/determine_quota_cost
 *
 * One scope is asked for: https://www.googleapis.com/auth/youtube. It covers videos.insert (the upload), videos.update and
 * videos.delete, thumbnails.set, playlists.list, playlistItems.insert, channels.list and videoCategories.list. youtube.upload alone
 * cannot change or remove a film or add it to a playlist, and youtube.force-ssl adds comments and captions, which Workflow never
 * touches – so `youtube` is the smallest that covers it all.
 *
 * Tokens travel only in the Authorization header (API) or the form body (OAuth) – never in an address, a log or an error text.
 * The upload's session address is a secret too (whoever has it may send bytes): it is sealed where it is stored.
 */
import { createHash } from "node:crypto";

export const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube";
export const SCOPES = [YOUTUBE_SCOPE] as const;
const HOSTS = { auth: "accounts.google.com", oauth: "oauth2.googleapis.com", api: "www.googleapis.com" } as const;

type Source = Record<string, string | undefined>;
/** The stand-in's origin when YOUTUBE_API_BASE_URL is a loopback address, else null (Google itself). */
export function localBase(source: Source = process.env): string | null {
  const own = source.YOUTUBE_API_BASE_URL?.trim();
  if (!own) return null;
  try {
    const url = new URL(own);
    if (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && !url.username && !url.password) return url.origin;
  } catch { /* ignored: Google itself */ }
  return null;
}

/** The base of each kind of address: Google's hosts, or the stand-in for all of them. */
export function endpoints(source: Source = process.env) {
  const local = localBase(source);
  return {
    authorize: local ? `${local}/o/oauth2/v2/auth` : `https://${HOSTS.auth}/o/oauth2/v2/auth`,
    token: local ? `${local}/token` : `https://${HOSTS.oauth}/token`,
    revoke: local ? `${local}/revoke` : `https://${HOSTS.oauth}/revoke`,
    api: local ? `${local}/youtube/v3` : `https://${HOSTS.api}/youtube/v3`,
    upload: local ? `${local}/upload/youtube/v3` : `https://${HOSTS.api}/upload/youtube/v3`,
  };
}

/** Whether an address is one Workflow may send a request to: Google's hosts over https (or the stand-in). Pure. */
export function googleUrl(value: string, source: Source = process.env): URL | null {
  try {
    const url = new URL(value);
    const local = localBase(source);
    if (local && url.origin === local) return url;
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    return (Object.values(HOSTS) as string[]).includes(url.hostname.toLowerCase()) ? url : null;
  } catch { return null; }
}

/** An upload session address YouTube hands out: only www.googleapis.com/upload/… (or the stand-in's). Pure. */
export function uploadSessionUrl(value: string, source: Source = process.env): URL | null {
  const url = googleUrl(value, source);
  if (!url) return null;
  return url.pathname.startsWith("/upload/youtube/v3/") && (localBase(source) ? true : url.hostname === HOSTS.api) ? url : null;
}

export type YouTubeErrorKind = "token" | "permission" | "quota" | "rate" | "network" | "notFound" | "session" | "invalid" | "other";
export class YouTubeError extends Error {
  constructor(message: string, readonly kind: YouTubeErrorKind, readonly status: number, readonly reason: string | null = null) {
    super(message);
    this.name = "YouTubeError";
  }
}
/** Whether an attempt may succeed later by itself (the network, Google's servers, a rate, the day's quota). */
export const retryable = (error: unknown) => error instanceof YouTubeError && (error.kind === "network" || error.kind === "rate" || error.kind === "quota" || error.status >= 500);

const TOKEN_HELP = "Tryck Koppla YouTube under Kopplingar igen.";

/** Google's answer as one of ours: a short Swedish text and a kind. Pure. */
export function youTubeErrorOf(status: number, body: unknown, where: "oauth" | "api" | "upload" = "api"): YouTubeError {
  const data = (body && typeof body === "object" ? body : {}) as { error?: unknown; error_description?: unknown };
  if (typeof data.error === "string") {
    if (data.error === "invalid_grant") return new YouTubeError(`Google godtog inte inloggningen längre (den har gått ut eller tagits bort). ${TOKEN_HELP}`, "token", 409, data.error);
    if (data.error === "invalid_client" || data.error === "unauthorized_client") return new YouTubeError("Google godtar inte klient-id eller klienthemlighet. Kopiera dem igen från Google Cloud.", "invalid", 400, data.error);
    if (data.error === "redirect_uri_mismatch") return new YouTubeError("Omdirigeringsadressen stämmer inte med den i Google Cloud.", "invalid", 400, data.error);
    return new YouTubeError("Google godtog inte anropet.", "other", 400, data.error);
  }
  const error = (data.error && typeof data.error === "object" ? data.error : {}) as { errors?: { reason?: unknown }[]; status?: unknown };
  const reason = Array.isArray(error.errors) && typeof error.errors[0]?.reason === "string" ? error.errors[0].reason : null;
  if (status === 401 || reason === "authError" || reason === "invalidCredentials") return new YouTubeError(`Inloggningen hos Google gäller inte längre. ${TOKEN_HELP}`, "token", 409, reason);
  if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") return new YouTubeError("YouTubes dagliga kvot för projektet är slut. Uppladdningen fortsätter när kvoten fylls på (vid midnatt, amerikansk västkusttid).", "quota", 429, reason);
  if (reason === "uploadLimitExceeded") return new YouTubeError("Kanalen har laddat upp så många filmer den får just nu. Försök igen senare.", "quota", 429, reason);
  if (status === 429 || reason === "rateLimitExceeded" || reason === "userRateLimitExceeded") return new YouTubeError("YouTube begränsar antalet anrop just nu. Uppladdningen försöker igen om en stund.", "rate", 429, reason);
  if (where === "upload" && (status === 404 || status === 410)) return new YouTubeError("Uppladdningen hos YouTube har gått ut. Den börjar om från början.", "session", 409, reason);
  if (status === 404 || reason === "videoNotFound" || reason === "playlistNotFound") return new YouTubeError("Filmen eller spellistan finns inte längre på YouTube.", "notFound", 404, reason);
  if (reason === "invalidTitle") return new YouTubeError("YouTube godtog inte titeln.", "invalid", 400, reason);
  if (reason === "invalidDescription") return new YouTubeError("YouTube godtog inte beskrivningen.", "invalid", 400, reason);
  if (reason === "invalidTags") return new YouTubeError("YouTube godtog inte taggarna.", "invalid", 400, reason);
  if (reason === "invalidCategoryId") return new YouTubeError("YouTube godtog inte kategorin. Välj en annan.", "invalid", 400, reason);
  if (reason === "invalidImage" || reason === "mediaBodyRequired") return new YouTubeError("YouTube godtog inte omslagsbilden. Välj en JPEG- eller PNG-bild på högst 2 MB.", "invalid", 400, reason);
  if (status === 403) return new YouTubeError(reason === "forbidden" && where === "api"
    ? "YouTube tillåter inte det här för kanalen. Egna omslagsbilder kräver att kanalen är verifierad hos YouTube."
    : "Behörighet saknas hos YouTube för det här. Koppla YouTube igen och godkänn alla rättigheter.", "permission", 409, reason);
  if (status >= 500) return new YouTubeError("YouTube svarade med ett serverfel. Uppladdningen försöker igen om en stund.", "other", 502, reason);
  if (status === 400) return new YouTubeError("YouTube godtog inte anropet. Kontrollera texterna och filen.", "invalid", 400, reason);
  return new YouTubeError("YouTube svarade med ett fel.", "other", 400, reason);
}

export type YouTubeRequest = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  token?: string;
  form?: Record<string, string>;
  json?: unknown;
  bytes?: { data: Uint8Array; type: string };
  headers?: Record<string, string>;
};
export type YouTubeAnswer = { status: number; headers: Record<string, string>; body: unknown };
/** How a request reaches Google; the tests give their own. */
export type YouTubeTransport = (request: YouTubeRequest) => Promise<YouTubeAnswer>;

const TIMEOUT_MS = 30_000;
/** A piece of 8 MiB on a slow line takes long: the upload's own requests get more time. */
const UPLOAD_TIMEOUT_MS = 10 * 60_000;
const MAX_BYTES = 2 * 1024 * 1024;

/** The real transport: fetch to Google's hosts only, no redirects (a 308 is the upload's own answer), a time and a size limit. */
export const fetchTransport: YouTubeTransport = async (request) => {
  const url = googleUrl(request.url);
  if (!url) throw new YouTubeError("Ogiltig adress till Google.", "other", 400);
  const headers: Record<string, string> = { "user-agent": "Workflow", ...(request.headers ?? {}) };
  if (request.token) headers.authorization = `Bearer ${request.token}`;
  let body: BodyInit | undefined;
  if (request.form) { body = new URLSearchParams(request.form); headers["content-type"] = "application/x-www-form-urlencoded"; }
  else if (request.json !== undefined) { body = JSON.stringify(request.json); headers["content-type"] = "application/json; charset=UTF-8"; }
  else if (request.bytes) { body = new Blob([new Uint8Array(request.bytes.data)], { type: request.bytes.type }); headers["content-type"] = request.bytes.type; }
  let response: Response;
  try {
    response = await fetch(url, { method: request.method, body, headers, redirect: "manual", signal: AbortSignal.timeout(request.bytes ? UPLOAD_TIMEOUT_MS : TIMEOUT_MS) });
  } catch (error) {
    const timeout = (error as Error)?.name === "TimeoutError";
    throw new YouTubeError(timeout ? "YouTube svarar inte (tidsgränsen gick ut)." : "Ingen kontakt med YouTube.", "network", 504);
  }
  if (response.status >= 300 && response.status < 400 && response.status !== 308) throw new YouTubeError("Google svarade med en omdirigering, som inte följs.", "other", 502);
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel().catch(() => undefined); throw new YouTubeError("Svaret från YouTube är för stort.", "other", 502); }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  const out: Record<string, string> = {};
  response.headers.forEach((value, key) => { out[key.toLowerCase()] = value; });
  return { status: response.status, headers: out, body: parsed };
};

async function call(transport: YouTubeTransport, request: YouTubeRequest, where: "oauth" | "api" | "upload" = "api"): Promise<YouTubeAnswer> {
  const answer = await transport(request);
  if (answer.status >= 400) throw youTubeErrorOf(answer.status, answer.body, where);
  return answer;
}
const objectOf = (answer: YouTubeAnswer) => {
  if (!answer.body || typeof answer.body !== "object") throw new YouTubeError("YouTube svarade inte som väntat.", "other", 502);
  return answer.body as Record<string, unknown>;
};
const itemsOf = (body: Record<string, unknown>) => (Array.isArray(body.items) ? body.items : []) as Record<string, unknown>[];
const snippetOf = (item: Record<string, unknown>) => (item.snippet && typeof item.snippet === "object" ? item.snippet : {}) as Record<string, unknown>;

// ---------- OAuth ----------

export type GoogleApp = { clientId: string; clientSecret: string };

/** The PKCE challenge of a verifier: BASE64URL(SHA256(verifier)) (RFC 7636, S256). Pure. */
export const codeChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

/** Why the token cannot do what Workflow needs, or null. Pure. */
export function tokenProblem(input: { scopes: readonly string[]; refreshable: boolean }): string | null {
  if (input.scopes.length && !input.scopes.includes(YOUTUBE_SCOPE)) return "Google gav inte rätten att hantera kanalens filmer. Tryck Koppla YouTube igen och godkänn alla rättigheter.";
  if (!input.refreshable) return "Google gav ingen förnyelse av inloggningen, så kopplingen slutar fungera inom en timme. Ta bort Workflows åtkomst i Google-kontot och tryck Koppla YouTube igen.";
  return null;
}

/**
 * Where the browser is sent (accounts.google.com/o/oauth2/v2/auth): offline access so Google gives a refresh token, consent
 * every time (a new Koppla YouTube always gets one), PKCE with S256 and a single-use state. Pure.
 */
export function authorizationUrl(input: { clientId: string; redirectUri: string; state: string; codeChallenge: string; scopes?: readonly string[] }, source: Source = process.env): string {
  const url = new URL(endpoints(source).authorize);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", (input.scopes ?? SCOPES).join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent select_account");
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString().replace(/\+/g, "%20");
}

export type TokenSet = { accessToken: string; expiresAt: Date | null; refreshToken: string | null; scopes: string[] };

function tokenSetOf(body: Record<string, unknown>, now = Date.now()): TokenSet {
  if (typeof body.access_token !== "string" || !body.access_token) throw new YouTubeError("Google gav ingen token tillbaka.", "other", 502);
  return {
    accessToken: body.access_token,
    expiresAt: typeof body.expires_in === "number" && body.expires_in > 0 ? new Date(now + body.expires_in * 1000) : null,
    refreshToken: typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : null,
    scopes: typeof body.scope === "string" ? body.scope.split(/\s+/).filter(Boolean) : [],
  };
}

/** The code for tokens (POST oauth2.googleapis.com/token, form encoded, with the secret and the PKCE verifier). */
export async function exchangeCode(transport: YouTubeTransport, app: GoogleApp, input: { code: string; redirectUri: string; codeVerifier: string }): Promise<TokenSet> {
  const answer = await call(transport, { method: "POST", url: endpoints().token, form: {
    grant_type: "authorization_code", code: input.code, client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: input.redirectUri, code_verifier: input.codeVerifier,
  } }, "oauth");
  return tokenSetOf(objectOf(answer));
}

/** A new access token from the refresh token (Google keeps the refresh token; a new one is seldom given). */
export async function refreshAccessToken(transport: YouTubeTransport, app: GoogleApp, refreshToken: string): Promise<TokenSet> {
  const answer = await call(transport, { method: "POST", url: endpoints().token, form: {
    grant_type: "refresh_token", refresh_token: refreshToken, client_id: app.clientId, client_secret: app.clientSecret,
  } }, "oauth");
  return tokenSetOf(objectOf(answer));
}

/** Takes back Workflow's access at Google (Koppla från). A token Google no longer knows is already gone. */
export async function revokeToken(transport: YouTubeTransport, token: string): Promise<void> {
  const answer = await transport({ method: "POST", url: endpoints().revoke, form: { token } });
  if (answer.status >= 400 && answer.status !== 400) throw youTubeErrorOf(answer.status, answer.body, "oauth");
}

// ---------- the channel, its playlists and the categories ----------

export type Choice = { id: string; name: string };
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{10,40}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,64}$/;

/** The Google account's channels (GET channels?part=snippet&mine=true, 1 unit). */
export async function myChannels(transport: YouTubeTransport, token: string): Promise<Choice[]> {
  const url = new URL(`${endpoints().api}/channels`);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("mine", "true");
  url.searchParams.set("maxResults", "50");
  const body = objectOf(await call(transport, { method: "GET", url: url.toString(), token }));
  return itemsOf(body).flatMap((item) => typeof item.id === "string" && CHANNEL_ID.test(item.id)
    ? [{ id: item.id, name: String(snippetOf(item).title ?? item.id).slice(0, 200) }] : []);
}

/** The channel's playlists (GET playlists?part=snippet&mine=true, 1 unit a page; at most four pages of 50). */
export async function myPlaylists(transport: YouTubeTransport, token: string): Promise<Choice[]> {
  const out: Choice[] = [];
  let page: string | null = null;
  for (let round = 0; round < 4; round += 1) {
    const url = new URL(`${endpoints().api}/playlists`);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("mine", "true");
    url.searchParams.set("maxResults", "50");
    if (page) url.searchParams.set("pageToken", page);
    const body = objectOf(await call(transport, { method: "GET", url: url.toString(), token }));
    for (const item of itemsOf(body)) if (typeof item.id === "string" && PLAYLIST_ID.test(item.id)) out.push({ id: item.id, name: String(snippetOf(item).title ?? item.id).slice(0, 200) });
    page = typeof body.nextPageToken === "string" && body.nextPageToken ? body.nextPageToken : null;
    if (!page) break;
  }
  return out;
}

/** The categories a film may get in Sweden, in Swedish (GET videoCategories?part=snippet&regionCode=SE&hl=sv, 1 unit). */
export async function videoCategories(transport: YouTubeTransport, token: string): Promise<Choice[]> {
  const url = new URL(`${endpoints().api}/videoCategories`);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("regionCode", "SE");
  url.searchParams.set("hl", "sv");
  const body = objectOf(await call(transport, { method: "GET", url: url.toString(), token }));
  return itemsOf(body).flatMap((item) => typeof item.id === "string" && /^\d{1,4}$/.test(item.id) && snippetOf(item).assignable !== false
    ? [{ id: item.id, name: String(snippetOf(item).title ?? item.id).slice(0, 100) }] : []);
}

// ---------- the film ----------

export type VideoMetadata = { title: string; description: string; tags: string[]; categoryId: string | null; privacy: string; madeForKids: boolean };
/** A video resource's snippet and status as YouTube wants them (snippet.categoryId is required on update; 22 is People & Blogs). Pure. */
export function videoResource(meta: VideoMetadata) {
  return {
    snippet: { title: meta.title.trim(), description: meta.description, tags: meta.tags, categoryId: meta.categoryId ?? "22" },
    status: { privacyStatus: meta.privacy, selfDeclaredMadeForKids: meta.madeForKids, embeddable: true },
  };
}

export type UploadedVideo = { id: string; privacy: string | null; uploadStatus: string | null; channelId: string | null; rejection: string | null };
function videoOf(body: unknown): UploadedVideo | null {
  if (!body || typeof body !== "object") return null;
  const item = body as { id?: unknown; status?: { privacyStatus?: unknown; uploadStatus?: unknown; rejectionReason?: unknown; failureReason?: unknown }; snippet?: { channelId?: unknown } };
  if (typeof item.id !== "string" || !/^[A-Za-z0-9_-]{6,20}$/.test(item.id)) return null;
  const text = (value: unknown) => (typeof value === "string" && value ? value : null);
  return { id: item.id, privacy: text(item.status?.privacyStatus), uploadStatus: text(item.status?.uploadStatus), channelId: text(item.snippet?.channelId), rejection: text(item.status?.rejectionReason) ?? text(item.status?.failureReason) };
}

/**
 * Starts a resumable upload (POST upload/youtube/v3/videos?uploadType=resumable&part=snippet,status with the metadata, 1600 units
 * when the upload completes): YouTube answers with the session's address in Location, where the bytes go.
 */
export async function startResumable(transport: YouTubeTransport, token: string, input: { meta: VideoMetadata; size: number; type: string }): Promise<string> {
  const url = new URL(`${endpoints().upload}/videos`);
  url.searchParams.set("uploadType", "resumable");
  url.searchParams.set("part", "snippet,status");
  const answer = await call(transport, { method: "POST", url: url.toString(), token, json: videoResource(input.meta), headers: {
    "x-upload-content-length": String(input.size), "x-upload-content-type": input.type,
  } }, "upload");
  const location = answer.headers.location;
  if (!location || !uploadSessionUrl(location)) throw new YouTubeError("YouTube gav ingen adress för uppladdningen.", "other", 502);
  return location;
}

export type ChunkAnswer = { done: false; received: number } | { done: true; video: UploadedVideo };

/** "bytes=0-524287" → 524288 (how much YouTube has); none → 0. Pure. */
export function receivedFromRange(header: string | null | undefined): number {
  const match = /^bytes=0-(\d+)$/.exec(String(header ?? "").trim());
  return match ? Number(match[1]) + 1 : 0;
}

function chunkAnswerOf(answer: YouTubeAnswer): ChunkAnswer {
  if (answer.status === 308) return { done: false, received: receivedFromRange(answer.headers.range) };
  if (answer.status === 200 || answer.status === 201) {
    const video = videoOf(answer.body);
    if (!video) throw new YouTubeError("YouTube gav inget id för filmen.", "other", 502);
    return { done: true, video };
  }
  throw youTubeErrorOf(answer.status, answer.body, "upload");
}

/** One piece of the file (PUT to the session with Content-Range bytes start-end/total): 308 and how much YouTube has, or the video. */
export async function uploadChunk(transport: YouTubeTransport, session: string, token: string, input: { bytes: Uint8Array; start: number; total: number; type: string }): Promise<ChunkAnswer> {
  if (!uploadSessionUrl(session)) throw new YouTubeError("Ogiltig adress för uppladdningen.", "other", 400);
  const end = input.start + input.bytes.byteLength - 1;
  const answer = await transport({ method: "PUT", url: session, token, bytes: { data: input.bytes, type: input.type }, headers: { "content-range": `bytes ${input.start}-${end}/${input.total}` } });
  if (answer.status >= 400) throw youTubeErrorOf(answer.status, answer.body, "upload");
  return chunkAnswerOf(answer);
}

/** How far an interrupted upload came (PUT with Content-Range bytes * /total and no body). */
export async function uploadStatus(transport: YouTubeTransport, session: string, token: string, total: number): Promise<ChunkAnswer> {
  if (!uploadSessionUrl(session)) throw new YouTubeError("Ogiltig adress för uppladdningen.", "other", 400);
  const answer = await transport({ method: "PUT", url: session, token, headers: { "content-range": `bytes */${total}`, "content-length": "0" } });
  if (answer.status >= 400) throw youTubeErrorOf(answer.status, answer.body, "upload");
  return chunkAnswerOf(answer);
}

/** The cover picture (POST upload/youtube/v3/thumbnails/set?videoId=…, the picture as the body, 50 units). */
export async function setThumbnail(transport: YouTubeTransport, token: string, videoId: string, image: { bytes: Uint8Array; type: string }): Promise<void> {
  const url = new URL(`${endpoints().upload}/thumbnails/set`);
  url.searchParams.set("videoId", videoId);
  url.searchParams.set("uploadType", "media");
  await call(transport, { method: "POST", url: url.toString(), token, bytes: { data: image.bytes, type: image.type } });
}

/** Adds the film to a playlist (POST playlistItems?part=snippet, 50 units). */
export async function addToPlaylist(transport: YouTubeTransport, token: string, playlistId: string, videoId: string): Promise<void> {
  const url = new URL(`${endpoints().api}/playlistItems`);
  url.searchParams.set("part", "snippet");
  await call(transport, { method: "POST", url: url.toString(), token, json: { snippet: { playlistId, resourceId: { kind: "youtube#video", videoId } } } });
}

/** Changes the title, description, tags, category, privacy and the children's answer (PUT videos?part=snippet,status, 50 units). */
export async function updateVideo(transport: YouTubeTransport, token: string, id: string, meta: VideoMetadata): Promise<UploadedVideo> {
  const url = new URL(`${endpoints().api}/videos`);
  url.searchParams.set("part", "snippet,status");
  const answer = await call(transport, { method: "PUT", url: url.toString(), token, json: { id, ...videoResource(meta) } });
  return videoOf(answer.body) ?? { id, privacy: null, uploadStatus: null, channelId: null, rejection: null };
}

/** Removes the film from YouTube (DELETE videos?id=…, 50 units). One that is already gone counts as removed. */
export async function deleteVideo(transport: YouTubeTransport, token: string, id: string): Promise<void> {
  const url = new URL(`${endpoints().api}/videos`);
  url.searchParams.set("id", id);
  try { await call(transport, { method: "DELETE", url: url.toString(), token }); }
  catch (error) { if (!(error instanceof YouTubeError && error.kind === "notFound")) throw error; }
}

/** How YouTube keeps a film now (GET videos?part=status&id=…, 1 unit), or null when it is gone. */
export async function getVideo(transport: YouTubeTransport, token: string, id: string): Promise<UploadedVideo | null> {
  const url = new URL(`${endpoints().api}/videos`);
  url.searchParams.set("part", "status,snippet");
  url.searchParams.set("id", id);
  const body = objectOf(await call(transport, { method: "GET", url: url.toString(), token }));
  return videoOf(itemsOf(body)[0] ?? null);
}

/**
 * Google's audit (YouTube API Services): a film uploaded through an API project that has not passed it is kept private, whatever
 * was asked for. The upload itself succeeds; YouTube's answer then says privacyStatus "private" for a film asked to be unlisted or
 * public. Pure: true when YouTube kept it private against the ask.
 */
export const keptPrivate = (asked: string, answered: string | null) => asked !== "private" && answered === "private";
