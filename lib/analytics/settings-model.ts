import { DEFAULT_RETENTION_MONTHS, RETENTION_CHOICES } from "./catalog";

/**
 * Beteendeanalys' switches (2026-10-07), kept in SystemSettings.analytics. Nothing chosen yet means the
 * installation's own defaults: Workflow's installation counts from the start (the funnel waits for the product owner); an installation without ee/
 * (the community edition) counts nothing until its administrator turns it on.
 */
export type AnalyticsSettings = {
  /** Count page views and functions in the app (anonymous, no consent needed). */
  usage: boolean;
  /** Measure the public pages' funnel (only for visitors who allow statistics). Needs ee/. */
  funnel: boolean;
  /** How many months the counters are kept. */
  retentionMonths: number;
};

export type AnalyticsDefaults = { usage: boolean; funnel: boolean };

export function resolveAnalyticsSettings(stored: unknown, defaults: AnalyticsDefaults): AnalyticsSettings {
  const value = stored && typeof stored === "object" && !Array.isArray(stored) ? stored as Record<string, unknown> : {};
  const months = Number(value.retentionMonths);
  return {
    usage: typeof value.usage === "boolean" ? value.usage : defaults.usage,
    // The funnel can never be on without the part that measures it, whatever was stored, and it starts off: it sets a
    // statistics cookie, so the product owner turns it on once the privacy policy describing it is published (2026-10-07).
    funnel: defaults.funnel && value.funnel === true,
    retentionMonths: (RETENTION_CHOICES as readonly number[]).includes(months) ? months : DEFAULT_RETENTION_MONTHS,
  };
}

/** The cut-off day (YYYY-MM-DD, Swedish): counters from before it are removed. */
export function retentionCutoffDay(today: string, months: number) {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1 - months;
  const day = Number(today.slice(8, 10));
  const target = new Date(Date.UTC(year, month, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString().slice(0, 10);
}
