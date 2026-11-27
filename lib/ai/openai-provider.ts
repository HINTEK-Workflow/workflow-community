import "server-only";
import OpenAI from "openai";
import { env } from "@/lib/env";
import { AI_MODEL_ROUTES } from "@/lib/ai/model-catalog";
import { openAiSettings } from "@/lib/ai/provider-settings-server";
import { providerProblem, type OpenAiSettings } from "@/lib/ai/provider-settings";

/** OpenAI's ordinary address, always: only Azure counts as the EU (2026-11-01), whatever is saved or set about a region. */
export const OPENAI_GLOBAL_BASE_URL = "https://api.openai.com/v1";

/** Workflow's AI provider as it stands now: the settings saved in Installation, otherwise the server's .env. */
export async function openAiProviderStatus() {
  const settings = await openAiSettings();
  return {
    enabled: providerProblem(settings) === null,
    requested: settings.requested,
    evalEnabled: env.OPENAI_EVAL_ENABLED,
    configured: Boolean(settings.apiKey),
    dpaApproved: settings.dpaApproved,
    processingMode: "GLOBAL",
    euDataControlsApproved: false,
    providerEvalApproved: settings.evalApproved,
    provider: "OPENAI",
    processingRegion: "GLOBAL",
    baseUrl: OPENAI_GLOBAL_BASE_URL,
    providerStateStored: false,
    settingsSource: settings.source,
    keySource: settings.keySource,
    problem: providerProblem(settings),
    models: [...new Set(Object.values(AI_MODEL_ROUTES).map((route) => route.model))],
  } as const;
}

function client(apiKey: string) {
  return new OpenAI({ apiKey, baseURL: OPENAI_GLOBAL_BASE_URL, timeout: 45_000, maxRetries: 0 });
}

export async function createOpenAiClient() {
  const settings: OpenAiSettings = await openAiSettings();
  const problem = providerProblem(settings);
  if (problem) throw new Error(problem);
  return client(settings.apiKey);
}

/** Asks OpenAI whether it accepts a key, without a model call and without the key or OpenAI's text leaving the server. */
export async function checkOpenAiKey(apiKey: string) {
  try {
    await client(apiKey).models.list();
    return { ok: true, message: "OpenAI godtar nyckeln." };
  } catch (error) {
    const status = (error as { status?: number }).status;
    return { ok: false, message: status === 401 ? "OpenAI godtar inte nyckeln." : status === 429 ? "OpenAI svarar att kontot saknar kredit eller har nått sin gräns." : "OpenAI svarade inte. Försök igen." };
  }
}

export function createOpenAiEvalClient() {
  if (!env.OPENAI_EVAL_ENABLED)
    throw new Error("Provsviten mot OpenAI är avstängd av servern.");
  if (env.OPENAI_PROVIDER_ENABLED)
    throw new Error("Normalt leverantörsläge måste vara avstängt medan provsviten körs.");
  if (!env.OPENAI_API_KEY)
    throw new Error("OpenAI provider-eval saknar servernyckel.");
  const appUrl = new URL(env.APP_URL);
  const databaseUrl = new URL(env.DATABASE_URL);
  if (!["localhost", "127.0.0.1", "::1"].includes(appUrl.hostname) ||
      databaseUrl.pathname.replace(/^\//, "") !== "kfid_v3_test")
    throw new Error("Provsviten mot OpenAI får bara köras på loopback mot kfid_v3_test.");
  return client(env.OPENAI_API_KEY);
}
