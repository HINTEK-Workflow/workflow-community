import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The theme's look as Astra writes it (Sajtens utseende, 2026-11-10): Karla 400 for the text and buttons, Rubik 600 for the
 * headings with Astra's sizes, a smaller set under 921 px, and the font css linked like Google Fonts' (here on the stand-in itself;
 * its files are the app's own Manrope, served under the site's names).
 */
export const ASTRA_LIKE_CSS = "body,button,input,select,textarea,.ast-button,.ast-custom-button{font-family:'Karla',sans-serif;font-weight:400;font-size:17px;font-size:1.0625rem;line-height:1.65}"
  + "body{color:#3a3a3a}a{color:#0274be}h1,h2,h3,h4,h5,h6,.entry-content h1,.entry-content h2{font-family:'Rubik',sans-serif;font-weight:600}"
  + "h1,.entry-content h1{font-size:48px;line-height:1.4em}h2,.entry-content h2{font-size:38px}h3,.entry-content h3{font-size:30px}h4{font-size:24px}h5{font-size:21px}h6{font-size:17px}"
  + ".wp-block-button .wp-block-button__link{font-family:'Karla',sans-serif;background-color:#113351}"
  + "@media (max-width:921px){h1,.entry-content h1{font-size:40px}h2,.entry-content h2{font-size:32px}h3{font-size:26px}h4{font-size:20px}}";
const FONT_CSS = "@font-face{font-family:'Karla';font-style:normal;font-weight:400;font-display:swap;src:url(/wp-content/fonts/karla-latin.woff2) format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153}"
  + "@font-face{font-family:'Karla';font-style:normal;font-weight:400;src:url(/wp-content/fonts/karla-vietnamese.woff2) format('woff2');unicode-range:U+0102-0103,U+1EA0-1EF9}"
  + "@font-face{font-family:'Rubik';font-style:normal;font-weight:600;font-display:swap;src:url(/wp-content/fonts/rubik-latin.woff2) format('woff2');unicode-range:U+0000-00FF,U+0131}";
// The front page links the font css (the look is read from it); a page shown in a frame gets the theme css only (its fonts come from Workflow).
const themeHead = (origin: string) => `<link rel="stylesheet" id="astra-google-fonts-css" href="${origin}/wp-content/fonts/css?family=Karla%3A400%7CRubik%3A600%2C500&#038;display=fallback" media="all"><style id="astra-theme-css-inline-css">${ASTRA_LIKE_CSS}</style>`;
let fontBytes: Buffer | null = null;
const fontFile = () => (fontBytes ??= readFileSync(path.join(__dirname, "..", "public", "picture", "fonts", "manrope", "Manrope-Latin.woff2")));

/**
 * A stand-in for a company's WordPress (Min webbsida, 2026-11-10; first 2026-11-09), for the tests and for showing the editor on a
 * dev server: the REST routes Workflow uses (the REST index, pages, one page, writing a page, media, users/me, settings) on
 * 127.0.0.1, with Basic authentication like an application password, and a front page that names its REST address like
 * WordPress does (a Link header and a <link>). Nothing here talks to a real site, except – when asked (`upstreamImages`) –
 * reading a public picture to show it.
 */
export type FakeSeo = { hintek_seo_title: string; hintek_seo_description: string; hintek_seo_noindex: boolean; hintek_seo_image: number };
export type FakePage = { id: number; title: string; content: string; status?: string; link?: string; seo?: Partial<FakeSeo> };
export type FakeWordPress = {
  url: string; base: string;
  pages: Map<number, FakePage & { modified: string; meta: FakeSeo }>;
  /** Every write of a page, as WordPress got it (the tests check that no `meta` reaches a site without the plugin). */
  writes: { id: number; body: Record<string, unknown> }[];
  media: Map<string, { bytes: Buffer; type: string }>;
  requests: { method: string; path: string }[];
  /** The blocks the block renderer was asked to draw. */
  renders: string[];
  /** Changes a page as if someone edited it in WordPress. */
  touch(id: number, content?: string): void;
  /** Changes a page's SEO meta as an update_post_meta would: `modified` stays (the editor must still notice). */
  touchSeo(id: number, values: Partial<FakeSeo>): void;
  stop(): Promise<void>;
};

let clock = Date.parse("2026-11-01T08:00:00Z");
const tick = () => { clock += 1000; return new Date(clock).toISOString().slice(0, 19); };

export async function startFakeWordPress(options: { pages: FakePage[]; username: string; password: string; port?: number; upstreamImages?: string; /** WordPress's own front page (page_on_front); none: the settings cannot be read. */ frontPage?: number; /** Where the REST index answers: the path form (default) or only ?rest_route=. */ rest?: "path" | "query";
  /** The Workflow SEO plugin (2026-11-11): its four post meta keys in `meta` and its namespace in the REST index. Off: plain WordPress (`meta: []`). */ seo?: boolean }): Promise<FakeWordPress> {
  // A page without its own link is shown on the stand-in itself (/?page_id=<id>), with a stylesheet like a theme's.
  const noSeo: FakeSeo = { hintek_seo_title: "", hintek_seo_description: "", hintek_seo_noindex: false, hintek_seo_image: 0 };
  const pages = new Map(options.pages.map((page) => [page.id, { status: "publish", ...page, meta: { ...noSeo, ...page.seo }, modified: tick() }]));
  const writes: FakeWordPress["writes"] = [];
  const namespaces = ["oembed/1.0", "wp/v2", ...(options.seo ? ["hintek-seo/v1"] : [])];
  const media = new Map<string, { bytes: Buffer; type: string }>();
  const requests: FakeWordPress["requests"] = [];
  const renders: string[] = [];
  let mediaId = 5000;
  let origin = "";

  const send = (response: ServerResponse, status: number, data: unknown) => {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(data));
  };
  const readBody = (request: IncomingMessage) => new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
  // Like WordPress: `meta` is [] while no key is registered with show_in_rest, an object of the registered keys otherwise.
  const view = (page: FakePage & { modified: string; meta: FakeSeo }, withContent: boolean) => ({
    id: page.id, title: { raw: page.title, rendered: page.title }, status: page.status, modified: page.modified, modified_gmt: page.modified, link: page.link ?? `${origin}/?page_id=${page.id}`,
    ...(withContent ? { content: { raw: page.content, rendered: "" } } : {}),
    meta: options.seo ? { ...page.meta } : [],
  });
  /**
   * The plugin's own checks over REST (as Workflow SEO answers, 2026-11-11): one line; a text over 70 or 200 characters is refused
   * with 400 rest_too_long (never cut); a boolean and an id. Nothing is stored unless every value passes. Unregistered keys are
   * ignored. The error code, or null when written.
   */
  const writeMeta = (page: { meta: FakeSeo }, meta: unknown): string | null => {
    if (!options.seo || !meta || typeof meta !== "object") return null;
    const input = meta as Record<string, unknown>;
    const next = { ...page.meta };
    const line = (value: unknown) => typeof value === "string" ? value.replace(/\s+/g, " ").trim() : null;
    for (const [key, max] of [["hintek_seo_title", 70], ["hintek_seo_description", 200]] as const) {
      if (!(key in input)) continue;
      const value = line(input[key]);
      if (value === null) return "rest_invalid_param";
      if ([...value].length > max) return "rest_too_long";
      next[key] = value;
    }
    if ("hintek_seo_noindex" in input) { if (typeof input.hintek_seo_noindex !== "boolean") return "rest_invalid_param"; next.hintek_seo_noindex = input.hintek_seo_noindex; }
    if ("hintek_seo_image" in input) { const value = Number(input.hintek_seo_image); if (!Number.isInteger(value) || value < 0) return "rest_invalid_param"; next.hintek_seo_image = value; }
    page.meta = next;
    return null;
  };
  // WordPress takes an application password with or without its spaces.
  const authorised = (request: IncomingMessage) => request.headers.authorization === `Basic ${Buffer.from(`${options.username}:${options.password.replace(/\s+/g, "")}`).toString("base64")}`;

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", origin);
      requests.push({ method: request.method ?? "GET", path: url.pathname });
      if (url.pathname.startsWith("/wp-content/uploads/")) {
        const stored = media.get(url.pathname);
        if (stored) { response.writeHead(200, { "content-type": stored.type }); response.end(stored.bytes); return; }
        if (options.upstreamImages) {
          try {
            const upstream = await fetch(new URL(url.pathname, options.upstreamImages), { signal: AbortSignal.timeout(15_000) });
            const type = upstream.headers.get("content-type") ?? "";
            if (upstream.ok && /^image\//.test(type)) { const bytes = Buffer.from(await upstream.arrayBuffer()); media.set(url.pathname, { bytes, type }); response.writeHead(200, { "content-type": type }); response.end(bytes); return; }
          } catch { /* shown as missing */ }
        }
        send(response, 404, { code: "not_found" }); return;
      }
      // The public page (for its look) and the theme's stylesheet: a visitor's GET, no sign-in.
      if (url.pathname === "/" && url.searchParams.has("page_id")) {
        const page = pages.get(Number(url.searchParams.get("page_id")));
        if (!page) { send(response, 404, { code: "not_found" }); return; }
        response.writeHead(200, { "content-type": "text/html; charset=UTF-8" });
        response.end(`<!doctype html><html><head><title>${page.title}</title><style id="astra-theme-css-inline-css">${ASTRA_LIKE_CSS}</style><link rel="stylesheet" id="demo-theme-css" href="/wp-content/themes/demo/style.css" media="all"><link rel="stylesheet" href="https://cdn.example.com/x.css"><style id="global-styles-inline-css">:root{--wp--preset--color--primary:#113351}</style></head><body>${page.content}</body></html>`);
        return;
      }
      // The front page names the REST address, as WordPress does; the REST index needs no sign-in.
      const restBase = options.rest === "query" ? `${origin}/?rest_route=/` : `${origin}/wp-json/`;
      if (url.pathname === "/" && !url.searchParams.has("rest_route")) {
        response.writeHead(200, { "content-type": "text/html; charset=UTF-8", link: `<${restBase}>; rel="https://api.w.org/"` });
        response.end(`<!doctype html><html><head><title>Start</title><link rel="https://api.w.org/" href="${restBase}">${themeHead(origin)}</head><body>Start</body></html>`);
        return;
      }
      const queryRoute = url.pathname === "/" ? url.searchParams.get("rest_route") : null;
      if (queryRoute !== null && options.rest === "query" && (queryRoute === "/" || queryRoute === "")) { send(response, 200, { name: "Demo", namespaces }); return; }
      if (url.pathname === "/wp-json/" && options.rest !== "query") { send(response, 200, { name: "Demo", namespaces }); return; }
      // The stand-in's own record of the page writes (for the browser tests: was a `meta` sent?). Not a WordPress route.
      if (url.pathname === "/__writes") { send(response, 200, writes); return; }
      if (url.pathname === "/wp-content/fonts/css") { response.writeHead(200, { "content-type": "text/css; charset=utf-8" }); response.end(FONT_CSS); return; }
      if (/^\/wp-content\/fonts\/[a-z-]+\.woff2$/.test(url.pathname)) { response.writeHead(200, { "content-type": "font/woff2" }); response.end(fontFile()); return; }
      if (url.pathname === "/wp-content/themes/demo/style.css") { response.writeHead(200, { "content-type": "text/css" }); response.end("body{font-family:Arial,sans-serif}.wp-block-uagb-container{padding:16px;border:1px solid #d8e2dc;border-radius:8px}"); return; }
      if (!url.pathname.startsWith("/wp-json/")) { send(response, 404, { code: "rest_no_route" }); return; }
      if (!authorised(request)) { send(response, 401, { code: "incorrect_password", message: "Fel lösenord." }); return; }
      const route = url.pathname.slice("/wp-json/".length).replace(/\/$/, "");
      if (route === "wp/v2/settings") {
        if (!options.frontPage) { send(response, 403, { code: "rest_forbidden" }); return; }
        send(response, 200, { show_on_front: "page", page_on_front: options.frontPage }); return;
      }
      if (route === "wp/v2/users/me") { send(response, 200, { name: "Webbredaktör", capabilities: { edit_pages: true, edit_published_pages: true, upload_files: true } }); return; }
      if (route === "wp/v2/pages" && request.method === "GET") {
        const page = Number(url.searchParams.get("page") ?? 1);
        send(response, 200, page > 1 ? [] : [...pages.values()].map((item) => view(item, false))); return;
      }
      const one = /^wp\/v2\/pages\/(\d+)$/.exec(route);
      if (one) {
        const page = pages.get(Number(one[1]));
        if (!page) { send(response, 404, { code: "rest_post_invalid_id" }); return; }
        if (request.method === "GET") { send(response, 200, view(page, true)); return; }
        if (request.method === "POST") {
          const input = JSON.parse((await readBody(request)).toString("utf8") || "{}") as { content?: unknown; meta?: unknown };
          writes.push({ id: page.id, body: input });
          if (input.content !== undefined && typeof input.content !== "string") { send(response, 400, { code: "rest_invalid_param" }); return; }
          if (input.content === undefined && input.meta === undefined) { send(response, 400, { code: "rest_invalid_param" }); return; }
          const metaError = writeMeta(page, input.meta);
          if (metaError) { send(response, 400, { code: metaError, message: "Parametern meta är ogiltig." }); return; }
          if (typeof input.content === "string") page.content = input.content;
          page.modified = tick();
          send(response, 200, view(page, false)); return;
        }
      }
      // The block renderer: the dynamic blocks WordPress itself draws (only what the tests and the demo use).
      const renderer = /^wp\/v2\/block-renderer\/([a-z0-9-]+\/[a-z0-9-]+)$/.exec(route);
      if (renderer) {
        renders.push(renderer[1]);
        const input = request.method === "POST" ? JSON.parse((await readBody(request)).toString("utf8") || "{}") as { attributes?: Record<string, unknown> } : {};
        const shown = Number(input.attributes?.postsToShow ?? 3);
        const drawn: Record<string, string> = {
          "core/latest-posts": `<ul class="wp-block-latest-posts__list wp-block-latest-posts">${Array.from({ length: Math.max(1, Math.min(5, shown)) }, (_, index) => `<li><a class="wp-block-latest-posts__post-title" href="${origin}/?p=${index + 1}">Nyhet ${index + 1}</a></li>`).join("")}</ul>`,
          "core/search": `<form role="search" method="get" action="${origin}/" class="wp-block-search"><label for="s1" class="wp-block-search__label">Sök</label><input id="s1" type="search" name="s"><button type="submit" class="wp-block-search__button">Sök</button></form>`,
        };
        if (!drawn[renderer[1]]) { send(response, 404, { code: "block_invalid" }); return; }
        send(response, 200, { rendered: drawn[renderer[1]] }); return;
      }
      // The media library: what was uploaded, newest first (Inlägg: Välj från webbplatsen).
      if (route === "wp/v2/media" && request.method === "GET") {
        const rows = [...media.entries()].filter(([path]) => /\/uploads\/\d{4}\/\d{2}\/\d+-/.test(path)).reverse()
          .map(([path, item]) => ({ id: Number(/\/(\d+)-/.exec(path)?.[1] ?? 0), source_url: `${origin}${path}`, alt_text: "", mime_type: item.type, media_details: { sizes: {} } }));
        send(response, 200, rows); return;
      }
      const oneMedia = /^wp\/v2\/media\/(\d+)$/.exec(route);
      if (oneMedia && request.method === "GET") {
        const found = [...media.entries()].find(([path]) => new RegExp(`/${oneMedia[1]}-`).test(path));
        if (!found) { send(response, 404, { code: "rest_post_invalid_id" }); return; }
        send(response, 200, { id: Number(oneMedia[1]), source_url: `${origin}${found[0]}`, alt_text: "", mime_type: found[1].type, media_details: { sizes: {} } }); return;
      }
      if (route === "wp/v2/media" && request.method === "POST") {
        const bytes = await readBody(request);
        const name = /filename="([^"]+)"/.exec(String(request.headers["content-disposition"] ?? ""))?.[1] ?? "bild.png";
        const path = `/wp-content/uploads/2026/11/${++mediaId}-${name}`;
        media.set(path, { bytes, type: String(request.headers["content-type"] ?? "application/octet-stream") });
        send(response, 201, { id: mediaId, source_url: `${origin}${path}` }); return;
      }
      send(response, 404, { code: "rest_no_route" });
    })().catch(() => send(response, 500, { code: "internal" }));
  });
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url: origin, base: `${origin}/wp-json/`, pages, media, requests, renders, writes,
    touch(id, content) { const page = pages.get(id); if (page) { if (content !== undefined) page.content = content; page.modified = tick(); } },
    touchSeo(id, values) { const page = pages.get(id); if (page) Object.assign(page.meta, values); },
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
