import { checkDisconnection, tripTimeOnCurve } from "../engine";
import type { DeviceType } from "../company-data";
import { defineCalculator } from "../define";
import { formatNumber } from "../number";
import type { CalcModule, Note, Origin, OutputRow } from "../types";
import { formatQuantity } from "../units";
import { cFactorInput, curveMethodFor, curveTripNote, deviceCurve, deviceInputs, deviceName, failure, neutralNote, originSuffix, quantity, requirementVerdict, warningNotes } from "./shared";

/**
 * Frånkopplingstid (Kalkylator, 2026-10-12): does the protective device trip within the required time at the end of
 * a circuit? The earth-fault current must be at least Ia, the current that trips the device within the time:
 *
 *   Ik1 = c·U0 / Zs ≥ Ia      equivalent to      Zs ≤ c·U0 / Ia = Zs,max
 *
 * The loop impedance Zs is given directly (in Ω or mΩ) or through the earth-fault current Ik1. The device, its rated
 * current, the required time and Ia are the person's or the company's own values (Mina skyddsapparater). No device table
 * and no multiple of In is built in (2026-11-01): without Ia the calculator asks for it. With at least two of the company's
 * rows for the device and rated current, they are its time–current curve (KA4): Ia can be read between the points, and the time
 * the curve gives at the circuit's Ik1 is shown. Nothing is read outside the entered points.
 */
export const disconnectionModule: CalcModule = defineCalculator({
  id: "disconnection",
  name: "Frånkopplingstid",
  summary: "Klarar skyddet kravtiden? Zs, Ia, marginal och Zs max.",
  groups: {
    circuit: { title: "Kretsen", hint: "Slingimpedansen vid slutet av kretsen: fas ut och skyddsledare tillbaka." },
    device: { title: "Skyddsapparat", hint: "Utlösningsströmmen Ia gäller kravtiden och anges av företaget eller skrivs in." },
    conditions: { title: "Beräkningsvillkor", collapsed: true },
  },
  inputs: [
    { kind: "choice", id: "known", label: "Slingan anges som", options: [{ value: "zs", label: "Zs" }, { value: "ik1", label: "Ik1" }], initial: "zs", display: "segmented", group: "circuit" },
    { kind: "number", id: "zs", label: "Slingimpedans Zs", dimension: "resistance", defaultUnit: "Ω", required: true, min: 0, minExclusive: true, group: "circuit", showIf: (choices) => choices.known === "zs", example: "0,35", help: "Välj Ω eller mΩ vid fältet." },
    { kind: "number", id: "ik1", label: "Jordslutningsström Ik1", dimension: "current", required: true, min: 0, minExclusive: true, group: "circuit", showIf: (choices) => choices.known === "ik1", example: "650" },
    { kind: "number", id: "u0", label: "Fasspänning U0", dimension: "voltage", initial: "230", required: true, min: 0, minExclusive: true, usual: [50, 1000], group: "circuit" },
    ...deviceInputs("device"),
    cFactorInput("c", "Spänningsfaktor c", "smallest", "conditions", "Minsta ström, t.ex. enligt IEC 60909-0 – värdet anges av företaget. Tomt fält: företagets värde, annars 1,0."),
  ],
  outputs: [
    { id: "verdict", label: "Resultat" }, { id: "ik1", label: "Ik1", dimension: "current" }, { id: "zsMax", label: "Zs max", dimension: "resistance" },
  ],
  example: {
    numbers: { zs: { text: "0,35", unit: "Ω" }, u0: { text: "230" }, rated: { text: "16" }, time: { text: "0,4" }, trip: { text: "145" } },
    choices: { known: "zs", device: "c" },
  },
  help: [
    "Fyll i kretsens slingimpedans Zs (eller jordslutningsströmmen Ik1), välj skyddsapparat och ange märkström och kravtid. Utlösningsströmmen Ia hämtas från företagets egna skyddsapparater om raden finns.",
    "Annars skriver du in Ia enligt tillverkarens tid–strömkurva för kravtiden (SS-EN 60898-1 för minibrytare). Workflow föreslår inget värde; utan Ia visas inget resultat.",
    "Spänningsfaktorn c är företagets värde eller ditt eget. Utan värde används 1,0, och det står i resultatet.",
    "Skyddet klarar kravet när Ik1 är minst lika stor som Ia, eller när Zs är högst Zs max. Marginalen visas i ohm och procent.",
    "Flera rader med samma skydd och märkström i Mina skyddsapparater är företagets kurva. Då visas också tiden kurvan ger vid Ik1. Mellan två punkter läses en smältsäkring längs linjen i log–log-diagrammet och andra skydd på säkra sidan. Utanför punkterna läses inget.",
    "Resultatet är ett beräkningsunderlag. Bedömningen görs av en behörig person.",
  ],
  compute: ({ numbers, origins, choices, company }) => {
    const c = numbers.c!;
    const u0 = numbers.u0!;
    // A given Ik1 is the circuit's current at U0 (measured): the loop is Zs = U0 / Ik1, and the smallest current then takes c like
    // a given Zs (the granskning 2026-10-31: with c in both steps it cancelled and the answer was about 5 % too optimistic).
    const zs = choices.known === "ik1" ? u0 / numbers.ik1! : numbers.zs!;
    const result = checkDisconnection({ loopImpedance: zs, u0V: u0, tripCurrentA: numbers.trip!, requiredTimeS: numbers.time, c, ratedCurrentA: numbers.rated });
    if (!result.ok) return failure(result.errors, { loopImpedance: choices.known === "ik1" ? "ik1" : "zs", u0: "u0", tripCurrent: "trip", c: "c", time: "time" });
    const ok = result.meetsRequirement;
    const detail = ok
      ? `Ik1 ${formatQuantity(result.ik1A, "current")} är minst Ia ${formatQuantity(result.tripCurrentA, "current")}${originSuffix(origins.trip)} (marginal ${formatNumber(result.marginPercent)} %).`
      : `Ik1 ${formatQuantity(result.ik1A, "current")} är lägre än Ia ${formatQuantity(result.tripCurrentA, "current")}${originSuffix(origins.trip)} (${formatNumber(result.marginPercent)} %). Zs får vara högst ${formatQuantity(result.zsMaxOhm, "resistance")}.`;
    const rows: OutputRow[] = [
      requirementVerdict("verdict", "Frånkoppling", ok, origins.trip, detail),
      quantity("zsMax", "Zs max (högsta tillåtna slingimpedans)", result.zsMaxOhm, "resistance", { primary: true, short: "Zs max" }),
      quantity("ik1", "Jordslutningsström Ik1", result.ik1A, "current", { primary: true, short: "Ik1" }),
      quantity("zs", "Slingimpedans Zs", result.zsOhm, "resistance"),
      quantity("margin", "Marginal, Zs max − Zs", result.zsMarginOhm, "resistance", { tone: ok ? "ok" : "alarm" }),
      quantity("marginPercent", "Marginal i procent, (Ik1 / Ia − 1)", result.marginPercent, "percent", { tone: ok ? "ok" : "alarm" }),
      quantity("trip", "Utlösningsström Ia", result.tripCurrentA, "current"),
    ];
    const curveNotes: Note[] = [];
    const curve = deviceCurve(company, choices.device, numbers.rated);
    if (curve) {
      const type = choices.device as DeviceType;
      const onCurve = tripTimeOnCurve(curve, result.ik1A, curveMethodFor(type));
      if (!onCurve) curveNotes.push({ tone: "warn", text: `Företagets kurva för ${deviceName(type)} ${formatQuantity(numbers.rated!, "current")} används inte: Ia ska bli lägre, eller vara lika, när tiden blir längre.` });
      else if (onCurve.kind === "below") curveNotes.push({ tone: "warn", text: `Ik1 ${formatQuantity(result.ik1A, "current")} är lägre än kurvans lägsta punkt (${formatQuantity(onCurve.lowestA, "current")} vid ${formatQuantity(onCurve.longestS, "time")}). Kurvan visar ingen frånkoppling vid den strömmen.` });
      else rows.push(quantity("curveTime", onCurve.how === "atMost" ? "Tid enligt företagets kurva, högst" : "Tid enligt företagets kurva", onCurve.timeS, "time"));
    }
    const mohm = (value: number) => formatQuantity(value, "resistance");
    const steps = [
      ...(choices.known === "ik1" ? [`Slingimpedans ur Ik1: Zs = U0 / Ik1 = ${formatQuantity(u0, "voltage")} / ${formatQuantity(numbers.ik1!, "current")} = ${mohm(zs)}.`] : []),
      `Skydd: ${deviceName(choices.device)} ${formatQuantity(numbers.rated!, "current")}, kravtid ${formatQuantity(numbers.time!, "time")}, Ia = ${formatQuantity(result.tripCurrentA, "current")}${originSuffix(origins.trip)}.`,
      `Jordslutningsström: Ik1 = c × U0 / Zs = ${formatNumber(c)}${originSuffix(origins.c)} × ${formatQuantity(u0, "voltage")} / ${mohm(result.zsOhm)} = ${formatQuantity(result.ik1A, "current")}.`,
      `Högsta slingimpedans: Zs max = c × U0 / Ia = ${formatNumber(c)} × ${formatQuantity(u0, "voltage")} / ${formatQuantity(result.tripCurrentA, "current")} = ${mohm(result.zsMaxOhm)}.`,
      `Jämförelse: Ik1 ${ok ? "≥" : "<"} Ia, det vill säga Zs ${ok ? "≤" : ">"} Zs max.`,
    ];
    return {
      status: "ok", rows, steps,
      notes: [...warningNotes(result.warnings), ...curveTripNote(origins as Record<string, Origin>, choices, numbers, company), ...curveNotes, ...neutralNote(origins as Record<string, Origin>, numbers, { c: { name: "spänningsfaktorn c" } })],
    };
  },
});
