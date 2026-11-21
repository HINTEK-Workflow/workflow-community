import { z } from "zod";

/**
 * Företagets mål (2026-10-28: "Företagets egna mål ska ersätta hårdkodade mål", "Företaget ska kunna ange egna
 * ekonomiska mål"): one JSON column on WorkspaceSettings (`goalSettings`). Every goal is optional – null means the company
 * has set none, and the statistics then draw no target line and say "Inget mål satt". The statistics read the work-order
 * goal; the economy goals are kept here so Ekonomi reads the same setting later. Only the company's admin changes them.
 */
export const companyGoalsSchema = z.object({
  /** Färdigställda arbetsordrar per månad (the whole company). */
  completedWorkOrdersPerMonth: z.number().int("Skriv ett heltal.").min(1, "Målet är minst 1.").max(100_000, "Målet är för stort.").nullable().default(null),
  /** Fakturerat per månad, kronor exklusive moms (Ekonomi, later). */
  invoicedPerMonth: z.number().int("Skriv beloppet i hela kronor.").min(0, "Beloppet kan inte vara negativt.").max(1_000_000_000, "Beloppet är för stort.").nullable().default(null),
  /** Andel vunna offerter, procent (Ekonomi, later). */
  quoteWinRatePercent: z.number().min(0, "Andelen är 0–100 %.").max(100, "Andelen är 0–100 %.").nullable().default(null),
});
export type CompanyGoals = z.infer<typeof companyGoalsSchema>;
export const NO_COMPANY_GOALS: CompanyGoals = { completedWorkOrdersPerMonth: null, invoicedPerMonth: null, quoteWinRatePercent: null };

/** The goals as stored; anything unreadable is "no goal", field by field (an old or hand-edited row never breaks a page). */
export function companyGoalsOf(value: unknown): CompanyGoals {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const field = <K extends keyof CompanyGoals>(key: K): CompanyGoals[K] => {
    const parsed = companyGoalsSchema.shape[key].safeParse(source[key]);
    return (parsed.success ? parsed.data : null) as CompanyGoals[K];
  };
  return { completedWorkOrdersPerMonth: field("completedWorkOrdersPerMonth"), invoicedPerMonth: field("invoicedPerMonth"), quoteWinRatePercent: field("quoteWinRatePercent") };
}

/** What a reader may see: the economy goals only for those who may see Ekonomi (admins see everything). */
export function visibleCompanyGoals(goals: CompanyGoals, reader: { economy: boolean }): CompanyGoals {
  return reader.economy ? goals : { ...goals, invoicedPerMonth: null, quoteWinRatePercent: null };
}

/** A goal field's text as typed ("" = no goal): a number, null for empty, or undefined when it cannot be read. */
export function parseGoalInput(value: string): number | null | undefined {
  const text = value.replace(/\s/g, "").replace(",", ".").replace(/%$/, "");
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}
