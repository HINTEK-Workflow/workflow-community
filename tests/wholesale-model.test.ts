import assert from "node:assert/strict";
import test from "node:test";
import { parseWholesaleRefKey, seenCount, seenFromSeqs, seenHas, seenSeqs, wholesaleRefKey } from "@/lib/catalogue/wholesale-model";

test("the bit list holds exactly the running numbers it was made from", () => {
  const seen = seenFromSeqs([1, 8, 9, 17, 17, 1000]);
  assert.equal(seen.length, (1000 >> 3) + 1);
  assert.equal(seenCount(seen), 5, "a duplicate counts once");
  assert.deepEqual(seenSeqs(seen), [1, 8, 9, 17, 1000]);
  for (const seq of [1, 8, 9, 17, 1000]) assert.equal(seenHas(seen, seq), true, String(seq));
  for (const seq of [0, 2, 7, 10, 16, 18, 999, 1001, 100_000, -1, 1.5]) assert.equal(seenHas(seen, seq), false, String(seq));
});

test("the bit order is Postgres' get_bit: byte seq>>3, least significant bit first", () => {
  const seen = seenFromSeqs([1, 8, 10]);
  assert.deepEqual([...seen], [0b0000_0010, 0b0000_0101]);
});

test("an empty list and a missing list see nothing", () => {
  assert.equal(seenFromSeqs([]).length, 0);
  assert.equal(seenHas(seenFromSeqs([]), 1), false);
  assert.equal(seenHas(null, 1), false);
  assert.equal(seenCount(undefined), 0);
});

test("a running number is a whole number from 1", () => {
  assert.throws(() => seenFromSeqs([0]));
  assert.throws(() => seenFromSeqs([1.5]));
  assert.throws(() => seenFromSeqs([-3]));
});

test("a wholesaler's article key round-trips and nothing else passes", () => {
  assert.equal(wholesaleRefKey("solar", "1000000004"), "W:solar:1000000004");
  assert.deepEqual(parseWholesaleRefKey("W:solar:1000000004"), { wholesaler: "solar", articleNo: "1000000004" });
  assert.deepEqual(parseWholesaleRefKey("W:rexel:REX-98765"), { wholesaler: "rexel", articleNo: "REX-98765" });
  assert.equal(parseWholesaleRefKey("W:okand:123"), null, "an unknown wholesaler");
  assert.equal(parseWholesaleRefKey("E:1234567"), null);
  assert.equal(parseWholesaleRefKey("W:solar:"), null);
  assert.equal(parseWholesaleRefKey(null), null);
  assert.equal(wholesaleRefKey("solar", ""), null);
  assert.equal(wholesaleRefKey("solar", "x".repeat(120)), null, "too long for the key check");
});
