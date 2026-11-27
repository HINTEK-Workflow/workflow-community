import assert from "node:assert/strict";
import { test } from "node:test";
import { aiAvailable } from "../lib/ai/availability";

const ready = { provider: { ready: true }, sharingPolicy: { ready: true }, creditLedger: { healthy: true }, availableCredits: { available: true } };
const noCredits = { ...ready, availableCredits: { available: false } };

test("AI-status med serverlagring: the model needs the key, the company's setting, a healthy ledger and credits", () => {
  assert.equal(aiAvailable(ready, true), true);
  assert.equal(aiAvailable(noCredits, true), false, "an empty wallet stops the model where credits are sold");
  assert.equal(aiAvailable({ ...ready, creditLedger: { healthy: false } }, true), false);
  assert.equal(aiAvailable({ ...ready, provider: { ready: false } }, true), false);
  assert.equal(aiAvailable({ ...ready, sharingPolicy: { ready: false } }, true), false);
});

test("AI-status utan krediter (Community, 2026-11-20): the key and the setting decide, never the wallet", () => {
  assert.equal(aiAvailable(noCredits, false), true, "an installation with its own key has no credits to count");
  assert.equal(aiAvailable({ ...noCredits, creditLedger: { healthy: false } }, false), true);
  assert.equal(aiAvailable({ ...noCredits, provider: { ready: false } }, false), false, "no key: no model");
  assert.equal(aiAvailable({ ...noCredits, sharingPolicy: { ready: false } }, false), false, "the company has AI off");
});
