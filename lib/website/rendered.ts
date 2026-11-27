/**
 * Kortkoder och dynamiska block som på webbplatsen (Min webbsida, 2026-11-12). A shortcode (the calculators' and the contact
 * card's `[wpcode id=…]`), a query loop (Nyheter) or a plugin's block is drawn by WordPress when the page is shown; its saved
 * markup says little about how it looks. WordPress's REST answer for the page has both the saved markup (`content.raw`) and
 * the page's content as WordPress draws it (`content.rendered`, the_content: blocks, shortcodes, layout classes). This module
 * finds each such block's part of the drawn content by walking both side by side: every other block draws the same number of
 * top-level elements as its saved html has (a paragraph one <p>, a group one <div> …), so the elements between them belong
 * to the dynamic block. Inside a container (the contact card's shortcode sits in a column of columns) the same is done one
 * level down. Where it cannot be told for certain (two dynamic blocks side by side, a tag that does not match) nothing is
 * taken: the editor then shows the block's box as before.
 *
 * The answer is keyed by the block's own markup, so an unchanged block finds its drawing in the editor; a changed one (or a
 * new one) does not. Pure: no network.
 */
import { childBlocks, isEditable, isHtml, isLocked, parseBlocks, serializeBlock, typeOf, type BlockNode, type Part } from "./blocks";
import { elementsOf, parseHtml, slotMark, type HtmlElement, type HtmlNode } from "./markup";

const MAX_PREVIEWS = 60;
const MAX_PREVIEW_BYTES = 400_000;

/** The block's saved html with its inner blocks as slots, read as a tree. */
export function savedTree(block: BlockNode): { nodes: HtmlNode[]; children: BlockNode[] } {
  const children: BlockNode[] = [];
  const html = block.inner.map((part) => {
    if (typeof part === "string") return part;
    children.push(part);
    return slotMark(children.length - 1);
  }).join("");
  return { nodes: parseHtml(html), children };
}

/** Whether WordPress draws the block itself (its saved html is not what is shown, or there is none). */
const isDynamic = (block: BlockNode) => typeOf(block) === "shortcode" || block.void;

/** How many top-level elements the block draws, when that is known from its saved html (null: drawn by WordPress). */
function elementCount(block: BlockNode): number | null {
  if (isDynamic(block)) return null;
  return elementsOf(savedTree(block).nodes).length;
}

type Item = { count: number | null; block: BlockNode | null; tag: string | null };

function itemsOfParts(parts: readonly Part[]): Item[] {
  const items: Item[] = [];
  for (const part of parts) {
    if (typeof part === "string") { const count = elementsOf(parseHtml(part)).length; if (count) items.push({ count, block: null, tag: null }); continue; }
    const tree = isDynamic(part) ? null : savedTree(part);
    items.push({ count: tree ? elementsOf(tree.nodes).length : null, block: part, tag: tree ? elementsOf(tree.nodes)[0]?.tag ?? null : null });
  }
  return items;
}

/** The items of one element's children in the saved tree: its own elements, and its slots (inner blocks). */
function itemsOfNodes(nodes: readonly HtmlNode[], children: readonly BlockNode[]): Item[] {
  const items: Item[] = [];
  for (const node of nodes) {
    if (node.t === "el") items.push({ count: 1, block: null, tag: node.tag });
    else if (node.t === "slot") {
      const block = children[node.index];
      if (!block) continue;
      const count = elementCount(block);
      items.push({ count, block, tag: count ? elementsOf(savedTree(block).nodes)[0]?.tag ?? null : null });
    }
  }
  return items;
}

/** The path (element indices) from the top of a tree to the element that holds the slots, or null when they are spread out. */
function slotParent(nodes: readonly HtmlNode[], trail: number[] = []): number[] | null {
  if (nodes.some((node) => node.t === "slot")) return trail;
  const elements = elementsOf(nodes);
  for (let index = 0; index < elements.length; index += 1) {
    const found = slotParent(elements[index].children, [...trail, index]);
    if (found) return found;
  }
  return null;
}

type Out = Map<string, string>;

/** Records a locked block's drawing (its outer html in the rendered content). */
function record(out: Out, block: BlockNode, html: string) {
  const text = html.trim();
  // Only a comment ("already on the page", "not found"): nothing to show.
  if (!text.replace(/<!--[\s\S]*?-->/g, "").trim() || text.length > MAX_PREVIEW_BYTES || out.size >= MAX_PREVIEWS) return;
  const key = serializeBlock(block);
  if (!out.has(key)) out.set(key, text);
}

/** Lines up a list of items (saved) with a list of drawn elements; `range` is where the drawn list sits in the source. */
function align(items: readonly Item[], drawn: readonly HtmlElement[], source: string, range: { start: number; end: number }, out: Out) {
  // Before the first and after the last block of unknown size the elements are counted; between them only one unknown fits.
  const unknown = items.map((item, index) => (item.count === null ? index : -1)).filter((index) => index >= 0);
  const known = items.reduce((sum, item) => sum + (item.count ?? 0), 0);
  if (known > drawn.length) return;
  if (unknown.length === 0 && known !== drawn.length) return;
  if (unknown.length > 1) {
    // Only the known blocks before the first and after the last unknown one can be placed.
    const head = items.slice(0, unknown[0]);
    const tail = items.slice(unknown[unknown.length - 1] + 1);
    walk(head, drawn, 0, source, out);
    const tailCount = tail.reduce((sum, item) => sum + (item.count ?? 0), 0);
    walk(tail, drawn, drawn.length - tailCount, source, out);
    return;
  }
  if (unknown.length === 1) {
    const at = unknown[0];
    const before = items.slice(0, at).reduce((sum, item) => sum + (item.count ?? 0), 0);
    const after = items.slice(at + 1).reduce((sum, item) => sum + (item.count ?? 0), 0);
    const span = drawn.length - before - after;
    if (span < 0) return;
    if (!walk(items.slice(0, at), drawn, 0, source, out) || !walk(items.slice(at + 1), drawn, before + span, source, out)) return;
    const block = items[at].block!;
    const from = before > 0 ? drawn[before - 1].end : range.start;
    const to = before + span < drawn.length ? drawn[before + span].start : range.end;
    if (isLocked(block) && !isHtml(block)) record(out, block, source.slice(from, to));
    return;
  }
  walk(items, drawn, 0, source, out);
}

/** Walks known items from `start`; false when a tag does not match (then nothing more is taken at this level). */
function walk(items: readonly Item[], drawn: readonly HtmlElement[], start: number, source: string, out: Out): boolean {
  let cursor = start;
  for (const item of items) {
    const count = item.count ?? 0;
    const own = drawn.slice(cursor, cursor + count);
    if (own.length !== count) return false;
    if (item.tag && own[0] && own[0].tag !== item.tag) return false;
    if (item.block && count) {
      if (isLocked(item.block) && !isHtml(item.block)) record(out, item.block, source.slice(own[0].start, own[own.length - 1].end));
      else if (isEditable(item.block) && childBlocks(item.block.inner).length && count === 1) inside(item.block, own[0], source, out);
    }
    cursor += count;
  }
  return true;
}

/** One level down: the container's inner blocks against the drawn element's children. */
function inside(block: BlockNode, drawn: HtmlElement, source: string, out: Out) {
  const tree = savedTree(block);
  const top = elementsOf(tree.nodes)[0];
  if (!top) return;
  const path = slotParent(top.children);
  if (!path) return;
  let saved: HtmlElement = top;
  let element: HtmlElement = drawn;
  for (const index of path) {
    const nextSaved = elementsOf(saved.children)[index];
    const nextDrawn = elementsOf(element.children)[index];
    if (!nextSaved || !nextDrawn || nextSaved.tag !== nextDrawn.tag) return;
    saved = nextSaved; element = nextDrawn;
  }
  const childStart = element.children.length ? Math.min(...element.children.map((node) => ("start" in node ? node.start : Number.POSITIVE_INFINITY))) : element.end;
  const lastChild = [...element.children].reverse().find((node) => "end" in node) as { end: number } | undefined;
  align(itemsOfNodes(saved.children, tree.children), elementsOf(element.children), source, { start: Number.isFinite(childStart) ? childStart : element.end, end: lastChild?.end ?? element.end }, out);
}

/**
 * The drawings of the page's locked blocks (shortcodes, query loops, plugins' blocks), keyed by each block's markup.
 * `raw` is the page's saved markup and `rendered` WordPress's drawing of it (both from the same REST answer).
 */
export function renderedPreviews(raw: string, rendered: string): Record<string, string> {
  const out: Out = new Map();
  let parts: Part[];
  try { parts = parseBlocks(raw).parts; } catch { return {}; }
  if (!childBlocks(parts).some((block) => isLocked(block) || hasLocked(block))) return {};
  const drawn = parseHtml(rendered);
  align(itemsOfParts(parts), elementsOf(drawn), rendered, { start: 0, end: rendered.length }, out);
  return Object.fromEntries(out);
}

function hasLocked(block: BlockNode): boolean {
  return childBlocks(block.inner).some((child) => (isLocked(child) && !isHtml(child)) || hasLocked(child));
}
