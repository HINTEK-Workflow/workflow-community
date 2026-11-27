import "server-only";
import { prisma } from "@/lib/db";
import { publicInstance } from "@/lib/instance";
import { azureProblem, chooseProvider, standardProviderOf, type AzureSettings, type ProviderChoice, type StandardProviderId } from "@/lib/ai/azure-settings";
import { azureSettings } from "@/lib/ai/azure-settings-server";
import { parseAiCreditSettings } from "@/lib/ai/credit-settings";
import { openAiCardsProblem } from "@/lib/ai/openai-models";
import { openAiModelCards } from "@/lib/ai/provider-settings-server";
import { getAiSharingPolicy } from "@/lib/ai/sharing-policy";
import { companyKeyChoice } from "@/lib/ai/company-key-server";

/**
 * Leverantör för Standard (2026-11-21, F7): Azure in Cloud whatever is saved; the product owner's choice in Community
 * (OpenAI from the start). Read here directly so this module and lib/ai/credit-settings-server.ts do not import each other.
 */
export async function standardProvider(): Promise<StandardProviderId> {
  const row = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { ai: true } });
  return standardProviderOf(parseAiCreditSettings(row?.ai).provider, publicInstance().community);
}

/**
 * Which provider a company's AI runs on right now (2026-10-24, 2026-11-21): its AI-profil and its EU choice (chooseProvider),
 * the installation's provider for Standard and the product owner's model cards. One place, used by the adapter's choice
 * (lib/ai/assistant-provider.ts) and by the pricing (lib/ai/credit-settings-server.ts), so the estimate, the reservation and the
 * call always agree.
 */
export async function providerChoiceFor(organizationId: string): Promise<{ choice: ProviderChoice; azure: AzureSettings | null }> {
  const policy = await getAiSharingPolicy(organizationId);
  // Använd företagets egen AI-nyckel (2026-11-27): the company's own provider, or AI paused with the reason – never Workflow's.
  const own = await companyKeyChoice(organizationId, policy);
  if (own) return { choice: own, azure: null };
  const provider = await standardProvider();
  const needsAzure = policy.requireEu || policy.profile === "eu" || provider === "AZURE_OPENAI";
  const [azure, cards] = await Promise.all([needsAzure ? azureSettings() : Promise.resolve(null), openAiModelCards()]);
  const unused = "Azure behövs inte för företagets val.";
  const choice = chooseProvider({
    requireEu: policy.requireEu, profile: policy.profile, standardProvider: provider, operator: publicInstance().operator,
    azureProblems: azure ? { standard: azureProblem(azure, "standard"), eu: azureProblem(azure, "eu") } : { standard: unused, eu: unused },
  });
  // The Standard profile on OpenAI with a model whose price was removed: no customer run is priced against nothing (pris saknas).
  if (choice.use === "openai") {
    const missing = openAiCardsProblem(cards);
    if (missing) return { choice: { use: "none", reason: `AI-modellen kan inte användas just nu: ${missing} ${publicInstance().operator} lägger in priset.` }, azure };
  }
  return { choice, azure };
}
