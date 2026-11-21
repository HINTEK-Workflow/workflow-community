import assert from "node:assert/strict";
import { test } from "node:test";
import {
  enabledWorkflowModules,
  getWorkflowModule,
  workflowModules,
} from "../lib/modules";

test("module registry has stable unique ids and exposes the implemented workflow task types", () => {
  assert.equal(new Set(workflowModules.map((module) => module.id)).size, workflowModules.length);
  assert.deepEqual(enabledWorkflowModules().map((module) => module.id), ["kfid", "risk-assessment", "work-order", "self-inspection"]);
  assert.equal(getWorkflowModule("self-inspection")?.route, "/?view=self_inspection");
  assert.equal(getWorkflowModule("kfid")?.route, "/");
});

test("only built modules are listed (2026-11-20): every module has a route, and an unknown id is null", () => {
  for (const definition of workflowModules) assert.ok(definition.route.startsWith("/"), definition.id);
  assert.equal(getWorkflowModule("unknown"), null);
  assert.equal(getWorkflowModule("periodic-control"), null, "the planned placeholder is gone");
});
