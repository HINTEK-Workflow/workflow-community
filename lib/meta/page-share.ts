import { allBlocks, blockImage, blockText, childBlocks, headingLevel, parseBlocks, serializeBlock, typeOf, type BlockNode } from "@/lib/website/blocks";
import { BODY_MAX, CAPTION_MAX, HEADING_MAX, plainText, shorten, type PostText } from "./text";

/**
 * Dela även på Facebook och Instagram (2026-11-10): before a page of Min webbsida is published, its blocks are offered as
 * a checklist. The blocks changed since the version on the site (block by block) are ticked; the admin ticks and unticks, picks
 * the heading for the picture and – if wanted – one of the page's pictures as its background. The draft (heading, short text,
 * the post's text) is made from the ticked blocks in page order: plain text, a list as "• " lines, within the limits. A draft
 * only – nothing is ever published from here. Pure.
 */
export type ShareBlock = {
  key: string;
  type: "heading" | "paragraph" | "list" | "image";
  /** Plain text (a list's items joined by new lines; an image's alt text). */
  text: string;
  /** A list's items. */
  items?: string[];
  level?: number;
  image?: { url: string; alt: string };
  changed: boolean;
};

const CONTENT = new Set(["heading", "paragraph", "list", "image", "cover", "media-text"]);

/** A block as one checklist row, or null when it says nothing (an empty paragraph, a spacer, a plugin's block). */
function rowOf(block: BlockNode): Omit<ShareBlock, "key" | "changed"> | null {
  const type = typeOf(block);
  if (type === "heading" || type === "paragraph") {
    const html = blockText(block);
    const text = html === null ? "" : plainText(html);
    return text ? { type, text, ...(type === "heading" ? { level: headingLevel(block) } : {}) } : null;
  }
  if (type === "list") {
    const items = [...allBlocks(block.inner)].filter((child) => typeOf(child) === "list-item").map((child) => plainText(blockText(child) ?? "")).filter(Boolean);
    return items.length ? { type: "list", text: items.join("\n"), items } : null;
  }
  if (type === "image" || type === "cover" || type === "media-text") {
    const image = blockImage(block);
    return image?.url && /^https?:\/\//i.test(image.url) ? { type: "image", text: image.alt, image: { url: image.url, alt: image.alt } } : null;
  }
  return null;
}

/** The content blocks of a page in order (inside groups and columns too; a cover's or media-text's own text follows its picture). */
function contentBlocks(markup: string): BlockNode[] {
  let parts;
  try { parts = parseBlocks(markup).parts; } catch { return []; }
  const out: BlockNode[] = [];
  const walk = (blocks: BlockNode[]) => {
    for (const block of blocks) {
      const type = typeOf(block);
      if (CONTENT.has(type)) out.push(block);
      if (type === "list") continue;
      walk(childBlocks(block.inner));
    }
  };
  walk(childBlocks(parts));
  return out;
}

/**
 * The checklist: every content block of the new page, `changed` when its markup is not among the site's version (each block
 * of the site's version matches once, so a block that is only moved is no change).
 */
export function shareBlocks(baseMarkup: string, nextMarkup: string): ShareBlock[] {
  const before = new Map<string, number>();
  for (const block of contentBlocks(baseMarkup)) { const key = serializeBlock(block); before.set(key, (before.get(key) ?? 0) + 1); }
  return contentBlocks(nextMarkup).flatMap((block, index) => {
    const row = rowOf(block);
    if (!row) return [];
    const markup = serializeBlock(block);
    const left = before.get(markup) ?? 0;
    if (left) before.set(markup, left - 1);
    return [{ key: `b${index}`, ...row, changed: left === 0 }];
  });
}

/** What is ticked to begin with: the changed blocks with text (pictures are offered as a background instead). */
export const defaultSelection = (blocks: readonly ShareBlock[]) => blocks.filter((block) => block.changed && block.type !== "image").map((block) => block.key);
/** The heading for the picture to begin with: the first ticked heading, else the first heading of the page. */
export function defaultHeading(blocks: readonly ShareBlock[], selected: readonly string[]): string | null {
  const headings = blocks.filter((block) => block.type === "heading");
  return (headings.find((block) => selected.includes(block.key)) ?? headings[0])?.key ?? null;
}

/** The draft from the ticked blocks, in page order; the page's title when no heading is chosen. */
export function draftFromSelection(blocks: readonly ShareBlock[], selected: readonly string[], headingKey: string | null, fallbackTitle: string): Omit<PostText, "link"> {
  const chosen = blocks.filter((block) => selected.includes(block.key) && block.type !== "image");
  const heading = shorten(blocks.find((block) => block.key === headingKey)?.text || plainText(fallbackTitle) || "Nytt på webbplatsen", HEADING_MAX);
  const firstText = chosen.find((block) => block.type === "paragraph")?.text ?? chosen.find((block) => block.type === "list")?.items?.[0] ?? "";
  const parts = chosen.map((block) => (block.type === "list" ? (block.items ?? []).map((item) => `• ${item}`).join("\n") : block.text));
  const caption = shorten((parts.length ? parts : [heading]).join("\n\n"), CAPTION_MAX);
  return { heading, body: shorten(firstText, BODY_MAX), caption };
}

/** The page's pictures that may become the background (in page order, each address once). */
export function pageImages(blocks: readonly ShareBlock[]) {
  const seen = new Set<string>();
  return blocks.flatMap((block) => (block.image && !seen.has(block.image.url) ? (seen.add(block.image.url), [block.image]) : []));
}
