// Maskinintag, steg S2: ren validering av en batch händelser, utan databas och utan HTTP.
// Rutten (lib/api-handlers/ingest-events.ts) autentiserar nyckeln och sparar; allt som går att avgöra av innehållet
// ensamt avgörs här, så att det kan provas med enhetstester. Företaget kommer aldrig härifrån: det bestäms av nyckeln.

export const INGEST_SCHEMA_VERSION = 1;
export const MAX_EVENTS_PER_CALL = 20;
/** Hela kroppen får vara högst så här stor; 20 händelser med fulla fält ryms med god marginal. */
export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_TEXT_LENGTH = 200;
export const MAX_EVENT_ID_LENGTH = 128;
export const MAX_CODE_LENGTH = 64;
/** Små I/O-värden som följer med en händelse (till exempel det en diagnos bygger på): högst så här många, med korta namn och värden. */
export const MAX_VALUES = 20;
export const MAX_VALUE_NAME_LENGTH = 40;
export const MAX_VALUE_TEXT_LENGTH = 60;
/** Tidsfönstret för `occurredAt`: en gammal händelse (kö som sänds i efterhand) får vara upp till en vecka, en framtida bara klockdrift. */
export const MAX_AGE_MS = 7 * 24 * 3600_000;
export const MAX_FUTURE_MS = 5 * 60_000;

export const EVENT_TYPES = ["alarm", "state", "diagnosis"] as const;
export const EVENT_SEVERITIES = ["info", "warning", "fault", "critical"] as const;
export const ALARM_STATES = ["raised", "cleared"] as const;
export const RUN_STATES = ["running", "stopped"] as const;
export type MachineEventType = (typeof EVENT_TYPES)[number];
export type MachineEventSeverity = (typeof EVENT_SEVERITIES)[number];

export type ParsedMachineEvent = {
  eventId: string;
  occurredAt: Date;
  type: MachineEventType;
  code: string;
  severity: MachineEventSeverity;
  state: string | null;
  text: string;
  basis: string | null;
  /** Namn till tal, sant/falskt eller kort text; null när inga värden skickades. */
  values: Record<string, number | boolean | string> | null;
};

/** Orsakerna är fasta koder, aldrig text ur kroppen, så svaret inte kan användas för att läsa något tillbaka. */
export type RejectReason =
  | "not_an_object" | "unknown_field" | "missing_field" | "bad_event_id" | "bad_time" | "time_window" | "bad_type"
  | "bad_code" | "bad_severity" | "bad_state" | "bad_text" | "bad_basis" | "bad_values";
export type EnvelopeError = "invalid_json" | "not_an_object" | "unknown_field" | "unsupported_version" | "bad_events" | "bad_batch_size";

export type EventResult = {
  index: number;
  eventId: string | null;
  status: "accepted" | "duplicate" | "rejected";
  reason?: RejectReason;
};

export type BatchItem =
  | { index: number; kind: "valid"; event: ParsedMachineEvent }
  | { index: number; kind: "duplicate"; eventId: string }
  | { index: number; kind: "rejected"; eventId: string | null; reason: RejectReason };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
// Synliga ASCII-tecken utan blanksteg; en nyckel som ska gå att skriva i en logg och i en URL utan tvivel.
const TOKENLIKE = /^[\x21-\x7e]+$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
// ISO 8601 med datum, tid och tidszon (Z eller +hh:mm); en tid utan zon är tvetydig och nekas.
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
const EVENT_FIELDS = new Set(["eventId", "occurredAt", "type", "code", "severity", "state", "text", "basis", "values"]);
// Namn på ett värde: bokstäver, siffror, understreck, punkt och bindestreck (som ett fältnamn i ett program).
const VALUE_NAME = /^[A-Za-z0-9_.-]+$/;
const PROTOTYPE_NAMES = new Set(["__proto__", "constructor", "prototype"]);

/** `values`: ett objekt med högst 20 namn till ändliga tal, sant/falskt eller kort text utan styrtecken; annars null. */
export function cleanValues(value: unknown): Record<string, number | boolean | string> | null | "bad" {
  if (value === undefined) return null;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "bad";
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length < 1 || entries.length > MAX_VALUES) return "bad";
  const out: Record<string, number | boolean | string> = {};
  for (const [name, item] of entries) {
    // __proto__, constructor and prototype are never names (integrationsmotorn: they could change an object's prototype).
    if (name.length < 1 || name.length > MAX_VALUE_NAME_LENGTH || !VALUE_NAME.test(name) || PROTOTYPE_NAMES.has(name)) return "bad";
    if (typeof item === "number") { if (!Number.isFinite(item)) return "bad"; out[name] = item; }
    else if (typeof item === "boolean") out[name] = item;
    else if (typeof item === "string") { if (CONTROL_CHARACTERS.test(item) || [...item].length > MAX_VALUE_TEXT_LENGTH) return "bad"; out[name] = item.trim(); }
    else return "bad";
  }
  return out;
}

/** Parsar `occurredAt` strikt; null när formen eller datumet är fel (t.ex. 2026-02-31). */
export function parseOccurredAt(value: unknown): Date | null {
  if (typeof value !== "string" || !ISO_WITH_ZONE.test(value)) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  // Ett datum som JavaScript "rättar" (31 februari) ska inte godkännas: dagen måste vara samma i UTC om zonen är Z.
  const day = Number(value.slice(8, 10));
  const month = Number(value.slice(5, 7));
  if (month < 1 || month > 12 || day < 1 || day > 31 || Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59) return null;
  if (value.endsWith("Z") && (date.getUTCDate() !== day || date.getUTCMonth() + 1 !== month)) return null;
  return date;
}

export function withinTimeWindow(date: Date, now: Date) {
  const diff = date.getTime() - now.getTime();
  return diff <= MAX_FUTURE_MS && -diff <= MAX_AGE_MS;
}

/** Fri text från kunden: sträng, trimmad, inga styrtecken, högst 200 tecken (räknat i tecken, inte byte). */
function cleanText(value: unknown, required: boolean): string | null {
  if (value === undefined && !required) return "";
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (CONTROL_CHARACTERS.test(text) || [...text].length > MAX_TEXT_LENGTH) return null;
  return text;
}

/** En händelse: antingen den tolkade, eller orsaken till att den nekas. Okända fält nekas. */
export function parseEvent(raw: unknown, now: Date): { ok: true; event: ParsedMachineEvent } | { ok: false; eventId: string | null; reason: RejectReason } {
  if (!isRecord(raw)) return { ok: false, eventId: null, reason: "not_an_object" };
  const idRaw = raw.eventId;
  const eventId = typeof idRaw === "string" && idRaw.length >= 1 && idRaw.length <= MAX_EVENT_ID_LENGTH && TOKENLIKE.test(idRaw) ? idRaw : null;
  const reject = (reason: RejectReason) => ({ ok: false as const, eventId, reason });
  if (Object.keys(raw).some((key) => !EVENT_FIELDS.has(key))) return reject("unknown_field");
  if (idRaw === undefined || raw.occurredAt === undefined || raw.type === undefined || raw.code === undefined || raw.severity === undefined) return reject("missing_field");
  if (!eventId) return reject("bad_event_id");
  const occurredAt = parseOccurredAt(raw.occurredAt);
  if (!occurredAt) return reject("bad_time");
  if (!withinTimeWindow(occurredAt, now)) return reject("time_window");
  if (typeof raw.type !== "string" || !(EVENT_TYPES as readonly string[]).includes(raw.type)) return reject("bad_type");
  const type = raw.type as MachineEventType;
  if (typeof raw.code !== "string" || raw.code.length < 1 || raw.code.length > MAX_CODE_LENGTH || !TOKENLIKE.test(raw.code)) return reject("bad_code");
  if (typeof raw.severity !== "string" || !(EVENT_SEVERITIES as readonly string[]).includes(raw.severity)) return reject("bad_severity");
  // Larm: raised/cleared (får utelämnas). Driftläge: running/stopped (krävs). Diagnos: inget läge.
  let state: string | null = null;
  if (raw.state !== undefined) {
    const allowed: readonly string[] = type === "alarm" ? ALARM_STATES : type === "state" ? RUN_STATES : [];
    if (typeof raw.state !== "string" || !allowed.includes(raw.state)) return reject("bad_state");
    state = raw.state;
  } else if (type === "state") return reject("bad_state");
  const text = cleanText(raw.text, false);
  if (text === null) return reject("bad_text");
  let basis: string | null = null;
  if (raw.basis !== undefined) {
    if (type !== "diagnosis") return reject("bad_basis");
    basis = cleanText(raw.basis, true);
    if (basis === null) return reject("bad_basis");
  }
  const values = cleanValues(raw.values);
  if (values === "bad") return reject("bad_values");
  return { ok: true, event: { eventId, occurredAt, type, code: raw.code, severity: raw.severity as MachineEventSeverity, state, text, basis, values } };
}

/**
 * Hela anropet. Ett fel i själva kuvertet (fel version, fel antal, okända fält högst upp) nekar allt; ett fel i en
 * enskild händelse nekar bara den, så en kö med en trasig rad inte fastnar för alltid. En eventId som redan förekommit
 * tidigare i samma batch blir `duplicate`, precis som en som redan finns sparad.
 */
export function parseBatch(body: unknown, now: Date): { ok: true; items: BatchItem[] } | { ok: false; error: EnvelopeError } {
  if (!isRecord(body)) return { ok: false, error: "not_an_object" };
  if (Object.keys(body).some((key) => key !== "schemaVersion" && key !== "events")) return { ok: false, error: "unknown_field" };
  if (body.schemaVersion !== INGEST_SCHEMA_VERSION) return { ok: false, error: "unsupported_version" };
  if (!Array.isArray(body.events)) return { ok: false, error: "bad_events" };
  if (body.events.length < 1 || body.events.length > MAX_EVENTS_PER_CALL) return { ok: false, error: "bad_batch_size" };
  const seen = new Set<string>();
  const items = body.events.map((raw, index): BatchItem => {
    const parsed = parseEvent(raw, now);
    if (!parsed.ok) return { index, kind: "rejected", eventId: parsed.eventId, reason: parsed.reason };
    if (seen.has(parsed.event.eventId)) return { index, kind: "duplicate", eventId: parsed.event.eventId };
    seen.add(parsed.event.eventId);
    return { index, kind: "valid", event: parsed.event };
  });
  return { ok: true, items };
}

/** Svarsraden för en händelse när sparandet gett `stored` (ny rad) eller `exists` (redan sparad). */
export function resultFor(item: BatchItem, outcome?: "stored" | "exists"): EventResult {
  if (item.kind === "rejected") return { index: item.index, eventId: item.eventId, status: "rejected", reason: item.reason };
  if (item.kind === "duplicate") return { index: item.index, eventId: item.eventId, status: "duplicate" };
  return { index: item.index, eventId: item.event.eventId, status: outcome === "stored" ? "accepted" : "duplicate" };
}

export function countResults(results: EventResult[]) {
  return {
    accepted: results.filter((item) => item.status === "accepted").length,
    duplicate: results.filter((item) => item.status === "duplicate").length,
    rejected: results.filter((item) => item.status === "rejected").length,
  };
}
