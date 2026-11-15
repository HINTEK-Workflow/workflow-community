import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Mer längst ner (2026-11-14): key cards side by side in a KeyCardGrid are as tall as their row, and each card's foot –
// the action row with Spara and the line with Mer – stands at the bottom, so Spara and Mer line up across the cards.
const card = readFileSync(new URL("../features/integrations/key-card.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("the key card's foot holds Spara and Mer and is pushed to the bottom", () => {
  assert.match(card, /className=\{cn\("key-card h-full", className\)\}/, "the card carries the class the stretch rules use");
  assert.match(card, /data-key-card=""/);
  assert.match(card, /<div className="@container flex min-w-0 flex-1 flex-col gap-3 text-sm" data-key-card=""/, "the content is a column that fills the card");
  const foot = card.indexOf('data-key-card-foot=""');
  assert.ok(foot > 0, "the card has one foot");
  assert.match(card.slice(card.lastIndexOf("<div", foot), foot), /mt-auto/, "the foot takes the free room above it");
  const row = card.indexOf('data-testid="key-card-save-row"');
  const more = card.indexOf('<CollapsibleSection title="Mer"');
  assert.ok(foot < row && row < more, "Spara's row and then Mer, both inside the foot");
});

test("in a KeyCardGrid the item, its wrappers and the card stretch to the row's height", () => {
  assert.match(card, /data-key-card-grid=""/);
  assert.doesNotMatch(card.slice(card.indexOf("export function KeyCardGrid"), card.indexOf("export function KeyCard(")), /items-start/, "the grid stretches its items");
  assert.match(css, /\[data-key-card-grid\] > li, \[data-key-card-grid\] > li div:has\(\.key-card\) \{ display: flex; flex-direction: column; \}/);
  assert.match(css, /\[data-key-card-grid\] \.key-card \{ flex: 1 1 auto; height: auto; \}/);
  assert.match(css, /\.key-card \{ display: flex; flex-direction: column; \}/);
  assert.match(css, /\.key-card > \.panel-content \{ display: flex; flex: 1 1 auto; flex-direction: column; \}/);
});
