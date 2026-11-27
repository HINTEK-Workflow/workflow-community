import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { considerAlarm } from "@/lib/machine/alarm-orders";
import { applyRunState } from "@/lib/machine/run-state";
import { countResults, parseBatch, resultFor, type BatchItem, type EventResult, type ParsedMachineEvent } from "@/lib/machine/intake";
import { knownSignals, recordSignals } from "@/lib/machine/signal-store";
import { codeSignalKey, readingsOfEvents, signalsOfEvents, steeringSignal, type CatalogueSignal } from "@/lib/machine/signals";
import { runRules } from "@/lib/machine/rule-engine";
import { feedRunHours } from "@/lib/machine/run-hours-store";

/**
 * Saves a checked batch for one source. A valid event is written once: (sourceId, eventId) is unique, so a resent event is
 * "exists" and becomes a duplicate in the answer, never a second row. The company is the source's, given by the caller.
 * Integrationsmotorn E1: each event keeps the object it was received for (a later change of the object never moves old
 * history), alarms are weighed first and then the run states, in time order, may fill in the open order's times.
 * E2: the event's code is a signal in the catalogue. An active signal with an object of its own decides the event's object;
 * the accepted events (never the duplicates) update the catalogue in one write per call.
 * E3: the values in the accepted events are tried against the signals' rules (lib/machine/rule-engine.ts). A rule's own
 * events come back here with `steer` – the rule's signal – which then decides the object and the scope instead of the code.
 */
export async function storeBatch(principal: { sourceId: string; organizationId: string }, items: BatchItem[], now = new Date(), steer: CatalogueSignal | null = null): Promise<EventResult[]> {
  const results: EventResult[] = [];
  const accepted: { id: string; event: ParsedMachineEvent; signalKnown: boolean }[] = [];
  const source = await prisma.machineSource.findFirst({ where: { id: principal.sourceId, organizationId: principal.organizationId }, select: { name: true, machinePartId: true } });
  const valid = items.flatMap((item) => (item.kind === "valid" ? [item.event] : []));
  const known = await knownSignals(principal, valid.flatMap((event) => [codeSignalKey(event.code), ...Object.keys(event.values ?? {})]));
  for (const item of items) {
    if (item.kind !== "valid") { results.push(resultFor(item)); continue; }
    const event = item.event;
    const signal = known.get(codeSignalKey(event.code));
    // Underhåll (2026-10-30): the event keeps the machine part it was received for.
    const machinePartId = steeringSignal(steer)?.partId ?? steeringSignal(signal)?.partId ?? source?.machinePartId ?? null;
    try {
      const row = await prisma.machineEvent.create({
        data: {
          organizationId: principal.organizationId, sourceId: principal.sourceId, eventId: event.eventId, occurredAt: event.occurredAt, receivedAt: now,
          type: event.type, code: event.code, severity: event.severity, state: event.state, text: event.text, basis: event.basis,
          ...(event.values ? { values: event.values as Prisma.InputJsonObject } : {}), machinePartId, signalId: signal?.id ?? null,
        },
        select: { id: true },
      });
      accepted.push({ id: row.id, event, signalKnown: Boolean(signal) });
      results.push(resultFor(item, "stored"));
      // När något händer (Agenter, 2026-11-21): a raised alarm may start a mission; the event's own id makes it run once.
      if (event.type === "alarm" && event.state !== "cleared") void import("@/lib/agents/events").then(({ emitAgentEvent }) => emitAgentEvent({ organizationId: principal.organizationId, key: "machine_alarm", id: `alarm:${row.id}`, recordId: row.id, title: event.text.slice(0, 160) || event.code, href: "/?view=maintenance", actorId: null })).catch(() => undefined);
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
      results.push(resultFor(item, "exists"));
    }
  }
  if (!accepted.length) return results;
  const catalogue = await recordSignals(principal, signalsOfEvents(accepted.map((item) => item.event)), known, now);
  // A code seen for the first time: its events get the new signal (one update per new code, rare after the first call).
  const firstSeen = new Map<string, string[]>();
  for (const item of accepted) if (!item.signalKnown) firstSeen.set(item.event.code, [...(firstSeen.get(item.event.code) ?? []), item.id]);
  for (const [code, ids] of firstSeen) {
    const signal = catalogue.signals.get(codeSignalKey(code));
    if (signal) await prisma.machineEvent.updateMany({ where: { id: { in: ids }, organizationId: principal.organizationId, sourceId: principal.sourceId }, data: { signalId: signal.id } });
  }
  await prisma.machineSource.update({ where: { id: principal.sourceId }, data: { lastEventAt: now, ...(catalogue.ignored ? { ignoredSignals: { increment: catalogue.ignored } } : {}) } });
  // The events are saved; what an alarm leads to (S3) never changes the answer to the sender.
  const signalOf = (code: string) => (steer && steer.status === "active" ? steer : catalogue.signals.get(codeSignalKey(code)) ?? null);
  for (const { id, event } of accepted) {
    if (event.type === "alarm") await considerAlarm(principal, { id, occurredAt: event.occurredAt, type: event.type, code: event.code, severity: event.severity, state: event.state, text: event.text }, now, signalOf(event.code));
  }
  if (source) {
    const states = accepted.filter((item) => item.event.type === "state").sort((a, b) => a.event.occurredAt.getTime() - b.event.occurredAt.getTime());
    for (const { event } of states) await applyRunState(principal, source, { occurredAt: event.occurredAt, state: event.state }, signalOf(event.code));
  }
  // E3: the readings in the events' values, and the codes that were heard, against the rules (a rule's own events are not tried
  // again). A signal marked for it also moves its part's run hours.
  if (!steer) {
    const readings = readingsOfEvents(accepted.map(({ event }) => event));
    await feedRunHours(principal, readings, known, now);
    await runRules(principal, readings, catalogue.signals, now, storeBatch);
  }
  return results;
}

/** Checks and saves a request body; the envelope error when the whole call is refused. */
export async function receiveEvents(principal: { sourceId: string; organizationId: string }, body: unknown, now = new Date()) {
  const parsed = parseBatch(body, now);
  if (!parsed.ok) return { ok: false as const, error: parsed.error };
  const results = await storeBatch(principal, parsed.items, now);
  return { ok: true as const, results, counts: countResults(results) };
}
