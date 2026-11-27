/**
 * Webbplatsens html som träd (Min webbsida, 2026-11-12): a small, forgiving reader of the html inside block markup and of what
 * WordPress renders, so the editor's canvas can draw a block with its own elements, classes and inline styles – the elements
 * the site's theme css is written for – instead of an approximation. Nothing here touches the DOM: the canvas turns the tree
 * into React elements from a fixed list of tags and attributes (website-canvas.tsx), never into innerHTML.
 *
 * Also the checks on what may be drawn: inline styles and attribute values are filtered (no url(), no expressions, no
 * scripts, no event handlers), and viewport units become container units, since the canvas is narrower than the window.
 * Pure: no DOM, no network.
 */
import { decodeEntities } from "./blocks";

export type HtmlElement = { t: "el"; tag: string; attrs: [string, string][]; children: HtmlNode[]; start: number; end: number };
export type HtmlNode = HtmlElement | { t: "text"; text: string; start: number; end: number } | { t: "slot"; index: number } | { t: "comment" };

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr", "param", "keygen"]);
const RAW = new Set(["script", "style", "textarea", "title", "xmp", "noscript"]);
// A start tag of these closes an open <p> (the html parser's rule, so `<p>a<div>` reads as WordPress's markup means).
const CLOSES_P = new Set(["address", "article", "aside", "blockquote", "details", "div", "dl", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "main", "nav", "ol", "p", "pre", "section", "table", "ul"]);
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
const TAG = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\?[^>]*>|<(\/)?([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/)?>/g;

/** Slots: where a child block sits in its parent's html (the parent's html is read with them in place). */
export const SLOT_OPEN = "";
export const SLOT_CLOSE = "";
export const slotMark = (index: number) => `${SLOT_OPEN}${index}${SLOT_CLOSE}`;
const SLOT = /(\d+)/g;

function textNodes(text: string, start: number): HtmlNode[] {
  if (!text.includes(SLOT_OPEN)) return [{ t: "text", text: decodeEntities(text), start, end: start + text.length }];
  const out: HtmlNode[] = [];
  let at = 0;
  SLOT.lastIndex = 0;
  for (let match = SLOT.exec(text); match; match = SLOT.exec(text)) {
    if (match.index > at) out.push({ t: "text", text: decodeEntities(text.slice(at, match.index)), start: start + at, end: start + match.index });
    out.push({ t: "slot", index: Number(match[1]) });
    at = match.index + match[0].length;
  }
  if (at < text.length) out.push({ t: "text", text: decodeEntities(text.slice(at)), start: start + at, end: start + text.length });
  return out;
}

export function readAttributes(raw: string): [string, string][] {
  const out: [string, string][] = [];
  ATTR.lastIndex = 0;
  for (let match = ATTR.exec(raw); match; match = ATTR.exec(raw)) {
    const name = match[1].toLowerCase();
    if (out.some(([seen]) => seen === name)) continue;
    out.push([name, decodeEntities(match[2] ?? match[3] ?? match[4] ?? "")]);
  }
  return out;
}

/** Reads html into a tree. Never throws: a stray end tag is skipped, an element never closed ends with its parent. */
export function parseHtml(html: string): HtmlNode[] {
  const root: HtmlNode[] = [];
  const stack: HtmlElement[] = [];
  const target = () => (stack.length ? stack[stack.length - 1].children : root);
  const close = (index: number, end: number) => { while (stack.length > index) { const element = stack.pop()!; element.end = end; } };
  let at = 0;
  TAG.lastIndex = 0;
  for (let match = TAG.exec(html); match; match = TAG.exec(html)) {
    if (match.index > at) target().push(...textNodes(html.slice(at, match.index), at));
    at = match.index + match[0].length;
    const [whole, closing, rawName, rawAttrs, selfClosing] = match;
    if (!rawName) { if (whole.startsWith("<!--")) target().push({ t: "comment" }); continue; }
    const tag = rawName.toLowerCase();
    if (closing) {
      const index = stack.map((element) => element.tag).lastIndexOf(tag);
      if (index >= 0) close(index, at);
      continue;
    }
    if (CLOSES_P.has(tag)) { const open = stack.map((element) => element.tag).lastIndexOf("p"); if (open >= 0 && open === stack.length - 1) close(open, match.index); }
    if (tag === "li") { const open = stack.map((element) => element.tag).lastIndexOf("li"); if (open >= 0 && open === stack.length - 1) close(open, match.index); }
    const element: HtmlElement = { t: "el", tag, attrs: readAttributes(rawAttrs ?? ""), children: [], start: match.index, end: at };
    target().push(element);
    if (VOID.has(tag) || selfClosing) continue;
    if (RAW.has(tag)) {
      // Script and style text is read as text up to its own end tag.
      const endTag = new RegExp(`</${tag}\\s*>`, "ig");
      endTag.lastIndex = at;
      const end = endTag.exec(html);
      const stop = end ? end.index : html.length;
      if (stop > at) element.children.push({ t: "text", text: html.slice(at, stop), start: at, end: stop });
      at = end ? end.index + end[0].length : html.length;
      element.end = at;
      TAG.lastIndex = at;
      continue;
    }
    stack.push(element);
  }
  if (at < html.length) target().push(...textNodes(html.slice(at), at));
  close(0, html.length);
  return root;
}

export const elementsOf = (nodes: readonly HtmlNode[]) => nodes.filter((node): node is HtmlElement => node.t === "el");
export const attributeOf = (element: HtmlElement, name: string) => element.attrs.find(([key]) => key === name)?.[1] ?? null;
export const classesOf = (element: HtmlElement) => (attributeOf(element, "class") ?? "").split(/\s+/).filter(Boolean);

// ---------- what may be drawn ----------

/**
 * A picture written into the css itself (an icon as `url("data:image/svg+xml,…")`, like the theme's menu and footer icons): the
 * browser asks nothing for it, and a picture cannot run anything (an svg used as an image has no scripts and loads nothing).
 */
const DATA_IMAGE = /url\(\s*(?:"data:image\/(?:svg\+xml|png|jpeg|gif|webp|avif)[;,][^"]*"|'data:image\/(?:svg\+xml|png|jpeg|gif|webp|avif)[;,][^']*'|data:image\/(?:svg\+xml|png|jpeg|gif|webp|avif)[;,][^"'()\s]*)\s*\)/gi;

const viewportUnits = (value: string) => value.replace(/(\d|\.)(vw|vi)\b/gi, "$1cqi").replace(/(\d|\.)vmin\b/gi, "$1cqmin").replace(/(\d|\.)vmax\b/gi, "$1cqmax")
  // The window's height: the canvas is as tall as the page, so it says how tall the window is (--wf-vh, a hundredth of it; 600 px
  // before it is known). A page shorter than the window keeps its footer at the bottom, as a visitor on this screen sees it.
  .replace(/(\d*\.?\d+)(vh|svh|dvh|lvh|vb)\b/gi, (_whole, amount: string) => `calc(${amount} * var(--wf-vh, 6px))`);

/** Viewport units become container units: the canvas is narrower than the window, and the site is drawn for its own width (a picture in the css is left as it is). */
export const toContainerUnits = (value: string) => {
  let out = "";
  let at = 0;
  for (const match of value.matchAll(DATA_IMAGE)) {
    out += viewportUnits(value.slice(at, match.index)) + match[0];
    at = match.index + match[0].length;
  }
  return out + viewportUnits(value.slice(at));
};

/**
 * Whether a css value is safe to write into the app's page: nothing that makes the browser ask for anything (url(), image-set,
 * @import; a picture written into the css as a data: address asks for nothing and is kept), no old expressions or bindings, no
 * escapes that could hide them, no markup.
 */
export function safeCssValue(value: string): boolean {
  if (value.length > 20_000) return false;
  if (/[\\<>{}@]/.test(value)) return false;
  const rest = value.replace(DATA_IMAGE, "none");
  if (rest.length > 2000) return false;
  if (/url\s*\(|image-set\s*\(|(^|[^-\w])image\s*\(|element\s*\(|src\s*\(|expression\s*\(|javascript:|vbscript:|-moz-binding|behavior/i.test(rest)) return false;
  return true;
}
const PROPERTY = /^(--[\w-]{1,80}|-?[a-z][a-z0-9-]{0,60})$/;
const BLOCKED_PROPERTIES = new Set(["behavior", "-moz-binding", "-webkit-binding"]);

/** An inline style's declarations that may be drawn, in order (viewport units as container units). */
export function safeDeclarations(style: string): [string, string][] {
  const out: [string, string][] = [];
  let depth = 0; let quote = ""; let start = 0;
  const take = (end: number) => {
    const part = style.slice(start, end);
    const colon = part.indexOf(":");
    if (colon <= 0) return;
    const name = part.slice(0, colon).trim();
    const value = part.slice(colon + 1).trim();
    const lower = name.startsWith("--") ? name : name.toLowerCase();
    if (!PROPERTY.test(lower) || BLOCKED_PROPERTIES.has(lower) || !value || !safeCssValue(value)) return;
    out.push([lower, toContainerUnits(value)]);
  };
  for (let index = 0; index < style.length; index += 1) {
    const char = style[index];
    if (quote) { if (char === quote) quote = ""; continue; }
    if (char === "\"" || char === "'") quote = char;
    else if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (char === ";" && depth === 0) { take(index); start = index + 1; }
  }
  take(style.length);
  return out;
}

/** A React style object from safe declarations (custom properties as they are, the rest in camelCase; !important dropped). */
export function styleObject(declarations: readonly [string, string][]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, raw] of declarations) {
    const value = raw.replace(/\s*!important\s*$/i, "");
    const key = name.startsWith("--") ? name : name.replace(/^-ms-/, "ms-").replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    out[key] = value;
  }
  return out;
}

/** Tags the canvas draws as themselves; anything else is left out (with its content, for the ones in DROP) or drawn as a span. */
export const DRAWN_TAGS = new Set([
  "a", "abbr", "address", "article", "aside", "b", "bdi", "bdo", "blockquote", "br", "caption", "cite", "code", "col", "colgroup", "dd", "del", "details", "dfn", "div", "dl", "dt",
  "em", "figcaption", "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "i", "img", "ins", "kbd", "label", "legend", "li", "main", "mark", "nav", "ol", "p", "picture",
  "pre", "q", "s", "samp", "section", "small", "span", "strong", "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "time", "tr", "u", "ul", "var", "wbr", "fieldset",
  "input", "select", "option", "optgroup", "textarea", "button", "output", "meter", "progress",
]);
/** Left out with everything in them: they run code, load something or only belong in <head>. */
export const DROPPED_TAGS = new Set(["script", "style", "noscript", "template", "iframe", "frame", "frameset", "object", "embed", "applet", "link", "meta", "base", "title", "head", "svg", "math", "canvas", "video", "audio", "source", "track", "portal", "dialog"]);
/** Drawn as their content only (the html block of a whole document: <html><body>…). */
export const TRANSPARENT_TAGS = new Set(["html", "body", "form", "center", "font"]);

/** Attributes drawn as they are (after the value check); class and style are handled by the canvas itself. */
const PLAIN_ATTRIBUTES = new Set(["alt", "title", "width", "height", "colspan", "rowspan", "span", "scope", "dir", "lang", "align", "valign", "start", "reversed", "type", "value", "placeholder",
  "min", "max", "step", "rows", "cols", "size", "label", "for", "headers", "datetime", "cite", "open", "selected", "checked", "multiple", "role"]);
const ARIA = /^aria-(hidden|label|level|describedby|labelledby|current|expanded|live)$/;
const DATA = /^data-[a-z0-9-]{1,40}$/;

/** The attributes of an element that may be drawn (React names), without class, style, id, href, src, events and the app's own data-site-*. */
export function drawnAttributes(element: HtmlElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of element.attrs) {
    if (value.length > 500 || /[<>]/.test(value) || /javascript:|vbscript:|data:text/i.test(value)) continue;
    if (name.startsWith("data-site") || name === "data-testid") continue;
    if (PLAIN_ATTRIBUTES.has(name) || ARIA.test(name) || DATA.test(name)) {
      if (name === "role" && !/^(presentation|none|img|list|listitem|group|region|note|figure)$/.test(value)) continue;
      const key = name === "for" ? "htmlFor" : name === "colspan" ? "colSpan" : name === "rowspan" ? "rowSpan" : name === "datetime" ? "dateTime" : name;
      out[key] = value;
    }
  }
  return out;
}

/**
 * A small inline picture (an svg: a menu's arrow, an icon) is drawn from a fixed list of shapes and attributes: no links, no
 * references (`url(#…)`, `<use>`), no scripts, no text, no styles of its own beyond the checked inline style. It stays out of
 * DROPPED_TAGS's counting: the canvas draws it as it is, outside the order of the editable elements.
 */
export const SVG_TAGS = new Set(["svg", "g", "path", "circle", "rect", "line", "polyline", "polygon", "ellipse"]);
const SVG_ATTRIBUTES: Record<string, string> = {
  viewbox: "viewBox", width: "width", height: "height", fill: "fill", stroke: "stroke", "stroke-width": "strokeWidth", "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin", "stroke-miterlimit": "strokeMiterlimit", "fill-rule": "fillRule", "clip-rule": "clipRule", "fill-opacity": "fillOpacity",
  "stroke-opacity": "strokeOpacity", opacity: "opacity", d: "d", cx: "cx", cy: "cy", r: "r", rx: "rx", ry: "ry", x: "x", y: "y", x1: "x1", y1: "y1", x2: "x2", y2: "y2",
  points: "points", transform: "transform", "aria-hidden": "aria-hidden", focusable: "focusable",
};

/** An svg element's attributes that may be drawn (React names). */
export function svgAttributes(element: HtmlElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of element.attrs) {
    const key = SVG_ATTRIBUTES[name];
    if (!key || value.length > 20_000 || !/^[\w\s.,#%()+-]*$/.test(value) || /url\s*\(|javascript|expression/i.test(value)) continue;
    out[key] = value;
  }
  return out;
}

/** The plain text of a tree (for the length check of a preview and for tests). */
export function textOf(nodes: readonly HtmlNode[]): string {
  return nodes.map((node) => node.t === "text" ? node.text : node.t === "el" && !DROPPED_TAGS.has(node.tag) ? textOf(node.children) : "").join("");
}

/** The css in an html block's <style> elements (the canvas scopes it to the page, site-css.ts). */
export function styleTexts(nodes: readonly HtmlNode[], into: string[] = []): string[] {
  for (const node of nodes) {
    if (node.t !== "el") continue;
    if (node.tag === "style") into.push(node.children.map((child) => (child.t === "text" ? child.text : "")).join(""));
    else if (node.tag !== "script") styleTexts(node.children, into);
  }
  return into;
}
