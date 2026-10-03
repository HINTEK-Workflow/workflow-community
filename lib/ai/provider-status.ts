// The AI model provider's status (HINTEK's OpenAI provider). AI_ENABLED=false (Fas 1) switches the model off for
// the whole installation; the rule-based answers remain. Workflow AI as a whole lives in ee/ (not in the community edition).
import { openAiProviderStatus } from "@/lib/ai/openai-provider";
import { publicInstance } from "@/lib/instance";

export type AiProviderStatus = {
  enabled: boolean;
  requested: boolean;
  evalEnabled: boolean;
  configured: boolean;
  dpaApproved: boolean;
  processingMode: "GLOBAL" | "EU";
  euDataControlsApproved: boolean;
  providerEvalApproved: boolean;
  provider: string;
  processingRegion: "GLOBAL" | "EU";
  baseUrl: string;
  providerStateStored: boolean;
  models: string[];
};

export const NO_AI_PROVIDER: AiProviderStatus = {
  enabled: false,
  requested: false,
  evalEnabled: false,
  configured: false,
  dpaApproved: false,
  processingMode: "GLOBAL",
  euDataControlsApproved: false,
  providerEvalApproved: false,
  provider: "NONE",
  processingRegion: "GLOBAL",
  baseUrl: "",
  providerStateStored: false,
  models: [],
};

export async function aiProviderStatus(): Promise<AiProviderStatus> {
  const provider = await openAiProviderStatus();
  const status: AiProviderStatus = { ...provider, models: [...provider.models] };
  return publicInstance().features.ai ? status : { ...status, enabled: false };
}
