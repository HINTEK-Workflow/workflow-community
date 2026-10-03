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
  WRITING: "Texter och förslag",
} as const;

type Provider = Awaited<ReturnType<typeof aiProviderStatus>>;
function providerReason(provider: Provider, assistantOn: boolean, superadmin: boolean) {
  if (provider.enabled && provider.configured && assistantOn) return undefined;
  if (!superadmin) return "HINTEK slår på AI-modellen. Tills dess svarar Workflow AI bara direkt ur Workflow.";
  if (!assistantOn) return "Assistenten är inte påslagen i agentregistret.";
  return `${"problem" in provider && provider.problem ? provider.problem : "AI är avstängt i den här installationen."} Ställs in under Produktadministration → AI.`;
}

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
        // Why the model is not on: the exact server setting for HINTEK's superadmin, a plain sentence for everyone else
        // (2026-10-02: "Inte påslagen än" said nothing about what was missing).
        reason: providerReason(provider, assistant?.lifecycle === "ENABLED", ctx.user.role === "SUPERADMIN"),
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
      // Rule-first (2026-09-30): direct answers from Workflow's own tools work in every Cloud company, without
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
