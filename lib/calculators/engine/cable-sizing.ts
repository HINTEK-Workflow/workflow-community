import { Issues, type EngineResult } from "./common";
import type { ConductorMaterial } from "./impedance";
import { minAreaForVoltageDrop, voltageDrop } from "./voltage-drop";
import { checkParallel, type ConductorSpec } from "./impedance";

/**
 * Cable sizing (Kalkylator, 2026-10-12): the smallest area that satisfies three things at once.
 *
 *  1. Current: the cable's current rating Iz (INPUT, a table the technician or the company supplies; none is built in)
 *     must be at least the load current, and at least the protective device's rated current, after the installation
 *     factor: Iz · factor ≥ max(Ib, In).
 *  2. Voltage drop: see voltage-drop.ts; the allowed percentage is input.
 *  3. Short-circuit withstand (adiabatic): k²·S² ≥ I²·t, that is S ≥ I·√t / k. k is input, or calculated with
 *     `adiabaticK` from the conductor's temperature before and at the end of the short circuit (the cable's
 *     datasheet or the company's values; no temperatures are built in, 2026-11-01).
 *
 * With a rating table the answer is the smallest listed area that satisfies all the checks; without one only the
 * continuous minimum areas for the voltage drop and the short circuit are given.
 *
 * With n conductors in parallel per phase (KA4, 2026-11-01) each carries the n-th part of the current, so the areas and Iz
 * are per conductor. The short-circuit check stays with the whole current: it is not certain that a fault shares equally
 * between the conductors, so that side is the safe one.
 */
export type RatingRow = { areaMm2: number; /** Current rating Iz of the cable in this installation, A. */ izA: number };
export type ShortCircuitDuty = {
  /** The largest short-circuit current the cable must carry until the device has cleared the fault, A. */
  faultCurrentA: number;
  /** Clearing time, s. */
  durationS: number;
  /** k in A·√s/mm². Input; see `suggestK`. */
  k: number;
};
export type CableSizingInput = ConductorSpec & {
  phases: 1 | 3;
  voltageV: number;
  /** Load current Ib, A. */
  loadCurrentA: number;
  lengthM: number;
  cosPhi: number;
  reactancePerM?: number;
  /** Conductors in parallel per phase; default 1. The areas, Iz and the rows are per conductor. */
  parallel?: number;
  /** Rated current In of the protective device, A. Then the cable must carry at least In. */
  protectiveRatedA?: number;
  /** Product of the installation correction factors that reduce Iz (e.g. grouping, ambient temperature); 1 = none. Input. */
  deratingFactor?: number;
  /** The cable's rating per area: input (leave out to get only the continuous minimum areas). */
  ratings?: readonly RatingRow[];
  maxDropPercent?: number;
  shortCircuit?: ShortCircuitDuty;
};
export type SizingRow = {
  areaMm2: number;
  izA: number;
  /** Iz after the installation factor, A. */
  izEffectiveA: number;
  currentOk: boolean;
  dropPercent: number | null;
  dropOk: boolean | null;
  /** k²·S², A²s, and the current that the area withstands for the duration, A. */
  withstandA2s: number | null;
  withstandA: number | null;
  shortCircuitOk: boolean | null;
  /** All the checks that were asked for are met. */
  ok: boolean;
};
export type CableSizingResult = {
  /** The current the rating has to cover: max(Ib, In), A, and the rating needed per conductor before the installation factor: that value / (factor · parallel). */
  designCurrentA: number;
  requiredIzA: number;
  /** Continuous minimum areas, mm² (null when that check was not asked for, or cannot be met). */
  minAreaForDropMm2: number | null;
  minAreaForShortCircuitMm2: number | null;
  /** The smallest area in the table that meets every check asked for; null when none does or there is no table. */
  recommendedAreaMm2: number | null;
  rows: SizingRow[];
};

/** Smallest area (continuous) that withstands the short circuit: S = I·√t / k, mm². */
export const minAreaForShortCircuit = (duty: ShortCircuitDuty): number => (duty.faultCurrentA * Math.sqrt(duty.durationS)) / duty.k;
/** Energy a conductor withstands: k²·S², A²s. */
export const withstandEnergy = (areaMm2: number, k: number): number => k * k * areaMm2 * areaMm2;

export function sizeCable(input: CableSizingInput): EngineResult<CableSizingResult> {
  const issues = new Issues();
  issues.positive(input.loadCurrentA, "load", "Belastningsströmmen");
  issues.positive(input.voltageV, "voltage", "Spänningen");
  issues.positive(input.lengthM, "length", "Längden");
  issues.cosPhi(input.cosPhi);
  if (input.protectiveRatedA !== undefined) issues.positive(input.protectiveRatedA, "rated", "Skyddets märkström");
  if (input.deratingFactor !== undefined) issues.positive(input.deratingFactor, "derating", "Korrektionsfaktorn");
  if (input.maxDropPercent !== undefined) issues.positive(input.maxDropPercent, "allowed", "Tillåtet spänningsfall");
  checkParallel(issues, input.parallel, "parallel", "Antalet parallella ledare");
  if (input.shortCircuit) {
    issues.positive(input.shortCircuit.faultCurrentA, "faultCurrent", "Kortslutningsströmmen");
    issues.positive(input.shortCircuit.durationS, "duration", "Frånkopplingstiden");
    issues.positive(input.shortCircuit.k, "k", "Konstanten k");
  }
  for (const row of input.ratings ?? []) {
    issues.positive(row.areaMm2, "ratingArea", "Arean i tabellen");
    issues.positive(row.izA, "ratingIz", "Strömvärdet Iz i tabellen");
  }
  if (issues.errors.length) return issues.fail();
  if (input.protectiveRatedA !== undefined && input.protectiveRatedA < input.loadCurrentA) issues.warn("ratedBelowLoad", "Skyddets märkström är lägre än belastningsströmmen; det löser ut i normal drift.");
  if (!input.ratings?.length) issues.warn("noRatings", "Ingen strömvärdestabell angiven; kabelarean utifrån strömvärde kan inte väljas. Ange Iz per area.");
  if (input.maxDropPercent === undefined) issues.warn("noDropLimit", "Tillåtet spänningsfall är inte angivet; spänningsfallet kontrolleras inte.");
  if (!input.shortCircuit) issues.warn("noShortCircuit", "Kortslutningsdata saknas; kortslutningsståligheten kontrolleras inte.");

  const factor = input.deratingFactor ?? 1;
  if (factor > 1) issues.warn("factorAboveOne", "Korrektionsfaktorn är över 1, vilket höjer strömvärdet. Kontrollera värdet.");
  const parallel = input.parallel ?? 1;
  const design = Math.max(input.loadCurrentA, input.protectiveRatedA ?? 0);
  const dropBase = { ...input, maxDropPercent: undefined, ratings: undefined, shortCircuit: undefined };
  const dropFor = (areaMm2: number) => {
    const result = voltageDrop({ ...dropBase, areaMm2, currentA: input.loadCurrentA, allowedPercent: input.maxDropPercent });
    return result.ok ? result : null;
  };

  let minDrop: number | null = null;
  if (input.maxDropPercent !== undefined) {
    const result = minAreaForVoltageDrop({ ...dropBase, currentA: input.loadCurrentA, allowedPercent: input.maxDropPercent });
    if (result.ok) minDrop = result.minAreaMm2;
  }
  const minShort = input.shortCircuit ? minAreaForShortCircuit(input.shortCircuit) : null;

  const rows: SizingRow[] = [...(input.ratings ?? [])].sort((a, b) => a.areaMm2 - b.areaMm2).map((row) => {
    const effective = row.izA * factor;
    const currentOk = effective * parallel >= design;
    const drop = input.maxDropPercent === undefined ? null : dropFor(row.areaMm2);
    const dropOk = drop ? drop.withinLimit : input.maxDropPercent === undefined ? null : false;
    const energy = input.shortCircuit ? withstandEnergy(row.areaMm2, input.shortCircuit.k) : null;
    const shortOk = input.shortCircuit && energy !== null ? energy >= input.shortCircuit.faultCurrentA ** 2 * input.shortCircuit.durationS : null;
    return {
      areaMm2: row.areaMm2, izA: row.izA, izEffectiveA: effective, currentOk,
      dropPercent: drop ? drop.dropPercent : null, dropOk,
      withstandA2s: energy, withstandA: input.shortCircuit && energy !== null ? Math.sqrt(energy / input.shortCircuit.durationS) : null, shortCircuitOk: shortOk,
      ok: currentOk && dropOk !== false && shortOk !== false,
    };
  });
  const recommended = rows.find((row) => row.ok)?.areaMm2 ?? null;
  if (rows.length && recommended === null) issues.warn("noneFits", "Ingen area i tabellen uppfyller alla krav. Lägg till större areor eller ändra kraven.");
  return issues.done({ designCurrentA: design, requiredIzA: design / (factor * parallel), minAreaForDropMm2: minDrop, minAreaForShortCircuitMm2: minShort, recommendedAreaMm2: recommended, rows });
}

/* ---- The adiabatic constant k, calculated from physical constants ---- */

/** Physical constants of the conductor metals: volumetric heat capacity (J/(K·m³)), the temperature constant β (°C) and the resistivity at 20 °C (Ω·m). */
const METAL = {
  cu: { heatCapacity: 3.45e6, beta: 234.5, rho20: 17.241e-9 },
  al: { heatCapacity: 2.5e6, beta: 228, rho20: 28.264e-9 },
} as const;
/** k = √( Qc·(β + 20)/ρ20 · ln((β + θf)/(β + θi)) ) in A·√s/mm², from the start and end temperatures of the conductor. */
export function adiabaticK(material: ConductorMaterial, initialC: number, finalC: number): number {
  const m = METAL[material];
  return Math.sqrt(((m.heatCapacity * (m.beta + 20)) / m.rho20) * Math.log((m.beta + finalC) / (m.beta + initialC))) / 1e6;
}
