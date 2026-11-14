import assert from "node:assert/strict";
import test from "node:test";
import { isTimeDrivenStatus, manualStatusChoices, savedStatusForTask, savedTaskStatus } from "../lib/workflow/task-status-rule";

test("Pågår and Pausad are driven by the time, the rest is manual", () => {
  assert.equal(isTimeDrivenStatus("IN_PROGRESS"), true);
  assert.equal(isTimeDrivenStatus("PAUSED"), true);
  for (const status of ["PLANNED", "NEEDS_ACTION", "COMPLETED"]) assert.equal(isTimeDrivenStatus(status), false, status);
});

test("the Status list offers Planerad and Behöver åtgärdas, plus the current status so old values stay readable", () => {
  assert.deepEqual(manualStatusChoices("PLANNED"), ["PLANNED", "NEEDS_ACTION"]);
  assert.deepEqual(manualStatusChoices("NEEDS_ACTION"), ["PLANNED", "NEEDS_ACTION"]);
  assert.deepEqual(manualStatusChoices("IN_PROGRESS"), ["IN_PROGRESS", "PLANNED", "NEEDS_ACTION"]);
  assert.deepEqual(manualStatusChoices("PAUSED"), ["PAUSED", "PLANNED", "NEEDS_ACTION"]);
  assert.deepEqual(manualStatusChoices("COMPLETED"), ["COMPLETED", "PLANNED", "NEEDS_ACTION"]);
  for (const current of ["PLANNED", "NEEDS_ACTION"] as const)
    assert.ok(!manualStatusChoices(current).some(isTimeDrivenStatus), "Pågår/Pausad are never offered as a manual choice");
});

test("a save never switches a saved task into or between Pågår and Pausad", () => {
  assert.equal(savedTaskStatus({ requested: "PAUSED", stored: "IN_PROGRESS" }), "IN_PROGRESS", "the timer is running: no manual pause");
  assert.equal(savedTaskStatus({ requested: "IN_PROGRESS", stored: "PAUSED" }), "PAUSED", "starting is the timer's job");
  assert.equal(savedTaskStatus({ requested: "IN_PROGRESS", stored: "PLANNED" }), "PLANNED");
  assert.equal(savedTaskStatus({ requested: "PAUSED", stored: "NEEDS_ACTION" }), "NEEDS_ACTION");
});

test("unchanged and manual statuses pass through, so existing data is kept", () => {
  assert.equal(savedTaskStatus({ requested: "IN_PROGRESS", stored: "IN_PROGRESS" }), "IN_PROGRESS");
  assert.equal(savedTaskStatus({ requested: "PAUSED", stored: "PAUSED" }), "PAUSED");
  assert.equal(savedTaskStatus({ requested: "PLANNED", stored: "IN_PROGRESS" }), "PLANNED");
  assert.equal(savedTaskStatus({ requested: "NEEDS_ACTION", stored: "PAUSED" }), "NEEDS_ACTION");
  assert.equal(savedTaskStatus({ requested: "COMPLETED", stored: "IN_PROGRESS" }), "COMPLETED", "completion is not the list's business");
});

test("a new task keeps what it is created with (imports, API)", () => {
  assert.equal(savedTaskStatus({ requested: "IN_PROGRESS", stored: null }), "IN_PROGRESS");
  assert.equal(savedTaskStatus({ requested: "PAUSED", stored: null }), "PAUSED");
});

test("a work order that waits for something may be paused by hand", () => {
  assert.equal(savedTaskStatus({ requested: "PAUSED", stored: "IN_PROGRESS", waiting: true }), "PAUSED");
  const order = (waitingOn: string) => ({ status: "PAUSED" as const, data: { kind: "WORK_ORDER", details: { waitingOn } } });
  assert.equal(savedStatusForTask(order("MATERIAL"), "PLANNED"), "PAUSED");
  assert.equal(savedStatusForTask(order(""), "PLANNED"), "PLANNED", "a plain pause without a reason is the timer's");
  assert.equal(savedStatusForTask({ status: "PAUSED", data: { kind: "FORM", details: { waitingOn: "MATERIAL" } } }, "IN_PROGRESS"), "IN_PROGRESS", "only work orders wait for something");
  assert.equal(savedStatusForTask(order("MATERIAL"), undefined), "PAUSED");
});
