import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/server";
import { PART_LIMIT, partPath, subtreeIds, type MaintenanceCaller } from "./model";
import { requireMaintenance } from "./server";

/**
 * Maskinlarm för läsverktyget list_machine_alarms (Workflow AI-kunskap, 2026-11-21; hjälpare 14 "Förklara maskinlarmet"): the
 * machines' latest alarms and diagnoses, which of them are still raised, and the rules' own observations (machine analysis:
 * an alarm that flutters, comes more often, or a source that went silent) not yet dismissed or acknowledged. For the whole company
 * or one part and everything under it. The module's read right (Underhåll – läsa), Cloud only, company-bound; read only – nothing
 * is acknowledged, analysed or changed here (the Kopplingar page refreshes the analysis, not this read).
 */
export const MACHINE_ALARM_DAYS_MAX = 90;
const EVENTS_SHOWN = 30;
const EVENTS_READ = 300;

export type MachineAlarmRow = { id: string; occurredAt: string; type: string; code: string; severity: string; state: string | null; text: string; sourceName: string; partId: string | null; partPath: string };
export type MachineObservation = { id: string; kind: string; title: string; basis: string; createdAt: string; sourceName: string; partId: string | null; partPath: string };

/** The alarms still raised: per source and code, the latest alarm event says raised. Pure, newest first in and out. */
export function raisedAlarms<T extends { type: string; code: string; state: string | null; sourceName: string }>(events: readonly T[]): T[] {
  const seen = new Set<string>();
  const raised: T[] = [];
  for (const event of events) {
    if (event.type !== "alarm") continue;
    const key = `${event.sourceName}\u0000${event.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (event.state === "raised") raised.push(event);
  }
  return raised;
}

export async function machineAlarmsOverview(caller: MaintenanceCaller, options: { partId?: string | null; days?: number } = {}) {
  requireMaintenance(caller, "read");
  const organizationId = caller.organizationId;
  const days = Math.min(Math.max(Math.round(options.days ?? 14), 1), MACHINE_ALARM_DAYS_MAX);
  const parts = await prisma.machinePart.findMany({ where: { organizationId }, select: { id: true, parentId: true, name: true }, take: PART_LIMIT });
  let ids: string[] | null = null;
  if (options.partId) {
    if (!parts.some((part) => part.id === options.partId)) throw new ApiError(404, "Delen hittades inte.");
    ids = subtreeIds(parts, options.partId);
  }
  const pathOf = (id: string | null) => {
    if (!id) return "";
    const part = parts.find((row) => row.id === id);
    return part ? [...partPath(parts, id), part.name].join(" › ") : "";
  };
  const since = new Date(Date.now() - days * 86_400_000);
  const where = { organizationId, type: { in: ["alarm", "diagnosis"] }, occurredAt: { gte: since }, ...(ids ? { machinePartId: { in: ids } } : {}) };
  const [rows, total, suggestions] = await Promise.all([
    prisma.machineEvent.findMany({ where, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: EVENTS_READ,
      select: { id: true, occurredAt: true, type: true, code: true, severity: true, state: true, text: true, machinePartId: true, source: { select: { name: true } } } }),
    prisma.machineEvent.count({ where }),
    prisma.machineSuggestion.findMany({ where: { organizationId, status: "open", ...(ids ? { source: { machinePartId: { in: ids } } } : {}) }, orderBy: { createdAt: "desc" }, take: 20,
      select: { id: true, kind: true, title: true, basis: true, createdAt: true, source: { select: { name: true, machinePartId: true } } } }),
  ]);
  const events: MachineAlarmRow[] = rows.map((row) => ({
    id: row.id, occurredAt: row.occurredAt.toISOString(), type: row.type, code: row.code, severity: row.severity, state: row.state, text: row.text.slice(0, 300),
    sourceName: row.source.name, partId: row.machinePartId, partPath: pathOf(row.machinePartId),
  }));
  const observations: MachineObservation[] = suggestions.map((row) => ({
    id: row.id, kind: row.kind, title: row.title, basis: row.basis, createdAt: row.createdAt.toISOString(), sourceName: row.source.name, partId: row.source.machinePartId, partPath: pathOf(row.source.machinePartId),
  }));
  return { days, total, raised: raisedAlarms(events), recent: events.slice(0, EVENTS_SHOWN), observations, partId: options.partId ?? null };
}
