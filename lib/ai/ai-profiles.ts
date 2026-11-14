import { calculateAiUsageCost } from "@/lib/ai/cost-policy";
import {
  AI_PROFILE_NAME, AZURE_FEATURE_LABEL, azureModelEuVerified, azureModelOf, azureModelPriced, azureRoutePolicy,
  type AiProfileId, type AzureModelFeature, type AzureModelInfo, type AzureRouteModel, type AzureSettings,
} from "@/lib/ai/azure-settings";
import { routeAiModel, type AiModelPolicy } from "@/lib/ai/model-catalog";
import { openAiCardWithoutEu, openAiCardsProblem, openAiRoutePolicy } from "@/lib/ai/openai-models";

// What a company's admin sees of each AI-profil (2026-10-24): pure, so the page and the tests read the same.

export const AI_FEATURE_LABELS_FOR_PROFILES: Record<AzureModelFeature, string> = AZURE_FEATURE_LABEL;
const KIND_LABEL: Record<AzureRouteModel, string> = { "gpt-5.6-luna": "Enkla svar", "gpt-5.6-terra": "Dokument och förslag", "gpt-5.6-sol": "Granskning" };
/** "A usual question": the same example as Kostnad per AI-svar (3 000 tokens in, 400 out). */
const USUAL = { inputTokens: 3_000, cachedInputTokens: 0, outputTokens: 400 };

export type ProfileModel = { kind: string; model: string; features: string[]; euVerified: boolean; euSource: string; limitations: string; priced: boolean };
export type ProfileView = {
  id: AiProfileId; name: string; provider: string; released: boolean; ready: boolean; euVerified: boolean;
  /** About what a usual question costs in credits (null while a price is missing); 0 without Workflow's credit system. */
  usualCredits: number | null; models: ProfileModel[];
};

const modelOf = (kind: AzureRouteModel, card: AzureModelInfo | undefined, fallback: string): ProfileModel => ({
  kind: KIND_LABEL[kind], model: card?.modelName || card?.deployment || fallback, features: (card?.features ?? []).map((feature) => AZURE_FEATURE_LABEL[feature]),
  euVerified: azureModelEuVerified(card), euSource: azureModelEuVerified(card) ? card?.euSource ?? "" : "", limitations: card?.limitations ?? "", priced: azureModelPriced(card),
});

export function describeProfiles(input: {
  openAiCards: AzureModelInfo[]; openAiProblem: string | null; azure: AzureSettings; azureProblem: string | null;
  margin: number; usdSekRateMicros: number; creditValueOre: number; minimumCredits: number; free: boolean; routeModels: readonly AzureRouteModel[];
}): ProfileView[] {
  const usual = (policy: AiModelPolicy | null) => {
    if (!policy) return null;
    if (input.free) return 0;
    return calculateAiUsageCost(USUAL, { ...policy, targetGrossMarginBps: input.margin, creditFloorValueOre: input.creditValueOre, minimumCredits: input.minimumCredits, usdSekRateMicros: input.usdSekRateMicros }).chargedCredits;
  };
  const tryPolicy = (make: () => AiModelPolicy) => { try { return make(); } catch { return null; } };
  const chat = routeAiModel("SIMPLE_CHAT");
  const standard: ProfileView = {
    id: "standard", name: AI_PROFILE_NAME.standard, provider: "OpenAI", released: true,
    ready: input.openAiProblem === null && openAiCardsProblem(input.openAiCards) === null,
    // Bara Azure räknas som EU (2026-11-01): Standard is never EU, whatever a card says.
    euVerified: false,
    usualCredits: usual(tryPolicy(() => openAiRoutePolicy(chat, input.openAiCards))),
    models: input.routeModels.map((kind) => { const card = input.openAiCards.find((item) => item.deployment === kind); return modelOf(kind, card && openAiCardWithoutEu(card), kind); }),
  };
  const eu: ProfileView = {
    id: "eu", name: AI_PROFILE_NAME.eu, provider: "Azure OpenAI", released: input.azure.requested, ready: input.azureProblem === null,
    euVerified: input.azureProblem === null,
    usualCredits: usual(tryPolicy(() => azureRoutePolicy(chat, input.azure))),
    models: input.routeModels.map((kind) => { const deployment = input.azure.deployments[kind] ?? ""; return modelOf(kind, azureModelOf(input.azure, deployment), deployment); }),
  };
  // Only released profiles are offered; Standard is the installation's own and always listed.
  return [standard, ...(eu.released ? [eu] : [])];
}
