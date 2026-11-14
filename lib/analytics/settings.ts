import { EE_PRESENT } from "@ee/present";
import { prisma } from "@/lib/db";
import { resolveAnalyticsSettings, type AnalyticsDefaults, type AnalyticsSettings } from "./settings-model";

/** Workflow's installation counts from the start; the community edition waits for its administrator (2026-10-07). */
export const ANALYTICS_DEFAULTS: AnalyticsDefaults = { usage: EE_PRESENT, funnel: EE_PRESENT };

let cached: { at: number; value: AnalyticsSettings } | null = null;
const TTL_MS = 15_000;

/** The switches, read at most every 15 seconds; a database that cannot answer reads as the defaults. Never throws. */
export async function getAnalyticsSettings(): Promise<AnalyticsSettings> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  let value: AnalyticsSettings;
  try {
    const row = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { analytics: true } });
    value = resolveAnalyticsSettings(row?.analytics, ANALYTICS_DEFAULTS);
  } catch {
    value = resolveAnalyticsSettings(null, ANALYTICS_DEFAULTS);
  }
  cached = { at: Date.now(), value };
  return value;
}

export async function saveAnalyticsSettings(patch: Partial<AnalyticsSettings>): Promise<AnalyticsSettings> {
  const row = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { analytics: true } });
  const current = resolveAnalyticsSettings(row?.analytics, ANALYTICS_DEFAULTS);
  const next = resolveAnalyticsSettings({ ...current, ...patch }, ANALYTICS_DEFAULTS);
  await prisma.systemSettings.upsert({ where: { id: "global" }, update: { analytics: next }, create: { id: "global", analytics: next } });
  cached = null;
  return next;
}
