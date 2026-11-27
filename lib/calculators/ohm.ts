import { defineCalculator } from "./define";
import { formatQuantity, type Dimension } from "./units";
import type { CalcModule, OutputRow } from "./types";

/**
 * Ohms lag (Räkneverktyg, 2026-10-07; moved here from the older calculator under Hjälp): any two of the
 * voltage U, the current I, the resistance R and the power P give the other two.
 *
 *   U = R × I     P = U × I = I² × R = U² / R
 *
 * Values given twice are checked against each other. A current of zero at a voltage above zero would mean an infinite
 * resistance, and a resistance of zero cannot be calculated with: both are refused.
 */
export type OhmQuantity = "u" | "i" | "r" | "p";
export type OhmValues = Partial<Record<OhmQuantity, number>>;
export type OhmSolution = { ok: true; values: OhmValues; given: OhmQuantity[]; derived: OhmQuantity[]; steps: string[] } | { ok: false; error: string };

export const OHM_QUANTITIES: Record<OhmQuantity, { label: string; dimension: Dimension }> = {
  u: { label: "Spänning U", dimension: "voltage" },
  i: { label: "Ström I", dimension: "current" },
  r: { label: "Resistans R", dimension: "resistance" },
  p: { label: "Effekt P", dimension: "power" },
};
const ORDER: OhmQuantity[] = ["u", "i", "r", "p"];
const TOLERANCE = 0.01;
const show = (quantity: OhmQuantity, value: number) => formatQuantity(value, OHM_QUANTITIES[quantity].dimension);
const defined = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value);
const positive = (value: number | undefined) => defined(value) && value > 0;
const close = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE * Math.max(Math.abs(a), Math.abs(b)) + 1e-12;

type Rule = { target: OhmQuantity; needs: OhmQuantity[]; when?: (v: OhmValues) => boolean; calc: (v: OhmValues) => number; formula: string; put: (v: OhmValues) => string };
const RULES: Rule[] = [
  { target: "u", needs: ["r", "i"], calc: (v) => v.r! * v.i!, formula: "U = R × I", put: (v) => `${show("r", v.r!)} × ${show("i", v.i!)}` },
  { target: "i", needs: ["u", "r"], when: (v) => positive(v.r), calc: (v) => v.u! / v.r!, formula: "I = U / R", put: (v) => `${show("u", v.u!)} / ${show("r", v.r!)}` },
  { target: "r", needs: ["u", "i"], when: (v) => positive(v.i), calc: (v) => v.u! / v.i!, formula: "R = U / I", put: (v) => `${show("u", v.u!)} / ${show("i", v.i!)}` },
  { target: "p", needs: ["u", "i"], calc: (v) => v.u! * v.i!, formula: "P = U × I", put: (v) => `${show("u", v.u!)} × ${show("i", v.i!)}` },
  { target: "i", needs: ["p", "u"], when: (v) => positive(v.u), calc: (v) => v.p! / v.u!, formula: "I = P / U", put: (v) => `${show("p", v.p!)} / ${show("u", v.u!)}` },
  { target: "u", needs: ["p", "i"], when: (v) => positive(v.i), calc: (v) => v.p! / v.i!, formula: "U = P / I", put: (v) => `${show("p", v.p!)} / ${show("i", v.i!)}` },
  { target: "i", needs: ["p", "r"], when: (v) => positive(v.r), calc: (v) => Math.sqrt(v.p! / v.r!), formula: "I = √(P / R)", put: (v) => `√(${show("p", v.p!)} / ${show("r", v.r!)})` },
];

/** Solves what the given values determine and checks values given twice against each other. */
export function solveOhm(given: OhmValues): OhmSolution {
  const values: OhmValues = {};
  for (const quantity of ORDER) if (defined(given[quantity])) values[quantity] = given[quantity];
  const givenQuantities = ORDER.filter((quantity) => values[quantity] !== undefined);
  for (const quantity of givenQuantities) {
    const value = values[quantity]!;
    if (value < 0) return { ok: false, error: `${OHM_QUANTITIES[quantity].label} kan inte vara negativ.` };
    if (quantity === "r" && value === 0) return { ok: false, error: "Resistansen måste vara större än noll." };
  }
  // Voltage over zero and no current at all: the resistance cannot be anything a calculation can use.
  if (positive(values.u) && values.i === 0 && values.r === undefined) return { ok: false, error: "Strömmen är noll vid en spänning över noll, så resistansen blir oändlig. Kontrollera värdena." };
  const derived: OhmQuantity[] = [];
  const steps: string[] = [];
  for (let pass = 0, progress = true; progress && pass < 12; pass++) {
    progress = false;
    for (const rule of RULES) {
      if (values[rule.target] !== undefined || !rule.needs.every((need) => defined(values[need]))) continue;
      if (rule.when && !rule.when(values)) continue;
      const result = rule.calc(values);
      if (!Number.isFinite(result)) continue;
      values[rule.target] = result;
      derived.push(rule.target);
      steps.push(`${OHM_QUANTITIES[rule.target].label}: ${rule.formula} = ${rule.put(values)} = ${show(rule.target, result)}`);
      progress = true;
    }
  }
  if (defined(values.r) && values.r <= 0) return { ok: false, error: "Resistansen måste vara större än noll. Kontrollera värdena." };
  if (defined(values.u) && defined(values.r) && defined(values.i) && !close(values.u, values.r * values.i)) {
    return { ok: false, error: `Spänning, resistans och ström hänger inte ihop: R × I = ${show("u", values.r * values.i)}, men U är ${show("u", values.u)}.` };
  }
  if (defined(values.p) && defined(values.u) && defined(values.i) && !close(values.p, values.u * values.i)) {
    return { ok: false, error: `Effekt, spänning och ström hänger inte ihop: U × I = ${show("p", values.u * values.i)}, men P är ${show("p", values.p)}.` };
  }
  return { ok: true, values, given: givenQuantities, derived, steps };
}

export const ohmModule: CalcModule = defineCalculator({
  id: "ohm",
  name: "Ohms lag",
  summary: "Två av spänning, ström, resistans och effekt ger de andra.",
  inputs: [
    { kind: "number", id: "u", label: "Spänning U", dimension: "voltage", min: 0 },
    { kind: "number", id: "i", label: "Ström I", dimension: "current", min: 0 },
    { kind: "number", id: "r", label: "Resistans R", dimension: "resistance", min: 0, minExclusive: true },
    { kind: "number", id: "p", label: "Effekt P", dimension: "power", min: 0 },
  ],
  outputs: ORDER.map((quantity) => ({ id: quantity, label: OHM_QUANTITIES[quantity].label, dimension: OHM_QUANTITIES[quantity].dimension })),
  help: ["Fyll i två av spänning, ström, resistans och effekt – verktyget räknar ut de andra. Fyller du i fler kontrolleras de mot varandra."],
  compute: ({ numbers }) => {
    const solved = solveOhm({ u: numbers.u, i: numbers.i, r: numbers.r, p: numbers.p });
    if (!solved.ok) return { status: "invalid", errors: [{ message: solved.error }] };
    if (!solved.derived.length) return { status: "incomplete", message: "Ange två av spänning, ström, resistans och effekt så räknas resten ut." };
    const rows: OutputRow[] = ORDER.filter((quantity) => solved.values[quantity] !== undefined).map((quantity) => ({
      kind: "quantity", id: quantity, label: OHM_QUANTITIES[quantity].label, value: solved.values[quantity]!, dimension: OHM_QUANTITIES[quantity].dimension,
      derived: solved.derived.includes(quantity), primary: solved.derived.includes(quantity),
    }));
    return { status: "ok", rows, steps: ["Ohms lag: U = R × I. Effekten: P = U × I = I² × R = U² / R.", ...solved.steps], notes: [] };
  },
});
