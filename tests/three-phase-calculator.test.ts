import assert from "node:assert/strict";
import test from "node:test";
import {
  enterThreePhase, formatFixed, formatThreePhase, initialThreePhase, PF_RANGE_NOTE, PF_ZERO_NOTE, resetThreePhase, restoreThreePhase,
  setPowerUnit, solveThreePhase, SQRT3, threePhaseResultOf, type ThreePhaseField, type ThreePhaseState,
} from "../lib/calculators/three-phase";

/**
 * The compact calculator in the top bar (2026-10-08): P = √3 × U × I × cos φ in all three directions, W and kW,
 * Swedish decimals, invalid values, cos φ = 0, and the direction following the order the fields were typed in.
 * Reference: 400 V, 16 A and cos φ = 1 give about 11,09 kW.
 */
const flat = (text: string | null) => (text ?? "").replace(/ /g, " ");
const near = (actual: number | null, expected: number, tolerance = 1e-9) => assert.ok(actual !== null && Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
const typed = (entries: [ThreePhaseField, string][], start: ThreePhaseState = initialThreePhase()) => entries.reduce((state, [field, text]) => enterThreePhase(state, field, text), start);

test("400 V and 16 A with cos φ 1 give about 11,09 kW; P is the result because U and I were typed", () => {
  const state = typed([["u", "400"], ["i", "16"]]);
  const outcome = solveThreePhase(state);
  assert.equal(outcome.result, "p");
  near(outcome.value, SQRT3 * 400 * 16 / 1000);
  assert.equal(flat(outcome.text), "11,09 kW");
  assert.equal(outcome.note, null);
  assert.deepEqual(outcome.invalid, {});
});

test("from P and U the current follows, from P and I the voltage: the reference backwards", () => {
  const current = solveThreePhase(typed([["p", "11,09"], ["u", "400"]]));
  assert.equal(current.result, "i");
  near(current.value, 11090 / (SQRT3 * 400), 1e-9);
  assert.equal(flat(current.text), "16,0 A");
  const voltage = solveThreePhase(typed([["p", "11,09"], ["i", "16"]]));
  assert.equal(voltage.result, "u");
  near(voltage.value, 11090 / (SQRT3 * 16), 1e-9);
  assert.equal(flat(voltage.text), "400 V");
});

test("cos φ scales the result in every direction and is a plain number without unit", () => {
  near(solveThreePhase(typed([["u", "400"], ["i", "10"], ["pf", "0,8"]])).value, SQRT3 * 400 * 10 * 0.8 / 1000);
  near(solveThreePhase(typed([["p", "5,5"], ["u", "400"], ["pf", "0,8"]])).value, 5500 / (SQRT3 * 400 * 0.8));
  near(solveThreePhase(typed([["p", "5,5"], ["i", "10"], ["pf", "0,8"]])).value, 5500 / (SQRT3 * 10 * 0.8));
});

test("W and kW: a typed P is read in the chosen unit, a result is shown in it, and switching converts a typed P", () => {
  const inWatts = setPowerUnit(typed([["u", "400"], ["i", "16"]]), "W");
  assert.equal(flat(solveThreePhase(inWatts).text), "11 085 W");
  assert.equal(inWatts.texts.p, "", "a calculated P is never stored as a text");
  const typedWatts = setPowerUnit(typed([["p", "11090"], ["u", "400"]], { ...initialThreePhase(), unit: "W" }), "kW");
  assert.equal(typedWatts.texts.p, "11,09", "11090 W becomes 11,09 kW when the unit changes");
  assert.equal(flat(solveThreePhase(typedWatts).text), "16,0 A");
  assert.equal(setPowerUnit(typedWatts, "W").texts.p, "11090");
  assert.equal(flat(solveThreePhase(typed([["p", "11090"], ["u", "400"]], { ...initialThreePhase(), unit: "W" })).text), "16,0 A", "a P typed in W is read as watts");
});

test("Swedish decimals: a comma in, a comma and a no-break space out", () => {
  const outcome = solveThreePhase(typed([["u", "230,5"], ["i", "2,5"], ["pf", "0,95"]]));
  near(outcome.value, SQRT3 * 230.5 * 2.5 * 0.95 / 1000);
  assert.equal(outcome.text, "0,948 kW");
  assert.equal(formatFixed(11085.1, 0), "11 085");
  assert.equal(formatFixed(-1234.5, 1), "-1 234,5");
  assert.equal(formatFixed(-0.001, 1), "0,0", "a rounded zero has no sign");
  assert.equal(flat(formatThreePhase("i", 2.345, "kW")), "2,35 A");
  assert.equal(flat(formatThreePhase("u", 24, "kW")), "24,0 V");
  assert.equal(flat(formatThreePhase("p", 0.5, "kW")), "0,500 kW");
});

test("empty and invalid values: nothing is calculated before two are typed, text that is not a number is marked", () => {
  const one = solveThreePhase(typed([["u", "400"]]));
  assert.equal(one.result, null);
  assert.equal(one.value, null);
  const bad = solveThreePhase(typed([["u", "400"], ["i", "sexton"]]));
  assert.equal(bad.result, "p");
  assert.equal(bad.value, null);
  assert.match(bad.invalid.i ?? "", /Ange ett tal/);
  assert.equal(bad.note, bad.invalid.i);
  const negative = solveThreePhase(typed([["u", "-400"], ["i", "16"]]));
  assert.match(negative.invalid.u ?? "", /inte är negativt/);
  const zeroPower = solveThreePhase(typed([["p", "0"], ["u", "400"]]));
  assert.equal(zeroPower.value, 0, "P = 0 is allowed and gives I = 0");
  assert.equal(flat(zeroPower.text), "0,00 A");
});

test("division by zero: U or I at zero in the denominator is refused, as is cos φ = 0 when U or I is calculated", () => {
  const zeroVoltage = solveThreePhase(typed([["p", "11,09"], ["u", "0"]]));
  assert.equal(zeroVoltage.value, null);
  assert.match(zeroVoltage.invalid.u ?? "", /större än noll/);
  const zeroCurrent = solveThreePhase(typed([["p", "11,09"], ["i", "0"]]));
  assert.match(zeroCurrent.invalid.i ?? "", /större än noll/);
  const pfZeroForP = solveThreePhase(typed([["u", "400"], ["i", "16"], ["pf", "0"]]));
  assert.equal(pfZeroForP.value, 0, "cos φ = 0 may still give P = 0");
  const pfZeroForI = solveThreePhase(typed([["p", "11,09"], ["u", "400"], ["pf", "0"]]));
  assert.equal(pfZeroForI.value, null);
  assert.equal(pfZeroForI.note, PF_ZERO_NOTE);
  assert.equal(pfZeroForI.invalid.pf, PF_ZERO_NOTE);
});

test("cos φ outside 0–1 is rejected with a note, an emptied cos φ asks for one", () => {
  const high = solveThreePhase(typed([["u", "400"], ["i", "16"], ["pf", "1,2"]]));
  assert.equal(high.value, null);
  assert.equal(high.note, PF_RANGE_NOTE);
  assert.equal(solveThreePhase(typed([["u", "400"], ["i", "16"], ["pf", "-0,5"]])).note, PF_RANGE_NOTE);
  const empty = solveThreePhase(typed([["u", "400"], ["i", "16"], ["pf", ""]]));
  assert.equal(empty.value, null);
  assert.match(empty.note ?? "", /Ange cos φ/);
  assert.equal(solveThreePhase(typed([["u", "400"], ["i", "16"], ["pf", "1"]])).note, null);
});

test("the direction follows the order of typing, and switches when a typed field is emptied and another filled", () => {
  assert.equal(threePhaseResultOf([]), null);
  assert.equal(threePhaseResultOf(["u"]), null);
  assert.equal(threePhaseResultOf(["u", "i"]), "p");
  assert.equal(threePhaseResultOf(["p", "i"]), "u");
  let state = typed([["u", "400"], ["i", "16"]]);
  assert.equal(solveThreePhase(state).result, "p");
  // Retyping a typed field keeps the direction.
  state = enterThreePhase(state, "u", "230");
  assert.equal(solveThreePhase(state).result, "p");
  assert.deepEqual(state.order, ["i", "u"]);
  // Empty I, type P: now I is the result and the old typed I is gone.
  state = enterThreePhase(state, "i", "");
  assert.equal(solveThreePhase(state).result, null);
  state = enterThreePhase(state, "p", "11,09");
  assert.equal(solveThreePhase(state).result, "i");
  assert.equal(state.texts.i, "");
  near(solveThreePhase(state).value, 11090 / (SQRT3 * 230));
  // Återställ: empty fields, kW and cos φ = 1.
  assert.deepEqual(resetThreePhase(), { texts: { p: "", u: "", i: "", pf: "1" }, unit: "kW", order: [] });
});

test("what the device remembers is restored only when it is sound", () => {
  const start = initialThreePhase();
  assert.deepEqual(restoreThreePhase(null), start);
  assert.deepEqual(restoreThreePhase("nonsense"), start);
  assert.deepEqual(restoreThreePhase({ unit: "MW", texts: { p: 5 }, order: ["x"] }), start);
  const saved = restoreThreePhase({ texts: { p: "11,09", u: "400", i: "stale", pf: "0,9" }, unit: "W", order: ["p", "u"] });
  assert.deepEqual(saved, { texts: { p: "11,09", u: "400", i: "", pf: "0,9" }, unit: "W", order: ["p", "u"] });
  // An order entry without a text is dropped, so a half-saved state never calculates from nothing.
  assert.deepEqual(restoreThreePhase({ texts: { p: "", u: "400", i: "", pf: "1" }, order: ["p", "u"] }).order, ["u"]);
  // cos φ missing in an old save means 1, an empty text is kept as typed.
  assert.equal(restoreThreePhase({ texts: { u: "400" } }).texts.pf, "1");
  assert.equal(restoreThreePhase({ texts: { u: "400", pf: "" } }).texts.pf, "");
});
