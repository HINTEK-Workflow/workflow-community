import assert from "node:assert/strict";
import test from "node:test";
import { initialFormValues } from "../lib/workflow/form-document";
import { isolationMeasurementForm } from "../lib/workflow/form-examples";
import { defaultWorkflowPermissionProfile, hasWorkflowPermission, workflowPermissionPresets, workflowSubjectForTask } from "../lib/workflow/permissions";
import { createLocalWorkspace, parseLocalWorkspace, saveLocalWorkflowTaskRecord } from "../features/kfid/local-workspace-store";
import { withLocalWorkOrder } from "./helpers/work-order";
import { resetWorkflowTaskApproval, stampWorkflowTaskApproval, workflowTaskCompletion, workflowTaskHasDocumentation, workflowTaskInputSchema, workflowTaskProgress } from "../lib/workflow/task-model";

const protocol = () => workflowTaskInputSchema.parse({
  kind: "FORM", title: "Isolationsmätning garage", status: "IN_PROGRESS",
  data: { kind: "FORM", details: { templateId: "form-1", templateVersion: 1, templateName: "Isolationsmätning", document: isolationMeasurementForm, values: initialFormValues(isolationMeasurementForm) } },
});

test("a protocol is a task of kind FORM with the form's own completion rules and the 95 % cap", () => {
  const task = protocol();
  assert.equal(task.data.kind, "FORM");
  assert.equal(workflowTaskHasDocumentation(task), false);
  let completion = workflowTaskCompletion(task);
  assert.equal(completion.ready, false);
  assert.ok(completion.issues.some((issue) => issue.field === "form-instrument"), "issues point at the block's input id");
  if (task.data.kind !== "FORM") throw new Error("kind");
  const values = task.data.details.values;
  Object.assign(values.fields, { instrument: "IT-200", provspanning: "500 V", provdatum: "2026-09-28" });
  values.tables.matning.forEach((row) => { row.cells = { uppmatt: "250", grans: "1,0" }; });
  values.signatures.utford = { name: "Elon Relässon", confirmed: true, signedAt: null };
  assert.equal(workflowTaskHasDocumentation(task), true);
  completion = workflowTaskCompletion(task);
  assert.equal(completion.ready, true, JSON.stringify(completion.issues));
  assert.equal(workflowTaskProgress(task), 95);
  assert.equal(workflowTaskProgress({ ...task, status: "COMPLETED" }), 100);

  // Signatures are stamped by the persistence boundary and reset when the protocol is reopened.
  const stamped = stampWorkflowTaskApproval(task.data, "2026-09-28T10:00:00.000Z");
  assert.equal(stamped.kind === "FORM" && stamped.details.values.signatures.utford.signedAt, "2026-09-28T10:00:00.000Z");
  const reset = resetWorkflowTaskApproval(stamped);
  assert.deepEqual(reset.kind === "FORM" && reset.details.values.signatures.utford, { name: "Elon Relässon", confirmed: false, signedAt: null });
});

test("a deviation requires a comment before the protocol can be completed", () => {
  const task = protocol();
  if (task.data.kind !== "FORM") throw new Error("kind");
  const values = task.data.details.values;
  Object.assign(values.fields, { instrument: "IT-200", provspanning: "500 V", provdatum: "2026-09-28" });
  values.tables.matning.forEach((row, index) => { row.cells = { uppmatt: index === 2 ? "0,4" : "250", grans: "1" }; });
  values.signatures.utford = { name: "Elon Relässon", confirmed: true, signedAt: null };
  assert.deepEqual(workflowTaskCompletion(task).issues.map((issue) => issue.field), ["form-deviations"]);
  values.deviationComment = "L3–PE mäts om efter åtgärd.";
  assert.equal(workflowTaskCompletion(task).ready, true);
});

test("Local: a protocol is saved in the .hwf file with its form version and reads back", () => {
  // Arbetsordern styr (2026-10-26): the protocol is made in a work order.
  const { workspace, workOrderId } = withLocalWorkOrder(createLocalWorkspace({ id: "forms-local", name: "Formulär AB" }));
  // Filled in, it has started: it needs its work order (a draft could wait, 2026-10-27).
  assert.throws(() => saveLocalWorkflowTaskRecord(workspace, protocol()), /Koppla uppgiften till en arbetsorder/);
  const saved = saveLocalWorkflowTaskRecord(workspace, { ...protocol(), workOrderId });
  assert.equal(saved.task.kind, "FORM");
  assert.equal(saved.task.workOrderId, workOrderId);
  assert.equal(saved.task.data.kind === "FORM" && saved.task.data.details.document.blocks.length, isolationMeasurementForm.blocks.length);
  const reread = parseLocalWorkspace(JSON.parse(JSON.stringify(saved.workspace)), "forms-local");
  const form = reread.workflowTasks.find((task) => task.kind === "FORM")!;
  assert.equal(form.workOrderId, workOrderId);
  assert.equal(form.revisions.length, 1);
});

test("forms are a permission area with the same actions as work orders", () => {
  assert.equal(workflowSubjectForTask("FORM"), "forms");
  assert.equal(hasWorkflowPermission(defaultWorkflowPermissionProfile(), "forms", "complete"), true);
  const field = workflowPermissionPresets.find((preset) => preset.id === "field")!.profile;
  const report = workflowPermissionPresets.find((preset) => preset.id === "report")!.profile;
  assert.equal(hasWorkflowPermission(field, "forms", "create"), true);
  assert.equal(hasWorkflowPermission(report, "forms", "read"), true);
  assert.equal(hasWorkflowPermission(report, "forms", "edit"), false);
  assert.equal(hasWorkflowPermission({ version: 1, grants: ["work-order:read"] }, "forms", "read"), false, "no implicit rights: stored profiles are migrated in the database");
});

test("a form that asks for its moments counts nothing as done until one is chosen (QA 2026-10-10)", async () => {
  const { kfidForm } = await import("../lib/workflow/builtin-kfid-form");
  const { formCompletion } = await import("../lib/workflow/form-document");
  const values = initialFormValues(kfidForm.document);
  // The basics filled in for the person (project, date, the user) are no progress of the control itself.
  values.fields = { ...values.fields, proj: "Garage", perf: "Elin", date: "2026-10-10" };
  assert.equal(formCompletion(kfidForm.document, values).percent, 0);
  values.sections["kfid-iso"] = true;
  assert.ok(formCompletion(kfidForm.document, values).percent > 0);
});
