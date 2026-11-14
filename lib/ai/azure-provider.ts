import "server-only";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import {
  AZURE_ENDPOINT_HINT, AZURE_PROBE_MAX_CHARS, azureErrorMessage, azureModelOf, azureModelPriced, azureProblem, normalizeAzureEndpoint,
  validAzureEndpoint, validAzureKey, validDeployment, type AzureRouteModel, type AzureSettings,
} from "@/lib/ai/azure-settings";
import { aiRunPricing } from "@/lib/ai/credit-settings-server";
import type { AiModelPolicy } from "@/lib/ai/model-catalog";
import { compensateFailedAiRun, markAiRunStarted, reserveAiRun, settleAiRun } from "@/lib/ai/run-ledger";
import { azureSettings } from "@/lib/ai/azure-settings-server";
import { makeResponsesProvider } from "@/lib/ai/openai-structured";

/**
 * Azure OpenAI Service (EU) behind the same neutral adapter as OpenAI: the Responses API on the owner's own resource address.
 * Used only for companies that require processing in the EU. Every part of the settings must be in place (azureProblem), or
 * the call is refused – there is no fallback to another provider. Azure takes the owner's deployment name as the model.
 */
async function client() {
  const settings = await azureSettings();
  const problem = azureProblem(settings);
  if (problem) throw new Error(problem);
  return new OpenAI({ apiKey: settings.apiKey, baseURL: `${settings.endpoint}/openai/v1/`, timeout: 45_000, maxRetries: 0 });
}

export const azureStructuredProvider = makeResponsesProvider({
  id: "AZURE_OPENAI_RESPONSES",
  getClient: client,
  plain: true,
  modelFor: async (model) => {
    const settings = await azureSettings();
    const name = settings.deployments[model as AzureRouteModel];
    if (!name) throw new Error("Det finns ingen Azure-driftsättning för den här modellen.");
    return name;
  },
});

export type AzureProbeClient = Pick<OpenAI, "responses">;
const probeClient = (endpoint: string, apiKey: string): AzureProbeClient => new OpenAI({ apiKey, baseURL: `${endpoint}/openai/v1/`, timeout: 30_000, maxRetries: 0 });

/** The trial's own prices: the model card's when it has them, otherwise one micro-USD so the run is recorded at (almost) no cost. */
function probePolicy(settings: AzureSettings, deployment: string, base: AiModelPolicy): AiModelPolicy {
  const card = azureModelOf(settings, deployment);
  const priced = azureModelPriced(card) && card?.inputUsdPerMillion && card.outputUsdPerMillion;
  const micros = (usd: number) => Math.max(1, Math.round(usd * 1_000_000));
  const input = priced ? micros(card.inputUsdPerMillion!) : 1;
  const output = priced ? micros(card.outputUsdPerMillion!) : 1;
  const cached = priced ? Math.min(input, micros(card.cachedInputUsdPerMillion ?? card.inputUsdPerMillion!)) : 1;
  return Object.freeze({
    ...base, provider: "AZURE_OPENAI" as const, model: card?.modelName || deployment, reasoningEffort: "low" as const, processingRegion: "EU" as const,
    pricingVersion: priced ? `azure-prov-${deployment}-${card.priceSetOn || "odaterat"}-${input}-${cached}-${output}` : `azure-prov-${deployment}-utan-pris`,
    inputPriceUsdMicrosPerMillion: input, cachedInputPriceUsdMicrosPerMillion: cached, outputPriceUsdMicrosPerMillion: output,
  });
}

/**
 * Kontrollera och provfråga för EU-leverantören (2026-10-24: "bygg kopplingen klart så att jag kan lägga in nyckeln och
 * testa"). A real, small Responses call against the deployment – the same call shape as Workflow's own (reasoning, store:false) – so a
 * wrong address, key or deployment name shows at once. It needs only the address, the key and a deployment: no price, no switch and
 * no confirmation, because it sends only synthetic text the superadmin types and is charged to no company. It is recorded in
 * Workflow's own organisation as a free run (surface "azure-probe"), so it shows in AI-användning. The key and Azure's own text
 * never leave the server; errors are told in Swedish (azureErrorMessage).
 */
export async function probeAzure(input: {
  organizationId: string; actorId: string; kind: "check" | "question";
  endpoint?: string; apiKey?: string; deployment?: string; question?: string;
}, makeClient: (endpoint: string, apiKey: string) => AzureProbeClient = probeClient) {
  const saved = await azureSettings();
  const endpoint = normalizeAzureEndpoint(input.endpoint || saved.endpoint);
  const apiKey = (input.apiKey || saved.apiKey).trim();
  const deployment = (input.deployment || saved.deployments["gpt-5.6-luna"] || "").trim();
  if (!validAzureEndpoint(endpoint)) return { ok: false as const, message: AZURE_ENDPOINT_HINT };
  if (!apiKey) return { ok: false as const, message: "Klistra in en nyckel först." };
  if (!validAzureKey(apiKey)) return { ok: false as const, message: "Nyckeln ser fel ut (bokstäver och siffror, minst 24 tecken)." };
  if (!validDeployment(deployment)) return { ok: false as const, message: "Ange driftsättningens namn (bokstäver, siffror, punkt, understreck och bindestreck)." };
  const question = input.kind === "check" ? "Svara bara: OK" : (input.question ?? "").trim().slice(0, AZURE_PROBE_MAX_CHARS) || "Svara kort: vad är 2 + 2?";
  const maxOutputTokens = input.kind === "check" ? 16 : 400;
  const pricing = await aiRunPricing("WRITING");
  const policy = probePolicy(saved, deployment, pricing.policy);
  const reserved = await reserveAiRun({
    organizationId: input.organizationId, subject: { type: "ORGANIZATION_DAY", id: `azure-probe:${Date.now()}` }, actorId: input.actorId, agentId: "workflow-writer",
    taskKind: "WRITING", policy, requestKey: `azure-probe-${randomUUID()}`, surface: "azure-probe", free: true, minimumCredits: 1, creditValueOre: pricing.creditValueOre,
    estimatedInputTokens: 200, inputTokenLimit: 4_000, maxOutputTokens, usdSekRateMicros: pricing.fx.usdSekRateMicros, fxSource: pricing.fx.source, fxEffectiveDate: pricing.fx.effectiveDate,
  });
  await markAiRunStarted(input.organizationId, reserved.run.id, input.actorId);
  const started = Date.now();
  try {
    const response = await makeClient(endpoint, apiKey).responses.create({
      model: deployment, reasoning: { effort: "low" }, input: question, max_output_tokens: maxOutputTokens, store: false,
    });
    const usage = { inputTokens: response.usage?.input_tokens ?? 0, cachedInputTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 };
    await settleAiRun({ organizationId: input.organizationId, runId: reserved.run.id, actorId: input.actorId, providerResponseId: response.id || `azure-probe-${reserved.run.id}`, usage });
    const answer = (response.output_text ?? "").trim().slice(0, 2_000);
    return {
      ok: true as const,
      message: input.kind === "check" ? `Azure godtar nyckeln och driftsättningen ${deployment}.` : answer ? "Azure svarade." : "Azure svarade utan text (svaret tog slut på tokens). Försök med en kortare fråga.",
      answer: input.kind === "check" ? "" : answer, deployment, model: typeof response.model === "string" ? response.model.slice(0, 100) : deployment,
      usage, ms: Date.now() - started, priced: !policy.pricingVersion.endsWith("utan-pris"),
    };
  } catch (error) {
    await compensateFailedAiRun({ organizationId: input.organizationId, runId: reserved.run.id, actorId: input.actorId, failureCode: "AZURE_PROBE_FAILED" });
    return { ok: false as const, message: azureErrorMessage(error, deployment) };
  }
}
