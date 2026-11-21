import { metricAccess, metricDefinition, metricPeriod, type MetricKey, type MetricViewer } from "@/lib/boards/metrics";
import { METRIC_BETTER } from "@/lib/boards/metric-shapes";
import type { BoardCard, MetricRef } from "@/lib/boards/model";
import type { Period } from "@/lib/boards/period";
import type { CardDataProblem, NumberShape, SeriesShape, Shape } from "@/lib/boards/shapes";
import type { SourceConfig } from "@/lib/boards/cards";
import { calendarShape, calendarWindow } from "@/lib/boards/cards/calendar";
import { faultsShape } from "@/lib/boards/cards/faults";
import { sheetSeries, sheetTable } from "@/lib/boards/cards/file";
import { daySummarySeries, machineEventsShape, machinesShape, machineStateOf, signalBuckets, signalSeries } from "@/lib/boards/cards/machines";
import { isTrendMetric, periodLabel, TREND_COUNT, trendMoments, trendPeriod } from "@/lib/boards/cards/trend";
import { upkeepShape, upkeepWindow } from "@/lib/boards/cards/upkeep";
import { PART_STATUS_LABELS, partStatusOf } from "@/lib/maintenance/model";
import type { MachineStatus } from "@/lib/machine/place-status";
import type { PlanningMaintenance } from "@/lib/maintenance/plan-model";
import type { PartListItem } from "@/lib/maintenance/model";
import { addSwedishDays, swedishDayKey } from "@/lib/swedish-time";
import { workflowSubjectForTask } from "@/lib/workflow/permissions";
import type { DemoBoardsContext } from "./demo-boards";
import { demoMaintenance } from "./demo-maintenance";
import { demoFaultReports } from "./demo-operator";

/**
 * Tavlans nyare kort i demon (2026-11-19): the calendar, the machines, Underhåll, Felanmälan and Trend counted in this browser from
 * the demo's invented data, through the same pure rules as the server (lib/boards/cards). The demo's maintenance answers are asked
 * exactly as its pages ask them. Files cannot be uploaded in the demo: the sheet card has a built-in example, a PDF card says so.
 */
export type DemoSourceResult = { ok: true; data: Shape; label?: string } | { ok: false; reason: CardDataProblem };
export type DemoCount = (key: MetricKey, period: Period, now: Date) => Promise<Shape>;

export const DEMO_SHEET_ID = "demo-fil-exempel";
const DEMO_SHEET = {
  name: "Exempel: produktion per skift.csv",
  headers: ["Skift", "Tillverkat", "Kasserat", "Stopp (min)"],
  rows: [["Mån fm", "412", "6", "18"], ["Mån em", "398", "9", "25"], ["Tis fm", "430", "4", "10"], ["Tis em", "405", "7", "22"], ["Ons fm", "441", "3", "8"], ["Ons em", "389", "11", "35"], ["Tor fm", "425", "5", "12"]],
};

const maintenanceContext = (ctx: DemoBoardsContext) => ({ db: ctx.db, user: ctx.user, admin: ctx.admin, now: ctx.now, can: (subject: "maintenance" | "catalogue" | "quotes" | "work-order", action: "read" | "edit") => ctx.can(subject, action) });
const ask = <T,>(ctx: DemoBoardsContext, query: string): T => demoMaintenance(maintenanceContext(ctx), { method: "GET", url: new URL(`https://demo.invalid/api/maintenance?${query}`), body: null }) as T;
const readsMaintenance = (ctx: DemoBoardsContext) => ctx.admin || ctx.can("maintenance", "read");
const machinesOf = (ctx: DemoBoardsContext) => ask<{ parts: PartListItem[] }>(ctx, "part=tree").parts.filter((part) => !part.parentId && part.isActive && part.status !== "DECOMMISSIONED").slice(0, 24);
type EventsAnswer = { status: MachineStatus | null; events: { occurredAt: string; type: string; code: string; severity: string; state: string | null; text: string; below: string }[] };
const eventsOf = (ctx: DemoBoardsContext, id: string) => ask<EventsAnswer>(ctx, `part=events&id=${encodeURIComponent(id)}&page=2`);
const stateOf = (ctx: DemoBoardsContext, part: PartListItem) => {
  const status = partStatusOf(part.status);
  return { name: part.name, ...machineStateOf(eventsOf(ctx, part.id).status, PART_STATUS_LABELS[status], status === "OUT_OF_SERVICE") };
};

/** The demo's own made-up values of a measured signal: a gentle day curve, the same every time for the same hour. */
const DEMO_SIGNALS = [
  { id: "demo-signal-tilluft", name: "Tilluftstemperatur (°C)", machine: "Ventilationsaggregat FTX1", unit: "°C", base: 19.2, swing: 1.4 },
  { id: "demo-signal-tryck", name: "Systemtryck (bar)", machine: "Kompressorrum", unit: "bar", base: 7.2, swing: 0.4 },
];
function demoSignalPoints(signal: (typeof DEMO_SIGNALS)[number], from: Date, to: Date) {
  const points: { at: Date; value: number }[] = [];
  for (let time = from.getTime(); time < to.getTime(); time += 20 * 60_000) {
    const hour = new Date(time).getUTCHours() + 1;
    const wobble = Math.sin((time / 3_600_000) * 1.7) * 0.15;
    points.push({ at: new Date(time), value: Math.round((signal.base + signal.swing * Math.sin(((hour - 6) / 24) * Math.PI * 2) + wobble) * 10) / 10 });
  }
  return points;
}

export async function demoSourceCard(ctx: DemoBoardsContext, viewer: MetricViewer, source: SourceConfig, count: DemoCount): Promise<DemoSourceResult> {
  const now = ctx.now;
  switch (source.type) {
    case "pdf": return { ok: false, reason: "not_available" };
    case "sheet": {
      if (source.fileId !== DEMO_SHEET_ID) return { ok: false, reason: "missing" };
      if (source.view === "chart") { const series = sheetSeries(DEMO_SHEET.headers, DEMO_SHEET.rows, source); return series ? { ok: true, data: series, label: DEMO_SHEET.name } : { ok: false, reason: "missing" }; }
      return { ok: true, data: sheetTable(DEMO_SHEET.headers, DEMO_SHEET.rows), label: DEMO_SHEET.name };
    }
    case "calendar": {
      const access = metricAccess("planning_today", viewer);
      if (access !== "ok") return { ok: false, reason: access };
      const window = calendarWindow(source.range ?? "today", now);
      const rows = ctx.db.activities.filter((activity) => !activity.deletedAt && activity.status !== "CANCELED" && new Date(activity.startsAt) < window.to && new Date(activity.endsAt) > window.from)
        .filter((activity) => { const task = ctx.db.tasks.find((item) => item.id === activity.workflowTaskId); return task ? ctx.can(workflowSubjectForTask(task.kind), "read") : true; })
        .map((activity) => ({
          startsAt: activity.startsAt, endsAt: activity.endsAt, title: ctx.db.tasks.find((task) => task.id === activity.workflowTaskId)?.title || activity.title,
          people: activity.assignments.length ? activity.assignments.map((item) => ctx.db.users.find((user) => user.id === item.userId)?.name ?? "").filter(Boolean) : activity.assignedToName ? [activity.assignedToName] : [],
        }));
      return { ok: true, data: calendarShape(rows, source, now) };
    }
    case "machine": case "machines": case "machine_events": case "machine_signal": case "faults": {
      if (!readsMaintenance(ctx)) return { ok: false, reason: "forbidden" };
      const machines = machinesOf(ctx);
      if (source.type === "machine") {
        const part = machines.find((item) => !source.partId || item.id === source.partId);
        return part ? { ok: true, data: machinesShape([stateOf(ctx, part)]), label: part.name } : { ok: false, reason: "missing" };
      }
      if (source.type === "machines") {
        const chosen = source.partIds?.length ? source.partIds.flatMap((id) => machines.filter((part) => part.id === id)) : machines;
        return { ok: true, data: machinesShape(chosen.map((part) => stateOf(ctx, part))) };
      }
      if (source.type === "machine_events") {
        const parts = source.partId ? machines.filter((part) => part.id === source.partId) : machines;
        const rows = parts.flatMap((part) => eventsOf(ctx, part.id).events.map((event) => ({ ...event, machine: event.below ? `${part.name} › ${event.below}` : part.name })))
          .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
        return { ok: true, data: machineEventsShape(rows, source.alarmsOnly), ...(source.partId && parts[0] ? { label: parts[0].name } : {}) };
      }
      if (source.type === "machine_signal") {
        const period = source.period ?? "today";
        const measure = source.measure ?? "signal";
        if (measure === "signal") {
          const signal = DEMO_SIGNALS.find((item) => item.id === source.signalId) ?? DEMO_SIGNALS[0]!;
          const buckets = signalBuckets(period, now);
          const points = demoSignalPoints(signal, buckets[0]!.from, now);
          return { ok: true, data: signalSeries(points, period, now, signal.name.replace(/ \(.*\)$/, ""), signal.unit), label: `${signal.name.replace(/ \(.*\)$/, "")} · ${signal.machine}` };
        }
        const parts = source.partId ? machines.filter((part) => part.id === source.partId) : machines;
        const days = new Map<string, { day: string; alarms: number; stops: number; stoppedMinutes: number }>();
        for (const part of parts) for (const event of eventsOf(ctx, part.id).events) {
          const day = swedishDayKey(event.occurredAt);
          const row = days.get(day) ?? { day, alarms: 0, stops: 0, stoppedMinutes: 0 };
          if (event.type === "alarm" && event.state === "raised") row.alarms += 1;
          if (event.type === "state" && event.state === "stopped") { row.stops += 1; row.stoppedMinutes += 45; }
          days.set(day, row);
        }
        return { ok: true, data: daySummarySeries([...days.values()], measure, period, now) };
      }
      return { ok: true, data: faultsShape(demoFaultReports(), source.period ?? "week", now) };
    }
    case "upkeep": {
      if (!readsMaintenance(ctx) && !ctx.can("work-order", "read")) return { ok: false, reason: "forbidden" };
      const horizon = source.horizon ?? "30d";
      const window = upkeepWindow(horizon, now);
      const { occurrences } = ask<{ occurrences: PlanningMaintenance[] }>(ctx, `part=planning&from=${window.from}&to=${window.until}`);
      return { ok: true, data: upkeepShape(occurrences, horizon, now) };
    }
    case "trend": {
      const keys = source.metrics.filter(isTrendMetric);
      if (!keys.length) return { ok: false, reason: "missing" };
      for (const key of keys) { const access = metricAccess(key, viewer); if (access !== "ok") return { ok: false, reason: access }; }
      const period = trendPeriod(keys, source.period);
      const histories = await Promise.all(keys.map((key) => demoMetricHistory(key, period, now, count, source.count)));
      const units = [...new Set(keys.map((key) => metricDefinition(key).unit ?? ""))];
      const data: SeriesShape = { kind: "series", labels: histories[0]!.labels, series: keys.map((key, index) => ({ name: metricDefinition(key).label, values: histories[index]!.values })), ...(units.length === 1 && units[0] ? { unit: units[0] } : {}) };
      return { ok: true, data, label: keys.length === 1 ? metricDefinition(keys[0]!).label : undefined };
    }
  }
}

/** The measure counted again for the periods before, exactly as the figure is counted in the demo. */
export async function demoMetricHistory(key: MetricKey, period: Period, now: Date, count: DemoCount, length = TREND_COUNT[period]) {
  const moments = trendMoments(period, now, length);
  const values = await Promise.all(moments.map(async (moment) => { const shape = await count(key, period, moment); return shape.kind === "number" ? shape.value : null; }));
  return { labels: moments.map((moment) => periodLabel(period, moment)), values };
}

/** A figure with its trend and good direction, as the server's withTrend. */
export async function demoWithTrend(ref: MetricRef, card: Pick<BoardCard, "type" | "settings">, shape: NumberShape, now: Date, count: DemoCount): Promise<NumberShape> {
  const better = METRIC_BETTER[ref.metric];
  const out: NumberShape = better ? { ...shape, better } : shape;
  const period = metricPeriod(ref.metric, ref.period);
  if (card.type !== "kpi" || card.settings.trend === "none" || !period || !isTrendMetric(ref.metric)) return out;
  return { ...out, history: await demoMetricHistory(ref.metric, period, now, count) };
}

/** What the properties panel offers in the demo: the example sheet, the demo's machines and its two made-up signals. */
export function demoSourceOptions(ctx: DemoBoardsContext, kind: string | null, id: string | null) {
  switch (kind) {
    case "files": return { items: [{ id: DEMO_SHEET_ID, name: DEMO_SHEET.name, kind: "sheet", size: 0, createdAt: addSwedishDays(ctx.now, -2).toISOString() }], demo: true };
    case "sheet": return id === DEMO_SHEET_ID ? { columns: sheetTable(DEMO_SHEET.headers, DEMO_SHEET.rows).columns.map((column) => ({ label: column.label, number: column.type === "number" })) } : { columns: [] };
    case "machines": return readsMaintenance(ctx) ? { items: machinesOf(ctx).map((part) => ({ id: part.id, name: part.name })) } : { items: [], refused: true };
    case "signals": return readsMaintenance(ctx) ? { items: DEMO_SIGNALS.map((signal) => ({ id: signal.id, name: signal.name, machine: signal.machine })) } : { items: [], refused: true };
    default: return { items: [] };
  }
}
