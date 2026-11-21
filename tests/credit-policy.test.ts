import assert from "node:assert/strict";
import { test } from "node:test";
import { assertPurchasedCreditCapacity, oneYearFrom } from "../lib/kfid/credit-policy";

test("cap counts unspent purchased credits, not money or test credits", () => {
  assert.doesNotThrow(() => assertPurchasedCreditCapacity(400, 600));
  assert.throws(() => assertPurchasedCreditCapacity(401, 600));
  assert.throws(() => assertPurchasedCreditCapacity(0, 1_001));
  assert.throws(() => assertPurchasedCreditCapacity(-1, 1));
  assert.throws(() => assertPurchasedCreditCapacity(0, 0));
});

test("one-year expiry uses calendar year and clamps leap day", () => {
  assert.equal(oneYearFrom(new Date("2024-02-29T12:30:00.000Z")).toISOString(), "2025-02-28T12:30:00.000Z");
  assert.equal(oneYearFrom(new Date("2026-09-20T00:00:00.000Z")).toISOString(), "2027-09-20T00:00:00.000Z");
});
