import assert from "node:assert/strict";
import test from "node:test";
import {
  effectiveDetailLevels, nextWorkViewSetting, personalChoicesCount, readWorkView, withWorkView, workListStartScope, workViewDefaults, workViewStamp,
} from "../lib/workflow/work-view";
import { canViewEconomy, canViewTeam, normalizeWorkflowPermissionProfile, workflowPermissionPresets, hasWorkflowPermission } from "../lib/workflow/permissions";
import { preferencesSchema } from "../lib/kfid/preferences";
import { parseWorkListPrefs, resolveWorkListScope } from "../lib/workflow/work-list";

const fitter = { view: "fitter" as const, setAt: "2026-10-08T08:00:00.000Z" };
const supervisor = { view: "supervisor" as const, setAt: "2026-10-08T09:00:00.000Z" };

// Arbetsvy (2026-10-08): the admin's view sets the defaults; without one everything is as before.
test("each work view has its own defaults; no view keeps today's", () => {
  assert.deepEqual(workViewDefaults(null), { detailLevels: { phone: 1, tablet: 2, desktop: 3 }, executionFirst: true, openSelfInspection: false, menuGroupsOpen: false, listScope: "mine" });
  assert.deepEqual(workViewDefaults(fitter).detailLevels, { phone: 1, tablet: 2, desktop: 3 }, "A2: the app on the phone");
  assert.equal(workViewDefaults(fitter).executionFirst, true);
  assert.equal(workViewDefaults({ view: "lead", setAt: "x" }).openSelfInspection, true);
  assert.equal(workViewDefaults(supervisor).executionFirst, false, "Arbetsledare keeps the planning first");
  assert.equal(workViewDefaults(supervisor).menuGroupsOpen, true);
  assert.equal(workViewDefaults(supervisor).listScope, "all");
  assert.deepEqual(workViewDefaults({ view: null, setAt: "x" }), workViewDefaults(null), "a view taken away is the plain default");
});

test("the person's own display levels count only under the view they were chosen under", () => {
  // Chosen before any work view existed: kept while the admin has chosen none.
  assert.deepEqual(effectiveDetailLevels(null, { detailLevel: { phone: 1, tablet: 1, desktop: 1 } }), { phone: 1, tablet: 1, desktop: 1 });
  // The admin then chooses a view: the old choice no longer bypasses it.
  assert.deepEqual(effectiveDetailLevels(fitter, { detailLevel: { phone: 3, tablet: 3 } }), { phone: 1, tablet: 2, desktop: 3 });
  // Chosen under the current view: the person's own levels.
  assert.deepEqual(effectiveDetailLevels(fitter, { detailLevel: { phone: 1, tablet: 3 }, viewBasis: fitter.setAt }), { phone: 1, tablet: 3, desktop: 3 });
  // The admin changes the view again: the choice made under the earlier view is reset.
  assert.deepEqual(effectiveDetailLevels(supervisor, { detailLevel: { phone: 1, tablet: 1 }, viewBasis: fitter.setAt }), { phone: 3, tablet: 3, desktop: 3 });
  // Återställ till standard (basis null): the view's defaults, also without a view.
  assert.deepEqual(effectiveDetailLevels(fitter, { detailLevel: { phone: 1, tablet: 1 }, viewBasis: null }), { phone: 1, tablet: 2, desktop: 3 });
  assert.deepEqual(effectiveDetailLevels(null, { detailLevel: { phone: 1, tablet: 1 }, viewBasis: null }), { phone: 1, tablet: 2, desktop: 3 });
  // Nothing saved at all.
  assert.deepEqual(effectiveDetailLevels(null, null), { phone: 1, tablet: 2, desktop: 3 });
  assert.equal(personalChoicesCount(undefined, null), true);
  assert.equal(personalChoicesCount(undefined, fitter), false);
  assert.equal(personalChoicesCount("", { view: null, setAt: "2026-10-08T10:00:00.000Z" }), false, "removing the view is a change too");
});

test("Mina or Alla starts from the view unless chosen under it, and Alla only where the person may read the area", () => {
  assert.equal(workListStartScope({}, supervisor), "all");
  assert.equal(workListStartScope({ scope: "mine" }, supervisor), "all", "a scope chosen before the view does not count");
  assert.equal(workListStartScope({ scope: "mine", basis: supervisor.setAt }, supervisor), "mine");
  assert.equal(workListStartScope({ scope: "all" }, null), "all", "without a view the remembered scope stays");
  assert.equal(workListStartScope({}, null), "mine");
  // The view never widens access: without read permission in the area the list stays Mina.
  assert.equal(resolveWorkListScope(workListStartScope({}, supervisor), ["mine"]), "mine");
  assert.deepEqual(parseWorkListPrefs(JSON.stringify({ scope: "all", basis: fitter.setAt, view: "cards" })), { scope: "all", basis: fitter.setAt, view: "cards" });
});

test("the admin's save: a new stamp only when the view changes or the person's choices are reset", () => {
  const now = new Date("2026-10-08T12:00:00.000Z");
  assert.equal(nextWorkViewSetting(fitter, undefined, false, now), undefined, "saving permissions only keeps the view and its stamp");
  assert.equal(nextWorkViewSetting(fitter, "fitter", false, now), undefined, "the same view keeps the person's choices");
  assert.deepEqual(nextWorkViewSetting(fitter, "lead", false, now), { view: "lead", setAt: now.toISOString() });
  assert.deepEqual(nextWorkViewSetting(fitter, null, false, now), { view: null, setAt: now.toISOString() });
  assert.deepEqual(nextWorkViewSetting(fitter, undefined, true, now), { view: "fitter", setAt: now.toISOString() }, "Återställ personens val");
  assert.equal(nextWorkViewSetting(null, null, false, now), undefined, "no view to no view is no change");
  assert.notEqual(workViewStamp(nextWorkViewSetting(fitter, "lead", false, now)), workViewStamp(fitter));
});

test("a work view is stored beside the permissions and never changes them", () => {
  const field = workflowPermissionPresets.find((preset) => preset.id === "field")!.profile;
  const record = withWorkView(field, fitter);
  assert.deepEqual(readWorkView(record), fitter);
  assert.deepEqual(normalizeWorkflowPermissionProfile(record), { version: 1, grants: field.grants }, "the permission profile reads exactly as before");
  assert.equal(hasWorkflowPermission(normalizeWorkflowPermissionProfile(withWorkView({ version: 1, grants: [] }, supervisor)), "projects", "read"), false, "Arbetsledare as a view grants nothing");
  assert.deepEqual(withWorkView(record, null), field, "removing the view leaves the profile");
  assert.equal(readWorkView(null), null);
  assert.equal(readWorkView({ workView: { view: "boss", setAt: "x" } })?.view, null, "an unknown view is no view");
  assert.equal(readWorkView({ workView: { view: "fitter" } }), null, "a view without a stamp is ignored");
});

// 2026-10-28: a work view never grants Teamet or Ekonomi, and an admin who chooses Montör keeps the admin rights.
test("no work view grants Teamet or Ekonomi; an admin in the Montör view is still admin", () => {
  for (const view of ["fitter", "lead", "supervisor"] as const) {
    const profile = normalizeWorkflowPermissionProfile(withWorkView({ version: 1, grants: [] }, { view, setAt: "2026-10-28T08:00:00.000Z" }));
    assert.equal(canViewTeam({ admin: false, workflowPermissions: profile }), false, `${view} gives no Teamet`);
    assert.equal(canViewEconomy({ admin: false, workflowPermissions: profile }), false, `${view} gives no Ekonomi`);
  }
  const adminInFitterView = { admin: true, workflowPermissions: normalizeWorkflowPermissionProfile(withWorkView({ version: 1, grants: [] }, fitter)) };
  assert.equal(canViewTeam(adminInFitterView), true);
  assert.equal(canViewEconomy(adminInFitterView), true);
  // A granted right survives a view change: the view is stored beside it and never touches it.
  const granted = withWorkView({ version: 1, grants: ["team:read"] }, supervisor);
  assert.equal(canViewTeam({ admin: false, workflowPermissions: normalizeWorkflowPermissionProfile(withWorkView(granted, fitter)) }), true);
});

test("preferences keep the basis of the person's own display level", () => {
  assert.equal(preferencesSchema.parse({}).viewBasis, undefined);
  assert.equal(preferencesSchema.parse({ viewBasis: fitter.setAt }).viewBasis, fitter.setAt);
  assert.equal(preferencesSchema.parse({ viewBasis: null }).viewBasis, null);
  assert.equal(preferencesSchema.parse({ viewBasis: 42 }).viewBasis, undefined);
});
