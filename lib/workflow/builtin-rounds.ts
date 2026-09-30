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
 * No limit values are set here: they depend on the facility, its permit (vattendom) and the manufacturer. Every limit
 * names where its value comes from. Sources: docs/kallor/skyddsrond.md, vattenkraft.md, reservkraft.md, pumpstation.md.
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
const VD = "Vattendomen / tillståndet för anläggningen";
const TILL = "Tillverkarens anvisning och anläggningens drift- och tillsynsprogram";
const DTP = "Anläggningens drift- och tillsynsprogram";
const DSP = "Dammsäkerhetsprogrammet (RIDAS)";

// ---------------------------------------------------------------------------------------------------------------
// Skyddsrond
// ---------------------------------------------------------------------------------------------------------------
const safetyRound = (() => {
  const b = builder("sr");
  // Each area is a moment that can be switched off, so the round fits industry, electrical power, installation,
  // property and maintenance: the author or the person on the round chooses the areas that apply.
  const area = (title: string, key: string, items: string[], on = true) => b.section(title, [b.checks(key, title, items)], { optional: true, defaultOn: on });
  return build([
    b.section("Skyddsrond", [
      b.note("Om skyddsronden", "Skyddsronden är en del av det systematiska arbetsmiljöarbetet (AFS 2023:1). Välj de områden som gäller arbetsplatsen, bedöm varje punkt och registrera brister med risk, åtgärd, ansvarig och datum. Allvarliga risker ska framgå och åtgärder följas upp.", "folded"),
      b.field("plats", "Arbetsplats / avdelning", "text", { required: true, prefill: "facility" }),
      b.field("datum", "Datum", "date", { required: true, prefill: "today" }),
      b.field("bransch", "Verksamhet", "choice", { options: ["Industri", "Elkraft", "Installation", "Fastighet", "Tekniskt underhåll", "Annan"] }),
      b.field("chef", "Arbetsgivarens representant", "text", { required: true }),
      b.field("skyddsombud", "Skyddsombud / arbetsmiljöombud", "text"),
      b.field("deltagare", "Övriga deltagare", "text"),
      b.field("foregaende", "Åtgärder från föregående skyddsrond genomförda", "yesno", { deviationOn: "NO", width: "half" }),
    ], { newPage: false }),
    area("Organisation, rutiner och SAM", "sam", [
      "Rutin för systematiskt arbetsmiljöarbete finns och är känd", "Uppgiftsfördelningen i arbetsmiljöarbetet är tydlig (skriftlig vid 10 eller fler anställda)",
      "Åtgärder från föregående rond och handlingsplanen är genomförda och kontrollerade", "Tillbud, olycksfall och arbetssjukdomar rapporteras, utreds och åtgärdas",
      "Introduktion och instruktioner finns för nyanställda och inhyrda", "Skyddsombud eller arbetsmiljöombud finns och deltar",
      "Tillstånd, behörigheter och utbildningsbevis (truck, lift, heta arbeten, el) är aktuella",
    ]),
    area("Ordning och reda, lokaler och trafik", "ordning", [
      "Städning och ordning är tillfredsställande", "Golv och gångytor är fria från snubbel- och halkrisk", "Förbindelseleder och transportvägar är fria och markerade",
      "Gående är separerade från fordons- och trucktrafik", "Material förvaras stabilt, tunga föremål lågt", "Pallställ är märkta med maxlast, förankrade och har påkörningsskydd",
      "Avfall och farligt avfall sorteras och förvaras rätt", "Personalutrymmen finns och är i gott skick",
    ]),
    area("Brandskydd och utrymning", "brand", [
      "Utrymningsvägar är fria, markerade och öppningsbara utan nyckel", "Nödbelysning och vägledande markering fungerar", "Handbrandsläckare och brandposter är kontrollerade, skyltade och åtkomliga",
      "Personalen vet hur släckutrustning används och var återsamlingsplatsen är", "Utrymningsplan finns och utrymning övas", "Utrymnings- och brandlarm fungerar och underhålls",
      "Branddörrar är hela och stänger", "Heta arbeten utförs med tillstånd, brandvakt och efterbevakning", "Brännbart material och gasflaskor förvaras rätt",
      "Systematiskt brandskyddsarbete (SBA) med utsedd ansvarig finns",
    ]),
    area("Elsäkerhet", "el", [
      "Elcentraler är stängda och märkta med fritt utrymme framför", "Installationer, uttag och kapslingar är hela utan provisorier", "Kablar och skarvsladdar är hela, rätt klassade och skyddade",
      "Skarvsladdar och grenuttag används inte som permanent installation", "Handhållna elverktyg är hela och kontrolleras regelbundet", "Jordfelsbrytare finns där det behövs och provas med testknapp",
      "Tillfällig elanläggning (byggström) har ansvarig och fortlöpande kontroll", "Rutiner finns för frånkoppling, låsning och spänningsprovning före arbete",
    ]),
    area("Maskiner och arbetsutrustning", "maskin", [
      "Rörliga och farliga delar har hela skydd som inte är förbikopplade", "Nödstopp finns, fungerar och är åtkomligt", "Energiskiljare kan låsas mot återinkoppling",
      "Märkning, skyltar och varningsanordningar finns på svenska", "Utrustningen underhålls och underhållsjournalen är aktuell", "Bruksanvisningar finns tillgängliga och följs",
      "Besiktningspliktig utrustning (lyftanordningar, tryckkärl) har giltig besiktning",
    ]),
    area("Personlig skyddsutrustning", "ppe", [
      "Behovet av skyddsutrustning är bedömt utifrån riskbedömningen", "Rätt skyddsutrustning finns utan kostnad för de anställda", "Skyddsutrustningen används där den behövs",
      "Skyddsutrustningen är hel, rätt förvarad och inom sin livslängd", "Utbildning och instruktion om användningen har getts",
    ]),
    area("Fallrisk och arbete på höjd", "fall", [
      "Hål, öppningar och kanter är skyddade med räcke eller täckning", "Fallskydd finns vid arbete på höjd", "Stegar och arbetsbockar är hela och används rätt",
      "Ställningar är kontrollerade före användning", "Personligt fallskydd är kontrollerat och räddningsplan finns",
    ]),
    area("Kemiska riskkällor", "kemi", [
      "Förteckning över kemiska riskkällor finns och är daterad", "Aktuella säkerhetsdatablad finns på svenska", "Riskbedömning av kemikaliehanteringen är gjord",
      "Behållare är märkta, även omtappade", "Förvaringen är ventilerad, invallad och åtskild", "Nöddusch och ögondusch finns där risk föreligger och kontrolleras",
    ]),
    area("Första hjälpen och krisberedskap", "forsta", [
      "Utrustning för första hjälpen finns, är komplett och skyltad", "Anslag visar larmnummer, adress och vem som kan ge första hjälpen", "Tillräckligt många har aktuell utbildning i första hjälpen",
      "Rutiner för första hjälpen och krisstöd är kända", "Hjärtstartare finns och är kontrollerad, om den behövs",
    ]),
    area("Belysning, buller, vibrationer och klimat", "fysik", [
      "Belysningen räcker och bländar inte", "Bullerkällor är åtgärdade och bullerområden skyltade", "Hörselskydd finns och används där det krävs",
      "Vibrationsexponering är bedömd", "Temperatur, drag och luftkvalitet är tillfredsställande", "Ventilationen fungerar och OVK är utförd",
    ]),
    area("Ergonomi och belastning", "ergonomi", [
      "Tunga lyft undviks och lyfthjälpmedel används", "Arbete med vriden bål eller över axelhöjd undviks", "Repetitivt arbete är begränsat med variation och paus",
      "Arbetshöjder är anpassningsbara", "Bildskärmsarbetsplatser är ergonomiskt utformade",
    ]),
    area("Truckar, lyft och transporter", "lyft", [
      "Truckförare har utbildning och skriftligt tillstånd", "Truckar är i gott skick med daglig tillsyn", "Laddplatsen för truckbatterier är ventilerad med ögondusch",
      "Lyftanordningar och lyftredskap är kontrollerade och märkta", "Ingen vistas under hängande last", "Lastkajer och lastbryggor är säkrade",
    ], false),
    area("Ensamarbete och arbete på annan plats", "ensam", [
      "Ensamarbete är kartlagt och riskbedömt", "Det finns sätt att snabbt få hjälp (larm, kontaktrutin)", "Arbete som inte kan göras säkert ensam görs inte ensam",
      "Servicebilen är i ordning: last säkrad, gasflaskor och kemikalier rätt förvarade, första hjälpen och släckare finns",
    ], false),
    area("Organisatorisk och social arbetsmiljö", "osa", [
      "Arbetsbelastningen är rimlig i förhållande till resurserna", "Var och en vet vilka uppgifter som gäller och vem som prioriterar", "Rutin mot kränkande särbehandling finns och är känd",
      "Risker för våld och hot är bedömda",
    ], false),
    b.section("Brister och åtgärder", [
      b.deviations("Brister", ["Låg", "Medel", "Hög"], ["Medel", "Hög"]),
      b.computed("antal", "Antal brister", "ANTAL(avvikelser.punkt)"),
      b.computed("hoga", "Brister med hög risk", "ANTAL.OM(avvikelser.allvarlighet; \"Hög\")"),
    ]),
    b.section("Sammanfattning och signering", [
      { id: "sr-summary", type: "summary", label: "Sammanfattning / avvikelser", help: "Allvarliga risker ska framgå. Handlingsplanen är bristerna ovan med ansvarig och datum." },
      b.signature("chef_sign", "Signatur arbetsgivare", { role: "approver", statement: "Skyddsronden är genomförd och bristerna förs in i handlingsplanen" }),
      b.signature("skyddsombud_sign", "Signatur skyddsombud", { role: "reviewer", required: false, distinctFrom: "chef_sign" }),
    ]),
  ], b.limits, { moments: { label: "Områden", requireOne: true, placement: "top" }, report: { title: "Skyddsrond", code: "AFS 2023:1", taskFacts: true } });
})();

// ---------------------------------------------------------------------------------------------------------------
// Daglig tillsyn – vattenkraftstation (generell mall baserad på offentliga källor)
// ---------------------------------------------------------------------------------------------------------------
const hydropower = (() => {
  const b = builder("vk");
  return build([
    b.section("Rondinformation", [
      b.note("Generell mall baserad på offentliga källor", "Mallen bygger på RIDAS, dammsäkerhetsförordningen, Svenska kraftnäts vägledningar, Miljösamverkan Sveriges egenkontroll för vattenkraft, USBR FIST och UNIDO (docs/kallor/vattenkraft.md). Den innehåller inga gränsvärden: sätt anläggningens egna nivåer under Gränsvärden – från vattendomen, tillverkarens anvisningar och drift- och tillsynsprogrammet – och ta bort eller lägg till punkter så att mallen stämmer med anläggningens program. Gör en rond per aggregat när stationen har flera.", "card"),
      b.field("tid", "Datum och tid för ronden", "datetime", { required: true }),
      b.field("station", "Station / anläggning", "text", { required: true, prefill: "facility" }),
      b.field("aggregat", "Aggregat", "choice", { options: ["G1", "G2", "G3", "G4", "Hela stationen"], defaultValue: "G1", help: "Gränsvärden kan sättas per aggregat." }),
      b.field("typ", "Typ av tillsyn", "choice", { options: ["Daglig rond", "Anpassad drift (högflöde, is)", "Efter larm"], defaultValue: "Daglig rond" }),
      b.field("bemannad", "Anläggningen bemannad vid ronden", "yesno", { allowNotApplicable: false }),
      b.field("vader", "Väder, is och drivgods", "text"),
      b.field("kontrollant", "Kontrollant", "text", { prefill: "user" }),
    ]),
    b.section("Driftstatus, larm och störningar", [
      b.field("driftlage", "Driftläge", "choice", { options: ["Drift", "Stopp", "Reserv", "Avställt"], required: true }),
      b.measure("effekt", "Aktuell effekt", "kW", `${TILL} (märkdata); ${VD} (ev. begränsning)`),
      b.count("energi", "Räkneverk energi", "MWh"),
      b.count("drifttimmar", "Drifttimmar", "h"),
      b.count("starter", "Starter sedan förra ronden", "st"),
      b.field("larm", "Aktiva larm i styrsystemet", "yesno", { deviationOn: "YES" }),
      b.field("larm_text", "Vilka larm och status (kvitterade/okvitterade)", "text", { width: "two_thirds", ...when("larm") }),
      b.field("storning", "Larm eller driftstörning sedan förra ronden", "yesno"),
      b.field("storning_text", "Störning och orsak", "text", { width: "two_thirds", ...when("storning") }),
      b.field("anmalan", "Anmälningspliktig driftstörning (anmäls till länsstyrelsen)", "yesno", { deviationOn: "YES", help: "Förordningen om verksamhetsutövares egenkontroll 6 §." }),
      b.checks("drift", "Driftfunktioner", ["Fjärrövervakning och kommunikation med driftcentralen fungerar", "Skyddsfunktioner i drift utan förbikopplingar eller blockeringar"]),
    ]),
    b.section("Vattennivåer och flöden", [
      b.text("Ange nivåer i anläggningens höjdsystem (t.ex. RH 2000). Dämningsgräns och sänkningsgräns från vattendomen sätts som övre och nedre larmgräns för övre vattennivå."),
      b.measure("ovy", "Övre vattennivå", "m", `${VD} (dämningsgräns DG och sänkningsgräns SG)`, { width: "third" }),
      b.measure("nvy", "Nedre vattennivå", "m", `${VD}; ${TILL} (lägsta undervatten)`, { width: "third" }),
      b.computed("fallhojd", "Fallhöjd", "ovy - nvy", { unit: "m", trend: true, width: "third" }),
      b.measure("pegel", "Avvikelse pegel mot givare", "cm", `${DTP} (tillåten avvikelse)`),
      b.measure("turbinflode", "Turbinflöde", "m³/s", `${VD} (utbyggnadsflöde); ${TILL}`),
      b.measure("minimitappning", "Minimitappning", "m³/s", `${VD} (villkor för minimitappning)`),
      b.measure("fiskvag", "Flöde i fiskväg", "m³/s", `${VD} (villkor för fiskväg)`),
      b.count("spill", "Spill via utskov", "m³/s"),
      b.computed("totalt", "Totalt flöde förbi anläggningen", "SUMMA(turbinflode; minimitappning; fiskvag; spill)", { unit: "m³/s", trend: true }),
      b.checks("niva", "Nivå och flöde", ["Övre nivå inom dämnings- och sänkningsgräns", "Ändringstakten i nivå och flöde har följt villkoren", "Nivå- och flödesloggning och dataöverföring fungerar"]),
    ]),
    b.section("Damm, utskov och luckor", [
      b.checks("damm", "Damm och luckor", [
        "Dammens krön, släntar och tå utan sättningar, sprickor, erosion eller sjunkgropar", "Inget synligt eller förändrat läckage vid damm och tå", "Ingen växtlighet, träd eller rötter på dammkroppen",
        "Luckornas läge överensstämmer med indikeringen", "Luckor utan skador, tätningar hela, fria från is och drivgods", "Luckmaskineri: oljenivå och inget läckage",
        "Isfrihållning vid luckor i funktion (vintertid)", "Tillträdesvägar, räcken och brobana säkra", "Skalskydd, grindar och lås intakta",
      ]),
      b.measure("dammlackage", "Uppmätt läckage vid damm", "l/s", `${DSP} (referensvärde från tidigare mätningar)`),
    ]),
    b.section("Intag, galler och vattenvägar", [
      b.measure("gallerdiff", "Nivådifferens över intagsgaller", "cm", `${TILL}; ${DTP}`),
      b.field("fisk_galler", "Fisk fastnad på intagsgallret", "yesno", { deviationOn: "YES" }),
      b.checks("intag", "Intag och vattenvägar", [
        "Intagsgaller rent från drivgods och is", "Gallerrensare i funktion", "Rensat material omhändertaget och kontrollerat för fisk",
        "Intagskanal och tilloppstub utan erosion eller läckage", "Tub och tryckledning utan läckage eller skador", "Avstängningsventil eller intagslucka i avsett läge",
      ]),
    ]),
    b.section("Turbin och reglering", [
      b.count("ledskena", "Ledskeneöppning", "%"),
      b.count("lophjul", "Löphjulsvinkel (Kaplan)", "°"),
      b.measure("axeltatning", "Läckage vid axeltätning", "l/min", TILL),
      b.measure("reglerolja_niva", "Reglerolja, nivå", "%", TILL),
      b.measure("reglerolja_tryck", "Reglerolja, tryck", "bar", TILL),
      b.measure("reglerolja_temp", "Reglerolja, temperatur", "°C", TILL),
      b.checks("turbin", "Turbin och hydraulik", [
        "Inget onormalt ljud, lukt eller skakningar vid turbinen", "Brytpinnar och länkage hela", "Servomotorer utan oljeläckage", "Oljepumpar växlar och går utan onormalt ljud",
        "Oljefiltrets differenstrycksindikering utan anmärkning", "Inga onormala pulsationer eller ljud i sugröret", "Inget läckage av olja eller vatten i turbingropen", "Automatiskt smörjsystem för ledskenor i funktion",
      ]),
    ]),
    b.section("Generator och lager", [
      b.measure("styrlager_turbin", "Styrlager turbin, temperatur", "°C", TILL),
      b.measure("styrlager_generator", "Styrlager generator, temperatur", "°C", TILL),
      b.measure("barlager", "Bärlager, temperatur", "°C", TILL),
      b.measure("lagerolja_temp", "Lagerolja, temperatur", "°C", TILL),
      b.measure("lagerolja_niva", "Lagerolja, nivå", "%", TILL),
      b.measure("vibration", "Vibration vid lager", "mm/s", `${TILL}; zoner enligt ISO 20816-5; referensvärde från tidigare mätningar`),
      b.measure("statorlindning", "Statorlindning, temperatur", "°C", `${TILL} (isolationsklass)`),
      b.count("generator_spanning", "Generatorspänning", "kV"),
      b.count("generator_strom", "Generatorström", "A"),
      b.count("frekvens", "Frekvens", "Hz"),
      b.checks("generator", "Generator och lager", [
        "Lageroljan ser normal ut (inte grumlig, inget vatten eller metallpartiklar)", "Oljeflöde i synglas och lageroljepumpens tryck normalt", "Släpringar och kolborstar utan gnistbildning eller damm",
        "Inget onormalt ljud eller brandlukt från generatorn", "Bromsar frånslagna under drift, lufttryck normalt",
      ]),
    ]),
    b.section("Kylvatten, dränage och hjälpsystem", [
      b.measure("tryckluft", "Tryckluft (bromsar och reglering)", "bar", TILL),
      b.measure("stationstemp", "Temperatur i stationen", "°C", DTP),
      b.checks("hjalp", "Hjälpsystem", ["Inget vatten i oljan från kylarna", "Dränagegrop: nivå och båda länspumparna fungerar", "Oljeavskiljare vid länsvatten fungerar", "Ventilationen i stationen fungerar"]),
    ]),
    b.section("Elsystem, hjälpkraft och reservkraft", [
      b.measure("laddare", "Batteriladdarens flytspänning", "V DC", `${TILL} (batteri och laddare)`),
      b.field("reservkraft_prov", "Senaste provkörning av reservkraft", "date"),
      b.checks("el", "Elsystem", [
        "Ingen jordfelsindikering på batterisystemet", "Batterirum utan läckage, med ventilation och fri utrymningsväg", "Transformator: oljenivå, temperatur, läckage och avfuktare utan anmärkning",
        "Ställverk och brytare: rätt lägesindikering, inga onormala ljud eller värme", "Hjälpkraften i drift", "Reservkraftaggregatet driftklart (bränsle, laddning, larm)", "Reserv- och nödmanövrering av luckor tillgänglig",
      ]),
    ]),
    b.section("Miljö och villkor", [
      b.field("oljefilm", "Oljefilm eller oljeläckage till vatten", "yesno", { deviationOn: "YES" }),
      b.checks("miljo", "Miljö och villkorsefterlevnad", [
        "Minimitappningen uppfylld sedan förra ronden (logg kontrollerad)", "Ingen torrläggning av naturfåra eller fiskväg", "Fiskvägens in- och utlopp fria från drivgods, grus och is",
        "Fiskvägens vattendjup och strömbild normala, ingen död fisk", "Fiskvägen öppen enligt villkorad period", "Nedströmspassage och avledare fria", "Saneringsutrustning (länsar, absorbenter) komplett",
        "Oljor och kemikalier förvarade invallat och märkta", "Nivån avläsbar för allmänheten (pegel eller webb)", "Ingen erosion eller grumling nedströms",
      ]),
    ]),
    b.section("Säkerhetsutrustning och arbetsmiljö", [
      b.checks("sakerhet", "Säkerhet", [
        "Brandlarm utan fel", "Brandsläckare på plats och plomberade", "Livräddningsutrustning vid damm och intag", "Avspärrningar och varningsskyltar för strömmande vatten",
        "Skyddsutrustning och isolerade verktyg tillgängliga", "Utrymningsvägar fria och nödbelysning fungerar", "Ensamarbete: larm eller rapportering enligt rutin",
      ]),
    ]),
    b.section("Avvikelser och avslut", [
      b.deviations("Avvikelser", ["Observera", "Planeras", "Akut"], ["Planeras", "Akut"]),
      b.field("underrattelse", "Underrättelse krävs (tillsynsmyndighet, driftcentral eller nedströms dammägare)", "yesno", { width: "two_thirds" }),
      { id: "vk-summary", type: "summary", label: "Sammanfattning / avvikelser" },
      b.signature("kontrollant_sign", "Ronden utförd av", { role: "performer" }),
    ]),
  ], b.limits, { limitObjectKey: "aggregat", report: { title: "Daglig tillsyn", code: "Vattenkraftstation", taskFacts: true } });
})();

// ---------------------------------------------------------------------------------------------------------------
// Provkörning och tillsyn – reservkraftaggregat
// ---------------------------------------------------------------------------------------------------------------
const standby = (() => {
  const b = builder("rk");
  const RK = "Aggregatets tillverkare och anläggningens provplan";
  return build([
    b.section("Aggregat och prov", [
      b.field("datum", "Datum", "date", { required: true, prefill: "today" }),
      b.field("aggregat", "Aggregat", "text", { required: true, prefill: "facility" }),
      b.field("provtyp", "Typ av prov", "choice", { options: ["Veckotillsyn (utan last)", "Månadsprov med last", "Årsprov med last", "Efter larm eller reparation"], required: true }),
      b.field("kontrollant", "Utfört av", "text", { prefill: "user" }),
    ]),
    b.section("Uppställningsplats och säkerhet", [b.checks("plats", "Uppställningsplats", ["Fritt tillträde, dörrar och utrymningsvägar fungerar, brandsläckare på plats", "Inget läckage av olja, bränsle eller kylvätska", "Driftväljaren står i AUTO (återställd efter prov)"]),
      b.field("journal", "Driftinstruktion och driftjournal finns vid aggregatet", "yesno", { deviationOn: "NO", width: "half" })]),
    b.section("Motor, batteri och bränsle (stillastående)", [
      b.measure("motortemp", "Motortemperatur med motorvärmare", "°C", `${RK} (källorna anger ca 35–50 °C – verifiera)`),
      b.measure("laddspanning", "Laddspänning startbatteri", "V", "Batteri- och laddartillverkaren"),
      b.count("laddstrom", "Laddström", "A"),
      b.measure("batteritemp", "Batteritemperatur", "°C", "Batteritillverkaren"),
      b.measure("bransle", "Bränslenivå", "%", "Anläggningens bränsleplan (t.ex. fyll på under viss nivå)"),
      b.field("batteri_datum", "Batterier inom tillverkarens bytesintervall", "yesno", { deviationOn: "NO" }),
      b.field("bransleprov", "Bränsleprov analyserat senaste 12 månaderna", "yesno", { deviationOn: "NO" }),
      b.checks("motor", "Motor och bränsle", ["Motoroljenivå inom markeringarna", "Slangar, klämmor och drivremmar utan sprickor", "Luftfilter och undertrycksindikator inte igensatta", "Batterier hela, poler rena och åtdragna",
        "Invallning hel och fri från bränsle, larm för låg nivå och läckage testade", "Ventilationsspjäll öppnar och stänger, galler inte igensatta", "Avgassystemet tätt, skydd hela"]),
    ]),
    b.section("Larm", [b.checks("larm", "Larm", ["Aktiva och historiska larm genomgångna", "Nödstopp fungerar och är märkt"]),
      b.field("larmkedja", "Hela larmkedjan testad till larmmottagare och jour", "yesno", { width: "half" })]),
    b.section("Provkörning med last", [
      b.field("verklig_last", "Provet kördes mot verklig last", "yesno", { width: "half" }),
      b.measure("starttid", "Tid från start till last", "s", `${RK} (kravspecifikation)`),
      b.measure("last", "Last", "kW", `${RK} (lägsta last, t.ex. 30–50 % av märkeffekt – konfigureras per anläggning)`),
      b.measure("spanning", "Spänning mellan faser", "V", `${RK} (märkdata och prestandaklass)`),
      b.measure("strom", "Högsta fasström", "A", "Generatorns märkström"),
      b.measure("frekvens", "Frekvens", "Hz", `${RK} (prestandaklass)`),
      b.measure("oljetryck", "Oljetryck", "kPa", RK),
      b.measure("avgastemp", "Avgastemperatur", "°C", RK),
      b.count("provtid", "Provets längd", "h"),
      b.count("timmar", "Drifttimräknare efter prov", "h"),
      b.count("forbrukning", "Bränsleförbrukning under provet", "l"),
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
  const PS = "Pumptillverkarens datablad och anläggningens driftinstruktion";
  return build([
    b.section("Pumpstation", [
      b.field("datum", "Datum", "date", { required: true, prefill: "today" }),
      b.field("station", "Pumpstation", "text", { required: true, prefill: "facility" }),
      b.field("pump", "Pump", "choice", { options: ["P1", "P2", "P3", "Hela stationen"], defaultValue: "P1", help: "Gränsvärden kan sättas per pump." }),
      b.field("kontrollant", "Utfört av", "text", { prefill: "user" }),
    ]),
    b.section("Tillträde och arbetsmiljö", [
      b.field("nedstigning", "Nedstigning i sump eller ventilkammare", "yesno", { allowNotApplicable: false }),
      b.field("gasmatning", "Luftmätning gjord före nedstigning", "yesno", { deviationOn: "NO", ...when("nedstigning") }),
      b.measure("h2s", "Svavelväte (H₂S)", "ppm", "Gasvarnarens larmnivåer och hygieniska gränsvärden (AFS)", { ...when("nedstigning") }),
      b.measure("o2", "Syrgashalt", "% vol", "Gasvarnarens larmnivå", { ...when("nedstigning") }),
      b.checks("tilltrade", "Tillträde", ["Station, lock och luckor låsta och hela, varningsskyltar på plats", "Stege, plattform, räcken och galler hela"]),
    ]),
    b.section("Pump", [
      b.count("drifttimmar", "Drifttimräknare", "h"),
      b.measure("starter", "Antal starter", "st", `${PS} (högsta antal starter per timme)`),
      b.measure("strom", "Driftström", "A", `${PS} (märkström och motorskydd)`),
      b.measure("isolation", "Isolationsresistans fas–jord", "MΩ", `${PS} (periodisk kontroll av behörig person)`),
      b.checks("pumpkontroll", "Pump", ["Omkopplare i Auto och pumpväxlingen fungerar", "Inga larm från termokontakter, läckagesensor eller motorskydd", "Pumphjul och spel kontrollerade vid upptagning"]),
    ]),
    b.section("Nivåer, larm och bräddning", [
      b.measure("niva", "Nivå i pumpsumpen", "m", "Anläggningens start-, stopp- och larmnivåer"),
      b.measure("tryck", "Tryck i utgående ledning", "bar", "Anläggningens driftinstruktion och dimensionering"),
      b.field("bradd", "Bräddning sedan förra tillsynen", "yesno", { deviationOn: "YES" }),
      b.count("bradd_antal", "Antal bräddtillfällen", "st", { ...when("bradd") }),
      b.count("bradd_tid", "Total bräddtid", "min", { ...when("bradd") }),
      b.count("bradd_volym", "Bräddad volym", "m³", { ...when("bradd"), help: "Ange om den är mätt eller beräknad (NFS 2016:6)." }),
      b.checks("nivaer", "Styrning och larm", ["Nivågivaren stämmer mot kontrollmätning", "Nödkörning via nivåvippa fungerar", "Sumpen fri från flytslam, fett och skräp", "Larm sedan förra tillsynen genomgångna",
        "Larmöverföring till övervakning eller jour provad", "Backventiler och avstängningsventiler fungerar och är täta", "Backventil på bräddledning fungerar"]),
    ]),
    b.section("El, ventilation och reservkraft", [b.checks("el", "El och ventilation", ["Elskåp rent och torrt, kablar hela", "Jordfelsbrytare provad med testknapp", "Ventilation och luktfilter fungerar", "Reservkraftsomkopplare och reservkabellucka åtkomliga och hela"])]),
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
    description: "Generell mall: nivåer, flöden, aggregat, damm och miljövillkor med gränsvärden per anläggning.",
  }) },
  { id: "hintek-reservkraft", document: standby, meta: formMetaSchema.parse({
    name: "Reservkraft – tillsyn och provkörning", icon: "zap", color: "violet", category: "ROUNDS",
    description: "Veckotillsyn och provkörning med last: batteri, bränsle, larm, spänning och frekvens.",
  }) },
  { id: "hintek-pumpstation", document: pumpStation, meta: formMetaSchema.parse({
    name: "Tillsyn – pumpstation", icon: "wrench", color: "blue", category: "ROUNDS",
    description: "Tillsyn av pumpstation: pumpar, nivåer, larm, bräddning och säker nedstigning.",
  }) },
];
