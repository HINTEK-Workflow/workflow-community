import { test } from "node:test";
import assert from "node:assert/strict";
import { decimalText } from "../lib/workflow/form-document";

// Mobilresan 2026-11-18: a limit filled in from the company's values (a stored number) is shown with the Swedish decimal comma,
// as the measured value beside it.
test("a stored number in a form field is shown with a decimal comma", () => {
  assert.equal(decimalText(0.5), "0,5");
  assert.equal(decimalText(1), "1");
  assert.equal(decimalText(0.15), "0,15");
  assert.equal(decimalText(-2.25), "-2,25");
  assert.equal(decimalText(Number.NaN), "");
});
