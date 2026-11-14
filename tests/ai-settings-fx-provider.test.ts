import assert from "node:assert/strict";
import test from "node:test";
import { AI_MARGIN_MAX, AI_PROVIDERS, DEFAULT_AI_CREDIT_SETTINGS, marginBpsOf, SETTING_FX_SOURCE, fxSnapshot, minimumCreditsFor, parseAiCreditSettings } from "../lib/ai/credit-settings";
import { quoteAiRun } from "../lib/ai/cost-policy";

test("the exchange rate and the provider are settings (2026-10-02); OpenAI is the only provider for now", () => {
  assert.deepEqual(AI_PROVIDERS.map((item) => item.id), ["OPENAI"]);
  assert.deepEqual(parseAiCreditSettings(undefined), DEFAULT_AI_CREDIT_SETTINGS);
  assert.equal(DEFAULT_AI_CREDIT_SETTINGS.usdSek, 12, "the rate used so far is the starting value");
  // Settings saved before these fields existed keep their minimums and get the defaults.
  assert.deepEqual(parseAiCreditSettings({ chatMinimumCredits: 2, documentMinimumCredits: 4 }), { ...DEFAULT_AI_CREDIT_SETTINGS, chatMinimumCredits: 2, documentMinimumCredits: 4 });
  assert.equal(parseAiCreditSettings({ usdSek: 10.456 }).usdSek, 10.46, "two decimals");
  assert.equal(parseAiCreditSettings({ usdSek: 120 }).usdSek, 12, "a typo falls back instead of pricing at 120 kr/USD");
  assert.equal(parseAiCreditSettings({ provider: "SOMETHING" }).provider, "OPENAI");
  assert.equal(minimumCreditsFor("WRITING", { chatMinimumCredits: 2, documentMinimumCredits: 7 }), 2);
});

test("a run records the set rate as the product owner's, from the day it was set", () => {
  const fx = fxSnapshot({ usdSek: 10.5, usdSekSetOn: "2026-10-02" });
  assert.deepEqual(fx, { usdSekRateMicros: 10_500_000, source: SETTING_FX_SOURCE, effectiveDate: new Date("2026-10-02T00:00:00.000Z"), version: "setting-2026-10-02-10.50" });
  // The rate changes what a run may cost: a higher rate, a higher reservation.
  const reserve = (usdSek: number) => quoteAiRun({ taskKind: "DOCUMENT_ANALYSIS", inputTokenLimit: 20_000, maxOutputTokens: 3_000, usdSekRateMicros: fxSnapshot({ usdSek, usdSekSetOn: "2026-10-02" }).usdSekRateMicros, minimumCredits: 1 }).reservedCredits;
  assert.ok(reserve(14) > reserve(9), `${reserve(14)} > ${reserve(9)}`);
});

test("påslaget is one setting for every provider, 40 % from the start, and a higher margin costs more credits (2026-10-24)", () => {
  assert.equal(DEFAULT_AI_CREDIT_SETTINGS.marginPercent, 40);
  assert.equal(parseAiCreditSettings({}).marginPercent, 40, "settings saved before the margin existed keep 40 %");
  assert.equal(parseAiCreditSettings({ marginPercent: 25 }).marginPercent, 25);
  assert.equal(parseAiCreditSettings({ marginPercent: AI_MARGIN_MAX + 1 }).marginPercent, 40, "out of range falls back");
  assert.equal(parseAiCreditSettings({ marginPercent: 2.5 }).marginPercent, 40, "whole percent");
  assert.equal(marginBpsOf({ marginPercent: 40 }), 4_000);
  const base = { taskKind: "DOCUMENT_ANALYSIS" as const, inputTokenLimit: 50_000, maxOutputTokens: 4_000, usdSekRateMicros: 11_000_000, minimumCredits: 1 };
  const route = quoteAiRun(base).policy;
  const low = quoteAiRun({ ...base, policy: { ...route, targetGrossMarginBps: marginBpsOf({ marginPercent: 10 }) } });
  const high = quoteAiRun({ ...base, policy: { ...route, targetGrossMarginBps: marginBpsOf({ marginPercent: 60 }) } });
  assert.ok(high.reservedCredits > low.reservedCredits);
  assert.equal(high.policy.targetGrossMarginBps, 6_000, "the run stores the margin it was priced with");
});
