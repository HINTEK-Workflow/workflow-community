// Workflow AI:s leverantör as it stands now (2026-11-21): in Cloud Microsoft Azure, in Community the product owner's
// Leverantör för Standard (OpenAI or Azure). AI_ENABLED=false (Fas 1) switches the model off for the whole installation; the
// rule-based answers remain. Workflow AI as a whole lives in ee/ (not in the community edition).
import { openAiProviderStatus } from "@/lib/ai/openai-provider";
import { publicInstance } from "@/lib/instance";
import { azureCommonProblem, azureProblem } from "@/lib/ai/azure-settings";
import { azureSettings } from "@/lib/ai/azure-settings-server";
import { standardProvider } from "@/lib/ai/provider-choice-server";
import { AI_MODEL_ROUTES } from "@/lib/ai/model-catalog";
import { companyKeyOn } from "@/lib/ai/company-key-server";

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
  /** The first thing that stops the provider, for the superadmin's status. */
  problem?: string | null;
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

/**
 * Azure as the installation's provider: on when the switch, the address, the key and Microsoft's agreement are in place and at
 * least one profile is ready. Whether a company's own profile is ready is checked per company (euRefusal), never here.
 */
async function azureProviderStatus(): Promise<AiProviderStatus> {
  const settings = await azureSettings();
  const common = azureCommonProblem(settings);
  const standard = azureProblem(settings, "standard");
  const eu = azureProblem(settings, "eu");
  const problem = common ?? (standard && eu ? standard : null);
  return {
    enabled: problem === null,
    requested: settings.requested,
    evalEnabled: false,
    configured: Boolean(settings.apiKey),
    dpaApproved: settings.dpaApproved,
    processingMode: standard === null ? "GLOBAL" : "EU",
    euDataControlsApproved: eu === null,
    // The synthetic suite runs against OpenAI only; Azure is tried with Kontrollera and Provfråga on its card.
    providerEvalApproved: true,
    provider: "AZURE_OPENAI",
    processingRegion: standard === null ? "GLOBAL" : "EU",
    baseUrl: settings.endpoint,
    providerStateStored: false,
    models: [...new Set(Object.values(AI_MODEL_ROUTES).map((route) => route.model))],
    problem,
  };
}

/**
 * With `organizationId`: a company that uses its own AI key does not need Workflow's provider at all (2026-11-27), so the model
 * counts as on for it; whether its own key may be used is the company's own refusal (euRefusal), with the reason.
 */
export async function aiProviderStatus(organizationId?: string): Promise<AiProviderStatus> {
  if (organizationId && publicInstance().features.ai && (await companyKeyOn(organizationId)))
    return { ...NO_AI_PROVIDER, enabled: true, requested: true, configured: true, dpaApproved: true, providerEvalApproved: true, provider: "COMPANY_KEY", problem: null };
  const status: AiProviderStatus = (await standardProvider()) === "AZURE_OPENAI"
    ? await azureProviderStatus()
    : await openAiProviderStatus().then((provider) => ({ ...provider, models: [...provider.models] }));
  return publicInstance().features.ai ? status : { ...status, enabled: false };
}
