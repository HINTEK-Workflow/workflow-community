import assert from "node:assert/strict";
import test from "node:test";
import { purchaseLineInputSchema } from "../lib/purchases/model";
import { quantityProblem, quoteInputSchema, quoteLineInputSchema } from "../lib/quotes/model";

// Antal på rad i inköp och offert: minst något över 0 (2026-10-18, beslut 1).
test("quantityProblem: 0 and negative numbers have their own text, a non-number another, a number none", () => {
  assert.equal(quantityProblem("0"), "Antal ska vara större än 0.");
  assert.equal(quantityProblem("-2"), "Antal ska vara större än 0.");
  assert.equal(quantityProblem("abc"), "Antal måste vara ett tal, till exempel 12 eller 2,5.");
  assert.equal(quantityProblem(""), "Antal måste vara ett tal, till exempel 12 eller 2,5.");
  assert.equal(quantityProblem("1"), null);
  assert.equal(quantityProblem("2,5"), null);
  assert.equal(quantityProblem("0,5"), null);
});

test("a quote line and a purchase line refuse antal 0 and below, with the same text", () => {
  for (const quantity of ["0", "-2"]) {
    assert.throws(() => quoteLineInputSchema.parse({ kind: "MATERIAL", name: "Kabel", quantity }), /Antal ska vara större än 0/);
    assert.throws(() => purchaseLineInputSchema.parse({ name: "Kabel", quantity }), /Antal ska vara större än 0/);
    assert.throws(() => quoteInputSchema.parse({ title: "X", lines: [{ kind: "MATERIAL", name: "Kabel", quantity }] }), /Antal ska vara större än 0/);
  }
  assert.equal(quoteLineInputSchema.parse({ kind: "MATERIAL", name: "Kabel", quantity: "1" }).quantity, "1");
  assert.equal(purchaseLineInputSchema.parse({ name: "Kabel", quantity: "2,5" }).quantity, "2,5");
});
