import assert from "node:assert/strict";
import { test } from "node:test";
import { AI_PAYER_LABEL, COMPANY_KEY_PRICING_PREFIX, aiPayerText, aiRunPayer, payerOf } from "../lib/ai/payer";

// Vem som betalar (2026-11-27, 6b punkt 5): Ingår, Krediter or Företagets nyckel – never "free" – derived from what the AI log
// already stores, so no field changes meaning.

test("who pays: the company's own key, credits reserved, or included", () => {
  assert.equal(aiRunPayer({ pricingVersion: `${COMPANY_KEY_PRICING_PREFIX}azure-openai-gpt-x`, reservedCredits: 0 }), "company");
  assert.equal(aiRunPayer({ pricingVersion: "azure-gpt-5.6-luna-2026-11-21-1-1-1", reservedCredits: 3 }), "credits");
  assert.equal(aiRunPayer({ pricingVersion: "azure-gpt-5.6-luna-2026-11-21-1-1-1", reservedCredits: 0 }), "included");
  assert.equal(payerOf({ pricingVersion: "openai-x", free: true }), "included");
  assert.equal(payerOf({ pricingVersion: "openai-x", free: false }), "credits");
  assert.equal(payerOf({ pricingVersion: `${COMPANY_KEY_PRICING_PREFIX}openai-x`, free: true }), "company");
});

test("the words the person sees", () => {
  assert.deepEqual(Object.values(AI_PAYER_LABEL), ["Ingår", "Krediter", "Företagets nyckel"]);
  assert.equal(aiPayerText("credits", 3), "Krediter: 3");
  assert.equal(aiPayerText("company", 0), "Företagets nyckel");
  assert.equal(aiPayerText("included"), "Ingår");
  for (const text of Object.values(AI_PAYER_LABEL)) assert.doesNotMatch(text, /free|gratis/i);
});
