import { formDocumentSchema, type FormDocument } from "./form-document";
import { formMetaSchema, type FormMeta } from "./form-publish";
import { LIMIT_HELP } from "../kfid/guidance";

/**
 * Workflow's own inspection types (2026-09-26): Termografering, Fortlöpande kontroll, Isolationsmätning – kabelnät
 * and Följelinemätning (strömkvot). They are ordinary published forms – versioned data drawn by the shared form engine –
 * so they work in projects, planning, time, progression, PDF, Local and Cloud like every other protocol, and the
 * superadmin can refine them in "Skapa formulär" without a deploy. Migrations publish them; nothing here runs at
 * request time.
 *
 * Copyright precaution (2026-10-06): Workflow is a framework. No organisation or manufacturer names, nothing
 * taken from standards, manuals or publishers' documents, and no limit values: where a measurement has an acceptance
 * criterion, the person enters the limit from the instrument or the company's own limit profile and the form compares
 * the value with it. A row without a limit is not judged. Emissivity and the control interval are input defaults the
 * person changes, not limits.
 *
 * Slimmed (2026-10-02: "det är väldigt mycket att kontrollera – ta med det mest relevanta, kunden bygger själv
 * på"): each control holds what is always measured or judged; a company adds its own fields in Skapa formulär. The
 * texts name no standards or sources.
 */

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${++counter}`;
type Width = "quarter" | "third" | "half" | "two_thirds" | "three_quarters" | "full";
type Extra = Record<string, unknown>;

const field = (key: string, label: string, input: string, extra: Extra = {}) => ({ id: nextId("f"), type: "field", key, label, input, width: input === "textarea" ? "full" : "third" as Width, ...extra });
const column = (key: string, label: string, input: string, extra: Extra = {}) => ({ id: nextId("c"), key, label, input, ...extra });
const table = (key: string, label: string, columns: unknown[], extra: Extra = {}) => ({ id: nextId("t"), type: "table", key, label, columns, rowMode: "free", ...extra });
const checklist = (key: string, label: string, items: string[], extra: Extra = {}) => ({ id: nextId("l"), type: "checklist", key, label, items: items.map((text, index) => ({ id: `${key}-${index + 1}`, text })), ...extra });
const computed = (key: string, label: string, formula: string, extra: Extra = {}) => ({ id: nextId("r"), type: "computed", key, label, formula, width: "third" as Width, ...extra });
const signature = (key: string, label: string) => ({ id: nextId("s"), type: "signature", key, label, required: true, width: "half" as Width });
const section = (title: string, blocks: unknown[], extra: Extra = {}) => ({ id: nextId("a"), type: "section", title, blocks, ...extra });
const document = (blocks: unknown[], extra: Extra = {}): FormDocument => formDocumentSchema.parse({ schema: 2, blocks, ...extra });
// ---------------------------------------------------------------------------------------------------------------
// Termografering
// ---------------------------------------------------------------------------------------------------------------
// One card per object with its temperatures, the thermographer's judgement and the pictures. The limit for ΔT depends
// on the assessment basis of the assignment, so the company sets it under Värden och referenser (or per facility under
// Gränsvärden) – never a number of our own.
const thermography = document([
  section("Mätförutsättningar", [
    field("matdatum", "Mättillfälle", "datetime", { required: true }),
    field("kamera", "Värmekamera (fabrikat och modell)", "text", { required: true }),
    field("omgivning", "Omgivningstemperatur", "number", { unit: "°C", required: true, width: "quarter" }),
    field("emissivitet", "Emissivitet", "number", { defaultValue: 0.95, allowedMin: 0.01, allowedMax: 1, decimals: 2, width: "quarter" }),
    field("driftlage", "Anläggningens driftläge", "choice", { options: ["Normal drift", "Hög last", "Låg last", "Varierande last"], required: true }),
  ]),
  section("Objekt", [
    table("objekt", "Termograferade objekt", [
      column("objekt", "Objekt / position", "text", { required: true, help: "T.ex. Central A1, grupp 12." }),
      column("komponent", "Komponent", "choice", { options: ["Säkring", "Brytare", "Kontaktor", "Kabelanslutning", "Skena", "Transformator", "Övrigt"] }),
      column("maxtemp", "Högsta temperatur", "number", { unit: "°C", required: true }),
      column("reftemp", "Referenstemperatur", "number", { unit: "°C", help: "Jämförbar komponent eller fas med samma belastning." }),
      column("deltat", "Temperaturskillnad ΔT", "formula", { formula: "[maxtemp] - [reftemp]", unit: "K", limitKey: "delta_ref" }),
      column("last", "Belastning", "number", { unit: "A" }),
      column("bedomning", "Bedömning", "choice", { required: true, options: ["Ingen anmärkning", "Bevaka", "Åtgärda planerat", "Åtgärda omgående"], deviationOptions: ["Åtgärda planerat", "Åtgärda omgående"] }),
      column("atgard", "Iakttagelse och rekommenderad åtgärd", "textarea"),
      column("termobild", "Termografibild", "images"),
      column("foto", "Fotografi", "images"),
    ], { layout: "cards", itemLabel: "Objekt", required: true, workOrders: true }),
    computed("antal", "Antal objekt", "ANTAL(objekt.objekt)"),
    computed("omgaende", "Åtgärda omgående", "ANTAL.OM(objekt.bedomning; \"Åtgärda omgående\")"),
  ]),
  section("Sammanfattning och signering", [
    field("sammanfattning", "Sammanfattning", "textarea", { help: "Övergripande resultat och rekommendationer till beställaren." }),
    signature("termograf", "Termograferad av"),
  ]),
], {
  limits: [{ key: "delta_ref", label: "ΔT mot referens", unit: "K", help: "Larm- och varningsnivå anges under Inställningar → Värden och referenser eller per anläggning." }],
});

// ---------------------------------------------------------------------------------------------------------------
// Fortlöpande kontroll
// ---------------------------------------------------------------------------------------------------------------
const recurring = document([
  section("Kontrolltillfälle", [
    field("kontrolldatum", "Kontrolldatum", "date", { required: true }),
    field("intervall", "Kontrollintervall", "number", { unit: "mån", required: true, defaultValue: 12, allowedMin: 1, allowedMax: 120, decimals: 0 }),
    computed("nasta", "Nästa kontroll senast", "EDATUM(kontrolldatum; intervall)"),
    field("omfattning", "Omfattning", "choice", { options: ["Hela anläggningen", "Del av anläggningen", "Uppföljning av anmärkningar"], required: true }),
    field("tidigare_atgardade", "Anmärkningar från föregående kontroll åtgärdade", "yesno", { deviationOn: "NO", width: "two_thirds" }),
  ]),
  section("Kontrollpunkter", [
    checklist("kontrollpunkter", "Kontrollpunkter", [
      "Elcentraler: märkning och gruppförteckning",
      "Kapslingar, luckor och beröringsskydd hela",
      "Kablar och ledningar utan synliga skador",
      "Inga tecken på överhettning (lukt, missfärgning, varma kapslingar)",
      "Jordfelsbrytare provade med testknapp",
      "Skyddsutjämning och jordningar synligt intakta",
      "Fritt utrymme framför elcentraler, inget brännbart vid elutrustning",
      "Nödbelysning fungerar",
      "Tillfälliga installationer och skarvsladdar i gott skick",
      "Dokumentationen är aktuell",
    ], { photos: true, deviationTable: "anmarkningar" }),
  ]),
  section("Anmärkningar och åtgärder", [
    table("anmarkningar", "Anmärkningar", [
      column("beskrivning", "Anmärkning", "text", { required: true }),
      column("plats", "Plats", "text"),
      column("klass", "Klassning", "choice", { options: ["Observation", "Åtgärdas snarast", "Omedelbar fara"], deviationOptions: ["Åtgärdas snarast", "Omedelbar fara"], required: true, help: "Välj efter företagets rutin. Åtgärdas snarast och Omedelbar fara räknas som avvikelser och kan bli en arbetsorder." }),
      column("atgard", "Åtgärd", "textarea"),
      column("klart", "Åtgärdas senast", "date"),
      column("foto", "Foto", "images"),
    ], { layout: "cards", itemLabel: "Anmärkning", workOrders: true }),
    computed("antal_anm", "Antal anmärkningar", "ANTAL(anmarkningar.beskrivning)"),
  ]),
  section("Signering", [
    field("sammanfattning", "Sammanfattning", "textarea"),
    signature("kontrollant", "Kontrollerad av"),
  ]),
]);

// ---------------------------------------------------------------------------------------------------------------
// Isolationsmätning
// ---------------------------------------------------------------------------------------------------------------
// One row per measurement of a part of the installation, the measured value against the requirement the person enters.
// Low and high voltage use the same rows; the test voltage says which.
const insulation = document([
  section("Mätförutsättningar", [
    field("matdatum", "Mätdatum", "date", { required: true }),
    field("instrument", "Mätinstrument", "text", { required: true, prefill: "instrument" }),
    field("spanning", "Mätspänning", "choice", { required: true, options: ["250 V", "500 V", "1000 V", "2500 V", "5000 V", "10 000 V"] }),
    field("frankopplad", "Objektet frånkopplat och spänningslöshet kontrollerad", "yesno", { required: true, allowNotApplicable: false, deviationOn: "NO", width: "two_thirds" }),
  ]),
  section("Mätningar", [
    table("matningar", "Isolationsmätningar", [
      column("objekt", "Anläggningsdel / kabel", "text", { required: true, help: "T.ex. gruppcentral, apparatskåp, huvudledning eller kabel." }),
      column("matning", "Mätning mellan", "choice", { required: true, options: ["L1+L2+L3+N–PE", "L1–PE", "L2–PE", "L3–PE", "N–PE", "L1–L2", "L1–L3", "L2–L3", "Ledare–skärm"] }),
      column("uppmatt", "Uppmätt", "number", { unit: "MΩ", required: true, total: "min" }),
      column("krav", "Krav (lägst)", "number", { unit: "MΩ", limitDefault: "isolation_min", help: LIMIT_HELP }),
      column("godkand", "Godkänd", "formula", { formula: "[uppmatt] >= [krav]", passCondition: true }),
      column("kommentar", "Anmärkning", "text"),
    // Measurement rows like the control's Isolation: they stack on a phone instead of scrolling sideways.
    ], { required: true, layout: "rows", startEmpty: true, emptyTitle: "Inga mätningar ännu. Lägg till din första rad." }),
    computed("lagsta", "Lägsta uppmätta värde", "MIN(matningar.uppmatt)", { unit: "MΩ" }),
    computed("underkanda", "Mätningar under krav", "ANTAL.OM(matningar.godkand; FALSKT)"),
  ]),
  section("Kommentarer och signering", [
    field("kommentar", "Kommentarer", "textarea"),
    signature("matare", "Mätt av"),
  ]),
// The same key as Kontroll före idrifttagning's insulation limit (2026-10-06): the company enters the value once.
], { limits: [{ key: "isolation_min", label: "Isolationsresistans, lägsta", unit: "MΩ", help: "Fylls i som Krav på nya mätrader." }] });

// ---------------------------------------------------------------------------------------------------------------
// Följelinemätning (strömkvot)
// ---------------------------------------------------------------------------------------------------------------
// Earthing check of a connected cable network: a measuring current is sent out in the cable and the part that returns
// outside it is read; the quotient I y / I mät is compared with two limits. The limit fields are filled in from the
// company's values under Värden och referenser (2026-10-06) and can be changed in the protocol – never values of our
// own; while one is empty its column is not judged.
const followWire = document([
  section("Mätning", [
    field("matdatum", "Mätdatum", "date", { required: true }),
    field("natomrade", "Fördelningsnät", "text"),
    field("instrument", "Instrument", "text", { required: true, prefill: "instrument", help: "Instrumentets typ och serienummer." }),
    field("grans_skarm", "Kvot högst för intakt skärmförbindelse", "number", { allowedMin: 0, allowedMax: 1, decimals: 2, width: "half", limitDefault: "kvot_skarm_max", help: LIMIT_HELP }),
    field("grans_jord", "Kvot lägst för betryggande yttre jordförbindelser", "number", { allowedMin: 0, allowedMax: 1, decimals: 2, width: "half", limitDefault: "kvot_jord_min", help: LIMIT_HELP }),
  ]),
  section("Mätsträckor", [
    table("matpunkter", "Mätsträckor", [
      column("fran", "Från kontrollpunkt", "text", { required: true }),
      column("till", "Till kontrollpunkt", "text", { required: true }),
      column("kabel", "Kabeltyp och area", "text"),
      column("langd", "Längd", "number", { unit: "km" }),
      column("imat", "Mätström I mät", "number", { unit: "A", required: true }),
      column("iy", "Yttre ström I y", "number", { unit: "A", required: true }),
      column("umat", "Mätspänning U mät", "number", { unit: "V" }),
      column("kvot", "Kvot I y / I mät", "formula", { formula: "AVRUNDA([iy] / [imat]; 2)" }),
      column("skarm_ok", "Skärmförbindelse intakt", "formula", { formula: "[iy] / [imat] <= grans_skarm", passCondition: true }),
      column("jord_ok", "Yttre jordförbindelser betryggande", "formula", { formula: "[iy] / [imat] >= grans_jord", passCondition: true }),
      column("kommentar", "Anmärkning", "text"),
    // One card per stretch, readable on a phone.
    ], { required: true, layout: "cards", itemLabel: "Mätsträcka", itemLabelPlural: "mätsträckor", cardTitle: "{fran} – {till}" }),
    computed("besiktiga_skarm", "Skärmförbindelser att besiktiga", "ANTAL.OM(matpunkter.skarm_ok; FALSKT)"),
    computed("besiktiga_jord", "Yttre jordförbindelser att besiktiga", "ANTAL.OM(matpunkter.jord_ok; FALSKT)"),
  ]),
  section("Observationer och signering", [
    field("observationer", "Observationer och åtgärder", "textarea"),
    signature("matare", "Mätt av"),
  ]),
], { limits: [
  { key: "kvot_skarm_max", label: "Strömkvot, högst för intakt skärmförbindelse", unit: "", help: "Fylls i i protokollets gränsfält." },
  { key: "kvot_jord_min", label: "Strömkvot, lägst för betryggande yttre jordförbindelser", unit: "", help: "Fylls i i protokollets gränsfält." },
] });

export type BuiltinForm = { id: string; meta: FormMeta; document: FormDocument };

/** Fixed ids so the migration is idempotent and the forms can be recognised in tests and in the demo. */
export const BUILTIN_FORMS: BuiltinForm[] = [
  { id: "hintek-termografering", document: thermography, meta: formMetaSchema.parse({
    name: "Termografering", icon: "thermometer", color: "rose", category: "ELECTRICAL",
    description: "Termografering av elcentraler och anslutningar: temperatur, bedömning och bilder per objekt.",
  }) },
  { id: "hintek-fortlopande-kontroll", document: recurring, meta: formMetaSchema.parse({
    name: "Fortlöpande kontroll", icon: "list-checks", color: "blue", category: "ELECTRICAL",
    description: "Återkommande kontroll av elanläggning: kontrollpunkter, anmärkningar och nästa kontroll.",
  }) },
  // The ids keep their old suffix: they are internal, and protocols and migrations refer to them.
  { id: "hintek-isolationsmatning-ebr", document: insulation, meta: formMetaSchema.parse({
    name: "Isolationsmätning – kabelnät", icon: "gauge", color: "violet", category: "POWER",
    description: "Isolationsmätning: uppmätt värde mot krav per anläggningsdel, för låg- och högspänning.",
  }) },
  { id: "hintek-foljelinematning-ebr", document: followWire, meta: formMetaSchema.parse({
    name: "Följelinemätning (strömkvot)", icon: "plug", color: "cyan", category: "POWER",
    description: "Jordningskontroll i kabelnät: mätström, yttre ström och kvot per mätsträcka mot angivna gränser.",
  }) },
];
