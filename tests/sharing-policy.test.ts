import assert from "node:assert/strict";
import test from "node:test";
import { disabledAiSharingPolicy, sharesWork, sourceAllowed } from "../lib/ai/sharing-policy";

test("AI sharing at Workflow's level: each choice governs only its own sources (2026-10-01)", () => {
  const customersOnly = { ...disabledAiSharingPolicy, enabled: true, shareChatContent: true, shareCustomers: true };
  assert.equal(sourceAllowed(customersOnly, "CUSTOMER"), true);
  for (const kind of ["PROJECT", "TASK", "CONTROL", "DOCUMENT"]) assert.equal(sourceAllowed(customersOnly, kind), false, `${kind} is not shared with customers only`);
  const work = { ...disabledAiSharingPolicy, shareWork: true };
  for (const kind of ["PROJECT", "TASK", "CONTROL"]) assert.equal(sourceAllowed(work, kind), true);
  assert.equal(sourceAllowed(work, "CUSTOMER"), false);
  assert.equal(sourceAllowed({ ...disabledAiSharingPolicy, shareDocuments: true }, "DOCUMENT"), true);
  // A policy saved before "Uppgifter och projekt" existed shares tasks when it shared the controls.
  assert.equal(sharesWork({ ...disabledAiSharingPolicy, shareControls: true, allowedModules: ["KFID"] }), true);
  assert.equal(sharesWork({ ...disabledAiSharingPolicy, shareControls: true, allowedModules: [] }), false);
});
