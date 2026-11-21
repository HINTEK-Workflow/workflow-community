// Integrationsmotorn E2 (plan, beslut 5): analysen per scope i stället för per källa. Rent, utan databas: händelserna
// delas i grupper efter det objekt eller den aktiva signal de gäller (samma upplösning som larmkedjan), och "tyst maskin"
// räknas per aktiv signal. En källa utan aktiva signaler och utan objekt analyseras precis som förut (en grupp, alla regler).
import { resolveScope } from "@/lib/machine/alarm-scope";
import type { SuggestionKind } from "@/lib/machine/analysis";
import { codeSignalKey, isCodeKey, signalLabel } from "@/lib/machine/signals";

export type ScopedEvent = { occurredAt: Date; type: string; code: string; severity: string; state: string | null; machinePartId: string | null; signalId: string | null; values: Record<string, unknown> | null };
export type ActiveSignal = { id: string; key: string; name: string; machinePartId: string | null };
export type AnalysisGroup = { scopeKey: string; events: ScopedEvent[]; kinds: SuggestionKind[]; silent?: { id: string; label: string } };

export function analysisGroups(sourceId: string, events: readonly ScopedEvent[], active: readonly ActiveSignal[]): AnalysisGroup[] {
  const byId = new Map(active.map((signal) => [signal.id, signal]));
  const byCode = new Map(active.filter((signal) => isCodeKey(signal.key)).map((signal) => [signal.key, signal]));
  const scopeOf = (event: ScopedEvent) => {
    const signal = (event.signalId ? byId.get(event.signalId) : undefined) ?? byCode.get(codeSignalKey(event.code));
    return resolveScope({ sourceId, sourcePartId: event.machinePartId, signal: signal ? { id: signal.id, partId: signal.machinePartId } : null }).scopeKey;
  };
  const scoped = new Map<string, ScopedEvent[]>();
  for (const event of events) { const key = scopeOf(event); scoped.set(key, [...(scoped.get(key) ?? []), event]); }
  const perScope: SuggestionKind[] = active.length ? ["flutter", "denser"] : ["flutter", "denser", "silent"];
  const groups: AnalysisGroup[] = [...scoped].map(([scopeKey, list]) => ({ scopeKey, events: list, kinds: perScope }));
  // Tyst per aktiv signal: a code signal's own events, or the events that carried the value.
  for (const signal of active) {
    const own = events.filter((event) => isCodeKey(signal.key) ? event.signalId === signal.id || codeSignalKey(event.code) === signal.key : Boolean(event.values && Object.hasOwn(event.values, signal.key)));
    groups.push({ scopeKey: resolveScope({ sourceId, sourcePartId: null, signal: { id: signal.id, partId: signal.machinePartId } }).scopeKey, events: own, kinds: ["silent"], silent: { id: signal.id, label: signalLabel(signal) } });
  }
  return groups;
}
