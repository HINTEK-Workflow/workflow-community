import "server-only";
import { readAiCreditSettings } from "@/lib/ai/credit-settings-server";
import type { AiProviderId } from "@/lib/ai/credit-settings";
import { azureStructuredProvider } from "@/lib/ai/azure-provider";
import { openAiStructuredProvider } from "@/lib/ai/openai-structured";
import { makeWorkflowAssistantProvider, openAiWorkflowAssistantProvider } from "@/lib/ai/openai-workflow-assistant";
import { providerChoiceFor } from "@/lib/ai/provider-choice-server";
import type { StructuredProviderAdapter } from "@/lib/ai/structured-provider";
import type { AssistantProviderAdapter } from "@/lib/ai/workflow-assistant";

/**
 * The AI provider the product owner has chosen (2026-10-02: "OpenAI tills vidare, som en valbar inställning"). Each
 * provider is one adapter pair here; adding one is an entry in AI_PROVIDERS, its adapters and its prices.
 *
 * EU (2026-10-19): a company that requires processing in the EU is given the EU provider (Azure OpenAI) and nothing
 * else. When that provider is not ready there is no answer from any other provider: the call is refused with a reason.
 */
const ADAPTERS: Record<AiProviderId, { assistant: AssistantProviderAdapter; structured: StructuredProviderAdapter }> = {
  OPENAI: { assistant: openAiWorkflowAssistantProvider, structured: openAiStructuredProvider },
};
const AZURE_EU = { assistant: makeWorkflowAssistantProvider(azureStructuredProvider), structured: azureStructuredProvider };

/**
 * Why AI must not run for this company right now because of its AI-profil or its EU choice (or a model without a price), or null
 * when nothing there stops it (2026-10-24).
 */
export async function euRefusal(organizationId: string): Promise<string | null> {
  const { choice } = await providerChoiceFor(organizationId);
  return choice.use === "none" ? choice.reason : null;
}

async function chosen(organizationId?: string) {
  if (organizationId) {
    const { choice } = await providerChoiceFor(organizationId);
    if (choice.use === "none") throw new Error(choice.reason);
    if (choice.use === "azure-eu") return AZURE_EU;
  }
  return ADAPTERS[(await readAiCreditSettings()).provider] ?? ADAPTERS.OPENAI;
}

/** The provider behind Workflow AI's chat. */
export async function configuredAssistantProvider(organizationId?: string): Promise<AssistantProviderAdapter> {
  return (await chosen(organizationId)).assistant;
}

/** The provider behind every other agent (import, review, summaries, proposals, the digest, machine analysis). */
export async function configuredStructuredProvider(organizationId?: string): Promise<StructuredProviderAdapter> {
  return (await chosen(organizationId)).structured;
}
