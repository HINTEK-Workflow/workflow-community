import { maxBranchLength, type BranchSource } from "../engine";
import { effectiveMaterial, materialChoiceInput, materialDataInputs, MATERIAL_GROUPS, resistancePerKmInput } from "../conductor";
import { defineCalculator } from "../define";
import { formatNumber } from "../number";
import type { CalcModule, Choices, Note, Origin, OutputRow } from "../types";
import { formatQuantity } from "../units";
import { cableAreaFallback, cableTypeInput, cFactorInput, curveTripNote, deviceInputs, deviceName, failure, neutralNote, OWN_CABLE, originSuffix, parallelInput, parallelOf, quantity, reactanceFor, reactanceInput, requirementVerdict, returnParallelInput, returnParallelOf, temperatureInput, warningNotes } from "./shared";

/**
 * Största gruppledningslängd (Kalkylator, 2026-10-12): the longest branch circuit for which the protective device
 * still trips within the required time. The loop impedance at the end of the cable (the source's loop plus the cable out
 * along the phase conductor and back along the protective conductor) must stay at or below c·U0 / Ia:
 *
 *   |Zsource + L·zloop| ≤ c·U0 / Ia          zloop = (ρ/Afas + ρ/Askydd) + j·2x
 *
 * The engine (`maxBranchLength`) solves it exactly, so the cable's reactance counts. The source is given by its earth-fault
 * current Ik1 or by its loop impedance with the unit stated (mΩ or Ω – 0,2 Ω is 200 mΩ), the device by its type, rated
 * current, required time and Ia (the company's own list or the maker's value typed; nothing is suggested,
 * 2026-11-01). The conductors' resistance is their own per km from the datasheet when given, otherwise ρ / A. The cable can be
 * the company's cable type and have conductors in parallel (KA4, 2026-11-01).
 */
const sourceShown = (kind: string) => (choices: Choices) => choices.source === kind;

export const branchLengthModule: CalcModule = defineCalculator({
  id: "branch-length",
  name: "Största gruppledningslängd",
  summary: "Längsta ledning där skyddet löser ut inom kravtiden.",
  groups: {
    source: { title: "Matningen", hint: "Slingan vid början av gruppledningen." },
    device: { title: "Skyddsapparat", hint: "Utlösningsströmmen Ia gäller kravtiden." },
    cable: { title: "Gruppledning" },
    conditions: { title: "Beräkningsvillkor", collapsed: true },
    ...MATERIAL_GROUPS,
  },
  inputs: [
    { kind: "choice", id: "source", label: "Matningen anges som", options: [{ value: "impedance", label: "Impedans" }, { value: "ik1", label: "Ik1" }], initial: "impedance", display: "segmented", group: "source" },
    { kind: "number", id: "srcZ", label: "Källans slingimpedans", dimension: "resistance", defaultUnit: "mΩ", required: true, min: 0, minExclusive: true, group: "source", showIf: sourceShown("impedance"), example: "200", help: "Välj mΩ eller Ω vid fältet. 0,2 Ω är 200 mΩ." },
    { kind: "number", id: "srcIk1", label: "Jordslutningsström Ik1 vid källan", dimension: "current", required: true, min: 0, minExclusive: true, group: "source", showIf: sourceShown("ik1"), example: "1150" },
    { kind: "number", id: "rx", label: "Källans R/X-förhållande", dimension: "ratio", min: 0, group: "source", help: "Valfritt. Tomt fält: källan läggs i linje med kabeln (säkra sidan)." },
    { kind: "number", id: "u0", label: "Fasspänning U0", dimension: "voltage", initial: "230", required: true, min: 0, minExclusive: true, usual: [50, 1000], group: "source" },
    ...deviceInputs("device"),
    cableTypeInput("cableType", "cable"),
    { kind: "number", id: "area", label: "Area, fasledare", dimension: "area", required: true, min: 0, minExclusive: true, usual: [0.5, 1500], group: "cable", example: "2,5", fallback: cableAreaFallback("cableType") },
    { kind: "number", id: "pe", label: "Area, skyddsledare", dimension: "area", min: 0, minExclusive: true, group: "cable", help: "Tomt fält: samma som fasledaren (en varning visas)." },
    materialChoiceInput("cable", { showIf: (choices) => (choices.cableType ?? OWN_CABLE) === OWN_CABLE }),
    parallelInput("parallel", "cable"),
    returnParallelInput("parallelPe", "cable", "parallel"),
    resistancePerKmInput("rkm", "Fasledarens resistans per km (från databladet)", "cable", undefined, "cableType"),
    resistancePerKmInput("rkmPe", "Skyddsledarens resistans per km (från databladet)", "cable"),
    { kind: "number", id: "len", label: "Verklig längd att kontrollera", dimension: "length", min: 0, group: "cable", help: "Valfritt. Visar om just den längden klarar kravet." },
    temperatureInput("temperature", "Ledartemperatur (minsta ström)", "smallest", "conditions"),
    reactanceInput("conditions", { typeId: "cableType" }),
    cFactorInput("c", "Spänningsfaktor c", "smallest", "conditions", "Minsta ström, t.ex. enligt IEC 60909-0 – värdet anges av företaget. Tomt fält: företagets värde, annars 1,0."),
    ...materialDataInputs(),
  ],
  outputs: [
    { id: "maxLength", label: "Största längd", dimension: "length" }, { id: "zsMax", label: "Zs max", dimension: "resistance" },
  ],
  example: {
    numbers: { srcZ: { text: "200", unit: "mΩ" }, u0: { text: "230" }, rated: { text: "16" }, time: { text: "0,4" }, trip: { text: "75" }, area: { text: "2,5" } },
    choices: { source: "impedance", device: "b", material: "cu" },
  },
  help: [
    "Fyll i matningens slingimpedans (välj mΩ eller Ω) eller dess jordslutningsström, välj skyddsapparat med märkström och kravtid, och ange gruppledningens area och material. Största längd visas direkt.",
    "Utlösningsströmmen Ia hämtas från företagets egna skyddsapparater om raden finns. Annars skriver du in Ia enligt tillverkarens tid–strömkurva (SS-EN 60898-1 för minibrytare). Workflow föreslår inget värde; utan Ia visas inget resultat.",
    "Slingan går ut längs fasledaren och tillbaka längs skyddsledaren. Saknas skyddsledarens area antas den vara lika stor som fasledarens. Ledarnas resistans per km från databladet går före materialets resistivitet.",
    "Ledartemperatur och spänningsfaktor är företagets värden eller dina egna; utan värde används 20 °C och c = 1,0, och det står i resultatet. Reaktansen är kabelns, företagets eller ett typiskt värde. Resultatet är ett beräkningsunderlag.",
  ],
  compute: ({ numbers, origins, choices, company }) => {
    const source: BranchSource = choices.source === "ik1" ? { kind: "earthFaultCurrent", ik1A: numbers.srcIk1! } : { kind: "impedance", impedance: { value: numbers.srcZ!, unit: "Ω" } };
    const result = maxBranchLength({
      material: effectiveMaterial(choices, company), parallel: parallelOf(choices, "parallel"), returnParallel: returnParallelOf(choices, "parallelPe", "parallel"), temperatureC: numbers.temperature!, rho20: numbers.rho20, alpha: numbers.alpha,
      u0V: numbers.u0!, tripCurrentA: numbers.trip!, requiredTimeS: numbers.time, source, sourceROverX: numbers.rx,
      areaMm2: numbers.area!, returnAreaMm2: numbers.pe, reactancePerM: reactanceFor(numbers, origins), c: numbers.c, lengthM: numbers.len,
      resistancePerM20: numbers.rkm, returnResistancePerM20: numbers.rkmPe,
    });
    if (!result.ok) return failure(result.errors, { u0: "u0", tripCurrent: "trip", area: "area", returnArea: "pe", reactance: "reactance", c: "c", time: "time", length: "len", ik1: "srcIk1", sourceImpedance: "srcZ", resistance: "rkm", returnResistance: "rkmPe" });
    const mohm = (value: number) => formatQuantity(value, "resistance", { unit: "mΩ" });
    const rows: OutputRow[] = [
      quantity("maxLength", "Största längd för gruppledningen", result.maxLengthM, "length", { primary: true, short: "Max längd" }),
      quantity("zsMax", "Zs max (c × U0 / Ia)", result.zsMaxOhm, "resistance", { primary: true, short: "Zs max" }),
      quantity("ik1AtMax", "Ik1 vid största längd", result.ik1AtMaxA, "current"),
      quantity("zsAtMax", "Zs vid största längd", result.zsAtMaxOhm, "resistance"),
      quantity("source", "Källans slingimpedans", result.sourceOhm, "resistance"),
      quantity("loopR", "Slingans resistans per meter (fas + skyddsledare)", result.loopResistancePerM, "perLength", { unit: "mΩ/m" }),
      quantity("loopX", "Slingans reaktans per meter", result.loopReactancePerM, "perLength", { unit: "mΩ/m" }),
    ];
    if (result.check) {
      rows.unshift(requirementVerdict("check", "Kontroll av vald längd", result.check.ok, origins.trip,
        `${formatQuantity(result.check.lengthM, "length")} ger Ik1 ${formatQuantity(result.check.ik1A, "current")}, ${result.check.ok ? "minst" : "lägre än"} Ia ${formatQuantity(numbers.trip!, "current")}${originSuffix(origins.trip)}.`));
    }
    const steps = [
      `Skydd: ${deviceName(choices.device)} ${formatQuantity(numbers.rated!, "current")}, kravtid ${formatQuantity(numbers.time!, "time")}, Ia = ${formatQuantity(numbers.trip!, "current")}${originSuffix(origins.trip)}.`,
      `Högsta slingimpedans: Zs max = c × U0 / Ia = ${formatNumber(numbers.c!)}${originSuffix(origins.c)} × ${formatQuantity(numbers.u0!, "voltage")} / ${formatQuantity(numbers.trip!, "current")} = ${mohm(result.zsMaxOhm)}.`,
      `Källan: ${choices.source === "ik1" ? `Zs källa = U0 / Ik1 = ${formatQuantity(numbers.u0!, "voltage")} / ${formatQuantity(numbers.srcIk1!, "current")}` : "Zs källa"} = ${mohm(result.sourceOhm)}.`,
      `Ledningens slinga per meter: R = ${numbers.rkm !== undefined || numbers.rkmPe !== undefined ? "rfas + rskydd (databladets värden där de är angivna, annars ρ / A)" : "ρ / Afas + ρ / Askydd"} = ${formatQuantity(result.loopResistancePerM, "perLength")}, X = 2 × x = ${formatQuantity(result.loopReactancePerM, "perLength")} (vid ${formatNumber(numbers.temperature!)} °C${originSuffix(origins.temperature)}).`,
      `Största längd: den längd L där |Zs källa + L × z| = Zs max, löst exakt med reaktansen. L = ${formatQuantity(result.maxLengthM, "length")}.`,
    ];
    const notes: Note[] = [...warningNotes(result.warnings), ...curveTripNote(origins as Record<string, Origin>, choices, numbers, company),
      ...neutralNote(origins as Record<string, Origin>, numbers, { c: { name: "spänningsfaktorn c" }, temperature: { name: "ledartemperaturen", unit: "°C" } })];
    return { status: "ok", rows, steps, notes };
  },
});
