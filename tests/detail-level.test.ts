import assert from "node:assert/strict";
import test from "node:test";
import { appColumnDevice, appColumnFrameName, defaultDetailLevels, detailLevelFor, deviceClass, executionFirst, DEVICE_LEVELS } from "../lib/workflow/detail-level";
import { preferencesSchema } from "../lib/kfid/preferences";

// Visningsnivå (2026-10-02; every device since 2026-10-11): the level is chosen for the phone, the tablet and the computer.
test("the display level follows the device: phone, tablet and computer", () => {
  assert.equal(deviceClass(390, true), "phone");
  assert.equal(deviceClass(600, false), "phone", "a narrow window counts as a phone");
  assert.equal(deviceClass(820, true), "tablet");
  assert.equal(deviceClass(1366, true), "tablet", "a large tablet in landscape");
  assert.equal(deviceClass(1024, false), "desktop", "a small computer window with a mouse");
  assert.equal(deviceClass(1920, true), "desktop");
  // A phone on its side stays a phone (2026-10-13); a small tablet on its side stays a tablet.
  assert.equal(deviceClass(844, true, 390), "phone", "a phone turned on its side");
  assert.equal(deviceClass(1024, true, 768), "tablet", "a tablet turned on its side");
  assert.equal(deviceClass(844, false, 390), "desktop", "a low computer window without touch is still a computer");
  const levels = { phone: 1, tablet: 2, desktop: 1 } as const;
  assert.equal(detailLevelFor(levels, 390, true), 1);
  assert.equal(detailLevelFor(levels, 820, true), 2);
  assert.equal(detailLevelFor(levels, 1440, false), 1, "a computer can choose the app look too");
  assert.equal(detailLevelFor({ phone: 1, tablet: 2 }, 1440, false), 3, "nothing chosen on a computer is everything");
  // A2 (2026-10-21/22; replaces plan 1P's Lagom on a phone): the first time, by device - phone 1, tablet 1 (the tablet's
  // app view, produktägarens beslut 2026-11-23; was Lagom), computer 3.
  assert.deepEqual(defaultDetailLevels, { phone: 1, tablet: 1, desktop: 3 });
  assert.equal(detailLevelFor(null, 390, true), 1, "nothing chosen on the phone is the app");
  assert.equal(detailLevelFor(null, 820, true), 1, "nothing chosen on a tablet is the app view");
  assert.equal(detailLevelFor(null, 768, false), 3, "a window of 768 px with a mouse is a computer: everything");
  assert.equal(detailLevelFor(null, 1440, false), 3, "nothing chosen on a computer is everything");
  assert.equal(detailLevelFor({ tablet: 3 }, 390, true), 1, "a choice for the tablet only leaves the phone at its default");
  assert.equal(detailLevelFor({ phone: 3 }, 390, true), 3, "a saved 3 on the phone is kept");
  assert.equal(detailLevelFor({ phone: 1, tablet: 2 }, 844, true, 390), 1, "a phone on its side keeps the phone's level (2026-10-13)");
  // Level 1 is open to every device (it replaces 2026-10-09 evening's "phone only").
  assert.equal(detailLevelFor({ tablet: 1 }, 820, true), 1);
  assert.equal(detailLevelFor({ desktop: 2 }, 1440, false), 2, "a computer can choose Lagom");
  for (const device of ["tablet", "desktop"] as const) assert.deepEqual(DEVICE_LEVELS[device], [1, 2, 3]);
  assert.deepEqual(DEVICE_LEVELS.phone, [1, 3], "A2: the phone has the app with Visa allt off or on");
  assert.equal(detailLevelFor({ phone: 7 as never }, 390, true), 3, "an unknown level is everything");
});

test("preferences: the level is saved per device, and a menu button that became a tab is dropped without losing the rest", () => {
  const defaults = preferencesSchema.parse({});
  assert.deepEqual(defaults.detailLevel, { phone: 1, tablet: 1, desktop: 3 });
  assert.deepEqual(preferencesSchema.parse({ detailLevel: { phone: 1, tablet: 2 } }).detailLevel, { phone: 1, tablet: 2, desktop: 3 }, "an older record without the computer's key reads as the default");
  assert.deepEqual(preferencesSchema.parse({ detailLevel: { phone: 1, tablet: 1, desktop: 1 } }).detailLevel, { phone: 1, tablet: 1, desktop: 1 });
  assert.deepEqual(preferencesSchema.parse({ detailLevel: { phone: 9 } }).detailLevel, { phone: 1, tablet: 1, desktop: 3 });
  // Platser and Krediter are tabs under Mitt företag since 2026-10-02; an older choice to hide them is just forgotten.
  assert.deepEqual(preferencesSchema.parse({ hiddenMenuItems: ["credits", "facilities", "time"] }).hiddenMenuItems, ["time"]);
  // Autospara utkast and example rows are no longer choices (2026-10-07); older stored keys are dropped quietly.
  const old = preferencesSchema.parse({ autoSave: false, showExamples: true, compact: true });
  assert.equal("autoSave" in old, false);
  assert.equal("showExamples" in old, false);
  assert.equal(old.compact, true);
});

// Utförande först (proposal 2026-10-08, step 2): the work before the planning, only for the responsible person on a
// phone or tablet at level 1–2, and only once the task is saved.
test("the work comes first only for the responsible person at level 1–2 on a saved task", () => {
  const mine = { saved: true, responsibleId: "u1", viewerId: "u1" };
  assert.equal(executionFirst({ ...mine, level: 1 }), true);
  assert.equal(executionFirst({ ...mine, level: 2 }), true);
  assert.equal(executionFirst({ ...mine, level: 3 }), false, "level 3 and a computer keep the usual order");
  assert.equal(executionFirst({ ...mine, level: 2, viewerId: "u2" }), false, "office and supervisors see the usual order");
  assert.equal(executionFirst({ ...mine, level: 2, saved: false }), false, "a new task starts with its planning");
  assert.equal(executionFirst({ ...mine, level: 2, responsibleId: null }), false, "no responsible person");
  assert.equal(executionFirst({ level: 2, saved: true, responsibleId: null, viewerId: null }), false, "nobody signed in and nobody responsible");
  assert.equal(executionFirst({ level: 1, saved: true, responsibleId: "u1" }), false, "no viewer (the Local file)");
});

test("the app column's frame is named after the device it stands on", () => {
  assert.equal(appColumnDevice(appColumnFrameName("desktop")), "desktop");
  assert.equal(appColumnDevice(appColumnFrameName("tablet")), "tablet");
  assert.equal(appColumnDevice(""), null);
  assert.equal(appColumnDevice("something-else"), null);
  assert.equal(appColumnDevice("hintek-app-column-watch"), null);
});
