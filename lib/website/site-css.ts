/**
 * Sajtens egen css på sidytan (Min webbsida, 2026-11-12: "det jag ser i editorn är det som är live"). The editor's
 * canvas draws each block with its own elements and classes (website-canvas.tsx); this module turns the css the site's page
 * loads – a block theme's global styles (theme.json as custom properties), the block library's css, the theme's and the
 * plugins' css, the per-page layout rules – into css for the canvas only:
 *
 * - every selector is scoped to the canvas: `html`, `:root` and `body` become the canvas's own body element (which carries the
 *   page's body classes), everything else is looked for inside it, so nothing reaches the app around it;
 * - width media queries become container queries on the canvas (the canvas is narrower than the window), and viewport units
 *   container units, so the page is drawn for the canvas's width as the site draws it for a window of that width;
 * - nothing in it can make the browser ask for anything: url(), image-set(), @import and @font-face are left out (the site's
 *   fonts are copied to Workflow by look-server.ts and given as data: addresses), as are bindings, expressions and escapes;
 * - all of it sits in the app's `base` cascade layer, after a reset that gives the canvas's elements the browser's own
 *   defaults back (the app's own reset would otherwise remove a list's bullets and a heading's size), so the editor's own
 *   controls on the canvas (Tailwind utilities) still win over it.
 *
 * Also what the canvas needs from the page around the content: the body's classes and the chain of elements around the
 * post content (`main.hintek-main …`, `.entry-content.wp-block-post-content.has-global-padding …`), whose classes the theme's
 * css is written for. Pure: no DOM, no network.
 */
import { classesOf, elementsOf, parseHtml, safeCssValue, toContainerUnits, type HtmlElement } from "./markup";

/** The canvas's container (its width is the page's) and its body element. */
export const CANVAS_CONTAINER = "wfsite";
export const CANVAS_BODY = "[data-site-canvas]";
const UI = "[data-site-ui]";

export type CanvasChainLink = {
  tag: string;
  className: string;
  /** The site's html in this element before and after the next link (the header, the page title, the footer); drawn, not edited. */
  before?: string;
  after?: string;
};
export type CanvasLook = {
  /** The scoped css (already safe to write into a <style> on the app's page). */
  css: string;
  /** The page's body classes. */
  bodyClass: string;
  /** The elements around the post content, outermost first (tag and classes only). */
  chain: CanvasChainLink[];
  /** WordPress adds `wp-block-paragraph` to every paragraph when it draws the page (6.9). */
  paragraphClass: boolean;
  /** theme.json's useRootPaddingAwareAlignments: constrained groups get `has-global-padding`. */
  rootPadding: boolean;
};

// ---------- reading css ----------

type CssItem = { kind: "rule"; prelude: string; body: string } | { kind: "at"; name: string; prelude: string; body: string | null };

/** Comments out, strings kept. */
function stripComments(css: string): string {
  let out = ""; let quote = "";
  for (let index = 0; index < css.length; index += 1) {
    const char = css[index];
    if (quote) { out += char; if (char === quote && css[index - 1] !== "\\") quote = ""; continue; }
    if (char === "\"" || char === "'") { quote = char; out += char; continue; }
    if (char === "/" && css[index + 1] === "*") { const end = css.indexOf("*/", index + 2); index = end < 0 ? css.length : end + 1; continue; }
    out += char;
  }
  return out;
}

/** The top-level statements of a stylesheet (rules and at-rules, with their bodies as text). */
function readItems(css: string): CssItem[] {
  const items: CssItem[] = [];
  let index = 0;
  while (index < css.length && items.length < 40_000) {
    // The prelude: up to "{" or ";" (outside strings and parentheses).
    let at = index; let depth = 0; let quote = "";
    while (at < css.length) {
      const char = css[at];
      if (quote) { if (char === quote) quote = ""; }
      else if (char === "\"" || char === "'") quote = char;
      else if (char === "(") depth += 1;
      else if (char === ")") depth = Math.max(0, depth - 1);
      else if (depth === 0 && (char === "{" || char === ";" || char === "}")) break;
      at += 1;
    }
    const prelude = css.slice(index, at).trim();
    if (at >= css.length) break;
    if (css[at] === "}" ) { index = at + 1; continue; }
    if (css[at] === ";") {
      if (prelude.startsWith("@")) { const name = /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase() ?? ""; items.push({ kind: "at", name, prelude: prelude.slice(name.length + 1).trim(), body: null }); }
      index = at + 1;
      continue;
    }
    // The body: up to the matching "}".
    let end = at + 1; let level = 1; quote = "";
    while (end < css.length && level > 0) {
      const char = css[end];
      if (quote) { if (char === quote) quote = ""; }
      else if (char === "\"" || char === "'") quote = char;
      else if (char === "{") level += 1;
      else if (char === "}") level -= 1;
      end += 1;
    }
    const body = css.slice(at + 1, level === 0 ? end - 1 : end);
    if (prelude.startsWith("@")) { const name = /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase() ?? ""; items.push({ kind: "at", name, prelude: prelude.slice(name.length + 1).trim(), body }); }
    else if (prelude) items.push({ kind: "rule", prelude, body });
    index = end;
  }
  return items;
}

/** Splits on a character outside parentheses, brackets and strings. */
function splitTop(text: string, separator: string): string[] {
  const out: string[] = [];
  let depth = 0; let quote = ""; let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) { if (char === quote) quote = ""; continue; }
    if (char === "\"" || char === "'") quote = char;
    else if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth = Math.max(0, depth - 1);
    else if (char === separator && depth === 0) { out.push(text.slice(start, index)); start = index + 1; }
  }
  out.push(text.slice(start));
  return out;
}

// ---------- selectors ----------

const ROOTISH = /^(html|:root|body)(?![\w-])/i;
const COMBINATOR = /^\s*([>+~])\s*|^\s+/;

/** The compounds of a selector with the combinators between them ("a > b c" → ["a", ">", "b", " ", "c"]). */
function compounds(selector: string): string[] {
  const out: string[] = [];
  let depth = 0; let quote = ""; let current = "";
  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index];
    if (quote) { current += char; if (char === quote) quote = ""; continue; }
    if (char === "\"" || char === "'") { quote = char; current += char; continue; }
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth = Math.max(0, depth - 1);
    if (depth === 0 && /[\s>+~]/.test(char)) {
      const match = COMBINATOR.exec(selector.slice(index));
      if (match) {
        if (current) out.push(current);
        current = "";
        out.push(match[1] ? ` ${match[1]} ` : " ");
        index += match[0].length - 1;
        continue;
      }
    }
    current += char;
  }
  if (current) out.push(current);
  // A combinator at the start or end means nothing; drop it.
  while (out.length && /^[\s>+~]$/.test(out[0])) out.shift();
  while (out.length && /^[\s>+~]$/.test(out[out.length - 1])) out.pop();
  return out;
}

/**
 * Ids: the canvas never gives its elements the site's ids (they could clash with the app's own); it writes them as
 * data-site-id, and `#x` becomes `:is([data-site-id="x"],#wf-no-id)` – the same element and the same weight as an id.
 */
export function rewriteIds(selector: string): string {
  let out = ""; let depth = 0; let quote = "";
  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index];
    if (quote) { out += char; if (char === quote) quote = ""; continue; }
    if (char === "\"" || char === "'") { quote = char; out += char; continue; }
    if (char === "[") depth += 1;
    else if (char === "]") depth = Math.max(0, depth - 1);
    if (char === "#" && depth === 0) {
      const match = /^#([A-Za-z_][\w-]{0,80})/.exec(selector.slice(index));
      if (match) { out += `:is([data-site-id="${match[1]}"],#wf-no-id)`; index += match[0].length - 1; continue; }
    }
    out += char;
  }
  return out;
}

/** An id the canvas may write as data-site-id (the same rule as rewriteIds reads). */
export const siteId = (value: string | null) => (value && /^[A-Za-z_][\w-]{0,80}$/.test(value) ? value : undefined);

/**
 * One selector for the canvas: `html`, `:root` and `body` (and `:where(body)`) become the canvas's body; everything else is
 * looked for inside it. Null: the selector cannot be scoped safely (left out).
 */
export function scopeSelector(selector: string, scope = CANVAS_BODY): string | null {
  let text = selector.trim().replace(/\s+/g, " ");
  if (!text || text.length > 1000 || /[{};<@\\]/.test(text)) return null;
  // A block style's per-block copy (`is-style-outline--1`) is the same style for every block that has it.
  text = text.replace(/(\.is-style-[a-z0-9_-]+?)--\d+(?![\w-])/gi, "$1");
  text = rewriteIds(text);
  text = text.replace(/:where\(\s*(?:html|:root|body)\s*\)/gi, `:where(${scope})`);
  const parts = compounds(text);
  if (!parts.length) return null;
  let consumed = 0;
  let suffix = "";
  let roots = 0;
  let types = 0;
  // Leading html/:root and body compounds collapse into the scope (keeping their classes and pseudo-classes).
  while (consumed < parts.length && ROOTISH.test(parts[consumed])) {
    if (/^:root/i.test(parts[consumed])) roots += 1; else types += 1;
    suffix += parts[consumed].replace(ROOTISH, "");
    consumed += 1;
    if (consumed < parts.length && /^[\s>]$/.test(parts[consumed]) && consumed + 1 < parts.length && ROOTISH.test(parts[consumed + 1])) { consumed += 1; continue; }
    break;
  }
  // Every rule gets the same weight added (the canvas's attribute, as the reset has), and the scope weighs what the compounds it
  // stands for weighed (`:root` a class, `html` and `body` an element: the canvas's body is a div), so the site's rules keep their
  // order of strength among themselves (`:root :where(.is-layout-flow) > :last-child` over `.hintek-footer p`, as on the site).
  if (consumed) {
    const rest = parts.slice(consumed).join("");
    return `${scope.repeat(roots + 1)}${":is(div)".repeat(types)}${suffix}${rest}`.replace(/\s+$/, "");
  }
  if (parts[0].startsWith(`:where(${scope})`)) return `${scope}${text}`;
  return `${scope} ${text}`;
}

// ---------- media queries ----------

const WIDTH_FEATURE = /^\(\s*(min-width|max-width|width)\s*:\s*[\d.]+(px|em|rem)\s*\)$|^\(\s*width\s*[<>]=?\s*[\d.]+(px|em|rem)\s*\)$|^\(\s*[\d.]+(px|em|rem)\s*[<>]=?\s*width\s*[<>]=?\s*[\d.]+(px|em|rem)\s*\)$/i;

/** A media query list as the canvas reads it: a container query (width only), the media query as it is, or null (print). */
export function canvasMedia(query: string): { kind: "container" | "media"; queries: string[] } | null {
  const list = splitTop(query, ",").map((item) => item.trim().replace(/\s+/g, " ")).filter(Boolean);
  if (!list.length) return { kind: "media", queries: ["all"] };
  const kept: string[] = [];
  let widthOnly = true;
  for (const item of list) {
    if (/^(only\s+)?print$/i.test(item) || /^not\s+(all|screen)$/i.test(item)) continue;
    const body = item.replace(/^(only\s+)?(screen|all)\s+and\s+/i, "");
    if (/^(only\s+)?(screen|all)$/i.test(item)) { kept.push(item); widthOnly = false; continue; }
    const features = splitTop(body.replace(/\s+and\s+/gi, "\u0000"), "\u0000").map((feature) => feature.trim());
    if (!features.every((feature) => WIDTH_FEATURE.test(feature))) widthOnly = false;
    kept.push(body);
  }
  if (!kept.length) return null;
  if (widthOnly) return { kind: "container", queries: kept };
  return { kind: "media", queries: list.filter((item) => !/^(only\s+)?print$/i.test(item)) };
}

// ---------- declarations ----------

/** A rule's body with only declarations that are safe (and viewport units as container units). Null: nothing left. */
function safeBody(body: string): string | null {
  if (body.includes("{")) return null;
  const out: string[] = [];
  for (const declaration of splitTop(body, ";")) {
    const colon = declaration.indexOf(":");
    if (colon <= 0) continue;
    const name = declaration.slice(0, colon).trim();
    const value = declaration.slice(colon + 1).trim();
    const lower = name.startsWith("--") ? name : name.toLowerCase();
    if (!/^(--[\w-]{1,80}|-?[a-z][a-z0-9-]{0,60})$/.test(lower) || /binding|behavior/.test(lower) || !value || !safeCssValue(value)) continue;
    out.push(`${lower}:${toContainerUnits(value)}`);
  }
  return out.length ? out.join(";") : null;
}

const SKIPPED_AT = new Set(["import", "font-face", "charset", "namespace", "page", "property", "keyframes", "-webkit-keyframes", "-moz-keyframes", "font-feature-values", "counter-style", "font-palette-values", "view-transition", "scope", "starting-style", "position-try"]);

/** A stylesheet for the canvas (no layer, no reset): scoped, filtered, width queries as container queries. */
export function scopeCss(css: string, scope = CANVAS_BODY, limit = { bytes: 0, max: 900_000 }): string {
  const out: string[] = [];
  for (const item of readItems(stripComments(css))) {
    if (limit.bytes > limit.max) break;
    if (item.kind === "rule") {
      const selectors = splitTop(item.prelude, ",").map((selector) => scopeSelector(selector, scope)).filter((selector): selector is string => Boolean(selector));
      const body = safeBody(item.body);
      if (!selectors.length || !body) continue;
      const rule = `${selectors.join(",")}{${body}}`;
      limit.bytes += rule.length;
      out.push(rule);
      continue;
    }
    if (item.body === null || SKIPPED_AT.has(item.name)) continue;
    if (item.name === "layer") { out.push(scopeCss(item.body, scope, limit)); continue; }
    if (item.name === "media") {
      const media = canvasMedia(item.prelude);
      if (!media || media.queries.some((query) => /[{};<@\\]/.test(query))) continue;
      const inner = scopeCss(item.body, scope, limit);
      if (!inner) continue;
      if (media.kind === "container") for (const query of media.queries) out.push(`@container ${CANVAS_CONTAINER} ${query}{${inner}}`);
      else out.push(`@media ${media.queries.join(",")}{${inner}}`);
      continue;
    }
    if (item.name === "supports" || item.name === "container") {
      if (/[{};<@\\]|url\s*\(/i.test(item.prelude) || item.prelude.length > 300) continue;
      const inner = scopeCss(item.body, scope, limit);
      if (inner) out.push(`@${item.name} ${item.prelude}{${inner}}`);
    }
  }
  return out.join("\n");
}

/**
 * The canvas's base: the browser's own defaults back on every element of the page (not on the editor's controls, which carry
 * data-site-ui), and the canvas's body starting as a page's body does. Specificity: the canvas's own attribute only – over the
 * app's own base (its element rules) – and every rule of the site's (scoped with the same attribute and more, written after it) wins.
 */
export function canvasReset(scope = CANVAS_BODY): string {
  return [
    `${scope}{all:revert;display:block;margin:0;font-size:16px;line-height:normal;font-weight:400;font-style:normal;color:#000;letter-spacing:normal;text-transform:none;text-align:start;white-space:normal;cursor:auto;min-height:100%}`,
    // An inline svg keeps its own attributes (its path, size and colours are presentation hints that `all` would undo).
    `${scope} :where(:not(${UI},${UI} *,svg,svg *)){all:revert}`,
    `${scope} :where(svg:not(${UI} *)){display:revert;vertical-align:revert}`,
  ].join("\n");
}

/**
 * A plain block look for a site whose css could not be read: what WordPress's block library does for the blocks Workflow
 * edits (columns side by side, buttons in a row, pictures within the column). The site's typography still comes on top.
 */
export const FALLBACK_BLOCK_CSS = [
  ".is-layout-flex{display:flex;flex-wrap:wrap;align-items:center;gap:.5em}",
  ".wp-block-columns{display:flex;flex-wrap:wrap;gap:2em;margin-bottom:1.75em}",
  "@container wfsite (min-width:782px){.wp-block-columns{flex-wrap:nowrap}}",
  ".wp-block-column{flex-grow:1;flex-basis:0;min-width:0}",
  "@container wfsite (max-width:781px){.wp-block-column{flex-basis:100%!important}}",
  ".wp-block-column[style*=flex-basis]{flex-grow:0}",
  ".wp-block-button__link{display:inline-block;background:#32373c;color:#fff;border-radius:9999px;padding:calc(.667em + 2px) calc(1.333em + 2px);text-decoration:none}",
  ".is-style-outline>.wp-block-button__link{background:transparent;color:currentColor;border:2px solid}",
  ".wp-block-image img{max-width:100%;height:auto;vertical-align:bottom}",
  ".wp-block-cover{position:relative;display:flex;align-items:center;justify-content:center;min-height:430px;padding:1em;overflow:hidden;color:#fff}",
  ".wp-block-cover__image-background{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}",
  ".wp-block-cover__background{position:absolute;inset:0;background:#000;opacity:.5}",
  ".wp-block-cover__inner-container{position:relative;width:100%}",
  ".wp-block-media-text{display:grid;grid-template-columns:50% 1fr;align-items:center}",
  ".wp-block-separator{border:none;border-top:2px solid;opacity:.4}",
  ".has-text-align-center{text-align:center}.has-text-align-right{text-align:right}",
].join("\n");

/**
 * The app's own class names never style the site's elements: WordPress and the app share some (`size-full` on a picture is the
 * app's `width:100%;height:100%`, `container`, `hidden` …), and the app's components and utilities come after the base layer.
 * In those layers every element of the page (not the editor's own, data-site-ui) is set back to what the base layer – the
 * site's css – gives it.
 */
export function canvasShield(scope = CANVAS_BODY): string {
  const site = `${scope} :not(${UI}):not(${UI} *):not(svg):not(svg *)`;
  return `@layer components{${site}{all:revert-layer}}\n@layer utilities{${site}{all:revert-layer}}`;
}

/** Everything the canvas's <style> holds: the reset, the site's css (or the plain block look) and the canvas's own extra rules, in the base layer, and the shield against the app's class names. */
export function canvasStylesheet(siteCss: string | null, extra = "", scope = CANVAS_BODY): string {
  const site = siteCss ?? scopeCss(FALLBACK_BLOCK_CSS, scope);
  return `@layer base{\n${canvasReset(scope)}\n${site}\n${extra}\n}\n${canvasShield(scope)}`;
}

// ---------- the page around the content ----------

const CLASS = /^[A-Za-z_-][\w-]{0,80}$/;
const cleanClasses = (list: readonly string[]) => list.filter((name) => CLASS.test(name)).slice(0, 40).join(" ");

/** The path of elements from the top of the body down to the post content (the element itself last). */
function pathTo(nodes: readonly HtmlElement[], test: (element: HtmlElement) => boolean, trail: HtmlElement[] = []): HtmlElement[] | null {
  for (const element of nodes) {
    const next = [...trail, element];
    if (test(element)) return next;
    const found = pathTo(elementsOf(element.children), test, next);
    if (found) return found;
  }
  return null;
}

const MAX_AROUND = 150_000;

/**
 * What a link of the chain holds before and after the next one (the site's header and footer around `main`, the page title
 * above the post content): the canvas draws it as it is, not editable, so the page looks as on the site. Its scripts and
 * everything else that is not drawn are left out by the canvas's drawing (markup.ts's lists), as for a shortcode's drawing.
 */
function around(source: string, element: HtmlElement, next: HtmlElement | undefined): Pick<CanvasChainLink, "before" | "after"> {
  if (!next) return {};
  const open = /^<[^>]*>/.exec(source.slice(element.start))?.[0].length ?? 0;
  const close = new RegExp(`</${element.tag}\\s*>$`, "i").exec(source.slice(element.start, element.end))?.[0].length ?? 0;
  const before = source.slice(element.start + open, next.start);
  const after = source.slice(next.end, element.end - close);
  const kept = (html: string) => (html.trim() && html.length <= MAX_AROUND ? html : undefined);
  return { before: kept(before), after: kept(after) };
}

/** The body's classes and the chain of elements around the post content, from the page as WordPress draws it. */
export function pageFrame(html: string): Pick<CanvasLook, "bodyClass" | "chain" | "paragraphClass" | "rootPadding"> {
  const bodyAt = html.search(/<body\b/i);
  const bodyTag = bodyAt >= 0 ? /<body\b[^>]*>/i.exec(html.slice(bodyAt))?.[0] ?? "" : "";
  const bodyElement = bodyTag ? elementsOf(parseHtml(`${bodyTag}</body>`))[0] : null;
  const bodyClass = bodyElement ? cleanClasses(classesOf(bodyElement)) : "";
  const source = bodyAt >= 0 ? html.slice(bodyAt) : html;
  const tree = parseHtml(source);
  const path = pathTo(elementsOf(tree), (element) => classesOf(element).some((name) => name === "wp-block-post-content" || name === "entry-content"));
  const links = (path ?? []).filter((element) => element.tag !== "body");
  const chain = links.map((element, index) => ({
    tag: /^(div|main|article|section)$/.test(element.tag) ? element.tag : "div",
    className: cleanClasses(classesOf(element)),
    ...around(source, element, links[index + 1]),
  })).slice(-8);
  const content = path?.[path.length - 1];
  const contentHtml = content ? html.slice(bodyAt + content.start, bodyAt + content.end) : "";
  return {
    bodyClass,
    chain,
    paragraphClass: /<p\b[^>]*class="[^"]*\bwp-block-paragraph\b/.test(contentHtml),
    rootPadding: chain.some((link) => link.className.split(" ").includes("has-global-padding")),
  };
}

/** The post content as the public page draws it (the inside of `.wp-block-post-content` / `.entry-content`), or null. */
export function postContentHtml(html: string): string | null {
  const bodyAt = Math.max(0, html.search(/<body\b/i));
  const body = html.slice(bodyAt);
  const path = pathTo(elementsOf(parseHtml(body)), (element) => classesOf(element).some((name) => name === "wp-block-post-content" || name === "entry-content"));
  const content = path?.[path.length - 1];
  if (!content) return null;
  const open = /^<[^>]*>/.exec(body.slice(content.start))?.[0].length ?? 0;
  const inner = body.slice(content.start + open, content.end);
  return inner.replace(/<\/[a-z]+>\s*$/i, "");
}

/** The css a page loads, in order: its <style> elements (and the stylesheets the caller has read, in their place). */
export type PageCss = { css: string; url: string };

/** The canvas's look from the page's html and its css (inline and the stylesheets read by the server, in document order). */
export function canvasLook(html: string, sources: readonly PageCss[]): CanvasLook {
  const limit = { bytes: 0, max: 900_000 };
  const css = sources.map((source) => scopeCss(source.css, CANVAS_BODY, limit)).filter(Boolean).join("\n");
  return { css, ...pageFrame(html) };
}
