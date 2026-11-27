import "server-only";
import { randomUUID } from "node:crypto";
import OpenAI, { toFile } from "openai";
import { ApiError, type Context } from "@/lib/kfid/server";
import { azureTranscriptionPolicy } from "@/lib/ai/azure-settings";
import { aiRunPricing } from "@/lib/ai/credit-settings-server";
import { providerChoiceFor } from "@/lib/ai/provider-choice-server";
import { compensateFailedAiRun, markAiRunStarted, reserveAiRun, settleAiRun } from "@/lib/ai/run-ledger";
import { getAiSharingPolicy } from "@/lib/ai/sharing-policy";
import { chatMediaStatus } from "@/lib/ai/chat-media-server";
import { checkAiBudgetSoon, reportAzureRefusal } from "@/lib/ai/ai-alarms-run";
import { AI_RATE_LIMIT_REASON, allowAiCall } from "@/lib/ai/rate-limit";
import { AI_COMPANY_LIMIT_REASON, allowCompanyAiCall } from "@/lib/ai/company-limit";
import { transcribeSpeech, TranscriptionRefused, type TranscriptionClient } from "@/lib/ai/transcription";

/**
 * Tal till text for one company (2026-11-21): the same gates as a chat answer – the company's Workflow AI and chat sharing,
 * its AI profile (no fallback), the weekly quota (lib/ai/credit-settings-server.ts pauses it), the per-person and per-company
 * limits – then one call to the profile's transcription deployment on Azure, recorded in the AI log as "Tal till text" with the
 * card's prices. Manuellt and Auto stay within the weekly quota; credits only where the quota's own rule says so.
 */
export async function transcribeForCompany(ctx: Context, audio: Uint8Array, seconds: number, signal?: AbortSignal) {
  try {
    const sharing = await getAiSharingPolicy(ctx.organizationId);
    if (!sharing.enabled || !sharing.shareChatContent) throw new ApiError(409, "Workflow AI är av för företaget, så tal till text går inte att använda.");
    const media = await chatMediaStatus(ctx.organizationId);
    if (!media.voice.ready) throw new ApiError(409, media.voice.reason ?? "Tal till text går inte att använda just nu.");
    if (!allowAiCall(ctx.user.id)) throw new ApiError(429, AI_RATE_LIMIT_REASON);
    if (!(await allowCompanyAiCall(ctx.organizationId))) throw new ApiError(429, AI_COMPANY_LIMIT_REASON);
    const { choice, azure } = await providerChoiceFor(ctx.organizationId);
    if (choice.use !== "azure" || !azure) throw new ApiError(409, "Tal till text går inte att använda just nu.");
    let pricing: Awaited<ReturnType<typeof aiRunPricing>>;
    try { pricing = await aiRunPricing("WRITING", ctx.organizationId); }
    catch (error) { throw new ApiError(409, error instanceof Error ? error.message : "Tal till text går inte att använda just nu."); }
    const { policy, deployment } = azureTranscriptionPolicy(pricing.policy, azure, choice.profile);
    const client = new OpenAI({ apiKey: azure.apiKey, baseURL: `${azure.endpoint}/openai/v1/`, timeout: 45_000, maxRetries: 0 }) as unknown as TranscriptionClient<Awaited<ReturnType<typeof toFile>>>;
    try {
      const result = await transcribeSpeech({
        audio, seconds, deployment, client, toFile: (bytes, name, type) => toFile(bytes, name, { type }), signal,
        ledger: {
          async reserve(limits) {
            // A refused reservation (too few credits, a limit) is the ledger's own Swedish reason, not a provider error.
            const reserved = await reserveAiRun({
              organizationId: ctx.organizationId, subject: { type: "ORGANIZATION_DAY", id: `voice:${randomUUID()}` }, actorId: ctx.user.id, agentId: "workflow-writer",
              taskKind: "WRITING", policy, requestKey: `voice-${randomUUID()}`, surface: "voice", free: pricing.free, minimumCredits: pricing.minimumCredits,
              creditValueOre: pricing.creditValueOre, ...limits, usdSekRateMicros: pricing.fx.usdSekRateMicros, fxSource: pricing.fx.source, fxEffectiveDate: pricing.fx.effectiveDate,
            }).catch((error: unknown) => { throw new ApiError(409, error instanceof Error ? error.message.slice(0, 200) : "Tal till text går inte att använda just nu."); });
            await markAiRunStarted(ctx.organizationId, reserved.run.id, ctx.user.id);
            return { runId: reserved.run.id };
          },
          async settle(runId, usage) {
            await settleAiRun({ organizationId: ctx.organizationId, runId, actorId: ctx.user.id, providerResponseId: `voice-${runId}`, usage });
          },
          async fail(runId, code) {
            await compensateFailedAiRun({ organizationId: ctx.organizationId, runId, actorId: ctx.user.id, failureCode: code });
          },
        },
      });
      checkAiBudgetSoon();
      return result.text;
    } catch (error) {
      if (error instanceof TranscriptionRefused) throw new ApiError(error.status, error.message);
      if (error instanceof ApiError) throw error;
      if (signal?.aborted) throw new ApiError(409, "Inspelningen avbröts.");
      void reportAzureRefusal(error, deployment);
      console.error("Workflow AI transcription failed", error instanceof Error ? error.name : "Unknown");
      throw new ApiError(502, "Tal till text svarade inte. Försök igen.");
    }
  } finally {
    // Whatever happened above, the recording is gone from memory (transcribeSpeech wipes it too).
    audio.fill(0);
  }
}
