import { Issues, type EngineResult } from "./common";
import { magnitude, type Impedance } from "./impedance";

/**
 * Automatic disconnection (frånkopplingstid), Kalkylator, 2026-10-12. The earth-fault current at the end of a
 * circuit must be at least the current Ia that makes the protective device trip within the required time:
 *
 *   Ik1 = c·U0 / Zs ≥ Ia      equivalent to      Zs ≤ c·U0 / Ia = Zs,max
 *
 * The required time and Ia are INPUT: the technician (or the company's own list) reads Ia from the device maker's
 * time–current curve for that time. No device table and no multiple of the rated current is built in (
 * 2026-11-01): without Ia there is no answer.
 */
export type DisconnectionInput = {
  /** The earth-fault loop impedance Zs: a number in ohm, or R and X. */
  loopImpedance: number | Impedance;
  /** Phase-to-earth voltage U0, V (often 230). */
  u0V: number;
  /** The current that makes the device trip within the required time, A. Input, from the maker's data. */
  tripCurrentA: number;
  /** The required disconnection time, s. Input; only repeated in the result so the report states which time was meant. */
  requiredTimeS?: number;
  /** Voltage factor c for the smallest current; default 1. */
  c?: number;
  /** Rated current In of the device, A; only used to warn when Ia is below In. */
  ratedCurrentA?: number;
};
export type DisconnectionResult = {
  zsOhm: number;
  /** The highest loop impedance that still trips within the time: c·U0/Ia, Ω. */
  zsMaxOhm: number;
  /** Zs,max − Zs, Ω (negative when the requirement is not met). */
  zsMarginOhm: number;
  ik1A: number;
  tripCurrentA: number;
  requiredTimeS: number | null;
  /** Ik1 / Ia; above 1 the requirement is met. */
  currentRatio: number;
  /** The same as a percentage margin: (Ik1/Ia − 1)·100. */
  marginPercent: number;
  /** True when the device trips within the time. (Not called `ok`: that is the success flag of the result.) */
  meetsRequirement: boolean;
};

/** The highest loop impedance that trips the device: Zs,max = c·U0 / Ia. */
export function maxLoopImpedance(u0V: number, tripCurrentA: number, c = 1): EngineResult<{ zsMaxOhm: number }> {
  const issues = new Issues();
  issues.positive(u0V, "u0", "Spänningen U0");
  issues.positive(tripCurrentA, "tripCurrent", "Utlösningsströmmen Ia");
  issues.positive(c, "c", "Spänningsfaktorn c");
  if (issues.errors.length) return issues.fail();
  return issues.done({ zsMaxOhm: (c * u0V) / tripCurrentA });
}

/** Does the circuit trip within the required time: Zs against Ia. */
export function checkDisconnection(input: DisconnectionInput): EngineResult<DisconnectionResult> {
  const issues = new Issues();
  const zs = typeof input.loopImpedance === "number" ? input.loopImpedance : magnitude(input.loopImpedance);
  const c = input.c ?? 1;
  issues.positive(zs, "loopImpedance", "Slingimpedansen Zs");
  issues.positive(input.u0V, "u0", "Spänningen U0");
  issues.positive(input.tripCurrentA, "tripCurrent", "Utlösningsströmmen Ia");
  issues.positive(c, "c", "Spänningsfaktorn c");
  if (input.requiredTimeS !== undefined) issues.positive(input.requiredTimeS, "time", "Frånkopplingstiden");
  if (issues.errors.length) return issues.fail();
  if (zs > 5) issues.warn("zsRange", "Slingimpedansen är över 5 Ω. Kontrollera att den är i ohm och inte i milliohm.");
  if (zs < 0.0005) issues.warn("zsRangeLow", "Slingimpedansen är under 0,5 mΩ. Kontrollera att den är i ohm och inte i milliohm.");
  if (input.u0V < 50 || input.u0V > 1000) issues.warn("u0Range", "U0 ligger utanför det vanliga för fasspänning. Kontrollera värdet.");
  if (input.ratedCurrentA !== undefined && input.tripCurrentA < input.ratedCurrentA) issues.warn("tripBelowRated", "Utlösningsströmmen Ia är lägre än apparatens märkström. Kontrollera Ia.");
  if (input.requiredTimeS === undefined) issues.warn("noTime", "Kravtiden är inte angiven; kontrollera att Ia gäller den tid som krävs.");
  const ik1 = (c * input.u0V) / zs;
  const zsMax = (c * input.u0V) / input.tripCurrentA;
  return issues.done({
    zsOhm: zs, zsMaxOhm: zsMax, zsMarginOhm: zsMax - zs, ik1A: ik1, tripCurrentA: input.tripCurrentA, requiredTimeS: input.requiredTimeS ?? null,
    currentRatio: ik1 / input.tripCurrentA, marginPercent: (ik1 / input.tripCurrentA - 1) * 100, meetsRequirement: ik1 >= input.tripCurrentA,
  });
}

