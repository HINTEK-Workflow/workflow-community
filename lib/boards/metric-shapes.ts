import { DEVIATION_TYPES, deviationType } from "@/lib/self-inspection/incidents";
import { PART_STATUS_LABELS, partStatusOf } from "@/lib/maintenance/model";
import type { MetricKey } from "./metrics";
import { PREVIOUS_PERIOD_LABEL, type Period } from "./period";
import type { NumberShape, SeriesShape, StatusShape, TableShape } from "./shapes";

/**
 * The finished shapes of the measures that count the same way on the server (lib/boards/metrics-server.ts) and in the public demo
 * (features/demo/demo-boards.ts), so a demo card reads exactly like a real one. Pure.
 */
/** A figure for the period and the same figure for the period before, which the card may show as a change. */
export const withPrevious = (period: Period, value: number, previous: number): NumberShape => ({ kind: "number", value, previous, note: PREVIOUS_PERIOD_LABEL[period] });

/**
 * Which way is good for a measure (Trend, 2026-11-19): the change and the curve are green when they go that way and red the
 * other; a measure left out is neutral, where more or less is not good or bad in itself (hours, open work orders, quotes out).
 */
export const METRIC_BETTER: Partial<Record<MetricKey, "up" | "down">> = {
  tasks_completed_week: "up", quotes_accepted: "up", invoiced_amount: "up", customers_new: "up",
  tasks_overdue: "down", deviations_open: "down", deviations_new: "down", rounds_missed: "down", invoices_overdue: "down", faults_open: "down",
};

/** Arbetsordrar per status: planned and ongoing now, done during the period. */
export function workOrderSeries(states: readonly string[]): SeriesShape {
  const count = (state: string) => states.filter((item) => item === state).length;
  return { kind: "series", labels: ["Planerade", "Pågår", "Klara"], series: [{ name: "Arbetsordrar", values: [count("planned"), count("active"), count("done")] }] };
}

/** Avvikelser per typ, in the order of the deviation types. */
export function deviationSeries(types: readonly (string | null | undefined)[]): SeriesShape {
  const keys = Object.keys(DEVIATION_TYPES) as (keyof typeof DEVIATION_TYPES)[];
  return { kind: "series", labels: keys.map((key) => DEVIATION_TYPES[key]), series: [{ name: "Avvikelser", values: keys.map((key) => types.filter((type) => deviationType(type ?? "") === key).length) }] };
}

/** Maskinstatus: a lamp per machine from its own status and its open fault reports (a stop not yet restored is red). */
export function machineStatusShape(parts: readonly { id: string; name: string; status: string }[], faults: readonly { partId: string; stoppedAt: Date | string | null; restoredAt: Date | string | null }[]): StatusShape {
  return {
    kind: "status",
    items: parts.map((part) => {
      const open = faults.filter((item) => item.partId === part.id);
      const stopped = open.some((item) => item.stoppedAt && !item.restoredAt);
      const status = partStatusOf(part.status);
      const state = status === "OUT_OF_SERVICE" || stopped ? "error" : status === "SERVICE_SOON" || open.length ? "warning" : "ok";
      return { name: part.name, state, text: open.length ? `${PART_STATUS_LABELS[status]} · ${open.length} ${open.length === 1 ? "felanmälan" : "felanmälningar"}` : PART_STATUS_LABELS[status] };
    }),
  };
}

/** Reservdelar under miniminivå, the lowest share first. */
export function storeBelowMinShape(items: readonly { name: string; min: number; have: number }[]): TableShape {
  const low = items.filter((item) => item.have < item.min).sort((a, b) => a.have / (a.min || 1) - b.have / (b.min || 1));
  return {
    kind: "table",
    columns: [{ key: "name", label: "Artikel", type: "text" }, { key: "have", label: "Saldo", type: "number" }, { key: "min", label: "Miniminivå", type: "number" }],
    rows: low.slice(0, 100).map((item) => ({ name: item.name, have: item.have, min: item.min })), total: low.length,
  };
}

/** An invoice's amount without VAT from its frozen content (a credit is negative). */
export function invoiceNet(content: unknown): number {
  const net = (content as { net?: unknown } | null)?.net;
  return typeof net === "number" && Number.isFinite(net) ? net : 0;
}
