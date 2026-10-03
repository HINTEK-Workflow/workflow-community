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
import { quoteAiRun } from "@/lib/ai/cost-policy";
import { aiRunPricing } from "@/lib/ai/credit-settings-server";
import {
  assistantTaskLimits,
  classifyAssistantTask,
  estimateAssistantInputTokens,
} from "@/lib/ai/task-router";

export const dynamic = "force-dynamic";

const quoteRequest = z.object({
  messageId: z.string().min(1).max(100),
}).strict();

const taskLabels = {
  SIMPLE_CHAT: "Enkel fråga",
  WORKFLOW_SEARCH: "Workflow-sökning",
  DOCUMENT_ANALYSIS: "Dokumentanalys",
  WORKFLOW_PROPOSAL: "Förslag till ändring",
  KFID_CONTROL_REVIEW: "Teknisk granskning av kontroll före idrifttagning",
  WRITING: "Texter och förslag",
} as const;

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    const input = quoteRequest.parse(await body(request));
    const message = await prisma.aiMessage.findFirst({
      where: {
        id: input.messageId,
        organizationId: ctx.organizationId,
        authorId: ctx.user.id,
        role: "USER",
        conversation: { createdById: ctx.user.id, status: "ACTIVE" },
      },
      select: { id: true, content: true },
    });
    if (!message) throw new ApiError(404, "AI-meddelandet finns inte.");

    const taskKind = classifyAssistantTask(message.content);
    const limits = assistantTaskLimits(taskKind);
    const estimatedInputTokens = estimateAssistantInputTokens(message.content);
    const inputTokenLimit = Math.max(
      limits.minimumInputTokens,
      Math.min(200_000, estimatedInputTokens * 2),
    );
    const { minimumCredits, fx, free } = await aiRunPricing(taskKind);
    const quote = quoteAiRun({
      taskKind,
      inputTokenLimit,
      maxOutputTokens: limits.maxOutputTokens,
      usdSekRateMicros: fx.usdSekRateMicros,
      minimumCredits,
      free,
    });
    const wallet = await prisma.creditWallet.findUniqueOrThrow({
      where: { organizationId: ctx.organizationId },
      select: { balance: true },
    });

    return NextResponse.json({
      messageId: message.id,
      taskKind,
      taskLabel: taskLabels[taskKind],
      model: quote.policy.model,
      reasoningEffort: quote.policy.reasoningEffort,
      estimatedInputTokens,
      inputTokenLimit,
      maxOutputTokens: limits.maxOutputTokens,
      maximumCredits: quote.reservedCredits,
      currentBalance: wallet.balance,
      canReserve: wallet.balance >= quote.reservedCredits,
      pricingVersion: quote.policy.pricingVersion,
      fxVersion: fx.version,
      providerCalled: false,
      creditsReserved: false,
    });
  } catch (error) {
    return failure(error);
  }
}
