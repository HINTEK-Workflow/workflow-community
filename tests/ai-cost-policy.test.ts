import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_CREDIT_POLICY,
  calculateAiUsageCost,
  quoteAiRun,
} from "../lib/ai/cost-policy";
import {
  AI_INTERNAL_FX_POLICY,
  routeAiModel,
} from "../lib/ai/model-catalog";
import {
  assistantTaskLimits,
  classifyAssistantTask,
} from "../lib/ai/task-router";

const snapshot = { ...AI_CREDIT_POLICY, usdSekRateMicros: 10_500_000 };

test("AI policy snapshots the approved GPT-5.6 Sol global pricing and commercial rules", () => {
  assert.equal(AI_CREDIT_POLICY.model, "gpt-5.6-sol");
  assert.equal(AI_CREDIT_POLICY.reasoningEffort, "medium");
  assert.equal(AI_CREDIT_POLICY.targetGrossMarginBps, 4_000);
  assert.equal(AI_CREDIT_POLICY.minimumCredits, 5);
  assert.equal(AI_CREDIT_POLICY.creditFloorValueOre, 83);
  assert.equal(AI_CREDIT_POLICY.processingRegion, "GLOBAL");
  assert.equal(AI_CREDIT_POLICY.storeProviderState, false);
});

test("trusted task kinds route to Luna, Terra and Sol without a client model override", () => {
  assert.equal(routeAiModel("SIMPLE_CHAT").model, "gpt-5.6-luna");
  assert.equal(routeAiModel("WORKFLOW_SEARCH").model, "gpt-5.6-luna");
  assert.equal(routeAiModel("DOCUMENT_ANALYSIS").model, "gpt-5.6-terra");
  assert.equal(routeAiModel("WORKFLOW_PROPOSAL").model, "gpt-5.6-terra");
  assert.equal(routeAiModel("KFID_CONTROL_REVIEW").model, "gpt-5.6-sol");
  assert.equal(AI_INTERNAL_FX_POLICY.usdSekRateMicros, 12_000_000);
});

test("assistant routing classifies server-side tasks before choosing a model", () => {
  assert.equal(classifyAssistantTask("Vad betyder statusen?"), "SIMPLE_CHAT");
  assert.equal(classifyAssistantTask("Hitta kontrollen för projekt Alpha"), "WORKFLOW_SEARCH");
  assert.equal(classifyAssistantTask("Analysera bifogad PDF"), "DOCUMENT_ANALYSIS");
  assert.equal(classifyAssistantTask("Uppdatera kontrollens mätvärde"), "WORKFLOW_PROPOSAL");
  assert.ok(assistantTaskLimits("DOCUMENT_ANALYSIS").maxOutputTokens > assistantTaskLimits("SIMPLE_CHAT").maxOutputTokens);
});

test("maximum quote uses uncached token limits and rounds credits upward", () => {
  const quote = quoteAiRun({
    inputTokenLimit: 50_000,
    maxOutputTokens: 2_000,
    usdSekRateMicros: snapshot.usdSekRateMicros,
  });
  assert.equal(quote.providerCostUsdMicros, 240_000);
  assert.equal(quote.providerCostOre, 252);
  assert.equal(quote.reservedCredits, 6);
});

test("actual usage honors cached input and the minimum five-credit charge", () => {
  const cost = calculateAiUsageCost({
    inputTokens: 10_000,
    cachedInputTokens: 8_000,
    outputTokens: 500,
  }, snapshot);
  assert.equal(cost.providerCostUsdMicros, 21_200);
  assert.equal(cost.providerCostOre, 23);
  assert.equal(cost.chargedCredits, 5);
});

test("invalid usage and pricing fail closed", () => {
  assert.throws(() => calculateAiUsageCost({
    inputTokens: 10,
    cachedInputTokens: 11,
    outputTokens: 1,
  }, snapshot), /kan inte överstiga/);
  assert.throws(() => quoteAiRun({
    inputTokenLimit: 0,
    maxOutputTokens: 2_000,
    usdSekRateMicros: snapshot.usdSekRateMicros,
  }), /positivt heltal/);
});
