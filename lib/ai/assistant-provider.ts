import "server-only";
import { readAiCreditSettings } from "@/lib/ai/credit-settings-server";
import type { AiProviderId } from "@/lib/ai/credit-settings";
import { openAiStructuredProvider } from "@/lib/ai/openai-structured";
import { openAiWorkflowAssistantProvider } from "@/lib/ai/openai-workflow-assistant";
import type { StructuredProviderAdapter } from "@/lib/ai/structured-provider";
import type { AssistantProviderAdapter } from "@/lib/ai/workflow-assistant";

/**
 * The AI provider the product owner has chosen (2026-10-02: "OpenAI tills vidare, som en valbar inställning"). Each
 * provider is one adapter pair here; adding one is an entry in AI_PROVIDERS, its adapters and its prices.
 */
const ADAPTERS: Record<AiProviderId, { assistant: AssistantProviderAdapter; structured: StructuredProviderAdapter }> = {
  OPENAI: { assistant: openAiWorkflowAssistantProvider, structured: openAiStructuredProvider },
};

async function chosen() {
  return ADAPTERS[(await readAiCreditSettings()).provider] ?? ADAPTERS.OPENAI;
}

/** The provider behind Workflow AI's chat. */
export async function configuredAssistantProvider(): Promise<AssistantProviderAdapter> {
  return (await chosen()).assistant;
}

/** The provider behind every other agent (import, review, summaries, proposals, the digest). */
export async function configuredStructuredProvider(): Promise<StructuredProviderAdapter> {
  return (await chosen()).structured;
}
