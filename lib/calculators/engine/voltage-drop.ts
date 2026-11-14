import { Issues, SQRT3, type EngineResult } from "./common";
import { checkParallel, resistancePerMeter, resistivity, SUGGESTED_REACTANCE_OHM_PER_M, type ConductorSpec } from "./impedance";

/**
 * Voltage drop along a cable (Kalkylator, 2026-10-12):
 *
 *   ΔU = k · I · (R·cos φ + X·sin φ)       k = √3 (three-phase) or 2 (single-phase, out and back)
 *   R = ρ·L/A,  X = x·L                    ΔU% = ΔU / U · 100
 *
 * U is the line voltage for three phases and the phase voltage for a single phase. The allowed percentage is the
 * caller's input; no limit is built in. n conductors in parallel per phase divide R and X by n, and sections in series add
 * their drops (each with its own current and the same cos φ): ΔU = Σ k · Ii · (Ri·cos φ + Xi·sin φ) (KA4, 2026-11-01).
 */
export type VoltageDropInput = ConductorSpec & {
  phases: 1 | 3;
  /** Nominal voltage, V: line voltage (three-phase) or phase voltage (single-phase). */
  voltageV: number;
  currentA: number;
  lengthM: number;
  areaMm2: number;
  cosPhi: number;
  /** Reactance per metre of one conductor, Ω/m. Default: a suggestion (0,08 Ω/km). */
  reactancePerM?: number;
  /** Conductors in parallel per phase; default 1. */
  parallel?: number;
  /** Allowed voltage drop, %. If given the result says whether it is met. */
  allowedPercent?: number;
};
export type VoltageDropResult = {
  /** k = √3 or 2. */
  factor: number;
  /** One phase (its parallel conductors together), the whole length, Ω. */
  resistanceOhm: number;
  reactanceOhm: number;
  /** One conductor, per metre, at its temperature. */
  resistancePerM: number;
  reactancePerM: number;
  dropV: number;
  dropPercent: number;
  /** Voltage left at the load, V. */
  loadVoltageV: number;
  /** Within the allowed percentage; null when no limit was given. */
  withinLimit: boolean | null;
  /** The limit's margin in percentage points (allowed − actual), null without a limit. */
  marginPercentPoints: number | null;
};

const factorOf = (phases: 1 | 3) => (phases === 3 ? SQRT3 : 2);
const sinOf = (cos: number) => Math.sqrt(Math.max(0, 1 - cos * cos));

function validate(input: Omit<VoltageDropInput, "lengthM" | "areaMm2"> & { lengthM?: number; areaMm2?: number }, issues: Issues) {
  if (input.phases !== 1 && input.phases !== 3) issues.error("phases", "Antal faser måste vara 1 eller 3.");
  issues.positive(input.voltageV, "voltage", "Spänningen");
  issues.positive(input.currentA, "current", "Strömmen");
  issues.cosPhi(input.cosPhi);
  if (input.reactancePerM !== undefined) issues.nonNegative(input.reactancePerM, "reactance", "Reaktansen");
  if (input.allowedPercent !== undefined) issues.positive(input.allowedPercent, "allowed", "Tillåtet spänningsfall");
  if (!Number.isFinite(input.temperatureC)) issues.error("temperature", "Temperaturen måste vara ett tal.");
  if (input.resistancePerM20 !== undefined) issues.positive(input.resistancePerM20, "resistance", "Ledarens resistans");
  checkParallel(issues, input.parallel, "parallel", "Antalet parallella ledare");
}

/** The voltage drop in V and %, with the reactive part. */
export function voltageDrop(input: VoltageDropInput): EngineResult<VoltageDropResult> {
  const issues = new Issues();
  validate(input, issues);
  issues.nonNegative(input.lengthM, "length", "Längden");
  issues.positive(input.areaMm2, "area", "Arean");
  if (issues.errors.length) return issues.fail();
  if (input.reactancePerM === undefined) issues.warn("reactanceSuggested", "Reaktans per meter är ett förslag (0,08 Ω/km). Ange kabelns eget värde.");
  if (input.phases === 3 && input.voltageV < 100) issues.warn("voltageRange", "Trefas med så låg spänning är ovanligt. Ange huvudspänningen (t.ex. 400 V).");
  if (input.lengthM > 5000) issues.warn("lengthRange", "Längden är ovanligt stor. Kontrollera att den är i meter.");
  const x = input.reactancePerM ?? SUGGESTED_REACTANCE_OHM_PER_M;
  const rPerM = resistancePerMeter(input, input.areaMm2);
  const factor = factorOf(input.phases);
  const parallel = input.parallel ?? 1;
  const r = (rPerM * input.lengthM) / parallel;
  const xl = (x * input.lengthM) / parallel;
  const dropV = factor * input.currentA * (r * input.cosPhi + xl * sinOf(input.cosPhi));
  const dropPercent = (dropV / input.voltageV) * 100;
  if (dropPercent > 20) issues.warn("dropLarge", "Spänningsfallet är över 20 %. Kontrollera längd, area och ström.");
  return issues.done({
    factor, resistanceOhm: r, reactanceOhm: xl, resistancePerM: rPerM, reactancePerM: x, dropV, dropPercent, loadVoltageV: input.voltageV - dropV,
    withinLimit: input.allowedPercent === undefined ? null : dropPercent <= input.allowedPercent,
    marginPercentPoints: input.allowedPercent === undefined ? null : input.allowedPercent - dropPercent,
  });
}

export type MaxLengthForDropInput = Omit<VoltageDropInput, "lengthM" | "allowedPercent"> & { allowedPercent: number };
/** The longest cable that stays within the allowed voltage drop: L = ΔU,allowed / (k·I·(r·cos φ + x·sin φ)). */
export function maxLengthForVoltageDrop(input: MaxLengthForDropInput): EngineResult<{ maxLengthM: number; dropPercentPerHundredMeters: number }> {
  const issues = new Issues();
  validate(input, issues);
  issues.positive(input.areaMm2, "area", "Arean");
  issues.positive(input.allowedPercent, "allowed", "Tillåtet spänningsfall");
  if (issues.errors.length) return issues.fail();
  if (input.reactancePerM === undefined) issues.warn("reactanceSuggested", "Reaktans per meter är ett förslag (0,08 Ω/km). Ange kabelns eget värde.");
  const x = input.reactancePerM ?? SUGGESTED_REACTANCE_OHM_PER_M;
  const rPerM = resistancePerMeter(input, input.areaMm2);
  const dropPerMeter = (factorOf(input.phases) * input.currentA * (rPerM * input.cosPhi + x * sinOf(input.cosPhi))) / (input.parallel ?? 1);
  const allowedV = (input.allowedPercent / 100) * input.voltageV;
  return issues.done({ maxLengthM: allowedV / dropPerMeter, dropPercentPerHundredMeters: ((dropPerMeter * 100) / input.voltageV) * 100 });
}

/** The smallest area (continuous, mm²) that keeps a given length within the allowed drop; null when the reactance alone exceeds it. */
export function minAreaForVoltageDrop(input: Omit<VoltageDropInput, "areaMm2"> & { allowedPercent: number }): EngineResult<{ minAreaMm2: number | null }> {
  const issues = new Issues();
  validate(input, issues);
  issues.positive(input.lengthM, "length", "Längden");
  issues.positive(input.allowedPercent, "allowed", "Tillåtet spänningsfall");
  if (issues.errors.length) return issues.fail();
  const x = input.reactancePerM ?? SUGGESTED_REACTANCE_OHM_PER_M;
  const allowedV = (input.allowedPercent / 100) * input.voltageV;
  const k = factorOf(input.phases);
  const parallel = input.parallel ?? 1;
  const reactiveV = (k * input.currentA * x * input.lengthM * sinOf(input.cosPhi)) / parallel;
  const room = allowedV - reactiveV;
  if (room <= 0) {
    issues.warn("reactanceTooLarge", "Reaktansen ensam ger redan mer spänningsfall än tillåtet; ingen area räcker.");
    return issues.done({ minAreaMm2: null });
  }
  return issues.done({ minAreaMm2: (k * input.currentA * resistivity(input) * input.lengthM * input.cosPhi) / (parallel * room) });
}

/** One section of a run in series: its own cable, length and current. */
export type DropSection = ConductorSpec & { currentA: number; lengthM: number; areaMm2: number; reactancePerM?: number; parallel?: number };
export type VoltageDropSectionsInput = { phases: 1 | 3; voltageV: number; cosPhi: number; sections: readonly DropSection[]; allowedPercent?: number };
export type VoltageDropSectionsResult = {
  sections: VoltageDropResult[];
  dropV: number;
  dropPercent: number;
  loadVoltageV: number;
  withinLimit: boolean | null;
  marginPercentPoints: number | null;
};

/** The drop over several sections in series: the sum of each section's own drop. One section gives exactly `voltageDrop`. */
export function voltageDropOverSections(input: VoltageDropSectionsInput): EngineResult<VoltageDropSectionsResult> {
  const issues = new Issues();
  if (!input.sections.length) issues.error("sections", "Ange minst ett kabelavsnitt.");
  const results: VoltageDropResult[] = [];
  for (const section of input.sections) {
    const result = voltageDrop({ ...section, phases: input.phases, voltageV: input.voltageV, cosPhi: input.cosPhi });
    if (!result.ok) return result;
    results.push(result);
    for (const warning of result.warnings) if (warning.code !== "dropLarge" && !issues.warnings.some((item) => item.message === warning.message)) issues.warnings.push(warning);
  }
  if (input.allowedPercent !== undefined) issues.positive(input.allowedPercent, "allowed", "Tillåtet spänningsfall");
  if (issues.errors.length) return issues.fail();
  const dropV = results.reduce((sum, result) => sum + result.dropV, 0);
  const dropPercent = (dropV / input.voltageV) * 100;
  if (dropPercent > 20) issues.warn("dropLarge", "Spänningsfallet är över 20 %. Kontrollera längd, area och ström.");
  return issues.done({
    sections: results, dropV, dropPercent, loadVoltageV: input.voltageV - dropV,
    withinLimit: input.allowedPercent === undefined ? null : dropPercent <= input.allowedPercent,
    marginPercentPoints: input.allowedPercent === undefined ? null : input.allowedPercent - dropPercent,
  });
}
