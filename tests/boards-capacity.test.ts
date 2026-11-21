import assert from "node:assert/strict";
import test from "node:test";
import { boardReadability, cardPixels, cardTextPx, DEFAULT_TV_INCHES, figurePx, READING_DISTANCE_M, readablePx, screenCapacity, screenPixels, SCREEN_SIZES, TV_INCHES, tvInches } from "../lib/boards/capacity";
import { DISTANCE, DISTANCES, type BoardCard, type BoardLayout } from "../lib/boards/model";

// Hur mycket ryms läsbart (2026-11-20). The table the editor's warning and Förhandsgranska read from: for each screen and
// distance, the smallest readable text (CSS px, about 1/300 of the reading distance), how many cards of the smallest readable size
// fit on a lying board of 14 rows, that size in cells, and the text it gets. A tv has the distance's own size unless one is chosen:
// Nära 55", Mellan 65", Långt 86".
const TABLE = {
  ipad: { near: [8.7, 40, "3×2", 11], medium: [77.9, 0, null, 0], far: [138.5, 0, null, 0] },
  laptop: { near: [10, 40, "3×2", 11], medium: [64.3, 0, null, 0], far: [114.3, 0, null, 0] },
  tv1080: { near: [10.5, 40, "3×2", 11], medium: [20, 24, "3×4", 20.6], far: [26.9, 24, "3×4", 27.4] },
  tv4k: { near: [21, 32, "3×3", 26.3], medium: [40, 24, "3×4", 41.2], far: [53.8, 24, "3×4", 54.9] },
} as const;
// Cards readable on a lying TV 1080p per chosen size (the same on 4K, except 55–65" at Nära, where the 11 px floor helps 1080p).
const BY_INCHES = {
  55: { near: 40, medium: 18, far: 8 },
  65: { near: 40, medium: 24, far: 12 },
  75: { near: 40, medium: 32, far: 18 },
  86: { near: 40, medium: 32, far: 24 },
  98: { near: 40, medium: 32, far: 32 },
} as const;

const one = (value: number) => Math.round(value * 10) / 10;

test("the capacity per screen and distance (the table)", () => {
  for (const size of SCREEN_SIZES) {
    for (const distance of DISTANCES) {
      const capacity = screenCapacity(size.key, "landscape", distance, 14);
      const [need, cards, card, text] = TABLE[size.key][distance];
      assert.deepEqual([one(capacity.readablePx), capacity.cards, capacity.card ? `${capacity.card.w}×${capacity.card.h}` : null, one(capacity.textPx)], [need, cards, card, text], `${size.key} ${distance}`);
    }
  }
});

test("Skärmstorlek: a larger tv holds more readable cards; the default follows the distance", () => {
  assert.deepEqual(DEFAULT_TV_INCHES, { near: 55, medium: 65, far: 86 });
  assert.deepEqual([...TV_INCHES], [55, 65, 75, 86, 98]);
  for (const inches of TV_INCHES) for (const distance of DISTANCES) {
    assert.equal(screenCapacity("tv1080", "landscape", distance, 14, inches).cards, BY_INCHES[inches][distance], `${inches}" ${distance}`);
    if (distance !== "near") assert.equal(screenCapacity("tv4k", "landscape", distance, 14, inches).cards, BY_INCHES[inches][distance], `4K ${inches}" ${distance}`);
  }
  assert.equal(tvInches("far", null), 86);
  assert.equal(tvInches("far", 55), 55, "a chosen size wins");
  assert.equal(tvInches("near", 5), 55, "a size no tv has is the default");
  assert.ok(readablePx("tv1080", "far", false, 98) < readablePx("tv1080", "far", false, 55), "a larger tv needs fewer pixels for the same letters");
});

test("Långt's text holds: at 10 m an 86 tum tv still reads a dozen cards, a 55 tum only two", () => {
  const usual = READING_DISTANCE_M.far;
  try {
    READING_DISTANCE_M.far = 10;
    assert.equal(screenCapacity("tv1080", "landscape", "far", 14, 86).cards, 12);
    assert.equal(screenCapacity("tv1080", "landscape", "far", 14, 98).cards, 18);
    assert.equal(screenCapacity("tv1080", "landscape", "far", 14, 55).cards, 2);
  } finally { READING_DISTANCE_M.far = usual; }
  assert.match(DISTANCE.far.hint, /^Upp till 10 meter, som en produktionshall, med en skärm på 86 tum eller större\./);
});

test("a tablet or a computer cannot be read from a meeting room or a hall; further away, fewer cards", () => {
  for (const key of ["ipad", "laptop"] as const) for (const distance of ["medium", "far"] as const) assert.equal(screenCapacity(key, "landscape", distance, 14).cards, 0);
  assert.ok(screenCapacity("tv1080", "landscape", "far", 14, 55).cards < screenCapacity("tv1080", "landscape", "medium", 14, 55).cards);
  assert.ok(screenCapacity("tv1080", "portrait", "far", 40, 55).cards <= screenCapacity("tv1080", "landscape", "far", 14, 55).cards, "a standing tv is narrow");
});

test("Avstånd's `enough` reaches the readable size even on a 55\" tv and `most` stays above it", () => {
  const screen = screenPixels("tv1080", "landscape");
  for (const distance of DISTANCES) {
    const row = cardPixels({ w: 24, h: 14 }, 14, screen).h / 14;
    if (distance !== "near") assert.ok(((DISTANCE[distance].enough / 100) * row) >= readablePx("tv1080", distance, false, 55) * 0.95, `${distance}: enough`);
    assert.ok(((DISTANCE[distance].most / 100) * row) > readablePx("tv1080", distance, false, 55) * 1.5, `${distance}: most`);
  }
});

test("the card's text follows the CSS: larger by the distance, capped by its height and by `most`", () => {
  const screen = screenPixels("tv1080", "landscape");
  const small = cardPixels({ w: 6, h: 4 }, 14, screen);
  assert.ok(cardTextPx(small, 4, "far") > cardTextPx(small, 4, "near") * 1.5, "Långt grows a small card");
  assert.ok(cardTextPx(small, 4, "far") <= 0.11 * small.h + 1e-9, "never more than 11 % of the card's height");
  const large = cardPixels({ w: 12, h: 14 }, 14, screen);
  // Filmed 2026-11-20: a large calendar card's title as large as a poster. `most` holds it at 40 % of a row at Nära.
  assert.ok(cardTextPx(large, 14, "near") <= 0.4 * (large.h / 14) + 1e-9);
  assert.ok(cardTextPx(large, 14, "near", 1.25) > cardTextPx(large, 14, "near"), "Textstorlek Större still makes it larger");
  assert.equal(cardTextPx({ w: 40, h: 30 }, 1, "near"), 11, "never below 11 px");
  assert.ok(figurePx(small) > cardTextPx(small, 4, "near") * 2, "a figure is larger than the card's text");
});

const card = (id: string, type: BoardCard["type"], x: number, y: number, w: number, h: number, settings: BoardCard["settings"] = {}): BoardCard => ({ id, type, x, y, w, h, title: "", data: null, settings });
const board = (cards: BoardCard[]): Pick<BoardLayout, "rows" | "cards"> => ({ rows: 14, cards });

test("the warnings: too many cards, a card too small to read, one figure filling a quarter of the board", () => {
  const four = board([card("a", "kpi", 0, 0, 12, 7), card("b", "kpi", 12, 0, 12, 7), card("c", "chart", 0, 7, 12, 7), card("d", "table", 12, 7, 12, 7)]);
  const near = boardReadability(four, "tv1080", "landscape", "near");
  assert.equal(near.tooMany, false);
  assert.equal(near.readable, true);
  assert.deepEqual(near.issues.map((issue) => [issue.cardId, issue.kind]), [["a", "large"], ["b", "large"]], "a figure on a quarter of the board is far larger than Nära needs");
  assert.equal(boardReadability(four, "tv1080", "landscape", "far", 55).issues.filter((issue) => issue.kind === "large").length, 0, "from afar on a 55\" tv a large figure is what is needed");

  const many = board(Array.from({ length: 12 }, (_, index) => card(`k${index}`, "kpi", (index % 4) * 6, Math.floor(index / 4) * 4, 6, 4)));
  const far = boardReadability(many, "tv1080", "landscape", "far", 55);
  assert.equal(far.tooMany, true, "12 cards, 8 fit readably from 8 m on 55\"");
  assert.equal(far.readable, false);
  assert.equal(far.issues.length, 0, "a 6 × 4 figure is read by its figure, which is large enough from afar");
  assert.equal(boardReadability(many, "tv1080", "landscape", "far").readable, true, "the same board on the hall's 86\" tv");
  assert.equal(boardReadability(many, "tv1080", "landscape", "near").readable, true, "and at Nära");
  const texts = board([card("t", "text", 0, 0, 6, 4), card("u", "text", 6, 0, 8, 6)]);
  assert.deepEqual(boardReadability(texts, "tv1080", "landscape", "far", 55).issues.map((issue) => [issue.cardId, issue.kind]), [["t", "small"]], "a 6 × 4 text is too small from 8 m on 55\", an 8 × 6 is not");
  assert.deepEqual(boardReadability(texts, "tv1080", "landscape", "far", 86).issues, [], "on 86\" both are read");
  assert.equal(boardReadability(many, "ipad", "landscape", "medium").capacity.cards, 0, "an iPad is not read from a meeting room");

  // Textstorlek Större lifts a card over the line; a picture has no text to read.
  const edge = board([card("m", "kpi", 0, 0, 6, 5), card("p", "image", 6, 0, 3, 2)]);
  assert.deepEqual(boardReadability(edge, "tv1080", "landscape", "medium", 55).issues.map((issue) => issue.cardId), []);
  const tiny = board([card("m", "kpi", 0, 0, 3, 2), card("n", "kpi", 3, 0, 3, 2, { textSize: "large" })]);
  assert.deepEqual(boardReadability(tiny, "tv1080", "landscape", "medium", 55).issues.map((issue) => issue.cardId), ["m", "n"]);
});
