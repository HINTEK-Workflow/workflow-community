// Integrationsmotorn E2 (2026-10-24, beslut 4): signalkatalogen som rena regler. Servern (signal-store.ts) läser och
// skriver; allt som går att avgöra av innehållet avgörs här, så att det kan provas med enhetstester. Inga tillverkarnamn,
// inga uttryck och inga kundskrivna reguljära uttryck: en signal är ett värdenamn eller en kod som intaget redan godkänt.

export const SIGNAL_KINDS = ["number", "boolean", "text", "code"] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];
export const SIGNAL_STATUSES = ["discovered", "active", "ignored"] as const;
export type SignalStatus = (typeof SIGNAL_STATUSES)[number];
export const SIGNAL_STATUS_LABELS: Record<SignalStatus, string> = { discovered: "Upptäckt", active: "Aktiv", ignored: "Ignorerad" };
export const SIGNAL_KIND_LABELS: Record<SignalKind, string> = { number: "Tal", boolean: "Sant/falskt", text: "Text", code: "Kod" };

/** Taken (svar 4): signaler över taket räknas men sparas inte. */
export const MAX_SIGNALS_PER_SOURCE = 200;
export const MAX_SIGNALS_PER_COMPANY = 2000;
/** Senaste värdet skrivs när det ändrats (utanför dödbandet) eller högst en gång i minuten. */
export const VALUE_WRITE_INTERVAL_MS = 60_000;
export const MAX_SIGNAL_NAME_LENGTH = 80;
export const MAX_SIGNAL_UNIT_LENGTH = 20;
/** Namn som aldrig blir en signal eller ett värde (de skulle kunna ändra ett objekts prototyp i JavaScript). */
export const FORBIDDEN_NAMES = new Set(["__proto__", "constructor", "prototype"]);

export const CODE_PREFIX = "code:";
export const codeSignalKey = (code: string) => `${CODE_PREFIX}${code}`;
export const isCodeKey = (key: string) => key.startsWith(CODE_PREFIX);

type Value = number | boolean | string;
export type SignalEvent = { occurredAt: Date; type: string; code: string; severity: string; state: string | null; values: Record<string, Value> | null };
export type SeenSignal = { key: string; kind: SignalKind; seenAt: Date; value: Value | null; valueAt: Date; name?: string; unit?: string; deadband?: number };

const kindOf = (value: Value): SignalKind => (typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "text");

/**
 * Vad ett anrops godkända händelser säger om katalogen: varje kod (`code:<kod>`, värdet är läget eller nivån) och varje
 * värdenamn, med den senaste tiden och det senaste värdet. Ett namn högre i en senare händelse vinner; arrayer finns inte
 * här (intaget tar bara platta värden), så ett index blir aldrig ett signalnamn.
 */
export function signalsOfEvents(events: readonly SignalEvent[]): Map<string, SeenSignal> {
  const seen = new Map<string, SeenSignal>();
  const note = (key: string, kind: SignalKind, at: Date, value: Value | null) => {
    if (FORBIDDEN_NAMES.has(key)) return;
    const current = seen.get(key);
    if (!current) { seen.set(key, { key, kind, seenAt: at, value, valueAt: at }); return; }
    if (at.getTime() > current.seenAt.getTime()) current.seenAt = at;
    if (at.getTime() >= current.valueAt.getTime()) { current.value = value; current.valueAt = at; }
  };
  for (const event of events) {
    note(codeSignalKey(event.code), "code", event.occurredAt, event.state ?? event.severity);
    for (const [name, value] of Object.entries(event.values ?? {})) note(name, kindOf(value), event.occurredAt, value);
  }
  return seen;
}

/**
 * Vad ett rådata-anrops avläsningar (E4) säger om katalogen: samma regler som för händelserna – senaste tid och senaste
 * värde per sökväg – och profilens namn, enhet och dödband för en signal som är ny.
 */
export function signalsOfReadings(readings: readonly { key: string; kind: SignalKind; value: Value; at: Date; name?: string; unit?: string; deadband?: number }[]): Map<string, SeenSignal> {
  const seen = new Map<string, SeenSignal>();
  for (const reading of readings) {
    if (FORBIDDEN_NAMES.has(reading.key)) continue;
    const current = seen.get(reading.key);
    const extra = { ...(reading.name ? { name: reading.name.slice(0, MAX_SIGNAL_NAME_LENGTH) } : {}), ...(reading.unit ? { unit: reading.unit.slice(0, MAX_SIGNAL_UNIT_LENGTH) } : {}), ...(reading.deadband !== undefined ? { deadband: reading.deadband } : {}) };
    if (!current) { seen.set(reading.key, { key: reading.key, kind: reading.kind, seenAt: reading.at, value: reading.value, valueAt: reading.at, ...extra }); continue; }
    if (reading.at.getTime() > current.seenAt.getTime()) current.seenAt = reading.at;
    if (reading.at.getTime() >= current.valueAt.getTime()) { current.value = reading.value; current.valueAt = reading.at; }
  }
  return seen;
}

/**
 * Vad ett anrops godkända händelser säger till reglerna och drifttimmarna: varje värde och varje kod. En kod har inget värde att
 * jämföra, men den hörs: det är vad som släcker en Tystnad-regel på kodsignalen (bara den regeln går att lägga på en kod).
 */
export function readingsOfEvents(events: readonly Pick<SignalEvent, "occurredAt" | "code" | "severity" | "state" | "values">[]): { key: string; value: Value; at: Date }[] {
  return events.flatMap((event) => [
    { key: codeSignalKey(event.code), value: event.state ?? event.severity, at: event.occurredAt },
    ...Object.entries(event.values ?? {}).map(([key, value]) => ({ key, value, at: event.occurredAt })),
  ]);
}

/** Hur många nya signaler som får plats: källans och företagets tak, det minsta gäller. Ordningen är den mottagna. */
export function admitNewSignals<T>(fresh: readonly T[], counts: { source: number; company: number }) {
  const room = Math.max(0, Math.min(MAX_SIGNALS_PER_SOURCE - counts.source, MAX_SIGNALS_PER_COMPANY - counts.company));
  return { admitted: fresh.slice(0, room), ignored: Math.max(0, fresh.length - room) };
}

/**
 * Om det senaste värdet ska skrivas: alltid första gången; aldrig bakåt i tiden (en sen eller omsänd mätning flyttar inte
 * värdet bakåt); när det ändrats – för tal utanför dödbandet – eller när minuten gått.
 */
export function shouldWriteValue(input: { kind: string; deadband: number | null; previous: { value: unknown; at: Date | null } | null; next: { value: unknown; at: Date } }) {
  const { previous, next } = input;
  if (!previous || !previous.at) return true;
  if (next.at.getTime() <= previous.at.getTime()) return false;
  if (next.at.getTime() - previous.at.getTime() >= VALUE_WRITE_INTERVAL_MS) return true;
  if (input.kind === "number" && typeof next.value === "number" && typeof previous.value === "number" && input.deadband !== null)
    return Math.abs(next.value - previous.value) > input.deadband;
  return next.value !== previous.value;
}

/** En katalograd som påverkar larmkedjan: bara en aktiv signal styr objekt och scope; en upptäckt gör ingenting. */
export type CatalogueSignal = { id: string; status: string; partId: string | null };
export const steeringSignal = (signal: CatalogueSignal | null | undefined) => (signal && signal.status === "active" ? { id: signal.id, partId: signal.partId } : null);
/** En ignorerad larmkod ger ingen order (administratören har sagt att den inte betyder något). */
export const signalIgnored = (signal: CatalogueSignal | null | undefined) => signal?.status === "ignored";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
/** Namn och enhet från administratören: trimmad text utan styrtecken och inom längden; annars null. */
export function cleanSignalText(value: string, max: number): string | null {
  const text = value.trim();
  return CONTROL_CHARACTERS.test(text) || [...text].length > max ? null : text;
}

/** Signalens namn i listor: administratörens namn, annars nyckeln (för en kod "Kod <kod>"). */
export const signalLabel = (signal: { key: string; name: string }) => signal.name.trim() || (isCodeKey(signal.key) ? `Kod ${signal.key.slice(CODE_PREFIX.length)}` : signal.key);

/** Det senaste värdet som text, med enheten. */
export function signalValueText(signal: { kind: string; unit: string; lastValue: unknown }) {
  const value = signal.lastValue;
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Sant" : "Falskt";
  if (typeof value === "number") return `${String(value).replace(".", ",")}${signal.unit ? ` ${signal.unit}` : ""}`;
  return `${String(value)}${signal.unit && signal.kind !== "code" ? ` ${signal.unit}` : ""}`;
}
