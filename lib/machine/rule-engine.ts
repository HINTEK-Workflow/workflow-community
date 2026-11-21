import { Prisma } from "@prisma/client";
import { moduleOnWhere } from "@/lib/workflow/modules";
import { prisma } from "@/lib/db";
import { EMPTY_RULE_STATE, evaluateReading, evaluateTime, ruleEvent, type Rule, type RuleState, type Transition } from "@/lib/machine/signal-rules";
import type { BatchItem } from "@/lib/machine/intake";
import type { CatalogueSignal } from "@/lib/machine/signals";

/**
 * Integrationsmotorn E3: the database part of the rules. After the catalogue is updated (from /events or /raw), the active
 * rules of the signals in the call are tried against each reading in time order; then the source's rules that time alone
 * decides (a duration reached, a signal gone quiet). A transition becomes a canonical event that goes through the same
 * chain as /events (storeBatch → considerAlarm → order → notice), steered by the rule's signal, so the order lands on that
 * signal's object. Only active signals run rules. Never throws into the intake: the readings are already saved.
 */
type Reading = { key: string; value: number | boolean | string; at: Date };
type StoreBatch = (principal: { sourceId: string; organizationId: string }, items: BatchItem[], now: Date, steer: CatalogueSignal | null) => Promise<unknown>;
type RuleRow = Prisma.MachineSignalRuleGetPayload<{ include: { state: true; signal: { select: { id: true; key: true; status: true; machinePartId: true; lastSeenAt: true; sourceId: true } } } }>;

const ruleInclude = { state: true, signal: { select: { id: true, key: true, status: true, machinePartId: true, lastSeenAt: true, sourceId: true } } } as const;
const asRule = (row: RuleRow): Rule => ({ id: row.id, operator: row.operator as Rule["operator"], value: row.value as Rule["value"], hysteresis: row.hysteresis, forSeconds: row.forSeconds });
const stateOf = (row: RuleRow): RuleState => (row.state ? { active: row.state.active, activeSince: row.state.activeSince, pendingSince: row.state.pendingSince, lastValue: row.state.lastValue, evaluatedAt: row.state.evaluatedAt } : { ...EMPTY_RULE_STATE });
const json = (value: unknown) => (value === null || value === undefined ? Prisma.JsonNull : JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue);

async function saveState(ruleId: string, state: RuleState) {
  const data = { active: state.active, activeSince: state.activeSince, pendingSince: state.pendingSince, lastValue: json(state.lastValue), evaluatedAt: state.evaluatedAt };
  await prisma.machineRuleState.upsert({ where: { ruleId }, create: { ruleId, ...data }, update: data });
}

/** Makes the events of one rule's transitions, through the ordinary chain, steered by its signal. */
async function emit(principal: { sourceId: string; organizationId: string }, row: RuleRow, transitions: { transition: Transition; at: Date }[], now: Date, store: StoreBatch) {
  const items: BatchItem[] = transitions.flatMap(({ transition, at }, index) => {
    const event = ruleEvent(row, transition, at);
    return event ? [{ index, kind: "valid" as const, event }] : [];
  });
  if (items.length) await store(principal, items, now, { id: row.signal.id, status: row.signal.status, partId: row.signal.machinePartId });
}

const changed = (before: RuleState, after: RuleState) => before.active !== after.active || before.pendingSince?.getTime() !== after.pendingSince?.getTime() || before.evaluatedAt?.getTime() !== after.evaluatedAt?.getTime();

export async function runRules(principal: { sourceId: string; organizationId: string }, readings: readonly Reading[], signals: Map<string, CatalogueSignal>, now: Date, store: StoreBatch) {
  try {
    const signalIds = [...new Set(readings.map((reading) => signals.get(reading.key)).filter((signal): signal is CatalogueSignal => Boolean(signal && signal.status === "active")).map((signal) => signal.id))];
    const rows = await prisma.machineSignalRule.findMany({
      where: { organizationId: principal.organizationId, isActive: true, signal: { sourceId: principal.sourceId, status: "active" },
        OR: [{ signalId: { in: signalIds } }, { operator: "stale" }, { state: { pendingSince: { not: null } } }] },
      include: ruleInclude, take: 50,
    });
    for (const row of rows) {
      const rule = asRule(row);
      let state = stateOf(row);
      const before = state;
      const transitions: { transition: Transition; at: Date }[] = [];
      const own = readings.filter((reading) => reading.key === row.signal.key).sort((a, b) => a.at.getTime() - b.at.getTime());
      for (const reading of own) {
        const result = evaluateReading(rule, state, reading);
        state = result.state;
        if (result.transition) transitions.push({ transition: result.transition, at: reading.at });
      }
      const timed = evaluateTime(rule, state, { lastSeenAt: own.at(-1)?.at ?? row.signal.lastSeenAt }, now);
      if (timed) { state = timed.state; if (timed.transition) transitions.push({ transition: timed.transition, at: timed.at }); }
      if (changed(before, state) || transitions.length) await saveState(row.id, state);
      if (transitions.length) await emit(principal, row, transitions, now, store);
    }
  } catch (error) {
    console.error("machine rules failed", error instanceof Error ? error.message : "unknown");
  }
}

/** The job every 5 minutes (svar 5): what time alone decides, for every company's active rules. Counts only. */
export async function runTimedRules(now: Date, store: StoreBatch) {
  const rows = await prisma.machineSignalRule.findMany({
    // Företagets moduler (0.39.0): with Underhåll off no rule makes an event; the rules are as they were when it is on again.
    where: { isActive: true, organization: { isActive: true, storageMode: "HINTEK_CLOUD", ...moduleOnWhere("upkeep") }, signal: { status: "active" }, OR: [{ operator: "stale" }, { state: { pendingSince: { not: null } } }] },
    include: ruleInclude, take: 5000,
  });
  let events = 0;
  for (const row of rows) {
    try {
      const timed = evaluateTime(asRule(row), stateOf(row), { lastSeenAt: row.signal.lastSeenAt }, now);
      if (!timed) continue;
      await saveState(row.id, timed.state);
      if (timed.transition) { await emit({ sourceId: row.signal.sourceId, organizationId: row.organizationId }, row, [{ transition: timed.transition, at: timed.at }], now, store); events += 1; }
    } catch (error) {
      console.error("machine timed rule failed", error instanceof Error ? error.message : "unknown");
    }
  }
  return { rules: rows.length, events };
}
