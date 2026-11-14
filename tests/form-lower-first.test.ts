import assert from "node:assert/strict";
import test from "node:test";
import { lowerFirst } from "../lib/workflow/form-document";

test("a column name inside a sentence keeps its unit and short names (Uppmätt (MΩ) never becomes mω, 2026-10-12)", () => {
  assert.equal(lowerFirst("Uppmätt (MΩ)"), "uppmätt (MΩ)");
  assert.equal(lowerFirst("Utlösningstid (ms)"), "utlösningstid (ms)");
  assert.equal(lowerFirst("PE-ledare"), "PE-ledare");
  assert.equal(lowerFirst("RCD"), "RCD");
  assert.equal(lowerFirst("Ik1"), "Ik1");
  assert.equal(lowerFirst(""), "");
});
