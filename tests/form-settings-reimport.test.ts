import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { conflictObjectName, planLimitProfileReimport, planScheduleReimport, sameLimitValues, scheduleConflictTitle } from "../lib/kfid/form-settings-reimport";
import { createLocalWorkspace, removeLocalFormSchedule, saveLocalCustomerRecord, saveLocalFormLimitProfile, saveLocalFormSchedule } from "../features/kfid/local-workspace-store";

/** Återimport of limit profiles and round schedules (2026-10-06): the same rule as the other records – never silent. */
const origin = { id: "cloud-1", version: 3 };
const values = { temp: { low: 1, high: 5 } };

test("a limit profile updates Cloud only when Cloud still has the exported version", () => {
  assert.equal(planLimitProfileReimport({ version: 3, values, cloudOrigin: origin }, { version: 3, values }, { values }), "UNCHANGED");
  assert.equal(planLimitProfileReimport({ version: 4, values, cloudOrigin: origin }, { version: 3, values: {} }, { values: {} }), "UPDATE");
  assert.equal(planLimitProfileReimport({ version: 4, values, cloudOrigin: origin }, { version: 5, values: {} }, { values: {} }), "COPY_CONFLICT");
  assert.equal(planLimitProfileReimport({ version: 4, values, cloudOrigin: origin }, { version: 5, values: { temp: { high: 5, low: 1 } } }, null), "UNCHANGED", "the same values in another key order");
  // New in Local, or its Cloud profile is gone or on another place: created, or a copy when the key is taken.
  assert.equal(planLimitProfileReimport({ version: 1, values }, null, null), "CREATE");
  assert.equal(planLimitProfileReimport({ version: 1, values }, null, { values: { temp: { low: 2 } } }), "COPY_CONFLICT");
  assert.equal(planLimitProfileReimport({ version: 2, values, cloudOrigin: origin }, null, { values }), "UNCHANGED");
  assert.equal(sameLimitValues(undefined, {}), true);
});

test("a round schedule is written only when the file changed it, and a both-sides change becomes a copy", () => {
  const local = (version: number, deletedAt: string | null = null) => ({ version, deletedAt, cloudOrigin: origin });
  assert.equal(planScheduleReimport(local(3), { version: 3, deletedAt: null }), "UNCHANGED");
  assert.equal(planScheduleReimport(local(3), { version: 7, deletedAt: null }), "UNCHANGED", "Cloud's newer round is kept as it is");
  assert.equal(planScheduleReimport(local(4), { version: 3, deletedAt: null }), "UPDATE");
  assert.equal(planScheduleReimport(local(4), { version: 4, deletedAt: null }), "COPY_CONFLICT");
  assert.equal(planScheduleReimport(local(4), null), "COPY_CONFLICT", "a round removed (or from another company) is never revived in place");
  assert.equal(planScheduleReimport(local(4, "2026-10-06T08:00:00.000Z"), { version: 3, deletedAt: null }), "DELETE");
  assert.equal(planScheduleReimport(local(4, "2026-10-06T08:00:00.000Z"), { version: 4, deletedAt: null }), "KEEP_CLOUD");
  assert.equal(planScheduleReimport({ version: 1, deletedAt: null }, null), "CREATE");
  assert.equal(planScheduleReimport({ version: 2, deletedAt: "2026-10-06T08:00:00.000Z" }, null), "UNCHANGED");
});

test("conflict names stay within the limits and never reuse a taken name", () => {
  const taken = new Set(["Pump (konfliktkopia)"]);
  assert.equal(conflictObjectName("Pump", (name) => taken.has(name)), "Pump (konfliktkopia 2)");
  assert.equal(conflictObjectName("", () => false), "(konfliktkopia)");
  assert.ok(conflictObjectName("x".repeat(120), () => false).length <= 120);
  assert.ok(scheduleConflictTitle("y".repeat(200)).length <= 200);
});

test("the file keeps the Cloud origin of a profile and a schedule through edits and removal", () => {
  let workspace = createLocalWorkspace({ id: "org", name: "QA" });
  const customer = saveLocalCustomerRecord(workspace, { name: "Kund", company: "QA" });
  workspace = customer.workspace;
  const stamp = "2026-10-06T08:00:00.000Z";
  workspace.customerFacilities = [{ ...structuredClone(workspace.customerFacilities[0] ?? {}), id: "place", customerId: customer.customer.id, name: "Station", kind: "FACILITY", code: "", parentId: null, latitude: null, longitude: null, address: "", postalCode: "", city: "", description: "", isActive: true, version: 1, createdAt: stamp, updatedAt: stamp } as (typeof workspace.customerFacilities)[number]];
  workspace.formLimitProfiles = [{ id: "p", templateId: "form", facilityId: "place", objectName: "", values: {}, version: 3, updatedAt: stamp, updatedByName: "", cloudOrigin: origin }];
  workspace = saveLocalFormLimitProfile(workspace, { templateId: "form", facilityId: "place", objectName: "", values: { temp: { low: 1, high: 2, warnLow: null, warnHigh: null, source: "" } } }, "form");
  assert.deepEqual(workspace.formLimitProfiles[0].cloudOrigin, origin);
  assert.equal(workspace.formLimitProfiles[0].version, 4);
  workspace.formSchedules = [{ id: "s", version: 3, title: "Rond", templateId: "form", customerId: null, facilityId: null, projectId: null, assignedToUserId: null, assignedToName: "", active: true,
    rule: { frequency: "DAILY", interval: 1, weekdays: [], startDate: "2026-10-01", endDate: "" }, reminders: { bell: true, email: false }, templateName: "", deletedAt: null, createdAt: stamp, updatedAt: stamp, cloudOrigin: origin }];
  workspace = saveLocalFormSchedule(workspace, { ...workspace.formSchedules[0], title: "Ny titel" }, "Formulär").workspace;
  assert.deepEqual(workspace.formSchedules[0].cloudOrigin, origin);
  workspace = removeLocalFormSchedule(workspace, "s");
  assert.deepEqual(workspace.formSchedules[0].cloudOrigin, origin);
  assert.ok(workspace.formSchedules[0].deletedAt && workspace.formSchedules[0].version === 5);
});

test("the export marks profiles and schedules with their Cloud origin and the import is bound to the organization", () => {
  const exporter = readFileSync("lib/kfid/cloud-export.ts", "utf8");
  assert.match(exporter, /cloudOrigin: \{ id: profile\.id, version: profile\.version \}/);
  assert.match(exporter, /cloudOrigin: \{ id: schedule\.id, version: schedule\.version \}/);
  const importer = readFileSync("lib/kfid/cloud-import-form-settings.ts", "utf8");
  for (const call of importer.match(/db\.(formLimitProfile|formSchedule|customerFacility)\.\w+\(\{ where: [^\n]+/g) ?? []) assert.match(call, /organizationId/, call);
  assert.match(importer, /visibleFormsWhere\(organizationId\)/);
  assert.match(readFileSync("lib/kfid/cloud-import.ts", "utf8"), /importFormSettings\(tx, \{ organizationId: input\.organizationId/);
});
