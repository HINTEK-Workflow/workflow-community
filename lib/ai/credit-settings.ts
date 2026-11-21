import { z } from "zod";
import type { AiTaskKind } from "@/lib/ai/model-catalog";

/**
 * Lägsta kredituttag per AI-svar (2026-10-01: "en banal fråga kostar 5 krediter, sådant skapar irritation").
 * The price of an AI run is the provider's token cost at the exchange rate, plus the markup (påslaget), divided by
 * the credit's floor value and rounded up – and never below a minimum. The minimum, the exchange rate and the AI
 * provider are settings the product owner changes in the app (2026-10-02: "valutakurs och leverantör som valbara
 * inställningar"). Every run stores what it was priced with, so a change never touches earlier runs.
 */

/**
 * Leverantör för Standard (2026-11-21, F7): the providers the Standard profile can run on. In Cloud it is always Azure and
 * not choosable (standardProviderOf in lib/ai/azure-settings.ts); in Community OpenAI is the default and Azure can be chosen.
 */
export const AI_PROVIDERS = [{ id: "OPENAI", name: "OpenAI" }, { id: "AZURE_OPENAI", name: "Microsoft Azure" }] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number]["id"];
/** How a run's provider is named in the statistics. */
export const AI_PROVIDER_LABEL: Record<string, string> = { OPENAI: "OpenAI", AZURE_OPENAI: "Microsoft Azure" };

/** The exchange rate's limits in kr per USD: wide enough for any real rate, narrow enough to catch a typo. */
export const USD_SEK_MIN = 5;
export const USD_SEK_MAX = 30;
/** Where the rate in a run came from; a rate the product owner set has no expiry (the ledger's age limit is for other sources). */
export const SETTING_FX_SOURCE = "PRODUCT_OWNER_SETTING";
const DEFAULT_RATE_SET_ON = "2026-10-01";
/**
 * Påslaget (2026-11-21, F2: "Jag vill att det baseras på ett procentuellt påslag, så kunden inte blir irriterad över att det
 * är löjligt dyrt. Månadskostnaden ska täcka det mesta … krediterna är som ett extra skydd för mig. Det ska kännas som krediterna
 * räcker långt."): a credit charge is the provider's actual cost of the call plus a markup in percent of that cost – 100 % from the
 * start, so the customer pays twice the cost – turned into whole credits, rounded up. 0 % is cost price; 400 % is the most.
 */
export const AI_MARKUP_MIN = 0;
export const AI_MARKUP_MAX = 400;
export const DEFAULT_MARKUP_PERCENT = 100;
/** The lowest charge per answer: one credit from the start, so a short question costs little (no high fixed minimum, F2). */
export const DEFAULT_MINIMUM_CREDITS = 1;
/**
 * Vad krediterna gäller (2026-11-21: "Vanliga frågor i Workflow-chatten ska ju kunna rymmas i månadskostnaden. Väljer kunden
 * att slå på agentläge kostar det extra krediter."): every Workflow AI use there is today – chat answers, proposals with Använd,
 * Skriv och Granska med AI, import, the daily digest, machine analysis – is included in the subscription and charged no credits; the
 * ledger still records the exact provider cost of every run, up to the company's weekly quota (lib/ai/weekly-quota.ts). Credits (the
 * provider's cost plus the markup) apply to "credits": the coming agentläge, and – when the company's admin chose it – the included
 * use after the week's quota is spent.
 */
export const AI_CHARGE_MODES = ["included", "credits"] as const;
export type AiChargeMode = (typeof AI_CHARGE_MODES)[number];
/** Whether a run in this mode costs credits, in an installation with Workflow's credit system. */
export const creditsChargedIn = (mode: AiChargeMode, creditSystem: boolean) => creditSystem && mode === "credits";
/**
 * Veckokvot (2026-11-21: "det måste finnas … en veckokvot"; "säg att jag bara tar 149 kr i månaden, då måste kvoten vara
 * ganska snål"): the provider's cost per company and week (Monday 00:00 Swedish time) the included Workflow AI may use follows what
 * the company pays – Andel av abonnemanget till AI (10 % from the start) of its monthly price, × 12 / 52 – within a lowest and a
 * highest kr per week. The superadmin may give a company its own quota in kr per week (lib/ai/weekly-quota.ts).
 */
export const DEFAULT_AI_SHARE_PERCENT = 10;
export const AI_SHARE_MAX_PERCENT = 100;
export const DEFAULT_WEEKLY_QUOTA_MIN_KR = 2;
export const DEFAULT_WEEKLY_QUOTA_MAX_KR = 50;
export const WEEKLY_QUOTA_LIMIT_KR = 10_000;
/** Månadsbudget för AI (2026-11-21, F5): alarms at 50, 80 and 100 % of it go to Mottagare av driftlarm. */
export const DEFAULT_MONTHLY_BUDGET_KR = 500;
export const MONTHLY_BUDGET_MAX_KR = 1_000_000;

export const aiCreditSettingsSchema = z.object({
  chatMinimumCredits: z.number().int().min(1).max(50).catch(DEFAULT_MINIMUM_CREDITS).default(DEFAULT_MINIMUM_CREDITS),
  documentMinimumCredits: z.number().int().min(1).max(50).catch(DEFAULT_MINIMUM_CREDITS).default(DEFAULT_MINIMUM_CREDITS),
  /** Kr per USD, two decimals. */
  usdSek: z.number().min(USD_SEK_MIN).max(USD_SEK_MAX).transform((value) => Math.round(value * 100) / 100).catch(12).default(12),
  /** The day the rate was last set (YYYY-MM-DD); the runs record it. */
  usdSekSetOn: z.iso.date().catch(DEFAULT_RATE_SET_ON).default(DEFAULT_RATE_SET_ON),
  /** Leverantör för Standard (Community's choice; Cloud is always Azure, whatever is saved). */
  provider: z.enum(AI_PROVIDERS.map((item) => item.id) as [AiProviderId, ...AiProviderId[]]).catch("OPENAI").default("OPENAI"),
  /** Påslaget in whole percent of the provider's cost; one for every provider and model. An older save's margin is not read. */
  markupPercent: z.number().int().min(AI_MARKUP_MIN).max(AI_MARKUP_MAX).catch(DEFAULT_MARKUP_PERCENT).default(DEFAULT_MARKUP_PERCENT),
  /** Månadsbudget för AI in whole kronor (the provider's cost, from Workflow's own AI log); 0 = no budget alarms. */
  monthlyBudgetKr: z.number().int().min(0).max(MONTHLY_BUDGET_MAX_KR).catch(DEFAULT_MONTHLY_BUDGET_KR).default(DEFAULT_MONTHLY_BUDGET_KR),
  /** Andel av abonnemanget till AI, whole percent of the company's monthly price. */
  aiSharePercent: z.number().int().min(0).max(AI_SHARE_MAX_PERCENT).catch(DEFAULT_AI_SHARE_PERCENT).default(DEFAULT_AI_SHARE_PERCENT),
  /** The weekly quota's lowest and highest value in kr (the lowest also for a company without a price, for example a trial). */
  weeklyQuotaMinKr: z.number().int().min(0).max(WEEKLY_QUOTA_LIMIT_KR).catch(DEFAULT_WEEKLY_QUOTA_MIN_KR).default(DEFAULT_WEEKLY_QUOTA_MIN_KR),
  weeklyQuotaMaxKr: z.number().int().min(0).max(WEEKLY_QUOTA_LIMIT_KR).catch(DEFAULT_WEEKLY_QUOTA_MAX_KR).default(DEFAULT_WEEKLY_QUOTA_MAX_KR),
});
export type AiCreditSettings = z.infer<typeof aiCreditSettingsSchema>;
export const DEFAULT_AI_CREDIT_SETTINGS: AiCreditSettings = {
  chatMinimumCredits: DEFAULT_MINIMUM_CREDITS, documentMinimumCredits: DEFAULT_MINIMUM_CREDITS, usdSek: 12, usdSekSetOn: DEFAULT_RATE_SET_ON, provider: "OPENAI",
  markupPercent: DEFAULT_MARKUP_PERCENT, monthlyBudgetKr: DEFAULT_MONTHLY_BUDGET_KR, aiSharePercent: DEFAULT_AI_SHARE_PERCENT, weeklyQuotaMinKr: DEFAULT_WEEKLY_QUOTA_MIN_KR, weeklyQuotaMaxKr: DEFAULT_WEEKLY_QUOTA_MAX_KR,
};

/**
 * The markup as the price formula and the AI log take it: the gross margin in basis points of the price, since every run stores
 * `targetGrossMarginBps` (no new column). A markup of m % is a margin of m / (100 + m); it is rounded down to whole basis points,
 * so a run is never charged more than the markup says (100 % is exactly 5 000 bps: the customer pays twice the cost). The run keeps
 * the value it was priced with, so the ledger reproduces every charge exactly.
 */
export const markupToMarginBps = (markupPercent: number) => Math.floor((10_000 * markupPercent) / (100 + markupPercent));
export const marginBpsOf = (settings: Pick<AiCreditSettings, "markupPercent">) => markupToMarginBps(settings.markupPercent);
/** The other way, for showing a stored run's margin as a markup (whole percent). */
export const marginBpsToMarkupPercent = (bps: number) => (bps >= 10_000 ? Infinity : Math.round((100 * bps) / (10_000 - bps)));

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
