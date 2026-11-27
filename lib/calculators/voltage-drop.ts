import { companyFallback, conductorResistivity, materialChoiceInput, materialDataInputs, MATERIAL_GROUPS, materialOf, maxLengthForDrop, phasesOf, temperatureInput, voltageDrop, MATERIALS, REFERENCE_TEMPERATURE, type MaterialId, type VoltageDropInput, type VoltageDropResult } from "./conductor";
import { defineCalculator } from "./define";
import { formatNumber } from "./number";
import type { CalcInput, CalcModule, Choices, ComputeArgs, Note, Origin, OutputRow } from "./types";
import { formatQuantity } from "./units";

/**
 * Spänningsfall (Räkneverktyg, 2026-10-07): the voltage drop along a cable with its reactance, in volts and as
 * a percentage of the nominal voltage, and a comparison with a limit. The limit is entered by the person or taken
 * from the company's own values; Workflow gives none.
 *
 *   ΔU = k × I × (R × cos φ + X × sin φ)     R = ρ × L / A     X = x × L     k = √3 (three phases) or 2 (one phase)
 *
 * The formula takes the voltage drop along the cable as the part of the voltage phasor in line with the supply, which
 * is the usual first-order calculation; it does not follow the change of the angle between the voltages.
 */
export const voltageGroups = {
  load: { title: "Last och nät" },
  cable: { title: "Kabel" },
  limit: { title: "Jämförelse", hint: "Gränsen anger du själv eller hämtar från företagets värden. Workflow anger ingen gräns." },
  ...MATERIAL_GROUPS,
};

const nominal = (choices: Choices) => (choices.phases === "1" ? "230" : "400");

/** The inputs that describe the supply and the load; the cable area tool uses them too. */
export function loadInputs(): CalcInput[] {
  return [
    { kind: "choice", id: "phases", label: "System", options: [{ value: "3", label: "Trefas" }, { value: "1", label: "Enfas" }], initial: "3", display: "segmented", group: "load" },
    { kind: "number", id: "u", label: "Märkspänning U", dimension: "voltage", initial: nominal, min: 0, minExclusive: true, usual: [12, 40000], group: "load", help: "Huvudspänning vid trefas, fasspänning vid enfas." },
    { kind: "number", id: "i", label: "Belastningsström I", dimension: "current", required: true, min: 0, minExclusive: true, usual: [0.01, 50000], group: "load" },
    { kind: "number", id: "cosphi", label: "Effektfaktor cos φ", dimension: "ratio", initial: "1", min: 0, max: 1, group: "load", fallback: () => ({ value: 1, origin: "default", note: "cos φ 1" }), help: "Mellan 0 och 1. 1 är en rent resistiv last." },
  ];
}
export const lengthInput = (): CalcInput => ({ kind: "number", id: "length", label: "Kabellängd (enkel väg)", dimension: "length", required: true, min: 0, minExclusive: true, usual: [0.1, 20000], group: "cable" });
export const areaInput = (): CalcInput => ({ kind: "number", id: "area", label: "Area", dimension: "area", required: true, min: 0, minExclusive: true, usual: [0.5, 1500], group: "cable" });
export const reactanceInput = (): CalcInput => ({
  kind: "number", id: "reactance", label: "Reaktans per längd", dimension: "perLength", min: 0, group: "cable",
  fallback: (_choices, ctx) => companyFallback(ctx.company.reactancePerM) ?? { value: 0, origin: "default", note: "ingen reaktans angiven" },
  help: "Tomt fält: företagets värde under Värden och referenser, annars 0.",
});
export const dropLimitInput = (): CalcInput => ({
  kind: "number", id: "limit", label: "Gräns för spänningsfall", dimension: "percent", min: 0, minExclusive: true, max: 100, group: "limit",
  fallback: (_choices, ctx) => companyFallback(ctx.company.dropLimitPct),
  help: "Procent av märkspänningen. Tomt fält: företagets värde, annars ingen jämförelse.",
});

const ORIGIN_TEXT: Record<Origin, string> = { user: "", company: "företagets värde", suggestion: "förslag", default: "" };
/** "förslag" – where a number came from, when it is not simply what the person typed (or a neutral default). */
export const originWord = (origin: Origin | undefined) => (origin ? ORIGIN_TEXT[origin] : "");
/** " (förslag)" for the end of a sentence. */
export const originSuffix = (origin: Origin | undefined) => (originWord(origin) ? ` (${originWord(origin)})` : "");

export const COMPANY_VALUES_LINK = { label: "Värden och referenser", view: "company_values" } as const;
const MISSING_REACTANCE: Note = { tone: "info", text: "Ingen reaktans är angiven, så bara resistansen räknas. Ange reaktansen för ett mer rättvisande resultat, eller företagets värde under", link: COMPANY_VALUES_LINK };
export const NO_LIMIT: Note = { tone: "info", text: "Ingen gräns är angiven, så ingen jämförelse görs. Ange en gräns i fältet, eller företagets värde under", link: COMPANY_VALUES_LINK };

/** Lines describing how the resistivity at the conductor temperature came about. */
export function resistivitySteps(numbers: ComputeArgs["numbers"], origins: ComputeArgs["origins"], material: MaterialId, temperatureId = "temperature"): { steps: string[]; rho: number } {
  const resistivity = conductorResistivity(numbers, temperatureId);
  const name = MATERIALS[material].label.toLowerCase();
  const steps = [`Resistivitet för ${name} vid ${REFERENCE_TEMPERATURE} °C: ρ20 = ${formatNumber(resistivity.rho20)} Ω·mm²/m${originSuffix(origins.rho20)}.`];
  if (resistivity.celsius !== REFERENCE_TEMPERATURE) {
    steps.push(`Vid ${formatNumber(resistivity.celsius)} °C: ρ = ρ20 × (1 + α × (θ − ${REFERENCE_TEMPERATURE})) = ${formatNumber(resistivity.rho20)} × (1 + ${formatNumber(resistivity.alpha)} × (${formatNumber(resistivity.celsius)} − ${REFERENCE_TEMPERATURE})) = ${formatNumber(resistivity.rho)} Ω·mm²/m (α = ${formatNumber(resistivity.alpha)} per grad${originSuffix(origins.alpha)}).`);
  }
  return { steps, rho: resistivity.rho };
}

export type DropCalculation = { input: VoltageDropInput; result: VoltageDropResult; steps: string[]; notes: Note[]; rows: OutputRow[]; limitPct: number | undefined; maxLengthM: number | null };

/** The voltage drop of a run of cable from the module's numbers, as rows, notes and the way it was calculated. */
export function calculateDrop({ numbers, origins, choices }: Pick<ComputeArgs, "numbers" | "origins" | "choices">): DropCalculation {
  const phases = phasesOf(choices);
  const { steps: materialSteps, rho } = resistivitySteps(numbers, origins, materialOf(choices));
  const input: VoltageDropInput = { phases, lengthM: numbers.length!, currentA: numbers.i!, areaMm2: numbers.area!, rho, reactancePerM: numbers.reactance ?? 0, cosPhi: numbers.cosphi ?? 1, voltageV: numbers.u! };
  const result = voltageDrop(input);
  const k = phases === 3 ? "√3" : "2";
  const milliohm = (value: number) => formatQuantity(value, "resistance", { unit: "mΩ" });
  const steps = [...materialSteps,
    `Resistans för en ledare: R = ρ × L / A = ${formatNumber(rho)} Ω·mm²/m × ${formatQuantity(input.lengthM, "length")} / ${formatQuantity(input.areaMm2, "area")} = ${milliohm(result.resistance)}.`,
    `Reaktans för en ledare: X = x × L = ${formatQuantity(input.reactancePerM, "perLength")} × ${formatQuantity(input.lengthM, "length")} = ${milliohm(result.reactance)}${originSuffix(origins.reactance)}.`,
    `Spänningsfall: ΔU = k × I × (R × cos φ + X × sin φ) = ${k} × ${formatQuantity(input.currentA, "current")} × (${milliohm(result.resistance)} × ${formatNumber(input.cosPhi)} + ${milliohm(result.reactance)} × ${formatNumber(result.sinPhi)}) = ${formatQuantity(result.dropV, "voltage")}. Faktorn k är √3 vid trefas och 2 vid enfas (ut och tillbaka).`,
    `I procent av märkspänningen: ΔU / U × 100 = ${formatQuantity(result.dropV, "voltage")} / ${formatQuantity(input.voltageV, "voltage")} × 100 = ${formatNumber(result.dropPct)} %.`,
    `Spänning vid lasten: U − ΔU = ${formatQuantity(input.voltageV, "voltage")} − ${formatQuantity(result.dropV, "voltage")} = ${formatQuantity(result.loadV, "voltage")}.`,
  ];
  const notes: Note[] = [];
  if (origins.reactance === "default") notes.push(MISSING_REACTANCE);
  if (result.dropPct >= 100) notes.push({ tone: "warn", text: "Spänningsfallet är lika stort som märkspänningen eller större. Kontrollera längd, area och ström." });
  const limitPct = numbers.limit;
  const rows: OutputRow[] = [
    { kind: "quantity", id: "dropV", label: "Spänningsfall ΔU", value: result.dropV, dimension: "voltage", derived: true, primary: true },
    { kind: "quantity", id: "dropPct", label: "Spänningsfall i procent av märkspänning", value: result.dropPct, dimension: "percent", derived: true, primary: true },
    { kind: "quantity", id: "loadV", label: "Spänning vid lasten", value: result.loadV, dimension: "voltage", derived: true },
    { kind: "quantity", id: "resistance", label: "Resistans, en ledare", value: result.resistance, dimension: "resistance", unit: "mΩ", derived: true },
    { kind: "quantity", id: "reactance", label: "Reaktans, en ledare", value: result.reactance, dimension: "resistance", unit: "mΩ", derived: true },
  ];
  let maxLengthM: number | null = null;
  if (limitPct !== undefined) {
    const over = result.dropPct > limitPct;
    rows.push({ kind: "verdict", id: "limit", label: "Jämförelse med gränsen", tone: over ? "alarm" : "ok",
      text: `${over ? "Över" : "Under"} angiven gräns: ${formatNumber(result.dropPct)} % mot ${formatNumber(limitPct)} %${originSuffix(origins.limit)}.` });
    maxLengthM = maxLengthForDrop({ ...input, limitPct });
    if (maxLengthM !== null) {
      rows.push({ kind: "quantity", id: "maxLength", label: "Längd där gränsen nås", value: maxLengthM, dimension: "length", derived: true });
      steps.push(`Längd där gränsen nås: L = gräns × U / (k × I × (r × cos φ + x × sin φ)) = ${formatQuantity(maxLengthM, "length")} (samma kabel, samma ström).`);
    }
  } else {
    notes.push(NO_LIMIT);
  }
  return { input, result, steps, notes, rows, limitPct, maxLengthM };
}

export const voltageDropModule: CalcModule = defineCalculator({
  id: "voltage-drop",
  name: "Spänningsfall",
  summary: "Spänningsfall med reaktans och jämförelse med en gräns.",
  groups: voltageGroups,
  inputs: [
    ...loadInputs(),
    lengthInput(),
    areaInput(),
    materialChoiceInput("cable"),
    temperatureInput("cable"),
    reactanceInput(),
    dropLimitInput(),
    ...materialDataInputs(),
  ],
  outputs: [
    { id: "dropV", label: "Spänningsfall ΔU", dimension: "voltage" },
    { id: "dropPct", label: "Spänningsfall i procent av märkspänning", dimension: "percent" },
    { id: "loadV", label: "Spänning vid lasten", dimension: "voltage" },
    { id: "resistance", label: "Resistans, en ledare", dimension: "resistance" },
    { id: "reactance", label: "Reaktans, en ledare", dimension: "resistance" },
    { id: "limit", label: "Jämförelse med gränsen" },
    { id: "maxLength", label: "Längd där gränsen nås", dimension: "length" },
  ],
  help: [
    "Spänningsfallet räknas som ΔU = k × I × (R × cos φ + X × sin φ). Faktorn k är √3 vid trefas och 2 vid enfas, R är ledarens resistans och X dess reaktans över hela längden.",
    "Resistansen räknas från materialets resistivitet och ledarens temperatur. Resistiviteten är det fysikaliska värdet för koppar och aluminium vid 20 °C, som du kan ändra under Materialdata.",
    "Reaktansen anger du själv eller hämtar från företagets värden. Utan reaktans räknas bara resistansen.",
    "Gränsen anger du själv eller hämtar från företagets värden. Workflow anger ingen gräns, och resultatet är ett beräkningsunderlag – bedömningen görs av en behörig person.",
  ],
  compute: (args) => {
    const calculation = calculateDrop(args);
    return { status: "ok", rows: calculation.rows, steps: calculation.steps, notes: calculation.notes };
  },
});
