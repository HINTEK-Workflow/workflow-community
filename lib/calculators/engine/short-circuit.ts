import { Issues, SQRT3, type EngineResult } from "./common";
import { impedanceFromShortCircuitCurrent, impedanceFromShortCircuitPower, magnitude, splitImpedance, type FaultPoint, type Impedance } from "./impedance";

/**
 * Short-circuit currents from impedances (Kalkylator, 2026-10-12), the impedance method.
 *
 *   Ik3 = c·U / (√3·|Z|)           three-phase, the largest current
 *   Ik2 = (√3/2)·Ik3               two-phase
 *   Ik1 = c·U0 / |Zs|              phase to PE/N (the earth-fault current), U0 = U/√3, Zs the loop out and back
 *
 * The voltage factor c and the conductor temperatures are the caller's: the company's own values or typed (
 * 2026-11-01). Nothing from a standard is built in; without a value the neutral choice is c = 1 and 20 °C (no
 * temperature correction), and the calculator says so.
 */
/** The neutral voltage factor: the voltage as it is, no correction. */
export const NEUTRAL_VOLTAGE_FACTOR = 1;

export type SourceSpec =
  /** The source's three-phase short-circuit current at the connection point, A. */
  | { kind: "ik3"; amps: number; /** R/X of the source; without it, pure reactance. */ rOverX?: number }
  /** Its three-phase short-circuit power, VA. */
  | { kind: "power"; voltAmps: number; rOverX?: number }
  /** Its impedance as R and X per phase; `loop` when the source's earth-fault loop differs from the phase (otherwise equal). */
  | { kind: "impedance"; phase: Impedance; loop?: Impedance };

/** The fault point at a source's own terminals. */
export function sourceFaultPoint(source: SourceSpec, lineVoltageV: number, c = 1): EngineResult<{ point: FaultPoint }> {
  const issues = new Issues();
  issues.positive(lineVoltageV, "voltage", "Spänningen");
  if (source.kind === "ik3") issues.positive(source.amps, "ik3", "Kortslutningsströmmen");
  if (source.kind === "power") issues.positive(source.voltAmps, "power", "Kortslutningseffekten");
  if (issues.errors.length) return issues.fail();
  let phase: Impedance;
  if (source.kind === "ik3") phase = splitImpedance(impedanceFromShortCircuitCurrent(lineVoltageV, source.amps, c), source.rOverX);
  else if (source.kind === "power") phase = splitImpedance(impedanceFromShortCircuitPower(lineVoltageV, source.voltAmps, c), source.rOverX);
  else phase = source.phase;
  if (magnitude(phase) <= 0) { issues.error("zeroImpedance", "Källans impedans måste vara större än noll."); return issues.fail(); }
  if (!(source.kind === "impedance" && source.loop)) issues.warn("loopAssumed", "Källans slingimpedans antas vara lika med fasimpedansen.");
  return issues.done({ point: { phase, loop: source.kind === "impedance" && source.loop ? source.loop : phase } });
}

export type ShortCircuitInput = {
  /** Line voltage U, V. */
  lineVoltageV: number;
  /** Voltage factor c. */
  c: number;
  point: FaultPoint;
};
export type ShortCircuitResult = {
  /** Impedance of one phase / of the earth-fault loop, Ω. */
  phaseOhm: number;
  loopOhm: number;
  ik3A: number;
  ik2A: number;
  /** Phase to PE/N. */
  ik1A: number;
};

/** Ik3, Ik2 and Ik1 at a fault point. Use the largest-current conditions for Ik3 and the smallest-current conditions (the company's c and conductor temperature) for Ik1. */
export function shortCircuitCurrents(input: ShortCircuitInput): EngineResult<ShortCircuitResult> {
  const issues = new Issues();
  issues.positive(input.lineVoltageV, "voltage", "Spänningen");
  if (!Number.isFinite(input.c) || input.c < 0.8 || input.c > 1.2) issues.error("c", "Spänningsfaktorn c ligger utanför 0,8–1,2. Kontrollera värdet.");
  const zPhase = magnitude(input.point.phase);
  const zLoop = magnitude(input.point.loop);
  if (!(zPhase > 0) || !(zLoop > 0)) issues.error("impedance", "Impedansen måste vara större än noll.");
  if (issues.errors.length) return issues.fail();
  if (zLoop < zPhase * 0.99) issues.warn("loopBelowPhase", "Slingimpedansen är lägre än fasimpedansen, vilket är ovanligt. Kontrollera värdena.");
  const ik3 = (input.c * input.lineVoltageV) / (SQRT3 * zPhase);
  return issues.done({ phaseOhm: zPhase, loopOhm: zLoop, ik3A: ik3, ik2A: (SQRT3 / 2) * ik3, ik1A: (input.c * input.lineVoltageV) / (SQRT3 * zLoop) });
}
