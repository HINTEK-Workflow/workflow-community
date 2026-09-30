import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocalWorkspace, parseLocalWorkspace, saveLocalControlRecord } from "../features/kfid/local-workspace-store";
import { planCloudControlReimport, planCloudReimport } from "../lib/kfid/cloud-reimport";
import { blankControl } from "../lib/kfid/model";

test("cloud origin survives local workspace parsing", () => {
  const workspace = createLocalWorkspace({ id: "qa-cloud-organization", name: "QA" });
  workspace.cloudSnapshot = {
    format: "KFID_CLOUD_SNAPSHOT", schemaVersion: 1,
    exportedAt: "2026-09-20T12:00:00.000Z",
  };
  const data = blankControl();
  data.meta.proj = "Cloudkontroll";
  const created = saveLocalControlRecord(workspace, {
    version: 0, customerId: null, data, status: "DRAFT",
  });
  created.control.cloudOrigin = {
    id: "cloud-control-id", version: 3, siteId: null, departmentId: null,
  };
  const restored = parseLocalWorkspace(created.workspace, "qa-cloud-organization");
  const changed = structuredClone(data);
  changed.meta.proj = "Lokalt ändrad";
  const saved = saveLocalControlRecord(restored, {
    id: created.control.id, version: 1, customerId: null, data: changed, status: "DRAFT",
  });
  assert.deepEqual(saved.control.cloudOrigin, created.control.cloudOrigin);
  assert.deepEqual(parseLocalWorkspace(workspace, "qa-cloud-organization").cloudSnapshot, workspace.cloudSnapshot);
});

test("attachment changes on either side require a separate copy", () => {
  const origin = { id: "control", version: 2, attachmentIds: ["a", "b"] };
  const current = { version: 2, status: "DRAFT", attachmentIds: ["b", "a"] };
  assert.equal(planCloudControlReimport(origin, current, ["a", "b"], 2), "UPDATE");
  assert.equal(planCloudControlReimport(origin, current, ["a"], 1), "COPY_CONFLICT");
  assert.equal(planCloudControlReimport(origin, current, ["a", "b"], 3), "COPY_CONFLICT");
  assert.equal(planCloudControlReimport(origin,
    { ...current, attachmentIds: ["a"] }, ["a", "b"], 2), "COPY_CONFLICT");
  assert.equal(planCloudControlReimport({ id: "control", version: 2 }, current,
    ["a", "b"], 2), "COPY_CONFLICT");
});

test("reimport protects the Cloud original after concurrent change or completion", () => {
  const origin = { id: "cloud-control-id", version: 3 };
  assert.equal(planCloudReimport(undefined, null), "CREATE");
  assert.equal(planCloudReimport(origin, { version: 3, status: "DRAFT" }), "UPDATE");
  assert.equal(planCloudReimport(origin, { version: 4, status: "DRAFT" }), "COPY_CONFLICT");
  assert.equal(planCloudReimport(origin, { version: 3, status: "COMPLETED" }), "COPY_CONFLICT");
  assert.equal(planCloudReimport(origin, null), "COPY_CONFLICT");
});
