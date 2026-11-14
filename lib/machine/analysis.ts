import { swedishDayKey } from "@/lib/swedish-time";

// Maskinanalys (0.19.0): regler först. Varje källas händelser jämförs med dess egen historik och ger förslag med sitt
// underlag. Rent: ingen databas, ingen AI. Tröskeln "lär sig": varje gång en administratör avvisar en sorts förslag för en
// källa blir just den sortens tröskel högre (högst tre gånger grundvärdet), så källan inte tjatar om det den bedömts som normalt.

export const SUGGESTION_KINDS = ["flutter", "denser", "silent"] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];
export type Tuning = Record<SuggestionKind, number>;
export const DEFAULT_TUNING: Tuning = { flutter: 1, denser: 1, silent: 1 };
export const TUNING_STEP = 1.5;
export const TUNING_MAX = 3;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Grundtrösklar (multipliceras med källans egen justering). */
export const BASE = { flutterCount: 5, flutterWindowMs: HOUR, denserMin: 5, denserFactor: 2, denserExtra: 3, silentMinMs: DAY, silentGapFactor: 5, silentMinEvents: 10, silentMinDays: 3 } as const;
export const HISTORY_DAYS = 14;

export type AnalysisEvent = { occurredAt: Date; type: string; code: string; severity: string; state: string | null };
export type Finding = { kind: SuggestionKind; dedupeKey: string; title: string; basis: string; stats: Record<string, number | string> };

export function parseTuning(value: unknown): Tuning {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const pick = (key: SuggestionKind) => { const n = record[key]; return typeof n === "number" && Number.isFinite(n) ? Math.min(TUNING_MAX, Math.max(1, n)) : 1; };
  return { flutter: pick("flutter"), denser: pick("denser"), silent: pick("silent") };
}

/** Efter ett avvisat förslag: den sortens tröskel höjs ett steg. */
export function tunedAfterDismiss(current: Tuning, kind: SuggestionKind): Tuning {
  return { ...current, [kind]: Math.min(TUNING_MAX, Math.round(current[kind] * TUNING_STEP * 100) / 100) };
}

const isNewAlarm = (event: AnalysisEvent) => event.type === "alarm" && (event.state === null || event.state === "raised");
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0; };
const minutes = (ms: number) => Math.round(ms / 60_000);
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Vilka regler som körs och vad "tyst" gäller (integrationsmotorn E2): utan val alla tre för hela källan, som förut. Med
 * aktiva signaler körs fladder och tätare larm per objekt eller signal, och tyst maskin per aktiv signal – då med signalens
 * namn i rubriken och dess id i dubblettnyckeln, så två signaler på samma objekt kan tystna var för sig.
 */
export type AnalyseOptions = { kinds?: readonly SuggestionKind[]; silent?: { id: string; label: string } };

export function analyse(events: readonly AnalysisEvent[], now: Date, tuningInput: unknown = null, options: AnalyseOptions = {}): Finding[] {
  const tuning = parseTuning(tuningInput);
  const runs = (kind: SuggestionKind) => !options.kinds || options.kinds.includes(kind);
  const findings: Finding[] = [];
  const day = swedishDayKey(now);
  const inLast = (event: AnalysisEvent, ms: number) => now.getTime() - event.occurredAt.getTime() <= ms && event.occurredAt.getTime() <= now.getTime();

  // 1. Fladder: samma larmkod kommer många gånger inom en timme.
  const lastDay = events.filter((event) => isNewAlarm(event) && inLast(event, DAY));
  const byCode = new Map<string, number[]>();
  for (const event of lastDay) byCode.set(event.code, [...(byCode.get(event.code) ?? []), event.occurredAt.getTime()]);
  const flutterLimit = Math.ceil(BASE.flutterCount * tuning.flutter);
  for (const [code, times] of runs("flutter") ? byCode : new Map<string, number[]>()) {
    times.sort((a, b) => a - b);
    let best = 0;
    for (let start = 0, end = 0; end < times.length; end += 1) {
      while (times[end] - times[start] > BASE.flutterWindowMs) start += 1;
      best = Math.max(best, end - start + 1);
    }
    if (best >= flutterLimit) findings.push({
      kind: "flutter", dedupeKey: `flutter:${code}:${day}`, title: `Larmet ${code} fladdrar`,
      basis: `${code} kom ${best} gånger inom en timme senaste dygnet (gräns ${flutterLimit}).`, stats: { code, inOneHour: best, limit: flutterLimit },
    });
  }

  // 2. Tätare larm: senaste dygnets larm mot källans eget dagssnitt de sju dagarna före.
  const alarmsNow = lastDay.length;
  const before = events.filter((event) => isNewAlarm(event) && now.getTime() - event.occurredAt.getTime() > DAY && now.getTime() - event.occurredAt.getTime() <= 8 * DAY);
  const daysWithHistory = new Set(before.map((event) => swedishDayKey(event.occurredAt))).size;
  if (runs("denser") && daysWithHistory >= 3) {
    const mean = before.length / 7;
    const limit = Math.max(BASE.denserMin, Math.ceil(BASE.denserFactor * tuning.denser * mean));
    if (alarmsNow >= limit && alarmsNow - mean >= BASE.denserExtra) findings.push({
      kind: "denser", dedupeKey: `denser:${day}`, title: "Larmen har blivit tätare",
      basis: `${count(alarmsNow, "larm", "larm")} senaste dygnet mot ${(Math.round(mean * 10) / 10).toString().replace(".", ",")} per dygn de sju dagarna före (gräns ${limit}).`,
      stats: { lastDay: alarmsNow, dailyMean: Math.round(mean * 10) / 10, limit },
    });
  }

  // 3. Tyst maskin: många händelser tidigare men inget på länge jämfört med hur ofta den brukar höra av sig.
  const history = events.filter((event) => inLast(event, HISTORY_DAYS * DAY)).map((event) => event.occurredAt.getTime()).sort((a, b) => a - b);
  const historyDays = new Set(history.map((time) => swedishDayKey(new Date(time)))).size;
  if (runs("silent") && history.length >= BASE.silentMinEvents && historyDays >= BASE.silentMinDays) {
    const gaps = history.slice(1).map((time, index) => time - history[index]);
    const last = history[history.length - 1];
    const silence = now.getTime() - last;
    const limit = Math.max(BASE.silentMinMs * tuning.silent, BASE.silentGapFactor * median(gaps) * tuning.silent);
    if (silence >= limit) findings.push({
      kind: "silent", dedupeKey: options.silent ? `silent:${options.silent.id}:${swedishDayKey(new Date(last))}` : `silent:${swedishDayKey(new Date(last))}`,
      title: options.silent ? `${options.silent.label} har tystnat`.slice(0, 200) : "Maskinen har tystnat",
      basis: `Inget har hörts på ${Math.round(silence / HOUR)} timmar; den brukar höra av sig med ${minutes(median(gaps))} minuters mellanrum (gräns ${Math.round(limit / HOUR)} timmar).`,
      stats: { silentHours: Math.round(silence / HOUR), typicalGapMinutes: minutes(median(gaps)), limitHours: Math.round(limit / HOUR) },
    });
  }
  return findings;
}
