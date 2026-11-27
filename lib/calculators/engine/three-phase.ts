import { agrees, Issues, SQRT3, type EngineResult } from "./common";

/**
 * Power and current of a symmetrical load (Kalkylator, 2026-10-12), three-phase (default) or single-phase.
 *
 *   S = √3·U·I       P = S·cos φ       Q = S·sin φ       S² = P² + Q²       (single-phase: S = U·I)
 *
 * Give the voltage and enough of the others: current, S, P with cos φ, P with Q, or Q with cos φ. Everything that can
 * be calculated is returned; what cannot (P and Q without a cos φ) is null with a warning. A load is taken as
 * inductive (current lagging, Q positive).
 */
export type PowerInput = {
  /** 3 (default) or 1. */
  phases?: 1 | 3;
  /** Line voltage U between two phases, V (the voltage across the load for a single-phase one). */
  lineVoltageV?: number;
  /** Phase voltage, V; for three phases the line voltage is √3 times this. Either of the two is enough. */
  phaseVoltageV?: number;
  currentA?: number;
  powerW?: number;
  apparentVA?: number;
  reactiveVar?: number;
  cosPhi?: number;
};
export type PowerResult = {
  phases: 1 | 3;
  lineVoltageV: number;
  phaseVoltageV: number;
  currentA: number;
  apparentVA: number;
  /** null when there was no cos φ and no P or Q to get it from. */
  powerW: number | null;
  reactiveVar: number | null;
  cosPhi: number | null;
  /** φ in degrees. */
  phiDegrees: number | null;
};

export function threePhasePower(input: PowerInput): EngineResult<PowerResult> {
  const issues = new Issues();
  const phases = input.phases ?? 3;
  const k = phases === 3 ? SQRT3 : 1;
  for (const [value, code, label] of [
    [input.lineVoltageV, "lineVoltage", "Spänningen"], [input.phaseVoltageV, "phaseVoltage", "Fasspänningen"], [input.currentA, "current", "Strömmen"],
    [input.powerW, "power", "Aktiv effekt"], [input.apparentVA, "apparent", "Skenbar effekt"],
  ] as const) if (value !== undefined) issues.positive(value, code, label);
  if (input.reactiveVar !== undefined && !Number.isFinite(input.reactiveVar)) issues.error("reactive", "Reaktiv effekt måste vara ett tal.");
  if (input.cosPhi !== undefined) issues.cosPhi(input.cosPhi);

  let u = input.lineVoltageV;
  if (u === undefined && input.phaseVoltageV !== undefined) u = phases === 3 ? input.phaseVoltageV * SQRT3 : input.phaseVoltageV;
  else if (u !== undefined && input.phaseVoltageV !== undefined) {
    const expected = phases === 3 ? input.phaseVoltageV * SQRT3 : input.phaseVoltageV;
    if (!agrees(u, expected)) issues.warn("voltageMismatch", "Linje- och fasspänning stämmer inte med varandra. Linjespänningen används.");
  }
  if (u === undefined) issues.error("voltageMissing", "Ange spänningen.");
  if (issues.errors.length || u === undefined) return issues.fail();
  issues.usual(u, 12, 40000, "voltageRange", "Spänningen", "12 V till 40 kV");

  // The apparent power, from the first thing that gives it.
  const { currentA: i, powerW: p, reactiveVar: q, cosPhi: pf } = input;
  let s: number | undefined = input.apparentVA;
  if (s === undefined && i !== undefined) s = k * u * i;
  if (s === undefined && p !== undefined && pf !== undefined) s = p / pf;
  if (s === undefined && p !== undefined && q !== undefined) s = Math.hypot(p, q);
  if (s === undefined && q !== undefined && pf !== undefined && pf < 1) s = Math.abs(q) / Math.sqrt(1 - pf * pf);
  if (s === undefined) {
    issues.error("underdetermined", "Det räcker inte för att räkna: ange strömmen, skenbar effekt, eller aktiv effekt med cos φ (eller reaktiv effekt).");
    return issues.fail();
  }

  // cos φ from what was given.
  let cos: number | null = pf ?? null;
  if (cos === null && p !== undefined) cos = p / s;
  if (cos === null && q !== undefined) cos = Math.sqrt(Math.max(0, 1 - (q / s) ** 2));
  if (cos !== null && cos > 1 + 1e-9) {
    issues.error("powerExceedsApparent", "Aktiv effekt kan inte vara större än skenbar effekt.");
    return issues.fail();
  }
  if (cos !== null) cos = Math.min(1, cos);
  if (cos !== null && cos <= 0) { issues.error("cosPhi", "cos φ måste vara större än 0."); return issues.fail(); }

  const power = cos === null ? null : s * cos;
  const sin = cos === null ? null : Math.sqrt(Math.max(0, 1 - cos * cos));
  const reactive = sin === null ? null : s * sin;
  const current = s / (k * u);

  // Over-specified input that does not agree.
  const check = (given: number | undefined, calculated: number | null, label: string) => {
    if (given !== undefined && calculated !== null && !agrees(given, calculated)) issues.warn("inconsistent", `${label} stämmer inte med de övriga värdena (räknat värde används).`);
  };
  check(i, current, "Strömmen");
  check(p, power, "Aktiv effekt");
  check(input.apparentVA, s, "Skenbar effekt");
  check(q === undefined ? undefined : Math.abs(q), reactive, "Reaktiv effekt");
  if (cos === null) issues.warn("noCosPhi", "cos φ saknas, så aktiv och reaktiv effekt kan inte räknas. Ange cos φ.");
  else if (pf === undefined && p === undefined) issues.warn("cosPhiFromQ", "cos φ är härledd ur reaktiv effekt.");
  issues.usual(current, 0.001, 20000, "currentRange", "Strömmen", "1 mA till 20 kA");
  if (q !== undefined && q < 0) issues.warn("capacitive", "Negativ reaktiv effekt (kapacitiv last) behandlas som induktiv i resultatet. Beloppet används.");

  return issues.done({
    phases, lineVoltageV: u, phaseVoltageV: phases === 3 ? u / SQRT3 : u, currentA: current, apparentVA: s,
    powerW: power, reactiveVar: reactive, cosPhi: cos, phiDegrees: cos === null ? null : (Math.acos(cos) * 180) / Math.PI,
  });
}

/** Reactive power to compensate from cos φ1 to cos φ2 for an active power: Qc = P·(tan φ1 − tan φ2). */
export function compensationReactivePower(powerW: number, cosPhiBefore: number, cosPhiAfter: number): EngineResult<{ capacitorVar: number; before: number; after: number }> {
  const issues = new Issues();
  issues.positive(powerW, "power", "Aktiv effekt");
  issues.cosPhi(cosPhiBefore, "cosPhiBefore");
  issues.cosPhi(cosPhiAfter, "cosPhiAfter");
  if (issues.errors.length) return issues.fail();
  if (cosPhiAfter < cosPhiBefore) issues.warn("worse", "Önskad cos φ är lägre än den nuvarande, så ingen kompensering behövs.");
  const tan = (cos: number) => Math.sqrt(1 - cos * cos) / cos;
  const before = powerW * tan(cosPhiBefore);
  const after = powerW * tan(cosPhiAfter);
  return issues.done({ capacitorVar: before - after, before, after });
}
