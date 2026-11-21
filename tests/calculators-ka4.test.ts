import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cableTypeKey, companyCalcData, deviceKey, emptyCompanyCalcData, type CompanyCalcData } from "../lib/calculators/company-data";
import { modelFromValues, sameModel, saveInputs, type PanelModel } from "../lib/calculators/company-values-edit";
import { MATERIALS } from "../lib/calculators/conductor";
import { curveFalls, tripCurrentOnCurve, tripTimeOnCurve, voltageDropOverSections } from "../lib/calculators/engine";
import { branchLengthModule } from "../lib/calculators/kalkylator/branch-length";
import { cableSizingModule } from "../lib/calculators/kalkylator/cable-sizing";
import { disconnectionModule } from "../lib/calculators/kalkylator/disconnection";
import { shortCircuitToolModule } from "../lib/calculators/kalkylator/short-circuit";
import { voltageDropToolModule } from "../lib/calculators/kalkylator/voltage-drop";
import { choiceOptions, fieldFallback, initialState, runModule, withChoice, withText, withUnit } from "../lib/calculators/run";
import type { CalcModule, ChoiceInput, Choices, Outcome } from "../lib/calculators/types";
import { companyValueInputSchema, mergeCompanyValues, type CompanyValue, type CompanyValueInput } from "../lib/workflow/company-values";

/**
 * KA4 (2026-11-01): the company's cable types, parallel conductors, voltage drop over several sections and a protective
 * device's curve. Every expected figure below is worked out by hand from the formula in the comment, not read from the code. The numbers
 * of cables and curves are invented for the test; they come from no standard and no maker.
 */
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
const near = (actual: number, expected: number, tolerance: number, what = "") => assert.ok(Math.abs(actual - expected) <= tolerance, `${what} ${actual} is not ${expected} ± ${tolerance}`);

const stored = (input: CompanyValueInput): CompanyValue => ({ key: input.key, low: input.low, high: input.high, warnLow: input.warnLow, warnHigh: input.warnHigh, source: input.source, reference: input.reference, version: 1, updatedByName: "" });
const blank = { low: null, high: null, warnLow: null, warnHigh: null, source: "", reference: "" };
const typeRow = (slot: number, name: string, material: "cu" | "al", area: number, ohmPerKm: number, reactance: number | null = null, source = "Eget datablad"): CompanyValue =>
  stored({ ...blank, key: cableTypeKey(slot, material, area), high: ohmPerKm, warnHigh: reactance, source, reference: name });
const deviceRow = (type: "gg" | "c" | "annan", rated: number, time: number, trip: number): CompanyValue => stored({ ...blank, key: deviceKey(type, rated, time), low: rated, high: trip, source: "Egen lista" });

test("only physics is built in: the two resistivities at 20 °C and no cable type, curve or limit", () => {
  assert.equal(MATERIALS.cu.rho20, 0.01724);
  assert.equal(MATERIALS.al.rho20, 0.02826);
  const none = emptyCompanyCalcData();
  assert.deepEqual(none.cableTypes, []);
  assert.deepEqual(none.devices, []);
  const input = voltageDropToolModule.inputs.find((item) => item.id === "cableType") as ChoiceInput;
  assert.deepEqual(choiceOptions(input, { company: none }).map((option) => option.value), ["own"], "without the company's types there is nothing to choose");
});

test("parallel conductors divide R and X: 2 × 95 mm² Cu, 200 A, 100 m, cos φ 0,8", () => {
  // R = 0,01724 × 100 / 95 / 2 = 0,00907368 Ω; X = 0,00008 × 100 / 2 = 0,004 Ω; sin φ = 0,6
  // ΔU = √3 × 200 × (0,00907368 × 0,8 + 0,004 × 0,6) = 346,4102 × 0,00965895 = 3,34596 V = 0,83649 % of 400 V
  const outcome = run(voltageDropToolModule, { i: "200", cosphi: "0,8", len: "100", area: "95", reactance: "0,08" }, { parallel: "2" }, emptyCompanyCalcData(), { reactance: "Ω/km" });
  near(value(outcome, "dropV"), 3.34596, 0.0001, "ΔU");
  near(value(outcome, "dropPercent"), 0.83649, 0.00005, "ΔU %");
  near(value(outcome, "resistance"), 0.00907368, 0.00000002, "R");
  near(value(outcome, "reactance"), 0.004, 1e-9, "X");
  assert.ok(ok(outcome).rows.some((row) => row.label === "Resistans, 2 parallella ledare"));
  // One conductor is exactly what it always was: R = 0,01814737, X = 0,008; ΔU = 346,4102 × (0,01451789 + 0,0048) = 6,69192 V
  near(value(run(voltageDropToolModule, { i: "200", cosphi: "0,8", len: "100", area: "95", reactance: "0,08" }, {}, emptyCompanyCalcData(), { reactance: "Ω/km" }), "dropV"), 6.69192, 0.0001, "ΔU one");
});

test("the longest cable counts the parallel conductors", () => {
  // Per metre with 2 × 10 mm² Cu, cos φ 1: √3 × 32 × 0,01724 / 10 / 2 = 0,0477757 V/m; 3 % of 400 V = 12 V; L = 12 / 0,0477757 = 251,174 m
  const outcome = run(voltageDropToolModule, { i: "32", len: "80", area: "10", allowed: "3" }, { parallel: "2" });
  near(value(outcome, "maxLength"), 251.174, 0.01, "L");
});

test("voltage drop over several sections adds each section with its own current", () => {
  // Feeder: 100 A, 50 m, 35 mm² Cu: R = 0,01724 × 50 / 35 = 0,02462857; ΔU = √3 × 100 × R = 4,26580 V
  // Branch: 16 A, 30 m, 2,5 mm² Cu: R = 0,01724 × 30 / 2,5 = 0,20688; ΔU = √3 × 16 × R = 5,73323 V
  // Together 9,99903 V = 2,49976 % of 400 V
  const outcome = run(voltageDropToolModule, { i: "100", len: "50", area: "35", i2: "16", len2: "30", area2: "2,5" }, { sections: "2" });
  near(value(outcome, "dropSection1"), 4.2658, 0.0001, "feeder");
  near(value(outcome, "dropSection2"), 5.73323, 0.0001, "branch");
  near(value(outcome, "dropV"), 9.99903, 0.0002, "together");
  near(value(outcome, "dropPercent"), 2.49976, 0.00005, "percent");
  near(value(outcome, "loadV"), 390.00097, 0.0002, "at the load");
});

test("what is left of the limit decides the last section's longest length", () => {
  // The feeder takes 4,26580 V = 1,06645 %. Of 4 % there is 2,93355 % = 11,7342 V left.
  // The branch per metre: √3 × 16 × 0,01724 / 2,5 = 0,191107 V/m, so L = 11,7342 / 0,191107 = 61,402 m
  const outcome = run(voltageDropToolModule, { i: "100", len: "50", area: "35", i2: "16", len2: "30", area2: "2,5", allowed: "4" }, { sections: "2" });
  near(value(outcome, "maxLength"), 61.402, 0.01, "last section");
  const verdict = ok(outcome).rows.find((row) => row.id === "limit");
  assert.ok(verdict?.kind === "verdict" && verdict.tone === "ok");
  // When the feeder alone takes it all, no length is given, and the comparison says over.
  const over = run(voltageDropToolModule, { i: "100", len: "50", area: "35", i2: "16", len2: "30", area2: "2,5", allowed: "1" }, { sections: "2" });
  assert.equal(ok(over).rows.some((row) => row.id === "maxLength"), false);
  const overVerdict = ok(over).rows.find((row) => row.id === "limit");
  assert.ok(overVerdict?.kind === "verdict" && overVerdict.tone === "alarm");
});

test("a later section takes the current above it when none is given, and its own material", () => {
  // Enfas 230 V, cos φ 1, 10 A: Cu 20 m 6 mm²: ΔU = 2 × 10 × 0,01724 × 20 / 6 = 1,149333 V
  // Al 10 m 10 mm²: ΔU = 2 × 10 × 0,02826 × 10 / 10 = 0,5652 V; together 1,714533 V = 0,745449 %
  const outcome = run(voltageDropToolModule, { i: "10", len: "20", area: "6", len2: "10", area2: "10" }, { phases: "1", sections: "2", mat2: "al" });
  near(value(outcome, "dropV"), 1.714533, 0.00001, "ΔU");
  near(value(outcome, "dropPercent"), 0.745449, 0.00001, "ΔU %");
});

test("one section through the new sum is exactly the old voltage drop", () => {
  const section = { currentA: 32, lengthM: 80, areaMm2: 10, material: "cu" as const, temperatureC: 20, reactancePerM: 0.00008 };
  const result = voltageDropOverSections({ phases: 3, voltageV: 400, cosPhi: 0.9, sections: [section] });
  assert.ok(result.ok);
  // R = 0,1379200; X = 0,0064; sin φ = 0,4358899; ΔU = √3 × 32 × (0,124128 + 0,00278970) = 55,42563 × 0,1269177 = 7,03449 V
  near(result.dropV, 7.03449, 0.00001, "ΔU");
  assert.deepEqual(voltageDropOverSections({ phases: 3, voltageV: 400, cosPhi: 1, sections: [] }).ok, false);
});

test("a whole number of conductors is asked for", () => {
  const section = { currentA: 32, lengthM: 80, areaMm2: 10, material: "cu" as const, temperatureC: 20, parallel: 1.5 };
  assert.equal(voltageDropOverSections({ phases: 3, voltageV: 400, cosPhi: 1, sections: [section] }).ok, false);
});

test("the company's cable type fills in the cable, and what is typed goes before it", () => {
  const company = companyCalcData([typeRow(1, "Matare A", "cu", 16, 1.2, 0.07), typeRow(2, "Matare B", "al", 25, 1.2, 0.07)]);
  // Cu at 20 °C: R = 1,2 Ω/km × 100 m = 0,12 Ω; X = 0,07 Ω/km × 100 m = 0,007 Ω; cos φ 0,8, sin φ 0,6
  // ΔU = √3 × 50 × (0,096 + 0,0042) = 86,60254 × 0,1002 = 8,67757 V
  const copper = run(voltageDropToolModule, { i: "50", cosphi: "0,8", len: "100" }, { cableType: "typ1" }, company);
  near(value(copper, "dropV"), 8.67757, 0.0001, "ΔU Cu");
  const echoed = ok(copper).inputs.find((input) => input.id === "area");
  assert.equal(echoed?.origin, "company");
  assert.match(echoed?.note ?? "", /Kabeltypen Matare A/);

  // Aluminium is the type's own material, so α is aluminium's at 70 °C: r = 1,2 × (1 + 0,00403 × 50) = 1,4418 Ω/km, R = 0,14418 Ω
  // ΔU = √3 × 50 × (0,115344 + 0,0042) = 86,60254 × 0,119544 = 10,35282 V
  const aluminium = run(voltageDropToolModule, { i: "50", cosphi: "0,8", len: "100", temperature: "70" }, { cableType: "typ2" }, company);
  near(value(aluminium, "dropV"), 10.35282, 0.0001, "ΔU Al");
  // A chosen copper type does not follow a material left on aluminium in the hidden field: r = 1,2 × (1 + 0,00393 × 50) = 1,4358
  const hiddenChoice = run(voltageDropToolModule, { i: "50", cosphi: "1", len: "100", temperature: "70" }, { material: "al", cableType: "typ1" }, company);
  near(value(hiddenChoice, "resistance"), 0.14358, 0.000001, "R Cu at 70 °C");

  // A resistance typed in the field goes before the type: 2 Ω/km × 100 m = 0,2 Ω
  const typed = run(voltageDropToolModule, { i: "50", cosphi: "1", len: "100", rkm: "2" }, { cableType: "typ1" }, company);
  near(value(typed, "resistance"), 0.2, 1e-9, "typed R");

  const ctx = { company };
  const state = withChoice(voltageDropToolModule, initialState(voltageDropToolModule, ctx), "cableType", "typ1");
  near(fieldFallback(voltageDropToolModule, state, "rkm", ctx)?.value ?? 0, 0.0012, 1e-12, "the empty field shows the type's value");
  near(fieldFallback(voltageDropToolModule, state, "reactance", ctx)?.value ?? 0, 0.00007, 1e-12, "and its reactance");
  assert.equal(fieldFallback(voltageDropToolModule, initialState(voltageDropToolModule, ctx), "area", ctx), undefined, "without a type the area is asked for");
});

test("Kortslutning: parallel conductors in the phase and the loop", () => {
  // Source 10 mΩ, all reactance. 100 m, 2 × 50 mm² Cu at 20 °C, x 0,08 Ω/km, c 1.
  // Phase: R = 0,01724 × 100 / 50 / 2 = 0,01724; X = 0,010 + 0,008 / 2 = 0,014; |Z| = 0,0222085 Ω; Ik3 = 400 / (√3 × |Z|) = 10 398,8 A
  // Loop, two protective conductors: R = 0,01724 + 0,01724 = 0,03448; X = 0,010 + 0,004 + 0,004 = 0,018; |Zs| = 0,0388956; Ik1 = 5 937,4 A
  const common = { u: "400", srcZ: "10", len1: "100", area1: "50", reactance: "0,08" };
  const units = { srcZ: "mΩ", reactance: "Ω/km" };
  const same = run(shortCircuitToolModule, common, { source: "impedance", par1: "2" }, emptyCompanyCalcData(), units);
  near(value(same, "ik3"), 10398.8, 0.5, "Ik3");
  near(value(same, "ik1"), 5937.4, 0.5, "Ik1");
  assert.ok(ok(same).notes.some((note) => /parallella skyddsledare saknas/.test(note.text)), "the assumption is said");
  // One protective conductor: R = 0,01724 + 0,03448 = 0,05172; X = 0,010 + 0,004 + 0,008 = 0,022; |Zs| = 0,0562047; Ik1 = 4 108,9 A
  const single = run(shortCircuitToolModule, common, { source: "impedance", par1: "2", parPe1: "1" }, emptyCompanyCalcData(), units);
  near(value(single, "ik1"), 4108.9, 0.5, "Ik1 with one PE");
  assert.equal(value(single, "ik3"), value(same, "ik3"), "the phase does not change");
});

test("Kortslutning: a section's cable type gives its values; a reactance typed in the conditions goes before the type's", () => {
  const company = companyCalcData([typeRow(1, "Matare A", "cu", 16, 1.2, 0.07)]);
  // Source 10 mΩ reactance; 100 m of the type at 20 °C: R = 0,12; X = 0,010 + 0,007 = 0,017; |Z| = 0,121198 Ω; Ik3 = 400 / (√3 × |Z|) = 1 905,5 A
  const fromType = run(shortCircuitToolModule, { u: "400", srcZ: "10", len1: "100" }, { source: "impedance", cableType1: "typ1" }, company, { srcZ: "mΩ" });
  near(value(fromType, "ik3"), 1905.5, 0.5, "Ik3 type");
  // Typed 0,17 Ω/km: X = 0,010 + 0,017 = 0,027; |Z| = 0,123 Ω; Ik3 = 1 877,5 A
  const typed = run(shortCircuitToolModule, { u: "400", srcZ: "10", len1: "100", reactance: "0,17" }, { source: "impedance", cableType1: "typ1" }, company, { srcZ: "mΩ", reactance: "Ω/km" });
  near(value(typed, "ik3"), 1877.5, 0.5, "Ik3 typed X");
});

test("Största gruppledningslängd: parallel conductors make the loop per metre smaller", () => {
  // Zs max = 230 / 500 = 0,46 Ω; source 0,1 Ω in line with the cable; x = 0.
  // One conductor 10 mm²: loop r = 2 × 0,001724 = 0,003448 Ω/m; L = 0,36 / 0,003448 = 104,41 m. Two in parallel, both ways: L = 208,82 m
  const texts = { srcZ: "100", u0: "230", rated: "16", time: "0,4", trip: "500", area: "10", reactance: "0" };
  const units = { srcZ: "mΩ", reactance: "Ω/km" };
  near(value(run(branchLengthModule, texts, { source: "impedance", device: "c" }, emptyCompanyCalcData(), units), "maxLength"), 104.41, 0.01, "L one");
  near(value(run(branchLengthModule, texts, { source: "impedance", device: "c", parallel: "2" }, emptyCompanyCalcData(), units), "maxLength"), 208.82, 0.01, "L two");
  // Two phase conductors, one protective conductor: r = 0,000862 + 0,001724 = 0,002586 Ω/m; L = 0,36 / 0,002586 = 139,21 m
  near(value(run(branchLengthModule, texts, { source: "impedance", device: "c", parallel: "2", parallelPe: "1" }, emptyCompanyCalcData(), units), "maxLength"), 139.21, 0.01, "L one PE");
});

test("Kabeldimensionering: with parallel conductors Iz and the areas are per conductor", () => {
  // Ib 200 A, In 250 A, 2 per phase: Iz needed = 250 / 2 = 125 A; of the invented rows 70 mm² (130 A) is the first that carries it.
  // Area for the drop: √3 × 200 × 0,01724 × 100 / (2 × 12 V) = 24,884 mm²
  const texts = { i: "200", rated: "250", len: "100", allowed: "3" };
  const ratings = { ratings: "50 100\n70 130\n95 160" };
  const ctx = { company: emptyCompanyCalcData() };
  let state = initialState(cableSizingModule, ctx);
  state = withChoice(cableSizingModule, state, "parallel", "2");
  state = withChoice(cableSizingModule, state, "table", "own");
  for (const [id, text] of Object.entries(texts)) state = withText(cableSizingModule, state, id, text);
  state = { ...state, texts: ratings };
  const outcome = runModule(cableSizingModule, state, ctx);
  near(value(outcome, "requiredIz"), 125, 1e-9, "Iz");
  near(value(outcome, "minDrop"), 24.884, 0.001, "S");
  assert.equal(value(outcome, "recommended"), 70);
  // The short-circuit check keeps the whole current: 6 kA, 0,1 s, k 100: S = 6000 × √0,1 / 100 = 18,974 mm², with one conductor or two.
  let withFault = withText(cableSizingModule, state, "faultCurrent", "6000");
  withFault = withUnit(cableSizingModule, withFault, "faultCurrent", "A");
  withFault = withText(cableSizingModule, withFault, "faultTime", "0,1");
  withFault = withText(cableSizingModule, withFault, "k", "100");
  near(value(runModule(cableSizingModule, withFault, ctx), "minShort"), 18.974, 0.001, "S for the fault");
});

const CURVE = [{ timeS: 0.1, tripA: 200 }, { timeS: 10, tripA: 50 }];

test("a curve is read between its points and never outside them", () => {
  // Log–log: part = ln(0,4 / 0,1) / ln(10 / 0,1) = 0,30103; I = 200 × (50 / 200)^0,30103 = 200 × 0,658815 = 131,763 A
  near(tripCurrentOnCurve(CURVE, 0.4, "logLog")?.tripA ?? 0, 131.763, 0.001, "Ia log–log");
  // The safe side: the point with the shorter time, since the device has tripped by then at the latest.
  assert.equal(tripCurrentOnCurve(CURVE, 0.4, "safeSide")?.tripA, 200);
  assert.equal(tripCurrentOnCurve(CURVE, 10, "logLog")?.how, "point");
  assert.equal(tripCurrentOnCurve(CURVE, 10, "logLog")?.tripA, 50);
  assert.equal(tripCurrentOnCurve(CURVE, 0.05, "logLog"), null, "not before the first point");
  assert.equal(tripCurrentOnCurve(CURVE, 11, "safeSide"), null, "not after the last");

  // The other way: 100 A: part = ln(100 / 200) / ln(50 / 200) = 0,5; t = 0,1 × 100^0,5 = 1 s
  const between = tripTimeOnCurve(CURVE, 100, "logLog");
  assert.ok(between?.kind === "time");
  near(between.timeS, 1, 1e-9, "t");
  assert.deepEqual(tripTimeOnCurve(CURVE, 100, "safeSide"), { kind: "time", timeS: 10, how: "between" });
  assert.deepEqual(tripTimeOnCurve(CURVE, 300, "logLog"), { kind: "time", timeS: 0.1, how: "atMost" });
  assert.deepEqual(tripTimeOnCurve(CURVE, 40, "logLog"), { kind: "below", lowestA: 50, longestS: 10 });
  assert.deepEqual(tripTimeOnCurve(CURVE, 200, "logLog"), { kind: "time", timeS: 0.1, how: "point" });
});

test("a curve that does not fall answers nothing", () => {
  const rising = [{ timeS: 0.1, tripA: 50 }, { timeS: 10, tripA: 200 }];
  assert.equal(curveFalls(rising), false);
  assert.equal(tripCurrentOnCurve(rising, 1, "logLog"), null);
  assert.equal(tripTimeOnCurve(rising, 100, "logLog"), null);
  assert.equal(curveFalls([{ timeS: 0.1, tripA: 50 }, { timeS: 10, tripA: 50 }]), true, "a flat part is a curve, as with a breaker's instantaneous part");
});

test("Frånkopplingstid reads Ia and the time from the company's curve", () => {
  const company = companyCalcData([deviceRow("gg", 16, 0.1, 200), deviceRow("gg", 16, 10, 50)]);
  // Zs 2,3 Ω, c = 1: Ik1 = 230 / 2,3 = 100 A. Ia for 0,4 s is 131,763 A: not met. The curve gives 1 s at 100 A.
  const texts = { zs: "2,3", u0: "230", rated: "16", time: "0,4" };
  const fails = run(disconnectionModule, texts, { known: "zs", device: "gg" }, company, { zs: "Ω" });
  near(value(fails, "trip"), 131.763, 0.001, "Ia");
  near(value(fails, "curveTime"), 1, 1e-9, "t");
  const verdict = ok(fails).rows.find((row) => row.id === "verdict");
  assert.ok(verdict?.kind === "verdict" && verdict.tone === "alarm");
  assert.ok(ok(fails).notes.some((note) => /mellan företagets punkter 0,1 s och 10 s/.test(note.text)), "the result says Ia was read between points");
  // A row for just that time goes before the curve.
  const withRow = companyCalcData([deviceRow("gg", 16, 0.1, 200), deviceRow("gg", 16, 10, 50), deviceRow("gg", 16, 0.4, 90)]);
  const exact = run(disconnectionModule, texts, { known: "zs", device: "gg" }, withRow, { zs: "Ω" });
  assert.equal(value(exact, "trip"), 90);
  assert.equal(ok(exact).notes.some((note) => /på kurvan/.test(note.text)), false);
  // A breaker reads on the safe side: Ia = the point at 0,1 s; 100 A gives the point at 10 s.
  const breaker = companyCalcData([deviceRow("c", 16, 0.1, 200), deviceRow("c", 16, 10, 50)]);
  const safe = run(disconnectionModule, texts, { known: "zs", device: "c" }, breaker, { zs: "Ω" });
  assert.equal(value(safe, "trip"), 200);
  assert.equal(value(safe, "curveTime"), 10);
  // Below the curve: no time and it says so (Zs 5 Ω gives 46 A).
  const below = run(disconnectionModule, { ...texts, zs: "5" }, { known: "zs", device: "gg" }, company, { zs: "Ω" });
  assert.equal(ok(below).rows.some((row) => row.id === "curveTime"), false);
  assert.ok(ok(below).notes.some((note) => /lägre än kurvans lägsta punkt/.test(note.text)));
  // Outside the points, and with one point only, nothing is read: Ia is asked for.
  assert.equal(run(disconnectionModule, { ...texts, time: "20" }, { known: "zs", device: "gg" }, company, { zs: "Ω" }).status, "incomplete");
  assert.equal(run(disconnectionModule, texts, { known: "zs", device: "gg" }, companyCalcData([deviceRow("gg", 16, 0.1, 200)]), { zs: "Ω" }).status, "incomplete");
  // Another rated current has no curve here.
  assert.equal(run(disconnectionModule, { ...texts, rated: "20" }, { known: "zs", device: "gg" }, company, { zs: "Ω" }).status, "incomplete");
});

test("Största gruppledningslängd reads Ia from the same curve", () => {
  const company = companyCalcData([deviceRow("gg", 16, 0.1, 200), deviceRow("gg", 16, 10, 50)]);
  const outcome = run(branchLengthModule, { srcZ: "100", u0: "230", rated: "16", time: "0,4", area: "10", reactance: "0" }, { source: "impedance", device: "gg" }, company, { srcZ: "mΩ", reactance: "Ω/km" });
  // Zs max = 230 / 131,763 = 1,74556 Ω; L = (1,74556 − 0,1) / 0,003448 = 477,25 m
  near(value(outcome, "maxLength"), 477.25, 0.05, "L");
  assert.ok(ok(outcome).notes.some((note) => /på kurvan/.test(note.text)));
});

const panel = (rows: PanelModel["cableTypes"]["rows"], source = "Eget datablad", base: readonly CompanyValue[] = []): PanelModel => ({ ...modelFromValues(base), cableTypes: { source, rows } });
const applied = (values: readonly CompanyValue[], model: PanelModel) => {
  const saved = saveInputs(values, model);
  assert.ok("inputs" in saved, JSON.stringify(saved));
  for (const input of saved.inputs) companyValueInputSchema.parse(input);
  return { inputs: saved.inputs, values: mergeCompanyValues([...values], saved.inputs, "Test") };
};

test("cable types are saved as the company's values, read back the same, and only what changed is written", () => {
  const first = applied([], panel([
    { name: "Matare A", material: "cu", area: "16", resistance: "1,2", reactance: "0,07" },
    { name: "Grupp B", material: "al", area: "2,5", resistance: "12", reactance: "" },
  ]));
  assert.deepEqual(first.inputs.map((input) => input.key), ["kabel.typ.1.cu.16", "kabel.typ.2.al.2_5"]);
  const data = companyCalcData(first.values);
  assert.deepEqual(data.cableTypes.map((type) => [type.id, type.name, type.material, type.areaMm2, type.source]), [["typ1", "Matare A", "cu", 16, "Eget datablad"], ["typ2", "Grupp B", "al", 2.5, "Eget datablad"]]);
  near(data.cableTypes[0]!.resistancePerM20, 0.0012, 1e-12, "R in Ω/m");
  near(data.cableTypes[0]!.reactancePerM ?? 0, 0.00007, 1e-12, "X in Ω/m");
  assert.equal(data.cableTypes[1]!.reactancePerM, undefined);
  // Read back: the same panel, nothing to save.
  const model = modelFromValues(first.values);
  assert.deepEqual(model.cableTypes.rows[0], { name: "Matare A", material: "cu", area: "16", resistance: "1,2", reactance: "0,07" });
  assert.ok(sameModel(model, modelFromValues(first.values)));
  assert.deepEqual(applied(first.values, model).inputs, []);
  // A changed reactance writes that row and no other.
  const changed = { ...model, cableTypes: { ...model.cableTypes, rows: [{ ...model.cableTypes.rows[0]!, reactance: "0,08" }, model.cableTypes.rows[1]!] } };
  assert.deepEqual(applied(first.values, changed).inputs.map((input) => input.key), ["kabel.typ.1.cu.16"]);
  // A row taken away goes, and the next one takes its place in the list.
  const removed = applied(first.values, { ...model, cableTypes: { ...model.cableTypes, rows: [model.cableTypes.rows[1]!] } });
  assert.deepEqual(companyCalcData(removed.values).cableTypes.map((type) => [type.id, type.name]), [["typ1", "Grupp B"]]);
});

test("cable types: what is wrong is said, and a row left empty is no row", () => {
  const error = (row: Partial<PanelModel["cableTypes"]["rows"][number]>) => {
    const saved = saveInputs([], panel([{ name: "Matare", material: "cu", area: "16", resistance: "1,2", reactance: "", ...row }]));
    return "error" in saved ? saved.error : "";
  };
  assert.match(error({ name: "" }), /skriv ett namn/);
  assert.match(error({ area: "" }), /fyll i area och resistans/);
  assert.match(error({ resistance: "tre" }), /fyll i area och resistans/);
  assert.match(error({ resistance: "0" }), /större än noll/);
  assert.match(error({ reactance: "x" }), /reaktansen/);
  assert.equal(error({}), "");
  const twice = saveInputs([], panel([{ name: "Matare", material: "cu", area: "16", resistance: "1,2", reactance: "" }, { name: "matare", material: "cu", area: "25", resistance: "0,8", reactance: "" }]));
  assert.ok("error" in twice && /två gånger/.test(twice.error));
  const empty = saveInputs([], panel([{ name: " ", material: "cu", area: "", resistance: "", reactance: "" }]));
  assert.ok("inputs" in empty && empty.inputs.length === 0);
});

test("a key the form limits cannot take: the cable types stay in the calculators' namespace, and stray rows are ignored", () => {
  assert.equal(companyValueInputSchema.safeParse({ ...blank, key: "kabel.typ.40.cu.1000_75", high: 1 }).success, true);
  const data = companyCalcData([
    stored({ ...blank, key: "kabel.typ.1.cu.16", high: null, reference: "Utan resistans" }),
    stored({ ...blank, key: "kabel.typ.2.cu.16", high: -1, reference: "Negativ" }),
    stored({ ...blank, key: "kabel.typ.99.cu.16", high: 1, reference: "För långt ned" }),
    stored({ ...blank, key: "kabel.typ.3.ag.16", high: 1, reference: "Okänt material" }),
    stored({ ...blank, key: "kabel.typ.4.cu.25", high: 1, source: "Källa" }),
  ]);
  assert.deepEqual(data.cableTypes.map((type) => [type.id, type.name]), [["typ4", "Kabeltyp 4"]], "a row without a name still has one");
});

test("a curve that rises is refused when saved, except for Annat skydd", () => {
  const curveModel = (type: "gg" | "annan") => ({
    ...modelFromValues([]),
    devices: { source: "", reference: "", rows: [{ type, rated: "16", time: "0,1", trip: "50" }, { type, rated: "16", time: "10", trip: "200" }] },
  });
  const refused = saveInputs([], curveModel("gg"));
  assert.ok("error" in refused && /Ia ska bli lägre/.test(refused.error));
  assert.ok("inputs" in saveInputs([], curveModel("annan")), "Annat skydd may hold different devices");
});

test("the panel and the calculators name no maker and hold no table of their own", () => {
  const NAMES = /\bEBR\b|Ymer|Metrel|Eurotest|Megger|Fluke|FLIR|EL-Info|Energiföretagen|Svensk Energi|\bESA\b|Nexans|Prysmian|Draka|Hager|\bABB\b|Schneider|Eaton|Siemens/;
  for (const file of ["features/calculators/company-values-panel.tsx", "lib/calculators/kalkylator/voltage-drop.ts", "lib/calculators/kalkylator/shared.ts", "lib/calculators/engine/device-curve.ts", "lib/calculators/company-data.ts", "lib/calculators/company-values-edit.ts"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), NAMES, file);
  }
});
