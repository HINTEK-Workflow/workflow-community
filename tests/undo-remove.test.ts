import assert from "node:assert/strict";
import test from "node:test";
import { removeRow, restoreRow, undoStillOffered, UNDO_REMOVE_MS } from "../lib/workflow/undo-remove";

// Ångra borttagen rad (2026-10-11): the rules for putting a removed row back. Made-up rows.
type Row = { id: string; name: string; catalogue?: { articleId: string } };
const rows: Row[] = [{ id: "a", name: "A" }, { id: "b", name: "B", catalogue: { articleId: "art-1" } }, { id: "c", name: "C" }, { id: "d", name: "D" }];
const ids = (list: Row[]) => list.map((row) => row.id).join("");

test("a removed row goes back where it stood, with everything it held", () => {
  const { list, removed } = removeRow(rows, "b", 1000);
  assert.equal(ids(list), "acd");
  assert.deepEqual(removed?.item, rows[1], "the whole row, including the catalogue copy");
  assert.equal(ids(restoreRow(list, removed!)), "abcd");
  assert.deepEqual(restoreRow(list, removed!)[1].catalogue, { articleId: "art-1" });
});

test("first and last rows go back to first and last", () => {
  const first = removeRow(rows, "a");
  assert.equal(ids(restoreRow(first.list, first.removed!)), "abcd");
  const last = removeRow(rows, "d");
  assert.equal(ids(restoreRow(last.list, last.removed!)), "abcd");
});

test("rows added or removed in the meantime: back after the row it followed, else at its old place", () => {
  const { list, removed } = removeRow(rows, "c");
  assert.equal(ids(restoreRow([{ id: "n", name: "new" }, ...list], removed!)), "nabcd", "after b, wherever b is now");
  assert.equal(ids(restoreRow(list.filter((row) => row.id !== "b"), removed!)), "adc", "its predecessor is gone: the old index, clamped");
  assert.equal(ids(restoreRow([], removed!)), "c");
});

test("a row already in the list is never added twice, and removing a missing row changes nothing", () => {
  const { list, removed } = removeRow(rows, "b");
  const once = restoreRow(list, removed!);
  assert.equal(ids(restoreRow(once, removed!)), "abcd");
  const none = removeRow(rows, "zzz");
  assert.equal(none.removed, null);
  assert.equal(ids(none.list), "abcd");
});

test("the list given is never changed", () => {
  const copy = JSON.stringify(rows);
  const { list, removed } = removeRow(rows, "b");
  restoreRow(list, removed!);
  assert.equal(JSON.stringify(rows), copy);
});

test("Ångra is offered for eight seconds, then not", () => {
  const { removed } = removeRow(rows, "b", 10_000);
  assert.equal(UNDO_REMOVE_MS, 8000);
  assert.equal(undoStillOffered(removed!, 10_000 + 7999), true);
  assert.equal(undoStillOffered(removed!, 10_000 + 8000), true);
  assert.equal(undoStillOffered(removed!, 10_000 + 8001), false);
});
