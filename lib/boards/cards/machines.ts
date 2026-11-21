import { z } from "zod";
import { addSwedishDays, formatSwedish, swedishDayKey } from "@/lib/swedish-time";
import { MACHINE_EVENT_TYPE_LABELS, MACHINE_STATE_LABELS } from "@/lib/machine/place-status";
import { periodRange } from "../period";
import type { EventLevel, EventsShape, SeriesShape } from "../shapes";
import type { MachineState, MachinesShape } from "./shapes";

/**
 * Maskinkorten (2026-11-19, Kopplingar → Maskiner): what the company's machine connection already has – the state now, the
 * latest alarms and events, a measured value over time and an overview of several machines. Only received data is shown: a value
 * is drawn where an event carried it, a day's stops and alarms come from the machine's day summaries, nothing is filled in. The
 * server reads with Underhåll's read right, as the machine's own page does (lib/maintenance/machine-server.ts). Pure.
 */
const id = z.string().trim().min(1).max(60);
export const machineSourceSchema = z.object({ type: z.literal("machine"), partId: id.optional() });
export const machineEventsSourceSchema = z.object({ type: z.literal("machine_events"), partId: id.optional(), alarmsOnly: z.boolean().optional() });
export const SIGNAL_MEASURES = ["signal", "alarms", "stops", "stopped_minutes"] as const;
export type SignalMeasure = (typeof SIGNAL_MEASURES)[number];
export const SIGNAL_MEASURE_LABEL: Record<SignalMeasure, string> = { signal: "Ett mätvärde", alarms: "Larm per dag", stops: "Stopp per dag", stopped_minutes: "Stopptid per dag (minuter)" };
export const SIGNAL_PERIODS = ["today", "week", "30d"] as const;
export type SignalPeriod = (typeof SIGNAL_PERIODS)[number];
export const machineSignalSourceSchema = z.object({
  type: z.literal("machine_signal"),
  measure: z.enum(SIGNAL_MEASURES).optional(),
  signalId: id.optional(),
  partId: id.optional(),
  period: z.enum(SIGNAL_PERIODS).optional(),
});
export const MACHINES_MAX = 24;
export const machinesSourceSchema = z.object({ type: z.literal("machines"), partIds: z.array(id).max(MACHINES_MAX).optional() });
export type MachineSource = z.infer<typeof machineSourceSchema>;
export type MachineEventsSource = z.infer<typeof machineEventsSourceSchema>;
export type MachineSignalSource = z.infer<typeof machineSignalSourceSchema>;
export type MachinesSource = z.infer<typeof machinesSourceSchema>;

/** The machine page's status row (lib/machine/place-status.ts) as a lamp; without a connection the part's own status is all there is. */
export function machineStateOf(status: { tone: string; label: string; stateAt: string | null } | null, partStatusLabel: string, outOfService: boolean): { state: MachineState; label: string; at: string | null } {
  if (!status) return outOfService ? { state: "stopped", label: partStatusLabel, at: null } : { state: "unknown", label: "Ingen maskinkoppling", at: null };
  const state: MachineState = status.tone === "danger" ? "alarm" : status.tone === "warning" ? "stopped" : status.tone === "success" ? "running" : "unknown";
  return { state, label: status.label, at: status.stateAt };
}

export const machinesShape = (items: MachinesShape["items"]): MachinesShape => ({ kind: "machines", items, total: items.length });

const LEVEL: Record<string, EventLevel> = { critical: "error", fault: "error", warning: "warning", info: "info" };
export type MachineEventRow = { occurredAt: Date | string; type: string; code: string; severity: string; state: string | null; text: string; machine: string };
/** The latest alarms and events, newest first: the machine's text, the machine and what kind of event it was. */
export function machineEventsShape(rows: readonly MachineEventRow[], alarmsOnly = false): EventsShape {
  return {
    kind: "events",
    items: rows.filter((row) => !alarmsOnly || row.type === "alarm").slice(0, 50).map((row) => ({
      at: new Date(row.occurredAt).toISOString(),
      title: row.text.trim() || `${MACHINE_EVENT_TYPE_LABELS[row.type] ?? row.type} ${row.code}`,
      level: row.state === "cleared" ? "info" : LEVEL[row.severity] ?? "info",
      detail: [row.machine, `${MACHINE_EVENT_TYPE_LABELS[row.type] ?? row.type} ${row.code}`, row.state ? MACHINE_STATE_LABELS[row.state] ?? row.state : ""].filter(Boolean).join(" · "),
    })),
  };
}

/** The buckets of a period: the hours of today, or the days of the week or the last 30 days. */
export function signalBuckets(period: SignalPeriod, now: Date) {
  const range = periodRange(period, now);
  if (period === "today") return Array.from({ length: 24 }, (_, hour) => ({ from: new Date(range.from.getTime() + hour * 3_600_000), to: new Date(range.from.getTime() + (hour + 1) * 3_600_000), label: `${String(hour).padStart(2, "0")}`, day: swedishDayKey(range.from) }));
  const days = period === "week" ? 7 : 30;
  return Array.from({ length: days }, (_, index) => {
    const from = addSwedishDays(range.from, index);
    return { from, to: addSwedishDays(from, 1), day: swedishDayKey(from), label: period === "week" ? formatSwedish(from, { weekday: "short" }) : formatSwedish(from, { day: "numeric", month: "numeric" }) };
  });
}

/** A measured value over the period: the mean of what was received in each hour or day; an empty hour or day stays empty. */
export function signalSeries(points: readonly { at: Date | string; value: number }[], period: SignalPeriod, now: Date, name: string, unit?: string): SeriesShape {
  const buckets = signalBuckets(period, now);
  const values = buckets.map((bucket) => {
    const inside = points.filter((point) => { const time = new Date(point.at).getTime(); return time >= bucket.from.getTime() && time < bucket.to.getTime(); });
    return inside.length ? Math.round((inside.reduce((sum, point) => sum + point.value, 0) / inside.length) * 100) / 100 : null;
  });
  return { kind: "series", labels: buckets.map((bucket) => bucket.label), series: [{ name, values }], ...(unit ? { unit } : {}) };
}

/** Alarms, stops or minutes stopped per day from the machines' day summaries (today: the one day). */
export function daySummarySeries(rows: readonly { day: string; alarms: number; stops: number; stoppedMinutes: number }[], measure: Exclude<SignalMeasure, "signal">, period: SignalPeriod, now: Date): SeriesShape {
  const field = measure === "alarms" ? "alarms" : measure === "stops" ? "stops" : "stoppedMinutes";
  const buckets = period === "today" ? [{ day: swedishDayKey(now), label: "I dag" }] : signalBuckets(period, now);
  return {
    kind: "series", labels: buckets.map((bucket) => bucket.label),
    series: [{ name: SIGNAL_MEASURE_LABEL[measure], values: buckets.map((bucket) => rows.filter((row) => row.day === bucket.day).reduce((sum, row) => sum + row[field], 0)) }],
    ...(measure === "stopped_minutes" ? { unit: "min" } : {}),
  };
}

/** A value an event carried for the signal, when it is a number. */
export function signalValueOf(values: unknown, key: string): number | null {
  const value = values && typeof values === "object" ? (values as Record<string, unknown>)[key] : undefined;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
