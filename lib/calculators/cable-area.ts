import { ampacityFor, AMPACITY_SLOTS, type AmpacityMaterial, type AmpacityRow, type AmpacityTable } from "./company-data";
import { materialChoiceInput, materialDataInputs, materialOf, MATERIALS, minAreaForDrop, temperatureInput, voltageDrop, type MaterialId } from "./conductor";
import { defineCalculator } from "./define";
import { formatNumber } from "./number";
import type { CalcContext, CalcModule, ComputeArgs, ComputeOutcome, Note, OutputRow } from "./types";
import { areaInput, calculateDrop, COMPANY_VALUES_LINK, dropLimitInput, lengthInput, loadInputs, reactanceInput, voltageGroups } from "./voltage-drop";
import { formatQuantity } from "./units";

/**
 * Kabelarea (Räkneverktyg, 2026-10-07): a chosen cable area checked against the load current and the voltage
 * drop. How much current a cable of an area may carry is the company's own table (Värden och referenser, the
 * `kabel.iz.…` rows): Workflow delivers no table and no limit. Without a value for the area the tool says so and leads
 * to where the company enters it; the voltage drop is checked all the same. A person who has no table of their own can
 * type the current the cable may carry, and a correction factor for temperature, installation and grouping.
 *
 *   Iz med korrektion = Iz × k        utnyttjande = I / (Iz × k)
 *
 * The tool also gives the smallest area the voltage drop limit allows and, when the company's table has the rows, the
 * smallest area in it that carries the current within the limit. It does not check the protective device, the
 * short-circuit withstand or any other requirement.
 */
const GROUPS = {
  ...voltageGroups,
  capacity: { title: "Belastbarhet", hint: "Belastbarheten hämtas ur företagets egen tabell under Värden och referenser. Har företaget ingen tabell kan du skriva belastbarheten själv." },
};

const tableOptions = (ctx: CalcContext) => ctx.company.ampacity.map((table) => ({ value: String(table.slot), label: table.name === `Tabell ${table.slot}` ? table.name : `Tabell ${table.slot} – ${table.name}` }));
const slotOf = (choices: ComputeArgs["choices"]): number | null => {
  const slot = Number(choices.table);
  return Number.isInteger(slot) && slot >= 1 && slot <= AMPACITY_SLOTS ? slot : null;
};
const areaText = (area: number) => formatQuantity(area, "area");
const materialName = (material: MaterialId) => MATERIALS[material].label.toLowerCase();

/** The smallest row of a table that carries the current within the limit (when there is one); the table must have the material. */
export function smallestFittingArea(rows: readonly AmpacityRow[], fits: (row: AmpacityRow) => boolean): AmpacityRow | undefined {
  return [...rows].sort((a, b) => a.area - b.area).find(fits);
}

export const cableAreaModule: CalcModule = defineCalculator({
  id: "cable-area",
  name: "Kabelarea",
  summary: "Kontrollera vald area mot belastningsström och spänningsfall.",
  groups: GROUPS,
  inputs: [
    ...loadInputs(),
    lengthInput(),
    areaInput(),
    materialChoiceInput("cable"),
    temperatureInput("cable"),
    reactanceInput(),
    { kind: "choice", id: "table", label: "Belastbarhetstabell", options: tableOptions, initial: "", display: "select", hideWhenSingle: true, group: "capacity" },
    { kind: "number", id: "ampacity", label: "Belastbarhet Iz", dimension: "current", min: 0, minExclusive: true, group: "capacity", help: "Valfritt. Går före företagets tabell." },
    { kind: "number", id: "correction", label: "Korrektionsfaktor k", dimension: "ratio", min: 0, minExclusive: true, max: 5, group: "capacity", fallback: () => ({ value: 1, origin: "default", note: "faktor 1" }), help: "Samlad faktor för temperatur, förläggning och gruppering enligt företagets uppgifter. Tomt fält: 1." },
    dropLimitInput(),
    ...materialDataInputs(),
  ],
  outputs: [
    { id: "iz", label: "Belastbarhet enligt tabell eller angiven", dimension: "current" },
    { id: "izEffective", label: "Belastbarhet med korrektion", dimension: "current" },
    { id: "utilisation", label: "Utnyttjande av belastbarheten", dimension: "percent" },
    { id: "capacity", label: "Belastbarhet" },
    { id: "dropV", label: "Spänningsfall ΔU", dimension: "voltage" },
    { id: "dropPct", label: "Spänningsfall i procent av märkspänning", dimension: "percent" },
    { id: "loadV", label: "Spänning vid lasten", dimension: "voltage" },
    { id: "resistance", label: "Resistans, en ledare", dimension: "resistance" },
    { id: "reactance", label: "Reaktans, en ledare", dimension: "resistance" },
    { id: "limit", label: "Jämförelse med gränsen" },
    { id: "maxLength", label: "Längd där gränsen nås", dimension: "length" },
    { id: "minAreaDrop", label: "Minsta area för spänningsfallsgränsen", dimension: "area" },
    { id: "minAreaTable", label: "Minsta area i företagets tabell", dimension: "area" },
  ],
  help: [
    "Verktyget kontrollerar en vald area mot belastningsströmmen och mot spänningsfallet.",
    "Hur mycket ström en kabel av en viss area får bära är företagets egen tabell. Ange den under Inställningar → Arbetssätt → Värden och referenser. Workflow levererar ingen tabell och ingen gräns. Saknas värdet för arean visas det, och spänningsfallet kontrolleras ändå.",
    "Har företaget ingen tabell kan du skriva belastbarheten själv, och en korrektionsfaktor för temperatur, förläggning och gruppering.",
    "Verktyget kontrollerar inte skyddets märkström, kortslutningstålighet eller andra krav. Resultatet är ett beräkningsunderlag – bedömningen görs av en behörig person.",
  ],
  compute: (args): ComputeOutcome => {
    const { numbers, origins, choices, company } = args;
    const material: AmpacityMaterial = materialOf(choices);
    const drop = calculateDrop(args);
    const area = numbers.area!;
    const current = numbers.i!;
    const correction = numbers.correction ?? 1;
    const slot = slotOf(choices);
    const rows: OutputRow[] = [];
    const steps: string[] = [];
    const notes: Note[] = [];

    // How much the cable may carry: the person's own figure, else the company's table.
    let amps: number | undefined;
    let basis = "";
    if (numbers.ampacity !== undefined) {
      amps = numbers.ampacity;
      basis = "angiven av dig";
    } else {
      const hit = ampacityFor(company.ampacity, slot, material, area);
      if (hit) {
        amps = hit.amps;
        basis = `företagets ${hit.table.name === `Tabell ${hit.table.slot}` ? hit.table.name.toLowerCase() : `tabell ${hit.table.slot} (${hit.table.name})`}`;
      }
    }
    if (amps !== undefined) {
      const effective = amps * correction;
      const utilisation = (current / effective) * 100;
      const fits = current <= effective;
      rows.push(
        { kind: "quantity", id: "iz", label: "Belastbarhet enligt tabell eller angiven", value: amps, dimension: "current", derived: false, note: basis },
        { kind: "quantity", id: "izEffective", label: "Belastbarhet med korrektion", value: effective, dimension: "current", derived: true, primary: true },
        { kind: "quantity", id: "utilisation", label: "Utnyttjande av belastbarheten", value: utilisation, dimension: "percent", derived: true, tone: fits ? "ok" : "alarm" },
        { kind: "verdict", id: "capacity", label: "Belastbarhet", tone: fits ? "ok" : "alarm",
          text: `Belastningsströmmen ${formatQuantity(current, "current")} är ${fits ? "inte högre än" : "högre än"} belastbarheten ${formatQuantity(effective, "current")} (${formatNumber(utilisation)} %).` });
      steps.push(`Belastbarhet för ${materialName(material)} ${areaText(area)}: ${formatQuantity(amps, "current")} (${basis}).`);
      steps.push(`Med korrektionsfaktor k = ${formatNumber(correction)}${origins.correction === "default" ? " (ingen faktor angiven)" : ""}: Iz = ${formatQuantity(amps, "current")} × ${formatNumber(correction)} = ${formatQuantity(effective, "current")}.`);
      steps.push(`Utnyttjande: I / Iz = ${formatQuantity(current, "current")} / ${formatQuantity(effective, "current")} × 100 = ${formatNumber(utilisation)} %.`);
    } else {
      rows.push({ kind: "verdict", id: "capacity", label: "Belastbarhet", tone: "warn", text: `Ej bedömd – belastbarhet saknas för ${materialName(material)} ${areaText(area)}.` });
      const hasTables = company.ampacity.length > 0;
      notes.push({
        tone: "missing", text: "Ange företagets värde under", link: COMPANY_VALUES_LINK,
        detail: hasTables ? `Företagets tabell har ingen rad för ${materialName(material)} ${areaText(area)}.` : "Företaget har ingen belastbarhetstabell ännu. Du kan också skriva belastbarheten själv i fältet Belastbarhet Iz.",
      });
    }

    // The voltage drop, from the shared calculation.
    rows.push(...drop.rows);
    steps.push(...drop.steps);
    notes.push(...drop.notes);

    // The smallest area the limit allows, and the smallest one in the company's table that carries the current within it.
    const dropInput = drop.input;
    if (drop.limitPct !== undefined) {
      const minimum = minAreaForDrop({ ...dropInput, limitPct: drop.limitPct });
      if (minimum.kind === "area") {
        rows.push({ kind: "quantity", id: "minAreaDrop", label: "Minsta area för spänningsfallsgränsen", value: minimum.areaMm2, dimension: "area", derived: true, primary: true });
        steps.push(`Minsta area för gränsen: A = k × I × L × ρ × cos φ / (gräns × U − k × I × L × x × sin φ) = ${areaText(minimum.areaMm2)}.`);
      } else if (minimum.kind === "impossible") {
        notes.push({ tone: "warn", text: "Reaktansen ensam ger ett spänningsfall över gränsen, så ingen area klarar den med de här värdena." });
      } else {
        notes.push({ tone: "info", text: "Vid cos φ 0 påverkar arean inte spänningsfallet, så ingen minsta area kan anges." });
      }
    }
    const candidates: AmpacityTable[] = slot !== null ? company.ampacity.filter((table) => table.slot === slot) : company.ampacity;
    const table = candidates.find((item) => item[material].length > 0);
    if (table && numbers.ampacity === undefined) {
      const fitting = smallestFittingArea(table[material], (row) => {
        if (row.amps * correction < current) return false;
        if (drop.limitPct === undefined) return true;
        return voltageDrop({ ...dropInput, areaMm2: row.area }).dropPct <= drop.limitPct;
      });
      if (fitting) {
        rows.push({ kind: "quantity", id: "minAreaTable", label: `Minsta area i företagets tabell${candidates.length > 1 ? ` (tabell ${table.slot})` : ""}`, value: fitting.area, dimension: "area", derived: true, primary: true });
        steps.push(`Minsta area i företagets tabell som bär ${formatQuantity(current, "current")}${drop.limitPct !== undefined ? " och håller spänningsfallet inom gränsen" : ""}: ${areaText(fitting.area)} (${formatQuantity(fitting.amps, "current")}${correction !== 1 ? ` × ${formatNumber(correction)}` : ""}).`);
      } else {
        notes.push({ tone: "warn", text: `Ingen area i företagets tabell för ${materialName(material)} klarar strömmen${drop.limitPct !== undefined ? " och spänningsfallsgränsen" : ""}.` });
      }
    }
    notes.push({ tone: "info", text: "Verktyget kontrollerar inte skyddets märkström, kortslutningstålighet eller andra krav." });
    return { status: "ok", rows, steps, notes };
  },
});
