import assert from "node:assert/strict";
import test from "node:test";
import { choiceHint, choiceLevel, choiceName, defaultDetailLevels, displayLevelsFor, offersShowMore, phoneShowsAll } from "../lib/workflow/detail-level";
import { appColumnFor, nativeHidesView, nativeModeFor, nativeMoreSections, nativeMoreTools, nativeSettingsHidden, nativeVisibleSections } from "../lib/workflow/native-mode";
import { resolveMenu } from "../lib/workflow/menu-items";
import { defaultWorkflowPermissionProfile } from "../lib/workflow/permissions";
import { effectiveDetailLevels, workViewDefaults } from "../lib/workflow/work-view";
import { nativeReduced, parseShowMorePages, SHOW_MORE_MAX_PAGES, SHOW_MORE_NOTE, showMoreButtonShown, showMoreLabel, showMoreNote, showMorePage, withShowMorePage } from "../lib/workflow/show-more";
import { detailLevelPatch, preferencesSchema } from "../lib/kfid/preferences";

// UX-granskningen A2 (2026-10-21, preciserat 2026-10-22): a phone always shows the app; Lagom and Allt are a
// "Visa mer" on the page, not another layout.
test("A2: the first levels are the app on a phone, the app view on a tablet (2026-11-23) and everything on a computer", () => {
  assert.deepEqual(defaultDetailLevels, { phone: 1, tablet: 1, desktop: 3 });
  assert.deepEqual(preferencesSchema.parse({}).detailLevel, { phone: 1, tablet: 1, desktop: 3 }, "a new person");
  assert.deepEqual(displayLevelsFor(null, 820, true, 1180), { layout: 1, content: 1 }, "a tablet standing: the app view");
  assert.deepEqual(displayLevelsFor(null, 1180, true, 820), { layout: 1, content: 1 }, "a tablet on its side: the same tablet level");
  assert.deepEqual(displayLevelsFor(null, 1440, false, 900), { layout: 3, content: 3 }, "a computer: everything");
});

test("A2: a signed-in phone always has the app's layout, standing and on its side", () => {
  for (const [width, height] of [[390, 844], [844, 390]] as const) {
    for (const phone of [1, 2, 3] as const) {
      const { layout } = displayLevelsFor({ phone, tablet: 2, desktop: 3 }, width, true, height);
      assert.equal(layout, 1, `saved ${phone} at ${width}×${height}`);
      assert.equal(nativeModeFor(layout, width, true), true, "the app look is on");
      assert.equal(appColumnFor(layout, width, true), false, "never the narrow column on a phone");
    }
  }
  assert.deepEqual(displayLevelsFor(null, 390, true, 844, { signedIn: false }), { layout: 2, content: 2 }, "signed out: the login pages as before");
  assert.deepEqual(displayLevelsFor({ tablet: 1 }, 820, true, 1180), { layout: 1, content: 1 }, "a tablet may still choose the app (the app column)");
});

test("A2: a saved Lagom or Allt on the phone reads as the app with Visa allt on; no record needs to change", () => {
  assert.equal(phoneShowsAll(1), false);
  assert.equal(phoneShowsAll(2), true, "Lagom before 2026-10-22");
  assert.equal(phoneShowsAll(3), true);
  assert.equal(phoneShowsAll(undefined), false);
  assert.deepEqual(displayLevelsFor({ phone: 2 }, 390, true, 844), { layout: 1, content: 3 });
  assert.deepEqual(displayLevelsFor({ phone: 3 }, 390, true, 844), { layout: 1, content: 3 });
  assert.deepEqual(displayLevelsFor({ phone: 1 }, 390, true, 844), { layout: 1, content: 1 });
  assert.deepEqual(displayLevelsFor(null, 390, true, 844), { layout: 1, content: 1 }, "nothing saved: the app, Visa allt off");
  assert.equal(choiceLevel("phone", 2), 3);
  assert.equal(choiceLevel("phone", 1), 1);
  assert.equal(choiceLevel("tablet", 2), 2, "a tablet keeps its three levels");
  assert.equal(choiceName("phone", 2), "Appvyn, allt visat");
  assert.equal(choiceName("phone", 1), "Appvyn");
  assert.equal(choiceName("desktop", 3), "Allt");
  assert.ok(choiceHint("phone", 1).includes("Visa mer"));
  // The switch "Visa allt på den här enheten" writes 3 or 1 for the phone only.
  const stored = preferencesSchema.parse({ detailLevel: { phone: 2, tablet: 2, desktop: 3 }, viewBasis: "" });
  assert.deepEqual(detailLevelPatch(null, stored, "phone", 1).detailLevel, { phone: 1 });
  assert.deepEqual(detailLevelPatch(null, stored, "phone", 3).detailLevel, { phone: 3 });
});

test("A2: Visa mer raises only the content level, and only on a phone with Visa allt off", () => {
  assert.deepEqual(displayLevelsFor({ phone: 1 }, 390, true, 844, { showMore: true }), { layout: 1, content: 3 }, "the app stays the app");
  assert.deepEqual(displayLevelsFor({ phone: 1 }, 844, true, 390, { showMore: true }), { layout: 1, content: 3 }, "also on its side");
  assert.equal(nativeModeFor(displayLevelsFor({ phone: 1 }, 390, true, 844, { showMore: true }).layout, 390, true), true, "Visa mer never turns the app off");
  assert.deepEqual(displayLevelsFor({ tablet: 2 }, 820, true, 1180, { showMore: true }), { layout: 2, content: 2 }, "not on a tablet");
  assert.deepEqual(displayLevelsFor({ desktop: 1 }, 1440, false, 900, { showMore: true }), { layout: 1, content: 1 }, "not in a computer's app column");
  assert.equal(offersShowMore({ phone: 1 }, 390, true, 844), true);
  assert.equal(offersShowMore(null, 390, true, 844), true, "a new person on a phone");
  assert.equal(offersShowMore({ phone: 3 }, 390, true, 844), false, "Visa allt already shows everything");
  assert.equal(offersShowMore({ phone: 2 }, 390, true, 844), false, "a saved Lagom is Visa allt");
  assert.equal(offersShowMore({ phone: 1 }, 390, true, 844, false), false, "signed out");
  assert.equal(offersShowMore({ tablet: 1 }, 820, true, 1180), false, "a tablet");
  assert.equal(offersShowMore({ desktop: 1 }, 1440, false, 900), false, "a computer");
});

test("A2: the button is shown only where it shows something, and can always be turned off again", () => {
  assert.equal(showMoreButtonShown({ offered: true, on: false, hasMore: true }), true);
  assert.equal(showMoreButtonShown({ offered: true, on: false, hasMore: false }), false, "nothing more on the page");
  assert.equal(showMoreButtonShown({ offered: true, on: true, hasMore: false }), true, "Visa mindre stays");
  assert.equal(showMoreButtonShown({ offered: false, on: true, hasMore: true }), false, "not offered (tablet, computer, Visa allt)");
  assert.equal(showMoreLabel(false), "Visa mer");
  assert.equal(showMoreLabel(true), "Visa mindre");
});

test("A2: Visa mer is remembered per page on the device, and a broken memory is nothing remembered", () => {
  assert.equal(showMorePage("work_orders"), "work_orders");
  assert.equal(showMorePage(null), "stats", "Hem without a view");
  assert.equal(showMorePage(""), "stats");
  assert.equal(showMorePage("x".repeat(61)), "stats");
  assert.deepEqual(parseShowMorePages(null), []);
  assert.deepEqual(parseShowMorePages("{"), [], "not JSON");
  assert.deepEqual(parseShowMorePages("{\"a\":1}"), [], "not a list");
  assert.deepEqual(parseShowMorePages("[\"settings\",3,\"\",\"settings\",\"tasks\"]"), ["settings", "tasks"]);
  let pages = withShowMorePage([], "settings", true);
  pages = withShowMorePage(pages, "tasks", true);
  assert.deepEqual(pages, ["settings", "tasks"]);
  assert.deepEqual(withShowMorePage(pages, "settings", true), ["tasks", "settings"], "the newest last");
  assert.deepEqual(withShowMorePage(pages, "settings", false), ["tasks"]);
  const many = Array.from({ length: SHOW_MORE_MAX_PAGES + 5 }, (_, index) => `p${index}`).reduce<string[]>((list, page) => withShowMorePage(list, page, true), []);
  assert.equal(many.length, SHOW_MORE_MAX_PAGES);
  assert.equal(many[0], "p5", "the oldest is forgotten first");
});

test("A2: in the app the pages and settings for a larger screen come back with Visa mer", () => {
  assert.equal(nativeHidesView(true, 1, "forms"), true, "Skapa formulär is left out at content level 1");
  assert.equal(nativeHidesView(true, 3, "forms"), false, "Visa mer draws it in the app");
  assert.equal(nativeHidesView(false, 1, "forms"), false, "the ordinary pages never leave it out");
  assert.equal(nativeHidesView(true, 1, "work_orders"), false, "the work is never left out");
  assert.equal(nativeSettingsHidden("theme", 1), true);
  assert.equal(nativeSettingsHidden("theme", 3), false);
  assert.equal(nativeSettingsHidden("profile", 1), false);
});

test("A2: the work views on a phone – Montör and Ledande montör the app, Arbetsledare the app with Visa allt", () => {
  const at = "2026-10-22T08:00:00.000Z";
  assert.deepEqual(workViewDefaults({ view: "fitter", setAt: at }).detailLevels, { phone: 1, tablet: 1, desktop: 3 });
  assert.deepEqual(workViewDefaults({ view: "lead", setAt: at }).detailLevels, { phone: 1, tablet: 3, desktop: 3 });
  assert.deepEqual(workViewDefaults({ view: "supervisor", setAt: at }).detailLevels, { phone: 3, tablet: 3, desktop: 3 });
  for (const view of ["fitter", "lead", "supervisor"] as const) {
    const levels = effectiveDetailLevels({ view, setAt: at }, null);
    assert.equal(displayLevelsFor(levels, 390, true, 844).layout, 1, `${view}: the app on the phone`);
    assert.equal(displayLevelsFor(levels, 390, true, 844).content, view === "supervisor" ? 3 : 1, `${view}: Visa allt`);
  }
});

// Inget blir onåbart (A2, 2026-10-22): what the app leaves out at content level 1 comes back with Visa mer on a phone.
test("A2: the app's slimmer variant is drawn only at content level 1", () => {
  assert.equal(nativeReduced(true, 1), true, "the app column, or a phone without Visa mer");
  assert.equal(nativeReduced(true, 3), false, "a phone with Visa mer or Visa allt: the ordinary part");
  assert.equal(nativeReduced(false, 1), false, "never outside the app");
  assert.equal(nativeReduced(false, 3), false);
  // The phone's own path: the app (layout 1) with content 1 or 3; the column is forced to content 1.
  const phone = (showMore: boolean) => displayLevelsFor({ phone: 1 }, 390, true, 844, { showMore }).content;
  assert.equal(nativeReduced(true, phone(false)), true);
  assert.equal(nativeReduced(true, phone(true)), false);
  assert.equal(nativeReduced(true, displayLevelsFor({ phone: 3 }, 390, true, 844).content), false, "Visa allt");
});

test("A2: the line under a slimmer app screen names Visa mer on a phone and display 2 in the app column", () => {
  const column = "Företagets inställningar finns i visning 2 (Lagom).";
  assert.equal(showMoreNote(true, column), SHOW_MORE_NOTE);
  assert.equal(SHOW_MORE_NOTE, "Fler val under Visa mer längst ned.");
  assert.ok(!/visning 2|Lagom/.test(SHOW_MORE_NOTE), "a phone has no display 2 to point to");
  assert.equal(showMoreNote(false, column), column, "the app column keeps its text");
});

test("A2: Mer keeps the pages for a larger screen with Visa mer or Visa allt", () => {
  const admin = { memberRole: "OWNER" as const, workflowPermissions: defaultWorkflowPermissionProfile(), ai: true, importPage: true, canBuildForms: true };
  const sections = nativeMoreSections(resolveMenu(admin, { hidden: [], shortcuts: [] }), { productAdmin: true });
  const keys = (content: 1 | 3) => nativeMoreTools(sections, content).flatMap((section) => section.rows.map((row) => row.key));
  for (const key of ["import", "forms", "customer_companies"]) {
    assert.ok(!keys(1).includes(key), `${key} left out at content 1`);
    assert.ok(keys(3).includes(key), `${key} in reach with Visa mer`);
  }
  assert.deepEqual(nativeMoreTools(sections), nativeMoreTools(sections, 1), "content 1 is the default");
  assert.equal(keys(3).at(-1), "logout");
  assert.equal(nativeVisibleSections([{ rows: [{ key: "import", label: "Import", type: "neutral", href: "/?view=import" }] }], 3).length, 1);
});
