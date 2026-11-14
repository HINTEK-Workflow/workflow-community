import assert from "node:assert/strict";
import test from "node:test";
import { describeProfiles } from "../lib/ai/ai-profiles";
import { AZURE_ROUTE_MODELS, azureProblem, chooseProvider, effectiveAzureSettings, storedAzureSchema } from "../lib/ai/azure-settings";
import { GLOBAL_MODEL_PRICES, routeAiModel } from "../lib/ai/model-catalog";
import { OPENAI_ROUTE_MODELS, openAiCards, openAiCardsProblem, openAiRoutePolicy, openAiStartingCards } from "../lib/ai/openai-models";
import { effectiveOpenAiSettings, providerProblem } from "../lib/ai/provider-settings";
import { aiSharingPolicySchema, disabledAiSharingPolicy } from "../lib/ai/sharing-policy";

// AI-profiler, prices as fields (2026-10-24, svar 1 and 3). Synthetic prices only.
const azureCard = (patch: Record<string, unknown> = {}) => ({ deployment: "gpt-5.4-mini", modelName: "gpt-5.4-mini", inputUsdPerMillion: 0.5, outputUsdPerMillion: 3, euVerified: true, euSource: "QA-källa", ...patch });
const azure = (patch: Record<string, unknown> = {}) => effectiveAzureSettings(storedAzureSchema.parse({
  enabled: true, endpoint: "https://qa.services.ai.azure.com", euConfirmed: true, dpaApproved: true,
  deployments: { "gpt-5.6-luna": "gpt-5.4-mini", "gpt-5.6-terra": "gpt-5.4-mini", "gpt-5.6-sol": "gpt-5.4-mini" }, models: [azureCard()], ...patch,
}), "k".repeat(32));

test("OpenAI's starting cards are the prices the code had, and keep the code's pricing version", () => {
  const cards = openAiStartingCards();
  assert.deepEqual(cards.map((card) => card.deployment).sort(), Object.keys(GLOBAL_MODEL_PRICES).sort());
  for (const card of cards) {
    const price = GLOBAL_MODEL_PRICES[card.deployment as keyof typeof GLOBAL_MODEL_PRICES];
    assert.equal(Math.round(card.inputUsdPerMillion! * 1_000_000), price.input);
    assert.equal(Math.round(card.outputUsdPerMillion! * 1_000_000), price.output);
    assert.match(card.priceSource, /Startvärde/);
    assert.equal(card.priceSetOn, "2026-09-23");
    assert.equal(card.euVerified, false, "never EU without a source");
  }
  const route = routeAiModel("DOCUMENT_ANALYSIS");
  const policy = openAiRoutePolicy(route, openAiCards(undefined));
  assert.equal(policy.pricingVersion, route.pricingVersion, "unchanged prices read as before");
  assert.equal(policy.inputPriceUsdMicrosPerMillion, route.inputPriceUsdMicrosPerMillion);
  assert.equal(policy.model, route.model);
  assert.equal(openAiCardsProblem(openAiCards(undefined)), null);
});

test("a new OpenAI price is a new pricing version without a code change; a removed price stops customers' runs", () => {
  const route = routeAiModel("SIMPLE_CHAT");
  const cards = openAiCards([{ ...openAiStartingCards().find((card) => card.deployment === route.model)!, inputUsdPerMillion: 0.3, priceSetOn: "2026-11-01" }]);
  const policy = openAiRoutePolicy(route, cards);
  assert.equal(policy.inputPriceUsdMicrosPerMillion, 300_000);
  assert.match(policy.pricingVersion, /^openai-gpt-5\.6-luna-2026-11-01-300000-/);
  assert.equal(cards.length, OPENAI_ROUTE_MODELS.length, "the other models keep their starting cards");
  const removed = openAiCards([{ ...cards[0], inputUsdPerMillion: null }]);
  assert.match(openAiCardsProblem(removed) ?? "", /Pris saknas för gpt-5\.6-luna/);
  assert.throws(() => openAiRoutePolicy(route, removed), /Pris saknas/);
});

test("the company's profile decides the provider; the EU requirement means Azure or nothing; never a fallback", () => {
  // Standard by default, also for a policy saved before profiles existed.
  assert.equal(disabledAiSharingPolicy.profile, "standard");
  assert.equal(aiSharingPolicySchema.parse({}).profile, "standard");
  assert.equal(aiSharingPolicySchema.parse({ profile: "rubbish" }).profile, "standard");
  assert.deepEqual(chooseProvider({ requireEu: false, azureProblem: "x", profile: "standard" }), { use: "installation" });
  assert.deepEqual(chooseProvider({ requireEu: false, azureProblem: null, profile: "eu" }), { use: "azure-eu" });
  // EU chosen but not ready: no AI, never OpenAI in its place.
  const notReady = chooseProvider({ requireEu: false, azureProblem: "Pris saknas", profile: "eu" });
  assert.equal(notReady.use, "none");
  assert.match(notReady.use === "none" ? notReady.reason : "", /AI-profilen EU/);
  // EU required: Azure, or nothing (2026-11-01: bara Azure räknas som EU).
  assert.deepEqual(chooseProvider({ requireEu: true, azureProblem: null, profile: "standard" }), { use: "azure-eu" });
  assert.equal(chooseProvider({ requireEu: true, azureProblem: "x", profile: "standard" }).use, "none");
  assert.equal(chooseProvider({ requireEu: true, azureProblem: "x", profile: "eu" }).use, "none", "the chosen EU profile that is not ready is never swapped for another");
});

test("only Azure counts as the EU: saved OpenAI data marked EU is ignored everywhere (2026-11-01)", () => {
  const marked = openAiStartingCards().map((card) => ({ ...card, region: "EU", euVerified: true, euSource: "Sparad QA-källa" }));
  // The cards that apply never say EU.
  for (const card of openAiCards(marked)) {
    assert.equal(card.euVerified, false);
    assert.equal(card.euSource, "");
    assert.equal(card.region, "Global");
  }
  // The route's policy is global, also on such a card.
  assert.equal(openAiRoutePolicy(routeAiModel("SIMPLE_CHAT"), marked).processingRegion, "GLOBAL");
  // What the admin sees: Standard is never EU, also when the cards handed in say so.
  const base = { openAiCards: marked, openAiProblem: null, margin: 4_000, usdSekRateMicros: 11_000_000, creditValueOre: 83, minimumCredits: 1, free: false, routeModels: AZURE_ROUTE_MODELS };
  const [standard] = describeProfiles({ ...base, azure: azure(), azureProblem: azureProblem(azure()) });
  assert.equal(standard.id, "standard");
  assert.equal(standard.euVerified, false);
  assert.ok(standard.models.every((model) => !model.euVerified && model.euSource === ""));
  // A saved row or a server setting that says EU changes nothing about the settings that apply.
  const env = { OPENAI_PROVIDER_ENABLED: true, OPENAI_DPA_APPROVED: true, OPENAI_PROVIDER_EVAL_APPROVED: true, OPENAI_PROCESSING_REGION: "EU" as const, OPENAI_EU_DATA_CONTROLS_APPROVED: true, OPENAI_API_KEY: "sk-env" };
  const saved = effectiveOpenAiSettings({ enabled: true, dpaApproved: true, evalApproved: true, region: "EU", euControlsApproved: true, updatedAt: "2026-10-30" }, env, "sk-app");
  assert.equal("region" in saved, false);
  assert.equal("euControlsApproved" in saved, false);
  assert.equal(providerProblem(saved), null, "OpenAI keeps working, as what it is: not the EU");
  // The EU requirement with such data: Azure, or nothing. There is no way to pass OpenAI off as the EU.
  const legacy = { requireEu: true, azureProblem: "Azure-nyckel saknas.", profile: "standard" as const, standardEuVerified: true };
  assert.equal(chooseProvider(legacy).use, "none");
  assert.equal(chooseProvider({ ...legacy, azureProblem: null }).use, "azure-eu");
});

test("the profiles the admin sees: released ones only, price per usual question, models, functions, EU source; no key or address", () => {
  const base = { openAiCards: openAiCards(undefined), openAiProblem: null, margin: 4_000, usdSekRateMicros: 11_000_000, creditValueOre: 83, minimumCredits: 1, free: false, routeModels: AZURE_ROUTE_MODELS };
  const off = describeProfiles({ ...base, azure: azure({ enabled: false }), azureProblem: azureProblem(azure({ enabled: false })) });
  assert.deepEqual(off.map((profile) => profile.id), ["standard"], "EU is offered once Workflow switches the EU provider on");
  const on = describeProfiles({ ...base, azure: azure(), azureProblem: azureProblem(azure()) });
  assert.deepEqual(on.map((profile) => profile.id), ["standard", "eu"]);
  const eu = on[1];
  assert.equal(eu.provider, "Azure OpenAI");
  assert.equal(eu.ready, true);
  assert.equal(eu.euVerified, true);
  assert.ok((eu.usualCredits ?? 0) >= 1);
  assert.equal(eu.models[0].model, "gpt-5.4-mini");
  assert.equal(eu.models[0].euSource, "QA-källa");
  assert.equal(on[0].euVerified, false);
  assert.ok((on[0].usualCredits ?? 0) >= 1);
  assert.equal(JSON.stringify(on).includes("k".repeat(32)) || JSON.stringify(on).includes("services.ai.azure.com"), false);
  // Pris saknas: the profile is listed but not ready, with no price.
  const unpriced = describeProfiles({ ...base, azure: azure({ models: [azureCard({ inputUsdPerMillion: null })] }), azureProblem: azureProblem(azure({ models: [azureCard({ inputUsdPerMillion: null })] })) });
  assert.equal(unpriced[1].ready, false);
  assert.equal(unpriced[1].usualCredits, null);
  // A higher margin: a usual question costs more.
  const dear = azure({ models: [azureCard({ inputUsdPerMillion: 50, outputUsdPerMillion: 200 })] });
  const lowMargin = describeProfiles({ ...base, margin: 1_000, azure: dear, azureProblem: null })[1].usualCredits ?? 0;
  const highMargin = describeProfiles({ ...base, margin: 8_000, azure: dear, azureProblem: null })[1].usualCredits ?? 0;
  assert.ok(highMargin > lowMargin, "the margin reaches the price shown");
  // Without Workflow's credit system: no credits at all.
  assert.equal(describeProfiles({ ...base, free: true, azure: azure(), azureProblem: null })[0].usualCredits, 0);
});
