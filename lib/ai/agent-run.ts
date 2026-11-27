import "server-only";
import { createHash } from "node:crypto";
import type { z } from "zod";
import { getWorkflowAgent, type WorkflowAgentId } from "@/lib/ai/agent-registry";
import { configuredStructuredProvider, euRefusal } from "@/lib/ai/assistant-provider";
import { quoteAiRun } from "@/lib/ai/cost-policy";
import { aiRunPricing } from "@/lib/ai/credit-settings-server";
import type { AiChargeMode } from "@/lib/ai/credit-settings";
import { routeAiModel, type AiTaskKind } from "@/lib/ai/model-catalog";
import { aiProviderStatus } from "@/lib/ai/provider-status";
import { AI_RATE_LIMIT_REASON, allowAiCall } from "@/lib/ai/rate-limit";
import { AI_COMPANY_LIMIT_REASON, allowCompanyAiCall } from "@/lib/ai/company-limit";
import { compensateFailedAiRun, markAiRunStarted, reserveAiRun, settleAiRun, type AiRunSubject } from "@/lib/ai/run-ledger";
import { getAiSharingPolicy, type AiSharingPolicy } from "@/lib/ai/sharing-policy";
import { assistantTaskLimits, estimateAssistantInputTokens } from "@/lib/ai/task-router";
import { prisma } from "@/lib/db";
import { companyKeyErrorReason } from "@/lib/ai/company-key-server";

export type AgentRunOutcome<T> =
  | { used: true; output: T; chargedCredits: number; model: string; runId: string }
  | { used: false; reason: string };

/**
 * One structured answer from an agent without tools (plan 2026-10-01, fas 2): the writer, the reviewer, the digest.
 * Everything every AI call must pass sits here once: the provider is on, the company has switched the AI on and
 * shares what this run needs, the person is within the rate limit, the credits cover the most the run can cost; then
 * the reservation, the call through the neutral adapter, and the settlement – with the reservation returned if
 * anything fails. A refusal is a reason in Swedish, never an exception, so the caller can fall back on the rules.
 */
export async function runStructuredAgent<T>(input: {
  organizationId: string;
  actorId: string;
  agentId: WorkflowAgentId;
  taskKind: AiTaskKind;
  /** Where in Workflow the run was asked for, for cost per place. */
  surface: string;
  subject: AiRunSubject;
  /** Unique per run; the same key never runs twice. */
  requestKey: string;
  instructions: string;
  /** The material, already minimised and with names as aliases. Untrusted data to the model. */
  input: string;
  schema: z.ZodType<T>;
  schemaName: string;
  /** Which of the company's sharing choices the run needs. */
  shared: (policy: AiSharingPolicy) => boolean;
  /** Counted against the person's rate limit; the nightly digest is not a person's call. */
  rateLimited?: boolean;
  maxOutputTokens?: number;
  /**
   * Agenter (2026-11-21): "credits" for a mission's run, which costs Azure's price and the markup outside the week's quota;
   * left out, the run is included in the subscription within the week's quota (the chat, Auto, Provkör).
   */
  chargeMode?: AiChargeMode;
}): Promise<AgentRunOutcome<T>> {
  const agent = getWorkflowAgent(input.agentId);
  const provider = await aiProviderStatus(input.organizationId);
  if (!provider.enabled || !provider.configured || agent?.lifecycle !== "ENABLED") return { used: false, reason: "AI-modellen är inte påslagen på servern ännu." };
  const policy = await getAiSharingPolicy(input.organizationId);
  if (!policy.enabled || !input.shared(policy)) return { used: false, reason: "Företagets admin har inte slagit på det här för Workflow AI (Inställningar → Arbetssätt → Workflow AI)." };
  const euStop = await euRefusal(input.organizationId);
  if (euStop) return { used: false, reason: euStop };
  if (input.rateLimited !== false && !allowAiCall(input.actorId)) return { used: false, reason: AI_RATE_LIMIT_REASON };
  if (input.rateLimited !== false && !(await allowCompanyAiCall(input.organizationId))) return { used: false, reason: AI_COMPANY_LIMIT_REASON };

  const route = routeAiModel(input.taskKind);
  const limits = assistantTaskLimits(input.taskKind);
  const maxOutputTokens = Math.min(input.maxOutputTokens ?? limits.maxOutputTokens, agent.limits.maxOutputTokens);
  const estimatedInputTokens = estimateAssistantInputTokens(`${input.instructions}\n${input.input}`);
  const inputTokenLimit = Math.max(limits.minimumInputTokens, Math.min(200_000, estimatedInputTokens * 2));
  let pricingResult;
  try { pricingResult = await aiRunPricing(input.taskKind, input.organizationId, input.chargeMode); }
  catch (error) { return { used: false, reason: error instanceof Error && error.message ? error.message : "AI-modellen kan inte användas just nu." }; }
  const { minimumCredits, fx, free, creditValueOre, policy: pricing } = pricingResult;
  const quote = quoteAiRun({ taskKind: input.taskKind, policy: pricing, inputTokenLimit, maxOutputTokens, usdSekRateMicros: fx.usdSekRateMicros, minimumCredits, free, creditValueOre });
  const wallet = await prisma.creditWallet.findUnique({ where: { organizationId: input.organizationId }, select: { balance: true } });
  if (!free && (!wallet || wallet.balance < quote.reservedCredits)) return { used: false, reason: `Företaget har för få AI-krediter (minst ${quote.reservedCredits} krävs, ${wallet?.balance ?? 0} finns).` };

  const reserved = await reserveAiRun({
    organizationId: input.organizationId, subject: input.subject, actorId: input.actorId, agentId: input.agentId, taskKind: input.taskKind, policy: pricing,
    requestKey: input.requestKey, surface: input.surface, minimumCredits, free, creditValueOre, estimatedInputTokens, inputTokenLimit, maxOutputTokens,
    usdSekRateMicros: fx.usdSekRateMicros, fxSource: fx.source, fxEffectiveDate: fx.effectiveDate,
  });
  if (!reserved.created) return { used: false, reason: "AI-körningen är redan gjord." };
  await markAiRunStarted(input.organizationId, reserved.run.id, input.actorId);
  let result;
  try {
    const adapter = await configuredStructuredProvider(input.organizationId);
    result = await adapter.generateStructured({
      model: route.model, reasoningEffort: route.reasoningEffort, maxOutputTokens,
      safetyIdentifier: createHash("sha256").update(`${input.organizationId}:${input.actorId}`).digest("hex"),
      // Every run of an agent starts with the same instructions, so they share the provider's prompt cache.
      cacheKey: `hwf-${input.agentId}`,
      instructions: input.instructions, input: input.input, schema: input.schema, schemaName: input.schemaName,
    });
  } catch (error) {
    await compensateFailedAiRun({ organizationId: input.organizationId, runId: reserved.run.id, actorId: input.actorId, failureCode: "PROVIDER_FAILED" });
    // The company's own key said no: its reason, so the admin knows what to fix (and a mission pauses on it).
    return { used: false, reason: companyKeyErrorReason(error) ?? "AI-leverantören kunde inte slutföra svaret. Reservationen är återförd." };
  }
  try {
    const settled = await settleAiRun({ organizationId: input.organizationId, runId: reserved.run.id, actorId: input.actorId, providerResponseId: result.providerResponseId, usage: result.usage });
    return { used: true, output: result.output, chargedCredits: settled.run.chargedCredits ?? 0, model: pricing.model, runId: reserved.run.id };
  } catch {
    await compensateFailedAiRun({ organizationId: input.organizationId, runId: reserved.run.id, actorId: input.actorId, failureCode: "SETTLEMENT_FAILED" });
    return { used: false, reason: "AI-svaret kunde inte slutregleras. Reservationen är återförd." };
  }
}
