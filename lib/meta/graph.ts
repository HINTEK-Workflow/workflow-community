/**
 * Facebook och Instagram (2026-11-10): every request the server makes to Meta goes through here. One fixed host,
 * graph.facebook.com over https, and one pinned Graph API version – bump GRAPH_VERSION here (and nowhere else) when Meta
 * retires it (each version lives about two years).
 *
 * - No redirects are followed, a time limit covers the whole answer and the answer's size is limited while it is read (the
 *   same protections as lib/website/net.ts, where the host is the company's own text).
 * - The tests and the local stand-in (scripts/meta/demo-meta.ts) may point the base at a loopback address with
 *   META_GRAPH_BASE_URL (http://127.0.0.1:<port> or http://localhost:<port> only); any other value is ignored, so an
 *   installation can never send the tokens anywhere but Meta.
 * - Meta's errors become MetaError with a kind (token, permission, rate, other) and a short Swedish text; a token that no
 *   longer works (code 190 and its subcodes) marks the connection invalid where it is used (lib/meta/server.ts).
 *
 * Tokens travel as the access_token parameter in the body (POST) or the address (GET) – never in a log or an error text here.
 */
export const GRAPH_VERSION = "v24.0";
export const GRAPH_HOST = "graph.facebook.com";

/** The permissions Workflow asks for (Facebook Login for Business with a User access token). */
export const REQUIRED_SCOPES = [
  "pages_show_list", "pages_read_engagement", "pages_manage_posts", "instagram_basic", "instagram_content_publish", "business_management",
] as const;
/** The permissions Instagram needs; without them Facebook can still be used. */
export const INSTAGRAM_SCOPES = ["instagram_basic", "instagram_content_publish"] as const;

export type MetaErrorKind = "token" | "permission" | "rate" | "network" | "other";

export class MetaError extends Error {
  constructor(message: string, readonly kind: MetaErrorKind, readonly status: number, readonly code: number | null = null, readonly subcode: number | null = null) {
    super(message);
    this.name = "MetaError";
  }
}

const TOKEN_HELP = "Hämta en ny token i Graph API Explorer och klistra in den under Kopplingar.";

/** Meta's error object as one of ours. Pure. */
export function metaErrorOf(status: number, error: { code?: unknown; error_subcode?: unknown; type?: unknown; message?: unknown } | null | undefined): MetaError {
  const code = typeof error?.code === "number" ? error.code : null;
  const subcode = typeof error?.error_subcode === "number" ? error.error_subcode : null;
  if (code === 190 || code === 102 || code === 2500 || (error?.type === "OAuthException" && status === 401)) {
    const why = subcode === 463 ? "Token har gått ut."
      : subcode === 460 ? "Token gäller inte längre (lösenordet på Facebook har bytts)."
        : subcode === 467 ? "Token gäller inte längre (utloggad eller ogiltig)."
          : subcode === 458 ? "Appen har tagits bort från kontot."
            : "Token gäller inte längre.";
    return new MetaError(`${why} ${TOKEN_HELP}`, "token", 409, code, subcode);
  }
  if (code === 10 || (code !== null && code >= 200 && code <= 299)) return new MetaError("Behörighet saknas hos Meta för det här. Kontrollera att token har alla sex behörigheter och att du är administratör för sidan.", "permission", 409, code, subcode);
  if (code === 4 || code === 17 || code === 32 || code === 613 || code === 80001 || code === 80002 || code === 9) return new MetaError("Meta begränsar antalet anrop just nu. Vänta en stund och försök igen.", "rate", 429, code, subcode);
  if (code === 368) return new MetaError("Meta har tillfälligt spärrat publicering från kontot.", "permission", 409, code, subcode);
  if (code === 100 || code === 9004 || code === 2207026 || code === 36003) return new MetaError("Meta godtog inte anropet. Kontrollera sidan, kontot och bilden.", "other", 400, code, subcode);
  return new MetaError("Meta svarade med ett fel.", "other", status >= 500 ? 502 : 400, code, subcode);
}

/** The base of every request: Meta, or a loopback stand-in in the tests and on a dev server. */
type Source = Record<string, string | undefined>;
export function graphBase(source: Source = process.env): string {
  const own = source.META_GRAPH_BASE_URL?.trim();
  if (own) {
    try {
      const url = new URL(own);
      if (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && !url.username && !url.password)
        return `${url.origin}`;
    } catch { /* ignored: Meta itself */ }
  }
  return `https://${GRAPH_HOST}`;
}
/** Whether the requests go to a stand-in on this computer (then it can fetch the pictures from localhost too). */
export const graphIsLocal = (source: Source = process.env) => graphBase(source) !== `https://${GRAPH_HOST}`;

export type GraphParams = Record<string, string | number | boolean | undefined | null>;
export type GraphRequest = { method: "GET" | "POST" | "DELETE"; path: string; params?: GraphParams; file?: { bytes: Uint8Array; name: string; type: string; field: string } };
/** How a request reaches Meta; the tests give their own. */
export type GraphTransport = (request: GraphRequest) => Promise<{ status: number; body: unknown }>;

const TIMEOUT_MS = 30_000;
const MAX_BYTES = 2 * 1024 * 1024;

const clean = (params: GraphParams = {}) => Object.entries(params).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => [key, String(value)] as [string, string]);

/** The real transport: fetch to the fixed host, no redirects, a time limit and a size limit. */
export const fetchTransport: GraphTransport = async (request) => {
  const base = graphBase();
  const path = request.path.replace(/^\/+/, "");
  if (!/^[A-Za-z0-9_./-]+$/.test(path) || path.includes("..")) throw new MetaError("Ogiltig adress till Meta.", "other", 400);
  const url = new URL(`${base}/${GRAPH_VERSION}/${path}`);
  if (url.origin !== base) throw new MetaError("Ogiltig adress till Meta.", "other", 400);
  const params = clean(request.params);
  let body: BodyInit | undefined;
  if (request.method === "GET" || request.method === "DELETE") for (const [key, value] of params) url.searchParams.set(key, value);
  else if (request.file) {
    const form = new FormData();
    for (const [key, value] of params) form.append(key, value);
    form.append(request.file.field, new Blob([new Uint8Array(request.file.bytes)], { type: request.file.type }), request.file.name);
    body = form;
  } else body = new URLSearchParams(params);
  let response: Response;
  try {
    response = await fetch(url, { method: request.method, body, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": "Workflow" } });
  } catch (error) {
    const timeout = (error as Error)?.name === "TimeoutError";
    throw new MetaError(timeout ? "Meta svarar inte (tidsgränsen gick ut)." : "Ingen kontakt med Meta.", "network", 504);
  }
  if (response.status >= 300 && response.status < 400) throw new MetaError("Meta svarade med en omdirigering, som inte följs.", "other", 502);
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel().catch(() => undefined); throw new MetaError("Svaret från Meta är för stort.", "other", 502); }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  return { status: response.status, body: parsed };
};

/** One call; Meta's error object becomes a MetaError, anything else is the answer. */
export async function graph<T = Record<string, unknown>>(transport: GraphTransport, request: GraphRequest): Promise<T> {
  const answer = await transport(request);
  const body = answer.body as { error?: Parameters<typeof metaErrorOf>[1] } | null;
  if (answer.status >= 400 || body?.error) throw metaErrorOf(answer.status, body?.error ?? null);
  if (!body || typeof body !== "object") throw new MetaError("Meta svarade inte som väntat.", "other", 502);
  return body as T;
}

// ---------- the calls ----------

export type TokenInfo = {
  valid: boolean; appId: string | null; userId: string | null; type: string | null;
  /** null: never expires (a page token from a long-lived user token). */
  expiresAt: Date | null; dataAccessExpiresAt: Date | null; scopes: string[];
};

const epoch = (value: unknown) => (typeof value === "number" && value > 0 ? new Date(value * 1000) : null);

/** Short-lived user token → long-lived (about 60 days). */
export async function exchangeUserToken(transport: GraphTransport, app: { appId: string; appSecret: string }, shortToken: string) {
  const answer = await graph<{ access_token?: string; expires_in?: number }>(transport, { method: "GET", path: "oauth/access_token", params: {
    grant_type: "fb_exchange_token", client_id: app.appId, client_secret: app.appSecret, fb_exchange_token: shortToken,
  } });
  if (!answer.access_token) throw new MetaError("Meta gav ingen token tillbaka.", "other", 502);
  return { token: answer.access_token, expiresAt: typeof answer.expires_in === "number" && answer.expires_in > 0 ? new Date(Date.now() + answer.expires_in * 1000) : null };
}

/** What Meta says about a token, asked with the app's own token (app id|app secret). */
export async function debugToken(transport: GraphTransport, app: { appId: string; appSecret: string }, token: string): Promise<TokenInfo> {
  const answer = await graph<{ data?: Record<string, unknown> }>(transport, { method: "GET", path: "debug_token", params: { input_token: token, access_token: `${app.appId}|${app.appSecret}` } });
  const data = answer.data ?? {};
  return {
    valid: data.is_valid === true,
    appId: typeof data.app_id === "string" ? data.app_id : null,
    userId: typeof data.user_id === "string" ? data.user_id : null,
    type: typeof data.type === "string" ? data.type : null,
    expiresAt: epoch(data.expires_at),
    dataAccessExpiresAt: epoch(data.data_access_expires_at),
    scopes: Array.isArray(data.scopes) ? data.scopes.filter((scope): scope is string => typeof scope === "string") : [],
  };
}

export const missingScopes = (scopes: readonly string[]) => REQUIRED_SCOPES.filter((scope) => !scopes.includes(scope));

export type MetaPage = { id: string; name: string; token: string; instagram: { id: string; username: string | null } | null };

/** The pages the user token reaches, each with its page token and Instagram account. */
export async function listPages(transport: GraphTransport, userToken: string): Promise<MetaPage[]> {
  const answer = await graph<{ data?: Record<string, unknown>[] }>(transport, { method: "GET", path: "me/accounts", params: {
    fields: "id,name,access_token,instagram_business_account{id,username}", limit: 100, access_token: userToken,
  } });
  return (answer.data ?? []).flatMap((row) => {
    if (typeof row.id !== "string" || typeof row.access_token !== "string") return [];
    const ig = row.instagram_business_account as { id?: unknown; username?: unknown } | undefined;
    return [{
      id: row.id, name: typeof row.name === "string" ? row.name : row.id, token: row.access_token,
      instagram: ig && typeof ig.id === "string" ? { id: ig.id, username: typeof ig.username === "string" ? ig.username : null } : null,
    }];
  });
}

/** A picture on the page: published (live) or not (a test, which nobody sees), from the picture's bytes. */
export async function facebookPhoto(transport: GraphTransport, page: { id: string; token: string }, input: { bytes: Uint8Array; caption: string; published: boolean }) {
  const answer = await graph<{ id?: string; post_id?: string }>(transport, { method: "POST", path: `${page.id}/photos`, params: {
    caption: input.caption, published: input.published, access_token: page.token,
  }, file: { bytes: input.bytes, name: "inlagg.jpg", type: "image/jpeg", field: "source" } });
  if (!answer.id) throw new MetaError("Facebook gav inget id tillbaka.", "other", 502);
  return { photoId: answer.id, postId: answer.post_id ?? null };
}

/**
 * Även som story (2026-11-13): an unpublished picture on the page (facebookPhoto with published: false, its own upload – Meta
 * refuses a picture already used in a post) becomes the page's story. Returns the story's post id.
 */
export async function facebookPhotoStory(transport: GraphTransport, page: { id: string; token: string }, photoId: string) {
  const answer = await graph<{ success?: boolean; post_id?: string }>(transport, { method: "POST", path: `${page.id}/photo_stories`, params: { photo_id: photoId, access_token: page.token } });
  if (!answer.post_id && answer.success !== true) throw new MetaError("Facebook gav inget id tillbaka.", "other", 502);
  return answer.post_id ?? photoId;
}

export async function deleteObject(transport: GraphTransport, id: string, token: string) {
  await graph(transport, { method: "DELETE", path: id, params: { access_token: token } });
}

export const isGraphId = (value: string) => /^\d{1,30}$/.test(value);
