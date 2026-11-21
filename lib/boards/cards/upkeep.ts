import { z } from "zod";
import { PLAN_STATE_LABELS, type PlanOccurrenceState } from "@/lib/maintenance/plan-model";
import { addSwedishDays, formatSwedish, swedishDayKey } from "@/lib/swedish-time";
import type { SummaryShape } from "./shapes";

/**
 * Underhållskortet (2026-11-19): the maintenance plans' jobs that are overdue and those coming within the chosen time, with
 * counts and a short list, read as Planering's calendar reads them (lib/maintenance/plan-server.ts planningMaintenance: Underhåll or
 * work orders to read). Pure.
 */
export const UPKEEP_HORIZONS = ["week", "30d", "month"] as const;
export type UpkeepHorizon = (typeof UPKEEP_HORIZONS)[number];
export const UPKEEP_HORIZON_LABEL: Record<UpkeepHorizon, string> = { week: "Kommande 7 dagar", "30d": "Kommande 30 dagar", month: "Kommande 3 månader" };
const HORIZON_DAYS: Record<UpkeepHorizon, number> = { week: 7, "30d": 30, month: 91 };
export const upkeepSourceSchema = z.object({ type: z.literal("upkeep"), horizon: z.enum(UPKEEP_HORIZONS).optional() });
export type UpkeepSource = z.infer<typeof upkeepSourceSchema>;

/** The days the card asks for: 300 days back (what is still overdue) and the chosen time ahead, within the calendar's 400 days. */
export function upkeepWindow(horizon: UpkeepHorizon, now: Date) {
  return { from: swedishDayKey(addSwedishDays(now, -300)), today: swedishDayKey(now), until: swedishDayKey(addSwedishDays(now, HORIZON_DAYS[horizon])) };
}

export type UpkeepRow = { title: string; partName: string; date: string; state: PlanOccurrenceState };
const dayText = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) ? formatSwedish(`${day}T12:00:00`, { day: "numeric", month: "short" }) : day;

export function upkeepShape(rows: readonly UpkeepRow[], horizon: UpkeepHorizon, now: Date): SummaryShape {
  const { today, until } = upkeepWindow(horizon, now);
  const late = rows.filter((row) => row.state === "late").sort((a, b) => a.date.localeCompare(b.date));
  const coming = rows.filter((row) => (row.state === "due" || row.state === "dormant") && row.date >= today && row.date < until).sort((a, b) => a.date.localeCompare(b.date));
  const started = rows.filter((row) => row.state === "started");
  const line = (row: UpkeepRow, tone: SummaryShape["items"][number]["tone"]) => ({ title: row.title, detail: [row.partName, dayText(row.date), PLAN_STATE_LABELS[row.state]].filter(Boolean).join(" · "), tone });
  const items = [...late.map((row) => line(row, "danger")), ...started.map((row) => line(row, "warning")), ...coming.map((row) => line(row, "info"))];
  return {
    kind: "summary",
    counts: [
      { label: "Förfallna", value: late.length, tone: late.length ? "danger" : "neutral" },
      { label: "Pågår", value: started.length, tone: started.length ? "warning" : "neutral" },
      { label: "Kommande", value: coming.length, tone: "info" },
    ],
    items: items.slice(0, 50), total: items.length,
  };
}
