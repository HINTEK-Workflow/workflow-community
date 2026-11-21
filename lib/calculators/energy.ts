import { defineCalculator } from "./define";
import { formatNumber } from "./number";
import type { CalcModule, Note, OutputRow } from "./types";
import { formatQuantity } from "./units";

/**
 * Energikostnad (Räkneverktyg, 2026-10-07; moved here from the older calculator under Hjälp): the energy a load
 * uses over a number of days and, when a price is given, what it costs. Workflow gives no price: it is the person's.
 *
 *   energi = effekt × timmar per dag × antal dagar     kostnad = energi × elpris
 */
export type EnergyResult = { kwh: number; cost: number | undefined };

/** Energy in kWh from a power in watts; the cost when a price per kWh is given. */
export function energyCost(input: { powerW: number; hoursPerDay: number; days: number; pricePerKwh?: number }): EnergyResult {
  const kwh = (input.powerW / 1000) * input.hoursPerDay * input.days;
  return { kwh, cost: input.pricePerKwh === undefined ? undefined : kwh * input.pricePerKwh };
}

export const energyModule: CalcModule = defineCalculator({
  id: "energy",
  name: "Energikostnad",
  summary: "Energi och kostnad för en last över tid.",
  inputs: [
    { kind: "number", id: "p", label: "Effekt", dimension: "power", defaultUnit: "kW", required: true, min: 0 },
    { kind: "number", id: "hours", label: "Timmar per dag", dimension: "hoursPerDay", required: true, min: 0, max: 24 },
    { kind: "number", id: "days", label: "Antal dagar", dimension: "days", initial: "30", required: true, min: 0 },
    { kind: "number", id: "price", label: "Elpris", dimension: "energyPrice", min: 0, help: "Valfritt: ditt eget pris per kWh." },
  ],
  outputs: [{ id: "energy", label: "Energi", dimension: "energy" }, { id: "cost", label: "Kostnad", dimension: "money" }],
  help: ["Energin är effekt gånger timmar per dag gånger antal dagar. Ange ett elpris för att få kostnaden – priset är ditt eget, verktyget föreslår inget."],
  compute: ({ numbers }) => {
    const result = energyCost({ powerW: numbers.p!, hoursPerDay: numbers.hours!, days: numbers.days!, pricePerKwh: numbers.price });
    const rows: OutputRow[] = [{ kind: "quantity", id: "energy", label: "Energi", value: result.kwh, dimension: "energy", derived: true, primary: true }];
    const steps = [`Energi = effekt × timmar per dag × antal dagar = ${formatQuantity(numbers.p!, "power")} × ${formatNumber(numbers.hours!)} h/dag × ${formatNumber(numbers.days!)} dagar = ${formatQuantity(result.kwh, "energy")}.`];
    const notes: Note[] = [];
    if (result.cost !== undefined) {
      rows.push({ kind: "quantity", id: "cost", label: "Kostnad", value: result.cost, dimension: "money", derived: true, primary: true });
      steps.push(`Kostnad = energi × elpris = ${formatQuantity(result.kwh, "energy")} × ${formatNumber(numbers.price!)} kr/kWh = ${formatNumber(result.cost)} kr.`);
    } else notes.push({ tone: "info", text: "Ange ett elpris för att få kostnaden." });
    return { status: "ok", rows, steps, notes };
  },
});
