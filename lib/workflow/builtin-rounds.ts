import { formDocumentSchema, type FormDocument } from "./form-document";
import { formMetaSchema } from "./form-publish";
import type { BuiltinForm } from "./builtin-forms";

/**
 * New HINTEK controls (2026-09-28, phase 4): Skyddsrond for systematic work environment management, and the rounds
 * module's templates – daily supervision of a hydropower station, a standby generator's test run and a pumping
 * station's supervision. All are ordinary forms drawn by the shared engine: checkpoints judged OK / Ej OK / Ej aktuellt
 * with a camera, deviations registered as rows that can become work orders, numbers with units followed as trends
 * against configurable limits per facility (and unit), and rounds scheduled under Driftronder.
 *
 * No limit values are set here: they depend on the facility, its permit and the manufacturer, and are set per
 * facility under Gränsvärden.
 *
 * Slimmed (2026-10-02: "det är väldigt mycket att kontrollera – ta med det mest relevanta, kunden bygger själv
 * på"): each round holds the points that are looked at every time; a company adds its facility's own points in Skapa
 * formulär. The texts name no standards or sources.
 */
type Extra = Record<string, unknown>;
type Limit = { key: string; label: string; unit: string; source: string };

/** Builds one form: ids from a prefix, limits collected from the measurements that use them. */
function builder(prefix: string) {
  let counter = 0;
  const id = (kind: string) => `${prefix}-${kind}${++counter}`;
  const limits: Limit[] = [];
  const api = {
    limits,
    field: (key: string, label: string, input: string, extra: Extra = {}) => ({ id: id("f"), type: "field", key, label, input, width: input === "textarea" ? "full" : "third", ...extra }),
    /** A measured value with its unit, followed as a trend and judged against a limit whose value comes from `source`. */
    measure: (key: string, label: string, unit: string, source: string, extra: Extra = {}) => {
      limits.push({ key, label, unit, source });
      return { id: id("m"), type: "field", key, label, input: "number", unit, limitKey: key, trend: true, width: "quarter", ...extra };
    },
    count: (key: string, label: string, unit: string, extra: Extra = {}) => ({ id: id("m"), type: "field", key, label, input: "number", unit, trend: true, width: "quarter", ...extra }),
    checks: (key: string, label: string, items: string[], extra: Extra = {}) => ({ id: id("l"), type: "checklist", key, label, mode: "assessment", required: false, photos: true, deviationTable: "avvikelser", items: items.map((text, index) => ({ id: `${key}-${index + 1}`, text })), ...extra }),
    note: (title: string, text: string, style = "notice") => ({ id: id("n"), type: "note", title, text, style }),
    text: (value: string) => ({ id: id("x"), type: "text", text: value }),
    computed: (key: string, label: string, formula: string, extra: Extra = {}) => ({ id: id("r"), type: "computed", key, label, formula, width: "quarter", ...extra }),
    section: (title: string, blocks: unknown[], extra: Extra = {}) => ({ id: id("a"), type: "section", title, blocks, ...extra }),
    signature: (key: string, label: string, extra: Extra = {}) => ({ id: id("s"), type: "signature", key, label, required: true, width: "half", ...extra }),
    /** Deviations found during the round: one card each, with picture, action, responsible and date, and "Skapa arbetsorder". */
    deviations: (label: string, severities: string[], serious: string[], extra: Extra = {}) => ({
      id: id("t"), type: "table", key: "avvikelser", label, layout: "cards", itemLabel: "Avvikelse", itemLabelPlural: "avvikelser", rowMode: "free", startEmpty: true, workOrders: true,
      emptyTitle: "Inga avvikelser registrerade", emptyAction: "Lägg till avvikelse", emptyIcon: "shield-alert",
      help: "En punkt som bedöms Ej OK registreras här med Registrera brist. Lägg till andra avvikelser direkt.", columns: [
        { id: id("c"), key: "punkt", label: "Kontrollpunkt / plats", input: "text", required: true, cardWidth: "half" },
        { id: id("c"), key: "beskrivning", label: "Beskrivning", input: "textarea", required: true, cardWidth: "half" },
        { id: id("c"), key: "allvarlighet", label: "Allvarlighet", input: "choice", options: severities, deviationOptions: serious, required: true, cardWidth: "quarter" },
        { id: id("c"), key: "direkt", label: "Åtgärdad direkt", input: "check", cardWidth: "quarter" },
        { id: id("c"), key: "atgard", label: "Föreslagen åtgärd", input: "textarea", cardWidth: "half" },
        { id: id("c"), key: "ansvarig", label: "Ansvarig", input: "text", group: "Uppföljning", cardWidth: "quarter" },
        { id: id("c"), key: "klart", label: "Klart senast", input: "date", group: "Uppföljning", cardWidth: "quarter" },
        { id: id("c"), key: "atgardad", label: "Åtgärdad datum", input: "date", group: "Uppföljning", cardWidth: "quarter" },
        { id: id("c"), key: "kontrollerad", label: "Kontrollerad av", input: "text", group: "Uppföljning", cardWidth: "quarter" },
        { id: id("c"), key: "bild", label: "Bild", input: "images" },
      ], ...extra }),
  };
  return api;
}
const build = (blocks: unknown[], limits: Limit[], extra: Extra = {}): FormDocument => formDocumentSchema.parse({ schema: 2, blocks, limits, ...extra });
const when = (key: string, value = "YES") => ({ showIf: { key, op: "eq", value } });
const PLANT = "Sätts per anläggning";
const MAKER = "Tillverkarens anvisning";

// ---------------------------------------------------------------------------------------------------------------
// Skyddsrond
// ---------------------------------------------------------------------------------------------------------------
const safetyRound = (() => {
  const b = builder("sr");
  // Each area is a moment that can be switched off, so the round fits the workplace.
  const area = (title: string, key: string, items: string[]) => b.section(title, [b.checks(key, title, items)], { optional: true, defaultOn: true });
  return build([
    b.section("Skyddsrond", [
      b.field("plats", "Arbetsplats / avdelning", "text", { required: true, prefill: "facility" }),
      b.field("datum", "Datum", "date", { required: true, prefill: "today" }),
      b.field("chef", "Arbetsgivarens representant", "text", { required: true }),
      b.field("skyddsombud", "Skyddsombud", "text"),
      b.field("foregaende", "Åtgärder från föregående skyddsrond genomförda", "yesno", { deviationOn: "NO", width: "two_thirds" }),
    ], { newPage: false }),
    area("Ordning och utrymning", "ordning", [
      "Golv, gångytor och transportvägar är fria och utan snubbelrisk", "Material förvaras stabilt",
      "Utrymningsvägar är fria, markerade och öppningsbara", "Brandsläckare är kontrollerade och åtkomliga", "Nödbelysning fungerar",
    ]),
    area("Elsäkerhet", "el", [
      "Elcentraler är stängda, märkta och har fritt utrymme framför", "Kablar, skarvsladdar och uttag är hela",
      "Handhållna elverktyg är hela", "Jordfelsbrytare provas med testknapp",
    ]),
    area("Maskiner och arbetsutrustning", "maskin", [
      "Skydd är hela och inte förbikopplade", "Nödstopp fungerar och är åtkomligt",
      "Utrustningen underhålls och bruksanvisning finns", "Besiktningspliktig utrustning har giltig besiktning",
    ]),
    area("Skyddsutrustning och arbete på höjd", "ppe", [
      "Rätt skyddsutrustning finns, är hel och används", "Stegar och ställningar är hela och används rätt",
      "Öppningar och kanter är skyddade", "Fallskydd används vid arbete på höjd",
    ]),
    area("Kemikalier och första hjälpen", "kemi", [
      "Kemikalier är märkta och rätt förvarade", "Säkerhetsdatablad finns", "Första hjälpen-utrustning är komplett och skyltad", "Ögondusch finns där den behövs",
    ]),
    area("Rutiner och arbetsmiljö", "sam", [
      "Tillbud och olyckor rapporteras och följs upp", "Nyanställda och inhyrda får introduktion",
      "Behörigheter och utbildningsbevis är aktuella", "Arbetsbelastningen är rimlig och ensamarbete är riskbedömt",
    ]),
    b.section("Brister och åtgärder", [
      b.deviations("Brister", ["Låg", "Medel", "Hög"], ["Medel", "Hög"]),
      b.computed("antal", "Antal brister", "ANTAL(avvikelser.punkt)"),
      b.computed("hoga", "Brister med hög risk", "ANTAL.OM(avvikelser.allvarlighet; \"Hög\")"),
    ]),
    b.section("Sammanfattning och signering", [
      { id: "sr-summary", type: "summary", label: "Sammanfattning / avvikelser" },
      b.signature("chef_sign", "Signatur arbetsgivare", { role: "approver", statement: "Skyddsronden är genomförd och bristerna förs in i handlingsplanen" }),
      b.signature("skyddsombud_sign", "Signatur skyddsombud", { role: "reviewer", required: false, distinctFrom: "chef_sign" }),
    ]),
  ], b.limits, { moments: { label: "Områden", requireOne: true, placement: "top" }, report: { title: "Skyddsrond", code: "", taskFacts: true } });
})();

// ---------------------------------------------------------------------------------------------------------------
// Daglig tillsyn – vattenkraftstation (generell mall)
// ---------------------------------------------------------------------------------------------------------------
const hydropower = (() => {
  const b = builder("vk");
  return build([
    b.section("Rond", [
      b.field("tid", "Datum och tid för ronden", "datetime", { required: true }),
      b.field("station", "Station / anläggning", "text", { required: true, prefill: "facility" }),
      b.field("aggregat", "Aggregat", "choice", { options: ["G1", "G2", "G3", "G4", "Hela stationen"], defaultValue: "G1", help: "Gränsvärden kan sättas per aggregat." }),
      b.field("kontrollant", "Kontrollant", "text", { prefill: "user" }),
    ]),
    b.section("Drift", [
      b.field("driftlage", "Driftläge", "choice", { options: ["Drift", "Stopp", "Reserv", "Avställt"], required: true }),
      b.measure("effekt", "Aktuell effekt", "kW", PLANT),
      b.field("larm", "Aktiva larm i styrsystemet", "yesno", { deviationOn: "YES" }),
      b.field("larm_text", "Vilka larm", "text", { width: "two_thirds", ...when("larm") }),
    ]),
    b.section("Vattennivåer och flöden", [
      b.measure("ovy", "Övre vattennivå", "m", PLANT, { width: "third" }),
      b.measure("nvy", "Nedre vattennivå", "m", PLANT, { width: "third" }),
      b.computed("fallhojd", "Fallhöjd", "ovy - nvy", { unit: "m", trend: true, width: "third" }),
      b.measure("minimitappning", "Minimitappning", "m³/s", PLANT),
      b.checks("niva", "Nivå och flöde", ["Övre nivå inom dämnings- och sänkningsgräns", "Minimitappningen är uppfylld"]),
    ]),
    b.section("Damm, luckor och intag", [
      b.measure("gallerdiff", "Nivådifferens över intagsgaller", "cm", PLANT),
      b.checks("damm", "Damm, luckor och intag", [
        "Dammen utan sättningar, sprickor eller nytt läckage", "Luckor i rätt läge, fria från is och drivgods",
        "Intagsgaller rent och gallerrensaren fungerar", "Fiskvägen är fri och har normalt flöde",
      ]),
    ]),
    b.section("Turbin och generator", [
      b.measure("reglerolja_tryck", "Reglerolja, tryck", "bar", MAKER),
      b.measure("barlager", "Lagertemperatur (högsta)", "°C", MAKER),
      b.measure("vibration", "Vibration vid lager", "mm/s", MAKER),
      b.measure("statorlindning", "Statorlindning, temperatur", "°C", MAKER),
      b.checks("turbin", "Turbin och generator", ["Inget onormalt ljud, lukt eller vibration", "Inget läckage av olja eller vatten", "Oljenivåer normala"]),
    ]),
    b.section("Station och säkerhet", [
      b.checks("sakerhet", "Station och säkerhet", [
        "Dränagegrop och länspumpar fungerar", "Batteri och hjälpkraft utan larm", "Ingen oljefilm på vattnet",
        "Livräddningsutrustning och avspärrningar på plats", "Skalskydd, grindar och lås intakta",
      ]),
    ]),
    b.section("Avvikelser och avslut", [
      b.deviations("Avvikelser", ["Observera", "Planeras", "Akut"], ["Planeras", "Akut"]),
      { id: "vk-summary", type: "summary", label: "Sammanfattning / avvikelser" },
      b.signature("kontrollant_sign", "Ronden utförd av", { role: "performer" }),
    ]),
  ], b.limits, { limitObjectKey: "aggregat", report: { title: "Daglig tillsyn", code: "Vattenkraftstation", taskFacts: true } });
})();

// ---------------------------------------------------------------------------------------------------------------
// Tillsyn och provkörning – reservkraftaggregat
// ---------------------------------------------------------------------------------------------------------------
const standby = (() => {
  const b = builder("rk");
  return build([
    b.section("Aggregat och prov", [
      b.field("datum", "Datum", "date", { required: true, prefill: "today" }),
      b.field("aggregat", "Aggregat", "text", { required: true, prefill: "facility" }),
      b.field("provtyp", "Typ av prov", "choice", { options: ["Veckotillsyn (utan last)", "Provkörning med last"], required: true }),
      b.field("kontrollant", "Utfört av", "text", { prefill: "user" }),
    ]),
    b.section("Tillsyn", [
      b.measure("bransle", "Bränslenivå", "%", PLANT),
      b.measure("laddspanning", "Laddspänning startbatteri", "V", MAKER),
      b.checks("motor", "Aggregat", [
        "Inget läckage av olja, bränsle eller kylvätska", "Motorolja och kylvätska på rätt nivå", "Batterier hela, poler rena och åtdragna",
        "Inga aktiva larm", "Driftväljaren står i AUTO",
      ]),
    ]),
    b.section("Provkörning med last", [
      b.measure("starttid", "Tid från start till last", "s", PLANT),
      b.measure("last", "Last", "kW", PLANT),
      b.measure("spanning", "Spänning mellan faser", "V", MAKER),
      b.measure("frekvens", "Frekvens", "Hz", MAKER),
      b.count("provtid", "Provets längd", "h"),
      b.count("timmar", "Drifttimräknare efter prov", "h"),
      b.checks("drift", "Under drift", ["Inga avvikande ljud, vibrationer eller rök"]),
    ], { showIf: { key: "provtyp", op: "neq", value: "Veckotillsyn (utan last)" } }),
    b.section("Avvikelser och signering", [
      b.deviations("Avvikelser", ["Observera", "Åtgärdas", "Akut"], ["Åtgärdas", "Akut"]),
      { id: "rk-summary", type: "summary", label: "Sammanfattning / avvikelser" },
      b.signature("sign", "Utfört av", { role: "performer" }),
    ]),
  ], b.limits, { report: { title: "Reservkraft – tillsyn och provkörning", code: "", taskFacts: true } });
})();

// ---------------------------------------------------------------------------------------------------------------
// Tillsyn – pumpstation
// ---------------------------------------------------------------------------------------------------------------
const pumpStation = (() => {
  const b = builder("ps");
  return build([
    b.section("Pumpstation", [
      b.field("datum", "Datum", "date", { required: true, prefill: "today" }),
      b.field("station", "Pumpstation", "text", { required: true, prefill: "facility" }),
      b.field("pump", "Pump", "choice", { options: ["P1", "P2", "P3", "Hela stationen"], defaultValue: "P1", help: "Gränsvärden kan sättas per pump." }),
      b.field("kontrollant", "Utfört av", "text", { prefill: "user" }),
    ]),
    b.section("Pump", [
      b.count("drifttimmar", "Drifttimräknare", "h"),
      b.measure("strom", "Driftström", "A", MAKER),
      b.checks("pumpkontroll", "Pump", ["Omkopplare i Auto och pumpväxlingen fungerar", "Inga larm från motorskydd eller läckagesensor", "Inget onormalt ljud eller vibration"]),
    ]),
    b.section("Nivåer och larm", [
      b.measure("niva", "Nivå i pumpsumpen", "m", PLANT),
      b.field("bradd", "Bräddning sedan förra tillsynen", "yesno", { deviationOn: "YES", width: "half" }),
      b.checks("nivaer", "Styrning och larm", ["Nivågivare och nivåvippa fungerar", "Larmöverföringen är provad", "Sumpen fri från fett och skräp", "Backventiler och avstängningsventiler täta"]),
    ]),
    b.section("Säkerhet och el", [
      b.field("nedstigning", "Nedstigning i sump eller ventilkammare", "yesno", { allowNotApplicable: false }),
      b.field("gasmatning", "Luftmätning gjord före nedstigning", "yesno", { deviationOn: "NO", ...when("nedstigning") }),
      b.checks("tilltrade", "Säkerhet och el", ["Lock, luckor och stege hela, stationen låst", "Elskåp rent och torrt, jordfelsbrytare provad"]),
    ]),
    b.section("Avvikelser och signering", [
      b.deviations("Avvikelser", ["Observera", "Åtgärdas", "Akut"], ["Åtgärdas", "Akut"]),
      { id: "ps-summary", type: "summary", label: "Sammanfattning / avvikelser" },
      b.signature("sign", "Utfört av", { role: "performer" }),
    ]),
  ], b.limits, { limitObjectKey: "pump", report: { title: "Tillsyn pumpstation", code: "", taskFacts: true } });
})();

export const ROUND_FORMS: BuiltinForm[] = [
  { id: "hintek-skyddsrond", document: safetyRound, meta: formMetaSchema.parse({
    name: "Skyddsrond", icon: "shield-check", color: "amber", category: "SAFETY",
    description: "Arbetsmiljörond: bedöm områdena, registrera brister och följ upp åtgärderna.",
  }) },
  { id: "hintek-driftrond-vattenkraft", document: hydropower, meta: formMetaSchema.parse({
    name: "Daglig tillsyn – vattenkraftstation", icon: "gauge", color: "cyan", category: "ROUNDS",
    description: "Generell mall: drift, nivåer, damm, turbin och säkerhet med gränsvärden per anläggning.",
  }) },
  { id: "hintek-reservkraft", document: standby, meta: formMetaSchema.parse({
    name: "Reservkraft – tillsyn och provkörning", icon: "zap", color: "violet", category: "ROUNDS",
    description: "Veckotillsyn och provkörning med last: bränsle, batteri, larm, spänning och frekvens.",
  }) },
  { id: "hintek-pumpstation", document: pumpStation, meta: formMetaSchema.parse({
    name: "Tillsyn – pumpstation", icon: "wrench", color: "blue", category: "ROUNDS",
    description: "Tillsyn av pumpstation: pump, nivåer, larm, bräddning och säker nedstigning.",
  }) },
];
