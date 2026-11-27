import { addSwedishDays, swedishDayKey, swedishMonday } from "@/lib/swedish-time";

/**
 * Veckokvot för Workflow AI (2026-11-21: "Jag vill att det ska finnas en spärr för onormal användning … en veckokvot"; "säg att
 * jag bara tar 149 kr i månaden, då måste kvoten vara ganska snål"). Ordinary Workflow AI is included in the subscription up to a
 * provider cost per company and week (Monday 00:00 Swedish time to the next Monday). The quota follows what the company pays:
 * Andel av abonnemanget till AI of its monthly price, × 12 / 52, within the product owner's lowest and highest kr per week; a
 * company without a price (a trial, Community) gets the lowest. The superadmin may give a company its own quota.
 * At 80 % the company's admin sees a warning; at 100 % the included AI pauses for the company until the week turns – unless the
 * admin chose to continue on credits and the installation has them. Answers from Workflow's own rules never reach the provider and
 * are never stopped. Pure, so the tests read the same rules. Amounts in öre.
 */

export const QUOTA_WARN_PERCENT = 80;
export const QUOTA_FULL_PERCENT = 100;

/** The week a moment belongs to: from Monday 00:00 Swedish time, to the next Monday 00:00. */
export function quotaWeek(now: Date) {
  const start = swedishMonday(now);
  const end = addSwedishDays(start, 7);
  return { start, end, key: swedishDayKey(start) };
}

export type QuotaSettings = { aiSharePercent: number; weeklyQuotaMinKr: number; weeklyQuotaMaxKr: number };

/**
 * The week's quota in öre and where it comes from: the company's own (kr per week), or the share of its monthly price
 * (monthly × share × 12 / 52, rounded down to whole öre) within the lowest and highest. A highest below the lowest counts as the lowest.
 */
export function weeklyQuotaOre(input: { monthlyPriceOre: number | null; ownKr?: number; settings: QuotaSettings }): { quotaOre: number; source: "own" | "price" | "minimum" } {
  if (typeof input.ownKr === "number" && input.ownKr >= 0) return { quotaOre: input.ownKr * 100, source: "own" };
  const min = input.settings.weeklyQuotaMinKr * 100;
  const max = Math.max(min, input.settings.weeklyQuotaMaxKr * 100);
  if (!input.monthlyPriceOre || input.monthlyPriceOre <= 0) return { quotaOre: min, source: "minimum" };
  const share = Math.floor((input.monthlyPriceOre * input.settings.aiSharePercent * 12) / (100 * 52));
  return { quotaOre: Math.min(max, Math.max(min, share)), source: share < min ? "minimum" : "price" };
}

export type QuotaView = {
  /** The week's quota in öre (0 = no quota at all). */
  quotaOre: number;
  source: "own" | "price" | "minimum";
  /** Used this week in öre and in whole percent (may pass 100 when runs on credits continue or a run finished after the limit). */
  spentOre: number;
  usedPercent: number;
  warn: boolean;
  full: boolean;
  /** When the week turns (ISO). */
  opensAt: string;
};

export function quotaView(input: { spentOre: number; quota: { quotaOre: number; source: QuotaView["source"] }; now: Date }): QuotaView {
  const { end } = quotaWeek(input.now);
  const base = { quotaOre: input.quota.quotaOre, source: input.quota.source, spentOre: input.spentOre, opensAt: end.toISOString() };
  if (!(input.quota.quotaOre > 0)) return { ...base, quotaOre: 0, usedPercent: 0, warn: false, full: false };
  const usedPercent = Math.floor((input.spentOre * 100) / input.quota.quotaOre);
  return { ...base, usedPercent, warn: usedPercent >= QUOTA_WARN_PERCENT, full: usedPercent >= QUOTA_FULL_PERCENT };
}

export const QUOTA_FULL_REASON = "Veckans kvot är slut. Workflow AI öppnar igen måndag 00:00.";
export const quotaWarnText = (view: Pick<QuotaView, "usedPercent">) => `Företaget har använt ${Math.min(view.usedPercent, 99)} % av veckans kvot för Workflow AI. När kvoten är slut pausas AI-svaren till måndag 00:00. Chatten svarar ändå på enkla frågor om ert arbete.`;

/**
 * How a company's next Workflow AI run is made: included in the subscription, on credits (the admin's "Fortsätt med krediter när
 * veckans kvot är slut", only where the installation has credits), or not at all until Monday.
 */
export type QuotaDecision = { mode: "included" } | { mode: "credits" } | { mode: "paused"; reason: string };
export function quotaDecision(input: { view: QuotaView; continueOnCredits: boolean; creditSystem: boolean }): QuotaDecision {
  if (!input.view.full) return { mode: "included" };
  if (input.continueOnCredits && input.creditSystem) return { mode: "credits" };
  return { mode: "paused", reason: QUOTA_FULL_REASON };
}

/** The administration-history action that marks the week's alarm, so it is told once per company and week. */
export const quotaAlarmAction = (weekKey: string) => `ai_week_quota:${weekKey}:100`;

const kr = (ore: number) => `${(ore / 100).toFixed(2).replace(".", ",")} kr`;
export const quotaKrText = kr;

export function quotaAlarmText(input: { company: string; quotaOre: number; link: string }) {
  return {
    subject: "Ett företag har använt hela veckans kvot för Workflow AI",
    text: `${input.company} har använt hela veckans kvot för Workflow AI (${kr(input.quotaOre)}). AI-svaren är pausade för företaget till måndag 00:00, om inte företaget har valt att fortsätta med krediter.\nKvoten ändras under Installation → Priser → Kostnad per AI-svar, eller för företaget under Kundföretag:\n${input.link}`,
  };
}
