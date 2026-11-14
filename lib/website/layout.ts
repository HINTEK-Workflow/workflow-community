/**
 * Blockens layout som WordPress ritar den (Min webbsida, 2026-11-12). A block's saved html lacks what WordPress adds when it
 * draws the page: the layout classes (`is-layout-constrained`, `wp-block-group-is-layout-flex`, `has-global-padding` …) and a
 * per-block rule for its own layout settings (content width, gap, justification), written as `wp-container-…` classes in the
 * page's css. The theme's and the block library's css is written for those, so the canvas adds the same classes and writes
 * the same rules for its own class per block (`wf-layout-<id>`), as WordPress's layout support does (wp-includes/block-supports/
 * layout.php): which element gets them, which classes, which rules. Every value is checked before it is written. Pure.
 */
import { classesOf, parseHtml, styleTexts, type HtmlElement } from "./markup";
import { CANVAS_BODY, scopeCss } from "./site-css";
import { allBlocks, htmlCode, isHtml, typeOf, type BlockDocument, type BlockNode } from "./blocks";

type Layout = { type?: unknown; contentSize?: unknown; wideSize?: unknown; justifyContent?: unknown; orientation?: unknown; flexWrap?: unknown; verticalAlignment?: unknown; inherit?: unknown;
  columnCount?: unknown; minimumColumnWidth?: unknown };

/** The blocks with layout support among those the canvas draws, and their default layout (block.json). */
const LAYOUT_DEFAULTS: Record<string, Layout> = {
  group: { type: "flow" }, columns: { type: "flex", flexWrap: "nowrap" }, column: { type: "flow" }, buttons: { type: "flex" }, cover: { type: "flow" }, "post-content": { type: "flow" },
  details: { type: "flow" }, gallery: { type: "flex" }, "social-links": { type: "flex" }, quote: { type: "flow" }, pullquote: { type: "flow" },
};

const LENGTH = /^(0|-?\d{1,5}(\.\d{1,4})?(px|em|rem|%|vw|vh|ch|cqi|svh|dvh)|var\(--[\w-]{1,80}\)|(clamp|calc|min|max)\([\w\s.,%()+*/-]{1,200}\))$/;

/** `var:preset|spacing|60` → `var(--wp--preset--spacing--60)`; a length as it is; anything else null. */
export function cssLength(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return `${value}px`;
  if (typeof value !== "string") return null;
  const preset = /^var:preset\|([a-z0-9-]+)\|([a-z0-9-]+)$/i.exec(value.trim());
  if (preset) return `var(--wp--preset--${preset[1]}--${preset[2]})`;
  const text = value.trim();
  return LENGTH.test(text) ? text.replace(/(\d|\.)(vw|vi)\b/g, "$1cqi") : null;
}

const style = (block: BlockNode) => (block.attrs.style && typeof block.attrs.style === "object" ? block.attrs.style as Record<string, Record<string, unknown> | undefined> : {});

/** The block's layout: its own attribute over the block's default (old `inherit: true` is the constrained layout). */
export function layoutOf(block: BlockNode): (Layout & { type: string }) | null {
  const type = typeOf(block);
  const fallback = LAYOUT_DEFAULTS[type];
  if (!fallback) return null;
  const own = block.attrs.layout && typeof block.attrs.layout === "object" ? block.attrs.layout as Layout : {};
  const merged = { ...fallback, ...own };
  const kind = own.inherit === true ? "constrained" : typeof merged.type === "string" && merged.type !== "default" ? merged.type : "flow";
  return { ...merged, type: /^(flow|constrained|flex|grid)$/.test(kind) ? kind : "flow" };
}

/** The element WordPress gives the layout classes: the last tag before the first inner block, or the first tag. */
export function layoutTarget(block: BlockNode, tops: readonly HtmlElement[], beforeChildren: readonly HtmlElement[]): HtmlElement | null {
  if (block.inner.length > 1 && typeof block.inner[0] === "string" && beforeChildren.length) return beforeChildren[beforeChildren.length - 1];
  return tops[0] ?? null;
}

const JUSTIFY: Record<string, string> = { left: "flex-start", right: "flex-end", center: "center", "space-between": "space-between", stretch: "stretch" };
const ALIGN: Record<string, string> = { top: "flex-start", center: "center", bottom: "flex-end", stretch: "stretch", "space-between": "space-between" };

export type BlockLayout = { classes: string[]; css: string };

/**
 * The classes to add and the rules to write for one block (selector `.wf-layout-<id>` inside the canvas). Empty when the
 * block has no layout support. `rootPadding`: the theme's root-padding-aware alignments (constrained → has-global-padding).
 */
export function blockLayout(block: BlockNode, scope: string, options: { rootPadding: boolean }): BlockLayout {
  const layout = layoutOf(block);
  if (!layout) return { classes: [], css: "" };
  const name = block.name.includes("/") ? block.name.replace(/^core\//, "").replace("/", "-") : block.name;
  const own = `wf-layout-${block.id.replace(/[^\w-]/g, "")}`;
  const at = `${scope} .${own}`;
  const classes = [`is-layout-${layout.type}`, `wp-block-${name}-is-layout-${layout.type}`];
  const rules: string[] = [];
  const spacing = style(block).spacing ?? {};
  const gapRaw = (spacing as { blockGap?: unknown }).blockGap;
  const gapTop = cssLength(typeof gapRaw === "object" && gapRaw ? (gapRaw as { top?: unknown }).top : gapRaw);
  const gapLeft = cssLength(typeof gapRaw === "object" && gapRaw ? (gapRaw as { left?: unknown }).left : gapRaw);
  if (layout.type === "flow" || layout.type === "constrained") {
    if (layout.type === "constrained") {
      if (options.rootPadding) classes.push("has-global-padding");
      const content = cssLength(layout.contentSize);
      const wide = cssLength(layout.wideSize);
      const all = content ?? wide;
      const wider = wide ?? content;
      if (all || wider) {
        rules.push(`${at} > :where(:not(.alignleft):not(.alignright):not(.alignfull)){max-width:${all};margin-left:auto !important;margin-right:auto !important}`,
          `${at} > .alignwide{max-width:${wider}}`, `${at} .alignfull{max-width:none}`);
      }
      const justify = typeof layout.justifyContent === "string" ? layout.justifyContent : "";
      if (justify === "left") rules.push(`${at} > :where(:not(.alignleft):not(.alignright):not(.alignfull)){margin-left:0 !important}`);
      if (justify === "right") rules.push(`${at} > :where(:not(.alignleft):not(.alignright):not(.alignfull)){margin-right:0 !important}`);
      const padding = (spacing as { padding?: Record<string, unknown> }).padding;
      const right = cssLength(padding?.right); const left = cssLength(padding?.left);
      if (options.rootPadding && (right || left)) rules.push(`${at} > .alignfull{${right ? `margin-right:calc(${right} * -1);` : ""}${left ? `margin-left:calc(${left} * -1)` : ""}}`);
    }
    if (gapTop) rules.push(`${at} > *{margin-block-start:0;margin-block-end:0}`, `${at} > * + *{margin-block-start:${gapTop};margin-block-end:0}`);
  } else if (layout.type === "flex") {
    const declarations: string[] = [];
    // The classes come from the block's own setting only, the rules from its setting over the block's default (as WordPress).
    const ownLayout = (block.attrs.layout && typeof block.attrs.layout === "object" ? block.attrs.layout : {}) as Layout;
    const vertical = layout.orientation === "vertical";
    if (layout.flexWrap === "nowrap") declarations.push("flex-wrap:nowrap");
    if (ownLayout.flexWrap === "nowrap") classes.push("is-nowrap");
    if (vertical) declarations.push("flex-direction:column");
    if (ownLayout.orientation === "vertical") classes.push("is-vertical");
    const justify = typeof layout.justifyContent === "string" ? layout.justifyContent : "";
    if (justify && JUSTIFY[justify]) {
      if (ownLayout.justifyContent === justify) classes.push(`is-content-justification-${justify}`);
      declarations.push(vertical ? `align-items:${JUSTIFY[justify] === "space-between" ? "flex-start" : JUSTIFY[justify]}` : `justify-content:${JUSTIFY[justify]}`);
    } else if (vertical) declarations.push("align-items:flex-start");
    const align = typeof layout.verticalAlignment === "string" ? ALIGN[layout.verticalAlignment] : undefined;
    if (align) declarations.push(vertical ? `justify-content:${align}` : `align-items:${align}`);
    if (gapRaw !== undefined && (gapTop || gapLeft)) declarations.push(`gap:${gapTop ?? "var(--wp--style--block-gap, 0.5em)"} ${gapLeft ?? "var(--wp--style--block-gap, 0.5em)"}`);
    if (declarations.length) rules.push(`${at}{${declarations.join(";")}}`);
  } else if (layout.type === "grid") {
    const count = typeof layout.columnCount === "number" && layout.columnCount > 0 && layout.columnCount < 20 ? Math.round(layout.columnCount) : null;
    const minimum = cssLength(layout.minimumColumnWidth);
    if (count) rules.push(`${at}{grid-template-columns:repeat(${count}, minmax(0, 1fr))}`);
    else rules.push(`${at}{grid-template-columns:repeat(auto-fill, minmax(min(${minimum ?? "12rem"}, 100%), 1fr));container-type:inline-size}`);
    if (gapTop || gapLeft) rules.push(`${at}{gap:${gapTop ?? "var(--wp--style--block-gap, 0.5em)"} ${gapLeft ?? "var(--wp--style--block-gap, 0.5em)"}}`);
  }
  if (rules.length) classes.push(own);
  return { classes, css: rules.join("\n") };
}

/** A block's link colour (style.elements.link.color.text): WordPress writes it as a `wp-elements-…` class and rule. */
export function elementColours(block: BlockNode, scope: string): BlockLayout {
  const link = (style(block).elements as { link?: { color?: { text?: unknown }; ":hover"?: { color?: { text?: unknown } } } } | undefined)?.link;
  const colour = (value: unknown) => {
    if (typeof value !== "string") return null;
    const preset = /^var:preset\|color\|([a-z0-9-]+)$/i.exec(value);
    if (preset) return `var(--wp--preset--color--${preset[1]})`;
    return /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla)\([\d.,\s%/]{1,60}\)|var\(--[\w-]{1,80}\))$/i.test(value) ? value : null;
  };
  const text = colour(link?.color?.text);
  const hover = colour(link?.[":hover"]?.color?.text);
  if (!text && !hover) return { classes: [], css: "" };
  const own = `wf-elements-${block.id.replace(/[^\w-]/g, "")}`;
  const at = `${scope} .${own}`;
  return {
    classes: [own],
    css: [text ? `${at} a:where(:not(.wp-element-button)){color:${text}}` : "", hover ? `${at} a:where(:not(.wp-element-button)):hover{color:${hover}}` : ""].filter(Boolean).join("\n"),
  };
}

/** Whether an element already says it has the class (the saved html sometimes has WordPress's classes already). */
export const hasClass = (element: HtmlElement, name: string) => classesOf(element).includes(name);

/** The page's own rules for the canvas: each block's layout and link colours, and the css in its html blocks (scoped like the site's). */
export function pageRules(doc: BlockDocument, rootPadding: boolean): string {
  const rules: string[] = [];
  const htmlCss: string[] = [];
  for (const block of allBlocks(doc.parts)) {
    if (isHtml(block)) { htmlCss.push(...styleTexts(parseHtml(htmlCode(block)))); continue; }
    const layout = blockLayout(block, CANVAS_BODY, { rootPadding });
    if (layout.css) rules.push(layout.css);
    const colours = elementColours(block, CANVAS_BODY);
    if (colours.css) rules.push(colours.css);
  }
  return [...rules, ...htmlCss.map((css) => scopeCss(css))].filter(Boolean).join("\n");
}
