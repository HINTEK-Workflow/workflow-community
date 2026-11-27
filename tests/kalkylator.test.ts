import assert from "node:assert/strict";
import test from "node:test";
import { companyCalcData, deviceKey, emptyCompanyCalcData, ampacityKey, type CompanyCalcData } from "../lib/calculators/company-data";
import { modelFromValues, saveInputs } from "../lib/calculators/company-values-edit";
import { branchLengthModule } from "../lib/calculators/kalkylator/branch-length";
import { cableSizingModule } from "../lib/calculators/kalkylator/cable-sizing";
import { compensationModule } from "../lib/calculators/kalkylator/compensation";
import { disconnectionModule } from "../lib/calculators/kalkylator/disconnection";
import { CALC_ENTRIES, CALC_MODULES, entryById, partOf } from "../lib/calculators/kalkylator/list";
import { calcHref, COMPANY_VALUES_TOOL, companyValuesOpen, dockSummary, readSelection, readSelectionOrDefault } from "../lib/calculators/kalkylator/navigation";
import { parseRatings } from "../lib/calculators/kalkylator/ratings";
import { shortCircuitToolModule } from "../lib/calculators/kalkylator/short-circuit";
import { transformerModule } from "../lib/calculators/kalkylator/transformer";
import { voltageDropToolModule } from "../lib/calculators/kalkylator/voltage-drop";
import { registryProblems } from "../lib/calculators/registry";
import { fieldFallback, initialState, runModule, withChoice, withExample, withText, withTextInput, withUnit } from "../lib/calculators/run";
import { parseDecimal } from "../lib/calculators/number";
import type { CalcContext, CalcModule, Outcome, OutputQuantity } from "../lib/calculators/types";
import { formatQuantity } from "../lib/calculators/units";
import type { CompanyValue } from "../lib/workflow/company-values";

/**
 * The Kalkylator (2026-10-12): every calculator, driven the way the page drives it (typed text with a decimal comma,
 * a unit chosen at the field, a choice) and checked against numbers worked out here by hand from the formulas, not from the
 * engine. The Iz table and the devices in these tests are invented for the tests; no table is part of the product.
 */
type Typed = Record<string, string | { text: string; unit: string }>;
const plain: CalcContext = { company: emptyCompanyCalcData() };
function solve(tool: CalcModule, typed: Typed, choices: Record<string, string> = {}, ctx: CalcContext = plain, texts: Record<string, string> = {}): Outcome {
  let state = initialState(tool, ctx);
  for (const [id, value] of Object.entries(choices)) state = withChoice(tool, state, id, value);
  for (const [id, value] of Object.entries(typed)) {
    state = withText(tool, state, id, typeof value === "string" ? value : value.text);
    if (typeof value !== "string") state = withUnit(tool, state, id, value.unit);
  }
  for (const [id, text] of Object.entries(texts)) state = withTextInput(state, id, text);
  return runModule(tool, state, ctx);
}
function ok(outcome: Outcome) {
  assert.equal(outcome.status, "ok", JSON.stringify(outcome));
  return outcome as Extract<Outcome, { status: "ok" }>;
}
const quantityOf = (outcome: Outcome, id: string): number => {
  const row = ok(outcome).rows.find((item) => item.id === id);
  assert.ok(row?.kind === "quantity", `${id} is a quantity`);
  return (row as OutputQuantity).value;
};
const near = (actual: number, expected: number, relative = 1e-6) => assert.ok(Math.abs(actual - expected) <= relative * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
const notesOf = (outcome: Outcome) => ok(outcome).notes.map((note) => note.text).join(" | ");
const verdictOf = (outcome: Outcome, id: string) => ok(outcome).rows.find((row) => row.id === id && row.kind === "verdict");
const SQRT3 = Math.sqrt(3);
// Physics at 20 °C (2026-11-01): annealed copper at 100 % IACS and its temperature coefficient. Without the company's
// values the calculators take the neutral c = 1 and 20 °C, so the conductor is counted as it is at 20 °C.
const RHO20 = 0.01724;
const ALPHA = 0.00393;
const X = 0.00008; // the reactance suggestion, Ω/m
const rhoAt = (celsius: number) => RHO20 * (1 + ALPHA * (celsius - 20));
/** Results use no-break spaces between thousands and before the unit; the tests read them as plain spaces. */
const flat = (text: string) => text.replace(/ /g, " ");

const row = (key: string, low: number | null, high: number | null, source = ""): CompanyValue => ({ key, low, high, warnLow: null, warnHigh: null, source, reference: "", version: 1, updatedAt: null, updatedByName: null } as unknown as CompanyValue);
const withCompany = (...rows: CompanyValue[]): CalcContext => ({ company: companyCalcData(rows) });

test("the list holds the seven calculators, each module declared correctly, the first with three parts", () => {
  assert.deepEqual(CALC_ENTRIES.map((entry) => entry.id), ["power", "transformer", "short-circuit", "disconnection", "voltage-drop", "branch-length", "cable-sizing"]);
  assert.deepEqual(registryProblems(CALC_MODULES), []);
  assert.deepEqual(entryById("power")!.parts.map((part) => part.id), ["quick", "power", "compensation"]);
  assert.equal(entryById("power")!.parts[0]!.module, undefined, "the compact three-phase calculator is the first part");
  assert.equal(partOf(entryById("power")!, "nonsense").id, "quick");
  // Ström och effekt is the older module, unchanged; the others of the Kalkylator each have a worked example.
  for (const tool of CALC_MODULES.filter((item) => item.id !== "power")) assert.ok(tool.example, `${tool.id} has an example`);
});

test("Swedish decimals: comma, point, spaces and a minus are read the same way in every field", () => {
  assert.deepEqual(parseDecimal("0,35"), { state: "ok", value: 0.35 });
  assert.deepEqual(parseDecimal("0.35"), { state: "ok", value: 0.35 });
  assert.deepEqual(parseDecimal("1 250,5"), { state: "ok", value: 1250.5 });
  assert.deepEqual(parseDecimal("  "), { state: "empty" });
  assert.equal(parseDecimal("abc").state, "invalid");
  const comma = solve(disconnectionModule, { zs: "0,35", rated: "16", time: "0,4", trip: "145,5" }, { device: "c" });
  const point = solve(disconnectionModule, { zs: "0.35", rated: "16", time: "0.4", trip: "145.5" }, { device: "c" });
  near(quantityOf(comma, "trip"), quantityOf(point, "trip"));
  near(quantityOf(comma, "ik1"), quantityOf(point, "ik1"));
  const bad = solve(disconnectionModule, { zs: "0,3,5", rated: "16", time: "0,4" });
  assert.equal(bad.status, "invalid");
});

test("units are chosen at the field: 350 mΩ is 0,35 Ω, and a unit outside the dimension is refused before anything is calculated", () => {
  const ohm = solve(disconnectionModule, { zs: { text: "0,35", unit: "Ω" }, rated: "16", time: "0,4", trip: "145" }, { device: "c" });
  const milli = solve(disconnectionModule, { zs: { text: "350", unit: "mΩ" }, rated: "16", time: "0,4", trip: "145" }, { device: "c" });
  near(quantityOf(milli, "zs"), 0.35);
  near(quantityOf(milli, "ik1"), quantityOf(ohm, "ik1"));
  const tool = disconnectionModule;
  const state = withUnit(tool, withText(tool, initialState(tool, plain), "zs", "0,35"), "zs", "kV");
  const refused = runModule(tool, state, plain);
  assert.equal(refused.status, "invalid");
  assert.match(refused.status === "invalid" ? refused.errors[0]!.message : "", /Enhetsfel/);
});

test("transformer: 800 kVA, 10/0,4 kV and uk 5 % give about 1155 A on the LSP side; everything worked out by hand", () => {
  const outcome = solve(transformerModule, { s: { text: "800", unit: "kVA" }, u1: { text: "10", unit: "kV" }, u2: { text: "400", unit: "V" }, uk: "5" });
  near(quantityOf(outcome, "i2"), 800000 / (SQRT3 * 400)); // 1154,7 A
  assert.ok(Math.abs(quantityOf(outcome, "i2") - 1155) < 1);
  near(quantityOf(outcome, "i1"), 800000 / (SQRT3 * 10000)); // 46,19 A
  near(quantityOf(outcome, "zk"), 0.05 * 400 ** 2 / 800000); // 10 mΩ
  near(quantityOf(outcome, "ik3"), 400 / (SQRT3 * 0.01)); // 23 094 A
  near(quantityOf(outcome, "ik2"), (SQRT3 / 2) * 400 / (SQRT3 * 0.01));
  assert.match(notesOf(outcome), /ren reaktans/, "no load loss: the engine says it is pure reactance");
  assert.equal(ok(outcome).rows.some((item) => item.id === "ik3Grid"), false, "without a grid there is only one Ik3");
});

test("transformer with a grid of 250 MVA and with a load loss: the grid's impedance and the resistance are counted", () => {
  const withGrid = solve(transformerModule, { s: { text: "800", unit: "kVA" }, u1: { text: "10", unit: "kV" }, u2: "400", uk: "5", gridS: { text: "250", unit: "MVA" } }, { grid: "power" });
  const zGrid = 400 ** 2 / 250e6; // 0,64 mΩ
  near(quantityOf(withGrid, "ik3Grid"), 400 / (SQRT3 * (0.01 + zGrid)));
  assert.ok(quantityOf(withGrid, "ik3Grid") < quantityOf(withGrid, "ik3"));
  // The grid given by Ik3 on the HSP side is the same grid: S = √3 · 10 kV · 14,434 kA = 250 MVA.
  const byCurrent = solve(transformerModule, { s: { text: "800", unit: "kVA" }, u1: { text: "10", unit: "kV" }, u2: "400", uk: "5", gridI: { text: "14,4338", unit: "kA" } }, { grid: "current" });
  near(quantityOf(byCurrent, "ik3Grid"), quantityOf(withGrid, "ik3Grid"), 1e-4);
  const withLoss = solve(transformerModule, { s: { text: "800", unit: "kVA" }, u1: { text: "10", unit: "kV" }, u2: "400", uk: "5", pk: { text: "9", unit: "kW" }, p0: { text: "1300", unit: "W" } });
  const i2 = 800000 / (SQRT3 * 400);
  const rk = 9000 / (3 * i2 * i2);
  near(quantityOf(withLoss, "rk"), rk);
  near(quantityOf(withLoss, "xk"), Math.sqrt(0.01 ** 2 - rk ** 2));
  near(quantityOf(withLoss, "eta"), (800000 / (800000 + 10300)) * 100);
});

test("transformer: a mistyped voltage order and an impossible loss are said in words", () => {
  const swapped = solve(transformerModule, { s: { text: "800", unit: "kVA" }, u1: { text: "400", unit: "V" }, u2: { text: "10", unit: "kV" }, uk: "5" });
  assert.match(notesOf(swapped), /HSP och LSP/);
  const tooLarge = solve(transformerModule, { s: { text: "800", unit: "kVA" }, u1: { text: "10", unit: "kV" }, u2: "400", uk: "5", pk: { text: "60", unit: "kW" } });
  assert.equal(tooLarge.status, "invalid");
  assert.match(tooLarge.status === "invalid" ? tooLarge.errors.map((error) => error.message).join(" ") : "", /Belastningsförlusten är för stor/);
});

test("short circuit: a 16 kA source and two cable sections add as vectors; without company values c is 1 and the conductors 20 °C, and the result says so", () => {
  const outcome = solve(shortCircuitToolModule, { u: "400", srcIk3: { text: "16", unit: "kA" }, len1: "50", area1: "35", len2: "30", area2: "16" }, { source: "ik3", sections: "2" });
  // Largest: source Z = 400/(√3·16000), pure reactance; the cable at 20 °C.
  const zSource = 400 / (SQRT3 * 16000);
  const r = (RHO20 / 35) * 50 + (RHO20 / 16) * 30;
  const x = zSource + X * 50 + X * 30;
  const z = Math.hypot(r, x);
  near(quantityOf(outcome, "ik3"), 400 / (SQRT3 * z)); // about 3,81 kA
  assert.ok(Math.abs(quantityOf(outcome, "ik3") - 3808) < 2);
  near(quantityOf(outcome, "ik2"), (SQRT3 / 2) * 400 / (SQRT3 * z));
  // Smallest: the neutral c 1 and 20 °C, the loop out and back along equally large protective conductors.
  const loopR = 2 * r;
  const loopX = zSource + 2 * X * 80;
  near(quantityOf(outcome, "ik1"), 400 / (SQRT3 * Math.hypot(loopR, loopX)));
  assert.ok(Math.abs(quantityOf(outcome, "ik1") - 1972) < 2);
  const notes = notesOf(outcome);
  assert.match(notes, /slingimpedans antas vara lika med fasimpedansen/, "the source's loop is assumed and the engine says so");
  assert.match(notes, /Skyddsledarens area saknas/);
  assert.match(notes, /Räknat med 1 för spänningsfaktorn c för största ström, 1 för spänningsfaktorn c för minsta ström, 20 °C för ledartemperaturen vid största ström och 20 °C för ledartemperaturen vid minsta ström eftersom inget värde är angivet/);
  assert.equal(ok(outcome).notes.find((note) => /^Räknat med/.test(note.text))?.tone, "missing");
  assert.doesNotMatch(notes, /0,95|55 °C/, "no number from a standard is used");
});

test("short circuit: the company's c and temperatures replace the neutral values; a section's datasheet resistance per km goes before ρ / A", () => {
  const company = withCompany(row("kabel.c_max", null, 1.05, "Egen rutin"), row("kabel.c_min", null, 0.9, "Egen rutin"), row("kabel.temp_min", null, 80, "Egen rutin"));
  const outcome = solve(shortCircuitToolModule, { u: "400", srcIk3: { text: "16", unit: "kA" }, len1: "50", area1: "35" }, { source: "ik3", sections: "1" }, company);
  assert.doesNotMatch(notesOf(outcome), /Räknat med 1 för spänningsfaktorn/);
  assert.match(notesOf(outcome), /20 °C för ledartemperaturen vid största ström/, "only the missing value is named");
  const zMax = 1.05 * 400 / (SQRT3 * 16000);
  near(quantityOf(outcome, "ik3"), (1.05 * 400) / (SQRT3 * Math.hypot((RHO20 / 35) * 50, zMax + X * 50)));
  const zMin = 0.9 * 400 / (SQRT3 * 16000);
  near(quantityOf(outcome, "ik1"), (0.9 * 400) / (SQRT3 * Math.hypot(2 * (rhoAt(80) / 35) * 50, zMin + 2 * X * 50)));
  // 0,52 Ω/km from an (invented) datasheet at 20 °C: r = 0,52/1000 Ω/m, out and back along the same conductor.
  const own = solve(shortCircuitToolModule, { u: "400", srcIk3: { text: "16", unit: "kA" }, len1: "50", area1: "35", rkm1: { text: "0,52", unit: "Ω/km" } }, { source: "ik3", sections: "1" });
  const zSource = 400 / (SQRT3 * 16000);
  near(quantityOf(own, "ik3"), 400 / (SQRT3 * Math.hypot(0.00052 * 50, zSource + X * 50)));
  near(quantityOf(own, "ik1"), 400 / (SQRT3 * Math.hypot(2 * 0.00052 * 50, zSource + 2 * X * 50)));
  const ownPe = solve(shortCircuitToolModule, { u: "400", srcIk3: { text: "16", unit: "kA" }, len1: "50", area1: "35", pe1: "16", rkm1: { text: "0,52", unit: "Ω/km" }, rkmPe1: { text: "1,15", unit: "Ω/km" }, tempMin: "70" }, { source: "ik3", sections: "1" });
  const warm = 1 + ALPHA * 50;
  near(quantityOf(ownPe, "ik1"), 400 / (SQRT3 * Math.hypot((0.00052 + 0.00115) * warm * 50, zSource + 2 * X * 50)));
});

test("short circuit: the source by power or by impedance in mΩ or Ω, and a separate loop impedance Zför", () => {
  // 11 MVA at 400 V is the same source as 15,877 kA: Ik3 = S / (√3 U).
  const byPower = solve(shortCircuitToolModule, { u: "400", srcPower: { text: "11", unit: "MVA" }, len1: "0", area1: "35" }, { source: "power" });
  near(quantityOf(byPower, "ik3"), 11e6 / (SQRT3 * 400), 1e-9);
  const milli = solve(shortCircuitToolModule, { u: "400", srcZ: { text: "14", unit: "mΩ" }, len1: "0", area1: "35" }, { source: "impedance" });
  const ohm = solve(shortCircuitToolModule, { u: "400", srcZ: { text: "0,014", unit: "Ω" }, len1: "0", area1: "35" }, { source: "impedance" });
  near(quantityOf(milli, "ik3"), 400 / (SQRT3 * 0.014));
  near(quantityOf(milli, "ik3"), quantityOf(ohm, "ik3"));
  const separate = solve(shortCircuitToolModule, { u: "400", srcZ: { text: "14", unit: "mΩ" }, zLoop: { text: "28", unit: "mΩ" }, len1: "0", area1: "35" }, { source: "impedance" });
  near(quantityOf(separate, "ik1"), 400 / (SQRT3 * 0.028));
  assert.doesNotMatch(notesOf(separate), /slingimpedans antas/);
  assert.match(notesOf(milli), /slingimpedans antas/);
});

test("disconnection: C16 on 0,4 s with a typed Ia of 145 A clears at Zs 0,35 Ω and not at 1,8 Ω; without the company's c it is 1 and the result says so", () => {
  const clears = solve(disconnectionModule, { zs: { text: "0,35", unit: "Ω" }, rated: "16", time: "0,4", trip: "145" }, { device: "c" });
  near(quantityOf(clears, "trip"), 145);
  near(quantityOf(clears, "ik1"), 230 / 0.35); // 657,1 A
  near(quantityOf(clears, "zsMax"), 230 / 145); // 1,586 Ω
  near(quantityOf(clears, "marginPercent"), (230 / 0.35 / 145 - 1) * 100);
  const passing = verdictOf(clears, "verdict");
  assert.ok(passing?.kind === "verdict" && passing.tone === "ok" && passing.text.startsWith("Klarar kravet: "), JSON.stringify(passing));
  assert.match(notesOf(clears), /Räknat med 1 för spänningsfaktorn c eftersom inget värde är angivet/);
  assert.doesNotMatch(notesOf(clears), /förslag/i, "nothing in the calculation is a suggestion");
  const fails = solve(disconnectionModule, { zs: { text: "1,8", unit: "Ω" }, rated: "16", time: "0,4", trip: "145" }, { device: "c" });
  const failing = verdictOf(fails, "verdict");
  assert.ok(failing?.kind === "verdict" && failing.tone === "alarm" && /^Klarar inte kravet: /.test(failing.text));
  assert.ok(quantityOf(fails, "margin") < 0);
  // The company's c replaces the neutral 1 and the note goes away.
  const withC = solve(disconnectionModule, { zs: { text: "0,35", unit: "Ω" }, rated: "16", time: "0,4", trip: "145" }, { device: "c" }, withCompany(row("kabel.c_min", null, 0.9, "Egen rutin")));
  near(quantityOf(withC, "ik1"), (0.9 * 230) / 0.35);
  assert.doesNotMatch(notesOf(withC), /Räknat med/);
});

test("disconnection: the device is a choice the person must make – nothing is chosen from the start and the result waits for it", () => {
  const state = initialState(disconnectionModule, plain);
  assert.equal(state.choices.device, "", "no device chosen from the start");
  const waiting = solve(disconnectionModule, { zs: "0,35", rated: "16", time: "0,4" });
  assert.equal(waiting.status, "incomplete");
  assert.match(waiting.status === "incomplete" ? waiting.message : "", /^Ange skyddsapparat så visas resultatet här\.$/, "Ia is not asked for before the device is chosen");
  assert.equal(dockSummary(waiting).state, "waiting");
  const device = disconnectionModule.inputs.find((input) => input.id === "device");
  assert.ok(device?.kind === "choice" && device.placeholder === "Välj skyddsapparat" && device.display === "select");
  const trip = disconnectionModule.inputs.find((input) => input.id === "trip");
  assert.ok(trip?.kind === "number" && trip.example === undefined && trip.placeholder === "Tillverkarens tabell", "no example figure for Ia");
  assert.match(trip?.help ?? "", /^Ia enligt tillverkarens tid–strömkurva \/ SS-EN 60898-1 – värdet anges av företaget\./);
  assert.doesNotMatch(trip?.help ?? "", /\d+ ?×|gånger/, "the designation only, never the standard's multiples");
  // The same in Största gruppledningslängd.
  assert.equal(initialState(branchLengthModule, plain).choices.device, "");
  assert.equal(solve(branchLengthModule, { srcZ: { text: "200", unit: "mΩ" }, rated: "16", time: "0,4", area: "2,5" }).status, "incomplete");
});

test("disconnection: Ia is asked for for every device – no multiple of In is suggested for B, C or D – and a typed Ia gives the answer", () => {
  for (const device of ["gg", "b", "c", "d", "annan"]) {
    const waiting = solve(disconnectionModule, { zs: "0,35", rated: "16", time: "0,4" }, { device });
    assert.equal(waiting.status, "incomplete", device);
    assert.match(waiting.status === "incomplete" ? waiting.message : "", /utlösningsström Ia/i);
    let state = initialState(disconnectionModule, plain);
    state = withChoice(disconnectionModule, state, "device", device);
    state = withText(disconnectionModule, withText(disconnectionModule, state, "rated", "16"), "time", "0,4");
    assert.equal(fieldFallback(disconnectionModule, state, "trip", plain), undefined, `${device}: no value is made up`);
  }
  const typed = solve(disconnectionModule, { zs: "0,35", rated: "16", time: "0,4", trip: "100" }, { device: "gg" });
  near(quantityOf(typed, "trip"), 100);
  const own = verdictOf(typed, "verdict");
  assert.ok(own?.kind === "verdict" && own.tone === "ok" && own.text.startsWith("Klarar kravet: "), "the person's own Ia: green");
  const curve = solve(disconnectionModule, { zs: "0,35", rated: "16", time: "0,4", trip: "110" }, { device: "c" });
  near(quantityOf(curve, "trip"), 110);
  assert.equal(verdictOf(curve, "verdict")?.tone, "ok");
});

test("disconnection: the company's own protective devices fill Ia and the field says where it came from; Ik1 can be given instead of Zs", () => {
  const company = withCompany(row(deviceKey("c", 16, 0.4), 16, 120, "Egen lista"), row(deviceKey("gg", 16, 5), 16, 90, "Egen lista"));
  assert.equal(company.company.devices.length, 2);
  const outcome = solve(disconnectionModule, { zs: "0,35", rated: "16", time: "0,4" }, { device: "c" }, company);
  near(quantityOf(outcome, "trip"), 120);
  const companyVerdict = verdictOf(outcome, "verdict");
  assert.ok(companyVerdict?.kind === "verdict" && companyVerdict.tone === "ok" && /^Klarar kravet: .*\(företagets värde\)/.test(companyVerdict.text), "the company's own Ia: green");
  // The page shows the fallback in the empty field, following type, In and time typed above it.
  let state = initialState(disconnectionModule, company);
  state = withChoice(disconnectionModule, state, "device", "gg");
  state = withText(disconnectionModule, withText(disconnectionModule, state, "rated", "16"), "time", "5");
  const shown = fieldFallback(disconnectionModule, state, "trip", company);
  assert.deepEqual([shown?.value, shown?.origin], [90, "company"]);
  assert.match(shown?.note ?? "", /Egen lista/);
  // Another time: no row, so nothing is made up.
  state = withText(disconnectionModule, state, "time", "0,2");
  assert.equal(fieldFallback(disconnectionModule, state, "trip", company), undefined);
  // From Ik1: Zs = U0 / Ik1 (the given current at U0), and the smallest current takes c: Ik1 min = c · U0 / Zs = c · Ik1 (2026-10-31).
  const byCurrent = solve(disconnectionModule, { ik1: "650", rated: "16", time: "0,4", c: "0,9" }, { known: "ik1", device: "c" }, company);
  near(quantityOf(byCurrent, "zs"), 230 / 650);
  near(quantityOf(byCurrent, "ik1"), 0.9 * 650); // the typed c 0,9
});

test("voltage drop: three-phase 32 A, 80 m of 10 mm² copper at cos φ 0,9 and the longest cable for 3 %; without a temperature it is 20 °C and said", () => {
  const outcome = solve(voltageDropToolModule, { i: "32", cosphi: "0,9", len: "80", area: "10", allowed: "3" });
  const rr = (RHO20 / 10) * 80; // 0,1379 Ω
  const xx = X * 80;
  const sin = Math.sqrt(1 - 0.81);
  const drop = SQRT3 * 32 * (rr * 0.9 + xx * sin);
  near(quantityOf(outcome, "dropV"), drop);
  near(quantityOf(outcome, "dropPercent"), (drop / 400) * 100);
  assert.ok(Math.abs(quantityOf(outcome, "dropPercent") - 1.759) < 0.001);
  const perMetre = SQRT3 * 32 * ((RHO20 / 10) * 0.9 + X * sin);
  near(quantityOf(outcome, "maxLength"), (0.03 * 400) / perMetre);
  const within = verdictOf(outcome, "limit");
  assert.ok(within?.kind === "verdict" && within.tone === "ok");
  const label = ok(outcome).rows.find((item) => item.id === "dropPercent")?.label;
  assert.match(label ?? "", /huvudspänningen/);
  // No temperature is built in: 20 °C (no correction), marked as the neutral value with a way to enter the company's.
  assert.match(notesOf(outcome), /Räknat med 20 °C för ledartemperaturen eftersom inget värde är angivet/);
  assert.ok(ok(outcome).inputs.some((input) => input.id === "temperature" && input.origin === "default" && /20 °C – ange företagets värde/.test(input.note ?? "")));
  assert.doesNotMatch(notesOf(outcome), /70 °C/);
  const warm = solve(voltageDropToolModule, { i: "32", cosphi: "0,9", len: "80", area: "10", allowed: "3", temperature: "70" });
  near(quantityOf(warm, "dropV"), SQRT3 * 32 * ((rhoAt(70) / 10) * 80 * 0.9 + xx * sin));
  assert.doesNotMatch(notesOf(warm), /Räknat med/);
  const company = solve(voltageDropToolModule, { i: "32", cosphi: "0,9", len: "80", area: "10" }, {}, withCompany(row("kabel.temp_drift", null, 60, "Egen rutin")));
  near(quantityOf(company, "dropV"), SQRT3 * 32 * ((rhoAt(60) / 10) * 80 * 0.9 + xx * sin));
  const help = voltageDropToolModule.inputs.find((input) => input.id === "temperature")?.help ?? "";
  assert.match(help, /20 °C/);
  assert.doesNotMatch(help, /70 °C/);
});

test("voltage drop: the conductor's resistance per km from the datasheet goes before ρ / A and is corrected to the temperature", () => {
  // 1,9 Ω/km is an invented datasheet value at 20 °C for the test.
  const own = solve(voltageDropToolModule, { i: "32", cosphi: "0,9", len: "80", area: "10", rkm: { text: "1,9", unit: "Ω/km" }, temperature: "50" });
  const sin = Math.sqrt(1 - 0.81);
  const r = 0.0019 * (1 + ALPHA * 30) * 80;
  near(quantityOf(own, "dropV"), SQRT3 * 32 * (r * 0.9 + X * 80 * sin));
  near(quantityOf(own, "resistance"), r);
  assert.match(ok(own).steps.join("\n"), /databladets/);
  const field = voltageDropToolModule.inputs.find((input) => input.id === "rkm");
  // Only a cable type the company itself entered fills the field (KA4, 2026-11-01).
  assert.ok(field?.kind === "number" && field.label === "Ledarens resistans per km (från databladet)" && field.fallback?.({ cableType: "own" }, plain) === undefined, "no datasheet value is built in");
});

test("voltage drop: single phase counts out and back against the phase voltage, and says so; without a limit there is no comparison", () => {
  const outcome = solve(voltageDropToolModule, { i: "16", len: "40", area: "2,5" }, { phases: "1" });
  const drop = 2 * 16 * ((RHO20 / 2.5) * 40 * 1 + 0); // cos φ 1: the reactance does not count
  near(quantityOf(outcome, "dropV"), drop);
  near(quantityOf(outcome, "dropPercent"), (drop / 230) * 100);
  assert.match(ok(outcome).rows.find((item) => item.id === "dropPercent")?.label ?? "", /fasspänningen/);
  assert.equal(verdictOf(outcome, "limit"), undefined);
  assert.match(notesOf(outcome), /Ingen gräns är angiven/);
  assert.match(notesOf(outcome), /Reaktans per meter är ett förslag/);
});

test("voltage drop: the company's limit and reactance fill the empty fields and replace the suggestion", () => {
  const company = withCompany(row("kabel.spanningsfall_max", null, 4, "Egen rutin"), row("kabel.reaktans", null, 0.1, "Egen rutin"));
  const outcome = solve(voltageDropToolModule, { i: "32", cosphi: "0,9", len: "80", area: "10" }, {}, company);
  const sin = Math.sqrt(1 - 0.81);
  near(quantityOf(outcome, "dropV"), SQRT3 * 32 * ((RHO20 / 10) * 80 * 0.9 + 0.0001 * 80 * sin));
  assert.ok(verdictOf(outcome, "limit"), "the company's 4 % is compared with");
  assert.doesNotMatch(notesOf(outcome), /Reaktans per meter är ett förslag/);
});

test("branch length: 200 mΩ (0,2 Ω) with a B16 on 0,4 s, a typed Ia of 75 A and 2,5 mm² copper gives about 208 m; a source far too small for its unit is warned about", () => {
  const typed = { srcZ: { text: "200", unit: "mΩ" }, rated: "16", time: "0,4", trip: "75", area: "2,5" };
  const outcome = solve(branchLengthModule, typed, { device: "b" });
  const zsMax = 230 / 75; // the neutral c 1
  near(quantityOf(outcome, "zsMax"), zsMax);
  const loopR = (2 * RHO20) / 2.5; // the neutral 20 °C
  const loopX = 2 * X;
  const perMetre = Math.hypot(loopR, loopX); // the source is put in line with the cable (the safe side)
  near(quantityOf(outcome, "maxLength"), (zsMax - 0.2) / perMetre);
  assert.ok(Math.abs(quantityOf(outcome, "maxLength") - 207.8) < 0.1);
  assert.match(notesOf(outcome), /Räknat med 1 för spänningsfaktorn c och 20 °C för ledartemperaturen eftersom inget värde är angivet/);
  assert.equal(solve(branchLengthModule, { ...typed, trip: "" }, { device: "b" }).status, "incomplete", "no Ia, no answer");
  near(quantityOf(outcome, "source"), 0.2);
  const ohm = solve(branchLengthModule, { ...typed, srcZ: { text: "0,2", unit: "Ω" } }, { device: "b" });
  near(quantityOf(ohm, "maxLength"), quantityOf(outcome, "maxLength"));
  const slip = solve(branchLengthModule, { ...typed, srcZ: { text: "0,05", unit: "mΩ" } }, { device: "b" });
  assert.match(notesOf(slip), /Kontrollera enheten \(mΩ eller Ω\)/);
  assert.ok(quantityOf(slip, "maxLength") > quantityOf(outcome, "maxLength"));
  assert.match(notesOf(outcome), /Skyddsledarens area saknas/);
});

test("branch length: the source by Ik1, a protective conductor of its own and a length to check", () => {
  const company = withCompany(row("kabel.c_min", null, 0.9, "Egen rutin"), row("kabel.temp_min", null, 60, "Egen rutin"));
  const outcome = solve(branchLengthModule, { srcIk1: "1150", rated: "16", time: "0,4", area: "2,5", pe: "1,5", len: "120", trip: "100" }, { source: "ik1", device: "gg" }, company);
  const rho = rhoAt(60);
  const loopR = rho / 2.5 + rho / 1.5;
  const perMetre = Math.hypot(loopR, 2 * X);
  const zSource = 230 / 1150;
  near(quantityOf(outcome, "maxLength"), ((0.9 * 230) / 100 - zSource) / perMetre);
  const check = verdictOf(outcome, "check");
  assert.ok(check?.kind === "verdict");
  const zs120 = zSource + 120 * perMetre;
  assert.equal(check.tone, (0.9 * 230) / zs120 >= 100 ? "ok" : "alarm");
  assert.doesNotMatch(notesOf(outcome), /Skyddsledarens area saknas/);
  assert.doesNotMatch(notesOf(outcome), /Räknat med/, "the company's c and temperature are used");
});

test("branch length: the datasheet resistance per km of the phase and protective conductors goes before ρ / A", () => {
  // 7,6 and 12,3 Ω/km are invented datasheet values at 20 °C for the test; the conductors at 20 °C (no correction).
  const outcome = solve(branchLengthModule, { srcZ: { text: "200", unit: "mΩ" }, rated: "16", time: "0,4", trip: "75", area: "2,5", pe: "1,5", rkm: { text: "7,6", unit: "Ω/km" }, rkmPe: { text: "12,3", unit: "Ω/km" } }, { device: "b" });
  const perMetre = Math.hypot(0.0076 + 0.0123, 2 * X);
  near(quantityOf(outcome, "maxLength"), (230 / 75 - 0.2) / perMetre);
  near(quantityOf(outcome, "loopR"), 0.0076 + 0.0123);
  // Only the phase conductor's value and no protective conductor area: the loop is the phase conductor twice.
  const phaseOnly = solve(branchLengthModule, { srcZ: { text: "200", unit: "mΩ" }, rated: "16", time: "0,4", trip: "75", area: "2,5", rkm: { text: "7,6", unit: "Ω/km" } }, { device: "b" });
  near(quantityOf(phaseOnly, "loopR"), 2 * 0.0076);
});

test("branch length: a source that is already too weak gives length 0 with the engine's warning", () => {
  const outcome = solve(branchLengthModule, { srcZ: { text: "3", unit: "Ω" }, rated: "16", time: "0,4", trip: "80", area: "2,5" }, { device: "b" });
  near(quantityOf(outcome, "maxLength"), 0);
  assert.match(notesOf(outcome), /Källans impedans ensam är redan högre/);
});

test("cable sizing: the current, the voltage drop and the short circuit are all checked against a table typed in", () => {
  // An invented rating table (Iz per area), for the test only.
  const table = "1,5 10\n2,5 14\n4 19\n6 25\n10 35\n16 60\n25 80";
  // The cable's temperatures before and at the end of the short circuit are typed here (invented for the test, as from a datasheet).
  const outcome = solve(cableSizingModule, { i: "40", cosphi: "0,9", rated: "50", len: "60", allowed: "3", faultCurrent: { text: "6", unit: "kA" }, faultTime: "0,1", kStart: "75", kEnd: "155" }, {}, plain, { ratings: table });
  // Iz must cover max(40, 50) = 50 A: 16 mm² (60 A) does; its voltage drop is fine; but 6 kA for 0,1 s needs about 17,5 mm².
  near(quantityOf(outcome, "design"), 50);
  // k from physics: copper's volumetric heat capacity 3,45·10⁶ J/(K·m³), β 234,5 °C and ρ20 17,241 nΩ·m.
  const k = Math.sqrt(((3.45e6 * (234.5 + 20)) / 17.241e-9) * Math.log((234.5 + 155) / (234.5 + 75))) / 1e6;
  near(quantityOf(outcome, "minShort"), (6000 * Math.sqrt(0.1)) / k);
  assert.ok(quantityOf(outcome, "minShort") > 16, "16 mm² does not withstand it");
  assert.equal(quantityOf(outcome, "recommended"), 25);
  const dropAt16 = SQRT3 * 40 * ((RHO20 / 16) * 60 * 0.9 + X * 60 * Math.sqrt(1 - 0.81));
  assert.ok(dropAt16 / 400 * 100 < 3, "16 mm² would pass the voltage drop, so the short circuit is what rules it out");
  near(quantityOf(outcome, "dropAtChosen"), (SQRT3 * 40 * ((RHO20 / 25) * 60 * 0.9 + X * 60 * Math.sqrt(1 - 0.81)) / 400) * 100);
  assert.ok(ok(outcome).inputs.some((input) => input.id === "k" && input.origin === "default" && /75 till 155 °C/.test(input.note ?? "")));
  assert.match(notesOf(outcome), /Räknat med 20 °C för ledartemperaturen/);
  assert.doesNotMatch(notesOf(outcome), /förslag räknat|160|250|70 °C/, "no temperature from a standard");
  const steps = ok(outcome).steps.join("\n");
  assert.match(steps, /16\smm²: Iz\s60\sA – ström ok, spänningsfall .* ok, kortslutning inte ok/);
});

test("cable sizing: without k or the cable's temperatures the short circuit is not checked and the result asks for them; the company's temperatures fill in", () => {
  const typed = { i: "40", cosphi: "0,9", rated: "50", len: "60", allowed: "3", faultCurrent: { text: "6", unit: "kA" }, faultTime: "0,1" };
  const asked = solve(cableSizingModule, typed);
  assert.equal(ok(asked).rows.some((item) => item.id === "minShort"), false);
  const note = ok(asked).notes.find((item) => /Kortslutningsståligheten kontrolleras inte/.test(item.text));
  assert.equal(note?.tone, "missing");
  assert.equal(cableSizingModule.inputs.some((input) => input.id === "insulation"), false, "no insulation choice with built-in temperatures");
  const company = withCompany(row("kabel.k_temp_fore", null, 75, "Kabelns datablad"), row("kabel.k_temp_slut", null, 155, "Kabelns datablad"));
  const filled = solve(cableSizingModule, typed, {}, company);
  const k = Math.sqrt(((3.45e6 * (234.5 + 20)) / 17.241e-9) * Math.log((234.5 + 155) / (234.5 + 75))) / 1e6;
  near(quantityOf(filled, "minShort"), (6000 * Math.sqrt(0.1)) / k);
  const typedK = solve(cableSizingModule, { ...typed, k: "100" });
  near(quantityOf(typedK, "minShort"), (6000 * Math.sqrt(0.1)) / 100);
});

test("cable sizing: without a table the minimum areas are still given, and the company's table can be picked", () => {
  const without = solve(cableSizingModule, { i: "40", cosphi: "0,9", len: "60", allowed: "3" });
  assert.equal(ok(without).rows.some((item) => item.id === "recommended"), false);
  const minDrop = (SQRT3 * 40 * (RHO20 * 60 * 0.9)) / (0.03 * 400 - SQRT3 * 40 * X * 60 * Math.sqrt(1 - 0.81));
  near(quantityOf(without, "minDrop"), minDrop);
  assert.match(notesOf(without), /Ange kabelns Iz per area/);
  const company = withCompany(
    row(ampacityKey(1, "cu", 10), 10, 35, "Egen tabell"), row(ampacityKey(1, "cu", 16), 16, 48, "Egen tabell"), row(ampacityKey(1, "cu", 25), 25, 63, "Egen tabell"));
  const picked = solve(cableSizingModule, { i: "40", cosphi: "0,9", len: "60", allowed: "3" }, { table: "t1" }, company);
  assert.equal(quantityOf(picked, "recommended"), 16, "48 A covers 40 A and the drop is within 3 %");
  const none = solve(cableSizingModule, { i: "90", len: "60" }, { table: "t1" }, company);
  assert.ok(verdictOf(none, "noneFits"));
});

test("cable sizing: pasted rows are read with comma decimals, odd lines are counted and a repeated area keeps the last", () => {
  const parsed = parseRatings("2,5\t20\n4;27\n\ntext only\n6 mm² 34 A\n4 28");
  assert.deepEqual(parsed.rows, [{ areaMm2: 2.5, izA: 20 }, { areaMm2: 4, izA: 28 }, { areaMm2: 6, izA: 34 }]);
  assert.equal(parsed.skipped, 1);
  assert.equal(parsed.duplicates, 1);
});

test("compensation: 100 kW from cos φ 0,8 to 0,95 needs about 42 kVAr, and the current falls with it", () => {
  const outcome = solve(compensationModule, { p: { text: "100", unit: "kW" }, cosBefore: "0,8", cosAfter: "0,95", u: "400" });
  const qc = 100000 * (0.75 - Math.sqrt(1 - 0.95 ** 2) / 0.95);
  near(quantityOf(outcome, "qc"), qc);
  assert.ok(Math.abs(quantityOf(outcome, "qc") - 42130) < 20);
  near(quantityOf(outcome, "iBefore"), 100000 / 0.8 / (SQRT3 * 400));
  assert.ok(quantityOf(outcome, "iAfter") < quantityOf(outcome, "iBefore"));
});

test("every example fills the fields and gives a result without errors", () => {
  for (const tool of CALC_MODULES.filter((item) => item.id !== "power")) {
    const state = withExample(tool, initialState(tool, plain), plain);
    const outcome = runModule(tool, state, plain);
    assert.equal(outcome.status, "ok", `${tool.id}: ${JSON.stringify(outcome)}`);
  }
  const transformer = runModule(transformerModule, withExample(transformerModule, initialState(transformerModule, plain), plain), plain);
  near(quantityOf(transformer, "i2"), 800000 / (SQRT3 * 400));
});

test("copyright precaution (2026-11-01): without the company's values an empty field is only physics or a neutral default – never a number from a standard", () => {
  // The values a field may stand for on its own: c 1, 20 °C, cos φ 1, the materials' physics at 20 °C; the typical reactance is the one suggestion.
  const allowed: Record<string, number[]> = { c: [1], cMax: [1], cMin: [1], temperature: [20], tempMax: [20], tempMin: [20], cosphi: [1], rho20: [0.01724, 0.02826], alpha: [0.00393, 0.00403] };
  const choiceSets = ["gg", "b", "c", "d", "annan"].flatMap((device) => ["cu", "al"].map((material) => ({ device, material, phases: "3", known: "zs", source: "impedance", sections: "1", table: "own" })));
  for (const tool of CALC_MODULES) {
    for (const input of tool.inputs) {
      if (input.kind !== "number" || !input.fallback) continue;
      for (const choices of choiceSets) {
        // The fields above may hold anything typed: a device's In and time, the cable's temperatures for k.
        const fallback = input.fallback(choices, plain, { rated: 16, time: 0.4 });
        if (!fallback) continue;
        if (/^reactance[23]?$/.test(input.id)) { assert.equal(fallback.origin, "suggestion", `${tool.id}.${input.id}`); continue; }
        assert.equal(fallback.origin, "default", `${tool.id}.${input.id} may not have a built-in value`);
        assert.ok(allowed[input.id]?.includes(fallback.value), `${tool.id}.${input.id} = ${fallback.value}`);
      }
    }
    // What the person reads: the designation of a standard may be named, never its numbers.
    const texts = [...(tool.help ?? []), ...tool.inputs.map((input) => input.help ?? ""), ...tool.inputs.map((input) => input.label), ...Object.values(tool.groups ?? {}).map((group) => `${group.title} ${group.hint ?? ""}`)];
    for (const text of texts) assert.doesNotMatch(text, /× In|gånger märkströmmen|0,95|55 °C|160 °C|250 °C|70 °C/, `${tool.id}: ${text}`);
  }
});

test("the address names the calculator and the part; an unknown one is the list on a phone and the first calculator on a computer", () => {
  assert.equal(calcHref(), "/?view=calculators");
  assert.equal(calcHref("disconnection"), "/?view=calculators&tool=disconnection");
  assert.equal(calcHref("power", "compensation"), "/?view=calculators&tool=power&part=compensation");
  const params = (query: string) => new URLSearchParams(query);
  assert.equal(readSelection(params("")).entry, null);
  assert.equal(readSelection(params("tool=nope")).entry, null);
  assert.equal(readSelection(params("tool=power&part=compensation")).part?.id, "compensation");
  assert.equal(readSelection(params("tool=transformer&part=zzz")).part?.id, "transformer");
  assert.equal(readSelectionOrDefault(params("")).entry.id, "power");
  // Företagets värden as the last row of the phone's list, with a screen of its own.
  assert.equal(calcHref(COMPANY_VALUES_TOOL), "/?view=calculators&tool=company-values");
  assert.equal(companyValuesOpen(params("tool=company-values")), true);
  assert.equal(companyValuesOpen(params("tool=power")), false);
  assert.equal(readSelection(params("tool=company-values")).entry, null, "no calculator is open on that screen");
});

test("the result bar under the fields: short labels, the main figures and the verdict's first words, or why there is none yet", () => {
  assert.equal(dockSummary(solve(disconnectionModule, {})).state, "waiting");
  assert.equal(dockSummary(solve(disconnectionModule, { zs: "0,3,5" }, { device: "c" })).state, "invalid");
  const noTrip = dockSummary(solve(disconnectionModule, { zs: "0,35", rated: "16", time: "0,4" }, { device: "c" }));
  assert.equal(noTrip.state, "waiting", "without Ia the bar waits for it instead of guessing");
  const own = dockSummary(solve(disconnectionModule, { zs: "0,35", rated: "16", time: "0,4", trip: "145" }, { device: "c" }));
  assert.equal(own.state, "ok");
  assert.deepEqual(own.items.map((item) => [item.label, item.tone]), [["Bedömning", "ok"], ["Zs max", "neutral"], ["Ik1", "neutral"]]);
  assert.deepEqual([own.items[0]!.text, own.items[0]!.tone], ["Klarar kravet", "ok"]);
  const transformer = dockSummary(solve(transformerModule, { s: { text: "800", unit: "kVA" }, u1: { text: "10", unit: "kV" }, u2: "400", uk: "5" }));
  assert.deepEqual(transformer.items.map((item) => item.label), ["In HSP", "In LSP"]);
  assert.equal(flat(transformer.items[1]!.text), "1 155 A", "ampere in whole numbers up to 9 999 A");
  const branch = dockSummary(solve(branchLengthModule, { srcZ: { text: "200", unit: "mΩ" }, rated: "16", time: "0,4", trip: "75", area: "2,5" }, { device: "b" }));
  assert.deepEqual(branch.items.map((item) => item.label), ["Max längd", "Zs max"]);
  const shortCircuit = dockSummary(solve(shortCircuitToolModule, { u: "400", srcIk3: { text: "16", unit: "kA" }, len1: "50", area1: "35" }, { source: "ik3" }));
  assert.deepEqual(shortCircuit.items.map((item) => item.label), ["Ik3", "Ik1"]);
  // Spänningsfall: with an allowed percentage the bar shows the percentage and the longest cable; without it the volts and the percentage.
  const limited = dockSummary(solve(voltageDropToolModule, { i: "32", cosphi: "0,9", len: "80", area: "10", allowed: "3" }));
  assert.deepEqual(limited.items.map((item) => item.label), ["Bedömning", "ΔU i %", "Max längd"]);
  const free = dockSummary(solve(voltageDropToolModule, { i: "32", cosphi: "0,9", len: "80", area: "10" }));
  assert.deepEqual(free.items.map((item) => item.label), ["ΔU", "ΔU i %"]);
  for (const tool of CALC_MODULES.filter((item) => item.id !== "power")) {
    const outcome = ok(runModule(tool, withExample(tool, initialState(tool, plain), plain), plain));
    for (const row of outcome.rows) if (row.kind === "quantity" && row.primary) assert.ok(row.short && row.short.length <= 12, `${tool.id}/${row.id} has a short label for the bar`);
  }
});

test("currents read in whole ampere up to 9 999 A and in kA from 10 000 A, in the result and in the bar", () => {
  assert.equal(flat(formatQuantity(1154.7, "current")), "1 155 A");
  assert.equal(flat(formatQuantity(9999, "current")), "9 999 A");
  assert.equal(flat(formatQuantity(10000, "current")), "10 kA");
  assert.equal(flat(formatQuantity(23094, "current")), "23,1 kA");
  const transformer = solve(transformerModule, { s: { text: "800", unit: "kVA" }, u1: { text: "10", unit: "kV" }, u2: "400", uk: "5" });
  assert.match(flat(ok(transformer).steps[1]!), /= 1 155 A\.$/);
  assert.match(flat(ok(transformer).steps[4]!), /= 23,1 kA\.$/);
});

test("Mina skyddsapparater: the panel's rows become keys with In and Ia, a repeated row is refused and a removed row is deleted", () => {
  const model = modelFromValues([]);
  const edited = { ...model, devices: { source: "Egen lista", reference: "2026", rows: [{ type: "c" as const, rated: "16", time: "0,4", trip: "160" }, { type: "gg" as const, rated: "35", time: "5", trip: "190" }] } };
  const saved = saveInputs([], edited);
  assert.ok("inputs" in saved, JSON.stringify(saved));
  const inputs = (saved as { inputs: { key: string; low: number | null; high: number | null; source: string }[] }).inputs;
  assert.deepEqual(inputs.map((input) => [input.key, input.low, input.high, input.source]), [["kabel.ia.c.16.0_4", 16, 160, "Egen lista"], ["kabel.ia.gg.35.5", 35, 190, "Egen lista"]]);
  assert.ok(inputs.every((input) => /^kabel(?:\.[a-z0-9_]{1,24}){1,4}$/.test(input.key) && input.key.length <= 40), "keys are valid company value keys");
  const stored = inputs.map((input, index) => row(input.key, input.low, input.high, input.source) && ({ ...row(input.key, input.low, input.high, input.source), reference: "2026", version: index + 1 }));
  const again = modelFromValues(stored);
  assert.deepEqual(again.devices.rows.map((item) => [item.type, item.rated, item.time, item.trip]), [["gg", "35", "5", "190"], ["c", "16", "0,4", "160"]]);
  assert.equal(again.devices.source, "Egen lista");
  const unchanged = saveInputs(stored, again);
  assert.deepEqual("inputs" in unchanged ? unchanged.inputs : null, [], "nothing changed, nothing is written");
  const dropped = saveInputs(stored, { ...again, devices: { ...again.devices, rows: again.devices.rows.slice(1) } });
  assert.ok("inputs" in dropped);
  const removal = (dropped as { inputs: { key: string; low: number | null; source: string }[] }).inputs;
  assert.deepEqual(removal.map((input) => [input.key, input.low, input.source]), [["kabel.ia.gg.35.5", null, ""]]);
  const twice = saveInputs([], { ...model, devices: { source: "", reference: "", rows: [{ type: "b", rated: "16", time: "0,4", trip: "80" }, { type: "b", rated: "16", time: "0,40", trip: "90" }] } });
  assert.ok("error" in twice && /finns två gånger/.test(twice.error));
  const incomplete = saveInputs([], { ...model, devices: { source: "", reference: "", rows: [{ type: "b", rated: "16", time: "", trip: "80" }] } });
  assert.ok("error" in incomplete && /fyll i märkström, tid och utlösningsström/.test(incomplete.error));
});

test("company data: a device row whose key and In disagree is left out, and the list is ordered by type, In and time", () => {
  const data: CompanyCalcData = companyCalcData([
    row("kabel.ia.c.16.0_4", 16, 160), row("kabel.ia.b.16.0_4", 16, 80), row("kabel.ia.b.10.0_4", 10, 50), row("kabel.ia.d.16.5", 20, 320), row("kabel.ia.zz.16.5", 16, 1),
  ]);
  assert.deepEqual(data.devices.map((device) => `${device.type}${device.ratedA}@${device.timeS}`), ["b10@0.4", "b16@0.4", "c16@0.4"]);
});
