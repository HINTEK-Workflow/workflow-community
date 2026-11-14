import assert from "node:assert/strict";
import test from "node:test";
import { canBookAnything, canBookJob, canReadPlannedActivity, plannedActivityWriteRefusal } from "../lib/workflow/planned-activity-access";
import type { WorkflowPermissionProfile } from "../lib/workflow/permissions";

// Bokning följer jobbets egna rättigheter (2026-10-10, kartläggningen 5.11).
const profile = (...grants: string[]) => ({ version: 1 as const, grants: grants as WorkflowPermissionProfile["grants"] });
const standaloneOrder = { projectId: null, workflowTask: { kind: "WORK_ORDER", formArea: null, projectId: null } };

test("Boka is offered only when the form can take the job (2026-11-02): a job in a project needs the Projekt module and the right to read projects", () => {
  const editor = profile("work-order:read", "work-order:edit");
  assert.equal(canBookJob(editor, false, null, true), true, "a standalone work order follows its own right");
  assert.equal(canBookJob(editor, false, null, false), true, "the Projekt module does not matter for it");
  assert.equal(canBookJob(editor, false, "p", true), false, "no project right");
  assert.equal(canBookJob(profile("work-order:edit", "projects:create"), false, "p", true), false, "may write but not read the project");
  assert.equal(canBookJob(profile("work-order:edit", "projects:create", "projects:read"), false, "p", true), true);
  assert.equal(canBookJob(profile("work-order:edit", "projects:create", "projects:read"), false, "p", false), false, "Projekt is off");
  assert.equal(canBookJob(profile(), true, "p", true), true, "an admin");
  assert.equal(canBookJob(profile(), true, "p", false), false, "Projekt off holds for an admin too");
});
const projectOrder = { projectId: null, workflowTask: { kind: "WORK_ORDER", formArea: null, projectId: "p1" } };
const projectOnly = { projectId: "p1", workflowTask: null };
const free = { projectId: null, workflowTask: null };

test("a standalone job is booked and read with the job's own rights, never the project right", () => {
  const worker = profile("work-order:read", "work-order:edit");
  assert.equal(plannedActivityWriteRefusal(worker, false, standaloneOrder, true), null);
  assert.equal(plannedActivityWriteRefusal(worker, false, standaloneOrder, false), null);
  assert.equal(canReadPlannedActivity(worker, false, standaloneOrder), true);
  assert.equal(canReadPlannedActivity(profile("work-order:read"), false, standaloneOrder), true);
  assert.match(plannedActivityWriteRefusal(profile("work-order:read"), false, standaloneOrder, true) ?? "", /ändra jobbet/);
  // A protocol follows its form's area.
  const control = { projectId: null, workflowTask: { kind: "FORM", formArea: "kfid", projectId: null } };
  assert.equal(plannedActivityWriteRefusal(profile("kfid:read", "kfid:edit"), false, control, true), null);
  assert.notEqual(plannedActivityWriteRefusal(profile("forms:read", "forms:edit"), false, control, true), null);
});

test("planning in a project still needs the project right, and the job's right when there is a job", () => {
  const worker = profile("work-order:read", "work-order:edit");
  assert.match(plannedActivityWriteRefusal(worker, false, projectOrder, true) ?? "", /planera i projekt/);
  assert.equal(canReadPlannedActivity(worker, false, projectOrder), false);
  const planner = profile("projects:read", "projects:create", "projects:edit", "work-order:read", "work-order:edit");
  assert.equal(plannedActivityWriteRefusal(planner, false, projectOrder, true), null);
  assert.equal(plannedActivityWriteRefusal(planner, false, projectOnly, false), null);
  // Create is asked for a new booking, edit for a change.
  assert.notEqual(plannedActivityWriteRefusal(profile("projects:read", "projects:edit"), false, projectOnly, true), null);
  assert.equal(plannedActivityWriteRefusal(profile("projects:read", "projects:create"), false, projectOnly, true), null);
  assert.notEqual(plannedActivityWriteRefusal(profile("projects:read", "projects:create"), false, projectOnly, false), null);
  // A booking without project or job is project planning.
  assert.notEqual(plannedActivityWriteRefusal(worker, false, free, true), null);
  assert.equal(canReadPlannedActivity(worker, false, free), false);
  assert.equal(canReadPlannedActivity(profile("projects:read"), false, free), true);
  // A booking placed on a project counts as project planning even when its job stands alone.
  assert.notEqual(plannedActivityWriteRefusal(worker, false, { ...standaloneOrder, projectId: "p1" }, true), null);
});

test("an admin books everything; who may book anything at all", () => {
  assert.equal(plannedActivityWriteRefusal(profile(), true, free, true), null);
  assert.equal(canReadPlannedActivity(profile(), true, projectOrder), true);
  assert.equal(canBookAnything(profile("forms:read", "forms:edit"), false), true);
  assert.equal(canBookAnything(profile("projects:read", "projects:create"), false), true);
  assert.equal(canBookAnything(profile("work-order:read", "projects:read"), false), false);
});
