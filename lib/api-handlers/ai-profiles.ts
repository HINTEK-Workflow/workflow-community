import { NextResponse } from "next/server";
import { context, failure } from "@/lib/kfid/server";
import { AI_FEATURE_LABELS_FOR_PROFILES, describeProfiles } from "@/lib/ai/ai-profiles";
import { AZURE_ROUTE_MODELS, azureProblem } from "@/lib/ai/azure-settings";
import { azureSettings } from "@/lib/ai/azure-settings-server";
import { aiRunPricing } from "@/lib/ai/credit-settings-server";
import { openAiModelCards, openAiSettings } from "@/lib/ai/provider-settings-server";
import { providerProblem } from "@/lib/ai/provider-settings";
import { getAiSharingPolicy } from "@/lib/ai/sharing-policy";

export const dynamic = "force-dynamic";

/**
 * AI-profiler för företagets admin (2026-10-24, svar 1): the profiles Workflow released, each with its provider and models,
 * what a short answer costs in credits, what the models can do, whether processing in the EU is verified (and the source) and their
 * limits – so the choice can be made on price, functions and data processing. Read by every member (it is what applies); only the
 * admin changes the choice (POST /api/ai/policy). No key, address or internal setting is in it.
 */
export async function GET() {
  try {
    const ctx = await context();
    const [policy, azure, cards, openAi, pricing] = await Promise.all([
      getAiSharingPolicy(ctx.organizationId), azureSettings(), openAiModelCards(), openAiSettings(), aiRunPricing("SIMPLE_CHAT"),
    ]);
    const profiles = describeProfiles({
      openAiCards: cards, openAiProblem: providerProblem(openAi), azure, azureProblem: azureProblem(azure),
      margin: pricing.policy.targetGrossMarginBps, usdSekRateMicros: pricing.fx.usdSekRateMicros, creditValueOre: pricing.creditValueOre,
      minimumCredits: pricing.minimumCredits, free: pricing.free, routeModels: AZURE_ROUTE_MODELS,
    });
    return NextResponse.json({ profiles, chosen: policy.profile, requireEu: policy.requireEu, canManage: ctx.admin, features: AI_FEATURE_LABELS_FOR_PROFILES }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}
