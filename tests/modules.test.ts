import assert from "node:assert/strict";
import { test } from "node:test";
import {
  enabledWorkflowModules,
  getWorkflowModule,
  workflowModules,
} from "../lib/modules";

test("module registry has stable unique ids and exposes the implemented workflow task types", () => {
  assert.equal(new Set(workflowModules.map((module) => module.id)).size, workflowModules.length);
  assert.deepEqual(enabledWorkflowModules().map((module) => module.id), ["kfid", "risk-assessment", "work-order"]);
  assert.equal(getWorkflowModule("kfid")?.route, "/");
});

test("planned modules fail closed without routes or configured access", () => {
  for (const definition of workflowModules.filter((item) => item.lifecycle === "PLANNED")) {
    assert.equal(definition.route, null);
    assert.equal(definition.access.kind, "NOT_CONFIGURED");
  }
  assert.equal(getWorkflowModule("unknown"), null);
});
