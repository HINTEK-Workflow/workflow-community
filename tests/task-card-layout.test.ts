import assert from "node:assert/strict";
import test from "node:test";
import {
  FAVORITES,
  arrangeTaskCards,
  firstFreeSlot,
  moveCardToSlot,
  moveTaskCard,
  placeTaskCards,
  saveableTaskCardLayout,
  slotsOfPlacement,
} from "../lib/workflow/task-card-layout";
import { preferencesSchema } from "../lib/kfid/preferences";

const cards = ["type:A", "type:B", "form:1", "form:2"].map((key) => ({ key }));

test("the saved order comes first and new cards keep their default place at the end", () => {
  const arranged = arrangeTaskCards([...cards, { key: "form:new" }], { order: ["form:2", "type:A"], hidden: ["type:B"] });
  assert.deepEqual(arranged.all.map((card) => card.key), ["form:2", "type:A", "type:B", "form:1", "form:new"]);
  assert.deepEqual(arranged.visible.map((card) => card.key), ["form:2", "type:A", "form:1", "form:new"]);
  assert.deepEqual(arranged.hidden.map((card) => card.key), ["type:B"]);
  assert.deepEqual(arrangeTaskCards(cards).all.map((card) => card.key), cards.map((card) => card.key), "no layout keeps the default order");
});

test("moving a card and saving keeps cards that are not offered right now", () => {
  const keys = cards.map((card) => card.key);
  assert.deepEqual(moveTaskCard(keys, "form:2", 0), ["form:2", "type:A", "type:B", "form:1"]);
  assert.deepEqual(moveTaskCard(keys, "type:A", 99), ["type:B", "form:1", "form:2", "type:A"]);
  // Opened from a project, form:9 is not offered; its saved place, slot and hidden state survive.
  const saved = saveableTaskCardLayout(["type:B", "type:A"], new Set(["type:A"]), { order: ["form:9", "type:A", "type:B"], hidden: ["form:9"], slots: { "ELECTRICAL:3": "form:9", "ELECTRICAL:0": "form:8" } }, { "ELECTRICAL:0": "type:B", "OTHER:0": "type:A" });
  assert.deepEqual(saved, { order: ["type:B", "type:A", "form:9"], hidden: ["type:A", "form:9"], slots: { "ELECTRICAL:0": "type:B", "OTHER:0": "type:A", "ELECTRICAL:3": "form:9" } });
});

// Free placement (Daniel 2026-09-29): 3 favourites, 6 places per category, a card anywhere, new cards in their own category.
const categoryCards = [
  { key: "form:kfid", category: "ELECTRICAL" },
  { key: "form:thermo", category: "ELECTRICAL" },
  { key: "form:safety", category: "SAFETY" },
  { key: "type:X", category: "OTHER" },
];
const categories = ["ELECTRICAL", "SAFETY", "OTHER"];
const ofCategory = (card: { category: string }) => card.category;
const keysOf = (placement: ReturnType<typeof placeTaskCards<(typeof categoryCards)[number]>>) =>
  Object.fromEntries(placement.map(({ section, slots }) => [section, slots.map((card) => card?.key ?? null)]));

test("without a layout every card takes the first free place of its own category; sections show 3 and 6 places", () => {
  const placed = keysOf(placeTaskCards(categoryCards, {}, ofCategory, categories));
  assert.deepEqual(placed[FAVORITES], [null, null, null]);
  assert.deepEqual(placed.ELECTRICAL, ["form:kfid", "form:thermo", null, null, null, null]);
  assert.deepEqual(placed.SAFETY, ["form:safety", null, null, null, null, null]);
  assert.deepEqual(placed.OTHER, ["type:X", null, null, null, null, null]);
});

test("a card can be placed in the favourites or in another category, and a new card fills a free place in its own", () => {
  const layout = { slots: { "FAVORITES:1": "form:safety", "OTHER:4": "form:kfid" } };
  const placed = keysOf(placeTaskCards([...categoryCards, { key: "form:new", category: "ELECTRICAL" }], layout, ofCategory, categories));
  assert.deepEqual(placed[FAVORITES], [null, "form:safety", null]);
  assert.deepEqual(placed.ELECTRICAL, ["form:thermo", "form:new", null, null, null, null]);
  assert.deepEqual(placed.SAFETY, [null, null, null, null, null, null]);
  assert.deepEqual(placed.OTHER, ["type:X", null, null, null, "form:kfid", null]);
});

test("unknown cards, sections and places are ignored, a full category grows instead of losing a card", () => {
  const layout = { slots: { "FAVORITES:5": "form:kfid", "NOPE:0": "form:thermo", "SAFETY:0": "form:gone", "OTHER:0": "form:safety", "OTHER:1": "form:safety" } };
  const placed = keysOf(placeTaskCards(categoryCards, layout, ofCategory, categories));
  assert.deepEqual(placed[FAVORITES], [null, null, null], "only three favourite places");
  assert.deepEqual(placed.ELECTRICAL.slice(0, 2), ["form:kfid", "form:thermo"]);
  assert.deepEqual(placed.OTHER.slice(0, 2), ["form:safety", "type:X"], "a card is placed only once");
  const many = Array.from({ length: 8 }, (_, index) => ({ key: `form:${index}`, category: "SAFETY" }));
  const grown = keysOf(placeTaskCards(many, {}, ofCategory, categories));
  assert.equal(grown.SAFETY.length, 8);
  assert.ok(grown.SAFETY.every(Boolean));
});

test("moving to a taken place swaps; Flytta till takes the first free place and a full section has none", () => {
  const slots = slotsOfPlacement(placeTaskCards(categoryCards, {}, ofCategory, categories));
  assert.deepEqual(slots, { "ELECTRICAL:0": "form:kfid", "ELECTRICAL:1": "form:thermo", "SAFETY:0": "form:safety", "OTHER:0": "type:X" });
  const swapped = moveCardToSlot(slots, "form:safety", "ELECTRICAL:0");
  assert.equal(swapped["ELECTRICAL:0"], "form:safety");
  assert.equal(swapped["SAFETY:0"], "form:kfid");
  const moved = moveCardToSlot(slots, "type:X", "FAVORITES:0");
  assert.equal(moved["FAVORITES:0"], "type:X");
  assert.equal(moved["OTHER:0"], undefined);
  assert.equal(firstFreeSlot(moved, FAVORITES), "FAVORITES:1");
  const full = { "FAVORITES:0": "a", "FAVORITES:1": "b", "FAVORITES:2": "c" };
  assert.equal(firstFreeSlot(full, FAVORITES), null);
  assert.equal(moveCardToSlot(slots, "form:unknown", "OTHER:1"), slots);
});

test("preferences without a layout parse to an empty layout, and older layouts without places still parse", () => {
  assert.deepEqual(preferencesSchema.parse({}).taskCardLayout, { order: [], hidden: [], slots: {} });
  assert.deepEqual(preferencesSchema.parse({ taskCardLayout: { order: ["type:A"], hidden: [] } }).taskCardLayout, { order: ["type:A"], hidden: [], slots: {} });
  assert.throws(() => preferencesSchema.parse({ taskCardLayout: { order: Array.from({ length: 201 }, (_, index) => `k${index}`), hidden: [] } }));
});
