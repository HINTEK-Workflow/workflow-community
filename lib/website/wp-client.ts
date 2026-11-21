import { siteRequest, urlProblem, installationPolicy, WpError, type NetPolicy, type SiteAnswer } from "./net";
import { seoFromMeta, type PageSeo } from "./seo";

/**
 * A company's WordPress (Min webbsida, 2026-11-10; first for one site 2026-11-09): the few REST calls Workflow makes – the
 * list of pages, one page's block markup, writing a page, uploading a picture, checking the sign-in and finding the REST
 * address from the site's own address. Nothing is installed on the WordPress server: a WordPress application password
 * (Basic authentication) is all.
 *
 * Every request goes through lib/website/net.ts (https on 443, public addresses only, the checked address pinned, no
 * redirects, a time and size limit) and to the configured site's host only. The password is only ever put in the
 * Authorization header; no error, log or answer carries it, nor WordPress's own error text (only its short code).
 */
export { WpError };
export type WpConfig = { baseUrl: string; username: string; password: string };

const MAX_ANSWER_BYTES = 8 * 1024 * 1024;
export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
export const MEDIA_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

/** Why the address cannot be used, or null. */
export function baseUrlProblem(value: string, policy: NetPolicy = installationPolicy()): string | null {
  let url: URL;
  try { url = new URL(value); } catch { return "Adressen är inte en giltig webbadress."; }
  if (url.hash) return "Adressen får inte ha ett #-tecken.";
  return urlProblem(url, policy);
}

/**
 * The address of a REST route under the base: the path form (…/wp-json/ + wp/v2/pages) or the query form
 * (…/?rest_route=/ + wp/v2/pages), with the query's own parameters added.
 */
export function restUrl(base: string, route: string, query: Record<string, string> = {}) {
  const url = new URL(base);
  const clean = route.replace(/^\/+/, "");
  if (url.searchParams.has("rest_route")) {
    const prefix = (url.searchParams.get("rest_route") || "/").replace(/\/?$/, "/");
    url.searchParams.set("rest_route", prefix + clean);
  } else {
    url.pathname = url.pathname.replace(/\/?$/, "/") + clean;
  }
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url;
}

const STATUS_TEXT: Record<number, string> = {
  400: "WordPress tog inte emot ändringen.",
  401: "WordPress godtar inte användarnamnet eller applikationslösenordet.",
  403: "Användaren saknar behörighet för det här i WordPress.",
  404: "Sidan eller adressen finns inte i WordPress.",
  413: "Filen är för stor för WordPress.",
  429: "WordPress tar inte emot fler anrop just nu. Försök igen om en stund.",
};

const typeOf = (answer: SiteAnswer) => (answer.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();

async function call<T>(config: WpConfig, route: string, init: { method?: string; query?: Record<string, string>; json?: unknown; body?: Uint8Array; headers?: Record<string, string> } = {}): Promise<T> {
  const problem = baseUrlProblem(config.baseUrl);
  if (problem) throw new WpError(problem, 400);
  if (!config.username || !config.password) throw new WpError("Kopplingen till WordPress saknar användarnamn eller applikationslösenord.", 400);
  const url = restUrl(config.baseUrl, route, init.query);
  if (url.host !== new URL(config.baseUrl).host) throw new WpError("Adressen pekar på en annan server.", 400);
  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: `Basic ${Buffer.from(`${config.username}:${config.password.replace(/\s+/g, "")}`, "utf8").toString("base64")}`,
    ...init.headers,
  };
  let body: string | Uint8Array | undefined;
  if (init.json !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(init.json); }
  else if (init.body) body = init.body;
  const answer = await siteRequest(url, { method: init.method ?? "GET", headers, body, maxBytes: MAX_ANSWER_BYTES });
  if (answer.status >= 300 && answer.status < 400) throw new WpError("WordPress skickar vidare till en annan adress. Kontrollera webbplatsens adress.", 502);
  const text = answer.body.toString("utf8");
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { if (answer.status >= 200 && answer.status < 300) throw new WpError("WordPress svarade inte med JSON. Kontrollera webbplatsens adress.", 502); }
  if (answer.status < 200 || answer.status >= 300) {
    const code = data && typeof data === "object" && typeof (data as { code?: unknown }).code === "string" ? String((data as { code: string }).code).slice(0, 80) : null;
    throw new WpError(STATUS_TEXT[answer.status] ?? (answer.status >= 500 ? "WordPress svarade med ett fel." : "WordPress nekade anropet."), answer.status >= 500 ? 502 : answer.status === 401 || answer.status === 403 ? 502 : answer.status, code);
  }
  return data as T;
}

// ---------- finding the REST address ----------

/** The site's own address, cleaned: scheme, host and path, no query or #, ending in /. */
export function normalSiteUrl(value: string): string | null {
  let url: URL;
  try { url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`); } catch { return null; }
  if (url.username || url.password) return null;
  url.hash = ""; url.search = "";
  url.pathname = url.pathname.replace(/\/(index\.php\/?)?(wp-json\/?)?$/i, "/").replace(/\/?$/, "/");
  return url.toString();
}

/** The REST address WordPress names for itself: a Link header or a <link> in the page, rel="https://api.w.org/". */
export function announcedRestBase(answer: Pick<SiteAnswer, "headers" | "body">, pageUrl: string): string | null {
  const header = answer.headers.link ?? "";
  const fromHeader = /<([^>]+)>\s*;\s*rel="?https:\/\/api\.w\.org\/"?/i.exec(header)?.[1];
  const html = answer.body.toString("utf8", 0, Math.min(answer.body.byteLength, 400_000));
  const tag = [...html.matchAll(/<link\b[^>]*>/gi)].map(([found]) => found).find((found) => /rel=["']https:\/\/api\.w\.org\/["']/i.test(found));
  const fromHtml = tag ? /href=["']([^"']+)["']/i.exec(tag)?.[1]?.replace(/&amp;/g, "&") : undefined;
  const found = fromHeader ?? fromHtml;
  if (!found) return null;
  try {
    const url = new URL(found, pageUrl);
    return url.host === new URL(pageUrl).host ? url.toString() : null;
  } catch { return null; }
}

/** Whether the address answers as WordPress's REST index (a list of namespaces with wp/v2). */
async function isRestIndex(address: string): Promise<boolean> {
  try {
    const answer = await siteRequest(address, { headers: { accept: "application/json" }, maxBytes: 4 * 1024 * 1024, timeoutMs: 15_000 });
    if (answer.status !== 200) return false;
    const data = JSON.parse(answer.body.toString("utf8")) as { namespaces?: unknown };
    return Array.isArray(data?.namespaces) && data.namespaces.includes("wp/v2");
  } catch (error) {
    if (error instanceof WpError && error.code === "blocked") throw error;
    return false;
  }
}

/**
 * The REST address from the site's normal address: what the site announces (its Link header or <link>), else /wp-json/,
 * /index.php/wp-json/ and ?rest_route=/ in that order – the first that answers as WordPress. The site's own redirect is never
 * followed: the person is asked to write the address it points to.
 */
export async function discoverRestBase(siteUrl: string): Promise<string> {
  const root = normalSiteUrl(siteUrl);
  if (!root) throw new WpError("Adressen är inte en giltig webbadress.", 400);
  const problem = baseUrlProblem(root);
  if (problem) throw new WpError(problem, 400);
  const front = await siteRequest(root, { headers: { accept: "text/html" }, maxBytes: 3 * 1024 * 1024, timeoutMs: 15_000 });
  if (front.status >= 300 && front.status < 400) {
    let target = "";
    try { target = new URL(front.headers.location ?? "", root).origin; } catch { /* unreadable */ }
    throw new WpError(target ? `Webbplatsen skickar vidare till ${target}. Skriv den adressen i stället.` : "Webbplatsen skickar vidare till en annan adress. Skriv den adressen i stället.", 400);
  }
  const announced = announcedRestBase(front, root);
  const candidates = [...(announced ? [announced] : []), `${root}wp-json/`, `${root}index.php/wp-json/`, `${root}?rest_route=/`];
  for (const candidate of [...new Set(candidates)]) if (await isRestIndex(candidate)) return candidate;
  throw new WpError("Ingen WordPress hittades på adressen. Kontrollera adressen, eller skriv REST-adressen under Avancerat.", 404);
}

// ---------- pages ----------

export type WpPageSummary = { id: number; title: string; status: string; modified: string; link: string };
/** `seo`: the page's Sökmotorer och delning values when the site has them (the Workflow SEO plugin, lib/website/seo.ts), else null. */
export type WpPage = WpPageSummary & { content: string; seo: PageSeo | null };

type RawPage = { id?: unknown; title?: { raw?: unknown; rendered?: unknown }; content?: { raw?: unknown; rendered?: unknown }; status?: unknown; modified?: unknown; modified_gmt?: unknown; link?: unknown; meta?: unknown };
const asText = (value: unknown) => typeof value === "string" ? value : "";
const summary = (page: RawPage): WpPageSummary => ({
  id: Number(page.id), title: asText(page.title?.raw) || asText(page.title?.rendered) || `Sida ${page.id}`,
  status: asText(page.status), modified: asText(page.modified_gmt) || asText(page.modified), link: asText(page.link),
});

/** Every page (up to 300), with its title as written. */
export async function listPages(config: WpConfig): Promise<WpPageSummary[]> {
  const pages: WpPageSummary[] = [];
  for (let page = 1; page <= 3; page++) {
    const batch = await call<RawPage[]>(config, "wp/v2/pages", { query: { context: "edit", per_page: "100", page: String(page), status: "publish,draft,private,pending,future", orderby: "id", order: "asc", _fields: "id,title,status,modified,modified_gmt,link" } });
    if (!Array.isArray(batch)) throw new WpError("WordPress svarade inte med en lista över sidor.", 502);
    pages.push(...batch.filter((item) => Number.isInteger(Number(item.id))).map(summary));
    if (batch.length < 100) break;
  }
  return pages;
}

/** The site's front page (WordPress's own setting, page_on_front), when the user may read the settings; null otherwise. */
export async function frontPageId(config: WpConfig): Promise<number | null> {
  try {
    const settings = await call<{ show_on_front?: unknown; page_on_front?: unknown }>(config, "wp/v2/settings", { query: { _fields: "show_on_front,page_on_front" } });
    const id = Number(settings?.page_on_front);
    return settings?.show_on_front === "page" && Number.isInteger(id) && id > 0 ? id : null;
  } catch { return null; }
}

/** One page with its block markup (content.raw) and, when the site has them, its SEO values (`meta`; plain WordPress gives []). */
export async function getPage(config: WpConfig, id: number): Promise<WpPage> {
  const page = await call<RawPage>(config, `wp/v2/pages/${id}`, { query: { context: "edit", _fields: "id,title,content,status,modified,modified_gmt,link,meta" } });
  if (!page || typeof page.content?.raw !== "string") throw new WpError("WordPress gav inte sidans block. Användaren behöver kunna redigera sidor.", 502);
  return { ...summary(page), content: page.content.raw, seo: seoFromMeta(page.meta) };
}

/**
 * The page as WordPress has it and as WordPress draws its content (content.raw and content.rendered of one answer; Min webbsida's
 * previews of shortcodes and dynamic blocks, lib/website/rendered.ts), with its address and status. Reads only.
 */
export async function getPageDrawing(config: WpConfig, id: number): Promise<WpPageSummary & { raw: string; rendered: string }> {
  const page = await call<RawPage>(config, `wp/v2/pages/${id}`, { query: { context: "edit", _fields: "id,title,content,status,modified,modified_gmt,link" } });
  return { ...summary(page), raw: asText(page?.content?.raw), rendered: asText(page?.content?.rendered) };
}

/** One page without its markup: whether it was changed in WordPress (its `modified`). */
export async function getPageSummary(config: WpConfig, id: number): Promise<WpPageSummary> {
  return summary(await call<RawPage>(config, `wp/v2/pages/${id}`, { query: { context: "edit", _fields: "id,title,status,modified,modified_gmt,link" } }));
}

/**
 * A dynamic block as WordPress draws it (latest posts, search, log in/out, a plugin's server-rendered block): the block
 * renderer, /wp/v2/block-renderer/<name> (WordPress 5.0+), with the page as its context. It only reads; POST carries the
 * attributes in the body (WordPress 5.5+). Null when WordPress does not know the block as a dynamic one.
 */
export async function renderBlock(config: WpConfig, name: string, attributes: Record<string, unknown>, postId: number): Promise<string | null> {
  if (!/^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/.test(name)) throw new WpError("Blockets namn är ogiltigt.", 400);
  try {
    const answer = await call<{ rendered?: unknown }>(config, `wp/v2/block-renderer/${name}`, { method: "POST", query: { context: "edit" }, json: { attributes, post_id: postId } });
    return typeof answer?.rendered === "string" ? answer.rendered : null;
  } catch (error) {
    if (error instanceof WpError && (error.status === 404 || error.code === "block_invalid" || error.code === "rest_no_route")) return null;
    throw error;
  }
}

/** A public address on the configured site only (same scheme and host, no sign-in). */
function onSite(config: Pick<WpConfig, "baseUrl">, address: string, what: string): URL {
  let url: URL;
  try { url = new URL(address); } catch { throw new WpError(`${what} adress är ogiltig.`, 400); }
  const base = new URL(config.baseUrl);
  if (url.host !== base.host || url.protocol !== base.protocol || url.username || url.password) throw new WpError("Bara adresser på webbplatsen läses.", 400);
  return url;
}

/** A public page on the site, as a visitor gets it (for its stylesheets): the configured host only, no sign-in, no redirects. */
export async function fetchSitePage(config: Pick<WpConfig, "baseUrl">, address: string): Promise<string> {
  const url = onSite(config, address, "Sidans");
  const answer = await siteRequest(url, { headers: { accept: "text/html" }, maxBytes: 3 * 1024 * 1024 }).catch(() => { throw new WpError("Sidan kunde inte hämtas.", 504); });
  if (answer.status !== 200 || typeOf(answer) !== "text/html") throw new WpError("Sidan kunde inte hämtas.", 502);
  return answer.body.toString("utf8");
}

/** Writes the page's markup; WordPress's new `modified`. */
export async function updatePage(config: WpConfig, id: number, content: string): Promise<WpPageSummary> {
  const page = await call<RawPage>(config, `wp/v2/pages/${id}`, { method: "POST", query: { context: "edit", _fields: "id,title,status,modified,modified_gmt,link" }, json: { content } });
  return summary(page);
}

/**
 * Writes the page's markup and/or its SEO meta in one update of wp/v2/pages/<id> (WordPress keeps its revision as for any
 * edit). `meta` is only ever given for a site that has the keys (lib/website/seo.ts); without it the call is updatePage's.
 */
export async function writePage(config: WpConfig, id: number, input: { content?: string; meta?: Record<string, string | number | boolean> | null }): Promise<WpPageSummary & { seo: PageSeo | null }> {
  const json: Record<string, unknown> = {};
  if (input.content !== undefined) json.content = input.content;
  if (input.meta) json.meta = input.meta;
  if (!Object.keys(json).length) throw new WpError("Inget att skriva.", 400);
  const page = await call<RawPage>(config, `wp/v2/pages/${id}`, { method: "POST", query: { context: "edit", _fields: `id,title,status,modified,modified_gmt,link${input.meta ? ",meta" : ""}` }, json }).catch((error) => {
    // Workflow SEO refuses a too long text with 400 (rest_too_long, or rest_invalid_param from WordPress's own schema check); it never cuts.
    if (input.meta && error instanceof WpError && error.status === 400 && (error.code === "rest_too_long" || error.code === "rest_invalid_param"))
      throw new WpError("Webbplatsen tog inte emot sökmotoruppgifterna: en text är för lång eller ett värde ogiltigt (sidtitel högst 70 tecken, beskrivning högst 200). Inget ändrades.", 400, error.code);
    throw error;
  });
  return { ...summary(page), seo: input.meta ? seoFromMeta(page.meta) : null };
}

/** Uploads a picture to the media library; its id and address. */
export async function uploadMedia(config: WpConfig, file: { bytes: Uint8Array; name: string; type: string }): Promise<{ id: number; url: string }> {
  const extension = MEDIA_TYPES[file.type];
  if (!extension) throw new WpError("Bara PNG, JPEG, WebP och GIF kan laddas upp.", 400);
  if (file.bytes.byteLength > MAX_MEDIA_BYTES) throw new WpError("Bilden är för stor (högst 10 MB).", 413);
  const base = file.name.replace(/\.[^.]*$/, "").normalize("NFKD").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "bild";
  const media = await call<{ id?: unknown; source_url?: unknown }>(config, "wp/v2/media", {
    method: "POST", body: file.bytes, query: { _fields: "id,source_url" },
    headers: { "content-type": file.type, "content-disposition": `attachment; filename="${base}.${extension}"` },
  });
  const id = Number(media?.id);
  const url = asText(media?.source_url);
  if (!Number.isInteger(id) || id <= 0 || !/^https?:\/\//.test(url)) throw new WpError("WordPress gav inte bildens adress.", 502);
  return { id, url };
}

/** Signs in and reads the user: whether the application password works and may edit pages. */
export async function checkConnection(config: WpConfig): Promise<{ name: string; canEditPages: boolean }> {
  const me = await call<{ name?: unknown; capabilities?: Record<string, unknown> }>(config, "wp/v2/users/me", { query: { context: "edit", _fields: "name,capabilities" } });
  const capabilities = me?.capabilities ?? {};
  return { name: asText(me?.name).slice(0, 100), canEditPages: Boolean(capabilities.edit_pages && capabilities.edit_published_pages && capabilities.upload_files) };
}

/** Reads a picture on the site for the editor's preview (the app's pages show only their own server's pictures). */
export async function fetchSiteImage(config: Pick<WpConfig, "baseUrl">, address: string): Promise<{ bytes: Buffer; type: string }> {
  const url = onSite(config, address, "Bildens");
  const answer = await siteRequest(url, { headers: { accept: "image/*" }, maxBytes: MAX_MEDIA_BYTES }).catch((error) => {
    throw error instanceof WpError && error.code === "too-large" ? new WpError("Bilden är för stor.", 502) : new WpError("Bilden kunde inte hämtas.", 504);
  });
  const type = typeOf(answer);
  if (answer.status !== 200 || !MEDIA_TYPES[type]) throw new WpError("Bilden kunde inte hämtas.", 502);
  return { bytes: answer.body, type };
}

/** The file's first bytes match its picture type (a renamed file is refused before it reaches WordPress). */
export function imageSignature(bytes: Uint8Array, type: string) {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (type === "image/png") return starts(0x89, 0x50, 0x4e, 0x47);
  if (type === "image/jpeg") return starts(0xff, 0xd8, 0xff);
  if (type === "image/gif") return starts(0x47, 0x49, 0x46, 0x38);
  if (type === "image/webp") return starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  return false;
}

/** Whether an address is on the configured site (the same host and scheme as the REST address). */
export function isOnSite(config: Pick<WpConfig, "baseUrl">, address: string) {
  try { onSite(config, address, "Bildens"); return true; } catch { return false; }
}

/**
 * A public file anywhere on the internet (a font the site's css names, a picture on another site) under net.ts's rules – public
 * https only, the checked address pinned, no redirects, a size limit – with its type. Nothing is sent but a plain GET.
 */
export async function fetchPublic(address: string, options: { accept: string; maxBytes: number; userAgent?: string }): Promise<{ bytes: Buffer; type: string; status: number }> {
  let url: URL;
  try { url = new URL(address); } catch { throw new WpError("Adressen är ogiltig.", 400); }
  const answer = await siteRequest(url, { headers: { accept: options.accept, ...(options.userAgent ? { "user-agent": options.userAgent } : {}) }, maxBytes: options.maxBytes }).catch((error) => {
    if (error instanceof WpError && (error.code === "blocked" || error.code === "too-large")) throw error;
    throw new WpError("Filen kunde inte hämtas.", 504);
  });
  return { bytes: answer.body, type: typeOf(answer), status: answer.status };
}

export type WpMedia = { id: number; url: string; thumb: string; alt: string };
/** The newest pictures in the media library (Inlägg's background), with a small size for the list when WordPress has one. */
export async function listMedia(config: WpConfig, count = 48): Promise<WpMedia[]> {
  type Raw = { id?: unknown; source_url?: unknown; alt_text?: unknown; mime_type?: unknown; media_details?: { sizes?: Record<string, { source_url?: unknown }> } };
  const rows = await call<Raw[]>(config, "wp/v2/media", { query: { media_type: "image", per_page: String(Math.min(100, count)), orderby: "date", order: "desc", _fields: "id,source_url,alt_text,mime_type,media_details" } });
  if (!Array.isArray(rows)) throw new WpError("WordPress svarade inte med en lista över bilder.", 502);
  return rows.flatMap((row) => { const item = mediaRow(row); return item ? [item] : []; });
}

type RawMedia = { id?: unknown; source_url?: unknown; alt_text?: unknown; mime_type?: unknown; media_details?: { sizes?: Record<string, { source_url?: unknown }> } };
function mediaRow(row: RawMedia | null): WpMedia | null {
  const id = Number(row?.id);
  const url = asText(row?.source_url);
  if (!row || !Number.isInteger(id) || id <= 0 || !/^https?:\/\//.test(url) || !MEDIA_TYPES[asText(row.mime_type)]) return null;
  const sizes = row.media_details?.sizes ?? {};
  const thumb = asText(sizes.medium?.source_url) || asText(sizes.thumbnail?.source_url) || url;
  return { id, url, thumb: /^https?:\/\//.test(thumb) ? thumb : url, alt: asText(row.alt_text).slice(0, 200) };
}

/** One picture of the media library (the SEO panel's share picture); null when it is not there or not a picture. */
export async function getMedia(config: WpConfig, id: number): Promise<WpMedia | null> {
  let row: RawMedia;
  try { row = await call<RawMedia>(config, `wp/v2/media/${id}`, { query: { context: "edit", _fields: "id,source_url,alt_text,mime_type,media_details" } }); }
  catch (error) { if (error instanceof WpError && (error.status === 404 || error.status === 400)) return null; throw error; }
  return mediaRow(row);
}
