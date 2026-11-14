"use client";

import { cloneElement, createElement, Fragment, isValidElement, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { Code2, ImageDown, ImageOff, ImagePlus, Lock, Puzzle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  blockText, childBlocks, htmlCode, isHtml, isLocked, parseInline, serializeBlock, serializeInline, typeOf, type BlockDocument, type BlockNode, type InlineNode,
} from "@/lib/website/blocks";
import { previewKind, staticPreviewHtml } from "@/lib/website/frame";
import { blockLayout, elementColours, pageRules } from "@/lib/website/layout";
import {
  attributeOf, classesOf, DRAWN_TAGS, drawnAttributes, DROPPED_TAGS, elementsOf, parseHtml, readAttributes, safeDeclarations, styleObject, SVG_TAGS, svgAttributes, TRANSPARENT_TAGS, type HtmlElement, type HtmlNode,
} from "@/lib/website/markup";
import { savedTree } from "@/lib/website/rendered";
import { CANVAS_BODY, CANVAS_CONTAINER, canvasStylesheet, siteId, type CanvasChainLink, type CanvasLook } from "@/lib/website/site-css";
import { frameMayLoad, SiteFrame, type FrameEnv } from "./website-frame";

/**
 * The page on the canvas (Min webbsida, 2026-11-09; drawn as the site draws it since 2026-11-12: "det jag ser i editorn
 * är det som är live"). Each block is drawn from its own saved html – the same elements, classes and inline styles WordPress
 * shows, plus the layout classes WordPress adds when it draws the page (lib/website/layout.ts) – inside the elements the
 * page has around its content, and the site's own css is applied to the canvas only (lib/website/site-css.ts: scoped, no
 * requests, width queries as container queries). Nothing of the site's html enters the app's page as html: the tree is
 * turned into React elements from a fixed list of tags and attributes (lib/website/markup.ts), never innerHTML, no scripts,
 * no links that leave, no ids. Texts are edited in place like the landing page; pictures are shown through the app's own
 * server. An html block (the calculators) and a plugin's block are drawn in a sandboxed frame after the click on Visa
 * förhandsvisning (website-frame.tsx); before it, an html block shows its html without its scripts. A shortcode or a dynamic
 * block (a query loop) is shown as WordPress drew it on the published page (lib/website/rendered.ts), clearly marked.
 */
export type CanvasApi = {
  editing: boolean;
  selected: string | null;
  select: (id: string) => void;
  setText: (id: string, html: string) => void;
  /** The frames' site and look; null: no frames (boxes instead). */
  frame: FrameEnv | null;
  /** A dynamic block as WordPress draws it (null: it cannot be drawn here). */
  render: (block: BlockNode) => Promise<string | null>;
  /** A group Workflow writes itself (an extension's automatic block): its name, or null. */
  autoLabel?: (block: BlockNode) => string | null;
  /** The connected site's origin: a picture elsewhere is not fetched, it gets a placeholder (2026-11-10). */
  siteOrigin?: string | null;
  /** Kopiera till mediabiblioteket for a picture on another site; the block being copied, or null. */
  copyImage?: (blockId: string) => void;
  copying?: string | null;
  /** The site's copied fonts (@font-face with data: addresses, lib/website/look-server.ts). */
  fontCss?: string | null;
  /** The site's typography (site-look.ts), used only while the site's own css (look) is missing. */
  lookCss?: string | null;
  /** The site's css for the canvas and the elements around the content (null: not read; a plain block look is used). */
  look?: CanvasLook | null;
  /** How WordPress drew the page's shortcodes and dynamic blocks, by each block's markup. */
  rendered?: Record<string, string>;
};

/** Whether a picture's address is on another site than the connected one (the same rule as the server's: host and scheme). */
export function isExternalImage(url: string, siteOrigin: string | null | undefined) {
  if (!url || !siteOrigin || !/^https?:\/\//i.test(url)) return false;
  try { const own = new URL(siteOrigin); const at = new URL(url); return at.host !== own.host || at.protocol !== own.protocol; } catch { return false; }
}

export const imageAddress = (url: string) => /^https?:\/\//i.test(url) ? `/api/website/media?url=${encodeURIComponent(url)}` : "";

/** The blocks' names in Swedish, for the panel and the locked boxes. */
export const BLOCK_NAMES: Record<string, string> = {
  paragraph: "Text", heading: "Rubrik", list: "Lista", "list-item": "Listpunkt", image: "Bild", buttons: "Knappar", button: "Knapp", cover: "Omslag",
  columns: "Kolumner", column: "Kolumn", group: "Grupp", separator: "Avdelare", "media-text": "Media och text", spacer: "Mellanrum", html: "HTML-kod", shortcode: "Kortkod",
};
export const blockName = (block: BlockNode) => BLOCK_NAMES[typeOf(block)] ?? block.name;

// ---------- attributes ----------

const classOf = (element: HtmlElement, extra: readonly string[] = []) => {
  const own = classesOf(element).filter((name) => /^[A-Za-z_-][\w-]{0,120}$/.test(name));
  const list = [...own, ...extra.filter((name) => !own.includes(name))];
  return list.length ? list.join(" ") : undefined;
};
const styleOf = (element: HtmlElement): CSSProperties | undefined => {
  const raw = attributeOf(element, "style");
  if (!raw) return undefined;
  const declarations = safeDeclarations(raw);
  return declarations.length ? styleObject(declarations) as CSSProperties : undefined;
};
/** Everything an element of the site's html is drawn with (class, style, the plain attributes and its id as data-site-id). */
function propsOf(element: HtmlElement, extraClasses: readonly string[] = []): Record<string, unknown> {
  return { ...drawnAttributes(element), className: classOf(element, extraClasses), style: styleOf(element), "data-site-id": siteId(attributeOf(element, "id")) };
}

// ---------- inline text ----------

const SAFE_TAGS: Record<string, string> = { strong: "strong", b: "b", em: "em", i: "i", a: "a", mark: "mark", code: "code", sub: "sub", sup: "sup", s: "s", u: "u", small: "small", span: "span", kbd: "kbd", del: "del", ins: "ins", abbr: "abbr", cite: "cite", q: "q", time: "time" };

function numberNodes(nodes: readonly InlineNode[], table: InlineNode[] = []) {
  for (const node of nodes) { if (node.t !== "text") { table.push(node); if (node.t === "el") numberNodes(node.children, table); } }
  return table;
}

/** An inline element's class and style from its own tag (a coloured <mark>, a span with a class), checked like the rest. */
function inlineProps(open: string) {
  const element: HtmlElement = { t: "el", tag: "span", attrs: readAttributes(open.replace(/^<[a-zA-Z0-9-]+|\/?>$/g, "")), children: [], start: 0, end: 0 };
  return { className: classOf(element), style: styleOf(element) };
}

function renderInline(nodes: readonly InlineNode[], table: InlineNode[] | null): ReactNode[] {
  return nodes.map((node, index) => {
    if (node.t === "text") return node.text;
    const k = table ? table.indexOf(node) : undefined;
    if (node.t === "raw") {
      if (node.tag === "br") return <br key={index} data-k={k} />;
      // A comment, a stray closing tag or an inline picture: kept as it is, shown (in the editor) as a small mark.
      if (!table) return null;
      return <span key={index} data-k={k} data-site-ui="" contentEditable={false} className={node.tag === "!--" || node.raw.startsWith("</") ? "hidden" : "mx-0.5 rounded bg-slate-200 px-1 text-[10px] text-slate-600"}>{node.tag === "img" ? "bild" : ""}</span>;
    }
    return createElement(SAFE_TAGS[node.tag] ?? "span", { key: index, "data-k": k, ...inlineProps(node.open) }, ...renderInline(node.children, table));
  });
}

/** The edited DOM back as inline nodes: known tags keep their raw text, new bold or italics become strong and em, the rest text. */
function readNodes(parent: Node, table: InlineNode[]): InlineNode[] {
  const out: InlineNode[] = [];
  parent.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) { out.push({ t: "text", text: (child.textContent ?? "").replace(/ /g, " ") }); return; }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const element = child as HTMLElement;
    const known = element.dataset.k !== undefined ? table[Number(element.dataset.k)] : undefined;
    if (known?.t === "raw") { out.push(known); return; }
    if (known?.t === "el") { out.push({ ...known, children: readNodes(element, table) }); return; }
    const tag = element.tagName.toLowerCase();
    if (tag === "br") out.push({ t: "raw", tag: "br", raw: "<br>" });
    else if (tag === "b" || tag === "strong") out.push({ t: "el", tag: "strong", open: "<strong>", close: "</strong>", children: readNodes(element, table) });
    else if (tag === "i" || tag === "em") out.push({ t: "el", tag: "em", open: "<em>", close: "</em>", children: readNodes(element, table) });
    else if (tag === "div" || tag === "p") { if (out.length) out.push({ t: "raw", tag: "br", raw: "<br>" }); out.push(...readNodes(element, table)); }
    else out.push(...readNodes(element, table));
  });
  return out;
}

/**
 * A text that is plain on the preview and edited in place on the canvas, drawn as the site's own element (its tag, classes and
 * style). Enter: a line break in a paragraph, done elsewhere.
 */
function InlineText({ html, as, props, label, api, blockId, lineBreaks }: { html: string; as: string; props: Record<string, unknown>; label: string; api: CanvasApi; blockId: string; lineBreaks: boolean }) {
  const nodes = useMemo(() => parseInline(html), [html]);
  const table = useMemo(() => numberNodes(nodes), [nodes]);
  const [reset, setReset] = useState(0);
  if (!api.editing) return createElement(as, props, ...renderInline(nodes, null));
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") { event.preventDefault(); event.currentTarget.dataset.cancel = "1"; event.currentTarget.blur(); return; }
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (lineBreaks || event.shiftKey) document.execCommand("insertLineBreak");
    else event.currentTarget.blur();
  };
  return createElement(as, {
    ...props,
    key: `${html}\u0000${reset}`, role: "textbox", "aria-label": label, "aria-multiline": lineBreaks || undefined, tabIndex: 0, contentEditable: true, suppressContentEditableWarning: true, spellCheck: true,
    "data-site-text": blockId, className: cn("landing-editable", props.className as string | undefined),
    onKeyDown,
    // Only text comes in from the clipboard, never someone else's markup.
    onPaste: (event: React.ClipboardEvent<HTMLElement>) => { event.preventDefault(); document.execCommand("insertText", false, event.clipboardData.getData("text/plain")); },
    onBlur: (event: React.FocusEvent<HTMLElement>) => {
      const element = event.currentTarget;
      if (element.dataset.cancel) { delete element.dataset.cancel; setReset((value) => value + 1); return; }
      const read = readNodes(element, table);
      // The browser leaves a <br> in an emptied field and at the end of a line it broke.
      const endsWithBreak = (list: readonly InlineNode[]) => { const last = list[list.length - 1]; return last?.t === "raw" && last.tag === "br"; };
      if (endsWithBreak(read) && !endsWithBreak(nodes)) read.pop();
      api.setText(blockId, serializeInline(read));
    },
  }, ...renderInline(nodes, table));
}

// ---------- the editor's own marks on the canvas (data-site-ui: the site's css reset leaves them alone) ----------

function Box({ icon: Icon, title, text, testId }: { icon: typeof Lock; title: string; text: string; testId?: string }) {
  return <div className="flex items-start gap-3 rounded-lg border border-dashed border-slate-400 bg-slate-50 p-4 text-left font-sans text-sm text-slate-700" data-site-ui="" data-testid={testId}>
    <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
    <span><span className="block font-semibold">{title}</span><span className="text-xs">{text}</span></span>
  </div>;
}

/** A picture of the site: through the app's own server; one on another site, or none, as a placeholder in its place. */
function Picture({ element, api, blockId }: { element: HtmlElement; api: CanvasApi; blockId?: string }) {
  const url = attributeOf(element, "src") ?? "";
  const alt = attributeOf(element, "alt") ?? "";
  if (isExternalImage(url, api.siteOrigin)) {
    let host = "";
    try { host = new URL(url).hostname; } catch { host = ""; }
    const absolute = classesOf(element).some((name) => name.includes("background")) || /position:\s*absolute/.test(attributeOf(element, "style") ?? "");
    return <div className={cn("relative z-[1] flex min-h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-amber-500 bg-amber-50 p-4 text-center font-sans text-sm text-slate-700", absolute ? "absolute inset-0" : "")} data-site-ui="" data-testid="site-external-image">
      <ImageOff className="size-5" aria-hidden="true" />
      <span className="font-semibold">Bilden ligger på en annan webbplats</span>
      <span className="text-xs">{host}{alt ? ` · ${alt}` : ""}</span>
      {api.editing && api.copyImage && blockId ? <button type="button" className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
        disabled={Boolean(api.copying)} onClick={(event) => { event.stopPropagation(); api.copyImage?.(blockId); }} data-testid="site-copy-image"><ImageDown className="size-3.5" aria-hidden="true" />{api.copying === blockId ? "Kopierar…" : "Kopiera till mediabiblioteket"}</button> : null}
    </div>;
  }
  const src = imageAddress(url);
  if (!src) return <div className="flex min-h-32 items-center justify-center rounded-lg border border-dashed border-slate-400 bg-slate-50 font-sans text-sm text-slate-600" data-site-ui=""><ImagePlus className="mr-2 size-4" aria-hidden="true" />Ingen bild vald</div>;
  // eslint-disable-next-line @next/next/no-img-element -- a picture on the site, through the app's own server, not a page asset.
  return <img {...propsOf(element)} src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" />;
}

/** A framed or previewed block: in the editor a short line names it above. */
function Framed({ icon: Icon, label, api, children, testId, note }: { icon: typeof Lock; label: string; api: CanvasApi; children: ReactNode; testId: string; note?: string }) {
  return <div data-testid={testId}>
    {api.editing ? <p className="mb-1 flex flex-wrap items-center gap-1.5 font-sans text-[11px] font-semibold uppercase tracking-wide text-slate-500" data-site-ui=""><Icon className="size-3.5" aria-hidden="true" />{label}{note ? <span className="font-normal normal-case tracking-normal" data-testid="site-preview-note">· {note}</span> : null}</p> : null}
    {children}
  </div>;
}

// ---------- the site's html as React elements ----------

type Draw = {
  api: CanvasApi;
  /** The child blocks in the slots. */
  children: readonly BlockNode[];
  /** Extra classes per element, by its place in document order (WordPress's layout classes). */
  extra: Map<number, string[]>;
  /** The text element: its place, the text and how it is edited. */
  text?: { ordinal: number; html: string; label: string; lineBreaks: boolean; button: boolean };
  /** The block itself (the picture placeholder's Kopiera button). */
  blockId?: string;
  /** Elements met so far (document order). */
  counter: { value: number };
  /** The block's root: marked for selection. */
  root?: { ordinal: number; props: Record<string, unknown> };
};

const TABLE_PARTS = new Set(["table", "thead", "tbody", "tfoot", "tr", "colgroup", "select", "optgroup"]);
const VOID_TAGS = new Set(["br", "hr", "wbr", "col", "input"]);

function drawNodes(nodes: readonly HtmlNode[], draw: Draw, parentTag: string): ReactNode[] {
  const out: ReactNode[] = [];
  nodes.forEach((node, index) => {
    if (node.t === "comment") return;
    if (node.t === "text") { if (!(TABLE_PARTS.has(parentTag) && !node.text.trim())) out.push(node.text); return; }
    if (node.t === "slot") { const child = draw.children[node.index]; if (child) out.push(<BlockView key={child.id} block={child} api={draw.api} />); return; }
    out.push(drawElement(node, draw, index));
  });
  return out;
}

/** A small inline picture (svg) from its fixed list of shapes and attributes (markup.ts), outside the count of drawn elements. */
function drawSvg(element: HtmlElement, key: number): ReactNode {
  if (!SVG_TAGS.has(element.tag)) return null;
  return createElement(element.tag, { key, ...svgAttributes(element), className: classOf(element), style: styleOf(element) },
    ...elementsOf(element.children).map((child, index) => drawSvg(child, index)));
}

function drawElement(element: HtmlElement, draw: Draw, key: number): ReactNode {
  const tag = element.tag;
  if (tag === "svg") return drawSvg(element, key);
  if (DROPPED_TAGS.has(tag)) return null;
  const ordinal = draw.counter.value++;
  if (TRANSPARENT_TAGS.has(tag)) return <Fragment key={key}>{drawNodes(element.children, draw, tag)}</Fragment>;
  const props: Record<string, unknown> = { key, ...propsOf(element, draw.extra.get(ordinal) ?? []) };
  if (draw.root?.ordinal === ordinal) Object.assign(props, draw.root.props);
  if (tag === "img") return <Picture key={key} element={element} api={draw.api} blockId={draw.blockId} />;
  if (draw.text?.ordinal === ordinal) {
    const { html, label, lineBreaks, button } = draw.text;
    const { key: _key, ...rest } = props;
    void _key;
    return <InlineText key={key} html={html} as={DRAWN_TAGS.has(tag) ? tag : "span"} props={{ ...rest, ...(button ? { "data-site-button": "" } : {}) }} label={label} api={draw.api} blockId={draw.blockId ?? ""} lineBreaks={lineBreaks} />;
  }
  const drawnTag = DRAWN_TAGS.has(tag) ? tag : "div";
  if (["input", "select", "textarea", "button"].includes(drawnTag)) {
    // Shown, never used: no value is sent anywhere, nothing is focused (the preview around it is inert as well).
    const value = attributeOf(element, "value");
    delete props.value; delete props.checked; delete props.selected;
    Object.assign(props, { tabIndex: -1, ...(drawnTag === "button" ? { type: "button" } : {}) });
    if (drawnTag === "input") return createElement("input", { ...props, readOnly: true, defaultValue: value ?? undefined, defaultChecked: attributeOf(element, "checked") !== null || undefined });
    if (drawnTag === "textarea") return createElement("textarea", { ...props, readOnly: true, defaultValue: element.children.map((child) => (child.t === "text" ? child.text : "")).join("") });
    if (drawnTag === "select") {
      const chosen = elementsOf(element.children).flatMap((child) => (child.tag === "optgroup" ? elementsOf(child.children) : [child])).find((option) => attributeOf(option, "selected") !== null);
      return createElement("select", { ...props, defaultValue: chosen ? attributeOf(chosen, "value") ?? undefined : undefined }, ...drawNodes(element.children, draw, tag));
    }
  }
  if (drawnTag === "option") delete props.selected;
  if (VOID_TAGS.has(drawnTag)) return createElement(drawnTag, props);
  return createElement(drawnTag, props, ...drawNodes(element.children, draw, tag));
}

/** A whole piece of the site's html drawn statically (a shortcode as the page drew it, an html block without its scripts). */
function StaticHtml({ html, api }: { html: string; api: CanvasApi }) {
  const nodes = useMemo(() => parseHtml(html), [html]);
  const draw: Draw = { api: { ...api, editing: false }, children: [], extra: new Map(), counter: { value: 0 } };
  return <div inert data-site-static="">{drawNodes(nodes, draw, "div")}</div>;
}

/**
 * The site's own html around the page's content (its header, the page title, its footer), drawn like a shortcode's drawing but
 * without a wrapper (the theme's css is written for `.wp-site-blocks > header` and the like): each element is inert, so nothing
 * in it is clicked, focused or edited. It is never saved: the page's markup is only its content.
 */
function SiteChrome({ html, api }: { html: string; api: CanvasApi }) {
  const nodes = useMemo(() => parseHtml(html), [html]);
  const draw: Draw = { api: { ...api, editing: false }, children: [], extra: new Map(), counter: { value: 0 } };
  return <>{drawNodes(nodes, draw, "div").map((node) => isValidElement(node) && typeof node.type === "string"
    ? cloneElement(node as ReactElement<Record<string, unknown>>, { inert: true, "data-site-chrome": "" }) : node)}</>;
}

// ---------- blocks ----------

const TEXT_ELEMENT: Record<string, { label: (block: BlockNode) => string; lineBreaks: boolean; button?: boolean }> = {
  paragraph: { label: () => "Text", lineBreaks: true },
  heading: { label: (block) => `Rubrik nivå ${typeof block.attrs.level === "number" ? block.attrs.level : 2}`, lineBreaks: false },
  "list-item": { label: () => "Listpunkt", lineBreaks: false },
  button: { label: () => "Knapptext", lineBreaks: false, button: true },
};

/** How many drawn elements the html opens (the layout target is the last one before the first inner block). */
function elementsCount(nodes: readonly HtmlNode[]): number {
  let count = 0;
  for (const node of nodes) if (node.t === "el" && !DROPPED_TAGS.has(node.tag)) count += 1 + elementsCount(node.children);
  return count;
}
/** The element's place in document order among the drawn elements (the same order drawElement counts in). */
function ordinalOf(nodes: readonly HtmlNode[], test: (element: HtmlElement) => boolean, counter = { value: 0 }): number | null {
  for (const node of nodes) {
    if (node.t !== "el" || DROPPED_TAGS.has(node.tag)) continue;
    const at = counter.value++;
    if (test(node)) return at;
    const inner = ordinalOf(node.children, test, counter);
    if (inner !== null) return inner;
  }
  return null;
}

function blockRootProps(block: BlockNode, api: CanvasApi): Record<string, unknown> {
  const selected = api.editing && api.selected === block.id;
  return {
    "data-site-block": block.id, "data-site-type": typeOf(block), "data-site-selected": selected ? "" : undefined,
    onClick: api.editing ? (event: React.MouseEvent) => { event.stopPropagation(); api.select(block.id); } : undefined,
  };
}

/** WordPress's layout classes for the block (the rules are written once for the page, in WebsiteCanvas). */
function useLayoutClasses(block: BlockNode, rootPadding: boolean) {
  return useMemo(() => [...blockLayout(block, CANVAS_BODY, { rootPadding }).classes, ...elementColours(block, CANVAS_BODY).classes], [block, rootPadding]);
}

/** An editable block drawn from its saved html (with WordPress's layout classes added and its text editable in place). */
function SiteBlock({ block, api }: { block: BlockNode; api: CanvasApi }) {
  const layoutClasses = useLayoutClasses(block, Boolean(api.look?.rootPadding));
  const { nodes, children } = useMemo(() => savedTree(block), [block]);
  const type = typeOf(block);
  const tops = elementsOf(nodes).filter((element) => !DROPPED_TAGS.has(element.tag));
  if (!tops.length) return <div {...blockRootProps(block, api)}><Box icon={Lock} title={blockName(block)} text="Blocket har ingen html att visa. Det sparas som det är." /></div>;
  const extra = new Map<number, string[]>();
  const add = (at: number, names: readonly string[]) => extra.set(at, [...(extra.get(at) ?? []), ...names]);
  const rootOrdinal = ordinalOf(nodes, () => true) ?? 0;
  if (layoutClasses.length) add(block.inner.length > 1 && typeof block.inner[0] === "string" ? Math.max(0, elementsCount(parseHtml(block.inner[0])) - 1) : rootOrdinal, layoutClasses);
  if (type === "paragraph" && api.look?.paragraphClass) add(rootOrdinal, ["wp-block-paragraph"]);
  const auto = type === "group" ? api.autoLabel?.(block) ?? null : null;
  const draw: Draw = {
    api: auto ? { ...api, editing: false } : api, children, extra, counter: { value: 0 }, blockId: block.id,
    root: { ordinal: rootOrdinal, props: { ...blockRootProps(block, api), "data-site-auto": auto ? "" : undefined } },
  };
  const shape = TEXT_ELEMENT[type];
  const text = shape ? blockText(block) : null;
  if (shape && text !== null) {
    const ordinal = type === "button" ? ordinalOf(nodes, (element) => element.tag === "a") : rootOrdinal;
    if (ordinal !== null) draw.text = { ordinal, html: text, label: shape.label(block), lineBreaks: shape.lineBreaks, button: Boolean(shape.button) };
  }
  const drawn = drawNodes(nodes, draw, "div");
  if (!auto || !api.editing) return <>{drawn}</>;
  return <>
    <p className="flex items-center gap-1.5 font-sans text-xs font-semibold text-emerald-700" data-site-ui=""><RefreshCw className="size-3.5" aria-hidden="true" />Uppdateras automatiskt: {auto}</p>
    {drawn}
  </>;
}

function HtmlBlock({ block, api }: { block: BlockNode; api: CanvasApi }) {
  const props = blockRootProps(block, api);
  if (!api.frame) return <div {...props}><Box icon={Code2} title="HTML-kod" text={api.editing ? "Markera blocket och ändra koden i panelen." : "Visas på webbplatsen."} testId="site-html-block" /></div>;
  // Before Visa förhandsvisning: the html as it is, without its scripts, and the button that runs them in the frame.
  const live = frameMayLoad(api.frame);
  return <div {...props}>
    <Framed icon={Code2} label="HTML-kod" api={api} testId="site-html-block" note={live ? undefined : "utan skript tills du trycker Visa förhandsvisning"}>
      {live ? <SiteFrame html={htmlCode(block)} env={api.frame} title="HTML-kod" onPress={() => api.select(block.id)} testId="site-html-frame" />
        : <div style={{ position: "relative" }}>
          <StaticHtml html={htmlCode(block)} api={api} />
          <div className="absolute right-2 top-2" data-site-ui=""><SiteFrame html={htmlCode(block)} env={api.frame} title="HTML-kod" onPress={() => api.select(block.id)} testId="site-html-frame" gate="button" /></div>
        </div>}
    </Framed>
  </div>;
}

/** WordPress's own blocks that only hold saved html (a quote, a table, details …): drawn like the editable ones, not edited. */
const isCoreStatic = (block: BlockNode) => previewKind(block) === "static" && (!block.name.includes("/") || block.name.startsWith("core/"));

/** A plugin's block or another one Workflow does not edit: as the published page drew it, its saved html, or WordPress's own drawing. */
function LockedBlock({ block, api }: { block: BlockNode; api: CanvasApi }) {
  const kind = previewKind(block);
  const markup = useMemo(() => serializeBlock(block), [block]);
  const drawnOnPage = api.rendered?.[markup] ?? null;
  const key = `${block.name}\u0000${JSON.stringify(block.attrs)}`;
  const [rendered, setRendered] = useState<{ key: string; html: string | null } | null>(null);
  const { render } = api;
  const framed = Boolean(api.frame);
  // The block's name and attributes decide what WordPress draws (key); a new block object with the same ones is the same.
  const latest = useRef(block);
  useEffect(() => { latest.current = block; });
  useEffect(() => {
    if (kind !== "server" || !framed || drawnOnPage) return;
    let live = true;
    void render(latest.current).then((html) => { if (live) setRendered({ key, html }); });
    return () => { live = false; };
  }, [kind, key, render, framed, drawnOnPage]);
  const label = kind === "shortcode" ? "Kortkod" : `Tillägg: ${block.name}`;
  const props = blockRootProps(block, api);
  if (drawnOnPage) return <div {...props}><Framed icon={Puzzle} label={label} api={api} testId="site-locked-block" note="som på den publicerade sidan, ändras i WordPress"><StaticHtml html={drawnOnPage} api={api} /></Framed></div>;
  if (isCoreStatic(block)) return <div {...props}><Framed icon={Lock} label={blockName(block)} api={api} testId="site-locked-block" note="ändras i WordPress"><StaticHtml html={staticPreviewHtml(block)} api={api} /></Framed></div>;
  if (kind === "shortcode") return <div {...props}><Box icon={Puzzle} title="Kortkod" text={`${block.inner.filter((part): part is string => typeof part === "string").join("").trim().slice(0, 120)} – visas på webbplatsen.`} testId="site-locked-block" /></div>;
  if (!api.frame) return <div {...props}><Box icon={Lock} title={block.name} text="Ändras i WordPress. Sparas som det är." testId="site-locked-block" /></div>;
  if (kind === "static") return <div {...props}><Framed icon={Puzzle} label={label} api={api} testId="site-locked-block"><SiteFrame html={staticPreviewHtml(block)} env={api.frame} title={label} onPress={() => api.select(block.id)} testId="site-locked-frame" /></Framed></div>;
  const current = rendered?.key === key ? rendered : null;
  if (!current) return <div {...props}><Box icon={Puzzle} title={block.name} text="Hämtar blocket från WordPress…" testId="site-locked-block" /></div>;
  if (current.html === null || !current.html.trim()) return <div {...props}><Box icon={Puzzle} title={block.name} text="WordPress ritar blocket när sidan visas. Det sparas som det är." testId="site-locked-block" /></div>;
  return <div {...props}><Framed icon={Puzzle} label={label} api={api} testId="site-locked-block"><SiteFrame html={current.html} env={api.frame} title={label} onPress={() => api.select(block.id)} testId="site-locked-frame" /></Framed></div>;
}

function BlockView({ block, api }: { block: BlockNode; api: CanvasApi }) {
  if (isHtml(block)) return <HtmlBlock block={block} api={api} />;
  if (isLocked(block)) return <LockedBlock block={block} api={api} />;
  return <SiteBlock block={block} api={api} />;
}

// ---------- the page ----------

/** The editor's own marks on the canvas, over the site's css (outside the layer): the selected block, the hover, empty texts. */
const CANVAS_UI_CSS = [
  "[data-site-frame][data-editing] [data-site-block]{cursor:pointer}",
  "[data-site-frame][data-editing] [data-site-block]:hover{outline:1px dashed color-mix(in srgb,var(--primary) 45%,transparent);outline-offset:3px}",
  "[data-site-frame] [data-site-block][data-site-selected]{outline:2px solid var(--primary);outline-offset:4px}",
  "[data-site-frame][data-editing] [data-site-text]:empty{min-height:1.5em}",
  "[data-site-frame][data-editing] [data-site-auto]{outline:1px dashed #10b981;outline-offset:4px}",
].join("\n");

const FALLBACK_CHAIN: CanvasChainLink[] = [{ tag: "div", className: "wf-site-fallback" }];
const FALLBACK_FRAME_CSS = `${CANVAS_BODY} .wf-site-fallback{max-width:48rem;margin:0 auto;padding:2rem 1.25rem;font-family:Arial,Helvetica,sans-serif;font-size:17px;line-height:1.6;color:#17202a}`;

/** The window's height (the site's vh on the canvas: a visitor on this screen has a window as tall), 0 before it is known. */
const onResize = (change: () => void) => { window.addEventListener("resize", change); return () => window.removeEventListener("resize", change); };
const useWindowHeight = () => useSyncExternalStore(onResize, () => window.innerHeight, () => 0);

/** The whole page. Text outside every block (old content) is shown as a locked box. */
export function WebsiteCanvas({ doc, api }: { doc: BlockDocument; api: CanvasApi }) {
  const loose = doc.parts.some((part) => typeof part === "string" && part.trim());
  const look = api.look ?? null;
  const rootPadding = Boolean(look?.rootPadding);
  const rules = useMemo(() => pageRules(doc, rootPadding), [doc, rootPadding]);
  const stylesheet = useMemo(() => canvasStylesheet(look?.css ?? null, `${look ? "" : FALLBACK_FRAME_CSS}\n${rules}`), [look, rules]);
  const blocks = childBlocks(doc.parts);
  const chain = look?.chain.length ? look.chain : FALLBACK_CHAIN;
  const windowHeight = useWindowHeight();
  const content = <>
    {loose ? <Box icon={Lock} title="Text utanför block" text="Sidan har text utan block. Den sparas som den är." /> : null}
    {blocks.length ? blocks.map((block) => <BlockView key={block.id} block={block} api={api} />)
      : <p className="font-sans text-sm text-slate-500" data-site-ui="">Sidan är tom. Lägg till ett block.</p>}
  </>;
  // The page around the content (the site's header, the page title, the footer) as the site draws it, not editable.
  const wrapped = chain.reduceRight<ReactNode>((inner, link, index) => createElement(link.tag, { key: index, className: link.className || undefined },
    link.before ? <SiteChrome key="before" html={link.before} api={api} /> : null, inner, link.after ? <SiteChrome key="after" html={link.after} api={api} /> : null), content);
  // The site's own look (2026-11-12): its css on this element only (the canvas's container: the page's width), never the app around it.
  // While the site's css is missing, its typography (site-look.ts) is used on top of a plain block look.
  return <div className="w-full min-w-0" style={{ containerType: "inline-size", containerName: CANVAS_CONTAINER, contain: "layout paint", isolation: "isolate", ...(windowHeight ? { "--wf-vh": `${windowHeight / 100}px` } : {}) } as CSSProperties} data-testid="site-page" data-site-frame="" data-editing={api.editing ? "" : undefined}>
    <style data-testid="site-look-css">{`${api.fontCss ?? ""}\n${stylesheet}\n${look ? "" : api.lookCss ?? ""}\n${CANVAS_UI_CSS}`}</style>
    <div data-site-canvas="" data-site-look="" className={look?.bodyClass || undefined}>{wrapped}</div>
  </div>;
}
