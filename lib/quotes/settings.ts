import { z } from "zod";
import { parseAmount } from "@/lib/workflow/expenses";
import { parsePercent } from "@/lib/workflow/material-prices";

/**
 * Priser och offerter (2026-10-09): the company's own price settings, one JSON column on WorkspaceSettings.
 * - Påslag på material: copied to a material row and a quote's material line when they get their price ("" = none).
 * - Timpris: the default à-pris of a new Arbete line on a quote ("" = none).
 * - Giltighet: how many days a new quote is valid.
 * - Villkor: the company's own terms on its quotes. Workflow writes no terms and copies none from an industry template.
 * - ROT (2026-10-09): the share of the labour cost and the cap that a private customer's quote starts with. The
 *   figures shipped are only editable defaults; the company is responsible for them and changes them here.
 * - Meddelande i e-post (steg E, 2026-10-09): the company's standard text in "Skicka till kund", editable each time ("" = none).
 * Purchase prices and markup are business secrets: only someone who may see prices reads these settings.
 */
export const DEFAULT_QUOTE_VALID_DAYS = 30;
export const QUOTE_TERMS_MAX = 5000;
/** ROT defaults, only a starting point the company edits: share of the labour cost incl. VAT (%) and cap (kr). */
export const DEFAULT_ROT_PERCENT = "30";
export const DEFAULT_ROT_CAP = "50000";

const percentText = z.string().trim().max(20).refine((value) => !value || parsePercent(value) !== null, "Skriv påslaget i procent, till exempel 15.");
const shareText = z.string().trim().max(20).refine((value) => { const parsed = parseAmount(value.replace("%", "")); return !value || (parsed !== null && parsed >= 0 && parsed <= 100); }, "Skriv andelen i procent, mellan 0 och 100.");
const capText = z.string().trim().max(20).refine((value) => { const parsed = parseAmount(value); return !value || (parsed !== null && parsed >= 0 && parsed < 1e9); }, "Skriv taket i kronor, till exempel 50000.");
const priceText = z.string().trim().max(20).refine((value) => { const parsed = parseAmount(value); return !value || (parsed !== null && parsed >= 0); }, "Skriv timpriset i kronor, till exempel 650.");

export const priceSettingsSchema = z.object({
  markupPercent: percentText.default(""),
  hourlyRate: priceText.default(""),
  validDays: z.number().int().min(1, "Giltigheten är minst 1 dag.").max(365, "Giltigheten är högst 365 dagar.").default(DEFAULT_QUOTE_VALID_DAYS),
  terms: z.string().trim().max(QUOTE_TERMS_MAX).default(""),
  rotPercent: shareText.default(DEFAULT_ROT_PERCENT),
  rotCap: capText.default(DEFAULT_ROT_CAP),
  emailMessage: z.string().trim().max(2000).default(""),
});
export type PriceSettings = z.infer<typeof priceSettingsSchema>;

/** The settings as stored; anything unreadable falls back to its default, field by field. */
export function priceSettingsOf(value: unknown): PriceSettings {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const field = <K extends keyof PriceSettings>(key: K): PriceSettings[K] => {
    const parsed = priceSettingsSchema.shape[key].safeParse(source[key]);
    return (parsed.success ? parsed.data : priceSettingsSchema.shape[key].parse(undefined)) as PriceSettings[K];
  };
  return { markupPercent: field("markupPercent"), hourlyRate: field("hourlyRate"), validDays: field("validDays"), terms: field("terms"), rotPercent: field("rotPercent"), rotCap: field("rotCap"), emailMessage: field("emailMessage") };
}

/** ÅÅÅÅ-MM-DD `days` after `today` (also ÅÅÅÅ-MM-DD), in the calendar, without time zones. */
export function addDays(today: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return date.toISOString().slice(0, 10);
}
