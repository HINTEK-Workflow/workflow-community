import assert from "node:assert/strict";
import test from "node:test";
import {
  addImpedances, adiabaticK, cableImpedance, checkDisconnection, compensationReactivePower, extendFaultPoint, magnitude, maxBranchLength, NEUTRAL_VOLTAGE_FACTOR,
  maxLengthForVoltageDrop, maxLoopImpedance, minAreaForShortCircuit, minAreaForVoltageDrop, reactancePerMeterFromInductance, roundSig, shortCircuitCurrents, sizeCable,
  sourceFaultPoint, threePhasePower, toOhm, transformer, transformerShortCircuit, voltageDrop, SQRT3, type EngineResult,
} from "../lib/calculators/engine";

/**
 * Calculation engine of the Kalkylator (2026-10-12). Every expected value below is worked out for this test from
 * the formula, with numbers made up for it; none comes from a standard, a table or a manufacturer. Protective device
 * data and cable ratings are inputs, so the tests supply their own.
 */
const near = (actual: number | null | undefined, expected: number, relative = 1e-6) =>
  assert.ok(actual !== null && actual !== undefined && Math.abs(actual - expected) <= relative * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
function ok<T>(result: EngineResult<T>): Extract<EngineResult<T>, { ok: true }> {
  assert.equal(result.ok, true, result.ok ? "" : result.errors.map((e) => e.message).join("; "));
  return result as Extract<EngineResult<T>, { ok: true }>;
}
const codes = (result: { warnings: { code: string }[] }) => result.warnings.map((w) => w.code);
const failCodes = (result: EngineResult<unknown>) => (result.ok ? [] : result.errors.map((e) => e.code));
/** Copper at 20 °C, 100 % IACS (1/58 Ω·mm²/m, rounded as in the product): physics, 2026-11-01. */
const CU20 = 0.01724;

test("three-phase: current and cos φ give S, P, Q", () => {
  const r = ok(threePhasePower({ lineVoltageV: 400, currentA: 20, cosPhi: 0.9 }));
  near(r.apparentVA, SQRT3 * 400 * 20);
  near(r.powerW, SQRT3 * 400 * 20 * 0.9);
  near(r.reactiveVar, SQRT3 * 400 * 20 * Math.sqrt(1 - 0.81));
  near(r.phaseVoltageV, 400 / SQRT3);
  near(r.phiDegrees, (Math.acos(0.9) * 180) / Math.PI);
});
test("three-phase: P and cos φ give the current; phase voltage is enough", () => {
  const r = ok(threePhasePower({ phaseVoltageV: 230, powerW: 10000, cosPhi: 0.8 }));
  near(r.lineVoltageV, 230 * SQRT3);
  near(r.currentA, 10000 / (0.8 * SQRT3 * 230 * SQRT3));
});
test("three-phase: P and Q give S and cos φ; Q and cos φ give S", () => {
  const a = ok(threePhasePower({ lineVoltageV: 400, powerW: 6000, reactiveVar: 8000 }));
  near(a.apparentVA, 10000);
  near(a.cosPhi, 0.6);
  const b = ok(threePhasePower({ lineVoltageV: 400, reactiveVar: 6000, cosPhi: 0.8 }));
  near(b.apparentVA, 10000);
  near(b.powerW, 8000);
});
test("three-phase: single phase and missing cos φ", () => {
  const one = ok(threePhasePower({ phases: 1, lineVoltageV: 230, currentA: 10, cosPhi: 1 }));
  near(one.apparentVA, 2300);
  near(one.reactiveVar, 0);
  const noCos = ok(threePhasePower({ lineVoltageV: 400, currentA: 10 }));
  assert.equal(noCos.powerW, null);
  assert.ok(codes(noCos).includes("noCosPhi"));
});
test("three-phase: errors and warnings for unreasonable input", () => {
  assert.deepEqual(failCodes(threePhasePower({ currentA: 10, cosPhi: 0.9 })), ["voltageMissing"]);
  assert.ok(failCodes(threePhasePower({ lineVoltageV: -400, currentA: 10 })).includes("lineVoltage"));
  assert.ok(failCodes(threePhasePower({ lineVoltageV: 400, currentA: 10, cosPhi: 1.2 })).includes("cosPhi"));
  assert.ok(failCodes(threePhasePower({ lineVoltageV: 400, powerW: 9000, apparentVA: 5000 })).includes("powerExceedsApparent"));
  assert.ok(failCodes(threePhasePower({ lineVoltageV: 400, cosPhi: 0.9 })).includes("underdetermined"));
  assert.ok(codes(ok(threePhasePower({ lineVoltageV: 400, currentA: 10, cosPhi: 0.9, powerW: 20000 }))).includes("inconsistent"));
  assert.ok(codes(ok(threePhasePower({ lineVoltageV: 4, currentA: 10, cosPhi: 0.9 }))).includes("voltageRange"));
});
test("compensation: Qc = P (tan φ1 − tan φ2)", () => {
  const r = ok(compensationReactivePower(100e3, 0.8, 0.95));
  near(r.capacitorVar, 100e3 * (0.75 - Math.sqrt(1 - 0.9025) / 0.95), 1e-9);
  assert.ok(codes(ok(compensationReactivePower(100e3, 0.95, 0.8))).includes("worse"));
});

test("transformer: currents, Zk, Sk and Ik3 at the terminals", () => {
  const r = ok(transformer({ ratedVA: 1e6, primaryVoltageV: 10000, secondaryVoltageV: 400, ukPercent: 5 }));
  near(r.primaryCurrentA, 1e6 / (SQRT3 * 10000));
  near(r.secondaryCurrentA, 1e6 / (SQRT3 * 400));
  near(r.zkSecondaryOhm, 0.05 * 400 * 400 / 1e6);
  near(r.zkPrimaryOhm, 0.05 * 10000 * 10000 / 1e6);
  near(r.shortCircuitVA, 20e6);
  near(r.ik3SecondaryAtTerminalsA, r.secondaryCurrentA / 0.05, 1e-9);
  assert.equal(r.resistanceKnown, false);
  assert.deepEqual(r.secondary, { r: 0, x: r.zkSecondaryOhm });
  assert.ok(codes(r).includes("pureReactance"));
});
test("transformer: load loss gives R and X, ur and ux, efficiency", () => {
  const r = ok(transformer({ ratedVA: 630e3, primaryVoltageV: 10000, secondaryVoltageV: 400, ukPercent: 4, loadLossW: 6300, noLoadLossW: 1000 }));
  const i2 = 630e3 / (SQRT3 * 400);
  near(r.secondary.r, 6300 / (3 * i2 * i2));
  near(magnitude(r.secondary), r.zkSecondaryOhm, 1e-9);
  near(r.urPercent, 1);
  near(r.uxPercent, Math.sqrt(16 - 1));
  assert.equal(r.resistanceKnown, true);
  near(r.totalLossW, 7300);
  near(r.efficiencyAtUnity, 630e3 / (630e3 + 7300));
});
test("transformer: unreasonable input", () => {
  assert.ok(failCodes(transformer({ ratedVA: 0, primaryVoltageV: 10000, secondaryVoltageV: 400, ukPercent: 4 })).includes("rated"));
  assert.ok(failCodes(transformer({ ratedVA: 1e6, primaryVoltageV: 10000, secondaryVoltageV: 400, ukPercent: 1, loadLossW: 50000 })).includes("lossTooLarge"));
  const swapped = ok(transformer({ ratedVA: 1e6, primaryVoltageV: 400, secondaryVoltageV: 10000, ukPercent: 5 }));
  assert.ok(codes(swapped).includes("stepUp"));
  assert.ok(codes(ok(transformer({ ratedVA: 800, primaryVoltageV: 10000, secondaryVoltageV: 400, ukPercent: 5 }))).includes("ratedRange"));
  assert.ok(codes(ok(transformer({ ratedVA: 1e6, primaryVoltageV: 10000, secondaryVoltageV: 400, ukPercent: 60 }))).includes("ukRange"));
});
test("transformer short circuit: without the grid, and with the grid in series", () => {
  const input = { ratedVA: 1e6, primaryVoltageV: 22000, secondaryVoltageV: 400, ukPercent: 5 };
  const r = ok(transformerShortCircuit({ transformer: input, grid: { kind: "power", shortCircuitVA: 100e6 } }));
  near(r.ik3WithoutGridA, 20e6 / (SQRT3 * 400), 1e-9);
  const series = (100e6 * 20e6) / (100e6 + 20e6);
  near(r.ik3WithGridA, series / (SQRT3 * 400), 1e-9);
  near(r.ik2WithoutGridA, (SQRT3 / 2) * r.ik3WithoutGridA, 1e-12);
  assert.ok((r.ik3WithGridA ?? 0) < r.ik3WithoutGridA);
  // The grid given as a primary current gives the same result as the equivalent power.
  const byCurrent = ok(transformerShortCircuit({ transformer: input, grid: { kind: "current", ik3A: 100e6 / (SQRT3 * 22000), voltageV: 22000 } }));
  near(byCurrent.ik3WithGridA, r.ik3WithGridA ?? 0, 1e-9);
  assert.equal(ok(transformerShortCircuit({ transformer: input })).ik3WithGridA, null);
  assert.ok(codes(ok(transformerShortCircuit({ transformer: input, grid: { kind: "power", shortCircuitVA: 30e6 } }))).includes("weakGrid"));
  assert.ok(failCodes(transformerShortCircuit({ transformer: input, c: 2 })).includes("c"));
  assert.ok(failCodes(transformerShortCircuit({ transformer: input, grid: { kind: "power", shortCircuitVA: 0 } })).includes("grid"));
});

test("cable impedance: resistance from length, area, material and temperature", () => {
  const cold = ok(cableImpedance({ lengthM: 50, areaMm2: 16, material: "cu", temperatureC: 20, returnAreaMm2: 16, reactancePerM: 0.0001 }));
  near(cold.phase.r, (CU20 / 16) * 50);
  near(cold.phase.x, 0.005);
  near(cold.loop?.r, 2 * (CU20 / 16) * 50);
  near(cold.loop?.x, 0.01);
  near(cold.phaseResistancePerM, CU20 / 16);
  const warm = ok(cableImpedance({ lengthM: 50, areaMm2: 16, material: "cu", temperatureC: 70, reactancePerM: 0.0001 }));
  near(warm.phase.r, (CU20 * (1 + 0.00393 * 50) / 16) * 50);
  assert.equal(warm.loop, null);
  const al = ok(cableImpedance({ lengthM: 10, areaMm2: 10, material: "al", temperatureC: 20, rho20: 0.03, reactancePerM: 0 }));
  near(al.phase.r, 0.03);
  const different = ok(cableImpedance({ lengthM: 100, areaMm2: 25, returnAreaMm2: 16, material: "cu", temperatureC: 20, reactancePerM: 0 }));
  near(different.loop?.r, CU20 * 100 * (1 / 25 + 1 / 16));
  assert.ok(codes(ok(cableImpedance({ lengthM: 10, areaMm2: 10, material: "cu", temperatureC: 20 }))).includes("reactanceSuggested"));
});
test("cable impedance: unreasonable input", () => {
  assert.ok(failCodes(cableImpedance({ lengthM: 10, areaMm2: 0, material: "cu", temperatureC: 20 })).includes("area"));
  assert.ok(failCodes(cableImpedance({ lengthM: -1, areaMm2: 10, material: "cu", temperatureC: 20 })).includes("length"));
  assert.ok(failCodes(cableImpedance({ lengthM: 1, areaMm2: 10, material: "cu", temperatureC: Number.NaN })).includes("temperature"));
  assert.ok(codes(ok(cableImpedance({ lengthM: 1, areaMm2: 10, material: "cu", temperatureC: 500, reactancePerM: 0 }))).includes("temperatureRange"));
  assert.ok(codes(ok(cableImpedance({ lengthM: 90000, areaMm2: 10, material: "cu", temperatureC: 20, reactancePerM: 0 }))).includes("lengthRange"));
});
test("impedances add as vectors, not as magnitudes", () => {
  const z = addImpedances({ r: 3, x: 0 }, { r: 0, x: 4 });
  near(magnitude(z), 5);
});

test("short circuit: from a source current, a power or an impedance, along a cable", () => {
  const fromCurrent = ok(sourceFaultPoint({ kind: "ik3", amps: 10000 }, 400));
  near(fromCurrent.point.phase.x, 400 / (SQRT3 * 10000));
  const fromPower = ok(sourceFaultPoint({ kind: "power", voltAmps: 6.9282e6 }, 400, 1));
  near(magnitude(fromPower.point.phase), 160000 / 6.9282e6);
  const split = ok(sourceFaultPoint({ kind: "ik3", amps: 10000, rOverX: 1 }, 400));
  near(split.point.phase.r, split.point.phase.x);
  assert.ok(codes(fromCurrent).includes("loopAssumed"));
  const own = ok(sourceFaultPoint({ kind: "impedance", phase: { r: 0.01, x: 0.01 }, loop: { r: 0.03, x: 0.01 } }, 400));
  assert.equal(codes(own).includes("loopAssumed"), false);

  const out = ok(extendFaultPoint(own.point, { lengthM: 40, areaMm2: 10, returnAreaMm2: 10, material: "cu", temperatureC: 20, reactancePerM: 0 }));
  near(out.point.phase.r, 0.01 + (CU20 / 10) * 40);
  near(out.point.loop.r, 0.03 + 2 * (CU20 / 10) * 40);
  assert.equal(codes(out).includes("returnAssumed"), false);
  assert.ok(codes(ok(extendFaultPoint(own.point, { lengthM: 40, areaMm2: 10, material: "cu", temperatureC: 20, reactancePerM: 0 }))).includes("returnAssumed"));
});
test("short circuit: Ik3, Ik2 and Ik1 at a point", () => {
  const point = { phase: { r: 0.03, x: 0.04 }, loop: { r: 0.06, x: 0.08 } };
  const r = ok(shortCircuitCurrents({ lineVoltageV: 400, c: 1, point }));
  near(r.phaseOhm, 0.05);
  near(r.loopOhm, 0.1);
  near(r.ik3A, 400 / (SQRT3 * 0.05));
  near(r.ik2A, (SQRT3 / 2) * r.ik3A);
  near(r.ik1A, 230.9401 / 0.1, 1e-6);
  const low = ok(shortCircuitCurrents({ lineVoltageV: 400, c: 0.95, point }));
  near(low.ik1A, r.ik1A * 0.95);
  assert.ok(failCodes(shortCircuitCurrents({ lineVoltageV: 400, c: 1.5, point })).includes("c"));
  assert.ok(failCodes(shortCircuitCurrents({ lineVoltageV: 400, c: 1, point: { phase: { r: 0, x: 0 }, loop: { r: 1, x: 0 } } })).includes("impedance"));
  assert.ok(failCodes(shortCircuitCurrents({ lineVoltageV: 0, c: 1, point })).includes("voltage"));
});

test("disconnection: Zs against Ia, margin and Zs,max", () => {
  const good = ok(checkDisconnection({ loopImpedance: 0.8, u0V: 230, tripCurrentA: 160, requiredTimeS: 0.4 }));
  near(good.ik1A, 287.5);
  near(good.zsMaxOhm, 1.4375);
  near(good.zsMarginOhm, 0.6375);
  near(good.currentRatio, 287.5 / 160);
  near(good.marginPercent, (287.5 / 160 - 1) * 100);
  assert.equal(good.meetsRequirement, true);
  assert.equal(good.requiredTimeS, 0.4);
  const bad = ok(checkDisconnection({ loopImpedance: { r: 1.5, x: 0.8 }, u0V: 230, tripCurrentA: 160 }));
  assert.equal(bad.meetsRequirement, false);
  assert.ok(bad.zsMarginOhm < 0);
  assert.ok(codes(bad).includes("noTime"));
  const withC = ok(checkDisconnection({ loopImpedance: 1.4, u0V: 230, tripCurrentA: 160, c: 0.95 }));
  near(withC.ik1A, (0.95 * 230) / 1.4);
  near(ok(maxLoopImpedance(230, 100, 0.95)).zsMaxOhm, 2.185);
});
test("disconnection: unreasonable input; no trip current is suggested by the engine", async () => {
  assert.ok(failCodes(checkDisconnection({ loopImpedance: 0, u0V: 230, tripCurrentA: 100 })).includes("loopImpedance"));
  assert.ok(failCodes(checkDisconnection({ loopImpedance: 1, u0V: 230, tripCurrentA: 0 })).includes("tripCurrent"));
  assert.ok(failCodes(checkDisconnection({ loopImpedance: 1, u0V: 230, tripCurrentA: 10, requiredTimeS: -1 })).includes("time"));
  assert.ok(codes(ok(checkDisconnection({ loopImpedance: 200, u0V: 230, tripCurrentA: 10, requiredTimeS: 5 }))).includes("zsRange"));
  assert.ok(codes(ok(checkDisconnection({ loopImpedance: 0.0001, u0V: 230, tripCurrentA: 10, requiredTimeS: 5 }))).includes("zsRangeLow"));
  assert.ok(codes(ok(checkDisconnection({ loopImpedance: 1, u0V: 230, tripCurrentA: 10, ratedCurrentA: 16, requiredTimeS: 5 }))).includes("tripBelowRated"));
  // 2026-11-01: the multiples of In for the B, C and D curves are gone from the engine; Ia is always input.
  const engine = await import("../lib/calculators/engine");
  for (const name of ["magneticTripSuggestion", "SUGGESTED_MAGNETIC_MULTIPLE", "SUGGESTED_VOLTAGE_FACTOR", "SUGGESTED_TEMPERATURE_C", "suggestK", "SUGGESTED_K_TEMPERATURES"]) {
    assert.equal(name in engine, false, `${name} is not part of the engine`);
  }
  assert.equal(NEUTRAL_VOLTAGE_FACTOR, 1);
});

test("voltage drop: single phase, resistive, in V and %", () => {
  const r = ok(voltageDrop({ phases: 1, voltageV: 230, currentA: 16, lengthM: 40, areaMm2: 2.5, material: "cu", temperatureC: 20, cosPhi: 1, reactancePerM: 0, allowedPercent: 4 }));
  near(r.resistanceOhm, (CU20 * 40) / 2.5); // 0,2758 Ω
  near(r.dropV, 2 * 16 * (CU20 * 40) / 2.5); // 8,83 V
  near(r.dropPercent, ((2 * 16 * (CU20 * 40) / 2.5) / 230) * 100);
  near(r.loadVoltageV, 230 - (2 * 16 * (CU20 * 40)) / 2.5);
  assert.equal(r.withinLimit, true);
  assert.equal(ok(voltageDrop({ phases: 1, voltageV: 230, currentA: 16, lengthM: 40, areaMm2: 2.5, material: "cu", temperatureC: 20, cosPhi: 1, reactancePerM: 0, allowedPercent: 3 })).withinLimit, false);
  assert.equal(ok(voltageDrop({ phases: 1, voltageV: 230, currentA: 16, lengthM: 40, areaMm2: 2.5, material: "cu", temperatureC: 20, cosPhi: 1, reactancePerM: 0 })).withinLimit, null);
});
test("voltage drop: three-phase with reactance and a warm conductor", () => {
  const rho = CU20 * (1 + 0.00393 * 50);
  const x = reactancePerMeterFromInductance(0.3);
  near(x, (2 * Math.PI * 50 * 0.3e-3) / 1000);
  const r = ok(voltageDrop({ phases: 3, voltageV: 400, currentA: 25, lengthM: 80, areaMm2: 6, material: "cu", temperatureC: 70, cosPhi: 0.8, reactancePerM: x }));
  near(r.dropV, SQRT3 * 25 * ((rho / 6) * 80 * 0.8 + x * 80 * 0.6), 1e-9);
  near(r.resistancePerM, rho / 6);
  near(r.factor, SQRT3);
});
test("voltage drop: longest length and smallest area", () => {
  const base = { phases: 1 as const, voltageV: 230, currentA: 16, material: "cu" as const, temperatureC: 20, cosPhi: 1, reactancePerM: 0 };
  near(ok(maxLengthForVoltageDrop({ ...base, areaMm2: 2.5, allowedPercent: 3 })).maxLengthM, 6.9 / (2 * 16 * (CU20 / 2.5)), 1e-9);
  near(ok(minAreaForVoltageDrop({ ...base, lengthM: 40, allowedPercent: 3 })).minAreaMm2 ?? 0, (2 * 16 * CU20 * 40) / 6.9, 1e-9);
  // The two agree: the longest length for the smallest area is the length.
  const area = ok(minAreaForVoltageDrop({ ...base, lengthM: 40, allowedPercent: 3 })).minAreaMm2 ?? 0;
  near(ok(maxLengthForVoltageDrop({ ...base, areaMm2: area, allowedPercent: 3 })).maxLengthM, 40, 1e-9);
  // With reactance: the same agreement.
  const withX = { ...base, phases: 3 as const, voltageV: 400, cosPhi: 0.85, reactancePerM: 0.00008 };
  const a2 = ok(minAreaForVoltageDrop({ ...withX, lengthM: 120, allowedPercent: 4 })).minAreaMm2 ?? 0;
  near(ok(maxLengthForVoltageDrop({ ...withX, areaMm2: a2, allowedPercent: 4 })).maxLengthM, 120, 1e-9);
  // So much reactance that no area helps.
  const none = ok(minAreaForVoltageDrop({ ...withX, currentA: 100, lengthM: 3000, allowedPercent: 0.1, reactancePerM: 0.001, cosPhi: 0.6 }));
  assert.equal(none.minAreaMm2, null);
  assert.ok(codes(none).includes("reactanceTooLarge"));
});
test("voltage drop: unreasonable input", () => {
  const base = { phases: 3 as const, voltageV: 400, currentA: 10, lengthM: 50, areaMm2: 4, material: "cu" as const, temperatureC: 20, cosPhi: 0.9, reactancePerM: 0 };
  assert.ok(failCodes(voltageDrop({ ...base, currentA: 0 })).includes("current"));
  assert.ok(failCodes(voltageDrop({ ...base, cosPhi: 0 })).includes("cosPhi"));
  assert.ok(failCodes(voltageDrop({ ...base, areaMm2: -4 })).includes("area"));
  assert.ok(failCodes(voltageDrop({ ...base, phases: 2 as unknown as 3 })).includes("phases"));
  assert.ok(codes(ok(voltageDrop({ ...base, voltageV: 50 }))).includes("voltageRange"));
  assert.ok(codes(ok(voltageDrop({ ...base, areaMm2: 0.5, lengthM: 4000, currentA: 30 }))).includes("dropLarge"));
});

test("branch length: resistive case, mΩ and Ω are the same value", () => {
  const base = { u0V: 230, tripCurrentA: 100, requiredTimeS: 0.4, areaMm2: 2.5, returnAreaMm2: 2.5, material: "cu" as const, temperatureC: 20, reactancePerM: 0 };
  const inOhm = ok(maxBranchLength({ ...base, source: { kind: "impedance", impedance: { value: 0.3, unit: "Ω" } } }));
  const inMilli = ok(maxBranchLength({ ...base, source: { kind: "impedance", impedance: { value: 300, unit: "mΩ" } } }));
  near(inOhm.maxLengthM, (2.3 - 0.3) / ((2 * CU20) / 2.5), 1e-9);
  near(inMilli.maxLengthM, inOhm.maxLengthM, 1e-12);
  near(inOhm.loopResistancePerM, (2 * CU20) / 2.5);
  near(inOhm.loopResistanceMilliOhmPerM, ((2 * CU20) / 2.5) * 1000);
  near(inOhm.phaseResistancePerM, CU20 / 2.5);
  near(inOhm.ik1AtMaxA, 100, 1e-9);
  near(inOhm.zsMaxOhm, 2.3);
  assert.equal(inOhm.check, null);
});
test("branch length: from the earth-fault current at the source, with a check of an actual length", () => {
  const r = ok(maxBranchLength({
    u0V: 230, tripCurrentA: 100, requiredTimeS: 0.4, areaMm2: 2.5, material: "cu", temperatureC: 20, reactancePerM: 0,
    source: { kind: "earthFaultCurrent", ik1A: 1000 }, lengthM: 100,
  }));
  near(r.sourceOhm, 0.23);
  near(r.maxLengthM, (2.3 - 0.23) / ((2 * CU20) / 2.5), 1e-9);
  assert.equal(r.check?.ok, true);
  near(r.check?.ik1A, 230 / (0.23 + 100 * ((2 * CU20) / 2.5)), 1e-9);
  assert.ok(codes(r).includes("returnAssumed"));
  const tooLong = ok(maxBranchLength({ u0V: 230, tripCurrentA: 100, requiredTimeS: 0.4, areaMm2: 2.5, material: "cu", temperatureC: 20, reactancePerM: 0, source: { kind: "earthFaultCurrent", ik1A: 1000 }, lengthM: 200 }));
  assert.equal(tooLong.check?.ok, false);
});
test("branch length: reactance is included (the quadratic is solved exactly) and the case without a ratio is the safe side", () => {
  const input = { u0V: 230, tripCurrentA: 80, requiredTimeS: 5, areaMm2: 6, returnAreaMm2: 6, material: "cu" as const, temperatureC: 60, reactancePerM: 0.0001, source: { kind: "impedance" as const, impedance: { value: 150, unit: "mΩ" as const } } };
  const arithmetic = ok(maxBranchLength(input));
  // Zs at the longest length equals Zs,max, found independently from the loop per metre.
  const rho = CU20 * (1 + 0.00393 * 40);
  const loop = { r: 2 * rho / 6, x: 0.0002 };
  const zPerM = Math.hypot(loop.r, loop.x);
  near(arithmetic.maxLengthM, (230 / 80 - 0.15) / zPerM, 1e-9);
  near(arithmetic.zsAtMaxOhm, 230 / 80, 1e-9);
  const vector = ok(maxBranchLength({ ...input, sourceROverX: 0.5 }));
  assert.ok(vector.maxLengthM >= arithmetic.maxLengthM - 1e-9);
  near(vector.zsAtMaxOhm, 230 / 80, 1e-9);
  const withC = ok(maxBranchLength({ ...input, c: 0.95 }));
  assert.ok(withC.maxLengthM < arithmetic.maxLengthM);
});
test("branch length: weak source, wrong units and unreasonable input", () => {
  const base = { u0V: 230, tripCurrentA: 100, requiredTimeS: 0.4, areaMm2: 2.5, material: "cu" as const, temperatureC: 20, reactancePerM: 0 };
  const weak = ok(maxBranchLength({ ...base, source: { kind: "impedance", impedance: { value: 3, unit: "Ω" } } }));
  assert.equal(weak.maxLengthM, 0);
  assert.ok(codes(weak).includes("sourceTooWeak"));
  assert.ok(codes(weak).includes("sourceLarge"));
  assert.ok(codes(ok(maxBranchLength({ ...base, source: { kind: "impedance", impedance: { value: 0.05, unit: "mΩ" } } }))).includes("sourceTiny"));
  assert.ok(failCodes(maxBranchLength({ ...base, source: { kind: "impedance", impedance: { value: 1, unit: "kΩ" as unknown as "Ω" } } })).includes("unit"));
  assert.ok(failCodes(maxBranchLength({ ...base, source: { kind: "impedance", impedance: { value: -1, unit: "Ω" } } })).includes("sourceImpedance"));
  assert.ok(failCodes(maxBranchLength({ ...base, tripCurrentA: 0, source: { kind: "earthFaultCurrent", ik1A: 500 } })).includes("tripCurrent"));
  assert.ok(failCodes(maxBranchLength({ ...base, source: { kind: "earthFaultCurrent", ik1A: 0 } })).includes("ik1"));
  assert.ok(failCodes(maxBranchLength({ ...base, areaMm2: 0, source: { kind: "earthFaultCurrent", ik1A: 500 } })).includes("area"));
  assert.equal(toOhm({ value: 0.2, unit: "mΩ" }), 0.0002);
  assert.equal(toOhm({ value: 0.2, unit: "Ω" }), 0.2);
});

const TABLE = [{ areaMm2: 1.5, izA: 20 }, { areaMm2: 2.5, izA: 27 }, { areaMm2: 4, izA: 36 }, { areaMm2: 6, izA: 46 }, { areaMm2: 10, izA: 63 }, { areaMm2: 16, izA: 85 }, { areaMm2: 25, izA: 112 }];
test("cable sizing: current with the protective device and the installation factor", () => {
  const r = ok(sizeCable({
    phases: 3, voltageV: 400, loadCurrentA: 30, protectiveRatedA: 32, deratingFactor: 0.8, lengthM: 10, cosPhi: 0.9, material: "cu", temperatureC: 70,
    reactancePerM: 0.00008, ratings: TABLE,
  }));
  near(r.designCurrentA, 32);
  near(r.requiredIzA, 40);
  // 6 mm²: 46 · 0.8 = 36.8 ≥ 32; 4 mm²: 36 · 0.8 = 28.8 < 32.
  assert.equal(r.recommendedAreaMm2, 6);
  assert.equal(r.rows.find((row) => row.areaMm2 === 4)?.currentOk, false);
  assert.equal(r.rows.find((row) => row.areaMm2 === 6)?.currentOk, true);
  assert.ok(codes(r).includes("noDropLimit"));
  assert.ok(codes(r).includes("noShortCircuit"));
});
test("cable sizing: the voltage drop can decide, and the short circuit can decide", () => {
  const drop = ok(sizeCable({
    phases: 3, voltageV: 400, loadCurrentA: 30, lengthM: 150, cosPhi: 0.9, material: "cu", temperatureC: 70, reactancePerM: 0.00008, ratings: TABLE, maxDropPercent: 3,
  }));
  const recommended = drop.recommendedAreaMm2 ?? 0;
  const row = drop.rows.find((item) => item.areaMm2 === recommended);
  assert.equal(row?.dropOk, true);
  assert.ok((row?.dropPercent ?? 99) <= 3);
  const smaller = drop.rows.filter((item) => item.areaMm2 < recommended);
  assert.ok(smaller.length > 0 && smaller.every((item) => !item.ok));
  assert.ok(recommended >= (drop.minAreaForDropMm2 ?? 0));
  assert.ok(recommended > 6, "the current alone would have allowed 6 mm²");

  const short = ok(sizeCable({
    phases: 3, voltageV: 400, loadCurrentA: 20, lengthM: 5, cosPhi: 0.9, material: "cu", temperatureC: 70, reactancePerM: 0.00008, ratings: TABLE,
    shortCircuit: { faultCurrentA: 5000, durationS: 0.2, k: 115 },
  }));
  near(short.minAreaForShortCircuitMm2, (5000 * Math.sqrt(0.2)) / 115, 1e-12);
  assert.equal(short.recommendedAreaMm2, 25);
  assert.equal(short.rows.find((item) => item.areaMm2 === 16)?.shortCircuitOk, false);
  near(short.rows.find((item) => item.areaMm2 === 25)?.withstandA2s, 115 * 115 * 625);
  near(short.rows.find((item) => item.areaMm2 === 25)?.withstandA, Math.sqrt((115 * 115 * 625) / 0.2));
});
test("cable sizing: no table, no fit, and unreasonable input", () => {
  const base = { phases: 3 as const, voltageV: 400, loadCurrentA: 30, lengthM: 100, cosPhi: 0.9, material: "cu" as const, temperatureC: 70, reactancePerM: 0.00008 };
  const none = ok(sizeCable({ ...base, maxDropPercent: 3 }));
  assert.equal(none.recommendedAreaMm2, null);
  assert.ok(codes(none).includes("noRatings"));
  assert.ok((none.minAreaForDropMm2 ?? 0) > 0);
  const noFit = ok(sizeCable({ ...base, loadCurrentA: 300, ratings: TABLE }));
  assert.equal(noFit.recommendedAreaMm2, null);
  assert.ok(codes(noFit).includes("noneFits"));
  assert.ok(failCodes(sizeCable({ ...base, loadCurrentA: 0 })).includes("load"));
  assert.ok(failCodes(sizeCable({ ...base, deratingFactor: 0 })).includes("derating"));
  assert.ok(failCodes(sizeCable({ ...base, ratings: [{ areaMm2: 4, izA: -1 }] })).includes("ratingIz"));
  assert.ok(failCodes(sizeCable({ ...base, shortCircuit: { faultCurrentA: 1000, durationS: 0, k: 115 } })).includes("duration"));
  assert.ok(codes(ok(sizeCable({ ...base, protectiveRatedA: 16, loadCurrentA: 30 }))).includes("ratedBelowLoad"));
  assert.ok(codes(ok(sizeCable({ ...base, deratingFactor: 1.5, ratings: TABLE }))).includes("factorAboveOne"));
  near(minAreaForShortCircuit({ faultCurrentA: 4000, durationS: 1, k: 100 }), 40);
});
test("the constant k is calculated from physical constants and the temperatures given (none is built in)", () => {
  // k = √(Qc·(β + 20)/ρ20 · ln((β + θf)/(β + θi))) with copper's 3,45·10⁶ J/(K·m³), β 234,5 °C, ρ20 17,241 nΩ·m; invented temperatures.
  const cu = Math.sqrt(((3.45e6 * 254.5) / 17.241e-9) * Math.log((234.5 + 155) / (234.5 + 75))) / 1e6;
  near(adiabaticK("cu", 75, 155), cu);
  const al = Math.sqrt(((2.5e6 * 248) / 28.264e-9) * Math.log((228 + 155) / (228 + 75))) / 1e6;
  near(adiabaticK("al", 75, 155), al);
  assert.ok(adiabaticK("cu", 70, 250) > adiabaticK("cu", 70, 160));
});

test("a conductor's own resistance per km from the datasheet goes before ρ / A and follows the temperature with α", () => {
  // 1,15 Ω/km (invented) at 20 °C: at 70 °C it is 1,15 · (1 + 0,00393 · 50).
  const cable = ok(cableImpedance({ lengthM: 100, areaMm2: 16, material: "cu", temperatureC: 70, reactancePerM: 0, resistancePerM20: 0.00115, returnAreaMm2: 10, returnResistancePerM20: 0.00183 }));
  near(cable.phaseResistancePerM, 0.00115 * (1 + 0.00393 * 50));
  near(cable.loop?.r, (0.00115 + 0.00183) * (1 + 0.00393 * 50) * 100);
  const drop = ok(voltageDrop({ phases: 1, voltageV: 230, currentA: 10, lengthM: 50, areaMm2: 16, material: "cu", temperatureC: 20, cosPhi: 1, reactancePerM: 0, resistancePerM20: 0.00115 }));
  near(drop.dropV, 2 * 10 * 0.00115 * 50);
  const branch = ok(maxBranchLength({ u0V: 230, tripCurrentA: 100, areaMm2: 2.5, material: "cu", temperatureC: 20, reactancePerM: 0, resistancePerM20: 0.0074, source: { kind: "earthFaultCurrent", ik1A: 1000 } }));
  near(branch.loopResistancePerM, 2 * 0.0074, 1e-9);
  assert.ok(failCodes(cableImpedance({ lengthM: 10, areaMm2: 10, material: "cu", temperatureC: 20, resistancePerM20: 0 })).includes("resistance"));
});

test("physics at 20 °C: copper 0,01724 and aluminium 0,02826 Ω·mm²/m with α 0,00393 and 0,00403 per kelvin", async () => {
  const { MATERIALS } = await import("../lib/calculators/conductor");
  assert.deepEqual([MATERIALS.cu.rho20, MATERIALS.cu.alpha, MATERIALS.al.rho20, MATERIALS.al.alpha], [0.01724, 0.00393, 0.02826, 0.00403]);
});

test("rounding helpers", () => {
  assert.equal(roundSig(1234.5678), 1230);
  assert.equal(roundSig(0.0123456), 0.0123);
  assert.equal(roundSig(6.9282, 3), 6.93);
  assert.equal(roundSig(0), 0);
});
