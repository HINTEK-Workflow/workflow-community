import { companyFallback, materialChoiceInput, materialDataInputs, MATERIAL_GROUPS, materialOf, temperatureInput } from "./conductor";
import { COMPANY_VALUES_LINK, originSuffix, originWord, resistivitySteps } from "./voltage-drop";
import { defineCalculator } from "./define";
import { formatNumber } from "./number";
import type { CalcInput, CalcModule, Choices, Note, OutputRow } from "./types";
import { formatQuantity } from "./units";

/**
 * Kortslutningsström (Räkneverktyg, 2026-10-07): the simple impedance method. The source behind the cable is
 * given by its short-circuit current or power in the connection point, or by its impedance; the cable adds its
 * resistance and reactance; the current at the end of the cable follows from the total impedance.
 *
 *   Z källa = c × U / (√3 × I källa) = c × U² / S källa     Ik = c × U / (√3 × √(R² + X²))
 *
 * Two cases can be calculated, each from its own source value: the largest current (a three-phase fault, the source at
 * its strongest, a cold cable) and the smallest (a phase to the protective conductor, the source at its weakest, a hot
 * cable – the loop runs out along the phase conductor and back along the protective conductor). The voltage factor c
 * and the conductor temperatures are the person's or the company's; without them 1 and 20 °C are used and said so.
 * The reactance of the return conductor is taken as that of the phase conductor, and the source is taken to have the
 * same impedance in the loop as in a phase.
 */
export type SourceSpec = { kind: "current"; amps: number } | { kind: "power"; voltAmps: number } | { kind: "impedance"; ohms: number };
const SQRT3 = Math.sqrt(3);

/** The impedance of the source in ohms: from its short-circuit current, its short-circuit power or given directly. */
export function sourceImpedance(source: SourceSpec, voltageV: number, c: number): number {
  if (source.kind === "current") return (c * voltageV) / (SQRT3 * source.amps);
  if (source.kind === "power") return (c * voltageV * voltageV) / source.voltAmps;
  return source.ohms;
}

/** Splits an impedance into resistance and reactance by the ratio R/X; without a ratio it is all reactance. */
export function splitImpedance(z: number, rx: number | undefined): { r: number; x: number } {
  if (rx === undefined) return { r: 0, x: z };
  const x = z / Math.sqrt(1 + rx * rx);
  return { r: x * rx, x };
}

export type ShortCircuitInput = {
  voltageV: number;
  /** The voltage factor c. */
  c: number;
  source: SourceSpec;
  /** R/X of the source; undefined means pure reactance. */
  sourceRx?: number;
  lengthM: number;
  areaMm2: number;
  /** Ω·mm²/m at the conductor temperature. */
  rho: number;
  /** Ω/m */
  reactancePerM: number;
  /** A fault from the phase to the protective conductor: the return conductor, with its area, is part of the loop. */
  returnAreaMm2?: number;
};
export type ShortCircuitResult = {
  sourceZ: number;
  sourceR: number;
  sourceX: number;
  cableR: number;
  cableX: number;
  returnR: number;
  returnX: number;
  rTotal: number;
  xTotal: number;
  zTotal: number;
  /** A */
  current: number;
};

export function shortCircuit(input: ShortCircuitInput): ShortCircuitResult {
  const sourceZ = sourceImpedance(input.source, input.voltageV, input.c);
  const { r: sourceR, x: sourceX } = splitImpedance(sourceZ, input.sourceRx);
  const cableR = (input.rho * input.lengthM) / input.areaMm2;
  const cableX = input.reactancePerM * input.lengthM;
  const returnR = input.returnAreaMm2 === undefined ? 0 : (input.rho * input.lengthM) / input.returnAreaMm2;
  const returnX = input.returnAreaMm2 === undefined ? 0 : cableX;
  const rTotal = sourceR + cableR + returnR;
  const xTotal = sourceX + cableX + returnX;
  const zTotal = Math.hypot(rTotal, xTotal);
  return { sourceZ, sourceR, sourceX, cableR, cableX, returnR, returnX, rTotal, xTotal, zTotal, current: (input.c * input.voltageV) / (SQRT3 * zTotal) };
}

const GROUPS = {
  source: { title: "Källa", hint: "Källans kortslutningsström eller -effekt i anslutningspunkten, eller dess impedans. Fyll i det du vill beräkna: största, minsta eller båda." },
  cable: { title: "Kabel" },
  conditions: { title: "Beräkningsvillkor", hint: "Spänningsfaktor och ledartemperatur anger du själv eller hämtar från företagets värden. Utan dem räknas med 1 och 20 °C." },
  compare: { title: "Jämförelse (valfritt)", hint: "Uppgifter ur skyddets egen dokumentation." },
  ...MATERIAL_GROUPS,
};
const showWhen = (kind: string) => (choices: Choices) => choices.source === kind;

const sourceInputs = (): CalcInput[] => [
  { kind: "number", id: "un", label: "Märkspänning U", dimension: "voltage", initial: "400", required: true, min: 0, minExclusive: true, usual: [12, 40000], group: "source", help: "Huvudspänning." },
  { kind: "choice", id: "source", label: "Källan anges som", options: [{ value: "current", label: "Kortslutningsström" }, { value: "power", label: "Kortslutningseffekt" }, { value: "impedance", label: "Impedans" }], initial: "current", display: "segmented", group: "source" },
  { kind: "number", id: "srcMaxCurrent", label: "Källans största kortslutningsström", dimension: "current", defaultUnit: "kA", min: 0, minExclusive: true, group: "source", showIf: showWhen("current") },
  { kind: "number", id: "srcMinCurrent", label: "Källans minsta kortslutningsström", dimension: "current", defaultUnit: "kA", min: 0, minExclusive: true, group: "source", showIf: showWhen("current") },
  { kind: "number", id: "srcMaxPower", label: "Källans största kortslutningseffekt", dimension: "apparentPower", defaultUnit: "MVA", min: 0, minExclusive: true, group: "source", showIf: showWhen("power") },
  { kind: "number", id: "srcMinPower", label: "Källans minsta kortslutningseffekt", dimension: "apparentPower", defaultUnit: "MVA", min: 0, minExclusive: true, group: "source", showIf: showWhen("power") },
  { kind: "number", id: "srcMaxImpedance", label: "Källans impedans för största ström", dimension: "resistance", defaultUnit: "mΩ", min: 0, minExclusive: true, group: "source", showIf: showWhen("impedance") },
  { kind: "number", id: "srcMinImpedance", label: "Källans impedans för minsta ström", dimension: "resistance", defaultUnit: "mΩ", min: 0, minExclusive: true, group: "source", showIf: showWhen("impedance") },
  { kind: "number", id: "rx", label: "Källans R/X-förhållande", dimension: "ratio", min: 0, group: "source", help: "Valfritt. Tomt fält: källan räknas som ren reaktans." },
];

export const shortCircuitModule: CalcModule = defineCalculator({
  id: "short-circuit",
  name: "Kortslutningsström",
  summary: "Största och minsta kortslutningsström vid kabelns slut.",
  groups: GROUPS,
  inputs: [
    ...sourceInputs(),
    { kind: "number", id: "length", label: "Kabellängd (enkel väg)", dimension: "length", required: true, min: 0, usual: [0, 20000], group: "cable", help: "0 ger källans egen kortslutningsström." },
    { kind: "number", id: "area", label: "Area, fasledare", dimension: "area", required: true, min: 0, minExclusive: true, usual: [0.5, 1500], group: "cable" },
    { kind: "number", id: "returnArea", label: "Area, skyddsledare", dimension: "area", min: 0, minExclusive: true, group: "cable", help: "Tomt fält: samma som fasledaren. Används för den minsta strömmen." },
    materialChoiceInput("cable"),
    {
      kind: "number", id: "reactance", label: "Reaktans per längd", dimension: "perLength", min: 0, group: "cable",
      fallback: (_choices, ctx) => companyFallback(ctx.company.reactancePerM) ?? { value: 0, origin: "default", note: "ingen reaktans angiven" },
      help: "Tomt fält: företagets värde under Värden och referenser, annars 0.",
    },
    { kind: "number", id: "cMax", label: "Spänningsfaktor c, största ström", dimension: "ratio", min: 0, minExclusive: true, max: 10, group: "conditions", fallback: (_choices, ctx) => companyFallback(ctx.company.cMax) ?? { value: 1, origin: "default", note: "spänningsfaktor 1" } },
    { kind: "number", id: "cMin", label: "Spänningsfaktor c, minsta ström", dimension: "ratio", min: 0, minExclusive: true, max: 10, group: "conditions", fallback: (_choices, ctx) => companyFallback(ctx.company.cMin) ?? { value: 1, origin: "default", note: "spänningsfaktor 1" } },
    temperatureInput("conditions", { id: "tempMax", label: "Ledartemperatur, största ström", fallback: (_choices, ctx) => companyFallback(ctx.company.tempMax) ?? { value: 20, origin: "default", note: "20 °C" }, help: "Tomt fält: företagets värde, annars 20 °C." }),
    temperatureInput("conditions", { id: "tempMin", label: "Ledartemperatur, minsta ström", fallback: (_choices, ctx) => companyFallback(ctx.company.tempMin) ?? { value: 20, origin: "default", note: "20 °C" }, help: "Tomt fält: företagets värde, annars 20 °C." }),
    { kind: "number", id: "breaking", label: "Skyddets brytförmåga", dimension: "current", defaultUnit: "kA", min: 0, minExclusive: true, group: "compare", help: "Jämförs med den största strömmen." },
    { kind: "number", id: "trip", label: "Ström som får skyddet att utlösa", dimension: "current", min: 0, minExclusive: true, group: "compare", help: "Jämförs med den minsta strömmen." },
    ...materialDataInputs(),
  ],
  outputs: [
    { id: "ikMax", label: "Största kortslutningsström, trefasig", dimension: "current" },
    { id: "zMax", label: "Impedans till felstället, största", dimension: "resistance" },
    { id: "ikMin", label: "Minsta kortslutningsström, fas mot skyddsledare", dimension: "current" },
    { id: "zMin", label: "Slingimpedans, minsta", dimension: "resistance" },
    { id: "breaking", label: "Jämförelse med brytförmågan" },
    { id: "trip", label: "Jämförelse med utlösningsströmmen" },
  ],
  help: [
    "Verktyget använder impedansmetoden: källans impedans räknas ur dess kortslutningsström eller -effekt, kabelns resistans och reaktans läggs till, och strömmen vid kabelns slut följer av den samlade impedansen.",
    "Största ström räknas som en trefasig kortslutning. Minsta ström räknas som en kortslutning mellan fas och skyddsledare, där slingan går ut längs fasledaren och tillbaka längs skyddsledaren.",
    "Spänningsfaktorn c och ledartemperaturen anger du själv eller hämtar från företagets värden. Utan dem räknas med 1 och 20 °C, och det står i resultatet.",
    "Resultatet är ett beräkningsunderlag. Val av skydd och kontroll av utlösning görs av en behörig person.",
  ],
  compute: ({ numbers, origins, choices }) => {
    const kind = (choices.source === "power" ? "Power" : choices.source === "impedance" ? "Impedance" : "Current") as "Current" | "Power" | "Impedance";
    const specOf = (scenario: "Max" | "Min"): SourceSpec | undefined => {
      const value = numbers[`src${scenario}${kind}`];
      if (value === undefined) return undefined;
      return kind === "Current" ? { kind: "current", amps: value } : kind === "Power" ? { kind: "power", voltAmps: value } : { kind: "impedance", ohms: value };
    };
    const max = specOf("Max");
    const min = specOf("Min");
    if (!max && !min) return { status: "incomplete", message: "Ange källans kortslutningsström, eller dess effekt eller impedans, för största eller minsta ström så visas resultatet här." };
    const voltageV = numbers.un!;
    const rows: OutputRow[] = [];
    const steps: string[] = [];
    const notes: Note[] = [];
    const milliohm = (value: number) => formatQuantity(value, "resistance", { unit: "mΩ" });
    const scenario = (name: string, spec: SourceSpec, c: number, temperatureId: "tempMax" | "tempMin", cOrigin: string, loop: boolean) => {
      const { steps: materialSteps, rho } = resistivitySteps(numbers, origins, materialOf(choices), temperatureId);
      const result = shortCircuit({
        voltageV, c, source: spec, sourceRx: numbers.rx, lengthM: numbers.length!, areaMm2: numbers.area!, rho, reactancePerM: numbers.reactance ?? 0,
        returnAreaMm2: loop ? numbers.returnArea ?? numbers.area! : undefined,
      });
      steps.push(`${name}:`);
      steps.push(spec.kind === "current" ? `Källans impedans: Z = c × U / (√3 × I) = ${formatNumber(c)} × ${formatQuantity(voltageV, "voltage")} / (√3 × ${formatQuantity(spec.amps, "current")}) = ${milliohm(result.sourceZ)}.`
        : spec.kind === "power" ? `Källans impedans: Z = c × U² / S = ${formatNumber(c)} × (${formatQuantity(voltageV, "voltage")})² / ${formatQuantity(spec.voltAmps, "apparentPower")} = ${milliohm(result.sourceZ)}.`
        : `Källans impedans: Z = ${milliohm(result.sourceZ)} (angiven).`);
      steps.push(numbers.rx === undefined ? "Källan räknas som ren reaktans eftersom R/X inte är angivet." : `Källans resistans och reaktans med R/X = ${formatNumber(numbers.rx)}: R = ${milliohm(result.sourceR)}, X = ${milliohm(result.sourceX)}.`);
      steps.push(...materialSteps);
      steps.push(`Kabelns ${loop ? "fasledare" : "fas"}: R = ρ × L / A = ${formatNumber(rho)} Ω·mm²/m × ${formatQuantity(numbers.length!, "length")} / ${formatQuantity(numbers.area!, "area")} = ${milliohm(result.cableR)} och X = x × L = ${milliohm(result.cableX)}${originSuffix(origins.reactance)}.`);
      if (loop) steps.push(`Skyddsledaren: R = ${milliohm(result.returnR)}, X = ${milliohm(result.returnX)} (area ${formatQuantity(numbers.returnArea ?? numbers.area!, "area")}, reaktansen räknad som fasledarens).`);
      steps.push(`Summa: R = ${milliohm(result.rTotal)}, X = ${milliohm(result.xTotal)}, Z = √(R² + X²) = ${milliohm(result.zTotal)}.`);
      steps.push(`Kortslutningsström: Ik = c × U / (√3 × Z) = ${formatNumber(c)} × ${formatQuantity(voltageV, "voltage")} / (√3 × ${milliohm(result.zTotal)}) = ${formatQuantity(result.current, "current")}${cOrigin ? ` (c: ${cOrigin})` : ""}.`);
      return result;
    };
    if (max) {
      const result = scenario("Största kortslutningsström (trefasig kortslutning)", max, numbers.cMax!, "tempMax", originWord(origins.cMax), false);
      rows.push({ kind: "quantity", id: "ikMax", label: "Största kortslutningsström, trefasig", value: result.current, dimension: "current", derived: true, primary: true },
        { kind: "quantity", id: "zMax", label: "Impedans till felstället, största", value: result.zTotal, dimension: "resistance", unit: "mΩ", derived: true });
      if (numbers.breaking !== undefined) {
        const over = result.current > numbers.breaking;
        rows.push({ kind: "verdict", id: "breaking", label: "Jämförelse med brytförmågan", tone: over ? "alarm" : "ok",
          text: `Största kortslutningsströmmen ${formatQuantity(result.current, "current")} är ${over ? "högre än" : "inte högre än"} skyddets angivna brytförmåga ${formatQuantity(numbers.breaking, "current")}.` });
      }
    }
    if (min) {
      const result = scenario("Minsta kortslutningsström (fas mot skyddsledare)", min, numbers.cMin!, "tempMin", originWord(origins.cMin), true);
      rows.push({ kind: "quantity", id: "ikMin", label: "Minsta kortslutningsström, fas mot skyddsledare", value: result.current, dimension: "current", derived: true, primary: true },
        { kind: "quantity", id: "zMin", label: "Slingimpedans, minsta", value: result.zTotal, dimension: "resistance", unit: "mΩ", derived: true });
      if (numbers.trip !== undefined) {
        const enough = result.current >= numbers.trip;
        rows.push({ kind: "verdict", id: "trip", label: "Jämförelse med utlösningsströmmen", tone: enough ? "ok" : "alarm",
          text: `Minsta kortslutningsströmmen ${formatQuantity(result.current, "current")} är ${enough ? "minst lika stor som" : "lägre än"} strömmen som ska få skyddet att utlösa, ${formatQuantity(numbers.trip, "current")}.` });
      }
    }
    if (numbers.breaking !== undefined && !max) notes.push({ tone: "info", text: "Skyddets brytförmåga jämförs med den största strömmen. Fyll i källans största kortslutningsström för att få jämförelsen." });
    if (numbers.trip !== undefined && !min) notes.push({ tone: "info", text: "Utlösningsströmmen jämförs med den minsta strömmen. Fyll i källans minsta kortslutningsström för att få jämförelsen." });
    const defaults = [max && origins.cMax === "default" ? "c för största strömmen" : null, min && origins.cMin === "default" ? "c för minsta strömmen" : null,
      max && origins.tempMax === "default" ? "ledartemperaturen för största strömmen" : null, min && origins.tempMin === "default" ? "ledartemperaturen för minsta strömmen" : null].filter(Boolean);
    if (defaults.length) notes.push({ tone: "info", text: `Utan angivna värden räknas med 1 för c och 20 °C för ledartemperaturen (${defaults.join(", ")}). Ange dem, eller företagets värden under`, link: COMPANY_VALUES_LINK });
    if (origins.reactance === "default") notes.push({ tone: "info", text: "Ingen reaktans är angiven, så kabelns reaktans är 0. Ange reaktansen, eller företagets värde under", link: COMPANY_VALUES_LINK });
    return { status: "ok", rows, steps, notes };
  },
});
