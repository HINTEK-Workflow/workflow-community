import { z } from "zod";
import { azureErrorMessage, normalizeAzureEndpoint, validAzureEndpoint, validDeployment, AZURE_ENDPOINT_HINT } from "@/lib/ai/azure-settings";
import type { AiModelPolicy } from "@/lib/ai/model-catalog";
import { COMPANY_KEY_PRICING_PREFIX } from "@/lib/ai/payer";

/**
 * Använd företagets egen AI-nyckel (2026-11-27, 6b punkt 1–3): one switch per company. When it is on, EVERY AI function that
 * goes through the shared AI backend – the chat, Skriv och Granska med AI, import, the digest, proposals and the scheduled agents
 * with nobody signed in – runs on the company's own provider with the company's own key, and never on Workflow's. Workflow AI is the
 * default (off), and the subscription's price is the same. Pure rules without Prisma, so the settings page uses the same words.
 *
 * - Providers in this round: the company's own Azure OpenAI resource and OpenAI, through the existing Responses adapter.
 * - The key is an IntegrationKey of kind EXTERNAL (provider "azure-openai" or "openai"), sealed with the company's own data key
 *   (lib/integrations/company-keys.ts). The settings below are in the company's AI choices (WorkspaceSettings.aiPolicy.ownKey).
 * - Fail closed: a missing or broken key pauses the function with a reason that starts with COMPANY_KEY_PAUSE; it never falls back
 *   to Workflow's key by itself.
 * - EU (6b punkt 3): with Uppgifterna måste behandlas inom EU on, only the company's own Azure resource may be used, and only once the
 *   admin has attested that it is in the EU; an OpenAI key is blocked with a reason.
 * - A run is recorded as Företagets nyckel (lib/ai/payer.ts) and never counts against Workflow's weekly quota or budget.
 */
export const COMPANY_KEY_PROVIDERS = ["azure-openai", "openai"] as const;
export type CompanyKeyProvider = (typeof COMPANY_KEY_PROVIDERS)[number];
export const COMPANY_KEY_PROVIDER_LABEL: Record<CompanyKeyProvider, string> = { "azure-openai": "Företagets egen Azure OpenAI", openai: "OpenAI" };
/** The model field's name per provider: on Azure the company's deployment, at OpenAI the model's name. */
export const COMPANY_KEY_MODEL_LABEL: Record<CompanyKeyProvider, string> = { "azure-openai": "Driftsättning", openai: "Modell" };
/** The name the key row gets under the company's keys. */
export const COMPANY_KEY_NAME = "Företagets AI-nyckel";

export const companyKeySchema = z.object({
  on: z.boolean().default(false),
  provider: z.enum(COMPANY_KEY_PROVIDERS).catch("azure-openai").default("azure-openai"),
  /** Azure only: https://<resurs>.openai.azure.com (or the Foundry addresses), Microsoft's own domains only. */
  endpoint: z.string().max(200).default(""),
  /** Azure: the deployment's name; OpenAI: the model's name. One model for every task. */
  model: z.string().max(64).default(""),
  /** The admin's own statement that the company's Azure resource is in the EU (saved and audited). */
  euAttested: z.boolean().default(false),
  euAttestedAt: z.string().max(40).optional(),
  euAttestedBy: z.string().max(200).optional(),
  /** Set when the provider refused the key (401/403) or the deployment (404): AI stays paused until the admin checks or saves again. */
  pausedReason: z.string().max(300).optional(),
  pausedAt: z.string().max(40).optional(),
  updatedAt: z.string().max(40).optional(),
  updatedBy: z.string().max(200).optional(),
});
export type CompanyKeySettings = z.infer<typeof companyKeySchema>;
export const COMPANY_KEY_OFF: CompanyKeySettings = { on: false, provider: "azure-openai", endpoint: "", model: "", euAttested: false };
export const parseCompanyKey = (value: unknown): CompanyKeySettings => {
  const parsed = companyKeySchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : COMPANY_KEY_OFF;
};

/** Every reason that stops AI because of the company's own key starts with this, so a mission can tell it and pause. */
export const COMPANY_KEY_PAUSE = "Företagets egen AI-nyckel";
export const isCompanyKeyPause = (reason: string | null | undefined) => Boolean(reason?.startsWith(COMPANY_KEY_PAUSE));
const WHERE = "Inställningar → Arbetssätt → Workflow AI";

const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
export const validCompanyModel = (provider: CompanyKeyProvider, value: string) => (provider === "azure-openai" ? validDeployment(value) : MODEL.test(value.trim()));
/** An OpenAI key starts with sk-; an Azure key is letters and digits. Checked before it is sealed, never shown again. */
export const validCompanyKeyValue = (provider: CompanyKeyProvider, value: string) =>
  provider === "openai" ? /^sk-[A-Za-z0-9_-]{20,}$/.test(value.trim()) : /^[A-Za-z0-9]{24,128}$/.test(value.trim());
export const companyKeyValueHint = (provider: CompanyKeyProvider) =>
  provider === "openai" ? "En OpenAI-nyckel börjar med sk-." : "Nyckeln till Azure-resursen (bokstäver och siffror, minst 24 tecken).";

/** Why the company's own key may not be used right now, or null. Fail closed: every part must be in place. */
export function companyKeyProblem(input: { settings: CompanyKeySettings; keyStored: boolean; requireEu: boolean }): string | null {
  const { settings, keyStored, requireEu } = input;
  if (requireEu && settings.provider === "openai")
    return `${COMPANY_KEY_PAUSE} kan inte användas: företaget kräver behandling inom EU, och då är en OpenAI-nyckel spärrad. Välj företagets egen Azure-resurs i EU, eller stäng av egen AI-nyckel under ${WHERE}.`;
  if (requireEu && !settings.euAttested)
    return `${COMPANY_KEY_PAUSE} kan inte användas: företaget kräver behandling inom EU. Admin behöver intyga att företagets Azure-resurs ligger i EU under ${WHERE}.`;
  if (!keyStored) return `${COMPANY_KEY_PAUSE} saknas. AI är pausad för företaget tills admin lägger in nyckeln under ${WHERE}, eller stänger av egen AI-nyckel.`;
  if (settings.provider === "azure-openai" && !validAzureEndpoint(settings.endpoint)) return `${COMPANY_KEY_PAUSE}: adressen till Azure-resursen saknas eller ser fel ut. ${AZURE_ENDPOINT_HINT}`;
  if (!validCompanyModel(settings.provider, settings.model)) return `${COMPANY_KEY_PAUSE}: ${COMPANY_KEY_MODEL_LABEL[settings.provider].toLowerCase()} saknas eller ser fel ut.`;
  if (settings.pausedReason) return `${COMPANY_KEY_PAUSE} fungerade inte senast: ${settings.pausedReason} AI är pausad tills admin kontrollerar eller byter nyckeln under ${WHERE}.`;
  return null;
}

/** The company's choice when its own key is on: the provider to use, or the reason AI is paused. Never Workflow's provider. */
export type CompanyKeyChoice =
  | { use: "company"; provider: CompanyKeyProvider; endpoint: string; model: string; region: AiModelPolicy["processingRegion"] }
  | { use: "none"; reason: string };
export function companyKeyChoiceOf(input: { settings: CompanyKeySettings; keyStored: boolean; requireEu: boolean }): CompanyKeyChoice {
  const problem = companyKeyProblem(input);
  if (problem) return { use: "none", reason: problem };
  const { settings } = input;
  return {
    use: "company", provider: settings.provider, model: settings.model.trim(),
    endpoint: settings.provider === "azure-openai" ? normalizeAzureEndpoint(settings.endpoint) : "",
    // EU only for the company's Azure resource the admin attested; OpenAI is never counted as the EU (2026-11-01).
    region: settings.provider === "azure-openai" && settings.euAttested ? "EU" : "GLOBAL",
  };
}

/**
 * The policy a run on the company's own key is recorded with: the route's task and effort, the company's model, and prices of one
 * micro-USD per million tokens – Workflow knows nothing of the company's own price, so the run's cost is (almost) nothing in Workflow's
 * books while its tokens are kept. The pricing version starts with COMPANY_KEY_PRICING_PREFIX: that is what makes it Företagets nyckel.
 */
export function companyKeyPolicy(route: AiModelPolicy, choice: Extract<CompanyKeyChoice, { use: "company" }>): AiModelPolicy {
  return Object.freeze({
    ...route,
    provider: choice.provider === "azure-openai" ? "AZURE_OPENAI" as const : "OPENAI" as const,
    model: choice.model,
    pricingVersion: `${COMPANY_KEY_PRICING_PREFIX}${choice.provider}-${choice.model}`.slice(0, 120),
    inputPriceUsdMicrosPerMillion: 1, cachedInputPriceUsdMicrosPerMillion: 1, outputPriceUsdMicrosPerMillion: 1,
    processingRegion: choice.region,
  });
}

/**
 * The provider's answer in plain Swedish, and whether it pauses the company's AI: a refused key (401/403) or a deployment or model
 * that is not there (404) pauses until the admin acts; a full quota, a time-out or the provider's own fault is said and not kept.
 * Only the status and the error code are read, never the provider's text (and never the key).
 */
export function companyKeyFailure(provider: CompanyKeyProvider, error: unknown, model: string): { message: string; pause: boolean } {
  const status = (error as { status?: number } | null)?.status;
  const pause = status === 401 || status === 403 || status === 404;
  if (provider === "azure-openai") return { message: azureErrorMessage(error, model), pause };
  const message = status === 401 || status === 403 ? "OpenAI godtar inte nyckeln."
    : status === 404 ? (MODEL.test(model) ? `OpenAI hittar inte modellen ${model}.` : "OpenAI hittar inte modellen.")
    : status === 429 ? "OpenAI svarar att kontot saknar kredit eller har nått sin gräns."
    : status && status >= 500 ? "OpenAI har ett fel just nu. Försök igen senare." : "OpenAI svarade inte. Försök igen.";
  return { message, pause };
}

/** What the admin sends from the settings page. */
export const companyKeyInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save"),
    on: z.boolean(),
    provider: z.enum(COMPANY_KEY_PROVIDERS),
    endpoint: z.string().trim().max(200).default(""),
    model: z.string().trim().max(64).default(""),
    euAttested: z.boolean().default(false),
    /** A new key; empty or left out keeps the saved one. */
    apiKey: z.string().trim().max(400).optional(),
    /** The bin: the saved key is removed. */
    removeKey: z.boolean().optional(),
  }).strict(),
  z.object({ action: z.literal("check") }).strict(),
]);
export type CompanyKeyInput = z.infer<typeof companyKeyInputSchema>;
