// The AI model provider's status as the core sees it (Fas 2, 2026-09-30). HINTEK's OpenAI provider lives in ee/;
// without ee/ there is no provider and HINTEK AI answers from the rules only. AI_ENABLED=false (Fas 1) switches the
// model off for the whole installation whichever provider is present.
import { serverExtensions } from "@/lib/extensions/server";
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
  const status = (await serverExtensions.aiProviderStatus()) ?? NO_AI_PROVIDER;
  return publicInstance().features.ai ? status : { ...status, enabled: false };
}
