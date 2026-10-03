import assert from "node:assert/strict";
import test from "node:test";
import { keyAlertAction, keyAlertLine, keyAlertStage } from "../lib/integrations/key-alerts";
import { effectiveOpenAiSettings, providerProblem } from "../lib/ai/provider-settings";

test("a key is warned about two weeks and three days before it expires, and once just after", () => {
  const now = new Date("2026-10-03T08:00:00Z");
  const inDays = (days: number) => new Date(now.getTime() + days * 86_400_000);
  assert.equal(keyAlertStage(null, now), null, "a key without an end date never warns");
  assert.equal(keyAlertStage(inDays(30), now), null);
  assert.equal(keyAlertStage(inDays(10), now), "14d");
  assert.equal(keyAlertStage(inDays(2), now), "3d");
  assert.equal(keyAlertStage(inDays(-1), now), "expired");
  assert.equal(keyAlertStage(inDays(-30), now), null, "long expired keys are not warned about again");
  assert.notEqual(keyAlertAction("k1", "14d"), keyAlertAction("k1", "3d"), "each stage is sent once");
  assert.match(keyAlertLine({ name: "Lager", kind: "API", expiresAt: inDays(2) }, "3d"), /API-nyckeln ”Lager” går ut/);
});

test("the AI provider set in the app wins over .env, and says what stops it", () => {
  const env = { OPENAI_PROVIDER_ENABLED: true, OPENAI_DPA_APPROVED: true, OPENAI_PROVIDER_EVAL_APPROVED: true, OPENAI_PROCESSING_REGION: "GLOBAL" as const, OPENAI_EU_DATA_CONTROLS_APPROVED: false, OPENAI_API_KEY: "sk-env" };
  const nothingSaved = effectiveOpenAiSettings({ enabled: false, dpaApproved: false, evalApproved: false, region: "GLOBAL", euControlsApproved: false }, env, "");
  assert.equal(nothingSaved.source, "server");
  assert.equal(providerProblem(nothingSaved), null);
  const saved = effectiveOpenAiSettings({ enabled: true, dpaApproved: false, evalApproved: true, region: "GLOBAL", euControlsApproved: false, updatedAt: "2026-10-03" }, env, "sk-app");
  assert.equal(saved.source, "app");
  assert.equal(saved.apiKey, "sk-app");
  assert.match(providerProblem(saved) ?? "", /avtal/);
  const noKey = effectiveOpenAiSettings({ enabled: true, dpaApproved: true, evalApproved: true, region: "GLOBAL", euControlsApproved: false, updatedAt: "2026-10-03" }, { ...env, OPENAI_API_KEY: undefined }, "");
  assert.match(providerProblem(noKey) ?? "", /nyckel saknas/i);
});
