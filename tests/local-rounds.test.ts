import assert from "node:assert/strict";
import test from "node:test";
import { createLocalWorkspace, parseLocalWorkspace, removeLocalFormSchedule, saveLocalCustomerFacility, saveLocalFormLimitProfile, saveLocalFormSchedule, type LocalWorkspaceDocument } from "../features/kfid/local-workspace-store";

const CUSTOMER = "5b0d3a52-5d8e-4c3b-9d38-1f6f3c0d7a11";

/** Local (the .hwf file) keeps limit profiles and round schedules with the same rules as Cloud (2026-09-28). */
function workspaceWithFacility() {
  const now = new Date().toISOString();
  let workspace: LocalWorkspaceDocument = createLocalWorkspace({ id: "org-local", name: "Elkraft" });
  workspace = { ...workspace, customers: [{ id: CUSTOMER, name: "Kraftbolaget", company: "Kraftbolaget AB", address: "", postalCode: "", city: "", email: "", phone: "", mobile: "", lat: null, lng: null, notes: "", version: 1, deletedAt: null, createdAt: now, updatedAt: now }] } as LocalWorkspaceDocument;
  workspace = saveLocalCustomerFacility(workspace, CUSTOMER, { facility: { name: "Forsen kraftstation", address: "", postalCode: "", city: "", description: "" } });
  return { workspace, facilityId: workspace.customerFacilities[0].id };
}

test("an older file without profiles and schedules opens, and a new one round-trips them", () => {
  const { workspace, facilityId } = workspaceWithFacility();
  const older = { ...workspace } as Record<string, unknown>;
  delete older.formLimitProfiles;
  delete older.formSchedules;
  const opened = parseLocalWorkspace(older, "org-local");
  assert.deepEqual(opened.formLimitProfiles, []);
  assert.deepEqual(opened.formSchedules, []);
  const withProfile = saveLocalFormLimitProfile(workspace, { templateId: "vattenkraft", facilityId, objectName: "", values: { lagertemp: { low: null, high: 80, warnLow: null, warnHigh: 70, source: "Tillverkaren" } } }, "vattenkraft", "Ägaren");
  const { workspace: withSchedule, id } = saveLocalFormSchedule(withProfile, { title: "Daglig tillsyn", templateId: "vattenkraft", customerId: null, facilityId, projectId: null, assignedToUserId: null, assignedToName: "", active: true, rule: { frequency: "DAILY", interval: 1, weekdays: [], startDate: "2026-09-28", endDate: "" } }, "Daglig tillsyn – vattenkraft");
  const again = parseLocalWorkspace(JSON.parse(JSON.stringify(withSchedule)), "org-local");
  assert.equal(again.formLimitProfiles[0].values.lagertemp.high, 80);
  assert.equal(again.formSchedules[0].id, id);
  assert.equal(again.formSchedules[0].customerId, CUSTOMER, "the facility decides the customer");
});

test("profiles are versioned per facility and object, schedules are validated and removed softly", () => {
  const { workspace, facilityId } = workspaceWithFacility();
  const first = saveLocalFormLimitProfile(workspace, { templateId: "f", facilityId, objectName: "G1", values: {} }, "f");
  const second = saveLocalFormLimitProfile(first, { templateId: "f", facilityId, objectName: "G1", version: 1, values: { niva: { low: 1, high: 2, warnLow: null, warnHigh: null, source: "" } } }, "f");
  assert.equal(second.formLimitProfiles.length, 1);
  assert.equal(second.formLimitProfiles[0].version, 2);
  assert.throws(() => saveLocalFormLimitProfile(second, { templateId: "f", facilityId, objectName: "G1", version: 1, values: {} }, "f"), /annan flik/);
  assert.throws(() => saveLocalFormLimitProfile(second, { templateId: "f", facilityId: "saknas", objectName: "", values: {} }, "f"), /Anläggningen/);
  assert.throws(() => saveLocalFormSchedule(workspace, { title: "", templateId: "f", customerId: null, facilityId: null, projectId: null, assignedToUserId: null, assignedToName: "", active: true, rule: { frequency: "DAILY", interval: 1, weekdays: [], startDate: "2026-09-28", endDate: "" } }, "f"));
  const { workspace: planned, id } = saveLocalFormSchedule(workspace, { title: "Provkörning", templateId: "f", customerId: null, facilityId, projectId: null, assignedToUserId: null, assignedToName: "", active: true, rule: { frequency: "WEEKLY", interval: 1, weekdays: [3], startDate: "2026-09-28", endDate: "" } }, "Reservkraft");
  const removed = removeLocalFormSchedule(planned, id);
  assert.ok(removed.formSchedules[0].deletedAt);
  assert.throws(() => removeLocalFormSchedule(removed, id), /hittades inte/);
});
