import { adiabaticK, sizeCable, type RatingRow, type ShortCircuitDuty } from "../engine";
import { companyFallback, materialChoiceInput, materialDataInputs, MATERIAL_GROUPS, materialOf } from "../conductor";
import { defineCalculator } from "../define";
import { formatNumber } from "../number";
import type { CalcModule, Choices, Note, Origin, OutputRow } from "../types";
import { formatQuantity } from "../units";
import { NO_LIMIT } from "../voltage-drop";
import { COMPANY_VALUES_LINK, failure, neutralNote, operatingTemperatureInput, originSuffix, parallelInput, parallelOf, quantity, reactanceFor, reactanceInput, verdict, warningNotes } from "./shared";
import { parseRatings, ratingsOfTable } from "./ratings";

/**
 * Kabeldimensionering (Kalkylator, 2026-10-12): the smallest area that meets three things at once – the current
 * (the cable's rating Iz must cover the load and the device's rated current), the voltage drop and the short-circuit
 * withstand (k²·S² ≥ I²·t). The engine (`sizeCable`) does it.
 *
 * Iz is INPUT: the person types the cable's ratings (area and current on each line) or picks one of the company's own
 * tables (Värden och referenser); Workflow delivers none. Without a table the continuous minimum areas for the voltage
 * drop and the short circuit are still given. The adiabatic k is typed, or calculated from the material's physical
 * constants and the conductor's temperature before and at the end of the short circuit – the cable's datasheet or the
 * company's values (2026-11-01: no temperatures are built in). Without k or both temperatures the short-circuit
 * withstand is not checked, and the result asks for them. With conductors in parallel the areas and Iz are per conductor
 * (KA4, 2026-11-01); the short-circuit check keeps the whole current.
 */
const nominal = (choices: Choices) => (choices.phases === "1" ? "230" : "400");

export const cableSizingModule: CalcModule = defineCalculator({
  id: "cable-sizing",
  name: "Kabeldimensionering",
  summary: "Minsta area för ström, spänningsfall och kortslutningsstålighet.",
  groups: {
    load: { title: "Last och skydd" },
    cable: { title: "Kabel" },
    ratings: { title: "Strömvärden Iz", hint: "Kabelns belastbarhet per area i er förläggning. Workflow levererar ingen tabell." },
    limit: { title: "Spänningsfall", hint: "Tillåtet fall anger du själv eller hämtar från företagets värden." },
    shortCircuit: { title: "Kortslutningsstålighet (valfritt)", hint: "Största kortslutningsström kabeln ska tåla tills skyddet kopplat från, och tiden.", collapsed: true },
    ...MATERIAL_GROUPS,
  },
  inputs: [
    { kind: "choice", id: "phases", label: "System", options: [{ value: "3", label: "Trefas" }, { value: "1", label: "Enfas" }], initial: "3", display: "segmented", group: "load" },
    { kind: "number", id: "u", label: "Märkspänning U", dimension: "voltage", initial: nominal, required: true, min: 0, minExclusive: true, usual: [12, 40000], group: "load", help: "Huvudspänning vid trefas, fasspänning vid enfas." },
    { kind: "number", id: "i", label: "Belastningsström Ib", dimension: "current", required: true, min: 0, minExclusive: true, usual: [0.01, 50000], group: "load", example: "40" },
    { kind: "number", id: "cosphi", label: "Effektfaktor cos φ", dimension: "ratio", initial: "1", min: 0, minExclusive: true, max: 1, group: "load", fallback: () => ({ value: 1, origin: "default", note: "cos φ 1" }) },
    { kind: "number", id: "rated", label: "Skyddets märkström In", dimension: "current", min: 0, minExclusive: true, group: "load", example: "50", help: "Valfritt. Kabeln ska också tåla märkströmmen." },
    { kind: "number", id: "len", label: "Kabellängd (enkel väg)", dimension: "length", required: true, min: 0, minExclusive: true, usual: [0.1, 20000], group: "cable", example: "60" },
    materialChoiceInput("cable"),
    parallelInput("parallel", "cable"),
    operatingTemperatureInput("cable"),
    reactanceInput("cable"),
    { kind: "number", id: "derating", label: "Korrektionsfaktor", dimension: "ratio", min: 0, minExclusive: true, group: "ratings", example: "0,87", help: "Förläggning, gruppering och omgivningstemperatur samlade till en faktor. Tomt fält: 1." },
    {
      kind: "choice", id: "table", label: "Iz-tabell", group: "ratings", initial: "t1", hideWhenSingle: true, display: "select",
      options: (ctx) => [...ctx.company.ampacity.map((table) => ({ value: `t${table.slot}`, label: `Företagets tabell: ${table.name}` })), { value: "own", label: "Egen tabell (skriv in)" }],
    },
    { kind: "text", id: "ratings", label: "Strömvärden Iz, area och ström på varje rad", group: "ratings", rows: 6, placeholder: "t.ex. en rad per area:\n2,5  20", showIf: (choices) => choices.table === "own" },
    {
      kind: "number", id: "allowed", label: "Tillåtet spänningsfall", dimension: "percent", min: 0, minExclusive: true, max: 100, group: "limit", example: "3",
      fallback: (_choices, ctx) => companyFallback(ctx.company.dropLimitPct), help: "Procent. Tomt fält: företagets värde, annars kontrolleras inte spänningsfallet.",
    },
    { kind: "number", id: "faultCurrent", label: "Kortslutningsström", dimension: "current", defaultUnit: "kA", min: 0, minExclusive: true, group: "shortCircuit", example: "6" },
    { kind: "number", id: "faultTime", label: "Frånkopplingstid", dimension: "time", min: 0, minExclusive: true, group: "shortCircuit", example: "0,1" },
    {
      kind: "number", id: "kStart", label: "Ledartemperatur före kortslutning", dimension: "temperature", min: -60, max: 500, group: "shortCircuit",
      fallback: (_choices, ctx) => companyFallback(ctx.company.kTempStart), help: "Enligt kabelns datablad. Används för att räkna k. Tomt fält: företagets värde.",
    },
    {
      kind: "number", id: "kEnd", label: "Högsta ledartemperatur vid kortslutning", dimension: "temperature", min: -60, max: 1000, group: "shortCircuit",
      fallback: (_choices, ctx) => companyFallback(ctx.company.kTempEnd), help: "Enligt kabelns datablad. Används för att räkna k. Tomt fält: företagets värde.",
    },
    {
      kind: "number", id: "k", label: "Konstanten k", dimension: "adiabatic", min: 0, minExclusive: true, group: "shortCircuit",
      fallback: (choices, _ctx, numbers = {}) => {
        const start = numbers.kStart;
        const end = numbers.kEnd;
        if (start === undefined || end === undefined || !(end > start)) return undefined;
        return { value: adiabaticK(materialOf(choices), start, end), origin: "default", note: `Räknat ur materialets egenskaper, ${formatNumber(start)} till ${formatNumber(end)} °C` };
      },
      help: "Kabelns eget k, eller tomt: räknas ur material och de två temperaturerna ovan.",
    },
    ...materialDataInputs(),
  ],
  outputs: [
    { id: "recommended", label: "Minsta area enligt tabellen", dimension: "area" }, { id: "minDrop", label: "Minsta area för spänningsfall", dimension: "area" },
    { id: "minShort", label: "Minsta area för kortslutning", dimension: "area" }, { id: "requiredIz", label: "Iz som behövs", dimension: "current" },
  ],
  example: {
    numbers: { i: { text: "40" }, cosphi: { text: "0,9" }, rated: { text: "50" }, len: { text: "60" }, allowed: { text: "3" }, faultCurrent: { text: "6", unit: "kA" }, faultTime: { text: "0,1" } },
    choices: { phases: "3", material: "cu" },
  },
  help: [
    "Kabeln måste klara tre saker samtidigt: strömmen (Iz minst lika stor som belastningen och skyddets märkström), spänningsfallet och kortslutningsströmmen under frånkopplingstiden.",
    "Strömvärdena Iz anger du själv, en rad per area (area och ström), eller väljer företagets egen tabell om den är inlagd under Värden och referenser. Workflow levererar ingen tabell. Utan tabell visas bara de areor som spänningsfallet och kortslutningen kräver.",
    "Konstanten k för kortslutningsstålighet anger du själv. Annars räknas den ur materialet och kabelns temperaturer före och vid kortslutning enligt databladet (eller företagets värden). Workflow anger inga temperaturer. Ledartemperaturen i drift är din egen eller företagets; utan värde används 20 °C, och det står i resultatet.",
    "Med parallella ledare gäller areor och Iz per ledare, och strömmen antas delas lika. Korrektionsfaktorn ska täcka att ledarna ligger ihop. Kortslutningskontrollen räknar med hela strömmen, så den ligger på säkra sidan.",
    "Resultatet är ett beräkningsunderlag. Dimensioneringen avgörs av en behörig person.",
  ],
  compute: ({ numbers, origins, choices, texts, company }) => {
    const material = materialOf(choices);
    const tableId = choices.table ?? "own";
    const companyTable = /^t[1-9]$/.test(tableId) ? company.ampacity.find((table) => `t${table.slot}` === tableId) : undefined;
    const parsed = companyTable ? { rows: ratingsOfTable(companyTable, material), skipped: 0, duplicates: 0 } : parseRatings(texts.ratings ?? "");
    const ratings: RatingRow[] = parsed.rows;
    let duty: ShortCircuitDuty | undefined;
    const notes: Note[] = [];
    const kMissing = numbers.faultCurrent !== undefined && numbers.faultTime !== undefined && numbers.k === undefined;
    if (numbers.faultCurrent !== undefined && numbers.faultTime !== undefined && numbers.k !== undefined) duty = { faultCurrentA: numbers.faultCurrent, durationS: numbers.faultTime, k: numbers.k };
    else if (kMissing) notes.push({ tone: "missing", text: "Kortslutningsståligheten kontrolleras inte: ange kabelns k, eller ledartemperaturen före kortslutning och den högsta vid kortslutning enligt kabelns datablad. Företagets värden läggs in under", link: COMPANY_VALUES_LINK });
    else if (numbers.faultCurrent !== undefined || numbers.faultTime !== undefined) notes.push({ tone: "info", text: "Ange både kortslutningsström och frånkopplingstid för att kontrollera kortslutningsståligheten." });
    const parallel = parallelOf(choices, "parallel");
    if (parallel > 1) notes.push({ tone: "info", text: `Areor och Iz gäller per ledare, med ${parallel} parallella ledare per fas.` });
    const result = sizeCable({
      parallel, material, temperatureC: numbers.temperature ?? 20, rho20: numbers.rho20, alpha: numbers.alpha,
      phases: choices.phases === "1" ? 1 : 3, voltageV: numbers.u!, loadCurrentA: numbers.i!, lengthM: numbers.len!, cosPhi: numbers.cosphi ?? 1,
      reactancePerM: reactanceFor(numbers, origins), protectiveRatedA: numbers.rated, deratingFactor: numbers.derating, ratings: ratings.length ? ratings : undefined,
      maxDropPercent: numbers.allowed, shortCircuit: duty,
    });
    if (!result.ok) return failure(result.errors, { load: "i", voltage: "u", length: "len", cosPhi: "cosphi", rated: "rated", derating: "derating", allowed: "allowed", faultCurrent: "faultCurrent", duration: "faultTime", k: "k" });
    const rows: OutputRow[] = [];
    if (result.rows.length) {
      rows.push(result.recommendedAreaMm2 !== null
        ? quantity("recommended", "Minsta area enligt tabellen", result.recommendedAreaMm2, "area", { primary: true, short: "Minsta area" })
        : verdict("noneFits", "Tabellen", false, "Ingen area i tabellen uppfyller alla krav. Lägg till större areor eller ändra kraven."));
    }
    rows.push(quantity("requiredIz", parallel > 1 ? "Iz som behövs per ledare (före korrektionsfaktor)" : "Iz som behövs (före korrektionsfaktor)", result.requiredIzA, "current", { primary: result.rows.length === 0, short: "Iz som krävs" }));
    if (result.minAreaForDropMm2 !== null) rows.push(quantity("minDrop", "Minsta area för spänningsfallet", result.minAreaForDropMm2, "area", { primary: result.rows.length === 0, short: "Area för ΔU" }));
    if (result.minAreaForShortCircuitMm2 !== null) rows.push(quantity("minShort", "Minsta area för kortslutningsströmmen", result.minAreaForShortCircuitMm2, "area", { primary: result.rows.length === 0, short: "Area för Ik" }));
    rows.push(quantity("design", "Dimensionerande ström, störst av Ib och In", result.designCurrentA, "current"));
    const chosen = result.rows.find((row) => row.areaMm2 === result.recommendedAreaMm2);
    if (chosen?.dropPercent != null) rows.push(quantity("dropAtChosen", "Spänningsfall med vald area", chosen.dropPercent, "percent"));
    if (chosen?.withstandA != null) rows.push(quantity("withstand", "Kortslutningsström som vald area tål", chosen.withstandA, "current"));

    const yes = (value: boolean | null) => (value === null ? "ej kontrollerat" : value ? "ok" : "inte ok");
    const steps = [
      `Dimensionerande ström: störst av belastningen ${formatQuantity(numbers.i!, "current")} och skyddets märkström${numbers.rated !== undefined ? ` ${formatQuantity(numbers.rated, "current")}` : " (ej angiven)"} = ${formatQuantity(result.designCurrentA, "current")}. Iz behöver vara minst ${formatQuantity(result.requiredIzA, "current")} före korrektionsfaktorn${numbers.derating !== undefined ? ` ${formatNumber(numbers.derating)}` : ""}.`,
      ...(result.minAreaForDropMm2 !== null ? [`Minsta area för spänningsfallet (${formatNumber(numbers.allowed!)} %${originSuffix(origins.allowed)}): ${formatQuantity(result.minAreaForDropMm2, "area")}.`] : []),
      ...(result.minAreaForShortCircuitMm2 !== null && duty ? [`Minsta area för kortslutningen: S = I × √t / k = ${formatQuantity(duty.faultCurrentA, "current")} × √${formatQuantity(duty.durationS, "time")} / ${formatNumber(duty.k)} = ${formatQuantity(result.minAreaForShortCircuitMm2, "area")}${originSuffix(origins.k)}.`] : []),
      ...result.rows.map((row) => `${formatQuantity(row.areaMm2, "area")}: Iz ${formatQuantity(row.izA, "current")}${row.izEffectiveA !== row.izA ? ` (${formatQuantity(row.izEffectiveA, "current")} med faktorn)` : ""} – ström ${yes(row.currentOk)}, spänningsfall ${row.dropPercent === null ? "ej kontrollerat" : `${formatNumber(row.dropPercent)} % – ${yes(row.dropOk)}`}, kortslutning ${yes(row.shortCircuitOk)}.`),
    ];
    if (parsed.skipped) notes.push({ tone: "warn", text: `${parsed.skipped} ${parsed.skipped === 1 ? "rad" : "rader"} i Iz-tabellen hoppades över. Skriv area och ström på varje rad.` });
    if (parsed.duplicates) notes.push({ tone: "warn", text: "En area står flera gånger i Iz-tabellen; den sista raden används." });
    if (numbers.allowed === undefined) notes.push(NO_LIMIT);
    if (!result.rows.length) notes.push({ tone: "info", text: "Ange kabelns Iz per area, eller lägg in företagets egen tabell under", link: COMPANY_VALUES_LINK });
    notes.push(...neutralNote(origins as Record<string, Origin>, numbers, { temperature: { name: "ledartemperaturen", unit: "°C" } }));
    const shown = result.warnings.filter((warning) => warning.code !== "noRatings" && warning.code !== "noDropLimit" && !(kMissing && warning.code === "noShortCircuit"));
    return { status: "ok", rows, steps, notes: [...warningNotes(shown), ...notes] };
  },
});
