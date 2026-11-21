import { prisma } from "@/lib/db";
import { partMachineEvents, partMachineStatus } from "@/lib/maintenance/machine-server";
import { PART_LIMIT, PART_STATUS_LABELS, partStatusOf, subtreeIds } from "@/lib/maintenance/model";
import { requireMaintenance } from "@/lib/maintenance/server";
import { organizationModuleOn } from "@/lib/workflow/modules";
import type { MetricCaller } from "../metrics-server";
import { periodDays, periodRange } from "../period";
import { daySummarySeries, machineEventsShape, machinesShape, machineStateOf, MACHINES_MAX, signalSeries, signalValueOf, type MachineEventsSource, type MachineSignalSource, type MachineSource, type MachinesSource } from "./machines";
import { maintenanceCallerOf, type SourceResult } from "./server";

/**
 * Maskinkorten på servern: the machine connection's data read with Underhåll's read right and the module on, through the machine
 * page's own readers (lib/maintenance/machine-server.ts) where there is one. The machines are the tree's top level, as the measure
 * Maskinstatus counts them.
 */
const MACHINE_WHERE = (organizationId: string) => ({ organizationId, parentId: null, isActive: true, status: { not: "DECOMMISSIONED" } });

function allowed(viewer: MetricCaller): SourceResult | null {
  if (!organizationModuleOn(viewer.organization, "upkeep")) return { ok: false, reason: "module_off" };
  requireMaintenance(maintenanceCallerOf(viewer), "read");
  return null;
}

async function machineRows(viewer: MetricCaller, ids?: readonly string[]) {
  return prisma.machinePart.findMany({
    where: { ...MACHINE_WHERE(viewer.organizationId), ...(ids?.length ? { id: { in: [...ids] } } : {}) },
    orderBy: [{ position: "asc" }, { name: "asc" }], take: MACHINES_MAX, select: { id: true, name: true, status: true },
  });
}

async function stateOf(viewer: MetricCaller, part: { id: string; name: string; status: string }) {
  const status = await partMachineStatus(maintenanceCallerOf(viewer), part.id);
  const partStatus = partStatusOf(part.status);
  return { name: part.name, ...machineStateOf(status, PART_STATUS_LABELS[partStatus], partStatus === "OUT_OF_SERVICE") };
}

export async function readMachine(viewer: MetricCaller, source: MachineSource): Promise<SourceResult> {
  const refused = allowed(viewer); if (refused) return refused;
  const [part] = await machineRows(viewer, source.partId ? [source.partId] : undefined);
  if (!part) return source.partId ? { ok: false, reason: "missing" } : { ok: true, data: machinesShape([]) };
  return { ok: true, data: machinesShape([await stateOf(viewer, part)]), label: part.name };
}

export async function readMachines(viewer: MetricCaller, source: MachinesSource): Promise<SourceResult> {
  const refused = allowed(viewer); if (refused) return refused;
  const parts = await machineRows(viewer, source.partIds);
  const ordered = source.partIds?.length ? source.partIds.flatMap((id) => parts.filter((part) => part.id === id)) : parts;
  return { ok: true, data: machinesShape(await Promise.all(ordered.map((part) => stateOf(viewer, part)))) };
}

export async function readMachineEvents(viewer: MetricCaller, source: MachineEventsSource): Promise<SourceResult> {
  const refused = allowed(viewer); if (refused) return refused;
  if (source.partId) {
    const part = await prisma.machinePart.findFirst({ where: { id: source.partId, organizationId: viewer.organizationId }, select: { name: true } });
    if (!part) return { ok: false, reason: "missing" };
    const answer = await partMachineEvents(maintenanceCallerOf(viewer), source.partId, 2);
    return { ok: true, label: part.name, data: machineEventsShape(answer.events.map((event) => ({ ...event, machine: event.below ? `${part.name} › ${event.below}` : part.name })), source.alarmsOnly) };
  }
  const rows = await prisma.machineEvent.findMany({
    where: { organizationId: viewer.organizationId, ...(source.alarmsOnly ? { type: "alarm" } : {}) }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 50,
    select: { occurredAt: true, type: true, code: true, severity: true, state: true, text: true, machinePart: { select: { name: true } }, source: { select: { name: true } } },
  });
  return { ok: true, data: machineEventsShape(rows.map((row) => ({ ...row, machine: row.machinePart?.name ?? row.source.name })), source.alarmsOnly) };
}

export async function readMachineSignal(viewer: MetricCaller, source: MachineSignalSource, now: Date): Promise<SourceResult> {
  const refused = allowed(viewer); if (refused) return refused;
  const period = source.period ?? "today";
  const measure = source.measure ?? "signal";
  if (measure !== "signal") {
    const days = periodDays(period, now);
    let ids: string[] | null = null;
    if (source.partId) {
      const all = await prisma.machinePart.findMany({ where: { organizationId: viewer.organizationId }, select: { id: true, parentId: true, name: true }, take: PART_LIMIT });
      if (!all.some((part) => part.id === source.partId)) return { ok: false, reason: "missing" };
      ids = subtreeIds(all, source.partId);
    }
    const rows = await prisma.machineDaySummary.findMany({
      where: { organizationId: viewer.organizationId, day: { gte: days.from, lt: days.to }, ...(ids ? { machinePartId: { in: ids } } : { machinePartId: { not: null } }) },
      select: { day: true, alarms: true, stops: true, stoppedMinutes: true }, take: 20_000,
    });
    return { ok: true, data: daySummarySeries(rows, measure, period, now) };
  }
  // Only a number signal the company has made active; the values are those its events carried, nothing in between is made up.
  const signal = await prisma.machineSignal.findFirst({
    where: { organizationId: viewer.organizationId, kind: "number", status: "active", ...(source.signalId ? { id: source.signalId } : {}) },
    orderBy: [{ name: "asc" }, { key: "asc" }], select: { key: true, name: true, unit: true, sourceId: true, lastValue: true, lastValueAt: true, machinePart: { select: { name: true } }, source: { select: { name: true } } },
  });
  if (!signal) return source.signalId ? { ok: false, reason: "missing" } : { ok: true, data: { kind: "series", labels: [], series: [] } };
  const range = periodRange(period, now);
  const events = await prisma.machineEvent.findMany({
    where: { organizationId: viewer.organizationId, sourceId: signal.sourceId, occurredAt: { gte: range.from, lt: range.to } },
    orderBy: { occurredAt: "asc" }, take: 10_000, select: { occurredAt: true, values: true },
  });
  const points = events.flatMap((event) => { const value = signalValueOf(event.values, signal.key); return value === null ? [] : [{ at: event.occurredAt, value }]; });
  const last = typeof signal.lastValue === "number" && signal.lastValueAt && signal.lastValueAt >= range.from && signal.lastValueAt < range.to ? signal.lastValue : null;
  if (last !== null && !points.some((point) => point.at.getTime() === signal.lastValueAt!.getTime())) points.push({ at: signal.lastValueAt!, value: last });
  const name = signal.name.trim() || signal.key;
  return { ok: true, data: signalSeries(points, period, now, name, signal.unit || undefined), label: `${name} · ${signal.machinePart?.name ?? signal.source.name}` };
}
