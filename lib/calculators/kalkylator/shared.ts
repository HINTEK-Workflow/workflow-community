import { NEUTRAL_VOLTAGE_FACTOR, SUGGESTED_REACTANCE_OHM_PER_M, tripCurrentOnCurve, type CurveMethod, type CurvePoint, type Warning } from "../engine";
import { chosenCableType, companyFallback, REFERENCE_TEMPERATURE, temperatureInput as conductorTemperatureInput } from "../conductor";
import { deviceCurvePoints, DEVICE_LABEL, DEVICE_TYPES, deviceTripFor, type CompanyCalcData, type DeviceType, type ProtectiveDevice } from "../company-data";
import { formatNumber } from "../number";
import type { CalcInput, CalcModule, Choices, ComputeOutcome, Fallback, Note, OutputQuantity, OutputVerdict, Origin } from "../types";
import type { Dimension } from "../units";

/**
 * What the calculators of the Kalkylator share (2026-10-12): the notes from the engine, the common fields (the
 * protective device, the conductor's reactance, the voltage factor and the temperatures) and small helpers for result
 * rows. The engine does the calculating (lib/calculators/engine); the modules here only read fields and write rows,
 * steps and notes. Nothing here is a table or a limit (2026-11-01): a protective device's Ia, the voltage factor
 * and the conductor temperatures are the person's or the company's own values; without them Ia is asked for and the
 * others take the neutral choice (c = 1,0, 20 °C), which the result says. The one suggestion left, a typical reactance,
 * is marked "Förslag" in the field and in the result.
 */
export const COMPANY_VALUES_LINK = { label: "Värden och referenser", view: "company_values" } as const;

/** The engine's warnings as notes in plain text. */
export const warningNotes = (warnings: readonly Warning[]): Note[] => warnings.map((warning) => ({ tone: "warn", text: warning.message }));

/** The engine's errors as an invalid outcome; a code with a field in `fields` marks that field. */
export function failure(errors: readonly Warning[], fields: Readonly<Record<string, string>> = {}): ComputeOutcome {
  return { status: "invalid", errors: errors.map((error) => ({ field: fields[error.code], message: error.message })) };
}

export const quantity = (id: string, label: string, value: number, dimension: Dimension, extra: Partial<Omit<OutputQuantity, "kind" | "id" | "label" | "value" | "dimension">> = {}): OutputQuantity =>
  ({ kind: "quantity", id, label, value, dimension, derived: true, ...extra });
export const verdict = (id: string, label: string, ok: boolean, text: string): OutputVerdict => ({ kind: "verdict", id, label, text, tone: ok ? "ok" : "alarm" });

/**
 * Does the circuit meet the requirement (2026-10-12)? With Ia from a suggestion the answer is "Klarar kravet · baserat på
 * förslag" in the warning colour, never green: green only when Ia is the person's own or the company's value. The first words
 * before the colon are what the phone's result bar shows.
 */
export function requirementVerdict(id: string, label: string, ok: boolean, tripOrigin: Origin | undefined, detail: string): OutputVerdict {
  const suggested = tripOrigin === "suggestion";
  const head = `${ok ? "Klarar kravet" : "Klarar inte kravet"}${suggested ? " · baserat på förslag" : ""}`;
  return { kind: "verdict", id, label, text: `${head}: ${detail}`, tone: ok ? (suggested ? "warn" : "ok") : "alarm" };
}

const ORIGIN_WORD: Record<Origin, string> = { user: "", company: "företagets värde", suggestion: "förslag", default: "" };
/** " (förslag)" for the end of a sentence, when a number came from a suggestion or the company. */
export const originSuffix = (origin: Origin | undefined) => (origin && ORIGIN_WORD[origin] ? ` (${ORIGIN_WORD[origin]})` : "");

/** A note that says a figure in the calculation is a suggestion (or the company's), so it is never used unseen. */
export function suggestionNote(origins: Readonly<Record<string, Origin>>, ids: Readonly<Record<string, string>>): Note[] {
  const labels = Object.entries(ids).filter(([id]) => origins[id] === "suggestion").map(([, label]) => label);
  if (!labels.length) return [];
  const named = labels.map((label, index) => (index === 0 ? label : label.charAt(0).toLowerCase() + label.slice(1)));
  const list = named.length < 2 ? named.join("") : `${named.slice(0, -1).join(", ")} och ${named[named.length - 1]}`;
  return [{ tone: "info", text: `${list} ${labels.length === 1 ? "är ett förslag" : "är förslag"}. Ersätt ${labels.length === 1 ? "det" : "dem"} med egna värden i fälten, eller lägg in företagets egna under`, link: COMPANY_VALUES_LINK }];
}

/* ---- Fields several calculators use ---- */

/**
 * A protective device's curve (KA4, 2026-11-01): the rows of Mina skyddsapparater with one type and rated current. A fuse
 * melts along a smooth curve, so between two points the line on log–log axes is read. Everything else takes the safe side
 * (lib/calculators/engine/device-curve.ts): a breaker's curve has a step that a line would hide, and "Annat skydd" is unknown.
 */
export const curveMethodFor = (type: DeviceType): CurveMethod => (type === "gg" ? "logLog" : "safeSide");
const pointsOf = (rows: readonly ProtectiveDevice[]): CurvePoint[] => rows.map((row) => ({ timeS: row.timeS, tripA: row.tripA }));
/** The company's points for the device as a curve; null with fewer than two points. */
export function deviceCurve(company: CompanyCalcData, type: string, ratedA: number | undefined): CurvePoint[] | null {
  if (ratedA === undefined || !DEVICE_TYPES.includes(type as DeviceType)) return null;
  const rows = deviceCurvePoints(company.devices, type as DeviceType, ratedA);
  return rows.length >= 2 ? pointsOf(rows) : null;
}
export type CompanyTrip = { tripA: number; source: string; /** Read between two of the company's points: which, so the result can say it. */ between: { shorterS: number; longerS: number; method: CurveMethod } | null };
/** The company's Ia for a device, rated current and time: the exact row, otherwise read from its curve. Never outside the points. */
export function companyTrip(company: CompanyCalcData, type: DeviceType, ratedA: number, timeS: number): CompanyTrip | undefined {
  const own = deviceTripFor(company.devices, type, ratedA, timeS);
  if (own) return { tripA: own.tripA, source: own.source, between: null };
  const rows = deviceCurvePoints(company.devices, type, ratedA);
  if (rows.length < 2) return undefined;
  const method = curveMethodFor(type);
  const found = tripCurrentOnCurve(pointsOf(rows), timeS, method);
  return found ? { tripA: found.tripA, source: rows[0]!.source, between: { shorterS: found.shorter.timeS, longerS: found.longer.timeS, method } } : undefined;
}
const betweenWords = (between: NonNullable<CompanyTrip["between"]>) => between.method === "logLog"
  ? `mellan företagets punkter ${formatNumber(between.shorterS)} s och ${formatNumber(between.longerS)} s`
  : `från företagets punkt ${formatNumber(between.shorterS)} s (säkra sidan)`;
/** The note when Ia was read from the company's curve and not from a row for the required time. */
export function curveTripNote(origins: Readonly<Record<string, Origin>>, choices: Readonly<Choices>, numbers: Readonly<Record<string, number | undefined>>, company: CompanyCalcData): Note[] {
  if (origins.trip !== "company" || numbers.rated === undefined || numbers.time === undefined) return [];
  const found = companyTrip(company, choices.device as DeviceType, numbers.rated, numbers.time);
  return found?.between ? [{ tone: "info", text: `Ia är läst ${betweenWords(found.between)} på kurvan. En rad för just kravtiden går före.` }] : [];
}

export const DEVICE_CHOICES = DEVICE_TYPES.map((type) => ({ value: type, label: type === "gg" ? "gG (säkring)" : type === "annan" ? "Annat" : type.toUpperCase() }));
export const DEVICE_PLACEHOLDER = "Välj skyddsapparat";
const deviceChosen = (choices: Choices) => choices.device !== "";
/** What the Ia field says about where the value comes from: the standard's designation only, never its numbers (2026-11-01). */
export const TRIP_HELP = "Ia enligt tillverkarens tid–strömkurva / SS-EN 60898-1 – värdet anges av företaget. Tomt fält: företagets egen skyddsapparat (Mina skyddsapparater), annars skriver du in Ia.";

/**
 * The protective device: its type, rated current In, the required time and the current Ia that trips it within that time.
 * The type is a choice the person must make (2026-10-12). Ia comes only from the company's own list (Mina
 * skyddsapparater) or is typed (2026-11-01): no multiple of In is suggested for any curve, and without Ia the
 * calculator asks for it instead of answering. The field says so in words instead of an example figure.
 */
export function deviceInputs(group: string): CalcInput[] {
  return [
    { kind: "choice", id: "device", label: "Skyddsapparat", options: DEVICE_CHOICES, initial: "", placeholder: DEVICE_PLACEHOLDER, display: "select", group },
    { kind: "number", id: "rated", label: "Märkström In", dimension: "current", required: true, min: 0, minExclusive: true, usual: [0.5, 5000], group, example: "16" },
    { kind: "number", id: "time", label: "Kravtid", dimension: "time", required: true, min: 0, minExclusive: true, usual: [0.001, 3600], group, example: "0,4", help: "Den tid som skyddet har på sig att koppla från." },
    {
      kind: "number", id: "trip", label: "Utlösningsström Ia för kravtiden", dimension: "current", required: true, min: 0, minExclusive: true, group, placeholder: "Tillverkarens tabell", showIf: deviceChosen,
      fallback: (choices, ctx, numbers = {}) => {
        const rated = numbers.rated;
        const time = numbers.time;
        if (rated === undefined || time === undefined) return undefined;
        const own = companyTrip(ctx.company, choices.device as DeviceType, rated, time);
        if (!own) return undefined;
        const words = own.between ? `Företagets kurva, läst ${betweenWords(own.between)}` : "Företagets värde";
        return { value: own.tripA, origin: "company", note: own.source ? `${words} (${own.source})` : words };
      },
      help: TRIP_HELP,
    },
  ];
}
export const deviceName = (type: string) => DEVICE_LABEL[type as DeviceType] ?? type;

/** Reactance per length: the person's, the chosen cable type's, the company's or a suggestion (0,08 Ω/km), in that order. */
export const reactanceInput = (group: string, options: { id?: string; typeId?: string; showIf?: (choices: Choices) => boolean } = {}): CalcInput => ({
  kind: "number", id: options.id ?? "reactance", label: "Reaktans per längd", dimension: "perLength", min: 0, group, showIf: options.showIf,
  fallback: (choices, ctx) => {
    const type = options.typeId ? chosenCableType(choices, ctx.company, options.typeId) : undefined;
    if (type?.reactancePerM !== undefined) return { value: type.reactancePerM, origin: "company", note: `Kabeltypen ${type.name}${type.source ? ` (${type.source})` : ""}` };
    return companyFallback(ctx.company.reactancePerM) ?? { value: SUGGESTED_REACTANCE_OHM_PER_M, origin: "suggestion", note: "Förslag, 0,08 Ω/km (samma som 0,08 mΩ/m)" };
  },
  help: "Kabelns reaktans enligt databladet. Tomt fält: företagets värde, annars ett typiskt värde (förslag).",
});
/** `undefined` for a suggestion, so the engine says in words that it is one. */
export const reactanceFor = (numbers: Readonly<Record<string, number | undefined>>, origins: Readonly<Record<string, Origin>>, id = "reactance") => (origins[id] === "suggestion" ? undefined : numbers[id]);

/* ---- The company's cable types and parallel conductors (KA4, 2026-11-01) ---- */

/** The choice that means "I give the cable's values myself". */
export const OWN_CABLE = "own";
/** The company's cable types as a list; not drawn while the company has none. */
export const cableTypeInput = (id: string, group: string, showIf?: (choices: Choices) => boolean): CalcInput => ({
  kind: "choice", id, label: "Kabeltyp", group, showIf, initial: OWN_CABLE, display: "select", hideWhenSingle: true,
  options: (ctx) => [{ value: OWN_CABLE, label: "Egna värden" }, ...ctx.company.cableTypes.map((type) => ({ value: type.id, label: type.name }))],
  help: "Företagets kabeltyp fyller i area, material, resistans och reaktans.",
});
/** An area field's value from the chosen cable type. */
export const cableAreaFallback = (typeId: string) => (choices: Choices, ctx: { company: CompanyCalcData }): Fallback | undefined => {
  const type = chosenCableType(choices, ctx.company, typeId);
  return type ? { value: type.areaMm2, origin: "company", note: `Kabeltypen ${type.name}` } : undefined;
};
const PARALLEL_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const countOptions = PARALLEL_COUNTS.map((count) => ({ value: String(count), label: String(count) }));
export const parallelInput = (id: string, group: string, showIf?: (choices: Choices) => boolean): CalcInput => ({
  kind: "choice", id, label: "Parallella ledare per fas", group, showIf, initial: "1", display: "select", options: countOptions,
  help: "Lika ledare delar resistans och reaktans med antalet.",
});
export const parallelOf = (choices: Readonly<Choices>, id: string) => Math.max(1, Number(choices[id] ?? "1") || 1);
const SAME_AS_PHASE = "same";
/** Protective conductors in parallel: only asked when the phase has several. */
export const returnParallelInput = (id: string, group: string, parallelId: string, showIf?: (choices: Choices) => boolean): CalcInput => ({
  kind: "choice", id, label: "Parallella skyddsledare", group, initial: SAME_AS_PHASE, display: "select",
  showIf: (choices) => parallelOf(choices, parallelId) > 1 && (!showIf || showIf(choices)),
  options: [{ value: SAME_AS_PHASE, label: "Samma som fasledarna" }, ...countOptions],
  help: "Ingår i slingan vid jordfel.",
});
/** The count chosen; undefined when the phase has one conductor or the same count was chosen, and the engine then follows the phase. */
export function returnParallelOf(choices: Readonly<Choices>, id: string, parallelId: string): number | undefined {
  if (parallelOf(choices, parallelId) === 1) return 1;
  const chosen = choices[id];
  return !chosen || chosen === SAME_AS_PHASE ? undefined : Math.max(1, Number(chosen) || 1);
}

/*
 * The voltage factor c and the conductor temperatures (2026-11-01) are the company's values (Värden och
 * referenser) or typed; no number from a standard is built in. Without one the calculation takes the neutral choice –
 * c = 1,0 and 20 °C, no temperature correction – marked as "default", and `neutralNote` says so under the result.
 */
const NEUTRAL_HINT = "ange företagets värde";
const neutralC = (): Fallback => ({ value: NEUTRAL_VOLTAGE_FACTOR, origin: "default", note: `${formatNumber(NEUTRAL_VOLTAGE_FACTOR)} (neutralt) – ${NEUTRAL_HINT}` });
const neutralTemperature = (): Fallback => ({ value: REFERENCE_TEMPERATURE, origin: "default", note: `${REFERENCE_TEMPERATURE} °C – ${NEUTRAL_HINT}` });

/** The voltage factor c: the person's, the company's or the neutral 1,0. */
export const cFactorInput = (id: string, label: string, which: "largest" | "smallest", group: string, help?: string): CalcInput => ({
  kind: "number", id, label, dimension: "ratio", min: 0, minExclusive: true, max: 10, group,
  help: help ?? "T.ex. enligt IEC 60909-0 – värdet anges av företaget. Tomt fält: företagets värde, annars 1,0.",
  fallback: (_choices, ctx) => companyFallback(which === "largest" ? ctx.company.cMax : ctx.company.cMin) ?? neutralC(),
});

/** The conductor's operating temperature for Spänningsfall and Kabeldimensionering: the person's, the company's or 20 °C. */
export const operatingTemperatureInput = (group: string): CalcInput => conductorTemperatureInput(group, {
  fallback: (_choices, ctx) => companyFallback(ctx.company.tempOperating) ?? neutralTemperature(),
  help: "Ledarens temperatur i drift; resistansen rättas efter den. Tomt fält: företagets värde, annars 20 °C (ingen temperaturrättning).",
});

/** A conductor temperature for the largest or the smallest short-circuit current: the person's, the company's or 20 °C. */
export const temperatureInput = (id: string, label: string, which: "largest" | "smallest", group: string): CalcInput => ({
  kind: "number", id, label, dimension: "temperature", min: -60, max: 500, group, usual: [-40, 250],
  fallback: (_choices, ctx) => companyFallback(which === "largest" ? ctx.company.tempMax : ctx.company.tempMin) ?? neutralTemperature(),
  help: "Tomt fält: företagets värde, annars 20 °C (ingen temperaturrättning).",
});

/**
 * The note under a result when a company value was missing and the neutral choice was used: "Räknat med 1,0 för
 * spänningsfaktorn c och 20 °C för ledartemperaturen – ange företagets värden under Värden och referenser."
 * `labels` names each field (id → "spänningsfaktorn c"); only fields whose value is the neutral default are listed.
 */
export function neutralNote(origins: Readonly<Record<string, Origin>>, numbers: Readonly<Record<string, number | undefined>>, labels: Readonly<Record<string, { name: string; unit?: string }>>): Note[] {
  const parts = Object.entries(labels).filter(([id]) => origins[id] === "default" && numbers[id] !== undefined)
    .map(([id, label]) => `${formatNumber(numbers[id]!)}${label.unit ? ` ${label.unit}` : ""} för ${label.name}`);
  if (!parts.length) return [];
  const list = parts.length < 2 ? parts[0] : `${parts.slice(0, -1).join(", ")} och ${parts[parts.length - 1]}`;
  return [{ tone: "missing", text: `Räknat med ${list} eftersom inget värde är angivet – ange ${parts.length === 1 ? "företagets värde" : "företagets värden"} under`, link: COMPANY_VALUES_LINK }];
}

/** The module's example as the page's "Fyll i exempel" button needs it. */
export type Example = NonNullable<CalcModule["example"]>;
