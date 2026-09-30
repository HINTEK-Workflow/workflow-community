import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryLocalAttachmentStore, stageLocalWorkflowTaskAttachment } from "../features/kfid/local-attachments";
import { createLocalWorkspace, saveLocalWorkflowTaskRecord } from "../features/kfid/local-workspace-store";
import { createLocalWorkspaceBundle, parseLocalWorkspaceBundle } from "../features/kfid/local-workspace-bundle";

test("local workflow task attachments use the same portable workspace boundary", async () => {
  const workspace = createLocalWorkspace({ id: "org-local", name: "Lokala AB" });
  const saved = saveLocalWorkflowTaskRecord(workspace, { version: 0, kind: "WORK_ORDER", title: "Lokal arbetsorder", description: "", status: "PLANNED", projectId: null, customerId: null, siteId: null, departmentId: null, assignedToUserId: null, assignedToName: "", dueDate: "", data: { kind: "WORK_ORDER", details: { executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "" } } });
  const store = createMemoryLocalAttachmentStore();
  const attached = await stageLocalWorkflowTaskAttachment(store, saved.workspace, { taskId: saved.task.id, file: new File(["lokal bilaga"], "anteckning.txt", { type: "text/plain" }) });
  assert.equal(attached.attachment.taskId, saved.task.id);
  assert.equal(attached.attachment.controlId, null);
  const bundle = await createLocalWorkspaceBundle(attached.workspace, store);
  const imported = await parseLocalWorkspaceBundle(bundle, "org-local");
  assert.equal(imported.workspace.attachments[0].taskId, saved.task.id);
  assert.equal(await imported.files.get(attached.attachment.id)?.text(), "lokal bilaga");
});
