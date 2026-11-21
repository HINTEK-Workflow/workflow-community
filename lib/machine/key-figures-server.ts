import { prisma } from "@/lib/db";
import { addSwedishDays, startOfSwedishDay, swedishDayKey } from "@/lib/swedish-time";
import { KEY_FIGURE_PERIODS, keyFigureRows, machineKeyFigures, summariseSpan, type KeyFigurePeriod, type OrderFacts, type RunState } from "@/lib/machine/key-figures";

/**
 * Integrationsmotorn E6: nyckeltalen för en maskindel och det som ligger under (samma urval som Händelser; sedan Underhåll,
 * 2026-10-30, delar i maskinträdet i stället för platser – anroparen lib/maintenance/machine-server.ts kontrollerar
 * rätten och väljer delarna). Hela dygn kommer
 * ur dygnssammanfattningen (24 månader), det som inte sammanfattats än (i dag, och dygnen innan nattjobbet hunnit) räknas
 * direkt ur händelserna (90 dagar). Ordrarnas tider kommer från larmraderna, arbetsordrarna och larmens underhållsposter (Ur drift, Åter i drift). Bara företagets egna rader.
 */
const MAX_LIVE_EVENTS = 50_000;
const asState = (value: string | null | undefined): RunState | null => (value === "running" || value === "stopped" ? value : null);

export const parseKeyFigurePeriod = (value: string | null): KeyFigurePeriod => {
  const days = Number(value);
  return (KEY_FIGURE_PERIODS as readonly number[]).includes(days) ? days as KeyFigurePeriod : 90;
};

export async function machineKeyFiguresFor(organizationId: string, ids: string[], periodDays: KeyFigurePeriod, now = new Date()) {
  const periodStart = new Date(now.getTime() - periodDays * 86_400_000);
  const today = startOfSwedishDay(now);

  // Whole days from the summary; the live part starts the day after the latest summarised day (or at the period's start).
  const summaries = await prisma.machineDaySummary.findMany({
    where: { organizationId, machinePartId: { in: ids }, day: { gte: swedishDayKey(periodStart), lt: swedishDayKey(today) } },
    select: { machinePartId: true, day: true, events: true, alarms: true, faults: true, stops: true, stoppedMinutes: true, endState: true },
  });
  const lastDay = summaries.reduce<string | null>((latest, row) => (!latest || row.day > latest ? row.day : latest), null);
  const liveFrom = lastDay ? addSwedishDays(startOfSwedishDay(new Date(`${lastDay}T12:00:00Z`)), 1) : periodStart;
  const used = summaries;
  const totals = { events: 0, alarms: 0, faults: 0, stops: 0, stoppedMinutes: 0, hasState: false };
  for (const row of used) {
    totals.events += row.events; totals.alarms += row.alarms; totals.faults += row.faults; totals.stops += row.stops; totals.stoppedMinutes += row.stoppedMinutes;
    if (row.endState || row.stops) totals.hasState = true;
  }
  const firstSummary = used.filter((row) => row.events > 0).reduce<string | null>((first, row) => (!first || row.day < first ? row.day : first), null);

  const live = await prisma.machineEvent.findMany({
    where: { organizationId, machinePartId: { in: ids }, occurredAt: { gte: liveFrom, lte: now } }, orderBy: { occurredAt: "asc" }, take: MAX_LIVE_EVENTS,
    select: { machinePartId: true, occurredAt: true, type: true, state: true, severity: true },
  });
  const byObject = new Map<string, typeof live>();
  for (const event of live) byObject.set(event.machinePartId!, [...(byObject.get(event.machinePartId!) ?? []), event]);
  // An object stopped at the end of its latest summarised day is still stopped until it says otherwise.
  const endOf = new Map(used.filter((row) => row.day === lastDay).map((row) => [row.machinePartId!, asState(row.endState)]));
  for (const partId of new Set([...byObject.keys(), ...[...endOf.entries()].filter(([, state]) => state === "stopped").map(([id]) => id)])) {
    const events = byObject.get(partId) ?? [];
    let start = endOf.get(partId) ?? null;
    if (!endOf.has(partId)) {
      const before = await prisma.machineEvent.findFirst({ where: { organizationId, machinePartId: partId, type: "state", occurredAt: { lt: liveFrom } }, orderBy: { occurredAt: "desc" }, select: { state: true } });
      start = asState(before?.state);
    }
    const span = summariseSpan({ events: events.map((event) => ({ at: event.occurredAt, type: event.type, state: event.state, severity: event.severity })), startState: start, from: liveFrom, to: now });
    totals.events += span.events; totals.alarms += span.alarms; totals.faults += span.faults; totals.stops += span.stops; totals.stoppedMinutes += span.stoppedMinutes;
    if (start || span.endState) totals.hasState = true;
  }

  const rows = await prisma.machineAlarmOrder.findMany({
    where: { organizationId, machinePartId: { in: ids }, createdAt: { gte: periodStart }, taskId: { not: null }, status: { in: ["created", "closed"] } },
    orderBy: { createdAt: "asc" }, take: 2000, select: { id: true, createdAt: true, decidedAt: true, acknowledgedAt: true, taskId: true },
  });
  // Ur drift and Åter i drift are the alarm's maintenance item's (2026-10-30), not the work order's.
  const [tasks, items] = rows.length ? await Promise.all([
    prisma.workflowTask.findMany({ where: { organizationId, id: { in: rows.map((row) => row.taskId!) } }, select: { id: true, status: true, completedAt: true } }),
    prisma.maintenanceItem.findMany({ where: { organizationId, machineAlarmOrderId: { in: rows.map((row) => row.id) } }, select: { machineAlarmOrderId: true, stoppedAt: true, restoredAt: true } }),
  ]) : [[], []];
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const itemByRow = new Map(items.map((item) => [item.machineAlarmOrderId!, item]));
  const orders: OrderFacts[] = rows.map((row) => {
    const task = taskById.get(row.taskId!);
    const item = itemByRow.get(row.id);
    return { createdAt: row.createdAt, decidedAt: row.decidedAt, acknowledgedAt: row.acknowledgedAt, completedAt: task?.status === "COMPLETED" ? task.completedAt : null, stoppedAt: item?.stoppedAt?.toISOString() ?? null, restoredAt: item?.restoredAt?.toISOString() ?? null };
  });

  const starts = [firstSummary ? startOfSwedishDay(new Date(`${firstSummary}T12:00:00Z`)) : null, live[0]?.occurredAt ?? null, rows[0]?.createdAt ?? null].filter((value): value is Date => Boolean(value));
  const firstDataAt = starts.length ? new Date(Math.min(...starts.map((value) => value.getTime()))) : null;
  const figures = machineKeyFigures({ now, periodDays, firstDataAt, totals, orders });
  return { figures, rows: keyFigureRows(figures), periods: KEY_FIGURE_PERIODS, truncated: live.length >= MAX_LIVE_EVENTS };
}
