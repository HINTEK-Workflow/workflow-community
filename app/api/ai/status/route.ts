import { NextResponse } from "next/server";
import { ApiError, context, failure } from "@/lib/kfid/server";
import { aiProviderStatus } from "@/lib/ai/provider-status";
import { AI_MODEL_ROUTES } from "@/lib/ai/model-catalog";
import { getWorkflowAgent } from "@/lib/ai/agent-registry";
import { getAiSharingPolicy } from "@/lib/ai/sharing-policy";
import { readCreditWalletInvariant } from "@/lib/credits/wallet-invariant";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const routeLabels = {
  SIMPLE_CHAT: "Enkla frågor",
  WORKFLOW_SEARCH: "Sökning i Workflow",
  DOCUMENT_ANALYSIS: "Dokumentanalys",
  WORKFLOW_PROPOSAL: "Förslag till ändringar",
  KFID_CONTROL_REVIEW: "Teknisk granskning av kontroll före idrifttagning",
} as const;

export async function GET(request: Request) {
  try {
    const ctx = await context({ skipLegal: true });
    const provider = await aiProviderStatus();
    const assistant = getWorkflowAgent("workflow-assistant");
    const policy = await getAiSharingPolicy(ctx.organizationId);
    const ledger = await readCreditWalletInvariant(prisma, ctx.organizationId);
    const conditions = {
      provider: {
        ready: provider.enabled && provider.configured && assistant?.lifecycle === "ENABLED",
        configured: provider.configured,
        evaluationApproved: provider.providerEvalApproved,
      },
      sharingPolicy: {
        ready: policy.enabled && policy.shareChatContent,
      },
      creditLedger: {
        healthy: ledger.healthy,
        walletBalanceMatchesLots: ledger.walletBalanceMatchesLots,
        purchasedBalanceMatchesLots: ledger.purchasedBalanceMatchesLots,
        walletBalanceMatchesLedger: ledger.walletBalanceMatchesLedger,
      },
      availableCredits: {
        available: ledger.balance > 0,
        balance: ledger.balance,
      },
    } as const;
    const available = conditions.provider.ready && conditions.sharingPolicy.ready &&
      conditions.creditLedger.healthy && conditions.availableCredits.available;
    const details = new URL(request.url).searchParams.get("details") === "admin";
    if (details && ctx.user.role !== "SUPERADMIN")
      throw new ApiError(403, "Endast superadmin får se teknisk AI-status.");
    return NextResponse.json({
      lifecycle: available ? "READY" : "EXECUTION_LOCKED",
      available,
      // Rule-first (Daniel 2026-09-30): direct answers from Workflow's own tools work in every Cloud company, without
      // AI and without credits; "available" is whether the AI model can also be used.
      chatAvailable: ctx.organization.storageMode === "HINTEK_CLOUD",
      role: ctx.user.role === "SUPERADMIN"
        ? "SUPERADMIN"
        : ctx.admin ? "ADMIN" : "MEMBER",
      conditions,
      sharingPolicy: policy,
      historyLocation: "WORKFLOW",
      ...(details ? {
        provider: {
          adapter: "OPENAI_RESPONSES",
          architecture: "PROVIDER_NEUTRAL",
          enabled: provider.enabled,
          requested: provider.requested,
          evalEnabled: provider.evalEnabled,
          configured: provider.configured,
          dpaApproved: provider.dpaApproved,
          processingMode: provider.processingMode,
          euDataControlsApproved: provider.euDataControlsApproved,
          providerEvalApproved: provider.providerEvalApproved,
          processingRegion: provider.processingRegion,
          providerStateStored: provider.providerStateStored,
        },
        routes: Object.values(AI_MODEL_ROUTES).map((route) => ({
          taskKind: route.taskKind,
          label: routeLabels[route.taskKind],
          model: route.model,
        })),
      } : {}),
    });
  } catch (error) {
    return failure(error);
  }
}
