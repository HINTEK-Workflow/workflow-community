import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  applyWorkflowPermissionToggle, defaultWorkflowPermissionProfile, mayBuildFormsWith, noWorkflowPermissionProfile, normalizeWorkflowPermissionProfile,
  workflowPermissionMatrix, workflowPermissionPresets, workflowPermissionProfileSchema, type WorkflowPermissionProfile,
} from "@/lib/workflow/permissions";
import { archiveReadableSubjects } from "@/lib/workflow/report-archive";
import { menuItemAllowed } from "@/lib/workflow/menu-items";

// Bygga formulär (2026-11-26: "admin kan styra vem som får göra det eftersom admin inte kan göra att åt alla i större bolag"):
// the admin gives the right to build and edit forms – also Skapa med AI – to the people who need it.

const read = (file: string) => readFileSync(file, "utf8");
const builder: WorkflowPermissionProfile = { version: 1, grants: ["form-builder:edit"] };
const field = workflowPermissionPresets.find((preset) => preset.id === "field")!.profile;

test("an admin or owner always builds forms, with or without the right", () => {
  assert.equal(mayBuildFormsWith({ admin: true, workflowPermissions: noWorkflowPermissionProfile(), cloud: true }), true);
  assert.equal(mayBuildFormsWith({ admin: true, workflowPermissions: builder, cloud: true }), true);
});

test("an employee without the right does not, with it does", () => {
  assert.equal(mayBuildFormsWith({ admin: false, workflowPermissions: noWorkflowPermissionProfile(), cloud: true }), false);
  // Filling in and completing forms (Formulär) is not building them.
  assert.equal(mayBuildFormsWith({ admin: false, workflowPermissions: field, cloud: true }), false);
  assert.equal(mayBuildFormsWith({ admin: false, workflowPermissions: builder, cloud: true }), true);
  assert.equal(mayBuildFormsWith({ admin: false, workflowPermissions: { version: 1, grants: [...field.grants, "form-builder:edit"] }, cloud: true }), true);
});

test("never in a company whose data is in its own file, not even for an admin", () => {
  assert.equal(mayBuildFormsWith({ admin: true, workflowPermissions: builder, cloud: false }), false);
  assert.equal(mayBuildFormsWith({ admin: false, workflowPermissions: builder, cloud: false }), false);
});

test("another company: the right belongs to one membership, and context reads only the active company's", () => {
  // The person has the right in company A but not in B: in B the profile is B's membership's (none), so no.
  const inB = normalizeWorkflowPermissionProfile(null);
  assert.equal(mayBuildFormsWith({ admin: false, workflowPermissions: inB, cloud: true }), false);
  const server = read("lib/kfid/server.ts");
  assert.match(server, /organizationId_userId: \{\s*organizationId: activeOrganizationId,/);
  assert.match(server, /workflowPermissions: normalizeWorkflowPermissionProfile\(membership\.workflowPermissions\)/);
});

test("an API or MCP key has its member's right and nothing more", () => {
  // mayBuildForms reads only the role, the rights and the storage – never ctx.integration – so a key is the person it acts for;
  // Workflow's originals are never changed through a key.
  const formServer = read("lib/kfid/form-server.ts");
  const rule = formServer.slice(formServer.indexOf("export const mayBuildForms"), formServer.indexOf("export function requireFormAdmin"));
  assert.doesNotMatch(rule, /integration/);
  assert.match(formServer, /if \(ctx\.user\.role !== "SUPERADMIN" \|\| viewAs \|\| ctx\.integration\) return false;/);
  assert.match(read("lib/kfid/server.ts"), /where: \{ id: principal\.actingUserId \}/);
});

test("the right is one checkbox with nothing it depends on, off by default, and in no preset but Full åtkomst", () => {
  assert.deepEqual(workflowPermissionMatrix["form-builder"], ["edit"]);
  assert.equal(workflowPermissionProfileSchema.safeParse(builder).success, true, "edit without a read right of its own is valid");
  assert.deepEqual(applyWorkflowPermissionToggle(noWorkflowPermissionProfile(), "form-builder", "edit", true).grants, ["form-builder:edit"]);
  assert.deepEqual(applyWorkflowPermissionToggle(builder, "form-builder", "edit", false).grants, []);
  assert.equal(noWorkflowPermissionProfile().grants.includes("form-builder:edit"), false);
  assert.equal(normalizeWorkflowPermissionProfile(undefined).grants.includes("form-builder:edit"), false);
  for (const preset of workflowPermissionPresets) assert.equal((preset.profile.grants as readonly string[]).includes("form-builder:edit"), preset.id === "full", preset.id);
  assert.equal(defaultWorkflowPermissionProfile().grants.includes("form-builder:edit"), true);
  // The other areas still need what they always needed.
  assert.equal(workflowPermissionProfileSchema.safeParse({ version: 1, grants: ["forms:edit"] }).success, false);
});

test("it opens no reports and no other area", () => {
  assert.equal(archiveReadableSubjects(() => true).includes("form-builder"), false);
});

test("the menu offers Skapa formulär and Import by the same answer", () => {
  const access = { memberRole: "MEMBER" as const, workflowPermissions: builder, importPage: true };
  assert.equal(menuItemAllowed("forms", { ...access, canBuildForms: true }), true);
  assert.equal(menuItemAllowed("forms", { ...access, canBuildForms: false }), false);
  assert.equal(menuItemAllowed("import", { ...access, canBuildForms: true }), true);
});

test("every place that offers building uses the one rule", () => {
  assert.match(read("lib/help/help-access.ts"), /canBuildForms: mayBuildFormsWith\(/);
  const workspace = read("features/kfid/workspace.tsx");
  assert.match(workspace, /const shownBuildForms = user\?\.canBuildForms \?\? Boolean\(overview && mayBuildFormsWith\(/);
  assert.match(workspace, /<ImportPage canBuildForms=\{shownBuildForms\}/);
  assert.match(workspace, /canBuildForms=\{shownBuildForms\} canEditValues/);
  assert.doesNotMatch(workspace, /canBuildForms=\{Boolean\(overview\?\.admin/);
  // The admin page labels the right in its own words.
  assert.match(read("features/kfid/administration-users.tsx"), /"form-builder": "Bygga formulär"/);
});
