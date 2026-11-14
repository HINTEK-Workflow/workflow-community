import { prisma } from "@/lib/db";
import { addSwedishDays, startOfSwedishDay, swedishDayKey } from "@/lib/swedish-time";
import { firstDayToCount, summariseSpan, type RunState, type SummaryEvent } from "@/lib/machine/key-figures";

/**
 * Integrationsmotorn E6: dygnssammanfattningen per objekt (beslut 2026-10-18 punkt 6: rådata 90 dagar, sammanfattning
 * 24 månader). Nattjobbet history:retention räknar de hela dygn som inte sammanfattats, innan händelserna gallras, och
 * räknar alltid om så långt bakåt som en sen händelse kan komma (intaget tar emot en vecka gammalt). Bara maskindelar (Underhåll 2026-10-30; förut platsträdets
 * objekt): en händelse utan del hör till källan och ingår inte i delarnas nyckeltal. Gallringen efter 24 månader görs i pruneSystemLogs.
 */
const EVENTS_DAYS = 89;
const asState = (value: string | null | undefined): RunState | null => (value === "running" || value === "stopped" ? value : null);

/** The run state just before `at` for an object: its latest state event before it. */
async function stateBefore(organizationId: string, machinePartId: string, at: Date) {
  const row = await prisma.machineEvent.findFirst({ where: { organizationId, machinePartId, type: "state", occurredAt: { lt: at } }, orderBy: { occurredAt: "desc" }, select: { state: true } });
  return asState(row?.state);
}

export async function summariseMachineDays(now = new Date()) {
  const today = startOfSwedishDay(now);
  const earliest = addSwedishDays(today, -EVENTS_DAYS);
  const objects = await prisma.machineEvent.groupBy({ by: ["organizationId", "machinePartId"], where: { machinePartId: { not: null }, occurredAt: { gte: earliest, lt: today } }, _min: { occurredAt: true } });
  const result = { objects: 0, days: 0 };
  for (const object of objects) {
    const machinePartId = object.machinePartId!;
    try {
      const last = await prisma.machineDaySummary.findFirst({ where: { organizationId: object.organizationId, machinePartId }, orderBy: { day: "desc" }, select: { day: true } });
      const firstEvent = startOfSwedishDay(object._min.occurredAt!);
      let day = firstDayToCount({ lastSummarised: last ? startOfSwedishDay(new Date(`${last.day}T12:00:00Z`)) : null, firstEvent, earliest, today });
      const before = await prisma.machineDaySummary.findFirst({ where: { organizationId: object.organizationId, machinePartId, day: { lt: swedishDayKey(day) } }, orderBy: { day: "desc" }, select: { endState: true } });
      let state = before ? asState(before.endState) : await stateBefore(object.organizationId, machinePartId, day);
      result.objects++;
      while (day < today) {
        const next = addSwedishDays(day, 1);
        const rows = await prisma.machineEvent.findMany({ where: { organizationId: object.organizationId, machinePartId, occurredAt: { gte: day, lt: next } }, select: { occurredAt: true, type: true, state: true, severity: true }, take: 100_000 });
        const events: SummaryEvent[] = rows.map((row) => ({ at: row.occurredAt, type: row.type, state: row.state, severity: row.severity }));
        const summary = summariseSpan({ events, startState: state, from: day, to: next });
        if (summary.events || state) {
          const key = swedishDayKey(day);
          const data = { events: summary.events, alarms: summary.alarms, faults: summary.faults, stops: summary.stops, stoppedMinutes: Math.min(1500, summary.stoppedMinutes), endState: summary.endState };
          await prisma.machineDaySummary.upsert({ where: { machinePartId_day: { machinePartId, day: key } }, update: data, create: { organizationId: object.organizationId, machinePartId, day: key, ...data } });
          result.days++;
        }
        state = summary.endState;
        day = next;
      }
    } catch (error) {
      // One object's failure never stops the others.
      console.error("machine day summary failed", error instanceof Error ? error.name : "unknown");
    }
  }
  return result;
}
