import { maxLengthForVoltageDrop, voltageDropOverSections, type DropSection } from "../engine";
import { companyFallback, effectiveMaterial, materialChoiceInput, materialDataInputs, MATERIAL_GROUPS, resistancePerKmInput } from "../conductor";
import { defineCalculator } from "../define";
import { formatNumber } from "../number";
import type { CalcInput, CalcModule, Choices, Note, Origin, OutputRow } from "../types";
import { formatQuantity } from "../units";
import { NO_LIMIT } from "../voltage-drop";
import { cableAreaFallback, cableTypeInput, failure, neutralNote, OWN_CABLE, operatingTemperatureInput, originSuffix, parallelInput, parallelOf, quantity, reactanceFor, reactanceInput, verdict, warningNotes } from "./shared";

/**
 * Spänningsfall (Kalkylator, 2026-10-12): the voltage drop along a cable in volts and percent, and the longest
 * cable that stays within the allowed percentage. The engine (`voltageDropOverSections`, `maxLengthForVoltageDrop`) calculates
 *
 *   ΔU = Σ k · Ii · (Ri·cos φ + Xi·sin φ)      k = √3 (three-phase) or 2 (single-phase, out and back)      ΔU% = ΔU / U · 100
 *
 * The percentage is against the phase voltage for a single phase and against the line voltage for three phases, and the
 * result says which. The allowed percentage is the person's or the company's; no limit is built in.
 *
 * KA4 (2026-11-01): one to three sections in series, each with its own cable and, from the second on, its own current
 * (a feeder and a branch circuit); conductors in parallel divide R and X; and a company's cable type fills in the cable's
 * values. The first section keeps the field names it always had.
 */
const nominal = (choices: Choices) => (choices.phases === "1" ? "230" : "400");
const shown = (index: number) => (choices: Choices) => Number(choices.sections ?? "1") >= index;
/** The field names of a section: the first has no number of its own. */
const ids = (index: number) => index === 1
  ? { type: "cableType", length: "len", area: "area", material: "material", parallel: "parallel", resistance: "rkm", reactance: "reactance" }
  : { type: `cableType${index}`, length: `len${index}`, area: `area${index}`, material: `mat${index}`, parallel: `par${index}`, resistance: `rkm${index}`, reactance: `reactance${index}` };

const laterSection = (index: number): CalcInput[] => {
  const id = ids(index);
  const showIf = shown(index);
  const group = `cable${index}`;
  return [
    cableTypeInput(id.type, group, showIf),
    {
      kind: "number", id: `i${index}`, label: "Ström i avsnittet", dimension: "current", min: 0, minExclusive: true, group, showIf,
      fallback: (_choices, _ctx, numbers = {}) => (numbers.i === undefined ? undefined : { value: numbers.i, origin: "default", note: "Samma som belastningsströmmen" }),
      help: "Tomt fält: samma som belastningsströmmen.",
    },
    { kind: "number", id: id.length, label: "Kabellängd (enkel väg)", dimension: "length", required: true, min: 0, usual: [0, 20000], group, showIf, example: "30" },
    { kind: "number", id: id.area, label: "Area", dimension: "area", required: true, min: 0, minExclusive: true, usual: [0.5, 1500], group, showIf, example: "2,5", fallback: cableAreaFallback(id.type) },
    materialChoiceInput(group, { id: id.material, showIf: (choices) => showIf(choices) && (choices[id.type] ?? OWN_CABLE) === OWN_CABLE }),
    parallelInput(id.parallel, group, showIf),
    resistancePerKmInput(id.resistance, "Ledarens resistans per km (från databladet)", group, showIf, id.type),
    reactanceInput(group, { id: id.reactance, typeId: id.type, showIf }),
  ];
};

export const voltageDropToolModule: CalcModule = defineCalculator({
  id: "voltage-drop",
  name: "Spänningsfall",
  summary: "Spänningsfall i volt och procent, och största längd för tillåtet fall.",
  groups: {
    load: { title: "Last" },
    cable: { title: "Kabelavsnitt 1" },
    cable2: { title: "Kabelavsnitt 2" },
    cable3: { title: "Kabelavsnitt 3" },
    limit: { title: "Tillåtet spänningsfall", hint: "Gränsen anger du själv eller hämtar från företagets värden." },
    ...MATERIAL_GROUPS,
  },
  inputs: [
    { kind: "choice", id: "phases", label: "System", options: [{ value: "3", label: "Trefas" }, { value: "1", label: "Enfas" }], initial: "3", display: "segmented", group: "load" },
    { kind: "number", id: "u", label: "Märkspänning U", dimension: "voltage", initial: nominal, required: true, min: 0, minExclusive: true, usual: [12, 40000], group: "load", help: "Huvudspänning vid trefas, fasspänning vid enfas." },
    { kind: "number", id: "i", label: "Belastningsström I", dimension: "current", required: true, min: 0, minExclusive: true, usual: [0.01, 50000], group: "load", example: "32" },
    { kind: "number", id: "cosphi", label: "Effektfaktor cos φ", dimension: "ratio", initial: "1", min: 0, minExclusive: true, max: 1, group: "load", fallback: () => ({ value: 1, origin: "default", note: "cos φ 1" }), help: "Mellan 0 och 1. 1 är en rent resistiv last." },
    { kind: "choice", id: "sections", label: "Antal kabelavsnitt", options: [{ value: "1", label: "1" }, { value: "2", label: "2" }, { value: "3", label: "3" }], initial: "1", display: "segmented", group: "cable", help: "Avsnitten kopplas efter varandra, till exempel matarkabel och gruppledning." },
    cableTypeInput("cableType", "cable"),
    { kind: "number", id: "len", label: "Kabellängd (enkel väg)", dimension: "length", required: true, min: 0, usual: [0, 20000], group: "cable", example: "80" },
    { kind: "number", id: "area", label: "Area", dimension: "area", required: true, min: 0, minExclusive: true, usual: [0.5, 1500], group: "cable", example: "10", fallback: cableAreaFallback("cableType") },
    materialChoiceInput("cable", { showIf: (choices) => (choices.cableType ?? OWN_CABLE) === OWN_CABLE }),
    parallelInput("parallel", "cable"),
    resistancePerKmInput("rkm", "Ledarens resistans per km (från databladet)", "cable", undefined, "cableType"),
    operatingTemperatureInput("cable"),
    reactanceInput("cable", { typeId: "cableType" }),
    ...laterSection(2),
    ...laterSection(3),
    {
      kind: "number", id: "allowed", label: "Tillåtet spänningsfall", dimension: "percent", min: 0, minExclusive: true, max: 100, group: "limit", example: "3",
      fallback: (_choices, ctx) => companyFallback(ctx.company.dropLimitPct),
      help: "Procent. Tomt fält: företagets värde, annars ingen jämförelse.",
    },
    ...materialDataInputs(),
  ],
  outputs: [
    { id: "dropV", label: "Spänningsfall ΔU", dimension: "voltage" }, { id: "dropPercent", label: "Spänningsfall i procent", dimension: "percent" },
    { id: "maxLength", label: "Största längd för tillåtet fall", dimension: "length" },
  ],
  example: {
    numbers: { i: { text: "32" }, cosphi: { text: "0,9" }, len: { text: "80" }, area: { text: "10" }, allowed: { text: "3" } },
    choices: { phases: "3", material: "cu" },
  },
  help: [
    "Spänningsfallet räknas som ΔU = k × I × (R × cos φ + X × sin φ). Faktorn k är √3 vid trefas och 2 vid enfas (ut och tillbaka).",
    "Procenten räknas mot huvudspänningen vid trefas och mot fasspänningen vid enfas. Ange därför huvudspänningen (t.ex. 400 V) vid trefas och fasspänningen (230 V) vid enfas.",
    "Resistansen räknas från ledarens resistans per km enligt databladet när den är ifylld, annars från materialets resistivitet vid 20 °C (fysikaliskt värde du kan ändra), och rättas till ledartemperaturen. Temperaturen är din egen eller företagets; utan värde används 20 °C, och det står i resultatet. Reaktansen är kabelns egen, företagets eller ett typiskt värde.",
    "Flera kabelavsnitt läggs ihop: varje avsnitt räknas med sin kabel och sin ström, och med samma cos φ och temperatur. Parallella ledare delar resistansen och reaktansen med antalet. Företagets kabeltyper fyller i area, material, resistans och reaktans.",
    "Fyll i ett tillåtet spänningsfall så visas jämförelsen och den största längden. Med flera avsnitt är det längden på det sista avsnittet. Workflow anger ingen gräns.",
  ],
  compute: ({ numbers, origins, choices, company }) => {
    const phases = choices.phases === "1" ? 1 : 3;
    const count = Number(choices.sections ?? "1");
    const first = effectiveMaterial(choices, company);
    const temperatureC = numbers.temperature ?? 20;
    const sectionAt = (index: number): DropSection => {
      const id = ids(index);
      const material = effectiveMaterial(choices, company, id.material, id.type);
      return {
        currentA: (index === 1 ? numbers.i : numbers[`i${index}`])!, lengthM: numbers[id.length]!, areaMm2: numbers[id.area]!, material, temperatureC,
        // The folded material data is the first section's material: a later section of another material takes its own physical values.
        ...(material === first ? { rho20: numbers.rho20, alpha: numbers.alpha } : {}),
        reactancePerM: reactanceFor(numbers, origins, id.reactance), resistancePerM20: numbers[id.resistance], parallel: parallelOf(choices, id.parallel),
      };
    };
    const sections = Array.from({ length: count }, (_, index) => sectionAt(index + 1));
    const common = { phases: phases as 1 | 3, voltageV: numbers.u!, cosPhi: numbers.cosphi ?? 1 };
    const result = voltageDropOverSections({ ...common, sections, allowedPercent: numbers.allowed });
    if (!result.ok) return failure(result.errors, { voltage: "u", current: "i", cosPhi: "cosphi", length: "len", area: "area", reactance: "reactance", allowed: "allowed", resistance: "rkm" });
    const reference = phases === 3 ? "huvudspänningen" : "fasspänningen";
    const notes: Note[] = [...warningNotes(result.warnings), ...neutralNote(origins as Record<string, Origin>, numbers, { temperature: { name: "ledartemperaturen", unit: "°C" } })];
    // With a limit the phone's bar shows the percentage and the longest cable (the volts stay in the result list).
    const limited = numbers.allowed !== undefined && result.withinLimit !== null;
    const conductors = (index: number) => { const parallel = sections[index]!.parallel ?? 1; return parallel > 1 ? `${parallel} parallella ledare` : "en ledare"; };
    const rows: OutputRow[] = [
      quantity("dropV", count > 1 ? "Spänningsfall ΔU, alla avsnitt" : "Spänningsfall ΔU", result.dropV, "voltage", { primary: true, short: "ΔU", dock: !limited }),
      quantity("dropPercent", `Spänningsfall i procent av ${reference}`, result.dropPercent, "percent", { primary: true, short: "ΔU i %" }),
      quantity("loadV", "Spänning vid lasten", result.loadVoltageV, "voltage"),
    ];
    if (count > 1) result.sections.forEach((section, index) => rows.push(quantity(`dropSection${index + 1}`, `Avsnitt ${index + 1}: spänningsfall`, section.dropV, "voltage")));
    else {
      rows.push(quantity("resistance", `Resistans, ${conductors(0)}`, result.sections[0]!.resistanceOhm, "resistance", { unit: "mΩ" }));
      rows.push(quantity("reactance", `Reaktans, ${conductors(0)}`, result.sections[0]!.reactanceOhm, "resistance", { unit: "mΩ" }));
    }
    const steps = result.sections.flatMap((section, index) => {
      const id = ids(index + 1);
      const parallel = sections[index]!.parallel ?? 1;
      const dividedBy = parallel > 1 ? ` / ${parallel}` : "";
      const before = count > 1 ? `Avsnitt ${index + 1}: ` : "";
      const length = numbers[id.length]!;
      const own = numbers[id.resistance];
      const lines = [
        own !== undefined
          ? `${before}Resistans för ${conductors(index)}: R = r × L${dividedBy} = ${formatQuantity(section.resistancePerM, "perLength", { unit: "Ω/km" })} (databladets ${formatQuantity(own, "perLength", { unit: "Ω/km" })} vid 20 °C, rättad till ${formatNumber(temperatureC)} °C) × ${formatQuantity(length, "length")}${dividedBy} = ${formatQuantity(section.resistanceOhm, "resistance", { unit: "mΩ" })}.`
          : `${before}Resistans för ${conductors(index)}: R = ρ × L / A${dividedBy} = ${formatNumber(section.resistancePerM * numbers[id.area]!)} Ω·mm²/m × ${formatQuantity(length, "length")} / ${formatQuantity(numbers[id.area]!, "area")}${dividedBy} = ${formatQuantity(section.resistanceOhm, "resistance", { unit: "mΩ" })}.`,
        `${before}Reaktans för ${conductors(index)}: X = x × L${dividedBy} = ${formatQuantity(section.reactancePerM, "perLength")} × ${formatQuantity(length, "length")}${dividedBy} = ${formatQuantity(section.reactanceOhm, "resistance", { unit: "mΩ" })}${originSuffix(origins[id.reactance])}.`,
      ];
      if (count > 1) lines.push(`${before}Spänningsfall: ΔU = ${phases === 3 ? "√3" : "2"} × ${formatQuantity(sections[index]!.currentA, "current")} × (R × cos φ + X × sin φ) = ${formatQuantity(section.dropV, "voltage")}.`);
      return lines;
    });
    steps.push(count > 1
      ? `Spänningsfall: avsnitten läggs ihop, ΔU = ${formatQuantity(result.dropV, "voltage")}.`
      : `Spänningsfall: ΔU = ${phases === 3 ? "√3" : "2"} × I × (R × cos φ + X × sin φ) = ${formatQuantity(result.dropV, "voltage")}.`);
    steps.push(`Procent: ΔU / U × 100 = ${formatQuantity(result.dropV, "voltage")} / ${formatQuantity(numbers.u!, "voltage")} × 100 = ${formatNumber(result.dropPercent)} % (av ${reference}).`);
    if (limited) {
      const within = result.withinLimit === true;
      rows.push(verdict("limit", "Jämförelse med tillåtet spänningsfall", within, `${within ? "Inom" : "Över"} tillåtet spänningsfall: ${formatNumber(result.dropPercent)} % mot ${formatNumber(numbers.allowed!)} %${originSuffix(origins.allowed)}.`));
      // The earlier sections keep their drop; what is left of the limit decides how long the last one may be.
      const earlier = result.sections.slice(0, -1).reduce((sum, section) => sum + section.dropPercent, 0);
      const room = numbers.allowed! - earlier;
      const longest = room > 0 ? maxLengthForVoltageDrop({ ...common, ...sections[count - 1]!, allowedPercent: room }) : null;
      if (longest?.ok) {
        rows.push(quantity("maxLength", count > 1 ? "Största längd för sista avsnittet" : "Största längd för tillåtet spänningsfall", longest.maxLengthM, "length", { primary: true, short: "Max längd" }));
        steps.push(`${count > 1 ? `Största längd för sista avsnittet (${formatNumber(room)} % kvar efter de andra)` : "Största längd"}: L = ΔU tillåtet / (k × I × (r × cos φ + x × sin φ)) = ${formatQuantity(longest.maxLengthM, "length")} (samma kabel och ström).`);
      }
    } else notes.push(NO_LIMIT);
    return { status: "ok", rows, steps, notes };
  },
});
