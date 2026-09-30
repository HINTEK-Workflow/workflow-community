import { formDocumentSchema, type FormDocument } from "./form-document";
import { formMetaSchema, type FormMeta } from "./form-publish";

/**
 * HINTEK's own inspection types (Daniel 2026-09-26): Termografering, Fortlöpande kontroll, Isolationsmätning – EBR and
 * Följelinemätning – EBR. They are ordinary published forms – versioned data drawn by the shared form engine – so they
 * work in projects, planning, time, progression, PDF, Local and Cloud like every other protocol, and the superadmin
 * can refine them in "Skapa formulär" without a deploy. A migration publishes version 1 once; nothing here runs at
 * request time.
 *
 * No limit values are invented (Daniel's instruction): where a measurement has an acceptance criterion, the person
 * enters the requirement from the applicable EBR instruction, standard or client requirement, and the form compares
 * the value with it. See docs/INSPECTION_TYPES_20260926.md for what must be verified against EBR.
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
const text = (value: string) => ({ id: nextId("x"), type: "text", text: value });
const images = (key: string, label: string, extra: Extra = {}) => ({ id: nextId("i"), type: "images", key, label, ...extra });
const signature = (key: string, label: string) => ({ id: nextId("s"), type: "signature", key, label, required: true, width: "half" as Width });
const section = (title: string, blocks: unknown[], extra: Extra = {}) => ({ id: nextId("a"), type: "section", title, blocks, ...extra });
const weather = ["Torrt", "Fuktigt", "Regn", "Snö", "Inomhus"];
const when = (key: string, value = "YES") => ({ showIf: { key, op: "eq", value } });
const document = (blocks: unknown[], extra: Extra = {}): FormDocument => formDocumentSchema.parse({ schema: 2, blocks, ...extra });

// ---------------------------------------------------------------------------------------------------------------
// Termografering – version 2 (2026-09-28, docs/kallor/termografering.md)
// ---------------------------------------------------------------------------------------------------------------
// The classification depends on the assessment basis the assignment names (SBF 1031, NETA MTS, the insurer's, the
// client's), so ΔT and the lowest load are configurable limits with the source written out – never numbers of our own.
const thermography = document([
  section("Mätförutsättningar", [
    field("matdatum", "Mättillfälle", "datetime", { required: true }),
    field("kamera", "Värmekamera (fabrikat och modell)", "text", { required: true }),
    field("kamera_sn", "Kamerans serienummer", "text"),
    field("kalibrerad", "Kamerans kalibrering giltig till", "date"),
    field("emissivitet", "Emissivitet", "number", { defaultValue: 0.95, allowedMin: 0.01, allowedMax: 1, decimals: 2, width: "quarter", help: "Den emissivitet som kameran var inställd på." }),
    field("reflekterad", "Reflekterad temperatur", "number", { unit: "°C", width: "quarter" }),
    field("omgivning", "Omgivningstemperatur", "number", { unit: "°C", required: true, width: "quarter" }),
    field("fukt", "Relativ luftfuktighet", "number", { unit: "%", allowedMin: 0, allowedMax: 100, width: "quarter" }),
    field("miljo", "Miljö", "choice", { options: ["Inomhus", "Utomhus", "Ställverk inomhus", "Ställverk utomhus"] }),
    field("driftlage", "Anläggningens driftläge", "choice", { options: ["Normal drift", "Hög last", "Låg last", "Varierande last"], required: true }),
    field("oppnad", "Kapslingar öppnade eller IR-fönster använt", "yesno"),
    field("vader_paverkan", "Sol, vind eller nederbörd kan ha påverkat mätningen", "yesno", { ...when("miljo", "Utomhus") }),
    field("grund", "Bedömningsgrund", "choice", { options: ["SBF 1031 (försäkringsbolagens regler)", "NETA MTS", "Försäkringsbolagets krav", "Beställarens krav", "Annan"], width: "half", help: "Den grund uppdraget anger. Gränserna för ΔT skiljer sig mellan grunderna." }),
    field("grund_utgava", "Bedömningsgrundens utgåva eller dokument", "text", { width: "half" }),
    field("forutsattningar", "Övriga mätförutsättningar", "textarea", { help: "T.ex. avstånd, vinklar och lins. Låg belastning kan dölja fel – belastningen anges per objekt nedan." }),
  ]),
  section("Objekt", [
    text("Registrera ett kort per objekt: elcentral, ställverksfack, transformator eller anslutning. Ta termografibild och vanligt foto direkt i kortet så hamnar de tillsammans med mätvärdena i protokollet. Bedömningen görs av termografören enligt bedömningsgrunden; gränsvärdena för ΔT och lägsta belastning ställs in under Gränsvärden."),
    table("objekt", "Termograferade objekt", [
      column("objekt", "Objekt / position", "text", { required: true, help: "T.ex. Central A1, grupp 12 eller T1 lågspänningsanslutning." }),
      column("komponent", "Komponent", "choice", { options: ["Säkring", "Brytare", "Kontaktor", "Kabelanslutning", "Skena", "Frånskiljare", "Transformator", "Mätartavla", "Övrigt"] }),
      column("fas", "Fas", "choice", { options: ["L1", "L2", "L3", "N", "PE", "Alla faser"] }),
      column("typ", "Avvikelsetyp", "choice", { options: ["Varm", "Kall"], help: "Kall avvikelse, t.ex. en löst säkring eller en fas utan last." }),
      column("maxtemp", "Högsta temperatur", "number", { unit: "°C", required: true }),
      column("reftemp", "Referenstemperatur", "number", { unit: "°C", help: "Jämförbar komponent eller fas med samma belastning." }),
      column("deltat", "Temperaturskillnad ΔT", "formula", { formula: "[maxtemp] - [reftemp]", unit: "K", limitKey: "delta_ref" }),
      column("deltat_omg", "ΔT mot omgivning", "formula", { formula: "[maxtemp] - omgivning", unit: "K", limitKey: "delta_omg" }),
      column("last", "Belastning", "number", { unit: "A" }),
      column("markstrom", "Märkström", "number", { unit: "A" }),
      column("lastgrad", "Belastningsgrad", "formula", { formula: "AVRUNDA([last] / [markstrom] * 100; 0)", unit: "%", limitKey: "lastgrad" }),
      column("bedomning", "Bedömning", "choice", { required: true, options: ["Ingen anmärkning", "Bevaka", "Åtgärda planerat", "Åtgärda omgående"], deviationOptions: ["Åtgärda planerat", "Åtgärda omgående"] }),
      column("atgard", "Iakttagelse och rekommenderad åtgärd", "textarea"),
      column("senast", "Åtgärdas senast", "date", { group: "Uppföljning" }),
      column("kvitterad", "Åtgärd kvitterad", "date", { group: "Uppföljning", help: "Datum då åtgärden är utförd och kvitterad." }),
      column("kvitterad_av", "Kvitterad av", "text", { group: "Uppföljning" }),
      column("termobild", "Termografibild", "images"),
      column("foto", "Fotografi", "images"),
    ], { layout: "cards", itemLabel: "Objekt", required: true, workOrders: true }),
    computed("antal", "Antal objekt", "ANTAL(objekt.objekt)"),
    computed("omgaende", "Åtgärda omgående", "ANTAL.OM(objekt.bedomning; \"Åtgärda omgående\")"),
    computed("planerat", "Åtgärda planerat", "ANTAL.OM(objekt.bedomning; \"Åtgärda planerat\")"),
    field("muntligt", "Kritiskt fel meddelat muntligen på plats", "yesno", { width: "half" }),
    field("muntligt_till", "Till vem och när", "text", { width: "half", ...when("muntligt") }),
  ]),
  section("Omfattning", [
    field("undersokta", "Undersökta delar utan anmärkning", "textarea", { help: "Försäkringsbolagens vägledning kräver att även undersökta delar utan fel redovisas." }),
    field("ej_undersokta", "Delar som inte kunde undersökas och varför", "textarea"),
  ]),
  section("Sammanfattning och signering", [
    field("sammanfattning", "Sammanfattning", "textarea", { help: "Övergripande resultat och rekommendationer till beställaren." }),
    field("certifiering", "Termograförens behörighet", "text", { help: "T.ex. certifierad termograf nivå 1 eller 2.", width: "third" }),
    field("certifikat", "Certifieringsorgan och certifikatnummer", "text", { width: "third" }),
    field("certifikat_giltigt", "Certifikatet giltigt till", "date"),
    signature("termograf", "Termograferad av"),
  ]),
], {
  limits: [
    { key: "delta_ref", label: "ΔT mot referens", unit: "K", source: "Enligt vald bedömningsgrund (t.ex. SBF 1031 eller NETA MTS) – ange gränserna för er klassning" },
    { key: "delta_omg", label: "ΔT mot omgivning", unit: "K", source: "Enligt vald bedömningsgrund (NETA MTS har egna gränser mot omgivning)" },
    { key: "lastgrad", label: "Lägsta belastning vid mätning", unit: "%", source: "Termograferingsvägledningar anger ofta minst 40 % av märklast – verifiera mot bedömningsgrunden" },
  ],
});

// ---------------------------------------------------------------------------------------------------------------
// Fortlöpande kontroll – version 3 (2026-09-29; version 2 2026-09-28, docs/kallor/fortlopande-kontroll.md, ELSÄK-FS 2022:3)
// ---------------------------------------------------------------------------------------------------------------
const recurring = document([
  section("Kontrolltillfälle", [
    field("kontrolldatum", "Kontrolldatum", "date", { required: true }),
    field("intervall", "Kontrollintervall", "number", { unit: "mån", required: true, defaultValue: 12, allowedMin: 1, allowedMax: 120, decimals: 0 }),
    computed("nasta", "Nästa kontroll senast", "EDATUM(kontrolldatum; intervall)", { help: "Kontrolldatum plus intervallet." }),
    field("intervall_grund", "Intervallets grund", "choice", { options: ["Egen rutin och riskbedömning", "Elektriska Nämndens F200", "Tillverkarens anvisning", "Försäkringsbolagets krav", "Annan"] }),
    field("omfattning", "Omfattning", "choice", { options: ["Hela anläggningen", "Del av anläggningen", "Uppföljning av anmärkningar"], required: true }),
    field("foregaende", "Föregående kontroll", "date", { help: "Tidigare protokoll för samma kund och anläggning visas ovanför formuläret." }),
    field("tidigare_atgardade", "Anmärkningar från föregående kontroll åtgärdade", "yesno", { deviationOn: "NO" }),
    field("rutin", "Dokumenterad rutin för fortlöpande kontroll finns", "yesno", { deviationOn: "NO", help: "ELSÄK-FS 2022:3 6 §: rutinen ska bygga på en riskbedömning av anläggningens utförande, ålder, miljö och användning." }),
    field("riskbedomning_datum", "Rutinens riskbedömning gjord", "date", { ...when("rutin") }),
    field("forandring", "Förändring i anläggningen sedan förra kontrollen", "yesno"),
    field("forandring_text", "Vad har ändrats", "text", { width: "two_thirds", ...when("forandring") }),
    field("besiktningspliktig", "Besiktningspliktigt objekt (F200)", "yesno"),
    field("senaste_revision", "Senaste revisionsbesiktning", "date", { ...when("besiktningspliktig") }),
  ]),
  section("Kontrollpunkter", [
    text("Bedöm varje punkt: OK, Ej OK eller Ej aktuellt för delar som inte finns i anläggningen. Ta en bild direkt på punkten och registrera en brist som anmärkning. Lägg till anläggningens egna punkter i tabellen under."),
    checklist("kontrollpunkter", "Allmänna kontrollpunkter", [
      "Elcentraler: märkning, gruppförteckning och skyltning",
      "Kapslingar, luckor och beröringsskydd hela",
      "Kablar och ledningar utan synliga skador",
      "Anslutningar och komponenter utan tecken på överhettning",
      "Jordfelsbrytare provade med testknapp",
      "Skyddsutjämning och jordningar synligt intakta",
      "Belysning och nödbelysning fungerar",
      "Fritt utrymme framför elcentraler",
      "Brandtätningar vid genomföringar intakta",
      "Dokumentation (ritningar, förteckningar) aktuell",
      "Elrum och driftrum låsta och varselmärkta",
      "Inget brännbart material vid elutrustning",
      "Ingen lukt, missfärgning eller onormalt varma kapslingar",
      "Kabelstegar och förläggning utan skador eller överlast",
      "Tillfälliga installationer och skarvsladdar i gott skick",
      "Truckladdning och laddplatser utan anmärkning",
    ], { photos: true, deviationTable: "anmarkningar" }),
    table("egna", "Anläggningens egna kontrollpunkter", [
      column("punkt", "Kontrollpunkt", "text", { required: true }),
      column("bedomning", "Bedömning", "choice", { options: ["OK", "Ej OK", "Ej aktuellt"], deviationOptions: ["Ej OK"], required: true }),
      column("kommentar", "Kommentar", "text"),
      column("bild", "Bild", "images"),
    ]),
    table("jfb", "Jordfelsbrytare", [
      column("jfb", "Jordfelsbrytare", "text", { required: true, help: "Beteckning eller placering." }),
      column("testknapp", "Testknapp", "choice", { required: true, options: ["OK", "Ej OK"], deviationOptions: ["Ej OK"] }),
      column("tid", "Utlösningstid", "number", { unit: "ms", help: "När rutinen kräver provning med instrument." }),
      column("kommentar", "Kommentar", "text"),
    ], { startEmpty: true, emptyTitle: "Inga jordfelsbrytare registrerade." }),
  ]),
  // Version 3 (Daniel 2026-09-29): no "Separata kontrollmoment" – thermography, insulation, follow-wire and earth
  // electrode measurements are not part of an ordinary recurring inspection of a building; they have their own protocols.
  section("Anmärkningar och åtgärder", [
    table("anmarkningar", "Anmärkningar", [
      column("beskrivning", "Anmärkning", "text", { required: true }),
      column("plats", "Plats", "text"),
      column("klass", "Klassning", "choice", { options: ["Observation", "Åtgärdas snarast", "Omedelbar fara"], deviationOptions: ["Åtgärdas snarast", "Omedelbar fara"], required: true, help: "Omedelbar fara: anläggningsdelen tas ur bruk (ELSÄK-FS 2022:3 12 §)." }),
      column("ur_bruk", "Tagen ur bruk och skyddad", "check"),
      column("ansvarig", "Ansvarig för åtgärd", "text"),
      column("klart", "Åtgärdas senast", "date"),
      column("atgard", "Åtgärd", "textarea"),
      column("foto", "Foto", "images"),
    ], { layout: "cards", itemLabel: "Anmärkning", workOrders: true }),
    computed("antal_anm", "Antal anmärkningar", "ANTAL(anmarkningar.beskrivning)"),
  ]),
  section("Signering", [
    field("sammanfattning", "Sammanfattning", "textarea"),
    field("kompetens", "Kontrollantens kompetens", "choice", { options: ["Elinstallatör med auktorisation", "Fackkunnig person", "Instruerad person (okulär kontroll)"], width: "half" }),
    signature("kontrollant", "Kontrollerad av"),
  ]),
]);

// ---------------------------------------------------------------------------------------------------------------
// Isolationsmätning – EBR, version 2 (2026-09-28, docs/kallor/isolationsmatning.md)
// ---------------------------------------------------------------------------------------------------------------
const insulation = document([
  section("Mätförutsättningar", [
    field("matdatum", "Mätdatum", "date", { required: true }),
    field("instrument", "Instrument", "text", { required: true, help: "Fabrikat och modell." }),
    field("serienummer", "Serienummer", "text"),
    field("kalibrerad", "Kalibrering giltig till", "date"),
    field("temperatur", "Temperatur", "number", { unit: "°C", width: "quarter" }),
    field("fukt", "Relativ luftfuktighet", "number", { unit: "%", allowedMin: 0, allowedMax: 100, width: "quarter" }),
    field("vader", "Väder", "choice", { options: weather }),
    field("frankopplad", "Objektet frånkopplat och spänningslöshet verifierad", "yesno", { required: true, allowNotApplicable: false, deviationOn: "NO", width: "half" }),
    field("utrustning", "Känslig utrustning bortkopplad", "yesno", { width: "half" }),
    field("spd", "Överspänningsskydd (SPD) bortkopplat", "yesno", { width: "half" }),
    field("spd_reducerad", "Mätt med reducerad spänning (250 V) på grund av SPD", "yesno", { width: "half", ...when("spd", "NO") }),
    field("anvisning", "Tillämpad anvisning / krav", "text", { width: "full", help: "T.ex. aktuell EBR-anvisning, SS 436 40 00 del 6 eller beställarens tekniska krav, med utgåva." }),
    field("foregaende", "Föregående mätning", "date", { help: "För jämförelse – tidigare protokoll på samma anläggning visas ovanför formuläret." }),
  ]),
  section("Mätningar", [
    text("Ange kravet (lägsta godtagbara isolationsresistans) för varje mätning enligt den anvisning som gäller för objektet. Formuläret jämför det uppmätta värdet med kravet och markerar avvikelser; inga gränsvärden är förifyllda."),
    table("matningar", "Isolationsmätningar", [
      column("objekt", "Objekt / kabel", "text", { required: true }),
      column("objekttyp", "Objekttyp", "choice", { options: ["Installation ≤ 500 V", "SELV / PELV", "Installation > 500 V", "Kabel lågspänning", "Kabel högspänning", "Motor / maskin", "Annat"] }),
      column("fran", "Från", "text"),
      column("till", "Till", "text"),
      column("kabeltyp", "Kabeltyp", "text"),
      column("langd", "Längd", "number", { unit: "m" }),
      column("matning", "Mätning mellan", "choice", { required: true, options: ["L1–PE", "L2–PE", "L3–PE", "N–PE", "L1–L2", "L1–L3", "L2–L3", "Faser–PE", "Ledare–skärm", "Skärm–jord", "Mantel–jord"] }),
      column("spanning", "Mätspänning", "choice", { required: true, options: ["50 V", "100 V", "250 V", "500 V", "1000 V", "2500 V", "5000 V", "10 000 V"] }),
      column("tid", "Mättid", "number", { unit: "s" }),
      column("uppmatt", "Uppmätt", "number", { unit: "MΩ", required: true, total: "min" }),
      column("over", "Över mätområdet", "check", { help: "Värdet var högre än instrumentets mätområde; ange mätområdets övre gräns som uppmätt." }),
      column("krav", "Krav (lägst)", "number", { unit: "MΩ" }),
      column("godkand", "Godkänd", "formula", { formula: "[uppmatt] >= [krav]", passCondition: true }),
      column("bild", "Bild", "images", { pdf: "hide" }),
    ], { required: true }),
    computed("lagsta", "Lägsta uppmätta värde", "MIN(matningar.uppmatt)", { unit: "MΩ" }),
    computed("underkanda", "Mätningar under krav", "ANTAL.OM(matningar.godkand; FALSKT)"),
    computed("utan_krav", "Mätningar utan angivet krav", "ANTAL(matningar.uppmatt) - ANTAL(matningar.krav)"),
    computed("resultat", "Resultat", "OM(ANTAL.OM(matningar.godkand; FALSKT) > 0; \"Avvikelse\"; OM(ANTAL(matningar.krav) < ANTAL(matningar.uppmatt); \"Krav saknas för någon mätning\"; \"Godkänd\"))"),
    field("urladdat", "Objektet urladdat efter mätning", "yesno", { deviationOn: "NO", width: "half" }),
    field("tidsberoende", "Tidsberoende mätning utförd", "yesno", { width: "half", help: "För kablar, motorer och transformatorer: resistansen efter 30 s, 1 min och 10 min." }),
  ]),
  section("Tidsberoende mätning (PI och DAR)", [
    text("PI = R10min / R1min och DAR = R60s / R30s. Tolkningen skiljer sig mellan tillverkare och IEEE 43 – lägsta godtagbara värden ställs in under Gränsvärden."),
    table("tidsberoende_matning", "PI och DAR", [
      column("objekt", "Objekt", "text", { required: true }),
      column("r30", "R 30 s", "number", { unit: "MΩ", required: true }),
      column("r60", "R 1 min", "number", { unit: "MΩ", required: true }),
      column("r600", "R 10 min", "number", { unit: "MΩ" }),
      column("dar", "DAR", "formula", { formula: "AVRUNDA([r60] / [r30]; 2)", limitKey: "dar" }),
      column("pi", "PI", "formula", { formula: "AVRUNDA([r600] / [r60]; 2)", limitKey: "pi" }),
    ], { startEmpty: true, emptyTitle: "Inga tidsberoende mätningar." }),
  ], { ...when("tidsberoende") }),
  section("Mantelprov", [
    field("mantelprov", "Mantelprov utfört", "yesno", { width: "half" }),
    table("mantel", "Mantelprov", [
      column("stracka", "Sträcka", "text", { required: true }),
      column("provspanning", "Provspänning", "number", { unit: "kV", required: true }),
      column("provtid", "Provtid", "number", { unit: "min" }),
      column("lackstrom", "Läckström", "number", { unit: "µA", required: true }),
      column("langd", "Längd", "number", { unit: "km", required: true }),
      column("per_km", "Läckström per km", "formula", { formula: "AVRUNDA([lackstrom] / [langd]; 1)", unit: "µA/km" }),
      column("krav", "Krav (högst)", "number", { unit: "µA/km" }),
      column("godkand", "Godkänd", "formula", { formula: "[per_km] <= [krav]", passCondition: true }),
    ], { startEmpty: true, emptyTitle: "Inga mantelprov registrerade.", ...when("mantelprov") }),
  ]),
  section("Kommentarer och signering", [
    field("kommentar", "Kommentarer", "textarea"),
    images("bilder", "Bilder", { help: "T.ex. mätuppställning eller instrumentets display." }),
    signature("matare", "Mätt av"),
  ]),
], {
  limits: [
    { key: "dar", label: "DAR (lägsta)", unit: "", source: "Instrumenttillverkarens tolkningstabell eller IEEE 43 – verifiera" },
    { key: "pi", label: "PI (lägsta)", unit: "", source: "IEEE 43 för roterande maskiner eller tillverkarens anvisning – verifiera" },
  ],
});

// ---------------------------------------------------------------------------------------------------------------
// Följelinemätning – EBR (Ymermätning), version 2 (2026-09-28, docs/kallor/foljelinematning.md)
// ---------------------------------------------------------------------------------------------------------------
// Ymer reports the current in the phase conductor and over the whole cable and judges their ratio against the
// instrument's green area – not a resistance. Each point says its method; the resistance methods keep their columns.
const followWire = document([
  section("Ledningssträcka", [
    field("natomrade", "Nät / ledning", "text", { help: "Nätägarens beteckning." }),
    field("fran", "Från station", "text", { required: true }),
    field("till", "Till station", "text", { required: true }),
    field("kabeltyp", "Kabeltyp", "text"),
    field("kabellangd", "Sträckans längd", "number", { unit: "m" }),
    field("foljelina", "Följelina (material och area)", "text", { help: "T.ex. Cu 25 mm²." }),
    field("skarm", "Kabelskärm (material och area)", "text"),
    field("forlaggning", "Förläggning", "choice", { options: ["Mark", "Kanalisation", "Luft", "Blandad"] }),
    field("anvisning", "Tillämpad anvisning / krav", "text", { width: "two_thirds", help: "T.ex. aktuell EBR-anvisning eller nätägarens tekniska krav, med utgåva." }),
  ]),
  section("Instrument och förutsättningar", [
    field("matdatum", "Mätdatum", "date", { required: true }),
    field("instrument", "Instrument", "text", { required: true, help: "T.ex. Ymer eller motsvarande jordnings-/kontinuitetsprovare." }),
    field("serienummer", "Serienummer", "text"),
    field("kalibrerad", "Kalibrering giltig till", "date"),
    field("metod", "Mätmetod", "choice", { required: true, options: ["Ymer strömkvot", "Kontinuitet följelina", "Kontinuitet kabelskärm", "Annan metod"] }),
    field("stromomrade", "Strömområde", "choice", { options: ["0–25 V / 20 A", "0–50 V / 10 A", "Annat"], ...when("metod", "Ymer strömkvot") }),
    field("fasledare", "Fasledare som användes", "text", { width: "quarter", ...when("metod", "Ymer strömkvot") }),
    field("innanfor", "Följelinan innanför strömtångens mätsnitt", "yesno", { ...when("metod", "Ymer strömkvot") }),
    field("mark", "Markförhållanden", "choice", { options: ["Torr", "Fuktig", "Blöt", "Tjäle"], width: "quarter" }),
    field("frankopplad", "Förbindelser bortkopplade enligt metod", "yesno", { width: "third" }),
    field("mantelprov", "Mantelprov utfört samtidigt", "yesno", { width: "third" }),
    field("mantelprov_ref", "Referens till mantelprovets protokoll", "text", { width: "third", ...when("mantelprov") }),
    field("metodbeskrivning", "Mätuppställning", "textarea", { help: "Hur instrumentet anslöts och vilka förbindelser som var bortkopplade, så att mätningen kan upprepas." }),
  ]),
  section("Mätpunkter", [
    text("Varje mätpunkt anger sin metod. Resistansmetoder: ange kravet (högst) enligt anvisningen. Ymer: ange strömmarna och om kvoten låg inom instrumentets gröna område; ett numeriskt kvotkrav kan ställas in under Gränsvärden. Inga gränsvärden är förifyllda."),
    table("matpunkter", "Mätpunkter", [
      column("punkt", "Mätpunkt / station", "text", { required: true }),
      column("metod", "Metod", "choice", { options: ["Ymer strömkvot", "Slingresistanstång", "Kontinuitetsmätare"] }),
      column("avstand", "Avstånd från start", "number", { unit: "m" }),
      column("anslutning", "Anslutningspunkt", "text", { help: "T.ex. jordskena, kabelskåp eller stolpe." }),
      column("resistans", "Uppmätt resistans", "number", { unit: "Ω", total: "max" }),
      column("strom", "Mätström", "number", { unit: "A" }),
      column("krav", "Krav (högst)", "number", { unit: "Ω" }),
      column("godkand", "Godkänd", "formula", { formula: "[resistans] <= [krav]", passCondition: true }),
      column("u", "U", "number", { unit: "V" }),
      column("imat", "I mät", "number", { unit: "A" }),
      column("iy", "I y", "number", { unit: "A" }),
      column("kvot", "Kvot I y / I mät", "formula", { formula: "AVRUNDA([iy] / [imat]; 2)", limitKey: "ymer_kvot" }),
      column("gront", "Inom grönt område", "choice", { options: ["Ja", "Nej"], deviationOptions: ["Nej"] }),
      column("kommentar", "Kommentar", "text"),
      column("bild", "Bild", "images", { pdf: "hide" }),
    ], { required: true }),
    computed("hogsta", "Högsta uppmätta resistans", "MAX(matpunkter.resistans)", { unit: "Ω" }),
    computed("underkanda", "Mätpunkter över krav", "ANTAL.OM(matpunkter.godkand; FALSKT)"),
    computed("utanfor_gront", "Ymer-punkter utanför grönt område", "ANTAL.OM(matpunkter.gront; \"Nej\")"),
    computed("resultat", "Resultat", "OM(ANTAL.OM(matpunkter.godkand; FALSKT) + ANTAL.OM(matpunkter.gront; \"Nej\") > 0; \"Avvikelse\"; \"Inga avvikelser\")"),
  ]),
  section("Observationer och signering", [
    field("observationer", "Observationer och åtgärder", "textarea"),
    images("bilder", "Bilder från mätplatsen"),
    signature("matare", "Mätt av"),
  ]),
], {
  limits: [{ key: "ymer_kvot", label: "Ymer strömkvot I y / I mät (lägsta)", unit: "", source: "Instrumentets gröna område enligt tillverkaren eller nätägarens krav – verifiera" }],
});

export type BuiltinForm = { id: string; meta: FormMeta; document: FormDocument };

/** Fixed ids so the migration is idempotent and the forms can be recognised in tests and in the demo. */
export const BUILTIN_FORMS: BuiltinForm[] = [
  { id: "hintek-termografering", document: thermography, meta: formMetaSchema.parse({
    name: "Termografering", icon: "thermometer", color: "rose", category: "ELECTRICAL",
    description: "Termografering av elcentraler, ställverk, transformatorer och anslutningar – mätvärden, termografibild och foto per objekt.",
  }) },
  { id: "hintek-fortlopande-kontroll", document: recurring, meta: formMetaSchema.parse({
    name: "Fortlöpande kontroll", icon: "list-checks", color: "blue", category: "ELECTRICAL",
    description: "Återkommande kontroll av elanläggning: kontrollpunkter, anmärkningar och nästa kontroll.",
  }) },
  { id: "hintek-isolationsmatning-ebr", document: insulation, meta: formMetaSchema.parse({
    name: "Isolationsmätning – EBR", icon: "gauge", color: "violet", category: "POWER",
    description: "Isolationsmätning av kablar och objekt med instrument, mätspänning, uppmätt värde och krav per mätning.",
  }) },
  { id: "hintek-foljelinematning-ebr", document: followWire, meta: formMetaSchema.parse({
    name: "Följelinemätning – EBR", displayName: "Följelinemätning – EBR (Ymermätning)", icon: "plug", color: "cyan", category: "POWER",
    description: "Mätprotokoll för följelina och kabelskärm med Ymer eller motsvarande instrument, mätpunkt för mätpunkt.",
  }) },
];
