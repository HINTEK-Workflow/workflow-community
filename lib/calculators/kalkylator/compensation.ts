import { compensationReactivePower } from "../engine";
import { defineCalculator } from "../define";
import { formatNumber } from "../number";
import type { CalcModule, OutputRow } from "../types";
import { formatQuantity } from "../units";
import { failure, quantity, warningNotes } from "./shared";

/**
 * Kompensering (Kalkylator, 2026-10-12), a part of "Effekt och ström": the reactive power a capacitor bank has to
 * give to take a load from one power factor to another, Qc = P · (tan φ1 − tan φ2). With a voltage the apparent power and
 * the current before and after are given as well. The engine (`compensationReactivePower`) does the calculation.
 */
export const compensationModule: CalcModule = defineCalculator({
  id: "compensation",
  name: "Kompensering",
  summary: "Reaktiv effekt som behövs för att nå önskad cos φ.",
  groups: { load: { title: "Lasten" }, target: { title: "Önskad effektfaktor" } },
  inputs: [
    { kind: "number", id: "p", label: "Aktiv effekt P", dimension: "power", defaultUnit: "kW", required: true, min: 0, minExclusive: true, group: "load", example: "100" },
    { kind: "number", id: "cosBefore", label: "Nuvarande cos φ", dimension: "ratio", required: true, min: 0, minExclusive: true, max: 1, group: "load", example: "0,8" },
    { kind: "number", id: "cosAfter", label: "Önskad cos φ", dimension: "ratio", required: true, min: 0, minExclusive: true, max: 1, group: "target", example: "0,95" },
    { kind: "choice", id: "phases", label: "System (för strömmen)", options: [{ value: "3", label: "Trefas" }, { value: "1", label: "Enfas" }], initial: "3", display: "segmented", group: "target" },
    { kind: "number", id: "u", label: "Spänning U", dimension: "voltage", min: 0, minExclusive: true, usual: [12, 40000], group: "target", example: "400", help: "Valfritt. Med spänning visas också strömmen före och efter. Huvudspänning vid trefas." },
  ],
  outputs: [
    { id: "qc", label: "Kondensatoreffekt Qc", dimension: "reactivePower" }, { id: "qBefore", label: "Reaktiv effekt före", dimension: "reactivePower" },
    { id: "qAfter", label: "Reaktiv effekt efter", dimension: "reactivePower" },
  ],
  example: { numbers: { p: { text: "100", unit: "kW" }, cosBefore: { text: "0,8" }, cosAfter: { text: "0,95" }, u: { text: "400", unit: "V" } }, choices: { phases: "3" } },
  help: [
    "Fyll i lastens aktiva effekt, nuvarande cos φ och önskad cos φ. Kondensatoreffekten Qc = P × (tan φ1 − tan φ2) visas direkt.",
    "Fyll i spänningen om du vill se strömmen före och efter kompenseringen.",
  ],
  compute: ({ numbers, choices }) => {
    const result = compensationReactivePower(numbers.p!, numbers.cosBefore!, numbers.cosAfter!);
    if (!result.ok) return failure(result.errors, { power: "p", cosPhiBefore: "cosBefore", cosPhiAfter: "cosAfter" });
    const p = numbers.p!;
    const sBefore = p / numbers.cosBefore!;
    const sAfter = p / numbers.cosAfter!;
    const rows: OutputRow[] = [
      quantity("qc", "Kondensatoreffekt Qc", Math.max(0, result.capacitorVar), "reactivePower", { primary: true, short: "Qc" }),
      quantity("qBefore", "Reaktiv effekt före", result.before, "reactivePower"),
      quantity("qAfter", "Reaktiv effekt efter", result.after, "reactivePower"),
      quantity("sBefore", "Skenbar effekt före", sBefore, "apparentPower"),
      quantity("sAfter", "Skenbar effekt efter", sAfter, "apparentPower"),
    ];
    const steps = [
      `Reaktiv effekt före: Q1 = P × tan φ1 = ${formatQuantity(p, "power")} × ${formatNumber(Math.sqrt(1 - numbers.cosBefore! ** 2) / numbers.cosBefore!)} = ${formatQuantity(result.before, "reactivePower")}.`,
      `Reaktiv effekt efter: Q2 = P × tan φ2 = ${formatQuantity(p, "power")} × ${formatNumber(Math.sqrt(1 - numbers.cosAfter! ** 2) / numbers.cosAfter!)} = ${formatQuantity(result.after, "reactivePower")}.`,
      `Kondensatoreffekt: Qc = Q1 − Q2 = ${formatQuantity(result.capacitorVar, "reactivePower")}.`,
    ];
    if (numbers.u !== undefined) {
      const k = choices.phases === "1" ? 1 : Math.sqrt(3);
      const before = sBefore / (k * numbers.u);
      const after = sAfter / (k * numbers.u);
      rows.push(quantity("iBefore", "Ström före", before, "current"), quantity("iAfter", "Ström efter", after, "current"));
      steps.push(`Ström: I = S / (${k === 1 ? "" : "√3 × "}U) ger ${formatQuantity(before, "current")} före och ${formatQuantity(after, "current")} efter.`);
    }
    return { status: "ok", rows, steps, notes: warningNotes(result.warnings) };
  },
});
