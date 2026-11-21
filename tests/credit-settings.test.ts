import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_AI_CREDIT_SETTINGS, minimumCreditsFor, parseAiCreditSettings } from "../lib/ai/credit-settings";
import { quoteAiRun } from "../lib/ai/cost-policy";
import { AI_INTERNAL_FX_POLICY } from "../lib/ai/model-catalog";

test("the least an AI answer costs is a setting; a short chat answer costs only that (2026-10-01, 2026-11-21: one credit from the start)", () => {
  assert.deepEqual(parseAiCreditSettings(undefined), DEFAULT_AI_CREDIT_SETTINGS);
  assert.deepEqual(
    { chat: DEFAULT_AI_CREDIT_SETTINGS.chatMinimumCredits, document: DEFAULT_AI_CREDIT_SETTINGS.documentMinimumCredits, usdSek: DEFAULT_AI_CREDIT_SETTINGS.usdSek, provider: DEFAULT_AI_CREDIT_SETTINGS.provider, markup: DEFAULT_AI_CREDIT_SETTINGS.markupPercent },
    { chat: 1, document: 1, usdSek: 12, provider: "OPENAI", markup: 100 },
  );
  assert.deepEqual(parseAiCreditSettings({ chatMinimumCredits: 2, documentMinimumCredits: 999 }), { ...DEFAULT_AI_CREDIT_SETTINGS, chatMinimumCredits: 2, documentMinimumCredits: 1 });
  const settings = { chatMinimumCredits: 1, documentMinimumCredits: 4 };
  assert.equal(minimumCreditsFor("SIMPLE_CHAT", settings), 1);
  assert.equal(minimumCreditsFor("WORKFLOW_SEARCH", settings), 1);
  assert.equal(minimumCreditsFor("DOCUMENT_ANALYSIS", settings), 4);
  const quote = (minimumCredits?: number) => quoteAiRun({ taskKind: "SIMPLE_CHAT", inputTokenLimit: 2_000, maxOutputTokens: 1_000, usdSekRateMicros: AI_INTERNAL_FX_POLICY.usdSekRateMicros, minimumCredits });
  assert.equal(quote().reservedCredits, 1, "the catalog's minimum by default: one credit");
  assert.equal(quote(3).reservedCredits, 3, "a short answer reserves only the minimum");
  assert.equal(quote(3).policy.minimumCredits, 3, "the run is priced with the minimum it was given");
});
