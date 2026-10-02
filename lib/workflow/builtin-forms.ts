import { formDocumentSchema, type FormDocument } from "./form-document";
import { formMetaSchema, type FormMeta } from "./form-publish";

/**
 * HINTEK's own inspection types (2026-09-26): Termografering, Fortlöpande kontroll, Isolationsmätning – EBR and
 * Följelinemätning – EBR. They are ordinary published forms – versioned data drawn by the shared form engine – so they
 * work in projects, planning, time, progression, PDF, Local and Cloud like every other protocol, and the superadmin
 * can refine them in "Skapa formulär" without a deploy. A migration publishes version 1 once; nothing here runs at
 * request time.
 *
 * No limit values are invented: where a measurement has an acceptance criterion, the person enters the requirement
 * that applies to the object and the form compares the value with it.
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
// on the assessment basis of the assignment, so it is set per company under Gränsvärden – never a number of our own.
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
  limits: [{ key: "delta_ref", label: "ΔT mot referens", unit: "K", source: "Sätts per företag efter den bedömningsgrund uppdraget anger" }],
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
      column("klass", "Klassning", "choice", { options: ["Observation", "Åtgärdas snarast", "Omedelbar fara"], deviationOptions: ["Åtgärdas snarast", "Omedelbar fara"], required: true, help: "Omedelbar fara: anläggningsdelen tas ur bruk." }),
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
// As the protocols used in the field: one row per measurement of a part of the installation, the measured value against
// the requirement the person enters. Low and high voltage use the same rows; the test voltage says which.
const insulation = document([
  section("Mätförutsättningar", [
    field("matdatum", "Mätdatum", "date", { required: true }),
    field("instrument", "Mätinstrument", "text", { required: true }),
    field("spanning", "Mätspänning", "choice", { required: true, options: ["250 V", "500 V", "1000 V", "2500 V", "5000 V", "10 000 V"] }),
    field("frankopplad", "Objektet frånkopplat och spänningslöshet kontrollerad", "yesno", { required: true, allowNotApplicable: false, deviationOn: "NO", width: "two_thirds" }),
  ]),
  section("Mätningar", [
    table("matningar", "Isolationsmätningar", [
      column("objekt", "Anläggningsdel / kabel", "text", { required: true, help: "T.ex. gruppcentral, apparatskåp, huvudledning eller kabel." }),
      column("matning", "Mätning mellan", "choice", { required: true, options: ["L1+L2+L3+N–PE", "L1–PE", "L2–PE", "L3–PE", "N–PE", "L1–L2", "L1–L3", "L2–L3", "Ledare–skärm"] }),
      column("uppmatt", "Uppmätt", "number", { unit: "MΩ", required: true, total: "min" }),
      column("krav", "Krav (lägst)", "number", { unit: "MΩ" }),
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
]);

// ---------------------------------------------------------------------------------------------------------------
// Följelinemätning (Ymermätning)
// ---------------------------------------------------------------------------------------------------------------
// Earthing check of a connected cable network, as it is made with the Ymer instrument: a measuring current is sent out
// in the cable and the part that returns outside it is read. The quotient I y / I mät tells two things – whether the
// screen connection is intact and whether the parallel outer earth connections are adequate. The two limits are fields
// with the usual values filled in, so they are visible in the protocol and can be changed.
const followWire = document([
  section("Mätning", [
    field("matdatum", "Mätdatum", "date", { required: true }),
    field("natomrade", "Fördelningsnät", "text"),
    field("instrument", "Instrument", "text", { required: true, help: "T.ex. Ymer." }),
    field("grans_skarm", "Kvot högst för intakt skärmförbindelse", "number", { defaultValue: 0.9, allowedMin: 0, allowedMax: 1, decimals: 2, width: "half" }),
    field("grans_jord", "Kvot lägst för betryggande yttre jordförbindelser", "number", { defaultValue: 0.3, allowedMin: 0, allowedMax: 1, decimals: 2, width: "half" }),
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
    // One card per stretch, as the paper protocol has one sheet per stretch; readable on a phone.
    ], { required: true, layout: "cards", itemLabel: "Mätsträcka", itemLabelPlural: "mätsträckor", cardTitle: "{fran} – {till}" }),
    computed("besiktiga_skarm", "Skärmförbindelser att besiktiga", "ANTAL.OM(matpunkter.skarm_ok; FALSKT)"),
    computed("besiktiga_jord", "Yttre jordförbindelser att besiktiga", "ANTAL.OM(matpunkter.jord_ok; FALSKT)"),
  ]),
  section("Observationer och signering", [
    field("observationer", "Observationer och åtgärder", "textarea"),
    signature("matare", "Mätt av"),
  ]),
]);

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
  { id: "hintek-isolationsmatning-ebr", document: insulation, meta: formMetaSchema.parse({
    name: "Isolationsmätning – EBR", icon: "gauge", color: "violet", category: "POWER",
    description: "Isolationsmätning: uppmätt värde mot krav per anläggningsdel, för låg- och högspänning.",
  }) },
  { id: "hintek-foljelinematning-ebr", document: followWire, meta: formMetaSchema.parse({
    name: "Följelinemätning – EBR", displayName: "Följelinemätning – EBR (Ymermätning)", icon: "plug", color: "cyan", category: "POWER",
    description: "Jordningskontroll i kabelnät med Ymer: mätström, yttre ström och kvot per mätsträcka.",
  }) },
];
