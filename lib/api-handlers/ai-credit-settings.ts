import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { publicInstance } from "@/lib/instance";
import { ApiError, body, checkOrigin, context, failure } from "@/lib/kfid/server";
import { swedishDayKey } from "@/lib/swedish-time";
import {
  AI_MARKUP_MAX, AI_MARKUP_MIN, AI_PROVIDERS, AI_SHARE_MAX_PERCENT, MONTHLY_BUDGET_MAX_KR, WEEKLY_QUOTA_LIMIT_KR, USD_SEK_MAX, USD_SEK_MIN, aiCreditSettingsSchema, fxSnapshot, marginBpsOf, type AiCreditSettings,
} from "@/lib/ai/credit-settings";
import { standardProviderOf } from "@/lib/ai/azure-settings";
import { aiCreditValueOre, readAiCreditSettings } from "@/lib/ai/credit-settings-server";
import { calculateAiUsageCost } from "@/lib/ai/cost-policy";
import { routeAiModel } from "@/lib/ai/model-catalog";

export const dynamic = "force-dynamic";

/** What a typical answer really costs with these settings, so the product owner sees what a change does (no provider call). */
function examples(settings: AiCreditSettings, creditFloorValueOre: number) {
  const { usdSekRateMicros } = fxSnapshot(settings);
  const run = (taskKind: "SIMPLE_CHAT" | "DOCUMENT_ANALYSIS", inputTokens: number, outputTokens: number, minimumCredits: number) => {
    const policy = { ...routeAiModel(taskKind), targetGrossMarginBps: marginBpsOf(settings) };
    const cost = calculateAiUsageCost({ inputTokens, cachedInputTokens: 0, outputTokens }, { ...policy, creditFloorValueOre, minimumCredits, usdSekRateMicros });
    const formula = calculateAiUsageCost({ inputTokens, cachedInputTokens: 0, outputTokens }, { ...policy, creditFloorValueOre, minimumCredits: 1, usdSekRateMicros });
    return { model: policy.model, inputTokens, outputTokens, providerCostOre: cost.providerCostOre, formulaCredits: formula.chargedCredits, chargedCredits: cost.chargedCredits };
  };
  return [
    { label: "Kort chattfråga", ...run("SIMPLE_CHAT", 600, 80, settings.chatMinimumCredits) },
    { label: "Chattfråga med uppgifter och projekt", ...run("SIMPLE_CHAT", 3_000, 400, settings.chatMinimumCredits) },
    { label: "Analys av en importfil", ...run("DOCUMENT_ANALYSIS", 4_000, 800, settings.documentMinimumCredits) },
  ];
}

/** The providers the product owner may choose for Standard: in Cloud only Azure (not choosable), in Community OpenAI or Azure. */
const providersOffered = () => (publicInstance().community ? AI_PROVIDERS : AI_PROVIDERS.filter((item) => item.id === "AZURE_OPENAI"));

// The credit's value comes from the active price version (prisrättning 1, 2026-10-23), as when a run is priced.
const view = (saved: AiCreditSettings, creditFloorValueOre: number) => {
  // What applies: in Cloud the provider is Azure whatever an older save says.
  const settings = { ...saved, provider: standardProviderOf(saved.provider, publicInstance().community) };
  return {
    settings,
    providers: providersOffered(),
    providerChoosable: publicInstance().community,
    limits: { usdSekMin: USD_SEK_MIN, usdSekMax: USD_SEK_MAX, markupMin: AI_MARKUP_MIN, markupMax: AI_MARKUP_MAX, budgetMax: MONTHLY_BUDGET_MAX_KR, shareMax: AI_SHARE_MAX_PERCENT, quotaMax: WEEKLY_QUOTA_LIMIT_KR },
    formula: { markupPercent: settings.markupPercent, creditFloorValueOre, usdSek: settings.usdSek },
    examples: examples(settings, creditFloorValueOre),
  };
};

/**
 * Kostnad per AI-svar (2026-10-01, 2026-10-02, 2026-11-21): Workflow's superadmin reads the price formula and sets the markup,
 * the minimum for chat answers and for document analysis, the exchange rate, Månadsbudget för AI and – in Community – Leverantör för
 * Standard. Each run stores what it was priced with.
 */
export async function GET() {
  try {
    const ctx = await context();
    if (ctx.user.role !== "SUPERADMIN") throw new ApiError(403, "Bara installationens administratör kan göra det.");
    return NextResponse.json(view(await readAiCreditSettings(), await aiCreditValueOre()));
  } catch (error) {
    return failure(error);
  }
}

// Every field may be left out (an older page, or Community's provider choice alone): what is left out keeps its saved value.
const inputSchema = z.object({
  chatMinimumCredits: z.number().int().min(1).max(50).optional(),
  documentMinimumCredits: z.number().int().min(1).max(50).optional(),
  usdSek: z.number().min(USD_SEK_MIN, `Valutakursen måste vara minst ${USD_SEK_MIN} kr per USD.`).max(USD_SEK_MAX, `Valutakursen får vara högst ${USD_SEK_MAX} kr per USD.`).optional(),
  provider: z.enum(AI_PROVIDERS.map((item) => item.id) as [string, ...string[]]).optional(),
  markupPercent: z.number().int().min(AI_MARKUP_MIN, `Påslaget måste vara minst ${AI_MARKUP_MIN} %.`).max(AI_MARKUP_MAX, `Påslaget får vara högst ${AI_MARKUP_MAX} %.`).optional(),
  monthlyBudgetKr: z.number().int().min(0, "Budgeten kan inte vara negativ.").max(MONTHLY_BUDGET_MAX_KR, `Budgeten får vara högst ${MONTHLY_BUDGET_MAX_KR} kr.`).optional(),
  aiSharePercent: z.number().int().min(0, "Andelen kan inte vara negativ.").max(AI_SHARE_MAX_PERCENT, `Andelen får vara högst ${AI_SHARE_MAX_PERCENT} %.`).optional(),
  weeklyQuotaMinKr: z.number().int().min(0, "Kvoten kan inte vara negativ.").max(WEEKLY_QUOTA_LIMIT_KR, `Kvoten får vara högst ${WEEKLY_QUOTA_LIMIT_KR} kr.`).optional(),
  weeklyQuotaMaxKr: z.number().int().min(0, "Kvoten kan inte vara negativ.").max(WEEKLY_QUOTA_LIMIT_KR, `Kvoten får vara högst ${WEEKLY_QUOTA_LIMIT_KR} kr.`).optional(),
  /** Sent by a page opened before 2026-11-21 (the margin); accepted and never used. */
  marginPercent: z.number().optional(),
}).strict();

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    if (ctx.user.role !== "SUPERADMIN") throw new ApiError(403, "Bara installationens administratör kan göra det.");
    const input = inputSchema.parse(await body(request));
    const before = await readAiCreditSettings();
    const usdSek = Math.round((input.usdSek ?? before.usdSek) * 100) / 100;
    // The rate's date moves only when the rate changes, so the runs say from when it applied. Cloud keeps Azure whatever is sent.
    const settings = aiCreditSettingsSchema.parse({
      chatMinimumCredits: input.chatMinimumCredits ?? before.chatMinimumCredits,
      documentMinimumCredits: input.documentMinimumCredits ?? before.documentMinimumCredits,
      usdSek, usdSekSetOn: usdSek === before.usdSek ? before.usdSekSetOn : swedishDayKey(new Date()),
      provider: standardProviderOf(input.provider ?? before.provider, publicInstance().community),
      markupPercent: input.markupPercent ?? before.markupPercent,
      monthlyBudgetKr: input.monthlyBudgetKr ?? before.monthlyBudgetKr,
      aiSharePercent: input.aiSharePercent ?? before.aiSharePercent,
      weeklyQuotaMinKr: input.weeklyQuotaMinKr ?? before.weeklyQuotaMinKr,
      weeklyQuotaMaxKr: input.weeklyQuotaMaxKr ?? before.weeklyQuotaMaxKr,
    });
    if (settings.weeklyQuotaMaxKr < settings.weeklyQuotaMinKr) throw new ApiError(400, "Högsta veckokvoten kan inte vara lägre än den lägsta.");
    const providerName = AI_PROVIDERS.find((item) => item.id === settings.provider)?.name ?? settings.provider;
    await prisma.$transaction(async (tx) => {
      await tx.systemSettings.upsert({ where: { id: "global" }, create: { id: "global", ai: settings }, update: { ai: settings } });
      await tx.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "ai_credit_settings_updated", detail: `AI-inställningar: leverantör för Standard ${providerName}, ${settings.usdSek.toFixed(2).replace(".", ",")} kr/USD, lägsta uttag chatt ${settings.chatMinimumCredits}, dokument och granskning ${settings.documentMinimumCredits}, påslag ${settings.markupPercent} %${settings.markupPercent !== before.markupPercent ? ` (förut ${before.markupPercent} %)` : ""}, månadsbudget ${settings.monthlyBudgetKr} kr, andel av abonnemanget till AI ${settings.aiSharePercent} %, veckokvot ${settings.weeklyQuotaMinKr}–${settings.weeklyQuotaMaxKr} kr.` } });
    });
    return NextResponse.json(view(settings, await aiCreditValueOre()));
  } catch (error) {
    return failure(error);
  }
}
