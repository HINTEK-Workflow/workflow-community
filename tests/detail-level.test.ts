import assert from "node:assert/strict";
import test from "node:test";
import { detailLevelFor, deviceClass } from "../lib/workflow/detail-level";
import { preferencesSchema } from "../lib/kfid/preferences";

// Visningsnivå (2026-10-02): a simpler level chosen for the phone and for the tablet; a computer shows everything.
test("the display level follows the device: phone, tablet and computer", () => {
  assert.equal(deviceClass(390, true), "phone");
  assert.equal(deviceClass(600, false), "phone", "a narrow window counts as a phone");
  assert.equal(deviceClass(820, true), "tablet");
  assert.equal(deviceClass(1366, true), "tablet", "a large tablet in landscape");
  assert.equal(deviceClass(1024, false), "desktop", "a small computer window with a mouse");
  assert.equal(deviceClass(1920, true), "desktop");
  const levels = { phone: 1, tablet: 2 } as const;
  assert.equal(detailLevelFor(levels, 390, true), 1);
  assert.equal(detailLevelFor(levels, 820, true), 2);
  assert.equal(detailLevelFor(levels, 1440, false), 3, "a computer always shows everything");
  assert.equal(detailLevelFor(null, 390, true), 3, "nothing chosen is everything");
  assert.equal(detailLevelFor({ phone: 7 as never }, 390, true), 3, "an unknown level is everything");
});

test("preferences: the level is saved per device, and a menu button that became a tab is dropped without losing the rest", () => {
  const defaults = preferencesSchema.parse({});
  assert.deepEqual(defaults.detailLevel, { phone: 3, tablet: 3 });
  assert.deepEqual(preferencesSchema.parse({ detailLevel: { phone: 1, tablet: 2 } }).detailLevel, { phone: 1, tablet: 2 });
  assert.deepEqual(preferencesSchema.parse({ detailLevel: { phone: 9 } }).detailLevel, { phone: 3, tablet: 3 });
  // Platser and Krediter are tabs under Mitt företag since 2026-10-02; an older choice to hide them is just forgotten.
  assert.deepEqual(preferencesSchema.parse({ hiddenMenuItems: ["credits", "planning", "facilities", "time"] }).hiddenMenuItems, ["planning", "time"]);
});
