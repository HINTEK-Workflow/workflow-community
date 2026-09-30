import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertAgentToolAllowed,
  executableWorkflowAgents,
  getWorkflowAgent,
  workflowAgents,
} from "../lib/ai/agent-registry";

test("Workflow agents stay tenant-scoped and read-only", () => {
  assert.equal(workflowAgents.length, 2);
  assert.deepEqual(executableWorkflowAgents().map((agent) => agent.id), ["workflow-assistant"]);
  const assistant = getWorkflowAgent("workflow-assistant");
  assert.ok(assistant);
  assert.equal(assistant.lifecycle, "ENABLED");
  assert.equal(assistant.moduleId, null);
  assert.deepEqual(assistant.tools.map((tool) => tool.effect), ["READ"]);
  const agent = getWorkflowAgent("kfid-control-review");
  assert.ok(agent);
  assert.equal(agent.lifecycle, "DESIGN_ONLY");
  assert.equal(agent.moduleId, "kfid");
  assert.equal(agent.limits.requiresPositiveCredits, true);
  assert.deepEqual(agent.tools.map((tool) => tool.effect), ["READ"]);
  assert.equal(agent.tools[0].strict, true);
  assert.equal(agent.tools[0].parameters.additionalProperties, false);
});

test("agent tool dispatch fails closed", () => {
  const agent = getWorkflowAgent("kfid-control-review");
  assert.ok(agent);
  assert.equal(assertAgentToolAllowed(agent, "read_current_control").effect, "READ");
  const assistant = getWorkflowAgent("workflow-assistant");
  assert.ok(assistant);
  assert.equal(assertAgentToolAllowed(assistant, "search_workflow").effect, "READ");
  assert.throws(
    () => assertAgentToolAllowed(agent, "unknown_tool"),
    /inte tillåtet/,
  );
  assert.equal(getWorkflowAgent("unknown-agent"), null);
});
