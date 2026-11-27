import assert from "node:assert/strict";
import test from "node:test";
import { menuChoicesFor, menuChoicesPatch, mergePreferences, preferencesSchema } from "../lib/kfid/preferences";
import { menuChoicesOf, phoneMenuChoicesOf, resolveMenu, type MenuEntry } from "../lib/workflow/menu-items";
import { nativeMoreSections } from "../lib/workflow/native-mode";
import { defaultWorkflowPermissionProfile } from "../lib/workflow/permissions";

// Anpassa menyn per enhet (2026-10-24): one choice for Mer on the phone, one for the computer's and the tablet's menu.
const admin = { memberRole: "OWNER" as const, workflowPermissions: defaultWorkflowPermissionProfile(), ai: true, importPage: true, canBuildForms: true };
const menuKeys = (groups: MenuEntry[][]) => groups.flat().flatMap((entry) => entry.type === "group" ? entry.children : [entry.key]);
const moreKeys = (groups: MenuEntry[][]) => nativeMoreSections(groups).flatMap((section) => section.rows.map((row) => row.key));

test("a choice saved before the split reads on both devices until the phone's is changed", () => {
  const stored = preferencesSchema.parse({ hiddenMenuItems: ["rounds"], menuShortcuts: ["instruments"] });
  assert.equal(stored.phoneMenu, null, "no phone choice of its own");
  assert.deepEqual(menuChoicesFor(stored, "phone"), { hiddenMenuItems: ["rounds"], menuShortcuts: ["instruments"] });
  assert.deepEqual(menuChoicesFor(stored, "desktop"), { hiddenMenuItems: ["rounds"], menuShortcuts: ["instruments"] });
});

test("the phone's choice is read like the menu's: old keys translated, unknown keys dropped, bad input ignored", () => {
  const stored = preferencesSchema.parse({ phoneMenu: { hiddenMenuItems: ["new_task", "credits"], menuShortcuts: ["customers", "instruments"] } });
  assert.deepEqual(stored.phoneMenu, { hiddenMenuItems: [], menuShortcuts: ["instruments"] });
  assert.equal(preferencesSchema.parse({ phoneMenu: "all" }).phoneMenu, null, "a broken value is read as no choice of its own");
  assert.deepEqual(preferencesSchema.parse({ phoneMenu: {} }).phoneMenu, { hiddenMenuItems: [], menuShortcuts: [] }, "an empty choice shows everything");
  assert.equal(preferencesSchema.parse({ phoneMenu: { hiddenMenuItems: Array.from({ length: 41 }, () => "time") } }).phoneMenu?.hiddenMenuItems.length, 0, "too long a list is dropped as the menu's is");
});

test("a save for one device never changes the other's", () => {
  const stored = preferencesSchema.parse({ hiddenMenuItems: ["rounds"] });
  const phone = mergePreferences(stored, menuChoicesPatch("phone", { hiddenMenuItems: ["quotes", "time"], menuShortcuts: [] }));
  assert.deepEqual(phone.hiddenMenuItems, ["rounds"], "the computer's menu is kept");
  assert.deepEqual(menuChoicesFor(phone, "phone").hiddenMenuItems, ["quotes", "time"]);
  const desktop = mergePreferences(phone, menuChoicesPatch("desktop", { hiddenMenuItems: [], menuShortcuts: ["instruments"] }));
  assert.deepEqual(menuChoicesFor(desktop, "desktop"), { hiddenMenuItems: [], menuShortcuts: ["instruments"] });
  assert.deepEqual(menuChoicesFor(desktop, "phone"), { hiddenMenuItems: ["quotes", "time"], menuShortcuts: [] }, "the phone's is kept");
  // A key that is no button any more is dropped from a phone's saved choice too, and a saved Uppgifter is read as Arbetsordrar.
  assert.deepEqual(menuChoicesFor(preferencesSchema.parse({ phoneMenu: { hiddenMenuItems: ["project_planning", "tasks", "quotes"], menuShortcuts: [] } }), "phone").hiddenMenuItems, ["quotes"]);
  assert.deepEqual(Object.keys(menuChoicesPatch("phone", { hiddenMenuItems: [], menuShortcuts: [] })), ["phoneMenu"], "the phone's save carries only its own choice");
});

test("Mer follows the phone's choice and the menu the computer's", () => {
  const detail = { hidden: ["rounds"], shortcuts: [], phone: { hidden: ["quotes"], shortcuts: [] } };
  const menu = resolveMenu(admin, menuChoicesOf(detail));
  const more = resolveMenu(admin, phoneMenuChoicesOf(detail) ?? menuChoicesOf(detail));
  assert.ok(!menuKeys(menu).includes("rounds") && menuKeys(menu).includes("quotes"), "the menu hides what the computer's choice hides");
  assert.ok(!moreKeys(more).includes("quotes") && moreKeys(more).includes("rounds"), "Mer hides what the phone's choice hides");
  // Without a phone choice Mer shows what the menu shows.
  const follows = { hidden: ["rounds"], shortcuts: [], phone: null };
  assert.equal(phoneMenuChoicesOf(follows), null);
  assert.ok(!moreKeys(resolveMenu(admin, phoneMenuChoicesOf(follows) ?? menuChoicesOf(follows))).includes("rounds"));
  assert.equal(phoneMenuChoicesOf(["rounds"]), null, "an older sender's bare list has no phone choice");
});
