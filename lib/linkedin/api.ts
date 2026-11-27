/**
 * LinkedIn (2026-11-11): every request the server makes to LinkedIn goes through here. Server only – the browser is only
 * sent to LinkedIn's own sign-in page (the authorization address) by Koppla LinkedIn, and never loads anything from it.
 *
 * Fixed hosts over https: www.linkedin.com for OAuth (and the image upload addresses LinkedIn hands out, *.linkedin.com),
 * api.linkedin.com for the API. No redirects are followed, a time limit covers the whole answer and its size is limited
 * (the same protections as lib/meta/graph.ts). The versioned REST API is pinned to one version: bump LINKEDIN_VERSION here
 * (and nowhere else) before LinkedIn sunsets it (a version lives about one year).
 *
 * The request shapes follow LinkedIn's own documentation (read 2026-11-11):
 * - 3-legged OAuth (authorization code):   learn.microsoft.com/linkedin/shared/authentication/authorization-code-flow
 * - Programmatic refresh tokens:            learn.microsoft.com/linkedin/shared/authentication/programmatic-refresh-tokens
 * - Sign In with LinkedIn (OpenID, userinfo): learn.microsoft.com/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2
 * - Posts API:                              learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api
 * - Images API:                             learn.microsoft.com/linkedin/marketing/community-management/shares/images-api
 * - little text format (commentary):        learn.microsoft.com/linkedin/marketing/community-management/shares/little-text-format
 * - Organization access control (ACLs):     learn.microsoft.com/linkedin/marketing/community-management/organizations/organization-access-control-by-role
 * - Organization lookup:                    learn.microsoft.com/linkedin/marketing/community-management/organizations/organization-lookup-api
 *
 * PKCE: LinkedIn offers it only for native apps on a loopback address, switched on by LinkedIn per app
 * (…/shared/authentication/authorization-code-flow-native). A web server like Workflow is a confidential client: the code is
 * exchanged with the app's secret, and a single-use `state` bound to the company and the person stops forged answers.
 *
 * Tokens travel only in the Authorization header (API) or the form body (OAuth) – never in an address, a log or an error text.
 */
export const LINKEDIN_VERSION = "202610";
export const OAUTH_HOST = "www.linkedin.com";
export const API_HOST = "api.linkedin.com";

/** Koppla LinkedIn for the member's own profile: works with the two self-serve products, no review. */
export const PERSONAL_SCOPES = ["openid", "profile", "w_member_social"] as const;
/**
 * For a company page: the Community Management API, which LinkedIn approves per app and which must be the app's only product
 * (2026-11-21, Workflow's own app: Share on LinkedIn and Sign In with LinkedIn cannot be added beside it). Its scopes are therefore
 * the whole set: r_basicprofile instead of openid + profile (who signed in, GET /v2/me), its own w_member_social, and
 * rw_organization_admin, which the Development tier gives instead of r_organization_admin (both read the page roles).
 */
export const ORGANIZATION_SCOPES = ["r_basicprofile", "w_member_social", "w_organization_social", "rw_organization_admin"] as const;
export type ScopeSet = "personal" | "organization";
export const scopesFor = (set: ScopeSet): string[] => (set === "organization" ? [...ORGANIZATION_SCOPES] : [...PERSONAL_SCOPES]);
/** May post as and list company pages: w_organization_social and one of the two scopes that read the page roles. */
export const hasOrganizationScopes = (scopes: readonly string[]) => scopes.includes("w_organization_social") && (scopes.includes("rw_organization_admin") || scopes.includes("r_organization_admin"));

export type LinkedInStatus = "missing" | "unchecked" | "choose" | "ok" | "action" | "invalid";
const SOON_MS = 7 * 24 * 60 * 60_000;

/** The status from what is known about the token: ok, action (soon out, may not post, page scopes missing) or invalid. Pure. */
export function statusFromToken(input: { expiresAt: Date | null; refreshable: boolean; refreshExpiresAt: Date | null; scopeSet: ScopeSet; scopes: readonly string[] }, now = Date.now()): { status: LinkedInStatus; message: string | null } {
  if (input.expiresAt && input.expiresAt.getTime() <= now) return { status: "invalid", message: "Token har gått ut. Tryck Koppla LinkedIn igen." };
  if (!input.scopes.includes("w_member_social") && !input.scopes.includes("w_organization_social")) return { status: "action", message: "Token får inte publicera. Lägg till Share on LinkedIn i appen och tryck Koppla LinkedIn igen." };
  if (input.scopeSet === "organization" && !hasOrganizationScopes(input.scopes)) return { status: "action", message: "LinkedIn gav inte behörighet för företagssidor. Appen behöver Community Management API. Inlägg kan göras på din egen profil." };
  const renews = input.refreshable && (!input.refreshExpiresAt || input.refreshExpiresAt.getTime() - now > SOON_MS);
  if (!renews && input.expiresAt && input.expiresAt.getTime() - now < SOON_MS) return { status: "action", message: "Token går ut inom en vecka. Tryck Koppla LinkedIn igen." };
  return { status: "ok", message: null };
}

/** The roles on a company page that may post as it (Posts API, w_organization_social). */
export const POSTING_ROLES = ["ADMINISTRATOR", "CONTENT_ADMINISTRATOR", "CONTENT_ADMIN", "DIRECT_SPONSORED_CONTENT_POSTER"] as const;

export type LinkedInErrorKind = "token" | "permission" | "rate" | "network" | "other";
export class LinkedInError extends Error {
  constructor(message: string, readonly kind: LinkedInErrorKind, readonly status: number) {
    super(message);
    this.name = "LinkedInError";
  }
}

const TOKEN_HELP = "Tryck Koppla LinkedIn under Kopplingar igen.";

/** LinkedIn's answer as one of ours: a short Swedish text and a kind. Pure. */
export function linkedInErrorOf(status: number, body: unknown): LinkedInError {
  const data = (body && typeof body === "object" ? body : {}) as { error?: unknown; error_description?: unknown; code?: unknown; serviceErrorCode?: unknown };
  const oauth = typeof data.error === "string" ? data.error : null;
  if (oauth === "invalid_grant" || oauth === "invalid_redirect_uri") return new LinkedInError(`LinkedIn godtog inte inloggningen (koden har gått ut eller adressen stämmer inte). ${TOKEN_HELP}`, "other", 400);
  if (oauth === "invalid_client" || oauth === "unauthorized_client") return new LinkedInError("LinkedIn godtar inte Client ID eller Client Secret. Kopiera dem igen från appens Auth-flik.", "other", 400);
  if (oauth) return new LinkedInError("LinkedIn godtog inte anropet.", "other", 400);
  if (status === 401 || data.code === "INVALID_ACCESS_TOKEN" || data.code === "EXPIRED_ACCESS_TOKEN" || data.serviceErrorCode === 65600 || data.serviceErrorCode === 65601)
    return new LinkedInError(`Token gäller inte längre. ${TOKEN_HELP}`, "token", 409);
  if (status === 403) return new LinkedInError("Behörighet saknas hos LinkedIn för det här. Kontrollera appens produkter och att du är administratör för sidan.", "permission", 409);
  if (status === 429) return new LinkedInError("LinkedIn begränsar antalet anrop just nu. Vänta en stund och försök igen.", "rate", 429);
  if (status === 422 || status === 400) return new LinkedInError("LinkedIn godtog inte inlägget. Kontrollera texten och bilden.", "other", 400);
  return new LinkedInError("LinkedIn svarade med ett fel.", "other", status >= 500 ? 502 : 400);
}

export type LinkedInRequest = {
  method: "GET" | "POST" | "PUT";
  url: string;
  token?: string;
  /** The versioned REST headers (LinkedIn-Version, X-Restli-Protocol-Version). */
  rest?: boolean;
  form?: Record<string, string>;
  json?: unknown;
  bytes?: { data: Uint8Array; type: string };
};
export type LinkedInAnswer = { status: number; headers: Record<string, string>; body: unknown };
/** How a request reaches LinkedIn; the tests give their own. */
export type LinkedInTransport = (request: LinkedInRequest) => Promise<LinkedInAnswer>;

/** Whether an address is one of LinkedIn's own: https, no user or port, and www/api or (uploads) another *.linkedin.com. Pure. */
export function linkedInUrl(value: string, kind: "oauth" | "api" | "upload"): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    if (kind === "oauth") return host === OAUTH_HOST ? url : null;
    if (kind === "api") return host === API_HOST ? url : null;
    return host === "linkedin.com" || host.endsWith(".linkedin.com") ? url : null;
  } catch { return null; }
}

const TIMEOUT_MS = 30_000;
const MAX_BYTES = 2 * 1024 * 1024;

/** The real transport: fetch to LinkedIn's hosts only, no redirects, a time limit and a size limit. */
export const fetchTransport: LinkedInTransport = async (request) => {
  const url = linkedInUrl(request.url, "upload");
  if (!url) throw new LinkedInError("Ogiltig adress till LinkedIn.", "other", 400);
  const headers: Record<string, string> = { "user-agent": "Workflow" };
  if (request.token) headers.authorization = `Bearer ${request.token}`;
  if (request.rest) { headers["linkedin-version"] = LINKEDIN_VERSION; headers["x-restli-protocol-version"] = "2.0.0"; }
  let body: BodyInit | undefined;
  if (request.form) { body = new URLSearchParams(request.form); headers["content-type"] = "application/x-www-form-urlencoded"; }
  else if (request.json !== undefined) { body = JSON.stringify(request.json); headers["content-type"] = "application/json"; }
  else if (request.bytes) { body = new Blob([new Uint8Array(request.bytes.data)], { type: request.bytes.type }); headers["content-type"] = request.bytes.type; }
  let response: Response;
  try {
    response = await fetch(url, { method: request.method, body, headers, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    const timeout = (error as Error)?.name === "TimeoutError";
    throw new LinkedInError(timeout ? "LinkedIn svarar inte (tidsgränsen gick ut)." : "Ingen kontakt med LinkedIn.", "network", 504);
  }
  if (response.status >= 300 && response.status < 400) throw new LinkedInError("LinkedIn svarade med en omdirigering, som inte följs.", "other", 502);
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel().catch(() => undefined); throw new LinkedInError("Svaret från LinkedIn är för stort.", "other", 502); }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  const out: Record<string, string> = {};
  response.headers.forEach((value, key) => { out[key.toLowerCase()] = value; });
  return { status: response.status, headers: out, body: parsed };
};

async function call(transport: LinkedInTransport, request: LinkedInRequest): Promise<LinkedInAnswer> {
  const answer = await transport(request);
  if (answer.status >= 400) throw linkedInErrorOf(answer.status, answer.body);
  return answer;
}
const objectOf = (answer: LinkedInAnswer) => {
  if (!answer.body || typeof answer.body !== "object") throw new LinkedInError("LinkedIn svarade inte som väntat.", "other", 502);
  return answer.body as Record<string, unknown>;
};

// ---------- OAuth ----------

export type LinkedInApp = { clientId: string; clientSecret: string };

/** Step 2 of the 3-legged flow: where the browser is sent (GET www.linkedin.com/oauth/v2/authorization). Pure. */
export function authorizationUrl(input: { clientId: string; redirectUri: string; state: string; scopes: readonly string[] }): string {
  const url = new URL(`https://${OAUTH_HOST}/oauth/v2/authorization`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("scope", input.scopes.join(" "));
  // The scope list is space-delimited and URL-encoded: %20, not the form encoding's "+".
  return url.toString().replace(/\+/g, "%20");
}

export type TokenSet = { accessToken: string; expiresAt: Date | null; refreshToken: string | null; refreshExpiresAt: Date | null; scopes: string[] };

const inSeconds = (value: unknown, now: number) => (typeof value === "number" && value > 0 ? new Date(now + value * 1000) : null);

function tokenSetOf(body: Record<string, unknown>, now = Date.now()): TokenSet {
  if (typeof body.access_token !== "string" || !body.access_token) throw new LinkedInError("LinkedIn gav ingen token tillbaka.", "other", 502);
  return {
    accessToken: body.access_token, expiresAt: inSeconds(body.expires_in, now),
    refreshToken: typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : null,
    refreshExpiresAt: inSeconds(body.refresh_token_expires_in, now),
    scopes: typeof body.scope === "string" ? body.scope.split(/[\s,]+/).filter(Boolean) : [],
  };
}

/** Step 3: the code for an access token (POST www.linkedin.com/oauth/v2/accessToken, form encoded, with the secret). */
export async function exchangeCode(transport: LinkedInTransport, app: LinkedInApp, input: { code: string; redirectUri: string }): Promise<TokenSet> {
  const answer = await call(transport, { method: "POST", url: `https://${OAUTH_HOST}/oauth/v2/accessToken`, form: {
    grant_type: "authorization_code", code: input.code, client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: input.redirectUri,
  } });
  return tokenSetOf(objectOf(answer));
}

/** A new access token from a refresh token (only apps LinkedIn has given programmatic refresh). */
export async function refreshAccessToken(transport: LinkedInTransport, app: LinkedInApp, refreshToken: string): Promise<TokenSet> {
  const answer = await call(transport, { method: "POST", url: `https://${OAUTH_HOST}/oauth/v2/accessToken`, form: {
    grant_type: "refresh_token", refresh_token: refreshToken, client_id: app.clientId, client_secret: app.clientSecret,
  } });
  return tokenSetOf(objectOf(answer));
}

// ---------- who and where ----------

/**
 * The member behind the token. With openid + profile: GET api.linkedin.com/v2/userinfo (`sub` is the person id). Without openid
 * (a Community Management app, r_basicprofile): GET /v2/me, whose `id` is the same person id, with the localized names.
 */
export async function userInfo(transport: LinkedInTransport, token: string, scopes: readonly string[] = ["openid"]): Promise<{ id: string; name: string }> {
  if (!scopes.includes("openid")) {
    const me = objectOf(await call(transport, { method: "GET", url: `https://${API_HOST}/v2/me`, token }));
    if (typeof me.id !== "string" || !me.id) throw new LinkedInError("LinkedIn sa inte vem som är inloggad. Appen behöver r_basicprofile.", "other", 502);
    const name = [me.localizedFirstName, me.localizedLastName].filter((part) => typeof part === "string" && part).join(" ");
    return { id: me.id, name: name || me.id };
  }
  const body = objectOf(await call(transport, { method: "GET", url: `https://${API_HOST}/v2/userinfo`, token }));
  if (typeof body.sub !== "string" || !body.sub) throw new LinkedInError("LinkedIn sa inte vem som är inloggad. Kryssa i openid och profile.", "other", 502);
  const name = typeof body.name === "string" && body.name ? body.name : [body.given_name, body.family_name].filter((part) => typeof part === "string" && part).join(" ");
  return { id: body.sub, name: name || body.sub };
}

export const ORGANIZATION_URN = /^urn:li:organization:(\d{1,20})$/;
export const PERSON_ID = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * The company pages the member may post as: the approved roles (GET /rest/organizationAcls?q=roleAssignee&state=APPROVED,
 * r_organization_admin), each page once. LinkedIn's samples name the page `organization` or `organizationTarget`.
 */
export async function postingOrganizations(transport: LinkedInTransport, token: string): Promise<string[]> {
  const url = new URL(`https://${API_HOST}/rest/organizationAcls`);
  url.searchParams.set("q", "roleAssignee");
  url.searchParams.set("state", "APPROVED");
  url.searchParams.set("count", "100");
  const body = objectOf(await call(transport, { method: "GET", url: url.toString(), token, rest: true }));
  const ids = new Set<string>();
  for (const element of Array.isArray(body.elements) ? body.elements : []) {
    const entry = element as { role?: unknown; state?: unknown; organization?: unknown; organizationTarget?: unknown };
    if (entry.state !== undefined && entry.state !== "APPROVED") continue;
    if (typeof entry.role !== "string" || !(POSTING_ROLES as readonly string[]).includes(entry.role)) continue;
    const urn = typeof entry.organization === "string" ? entry.organization : typeof entry.organizationTarget === "string" ? entry.organizationTarget : "";
    const match = ORGANIZATION_URN.exec(urn);
    if (match) ids.add(match[1]);
  }
  return [...ids];
}

/** A company page's name (GET /rest/organizations/{id}, localizedName); the id when it cannot be read. */
export async function organizationName(transport: LinkedInTransport, token: string, id: string): Promise<string> {
  if (!/^\d{1,20}$/.test(id)) return id;
  try {
    const body = objectOf(await call(transport, { method: "GET", url: `https://${API_HOST}/rest/organizations/${id}`, token, rest: true }));
    return typeof body.localizedName === "string" && body.localizedName ? body.localizedName : id;
  } catch (error) {
    if (error instanceof LinkedInError && error.kind === "token") throw error;
    return id;
  }
}

// ---------- posting ----------

export const personUrn = (id: string) => `urn:li:person:${id}`;
export const organizationUrn = (id: string) => `urn:li:organization:${id}`;

/**
 * The image's way in (Images API): initializeUpload declares it for the owner (POST /rest/images?action=initializeUpload,
 * { initializeUploadRequest: { owner } }), the bytes are PUT to the address LinkedIn gave (only one of its own hosts), and
 * the image URN goes into the post. An uploaded image that no post uses is shown nowhere.
 */
export async function uploadImage(transport: LinkedInTransport, token: string, owner: string, bytes: Uint8Array, type = "image/jpeg"): Promise<string> {
  const body = objectOf(await call(transport, { method: "POST", url: `https://${API_HOST}/rest/images?action=initializeUpload`, token, rest: true, json: { initializeUploadRequest: { owner } } }));
  const value = (body.value ?? {}) as { uploadUrl?: unknown; image?: unknown };
  if (typeof value.uploadUrl !== "string" || typeof value.image !== "string" || !value.image.startsWith("urn:li:image:")) throw new LinkedInError("LinkedIn gav ingen adress för bilden.", "other", 502);
  if (!linkedInUrl(value.uploadUrl, "upload")) throw new LinkedInError("LinkedIn gav en adress för bilden som inte är LinkedIns egen.", "other", 502);
  await call(transport, { method: "PUT", url: value.uploadUrl, token, bytes: { data: bytes, type } });
  return value.image;
}

/** Text as little text (the commentary's format): every reserved character escaped, hashtags as LinkedIn's hashtag template. Pure. */
export function littleText(text: string): string {
  const escape = (part: string) => part.replace(/[\\|{}@[\]()<>#*_~]/g, (char) => `\\${char}`);
  let out = "";
  let last = 0;
  for (const match of text.matchAll(/(^|\s)#([\p{L}\p{N}_]+)/gu)) {
    const start = (match.index ?? 0) + match[1].length;
    out += escape(text.slice(last, start)) + `{hashtag|\\#|${escape(match[2])}}`;
    last = start + 1 + match[2].length;
  }
  return out + escape(text.slice(last));
}

/**
 * A post (POST /rest/posts): the author (a person or a company page), the text in little format, and the image. LinkedIn
 * answers 201 and the post's URN in the x-restli-id header.
 */
export async function createPost(transport: LinkedInTransport, token: string, input: { author: string; commentary: string; image?: { id: string; altText?: string } | null }): Promise<string> {
  const json: Record<string, unknown> = {
    author: input.author, commentary: littleText(input.commentary), visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED", isReshareDisabledByAuthor: false,
  };
  if (input.image) json.content = { media: { id: input.image.id, ...(input.image.altText ? { altText: input.image.altText.slice(0, 4086) } : {}) } };
  const answer = await call(transport, { method: "POST", url: `https://${API_HOST}/rest/posts`, token, rest: true, json });
  const id = answer.headers["x-restli-id"] ?? (answer.body && typeof answer.body === "object" ? (answer.body as { id?: unknown }).id : null);
  if (typeof id !== "string" || !id.startsWith("urn:li:")) throw new LinkedInError("LinkedIn gav inget id för inlägget.", "other", 502);
  return id;
}
