import { escapeAttribute, isLocked, serializeBlock, tagAttribute, typeOf, type BlockNode } from "./blocks";
import type { CanvasLook } from "./site-css";

/**
 * Förhandsvisning av HTML-block och tilläggsblock (2026-11-10). The site's own html (a calculator with its scripts, a plugin
 * block's saved html, a dynamic block as WordPress renders it) is drawn in a frame that cannot reach the app:
 *
 * - the frame is `<iframe sandbox="allow-scripts">` (never allow-same-origin): an opaque origin, no cookies, no storage, no
 *   access to the app's window, no popups, no top navigation;
 * - its document is a small shell served by the app (/api/website/frame) with a policy of its own in the answer
 *   header: `sandbox allow-scripts` again, scripts and styles inline or from the site only, pictures and fonts from the site,
 *   no fetch/XHR/WebSocket at all (connect-src 'none'), no forms, no frames, no <base>. A srcdoc frame would inherit the app's
 *   own policy (nonce scripts only, pictures from the app only), so the calculators could not run once that policy is
 *   enforced – hence a document of its own;
 * - the parent posts the page's html to the shell, which writes it into itself; the same policy is repeated as a <meta> in
 *   the written document. The html never enters the app's DOM;
 * - the frame talks back with postMessage only: "ready", its height and a pointer press (to select the block). Every message
 *   is checked: origin "null" (the sandbox), the frame's own window, the channel, the frame's token and the shape.
 *
 * Pure: no DOM, no network.
 */
export const FRAME_PATH = "/api/website/frame";
export const FRAME_CHANNEL = "workflow-site-frame";
export const MAX_FRAME_HEIGHT = 20_000;

/** The site's origin (scheme, host and port) from the REST address; null when the address cannot be read. */
export function siteOrigin(baseUrl: string): string | null {
  try { return new URL(baseUrl).origin; } catch { return null; }
}

/** The site's root (its origin and path, ending in /) from the REST address (…/index.php/wp-json/, …/wp-json/ or …/?rest_route=/). */
export function siteRoot(baseUrl: string): string | null {
  let url: URL;
  try { url = new URL(baseUrl); } catch { return null; }
  const path = url.pathname.replace(/(index\.php\/)?wp-json\/?$/, "").replace(/index\.php$/, "");
  return `${url.origin}${path.endsWith("/") ? path : `${path}/`}`;
}

/** The page in WordPress's own editor, for what only WordPress can change. */
export function wordpressEditUrl(baseUrl: string, pageId: number): string | null {
  const root = siteRoot(baseUrl);
  return root && Number.isInteger(pageId) && pageId > 0 ? `${root}wp-admin/post.php?post=${pageId}&action=edit` : null;
}

/**
 * The frame's policy. `origin` is the connected site's origin (a local stand-in on 127.0.0.1 in tests); only it is
 * allowed for scripts, styles, pictures and fonts. Nothing may be fetched, posted or framed.
 */
export function frameCsp(origin: string | null, options: { header?: boolean } = {}): string {
  const site = origin && /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origin) ? ` ${origin}` : "";
  const directives = [
    ...(options.header ? ["sandbox allow-scripts"] : []),
    "default-src 'none'",
    `script-src 'unsafe-inline'${site}`,
    `style-src 'unsafe-inline'${site}`,
    `img-src data: blob:${site}`,
    `font-src data:${site}`,
    `media-src${site || " 'none'"}`,
    "connect-src 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    ...(options.header ? ["frame-ancestors 'self'"] : []),
  ];
  return directives.join("; ");
}

/**
 * The shell the frame first loads: it says "ready" with the token from its address (#token) and writes the one document the
 * parent sends it. Its own policy comes in the answer header (frameCsp with header).
 */
export function frameShellHtml(): string {
  const script = `(function(){var t=location.hash.slice(1);if(!/^[A-Za-z0-9_-]{16,64}$/.test(t))return;var done=false;`
    + `window.addEventListener("message",function(e){if(done||e.source!==window.parent)return;var d=e.data;`
    + `if(!d||typeof d!=="object"||d.channel!==${JSON.stringify(FRAME_CHANNEL)}||d.kind!=="render"||d.token!==t||typeof d.html!=="string")return;`
    + `done=true;document.open();document.write(d.html);document.close();});`
    + `window.parent.postMessage({channel:${JSON.stringify(FRAME_CHANNEL)},kind:"ready",token:t},"*");})();`;
  return `<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>Förhandsvisning</title></head><body><script>${script}</script></body></html>`;
}

/** What the site's page itself loads for its look: its stylesheets (on the site) and the css it writes inline in <head>. */
export type ThemeStyles = { stylesheets: string[]; inline: string;
  /** The site's web fonts copied to Workflow (@font-face with data: addresses) and its body font (lib/website/site-look.ts). */
  fontCss?: string; baseFont?: string;
  /** The canvas: the site's css scoped to it and the elements around the content (site-css.ts, 2026-11-12); null: not read. */
  canvas?: CanvasLook | null;
  /** How WordPress draws the page's shortcodes and dynamic blocks, by each block's markup (rendered.ts). */
  rendered?: Record<string, string> };
export const NO_STYLES: ThemeStyles = { stylesheets: [], inline: "" };
const MAX_STYLESHEETS = 40;
const MAX_INLINE_CSS = 400_000;

/** Reads the stylesheets and inline css of a public page on the site (its <head>); addresses elsewhere are left out. */
export function themeStyles(html: string, pageUrl: string, origin: string): ThemeStyles {
  const head = html.slice(0, Math.max(0, html.search(/<\/head>/i)) || Math.min(html.length, 1_000_000));
  const stylesheets: string[] = [];
  for (const [tag] of head.matchAll(/<link\b[^>]*>/gi)) {
    if (!/\bstylesheet\b/i.test(tagAttribute(tag, "rel") ?? "")) continue;
    if (/^print$/i.test((tagAttribute(tag, "media") ?? "").trim())) continue;
    let url: URL;
    try { url = new URL(tagAttribute(tag, "href") ?? "", pageUrl); } catch { continue; }
    if (url.origin !== origin || !/^https?:$/.test(url.protocol)) continue;
    if (!stylesheets.includes(url.href)) stylesheets.push(url.href);
    if (stylesheets.length >= MAX_STYLESHEETS) break;
  }
  let inline = "";
  for (const match of head.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
    const css = match[1].replace(/<\/?style/gi, "");
    if (inline.length + css.length > MAX_INLINE_CSS) break;
    inline += `${css}\n`;
  }
  return { stylesheets, inline };
}

/** The script at the end of the written document: the height (on every change of size), a press, links that do not leave. */
const reporter = (token: string) => `(function(){var t=${JSON.stringify(token)},c=${JSON.stringify(FRAME_CHANNEL)},r=document.getElementById("__site_preview");`
  + `function send(k,h){window.parent.postMessage({channel:c,kind:k,token:t,height:h},"*");}`
  + `function size(){if(r)send("height",Math.ceil(r.getBoundingClientRect().height));}`
  + `if(r&&window.ResizeObserver)new ResizeObserver(size).observe(r);window.addEventListener("load",size);size();`
  + `document.addEventListener("pointerdown",function(){send("pointer",0);},true);`
  + `document.addEventListener("click",function(e){var a=e.target&&e.target.closest&&e.target.closest("a[href]");if(a)e.preventDefault();},true);})();`;

/** The whole document the frame writes: the policy again, the site's look, the html and the reporter. */
export function previewDocument(input: { html: string; token: string; origin: string | null; styles?: ThemeStyles }): string {
  const styles = input.styles ?? NO_STYLES;
  const library = input.origin ? `${input.origin}/wp-includes/css/dist/block-library/style.min.css` : null;
  const sheets = [...(library && !styles.stylesheets.some((href) => href.includes("/block-library/")) ? [library] : []), ...styles.stylesheets];
  return "<!doctype html><html lang=\"sv\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
    + "<meta name=\"referrer\" content=\"no-referrer\">"
    + `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(frameCsp(input.origin))}">`
    // The base first, so the theme's own css wins: the site's fonts (copied, data: addresses) and its body font, else Arial.
    + `<style>${(styles.fontCss ?? "").replace(/<\/?style/gi, "")}html,body{margin:0;padding:0;background:transparent}body{font-family:${safeFont(styles.baseFont)};color:#17202a}#__site_preview{display:flow-root}</style>`
    + sheets.map((href) => `<link rel="stylesheet" href="${escapeAttribute(href)}">`).join("")
    + (styles.inline ? `<style>${styles.inline.replace(/<\/?style/gi, "")}</style>` : "")
    + `</head><body><div id="__site_preview">${input.html}</div><script>${reporter(input.token)}</script></body></html>`;
}

const safeFont = (value: string | undefined) => (value && /^[\w\s,"-]{1,300}$/.test(value) ? value : "Arial,Helvetica,sans-serif");

export type FrameMessage = { kind: "ready" } | { kind: "height"; height: number } | { kind: "pointer" };

/** A message from a preview frame, or null: from the sandbox (origin "null"), from this frame's window, with its token. */
export function readFrameMessage(event: { origin: string; source: unknown; data: unknown }, frameWindow: unknown, token: string): FrameMessage | null {
  if (event.origin !== "null" || !frameWindow || event.source !== frameWindow) return null;
  const data = event.data as Record<string, unknown> | null;
  if (!data || typeof data !== "object" || Array.isArray(data) || data.channel !== FRAME_CHANNEL || typeof token !== "string" || !token || data.token !== token) return null;
  if (data.kind === "ready") return { kind: "ready" };
  if (data.kind === "pointer") return { kind: "pointer" };
  if (data.kind === "height") {
    if (typeof data.height !== "number" || !Number.isFinite(data.height) || data.height < 0) return null;
    return { kind: "height", height: Math.min(MAX_FRAME_HEIGHT, Math.ceil(data.height)) };
  }
  return null;
}

// ---------- what a locked block shows ----------

/** A block's full name for WordPress (paragraph → core/paragraph). */
export const fullBlockName = (block: Pick<BlockNode, "name">) => block.name.includes("/") ? block.name : `core/${block.name}`;
export const BLOCK_NAME = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/;

/**
 * How a locked block is shown: "static" – its saved html is what the site shows (most of Spectra's blocks); "server" – it has
 * no html of its own and WordPress draws it when the page is shown (latest posts, search, log in/out …), so WordPress's block
 * renderer is asked; "shortcode" – a shortcode, which only the site can expand.
 */
export function previewKind(block: BlockNode): "static" | "server" | "shortcode" | null {
  if (!isLocked(block)) return null;
  if (typeOf(block) === "shortcode") return "shortcode";
  if (block.void) return "server";
  const own = serializeBlock(block).replace(/<!--[\s\S]*?-->/g, "");
  return own.trim() ? "static" : "server";
}

/** The saved html of a static locked block (its block comments are left in; html ignores them). */
export const staticPreviewHtml = (block: BlockNode) => serializeBlock(block);
