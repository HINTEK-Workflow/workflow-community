import { z } from "zod";
import type { AiModelPolicy } from "@/lib/ai/model-catalog";

// Azure OpenAI Service (EU) as Workflow's second AI provider (2026-10-19: "Microsoft" = Azure OpenAI, the option for
// companies that require processing in the EU). Pure rules without Prisma. It is stored next to the OpenAI settings in
// SystemSettings.aiProvider under `azure`, sealed key included. Nothing is on until the product owner confirms all of it.

/** The model names Workflow's routes use (lib/ai/model-catalog.ts); on Azure each is a deployment with a name the owner chose. */
export const AZURE_ROUTE_MODELS = ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"] as const;
export type AzureRouteModel = (typeof AZURE_ROUTE_MODELS)[number];

/**
 * https://<resource>.openai.azure.com, or the Foundry addresses <resource>.services.ai.azure.com and
 * <resource>.cognitiveservices.azure.com (2026-10-24: the Foundry resource answers on services.ai.azure.com) – Microsoft's
 * own domains and nothing else, so a typo can never send the data to another host.
 */
const ENDPOINT = /^https:\/\/[a-z0-9][a-z0-9-]{1,62}\.(?:openai\.azure\.com|services\.ai\.azure\.com|cognitiveservices\.azure\.com)$/;
/** Trailing slashes and a pasted "/openai/v1" go: the adapter adds the API path itself. */
export const normalizeAzureEndpoint = (value: string) => value.trim().replace(/\/+$/, "").replace(/\/openai\/v1$/i, "").replace(/\/+$/, "");
export const validAzureEndpoint = (value: string) => ENDPOINT.test(normalizeAzureEndpoint(value));
export const AZURE_ENDPOINT_HINT = "Adressen ska se ut som https://<resurs>.services.ai.azure.com eller https://<resurs>.openai.azure.com.";
const DEPLOYMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const validDeployment = (value: string) => DEPLOYMENT.test(value.trim());
export const validAzureKey = (value: string) => /^[A-Za-z0-9]{24,128}$/.test(value.trim());
export const azureKeyHintOf = (value: string) => `…${value.trim().slice(-4)}`;

/**
 * What the product owner knows about each model behind a deployment (2026-10-24): the provider's price per million tokens
 * (USD, from the provider's price list for that region and deployment type – never a guessed value), what it can do, whether
 * processing in the EU is verified and where that comes from, and its limits. Data, so a new price needs no code change.
 */
export const AZURE_MODEL_FEATURES = ["tools", "structured", "reasoning", "promptCache"] as const;
export type AzureModelFeature = (typeof AZURE_MODEL_FEATURES)[number];
export const AZURE_FEATURE_LABEL: Record<AzureModelFeature, string> = {
  tools: "Workflows verktyg", structured: "Strikt svar", reasoning: "Resonemang", promptCache: "Cache för indata",
};
const usdPerMillion = z.number().positive().max(1_000).nullable().default(null);
const azureModelFields = {
  deployment: z.string().trim().max(64),
  modelName: z.string().trim().max(80).default(""),
  region: z.string().trim().max(80).default(""),
  deploymentType: z.string().trim().max(80).default(""),
  inputUsdPerMillion: usdPerMillion,
  /** Empty: cached input is priced as ordinary input. */
  cachedInputUsdPerMillion: usdPerMillion,
  outputUsdPerMillion: usdPerMillion,
  priceSource: z.string().trim().max(200).default(""),
  priceSetOn: z.union([z.iso.date(), z.literal("")]).default(""),
  features: z.array(z.enum(AZURE_MODEL_FEATURES)).max(AZURE_MODEL_FEATURES.length).default([]),
  /** Only with a source: a model is never called EU-based without verified support (hintek-ai-api-mcp.md, dataminimering). */
  euVerified: z.boolean().default(false),
  euSource: z.string().trim().max(200).default(""),
  limitations: z.string().trim().max(300).default(""),
};
export const azureModelSchema = z.object(azureModelFields);
export type AzureModelInfo = z.infer<typeof azureModelSchema>;
const MAX_MODELS = 6;

const deployments = z.object({
  "gpt-5.6-luna": z.string().max(64).default("gpt-5.6-luna"),
  "gpt-5.6-terra": z.string().max(64).default("gpt-5.6-terra"),
  "gpt-5.6-sol": z.string().max(64).default("gpt-5.6-sol"),
});

export const storedAzureSchema = z.object({
  enabled: z.boolean().default(false),
  endpoint: z.string().max(200).default(""),
  apiKeyCipher: z.string().max(4000).optional(),
  keyHint: z.string().max(20).optional(),
  deployments: deployments.default({ "gpt-5.6-luna": "gpt-5.6-luna", "gpt-5.6-terra": "gpt-5.6-terra", "gpt-5.6-sol": "gpt-5.6-sol" }),
  /** The owner confirms the resource is created in an EU region (and the deployments are EU or EU Data Zone deployments). */
  euConfirmed: z.boolean().default(false),
  dpaApproved: z.boolean().default(false),
  models: z.array(azureModelSchema).max(MAX_MODELS).catch([]).default([]),
  updatedAt: z.string().max(40).optional(),
  updatedBy: z.string().max(200).optional(),
}).catch({ enabled: false, endpoint: "", deployments: { "gpt-5.6-luna": "gpt-5.6-luna", "gpt-5.6-terra": "gpt-5.6-terra", "gpt-5.6-sol": "gpt-5.6-sol" }, euConfirmed: false, dpaApproved: false, models: [] });
export type StoredAzure = z.infer<typeof storedAzureSchema>;

export const azureInputSchema = z.object({
  enabled: z.boolean(),
  endpoint: z.string().trim().max(200),
  deployments,
  euConfirmed: z.boolean(),
  dpaApproved: z.boolean(),
  /** One entry per deployment name; left out keeps the saved ones (an older page). */
  models: z.array(z.object(azureModelFields).strict()).max(MAX_MODELS).optional(),
  /** A new key; empty keeps the saved one. */
  apiKey: z.string().trim().max(200).optional(),
}).strict();

export type AzureSettings = { requested: boolean; endpoint: string; apiKey: string; deployments: Record<AzureRouteModel, string>; euConfirmed: boolean; dpaApproved: boolean; models: AzureModelInfo[] };

export function effectiveAzureSettings(stored: StoredAzure, storedKey: string): AzureSettings {
  return { requested: stored.enabled, endpoint: normalizeAzureEndpoint(stored.endpoint), apiKey: storedKey, deployments: stored.deployments, euConfirmed: stored.euConfirmed, dpaApproved: stored.dpaApproved, models: stored.models ?? [] };
}

/** The deployment names the routes use, each once. */
export const usedDeployments = (settings: Pick<AzureSettings, "deployments">) => [...new Set(AZURE_ROUTE_MODELS.map((model) => (settings.deployments[model] ?? "").trim()))];
export const azureModelOf = (settings: Pick<AzureSettings, "models">, deployment: string) => settings.models.find((model) => model.deployment === deployment.trim());
/** Priced: input and output have the provider's price (cache is optional). */
export const azureModelPriced = (model: AzureModelInfo | undefined) => Boolean(model?.inputUsdPerMillion && model.outputUsdPerMillion);
/** EU only when ticked and a source says so. */
export const azureModelEuVerified = (model: AzureModelInfo | undefined) => Boolean(model?.euVerified && model.euSource.trim());

/** What stops one model from being used, or null. "Pris saknas" stops it: nothing is ever priced against a guessed value. */
export function azureModelProblem(model: AzureModelInfo | undefined, deployment: string): string | null {
  if (!model) return `Uppgifter om modellen saknas för driftsättningen ${deployment}.`;
  if (!azureModelPriced(model)) return `Pris saknas för ${deployment}.`;
  if (!azureModelEuVerified(model)) return `EU-behandling är inte verifierad med en källa för ${deployment}.`;
  return null;
}

/** The first thing that stops the EU provider, or null when it may be used. Fail closed: every part must be in place. */
export function azureProblem(settings: AzureSettings): string | null {
  if (!settings.requested) return "EU-leverantören (Azure OpenAI) är inte påslagen.";
  if (!validAzureEndpoint(settings.endpoint)) return "Azure-adressen saknas eller ser fel ut.";
  if (!settings.apiKey) return "Azure-nyckel saknas.";
  if (!settings.euConfirmed) return "Att Azure-resursen ligger i EU är inte bekräftat.";
  if (!settings.dpaApproved) return "Microsofts avtal (DPA) är inte bekräftat.";
  if (AZURE_ROUTE_MODELS.some((model) => !validDeployment(settings.deployments[model] ?? ""))) return "Ett driftsättningsnamn saknas eller ser fel ut.";
  for (const deployment of usedDeployments(settings)) {
    const problem = azureModelProblem(azureModelOf(settings, deployment), deployment);
    if (problem) return problem;
  }
  return null;
}

const micros = (usd: number) => Math.max(1, Math.round(usd * 1_000_000));

/**
 * A route's policy on Azure: the same task, effort, margin, minimum and credit value as every other provider (one commercial
 * policy, no Azure uplift in code), with the Azure model's own name and prices. The run stores it, so a later price change never
 * touches earlier runs. Throws when the model may not be used – there is no fallback price.
 */
export function azureRoutePolicy(route: AiModelPolicy, settings: AzureSettings): AiModelPolicy {
  const deployment = (settings.deployments[route.model as AzureRouteModel] ?? "").trim();
  const model = azureModelOf(settings, deployment);
  const problem = azureModelProblem(model, deployment);
  if (problem || !model?.inputUsdPerMillion || !model.outputUsdPerMillion) throw new Error(problem ?? `Pris saknas för ${deployment}.`);
  return cardPolicy(route, model, { provider: "AZURE_OPENAI", name: deployment, prefix: "azure", region: "EU" });
}

/**
 * A route's policy from a priced model card (any provider, 2026-10-24: every provider's prices are fields): the card's model
 * name and prices, everything else from the route. The pricing version names the card's prices and date.
 */
export function cardPolicy(route: AiModelPolicy, card: AzureModelInfo, as: { provider: AiModelPolicy["provider"]; name: string; prefix: string; region: AiModelPolicy["processingRegion"] }): AiModelPolicy {
  if (!card.inputUsdPerMillion || !card.outputUsdPerMillion) throw new Error(`Pris saknas för ${as.name}.`);
  const input = micros(card.inputUsdPerMillion);
  const cached = Math.min(input, micros(card.cachedInputUsdPerMillion ?? card.inputUsdPerMillion));
  const output = micros(card.outputUsdPerMillion);
  return Object.freeze({
    ...route,
    provider: as.provider,
    model: card.modelName || as.name,
    pricingVersion: `${as.prefix}-${as.name}-${card.priceSetOn || "odaterat"}-${input}-${cached}-${output}`,
    inputPriceUsdMicrosPerMillion: input,
    cachedInputPriceUsdMicrosPerMillion: cached,
    outputPriceUsdMicrosPerMillion: output,
    processingRegion: as.region,
  });
}

/** The installation's own suggestion for its Azure deployment (lib/instance-defaults.ts); a community installation has none. */
export type AzurePreset = { endpoint: string; deployment: string; modelName: string; region: string; deploymentType: string; euSource: string; limitations: string };

/** A blank model card for a deployment, filled from the installation's suggestion when it is that deployment. No price and no feature is ever filled in. */
export function blankAzureModel(deployment: string, preset: AzurePreset | null): AzureModelInfo {
  const base = azureModelSchema.parse({ deployment });
  if (!preset || preset.deployment !== deployment) return base;
  return { ...base, modelName: preset.modelName, region: preset.region, deploymentType: preset.deploymentType, euVerified: Boolean(preset.euSource), euSource: preset.euSource, limitations: preset.limitations };
}

/**
 * Azure's answer to a check or a trial question in plain Swedish (2026-10-24): wrong address, wrong key, wrong deployment
 * name, quota or region (429), and the rest. Only the HTTP status and Azure's error code are read – never the message, so nothing
 * Azure echoes (and never the key) reaches the page or a log.
 */
export function azureErrorMessage(error: unknown, deployment: string): string {
  const failure = (error ?? {}) as { status?: number; code?: unknown; name?: string; cause?: { code?: unknown } };
  const code = typeof failure.code === "string" && /^[A-Za-z0-9_.-]{1,60}$/.test(failure.code) ? failure.code : "";
  const name = validDeployment(deployment ?? "") ? deployment.trim() : "";
  if (failure.name === "APIConnectionTimeoutError") return "Azure svarade inte i tid. Försök igen.";
  if (failure.name === "APIConnectionError" || (!failure.status && /ENOTFOUND|ECONNREFUSED|EAI_AGAIN/.test(String(failure.cause?.code ?? ""))))
    return "Adressen svarar inte. Kontrollera resursens namn i adressen.";
  if (failure.status === 401 || failure.status === 403) return "Azure godtar inte nyckeln. Kontrollera att den hör till samma resurs som adressen.";
  if (failure.status === 404 && /DeploymentNotFound/i.test(code)) return `Driftsättningen ${name ? `${name} ` : ""}finns inte på resursen. Kontrollera namnet i Foundry.`;
  if (failure.status === 404) return "Azure hittar inte adressen eller driftsättningen. Kontrollera resursens namn och driftsättningens namn.";
  if (failure.status === 429) return "Azure begränsar anropen: kvoten för driftsättningen eller regionen är slut. Vänta en stund eller höj kvoten i Foundry.";
  if (failure.status === 400 && /unsupported|reasoning/i.test(code)) return `Modellen i ${name || "driftsättningen"} godtar inte Workflows anrop (${code}). Workflow behöver en resonerande modell, till exempel gpt-5.4-mini.`;
  if (failure.status === 400) return `Azure nekade anropet${code ? ` (${code})` : ""}.`;
  if (failure.status && failure.status >= 500) return "Azure har ett fel just nu. Försök igen senare.";
  return "Azure svarade inte. Försök igen.";
}

/** A trial question is synthetic text the superadmin types: short. Everything left out comes from what is saved. */
export const AZURE_PROBE_MAX_CHARS = 300;
export const azureProbeInputSchema = z.object({
  endpoint: z.string().trim().max(200).optional(),
  apiKey: z.string().trim().max(200).optional(),
  deployment: z.string().trim().max(64).optional(),
  question: z.string().trim().min(1).max(AZURE_PROBE_MAX_CHARS).optional(),
});

/**
 * AI-profiler (2026-10-24, svar 1): the company's admin chooses a profile the product owner has released – "Standard" (the
 * installation's provider, OpenAI) or "EU" (Azure OpenAI, released when the product owner switches the EU provider on). The server
 * still chooses the level per task. Only Azure counts as the EU (2026-11-01: "bara azure som är EU godkänt andra ai modeller är
 * det inte och kommer inte vara det"): a company that requires the EU runs on Azure or not at all, whatever is saved about OpenAI.
 * There is never an automatic fallback to a global model: a profile that is not ready refuses AI with a reason.
 */
export const AI_PROFILE_IDS = ["standard", "eu"] as const;
export type AiProfileId = (typeof AI_PROFILE_IDS)[number];
export const AI_PROFILE_NAME: Record<AiProfileId, string> = { standard: "Standard", eu: "EU" };

/** The company's choice decides the route: a company that requires the EU may only use Azure, never anything else. */
export type ProviderChoice = { use: "installation" } | { use: "azure-eu" } | { use: "none"; reason: string };
export function chooseProvider(input: { requireEu: boolean; azureProblem: string | null; profile?: AiProfileId }): ProviderChoice {
  const wanted = input.profile ?? "standard";
  if (input.requireEu) {
    if (input.azureProblem === null) return { use: "azure-eu" };
    return { use: "none", reason: "Företaget kräver behandling inom EU och Azure OpenAI är inte klar på servern. AI är avstängd för företaget tills den är klar." };
  }
  if (wanted === "eu") return input.azureProblem === null ? { use: "azure-eu" } : { use: "none", reason: "Företaget har valt AI-profilen EU och den är inte klar på servern. AI är avstängd för företaget tills den är klar eller en annan profil väljs." };
  return { use: "installation" };
}
