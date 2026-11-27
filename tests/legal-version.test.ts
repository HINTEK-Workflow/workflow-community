import assert from "node:assert/strict";
import test from "node:test";
import { legalVersionDate, legalVersionLabel } from "../lib/legal-version";

// Avtalslistan (2026-10-07): "Gäller från <datum> · version N", never the raw version string.

test("a published version reads as the day it applies from and its number", () => {
  assert.equal(legalVersionLabel({ version: "2026-10-06.1" }), "Gäller från 2026-10-06 · version 1");
  assert.equal(legalVersionLabel({ version: "2026-09-30.2" }), "Gäller från 2026-09-30 · version 2");
  assert.equal(legalVersionLabel({ version: "2026-09-14.01", validFrom: null }), "Gäller från 2026-09-14 · version 1");
});

test("the document's own start date wins over the day in its name, in Swedish time", () => {
  assert.equal(legalVersionLabel({ version: "2026-10-06.1", validFrom: "2026-10-07T07:12:00.000Z" }), "Gäller från 2026-10-07 · version 1");
  // 22:30 UTC on 6 October is already 7 October in Sweden.
  assert.equal(legalVersionDate({ version: "2026-10-06.1", validFrom: new Date("2026-10-06T22:30:00.000Z") }), "2026-10-07");
});

test("a version named in another way is shown as it is, never guessed at", () => {
  assert.equal(legalVersionLabel({ version: "qa-only-sandbox-v1" }), "Version qa-only-sandbox-v1");
  assert.equal(legalVersionLabel({ version: "qa-only-sandbox-v1", validFrom: "2026-10-07T07:00:00.000Z" }), "Gäller från 2026-10-07 · version qa-only-sandbox-v1");
  assert.equal(legalVersionDate({ version: "WORKING-2026-09-14.1" }), null);
  assert.equal(legalVersionLabel({ version: "2026-10-06.1", validFrom: "inte ett datum" }), "Gäller från 2026-10-06 · version 1", "an unreadable start date falls back to the name");
});

test("the text never contains the raw version string of a dated version", () => {
  for (const version of ["2026-10-06.1", "2026-09-30.1", "2026-09-14.1"]) assert.ok(!legalVersionLabel({ version }).includes(`${version}`), version);
});
