import "server-only";
import { publicInstance } from "@/lib/instance";
import { azureProblem, chooseProvider, type AzureSettings, type ProviderChoice } from "@/lib/ai/azure-settings";
import { azureSettings } from "@/lib/ai/azure-settings-server";
import { openAiCardsProblem } from "@/lib/ai/openai-models";
import { openAiModelCards } from "@/lib/ai/provider-settings-server";
import { getAiSharingPolicy } from "@/lib/ai/sharing-policy";

/**
 * Which provider a company's AI runs on right now (2026-10-24): its AI-profil and its EU choice (chooseProvider), with the
 * product owner's model cards. One place, used by the adapter's choice (lib/ai/assistant-provider.ts) and by the pricing
 * (lib/ai/credit-settings-server.ts), so the estimate, the reservation and the call always agree.
 */
export async function providerChoiceFor(organizationId: string): Promise<{ choice: ProviderChoice; azure: AzureSettings | null }> {
  const policy = await getAiSharingPolicy(organizationId);
  const needsAzure = policy.requireEu || policy.profile === "eu";
  const [azure, cards] = await Promise.all([needsAzure ? azureSettings() : Promise.resolve(null), openAiModelCards()]);
  const choice = chooseProvider({
    requireEu: policy.requireEu, profile: policy.profile,
    azureProblem: azure ? azureProblem(azure) : "Azure OpenAI behövs inte för företagets val.",
  });
  // The Standard profile with a model whose price was removed: no customer run is priced against nothing (pris saknas).
  if (choice.use === "installation") {
    const missing = openAiCardsProblem(cards);
    if (missing) return { choice: { use: "none", reason: `AI-modellen kan inte användas just nu: ${missing} ${publicInstance().operator} lägger in priset.` }, azure };
  }
  return { choice, azure };
}
