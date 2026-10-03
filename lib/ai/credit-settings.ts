import { z } from "zod";
import type { AiTaskKind } from "@/lib/ai/model-catalog";

/**
 * Lägsta kredituttag per AI-svar (2026-10-01: "en banal fråga kostar 5 krediter, sådant skapar irritation").
 * The price of an AI run is the provider's token cost at the exchange rate, with the target gross margin, divided by
 * the credit's floor value and rounded up – and never below a minimum. The minimum, the exchange rate and the AI
 * provider are settings the product owner changes in the app (2026-10-02: "valutakurs och leverantör som valbara
 * inställningar"). Every run stores what it was priced with, so a change never touches earlier runs.
 */

/** The AI providers Workflow can use. Only OpenAI for now; another is one more adapter and one more entry here. */
export const AI_PROVIDERS = [{ id: "OPENAI", name: "OpenAI" }] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number]["id"];

/** The exchange rate's limits in kr per USD: wide enough for any real rate, narrow enough to catch a typo. */
export const USD_SEK_MIN = 5;
export const USD_SEK_MAX = 30;
/** Where the rate in a run came from; a rate the product owner set has no expiry (the ledger's age limit is for other sources). */
export const SETTING_FX_SOURCE = "PRODUCT_OWNER_SETTING";
const DEFAULT_RATE_SET_ON = "2026-10-01";

export const aiCreditSettingsSchema = z.object({
  chatMinimumCredits: z.number().int().min(1).max(50).catch(5).default(5),
  documentMinimumCredits: z.number().int().min(1).max(50).catch(5).default(5),
  /** Kr per USD, two decimals. */
  usdSek: z.number().min(USD_SEK_MIN).max(USD_SEK_MAX).transform((value) => Math.round(value * 100) / 100).catch(12).default(12),
  /** The day the rate was last set (YYYY-MM-DD); the runs record it. */
  usdSekSetOn: z.iso.date().catch(DEFAULT_RATE_SET_ON).default(DEFAULT_RATE_SET_ON),
  provider: z.enum(AI_PROVIDERS.map((item) => item.id) as [AiProviderId, ...AiProviderId[]]).catch("OPENAI").default("OPENAI"),
});
export type AiCreditSettings = z.infer<typeof aiCreditSettingsSchema>;
export const DEFAULT_AI_CREDIT_SETTINGS: AiCreditSettings = { chatMinimumCredits: 5, documentMinimumCredits: 5, usdSek: 12, usdSekSetOn: DEFAULT_RATE_SET_ON, provider: "OPENAI" };

export function parseAiCreditSettings(value: unknown): AiCreditSettings {
  const parsed = aiCreditSettingsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : DEFAULT_AI_CREDIT_SETTINGS;
}

/** The minimum for a kind of run: chat, search and writing, or document analysis and reviews. */
export function minimumCreditsFor(taskKind: AiTaskKind, settings: Pick<AiCreditSettings, "chatMinimumCredits" | "documentMinimumCredits">) {
  return taskKind === "SIMPLE_CHAT" || taskKind === "WORKFLOW_SEARCH" || taskKind === "WRITING" ? settings.chatMinimumCredits : settings.documentMinimumCredits;
}

/** The exchange rate as a run records it. */
export function fxSnapshot(settings: Pick<AiCreditSettings, "usdSek" | "usdSekSetOn">) {
  return {
    usdSekRateMicros: Math.round(settings.usdSek * 1_000_000),
    source: SETTING_FX_SOURCE,
    effectiveDate: new Date(`${settings.usdSekSetOn}T00:00:00.000Z`),
    version: `setting-${settings.usdSekSetOn}-${settings.usdSek.toFixed(2)}`,
  };
}
export type FxSnapshot = ReturnType<typeof fxSnapshot>;
