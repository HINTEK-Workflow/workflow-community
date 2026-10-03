import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure } from "@/lib/kfid/server";
import { swedishDayKey } from "@/lib/swedish-time";
import { AI_PROVIDERS, USD_SEK_MAX, USD_SEK_MIN, aiCreditSettingsSchema, fxSnapshot, type AiCreditSettings } from "@/lib/ai/credit-settings";
import { readAiCreditSettings } from "@/lib/ai/credit-settings-server";
import { calculateAiUsageCost } from "@/lib/ai/cost-policy";
import { routeAiModel } from "@/lib/ai/model-catalog";

export const dynamic = "force-dynamic";

/** What a typical answer really costs with these settings, so the product owner sees what a change does (no provider call). */
function examples(settings: AiCreditSettings) {
  const { usdSekRateMicros } = fxSnapshot(settings);
  const run = (taskKind: "SIMPLE_CHAT" | "DOCUMENT_ANALYSIS", inputTokens: number, outputTokens: number, minimumCredits: number) => {
    const policy = routeAiModel(taskKind);
    const cost = calculateAiUsageCost({ inputTokens, cachedInputTokens: 0, outputTokens }, { ...policy, minimumCredits, usdSekRateMicros });
    const formula = calculateAiUsageCost({ inputTokens, cachedInputTokens: 0, outputTokens }, { ...policy, minimumCredits: 1, usdSekRateMicros });
    return { model: policy.model, inputTokens, outputTokens, providerCostOre: cost.providerCostOre, formulaCredits: formula.chargedCredits, chargedCredits: cost.chargedCredits };
  };
  return [
    { label: "Kort chattfråga", ...run("SIMPLE_CHAT", 600, 80, settings.chatMinimumCredits) },
    { label: "Chattfråga med uppgifter och projekt", ...run("SIMPLE_CHAT", 3_000, 400, settings.chatMinimumCredits) },
    { label: "Analys av en importfil", ...run("DOCUMENT_ANALYSIS", 4_000, 800, settings.documentMinimumCredits) },
  ];
}

const view = (settings: AiCreditSettings) => {
  const policy = routeAiModel("SIMPLE_CHAT");
  return {
    settings,
    providers: AI_PROVIDERS,
    limits: { usdSekMin: USD_SEK_MIN, usdSekMax: USD_SEK_MAX },
    formula: { targetGrossMarginPercent: policy.targetGrossMarginBps / 100, creditFloorValueOre: policy.creditFloorValueOre, usdSek: settings.usdSek },
    examples: examples(settings),
  };
};

/**
 * Kostnad per AI-svar (2026-10-01 and 2026-10-02): HINTEK's superadmin reads the price formula and sets the
 * minimum for chat answers and for document analysis, the exchange rate and the AI provider. Each run stores what it
 * was priced with.
 */
export async function GET() {
  try {
    const ctx = await context();
    if (ctx.user.role !== "SUPERADMIN") throw new ApiError(403, "Systemadministratör krävs.");
    return NextResponse.json(view(await readAiCreditSettings()));
  } catch (error) {
    return failure(error);
  }
}

const inputSchema = z.object({
  chatMinimumCredits: z.number().int().min(1).max(50),
  documentMinimumCredits: z.number().int().min(1).max(50),
  usdSek: z.number().min(USD_SEK_MIN, `Valutakursen måste vara minst ${USD_SEK_MIN} kr per USD.`).max(USD_SEK_MAX, `Valutakursen får vara högst ${USD_SEK_MAX} kr per USD.`),
  provider: z.enum(AI_PROVIDERS.map((item) => item.id) as [string, ...string[]]),
}).strict();

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    if (ctx.user.role !== "SUPERADMIN") throw new ApiError(403, "Systemadministratör krävs.");
    const input = inputSchema.parse(await body(request));
    const before = await readAiCreditSettings();
    const usdSek = Math.round(input.usdSek * 100) / 100;
    // The rate's date moves only when the rate changes, so the runs say from when it applied.
    const settings = aiCreditSettingsSchema.parse({ ...input, usdSek, usdSekSetOn: usdSek === before.usdSek ? before.usdSekSetOn : swedishDayKey(new Date()) });
    const providerName = AI_PROVIDERS.find((item) => item.id === settings.provider)?.name ?? settings.provider;
    await prisma.$transaction(async (tx) => {
      await tx.systemSettings.upsert({ where: { id: "global" }, create: { id: "global", ai: settings }, update: { ai: settings } });
      await tx.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "ai_credit_settings_updated", detail: `AI-inställningar: leverantör ${providerName}, ${settings.usdSek.toFixed(2).replace(".", ",")} kr/USD, lägsta uttag chatt ${settings.chatMinimumCredits}, dokument och granskning ${settings.documentMinimumCredits}.` } });
    });
    return NextResponse.json(view(settings));
  } catch (error) {
    return failure(error);
  }
}
