import "server-only";
import { serverExtensions } from "@/lib/extensions/server";
import type { AssistantProviderAdapter } from "@/lib/ai/workflow-assistant";

// The AI model behind HINTEK AI (Fas 2): HINTEK's OpenAI provider lives in ee/; without it only the rules answer.
export async function configuredAssistantProvider(): Promise<AssistantProviderAdapter> {
  const provider = await serverExtensions.assistantProvider();
  if (!provider) throw new Error("Ingen AI-provider är registrerad.");
  return provider;
}
