import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COMPANY_KEY_OFF, COMPANY_KEY_PAUSE, companyKeyChoiceOf, companyKeyFailure, companyKeyInputSchema, companyKeyPolicy, companyKeyProblem,
  isCompanyKeyPause, parseCompanyKey, validCompanyKeyValue, type CompanyKeySettings,
} from "../lib/ai/company-key";
import { aiRunPayer } from "../lib/ai/payer";
import { routeAiModel } from "../lib/ai/model-catalog";
import { aiSharingPolicySchema } from "../lib/ai/sharing-policy";
import { costText } from "../lib/agents/check";
import { EXTERNAL_PROVIDERS, isOtherKeyProvider } from "../lib/integrations/key-catalog";

// Använd företagets egen AI-nyckel (2026-11-27, 6b punkt 1–3): the rules without a database. The server path (sealed key,
// the adapters, the pause, the ledger) is tests/company-ai-key.integration.ts.

const azure: CompanyKeySettings = { ...COMPANY_KEY_OFF, on: true, provider: "azure-openai", endpoint: "https://qa-kund.openai.azure.com/openai/v1", model: "gpt-5.4-mini" };
const openai: CompanyKeySettings = { ...COMPANY_KEY_OFF, on: true, provider: "openai", model: "gpt-5.4-mini" };

test("Workflow AI is the default: an older policy has no own key, and a broken one reads as off", () => {
  assert.equal(parseCompanyKey(undefined).on, false);
  assert.equal(parseCompanyKey({ on: "ja" }).on, false);
  assert.equal(aiSharingPolicySchema.parse({}).ownKey, undefined);
  assert.equal(aiSharingPolicySchema.parse({ ownKey: { on: true, provider: "anthropic" } }).ownKey?.provider, "azure-openai", "an unknown provider is never used as such");
});

test("paus vid fel nyckel: a missing key, a bad address or model, or a refused key pauses with a reason – never Workflow's provider", () => {
  for (const [settings, keyStored, pattern] of [
    [azure, false, /saknas/],
    [{ ...azure, endpoint: "https://evil.example.com" }, true, /adressen/],
    [{ ...azure, model: "" }, true, /driftsättning saknas/],
    [{ ...openai, model: "fel modell" }, true, /modell saknas eller ser fel ut/],
    [{ ...azure, pausedReason: "Azure godtar inte nyckeln." }, true, /fungerade inte senast: Azure godtar inte nyckeln/],
  ] as const) {
    const choice = companyKeyChoiceOf({ settings, keyStored, requireEu: false });
    assert.equal(choice.use, "none", JSON.stringify(settings));
    if (choice.use === "none") {
      assert.match(choice.reason, pattern);
      assert.ok(isCompanyKeyPause(choice.reason), "every reason is the company key's own, so a mission pauses on it");
    }
  }
  const ready = companyKeyChoiceOf({ settings: azure, keyStored: true, requireEu: false });
  assert.deepEqual(ready, { use: "company", provider: "azure-openai", endpoint: "https://qa-kund.openai.azure.com", model: "gpt-5.4-mini", region: "GLOBAL" });
});

test("EU-kravet: only the company's own Azure resource, and only once the admin has attested it; an OpenAI key is blocked", () => {
  assert.match(companyKeyProblem({ settings: openai, keyStored: true, requireEu: true }) ?? "", /en OpenAI-nyckel spärrad/);
  assert.match(companyKeyProblem({ settings: azure, keyStored: true, requireEu: true }) ?? "", /intyga att företagets Azure-resurs ligger i EU/);
  const attested = companyKeyChoiceOf({ settings: { ...azure, euAttested: true }, keyStored: true, requireEu: true });
  assert.equal(attested.use, "company");
  if (attested.use === "company") assert.equal(attested.region, "EU");
  // OpenAI is never counted as the EU, even without the requirement and with a statement.
  const plain = companyKeyChoiceOf({ settings: { ...openai, euAttested: true }, keyStored: true, requireEu: false });
  assert.equal(plain.use === "company" && plain.region, "GLOBAL");
});

test("a run on the company's key is recorded as Företagets nyckel, at (almost) no cost to Workflow", () => {
  const choice = companyKeyChoiceOf({ settings: azure, keyStored: true, requireEu: false });
  assert.equal(choice.use, "company");
  if (choice.use !== "company") return;
  const policy = companyKeyPolicy(routeAiModel("SIMPLE_CHAT"), choice);
  assert.equal(policy.provider, "AZURE_OPENAI");
  assert.equal(policy.model, "gpt-5.4-mini");
  assert.equal(policy.inputPriceUsdMicrosPerMillion, 1);
  assert.equal(aiRunPayer({ pricingVersion: policy.pricingVersion, reservedCredits: 0 }), "company");
});

test("the provider's refusal: a refused key or a missing model pauses, a full quota does not; no provider text and no key", () => {
  const secret = "q".repeat(40);
  const refused = companyKeyFailure("openai", Object.assign(new Error(`nope ${secret}`), { status: 401 }), "gpt-5.4-mini");
  assert.deepEqual(refused, { message: "OpenAI godtar inte nyckeln.", pause: true });
  assert.equal(companyKeyFailure("azure-openai", Object.assign(new Error("x"), { status: 404, code: "DeploymentNotFound" }), "min-drift").pause, true);
  assert.equal(companyKeyFailure("openai", Object.assign(new Error("x"), { status: 429 }), "m").pause, false);
  assert.equal(JSON.stringify(refused).includes(secret), false);
  assert.ok(COMPANY_KEY_PAUSE.length > 0);
});

test("the key's form is checked before it is sealed, and the API takes nothing else", () => {
  assert.equal(validCompanyKeyValue("openai", "sk-" + "a".repeat(30)), true);
  assert.equal(validCompanyKeyValue("openai", "a".repeat(40)), false);
  assert.equal(validCompanyKeyValue("azure-openai", "A1".repeat(16)), true);
  assert.equal(companyKeyInputSchema.safeParse({ action: "save", on: true, provider: "azure-openai", extra: 1 }).success, false);
  assert.equal(companyKeyInputSchema.safeParse({ action: "save", on: true, provider: "anthropic" }).success, false);
});

test("the keys live on their own card: not under Övriga nycklar, and each row says what Workflow does with it", () => {
  assert.equal(isOtherKeyProvider("openai"), false);
  assert.equal(isOtherKeyProvider("azure-openai"), false);
  for (const key of ["openai", "azure-openai"]) assert.match(EXTERNAL_PROVIDERS.find((item) => item.key === key)!.use, /egen AI-nyckel/);
});

test("an agent's cost line says Företagets nyckel, never credits, with the company's key", () => {
  assert.match(costText("ai", { system: true, companyKey: true }), /^Företagets nyckel/);
  assert.match(costText("ai", { system: true }), /krediter/);
});
