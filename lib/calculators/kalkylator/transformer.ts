import { gridShortCircuitVA, transformer, transformerShortCircuit, type GridSource } from "../engine";
import { defineCalculator } from "../define";
import { formatNumber } from "../number";
import type { CalcModule } from "../types";
import { formatQuantity } from "../units";
import { cFactorInput, failure, quantity, warningNotes } from "./shared";

/**
 * Transformator (Kalkylator, 2026-10-12): rated currents on the high-voltage (HSP) and low-voltage (LSP) side,
 * the short-circuit impedance Zk and the three-phase short-circuit current on the LSP side, without and with the grid
 * in front of the transformer. The calculation is the engine's (`transformerShortCircuit`):
 *
 *   I = S / (√3·U)     Zk = uk/100 · U² / S     Ik3 = c·U2 / (√3·Zk)
 *
 * With the load loss Pk the resistance is Rk = Pk / (3·I²) and Zk is split into R and X; without it the transformer is
 * pure reactance, as the engine says. The grid is given by its short-circuit power or its Ik3 on the HSP side.
 */
export const transformerModule: CalcModule = defineCalculator({
  id: "transformer",
  name: "Transformator",
  summary: "Märkströmmar, Zk och kortslutningsström på LSP-sidan.",
  groups: {
    rating: { title: "Transformatorn", hint: "Ur märkskylten." },
    losses: { title: "Förluster (valfritt)", hint: "Med belastningsförlusten delas Zk i resistans och reaktans.", collapsed: true },
    grid: { title: "Nätet framför transformatorn", hint: "Utan nät räknas matningen som oändligt stark, vilket ger den högsta strömmen." },
    conditions: { title: "Beräkningsvillkor", collapsed: true },
  },
  inputs: [
    { kind: "number", id: "s", label: "Märkeffekt S", dimension: "apparentPower", defaultUnit: "kVA", required: true, min: 0, minExclusive: true, usual: [1000, 1e9], group: "rating", example: "800" },
    { kind: "number", id: "u1", label: "Märkspänning HSP (U1)", dimension: "voltage", defaultUnit: "kV", required: true, min: 0, minExclusive: true, usual: [12, 400000], group: "rating", example: "10", help: "Huvudspänning, primärsidan." },
    { kind: "number", id: "u2", label: "Märkspänning LSP (U2)", dimension: "voltage", defaultUnit: "V", required: true, min: 0, minExclusive: true, usual: [12, 40000], group: "rating", example: "400", help: "Huvudspänning, sekundärsidan." },
    { kind: "number", id: "uk", label: "Kortslutningsspänning uk", dimension: "percent", required: true, min: 0, minExclusive: true, max: 100, group: "rating", example: "5" },
    { kind: "number", id: "pk", label: "Belastningsförlust Pk", dimension: "power", defaultUnit: "kW", min: 0, group: "losses", example: "9", help: "Vid märkström. Tomt fält: ren reaktans." },
    { kind: "number", id: "p0", label: "Tomgångsförlust P0", dimension: "power", defaultUnit: "W", min: 0, group: "losses", example: "1300", help: "Med båda förlusterna visas totalförlust och verkningsgrad." },
    { kind: "choice", id: "grid", label: "Nätet anges som", options: [{ value: "none", label: "Utan nät" }, { value: "power", label: "Kortslutningseffekt" }, { value: "current", label: "Ik3 på HSP" }], initial: "none", display: "segmented", group: "grid" },
    { kind: "number", id: "gridS", label: "Nätets kortslutningseffekt", dimension: "apparentPower", defaultUnit: "MVA", required: true, min: 0, minExclusive: true, group: "grid", showIf: (choices) => choices.grid === "power", example: "250" },
    { kind: "number", id: "gridI", label: "Nätets Ik3 på HSP", dimension: "current", defaultUnit: "kA", required: true, min: 0, minExclusive: true, group: "grid", showIf: (choices) => choices.grid === "current", example: "14" },
    cFactorInput("c", "Spänningsfaktor c", "largest", "conditions"),
  ],
  outputs: [
    { id: "i1", label: "Märkström HSP", dimension: "current" }, { id: "i2", label: "Märkström LSP", dimension: "current" },
    { id: "ik3", label: "Ik3 på LSP utan nät", dimension: "current" }, { id: "ik3Grid", label: "Ik3 på LSP med nät", dimension: "current" },
    { id: "zk", label: "Zk sedd från LSP", dimension: "resistance" },
  ],
  example: { numbers: { s: { text: "800", unit: "kVA" }, u1: { text: "10", unit: "kV" }, u2: { text: "400", unit: "V" }, uk: { text: "5" } } },
  help: [
    "Fyll i märkeffekt, de två märkspänningarna och uk ur märkskylten. Märkströmmarna och kortslutningsströmmen visas direkt.",
    "Ik3 utan nät antar att nätet framför transformatorn är oändligt starkt. Anger du nätets kortslutningseffekt eller dess Ik3 på HSP-sidan räknas nätets impedans med, och strömmen blir lägre.",
    "Utan belastningsförlust räknas transformatorn som ren reaktans. Med förlusten delas Zk i resistans och reaktans.",
    "Spänningsfaktorn c är ett förslag (1,0 för största ström) som du kan ändra. Resultatet är ett beräkningsunderlag.",
  ],
  compute: ({ numbers, origins, choices }) => {
    let grid: GridSource | undefined;
    if (choices.grid === "power" && numbers.gridS !== undefined) grid = { kind: "power", shortCircuitVA: numbers.gridS };
    if (choices.grid === "current" && numbers.gridI !== undefined) grid = { kind: "current", ik3A: numbers.gridI, voltageV: numbers.u1! };
    const spec = { ratedVA: numbers.s!, primaryVoltageV: numbers.u1!, secondaryVoltageV: numbers.u2!, ukPercent: numbers.uk!, loadLossW: numbers.pk, noLoadLossW: numbers.p0 };
    const fields = { uk: "uk", rated: "s", primaryVoltage: "u1", secondaryVoltage: "u2", loadLoss: "pk", noLoadLoss: "p0", c: "c" };
    const t = transformer(spec);
    if (!t.ok) return failure(t.errors, fields);
    const result = transformerShortCircuit({ transformer: spec, grid, c: numbers.c });
    if (!result.ok) return failure(result.errors, fields);
    const withGrid = result.ik3WithGridA;
    const rows = [
      quantity("i1", "Märkström HSP", t.primaryCurrentA, "current", { primary: true, short: "In HSP" }),
      quantity("i2", "Märkström LSP", t.secondaryCurrentA, "current", { primary: true, short: "In LSP" }),
      quantity("ik3", "Ik3 på LSP-sidan, utan nät", result.ik3WithoutGridA, "current", { primary: withGrid === null, short: "Ik3 LSP" }),
      ...(withGrid !== null ? [quantity("ik3Grid", "Ik3 på LSP-sidan, med nät", withGrid, "current", { primary: true, short: "Ik3 med nät" })] : []),
      quantity("zk", "Zk sedd från LSP", t.zkSecondaryOhm, "resistance"),
      quantity("zkHsp", "Zk sedd från HSP", t.zkPrimaryOhm, "resistance"),
      ...(t.resistanceKnown ? [quantity("rk", "Rk, resistans sedd från LSP", t.secondary.r, "resistance", { unit: "mΩ" }), quantity("xk", "Xk, reaktans sedd från LSP", t.secondary.x, "resistance", { unit: "mΩ" })] : []),
      ...(t.urPercent !== null ? [quantity("ur", "Resistiv del ur", t.urPercent, "percent"), quantity("ux", "Reaktiv del ux", t.uxPercent ?? 0, "percent")] : []),
      quantity("sk", "Transformatorns kortslutningseffekt Sk", t.shortCircuitVA, "apparentPower"),
      quantity("ik2", "Ik2 på LSP-sidan, utan nät", result.ik2WithoutGridA, "current"),
      ...(result.ik2WithGridA !== null ? [quantity("ik2Grid", "Ik2 på LSP-sidan, med nät", result.ik2WithGridA, "current")] : []),
      ...(t.totalLossW !== null ? [quantity("loss", "Totalförlust vid märklast", t.totalLossW, "power"), quantity("eta", "Verkningsgrad vid märklast och cos φ 1", (t.efficiencyAtUnity ?? 0) * 100, "percent")] : []),
    ];
    const u1 = formatQuantity(numbers.u1!, "voltage");
    const u2 = formatQuantity(numbers.u2!, "voltage");
    const s = formatQuantity(numbers.s!, "apparentPower");
    const steps = [
      `Märkström HSP: I1 = S / (√3 × U1) = ${s} / (√3 × ${u1}) = ${formatQuantity(t.primaryCurrentA, "current")}.`,
      `Märkström LSP: I2 = S / (√3 × U2) = ${s} / (√3 × ${u2}) = ${formatQuantity(t.secondaryCurrentA, "current")}.`,
      `Transformatorns kortslutningseffekt: Sk = S / (uk / 100) = ${s} / (${formatNumber(numbers.uk!)} / 100) = ${formatQuantity(t.shortCircuitVA, "apparentPower")}.`,
      `Impedans sedd från LSP: Zk = uk / 100 × U2² / S = ${formatNumber(numbers.uk!)} / 100 × (${u2})² / ${s} = ${formatQuantity(t.zkSecondaryOhm, "resistance")}.`,
      `Ik3 utan nät: c × U2 / (√3 × Zk) = ${formatNumber(result.c)} × ${u2} / (√3 × ${formatQuantity(t.zkSecondaryOhm, "resistance")}) = ${formatQuantity(result.ik3WithoutGridA, "current")}.`,
    ];
    if (t.resistanceKnown) steps.push(`Med belastningsförlusten: Rk = Pk / (3 × I2²) = ${formatQuantity(t.secondary.r, "resistance")}, Xk = √(Zk² − Rk²) = ${formatQuantity(t.secondary.x, "resistance")}.`);
    if (grid && result.gridSecondaryOhm !== null && withGrid !== null) {
      steps.push(`Nätets impedans sedd från LSP: Zn = U2² / Sn = (${u2})² / ${formatQuantity(gridShortCircuitVA(grid), "apparentPower")} = ${formatQuantity(result.gridSecondaryOhm, "resistance")}.`,
        `Ik3 med nät: c × U2 / (√3 × |Zk + Zn|) = ${formatQuantity(withGrid, "current")}. Nätet räknas som ren reaktans.`);
    }
    return { status: "ok", rows, steps, notes: [...warningNotes(result.warnings), ...(origins.c === "suggestion" ? [{ tone: "info" as const, text: "Spänningsfaktorn c är ett förslag. Ändra den under Beräkningsvillkor." }] : [])] };
  },
});
