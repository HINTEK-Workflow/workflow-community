import "server-only";
import type { AiProfileId } from "@/lib/ai/azure-settings";
import { AZURE_PROVIDERS } from "@/lib/ai/azure-provider";
import { openAiStructuredProvider } from "@/lib/ai/openai-structured";
import { makeWorkflowAssistantProvider, openAiWorkflowAssistantProvider } from "@/lib/ai/openai-workflow-assistant";
import { providerChoiceFor, standardProvider } from "@/lib/ai/provider-choice-server";
import type { StructuredProviderAdapter } from "@/lib/ai/structured-provider";
import { companyKeyAdapters } from "@/lib/ai/company-key-server";
import { companyWeeklyQuota } from "@/lib/ai/weekly-quota-server";
import type { AssistantProviderAdapter } from "@/lib/ai/workflow-assistant";

/**
 * The AI provider behind Workflow AI (2026-11-21): in Cloud only Microsoft Azure, with the company's AI profile choosing the
 * deployments (Standard or EU); in Community the product owner's Leverantör för Standard (OpenAI or Azure), and Azure's EU
 * deployments for a company that requires the EU. When the profile is not ready there is no answer from any other provider: the
 * call is refused with a reason.
 */
type Pair = { assistant: AssistantProviderAdapter; structured: StructuredProviderAdapter };
const OPENAI: Pair = { assistant: openAiWorkflowAssistantProvider, structured: openAiStructuredProvider };
const AZURE: Record<AiProfileId, Pair> = {
  standard: { assistant: makeWorkflowAssistantProvider(AZURE_PROVIDERS.standard), structured: AZURE_PROVIDERS.standard },
  eu: { assistant: makeWorkflowAssistantProvider(AZURE_PROVIDERS.eu), structured: AZURE_PROVIDERS.eu },
};

/**
 * Använd företagets egen AI-nyckel (2026-11-27): with the company's switch on every call below goes to the company's own
 * provider (lib/ai/company-key-server.ts), and a missing or refused key refuses the call with its reason – never Workflow's provider.
 *
 * Why AI must not run for this company right now because of its AI-profil or its EU choice (or a model without a price), or null
 * when nothing there stops it (2026-10-24).
 */
export async function euRefusal(organizationId: string): Promise<string | null> {
  const [{ choice }, quota] = await Promise.all([providerChoiceFor(organizationId), companyWeeklyQuota(organizationId)]);
  if (choice.use === "none") return choice.reason;
  // The company's own key is paid at its own provider: Workflow's weekly quota never pauses it.
  if (choice.use === "company") return null;
  // Veckokvot (2026-11-21): the model pauses for the company until Monday; Workflow's own direct answers go on.
  return quota.decision.mode === "paused" ? quota.decision.reason : null;
}

async function chosen(organizationId?: string): Promise<Pair> {
  if (organizationId) {
    const { choice } = await providerChoiceFor(organizationId);
    if (choice.use === "none") throw new Error(choice.reason);
    if (choice.use === "company") return companyKeyAdapters(organizationId, choice);
    return choice.use === "azure" ? AZURE[choice.profile] : OPENAI;
  }
  return (await standardProvider()) === "AZURE_OPENAI" ? AZURE.standard : OPENAI;
}

/** The provider behind Workflow AI's chat. */
export async function configuredAssistantProvider(organizationId?: string): Promise<AssistantProviderAdapter> {
  return (await chosen(organizationId)).assistant;
}

/** The provider behind every other agent (import, review, summaries, proposals, the digest, machine analysis). */
export async function configuredStructuredProvider(organizationId?: string): Promise<StructuredProviderAdapter> {
  return (await chosen(organizationId)).structured;
}
