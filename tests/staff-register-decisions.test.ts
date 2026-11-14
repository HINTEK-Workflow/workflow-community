import assert from "node:assert/strict";
import test from "node:test";
import { disclosureAuditDetail, disclosureInputSchema, disclosureRefusal, STAFF_REGISTER_WRITE_PAUSED, staffRegisterWriteAllowed } from "../lib/staff-register/model";
import {
  canSwitchStaffRegister, EMPTY_STAFF_REGISTER, importedStaffRegister, keepsWorkflowRegister, STAFF_REGISTER_SCOPE_HINT,
  staffRegisterActivationChange, staffRegisterInputSchema,
} from "../lib/workflow/staff-register";

// 2026-10-09 evening: three decisions on the staff register.
const site = { required: true, inWorkflow: false, siteId: "AB12-3456", builder: "Brf Exempel", system: "" };
const workflow = { ...site, inWorkflow: true };

test("1. the register is never switched on by itself; only the responsible person or an admin switches it", () => {
  assert.equal(keepsWorkflowRegister({ staffRegister: staffRegisterInputSchema.parse({}) }), false, "a new project starts without it");
  assert.equal(keepsWorkflowRegister({ staffRegister: EMPTY_STAFF_REGISTER }), false);
  assert.equal(staffRegisterActivationChange(EMPTY_STAFF_REGISTER, workflow), "on");
  assert.equal(staffRegisterActivationChange(workflow, site), "off");
  assert.equal(staffRegisterActivationChange(workflow, { ...workflow, required: false }), "off", "unticking Personalliggare krävs switches it off");
  assert.equal(staffRegisterActivationChange(workflow, { ...workflow, builder: "Annan" }), null, "other fields are not an activation");
  assert.equal(staffRegisterActivationChange(EMPTY_STAFF_REGISTER, site), null, "steg 0 (system on site) is not Workflow's register");

  const base = { userId: "u1", responsibleUserId: "u1", canEditProjects: true };
  assert.equal(canSwitchStaffRegister({ ...base, admin: false }), true, "the responsible member with edit rights");
  assert.equal(canSwitchStaffRegister({ ...base, admin: false, canEditProjects: false }), false, "being responsible alone grants nothing");
  assert.equal(canSwitchStaffRegister({ ...base, admin: false, responsibleUserId: "u2" }), false, "another member");
  assert.equal(canSwitchStaffRegister({ ...base, admin: false, responsibleUserId: null }), false, "no responsible person");
  assert.equal(canSwitchStaffRegister({ ...base, admin: true, responsibleUserId: null, canEditProjects: false }), true, "a company admin");
  assert.ok(STAFF_REGISTER_SCOPE_HINT.length < 120 && !/§|kap\./.test(STAFF_REGISTER_SCOPE_HINT), "one neutral line without law text");
});

test("1. an import never switches Workflow's register on and never switches it off", () => {
  assert.deepEqual(importedStaffRegister(workflow), site, "an imported file asking for it gets steg 0");
  assert.deepEqual(importedStaffRegister({ ...site, system: "X" }), { ...site, system: "X" });
  assert.deepEqual(importedStaffRegister(EMPTY_STAFF_REGISTER, workflow), workflow, "a project keeping it keeps it");
  assert.deepEqual(importedStaffRegister(workflow, site), site);
  assert.deepEqual(importedStaffRegister(undefined), EMPTY_STAFF_REGISTER);
});

test("2–3. new rows only when Cloud writing is available or paused for an overdue invoice", () => {
  assert.equal(staffRegisterWriteAllowed({ allowed: true, reason: "AVAILABLE" }), true);
  assert.equal(staffRegisterWriteAllowed({ allowed: false, reason: "PAYMENT_OVERDUE" }), true, "an overdue invoice is the only exemption");
  assert.equal(staffRegisterWriteAllowed({ allowed: false, reason: "NO_VALID_CLOUD_RIGHT" }), false, "an ended agreement stops new rows");
  assert.equal(staffRegisterWriteAllowed({ allowed: false, reason: "SOMETHING_ELSE" }), false, "any other reason blocks too");
  assert.match(STAFF_REGISTER_WRITE_PAUSED, /läsas och exporteras/);
});

test("3. Personalliggare på begäran: superadmin only, inactive companies only, always with a reason", () => {
  assert.equal(disclosureRefusal({ superadmin: true, companyActive: false }), null);
  assert.match(disclosureRefusal({ superadmin: false, companyActive: false }) ?? "", /Systemadministratör/);
  assert.match(disclosureRefusal({ superadmin: true, companyActive: true }) ?? "", /aktivt/);
  const base = { organizationId: "o", projectId: "p" };
  assert.equal(disclosureInputSchema.safeParse({ ...base, reason: "kort" }).success, false, "a reason is required");
  assert.equal(disclosureInputSchema.safeParse({ ...base }).success, false);
  assert.equal(disclosureInputSchema.parse({ ...base, reason: "  Begäran från Skatteverket  " }).reason, "Begäran från Skatteverket");
  assert.equal(disclosureAuditDetail({ rows: 2, siteId: "AB1", reason: "Begäran\nfrån Skatteverket" }),
    "Personalliggaren lämnades ut på begäran av installationens superadmin: 2 rader för byggarbetsplats AB1. Skäl: Begäran från Skatteverket");
});
