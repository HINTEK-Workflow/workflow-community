import { Issues, SQRT3, type EngineResult } from "./common";
import { impedanceFromShortCircuitPower, magnitude, splitImpedance, type Impedance } from "./impedance";

/**
 * Transformer (Kalkylator, 2026-10-12). From the rated power, the two rated voltages and the short-circuit
 * voltage uk (in %):
 *
 *   I = S / (√3·U)      Zk = uk/100 · U² / S      Sk = S / (uk/100)      Ik3 = Sk / (√3·U2)
 *
 * The load loss Pk (at rated current) gives the resistance: Rk = Pk / (3·I²), uk's resistive part ur = Pk / S and the
 * reactance Xk = √(Zk² − Rk²). Without a load loss the transformer is calculated as pure reactance, which is the
 * usual assumption and gives a somewhat higher (safe for sizing equipment) short-circuit current.
 */
export type TransformerInput = {
  /** Rated apparent power, VA (kVA × 1000). */
  ratedVA: number;
  /** Rated line voltage on the primary (HV) side, V. */
  primaryVoltageV: number;
  /** Rated line voltage on the secondary (LV) side, V. */
  secondaryVoltageV: number;
  /** Short-circuit voltage uk, % of the rated voltage. */
  ukPercent: number;
  /** Load (copper) loss at rated current, W. Optional. */
  loadLossW?: number;
  /** No-load (iron) loss, W. Optional. */
  noLoadLossW?: number;
};
export type TransformerResult = {
  primaryCurrentA: number;
  secondaryCurrentA: number;
  /** Transformer short-circuit power Sk = S / uk, VA. */
  shortCircuitVA: number;
  /** Zk seen from the secondary and the primary side, Ω. */
  zkSecondaryOhm: number;
  zkPrimaryOhm: number;
  /** R and X seen from the secondary side. When there is no load loss, R is 0 and `resistanceKnown` is false. */
  secondary: Impedance;
  primary: Impedance;
  resistanceKnown: boolean;
  /** ur and ux in % when the load loss is given, otherwise null. */
  urPercent: number | null;
  uxPercent: number | null;
  /** Ik3 on the secondary terminals with an infinitely strong grid, A. */
  ik3SecondaryAtTerminalsA: number;
  /** Total loss at rated load and efficiency at rated load and cos φ 1, when both losses are given. */
  totalLossW: number | null;
  efficiencyAtUnity: number | null;
};

export function transformer(input: TransformerInput): EngineResult<TransformerResult> {
  const issues = new Issues();
  issues.positive(input.ratedVA, "rated", "Märkeffekten");
  issues.positive(input.primaryVoltageV, "primaryVoltage", "Primärspänningen");
  issues.positive(input.secondaryVoltageV, "secondaryVoltage", "Sekundärspänningen");
  issues.positive(input.ukPercent, "uk", "Kortslutningsspänningen uk");
  if (input.loadLossW !== undefined) issues.nonNegative(input.loadLossW, "loadLoss", "Belastningsförlusten");
  if (input.noLoadLossW !== undefined) issues.nonNegative(input.noLoadLossW, "noLoadLoss", "Tomgångsförlusten");
  if (issues.errors.length) return issues.fail();
  const { ratedVA: s, primaryVoltageV: u1, secondaryVoltageV: u2, ukPercent: uk } = input;
  if (u2 > u1) issues.warn("stepUp", "Sekundärspänningen är högre än primärspänningen (uppväxling). Kontrollera att HSP och LSP inte är omkastade.");
  if (s < 1000) issues.warn("ratedRange", "Märkeffekten är under 1 kVA. Kontrollera att den är angiven i VA (kVA × 1000).");
  if (uk < 1 || uk > 25) issues.warn("ukRange", "uk ligger utanför det vanliga (1–25 %). Kontrollera värdet.");

  const sk = s / (uk / 100);
  const zk2 = impedanceFromShortCircuitPower(u2, sk);
  const zk1 = impedanceFromShortCircuitPower(u1, sk);
  const i1 = s / (SQRT3 * u1);
  const i2 = s / (SQRT3 * u2);

  let secondary: Impedance;
  let primary: Impedance;
  let ur: number | null = null;
  let ux: number | null = null;
  let known = false;
  if (input.loadLossW !== undefined) {
    const rk2 = input.loadLossW / (3 * i2 * i2);
    if (rk2 > zk2) {
      issues.error("lossTooLarge", "Belastningsförlusten är för stor för uk: resistansen skulle bli större än impedansen. Kontrollera uk och förlusten.");
      return issues.fail();
    }
    const rk1 = input.loadLossW / (3 * i1 * i1);
    secondary = { r: rk2, x: Math.sqrt(zk2 * zk2 - rk2 * rk2) };
    primary = { r: rk1, x: Math.sqrt(zk1 * zk1 - rk1 * rk1) };
    ur = (input.loadLossW / s) * 100;
    ux = Math.sqrt(Math.max(0, uk * uk - ur * ur));
    known = true;
  } else {
    secondary = splitImpedance(zk2);
    primary = splitImpedance(zk1);
    issues.warn("pureReactance", "Utan belastningsförlust räknas transformatorn som ren reaktans (R = 0).");
  }
  const total = input.loadLossW !== undefined && input.noLoadLossW !== undefined ? input.loadLossW + input.noLoadLossW : null;
  return issues.done({
    primaryCurrentA: i1, secondaryCurrentA: i2, shortCircuitVA: sk, zkSecondaryOhm: zk2, zkPrimaryOhm: zk1, secondary, primary, resistanceKnown: known,
    urPercent: ur, uxPercent: ux, ik3SecondaryAtTerminalsA: sk / (SQRT3 * u2),
    totalLossW: total, efficiencyAtUnity: total === null ? null : s / (s + total),
  });
}

/** The grid feeding the transformer, given either by its short-circuit power or by its three-phase current on the primary side. */
export type GridSource = { kind: "power"; shortCircuitVA: number } | { kind: "current"; ik3A: number; voltageV: number };
export const gridShortCircuitVA = (grid: GridSource): number => (grid.kind === "power" ? grid.shortCircuitVA : SQRT3 * grid.voltageV * grid.ik3A);

export type TransformerShortCircuitInput = {
  transformer: TransformerInput;
  /** The grid on the primary side. Without it only the case without a grid (infinitely strong) is given. */
  grid?: GridSource;
  /** Voltage factor c; 1 for the largest current (suggestion: use a lower value for the smallest). */
  c?: number;
};
export type TransformerShortCircuitResult = {
  c: number;
  /** Impedance in front of the secondary terminals, from the grid (null without a grid). */
  gridSecondaryOhm: number | null;
  /** Total impedance at the secondary terminals, with the grid, and without (the transformer alone). */
  withGrid: Impedance | null;
  withoutGrid: Impedance;
  /** Secondary short-circuit currents, A. */
  ik3WithoutGridA: number;
  ik3WithGridA: number | null;
  /** The two-phase current, A: √3/2 · Ik3. */
  ik2WithoutGridA: number;
  ik2WithGridA: number | null;
};

/** The largest short-circuit currents on the secondary (LV) side, without the grid (the transformer alone) and with the grid in series. */
export function transformerShortCircuit(input: TransformerShortCircuitInput): EngineResult<TransformerShortCircuitResult> {
  const c = input.c ?? 1;
  const issues = new Issues();
  if (!Number.isFinite(c) || c < 0.8 || c > 1.2) issues.error("c", "Spänningsfaktorn c ligger utanför 0,8–1,2. Kontrollera värdet.");
  const t = transformer(input.transformer);
  if (!t.ok) return { ok: false, errors: [...issues.errors, ...t.errors] };
  if (issues.errors.length) return issues.fail();
  issues.warnings.push(...t.warnings);
  const u2 = input.transformer.secondaryVoltageV;
  const withoutGrid = { r: t.secondary.r, x: t.secondary.x };
  let gridZ: number | null = null;
  let withGrid: Impedance | null = null;
  if (input.grid) {
    const sg = gridShortCircuitVA(input.grid);
    if (!Number.isFinite(sg) || sg <= 0) { issues.error("grid", "Nätets kortslutningseffekt måste vara större än noll."); return issues.fail(); }
    if (sg < t.shortCircuitVA * 3) issues.warn("weakGrid", "Nätet är svagt jämfört med transformatorn, så nätets impedans påverkar resultatet kraftigt.");
    gridZ = impedanceFromShortCircuitPower(u2, sg);
    // The grid is taken as pure reactance (no R/X given); with R = 0 the impedance sum equals the series sum of the short-circuit powers.
    withGrid = { r: withoutGrid.r, x: withoutGrid.x + gridZ };
  }
  const ik = (z: Impedance) => (c * u2) / (SQRT3 * magnitude(z));
  const ik3 = ik(withoutGrid);
  const ik3g = withGrid ? ik(withGrid) : null;
  return issues.done({
    c, gridSecondaryOhm: gridZ, withGrid, withoutGrid, ik3WithoutGridA: ik3, ik3WithGridA: ik3g,
    ik2WithoutGridA: (SQRT3 / 2) * ik3, ik2WithGridA: ik3g === null ? null : (SQRT3 / 2) * ik3g,
  });
}
