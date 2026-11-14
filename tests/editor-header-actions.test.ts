import assert from "node:assert/strict";
import test from "node:test";
import { EDITOR_HEADER_MAX_BUTTONS, headerOverflow } from "../lib/workflow/editor-header-actions";

const button = (key: string, extra: { movable?: boolean; keep?: boolean; destructive?: boolean } = {}) => ({ key, movable: extra.movable ?? true, ...extra });

test("högst fyra knappar: allt syns när det får plats", () => {
  assert.equal(EDITOR_HEADER_MAX_BUTTONS, 4);
  assert.deepEqual(headerOverflow([button("a"), button("b"), button("c"), button("d")]), []);
  // Mer counts as one of the four when it is shown anyway.
  assert.deepEqual(headerOverflow([button("a"), button("b"), button("c")], { more: true }), []);
});

test("högst fyra knappar: den röda flyttar först, sedan från vänster, de som ska stå kvar sist", () => {
  // An unsaved purchase draft: Ta bort, Till grossist (own dialog), Lägg i offert (keep), Lägg som material, Markera som beställt (keep), Makulera.
  const purchase = [button("delete", { destructive: true }), button("wholesale", { movable: false }), button("to-quote", { keep: true }), button("to-work-order"), button("order", { keep: true }), button("cancel")];
  assert.deepEqual(headerOverflow(purchase), ["delete", "to-work-order", "cancel"]);
  // The kept ones move only when nothing else can.
  assert.deepEqual(headerOverflow([button("a", { keep: true }), button("b", { keep: true }), button("c", { keep: true }), button("d", { keep: true }), button("e", { keep: true })]), ["a", "b"]);
});

test("högst fyra knappar: tiden och knappar med egen meny flyttas aldrig", () => {
  assert.deepEqual(headerOverflow([button("a"), button("b"), button("c")], { fixed: 1, more: true }), ["a"]);
  assert.deepEqual(headerOverflow([button("x", { movable: false }), button("y", { movable: false }), button("z", { movable: false }), button("w", { movable: false }), button("v", { movable: false })]), []);
});
