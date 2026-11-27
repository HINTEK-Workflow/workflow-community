import type { CompanyValue } from "@/lib/workflow/company-values";

/**
 * What the calculators read from the company's own values (Värden och referenser, 2026-10-07). Workflow delivers
 * the calculators and no table: the reactance of the company's cables, its limit for the voltage drop, its factors for
 * the short-circuit current and its table of how much current a cable of each area may carry all come from the
 * company, kept as `CompanyReferenceValue` rows under the reserved key namespace `kabel.`. A key with a dot can never
 * be a form's limit key (those have none), so the two never collide.
 *
 * One value is kept in the "Högst" field (`high`). A table row keeps its area in "Lägst" (`low`) and the current in
 * "Högst" (`high`); the key carries the area as well (`kabel.iz.<tabell>.<material>.<area>`, 2,5 mm² is `2_5`), so a
 * row is the same row wherever it sits in the list. Up to three tables can be kept: the table's name is the source the
 * company names for it (for example the way the cable is installed).
 */
export const CALC_KEY_PREFIX = "kabel.";
export const CALC_KEYS = {
  /** Reactance per length of the company's cables, mΩ/m (the same number as Ω/km). */
  reactance: "kabel.reaktans",
  /** The company's limit for the voltage drop, percent of the nominal voltage. */
  dropLimit: "kabel.spanningsfall_max",
  /** The company's voltage factors c for the largest and the smallest short-circuit current. */
  cMax: "kabel.c_max",
  cMin: "kabel.c_min",
  /** The conductor temperature the company calculates the largest and the smallest short-circuit current at, °C. */
  tempMax: "kabel.temp_max",
  tempMin: "kabel.temp_min",
  /** The conductor's operating temperature for the voltage drop and the cable sizing, °C (2026-11-01). */
  tempOperating: "kabel.temp_drift",
  /** The conductor's temperature before the short circuit and the highest at its end, for the adiabatic k, °C (the cable's datasheet). */
  kTempStart: "kabel.k_temp_fore",
  kTempEnd: "kabel.k_temp_slut",
} as const;
export type CalcSingleKey = (typeof CALC_KEYS)[keyof typeof CALC_KEYS];
export const CALC_SINGLE_KEYS: readonly CalcSingleKey[] = Object.values(CALC_KEYS);

export const AMPACITY_SLOTS = 3;
export const AMPACITY_MATERIALS = ["cu", "al"] as const;
export type AmpacityMaterial = (typeof AMPACITY_MATERIALS)[number];
export const AMPACITY_MAX_ROWS = 30;

/**
 * "Mina skyddsapparater" (Kalkylator, 2026-10-12): the company's own list of protective devices with the current
 * Ia that makes the device trip within a required time. Workflow delivers no such table; the administrator enters the rows
 * from the maker's data. A row is one device type, rated current In and required time; the key carries all three
 * (`kabel.ia.<typ>.<In>.<tid>`, 16 A and 0,4 s is `kabel.ia.c.16.0_4`) and the row keeps In in "Lägst" and Ia in "Högst",
 * like the cable tables keep area and current. All rows of the list share one source and version.
 */
export const DEVICE_TYPES = ["gg", "b", "c", "d", "annan"] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];
/** The names a person sees; gG is the fuse type used with diazed and similar fuses, B, C and D the curves of miniature breakers. */
export const DEVICE_LABEL: Record<DeviceType, string> = { gg: "Smältsäkring gG", b: "Minibrytare B", c: "Minibrytare C", d: "Minibrytare D", annan: "Annat skydd" };
export const DEVICE_MAX_ROWS = 120;
export const deviceKey = (type: DeviceType, ratedA: number, timeS: number) => `${CALC_KEY_PREFIX}ia.${type}.${areaKeyPart(ratedA)}.${areaKeyPart(timeS)}`;
const DEVICE_KEY = /^kabel\.ia\.(gg|b|c|d|annan)\.(\d+(?:_\d+)?)\.(\d+(?:_\d+)?)$/;
export const isDeviceKey = (key: string) => DEVICE_KEY.test(key);
const fromKeyPart =(part: string) => Number(part.replace("_", "."));

/**
 * The company's own cable types (KA4, 2026-11-01): a name, the material, the phase conductor's area and resistance per km
 * at 20 °C, and optionally its reactance per km, all entered by the company from its own data. Workflow delivers no such list. One
 * row per type: the key carries the place in the list, the material and the area (`kabel.typ.<nr>.<material>.<area>`), "Högst" the
 * resistance, "Övre varning" the reactance, and since the row has no version of its own, the field for the version holds the
 * type's name. All rows share one source.
 */
export const CABLE_TYPE_MAX_ROWS = 40;
export const CABLE_TYPE_NAME_MAX = 80;
export const cableTypeKey = (slot: number, material: AmpacityMaterial, area: number) => `${CALC_KEY_PREFIX}typ.${slot}.${material}.${areaKeyPart(area)}`;
const CABLE_TYPE_KEY = /^kabel\.typ\.([1-9]\d?)\.(cu|al)\.(\d+(?:_\d+)?)$/;
export const isCableTypeKey = (key: string) => CABLE_TYPE_KEY.test(key);
/** What a stored row's key says: the place in the list, the material and the area. */
export function cableTypeKeyParts(key: string): { slot: number; material: AmpacityMaterial; area: number } | null {
  const match = CABLE_TYPE_KEY.exec(key);
  return match ? { slot: Number(match[1]), material: match[2] as AmpacityMaterial, area: fromKeyPart(match[3]) } : null;
}

export const isCalculatorKey = (key: string) => key.startsWith(CALC_KEY_PREFIX);

/** The area as it sits in a key: 2.5 → "2_5", 0.75 → "0_75", 16 → "16" (at most three decimals). */
export function areaKeyPart(area: number): string {
  return String(Math.round(area * 1000) / 1000).replace(".", "_");
}
export const ampacityKey = (slot: number, material: AmpacityMaterial, area: number) => `${CALC_KEY_PREFIX}iz.${slot}.${material}.${areaKeyPart(area)}`;
const AMPACITY_KEY = /^kabel\.iz\.([1-9])\.(cu|al)\.\d+(?:_\d+)?$/;

/** A number the company entered, with the source it named for it. */
export type Sourced = { value: number; source: string };
export type AmpacityRow = { area: number; amps: number };
export type AmpacityTable = { slot: number; name: string; source: string; cu: AmpacityRow[]; al: AmpacityRow[] };
/** One row of "Mina skyddsapparater": the device, its rated current, the time and the current that trips it within that time. */
export type ProtectiveDevice = { type: DeviceType; ratedA: number; timeS: number; tripA: number; source: string };
/** One of the company's cable types. `id` is what a calculator's choice holds. Ω/m, one conductor at 20 °C. */
export type CableType = { id: string; name: string; material: AmpacityMaterial; areaMm2: number; resistancePerM20: number; reactancePerM?: number; source: string };
export type CompanyCalcData = {
  /** Ω/m */
  reactancePerM?: Sourced;
  dropLimitPct?: Sourced;
  cMax?: Sourced;
  cMin?: Sourced;
  tempMax?: Sourced;
  tempMin?: Sourced;
  tempOperating?: Sourced;
  kTempStart?: Sourced;
  kTempEnd?: Sourced;
  ampacity: AmpacityTable[];
  /** The company's protective devices with Ia (empty when none were entered). */
  devices: ProtectiveDevice[];
  /** The company's cable types (empty when none were entered). */
  cableTypes: CableType[];
};
export const emptyCompanyCalcData = (): CompanyCalcData => ({ ampacity: [], devices: [], cableTypes: [] });

const sourceText = (value: Pick<CompanyValue, "source" | "reference">) => [value.source, value.reference].filter(Boolean).join(", ");
const single = (value: Pick<CompanyValue, "high" | "low">) => value.high ?? value.low;
const finite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);

/** The calculators' view of the company's values; a value that does not make sense is left out, as if not entered. */
export function companyCalcData(values: readonly CompanyValue[]): CompanyCalcData {
  const data = emptyCompanyCalcData();
  const sourced = (key: string, accept: (value: number) => boolean, divisor = 1): Sourced | undefined => {
    const row = values.find((item) => item.key === key);
    const value = row ? single(row) : null;
    return row && finite(value) && accept(value) ? { value: value / divisor, source: sourceText(row) } : undefined;
  };
  const set = (name: "reactancePerM" | "dropLimitPct" | "cMax" | "cMin" | "tempMax" | "tempMin" | "tempOperating" | "kTempStart" | "kTempEnd", found: Sourced | undefined) => { if (found) data[name] = found; };
  // mΩ/m is entered, Ω/m is used.
  set("reactancePerM", sourced(CALC_KEYS.reactance, (value) => value >= 0 && value < 1000, 1000));
  set("dropLimitPct", sourced(CALC_KEYS.dropLimit, (value) => value > 0 && value <= 100));
  set("cMax", sourced(CALC_KEYS.cMax, (value) => value > 0 && value < 10));
  set("cMin", sourced(CALC_KEYS.cMin, (value) => value > 0 && value < 10));
  set("tempMax", sourced(CALC_KEYS.tempMax, (value) => value >= -60 && value <= 500));
  set("tempMin", sourced(CALC_KEYS.tempMin, (value) => value >= -60 && value <= 500));
  set("tempOperating", sourced(CALC_KEYS.tempOperating, (value) => value >= -60 && value <= 500));
  set("kTempStart", sourced(CALC_KEYS.kTempStart, (value) => value >= -60 && value <= 500));
  set("kTempEnd", sourced(CALC_KEYS.kTempEnd, (value) => value >= -60 && value <= 1000));
  const tables = new Map<number, AmpacityTable>();
  for (const row of values) {
    const match = AMPACITY_KEY.exec(row.key);
    if (!match || !finite(row.low) || !finite(row.high) || row.low <= 0 || row.low > 10000 || row.high <= 0 || row.high > 100000) continue;
    const slot = Number(match[1]);
    if (slot > AMPACITY_SLOTS) continue;
    const material = match[2] as AmpacityMaterial;
    const table = tables.get(slot) ?? { slot, name: "", source: "", cu: [], al: [] };
    if (!table[material].some((item) => item.area === row.low)) table[material].push({ area: row.low, amps: row.high });
    // The source of the table: the first row that names one (the panel gives every row of a table the same).
    if (!table.source && sourceText(row)) { table.source = sourceText(row); table.name = row.source || sourceText(row); }
    tables.set(slot, table);
  }
  for (const table of [...tables.values()].sort((a, b) => a.slot - b.slot)) {
    table.cu.sort((a, b) => a.area - b.area);
    table.al.sort((a, b) => a.area - b.area);
    if (!table.name) table.name = `Tabell ${table.slot}`;
    data.ampacity.push(table);
  }
  for (const row of values) {
    const match = DEVICE_KEY.exec(row.key);
    if (!match || !finite(row.low) || !finite(row.high) || row.low <= 0 || row.low > 100000 || row.high <= 0 || row.high > 10000000) continue;
    const ratedA = fromKeyPart(match[2]);
    const timeS = fromKeyPart(match[3]);
    if (!(timeS > 0) || Math.abs(ratedA - row.low) > 1e-6 * Math.max(1, ratedA)) continue;
    data.devices.push({ type: match[1] as DeviceType, ratedA: row.low, timeS, tripA: row.high, source: sourceText(row) });
  }
  const order = (type: DeviceType) => DEVICE_TYPES.indexOf(type);
  data.devices.sort((a, b) => order(a.type) - order(b.type) || a.ratedA - b.ratedA || a.timeS - b.timeS);
  const types: { slot: number; type: CableType }[] = [];
  for (const row of values) {
    const parts = cableTypeKeyParts(row.key);
    if (!parts || parts.slot > CABLE_TYPE_MAX_ROWS || !(parts.area > 0) || !finite(row.high) || row.high <= 0 || row.high >= 1000) continue;
    types.push({
      slot: parts.slot,
      type: {
        id: `typ${parts.slot}`, name: row.reference || `Kabeltyp ${parts.slot}`, material: parts.material, areaMm2: parts.area, resistancePerM20: row.high / 1000,
        ...(finite(row.warnHigh) && row.warnHigh >= 0 && row.warnHigh < 1000 ? { reactancePerM: row.warnHigh / 1000 } : {}), source: row.source,
      },
    });
  }
  data.cableTypes = types.sort((a, b) => a.slot - b.slot).map((item) => item.type);
  return data;
}

/** The company's Ia for a device type, rated current and required time (the exact row); undefined when the company has not entered it. */
export function deviceTripFor(devices: readonly ProtectiveDevice[], type: DeviceType, ratedA: number, timeS: number): ProtectiveDevice | undefined {
  return devices.find((device) => device.type === type && sameArea(device.ratedA, ratedA) && sameArea(device.timeS, timeS));
}

/** Every point the company entered for one device type and rated current: its curve, by rising time. */
export function deviceCurvePoints(devices: readonly ProtectiveDevice[], type: DeviceType, ratedA: number): ProtectiveDevice[] {
  return devices.filter((device) => device.type === type && sameArea(device.ratedA, ratedA)).sort((a, b) => a.timeS - b.timeS);
}

const sameArea = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** The current the company's table gives for a material and an area; with no table chosen, the first one that has it. */
export function ampacityFor(tables: readonly AmpacityTable[], slot: number | null, material: AmpacityMaterial, area: number): { amps: number; table: AmpacityTable } | undefined {
  for (const table of tables) {
    if (slot !== null && table.slot !== slot) continue;
    const row = table[material].find((item) => sameArea(item.area, area));
    if (row) return { amps: row.amps, table };
  }
  return undefined;
}

/** Whether the company's table can answer for this material at all (it has at least one row). */
export const tableHasMaterial = (table: AmpacityTable, material: AmpacityMaterial) => table[material].length > 0;
