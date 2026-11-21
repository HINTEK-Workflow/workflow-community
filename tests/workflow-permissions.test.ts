import assert from "node:assert/strict";
import test from "node:test";
import {
  applyWorkflowPermissionToggle,
  canViewEconomy,
  canViewTeam,
  WORKFLOW_PERMISSION_SUBJECTS,
  workflowPermissionMatrix,
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

// Dashboard etapp 1 (2026-10-28): Teamet and Ekonomi are two separate read rights in the same model, opt-in.
test("Teamet and Ekonomi are two separate read rights, in no preset but Full åtkomst", () => {
  assert.equal(WORKFLOW_PERMISSION_SUBJECTS.includes("team"), true);
  assert.equal(WORKFLOW_PERMISSION_SUBJECTS.includes("economy"), true);
  assert.deepEqual(workflowPermissionMatrix.team, ["read"]);
  assert.deepEqual(workflowPermissionMatrix.economy, ["read"]);
  for (const id of ["field", "report", "none"] as const) {
    const preset = workflowPermissionPresets.find((item) => item.id === id)!.profile;
    const profile: WorkflowPermissionProfile = { version: 1, grants: [...preset.grants] };
    assert.equal(hasWorkflowPermission(profile, "team", "read"), false, `${id} does not include Teamet`);
    assert.equal(hasWorkflowPermission(profile, "economy", "read"), false, `${id} does not include Ekonomi`);
  }
  const full = workflowPermissionPresets.find((preset) => preset.id === "full")!.profile;
  assert.equal(hasWorkflowPermission(full, "team", "read") && hasWorkflowPermission(full, "economy", "read"), true);
  // Only read exists: a stored team:edit or economy:report is not a valid profile and fails closed.
  assert.deepEqual(normalizeWorkflowPermissionProfile({ version: 1, grants: ["team:read", "team:edit"] }), { version: 1, grants: [] });
  assert.deepEqual(normalizeWorkflowPermissionProfile({ version: 1, grants: ["economy:report"] }), { version: 1, grants: [] });
});

test("canViewTeam and canViewEconomy: admins, or exactly the granted right, never the other one", () => {
  const member = (grants: string[]) => ({ admin: false, workflowPermissions: normalizeWorkflowPermissionProfile({ version: 1, grants }) });
  assert.equal(canViewTeam(member([])), false, "a member without a grant sees no team");
  assert.equal(canViewEconomy(member([])), false, "a member without a grant sees no economy");
  assert.equal(canViewTeam(member(["team:read"])), true);
  assert.equal(canViewEconomy(member(["team:read"])), false, "Teamet does not give Ekonomi");
  assert.equal(canViewEconomy(member(["economy:read"])), true);
  assert.equal(canViewTeam(member(["economy:read"])), false, "Ekonomi does not give Teamet");
  // Module rights and price rights give neither (the amounts' own right stays separate).
  const field = workflowPermissionPresets.find((preset) => preset.id === "field")!.profile;
  const fieldWithPrices = member([...field.grants, "quotes:read", "catalogue:read", "catalogue:edit"]);
  assert.equal(fieldWithPrices.workflowPermissions.grants.includes("quotes:read"), true, "the profile itself is valid");
  assert.equal(canViewTeam(fieldWithPrices), false);
  assert.equal(canViewEconomy(fieldWithPrices), false);
  // A team:read member keeps no module right from it.
  assert.equal(hasWorkflowPermission(member(["team:read"]).workflowPermissions, "projects", "read"), false);
  assert.equal(canViewTeam({ admin: true, workflowPermissions: { version: 1, grants: [] } }), true, "admins see Teamet by role");
  assert.equal(canViewEconomy({ admin: true, workflowPermissions: { version: 1, grants: [] } }), true, "admins see Ekonomi by role");
});

test("the Teamet and Ekonomi toggles only add and remove themselves", () => {
  let profile: WorkflowPermissionProfile = { version: 1, grants: [] };
  profile = applyWorkflowPermissionToggle(profile, "team", "read", true);
  assert.deepEqual(profile.grants, ["team:read"]);
  profile = applyWorkflowPermissionToggle(profile, "economy", "read", true);
  assert.deepEqual([...profile.grants].sort(), ["economy:read", "team:read"]);
  profile = applyWorkflowPermissionToggle(profile, "team", "read", false);
  assert.deepEqual(profile.grants, ["economy:read"]);
});
