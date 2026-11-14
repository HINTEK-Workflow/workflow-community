import type { CompanyCalcData, Sourced } from "./company-data";
import type { CalcInput, CalcContext, Choices, Fallback, GroupInfo } from "./types";

/**
 * What the cable tools share (Räkneverktyg, 2026-10-07): the conductor material, the resistance of a run of
 * cable and the voltage drop along it.
 *
 * The material constants are constants of nature (2026-11-01): the resistivity at 20 °C – annealed copper at
 * 100 % IACS (1/58 Ω·mm²/m) and aluminium at 61 % IACS – and its change with the temperature. The person may overwrite
 * both, and a cable's own resistance per km from its datasheet goes before them (`resistancePerKmInput`). Nothing here
 * comes from a standard, and no limit or table of any kind lives in this file – those are the company's own values.
 */
export type Phases = 1 | 3;
export type MaterialId = "cu" | "al";

export const MATERIALS: Record<MaterialId, { label: string; /** Ω·mm²/m at 20 °C */ rho20: number; /** per kelvin */ alpha: number }> = {
  cu: { label: "Koppar", rho20: 0.01724, alpha: 0.00393 },
  al: { label: "Aluminium", rho20: 0.02826, alpha: 0.00403 },
};
export const REFERENCE_TEMPERATURE = 20;
const SQRT3 = Math.sqrt(3);

/** Resistivity at a temperature: ρ = ρ20 × (1 + α × (θ − 20)). */
export const resistivityAt = (rho20: number, alpha: number, celsius: number) => rho20 * (1 + alpha * (celsius - REFERENCE_TEMPERATURE));
/** The factor on the current: √3 for a three-phase supply (line-to-line drop), 2 for single phase (out and back). */
export const phaseFactor = (phases: Phases) => (phases === 3 ? SQRT3 : 2);
export const phasesOf = (choices: Choices): Phases => (choices.phases === "1" ? 1 : 3);
export const materialOf = (choices: Choices): MaterialId => (choices.material === "al" ? "al" : "cu");
/** The company's cable type chosen in a field (KA4, 2026-11-01); undefined when the person gives the values themselves. */
export const chosenCableType = (choices: Choices, company: CompanyCalcData, typeId = "cableType") => company.cableTypes.find((type) => type.id === choices[typeId]);
/** The material a conductor is calculated with: its cable type's, otherwise the person's choice. */
export const effectiveMaterial = (choices: Choices, company: CompanyCalcData, materialId = "material", typeId = "cableType"): MaterialId =>
  chosenCableType(choices, company, typeId)?.material ?? (choices[materialId] === "al" ? "al" : "cu");

export type VoltageDropInput = {
  phases: Phases;
  lengthM: number;
  currentA: number;
  areaMm2: number;
  /** Ω·mm²/m at the conductor's temperature. */
  rho: number;
  /** Ω/m */
  reactancePerM: number;
  cosPhi: number;
  voltageV: number;
};
export type VoltageDropResult = {
  factor: number;
  /** One conductor, the whole length, Ω. */
  resistance: number;
  reactance: number;
  sinPhi: number;
  dropV: number;
  dropPct: number;
  loadV: number;
};

/** ΔU = k × I × (R × cos φ + X × sin φ), with R = ρ × L / A and X = x × L; as a percentage of the nominal voltage. */
export function voltageDrop(input: VoltageDropInput): VoltageDropResult {
  const factor = phaseFactor(input.phases);
  const resistance = (input.rho * input.lengthM) / input.areaMm2;
  const reactance = input.reactancePerM * input.lengthM;
  const sinPhi = Math.sqrt(Math.max(0, 1 - input.cosPhi * input.cosPhi));
  const dropV = factor * input.currentA * (resistance * input.cosPhi + reactance * sinPhi);
  return { factor, resistance, reactance, sinPhi, dropV, dropPct: (dropV / input.voltageV) * 100, loadV: input.voltageV - dropV };
}

/** How long the run can be before the drop reaches the limit; null when nothing drops (no current). */
export function maxLengthForDrop(input: Omit<VoltageDropInput, "lengthM"> & { limitPct: number }): number | null {
  const sinPhi = Math.sqrt(Math.max(0, 1 - input.cosPhi * input.cosPhi));
  const perMetre = phaseFactor(input.phases) * input.currentA * ((input.rho / input.areaMm2) * input.cosPhi + input.reactancePerM * sinPhi);
  return perMetre > 0 ? ((input.limitPct / 100) * input.voltageV) / perMetre : null;
}

export type MinArea = { kind: "area"; areaMm2: number } | { kind: "any" } | { kind: "impossible" };
/**
 * The smallest area whose drop stays within the limit. "any": the area does not matter (cos φ is 0 and the reactive
 * drop is within the limit). "impossible": the reactance alone drops more than the limit allows.
 */
export function minAreaForDrop(input: Omit<VoltageDropInput, "areaMm2"> & { limitPct: number }): MinArea {
  const factor = phaseFactor(input.phases);
  const sinPhi = Math.sqrt(Math.max(0, 1 - input.cosPhi * input.cosPhi));
  const allowed = (input.limitPct / 100) * input.voltageV;
  const slack = allowed - factor * input.currentA * input.reactancePerM * input.lengthM * sinPhi;
  if (slack <= 0) return { kind: "impossible" };
  const resistive = factor * input.currentA * input.lengthM * input.cosPhi * input.rho;
  return resistive <= 0 ? { kind: "any" } : { kind: "area", areaMm2: resistive / slack };
}

/** The company's own value as a fallback for an empty field, with where it comes from. */
export const companyFallback = (sourced: Sourced | undefined): Fallback | undefined =>
  sourced ? { value: sourced.value, origin: "company", note: sourced.source ? `Företagets värde (${sourced.source})` : "Företagets värde" } : undefined;

/** The group of material data every cable tool draws folded: constants of nature at 20 °C. */
export const MATERIAL_GROUPS: Record<string, GroupInfo> = {
  materialData: { title: "Materialdata", hint: "Fysikaliska värden vid 20 °C för valt material. Skriv egna värden för att ersätta dem. Ledarens resistans per km från databladet går före.", collapsed: true },
};
/**
 * A conductor's own resistance per km from the cable's datasheet (2026-11-01). When it is filled it goes before
 * the material's resistivity over the area; the value is taken at 20 °C and corrected to the conductor temperature with α.
 * Workflow delivers no datasheet values: the company or the person enters them, with the source.
 */
export const resistancePerKmInput = (id: string, label: string, group: string, showIf?: (choices: Choices) => boolean, typeId?: string): CalcInput => ({
  kind: "number", id, label, dimension: "perLength", defaultUnit: "Ω/km", min: 0, minExclusive: true, group, showIf,
  ...(typeId ? {
    fallback: (choices: Choices, ctx: CalcContext): Fallback | undefined => {
      const type = chosenCableType(choices, ctx.company, typeId);
      return type ? { value: type.resistancePerM20, origin: "company", note: `Kabeltypen ${type.name}${type.source ? ` (${type.source})` : ""}` } : undefined;
    },
  } : {}),
  help: "Valfritt. Likströmsresistans vid 20 °C enligt kabelns datablad; går före materialets resistivitet och rättas till ledartemperaturen. Tomt fält: resistivitet / area.",
});
export const materialChoiceInput = (group: string, options: { id?: string; showIf?: (choices: Choices) => boolean } = {}): CalcInput => ({
  kind: "choice", id: options.id ?? "material", label: "Material", options: [{ value: "cu", label: MATERIALS.cu.label }, { value: "al", label: MATERIALS.al.label }], initial: "cu", display: "segmented", group, showIf: options.showIf,
});
/** A conductor temperature; empty means 20 °C, which leaves the resistance as it is at the reference temperature. */
export const temperatureInput = (group: string, options: { id?: string; label?: string; fallback?: (choices: Choices, ctx: CalcContext) => Fallback | undefined; help?: string } = {}): CalcInput => ({
  kind: "number", id: options.id ?? "temperature", label: options.label ?? "Ledartemperatur", dimension: "temperature", min: -60, max: 500, group,
  fallback: options.fallback ?? (() => ({ value: REFERENCE_TEMPERATURE, origin: "default", note: "20 °C, ingen temperaturrättning" })),
  help: options.help ?? "Resistansen rättas efter temperaturen. Tomt fält: 20 °C.",
});
/** The resistivity at 20 °C and its change per degree, as editable physical values for the chosen material. */
export const materialDataInputs = (group = "materialData"): CalcInput[] => [
  {
    kind: "number", id: "rho20", label: "Resistivitet vid 20 °C", dimension: "resistivity", min: 0, minExclusive: true, group,
    fallback: (choices, ctx) => ({ value: MATERIALS[effectiveMaterial(choices, ctx.company)].rho20, origin: "default", note: `Fysikaliskt värde för ${MATERIALS[effectiveMaterial(choices, ctx.company)].label.toLowerCase()}` }),
    help: "Tomt fält: det fysikaliska värdet för valt material vid 20 °C.",
  },
  {
    kind: "number", id: "alpha", label: "Temperaturkoefficient", dimension: "coefficient", min: 0, group,
    fallback: (choices, ctx) => ({ value: MATERIALS[effectiveMaterial(choices, ctx.company)].alpha, origin: "default", note: `Fysikaliskt värde för ${MATERIALS[effectiveMaterial(choices, ctx.company)].label.toLowerCase()}` }),
    help: "Resistansens ändring per grad. Tomt fält: det fysikaliska värdet.",
  },
];

/** The resistivity at the conductor temperature from the module's numbers: the person's own ρ20 or the physical value. */
export function conductorResistivity(numbers: Readonly<Record<string, number | undefined>>, temperatureId = "temperature") {
  const rho20 = numbers.rho20 as number;
  const alpha = numbers.alpha as number;
  const celsius = (numbers[temperatureId] ?? REFERENCE_TEMPERATURE) as number;
  return { rho20, alpha, celsius, rho: resistivityAt(rho20, alpha, celsius) };
}
