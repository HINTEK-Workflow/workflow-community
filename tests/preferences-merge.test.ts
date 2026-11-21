import assert from "node:assert/strict";
import test from "node:test";
import { applyPreferencesPatch, defaultPreferences, detailLevelPatch, mergePreferences, preferencesSchema } from "../lib/kfid/preferences";

// Simulation 0.6.3: a person with a phone and a tablet open at the same time saw the tablet's level jump from 2 to 3 – each
// device saved its whole, older copy of the preferences and the last one won. A save now carries only what changed.
test("a save carries only what changed; the rest stays as stored", () => {
  const stored = preferencesSchema.parse({ theme: "dark", detailLevel: { phone: 1, tablet: 2, desktop: 3 }, hiddenMenuItems: ["quotes"] });
  const merged = mergePreferences(stored, { textScale: "125" });
  assert.equal(merged.textScale, "125");
  assert.equal(merged.theme, "dark", "another choice is kept");
  assert.deepEqual(merged.detailLevel, { phone: 1, tablet: 2, desktop: 3 });
  assert.deepEqual(merged.hiddenMenuItems, stored.hiddenMenuItems);
});

test("the phone's level never writes back the tablet's, and the other way round", () => {
  // The tablet chose 2 a moment ago; the phone's page still believes the tablet is at 3.
  const stored = preferencesSchema.parse({ detailLevel: { phone: 2, tablet: 2 }, viewBasis: "" });
  const stalePhonePage = preferencesSchema.parse({ detailLevel: { phone: 2, tablet: 3 }, viewBasis: "" });
  const patch = detailLevelPatch(null, stalePhonePage, "phone", 1);
  assert.deepEqual(patch.detailLevel, { phone: 1 }, "only the phone is sent while the person's own levels count");
  assert.deepEqual(mergePreferences(stored, patch).detailLevel, { phone: 1, tablet: 2, desktop: 3 });
});

test("under a new work view the levels in force become the person's own, this device changed", () => {
  const view = { view: "fitter" as const, setAt: "2026-10-09T10:00:00.000Z" };
  const before = preferencesSchema.parse({ detailLevel: { phone: 3, tablet: 3 }, viewBasis: "older" });
  const patch = detailLevelPatch(view, before, "tablet", 2);
  assert.equal(patch.viewBasis, view.setAt);
  assert.equal(patch.detailLevel?.tablet, 2);
  assert.equal(typeof patch.detailLevel?.phone, "number", "the other device keeps the level now in force");
});

test("unknown keys and bad input are ignored; Återställ sends both devices", () => {
  const stored = preferencesSchema.parse({ theme: "light" });
  assert.equal(mergePreferences(stored, { unknown: 1, theme: "dark" }).theme, "dark");
  // Blue and Customer are Light since 2026-10-16: an old stored choice is read, never refused.
  assert.equal(preferencesSchema.parse({ theme: "blue" }).theme, "light");
  assert.equal(preferencesSchema.parse({ theme: "customer" }).theme, "light");
  assert.equal(mergePreferences(stored, null).theme, "light");
  assert.equal(mergePreferences(stored, ["x"]).theme, "light");
  assert.deepEqual(mergePreferences(null, {}).theme, defaultPreferences.theme);
  const reset = mergePreferences(preferencesSchema.parse({ detailLevel: { phone: 1, tablet: 2 }, viewBasis: "x" }), { detailLevel: { phone: 2, tablet: 2, desktop: 3 }, viewBasis: null });
  assert.deepEqual(reset.detailLevel, { phone: 2, tablet: 2, desktop: 3 });
  assert.equal(reset.viewBasis, null);
  // A whole object (older callers and tests) still works as before.
  assert.equal(applyPreferencesPatch(stored, { ...stored, textScale: "110" }).textScale, "110");
});
