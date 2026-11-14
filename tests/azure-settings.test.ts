import assert from "node:assert/strict";
import test from "node:test";
import { azureErrorMessage, azureProbeInputSchema, azureInputSchema, azureModelEuVerified, azureModelPriced, azureModelSchema, azureProblem, azureRoutePolicy, blankAzureModel, chooseProvider, effectiveAzureSettings, normalizeAzureEndpoint, storedAzureSchema, usedDeployments, validAzureEndpoint, validAzureKey, validDeployment } from "../lib/ai/azure-settings";
import { quoteAiRun } from "../lib/ai/cost-policy";
import { fromModelForm, modelCardsFor, parsePrice, toModelForm } from "../features/ai/azure-model-form";
import { routeAiModel } from "../lib/ai/model-catalog";
import { aiSharingPolicySchema, disabledAiSharingPolicy } from "../lib/ai/sharing-policy";

// EU (2026-10-19): a company that requires the EU gets the EU provider or no AI at all.
// Synthetic prices (QA only, not a provider's price list) for the models behind the default deployment names.
const model = (deployment: string, patch: Record<string, unknown> = {}) => ({ deployment, inputUsdPerMillion: 1, outputUsdPerMillion: 4, euVerified: true, euSource: "QA-källa", ...patch });
const models = [model("gpt-5.6-luna"), model("gpt-5.6-terra"), model("gpt-5.6-sol")];
const stored = (patch: Record<string, unknown> = {}) => storedAzureSchema.parse({ enabled: true, endpoint: "https://exempel-eu.openai.azure.com/", euConfirmed: true, dpaApproved: true, models, ...patch });
const ready = () => effectiveAzureSettings(stored(), "k".repeat(32));

test("only Microsoft's Azure addresses are accepted, so a typo can never send the data elsewhere", () => {
  assert.equal(validAzureEndpoint("https://exempel-eu.openai.azure.com"), true);
  assert.equal(validAzureEndpoint("https://exempel-eu.openai.azure.com/"), true);
  assert.equal(validAzureEndpoint("http://exempel-eu.openai.azure.com"), false);
  assert.equal(validAzureEndpoint("https://exempel-eu.openai.azure.com.evil.example"), false);
  assert.equal(validAzureEndpoint("https://evil.example/openai.azure.com"), false);
  assert.equal(validAzureEndpoint("https://user@exempel-eu.openai.azure.com"), false);
  assert.equal(validAzureEndpoint(""), false);
  assert.equal(validAzureKey("short"), false);
  assert.equal(validAzureKey("a".repeat(32)), true);
  assert.equal(validDeployment("gpt-5.6-luna"), true);
  assert.equal(validDeployment("../x"), false);
});

test("the EU provider is usable only when every part is in place", () => {
  assert.equal(azureProblem(ready()), null);
  assert.match(azureProblem(effectiveAzureSettings(stored({ enabled: false }), "k".repeat(32))) ?? "", /inte påslagen/);
  assert.match(azureProblem(effectiveAzureSettings(stored({ endpoint: "https://x.example" }), "k".repeat(32))) ?? "", /adressen/i);
  assert.match(azureProblem(effectiveAzureSettings(stored(), "")) ?? "", /nyckel saknas/);
  assert.match(azureProblem(effectiveAzureSettings(stored({ euConfirmed: false }), "k".repeat(32))) ?? "", /EU/);
  assert.match(azureProblem(effectiveAzureSettings(stored({ dpaApproved: false }), "k".repeat(32))) ?? "", /avtal/i);
  assert.match(azureProblem(effectiveAzureSettings(stored({ deployments: { "gpt-5.6-luna": "", "gpt-5.6-terra": "a", "gpt-5.6-sol": "b" } }), "k".repeat(32))) ?? "", /driftsättningsnamn/);
  // Rubbish stored there reads as everything off.
  assert.equal(azureProblem(effectiveAzureSettings(storedAzureSchema.parse("rubbish"), "k".repeat(32))) !== null, true);
});

test("a company that requires the EU never gets another provider (only Azure counts, 2026-11-01)", () => {
  assert.deepEqual(chooseProvider({ requireEu: false, azureProblem: "anything" }), { use: "installation" });
  assert.deepEqual(chooseProvider({ requireEu: false, azureProblem: null }), { use: "installation" });
  assert.deepEqual(chooseProvider({ requireEu: true, azureProblem: null }), { use: "azure-eu" });
  const refused = chooseProvider({ requireEu: true, azureProblem: "Azure-nyckel saknas." });
  assert.equal(refused.use, "none");
  assert.match(refused.use === "none" ? refused.reason : "", /EU/);
});

test("the company's EU choice and the machine sharing choice are off from the start and survive a round trip", () => {
  assert.equal(disabledAiSharingPolicy.requireEu, false);
  assert.equal(disabledAiSharingPolicy.shareMachines, false);
  assert.equal(aiSharingPolicySchema.parse({}).requireEu, false);
  const saved = aiSharingPolicySchema.parse({ enabled: true, shareChatContent: true, requireEu: true, shareMachines: true });
  assert.equal(saved.requireEu, true);
  assert.equal(aiSharingPolicySchema.parse(JSON.parse(JSON.stringify(saved))).requireEu, true);
});

test("the input is strict and keeps the key out of what is stored in the open", () => {
  assert.equal(azureInputSchema.safeParse({ enabled: true, endpoint: "https://a.openai.azure.com", deployments: { "gpt-5.6-luna": "a", "gpt-5.6-terra": "b", "gpt-5.6-sol": "c" }, euConfirmed: true, dpaApproved: true, extra: 1 }).success, false);
});

test("the Foundry address is accepted as well, and a pasted /openai/v1 is taken off", () => {
  assert.equal(validAzureEndpoint("https://exempel-ai.services.ai.azure.com"), true);
  assert.equal(validAzureEndpoint("https://exempel-ai.services.ai.azure.com/openai/v1"), true);
  assert.equal(validAzureEndpoint("https://exempel-ai.services.ai.azure.com/openai/v1/"), true);
  assert.equal(normalizeAzureEndpoint("https://exempel-ai.services.ai.azure.com/openai/v1/"), "https://exempel-ai.services.ai.azure.com");
  assert.equal(validAzureEndpoint("https://x1.cognitiveservices.azure.com"), true);
  // Nothing but Microsoft's own domains: not a look-alike, not another path on another host.
  assert.equal(validAzureEndpoint("https://x1.services.ai.azure.com.evil.example"), false);
  assert.equal(validAzureEndpoint("https://evil.example/x1.services.ai.azure.com"), false);
  assert.equal(validAzureEndpoint("https://x1.ai.azure.com"), false);
  assert.equal(validAzureEndpoint("https://x1.services.ai.azure.com/api/projects/p"), false);
});

test("a model without a price or without a verified EU source stops the EU provider (no guessed price, no unverified EU)", () => {
  const key = "k".repeat(32);
  assert.match(azureProblem(effectiveAzureSettings(stored({ models: [model("gpt-5.6-luna"), model("gpt-5.6-terra")] }), key)) ?? "", /Uppgifter om modellen saknas.*gpt-5\.6-sol/);
  assert.match(azureProblem(effectiveAzureSettings(stored({ models: [model("gpt-5.6-luna", { outputUsdPerMillion: null }), model("gpt-5.6-terra"), model("gpt-5.6-sol")] }), key)) ?? "", /Pris saknas för gpt-5\.6-luna/);
  assert.match(azureProblem(effectiveAzureSettings(stored({ models: [model("gpt-5.6-luna", { euSource: "" }), model("gpt-5.6-terra"), model("gpt-5.6-sol")] }), key)) ?? "", /EU-behandling är inte verifierad/);
  assert.match(azureProblem(effectiveAzureSettings(stored({ models: [model("gpt-5.6-luna", { euVerified: false }), model("gpt-5.6-terra"), model("gpt-5.6-sol")] }), key)) ?? "", /EU-behandling är inte verifierad/);
  // A price of zero or below is not a price.
  assert.equal(azureModelSchema.safeParse(model("x", { inputUsdPerMillion: 0 })).success, false);
  // One deployment for all three kinds of answer (Workflow's gpt-5.4-mini) needs one card.
  const one = effectiveAzureSettings(stored({ deployments: { "gpt-5.6-luna": "gpt-5.4-mini", "gpt-5.6-terra": "gpt-5.4-mini", "gpt-5.6-sol": "gpt-5.4-mini" }, models: [model("gpt-5.4-mini")] }), key);
  assert.deepEqual(usedDeployments(one), ["gpt-5.4-mini"]);
  assert.equal(azureProblem(one), null);
  // A company that requires the EU then gets no AI at all – never another provider.
  const refused = chooseProvider({ requireEu: true, azureProblem: azureProblem(effectiveAzureSettings(stored({ models: [] }), key)) });
  assert.equal(refused.use, "none");
});

test("an Azure run is priced with the Azure model's own prices, the shared margin and recorded as Azure in the EU", () => {
  const settings = effectiveAzureSettings(stored({ deployments: { "gpt-5.6-luna": "gpt-5.4-mini", "gpt-5.6-terra": "gpt-5.4-mini", "gpt-5.6-sol": "gpt-5.4-mini" }, models: [model("gpt-5.4-mini", { modelName: "gpt-5.4-mini", inputUsdPerMillion: 0.5, cachedInputUsdPerMillion: 0.05, outputUsdPerMillion: 3, priceSetOn: "2026-10-24" })] }), "k".repeat(32));
  const route = routeAiModel("SIMPLE_CHAT");
  const policy = azureRoutePolicy(route, settings);
  assert.equal(policy.provider, "AZURE_OPENAI");
  assert.equal(policy.model, "gpt-5.4-mini");
  assert.equal(policy.processingRegion, "EU");
  assert.equal(policy.inputPriceUsdMicrosPerMillion, 500_000);
  assert.equal(policy.cachedInputPriceUsdMicrosPerMillion, 50_000);
  assert.equal(policy.outputPriceUsdMicrosPerMillion, 3_000_000);
  assert.equal(policy.reasoningEffort, route.reasoningEffort);
  assert.equal(policy.targetGrossMarginBps, route.targetGrossMarginBps, "one central margin, no Azure uplift");
  assert.equal(policy.minimumCredits, route.minimumCredits);
  assert.equal(policy.pricingVersion, "azure-gpt-5.4-mini-2026-10-24-500000-50000-3000000");
  // A new price is a new pricing version, so earlier runs keep what they were priced with.
  const repriced = azureRoutePolicy(route, { ...settings, models: [{ ...settings.models[0], outputUsdPerMillion: 4 }] });
  assert.notEqual(repriced.pricingVersion, policy.pricingVersion);
  // Without a cache price cached input costs as ordinary input.
  const noCache = azureRoutePolicy(route, { ...settings, models: [{ ...settings.models[0], cachedInputUsdPerMillion: null }] });
  assert.equal(noCache.cachedInputPriceUsdMicrosPerMillion, 500_000);
  // The estimate before a run uses the same policy: a dearer model reserves more credits.
  const base = { taskKind: "SIMPLE_CHAT" as const, inputTokenLimit: 8_000, maxOutputTokens: 1_200, usdSekRateMicros: 11_000_000, minimumCredits: 1 };
  const cheap = quoteAiRun({ ...base, policy });
  const dear = quoteAiRun({ ...base, policy: azureRoutePolicy(route, { ...settings, models: [{ ...settings.models[0], inputUsdPerMillion: 5, outputUsdPerMillion: 30 }] }) });
  assert.ok(dear.reservedCredits > cheap.reservedCredits);
  assert.equal(cheap.policy.provider, "AZURE_OPENAI");
  assert.equal(quoteAiRun({ ...base, policy, free: true }).reservedCredits, 0, "without the credit system (community) nothing is reserved");
  // No price: no policy at all, never a fallback price.
  assert.throws(() => azureRoutePolicy(route, { ...settings, models: [{ ...settings.models[0], inputUsdPerMillion: null }] }), /Pris saknas/);
  assert.throws(() => azureRoutePolicy(route, { ...settings, models: [] }), /saknas/);
});

test("the installation's suggestion fills a blank card with the EU source but never a price or a feature", () => {
  const preset = { endpoint: "https://exempel-ai.services.ai.azure.com", deployment: "gpt-5.4-mini", modelName: "gpt-5.4-mini", region: "Sweden Central", deploymentType: "Data Zone Standard (EUR)", euSource: "Microsoft Foundry, distribution bekräftad 2026-10-24", limitations: "Inte ett GDPR-intyg för hela Workflow." };
  const card = blankAzureModel("gpt-5.4-mini", preset);
  assert.equal(card.euVerified, true);
  assert.match(card.euSource, /Microsoft Foundry, distribution bekräftad 2026-10-24/);
  assert.match(card.limitations, /Inte ett GDPR-intyg för hela Workflow/);
  assert.equal(card.inputUsdPerMillion, null);
  assert.equal(card.outputUsdPerMillion, null);
  assert.deepEqual(card.features, []);
  assert.equal(azureModelPriced(card), false, "the suggestion alone cannot be used: pris saknas");
  // Another deployment, or an installation without a suggestion (community), gets a blank card that is not EU.
  assert.equal(blankAzureModel("annan", preset).euVerified, false);
  assert.equal(blankAzureModel("gpt-5.4-mini", null).euVerified, false);
});

test("the model cards are strict input and survive a round trip; rubbish stored reads as no models", () => {
  const input = { enabled: true, endpoint: "https://a1.services.ai.azure.com", deployments: { "gpt-5.6-luna": "m", "gpt-5.6-terra": "m", "gpt-5.6-sol": "m" }, euConfirmed: true, dpaApproved: true };
  assert.equal(azureInputSchema.safeParse({ ...input, models: [model("m")] }).success, true);
  assert.equal(azureInputSchema.safeParse({ ...input, models: [{ ...model("m"), apiKey: "x" }] }).success, false);
  assert.equal(azureInputSchema.safeParse(input).success, true, "an older page without cards keeps the saved ones");
  const saved = storedAzureSchema.parse({ ...input, models: [model("m", { features: ["tools"], priceSetOn: "2026-10-24" })] });
  assert.deepEqual(storedAzureSchema.parse(JSON.parse(JSON.stringify(saved))).models, saved.models);
  assert.deepEqual(storedAzureSchema.parse({ ...input, models: "rubbish" }).models, []);
  assert.equal(azureModelEuVerified(saved.models[0]), true);
});

test("the form takes prices as typed text (comma or point), refuses anything but a number above zero and shows one card per deployment", () => {
  assert.deepEqual(parsePrice(""), { ok: true, value: null });
  assert.deepEqual(parsePrice(" 0,25 "), { ok: true, value: 0.25 });
  assert.deepEqual(parsePrice("1.5"), { ok: true, value: 1.5 });
  assert.equal(parsePrice("0").ok, false);
  assert.equal(parsePrice("-1").ok, false);
  assert.equal(parsePrice("gratis").ok, false);
  const card = toModelForm(azureModelSchema.parse(model("m", { cachedInputUsdPerMillion: null })));
  assert.equal(card.cached, "");
  assert.deepEqual(fromModelForm(card), azureModelSchema.parse(model("m", { cachedInputUsdPerMillion: null })));
  assert.equal(fromModelForm({ ...card, output: "x" }), null);
  const cards = modelCardsFor({ "gpt-5.6-luna": "a", "gpt-5.6-terra": "a", "gpt-5.6-sol": "b" }, [card], null);
  assert.deepEqual(cards.map((item) => item.deployment), ["a", "b"]);
  assert.equal(cards[0].input, "", "a new deployment gets a blank card: pris saknas");
});

test("Azure's errors are told in Swedish from the status and code only – wrong key, address, deployment, quota – never Azure's own text or the key", () => {
  const secret = "hemlig" + "k".repeat(30);
  const cases: [unknown, RegExp][] = [
    [{ status: 401, message: secret }, /godtar inte nyckeln/],
    [{ status: 403 }, /godtar inte nyckeln/],
    [{ status: 404, code: "DeploymentNotFound" }, /Driftsättningen gpt-5.4-mini finns inte på resursen/],
    [{ status: 404 }, /hittar inte adressen/],
    [{ status: 429, message: secret }, /kvoten/],
    [{ status: 400, code: "unsupported_parameter" }, /resonerande modell/],
    [{ status: 400, code: "<script>" }, /^Azure nekade anropet.$/],
    [{ status: 503 }, /fel just nu/],
    [{ name: "APIConnectionError" }, /Adressen svarar inte/],
    [{ name: "APIConnectionTimeoutError" }, /i tid/],
    [{ cause: { code: "ENOTFOUND" } }, /Adressen svarar inte/],
    [null, /svarade inte/],
  ];
  for (const [error, expected] of cases) {
    const text = azureErrorMessage(error, "gpt-5.4-mini");
    assert.match(text, expected);
    assert.equal(text.includes(secret), false);
  }
  assert.match(azureErrorMessage({ status: 404, code: "DeploymentNotFound" }, "../x"), /^Driftsättningen finns inte/, "a bad name is never echoed");
  assert.equal(azureProbeInputSchema.safeParse({ question: "x".repeat(301) }).success, false, "a trial question is short");
});
