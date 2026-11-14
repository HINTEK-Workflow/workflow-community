import { Issues, toOhm, type EngineResult, type OhmValue } from "./common";
import { checkParallel, conductorResistancePerM, resistancePerMeter, splitImpedance, type ConductorSpec, type Impedance, SUGGESTED_REACTANCE_OHM_PER_M } from "./impedance";

/**
 * Longest branch-circuit length for automatic disconnection (Kalkylator, 2026-10-12). The loop impedance at the
 * end of the cable, the source's loop impedance plus the cable's loop (out along the phase conductor, back along the
 * protective conductor), must stay at or below c·U0/Ia:
 *
 *   Zs(L) = |Zsource + L·zloop| ≤ c·U0 / Ia          zloop = (ρ/A_phase + ρ/A_pe) + j·2x
 *
 * Solved exactly (the quadratic in L), so the reactance of the cable counts. The device (Ia for the required time) and
 * the source are INPUT. The source is given either as the earth-fault current at the source or as a loop impedance
 * with its unit stated (mΩ or Ω; 0,2 Ω is 200 mΩ).
 */
export type BranchSource =
  /** The earth-fault current at the source (phase to PE), A: Zsource = U0 / Ik1. */
  | { kind: "earthFaultCurrent"; ik1A: number }
  /** The source's earth-fault loop impedance, with unit. */
  | { kind: "impedance"; impedance: OhmValue };

export type BranchLengthInput = ConductorSpec & {
  /** Phase-to-earth voltage U0, V. */
  u0V: number;
  /** The current that trips the device within the required time, A (input from the maker's data). */
  tripCurrentA: number;
  requiredTimeS?: number;
  source: BranchSource;
  /**
   * R/X of the source. Without it the source impedance is added in magnitude to the cable's (arithmetic sum), which is
   * a safe simplification (slightly shorter length).
   */
  sourceROverX?: number;
  /** Phase conductor area, mm². */
  areaMm2: number;
  /** Protective conductor area, mm²; default equal to the phase conductor (and a warning says so). */
  returnAreaMm2?: number;
  /** The protective conductor's own resistance per metre at 20 °C, Ω/m (datasheet); without a protective conductor area the phase conductor's own value is used. */
  returnResistancePerM20?: number;
  /** Reactance per metre of one conductor, Ω/m; default a suggestion. */
  reactancePerM?: number;
  /** Conductors in parallel per phase; default 1. */
  parallel?: number;
  /** Protective conductors in parallel; default the same as the phase (and a warning says so when that is more than one). */
  returnParallel?: number;
  /** Voltage factor c; default 1. */
  c?: number;
  /** An actual length to check against the limit, m. */
  lengthM?: number;
};
export type BranchLengthResult = {
  /** The longest length that still trips in time, m; 0 when the source alone is already too weak. */
  maxLengthM: number;
  /** Zs,max = c·U0/Ia, Ω. */
  zsMaxOhm: number;
  sourceOhm: number;
  /** Resistance per metre at the conductor temperature, Ω/m (and the same in mΩ/m). */
  phaseResistancePerM: number;
  returnResistancePerM: number;
  loopResistancePerM: number;
  loopResistanceMilliOhmPerM: number;
  /** The loop's reactance per metre, Ω/m. */
  loopReactancePerM: number;
  /** Zs at the longest length, Ω (equal to Zs,max unless the length is 0), and the earth-fault current there, A. */
  zsAtMaxOhm: number;
  ik1AtMaxA: number;
  /** When `lengthM` was given. */
  check: { lengthM: number; zsOhm: number; ik1A: number; ok: boolean } | null;
};

export function maxBranchLength(input: BranchLengthInput): EngineResult<BranchLengthResult> {
  const issues = new Issues();
  const c = input.c ?? 1;
  issues.positive(input.u0V, "u0", "Spänningen U0");
  issues.positive(input.tripCurrentA, "tripCurrent", "Utlösningsströmmen Ia");
  issues.positive(input.areaMm2, "area", "Arean");
  issues.positive(c, "c", "Spänningsfaktorn c");
  if (input.returnAreaMm2 !== undefined) issues.positive(input.returnAreaMm2, "returnArea", "Skyddsledarens area");
  if (input.reactancePerM !== undefined) issues.nonNegative(input.reactancePerM, "reactance", "Reaktansen");
  if (input.resistancePerM20 !== undefined) issues.positive(input.resistancePerM20, "resistance", "Ledarens resistans");
  if (input.returnResistancePerM20 !== undefined) issues.positive(input.returnResistancePerM20, "returnResistance", "Skyddsledarens resistans");
  if (input.requiredTimeS !== undefined) issues.positive(input.requiredTimeS, "time", "Frånkopplingstiden");
  if (input.lengthM !== undefined) issues.nonNegative(input.lengthM, "length", "Längden");
  checkParallel(issues, input.parallel, "parallel", "Antalet parallella ledare");
  checkParallel(issues, input.returnParallel, "returnParallel", "Antalet parallella skyddsledare");
  if (!Number.isFinite(input.temperatureC)) issues.error("temperature", "Temperaturen måste vara ett tal.");

  let sourceOhm = NaN;
  if (input.source.kind === "earthFaultCurrent") {
    if (issues.positive(input.source.ik1A, "ik1", "Jordslutningsströmmen vid källan")) sourceOhm = input.u0V / input.source.ik1A;
  } else if ((input.source.impedance.unit as string) !== "mΩ" && (input.source.impedance.unit as string) !== "Ω") {
    issues.error("unit", "Enheten för källans impedans måste vara Ω eller mΩ.");
  } else if (issues.positive(input.source.impedance.value, "sourceImpedance", "Källans impedans")) {
    sourceOhm = toOhm(input.source.impedance);
  }
  if (issues.errors.length) return issues.fail();

  // A source impedance in the wrong unit is the usual slip: 0,2 Ω typed as 0,2 mΩ or the other way round.
  if (sourceOhm < 0.0001) issues.warn("sourceTiny", `Källans impedans är bara ${(sourceOhm * 1000).toPrecision(2)} mΩ. Kontrollera enheten (mΩ eller Ω).`);
  if (sourceOhm > 2) issues.warn("sourceLarge", `Källans impedans är ${sourceOhm.toPrecision(3)} Ω, vilket är högt för en matning. Kontrollera enheten (mΩ eller Ω).`);
  if (input.tripCurrentA < 1) issues.warn("tripSmall", "Utlösningsströmmen är under 1 A. Kontrollera värdet.");
  if (input.requiredTimeS === undefined) issues.warn("noTime", "Kravtiden är inte angiven; kontrollera att Ia gäller den tid som krävs.");
  if (input.returnAreaMm2 === undefined) issues.warn("returnAssumed", "Skyddsledarens area saknas; den antas vara lika stor som fasledarens.");
  if ((input.parallel ?? 1) > 1 && input.returnParallel === undefined) issues.warn("returnParallelAssumed", "Antalet parallella skyddsledare saknas; det antas vara samma som fasledarna.");
  if (input.reactancePerM === undefined) issues.warn("reactanceSuggested", "Reaktans per meter är ett förslag (0,08 Ω/km). Ange kabelns eget värde.");

  const rPhase = resistancePerMeter(input, input.areaMm2);
  const rReturn = conductorResistancePerM(input, input.returnAreaMm2 ?? input.areaMm2, input.returnResistancePerM20 ?? (input.returnAreaMm2 === undefined ? input.resistancePerM20 : undefined));
  const x = input.reactancePerM ?? SUGGESTED_REACTANCE_OHM_PER_M;
  const parallel = input.parallel ?? 1;
  const returnParallel = input.returnParallel ?? parallel;
  const loop: Impedance = { r: rPhase / parallel + rReturn / returnParallel, x: x / parallel + x / returnParallel };
  // Source: with a ratio it is its own vector; without, it is put in line with the cable (arithmetic sum, the safe side).
  const angleSource = splitImpedance(sourceOhm, input.sourceROverX);
  const zloopMag = Math.hypot(loop.r, loop.x);
  const source: Impedance = input.sourceROverX === undefined ? { r: (sourceOhm * loop.r) / zloopMag, x: (sourceOhm * loop.x) / zloopMag } : angleSource;

  const zsMax = (c * input.u0V) / input.tripCurrentA;
  const a = loop.r * loop.r + loop.x * loop.x;
  const b = 2 * (source.r * loop.r + source.x * loop.x);
  const cc = source.r * source.r + source.x * source.x - zsMax * zsMax;
  let maxLength = 0;
  if (cc <= 0) maxLength = (-b + Math.sqrt(b * b - 4 * a * cc)) / (2 * a);
  else issues.warn("sourceTooWeak", "Källans impedans ensam är redan högre än vad som tillåts. Utlösningsvillkoret klaras inte ens vid källan.");
  const zsAt = (length: number) => Math.hypot(source.r + loop.r * length, source.x + loop.x * length);
  const zsAtMax = zsAt(maxLength);
  const check = input.lengthM === undefined ? null : (() => {
    const z = zsAt(input.lengthM);
    return { lengthM: input.lengthM, zsOhm: z, ik1A: (c * input.u0V) / z, ok: z <= zsMax };
  })();
  return issues.done({
    maxLengthM: maxLength, zsMaxOhm: zsMax, sourceOhm,
    phaseResistancePerM: rPhase, returnResistancePerM: rReturn, loopResistancePerM: loop.r, loopResistanceMilliOhmPerM: loop.r * 1000, loopReactancePerM: loop.x,
    zsAtMaxOhm: zsAtMax, ik1AtMaxA: (c * input.u0V) / zsAtMax, check,
  });
}
