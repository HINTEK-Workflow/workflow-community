// Integrationsmotorn E1 (2026-10-24, docs/proposals/integrationsmotor-plan-2026-10-24.md): rena regler för vad ett
// larm gäller och hur maskinens eget driftläge fyller i en öppen automatisk order. Ingen databas här; servern
// (lib/machine/alarm-orders.ts, run-state.ts) hämtar fakta och frågar.

/**
 * Vad spärren "högst en öppen automatisk order", vilan och dygnstaket räknas på. En kommunikationsenhet kan övervaka flera
 * maskiner (beslut 5), så källan är bara sista utvägen. Ordningen: signalens egen maskindel → källans standarddel →
 * signalen själv → källan. Sedan Underhåll (2026-10-30) är "objektet" en del i maskinträdet (`part:<id>`), aldrig
 * en plats i kundens platsträd; `facility:` finns kvar bara i gamla rader.
 */
export type ScopeInput = {
  sourceId: string;
  sourcePartId: string | null;
  signal?: { id: string; partId: string | null } | null;
};
export type AlarmScope = { scopeKey: string; partId: string | null };

export const SCOPE_KEY_PATTERN = /^(part|facility|signal|source):[A-Za-z0-9_-]{1,100}$/;

export function resolveScope(input: ScopeInput): AlarmScope {
  if (input.signal?.partId) return { scopeKey: `part:${input.signal.partId}`, partId: input.signal.partId };
  if (input.sourcePartId) return { scopeKey: `part:${input.sourcePartId}`, partId: input.sourcePartId };
  if (input.signal) return { scopeKey: `signal:${input.signal.id}`, partId: null };
  return { scopeKey: `source:${input.sourceId}`, partId: null };
}

export function parseScopeKey(key: string): { kind: "part" | "facility" | "signal" | "source"; id: string } | null {
  if (!SCOPE_KEY_PATTERN.test(key)) return null;
  const at = key.indexOf(":");
  return { kind: key.slice(0, at) as "part" | "facility" | "signal" | "source", id: key.slice(at + 1) };
}

/**
 * Hur långt före larmet ett `stopped` får ligga och ändå räknas som orderns "Ur drift" (en maskin som stannar och larmar i
 * samma ögonblick skickar ofta stoppet först, eller i ett tidigare anrop).
 */
export const STOP_BEFORE_ALARM_MS = 5 * 60_000;

export type RunStateFacts = {
  state: "running" | "stopped";
  occurredAt: Date;
  /** När larmet som gav ordern inträffade. */
  alarmAt: Date;
  /** Orderns nuvarande värden (ISO-tid eller null), satta av maskinen tidigare eller av en person. */
  stoppedAt: string | null;
  restoredAt: string | null;
};

/**
 * Beslut 2026-10-18: ett släckt larm betyder inte åter i drift; bara maskinens eget `running` eller en person fyller i
 * "Åter i drift". Därför: `stopped` fyller "Ur drift" en gång (inom fem minuter före larmet eller senare), `running` fyller
 * "Åter i drift" en gång och bara efter ett stopp (annars skulle en maskin som rapporterar `running` hela tiden se ut att
 * ha kommit tillbaka direkt). Ett värde som redan finns – maskinens eller en persons – skrivs aldrig över.
 */
export function runStateChange(facts: RunStateFacts): { field: "stoppedAt" | "restoredAt"; value: string } | null {
  const at = facts.occurredAt.getTime();
  if (facts.restoredAt) return null;
  if (facts.state === "stopped") {
    if (facts.stoppedAt) return null;
    if (at < facts.alarmAt.getTime() - STOP_BEFORE_ALARM_MS) return null;
    return { field: "stoppedAt", value: facts.occurredAt.toISOString() };
  }
  if (!facts.stoppedAt) return null;
  const stopped = Date.parse(facts.stoppedAt);
  if (!Number.isFinite(stopped) || at < stopped || at < facts.alarmAt.getTime() - STOP_BEFORE_ALARM_MS) return null;
  return { field: "restoredAt", value: facts.occurredAt.toISOString() };
}

/** Raden i orderns historik när maskinen själv fyllt i ett av fälten. */
export const runStateNote = (field: "stoppedAt" | "restoredAt", sourceName: string) =>
  field === "stoppedAt" ? `Maskinens driftläge: ${sourceName || "källan"} rapporterade stopp (Ur drift).` : `Maskinens driftläge: ${sourceName || "källan"} rapporterade i drift (Åter i drift).`;

/** Systemadministratörens gräns för dygnstaket per företag (CHECK i migreringen 20261024160000). */
export const DAILY_CAP_MIN = 1;
export const DAILY_CAP_MAX = 500;
