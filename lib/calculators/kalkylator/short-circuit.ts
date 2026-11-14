import { extendFaultPoint, magnitude, shortCircuitCurrents, sourceFaultPoint, splitImpedance, type FaultPoint, type SourceSpec, type Warning } from "../engine";
import { chosenCableType, effectiveMaterial, resistancePerKmInput } from "../conductor";
import { defineCalculator } from "../define";
import { formatNumber } from "../number";
import type { CalcInput, CalcModule, Choices, ComputeOutcome, Note, Origin } from "../types";
import { formatQuantity } from "../units";
import { cableAreaFallback, cableTypeInput, cFactorInput, failure, neutralNote, OWN_CABLE, originSuffix, parallelInput, parallelOf, quantity, reactanceFor, reactanceInput, returnParallelInput, returnParallelOf, temperatureInput, warningNotes } from "./shared";

/**
 * Kortslutning IK3/IK1/IK2 (Kalkylator, 2026-10-12): from a source (its Ik3, its short-circuit power or its
 * impedance) and one to three cable sections in series. The sections add as vectors (R and X separately), and the result
 * is the current at the end of the last section, the impedance method of the engine:
 *
 *   Ik3 = c·U / (√3·|Z|)     Ik2 = (√3/2)·Ik3     Ik1 = c·U / (√3·|Zs|)   (Zs: the loop out along the phase conductor and back along the PE)
 *
 * The largest current (Ik3, Ik2) uses the voltage factor and the conductor temperature for the largest current, the
 * smallest (Ik1) those for the smallest; both are the company's values or typed, and without them the neutral c = 1,0 and
 * 20 °C are used and said (2026-11-01). A section's own resistance per km from the datasheet goes before ρ / A. The source's loop
 * impedance can be given apart (Zför); without it the phase impedance is assumed and the engine says so. A section can take the
 * company's cable type and have conductors in parallel (KA4, 2026-11-01); a reactance typed in the conditions goes before the type's.
 */
const SECTIONS = [1, 2, 3] as const;
const shown = (index: number) => (choices: Choices) => Number(choices.sections ?? "1") >= index;

const sectionInputs = (index: number): CalcInput[] => [
  cableTypeInput(`cableType${index}`, `cable${index}`, shown(index)),
  { kind: "number", id: `len${index}`, label: "Längd", dimension: "length", required: true, min: 0, usual: [0, 20000], group: `cable${index}`, showIf: shown(index), example: index === 1 ? "50" : "30" },
  { kind: "number", id: `area${index}`, label: "Area, fasledare", dimension: "area", required: true, min: 0, minExclusive: true, usual: [0.5, 1500], group: `cable${index}`, showIf: shown(index), example: index === 1 ? "35" : "16", fallback: cableAreaFallback(`cableType${index}`) },
  { kind: "number", id: `pe${index}`, label: "Area, skyddsledare", dimension: "area", min: 0, minExclusive: true, group: `cable${index}`, showIf: shown(index), help: "Tomt fält: samma som fasledaren (en varning visas)." },
  { kind: "choice", id: `mat${index}`, label: "Material", options: [{ value: "cu", label: "Koppar" }, { value: "al", label: "Aluminium" }], initial: "cu", display: "segmented", group: `cable${index}`, showIf: (choices) => shown(index)(choices) && (choices[`cableType${index}`] ?? OWN_CABLE) === OWN_CABLE },
  parallelInput(`par${index}`, `cable${index}`, shown(index)),
  returnParallelInput(`parPe${index}`, `cable${index}`, `par${index}`, shown(index)),
  resistancePerKmInput(`rkm${index}`, "Fasledarens resistans per km (från databladet)", `cable${index}`, shown(index), `cableType${index}`),
  resistancePerKmInput(`rkmPe${index}`, "Skyddsledarens resistans per km (från databladet)", `cable${index}`, shown(index)),
];

const sourceShown = (kind: string) => (choices: Choices) => choices.source === kind;

export const shortCircuitToolModule: CalcModule = defineCalculator({
  id: "short-circuit",
  name: "Kortslutning",
  summary: "Ik3, Ik2 och Ik1 vid slutet av en eller flera kabelavsnitt.",
  groups: {
    source: { title: "Källa", hint: "Matningen i början av ledningen." },
    cable1: { title: "Kabelavsnitt 1" },
    cable2: { title: "Kabelavsnitt 2" },
    cable3: { title: "Kabelavsnitt 3" },
    conditions: { title: "Beräkningsvillkor", hint: "Företagets värden eller dina egna. Utan värde används c = 1,0 och 20 °C.", collapsed: true },
  },
  inputs: [
    { kind: "number", id: "u", label: "Märkspänning U", dimension: "voltage", initial: "400", required: true, min: 0, minExclusive: true, usual: [12, 40000], group: "source", help: "Huvudspänning." },
    { kind: "choice", id: "source", label: "Källan anges som", options: [{ value: "ik3", label: "Ik3" }, { value: "power", label: "Effekt" }, { value: "impedance", label: "Impedans" }], initial: "ik3", display: "segmented", group: "source" },
    { kind: "number", id: "srcIk3", label: "Källans Ik3", dimension: "current", defaultUnit: "kA", required: true, min: 0, minExclusive: true, group: "source", showIf: sourceShown("ik3"), example: "16" },
    { kind: "number", id: "srcPower", label: "Källans kortslutningseffekt", dimension: "apparentPower", defaultUnit: "MVA", required: true, min: 0, minExclusive: true, group: "source", showIf: sourceShown("power"), example: "11" },
    { kind: "number", id: "srcZ", label: "Källans impedans per fas", dimension: "resistance", defaultUnit: "mΩ", required: true, min: 0, minExclusive: true, group: "source", showIf: sourceShown("impedance"), example: "14", help: "Välj mΩ eller Ω vid fältet." },
    { kind: "number", id: "rx", label: "Källans R/X-förhållande", dimension: "ratio", min: 0, group: "source", help: "Valfritt. Tomt fält: ren reaktans." },
    { kind: "number", id: "zLoop", label: "Källans slingimpedans Zför", dimension: "resistance", defaultUnit: "mΩ", min: 0, minExclusive: true, group: "source", help: "Valfritt, fas–skyddsledare vid källan. Tomt fält: samma som fasimpedansen (en varning visas)." },
    { kind: "choice", id: "sections", label: "Antal kabelavsnitt", options: [{ value: "1", label: "1" }, { value: "2", label: "2" }, { value: "3", label: "3" }], initial: "1", display: "segmented", group: "cable1", help: "Avsnitten kopplas efter varandra; resultatet gäller i slutet av det sista." },
    ...SECTIONS.flatMap(sectionInputs),
    cFactorInput("cMax", "Spänningsfaktor c, största ström", "largest", "conditions"),
    cFactorInput("cMin", "Spänningsfaktor c, minsta ström (Ik1)", "smallest", "conditions"),
    temperatureInput("tempMax", "Ledartemperatur, största ström", "largest", "conditions"),
    temperatureInput("tempMin", "Ledartemperatur, minsta ström (Ik1)", "smallest", "conditions"),
    reactanceInput("conditions"),
  ],
  outputs: [
    { id: "ik3", label: "Ik3 vid slutpunkten", dimension: "current" }, { id: "ik2", label: "Ik2 vid slutpunkten", dimension: "current" },
    { id: "ik1", label: "Ik1 vid slutpunkten", dimension: "current" },
  ],
  example: {
    numbers: { u: { text: "400" }, srcIk3: { text: "16", unit: "kA" }, len1: { text: "50" }, area1: { text: "35" }, len2: { text: "30" }, area2: { text: "16" } },
    choices: { source: "ik3", sections: "2", mat1: "cu", mat2: "cu" },
  },
  help: [
    "Ange källan och ett till tre kabelavsnitt. Resultatet gäller i slutet av det sista avsnittet och uppdateras medan du skriver.",
    "Ik3 och Ik2 är de största strömmarna (kall ledare). Ik1 är jordslutningsströmmen (fas mot skyddsledare, varm ledare) som kontrollerar frånkopplingen.",
    "Källans slingimpedans Zför kan anges för sig. Utan den antas fasimpedansen, och en varning visas.",
    "Spänningsfaktorn c och ledartemperaturen är företagets värden eller dina egna; utan värde används c = 1,0 och 20 °C, och det står i resultatet. Reaktansen är kabelns, företagets eller ett typiskt värde. Saknas skyddsledarens area antas den vara lika stor som fasledarens.",
    "Ledarens resistans per km från databladet går före materialets resistivitet när den är ifylld. Företagets kabeltyp fyller i area, material, resistans och reaktans. Parallella ledare delar resistansen och reaktansen med antalet.",
  ],
  compute: ({ numbers, origins, choices, company }) => {
    const u = numbers.u!;
    const sections = Number(choices.sections ?? "1");
    const warnings = new Map<string, Warning>();
    const warn = (list: readonly Warning[]) => list.forEach((item) => warnings.set(item.message, item));
    const typedReactance = origins.reactance === "user";
    const reactanceOf = (index: number) => (typedReactance ? numbers.reactance : chosenCableType(choices, company, `cableType${index}`)?.reactancePerM ?? reactanceFor(numbers, origins));
    const materialAt = (index: number) => effectiveMaterial(choices, company, `mat${index}`, `cableType${index}`);

    const build = (c: number, temperatureC: number): { point: FaultPoint; source: FaultPoint; parts: { r: number; x: number }[] } | ComputeOutcome => {
      const rOverX = numbers.rx;
      let spec: SourceSpec;
      if (choices.source === "ik3") spec = { kind: "ik3", amps: numbers.srcIk3!, rOverX };
      else if (choices.source === "power") spec = { kind: "power", voltAmps: numbers.srcPower!, rOverX };
      else spec = { kind: "impedance", phase: splitImpedance(numbers.srcZ!, rOverX), loop: numbers.zLoop === undefined ? undefined : splitImpedance(numbers.zLoop, rOverX) };
      const source = sourceFaultPoint(spec, u, c);
      if (!source.ok) return failure(source.errors, { ik3: "srcIk3", power: "srcPower", voltage: "u" });
      const loopGiven = numbers.zLoop !== undefined;
      let sourcePoint = source.point;
      if (spec.kind !== "impedance" && loopGiven) sourcePoint = { phase: source.point.phase, loop: splitImpedance(numbers.zLoop!, rOverX) };
      warn(source.warnings.filter((item) => !(item.code === "loopAssumed" && loopGiven)));
      let point = sourcePoint;
      const parts: { r: number; x: number }[] = [];
      for (let index = 1; index <= sections; index += 1) {
        const next = extendFaultPoint(point, {
          material: materialAt(index), temperatureC, lengthM: numbers[`len${index}`]!, areaMm2: numbers[`area${index}`]!,
          returnAreaMm2: numbers[`pe${index}`], reactancePerM: reactanceOf(index), resistancePerM20: numbers[`rkm${index}`], returnResistancePerM20: numbers[`rkmPe${index}`],
          parallel: parallelOf(choices, `par${index}`), returnParallel: returnParallelOf(choices, `parPe${index}`, `par${index}`),
        });
        if (!next.ok) return failure(next.errors, { length: `len${index}`, area: `area${index}`, returnArea: `pe${index}`, reactance: "reactance", resistance: `rkm${index}`, returnResistance: `rkmPe${index}` });
        warn(next.warnings);
        parts.push({ r: next.point.phase.r - point.phase.r, x: next.point.phase.x - point.phase.x });
        point = next.point;
      }
      return { point, source: sourcePoint, parts };
    };

    const largest = build(numbers.cMax!, numbers.tempMax!);
    if ("status" in largest) return largest;
    const smallest = build(numbers.cMin!, numbers.tempMin!);
    if ("status" in smallest) return smallest;
    const max = shortCircuitCurrents({ lineVoltageV: u, c: numbers.cMax!, point: largest.point });
    const min = shortCircuitCurrents({ lineVoltageV: u, c: numbers.cMin!, point: smallest.point });
    if (!max.ok) return failure(max.errors, { c: "cMax" });
    if (!min.ok) return failure(min.errors, { c: "cMin" });
    const atSource = shortCircuitCurrents({ lineVoltageV: u, c: numbers.cMax!, point: largest.source });
    warn(max.warnings);
    warn(min.warnings);

    const rows = [
      quantity("ik3", "Ik3 vid slutpunkten (största)", max.ik3A, "current", { primary: true, short: "Ik3" }),
      quantity("ik1", "Ik1 vid slutpunkten (minsta, fas mot skyddsledare)", min.ik1A, "current", { primary: true, short: "Ik1" }),
      quantity("ik2", "Ik2 vid slutpunkten", max.ik2A, "current"),
      quantity("zPhase", "Fasimpedans till slutpunkten (kall ledare)", max.phaseOhm, "resistance"),
      quantity("zLoop", "Slingimpedans Zs till slutpunkten (varm ledare)", min.loopOhm, "resistance"),
      ...(atSource.ok ? [quantity("ik3Source", "Ik3 vid källan", atSource.ik3A, "current")] : []),
    ];
    const sourceText = choices.source === "ik3" ? `Ik3 ${formatQuantity(numbers.srcIk3!, "current")}` : choices.source === "power" ? `${formatQuantity(numbers.srcPower!, "apparentPower")}` : `Z ${formatQuantity(numbers.srcZ!, "resistance")}`;
    const mohm = (value: number) => formatQuantity(value, "resistance", { unit: "mΩ" });
    const steps = [
      `Källa: ${sourceText} vid ${formatQuantity(u, "voltage")}, c = ${formatNumber(numbers.cMax!)}${originSuffix(origins.cMax)}. Fasimpedans ${mohm(magnitude(largest.source.phase))}.`,
      ...largest.parts.map((part, index) => `Avsnitt ${index + 1}: ${formatQuantity(numbers[`len${index + 1}`]!, "length")}, ${formatQuantity(numbers[`area${index + 1}`]!, "area")} ${materialAt(index + 1) === "al" ? "aluminium" : "koppar"}${parallelOf(choices, `par${index + 1}`) > 1 ? `, ${parallelOf(choices, `par${index + 1}`)} parallella ledare` : ""}, R = ${mohm(part.r)}, X = ${mohm(part.x)} (vid ${formatNumber(numbers.tempMax!)} °C${originSuffix(origins.tempMax)}).`),
      `Seriekoppling: R och X läggs ihop var för sig. Z = √(R² + X²) = ${mohm(max.phaseOhm)}.`,
      `Ik3 = c × U / (√3 × Z) = ${formatNumber(numbers.cMax!)} × ${formatQuantity(u, "voltage")} / (√3 × ${mohm(max.phaseOhm)}) = ${formatQuantity(max.ik3A, "current")}. Ik2 = (√3 / 2) × Ik3 = ${formatQuantity(max.ik2A, "current")}.`,
      `Ik1 (c = ${formatNumber(numbers.cMin!)}${originSuffix(origins.cMin)}, ${formatNumber(numbers.tempMin!)} °C${originSuffix(origins.tempMin)}): Zs = ${mohm(min.loopOhm)} ger Ik1 = c × U / (√3 × Zs) = ${formatQuantity(min.ik1A, "current")}.`,
    ];
    const labels = {
      cMax: { name: "spänningsfaktorn c för största ström" }, cMin: { name: "spänningsfaktorn c för minsta ström" },
      tempMax: { name: "ledartemperaturen vid största ström", unit: "°C" }, tempMin: { name: "ledartemperaturen vid minsta ström", unit: "°C" },
    };
    return { status: "ok", rows, steps, notes: [...warningNotes([...warnings.values()]), ...neutralNote(origins as Record<string, Origin>, numbers, labels)] satisfies Note[] };
  },
});
