import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { bookingTaskId } from "../lib/workflow/bookings";
import { createDemoDatabase } from "../features/demo/demo-data";

// "Ingen bokning" on a protocol whose work order was booked (2026-11-18): a booking lands on the work order, so a
// protocol's or a risk assessment's page reads its work order's bookings; a work order and a free task read their own.
test("a task in a work order reads its work order's bookings", () => {
  assert.equal(bookingTaskId({ id: "p1", kind: "FORM", workOrderId: "wo1" }), "wo1");
  assert.equal(bookingTaskId({ id: "r1", kind: "RISK_ASSESSMENT", workOrderId: "wo1" }), "wo1");
  assert.equal(bookingTaskId({ id: "wo1", kind: "WORK_ORDER", workOrderId: null }), "wo1");
  assert.equal(bookingTaskId({ id: "p2", kind: "FORM", workOrderId: null }), "p2");
  assert.equal(bookingTaskId({ id: "p3", kind: "FORM" }), "p3");
});

test("the demo's booked control reads the booking of its work order", () => {
  const db = createDemoDatabase(new Date("2026-11-18T10:00:00Z"));
  const control = db.tasks.find((task) => task.id === "demo-task-kfid-stallverk")!;
  const booked = db.activities.filter((activity) => activity.workflowTaskId === bookingTaskId(control));
  assert.ok(control.workOrderId, "the control is in a work order");
  assert.ok(booked.length > 0, "the work order is booked");
  assert.equal(db.activities.filter((activity) => activity.workflowTaskId === control.id).length, 0, "nothing is booked on the protocol itself");
});

test("the task page's booking line uses it", () => {
  const editor = readFileSync("features/workflow/workflow-task-editor.tsx", "utf8");
  assert.match(editor, /<TaskBookingLine taskId=\{bookingTaskId\(task\)\}/);
});
