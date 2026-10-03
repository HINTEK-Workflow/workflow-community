import "server-only";
import OpenAI from "openai";
import { env } from "@/lib/env";
import { AI_MODEL_ROUTES } from "@/lib/ai/model-catalog";
import { openAiSettings } from "@/lib/ai/provider-settings-server";
import { providerProblem, type OpenAiSettings } from "@/lib/ai/provider-settings";

export const OPENAI_GLOBAL_BASE_URL = "https://api.openai.com/v1";
export const OPENAI_EU_BASE_URL = "https://eu.api.openai.com/v1";

const baseUrlOf = (region: "GLOBAL" | "EU") => region === "EU" ? OPENAI_EU_BASE_URL : OPENAI_GLOBAL_BASE_URL;

/** HINTEK's AI provider as it stands now: the settings saved in Produktadministration, otherwise the server's .env. */
export async function openAiProviderStatus() {
  const settings = await openAiSettings();
  return {
    enabled: providerProblem(settings) === null,
    requested: settings.requested,
    evalEnabled: env.OPENAI_EVAL_ENABLED,
    configured: Boolean(settings.apiKey),
    dpaApproved: settings.dpaApproved,
    processingMode: settings.region,
    euDataControlsApproved: settings.euControlsApproved,
    providerEvalApproved: settings.evalApproved,
    provider: "OPENAI",
    processingRegion: settings.region,
    baseUrl: baseUrlOf(settings.region),
    providerStateStored: false,
    settingsSource: settings.source,
    keySource: settings.keySource,
    problem: providerProblem(settings),
    models: [...new Set(Object.values(AI_MODEL_ROUTES).map((route) => route.model))],
  } as const;
}

function client(apiKey: string, region: "GLOBAL" | "EU") {
  return new OpenAI({ apiKey, baseURL: baseUrlOf(region), timeout: 45_000, maxRetries: 0 });
}

export async function createOpenAiClient() {
  const settings: OpenAiSettings = await openAiSettings();
  const problem = providerProblem(settings);
  if (problem) throw new Error(problem);
  return client(settings.apiKey, settings.region);
}

/** Asks OpenAI whether it accepts a key, without a model call and without the key or OpenAI's text leaving the server. */
export async function checkOpenAiKey(apiKey: string, region: "GLOBAL" | "EU") {
  try {
    await client(apiKey, region).models.list();
    return { ok: true, message: "OpenAI godtar nyckeln." };
  } catch (error) {
    const status = (error as { status?: number }).status;
    return { ok: false, message: status === 401 ? "OpenAI godtar inte nyckeln." : status === 429 ? "OpenAI svarar att kontot saknar kredit eller har nått sin gräns." : "OpenAI svarade inte. Försök igen." };
  }
}

export function createOpenAiEvalClient() {
  if (!env.OPENAI_EVAL_ENABLED)
    throw new Error("OpenAI provider-eval är avstängd av servern.");
  if (env.OPENAI_PROVIDER_ENABLED)
    throw new Error("Normalt providerläge måste vara avstängt under provider-eval.");
  if (env.OPENAI_PROCESSING_REGION === "EU" && !env.OPENAI_EU_DATA_CONTROLS_APPROVED)
    throw new Error("OpenAI-projektets EU-datakontroller är inte verifierade.");
  if (!env.OPENAI_API_KEY)
    throw new Error("OpenAI provider-eval saknar servernyckel.");
  const appUrl = new URL(env.APP_URL);
  const databaseUrl = new URL(env.DATABASE_URL);
  if (!["localhost", "127.0.0.1", "::1"].includes(appUrl.hostname) ||
      databaseUrl.pathname.replace(/^\//, "") !== "kfid_v3_test")
    throw new Error("OpenAI provider-eval får endast köras på loopback mot kfid_v3_test.");
  return client(env.OPENAI_API_KEY, env.OPENAI_PROCESSING_REGION);
}
