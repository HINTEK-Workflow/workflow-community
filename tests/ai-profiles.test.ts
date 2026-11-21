import assert from "node:assert/strict";
import test from "node:test";
import { describeProfiles } from "../lib/ai/ai-profiles";
import { AZURE_ROUTE_MODELS, azureProblem, chooseProvider, effectiveAzureSettings, standardProviderOf, storedAzureSchema, type AzureSettings } from "../lib/ai/azure-settings";
import { GLOBAL_MODEL_PRICES, routeAiModel } from "../lib/ai/model-catalog";
import { OPENAI_ROUTE_MODELS, openAiCards, openAiCardsProblem, openAiRoutePolicy, openAiStartingCards } from "../lib/ai/openai-models";
import { effectiveOpenAiSettings, providerProblem } from "../lib/ai/provider-settings";
import { aiSharingPolicySchema, disabledAiSharingPolicy } from "../lib/ai/sharing-policy";

// AI-profiler, prices as fields (2026-10-24, svar 1 and 3; 2026-11-21: Workflow AI on Azure). Synthetic prices only.
const azureCard = (patch: Record<string, unknown> = {}) => ({ deployment: "gpt-5.4-mini", modelName: "gpt-5.4-mini", inputUsdPerMillion: 0.5, outputUsdPerMillion: 3, euVerified: true, euSource: "QA-källa", ...patch });
const globalCard = (patch: Record<string, unknown> = {}) => ({ deployment: "std-mini", modelName: "gpt-5.4-mini", inputUsdPerMillion: 0.4, outputUsdPerMillion: 2.5, ...patch });
const set = (name: string) => ({ "gpt-5.6-luna": name, "gpt-5.6-terra": name, "gpt-5.6-sol": name });
const azure = (patch: Record<string, unknown> = {}) => effectiveAzureSettings(storedAzureSchema.parse({
  enabled: true, endpoint: "https://qa.services.ai.azure.com", dpaApproved: true,
  deployments: set("gpt-5.4-mini"), standardDeployments: set("std-mini"), models: [azureCard(), globalCard()], ...patch,
}), "k".repeat(32));
const problems = (settings: AzureSettings) => ({ standard: azureProblem(settings, "standard"), eu: azureProblem(settings, "eu") });
const READY = { standard: null, eu: null };

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

test("Leverantör för Standard: Azure in Cloud whatever is saved; OpenAI by default in Community, Azure selectable", () => {
  assert.equal(standardProviderOf("OPENAI", false), "AZURE_OPENAI");
  assert.equal(standardProviderOf(undefined, false), "AZURE_OPENAI");
  assert.equal(standardProviderOf(undefined, true), "OPENAI");
  assert.equal(standardProviderOf("OPENAI", true), "OPENAI");
  assert.equal(standardProviderOf("AZURE_OPENAI", true), "AZURE_OPENAI");
  assert.equal(standardProviderOf("rubbish", true), "OPENAI");
});

test("the company's profile decides the provider and the deployments; the EU requirement means EU models or nothing; never a fallback", () => {
  // Standard by default, also for a policy saved before profiles existed.
  assert.equal(disabledAiSharingPolicy.profile, "standard");
  assert.equal(aiSharingPolicySchema.parse({}).profile, "standard");
  assert.equal(aiSharingPolicySchema.parse({ profile: "rubbish" }).profile, "standard");
  // Cloud: Standard is Azure's Standard deployments.
  // A neutral operator name: the Community export rewrites "på servern" in texts, and the test must read the same in both editions.
  const cloud = { standardProvider: "AZURE_OPENAI" as const, operator: "Driftaren" };
  assert.deepEqual(chooseProvider({ ...cloud, requireEu: false, profile: "standard", azureProblems: READY }), { use: "azure", profile: "standard" });
  assert.deepEqual(chooseProvider({ ...cloud, requireEu: false, profile: "eu", azureProblems: READY }), { use: "azure", profile: "eu" });
  // Standard not ready: no AI, never the EU deployments or OpenAI in its place.
  const standardDown = chooseProvider({ ...cloud, requireEu: false, profile: "standard", azureProblems: { standard: "Pris saknas", eu: null } });
  assert.equal(standardDown.use, "none");
  assert.match(standardDown.use === "none" ? standardDown.reason : "", /AI-profilen Standard är inte klar hos Driftaren/);
  // EU chosen but not ready: no AI, never Standard in its place.
  const notReady = chooseProvider({ ...cloud, requireEu: false, profile: "eu", azureProblems: { standard: null, eu: "Pris saknas" } });
  assert.equal(notReady.use, "none");
  assert.match(notReady.use === "none" ? notReady.reason : "", /AI-profilen EU/);
  // EU required: the EU profile, or nothing, whatever the chosen profile.
  assert.deepEqual(chooseProvider({ ...cloud, requireEu: true, profile: "standard", azureProblems: READY }), { use: "azure", profile: "eu" });
  const required = chooseProvider({ ...cloud, requireEu: true, profile: "standard", azureProblems: { standard: null, eu: "x" } });
  assert.equal(required.use, "none");
  assert.match(required.use === "none" ? required.reason : "", /ingen EU-modell är klar hos Driftaren/);
  // Community with OpenAI for Standard: OpenAI, while EU still means Azure's EU models.
  const community = { standardProvider: "OPENAI" as const, operator: "Exempel" };
  assert.deepEqual(chooseProvider({ ...community, requireEu: false, profile: "standard", azureProblems: { standard: "x", eu: "x" } }), { use: "openai" });
  assert.deepEqual(chooseProvider({ ...community, requireEu: true, profile: "standard", azureProblems: { standard: "x", eu: null } }), { use: "azure", profile: "eu" });
  assert.match(JSON.stringify(chooseProvider({ ...community, requireEu: true, profile: "standard", azureProblems: { standard: "x", eu: "x" } })), /klar hos Exempel/);
});

test("OpenAI never counts as the EU: saved OpenAI data marked EU is ignored everywhere (2026-11-01)", () => {
  const marked = openAiStartingCards().map((card) => ({ ...card, region: "EU", euVerified: true, euSource: "Sparad QA-källa" }));
  for (const card of openAiCards(marked)) {
    assert.equal(card.euVerified, false);
    assert.equal(card.euSource, "");
    assert.equal(card.region, "Global");
  }
  assert.equal(openAiRoutePolicy(routeAiModel("SIMPLE_CHAT"), marked).processingRegion, "GLOBAL");
  // Community's Standard on OpenAI is never EU, also when the cards handed in say so.
  const base = { standardProvider: "OPENAI" as const, openAiCards: marked, openAiProblem: null, margin: 5_000, usdSekRateMicros: 11_000_000, creditValueOre: 83, minimumCredits: 1, free: false, routeModels: AZURE_ROUTE_MODELS };
  const [standard] = describeProfiles({ ...base, azure: azure(), azureProblems: problems(azure()) });
  assert.equal(standard.id, "standard");
  assert.equal(standard.provider, "OpenAI");
  assert.equal(standard.euVerified, false);
  assert.ok(standard.models.every((model) => !model.euVerified && model.euSource === ""));
  const env = { OPENAI_PROVIDER_ENABLED: true, OPENAI_DPA_APPROVED: true, OPENAI_PROVIDER_EVAL_APPROVED: true, OPENAI_PROCESSING_REGION: "EU" as const, OPENAI_EU_DATA_CONTROLS_APPROVED: true, OPENAI_API_KEY: "sk-env" };
  const saved = effectiveOpenAiSettings({ enabled: true, dpaApproved: true, evalApproved: true, region: "EU", euControlsApproved: true, updatedAt: "2026-10-30" }, env, "sk-app");
  assert.equal("region" in saved, false);
  assert.equal("euControlsApproved" in saved, false);
  assert.equal(providerProblem(saved), null, "OpenAI keeps working, as what it is: not the EU");
});

test("the profiles the admin sees (Cloud): both on Azure, EU status per model, price per usual question; no key or address", () => {
  const base = { standardProvider: "AZURE_OPENAI" as const, openAiCards: openAiCards(undefined), openAiProblem: "AI är inte påslaget.", margin: 5_000, usdSekRateMicros: 11_000_000, creditValueOre: 83, minimumCredits: 1, free: false, routeModels: AZURE_ROUTE_MODELS };
  const off = describeProfiles({ ...base, azure: azure({ enabled: false }), azureProblems: problems(azure({ enabled: false })) });
  assert.deepEqual(off.map((profile) => profile.id), ["standard"], "EU is offered once Workflow switches Azure on");
  assert.equal(off[0].ready, false);
  const on = describeProfiles({ ...base, azure: azure(), azureProblems: problems(azure()) });
  assert.deepEqual(on.map((profile) => profile.id), ["standard", "eu"]);
  const [standard, eu] = on;
  assert.equal(standard.provider, "Microsoft Azure");
  assert.equal(standard.ready, true, "the OpenAI key is not needed in Cloud");
  assert.equal(standard.euVerified, false, "Global Standard models: may be processed outside the EU");
  assert.equal(standard.models[0].model, "gpt-5.4-mini");
  assert.equal(eu.provider, "Microsoft Azure");
  assert.equal(eu.ready, true);
  assert.equal(eu.euVerified, true);
  assert.equal(eu.models[0].euSource, "QA-källa");
  assert.ok((eu.usualCredits ?? 0) >= 1);
  assert.equal(JSON.stringify(on).includes("k".repeat(32)) || JSON.stringify(on).includes("services.ai.azure.com"), false);
  // Standard on EU-verified models only (one deployment for both): its badge follows the models.
  const same = azure({ standardDeployments: set("gpt-5.4-mini") });
  assert.equal(describeProfiles({ ...base, azure: same, azureProblems: problems(same) })[0].euVerified, true);
  // Pris saknas: the profile is listed but not ready, with no price.
  const unpriced = azure({ models: [azureCard({ inputUsdPerMillion: null }), globalCard()] });
  const listed = describeProfiles({ ...base, azure: unpriced, azureProblems: problems(unpriced) });
  assert.equal(listed[1].ready, false);
  assert.equal(listed[1].usualCredits, null);
  assert.equal(listed[0].ready, true, "the other profile is not touched");
  // A higher markup: a usual question costs more.
  const dear = azure({ models: [azureCard({ inputUsdPerMillion: 50, outputUsdPerMillion: 200 }), globalCard()] });
  const low = describeProfiles({ ...base, margin: 1_000, azure: dear, azureProblems: READY })[1].usualCredits ?? 0;
  const high = describeProfiles({ ...base, margin: 8_000, azure: dear, azureProblems: READY })[1].usualCredits ?? 0;
  assert.ok(high > low, "the markup reaches the price shown");
  // Included in the subscription (or no credit system): no credits at all.
  assert.equal(describeProfiles({ ...base, free: true, azure: azure(), azureProblems: READY })[0].usualCredits, 0);
});
