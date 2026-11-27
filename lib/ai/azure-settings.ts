import { z } from "zod";
import type { AiModelPolicy } from "@/lib/ai/model-catalog";

// Workflow AI på Azure (2026-11-21: "Workflow AI drivs med Azure, med modeller i EU eller utanför"). Pure rules without Prisma.
// One Azure resource with one key serves both AI profiles, each with its own deployments: Standard (any deployment type, for example
// Global Standard, which may be processed outside the EU) and EU (only models whose card says EU verified, with a source). In Cloud
// Azure is Workflow AI's only provider; in Community it is one of two choices for Standard (lib/ai/credit-settings.ts). It is stored
// next to the OpenAI settings in SystemSettings.aiProvider under `azure`. Nothing is on until the product owner confirms all of it.

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
export const AZURE_MODEL_FEATURES = ["tools", "structured", "reasoning", "promptCache", "images"] as const;
export type AzureModelFeature = (typeof AZURE_MODEL_FEATURES)[number];
export const AZURE_FEATURE_LABEL: Record<AzureModelFeature, string> = {
  tools: "Workflows verktyg", structured: "Strikt svar", reasoning: "Resonemang", promptCache: "Cache för indata", images: "Bilder",
};
/**
 * A plain line under a feature where the name alone says too little. Bilder (2026-11-21): the model takes photos as input, so the
 * chat's image button is on for the companies that use it; without it the button explains why it is off.
 */
export const AZURE_FEATURE_DESCRIPTION: Partial<Record<AzureModelFeature, string>> = {
  images: "Modellen kan läsa foton. Utan den här är bildknappen i chatten avstängd.",
};
/** Whether a model card says the model reads photos (Bilder). */
export const azureModelReadsImages = (model: AzureModelInfo | undefined) => Boolean(model?.features.includes("images"));
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
export type AzureDeployments = Record<AzureRouteModel, string>;
const DEFAULT_DEPLOYMENTS: AzureDeployments = { "gpt-5.6-luna": "gpt-5.6-luna", "gpt-5.6-terra": "gpt-5.6-terra", "gpt-5.6-sol": "gpt-5.6-sol" };
/** One card per deployment; two profiles with three levels each may name up to six different deployments, plus Tal till text. */
const MAX_MODELS_BOTH = MAX_MODELS * 2;

/**
 * Tal till text (2026-11-21): an optional transcription deployment per profile (for example gpt-4o-transcribe or
 * gpt-4o-mini-transcribe), with its own model card – price, and for the EU profile a verified EU source. Empty: the chat's
 * microphone is off for the profile's companies. Audio is sent only from the server, and never kept.
 */
const transcriptionDeployments = z.object({
  standard: z.string().trim().max(64).default(""),
  eu: z.string().trim().max(64).default(""),
});
export type AzureTranscription = { standard: string; eu: string };
const NO_TRANSCRIPTION: AzureTranscription = { standard: "", eu: "" };

export const storedAzureSchema = z.object({
  enabled: z.boolean().default(false),
  endpoint: z.string().max(200).default(""),
  apiKeyCipher: z.string().max(4000).optional(),
  keyHint: z.string().max(20).optional(),
  /** The EU profile's deployments (the only set before 2026-11-21, hence the name). */
  deployments: deployments.default(DEFAULT_DEPLOYMENTS),
  /** The Standard profile's deployments (2026-11-21, F1: Global Standard). Missing in older saves: the same as the EU set. */
  standardDeployments: deployments.optional(),
  /** Tal till text per profile (2026-11-21); missing in older saves: none. */
  transcription: transcriptionDeployments.optional(),
  /** Read so an older save still parses, and ignored: EU now follows each model card (2026-11-21). */
  euConfirmed: z.boolean().optional(),
  dpaApproved: z.boolean().default(false),
  models: z.array(azureModelSchema).max(MAX_MODELS_BOTH).catch([]).default([]),
  updatedAt: z.string().max(40).optional(),
  updatedBy: z.string().max(200).optional(),
}).catch({ enabled: false, endpoint: "", deployments: DEFAULT_DEPLOYMENTS, dpaApproved: false, models: [] });
export type StoredAzure = z.infer<typeof storedAzureSchema>;

export const azureInputSchema = z.object({
  enabled: z.boolean(),
  endpoint: z.string().trim().max(200),
  /** The EU profile's deployments. */
  deployments,
  /** The Standard profile's deployments; left out (an older page) keeps the saved ones. */
  standardDeployments: deployments.optional(),
  /** Tal till text per profile; left out (the overview's switch, an older page) keeps the saved ones. */
  transcription: transcriptionDeployments.strict().optional(),
  /** Sent by a page opened before 2026-11-21; accepted and never used. */
  euConfirmed: z.boolean().optional(),
  dpaApproved: z.boolean(),
  /** One entry per deployment name; left out keeps the saved ones (an older page). */
  models: z.array(z.object(azureModelFields).strict()).max(MAX_MODELS_BOTH).optional(),
  /** A new key; empty keeps the saved one. */
  apiKey: z.string().trim().max(200).optional(),
}).strict();

export type AzureSettings = {
  requested: boolean; endpoint: string; apiKey: string;
  /** The EU profile's deployments. */
  deployments: AzureDeployments;
  /** The Standard profile's deployments. */
  standardDeployments: AzureDeployments;
  /** Tal till text per profile ("" = none). */
  transcription: AzureTranscription;
  dpaApproved: boolean; models: AzureModelInfo[];
};

export function effectiveAzureSettings(stored: StoredAzure, storedKey: string): AzureSettings {
  return {
    requested: stored.enabled, endpoint: normalizeAzureEndpoint(stored.endpoint), apiKey: storedKey,
    deployments: stored.deployments, standardDeployments: stored.standardDeployments ?? stored.deployments,
    transcription: stored.transcription ?? NO_TRANSCRIPTION,
    dpaApproved: stored.dpaApproved, models: stored.models ?? [],
  };
}

/**
 * AI-profiler (2026-10-24, svar 1; 2026-11-21): the company's admin chooses a profile the product owner has released –
 * "Standard" (the installation's provider for Standard: in Cloud Azure's Standard deployments, which may be processed outside the
 * EU) or "EU" (Azure with only EU-verified models). The server still chooses the level per task. There is never an automatic
 * fallback to a global model: a profile that is not ready refuses AI with a reason.
 */
export const AI_PROFILE_IDS = ["standard", "eu"] as const;
export type AiProfileId = (typeof AI_PROFILE_IDS)[number];
export const AI_PROFILE_NAME: Record<AiProfileId, string> = { standard: "Standard", eu: "EU" };

/** The level's name as the settings page shows it. */
export const AZURE_LEVEL_LABEL: Record<AzureRouteModel, string> = { "gpt-5.6-luna": "Enkla svar (luna)", "gpt-5.6-terra": "Dokument och förslag (terra)", "gpt-5.6-sol": "Granskning (sol)" };

/** A profile's deployment names per level. */
export const deploymentsFor = (settings: Pick<AzureSettings, "deployments" | "standardDeployments">, profile: AiProfileId): AzureDeployments =>
  profile === "eu" ? settings.deployments : settings.standardDeployments;

/** The deployment names the routes use, each once (one set, or both profiles' sets). */
export const usedDeployments = (settings: { deployments: AzureDeployments; standardDeployments?: AzureDeployments; transcription?: AzureTranscription }) =>
  [...new Set([
    ...[settings.deployments, ...(settings.standardDeployments ? [settings.standardDeployments] : [])].flatMap((set) => AZURE_ROUTE_MODELS.map((model) => (set[model] ?? "").trim())),
    // Tal till text has a card of its own when it is filled in (2026-11-21).
    ...(settings.transcription ? AI_PROFILE_IDS.map((profile) => (settings.transcription![profile] ?? "").trim()).filter(Boolean) : []),
  ])];
export const azureModelOf = (settings: Pick<AzureSettings, "models">, deployment: string) => settings.models.find((model) => model.deployment === deployment.trim());
/** Priced: input and output have the provider's price (cache is optional). */
export const azureModelPriced = (model: AzureModelInfo | undefined) => Boolean(model?.inputUsdPerMillion && model.outputUsdPerMillion);
/** EU only when ticked and a source says so. */
export const azureModelEuVerified = (model: AzureModelInfo | undefined) => Boolean(model?.euVerified && model.euSource.trim());
/** Where a run on this card is processed, as the AI log shows it: EU only for an EU-verified card. */
export const azureRegionOf = (model: AzureModelInfo | undefined): AiModelPolicy["processingRegion"] => (azureModelEuVerified(model) ? "EU" : "GLOBAL");

/**
 * What stops one model from being used, or null. "Pris saknas" stops it: nothing is ever priced against a guessed value. In the EU
 * profile a model without a verified EU source stops it too.
 */
export function azureModelProblem(model: AzureModelInfo | undefined, deployment: string, requireEu = true, level?: AzureRouteModel): string | null {
  if (!model) return `Uppgifter om modellen saknas för driftsättningen ${deployment}.`;
  if (!azureModelPriced(model)) return `Pris saknas för ${deployment}.`;
  if (requireEu && !azureModelEuVerified(model)) return level ? `Ingen EU-verifierad modell för ${AZURE_LEVEL_LABEL[level].toLowerCase()}.` : `EU-behandling är inte verifierad med en källa för ${deployment}.`;
  return null;
}

/** What stops Azure as a whole (switch, address, key, agreement), or null: the same for both profiles. */
export function azureCommonProblem(settings: AzureSettings): string | null {
  if (!settings.requested) return "Azure är inte påslagen.";
  if (!validAzureEndpoint(settings.endpoint)) return "Azure-adressen saknas eller ser fel ut.";
  if (!settings.apiKey) return "Azure-nyckel saknas.";
  if (!settings.dpaApproved) return "Microsofts avtal (DPA) är inte bekräftat.";
  return null;
}

/**
 * The first thing that stops a profile on Azure, or null when it may be used. Fail closed: every part must be in place. The EU
 * profile needs every level's model EU-verified with a source (2026-11-21: EU follows each model, not one switch).
 */
export function azureProblem(settings: AzureSettings, profile: AiProfileId = "eu"): string | null {
  const common = azureCommonProblem(settings);
  if (common) return common;
  const set = deploymentsFor(settings, profile);
  if (AZURE_ROUTE_MODELS.some((model) => !validDeployment(set[model] ?? ""))) return "Ett driftsättningsnamn saknas eller ser fel ut.";
  for (const level of AZURE_ROUTE_MODELS) {
    const deployment = set[level].trim();
    const problem = azureModelProblem(azureModelOf(settings, deployment), deployment, profile === "eu", level);
    if (problem) return problem;
  }
  return null;
}

/**
 * What stops the chat's image button for a profile on Azure, or null (2026-11-21): Azure itself, then the model behind the level
 * the chat answers with – it must be usable in the profile and its card must say Bilder. Said in plain words, since the person in
 * the chat sees it.
 */
export function azureImageProblem(settings: AzureSettings, profile: AiProfileId, level: AzureRouteModel): string | null {
  const blocked = azureProblem(settings, profile);
  if (blocked) return blocked;
  const deployment = (deploymentsFor(settings, profile)[level] ?? "").trim();
  return azureModelReadsImages(azureModelOf(settings, deployment)) ? null : IMAGES_OFF;
}
export const IMAGES_OFF = "AI-modellen som företaget använder kan inte läsa bilder.";
export const VOICE_OFF = "Tal till text är inte inställt för företagets AI-profil.";

/**
 * What stops Tal till text for a profile on Azure, or null (2026-11-21): Azure itself, a deployment filled in, and its card –
 * priced, and EU-verified with a source for the EU profile. There is no fallback to the other profile's deployment.
 */
export function azureTranscriptionProblem(settings: AzureSettings, profile: AiProfileId): string | null {
  const common = azureCommonProblem(settings);
  if (common) return common;
  const deployment = (settings.transcription?.[profile] ?? "").trim();
  if (!deployment) return VOICE_OFF;
  if (!validDeployment(deployment)) return "Driftsättningen för tal till text ser fel ut.";
  return azureModelProblem(azureModelOf(settings, deployment), deployment, profile === "eu");
}

/** The policy a transcription run is priced with: the route's commercial policy with the transcription card's prices and region. */
export function azureTranscriptionPolicy(route: AiModelPolicy, settings: AzureSettings, profile: AiProfileId): { policy: AiModelPolicy; deployment: string } {
  const problem = azureTranscriptionProblem(settings, profile);
  if (problem) throw new Error(problem);
  const deployment = settings.transcription[profile].trim();
  const card = azureModelOf(settings, deployment)!;
  return { deployment, policy: cardPolicy(route, card, { provider: "AZURE_OPENAI", name: deployment, prefix: "azure-tal", region: azureRegionOf(card) }) };
}

/** How many of the cards in use are EU-verified (the history line instead of "EU bekräftat"). */
export const euVerifiedCount = (settings: { deployments: AzureDeployments; standardDeployments?: AzureDeployments; transcription?: AzureTranscription; models: AzureModelInfo[] }) =>
  usedDeployments(settings).filter((deployment) => azureModelEuVerified(azureModelOf(settings, deployment))).length;

const micros = (usd: number) => Math.max(1, Math.round(usd * 1_000_000));

/**
 * A route's policy on Azure in a profile: the same task, effort, markup, minimum and credit value as every other provider (one
 * commercial policy, no Azure uplift in code), with the Azure model's own name, prices and region (EU or GLOBAL from the card). The
 * run stores it, so a later price change never touches earlier runs. Throws when the model may not be used – there is no fallback.
 */
export function azureRoutePolicy(route: AiModelPolicy, settings: AzureSettings, profile: AiProfileId = "eu"): AiModelPolicy {
  const level = route.model as AzureRouteModel;
  const deployment = (deploymentsFor(settings, profile)[level] ?? "").trim();
  const model = azureModelOf(settings, deployment);
  const problem = azureModelProblem(model, deployment, profile === "eu", AZURE_ROUTE_MODELS.includes(level) ? level : undefined);
  if (problem || !model?.inputUsdPerMillion || !model.outputUsdPerMillion) throw new Error(problem ?? `Pris saknas för ${deployment}.`);
  return cardPolicy(route, model, { provider: "AZURE_OPENAI", name: deployment, prefix: "azure", region: azureRegionOf(model) });
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
  /** Which profile's deployment is tried when the form gives none. */
  profile: z.enum(AI_PROFILE_IDS).optional(),
  endpoint: z.string().trim().max(200).optional(),
  apiKey: z.string().trim().max(200).optional(),
  deployment: z.string().trim().max(64).optional(),
  question: z.string().trim().min(1).max(AZURE_PROBE_MAX_CHARS).optional(),
});

/**
 * The company's choice decides the route (2026-11-21): a company that requires the EU, or chose the EU profile, runs on the
 * EU-verified Azure models or not at all; the Standard profile runs on the installation's provider for Standard (Cloud: always
 * Azure's Standard deployments; Community: OpenAI or Azure, the product owner's choice). A profile that is not ready never falls
 * back to another profile or provider.
 */
export type StandardProviderId = "OPENAI" | "AZURE_OPENAI";
export type ProviderChoice = { use: "openai" } | { use: "azure"; profile: AiProfileId } | { use: "none"; reason: string }
  // Företagets egen AI-nyckel (2026-11-27, lib/ai/company-key.ts): the company's own provider, never Workflow's.
  | { use: "company"; provider: "azure-openai" | "openai"; endpoint: string; model: string; region: AiModelPolicy["processingRegion"] };
export function chooseProvider(input: {
  requireEu: boolean; profile?: AiProfileId; standardProvider: StandardProviderId;
  /** What stops each Azure profile (azureProblem), or null when it is ready. */
  azureProblems: Record<AiProfileId, string | null>;
  /** The installation's operator as the reason names it ("HINTEK"). */
  operator?: string;
}): ProviderChoice {
  const operator = input.operator || "Workflow";
  const wanted = input.profile ?? "standard";
  if (input.requireEu) {
    if (input.azureProblems.eu === null) return { use: "azure", profile: "eu" };
    return { use: "none", reason: `Företaget kräver behandling inom EU och ingen EU-modell är klar hos ${operator}. AI är avstängd tills den är klar.` };
  }
  if (wanted === "eu") return input.azureProblems.eu === null ? { use: "azure", profile: "eu" } : { use: "none", reason: `Företaget har valt AI-profilen EU och den är inte klar hos ${operator}. AI är avstängd för företaget tills den är klar eller en annan profil väljs.` };
  if (input.standardProvider === "OPENAI") return { use: "openai" };
  return input.azureProblems.standard === null ? { use: "azure", profile: "standard" } : { use: "none", reason: `AI-profilen Standard är inte klar hos ${operator}. AI är avstängd för företaget tills den är klar eller en annan profil väljs.` };
}

/**
 * Leverantör för Standard (2026-11-21, F7): in Cloud Workflow AI runs only on Azure, whatever is saved; in Community the
 * product owner chooses OpenAI (the default) or Azure.
 */
export const standardProviderOf = (saved: string | undefined, community: boolean): StandardProviderId =>
  !community ? "AZURE_OPENAI" : saved === "AZURE_OPENAI" ? "AZURE_OPENAI" : "OPENAI";
