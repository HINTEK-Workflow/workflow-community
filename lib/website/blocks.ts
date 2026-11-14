/**
 * Webbplatsens sidor som block (Min webbsida; 2026-11-09): WordPress keeps a page as Gutenberg block markup (`<!-- wp:paragraph -->…`). This
 * module reads that markup into a tree and writes it back losslessly: every piece of text between the block comments is kept as
 * it was, so a block nobody touched is written back byte for byte, and an edited block changes only its own strings.
 *
 * Only the block types below are edited; every other block (plugins' blocks, shortcodes, …) is kept as it is and shown as
 * locked (moved or removed, its markup changed only as code). wp:html is edited as code and shown in a sandboxed frame
 * (frame.ts), never in the app's own page. Pure: no DOM, no network, no database.
 */

export type BlockNode = {
  kind: "block";
  /** Stable within one editing session, never written. */
  id: string;
  /** The name as written: "paragraph" (core), "core/paragraph" or "uagb/container". */
  name: string;
  attrs: Record<string, unknown>;
  /** The opening comment exactly as written (regenerated only when the attributes change). */
  opener: string;
  /** The closing comment exactly as written; "" for a void block (`<!-- wp:x /-->`). */
  closer: string;
  /** The block's own html strings and its inner blocks, in order. */
  inner: Part[];
  void: boolean;
};
export type Part = string | BlockNode;
export type BlockDocument = { parts: Part[] };

export class BlockParseError extends Error {
  constructor(message: string) { super(message); this.name = "BlockParseError"; }
}

/** The block types Workflow edits. Everything else is locked. */
export const EDITABLE_TYPES = ["paragraph", "heading", "list", "list-item", "image", "buttons", "button", "cover", "columns", "column", "group", "separator", "media-text", "spacer"] as const;
export type EditableType = (typeof EDITABLE_TYPES)[number];
/** The types a person can add as new blocks (list items, buttons and columns are added inside their parent; html as code). */
export const NEW_BLOCK_TYPES = ["paragraph", "heading", "list", "image", "buttons", "cover", "columns", "group", "separator", "media-text", "spacer", "html"] as const;
export type NewBlockType = (typeof NEW_BLOCK_TYPES)[number];

export const typeOf = (block: Pick<BlockNode, "name">) => block.name.startsWith("core/") ? block.name.slice(5) : block.name;
export const isEditable = (block: Pick<BlockNode, "name">) => (EDITABLE_TYPES as readonly string[]).includes(typeOf(block));
export const isHtml = (block: Pick<BlockNode, "name">) => typeOf(block) === "html";
/** A block Workflow does not edit as content (a plugin's block, a shortcode, …): it can be moved or removed, its code changed. */
export const isLocked = (block: Pick<BlockNode, "name">) => !isEditable(block) && !isHtml(block);

// The block comment as WordPress's own parser reads it: the attributes are JSON ending in "}" followed by space and an
// optional "/" before "-->".
const COMMENT = /<!--\s+(\/)?wp:([a-z][a-z0-9_-]*(?:\/[a-z][a-z0-9_-]*)?)\s+(?:(\{[\s\S]*?\})\s+)?(\/)?-->/g;

let counter = 0;
const nextId = () => `b${(++counter).toString(36)}`;

/** Reads a page's markup. Throws BlockParseError when the comments do not balance or an attribute is not JSON. */
export function parseBlocks(markup: string): BlockDocument {
  const root: { parts: Part[] } = { parts: [] };
  const stack: BlockNode[] = [];
  const target = () => (stack.length ? stack[stack.length - 1].inner : root.parts);
  const text = (value: string) => { if (value) target().push(value); };
  let at = 0;
  COMMENT.lastIndex = 0;
  for (let match = COMMENT.exec(markup); match; match = COMMENT.exec(markup)) {
    const [whole, closing, name, json, selfClosing] = match;
    text(markup.slice(at, match.index));
    at = match.index + whole.length;
    if (closing) {
      const open = stack.pop();
      if (!open || open.name !== name) throw new BlockParseError(`Blocket ${name} avslutas utan att ha börjat.`);
      open.closer = whole;
      continue;
    }
    let attrs: Record<string, unknown> = {};
    if (json) {
      try { const parsed = JSON.parse(json) as unknown; if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) attrs = parsed as Record<string, unknown>; else throw new Error(); }
      catch { throw new BlockParseError(`Blocket ${name} har inställningar som inte går att läsa.`); }
    }
    const block: BlockNode = { kind: "block", id: nextId(), name, attrs, opener: whole, closer: "", inner: [], void: Boolean(selfClosing) };
    target().push(block);
    if (!block.void) stack.push(block);
  }
  text(markup.slice(at));
  if (stack.length) throw new BlockParseError(`Blocket ${stack[stack.length - 1].name} avslutas aldrig.`);
  return { parts: root.parts };
}

export function serializeBlock(block: BlockNode): string {
  return block.opener + block.inner.map(serializePart).join("") + block.closer;
}
const serializePart = (part: Part) => typeof part === "string" ? part : serializeBlock(part);
export const serializeBlocks = (doc: BlockDocument) => doc.parts.map(serializePart).join("");

/** WordPress's own escaping of block attributes (serializeAttributes in @wordpress/blocks). */
export function serializeAttributes(attrs: Record<string, unknown>) {
  return JSON.stringify(attrs)
    .replace(/--/g, "\\u002d\\u002d")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\\"/g, "\\u0022");
}
const openerOf = (name: string, attrs: Record<string, unknown>, isVoid: boolean) =>
  `<!-- wp:${name} ${Object.keys(attrs).length ? `${serializeAttributes(attrs)} ` : ""}${isVoid ? "/" : ""}-->`;

/** The block with new attributes (and so a new opening comment); undefined values are dropped. */
export function withAttrs(block: BlockNode, change: Record<string, unknown>): BlockNode {
  const attrs = { ...block.attrs, ...change };
  for (const key of Object.keys(attrs)) if (attrs[key] === undefined) delete attrs[key];
  if (JSON.stringify(attrs) === JSON.stringify(block.attrs)) return block;
  return { ...block, attrs, opener: openerOf(block.name, attrs, block.void) };
}

// ---------- walking and changing the tree (immutable: a change copies the path to the block) ----------

export const childBlocks = (parts: readonly Part[]) => parts.filter((part): part is BlockNode => typeof part !== "string");

export function* allBlocks(parts: readonly Part[]): Generator<BlockNode> {
  for (const part of parts) if (typeof part !== "string") { yield part; yield* allBlocks(part.inner); }
}

export function findBlock(doc: BlockDocument, id: string): BlockNode | null {
  for (const block of allBlocks(doc.parts)) if (block.id === id) return block;
  return null;
}

/** The block's parent (null at the top of the page). */
export function parentOf(doc: BlockDocument, id: string): BlockNode | null {
  for (const block of allBlocks(doc.parts)) if (childBlocks(block.inner).some((child) => child.id === id)) return block;
  return null;
}

function mapParts(parts: readonly Part[], id: string, change: (block: BlockNode) => BlockNode): { parts: Part[]; done: boolean } {
  let done = false;
  const next = parts.map((part) => {
    if (done || typeof part === "string") return part;
    if (part.id === id) { done = true; return change(part); }
    const inner = mapParts(part.inner, id, change);
    if (!inner.done) return part;
    done = true;
    return { ...part, inner: inner.parts };
  });
  return { parts: next, done };
}

export function updateBlock(doc: BlockDocument, id: string, change: (block: BlockNode) => BlockNode): BlockDocument {
  const result = mapParts(doc.parts, id, change);
  return result.done ? { parts: result.parts } : doc;
}

const blank = (part: Part | undefined): part is string => typeof part === "string" && /^\s+$/.test(part);

/** Removes the block and one blank separator beside it (the one before, else the one after), so no empty lines pile up. */
export function removeBlock(doc: BlockDocument, id: string): BlockDocument {
  return changeSiblings(doc, id, (parts, index) => {
    parts.splice(index, 1);
    if (index > 0 && blank(parts[index - 1])) parts.splice(index - 1, 1);
    else if (blank(parts[index])) parts.splice(index, 1);
    return parts;
  });
}

/** Changes the parts holding the block (the page or its parent) with `change`, given the block's index among them. */
function changeSiblings(doc: BlockDocument, id: string, change: (parts: Part[], index: number) => Part[]): BlockDocument {
  const at = doc.parts.findIndex((part) => typeof part !== "string" && part.id === id);
  if (at >= 0) return { parts: change([...doc.parts], at) };
  const parent = parentOf(doc, id);
  if (!parent) return doc;
  return updateBlock(doc, parent.id, (block) => ({ ...block, inner: change([...block.inner], block.inner.findIndex((part) => typeof part !== "string" && part.id === id)) }));
}

/** Moves the block one step among its siblings; the text between the blocks stays where it is. */
export function moveBlock(doc: BlockDocument, id: string, delta: -1 | 1): BlockDocument {
  return changeSiblings(doc, id, (parts, index) => {
    let other = index + delta;
    while (other >= 0 && other < parts.length && typeof parts[other] === "string") other += delta;
    if (other < 0 || other >= parts.length) return parts;
    [parts[index], parts[other]] = [parts[other], parts[index]];
    return parts;
  });
}

/** Whether a block can move up (-1) or down (1). */
export function canMove(doc: BlockDocument, id: string, delta: -1 | 1) {
  const parent = parentOf(doc, id);
  const siblings = childBlocks(parent ? parent.inner : doc.parts);
  const index = siblings.findIndex((block) => block.id === id);
  return index >= 0 && index + delta >= 0 && index + delta < siblings.length;
}

/** Puts a block after another, with WordPress's blank line between them. */
export function insertAfter(doc: BlockDocument, afterId: string, block: BlockNode): BlockDocument {
  return changeSiblings(doc, afterId, (parts, index) => { parts.splice(index + 1, 0, "\n\n", block); return parts; });
}

/** Puts a block last on the page (before the page's trailing blank). */
export function append(doc: BlockDocument, block: BlockNode): BlockDocument {
  const parts = [...doc.parts];
  const last = parts.length - 1;
  const trailing = last >= 0 && typeof parts[last] === "string" && /^\s*$/.test(parts[last] as string) ? parts.pop() as string : "";
  if (childBlocks(parts).length) parts.push("\n\n");
  parts.push(block);
  if (trailing) parts.push(trailing);
  return { parts };
}

/** Puts a block last inside a container (a list's items, a row of buttons, columns, a group): before the wrapper's end. */
export function appendInside(doc: BlockDocument, containerId: string, block: BlockNode): BlockDocument {
  return updateBlock(doc, containerId, (container) => {
    const inner = [...container.inner];
    const lastChild = inner.map((part) => typeof part !== "string").lastIndexOf(true);
    if (lastChild >= 0) { inner.splice(lastChild + 1, 0, "\n\n", block); return { ...container, inner }; }
    // An empty container: the block goes just inside the wrapper's opening tag (…><block></…).
    const wrapper = splitWrapper(container);
    if (!wrapper) return container;
    return { ...container, inner: [wrapper.open, block, wrapper.close] };
  });
}

/** Which children a container takes; null: not a container. */
export function childTypesOf(block: BlockNode): readonly string[] | "any" | null {
  switch (typeOf(block)) {
    case "list": return ["list-item"];
    case "buttons": return ["button"];
    case "columns": return ["column"];
    case "column": case "group": case "cover": case "media-text": return "any";
    default: return null;
  }
}

/**
 * Where a new block of the type goes when `selectedId` is selected: after the selected block, or after the nearest ancestor
 * whose parent takes the type (a paragraph added while a list item is selected goes after the list). Null: last on the page.
 */
export function insertionPoint(doc: BlockDocument, selectedId: string | null, type: string): string | null {
  let current = selectedId ? findBlock(doc, selectedId) : null;
  while (current) {
    const parent = parentOf(doc, current.id);
    const takes = parent ? childTypesOf(parent) : "any";
    if (takes === "any" ? !["list-item", "button", "column"].includes(type) : takes?.includes(type)) return current.id;
    current = parent;
  }
  return null;
}

// ---------- the text of a block ----------

/** Where a text block's editable inline html sits: the opening tag before it and the closing tag after it. */
type TextSlot = { before: string; html: string; after: string };
const TEXT_SHAPES: Partial<Record<string, RegExp>> = {
  paragraph: /^(\s*<p\b[^>]*>)([\s\S]*?)(<\/p>\s*)$/,
  heading: /^(\s*<h([1-6])\b[^>]*>)([\s\S]*?)(<\/h\2>\s*)$/,
  "list-item": /^(\s*<li\b[^>]*>)([\s\S]*?)(<\/li>\s*)$/,
  button: /^([\s\S]*?<a\b[^>]*>)([\s\S]*?)(<\/a>[\s\S]*)$/,
};

function textSlot(block: BlockNode): TextSlot | null {
  const shape = TEXT_SHAPES[typeOf(block)];
  if (!shape || block.inner.length !== 1 || typeof block.inner[0] !== "string") return null;
  const match = shape.exec(block.inner[0]);
  if (!match) return null;
  if (typeOf(block) === "heading") return { before: match[1], html: match[3], after: match[4] };
  return { before: match[1], html: match[2], after: match[3] };
}

/** The block's editable inline html, or null when it has none (or is not a text block). */
export const blockText = (block: BlockNode) => textSlot(block)?.html ?? null;

/** The block with new inline html; the same block when nothing changed. */
export function setBlockText(block: BlockNode, html: string): BlockNode {
  const slot = textSlot(block);
  if (!slot || canonicalInline(slot.html) === canonicalInline(html)) return block;
  return { ...block, inner: [slot.before + html + slot.after] };
}

export const headingLevel = (block: BlockNode) => typeof block.attrs.level === "number" ? block.attrs.level : 2;

/** A heading's level: the tag and the attribute (2 is WordPress's default and is not written). */
export function setHeadingLevel(block: BlockNode, level: number): BlockNode {
  const slot = textSlot(block);
  if (!slot || level < 1 || level > 6 || level === headingLevel(block)) return block;
  const before = slot.before.replace(/<h[1-6]\b/, `<h${level}`);
  const after = slot.after.replace(/<\/h[1-6]>/, `</h${level}>`);
  return withAttrs({ ...block, inner: [before + slot.html + after] }, { level: level === 2 ? undefined : level });
}

// ---------- attributes inside the block's own html ----------

export const escapeAttribute = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const decodeAttribute = (value: string) => decodeEntities(value);

/** An attribute of an html tag (raw text of the tag), decoded; null when absent. */
export function tagAttribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return match ? decodeAttribute(match[2] ?? match[3] ?? match[4] ?? "") : null;
}

/** The tag with the attribute set (null removes it); other attributes stay as they were. */
export function setTagAttribute(tag: string, name: string, value: string | null): string {
  const pattern = new RegExp(`\\s${name}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, "i");
  if (value === null) return tag.replace(pattern, "");
  const written = ` ${name}="${escapeAttribute(value)}"`;
  if (pattern.test(tag)) return tag.replace(pattern, written);
  return tag.replace(/\s*(\/?)>$/, (_, slash: string) => `${written}${slash ? "/" : ""}>`);
}

/** The class list with WordPress's media class (wp-image-<id>) for the new picture. */
const withMediaClass = (classes: string | null, mediaId: number | null) => {
  const kept = (classes ?? "").split(/\s+/).filter((name) => name && !/^wp-image-\d+$/.test(name));
  if (mediaId) kept.push(`wp-image-${mediaId}`);
  return kept.join(" ");
};

const IMG = /<img\b[^>]*>/i;

/** The first picture in the block's own html: its address, text and media id. */
export function blockImage(block: BlockNode): { url: string; alt: string; id: number | null } | null {
  const type = typeOf(block);
  if (!["image", "cover", "media-text"].includes(type)) return null;
  const own = block.inner.find((part): part is string => typeof part === "string" && IMG.test(part));
  const tag = own ? IMG.exec(own)?.[0] ?? "" : "";
  const url = type === "cover" ? String(block.attrs.url ?? tagAttribute(tag, "src") ?? "") : type === "media-text" ? String(block.attrs.mediaUrl ?? tagAttribute(tag, "src") ?? "") : tagAttribute(tag, "src") ?? "";
  const idAttr = type === "media-text" ? block.attrs.mediaId : block.attrs.id;
  return { url, alt: tagAttribute(tag, "alt") ?? "", id: typeof idAttr === "number" ? idAttr : null };
}

/**
 * A new picture for an image, a cover's background or a media-text's media: the address and media id in the attributes and in
 * the `<img>` tag, the text (alt) when given. A cover or media-text without a picture gets its `<img>`.
 */
export function setBlockImage(block: BlockNode, image: { url?: string; id?: number | null; alt?: string }): BlockNode {
  const type = typeOf(block);
  if (!["image", "cover", "media-text"].includes(type)) return block;
  const rewrite = (tag: string) => {
    let next = tag;
    if (image.url !== undefined) next = setTagAttribute(next, "src", image.url);
    if (image.alt !== undefined) next = setTagAttribute(next, "alt", image.alt);
    if (image.id !== undefined) {
      const classes = withMediaClass(tagAttribute(next, "class"), image.id);
      next = setTagAttribute(next, "class", classes || null);
      // A new picture has its own sizes: srcset and sizes would point at the old one.
      next = setTagAttribute(setTagAttribute(next, "srcset", null), "sizes", null);
    }
    return next;
  };
  let found = false;
  let inner = block.inner.map((part) => {
    if (found || typeof part !== "string" || !IMG.test(part)) return part;
    found = true;
    return part.replace(IMG, rewrite);
  });
  if (!found && image.url) {
    const fresh = rewrite(type === "cover" ? `<img class="wp-block-cover__image-background" alt="" src="" data-object-fit="cover"/>` : `<img src="" alt=""/>`);
    const anchor = type === "cover" ? /(<div\b[^>]*\bwp-block-cover\b[^>]*>)/ : type === "media-text" ? /(<figure\b[^>]*wp-block-media-text__media[^>]*>)/ : /(<figure\b[^>]*>)/;
    inner = block.inner.map((part) => {
      if (found || typeof part !== "string" || !anchor.test(part)) return part;
      found = true;
      return part.replace(anchor, `$1${fresh}`);
    });
  }
  if (!found) return block;
  const changed = { ...block, inner };
  if (type === "image") return withAttrs(changed, image.id !== undefined ? { id: image.id ?? undefined } : {});
  if (type === "cover") return withAttrs(changed, { ...(image.url !== undefined ? { url: image.url } : {}), ...(image.id !== undefined ? { id: image.id ?? undefined } : {}) });
  return withAttrs(changed, { ...(image.url !== undefined ? { mediaUrl: image.url, mediaType: "image" } : {}), ...(image.id !== undefined ? { mediaId: image.id ?? undefined } : {}) });
}

/** A button's link. */
export function buttonLink(block: BlockNode) {
  const own = typeof block.inner[0] === "string" ? block.inner[0] : "";
  const tag = /<a\b[^>]*>/i.exec(own)?.[0];
  return tag ? tagAttribute(tag, "href") ?? "" : "";
}

/** Addresses a link may have: the web, mail, phone, a path on the site or an anchor. */
export const safeHref = (href: string) => /^(https?:\/\/[^\s"<>]+|mailto:[^\s"<>]+|tel:[+0-9 ()-]+|\/[^\s"<>]*|#[A-Za-z0-9_-]*)$/.test(href.trim());

export function setButtonLink(block: BlockNode, href: string): BlockNode {
  if (typeOf(block) !== "button" || typeof block.inner[0] !== "string" || !safeHref(href)) return block;
  const inner = block.inner[0].replace(/<a\b[^>]*>/i, (tag) => setTagAttribute(tag, "href", href.trim()));
  return inner === block.inner[0] ? block : { ...block, inner: [inner, ...block.inner.slice(1)] };
}

/** A spacer's height in pixels. */
export function spacerHeight(block: BlockNode) {
  const raw = block.attrs.height;
  const value = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? "100"), 10);
  return Number.isFinite(value) ? value : 100;
}

export function setSpacerHeight(block: BlockNode, px: number): BlockNode {
  if (typeOf(block) !== "spacer" || !Number.isFinite(px) || px < 1 || px > 2000) return block;
  const height = Math.round(px);
  const inner = block.inner.map((part) => typeof part === "string" ? part.replace(/height:\s*[0-9.]+(px|rem|em|vh)?/, `height:${height}px`) : part);
  return withAttrs({ ...block, inner }, { height: `${height}px` });
}

// ---------- wp:html: code only ----------

/** The html block's code as the person edits it (without WordPress's line break after the comment and before its end). */
export function htmlCode(block: BlockNode) {
  const raw = block.inner.map((part) => typeof part === "string" ? part : serializeBlock(part)).join("");
  return raw.replace(/^\n/, "").replace(/\n$/, "");
}

/** Why the code cannot be an html block's, or null: block comments inside it would change the page's structure. */
export const htmlCodeProblem = (code: string) => /<!--\s+\/?wp:/.test(code) ? "Koden får inte innehålla WordPress-blockkommentarer (<!-- wp:)." : null;

/** A new html block: a small example to write over. */
export const NEW_HTML_MARKUP = "<!-- wp:html -->\n<div class=\"site-html\">\n  <p>Ny HTML-kod</p>\n</div>\n<!-- /wp:html -->";

export function setHtmlCode(block: BlockNode, code: string): BlockNode {
  if (!isHtml(block) || code === htmlCode(block)) return block;
  // The code is written as text between the comments.
  if (htmlCodeProblem(code)) return block;
  return { ...block, inner: [`\n${code}\n`] };
}

/**
 * A locked block's markup written by hand (Avancerat): it must read as exactly one block of the same name, with nothing
 * outside it. The answer is the new block (a new id) or a short reason.
 */
export function blockFromMarkup(markup: string, name: string): { block: BlockNode } | { error: string } {
  let parts: Part[];
  try { parts = parseBlocks(markup.trim()).parts; } catch (error) { return { error: error instanceof BlockParseError ? error.message : "Koden går inte att läsa som block." }; }
  const blocks = childBlocks(parts);
  if (blocks.length !== 1 || parts.some((part) => typeof part === "string" && part.trim())) return { error: "Koden ska vara exakt ett block, utan något utanför det." };
  if (blocks[0].name !== name) return { error: `Blocket måste fortfarande vara ${name}.` };
  return { block: blocks[0] };
}

// ---------- the wrapper of a container (a group's <div …>…</div>) ----------

/** The container's opening and closing wrapper tags, when its html has that shape. */
export function splitWrapper(block: BlockNode): { open: string; close: string } | null {
  const first = block.inner[0];
  const last = block.inner[block.inner.length - 1];
  if (typeof first !== "string" || typeof last !== "string") return null;
  if (block.inner.length === 1) {
    const match = /^(\s*<(div|section|ul|ol)\b[^>]*>)([\s\S]*?)(<\/\2>\s*)$/.exec(first);
    return match && !match[3].trim() ? { open: match[1], close: match[4] } : null;
  }
  const open = /^\s*<(div|section|ul|ol|main|article|aside|header|footer)\b[^>]*>$/.exec(first);
  if (!open || !new RegExp(`^</${open[1]}>\\s*$`).test(last)) return null;
  return { open: first, close: last };
}

/** The group's class names (attribute className). */
export const classNames = (block: BlockNode) => String(block.attrs.className ?? "").split(/\s+/).filter(Boolean);

/** Adds or removes a class on the block: in the attributes and on the wrapper's opening tag. */
export function setBlockClass(block: BlockNode, name: string, on: boolean): BlockNode {
  const has = classNames(block).includes(name);
  if (has === on) return block;
  const wrapper = splitWrapper(block);
  if (!wrapper) return block;
  const list = on ? [...classNames(block), name] : classNames(block).filter((item) => item !== name);
  const tag = /<[a-z]+\b[^>]*>/.exec(wrapper.open)?.[0] ?? "";
  const tagClasses = (tagAttribute(tag, "class") ?? "").split(/\s+/).filter(Boolean);
  const nextClasses = on ? [...tagClasses, name] : tagClasses.filter((item) => item !== name);
  const open = wrapper.open.replace(tag, setTagAttribute(tag, "class", nextClasses.join(" ") || null));
  const inner = block.inner.length === 1 ? [open, wrapper.close] : [open, ...block.inner.slice(1, -1), wrapper.close];
  return withAttrs({ ...block, inner }, { className: list.length ? list.join(" ") : undefined });
}

// ---------- new blocks ----------

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const paragraphMarkup = (text: string) => `<!-- wp:paragraph -->\n<p>${esc(text)}</p>\n<!-- /wp:paragraph -->`;
const itemMarkup = (text: string) => `<!-- wp:list-item -->\n<li>${esc(text)}</li>\n<!-- /wp:list-item -->`;
const buttonMarkup = (text: string, href: string) => `<!-- wp:button -->\n<div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="${escapeAttribute(href)}">${esc(text)}</a></div>\n<!-- /wp:button -->`;
const columnMarkup = (text: string) => `<!-- wp:column -->\n<div class="wp-block-column">${paragraphMarkup(text)}</div>\n<!-- /wp:column -->`;

/** The markup WordPress writes for a new block of the type (one block). */
export function newBlockMarkup(type: NewBlockType | "list-item" | "button" | "column"): string {
  switch (type) {
    case "paragraph": return paragraphMarkup("Ny text");
    case "heading": return `<!-- wp:heading {"level":3} -->\n<h3 class="wp-block-heading">Ny rubrik</h3>\n<!-- /wp:heading -->`;
    case "list": return `<!-- wp:list -->\n<ul class="wp-block-list">${itemMarkup("Ny punkt")}</ul>\n<!-- /wp:list -->`;
    case "list-item": return itemMarkup("Ny punkt");
    case "image": return `<!-- wp:image {"sizeSlug":"full","linkDestination":"none"} -->\n<figure class="wp-block-image size-full"><img src="" alt=""/></figure>\n<!-- /wp:image -->`;
    case "buttons": return `<!-- wp:buttons -->\n<div class="wp-block-buttons">${buttonMarkup("Knapp", "/")}</div>\n<!-- /wp:buttons -->`;
    case "button": return buttonMarkup("Knapp", "/");
    case "cover": return `<!-- wp:cover {"dimRatio":50,"overlayColor":"black","isUserOverlayColor":true,"layout":{"type":"constrained"}} -->\n<div class="wp-block-cover"><span aria-hidden="true" class="wp-block-cover__background has-black-background-color has-background-dim"></span><div class="wp-block-cover__inner-container"><!-- wp:paragraph {"align":"center","fontSize":"large"} -->\n<p class="has-text-align-center has-large-font-size">Ny rubrik</p>\n<!-- /wp:paragraph --></div></div>\n<!-- /wp:cover -->`;
    case "columns": return `<!-- wp:columns -->\n<div class="wp-block-columns">${columnMarkup("Text i vänster kolumn")}\n\n${columnMarkup("Text i höger kolumn")}</div>\n<!-- /wp:columns -->`;
    case "column": return columnMarkup("Ny kolumn");
    case "group": return `<!-- wp:group {"layout":{"type":"constrained"}} -->\n<div class="wp-block-group">${paragraphMarkup("Ny text")}</div>\n<!-- /wp:group -->`;
    case "separator": return `<!-- wp:separator -->\n<hr class="wp-block-separator has-alpha-channel-opacity"/>\n<!-- /wp:separator -->`;
    case "media-text": return `<!-- wp:media-text {"mediaType":"image"} -->\n<div class="wp-block-media-text is-stacked-on-mobile"><figure class="wp-block-media-text__media"></figure><div class="wp-block-media-text__content">${paragraphMarkup("Ny text")}</div></div>\n<!-- /wp:media-text -->`;
    case "spacer": return `<!-- wp:spacer {"height":"40px"} -->\n<div style="height:40px" aria-hidden="true" class="wp-block-spacer"></div>\n<!-- /wp:spacer -->`;
    case "html": return NEW_HTML_MARKUP;
  }
}

/** A new block of the type, with fresh ids. */
export function newBlock(type: Parameters<typeof newBlockMarkup>[0]): BlockNode {
  return childBlocks(parseBlocks(newBlockMarkup(type)).parts)[0];
}

/** Parses markup that holds exactly the given blocks (as written by the generators). */
export const blocksOf = (markup: string) => parseBlocks(markup).parts;

// ---------- inline html (the text of a paragraph, heading, list item or button) ----------

export type InlineNode =
  | { t: "text"; text: string }
  | { t: "el"; tag: string; open: string; close: string; children: InlineNode[] }
  | { t: "raw"; tag: string; raw: string };

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", shy: "­", copy: "©", reg: "®", trade: "™", deg: "°", times: "×", minus: "−", middot: "·", bull: "•", euro: "€" };

export function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}
const encodeText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/ /g, "&nbsp;");

const VOID = new Set(["br", "img", "wbr", "hr", "input"]);
const TAG = /<!--[\s\S]*?-->|<(\/)?([a-zA-Z][a-zA-Z0-9-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*?(\/)?>/g;

/** Reads inline html into text and elements; every tag keeps its raw text, so nothing about it is lost. */
export function parseInline(html: string): InlineNode[] {
  const root: InlineNode[] = [];
  const stack: { tag: string; node: Extract<InlineNode, { t: "el" }> }[] = [];
  const target = () => stack.length ? stack[stack.length - 1].node.children : root;
  let at = 0;
  TAG.lastIndex = 0;
  for (let match = TAG.exec(html); match; match = TAG.exec(html)) {
    if (match.index > at) target().push({ t: "text", text: decodeEntities(html.slice(at, match.index)) });
    at = match.index + match[0].length;
    const [whole, closing, rawName, selfClosing] = match;
    if (!rawName) { target().push({ t: "raw", tag: "!--", raw: whole }); continue; }
    const tag = rawName.toLowerCase();
    if (closing) {
      const index = stack.map((entry) => entry.tag).lastIndexOf(tag);
      if (index < 0) { target().push({ t: "raw", tag, raw: whole }); continue; }
      while (stack.length > index + 1) {
        // An element never closed: it ends where its parent does (its children stay with it).
        const open = stack.pop()!;
        open.node.close = "";
      }
      stack.pop()!.node.close = whole;
      continue;
    }
    if (VOID.has(tag) || selfClosing) { target().push({ t: "raw", tag, raw: whole }); continue; }
    const node: Extract<InlineNode, { t: "el" }> = { t: "el", tag, open: whole, close: "", children: [] };
    target().push(node);
    stack.push({ tag, node });
  }
  if (at < html.length) target().push({ t: "text", text: decodeEntities(html.slice(at)) });
  return root;
}

export function serializeInline(nodes: readonly InlineNode[]): string {
  return nodes.map((node) => node.t === "text" ? encodeText(node.text) : node.t === "raw" ? node.raw : node.open + serializeInline(node.children) + node.close).join("");
}

/** The same inline html in one written form, to tell a real change from a different spelling of the same text. */
export const canonicalInline = (html: string) => serializeInline(parseInline(html));

/** The plain text of inline html (for names and summaries). */
export function inlineText(nodes: readonly InlineNode[]): string {
  return nodes.map((node) => node.t === "text" ? node.text : node.t === "raw" ? (node.tag === "br" ? " " : "") : inlineText(node.children)).join("");
}
export const plainText = (html: string) => inlineText(parseInline(html)).replace(/\s+/g, " ").trim();

/** Text the person typed, as inline html (no tags). */
export const textToInline = (text: string) => encodeText(text);
