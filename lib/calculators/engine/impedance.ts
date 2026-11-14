import { MATERIALS, resistivityAt, type MaterialId } from "../conductor";
import { Issues, SQRT3, type EngineResult } from "./common";

/**
 * Impedances and conductors (Kalkylator, 2026-10-12). An impedance is kept as resistance and reactance in ohm,
 * so a series connection adds R and X separately (the vector sum) and never the magnitudes of Z.
 */
export type Impedance = { r: number; x: number };
export type ConductorMaterial = MaterialId;

export const impedanceOf = (r: number, x: number): Impedance => ({ r, x });
/** |Z| = √(R² + X²) */
export const magnitude = (z: Impedance): number => Math.hypot(z.r, z.x);
/** Series connection: R and X are added separately. */
export const addImpedances = (...parts: Impedance[]): Impedance => ({ r: parts.reduce((s, p) => s + p.r, 0), x: parts.reduce((s, p) => s + p.x, 0) });
export const scaleImpedance = (z: Impedance, factor: number): Impedance => ({ r: z.r * factor, x: z.x * factor });
/** From a magnitude and the ratio R/X (no ratio: all reactance, the usual assumption for a transformer or a strong grid). */
export function splitImpedance(z: number, rOverX?: number): Impedance {
  if (rOverX === undefined) return { r: 0, x: z };
  const x = z / Math.sqrt(1 + rOverX * rOverX);
  return { r: x * rOverX, x };
}

/** SUGGESTION, not a table value: a reactance per length that is typical for a low-voltage cable, 0,08 Ω/km. Replace it with the cable's own value. */
export const SUGGESTED_REACTANCE_OHM_PER_M = 0.00008;
/** Reactance per metre from an inductance in mH/km: X = 2π·f·L. */
export const reactancePerMeterFromInductance = (milliHenryPerKm: number, hertz = 50): number => (2 * Math.PI * hertz * milliHenryPerKm * 1e-3) / 1000;

/**
 * What a conductor's resistance is based on (2026-11-01): the cable's own resistance per length from its datasheet
 * when it is given, otherwise the material's resistivity at 20 °C (physics, or the technician's own value) over the area.
 */
export type ConductorSpec = {
  material: ConductorMaterial;
  /** Conductor temperature, °C. */
  temperatureC: number;
  /** The technician's own resistivity at 20 °C, Ω·mm²/m. Without it the material's physical constant is used. */
  rho20?: number;
  /** The technician's own temperature coefficient, 1/K. */
  alpha?: number;
  /** The (phase) conductor's own resistance per metre at 20 °C, Ω/m, from the cable's datasheet. Goes before ρ / A; corrected to the temperature with α. */
  resistancePerM20?: number;
};
/** Resistivity at the conductor's temperature, Ω·mm²/m: ρ = ρ20 · (1 + α · (θ − 20)). */
export function resistivity(spec: ConductorSpec): number {
  const base = MATERIALS[spec.material];
  return resistivityAt(spec.rho20 ?? base.rho20, spec.alpha ?? base.alpha, spec.temperatureC);
}
/**
 * Resistance per metre of one conductor at its temperature, Ω/m: the datasheet's resistance at 20 °C corrected with α,
 * r = r20 · (1 + α · (θ − 20)), when it is given; otherwise ρ / A.
 */
export function conductorResistancePerM(spec: ConductorSpec, areaMm2: number, ownPerM20?: number): number {
  if (ownPerM20 === undefined) return resistivity(spec) / areaMm2;
  return resistivityAt(ownPerM20, spec.alpha ?? MATERIALS[spec.material].alpha, spec.temperatureC);
}
/** Resistance per metre of the (phase) conductor, Ω/m: its own datasheet value when given, otherwise ρ / A. */
export const resistancePerMeter = (spec: ConductorSpec, areaMm2: number): number => conductorResistancePerM(spec, areaMm2, spec.resistancePerM20);

/** Parallel conductors (KA4, 2026-11-01): n equal conductors per phase divide both R and X by n. Whole numbers from 1. */
export function checkParallel(issues: Issues, value: number | undefined, code: string, label: string) {
  if (value !== undefined && (!Number.isInteger(value) || value < 1)) issues.error(code, `${label} måste vara ett helt tal, minst 1.`);
}

export type CableImpedanceInput = ConductorSpec & {
  lengthM: number;
  /** Conductors in parallel per phase; default 1. Each is the same as the others, so R and X are divided by this. */
  parallel?: number;
  /** Protective conductors in parallel; default the same as the phase (and a warning says so when that is more than one). */
  returnParallel?: number;
  /** Phase conductor area, mm². */
  areaMm2: number;
  /** Reactance of one conductor per metre, Ω/m. Default: the suggestion above. */
  reactancePerM?: number;
  /**
   * Protective conductor (or N) area, mm². Without it only the phase conductor is calculated;
   * with it the loop impedance (out along the phase conductor and back along the PE) is calculated as well.
   */
  returnAreaMm2?: number;
  /** The return conductor's own resistance per metre at 20 °C, Ω/m (datasheet). Goes before ρ / A for the return conductor. */
  returnResistancePerM20?: number;
};
export type CableImpedance = {
  /** One phase (its parallel conductors together), the whole length. */
  phase: Impedance;
  /** The earth-fault loop (phase + return conductor) when `returnAreaMm2` was given, otherwise null. */
  loop: Impedance | null;
  /** Ω/m, phase conductor, at the temperature. */
  phaseResistancePerM: number;
  /** Ω/m, return conductor, when given. */
  returnResistancePerM: number | null;
  /** Ω·mm²/m used, at the temperature. */
  rho: number;
};

/** The impedance of a cable run from length, area, material and temperature. */
export function cableImpedance(input: CableImpedanceInput): EngineResult<CableImpedance> {
  const issues = new Issues();
  issues.nonNegative(input.lengthM, "length", "Längden");
  issues.positive(input.areaMm2, "area", "Arean");
  if (input.returnAreaMm2 !== undefined) issues.positive(input.returnAreaMm2, "returnArea", "Skyddsledarens area");
  if (!Number.isFinite(input.temperatureC)) issues.error("temperature", "Temperaturen måste vara ett tal.");
  if (input.reactancePerM !== undefined) issues.nonNegative(input.reactancePerM, "reactance", "Reaktansen");
  if (input.resistancePerM20 !== undefined) issues.positive(input.resistancePerM20, "resistance", "Ledarens resistans");
  if (input.returnResistancePerM20 !== undefined) issues.positive(input.returnResistancePerM20, "returnResistance", "Skyddsledarens resistans");
  checkParallel(issues, input.parallel, "parallel", "Antalet parallella ledare");
  checkParallel(issues, input.returnParallel, "returnParallel", "Antalet parallella skyddsledare");
  if (issues.errors.length) return issues.fail();
  if (input.temperatureC < -40 || input.temperatureC > 250) issues.warn("temperatureRange", "Temperaturen ligger utanför det vanliga för en ledare. Kontrollera värdet.");
  if (input.areaMm2 > 1200) issues.warn("areaRange", "Arean är ovanligt stor. Kontrollera att den är i mm².");
  if (input.lengthM > 5000) issues.warn("lengthRange", "Längden är ovanligt stor. Kontrollera att den är i meter.");
  const rho = resistivity(input);
  const xPerM = input.reactancePerM ?? SUGGESTED_REACTANCE_OHM_PER_M;
  if (input.reactancePerM === undefined) issues.warn("reactanceSuggested", "Reaktans per meter är ett förslag (0,08 Ω/km). Ange kabelns eget värde.");
  const phasePerM = resistancePerMeter(input, input.areaMm2);
  const returnPerM = input.returnAreaMm2 === undefined ? null : conductorResistancePerM(input, input.returnAreaMm2, input.returnResistancePerM20);
  const parallel = input.parallel ?? 1;
  const returnParallel = input.returnParallel ?? parallel;
  const rPhase = (phasePerM * input.lengthM) / parallel;
  const xPhase = (xPerM * input.lengthM) / parallel;
  const returnR = returnPerM === null ? null : (returnPerM * input.lengthM) / returnParallel;
  return issues.done({
    phase: { r: rPhase, x: xPhase },
    loop: returnR === null ? null : { r: rPhase + returnR, x: xPhase + (xPerM * input.lengthM) / returnParallel },
    phaseResistancePerM: phasePerM,
    returnResistancePerM: returnPerM,
    rho,
  });
}

/** A point in the network seen from the source: the impedance of one phase and of the earth-fault loop (phase + PE) up to it. */
export type FaultPoint = { phase: Impedance; loop: Impedance };
/** Moves a fault point out along a cable. A missing protective conductor area is assumed equal to the phase area (and says so). */
export function extendFaultPoint(from: FaultPoint, cable: CableImpedanceInput): EngineResult<{ point: FaultPoint }> {
  // A missing protective conductor is the phase conductor again, its own datasheet resistance included.
  const result = cableImpedance({
    ...cable, returnAreaMm2: cable.returnAreaMm2 ?? cable.areaMm2,
    returnResistancePerM20: cable.returnResistancePerM20 ?? (cable.returnAreaMm2 === undefined ? cable.resistancePerM20 : undefined),
  });
  if (!result.ok) return result;
  const warnings = [...result.warnings];
  if (cable.returnAreaMm2 === undefined) warnings.push({ code: "returnAssumed", message: "Skyddsledarens area saknas; den antas vara lika stor som fasledarens." });
  if ((cable.parallel ?? 1) > 1 && cable.returnParallel === undefined) warnings.push({ code: "returnParallelAssumed", message: "Antalet parallella skyddsledare saknas; det antas vara samma som fasledarna." });
  return { ok: true, warnings, point: { phase: addImpedances(from.phase, result.phase), loop: addImpedances(from.loop, result.loop ?? result.phase) } };
}

/** Impedance of a source from its short-circuit current: Z = c·U / (√3·Ik). U is the line voltage. */
export const impedanceFromShortCircuitCurrent = (lineVoltageV: number, ik3A: number, c = 1): number => (c * lineVoltageV) / (SQRT3 * ik3A);
/** Impedance from short-circuit power: Z = c·U² / S. */
export const impedanceFromShortCircuitPower = (lineVoltageV: number, shortCircuitVA: number, c = 1): number => (c * lineVoltageV * lineVoltageV) / shortCircuitVA;
/** Two short-circuit powers in series (grid and transformer): S = S1·S2 / (S1 + S2). */
export const seriesShortCircuitPower = (s1: number, s2: number): number => (s1 * s2) / (s1 + s2);
