import { calculateAiUsageCost } from "@/lib/ai/cost-policy";
import {
  AI_PROFILE_NAME, AZURE_FEATURE_LABEL, azureModelEuVerified, azureModelOf, azureModelPriced, azureRoutePolicy, deploymentsFor,
  type AiProfileId, type AzureModelFeature, type AzureModelInfo, type AzureRouteModel, type AzureSettings, type StandardProviderId,
} from "@/lib/ai/azure-settings";
import { AI_PROVIDER_LABEL } from "@/lib/ai/credit-settings";
import { routeAiModel, type AiModelPolicy } from "@/lib/ai/model-catalog";
import { openAiCardWithoutEu, openAiCardsProblem, openAiRoutePolicy } from "@/lib/ai/openai-models";

// What a company's admin sees of each AI-profil (2026-10-24, 2026-11-21): pure, so the page and the tests read the same.

export const AI_FEATURE_LABELS_FOR_PROFILES: Record<AzureModelFeature, string> = AZURE_FEATURE_LABEL;
const KIND_LABEL: Record<AzureRouteModel, string> = { "gpt-5.6-luna": "Enkla svar", "gpt-5.6-terra": "Dokument och förslag", "gpt-5.6-sol": "Granskning" };
/** "A usual question": the same example as Kostnad per AI-svar (3 000 tokens in, 400 out). */
const USUAL = { inputTokens: 3_000, cachedInputTokens: 0, outputTokens: 400 };

export type ProfileModel = { kind: string; model: string; features: string[]; euVerified: boolean; euSource: string; limitations: string; priced: boolean };
export type ProfileView = {
  id: AiProfileId; name: string; provider: string; released: boolean; ready: boolean;
  /** Every model in the profile is EU-verified with a source; otherwise the profile may be processed outside the EU. */
  euVerified: boolean;
  /** About what a usual question costs in credits (null while a price is missing); 0 without Workflow's credit system. */
  usualCredits: number | null; models: ProfileModel[];
};

const modelOf = (kind: AzureRouteModel, card: AzureModelInfo | undefined, fallback: string): ProfileModel => ({
  kind: KIND_LABEL[kind], model: card?.modelName || card?.deployment || fallback, features: (card?.features ?? []).map((feature) => AZURE_FEATURE_LABEL[feature]),
  euVerified: azureModelEuVerified(card), euSource: azureModelEuVerified(card) ? card?.euSource ?? "" : "", limitations: card?.limitations ?? "", priced: azureModelPriced(card),
});

export function describeProfiles(input: {
  /** Leverantör för Standard: Azure in Cloud, OpenAI or Azure in Community. */
  standardProvider: StandardProviderId;
  openAiCards: AzureModelInfo[]; openAiProblem: string | null; azure: AzureSettings;
  /** What stops each Azure profile (azureProblem), or null. */
  azureProblems: Record<AiProfileId, string | null>;
  margin: number; usdSekRateMicros: number; creditValueOre: number; minimumCredits: number; free: boolean; routeModels: readonly AzureRouteModel[];
}): ProfileView[] {
  const usual = (policy: AiModelPolicy | null) => {
    if (!policy) return null;
    if (input.free) return 0;
    return calculateAiUsageCost(USUAL, { ...policy, targetGrossMarginBps: input.margin, creditFloorValueOre: input.creditValueOre, minimumCredits: input.minimumCredits, usdSekRateMicros: input.usdSekRateMicros }).chargedCredits;
  };
  const tryPolicy = (make: () => AiModelPolicy) => { try { return make(); } catch { return null; } };
  const chat = routeAiModel("SIMPLE_CHAT");
  const azureModels = (profile: AiProfileId) => input.routeModels.map((kind) => { const deployment = deploymentsFor(input.azure, profile)[kind] ?? ""; return modelOf(kind, azureModelOf(input.azure, deployment), deployment); });
  const azureProfile = (profile: AiProfileId, released: boolean): ProfileView => {
    const models = azureModels(profile);
    return {
      id: profile, name: AI_PROFILE_NAME[profile], provider: AI_PROVIDER_LABEL.AZURE_OPENAI, released, ready: input.azureProblems[profile] === null,
      // EU follows each model (2026-11-21): the EU profile only when it is ready (every model EU-verified); Standard when all its models happen to be.
      euVerified: profile === "eu" ? input.azureProblems.eu === null : models.length > 0 && models.every((model) => model.euVerified),
      usualCredits: usual(tryPolicy(() => azureRoutePolicy(chat, input.azure, profile))),
      models,
    };
  };
  const standard: ProfileView = input.standardProvider === "AZURE_OPENAI" ? azureProfile("standard", true) : {
    id: "standard", name: AI_PROFILE_NAME.standard, provider: AI_PROVIDER_LABEL.OPENAI, released: true,
    ready: input.openAiProblem === null && openAiCardsProblem(input.openAiCards) === null,
    // OpenAI is never EU, whatever a card says (2026-11-01).
    euVerified: false,
    usualCredits: usual(tryPolicy(() => openAiRoutePolicy(chat, input.openAiCards))),
    models: input.routeModels.map((kind) => { const card = input.openAiCards.find((item) => item.deployment === kind); return modelOf(kind, card && openAiCardWithoutEu(card), kind); }),
  };
  const eu = azureProfile("eu", input.azure.requested);
  // Only released profiles are offered; Standard is the installation's own and always listed.
  return [standard, ...(eu.released ? [eu] : [])];
}
