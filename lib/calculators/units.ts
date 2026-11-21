import { formatNumber } from "./number";

/**
 * Units of the calculators (Räkneverktyg, 2026-10-07). Every number a tool takes or gives has a dimension; the
 * dimension knows which units belong to it and how each converts to the base unit the formulas work in. A unit that
 * does not belong to the dimension is a unit error and is refused before anything is calculated.
 *
 * The base units are V, A, W, VA, VAr, m, mm², Ω, Ω·mm²/m and Ω/m. Percent, ratios and temperatures have one unit.
 */
type DimensionDefinition = {
  base: string;
  units: readonly { unit: string; factor: number }[];
  /** The units a result may be shown in, smallest first: the largest one the value reaches is chosen. */
  scale?: readonly string[];
  /** Where a scale unit takes over when not at its own factor: a current reads in whole ampere up to 9 999 A, kA from 10 000 A (2026-10-12). */
  scaleFrom?: Readonly<Record<string, number>>;
};

export const DIMENSIONS = {
  voltage: { base: "V", units: [{ unit: "V", factor: 1 }, { unit: "kV", factor: 1000 }], scale: ["V", "kV"] },
  current: { base: "A", units: [{ unit: "A", factor: 1 }, { unit: "kA", factor: 1000 }, { unit: "mA", factor: 0.001 }], scale: ["A", "kA"], scaleFrom: { kA: 10000 } },
  power: { base: "W", units: [{ unit: "W", factor: 1 }, { unit: "kW", factor: 1000 }, { unit: "MW", factor: 1e6 }], scale: ["W", "kW", "MW"] },
  apparentPower: { base: "VA", units: [{ unit: "VA", factor: 1 }, { unit: "kVA", factor: 1000 }, { unit: "MVA", factor: 1e6 }], scale: ["VA", "kVA", "MVA"] },
  reactivePower: { base: "VAr", units: [{ unit: "VAr", factor: 1 }, { unit: "kVAr", factor: 1000 }, { unit: "MVAr", factor: 1e6 }], scale: ["VAr", "kVAr", "MVAr"] },
  length: { base: "m", units: [{ unit: "m", factor: 1 }, { unit: "km", factor: 1000 }], scale: ["m", "km"] },
  area: { base: "mm²", units: [{ unit: "mm²", factor: 1 }] },
  resistance: { base: "Ω", units: [{ unit: "Ω", factor: 1 }, { unit: "mΩ", factor: 0.001 }], scale: ["mΩ", "Ω"] },
  resistivity: { base: "Ω·mm²/m", units: [{ unit: "Ω·mm²/m", factor: 1 }] },
  /** Reactance or resistance per length: 1 mΩ/m is the same as 1 Ω/km. */
  perLength: { base: "Ω/m", units: [{ unit: "mΩ/m", factor: 0.001 }, { unit: "Ω/km", factor: 0.001 }], scale: ["mΩ/m"] },
  temperature: { base: "°C", units: [{ unit: "°C", factor: 1 }] },
  /** The constant k of the adiabatic short-circuit check. */
  adiabatic: { base: "A·√s/mm²", units: [{ unit: "A·√s/mm²", factor: 1 }] },
  coefficient: { base: "1/K", units: [{ unit: "1/K", factor: 1 }] },
  /** Seconds, for a disconnection time or the duration of a short circuit. */
  time: { base: "s", units: [{ unit: "s", factor: 1 }, { unit: "ms", factor: 0.001 }], scale: ["ms", "s"] },
  percent: { base: "%", units: [{ unit: "%", factor: 1 }] },
  ratio: { base: "", units: [{ unit: "", factor: 1 }] },
  hoursPerDay: { base: "h/dag", units: [{ unit: "h/dag", factor: 1 }] },
  days: { base: "dagar", units: [{ unit: "dagar", factor: 1 }] },
  energy: { base: "kWh", units: [{ unit: "kWh", factor: 1 }, { unit: "MWh", factor: 1000 }], scale: ["kWh", "MWh"] },
  energyPrice: { base: "kr/kWh", units: [{ unit: "kr/kWh", factor: 1 }] },
  money: { base: "kr", units: [{ unit: "kr", factor: 1 }] },
} as const satisfies Record<string, DimensionDefinition>;

export type Dimension = keyof typeof DIMENSIONS;

const definition = (dimension: Dimension): DimensionDefinition => DIMENSIONS[dimension];
export const unitsOf = (dimension: Dimension): string[] => definition(dimension).units.map((item) => item.unit);
/** The unit a field starts with: the first one of its dimension. */
export const defaultUnit = (dimension: Dimension) => definition(dimension).units[0].unit;
export const baseUnit = (dimension: Dimension) => definition(dimension).base;

const factorOf = (dimension: Dimension, unit: string) => definition(dimension).units.find((item) => item.unit === unit)?.factor;

/** Why a unit does not fit its dimension, or null when it does (the calculators' unit check). */
export function checkUnit(dimension: Dimension, unit: string, label = "värdet"): string | null {
  if (factorOf(dimension, unit) !== undefined) return null;
  const allowed = unitsOf(dimension).filter(Boolean).join(", ");
  return `Enhetsfel: ”${unit || "ingen enhet"}” passar inte för ${label}.${allowed ? ` Välj ${allowed}.` : ""}`;
}

/** A value in the base unit; a unit that does not belong to the dimension throws, so a unit error never calculates. */
export function toBase(value: number, dimension: Dimension, unit: string): number {
  const factor = factorOf(dimension, unit);
  if (factor === undefined) throw new Error(checkUnit(dimension, unit) ?? "Enhetsfel.");
  return value * factor;
}

/** A base-unit value in the given unit. */
export function fromBase(value: number, dimension: Dimension, unit: string): number {
  const factor = factorOf(dimension, unit);
  if (factor === undefined) throw new Error(checkUnit(dimension, unit) ?? "Enhetsfel.");
  return value / factor;
}

/** The unit a result is shown in: the largest of the dimension's scale the value reaches, otherwise the smallest. */
export function scaleUnit(value: number, dimension: Dimension): string {
  const def = definition(dimension);
  const scale = def.scale ?? [def.units[0].unit];
  const magnitude = Math.abs(value);
  let chosen = scale[0];
  for (const unit of scale) if ((def.scaleFrom?.[unit] ?? factorOf(dimension, unit) ?? 1) <= magnitude * (1 + 1e-12)) chosen = unit;
  return chosen;
}

/** "6,93 kVA": the base-unit value in a readable unit with three significant digits. `unit` forces a unit. */
export function formatQuantity(value: number, dimension: Dimension, options: { unit?: string; significant?: number } = {}): string {
  const unit = options.unit ?? scaleUnit(value, dimension);
  const number = formatNumber(fromBase(value, dimension, unit), options.significant);
  return unit ? `${number} ${unit}` : number;
}
