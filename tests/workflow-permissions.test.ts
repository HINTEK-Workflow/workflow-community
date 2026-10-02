import assert from "node:assert/strict";
import test from "node:test";
import {
  applyWorkflowPermissionToggle,
  defaultWorkflowPermissionProfile,
  hasWorkflowPermission,
  noWorkflowPermissionProfile,
  normalizeWorkflowPermissionProfile,
  workflowSubjectForTask,
  workflowPermissionPresets,
  type WorkflowPermissionProfile,
} from "../lib/workflow/permissions";

test("an employee without a saved profile may do nothing until an admin grants it (2026-09-27)", () => {
  const profile = normalizeWorkflowPermissionProfile(null);
  assert.deepEqual(profile, noWorkflowPermissionProfile());
  assert.equal(hasWorkflowPermission(profile, "kfid", "create"), false);
  assert.equal(hasWorkflowPermission(profile, "forms", "edit"), false);
  assert.equal(hasWorkflowPermission(profile, "projects", "read"), false);
  assert.equal(defaultWorkflowPermissionProfile().grants.length > 0, true, "the full profile still exists for admins and Local");
});

test("an explicit empty profile denies every module action", () => {
  const profile = normalizeWorkflowPermissionProfile({ version: 1, grants: [] });
  assert.equal(hasWorkflowPermission(profile, "projects", "read"), false);
  assert.equal(hasWorkflowPermission(profile, "kfid", "create"), false);
});

test("a malformed stored profile fails closed", () => {
  const profile = normalizeWorkflowPermissionProfile({ version: 2, grants: ["projects:read"] });
  assert.deepEqual(profile, { version: 1, grants: [] });
});

test("a limited profile only grants its selected actions", () => {
  const profile = normalizeWorkflowPermissionProfile({
    version: 1,
    grants: ["projects:read", "risk-assessment:read", "risk-assessment:edit"],
  });
  assert.equal(hasWorkflowPermission(profile, "projects", "read"), true);
  assert.equal(hasWorkflowPermission(profile, "projects", "edit"), false);
  assert.equal(hasWorkflowPermission(profile, "risk-assessment", "edit"), true);
  assert.equal(hasWorkflowPermission(profile, "risk-assessment", "complete"), false);
});

test("task kinds map to their shared permission subjects", () => {
  assert.equal(workflowSubjectForTask("WORK_ORDER"), "work-order");
  assert.equal(workflowSubjectForTask("RISK_ASSESSMENT"), "risk-assessment");
  assert.equal(workflowSubjectForTask("COMMISSIONING_CONTROL"), "kfid");
});

test("permission presets are valid and cover common member access levels", () => {
  assert.deepEqual(workflowPermissionPresets.map((preset) => preset.id), ["full", "field", "report", "none"]);
  const field = workflowPermissionPresets.find((preset) => preset.id === "field")!.profile;
  assert.equal(hasWorkflowPermission(field, "work-order", "complete"), true);
  assert.equal(hasWorkflowPermission(field, "projects", "archive"), false);
  const report = workflowPermissionPresets.find((preset) => preset.id === "report")!.profile;
  assert.equal(hasWorkflowPermission(report, "risk-assessment", "report"), true);
  assert.equal(hasWorkflowPermission(report, "risk-assessment", "edit"), false);
});

// 2026-10-02 (decision 2.2, the simulation): the customer register follows a real permission, governed by the
// admin like any other module, instead of being open to every member whatever their preset.
test("the customer register follows its own permission, on for Full and Utföra arbete, read-only for Läsa och rapportera", () => {
  const field = workflowPermissionPresets.find((preset) => preset.id === "field")!.profile;
  assert.equal(hasWorkflowPermission(field, "customers", "edit"), true);
  assert.equal(hasWorkflowPermission(field, "customers", "archive"), false);
  const report = workflowPermissionPresets.find((preset) => preset.id === "report")!.profile;
  assert.equal(hasWorkflowPermission(report, "customers", "read"), true);
  assert.equal(hasWorkflowPermission(report, "customers", "edit"), false);
  assert.equal(hasWorkflowPermission(report, "customers", "create"), false);
  const none = workflowPermissionPresets.find((preset) => preset.id === "none")!.profile;
  assert.equal(hasWorkflowPermission({ version: 1, grants: [...none.grants] }, "customers", "read"), false);
  assert.equal(defaultWorkflowPermissionProfile().grants.includes("customers:edit"), true, "Full åtkomst still includes it");
});

test("permission toggles add prerequisites and remove dependent actions", () => {
  let profile: WorkflowPermissionProfile = { version: 1, grants: [] };
  profile = applyWorkflowPermissionToggle(profile, "work-order", "complete", true);
  assert.deepEqual(profile.grants.sort(), ["work-order:complete", "work-order:edit", "work-order:read"]);
  profile = applyWorkflowPermissionToggle(profile, "work-order", "edit", false);
  assert.deepEqual(profile.grants, ["work-order:read"]);
});

test("inconsistent stored permission dependencies fail closed", () => {
  const profile = normalizeWorkflowPermissionProfile({ version: 1, grants: ["work-order:complete"] });
  assert.deepEqual(profile, { version: 1, grants: [] });
});
