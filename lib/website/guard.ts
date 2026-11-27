import { allBlocks, blockImage, BlockParseError, childBlocks, isHtml, isLocked, parseBlocks, serializeBlock, typeOf, type BlockNode } from "./blocks";

/**
 * Vad Workflow får skriva till företagets webbplats (Min webbsida; 2026-11-09, HTML-block 2026-11-10), checked on the server before every draft and
 * every publish:
 *
 * - the markup reads as blocks (a page that does not is never written);
 * - locked blocks (a plugin's block, a shortcode, …): moved, removed or their code changed (Avancerat), never added – of each
 *   name the page has at most as many as WordPress has now; new plugin blocks are added in WordPress;
 * - html only in an html block: a new one may be added (Lägg till → HTML, the company admin on the company's own site), and an
 *   html block holds code only, never blocks inside it;
 * - an edited text block brings no scripts, frames, event attributes or javascript: addresses that the page did not have –
 *   code goes in an html block, never through a text;
 * - (Publicera) no new picture without a file.
 *
 * Pure. The answer is a short Swedish reason, or null.
 */
export const MAX_PAGE_BYTES = 1_500_000;
// Inside a tag only: a text that says "javascript:" or "onsdag = …" is just text.
const DANGEROUS = /<\s*(script|iframe|object|embed|style|form|input|textarea|select|button|base|meta|link|svg|math)\b|<[^>]*\son[a-z]+\s*=|<[^>]*=\s*["']?\s*(javascript|vbscript|data)\s*:/i;

/** A block's own html (its strings, without its inner blocks). */
const ownHtml = (block: BlockNode) => block.opener + block.inner.filter((part): part is string => typeof part === "string").join("") + block.closer;

const count = (items: string[]) => items.reduce((map, item) => map.set(item, (map.get(item) ?? 0) + 1), new Map<string, number>());

/** The locked blocks that are not inside another locked block (a block inside a locked one is part of it). */
function outerLocked(blocks: BlockNode[]) {
  const inside = new Set<BlockNode>();
  const outer: BlockNode[] = [];
  for (const block of blocks) {
    if (inside.has(block)) continue;
    if (isLocked(block)) { outer.push(block); for (const child of allBlocks(block.inner)) inside.add(child); }
  }
  return outer;
}
/** The html blocks that are not inside a locked block (those are part of it). */
const outerHtml = (blocks: BlockNode[]) => {
  const inLocked = new Set(outerLocked(blocks).flatMap((block) => [...allBlocks(block.inner)]));
  return blocks.filter((block) => isHtml(block) && !inLocked.has(block));
};

function read(markup: string, where: "base" | "next"): BlockNode[] | string {
  try { return [...allBlocks(parseBlocks(markup).parts)]; }
  catch (error) {
    const reason = error instanceof BlockParseError ? `: ${error.message}` : ".";
    return where === "base" ? `Sidan i WordPress går inte att läsa som block${reason}` : `Sidan går inte att läsa${reason}`;
  }
}

export function editProblem(base: string, next: string, options: { publishing?: boolean } = {}): string | null {
  if (Buffer.byteLength(next, "utf8") > MAX_PAGE_BYTES) return "Sidan är för stor (högst 1,5 MB).";
  const before = read(base, "base");
  if (typeof before === "string") return before;
  const after = read(next, "next");
  if (typeof after === "string") return after;

  // Locked blocks: never more of a name than the page has now.
  const names = (blocks: BlockNode[]) => count(outerLocked(blocks).map((block) => block.name));
  const known = names(before);
  for (const [name, times] of names(after)) {
    if ((known.get(name) ?? 0) < times) return `Ett nytt block av typen ${name} kan bara läggas till i WordPress.`;
  }
  // Html blocks: code only.
  if (outerHtml(after).some((block) => childBlocks(block.inner).length > 0)) return "Ett HTML-block får inte innehålla andra block.";

  // Text blocks: nothing executable that the page did not already have.
  const lockedOrInside = (blocks: BlockNode[]) => new Set(outerLocked(blocks).flatMap((block) => [block, ...allBlocks(block.inner)]));
  const skipBefore = lockedOrInside(before);
  const skipAfter = lockedOrInside(after);
  const old = new Set(before.filter((block) => !skipBefore.has(block) && !isHtml(block)).map(ownHtml));
  for (const block of after) {
    if (skipAfter.has(block) || isHtml(block)) continue;
    const html = ownHtml(block);
    if (!old.has(html) && DANGEROUS.test(html)) return "En text innehåller kod som inte är tillåten (skript, ramar eller händelser). Lägg kod i ett HTML-block.";
    if (options.publishing && !old.has(html) && typeOf(block) === "image" && !blockImage(block)?.url) return "En bild saknar fil. Välj en bild eller ta bort blocket.";
  }
  return null;
}

/**
 * What changed in the page's code (for the audit, which never holds the code): html blocks added, changed or removed, and
 * locked blocks whose code was changed by hand. Counted from the blocks' markup, so a block that is only moved is no change.
 */
export function codeChanges(base: string, next: string): { htmlAdded: number; htmlChanged: number; htmlRemoved: number; lockedChanged: number } {
  const before = read(base, "base");
  const after = read(next, "next");
  const none = { htmlAdded: 0, htmlChanged: 0, htmlRemoved: 0, lockedChanged: 0 };
  if (typeof before === "string" || typeof after === "string") return none;
  const unmatched = (from: BlockNode[], to: BlockNode[]) => {
    const left = count(to.map(serializeBlock));
    let missing = 0;
    for (const source of from.map(serializeBlock)) { const times = left.get(source) ?? 0; if (times) left.set(source, times - 1); else missing += 1; }
    return missing;
  };
  const [htmlBefore, htmlAfter] = [outerHtml(before), outerHtml(after)];
  const newOrChanged = unmatched(htmlAfter, htmlBefore);
  const goneOrChanged = unmatched(htmlBefore, htmlAfter);
  const htmlAdded = Math.max(0, htmlAfter.length - htmlBefore.length);
  const htmlRemoved = Math.max(0, htmlBefore.length - htmlAfter.length);
  return {
    htmlAdded, htmlRemoved, htmlChanged: Math.max(0, Math.min(newOrChanged - htmlAdded, goneOrChanged - htmlRemoved)),
    lockedChanged: unmatched(outerLocked(after), outerLocked(before)),
  };
}

/** The audit's words for the changes; null when no code changed. */
export function codeChangeText(changes: ReturnType<typeof codeChanges>): string | null {
  const parts = [
    changes.htmlAdded ? `${changes.htmlAdded} nytt HTML-block` : null,
    changes.htmlChanged ? `kod ändrad i ${changes.htmlChanged} HTML-block` : null,
    changes.htmlRemoved ? `${changes.htmlRemoved} HTML-block borttaget` : null,
    changes.lockedChanged ? `kod ändrad i ${changes.lockedChanged} tilläggsblock` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}
