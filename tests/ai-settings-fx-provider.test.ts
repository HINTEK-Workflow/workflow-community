import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_MARKUP_MAX, AI_PROVIDERS, AI_PROVIDER_LABEL, DEFAULT_AI_CREDIT_SETTINGS, creditsChargedIn, marginBpsOf, marginBpsToMarkupPercent, markupToMarginBps, SETTING_FX_SOURCE, fxSnapshot,
  minimumCreditsFor, parseAiCreditSettings,
} from "../lib/ai/credit-settings";
import { calculateAiUsageCost, quoteAiRun } from "../lib/ai/cost-policy";
import { routeAiModel } from "../lib/ai/model-catalog";

test("the exchange rate and Leverantör för Standard are settings; OpenAI and Microsoft Azure can be chosen", () => {
  assert.deepEqual(AI_PROVIDERS.map((item) => item.id), ["OPENAI", "AZURE_OPENAI"]);
  assert.equal(AI_PROVIDER_LABEL.AZURE_OPENAI, "Microsoft Azure");
  assert.deepEqual(parseAiCreditSettings(undefined), DEFAULT_AI_CREDIT_SETTINGS);
  assert.equal(DEFAULT_AI_CREDIT_SETTINGS.usdSek, 12, "the rate used so far is the starting value");
  // Settings saved before these fields existed keep their minimums and get the defaults.
  assert.deepEqual(parseAiCreditSettings({ chatMinimumCredits: 2, documentMinimumCredits: 4 }), { ...DEFAULT_AI_CREDIT_SETTINGS, chatMinimumCredits: 2, documentMinimumCredits: 4 });
  assert.equal(parseAiCreditSettings({ usdSek: 10.456 }).usdSek, 10.46, "two decimals");
  assert.equal(parseAiCreditSettings({ usdSek: 120 }).usdSek, 12, "a typo falls back instead of pricing at 120 kr/USD");
  assert.equal(parseAiCreditSettings({ provider: "SOMETHING" }).provider, "OPENAI");
  assert.equal(parseAiCreditSettings({ provider: "AZURE_OPENAI" }).provider, "AZURE_OPENAI");
  assert.equal(minimumCreditsFor("WRITING", { chatMinimumCredits: 2, documentMinimumCredits: 7 }), 2);
  // No high fixed minimum (2026-11-21, F2): one credit from the start.
  assert.equal(DEFAULT_AI_CREDIT_SETTINGS.chatMinimumCredits, 1);
  assert.equal(DEFAULT_AI_CREDIT_SETTINGS.documentMinimumCredits, 1);
  assert.equal(DEFAULT_AI_CREDIT_SETTINGS.monthlyBudgetKr, 500);
});

test("a run records the set rate as the product owner's, from the day it was set", () => {
  const fx = fxSnapshot({ usdSek: 10.5, usdSekSetOn: "2026-10-02" });
  assert.deepEqual(fx, { usdSekRateMicros: 10_500_000, source: SETTING_FX_SOURCE, effectiveDate: new Date("2026-10-02T00:00:00.000Z"), version: "setting-2026-10-02-10.50" });
  const reserve = (usdSek: number) => quoteAiRun({ taskKind: "DOCUMENT_ANALYSIS", inputTokenLimit: 20_000, maxOutputTokens: 3_000, usdSekRateMicros: fxSnapshot({ usdSek, usdSekSetOn: "2026-10-02" }).usdSekRateMicros, minimumCredits: 1 }).reservedCredits;
  assert.ok(reserve(14) > reserve(9), `${reserve(14)} > ${reserve(9)}`);
});

test("påslaget (2026-11-21, F2): the provider's cost plus a markup in percent, 100 % from the start, stored exactly per run", () => {
  assert.equal(DEFAULT_AI_CREDIT_SETTINGS.markupPercent, 100);
  assert.equal(parseAiCreditSettings({}).markupPercent, 100);
  assert.equal(parseAiCreditSettings({ marginPercent: 40 }).markupPercent, 100, "an older save's margin is not read as a markup");
  assert.equal(parseAiCreditSettings({ markupPercent: 25 }).markupPercent, 25);
  assert.equal(parseAiCreditSettings({ markupPercent: AI_MARKUP_MAX + 1 }).markupPercent, 100, "out of range falls back");
  assert.equal(parseAiCreditSettings({ markupPercent: 2.5 }).markupPercent, 100, "whole percent");
  // The markup as the ledger's margin: exact for 0 and 100 %, rounded down otherwise so a run never costs more than the markup.
  assert.equal(markupToMarginBps(0), 0);
  assert.equal(markupToMarginBps(100), 5_000);
  assert.equal(markupToMarginBps(400), 8_000);
  assert.equal(markupToMarginBps(30), 2_307);
  assert.equal(marginBpsOf({ markupPercent: 100 }), 5_000);
  assert.equal(marginBpsToMarkupPercent(5_000), 100);
  for (const markup of [0, 1, 7, 30, 50, 99, 100, 150, 333, 400]) assert.ok(10_000 / (10_000 - markupToMarginBps(markup)) <= 1 + markup / 100 + 1e-9, `${markup} % never charges more than the markup`);
});

test("a charge is the actual cost × (1 + markup), turned into whole credits rounded up, and never below the minimum", () => {
  const usage = { inputTokens: 3_000, cachedInputTokens: 0, outputTokens: 400 };
  const route = routeAiModel("SIMPLE_CHAT");
  const snapshot = (markup: number, minimumCredits = 1) => ({ ...route, targetGrossMarginBps: markupToMarginBps(markup), creditFloorValueOre: 83, minimumCredits, usdSekRateMicros: 11_000_000 });
  const plain = calculateAiUsageCost(usage, snapshot(0));
  const doubled = calculateAiUsageCost(usage, snapshot(100));
  assert.equal(plain.providerCostOre, doubled.providerCostOre, "the provider's cost is the same: the markup is on top");
  assert.equal(doubled.chargedCredits, Math.max(1, Math.ceil((doubled.providerCostOre * 2) / 83)));
  // A big run: the markup shows clearly, roughly twice the credits at cost price.
  const big = { inputTokens: 200_000, cachedInputTokens: 0, outputTokens: 20_000 };
  const docRoute = routeAiModel("KFID_CONTROL_REVIEW");
  const at = (markup: number) => calculateAiUsageCost(big, { ...docRoute, targetGrossMarginBps: markupToMarginBps(markup), creditFloorValueOre: 83, minimumCredits: 1, usdSekRateMicros: 11_000_000 });
  assert.equal(at(100).chargedCredits, Math.ceil((at(100).providerCostOre * 2) / 83));
  assert.ok(at(100).chargedCredits >= 2 * at(0).chargedCredits - 1);
  // A tiny question costs one credit, not five.
  assert.equal(calculateAiUsageCost({ inputTokens: 100, cachedInputTokens: 0, outputTokens: 10 }, snapshot(100)).chargedCredits, 1);
  assert.equal(calculateAiUsageCost({ inputTokens: 100, cachedInputTokens: 0, outputTokens: 10 }, snapshot(100, 3)).chargedCredits, 3);
});

test("what costs credits (2026-11-21): ordinary Workflow AI is included; only credits mode is charged, and only with the credit system", () => {
  assert.equal(creditsChargedIn("included", true), false);
  assert.equal(creditsChargedIn("credits", true), true);
  assert.equal(creditsChargedIn("credits", false), false, "Community has no credits");
  // An included run reserves nothing but still knows the provider's real cost (the ledger records it at settlement).
  const quote = quoteAiRun({ taskKind: "SIMPLE_CHAT", inputTokenLimit: 8_000, maxOutputTokens: 1_200, usdSekRateMicros: 11_000_000, minimumCredits: 1, free: !creditsChargedIn("included", true) });
  assert.equal(quote.reservedCredits, 0);
  assert.ok(quote.providerCostOre > 0);
});
