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
import { routeAiModel } from "@/lib/ai/model-catalog";
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
import { isPageQuestion } from "@/lib/ai/assistant-rules";
import { answerForPage, answerWithoutAi, answerWithRules, planAnswer, searchSources, workContext } from "@/lib/ai/assistant-engine";
import { AliasMap } from "@/lib/ai/alias";
import { aiRunPricing } from "@/lib/ai/credit-settings-server";
import { readMemories } from "@/lib/ai/memory";
import {
  assistantSources,
  compactHistory,
  executeWorkflowAssistant,
} from "@/lib/ai/workflow-assistant";
import { AI_RATE_LIMIT_REASON, allowAiCall } from "@/lib/ai/rate-limit";
import { assistantToolDefinitions, createAssistantToolRunner, isOwnWorkQuestion, TOOL_OUTPUT_MAX_CHARS } from "@/lib/ai/assistant-tools";
import { runTool } from "@/lib/tools/registry";
import { readCachedResult, resultCacheKey, storeCachedResult } from "@/lib/ai/result-cache";
import { configuredAssistantProvider } from "@/lib/ai/assistant-provider";
import { getAiSharingPolicy, sharesWork, sourceAllowed } from "@/lib/ai/sharing-policy";

export const dynamic = "force-dynamic";

const idSchema = z.string().min(1).max(100);
/** The progress line's step, sent by "Fråga Workflow AI" on a tip (2026-10-01): kinds and steps only, never names. */
const pageSchema = z.object({
  kind: z.enum(["WORK_ORDER", "RISK_ASSESSMENT", "FORM", "COMMISSIONING_CONTROL", "PROJECT"]),
  step: z.string().max(60).nullable(),
  hint: z.string().max(400).nullable(),
  steps: z.array(z.object({ label: z.string().max(60), state: z.enum(["done", "current", "upcoming", "skipped"]) })).max(8),
  tip: z.string().max(500).nullable(),
  label: z.string().max(120).optional(),
  taskId: idSchema.optional(),
  missing: z.array(z.string().max(200)).max(10).optional(),
  /** "tip": asked from a tip's "Fråga Workflow AI"; "page": the page the person is on while typing a question. */
  source: z.enum(["tip", "page", "summary"]).optional(),
  /** Sammanställ resultat: the rules' summary, which the AI turns into a finished text (2026-10-01). */
  draft: z.string().max(4000).optional(),
}).strict();
const requestSchema = z.union([
  // The older two-step flow: the question was saved first, and this answers it.
  z.object({ messageId: idSchema }).strict(),
  // One round trip (2026-10-01: "långsam"): the question is saved and answered in the same request.
  z.object({ content: z.string().trim().min(1).max(8_000), conversationId: idSchema.optional(), page: pageSchema.optional() }).strict(),
]);

/** The model used for answers from the rules (no AI provider, no credits). */
const RULES_MODEL = "Workflow – direkt svar";

function titleFromMessage(content: string) {
  const firstLine = content.split(/\r?\n/, 1)[0].replace(/\s+/g, " ").trim();
  return firstLine.length > 64 ? `${firstLine.slice(0, 61)}…` : firstLine;
}

const messageSelect = {
  id: true, content: true, conversationId: true, createdAt: true,
  conversation: { select: { title: true, messages: { orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }], take: 12, select: { id: true, role: true, content: true } } } },
};

/**
 * Workflow AI (2026-09-30): rule-first. The question is answered with Workflow's own tools when it can be (the
 * person's own lists, reminders, time, planning, projects, customers, search) – immediately, without credits and
 * without anything leaving Workflow. Only questions that need interpretation, summarising or analysis go to the AI
 * model, which the server picks (the person never chooses model or effort) and which charges the company's credits.
 */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    const input = requestSchema.parse(await body(request));
    if (ctx.organization.storageMode !== "HINTEK_CLOUD") throw new ApiError(409, "Assistenten kräver serverlagring.");
    const message = "messageId" in input
      ? await prisma.aiMessage.findFirst({
        where: { id: input.messageId, organizationId: ctx.organizationId, authorId: ctx.user.id, role: "USER", conversation: { createdById: ctx.user.id, status: "ACTIVE" } },
        select: messageSelect,
      })
      : await prisma.$transaction(async (tx) => {
        const conversation = input.conversationId
          ? await tx.aiConversation.findFirst({ where: { id: input.conversationId, organizationId: ctx.organizationId, createdById: ctx.user.id, status: "ACTIVE" }, select: { id: true } })
          : await tx.aiConversation.create({ data: { organizationId: ctx.organizationId, createdById: ctx.user.id, title: titleFromMessage(input.content) }, select: { id: true } });
        if (!conversation) throw new ApiError(404, "AI-konversationen finns inte.");
        const created = await tx.aiMessage.create({ data: { conversationId: conversation.id, organizationId: ctx.organizationId, authorId: ctx.user.id, role: "USER", content: input.content }, select: { id: true } });
        await tx.aiConversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });
        return tx.aiMessage.findUniqueOrThrow({ where: { id: created.id }, select: messageSelect });
      });
    if (!message) throw new ApiError(404, "AI-meddelandet finns inte.");
    if (message.conversation.messages[0]?.id !== message.id)
      throw new ApiError(409, "Endast konversationens senaste meddelande kan skickas.");
    const conversation = { id: message.conversationId, title: message.conversation.title };
    const userMessage = { id: message.id, role: "USER" as const, content: message.content, citations: [], model: null, createdAt: message.createdAt };

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
        conversation,
        userMessage,
        message: existing.assistantMessage,
        chargedCredits: existing.chargedCredits,
        mode: "AI",
        reused: true,
      });
    }
    if (existing)
      throw new ApiError(409, "AI-körningen är redan startad eller avslutad. Spara en ny fråga för att försöka igen.");

    // 1. Rules: the same tools as the API and MCP, in the person's own session.
    const page = "page" in input ? input.page : undefined;
    // A question from a tip's "Fråga Workflow AI" is about the current step: the AI model when it is on, else the rules.
    // From a tip the question is about the step (AI when it is on). Typed on a page (2026-10-01: "den förstår inte att
    // jag är på kontrollsidan"), a question about the page – how to fill it in, what is missing, the next step – is
    // answered from the page's own rules for free; any other question is planned as usual, with the page as context.
    const fromTip = page && page.source !== "page";
    const aboutPage = Boolean(page && !fromTip && isPageQuestion(message.content));
    if (page && aboutPage) {
      const direct = answerForPage(page, "");
      const saved = await prisma.$transaction(async (tx) => {
        const created = await tx.aiMessage.create({ data: { conversationId: message.conversationId, organizationId: ctx.organizationId, role: "ASSISTANT", content: direct.answer.slice(0, 12_000), citations: direct.citations as never, model: RULES_MODEL } });
        await tx.aiConversation.update({ where: { id: message.conversationId }, data: { lastMessageAt: created.createdAt } });
        return created;
      });
      return NextResponse.json({ conversation, userMessage, message: saved, chargedCredits: 0, mode: "RULES", reused: false });
    }
    const plan = fromTip ? { kind: "ai" as const, reason: "interpretation" as const, searchQuery: null } : planAnswer(message.content);
    const saveDirect = async (content: string, citations: unknown[]) => {
      const saved = await prisma.$transaction(async (tx) => {
        const created = await tx.aiMessage.create({ data: { conversationId: message.conversationId, organizationId: ctx.organizationId, role: "ASSISTANT", content: content.slice(0, 12_000), citations: citations as never, model: RULES_MODEL } });
        await tx.aiConversation.update({ where: { id: message.conversationId }, data: { lastMessageAt: created.createdAt } });
        return created;
      });
      return NextResponse.json({ conversation, userMessage, message: saved, chargedCredits: 0, mode: "RULES", reused: false });
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
    const shareSources = sharingPolicy.shareCustomers || sharingPolicy.shareDocuments || sharesWork(sharingPolicy);
    if (!aiReady) {
      // Without AI the best the rules can do: the one clear match's details, or a search for the question's words.
      const reason = !sharingPolicy.enabled || !sharingPolicy.shareChatContent
        ? "Företagets admin har inte slagit på Workflow AI för tolkning och sammanfattningar (under Mitt företag → Workflow AI)."
        : "Workflow AI:s AI-modell är inte påslagen på servern ännu.";
      const direct = page && fromTip ? answerForPage(page, `AI-modellen kan resonera kring steget när den är påslagen. ${reason}`) : await answerWithoutAi(plan.searchQuery, reason, message.content);
      return saveDirect(direct.answer, direct.citations);
    }

    // Where the answer was asked for, so tokens and cost can be measured per place (plan 2026-10-01, fas 0).
    const isSummary = page?.source === "summary" && Boolean(page.draft);
    const surface = isSummary ? "summary" : fromTip ? "tip" : page ? "chat-page" : "chat";
    // Skriv med AI on unchanged material: the text already written is given back, without a new call or credits.
    const cacheKey = isSummary ? resultCacheKey({ organizationId: ctx.organizationId, agentId: "workflow-assistant", model: routeAiModel("SIMPLE_CHAT").model, material: `${page?.label ?? ""}\n${page?.draft ?? ""}` }) : null;
    const cached = cacheKey ? readCachedResult(cacheKey) : null;
    if (cached) {
      const saved = await prisma.$transaction(async (tx) => {
        const created = await tx.aiMessage.create({ data: { conversationId: message.conversationId, organizationId: ctx.organizationId, role: "ASSISTANT", content: cached.answer, citations: [], model: cached.model } });
        await tx.aiConversation.update({ where: { id: message.conversationId }, data: { lastMessageAt: created.createdAt } });
        return created;
      });
      return NextResponse.json({ conversation, userMessage, message: saved, chargedCredits: 0, mode: "AI", reused: true });
    }
    // A protection in the background: many AI answers in a minute get the best direct answer instead.
    if (!allowAiCall(ctx.user.id)) {
      const direct = page && fromTip ? answerForPage(page, AI_RATE_LIMIT_REASON) : await answerWithoutAi(plan.searchQuery, AI_RATE_LIMIT_REASON, message.content);
      return saveDirect(direct.answer, direct.citations);
    }

    // The server decides how much AI is needed: with Workflow sources a search answer (low effort), without a plain
    // answer (no extra reasoning). The person never picks a model.
    const sources = assistantSources(shareSources && plan.searchQuery ? (await searchSources(plan.searchQuery)).filter((item) => sourceAllowed(sharingPolicy, item.resourceType)).map((item) => ({ ...item })) : []);
    // Read tools for the answer (fas 1): only for a typed question, and only the ones the company's choices allow. A
    // summary is written from its draft and a tip's question is about the step, so neither gets tools.
    const alias = new AliasMap();
    const toolDefinitions = isSummary || fromTip ? [] : assistantToolDefinitions(sharingPolicy);
    const toolRunner = toolDefinitions.length ? createAssistantToolRunner({ policy: sharingPolicy, alias, run: runTool }) : null;
    const taskKind = sources.length || toolRunner ? "WORKFLOW_SEARCH" as const : "SIMPLE_CHAT" as const;
    const policy = routeAiModel(taskKind);
    const limits = assistantTaskLimits(taskKind);
    // A summary is written from its draft alone: no memory, no work overview and no earlier messages are sent.
    const memory = isSummary ? { company: "", user: "" } : await readMemories(ctx.organizationId, ctx.user.id);
    // Alias för grunduppgifter (2026-10-01): one map (above) for everything this answer sends; the answer is
    // restored. The work overview goes with a question about the person's own work as a whole – cheaper than several
    // tool calls; any other question leaves it out and fetches what it needs with the tools.
    const work = sharesWork(sharingPolicy) && !isSummary && !fromTip && isOwnWorkQuestion(message.content) ? await workContext(alias) : undefined;
    const completeHistory = [...message.conversation.messages].reverse().map((item) => ({
      role: item.role,
      content: item.content,
    }));
    // Older messages go in as their first line only (fewer tokens); the latest ones whole.
    const history = compactHistory(sharingPolicy.shareConversationHistory && !isSummary
      ? completeHistory
      : completeHistory.slice(-1));
    const estimatedInputTokens = estimateAssistantInputTokens([
      memory.company, memory.user,
      ...history.map((item) => item.content),
      ...sources.flatMap((source) => [source.title, source.description]),
      work ? JSON.stringify(work) : "", page ? JSON.stringify(page) : "",
      toolDefinitions.length ? JSON.stringify(toolDefinitions) : "",
    ].join("\n"));
    // With tools an answer takes up to one turn per call and a last one, and every turn sends the question and the
    // earlier results again: the run reserves for all of them (what is not used is released at the settlement).
    const turns = toolRunner ? toolRunner.maxCalls + 1 : 1;
    const toolOutputTokens = toolRunner ? toolRunner.maxCalls * Math.ceil(TOOL_OUTPUT_MAX_CHARS / 3) : 0;
    const inputTokenLimit = Math.min(200_000, turns * (Math.max(limits.minimumInputTokens, estimatedInputTokens * 2) + toolOutputTokens));
    const maxOutputTokens = limits.maxOutputTokens * turns;
    // The product owner sets the least an AI answer costs (2026-10-01); the run stores it.
    const { minimumCredits, fx, free } = await aiRunPricing(taskKind);
    const quote = quoteAiRun({
      taskKind,
      inputTokenLimit,
      maxOutputTokens,
      usdSekRateMicros: fx.usdSekRateMicros,
      minimumCredits,
      free,
    });
    const wallet = await prisma.creditWallet.findUniqueOrThrow({
      where: { organizationId: ctx.organizationId },
      select: { balance: true },
    });
    // Without enough credits the person still gets the best direct answer, with the reason (2026-10-01: an error
    // message instead of an answer made the chat feel broken).
    if (wallet.balance < quote.reservedCredits) {
      const reason = `Företaget har för få AI-krediter för AI-modellen (minst ${quote.reservedCredits} krävs, ${wallet.balance} finns).`;
      const direct = page && fromTip ? answerForPage(page, reason) : await answerWithoutAi(plan.searchQuery, reason, message.content);
      return saveDirect(direct.answer, direct.citations);
    }

    const reserved = await reserveAiRun({
      organizationId: ctx.organizationId,
      subject: { type: "WORKFLOW_ASSISTANT", id: message.conversationId },
      actorId: ctx.user.id,
      agentId: "workflow-assistant",
      minimumCredits,
      free,
      taskKind,
      requestKey,
      surface,
      estimatedInputTokens,
      inputTokenLimit,
      maxOutputTokens,
      usdSekRateMicros: fx.usdSekRateMicros,
      fxSource: fx.source,
      fxEffectiveDate: fx.effectiveDate,
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
        workContext: work,
        pageContext: page,
        alias,
        ...(toolRunner ? { tools: { definitions: toolDefinitions, maxToolCalls: toolRunner.maxCalls, callTool: toolRunner.callTool, citations: toolRunner.citations } } : {}),
      });
      // Which tools the answer used, in the run's own log: names and outcome, never what was asked or found.
      if (toolRunner?.calls.length)
        await prisma.aiRunEvent.create({ data: { runId: reserved.run.id, organizationId: ctx.organizationId, actorId: ctx.user.id, action: "tools_called", data: { tools: toolRunner.calls } } });
    } catch (error) {
      // Why it failed, without any content: the error kind and our own short reason (2026-10-02: the cause was invisible).
      console.error("Workflow AI provider failed", error instanceof Error ? `${error.name}: ${error.message.slice(0, 160)}` : "Unknown");
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

    if (cacheKey) storeCachedResult(cacheKey, providerResult.answer, policy.model);
    // The settled run's own message (saved atomically with the settlement), so the panel can show it without a reload.
    const assistantMessage = await prisma.aiMessage.findUnique({ where: { runId: settled.run.id }, select: { id: true, role: true, content: true, citations: true, model: true, createdAt: true } });
    return NextResponse.json({
      runId: settled.run.id,
      conversation,
      userMessage,
      message: assistantMessage ?? { id: settled.run.id, role: "ASSISTANT", content: providerResult.answer, citations: providerResult.citations, model: policy.model, createdAt: new Date() },
      chargedCredits: settled.run.chargedCredits,
      // What is left, shown in the panel instead of only what the answer cost (2026-10-01).
      balance: (await prisma.creditWallet.findUnique({ where: { organizationId: ctx.organizationId }, select: { balance: true } }))?.balance ?? null,
      mode: "AI",
      reused: false,
    });
  } catch (error) {
    return failure(error);
  }
}
