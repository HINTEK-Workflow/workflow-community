import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocalWorkspace, parseLocalWorkspace, saveLocalWorkflowTaskRecord } from "../features/kfid/local-workspace-store";
import { planCloudReimport } from "../lib/kfid/cloud-reimport";

test("cloud origin survives local workspace parsing", () => {
  const workspace = createLocalWorkspace({ id: "qa-cloud-organization", name: "QA" });
  workspace.cloudSnapshot = {
    format: "KFID_CLOUD_SNAPSHOT", schemaVersion: 1,
    exportedAt: "2026-09-20T12:00:00.000Z",
  };
  const created = saveLocalWorkflowTaskRecord(workspace, {
    version: 0, kind: "WORK_ORDER", title: "Cloudarbetsorder", description: "", status: "PLANNED",
    projectId: null, customerId: null, assignedToUserId: null, assignedToName: "", dueDate: "",
    data: { kind: "WORK_ORDER", details: { executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "" } },
  });
  created.task.cloudOrigin = { id: "cloud-task-id", version: 3, attachmentIds: [] };
  const restored = parseLocalWorkspace(created.workspace, "qa-cloud-organization");
  const saved = saveLocalWorkflowTaskRecord(restored, { ...restored.workflowTasks[0], title: "Lokalt ändrad" });
  assert.deepEqual(saved.task.cloudOrigin, created.task.cloudOrigin);
  assert.deepEqual(parseLocalWorkspace(workspace, "qa-cloud-organization").cloudSnapshot, workspace.cloudSnapshot);
});

test("reimport protects the Cloud original after concurrent change or completion", () => {
  const origin = { id: "cloud-task-id", version: 3 };
  assert.equal(planCloudReimport(undefined, null), "CREATE");
  assert.equal(planCloudReimport(origin, { version: 3, status: "DRAFT" }), "UPDATE");
  assert.equal(planCloudReimport(origin, { version: 4, status: "DRAFT" }), "COPY_CONFLICT");
  assert.equal(planCloudReimport(origin, { version: 3, status: "COMPLETED" }), "COPY_CONFLICT");
  assert.equal(planCloudReimport(origin, null), "COPY_CONFLICT");
});
