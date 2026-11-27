import assert from "node:assert/strict";
import test from "node:test";
import { hitLook } from "../lib/search/hit-look";

test("Sök names the supporting pages' place as the menu does: Mer, not Verktyg (förenkling 0.77.0)", () => {
  assert.equal(hitLook({ type: "command", href: "/?view=instruments", title: "Instrument" }).kind, "Sida · Mer");
  assert.equal(hitLook({ type: "command", href: "/?view=calculators", title: "Kalkylator" }).kind, "Sida · Mer");
  // The page Mer itself gets no "· Mer" after its own name.
  assert.doesNotMatch(hitLook({ type: "command", href: "/?view=tools", title: "Mer" }).kind, /Verktyg/);
});
