import assert from "node:assert/strict";
import test from "node:test";
import { emptyCompanyCalcData, type CompanyCalcData } from "../lib/calculators/company-data";
import { energyCost } from "../lib/calculators/energy";
import { solveOhm } from "../lib/calculators/ohm";
import { solvePower, type PowerQuantity, type PowerValues } from "../lib/calculators/power";
import { formatNumber, parseDecimal } from "../lib/calculators/number";
import { CALCULATORS, calculatorById } from "../lib/calculators/registry";
import { initialState, runModule, withChoice, withText, withUnit } from "../lib/calculators/run";
import { shortCircuit, sourceImpedance, splitImpedance } from "../lib/calculators/short-circuit";
import type { CalcModule, Choices, Outcome } from "../lib/calculators/types";
import { checkUnit, formatQuantity, fromBase, scaleUnit, toBase, unitsOf } from "../lib/calculators/units";
import { maxLengthForDrop, minAreaForDrop, resistivityAt, voltageDrop } from "../lib/calculators/conductor";

/**
 * Räkneverktyg (2026-10-07): the maths of every tool against examples worked out by hand, the edge cases (zero,
 * negative, unit errors, single and three phase), and the runner that turns what a person typed into a result. The
 * figures in the comments are the worked examples; none of them comes from a standard.
 */
/** Text with a no-break space between a number and its unit, as it is shown, compared with plain spaces. */
const flat = (text: string) => text.replace(/ /g, " ");
const near = (actual: number | undefined, expected: number, relative = 1e-9) => assert.ok(actual !== undefined && Math.abs(actual - expected) <= relative * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
/** Physics at 20 °C (2026-11-01): copper 100 % IACS and aluminium 61 % IACS, Ω·mm²/m. */
const CU20 = 0.01724;
const AL20 = 0.02826;
/** The short-circuit module's worked case: a 10 kA source at 400 V with R/X 0,1, then 50 m of 25 mm² copper with 0,08 Ω/km. */
const SC_MAX = (() => {
  const zSource = 400 / (Math.sqrt(3) * 10000);
  const x = zSource / Math.sqrt(1 + 0.1 ** 2);
  const z = Math.hypot(0.1 * x + (CU20 * 50) / 25, x + 0.00008 * 50);
  return { z, ik: 400 / (Math.sqrt(3) * z) };
})();

const run = (tool: CalcModule, texts: Record<string, string>, choices: Choices = {}, company: CompanyCalcData = emptyCompanyCalcData(), units: Record<string, string> = {}): Outcome => {
  const ctx = { company };
  let state = initialState(tool, ctx);
  for (const [id, value] of Object.entries(choices)) state = withChoice(tool, state, id, value);
  for (const [id, text] of Object.entries(texts)) state = withText(tool, state, id, text);
  for (const [id, unit] of Object.entries(units)) state = withUnit(tool, state, id, unit);
  return runModule(tool, state, ctx);
};
const ok = (outcome: Outcome) => { assert.equal(outcome.status, "ok", JSON.stringify(outcome)); return outcome as Extract<Outcome, { status: "ok" }>; };
const value = (outcome: Outcome, id: string) => {
  const row = ok(outcome).rows.find((item) => item.id === id);
  assert.ok(row && row.kind === "quantity", `no result ${id}`);
  return row.value;
};
const verdict = (outcome: Outcome, id: string) => {
  const row = ok(outcome).rows.find((item) => item.id === id);
  assert.ok(row && row.kind === "verdict", `no verdict ${id}`);
  return row;
};
const tool = (id: string) => calculatorById(id)!;

test("numbers are read the Swedish way: a decimal comma or point, spaces for thousands, nothing else", () => {
  assert.deepEqual(parseDecimal("2,5"), { state: "ok", value: 2.5 });
  assert.deepEqual(parseDecimal(" 2.5 "), { state: "ok", value: 2.5 });
  assert.deepEqual(parseDecimal("1 000,5"), { state: "ok", value: 1000.5 });
  assert.deepEqual(parseDecimal("1.000,5"), { state: "ok", value: 1000.5 });
  assert.deepEqual(parseDecimal("1,000.5"), { state: "ok", value: 1000.5 });
  assert.deepEqual(parseDecimal("1,000,000"), { state: "ok", value: 1000000 });
  assert.deepEqual(parseDecimal("−3,5"), { state: "ok", value: -3.5 });
  assert.deepEqual(parseDecimal(",5"), { state: "ok", value: 0.5 });
  assert.deepEqual(parseDecimal("2,5e-3"), { state: "ok", value: 0.0025 });
  assert.deepEqual(parseDecimal("0"), { state: "ok", value: 0 });
  assert.deepEqual(parseDecimal("  "), { state: "empty" });
  for (const text of ["abc", "1,2,3", "1.5,5", "--1", "12 kW", ",", "Infinity", "0x10", "1e999"]) assert.deepEqual(parseDecimal(text), { state: "invalid" }, text);
});

test("results have three significant digits, a decimal comma and never lose the whole part", () => {
  assert.equal(formatNumber(6.928203), "6,93");
  assert.equal(formatNumber(400), "400");
  assert.equal(formatNumber(1234.5), "1 235");
  assert.equal(formatNumber(0.0456789), "0,0457");
  assert.equal(formatNumber(10), "10");
  assert.equal(formatNumber(9.996), "10");
  assert.equal(formatNumber(999.6), "1 000");
  assert.equal(formatNumber(0), "0");
  assert.equal(formatNumber(-19.4), "-19,4");
  assert.equal(formatNumber(1234567.8), "1 234 568");
  assert.equal(formatNumber(Number.NaN), "–");
  assert.equal(formatNumber(6.928203, 5), "6,9282");
});

test("units: each dimension converts to its base unit, a foreign unit is a unit error, results scale to a readable unit", () => {
  assert.equal(toBase(2.5, "power", "kW"), 2500);
  assert.equal(toBase(0.4, "voltage", "kV"), 400);
  assert.equal(toBase(10, "current", "kA"), 10000);
  assert.equal(toBase(6, "apparentPower", "MVA"), 6e6);
  assert.equal(toBase(35, "resistance", "mΩ"), 0.035);
  assert.equal(toBase(0.08, "perLength", "mΩ/m"), 0.00008);
  assert.equal(toBase(0.08, "perLength", "Ω/km"), 0.00008, "1 mΩ/m is the same as 1 Ω/km");
  assert.equal(fromBase(2500, "power", "kW"), 2.5);
  assert.equal(checkUnit("length", "m"), null);
  assert.match(checkUnit("length", "kW", "kabellängd") ?? "", /Enhetsfel: ”kW” passar inte för kabellängd/);
  assert.throws(() => toBase(1, "voltage", "A"), /Enhetsfel/);
  assert.deepEqual(unitsOf("power"), ["W", "kW", "MW"]);
  assert.equal(scaleUnit(750, "power"), "W");
  assert.equal(scaleUnit(7500, "power"), "kW");
  assert.equal(scaleUnit(2.5e6, "power"), "MW");
  assert.equal(scaleUnit(0.02, "resistance"), "mΩ");
  assert.equal(formatQuantity(6928.2, "apparentPower"), "6,93 kVA");
  // A current reads in whole ampere up to 9 999 A and in kA from 10 000 A (2026-10-12).
  assert.equal(formatQuantity(5016.85, "current"), "5 017 A");
  assert.equal(formatQuantity(9999.4, "current"), "9 999 A");
  assert.equal(formatQuantity(10000, "current"), "10 kA");
  assert.equal(formatQuantity(0.7, "resistance", { unit: "mΩ" }), "700 mΩ");
});

// ───────────────────────────── Ström och effekt ─────────────────────────────

test("power: three phases, 400 V, 10 A and cos φ 0,8 give 6,93 kVA, 5,54 kW and 4,16 kVAr", () => {
  // S = √3 × 400 × 10 = 6928,20 VA; P = S × 0,8 = 5542,56 W; Q = S × 0,6 = 4156,92 VAr
  const solved = solvePower(3, { u: 400, i: 10, pf: 0.8 });
  assert.ok(solved.ok);
  near(solved.values.s, 6928.203230275509);
  near(solved.values.p, 5542.562584220407);
  near(solved.values.q, 4156.921938165305);
  assert.deepEqual(solved.derived, ["s", "p", "q"]);
  assert.equal(flat(solved.steps[0]), "Skenbar effekt S: S = √3 × U × I = √3 × 400 V × 10 A = 6,93 kVA");
});

test("power: single phase, 230 V and 10 A at cos φ 1 is 2,3 kW with no reactive power", () => {
  const solved = solvePower(1, { u: 230, i: 10, pf: 1 });
  assert.ok(solved.ok);
  near(solved.values.s, 2300);
  near(solved.values.p, 2300);
  near(solved.values.q, 0);
});

test("power: the current of a motor from its shaft power, efficiency and power factor", () => {
  // 7,5 kW on the shaft at η 0,9 draws 8333,3 W; at cos φ 0,85 that is 9803,9 VA; I = 9803,9 / (√3 × 400) = 14,15 A
  const solved = solvePower(3, { pu: 7500, eta: 0.9, pf: 0.85, u: 400 });
  assert.ok(solved.ok);
  near(solved.values.p, 8333.333333333334);
  near(solved.values.s, 9803.921568627451);
  near(solved.values.i, 14.150741891902593);
});

test("power: P and Q give S and cos φ; S and Q give P; the voltage follows from S and I", () => {
  const pq = solvePower(3, { p: 3000, q: 4000 });
  assert.ok(pq.ok);
  near(pq.values.s, 5000);
  near(pq.values.pf, 0.6);
  const sq = solvePower(3, { s: 5000, q: 4000 });
  assert.ok(sq.ok);
  near(sq.values.p, 3000);
  const voltage = solvePower(3, { s: 6928.203230275509, i: 10 });
  assert.ok(voltage.ok);
  near(voltage.values.u, 400);
  const phase = solvePower(1, { s: 2300, i: 10 });
  assert.ok(phase.ok);
  near(phase.values.u, 230);
});

test("power: any three of U, I, S, P, Q and cos φ that fix the system give back the others, however they are reached", () => {
  const truth = { phases: 3 as const, u: 400, i: 17.3, pf: 0.83 };
  for (const phases of [1, 3] as const) {
    const base = solvePower(phases, { u: 230, i: 17.3, pf: 0.83 });
    assert.ok(base.ok);
    const all = base.values as Required<Pick<PowerValues, PowerQuantity>>;
    const keys: PowerQuantity[] = ["u", "i", "s", "p", "q", "pf"];
    for (let mask = 0; mask < 1 << keys.length; mask++) {
      const picked = keys.filter((_, index) => mask & (1 << index));
      if (picked.length < 3) continue;
      const given: PowerValues = {};
      for (const key of picked) given[key] = all[key];
      const solved = solvePower(phases, given);
      assert.ok(solved.ok, `${phases} phase ${picked.join(",")}: ${solved.ok ? "" : solved.error}`);
      for (const key of keys) if (solved.values[key] !== undefined) near(solved.values[key], all[key], 1e-7);
    }
  }
  void truth;
});

test("power: the efficiency chain gives back the delivered power from the electrical one and the other way round", () => {
  const forward = solvePower(3, { u: 400, i: 10, pf: 0.8, eta: 0.9 });
  assert.ok(forward.ok);
  near(forward.values.pu, 5542.562584220407 * 0.9);
  const back = solvePower(3, { pu: 4988.306325798366, p: 5542.562584220407 });
  assert.ok(back.ok);
  near(back.values.eta, 0.9);
});

test("power: zero current gives zero power and leaves cos φ open; zero and negative values are refused where they cannot be", () => {
  const nothing = solvePower(3, { u: 400, i: 0, pf: 0.8 });
  assert.ok(nothing.ok);
  assert.deepEqual([nothing.values.s, nothing.values.p, nothing.values.q], [0, 0, 0]);
  const open = solvePower(3, { u: 400, i: 0 });
  assert.ok(open.ok);
  assert.equal(open.values.pf, undefined);
  for (const [given, message] of [
    [{ u: 0, i: 5 }, /Spänningen måste vara större än noll/],
    [{ u: -400, i: 5 }, /Spänning U kan inte vara negativ/],
    [{ u: 400, i: -1, pf: 0.9 }, /Ström I kan inte vara negativ/],
    [{ u: 400, i: 5, pf: 1.2 }, /cos φ ligger mellan 0 och 1/],
    [{ pu: 1000, eta: 0 }, /Verkningsgraden/],
    [{ pu: 1000, eta: 1.1 }, /Verkningsgraden/],
    [{ p: 5000, pf: 0 }, /Aktiv effekt är noll när cos φ är 0/],
    [{ q: 100, pf: 1 }, /Reaktiv effekt är noll när cos φ är 1/],
    [{ s: 1000, p: 2000 }, /Aktiv effekt kan inte vara större än skenbar effekt/],
    [{ s: 1000, q: 2000 }, /Reaktiv effekt kan inte vara större än skenbar effekt/],
    [{ p: 5000, s: 1000, u: 400 }, /Aktiv effekt kan inte vara större än skenbar effekt/],
  ] as [PowerValues, RegExp][]) {
    const solved = solvePower(3, given);
    assert.ok(!solved.ok && message.test(solved.error), JSON.stringify(given));
  }
});

test("power: values given twice must agree – a mismatch is named, rounded input is accepted", () => {
  const wrong = solvePower(3, { u: 400, i: 10, s: 10000 });
  assert.ok(!wrong.ok);
  assert.match(flat(wrong.error), /Skenbar effekt, spänning och ström hänger inte ihop: √3 × U × I = 6,93 kVA, men S är 10 kVA/);
  assert.ok(solvePower(3, { u: 400, i: 10, s: 6930 }).ok, "typed, rounded S is within 1 %");
  assert.ok(!solvePower(3, { s: 5000, p: 3000, pf: 0.7 }).ok);
  assert.ok(!solvePower(3, { s: 5000, p: 3000, q: 3000 }).ok);
  assert.ok(solvePower(3, { s: 5000, p: 3000, q: 4000 }).ok);
  assert.ok(!solvePower(3, { p: 1000, pu: 1200 }).ok || true);
  const efficiency = solvePower(3, { p: 1000, pu: 1200 });
  assert.ok(!efficiency.ok && /Avgiven effekt kan inte vara större än tillförd effekt/.test(efficiency.error));
});

test("power module: the starting voltage follows the system until the person types one; units are converted", () => {
  const power = tool("power");
  const ctx = { company: emptyCompanyCalcData() };
  let state = initialState(power, ctx);
  assert.equal(state.numbers.u.text, "400");
  state = withChoice(power, state, "phases", "1");
  assert.equal(state.numbers.u.text, "230", "untouched: follows");
  state = withText(power, state, "u", "120");
  state = withChoice(power, state, "phases", "3");
  assert.equal(state.numbers.u.text, "120", "typed: left alone");
  const outcome = run(power, { u: "0,4", i: "10", pf: "0,8" }, {}, emptyCompanyCalcData(), { u: "kV" });
  near(value(outcome, "s"), 6928.203230275509);
  const motor = run(power, { u: "400", pu: "7,5", eta: "0,9", pf: "0,85" });
  near(value(motor, "i"), 14.150741891902593);
  assert.equal(run(power, { u: "400" }).status, "incomplete");
  const mismatch = run(power, { u: "400", i: "10", s: "10" });
  assert.equal(mismatch.status, "invalid");
});

// ───────────────────────────── Ohms lag och energi ─────────────────────────────

test("Ohm: any two of U, I, R and P give the rest; contradictions, zero current and zero resistance are refused", () => {
  const cases: [Record<string, number>, Record<string, number>][] = [
    [{ u: 12, i: 2 }, { r: 6, p: 24 }], [{ u: 12, r: 6 }, { i: 2, p: 24 }], [{ i: 2, r: 6 }, { u: 12, p: 24 }],
    [{ u: 12, p: 24 }, { i: 2, r: 6 }], [{ i: 2, p: 24 }, { u: 12, r: 6 }], [{ r: 6, p: 24 }, { u: 12, i: 2 }],
  ];
  for (const [given, expected] of cases) {
    const solved = solveOhm(given);
    assert.ok(solved.ok, JSON.stringify(given));
    for (const [key, number] of Object.entries(expected)) near(solved.values[key as "u"], number);
  }
  assert.ok(!solveOhm({ u: 12, i: 3, r: 6 }).ok);
  assert.ok(!solveOhm({ u: 12, i: 0 }).ok);
  assert.ok(!solveOhm({ u: 12, r: 0 }).ok);
  assert.ok(!solveOhm({ u: -1, i: 2 }).ok);
  assert.ok(solveOhm({ u: 0, r: 6 }).ok && solveOhm({ u: 0, r: 6 }).ok);
  assert.ok(!solveOhm({ u: 0, i: 2 }).ok, "zero voltage at a current would be zero resistance");
});

test("energy: the energy of a load over some days, and its cost only when a price is given", () => {
  // 2,5 kW for 4 hours a day for 30 days is 300 kWh; at 1,5 kr/kWh that is 450 kr
  const result = energyCost({ powerW: 2500, hoursPerDay: 4, days: 30, pricePerKwh: 1.5 });
  near(result.kwh, 300);
  near(result.cost, 450);
  assert.equal(energyCost({ powerW: 2500, hoursPerDay: 4, days: 30 }).cost, undefined);
  const outcome = run(tool("energy"), { p: "2,5", hours: "4", days: "30", price: "1,5" });
  near(value(outcome, "energy"), 300);
  near(value(outcome, "cost"), 450);
  assert.equal(ok(run(tool("energy"), { p: "2,5", hours: "4" })).rows.some((row) => row.id === "cost"), false, "no price, no cost");
  const tooMany = run(tool("energy"), { p: "2", hours: "25", days: "30", price: "1" });
  assert.equal(tooMany.status, "invalid");
  assert.equal(run(tool("energy"), { p: "2", hours: "4", days: "-1" }).status, "invalid");
});

// ───────────────────────────── Spänningsfall ─────────────────────────────

test("voltage drop: 100 m of 2,5 mm² copper at 16 A and 400 V, resistance only, is 19,4 V or 4,85 %", () => {
  // R = 0,0175 × 100 / 2,5 = 0,7 Ω; ΔU = √3 × 16 × 0,7 = 19,399 V; 19,399 / 400 = 4,85 %
  const result = voltageDrop({ phases: 3, lengthM: 100, currentA: 16, areaMm2: 2.5, rho: 0.0175, reactancePerM: 0, cosPhi: 1, voltageV: 400 });
  near(result.resistance, 0.7);
  near(result.dropV, 19.398969044771427);
  near(result.dropPct, 4.849742261192857);
  near(result.loadV, 400 - 19.398969044771427);
  // The same as the older calculator's simple model (2026-10-07: behaviour kept).
  near(result.dropV, (Math.sqrt(3) * 16 * 0.0175 * 100) / 2.5);
});

test("voltage drop: the reactance and cos φ add their part, single phase counts the way out and back", () => {
  // x = 0,08 mΩ/m gives X = 8 mΩ; at cos φ 0,8 (sin φ 0,6): √3 × 16 × (0,7 × 0,8 + 0,008 × 0,6) = 15,652 V = 3,91 %
  const reactive = voltageDrop({ phases: 3, lengthM: 100, currentA: 16, areaMm2: 2.5, rho: 0.0175, reactancePerM: 0.00008, cosPhi: 0.8, voltageV: 400 });
  near(reactive.dropV, 15.652196737838432);
  near(reactive.dropPct, 3.9130491844596076);
  // 30 m of 1,5 mm² at 16 A on 230 V: R = 0,35 Ω; ΔU = 2 × 16 × 0,35 = 11,2 V = 4,87 %
  const single = voltageDrop({ phases: 1, lengthM: 30, currentA: 16, areaMm2: 1.5, rho: 0.0175, reactancePerM: 0, cosPhi: 1, voltageV: 230 });
  near(single.dropV, 11.2);
  near(single.dropPct, 4.869565217391305);
  // cos φ 0: only the reactance drops
  near(voltageDrop({ phases: 3, lengthM: 100, currentA: 16, areaMm2: 2.5, rho: 0.0175, reactancePerM: 0.00008, cosPhi: 0, voltageV: 400 }).dropV, Math.sqrt(3) * 16 * 0.008);
  assert.equal(voltageDrop({ phases: 3, lengthM: 100, currentA: 0, areaMm2: 2.5, rho: 0.0175, reactancePerM: 0, cosPhi: 1, voltageV: 400 }).dropV, 0);
});

test("voltage drop: the longest run and the smallest area that stay within a limit", () => {
  const base = { phases: 3 as const, currentA: 16, areaMm2: 2.5, rho: 0.0175, reactancePerM: 0, cosPhi: 1, voltageV: 400 };
  // 5 %: 20 V; per metre √3 × 16 × 0,007 = 0,19399 V; the longest run is 103,1 m
  near(maxLengthForDrop({ ...base, limitPct: 5 })!, 103.0982623552903);
  assert.equal(maxLengthForDrop({ ...base, currentA: 0, limitPct: 5 }), null);
  const length = maxLengthForDrop({ ...base, limitPct: 5 })!;
  near(voltageDrop({ ...base, lengthM: length }).dropPct, 5, 1e-9);
  // Over 100 m the smallest area is √3 × 16 × 100 × 0,0175 / 20 = 2,4249 mm²
  const { areaMm2: _area, ...withoutArea } = base; void _area;
  const minimum = minAreaForDrop({ ...withoutArea, lengthM: 100, limitPct: 5 });
  assert.equal(minimum.kind, "area");
  near(minimum.kind === "area" ? minimum.areaMm2 : 0, 2.4248711305964283);
  // The reactance alone over the limit: no area helps; at cos φ 0 the area does not matter
  assert.deepEqual(minAreaForDrop({ ...withoutArea, lengthM: 100, reactancePerM: 0.01, cosPhi: 0.5, limitPct: 5 }), { kind: "impossible" });
  assert.deepEqual(minAreaForDrop({ ...withoutArea, lengthM: 100, reactancePerM: 0, cosPhi: 0, limitPct: 5 }), { kind: "any" });
});

test("voltage drop: the resistivity follows the temperature and the material; the person's own value replaces the suggestion", () => {
  // ρ at 70 °C for copper: 0,0175 × (1 + 0,00393 × 50) = 0,02094 Ω·mm²/m
  near(resistivityAt(0.0175, 0.00393, 70), 0.02093875);
  near(resistivityAt(0.0175, 0.00393, 20), 0.0175);
  const drop = tool("voltage-drop");
  const hot = run(drop, { length: "100", i: "16", area: "2,5", temperature: "70" });
  near(value(hot, "dropV"), (Math.sqrt(3) * 16 * CU20 * (1 + 0.00393 * 50) * 100) / 2.5);
  const aluminium = run(drop, { length: "100", i: "16", area: "2,5" }, { material: "al" });
  near(value(aluminium, "dropV"), (Math.sqrt(3) * 16 * AL20 * 100) / 2.5);
  assert.ok(ok(aluminium).steps[0].includes("ρ20 = 0,0283 Ω·mm²/m."), "the material's physical constant at 20 °C");
  assert.ok(!ok(aluminium).steps[0].includes("(förslag)"), "a constant of nature is not a suggestion");
  const own = run(drop, { length: "100", i: "16", area: "2,5", rho20: "0,02" });
  near(value(own, "dropV"), (Math.sqrt(3) * 16 * 0.02 * 100) / 2.5);
  assert.ok(!ok(own).steps[0].includes("(förslag)"), "an own value is not a suggestion");
  assert.equal(ok(own).inputs.find((input) => input.id === "rho20")?.origin, "user");
});

test("voltage drop module: reactance and limit come from the company when the fields are empty, otherwise from the person", () => {
  const drop = tool("voltage-drop");
  const company: CompanyCalcData = { ...emptyCompanyCalcData(), reactancePerM: { value: 0.00008, source: "Egen tabell, 2026" }, dropLimitPct: { value: 4, source: "Företagets rutin" } };
  const withCompany = run(drop, { length: "100", i: "16", area: "2,5", cosphi: "0,8" }, {}, company);
  near(value(withCompany, "dropV"), Math.sqrt(3) * 16 * (CU20 * 40 * 0.8 + 0.008 * 0.6));
  const limit = verdict(withCompany, "limit");
  assert.equal(limit.tone, "ok");
  assert.match(limit.text, /Under angiven gräns: 3,86 % mot 4 % \(företagets värde\)/);
  assert.equal(ok(withCompany).inputs.find((input) => input.id === "reactance")?.note, "Företagets värde (Egen tabell, 2026)");
  const own = run(drop, { length: "100", i: "16", area: "2,5", cosphi: "0,8", reactance: "0,1", limit: "3" }, {}, company);
  near(value(own, "dropV"), Math.sqrt(3) * 16 * (CU20 * 40 * 0.8 + 0.01 * 0.6));
  assert.equal(verdict(own, "limit").tone, "alarm");
  assert.match(verdict(own, "limit").text, /^Över angiven gräns/);
  // Neither: only the resistance counts, and no limit means no comparison – both are said
  const bare = ok(run(drop, { length: "100", i: "16", area: "2,5" }));
  assert.ok(bare.notes.some((note) => /Ingen reaktans/.test(note.text) && note.link?.view === "company_values"));
  assert.ok(bare.notes.some((note) => /Ingen gräns/.test(note.text) && note.link?.view === "company_values"));
  assert.ok(!bare.rows.some((row) => row.id === "limit"));
});

test("voltage drop module: missing, invalid, out-of-range and unit errors are told apart", () => {
  const drop = tool("voltage-drop");
  const waiting = run(drop, { length: "100" });
  assert.equal(waiting.status, "incomplete");
  assert.match(waiting.status === "incomplete" ? waiting.message : "", /^Ange belastningsström I och area så visas resultatet här\.$/);
  const text = run(drop, { length: "hundra", i: "16", area: "2,5" });
  assert.equal(text.status, "invalid");
  assert.deepEqual(text.status === "invalid" ? text.errors : [], [{ field: "length", message: "Kabellängd (enkel väg): skriv värdet som ett tal, till exempel 2,5." }]);
  for (const [texts, field] of [[{ length: "0", i: "16", area: "2,5" }, "length"], [{ length: "100", i: "-1", area: "2,5" }, "i"], [{ length: "100", i: "16", area: "0" }, "area"], [{ length: "100", i: "16", area: "2,5", cosphi: "1,2" }, "cosphi"], [{ length: "100", i: "16", area: "2,5", limit: "150" }, "limit"]] as [Record<string, string>, string][]) {
    const outcome = run(drop, texts);
    assert.ok(outcome.status === "invalid" && outcome.errors.some((error) => error.field === field), `${field}: ${JSON.stringify(outcome)}`);
  }
  // A unit that does not belong to the field is a unit error and nothing is calculated
  const wrongUnit = run(drop, { length: "100", i: "16", area: "2,5" }, {}, emptyCompanyCalcData(), { length: "kW" });
  assert.equal(wrongUnit.status, "invalid");
  assert.match(wrongUnit.status === "invalid" ? wrongUnit.errors[0].message : "", /Enhetsfel: ”kW” passar inte för Kabellängd/);
  // kilometres are converted: 0,1 km is 100 m
  near(value(run(drop, { length: "0,1", i: "16", area: "2,5" }, {}, emptyCompanyCalcData(), { length: "km" }), "dropV"), (Math.sqrt(3) * 16 * CU20 * 100) / 2.5);
  // A value far outside the usual is calculated, with a hint to check the unit
  const odd = ok(run(drop, { length: "100", i: "16", area: "2500" }));
  assert.ok(odd.notes.some((note) => note.tone === "warn" && /Area: 2 500 mm² ligger utanför det vanliga/.test(note.text)), JSON.stringify(odd.notes));
});

test("voltage drop module: single phase starts at 230 V", () => {
  const drop = tool("voltage-drop");
  const outcome = run(drop, { length: "30", i: "16", area: "1,5" }, { phases: "1" });
  near(value(outcome, "dropV"), (2 * 16 * CU20 * 30) / 1.5);
  near(value(outcome, "dropPct"), ((2 * 16 * CU20 * 30) / 1.5 / 230) * 100);
  assert.equal(ok(outcome).inputs.find((input) => input.id === "u")?.text, "230 V");
});

// ───────────────────────────── Kortslutningsström ─────────────────────────────

test("short circuit: the impedance of the source from its current or its power, and its split into R and X", () => {
  // 10 kA at 400 V and c 1: Z = 400 / (√3 × 10 000) = 23,094 mΩ; the same source as 6,928 MVA
  near(sourceImpedance({ kind: "current", amps: 10000 }, 400, 1), 0.023094010767585033);
  near(sourceImpedance({ kind: "power", voltAmps: 6928203.230275509 }, 400, 1), 0.023094010767585033);
  near(sourceImpedance({ kind: "impedance", ohms: 0.025 }, 400, 1.05), 0.025, 1e-12);
  near(sourceImpedance({ kind: "current", amps: 10000 }, 400, 0.95), 0.95 * 0.023094010767585033);
  // R/X 0,1: X = Z / √1,01, R = 0,1 × X
  const split = splitImpedance(0.023094010767585033, 0.1);
  near(split.x, 0.022979399584857045);
  near(split.r, 0.0022979399584857045);
  assert.deepEqual(splitImpedance(0.02, undefined), { r: 0, x: 0.02 });
});

test("short circuit: the largest current at the end of 50 m of 25 mm² copper behind a 10 kA source", () => {
  // Source 23,094 mΩ with R/X 0,1 (R 2,298, X 22,979); cable R = 0,0175 × 50 / 25 = 35 mΩ, X = 0,08 × 50 = 4 mΩ
  // R = 37,298 mΩ, X = 26,979 mΩ, Z = 46,033 mΩ, Ik = 400 / (√3 × 0,046033) = 5 016,9 A
  const input = { voltageV: 400, c: 1, source: { kind: "current" as const, amps: 10000 }, sourceRx: 0.1, lengthM: 50, areaMm2: 25, rho: 0.0175, reactancePerM: 0.00008 };
  const result = shortCircuit(input);
  near(result.rTotal, 0.037297939958485706);
  near(result.xTotal, 0.026979399584857045);
  near(result.zTotal, 0.04603286138299671);
  near(result.current, 5016.853194382423);
  // Without R/X the source is pure reactance: X = 23,094 + 4, R = 35 mΩ, Z = 44,262 mΩ, Ik = 5 217,6 A
  const reactive = shortCircuit({ ...input, sourceRx: undefined });
  near(reactive.zTotal, 0.04426155690296054);
  near(reactive.current, 5217.622782275048);
  // No cable: the source's own current; a longer cable always gives less
  near(shortCircuit({ ...input, lengthM: 0 }).current, 10000);
  assert.ok(shortCircuit({ ...input, lengthM: 100 }).current < result.current);
});

test("short circuit: the smallest current runs out along the phase conductor and back along the protective conductor", () => {
  // 6 kA source at c 0,95: Z = 36,566 mΩ, pure reactance; hot cable at 80 °C: ρ = 0,0216265;
  // phase 25 mm²: R = 43,253 mΩ; protective 16 mm²: R = 67,583 mΩ; X = 4 + 4 mΩ; loop R = 110,836, X = 44,566 mΩ, Z = 119,46 mΩ
  const result = shortCircuit({ voltageV: 400, c: 0.95, source: { kind: "current", amps: 6000 }, lengthM: 50, areaMm2: 25, rho: 0.0175 * (1 + 0.00393 * 60), reactancePerM: 0.00008, returnAreaMm2: 16 });
  near(result.rTotal, 0.11083581250000002);
  near(result.xTotal, 0.0445655170486763);
  near(result.zTotal, 0.11945987879765748);
  near(result.current, 1836.5421470389097);
  const same = shortCircuit({ voltageV: 400, c: 1, source: { kind: "current", amps: 6000 }, lengthM: 50, areaMm2: 25, rho: 0.0175, reactancePerM: 0, returnAreaMm2: 25 });
  const phase = shortCircuit({ voltageV: 400, c: 1, source: { kind: "current", amps: 6000 }, lengthM: 50, areaMm2: 25, rho: 0.0175, reactancePerM: 0 });
  assert.ok(same.current < phase.current, "the loop is longer than the phase alone");
});

test("short circuit module: largest and smallest from their own sources; defaults for c and temperature are named; comparisons", () => {
  const sc = tool("short-circuit");
  const outcome = ok(run(sc, { srcMaxCurrent: "10", rx: "0,1", length: "50", area: "25", reactance: "0,08" }));
  near(value(outcome, "ikMax"), SC_MAX.ik);
  near(value(outcome, "zMax"), SC_MAX.z);
  assert.ok(!outcome.rows.some((row) => row.id === "ikMin"), "no smallest source, no smallest current");
  assert.ok(outcome.notes.some((note) => /1 för c och 20 °C/.test(note.text) && note.link?.view === "company_values"));
  assert.ok(outcome.steps.some((step) => flat(step).startsWith("Källans impedans: Z = c × U / (√3 × I) = 1 × 400 V / (√3 × 10 kA) = 23,1 mΩ")), outcome.steps.join("\n"));
  // Both scenarios, the company's c and temperatures, the protective conductor and the comparisons
  const company: CompanyCalcData = { ...emptyCompanyCalcData(), cMin: { value: 0.95, source: "Företagets metod" }, tempMin: { value: 80, source: "" }, reactancePerM: { value: 0.00008, source: "" } };
  const both = ok(run(sc, { srcMaxCurrent: "10", srcMinCurrent: "6", rx: "0,1", length: "50", area: "25", returnArea: "16", breaking: "6", trip: "2000" }, {}, company));
  near(value(both, "ikMax"), SC_MAX.ik);
  const smallest = both.rows.find((row) => row.id === "ikMin");
  assert.ok(smallest?.kind === "quantity");
  assert.ok(smallest.value < 1900 && smallest.value > 1500, `${smallest.value}`);
  assert.equal(verdict(both, "breaking").tone, "ok");
  assert.match(flat(verdict(both, "breaking").text), /är inte högre än skyddets angivna brytförmåga 6 000 A/);
  assert.equal(verdict(both, "trip").tone, "alarm", "the smallest current is lower than what the device needs");
  // From power and from impedance: the same source gives the same current
  const fromPower = ok(run(sc, { srcMaxPower: "6,928203230275509", rx: "0,1", length: "50", area: "25", reactance: "0,08" }, { source: "power" }));
  near(value(fromPower, "ikMax"), SC_MAX.ik, 1e-9);
  const fromImpedance = ok(run(sc, { srcMaxImpedance: "23,094010767585033", rx: "0,1", length: "50", area: "25", reactance: "0,08" }, { source: "impedance" }));
  near(value(fromImpedance, "ikMax"), SC_MAX.ik, 1e-9);
  assert.equal(run(sc, { length: "50", area: "25" }).status, "incomplete");
  assert.equal(run(sc, { srcMaxCurrent: "10", length: "-1", area: "25" }).status, "invalid");
  near(value(run(sc, { srcMaxCurrent: "10", length: "0", area: "25" }), "ikMax"), 10000);
});

// ───────────────────────────── Kabelarea ─────────────────────────────

const table = (name: string, cu: [number, number][], al: [number, number][] = []): CompanyCalcData["ampacity"][number] => ({ slot: 1, name, source: name, cu: cu.map(([area, amps]) => ({ area, amps })), al: al.map(([area, amps]) => ({ area, amps })) });
// Invented numbers for the test only: they are not a table of any kind.
const INVENTED = table("Testtabell A", [[1.5, 10], [2.5, 14], [4, 19], [6, 25], [10, 34], [16, 45]]);

test("cable area: without the company's value the ampacity is not judged, it says where to enter it, and the voltage drop is still checked", () => {
  const area = tool("cable-area");
  const outcome = ok(run(area, { length: "50", i: "16", area: "2,5" }));
  assert.equal(verdict(outcome, "capacity").tone, "warn");
  assert.match(verdict(outcome, "capacity").text, /^Ej bedömd – belastbarhet saknas för koppar 2,5 mm²\.$/);
  const missing = outcome.notes.find((note) => note.tone === "missing");
  assert.ok(missing);
  assert.equal(missing.text, "Ange företagets värde under");
  assert.deepEqual(missing.link, { label: "Värden och referenser", view: "company_values" });
  near(value(outcome, "dropV"), (Math.sqrt(3) * 16 * CU20 * 50) / 2.5);
  assert.ok(!outcome.rows.some((row) => row.id === "izEffective"));
  assert.ok(!outcome.rows.some((row) => row.id === "minAreaTable"));
});

test("cable area: the ampacity is the company's table or the person's own figure, with the correction factor", () => {
  const area = tool("cable-area");
  const company: CompanyCalcData = { ...emptyCompanyCalcData(), ampacity: [INVENTED], dropLimitPct: { value: 5, source: "" } };
  // 2,5 mm² copper is 14 A in the invented table; at k 0,8 it carries 11,2 A, so 16 A does not fit and 10 A does
  const over = ok(run(area, { length: "20", i: "16", area: "2,5", correction: "0,8" }, {}, company));
  near(value(over, "izEffective"), 11.2);
  near(value(over, "utilisation"), (16 / 11.2) * 100);
  assert.equal(verdict(over, "capacity").tone, "alarm");
  assert.match(verdict(over, "capacity").text, /Belastningsströmmen 16 A är högre än belastbarheten 11,2 A/);
  const fits = ok(run(area, { length: "20", i: "10", area: "2,5", correction: "0,8" }, {}, company));
  assert.equal(verdict(fits, "capacity").tone, "ok");
  // Own figure first: it replaces the table
  const own = ok(run(area, { length: "20", i: "16", area: "2,5", ampacity: "20" }, {}, company));
  near(value(own, "izEffective"), 20);
  assert.equal(verdict(own, "capacity").tone, "ok");
  // An area the table does not have is not judged; another material has no rows
  assert.equal(verdict(ok(run(area, { length: "20", i: "16", area: "3" }, {}, company)), "capacity").tone, "warn");
  const aluminium = ok(run(area, { length: "20", i: "16", area: "2,5" }, { material: "al" }, company));
  assert.match(verdict(aluminium, "capacity").text, /^Ej bedömd – belastbarhet saknas för aluminium/);
});

test("cable area: the smallest area for the voltage drop and the smallest one in the company's table that carries the current within it", () => {
  const area = tool("cable-area");
  const company: CompanyCalcData = { ...emptyCompanyCalcData(), ampacity: [INVENTED] };
  // 16 A over 100 m at 5 %: the area must be at least 2,4249 mm²; the table carries 16 A from 4 mm² (19 A), and 4 mm² keeps the drop at 3,03 %
  const outcome = ok(run(area, { length: "100", i: "16", area: "1,5", limit: "5" }, {}, company));
  near(value(outcome, "minAreaDrop"), (Math.sqrt(3) * 16 * 100 * CU20) / 20);
  near(value(outcome, "minAreaTable"), 4);
  // A longer run needs more than the current alone asks for: 16 A over 200 m at 5 % needs 4,85 mm², so the table's 6 mm²
  near(value(ok(run(area, { length: "200", i: "16", area: "2,5", limit: "5" }, {}, company)), "minAreaTable"), 6);
  // Without a limit only the current counts
  near(value(ok(run(area, { length: "200", i: "16", area: "2,5" }, {}, company)), "minAreaTable"), 4);
  // Nothing in the table is enough
  const none = ok(run(area, { length: "20", i: "60", area: "2,5" }, {}, company));
  assert.ok(!none.rows.some((row) => row.id === "minAreaTable"));
  assert.ok(none.notes.some((note) => /Ingen area i företagets tabell för koppar klarar strömmen/.test(note.text)));
  // The chosen table: a second table answers when it is picked, and the picker is only offered with two or more
  const second = { ...table("Testtabell B", [[2.5, 30]]), slot: 2 };
  const two: CompanyCalcData = { ...emptyCompanyCalcData(), ampacity: [INVENTED, second] };
  near(value(ok(run(area, { length: "20", i: "16", area: "2,5" }, { table: "2" }, two)), "izEffective"), 30);
  near(value(ok(run(area, { length: "20", i: "16", area: "2,5" }, { table: "1" }, two)), "izEffective"), 14);
  const picker = area.inputs.find((input) => input.id === "table");
  assert.ok(picker?.kind === "choice" && picker.hideWhenSingle);
  assert.deepEqual(typeof picker.options === "function" ? picker.options({ company: two }).map((option) => option.value) : [], ["1", "2"]);
});

// ───────────────────────────── Registret och körningen ─────────────────────────────

test("the runner follows a choice that is no longer offered back to the first option", () => {
  const area = tool("cable-area");
  const company: CompanyCalcData = { ...emptyCompanyCalcData(), ampacity: [INVENTED] };
  const outcome = ok(run(area, { length: "20", i: "10", area: "2,5" }, { table: "3" }, company));
  assert.equal(verdict(outcome, "capacity").tone, "ok", "table 3 is gone: table 1 answers");
});

test("every tool is available by id, in the order the page offers them", () => {
  assert.deepEqual(CALCULATORS.map((item) => item.id), ["power", "voltage-drop", "short-circuit", "cable-area", "ohm", "energy"]);
  assert.equal(calculatorById("voltage-drop")?.name, "Spänningsfall");
  assert.equal(calculatorById("nope"), undefined);
});
