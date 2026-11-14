// Integrationsmotorn E4 (2026-10-24, beslut 1 och 3): formatprofilen och tolkningen av en enhets egen JSON, som
// rena regler utan databas och utan HTTP. Profilen är data i en stängd struktur: sökvägar (namn med punkt emellan, `[*]`
// bara för posterna), ett tidsformat ur en fast lista och linjär skalning. Inga uttryck, ingen eval, inga JSONPath-bibliotek
// och inga kundskrivna reguljära uttryck. Ingen tillverkare nämns: exempelprofilen har ett generiskt namn (svar 6).
import { z } from "zod";
import { MAX_AGE_MS, MAX_FUTURE_MS, MAX_VALUE_NAME_LENGTH, MAX_VALUE_TEXT_LENGTH } from "@/lib/machine/intake";
import { FORBIDDEN_NAMES, type SignalKind } from "@/lib/machine/signals";

export const PROFILE_VERSION = 1;
/** Gränser för kroppen (utöver intagets 64 kB): djup, antal noder, nyckelnamnens längd, poster och signaler per anrop. */
export const RAW_LIMITS = { maxDepth: 8, maxNodes: 2000, maxKeyLength: 64, maxRecords: 200, maxReadings: 200, maxProfileSignals: 200 } as const;
export const TIME_FORMATS = ["iso", "unix_s", "unix_ms", "received"] as const;
export type TimeFormat = (typeof TIME_FORMATS)[number];
export const TIME_FORMAT_LABELS: Record<TimeFormat, string> = { iso: "ISO 8601 med tidszon", unix_s: "Unix-tid i sekunder", unix_ms: "Unix-tid i millisekunder", received: "Mottagningstiden (kroppen har ingen tid)" };
/** Fall c: en kropp utan egen tid spärras som hash i så här lång tid. */
export const RAW_DEDUPE_MS = 10 * 60_000;
export const RAW_SAMPLE_LIMIT = 20;
export const RAW_SAMPLE_HOURS = 24;

const SEGMENT = "[A-Za-z0-9_-]{1,40}";
const FIELD_PATH = new RegExp(`^${SEGMENT}(\\.${SEGMENT}){0,7}$`);
const RECORDS_PATH = new RegExp(`^(${SEGMENT}(\\.${SEGMENT}){0,6})\\[\\*\\]$|^${SEGMENT}(\\.${SEGMENT}){0,7}$`);
const fieldPath = z.string().regex(FIELD_PATH, "Sökvägen är namn med punkt emellan, till exempel modbus.temp.").refine((path) => !path.split(".").some((part) => FORBIDDEN_NAMES.has(part)), "Namnet är inte tillåtet.");
const finite = z.number().finite();

export const profileSignalSchema = z.object({
  path: fieldPath.refine((path) => path.length <= MAX_VALUE_NAME_LENGTH, `Signalens sökväg får vara högst ${MAX_VALUE_NAME_LENGTH} tecken.`),
  kind: z.enum(["number", "boolean", "text"]),
  name: z.string().trim().max(80).optional(),
  unit: z.string().trim().max(20).optional(),
  scale: finite.refine((value) => value !== 0, "Skalan kan inte vara 0.").optional(),
  offset: finite.optional(),
  deadband: finite.min(0).max(1e9).optional(),
}).strict();

export const profileDefinitionSchema = z.object({
  profileVersion: z.literal(PROFILE_VERSION),
  records: z.string().regex(RECORDS_PATH, "Posterna är en sökväg, med [*] sist för en lista, till exempel data[*].").refine((path) => !path.replace("[*]", "").split(".").some((part) => FORBIDDEN_NAMES.has(part)), "Namnet är inte tillåtet.").optional(),
  time: z.object({ path: fieldPath.optional(), format: z.enum(TIME_FORMATS) }).strict().refine((time) => time.format === "received" || Boolean(time.path), "Ange var tiden står, eller välj mottagningstiden.").optional(),
  id: z.object({ path: fieldPath }).strict().optional(),
  signals: z.array(profileSignalSchema).max(RAW_LIMITS.maxProfileSignals).default([]),
  discover: z.boolean().default(false),
}).strict().refine((profile) => profile.signals.length > 0 || profile.discover, "Lista minst en signal, eller slå på upptäckt.")
  .refine((profile) => new Set(profile.signals.map((signal) => signal.path)).size === profile.signals.length, "Samma sökväg finns två gånger.");
export type ProfileDefinition = z.infer<typeof profileDefinitionSchema>;

/** Workflows generiska exempel (svar 6): en router som skickar sina värden periodiskt som JSON. Inga tillverkarnamn. */
export const EXAMPLE_PROFILE_NAME = "Router med Data to Server (JSON)";
export const EXAMPLE_PROFILE: ProfileDefinition = {
  profileVersion: 1, records: "data[*]", time: { path: "ts", format: "unix_s" },
  signals: [
    { path: "di1", kind: "boolean", name: "Digital ingång 1" },
    { path: "modbus.temp", kind: "number", scale: 0.1, unit: "°C", deadband: 0.5 },
  ],
  discover: true,
};

/** Export och import: en fil med ett eget formatnamn, så att en annan JSON aldrig tas för en profil. */
export const PROFILE_FILE_FORMAT = "hintek-machine-profile";
export const profileFileSchema = z.object({ format: z.literal(PROFILE_FILE_FORMAT), name: z.string().trim().min(1).max(80), definition: z.unknown() }).strict();
export const profileFile = (name: string, definition: ProfileDefinition) => ({ format: PROFILE_FILE_FORMAT, name, definition });

/** Om profilen är fall a (id i kroppen), b (tid i kroppen) eller c (bara mottagningstiden). */
export function idempotencyCase(profile: ProfileDefinition): "a" | "b" | "c" {
  if (profile.id) return "a";
  return profile.time && profile.time.format !== "received" ? "b" : "c";
}
/** Fall a: how long a record's id is remembered, the same week an event may come late. The row's hash starts with the prefix. */
export const RAW_ID_DEDUPE_DAYS = 7;
export const RAW_ID_HASH_PREFIX = "id:";
export const IDEMPOTENCY_TEXT: Record<"a" | "b" | "c", string> = {
  a: `Kroppen har ett eget id: en omsändning inom ${RAW_ID_DEDUPE_DAYS} dagar blir ingen ny mätning.`,
  b: "Kroppen har en egen tid: en omsändning blir ingen ny mätning (värdet går aldrig bakåt i tiden).",
  c: "Kroppen har ingen egen tid: en omsändning inom 10 minuter känns igen, en senare blir en ny mätning.",
};

export type RawReject = "bad_shape" | "forbidden_name" | "too_deep" | "too_many_nodes" | "long_key" | "no_records" | "too_many_records";
export type RecordReject = "not_an_object" | "bad_time" | "time_window" | "bad_id";
export type ReadingReject = "missing" | "bad_value";
export type Reading = { key: string; kind: SignalKind; value: number | boolean | string; at: Date; name?: string; unit?: string; deadband?: number; /** The record's own id (a profile with `id`). */ recordId?: string };
export type Interpretation =
  | { ok: false; error: RawReject }
  | {
    ok: true; records: number; readings: Reading[]; recordIds: string[]; usesReceivedTime: boolean;
    rejectedRecords: { index: number; reason: RecordReject }[]; rejectedReadings: { record: number; path: string; reason: ReadingReject }[];
    /** Upptäckta värden som inte fick plats (högst 200 per anrop). */
    overLimit: number;
  };

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const isObject = (value: unknown): value is Record<string, Json> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Kroppens form före tolkningen: djup, antal noder och nyckelnamn. Ett förbjudet namn (`__proto__`, `constructor`,
 * `prototype`) någonstans nekar hela kroppen. JSON.parse gör sådana namn till vanliga egna fält, men de släpps aldrig vidare.
 */
export function checkShape(body: unknown): RawReject | null {
  let nodes = 0;
  const walk = (value: unknown, depth: number): RawReject | null => {
    nodes += 1;
    if (nodes > RAW_LIMITS.maxNodes) return "too_many_nodes";
    if (depth > RAW_LIMITS.maxDepth) return "too_deep";
    if (Array.isArray(value)) { for (const item of value) { const issue = walk(item, depth + 1); if (issue) return issue; } return null; }
    if (isObject(value)) {
      for (const key of Object.keys(value)) {
        if (FORBIDDEN_NAMES.has(key)) return "forbidden_name";
        if (key.length > RAW_LIMITS.maxKeyLength) return "long_key";
        const issue = walk(value[key], depth + 1);
        if (issue) return issue;
      }
    }
    return null;
  };
  if (!isObject(body) && !Array.isArray(body)) return "bad_shape";
  return walk(body, 0);
}

/** Ett värde på en sökväg (bara egna fält, aldrig något ur prototypen); undefined när det saknas. */
export function valueAt(root: unknown, path: string): Json | undefined {
  let current: unknown = root;
  for (const part of path.split(".")) {
    if (!isObject(current) || !Object.hasOwn(current, part)) return undefined;
    current = current[part];
  }
  return current as Json;
}

const NUMBER_TEXT = /^-?\d{1,15}(\.\d{1,12})?([eE][-+]?\d{1,3})?$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
/** Ett värde efter signalens typ: tal (också som text, "21.5"), sant/falskt (också 0/1), kort text. Annars null. */
export function readValue(raw: Json | undefined, kind: "number" | "boolean" | "text", scale = 1, offset = 0): number | boolean | string | null {
  if (kind === "number") {
    const number = typeof raw === "number" ? raw : typeof raw === "string" && NUMBER_TEXT.test(raw.trim()) ? Number(raw.trim()) : NaN;
    const scaled = number * scale + offset;
    return Number.isFinite(scaled) ? Math.round(scaled * 1e9) / 1e9 : null;
  }
  if (kind === "boolean") return typeof raw === "boolean" ? raw : raw === 0 || raw === 1 ? raw === 1 : null;
  return typeof raw === "string" && !CONTROL.test(raw) && [...raw].length <= MAX_VALUE_TEXT_LENGTH ? raw.trim() : null;
}

/** Tiden i en post, efter profilens format; null när den inte går att läsa. */
export function readTime(raw: Json | undefined, format: TimeFormat): Date | null {
  if (format === "iso") {
    if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(raw)) return null;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const number = typeof raw === "number" ? raw : typeof raw === "string" && /^\d{9,13}(\.\d{1,3})?$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isFinite(number) || number <= 0) return null;
  const date = new Date(format === "unix_s" ? number * 1000 : number);
  return Number.isNaN(date.getTime()) ? null : date;
}

const LEAF_NAME = new RegExp(`^${SEGMENT}(\\.${SEGMENT})*$`);
/** Upptäckt: varje skalärt värde i posten som inte redan är en profilsignal. Listor tolkas aldrig som namn per index. */
function discoverLeaves(record: Record<string, Json>, skip: Set<string>, reserved: Set<string>) {
  const out: { path: string; value: number | boolean | string }[] = [];
  const walk = (value: Json, path: string, depth: number) => {
    if (depth > 4) return;
    if (isObject(value)) { for (const [key, item] of Object.entries(value)) walk(item, path ? `${path}.${key}` : key, depth + 1); return; }
    if (Array.isArray(value) || value === null || !path || skip.has(path) || reserved.has(path)) return;
    if (path.length > MAX_VALUE_NAME_LENGTH || !LEAF_NAME.test(path)) return;
    if (typeof value === "string" && (CONTROL.test(value) || [...value].length > MAX_VALUE_TEXT_LENGTH)) return;
    if (typeof value === "number" && !Number.isFinite(value)) return;
    out.push({ path, value: typeof value === "string" ? value.trim() : value });
  };
  walk(record, "", 0);
  return out;
}

/**
 * Hela tolkningen av en kropp med en profil. Ett fel i kroppens form nekar allt; en post med fel tid eller id nekas för
 * sig; ett värde som inte kan tolkas ger en nekad avläsning med fast kod och resten tas emot. Inga texter ur kroppen kommer
 * ut i svaret, bara fasta koder och index.
 */
export function interpretRaw(body: unknown, profile: ProfileDefinition, now: Date): Interpretation {
  const shape = checkShape(body);
  if (shape) return { ok: false, error: shape };
  let records: Json[];
  if (profile.records) {
    const list = profile.records.endsWith("[*]");
    const found = profile.records === "[*]" ? body : valueAt(body, profile.records.replace(/\[\*\]$/, ""));
    if (found === undefined) return { ok: false, error: "no_records" };
    records = list ? (Array.isArray(found) ? found : []) : [found];
    if (list && !Array.isArray(found)) return { ok: false, error: "no_records" };
  } else records = Array.isArray(body) ? body as Json[] : [body as Json];
  if (records.length > RAW_LIMITS.maxRecords) return { ok: false, error: "too_many_records" };
  const format = profile.time?.format ?? "received";
  const listed = new Set(profile.signals.map((signal) => signal.path));
  const reserved = new Set([profile.time?.path, profile.id?.path].filter((path): path is string => Boolean(path)));
  const readings: Reading[] = [];
  const recordIds: string[] = [];
  const rejectedRecords: { index: number; reason: RecordReject }[] = [];
  const rejectedReadings: { record: number; path: string; reason: ReadingReject }[] = [];
  let overLimit = 0;
  records.forEach((record, index) => {
    if (!isObject(record)) { rejectedRecords.push({ index, reason: "not_an_object" }); return; }
    const at = format === "received" ? now : readTime(profile.time?.path ? valueAt(record, profile.time.path) : undefined, format);
    if (!at) { rejectedRecords.push({ index, reason: "bad_time" }); return; }
    const diff = at.getTime() - now.getTime();
    if (diff > MAX_FUTURE_MS || -diff > MAX_AGE_MS) { rejectedRecords.push({ index, reason: "time_window" }); return; }
    let recordId: string | undefined;
    if (profile.id) {
      const id = valueAt(record, profile.id.path);
      if ((typeof id !== "string" && typeof id !== "number") || String(id).length < 1 || String(id).length > 128) { rejectedRecords.push({ index, reason: "bad_id" }); return; }
      recordId = String(id);
      // The same id twice in one body is one measurement: the first counts.
      if (recordIds.includes(recordId)) return;
      recordIds.push(recordId);
    }
    const push = (reading: Reading) => { if (readings.length < RAW_LIMITS.maxReadings) readings.push(recordId === undefined ? reading : { ...reading, recordId }); else overLimit += 1; };
    for (const signal of profile.signals) {
      const raw = valueAt(record, signal.path);
      if (raw === undefined || raw === null) { rejectedReadings.push({ record: index, path: signal.path, reason: "missing" }); continue; }
      const value = readValue(raw, signal.kind, signal.scale, signal.offset);
      if (value === null) { rejectedReadings.push({ record: index, path: signal.path, reason: "bad_value" }); continue; }
      push({ key: signal.path, kind: signal.kind, value, at, ...(signal.name ? { name: signal.name } : {}), ...(signal.unit ? { unit: signal.unit } : {}), ...(signal.deadband !== undefined ? { deadband: signal.deadband } : {}) });
    }
    if (profile.discover) for (const leaf of discoverLeaves(record, listed, reserved))
      push({ key: leaf.path, kind: typeof leaf.value === "number" ? "number" : typeof leaf.value === "boolean" ? "boolean" : "text", value: leaf.value, at });
  });
  return { ok: true, records: records.length, readings, recordIds, usesReceivedTime: format === "received", rejectedRecords, rejectedReadings, overLimit };
}


/** Svarstexterna för ett nekat anrop: fasta, aldrig text ur kroppen. */
export const RAW_ERROR_TEXT: Record<RawReject | "invalid_json" | "no_profile" | "bad_profile", string> = {
  invalid_json: "Kroppen är inte giltig JSON.",
  bad_shape: "Kroppen ska vara ett JSON-objekt eller en lista.",
  forbidden_name: "Kroppen har ett namn som inte är tillåtet (__proto__, constructor eller prototype).",
  too_deep: `Kroppen är för djup (högst ${RAW_LIMITS.maxDepth} nivåer).`,
  too_many_nodes: `Kroppen har för många delar (högst ${RAW_LIMITS.maxNodes}).`,
  long_key: `Ett namn i kroppen är för långt (högst ${RAW_LIMITS.maxKeyLength} tecken).`,
  no_records: "Posterna finns inte där profilen säger.",
  too_many_records: `Kroppen har för många poster (högst ${RAW_LIMITS.maxRecords}).`,
  no_profile: "Källan har ingen formatprofil. Välj en profil, eller slå på Fånga prov för att spara kroppen.",
  bad_profile: "Källans formatprofil är inte giltig. Spara om den.",
};
