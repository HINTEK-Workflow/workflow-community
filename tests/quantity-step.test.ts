import assert from "node:assert/strict";
import test from "node:test";
import { alreadyInListText, articleUnit, quantityShown, stepQuantity, typedQuantity, unitTakesDecimals } from "@/lib/workflow/quantity-step";

test("plus och minus ändrar antalet med ett", () => {
  assert.deepEqual(stepQuantity(2, 1), { kind: "set", value: 3 });
  assert.deepEqual(stepQuantity(3, -1), { kind: "set", value: 2 });
});

test("minska under minimum tar bort raden när sidan kan det, annars händer inget", () => {
  assert.deepEqual(stepQuantity(1, -1, { canRemove: true }), { kind: "remove" });
  assert.deepEqual(stepQuantity(1, -1), { kind: "none" });
});

test("största antal respekteras och ogiltigt värde räknas som minimum", () => {
  assert.deepEqual(stepQuantity(5, 1, { max: 5 }), { kind: "none" });
  assert.deepEqual(stepQuantity(Number.NaN, 1), { kind: "set", value: 2 });
});

test("texten för en artikel som redan finns", () => {
  assert.equal(alreadyInListText(2), "Finns redan i listan – antal 2.");
});

test("artikelns enhet kommer från artikeln, koder översätts och saknad enhet är st", () => {
  assert.equal(articleUnit("m"), "m");
  assert.equal(articleUnit("MTR"), "m");
  assert.equal(articleUnit("PCE"), "st");
  assert.equal(articleUnit("förp"), "förp");
  assert.equal(articleUnit("PK"), "förp");
  assert.equal(articleUnit(""), "st");
  assert.equal(articleUnit(undefined), "st");
});

test("m tar decimaler, st och förp är hela tal", () => {
  assert.equal(unitTakesDecimals("m"), true);
  assert.equal(unitTakesDecimals("MTR"), true);
  assert.equal(unitTakesDecimals("st"), false);
  assert.equal(unitTakesDecimals("förp"), false);
  assert.equal(unitTakesDecimals(""), false, "utan enhet är det st");
  assert.deepEqual(typedQuantity("2,5", "m"), { value: 2.5 });
  assert.deepEqual(typedQuantity("12", "st"), { value: 12 });
  assert.deepEqual(typedQuantity("250", "förp"), { value: 250 });
  assert.deepEqual(typedQuantity("2,5", "st"), { problem: "Antal i st är hela tal." });
  assert.deepEqual(typedQuantity("1,5", "förp"), { problem: "Antal i förp är hela tal." });
  assert.deepEqual(typedQuantity("0", "st"), { value: 0 }, "0 tar bort raden");
  assert.ok("problem" in typedQuantity("abc", "m"));
  assert.ok("problem" in typedQuantity("-1", "m"));
});

test("plus och minus stegar med 1 även när antalet har decimaler", () => {
  assert.deepEqual(stepQuantity(2.5, 1, { min: 0.01, canRemove: true }), { kind: "set", value: 3.5 });
  assert.deepEqual(stepQuantity(1.5, -1, { min: 0.01, canRemove: true }), { kind: "set", value: 0.5 });
  assert.deepEqual(stepQuantity(0.5, -1, { min: 0.01, canRemove: true }), { kind: "remove" });
  assert.equal(quantityShown(2.5), "2,5");
  assert.equal(quantityShown(3), "3");
});
