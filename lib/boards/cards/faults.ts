import { z } from "zod";
import { SEVERITY_LABELS } from "@/lib/operator/rules";
import { formatSwedish } from "@/lib/swedish-time";
import { periodRange, type Period } from "../period";
import type { StateTone, SummaryShape } from "./shapes";

/**
 * Felanmälningskortet (2026-11-19): the fault reports from the operator terminal – how many came in during the period, how
 * many are still open (waiting for approval, or with their maintenance job not yet done) and the open ones as a short list. Never
 * the reporter's name. The server reads with Underhåll's read right, as the machine tree's own count does. Pure.
 */
export const FAULT_PERIODS = ["today", "week", "30d", "month"] as const satisfies readonly Period[];
/** The count of new reports, named short so it fits a small card. */
export const FAULT_NEW_LABEL: Record<(typeof FAULT_PERIODS)[number], string> = { today: "Nya i dag", week: "Nya i veckan", "30d": "Nya på 30 dagar", month: "Nya i månaden" };
export const faultsSourceSchema = z.object({ type: z.literal("faults"), period: z.enum(FAULT_PERIODS).optional() });
export type FaultsSource = z.infer<typeof faultsSourceSchema>;

export type FaultRow = { at: Date | string; machine: string; cause: string; severity: string; status: string; open: boolean; workOrder: string };
const TONE: Record<string, StateTone> = { ACUTE: "danger", HIGH: "danger", NORMAL: "warning", LOW: "info" };

export function faultsShape(rows: readonly FaultRow[], period: (typeof FAULT_PERIODS)[number], now: Date): SummaryShape {
  const range = periodRange(period, now);
  const fresh = rows.filter((row) => { const time = new Date(row.at).getTime(); return time >= range.from.getTime() && time < range.to.getTime(); });
  const open = rows.filter((row) => row.open).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const pending = open.filter((row) => row.status === "pending");
  return {
    kind: "summary",
    counts: [
      { label: FAULT_NEW_LABEL[period], value: fresh.length, tone: "info" },
      { label: "Öppna", value: open.length, tone: open.length ? "warning" : "neutral" },
      { label: "Att godkänna", value: pending.length, tone: pending.length ? "warning" : "neutral" },
    ],
    items: open.slice(0, 50).map((row) => ({
      title: [row.machine, row.cause].filter(Boolean).join(": "),
      detail: [formatSwedish(row.at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }), SEVERITY_LABELS[row.severity as keyof typeof SEVERITY_LABELS] ?? "", row.status === "pending" ? "Väntar på godkännande" : row.workOrder].filter(Boolean).join(" · "),
      tone: TONE[row.severity] ?? "neutral",
    })),
    total: open.length,
  };
}
