import { defineCalculator } from "./define";
import { formatNumber } from "./number";
import type { CalcModule, Choices, OutputRow } from "./types";
import { formatQuantity, type Dimension } from "./units";

/**
 * Ström och effekt (Räkneverktyg, 2026-10-07): single- and three-phase power. The person fills in what is known
 * and the tool solves the rest – the voltage U, the current I, the apparent power S, the active power P, the reactive
 * power Q, the power factor cos φ and, for a motor, the efficiency η and the power it delivers. Three independent
 * values are needed; more values than that are checked against each other.
 *
 *   S = k × U × I   (k = √3 for three phases, 1 for one)      P = S × cos φ      Q = S × sin φ      P ut = P × η
 *
 * Reactive power is a magnitude: whether the load is inductive or capacitive does not change the figures.
 */
export type PowerQuantity = "u" | "i" | "s" | "p" | "q" | "pf" | "eta" | "pu";
export type PowerValues = Partial<Record<PowerQuantity, number>>;
export type PowerSolution = { ok: true; values: PowerValues; given: PowerQuantity[]; derived: PowerQuantity[]; steps: string[] } | { ok: false; error: string };

export const POWER_QUANTITIES: Record<PowerQuantity, { label: string; dimension: Dimension }> = {
  u: { label: "Spänning U", dimension: "voltage" },
  i: { label: "Ström I", dimension: "current" },
  s: { label: "Skenbar effekt S", dimension: "apparentPower" },
  p: { label: "Aktiv effekt P", dimension: "power" },
  q: { label: "Reaktiv effekt Q", dimension: "reactivePower" },
  pf: { label: "Effektfaktor cos φ", dimension: "ratio" },
  eta: { label: "Verkningsgrad η", dimension: "ratio" },
  pu: { label: "Avgiven effekt P ut", dimension: "power" },
};
const ORDER: PowerQuantity[] = ["u", "i", "s", "p", "q", "pf", "eta", "pu"];
const SQRT3 = Math.sqrt(3);
/** Values given twice may differ by this much (typed numbers are rounded) before the tool calls them inconsistent. */
export const POWER_TOLERANCE = 0.01;

class SolveError extends Error {}

const show = (quantity: PowerQuantity, value: number) => {
  const { dimension } = POWER_QUANTITIES[quantity];
  return dimension === "ratio" ? formatNumber(value) : formatQuantity(value, dimension);
};
/** The value in a formula, "√3 × " in front of three-phase terms. */
const root = (k: number) => (k === 1 ? "" : "√3 × ");
const defined = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value);
const closeTo = (a: number, b: number) => Math.abs(a - b) <= POWER_TOLERANCE * Math.max(Math.abs(a), Math.abs(b)) + 1e-12;

/** A value that is a ratio of two others may exceed 1 by rounding only; clamps that, refuses more. */
function ratio(value: number, message: string): number {
  if (value > 1 + POWER_TOLERANCE) throw new SolveError(message);
  return Math.min(1, value);
}
/** The difference of two squares, which may only be negative by rounding. */
function rootOfDifference(larger: number, smaller: number, message: string): number {
  const difference = larger * larger - smaller * smaller;
  if (difference < 0 && smaller > larger * (1 + POWER_TOLERANCE)) throw new SolveError(message);
  return Math.sqrt(Math.max(0, difference));
}

type V = PowerValues;
type Rule = {
  target: PowerQuantity;
  needs: PowerQuantity[];
  when?: (v: V, k: number) => boolean;
  calc: (v: V, k: number) => number;
  formula: (k: number) => string;
  /** The formula with the values put in. */
  put: (v: V, k: number) => string;
};

const positive = (value: number | undefined) => defined(value) && value > 0;
const RULES: Rule[] = [
  { target: "s", needs: ["u", "i"], calc: (v, k) => k * v.u! * v.i!, formula: (k) => `S = ${root(k)}U × I`, put: (v, k) => `${root(k)}${show("u", v.u!)} × ${show("i", v.i!)}` },
  { target: "u", needs: ["s", "i"], when: (v) => positive(v.i), calc: (v, k) => v.s! / (k * v.i!), formula: (k) => `U = S / (${root(k)}I)`, put: (v, k) => `${show("s", v.s!)} / (${root(k)}${show("i", v.i!)})` },
  { target: "i", needs: ["s", "u"], when: (v) => positive(v.u), calc: (v, k) => v.s! / (k * v.u!), formula: (k) => `I = S / (${root(k)}U)`, put: (v, k) => `${show("s", v.s!)} / (${root(k)}${show("u", v.u!)})` },
  { target: "p", needs: ["s", "pf"], calc: (v) => v.s! * v.pf!, formula: () => "P = S × cos φ", put: (v) => `${show("s", v.s!)} × ${formatNumber(v.pf!)}` },
  { target: "s", needs: ["p", "pf"], when: (v) => positive(v.pf), calc: (v) => v.p! / v.pf!, formula: () => "S = P / cos φ", put: (v) => `${show("p", v.p!)} / ${formatNumber(v.pf!)}` },
  { target: "pf", needs: ["p", "s"], when: (v) => positive(v.s), calc: (v) => ratio(v.p! / v.s!, "Aktiv effekt kan inte vara större än skenbar effekt."), formula: () => "cos φ = P / S", put: (v) => `${show("p", v.p!)} / ${show("s", v.s!)}` },
  { target: "q", needs: ["s", "pf"], calc: (v) => v.s! * Math.sqrt(Math.max(0, 1 - v.pf! * v.pf!)), formula: () => "Q = S × sin φ = S × √(1 − cos² φ)", put: (v) => `${show("s", v.s!)} × √(1 − ${formatNumber(v.pf!)}²)` },
  { target: "s", needs: ["q", "pf"], when: (v) => defined(v.pf) && v.pf < 1, calc: (v) => v.q! / Math.sqrt(1 - v.pf! * v.pf!), formula: () => "S = Q / sin φ = Q / √(1 − cos² φ)", put: (v) => `${show("q", v.q!)} / √(1 − ${formatNumber(v.pf!)}²)` },
  { target: "pf", needs: ["q", "s"], when: (v) => positive(v.s), calc: (v) => Math.sqrt(1 - ratio(v.q! / v.s!, "Reaktiv effekt kan inte vara större än skenbar effekt.") ** 2), formula: () => "cos φ = √(1 − (Q / S)²)", put: (v) => `√(1 − (${show("q", v.q!)} / ${show("s", v.s!)})²)` },
  { target: "s", needs: ["p", "q"], calc: (v) => Math.hypot(v.p!, v.q!), formula: () => "S = √(P² + Q²)", put: (v) => `√((${show("p", v.p!)})² + (${show("q", v.q!)})²)` },
  { target: "p", needs: ["s", "q"], calc: (v) => rootOfDifference(v.s!, v.q!, "Reaktiv effekt kan inte vara större än skenbar effekt."), formula: () => "P = √(S² − Q²)", put: (v) => `√((${show("s", v.s!)})² − (${show("q", v.q!)})²)` },
  { target: "q", needs: ["s", "p"], calc: (v) => rootOfDifference(v.s!, v.p!, "Aktiv effekt kan inte vara större än skenbar effekt."), formula: () => "Q = √(S² − P²)", put: (v) => `√((${show("s", v.s!)})² − (${show("p", v.p!)})²)` },
  { target: "pu", needs: ["p", "eta"], calc: (v) => v.p! * v.eta!, formula: () => "P ut = P × η", put: (v) => `${show("p", v.p!)} × ${formatNumber(v.eta!)}` },
  { target: "p", needs: ["pu", "eta"], when: (v) => positive(v.eta), calc: (v) => v.pu! / v.eta!, formula: () => "P = P ut / η", put: (v) => `${show("pu", v.pu!)} / ${formatNumber(v.eta!)}` },
  { target: "eta", needs: ["pu", "p"], when: (v) => positive(v.p), calc: (v) => ratio(v.pu! / v.p!, "Avgiven effekt kan inte vara större än tillförd effekt."), formula: () => "η = P ut / P", put: (v) => `${show("pu", v.pu!)} / ${show("p", v.p!)}` },
];

type Relation = { needs: PowerQuantity[]; expected: (v: V, k: number) => number; actual: (v: V) => number; label: PowerQuantity; message: (k: number, expected: string, actual: string) => string };
/** The relations a set of given values must satisfy together; a value that was calculated satisfies them by construction. */
const RELATIONS: Relation[] = [
  { needs: ["s", "u", "i"], label: "s", expected: (v, k) => k * v.u! * v.i!, actual: (v) => v.s!, message: (k, e, a) => `Skenbar effekt, spänning och ström hänger inte ihop: ${root(k)}U × I = ${e}, men S är ${a}.` },
  { needs: ["p", "s", "pf"], label: "p", expected: (v) => v.s! * v.pf!, actual: (v) => v.p!, message: (_k, e, a) => `Aktiv effekt, skenbar effekt och cos φ hänger inte ihop: S × cos φ = ${e}, men P är ${a}.` },
  { needs: ["q", "s", "pf"], label: "q", expected: (v) => v.s! * Math.sqrt(Math.max(0, 1 - v.pf! * v.pf!)), actual: (v) => v.q!, message: (_k, e, a) => `Reaktiv effekt, skenbar effekt och cos φ hänger inte ihop: S × sin φ = ${e}, men Q är ${a}.` },
  { needs: ["s", "p", "q"], label: "s", expected: (v) => Math.hypot(v.p!, v.q!), actual: (v) => v.s!, message: (_k, e, a) => `Effekterna hänger inte ihop: √(P² + Q²) = ${e}, men S är ${a}.` },
  { needs: ["pu", "p", "eta"], label: "pu", expected: (v) => v.p! * v.eta!, actual: (v) => v.pu!, message: (_k, e, a) => `Avgiven effekt, tillförd effekt och verkningsgrad hänger inte ihop: P × η = ${e}, men P ut är ${a}.` },
];

/**
 * Solves the quantities that can be solved from the given ones, and checks values given twice against each other.
 * `phases` is 3 for a three-phase supply (U is the line-to-line voltage) and 1 for a single-phase one.
 */
export function solvePower(phases: 1 | 3, given: PowerValues): PowerSolution {
  const k = phases === 3 ? SQRT3 : 1;
  const values: V = {};
  for (const quantity of ORDER) if (defined(given[quantity])) values[quantity] = given[quantity];
  const givenQuantities = ORDER.filter((quantity) => values[quantity] !== undefined);
  try {
    for (const quantity of givenQuantities) {
      const value = values[quantity]!;
      const { label } = POWER_QUANTITIES[quantity];
      if (value < 0) throw new SolveError(`${label} kan inte vara negativ.`);
      if (quantity === "u" && value === 0) throw new SolveError("Spänningen måste vara större än noll.");
      if (quantity === "pf" && value > 1) throw new SolveError("Effektfaktorn cos φ ligger mellan 0 och 1.");
      if (quantity === "eta" && (value <= 0 || value > 1)) throw new SolveError("Verkningsgraden η är större än 0 och högst 1.");
    }
    if (values.pf === 0 && (values.p ?? 0) > 0) throw new SolveError("Aktiv effekt är noll när cos φ är 0.");
    if (values.pf === 1 && (values.q ?? 0) > 0) throw new SolveError("Reaktiv effekt är noll när cos φ är 1.");
    const derived: PowerQuantity[] = [];
    const steps: string[] = [];
    for (let pass = 0, progress = true; progress && pass < 24; pass++) {
      progress = false;
      for (const rule of RULES) {
        if (values[rule.target] !== undefined || !rule.needs.every((need) => defined(values[need]))) continue;
        if (rule.when && !rule.when(values, k)) continue;
        const result = rule.calc(values, k);
        if (!Number.isFinite(result)) continue;
        values[rule.target] = result;
        derived.push(rule.target);
        steps.push(`${POWER_QUANTITIES[rule.target].label}: ${rule.formula(k)} = ${rule.put(values, k)} = ${show(rule.target, result)}`);
        progress = true;
      }
    }
    // The apparent power is the largest of the three powers, however the values came about.
    if (defined(values.s) && defined(values.p) && values.p > values.s * (1 + POWER_TOLERANCE)) throw new SolveError("Aktiv effekt kan inte vara större än skenbar effekt.");
    if (defined(values.s) && defined(values.q) && values.q > values.s * (1 + POWER_TOLERANCE)) throw new SolveError("Reaktiv effekt kan inte vara större än skenbar effekt.");
    for (const relation of RELATIONS) {
      if (!relation.needs.every((need) => defined(values[need]))) continue;
      const expected = relation.expected(values, k);
      const actual = relation.actual(values);
      if (!closeTo(expected, actual)) throw new SolveError(relation.message(k, show(relation.label, expected), show(relation.label, actual)));
    }
    return { ok: true, values, given: givenQuantities, derived, steps };
  } catch (error) {
    if (error instanceof SolveError) return { ok: false, error: error.message };
    throw error;
  }
}

const phaseChoices = [{ value: "3", label: "Trefas" }, { value: "1", label: "Enfas" }];
const nominal = (choices: Choices) => (choices.phases === "1" ? "230" : "400");
const GROUPS = { net: { title: "Nät och last" }, power: { title: "Effekt" }, motor: { title: "Motor", hint: "Valfritt: för en motor är märkeffekten den avgivna effekten." } };
const KEY_QUANTITIES: PowerQuantity[] = ["u", "i", "s", "p", "q", "pf"];

export const powerModule: CalcModule = defineCalculator({
  id: "power",
  name: "Ström och effekt",
  summary: "Enfas och trefas: räkna ut den storhet som saknas.",
  groups: GROUPS,
  inputs: [
    { kind: "choice", id: "phases", label: "System", options: phaseChoices, initial: "3", display: "segmented", group: "net" },
    { kind: "number", id: "u", label: "Spänning U", dimension: "voltage", initial: nominal, min: 0, minExclusive: true, usual: [12, 40000], group: "net", help: "Huvudspänning vid trefas, fasspänning vid enfas." },
    { kind: "number", id: "i", label: "Ström I", dimension: "current", min: 0, group: "net" },
    { kind: "number", id: "s", label: "Skenbar effekt S", dimension: "apparentPower", defaultUnit: "kVA", min: 0, group: "power" },
    { kind: "number", id: "p", label: "Aktiv effekt P", dimension: "power", defaultUnit: "kW", min: 0, group: "power" },
    { kind: "number", id: "q", label: "Reaktiv effekt Q", dimension: "reactivePower", defaultUnit: "kVAr", min: 0, group: "power", help: "Anges som belopp." },
    { kind: "number", id: "pf", label: "Effektfaktor cos φ", dimension: "ratio", min: 0, max: 1, group: "power", help: "Mellan 0 och 1." },
    { kind: "number", id: "eta", label: "Verkningsgrad η", dimension: "ratio", min: 0, minExclusive: true, max: 1, group: "motor", help: "Mellan 0 och 1." },
    { kind: "number", id: "pu", label: "Avgiven effekt P ut", dimension: "power", defaultUnit: "kW", min: 0, group: "motor", help: "Axeleffekt för en motor." },
  ],
  outputs: ORDER.map((quantity) => ({ id: quantity, label: POWER_QUANTITIES[quantity].label, dimension: POWER_QUANTITIES[quantity].dimension })),
  help: [
    "Fyll i det du vet – verktyget räknar ut resten. Tre oberoende värden räcker, till exempel spänning, ström och cos φ. Fyller du i fler kontrolleras de mot varandra.",
    "Spänningen är huvudspänningen mellan faserna vid trefas och fasspänningen vid enfas. Reaktiv effekt anges som ett belopp.",
    "För en motor är märkeffekten den avgivna effekten (P ut). Ange verkningsgraden så räknas den tillförda effekten och strömmen ut.",
  ],
  compute: ({ numbers, choices }) => {
    const phases = choices.phases === "1" ? 1 : 3;
    const given: PowerValues = {};
    for (const quantity of ORDER) if (numbers[quantity] !== undefined) given[quantity] = numbers[quantity];
    const solved = solvePower(phases, given);
    if (!solved.ok) return { status: "invalid", errors: [{ message: solved.error }] };
    if (!solved.derived.length) return { status: "incomplete", message: "Ange fler värden, till exempel spänning, ström och cos φ, så räknas resten ut." };
    const rows: OutputRow[] = ORDER.filter((quantity) => solved.values[quantity] !== undefined).map((quantity) => {
      const isDerived = solved.derived.includes(quantity);
      return { kind: "quantity", id: quantity, label: POWER_QUANTITIES[quantity].label, value: solved.values[quantity]!, dimension: POWER_QUANTITIES[quantity].dimension, derived: isDerived, primary: isDerived };
    });
    const unknown = KEY_QUANTITIES.filter((quantity) => solved.values[quantity] === undefined).map((quantity) => POWER_QUANTITIES[quantity].label);
    return {
      status: "ok", rows,
      steps: [`${phases === 3 ? "Trefas" : "Enfas"}: S = ${root(phases === 3 ? SQRT3 : 1)}U × I, P = S × cos φ, Q = S × sin φ.`, ...solved.steps],
      notes: unknown.length ? [{ tone: "info", text: `Inte bestämt av de angivna värdena: ${unknown.join(", ")}. Ange ytterligare ett värde för att få med dem.` }] : [],
    };
  },
});
