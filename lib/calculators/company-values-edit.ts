import { AMPACITY_MATERIALS, AMPACITY_MAX_ROWS, AMPACITY_SLOTS, ampacityKey, CABLE_TYPE_MAX_ROWS, CABLE_TYPE_NAME_MAX, cableTypeKey, cableTypeKeyParts, CALC_KEYS, CALC_KEY_PREFIX, DEVICE_LABEL, DEVICE_MAX_ROWS, DEVICE_TYPES, deviceKey, isCableTypeKey, isDeviceKey, type AmpacityMaterial, type CalcSingleKey, type DeviceType } from "./company-data";
import { curveFalls } from "./engine/device-curve";
import { formatNumber, inputText, parseDecimal } from "./number";
import type { CompanyValue, CompanyValueInput } from "@/lib/workflow/company-values";

/**
 * Editing the calculators' values under Värden och referenser (2026-10-07), as plain functions: what the panel
 * shows from the stored rows, and which rows a save writes. The panel keeps one text per field; nothing is converted
 * until the person saves, and a row is only written when it changed.
 *
 * The single values (reactance, limit, voltage factors, temperatures) share one source and version, since a company
 * usually takes them from the same routine; every row of one table shares the table's source and version, and so does the
 * list of cable types share one source (a row's version field holds the type's name, see company-data.ts).
 */
export type SingleField = { key: CalcSingleKey; label: string; unit: string; help: string; accept: (value: number) => string | null };
const between = (min: number, max: number, text: string) => (value: number) => (value < min || value > max ? text : null);
export const SINGLE_FIELDS: readonly SingleField[] = [
  { key: CALC_KEYS.reactance, label: "Reaktans per längd", unit: "mΩ/m", help: "Företagets kablar enligt databladet. Förval i Spänningsfall, Kortslutning, Största gruppledningslängd och Kabeldimensionering. Samma tal som Ω/km. Utan värde räknas med ett typiskt värde, 0,08 Ω/km.", accept: between(0, 999, "Reaktansen ligger mellan 0 och 999.") },
  { key: CALC_KEYS.dropLimit, label: "Gräns för spänningsfall", unit: "%", help: "Procent av märkspänningen, t.ex. enligt SS 436 40 00 – värdet anges av företaget. Används för jämförelsen i Spänningsfall och Kabeldimensionering.", accept: (value) => (value > 0 && value <= 100 ? null : "Gränsen är större än 0 och högst 100 %.") },
  { key: CALC_KEYS.cMax, label: "Spänningsfaktor c, största kortslutningsström", unit: "", help: "T.ex. enligt IEC 60909-0 – värdet anges av företaget. Används i Kortslutning. Utan värde används 1,0, och det står i resultatet.", accept: (value) => (value > 0 && value < 10 ? null : "Spänningsfaktorn är större än 0 och mindre än 10.") },
  { key: CALC_KEYS.cMin, label: "Spänningsfaktor c, minsta kortslutningsström", unit: "", help: "T.ex. enligt IEC 60909-0 – värdet anges av företaget. Används i Kortslutning, Frånkopplingstid och Största gruppledningslängd. Utan värde används 1,0, och det står i resultatet.", accept: (value) => (value > 0 && value < 10 ? null : "Spänningsfaktorn är större än 0 och mindre än 10.") },
  { key: CALC_KEYS.tempMax, label: "Ledartemperatur, största kortslutningsström", unit: "°C", help: "Används i Kortslutning. Utan värde räknas med 20 °C och resultatet säger det.", accept: between(-60, 500, "Temperaturen ligger mellan -60 och 500 °C.") },
  { key: CALC_KEYS.tempMin, label: "Ledartemperatur, minsta kortslutningsström", unit: "°C", help: "Används i Kortslutning och Största gruppledningslängd. Utan värde räknas med 20 °C och resultatet säger det.", accept: between(-60, 500, "Temperaturen ligger mellan -60 och 500 °C.") },
  { key: CALC_KEYS.tempOperating, label: "Ledartemperatur i drift", unit: "°C", help: "Används i Spänningsfall och Kabeldimensionering. Utan värde räknas med 20 °C och resultatet säger det.", accept: between(-60, 500, "Temperaturen ligger mellan -60 och 500 °C.") },
  { key: CALC_KEYS.kTempStart, label: "Ledartemperatur före kortslutning (för k)", unit: "°C", help: "Enligt kabelns datablad. Används för konstanten k i Kabeldimensionering. Utan värde (och utan eget k) kontrolleras inte kortslutningsståligheten.", accept: between(-60, 500, "Temperaturen ligger mellan -60 och 500 °C.") },
  { key: CALC_KEYS.kTempEnd, label: "Högsta ledartemperatur vid kortslutning (för k)", unit: "°C", help: "Enligt kabelns datablad. Används för konstanten k i Kabeldimensionering. Utan värde (och utan eget k) kontrolleras inte kortslutningsståligheten.", accept: between(-60, 1000, "Temperaturen ligger mellan -60 och 1000 °C.") },
];

export type RowDraft = { area: string; amps: string };
export type TableDraft = { slot: number; source: string; reference: string; cu: RowDraft[]; al: RowDraft[] };
/** A row of "Mina skyddsapparater": the device type, rated current In (A), the required time (s) and the current Ia (A) that trips it within that time. */
export type DeviceRowDraft = { type: DeviceType; rated: string; time: string; trip: string };
export type DevicesDraft = { source: string; reference: string; rows: DeviceRowDraft[] };
/** A row of the company's cable types (KA4): what the company itself enters; resistance and reactance in Ω/km. */
export type CableTypeDraft = { name: string; material: AmpacityMaterial; area: string; resistance: string; reactance: string };
export type CableTypesDraft = { source: string; rows: CableTypeDraft[] };
export type PanelModel = { singles: Record<string, string>; singleSource: string; singleReference: string; tables: TableDraft[]; devices: DevicesDraft; cableTypes: CableTypesDraft };

const numberText = (value: number | null | undefined) => (value === null || value === undefined ? "" : inputText(value));
const byKey = (values: readonly CompanyValue[]) => new Map(values.map((value) => [value.key, value]));
const ampacityPrefix = (slot: number, material: AmpacityMaterial) => `${CALC_KEY_PREFIX}iz.${slot}.${material}.`;

/** What the panel starts from: the stored single values and the tables that have rows (and always table 1). */
export function modelFromValues(values: readonly CompanyValue[]): PanelModel {
  const rows = byKey(values);
  const singles: Record<string, string> = {};
  let singleSource = "";
  let singleReference = "";
  for (const field of SINGLE_FIELDS) {
    const row = rows.get(field.key);
    singles[field.key] = row ? numberText(row.high ?? row.low) : "";
    if (row) { singleSource ||= row.source; singleReference ||= row.reference; }
  }
  const tables: TableDraft[] = [];
  for (let slot = 1; slot <= AMPACITY_SLOTS; slot++) {
    const table: TableDraft = { slot, source: "", reference: "", cu: [], al: [] };
    let any = false;
    for (const material of AMPACITY_MATERIALS) {
      const found = values.filter((row) => row.key.startsWith(ampacityPrefix(slot, material)) && row.low !== null && row.high !== null).sort((a, b) => a.low! - b.low!);
      for (const row of found) {
        table[material].push({ area: numberText(row.low), amps: numberText(row.high) });
        table.source ||= row.source;
        table.reference ||= row.reference;
        any = true;
      }
    }
    if (any || slot === 1) tables.push(table);
  }
  const devices: DevicesDraft = { source: "", reference: "", rows: [] };
  const deviceRows = values.filter((row) => isDeviceKey(row.key) && row.low !== null && row.high !== null);
  const parts = (row: CompanyValue) => /^kabel\.ia\.([a-z]+)\.[^.]+\.([^.]+)$/.exec(row.key)!;
  const timeOf = (row: CompanyValue) => Number(parts(row)[2].replace("_", "."));
  deviceRows.sort((a, b) => DEVICE_TYPES.indexOf(parts(a)[1] as DeviceType) - DEVICE_TYPES.indexOf(parts(b)[1] as DeviceType) || a.low! - b.low! || timeOf(a) - timeOf(b));
  for (const row of deviceRows) {
    devices.rows.push({ type: parts(row)[1] as DeviceType, rated: numberText(row.low), time: numberText(timeOf(row)), trip: numberText(row.high) });
    devices.source ||= row.source;
    devices.reference ||= row.reference;
  }
  const cableTypes: CableTypesDraft = { source: "", rows: [] };
  const typeRows = values.flatMap((row) => { const parts = cableTypeKeyParts(row.key); return parts && row.high !== null ? [{ row, parts }] : []; }).sort((a, b) => a.parts.slot - b.parts.slot);
  for (const { row, parts } of typeRows) {
    cableTypes.rows.push({ name: row.reference, material: parts.material, area: numberText(parts.area), resistance: numberText(row.high), reactance: numberText(row.warnHigh) });
    cableTypes.source ||= row.source;
  }
  return { singles, singleSource, singleReference, tables, devices, cableTypes };
}

export const sameModel = (a: PanelModel, b: PanelModel) => JSON.stringify(a) === JSON.stringify(b);

/** The lowest table number that is not in use, or null when all of them are. */
export const freeSlot = (model: PanelModel): number | null => {
  for (let slot = 1; slot <= AMPACITY_SLOTS; slot++) if (!model.tables.some((table) => table.slot === slot)) return slot;
  return null;
};

/** Rows pasted from a spreadsheet: each line with at least two numbers, area first and current second. */
export function parsePastedRows(text: string): { rows: RowDraft[]; skipped: number } {
  const rows: RowDraft[] = [];
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    // The first two numbers of the line, whatever separates them (tab, semicolon, spaces) and whatever text surrounds them.
    const numbers = (line.match(/\d+(?:[.,]\d+)?/g) ?? []).map((part) => Number(part.replace(",", ".")));
    if (numbers.length < 2 || numbers[0] <= 0 || numbers[1] <= 0) { skipped++; continue; }
    rows.push({ area: numberText(numbers[0]), amps: numberText(numbers[1]) });
  }
  return { rows, skipped };
}

/** Rows added to a list: one with the same area is replaced, the list is kept in order of area. */
export function mergeRows(current: readonly RowDraft[], added: readonly RowDraft[]): RowDraft[] {
  const areaOf = (row: RowDraft) => { const parsed = parseDecimal(row.area); return parsed.state === "ok" ? parsed.value : Number.POSITIVE_INFINITY; };
  const merged = [...current.filter((row) => !added.some((item) => areaOf(item) === areaOf(row) && Number.isFinite(areaOf(row)))), ...added];
  return merged.sort((a, b) => areaOf(a) - areaOf(b));
}

const MATERIAL_NAME: Record<AmpacityMaterial, string> = { cu: "koppar", al: "aluminium" };
type Row = CompanyValueInput;
const fieldsOf = (row: { low: number | null; high: number | null; source: string; reference: string }) => JSON.stringify([row.low, row.high, row.source, row.reference]);

/**
 * The rows a save writes – only those that changed – or what is wrong. A row left empty is removed (the server removes
 * a row with no numbers and no source), and a row the company never filled in stays absent.
 */
export function saveInputs(values: readonly CompanyValue[], model: PanelModel): { inputs: Row[] } | { error: string } {
  const stored = byKey(values);
  const inputs: Row[] = [];
  const source = model.singleSource.trim().slice(0, 300);
  const reference = model.singleReference.trim().slice(0, 120);
  for (const field of SINGLE_FIELDS) {
    const text = model.singles[field.key] ?? "";
    const parsed = parseDecimal(text);
    const existing = stored.get(field.key);
    if (parsed.state === "invalid") return { error: `${field.label}: skriv värdet som ett tal, till exempel 0,08.` };
    if (parsed.state === "empty") {
      if (existing) inputs.push({ key: field.key, low: null, high: null, warnLow: null, warnHigh: null, source: "", reference: "", version: existing.version });
      continue;
    }
    const problem = field.accept(parsed.value);
    if (problem) return { error: `${field.label}: ${problem}` };
    const next = { low: null, high: parsed.value, source, reference };
    if (!existing || fieldsOf(existing) !== fieldsOf(next)) inputs.push({ key: field.key, ...next, warnLow: null, warnHigh: null, version: existing?.version });
  }
  for (const table of model.tables) {
    const tableSource = table.source.trim().slice(0, 300);
    const tableReference = table.reference.trim().slice(0, 120);
    for (const material of AMPACITY_MATERIALS) {
      const where = `Tabell ${table.slot}, ${MATERIAL_NAME[material]}`;
      const wanted = new Map<string, { area: number; amps: number }>();
      const drafts = table[material];
      if (drafts.length > AMPACITY_MAX_ROWS) return { error: `${where}: högst ${AMPACITY_MAX_ROWS} rader.` };
      for (const draft of drafts) {
        const area = parseDecimal(draft.area);
        const amps = parseDecimal(draft.amps);
        if (area.state === "empty" && amps.state === "empty") continue;
        if (area.state !== "ok" || amps.state !== "ok") return { error: `${where}: fyll i både area och belastbarhet som tal på varje rad.` };
        if (area.value <= 0 || area.value > 10000 || amps.value <= 0 || amps.value > 100000) return { error: `${where}: area och belastbarhet ska vara större än noll.` };
        const key = ampacityKey(table.slot, material, area.value);
        if (wanted.has(key)) return { error: `${where}: arean ${formatNumber(area.value)} mm² finns två gånger.` };
        wanted.set(key, { area: Math.round(area.value * 1000) / 1000, amps: amps.value });
      }
      for (const [key, row] of wanted) {
        const next = { low: row.area, high: row.amps, source: tableSource, reference: tableReference };
        const existing = stored.get(key);
        if (!existing || fieldsOf(existing) !== fieldsOf(next)) inputs.push({ key, ...next, warnLow: null, warnHigh: null, version: existing?.version });
      }
      for (const existing of values) {
        if (existing.key.startsWith(ampacityPrefix(table.slot, material)) && !wanted.has(existing.key)) inputs.push({ key: existing.key, low: null, high: null, warnLow: null, warnHigh: null, source: "", reference: "", version: existing.version });
      }
    }
  }
  // The company's protective devices: one row per type, rated current and time; a row taken away is removed.
  const deviceSource = (model.devices?.source ?? "").trim().slice(0, 300);
  const deviceReference = (model.devices?.reference ?? "").trim().slice(0, 120);
  const wantedDevices = new Map<string, { rated: number; time: number; trip: number }>();
  const deviceDrafts = model.devices?.rows ?? [];
  if (deviceDrafts.length > DEVICE_MAX_ROWS) return { error: `Skyddsapparater: högst ${DEVICE_MAX_ROWS} rader.` };
  for (const draft of deviceDrafts) {
    const rated = parseDecimal(draft.rated);
    const time = parseDecimal(draft.time);
    const trip = parseDecimal(draft.trip);
    if (rated.state === "empty" && time.state === "empty" && trip.state === "empty") continue;
    const where = `Skyddsapparater, ${DEVICE_LABEL[draft.type]}`;
    if (rated.state !== "ok" || time.state !== "ok" || trip.state !== "ok") return { error: `${where}: fyll i märkström, tid och utlösningsström som tal på varje rad.` };
    if (rated.value <= 0 || rated.value > 100000 || time.value <= 0 || time.value > 10000 || trip.value <= 0 || trip.value > 10000000) return { error: `${where}: märkström, tid och utlösningsström ska vara större än noll.` };
    const key = deviceKey(draft.type, rated.value, time.value);
    if (wantedDevices.has(key)) return { error: `${where}: ${formatNumber(rated.value)} A och ${formatNumber(time.value)} s finns två gånger.` };
    wantedDevices.set(key, { rated: Math.round(rated.value * 1000) / 1000, time: Math.round(time.value * 1000) / 1000, trip: trip.value });
  }
  for (const [key, row] of wantedDevices) {
    const next = { low: row.rated, high: row.trip, source: deviceSource, reference: deviceReference };
    const existing = stored.get(key);
    if (!existing || fieldsOf(existing) !== fieldsOf(next)) inputs.push({ key, ...next, warnLow: null, warnHigh: null, version: existing?.version });
  }
  for (const existing of values) {
    if (isDeviceKey(existing.key) && !wantedDevices.has(existing.key)) inputs.push({ key: existing.key, low: null, high: null, warnLow: null, warnHigh: null, source: "", reference: "", version: existing.version });
  }
  // A curve (KA4): the rows of one device and rated current are its time–current curve, and a longer time never needs a larger current.
  // "Annat skydd" may hold different devices, so its rows are not held to one curve here; the calculators do not read a curve that does not fall.
  const curves = new Map<string, { label: string; points: { timeS: number; tripA: number }[] }>();
  for (const draft of deviceDrafts) {
    const rated = parseDecimal(draft.rated);
    const time = parseDecimal(draft.time);
    const trip = parseDecimal(draft.trip);
    if (draft.type === "annan" || rated.state !== "ok" || time.state !== "ok" || trip.state !== "ok") continue;
    const id = `${draft.type}:${rated.value}`;
    const curve = curves.get(id) ?? { label: `${DEVICE_LABEL[draft.type]} ${formatNumber(rated.value)} A`, points: [] };
    curve.points.push({ timeS: time.value, tripA: trip.value });
    curves.set(id, curve);
  }
  for (const curve of curves.values()) if (!curveFalls(curve.points)) return { error: `Skyddsapparater, ${curve.label}: Ia ska bli lägre, eller vara lika, när tiden blir längre.` };
  // The company's cable types: the place in the list, the material and the area are in the key, so a change there is a new row and the old one goes.
  const typeDrafts = model.cableTypes?.rows ?? [];
  const typeSource = (model.cableTypes?.source ?? "").trim().slice(0, 300);
  if (typeDrafts.length > CABLE_TYPE_MAX_ROWS) return { error: `Kabeltyper: högst ${CABLE_TYPE_MAX_ROWS} rader.` };
  const wantedTypes = new Set<string>();
  const typeNames = new Set<string>();
  let typeSlot = 0;
  for (const draft of typeDrafts) {
    const name = draft.name.trim();
    const area = parseDecimal(draft.area);
    const resistance = parseDecimal(draft.resistance);
    const reactance = parseDecimal(draft.reactance);
    if (!name && area.state === "empty" && resistance.state === "empty" && reactance.state === "empty") continue;
    const where = `Kabeltyper, ${name || `rad ${typeSlot + 1}`}`;
    if (!name) return { error: `${where}: skriv ett namn.` };
    if (name.length > CABLE_TYPE_NAME_MAX) return { error: `${where}: namnet får vara högst ${CABLE_TYPE_NAME_MAX} tecken.` };
    if (typeNames.has(name.toLowerCase())) return { error: `${where}: namnet finns två gånger.` };
    typeNames.add(name.toLowerCase());
    if (area.state !== "ok" || resistance.state !== "ok") return { error: `${where}: fyll i area och resistans som tal.` };
    if (reactance.state === "invalid") return { error: `${where}: skriv reaktansen som ett tal eller lämna den tom.` };
    if (area.value <= 0 || area.value > 10000) return { error: `${where}: arean ska vara större än noll.` };
    if (resistance.value <= 0 || resistance.value >= 1000) return { error: `${where}: resistansen ska vara större än noll och mindre än 1000 Ω/km.` };
    if (reactance.state === "ok" && (reactance.value < 0 || reactance.value >= 1000)) return { error: `${where}: reaktansen ska vara från 0 och under 1000 Ω/km.` };
    typeSlot += 1;
    const key = cableTypeKey(typeSlot, draft.material, area.value);
    wantedTypes.add(key);
    const warnHigh = reactance.state === "ok" ? reactance.value : null;
    const existing = stored.get(key);
    if (!existing || existing.high !== resistance.value || existing.warnHigh !== warnHigh || existing.source !== typeSource || existing.reference !== name) {
      inputs.push({ key, low: null, high: resistance.value, warnLow: null, warnHigh, source: typeSource, reference: name, version: existing?.version });
    }
  }
  for (const existing of values) {
    if (isCableTypeKey(existing.key) && !wantedTypes.has(existing.key)) inputs.push({ key: existing.key, low: null, high: null, warnLow: null, warnHigh: null, source: "", reference: "", version: existing.version });
  }
  // A table that was taken away altogether: its stored rows go too.
  for (const existing of values) {
    const match = /^kabel\.iz\.([1-9])\./.exec(existing.key);
    if (match && !model.tables.some((table) => table.slot === Number(match[1])) && !inputs.some((input) => input.key === existing.key)) {
      inputs.push({ key: existing.key, low: null, high: null, warnLow: null, warnHigh: null, source: "", reference: "", version: existing.version });
    }
  }
  return { inputs };
}

