import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertAgentToolAllowed,
  executableWorkflowAgents,
  getWorkflowAgent,
  workflowAgents,
} from "../lib/ai/agent-registry";

test("Workflow agents stay tenant-scoped and read-only", () => {
  assert.equal(workflowAgents.length, 5);
  assert.deepEqual(executableWorkflowAgents().map((agent) => agent.id), ["workflow-assistant", "kfid-control-review", "document-import", "workflow-writer", "daily-digest"]);
  // The writer and the digest (2026-10-02) get their material from the server and have no tools: they cannot read or change anything.
  assert.deepEqual(getWorkflowAgent("workflow-writer")?.tools, []);
  assert.deepEqual(getWorkflowAgent("daily-digest")?.tools, []);
  // The import analysis (2026-10-01) reads the uploaded file only and never mutates: no tools at all.
  assert.deepEqual(getWorkflowAgent("document-import")?.tools, []);
  const assistant = getWorkflowAgent("workflow-assistant");
  assert.ok(assistant);
  assert.equal(assistant.lifecycle, "ENABLED");
  assert.equal(assistant.moduleId, null);
  // Fas 1 (2026-10-02): the read tools of the shared tool layer, never one that changes anything.
  assert.deepEqual(assistant.tools.map((tool) => tool.name), ["search", "get_task", "get_project", "get_customer", "list_my_work", "list_projects", "list_planned_activities", "list_time_entries"]);
  assert.ok(assistant.tools.every((tool) => tool.effect === "READ" && tool.strict && tool.parameters.additionalProperties === false));
  assert.equal(assistant.limits.maxToolCalls, 3);
  const agent = getWorkflowAgent("kfid-control-review");
  assert.ok(agent);
  // Fas 3 (2026-10-02): the reviewer is on. The server prepares its material, so it has no tools of its own.
  assert.equal(agent.lifecycle, "ENABLED");
  assert.equal(agent.moduleId, "kfid");
  assert.equal(agent.limits.requiresPositiveCredits, true);
  assert.deepEqual(agent.tools, []);
});

test("agent tool dispatch fails closed", () => {
  const agent = getWorkflowAgent("kfid-control-review");
  assert.ok(agent);
  assert.throws(() => assertAgentToolAllowed(agent, "read_current_control"), /inte tillåtet/, "the reviewer has no tools");
  const assistant = getWorkflowAgent("workflow-assistant");
  assert.ok(assistant);
  assert.equal(assertAgentToolAllowed(assistant, "search").effect, "READ");
  assert.throws(() => assertAgentToolAllowed(assistant, "update_task"), /inte tillåtet/);
  assert.throws(
    () => assertAgentToolAllowed(agent, "unknown_tool"),
    /inte tillåtet/,
  );
  assert.equal(getWorkflowAgent("unknown-agent"), null);
});
