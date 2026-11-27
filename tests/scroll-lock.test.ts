import assert from "node:assert/strict";
import test from "node:test";
import { shouldBlockTouch } from "../lib/workflow/scroll-lock";

const box = (scrollTop: number, scrollHeight = 1000, clientHeight = 400) => ({ scrollTop, scrollHeight, clientHeight });

test("Låst sida: a drag outside anything scrollable never reaches the page", () => {
  assert.equal(shouldBlockTouch([], 12), true, "the dimmed page or the sheet's title");
  assert.equal(shouldBlockTouch([], -12), true);
  assert.equal(shouldBlockTouch([box(0, 300, 400)], -12), true, "a list that fits has nothing to scroll");
  assert.equal(shouldBlockTouch([], 0), false, "no movement, nothing to stop");
});

test("Låst sida: the sheet's own list scrolls until its end, then the drag stops instead of chaining", () => {
  assert.equal(shouldBlockTouch([box(200)], 12), false, "scrolls back up");
  assert.equal(shouldBlockTouch([box(200)], -12), false, "scrolls on down");
  assert.equal(shouldBlockTouch([box(0)], 12), true, "at the top, pulling down");
  assert.equal(shouldBlockTouch([box(600)], -12), true, "at the bottom, pushing up");
  assert.equal(shouldBlockTouch([box(0)], -12), false, "at the top, pushing up still scrolls");
});

test("Låst sida: an inner box at its end passes the drag to an outer box that can still scroll", () => {
  // The message field at its top inside the chat's thread that can scroll up.
  assert.equal(shouldBlockTouch([box(0, 200, 100), box(300)], 12), false);
  assert.equal(shouldBlockTouch([box(0, 200, 100), box(0)], 12), true);
});
