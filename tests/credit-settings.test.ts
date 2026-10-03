import assert from "node:assert/strict";
import test from "node:test";
import { minimumCreditsFor, parseAiCreditSettings } from "../lib/ai/credit-settings";
import { quoteAiRun } from "../lib/ai/cost-policy";
import { AI_INTERNAL_FX_POLICY } from "../lib/ai/model-catalog";

test("the least an AI answer costs is a setting; a short chat answer costs only that (2026-10-01)", () => {
  assert.deepEqual(parseAiCreditSettings(undefined), { chatMinimumCredits: 5, documentMinimumCredits: 5, usdSek: 12, usdSekSetOn: "2026-10-01", provider: "OPENAI" });
  assert.deepEqual(parseAiCreditSettings({ chatMinimumCredits: 1, documentMinimumCredits: 999 }), { chatMinimumCredits: 1, documentMinimumCredits: 5, usdSek: 12, usdSekSetOn: "2026-10-01", provider: "OPENAI" });
  const settings = { chatMinimumCredits: 1, documentMinimumCredits: 4 };
  assert.equal(minimumCreditsFor("SIMPLE_CHAT", settings), 1);
  assert.equal(minimumCreditsFor("WORKFLOW_SEARCH", settings), 1);
  assert.equal(minimumCreditsFor("DOCUMENT_ANALYSIS", settings), 4);
  const quote = (minimumCredits?: number) => quoteAiRun({ taskKind: "SIMPLE_CHAT", inputTokenLimit: 2_000, maxOutputTokens: 1_000, usdSekRateMicros: AI_INTERNAL_FX_POLICY.usdSekRateMicros, minimumCredits });
  assert.equal(quote().reservedCredits, 5, "the catalog's minimum by default");
  assert.equal(quote(1).reservedCredits, 1, "a short answer reserves only the minimum");
  assert.equal(quote(1).policy.minimumCredits, 1, "the run is priced with the minimum it was given");
});
