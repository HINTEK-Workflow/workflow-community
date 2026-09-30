import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  ApiError,
  body,
  checkOrigin,
  context,
  failure,
} from "@/lib/kfid/server";
import { getWorkflowAgent } from "@/lib/ai/agent-registry";
import { quoteAiRun } from "@/lib/ai/cost-policy";
import {
  AI_INTERNAL_FX_POLICY,
  routeAiModel,
} from "@/lib/ai/model-catalog";
import { aiProviderStatus } from "@/lib/ai/provider-status";
import {
  compensateFailedAiRun,
  markAiRunStarted,
  reserveAiRun,
  settleAiRun,
} from "@/lib/ai/run-ledger";
import {
  assistantTaskLimits,
  estimateAssistantInputTokens,
} from "@/lib/ai/task-router";
import { answerWithRules, planAnswer, searchSources } from "@/lib/ai/assistant-engine";
import { readMemories } from "@/lib/ai/memory";
import {
  assistantSources,
  executeWorkflowAssistant,
} from "@/lib/ai/workflow-assistant";
import { configuredAssistantProvider } from "@/lib/ai/assistant-provider";
import { getAiSharingPolicy } from "@/lib/ai/sharing-policy";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  messageId: z.string().min(1).max(100),
}).strict();

/** The model used for answers from the rules (no AI provider, no credits). */
const RULES_MODEL = "Workflow – direkt svar";

/**
 * HINTEK AI (Daniel 2026-09-30): rule-first. The question is answered with Workflow's own tools when it can be (the
 * person's own lists, reminders, time, planning, projects, customers, search) – immediately, without credits and
 * without anything leaving Workflow. Only questions that need interpretation, summarising or analysis go to the AI
 * model, which the server picks (the person never chooses model or effort) and which charges the company's credits.
 */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    const input = requestSchema.parse(await body(request));
    const message = await prisma.aiMessage.findFirst({
      where: {
        id: input.messageId,
        organizationId: ctx.organizationId,
        authorId: ctx.user.id,
        role: "USER",
        conversation: { createdById: ctx.user.id, status: "ACTIVE" },
      },
      select: {
        id: true,
        content: true,
        conversationId: true,
        conversation: {
          select: {
            messages: {
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: 12,
              select: { id: true, role: true, content: true },
            },
          },
        },
      },
    });
    if (!message) throw new ApiError(404, "AI-meddelandet finns inte.");
    if (message.conversation.messages[0]?.id !== message.id)
      throw new ApiError(409, "Endast konversationens senaste meddelande kan skickas.");

    const requestKey = `assistant:${message.id}`;
    const existing = await prisma.aiRun.findUnique({
      where: {
        organizationId_requestKey: {
          organizationId: ctx.organizationId,
          requestKey,
        },
      },
      include: { assistantMessage: true },
    });
    if (existing?.status === "COMPLETED" && existing.assistantMessage) {
      return NextResponse.json({
        runId: existing.id,
        message: existing.assistantMessage,
        chargedCredits: existing.chargedCredits,
        reused: true,
      });
    }
    if (existing)
      throw new ApiError(409, "AI-körningen är redan startad eller avslutad. Spara en ny fråga för att försöka igen.");

    // 1. Rules: the same tools as the API and MCP, in the person's own session.
    const plan = planAnswer(message.content);
    const saveDirect = async (content: string, citations: unknown[]) => {
      const saved = await prisma.$transaction(async (tx) => {
        const created = await tx.aiMessage.create({ data: { conversationId: message.conversationId, organizationId: ctx.organizationId, role: "ASSISTANT", content: content.slice(0, 12_000), citations: citations as never, model: RULES_MODEL } });
        await tx.aiConversation.update({ where: { id: message.conversationId }, data: { lastMessageAt: created.createdAt } });
        return created;
      });
      return NextResponse.json({ message: saved, chargedCredits: 0, mode: "RULES", reused: false });
    };
    if (plan.kind !== "ai") {
      const direct = await answerWithRules(plan);
      return saveDirect(direct.answer, direct.citations);
    }

    // 2. AI: only when it is switched on for the company, allowed by its sharing choices and paid by its credits.
    const provider = await aiProviderStatus();
    const agent = getWorkflowAgent("workflow-assistant");
    const sharingPolicy = await getAiSharingPolicy(ctx.organizationId);
    const aiReady = sharingPolicy.enabled && sharingPolicy.shareChatContent && provider.enabled && provider.configured && agent?.lifecycle === "ENABLED";
    const shareSources = sharingPolicy.shareCustomers || (sharingPolicy.allowedModules.includes("KFID") && (sharingPolicy.shareControls || sharingPolicy.shareDocuments));
    if (!aiReady) {
      // Without AI the best the rules can do: a search for the question's words, said plainly.
      const found = plan.searchQuery ? await searchSources(plan.searchQuery) : [];
      const reason = !sharingPolicy.enabled || !sharingPolicy.shareChatContent
        ? "Företagets admin har inte slagit på HINTEK AI för tolkning och sammanfattningar (under HINTEK AI → Delning)."
        : "HINTEK AI:s AI-modell är inte påslagen på servern ännu.";
      const intro = `Den här frågan behöver AI för att tolkas. ${reason}`;
      if (!found.length) return saveDirect([intro, "Pröva en kortare fråga, t.ex. ”mina uppgifter”, ”vad är försenat” eller ”sök …”. Skriv ”hjälp” för fler."].join("\n"), []);
      return saveDirect([intro, "Det här hittade jag på orden i frågan:", ...found.map((item) => `• ${item.description || item.title}`)].join("\n"), found);
    }

    // The server decides how much AI is needed: with Workflow sources a search answer (low effort), without a plain
    // answer (no extra reasoning). The person never picks a model.
    const sources = assistantSources(shareSources && plan.searchQuery ? (await searchSources(plan.searchQuery)).map((item) => ({ ...item })) : []);
    const taskKind = sources.length ? "WORKFLOW_SEARCH" as const : "SIMPLE_CHAT" as const;
    const policy = routeAiModel(taskKind);
    const limits = assistantTaskLimits(taskKind);
    const memory = await readMemories(ctx.organizationId, ctx.user.id);
    const completeHistory = [...message.conversation.messages].reverse().map((item) => ({
      role: item.role,
      content: item.content,
    }));
    const history = sharingPolicy.shareConversationHistory
      ? completeHistory
      : completeHistory.slice(-1);
    const estimatedInputTokens = estimateAssistantInputTokens([
      memory.company, memory.user,
      ...history.map((item) => item.content),
      ...sources.flatMap((source) => [source.title, source.description]),
    ].join("\n"));
    const inputTokenLimit = Math.max(
      limits.minimumInputTokens,
      Math.min(200_000, estimatedInputTokens * 2),
    );
    const quote = quoteAiRun({
      taskKind,
      inputTokenLimit,
      maxOutputTokens: limits.maxOutputTokens,
      usdSekRateMicros: AI_INTERNAL_FX_POLICY.usdSekRateMicros,
    });
    const wallet = await prisma.creditWallet.findUniqueOrThrow({
      where: { organizationId: ctx.organizationId },
      select: { balance: true },
    });
    if (wallet.balance < quote.reservedCredits)
      throw new ApiError(402, `Minst ${quote.reservedCredits} krediter krävs för den här körningen.`);

    const reserved = await reserveAiRun({
      organizationId: ctx.organizationId,
      subject: { type: "WORKFLOW_ASSISTANT", id: message.conversationId },
      actorId: ctx.user.id,
      agentId: "workflow-assistant",
      taskKind,
      requestKey,
      estimatedInputTokens,
      inputTokenLimit,
      maxOutputTokens: limits.maxOutputTokens,
      usdSekRateMicros: AI_INTERNAL_FX_POLICY.usdSekRateMicros,
      fxSource: AI_INTERNAL_FX_POLICY.source,
      fxEffectiveDate: AI_INTERNAL_FX_POLICY.effectiveDate,
    });
    await markAiRunStarted(ctx.organizationId, reserved.run.id, ctx.user.id);

    let providerResult;
    try {
      providerResult = await executeWorkflowAssistant(await configuredAssistantProvider(), {
        model: policy.model,
        reasoningEffort: policy.reasoningEffort,
        maxOutputTokens: limits.maxOutputTokens,
        organizationId: ctx.organizationId,
        actorId: ctx.user.id,
        history,
        sources,
        memory: { company: memory.company, user: memory.user },
      });
    } catch {
      await compensateFailedAiRun({
        organizationId: ctx.organizationId,
        runId: reserved.run.id,
        actorId: ctx.user.id,
        failureCode: "PROVIDER_FAILED",
      });
      throw new ApiError(502, "AI-leverantören kunde inte slutföra svaret. Reservationen har återförts.");
    }

    let settled;
    try {
      settled = await settleAiRun({
        organizationId: ctx.organizationId,
        runId: reserved.run.id,
        actorId: ctx.user.id,
        providerResponseId: providerResult.providerResponseId,
        usage: providerResult.usage,
        assistantMessage: {
          conversationId: message.conversationId,
          content: providerResult.answer,
          citations: providerResult.citations,
          model: policy.model,
        },
      });
    } catch {
      await compensateFailedAiRun({
        organizationId: ctx.organizationId,
        runId: reserved.run.id,
        actorId: ctx.user.id,
        failureCode: "SETTLEMENT_FAILED",
      });
      throw new ApiError(502, "AI-svaret kunde inte sparas säkert. Reservationen har återförts.");
    }

    return NextResponse.json({
      runId: settled.run.id,
      message: {
        role: "ASSISTANT",
        content: providerResult.answer,
        citations: providerResult.citations,
        model: policy.model,
      },
      chargedCredits: settled.run.chargedCredits,
      mode: "AI",
      reused: false,
    });
  } catch (error) {
    return failure(error);
  }
}
