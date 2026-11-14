import assert from "node:assert/strict";
import test from "node:test";
import { defaultHeading, defaultSelection, draftFromSelection, pageImages, shareBlocks } from "../lib/meta/page-share";

// Dela även på Facebook och Instagram (2026-11-10): the page's blocks as a checklist, the changed ones ticked, and the draft
// made from what is ticked, in page order.
const heading = (text: string, level = 2) => `<!-- wp:heading${level === 2 ? "" : ` {"level":${level}}`} -->\n<h${level} class="wp-block-heading">${text}</h${level}>\n<!-- /wp:heading -->`;
const paragraph = (text: string) => `<!-- wp:paragraph -->\n<p>${text}</p>\n<!-- /wp:paragraph -->`;
const list = (items: string[]) => `<!-- wp:list -->\n<ul class="wp-block-list">${items.map((item) => `<!-- wp:list-item -->\n<li>${item}</li>\n<!-- /wp:list-item -->`).join("\n")}</ul>\n<!-- /wp:list -->`;
const image = (url: string, alt: string) => `<!-- wp:image -->\n<figure class="wp-block-image"><img src="${url}" alt="${alt}"/></figure>\n<!-- /wp:image -->`;
const group = (inner: string) => `<!-- wp:group -->\n<div class="wp-block-group">${inner}</div>\n<!-- /wp:group -->`;

const base = [heading("Välkommen", 1), paragraph("Elinstallationer för hem och industri."), heading("Tjänster"), list(["El", "Larm"])].join("\n\n");
const next = [heading("Välkommen", 1), paragraph("Elinstallationer för hem och industri. Nu även solceller."), heading("Tjänster"), list(["El", "Larm", "Solceller"]),
  group([heading("Nyhet: laddboxar", 3), paragraph("Vi installerar laddboxar &amp; solceller."), image("https://example.se/wp-content/uploads/sol.jpg", "Solpaneler")].join("\n")),
  paragraph(" "), image("https://cdn.annan.se/bild.png", "")].join("\n\n");

test("the checklist: every content block in page order (inside groups too), the changed ones marked", () => {
  const blocks = shareBlocks(base, next);
  assert.deepEqual(blocks.map((block) => [block.type, block.changed]), [
    ["heading", false], ["paragraph", true], ["heading", false], ["list", true], ["heading", true], ["paragraph", true], ["image", true], ["image", true],
  ]);
  assert.equal(blocks[1].text, "Elinstallationer för hem och industri. Nu även solceller.");
  assert.deepEqual(blocks[3].items, ["El", "Larm", "Solceller"]);
  assert.equal(blocks[5].text, "Vi installerar laddboxar & solceller.", "plain text, entities read");
  assert.equal(blocks.find((block) => block.type === "heading" && block.level === 3)?.text, "Nyhet: laddboxar");
  // A block only moved is no change; an unchanged page has nothing ticked.
  assert.deepEqual(shareBlocks(base, base).filter((block) => block.changed), []);
  const moved = [heading("Tjänster"), list(["El", "Larm"]), heading("Välkommen", 1), paragraph("Elinstallationer för hem och industri.")].join("\n\n");
  assert.equal(shareBlocks(base, moved).some((block) => block.changed), false);
  assert.deepEqual(shareBlocks("", "inte block alls"), []);
});

test("ticked to begin with: the changed texts; the picture's heading: the first ticked heading", () => {
  const blocks = shareBlocks(base, next);
  const selected = defaultSelection(blocks);
  assert.deepEqual(selected.map((key) => blocks.find((block) => block.key === key)?.type), ["paragraph", "list", "heading", "paragraph"], "pictures are never ticked (they are a background)");
  assert.equal(blocks.find((block) => block.key === defaultHeading(blocks, selected))?.text, "Nyhet: laddboxar");
  assert.equal(blocks.find((block) => block.key === defaultHeading(blocks, []))?.text, "Välkommen", "else the page's first heading");
});

test("the draft from the ticked blocks, in page order: lists as • lines, within the limits", () => {
  const blocks = shareBlocks(base, next);
  const pick = (...texts: string[]) => blocks.filter((block) => texts.some((text) => block.text.startsWith(text))).map((block) => block.key);
  const heading3 = blocks.find((block) => block.text === "Nyhet: laddboxar")!.key;
  const draft = draftFromSelection(blocks, [...pick("Vi installerar"), ...pick("El\n"), ...pick("Nyhet")], heading3, "Startsida");
  assert.equal(draft.heading, "Nyhet: laddboxar");
  assert.equal(draft.caption, "• El\n• Larm\n• Solceller\n\nNyhet: laddboxar\n\nVi installerar laddboxar & solceller.", "page order, not the order ticked");
  assert.equal(draft.body, "Vi installerar laddboxar & solceller.");
  const empty = draftFromSelection(blocks, [], null, "Startsida &amp; mer");
  assert.deepEqual(empty, { heading: "Startsida & mer", body: "", caption: "Startsida & mer" });
  const long = shareBlocks("", paragraph("ord ".repeat(800)));
  const big = draftFromSelection(long, defaultSelection(long), null, "T");
  assert.ok(big.caption.length <= 2200 && big.body.length <= 220);
});

test("the page's pictures, each once, for the background", () => {
  const images = pageImages(shareBlocks(base, `${next}\n\n${image("https://cdn.annan.se/bild.png", "igen")}`));
  assert.deepEqual(images.map((item) => item.url), ["https://example.se/wp-content/uploads/sol.jpg", "https://cdn.annan.se/bild.png"]);
});
