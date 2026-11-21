import { INSTRUCTIONS } from "./ladder/instructions";

// PLC-simulatorn, Hjälp (2026-11-05): the guide and the explanations as data, so a test can hold them to what the code does.
// Own words, no text from a standard or a manufacturer. "Larm", never "larmsystem": Workflow is no alarm system. The numbers here are the
// simulator's and Workflow's own limits (lib/machine/alarm-rules.ts, lib/machine/intake.ts), never limit values for a machine.

export const HELP_TOPICS = [
  { id: "start", label: "Kom igång" },
  { id: "alarms", label: "Larm och AI" },
  { id: "api", label: "API-koppling" },
  { id: "reference", label: "Paneler och fel" },
] as const;
export type HelpTopicId = (typeof HELP_TOPICS)[number]["id"];

export const GUIDE_EXAMPLE_ID = "lampa-knapp";

/** The guide's program: DI0 is %IX0.0 and DO0 is %QX0.0. */
export const GUIDE_PROGRAM = [
  "PROGRAM Lampa",
  "VAR",
  "  Knapp AT %IX0.0 : BOOL;  // DI0",
  "  Ljus AT %QX0.0 : BOOL;   // DO0",
  "END_VAR",
  "",
  "Ljus := Knapp;",
  "END_PROGRAM",
].join("\n");

export type GuideShow = "supply" | "devices" | "wires" | "check" | "program" | "run" | "tags" | "connection";
export type GuideStep = { id: string; title: string; lines: readonly string[]; list?: readonly string[]; code?: string; show?: { action: GuideShow; label: string } };

export const GUIDE_STEPS: readonly GuideStep[] = [
  {
    id: "matning", title: "Kontrollera matningen",
    lines: ["PLC:n får sin ström från en spänningskälla. På en ny ritning finns 24 V DC redan, och den är kopplad.", "Saknas källan drar du in 24 V DC från Paletten och kopplar två ledningar:"],
    list: ["Källans + till L+ på PLC:n.", "Källans − till M på PLC:n."],
    show: { action: "supply", label: "Visa mig var" },
  },
  {
    id: "apparater", title: "Dra in apparater",
    lines: ["Dra in en Tryckknapp och en Lampa från Paletten.", "Klickar du på en bild hamnar apparaten på en ledig plats."],
    show: { action: "devices", label: "Visa mig var" },
  },
  {
    id: "ledningar", title: "Koppla ledningarna",
    lines: ["Håll Ctrl, eller välj Redigera i verktygsraden, och dra från en plint till nästa. Plintens namn står bredvid den."],
    list: ["Källans + till 13 på knappen.", "14 på knappen till DI0.", "DO0 till X1 på lampan.", "X2 på lampan till källans −."],
    show: { action: "wires", label: "Visa DI0 och DO0" },
  },
  {
    id: "kontroll", title: "Läs Kontroll",
    lines: ["Panelen Kontroll visar direkt om något är fel kopplat.", "Klickar du på en rad markeras felet på ritytan. När allt är rätt står inga fel där."],
    show: { action: "check", label: "Visa Kontroll" },
  },
  {
    id: "program", title: "Skriv programmet",
    lines: ["Programmet bestämmer vad PLC:n gör. Här lyser lampan så länge knappen hålls ned.", "Skriv programmet i ST eller rita det i Ladder. Tryck sedan F7 för att kontrollera det."],
    code: GUIDE_PROGRAM,
    show: { action: "program", label: "Skriv in programmet åt mig" },
  },
  {
    id: "kor", title: "Kör och prova",
    lines: ["Tryck F5 för att starta PLC:n.", "Håll sedan ned knappen på ritytan, så tänds lampan."],
    show: { action: "run", label: "Starta PLC:n" },
  },
  {
    id: "felsok", title: "Om det inte fungerar",
    lines: ["Går PLC:n inte att starta? Läs Kontroll. Kanske saknar den matning.", "Lyser ERR? Då stoppar en koppling PLC:n, och Kontroll visar vilken.", "Tänds inte lampan? Se i Taggar om Knapp blir 1 när du håller ned knappen.", "Har programmet ett fel? Tryck F7 och klicka på felet, så kommer du till raden."],
    show: { action: "tags", label: "Visa Taggar" },
  },
  {
    id: "workflow", title: "Koppla till Workflow",
    lines: ["Allt stannar i webbläsaren tills du kopplar in en nyckel.", "Panelen Maskinkoppling skickar larm till Workflow. Läs gärna Larm och AI först."],
    show: { action: "connection", label: "Visa Maskinkoppling" },
  },
];

export type HelpPart = { id: string; title: string; flow?: readonly string[]; lines?: readonly string[]; steps?: readonly string[]; list?: readonly string[]; rows?: readonly (readonly [string, string])[]; code?: string };

export const ALARM_PARTS: readonly HelpPart[] = [
  {
    id: "vagen", title: "Hela vägen från signal till klockan",
    steps: [
      "Signal: en larmutgång i simulatorn får spänning. I en riktig anläggning är det en signal eller ett värde i maskinen.",
      "Händelse: larmet skickas till Workflow med kod, nivå och text och sparas under Maskiner.",
      "Beslut: Workflow läser larmets nivå och källans läge.",
      "Arbetsorder eller inte: läget avgör om det blir en arbetsorder, ett förslag eller ingenting.",
      "Notis: klockan visar vad som hände, också när ingen arbetsorder skapades och varför.",
    ],
  },
  {
    id: "statiska", title: "Statiska larm",
    lines: ["Ett statiskt larm följer en regel som ni själva bestämmer. Samma sak händer varje gång.", "Regeln kan finnas på två ställen:"],
    list: [
      "I PLC:n: programmet sätter en larmutgång, till exempel när ett värde har varit för högt en viss tid. Utgångens namn blir larmtexten, och nivån väljer du i Egenskaper.",
      "I Workflow: en regel på en signal under Kopplingar → Maskiner → Signaler, till exempel att värdet är större än en gräns eller att signalen har tystnat.",
    ],
  },
  {
    id: "ai", title: "Regler och AI",
    lines: ["Larmen bygger på regler, och AI hjälper till att förklara dem. AI skapar inga larm och inga arbetsordrar i Workflow i dag."],
    list: [
      "Regler läser varje källas händelser och jämför dem med källans egen historik.",
      "Reglerna ger förslag på sidan Maskiner, till exempel när samma larm kommer om och om igen, när larmen kommer tätare eller när maskinen har tystnat.",
      "Förklara med AI: AI beskriver vad felet kan bero på och vad du kan kontrollera, när någon trycker på knappen och företaget har tillåtit det.",
      "En människa bestämmer alltid och väljer Noterat eller Avvisa. AI avgör aldrig om en maskin är säker att köra.",
      "Ett eget analysprogram vid maskinen kan skicka färdiga diagnoser. De visas i Workflow men skapar ingen arbetsorder.",
    ],
  },
  {
    id: "lagen", title: "Källans tre lägen",
    rows: [
      ["Av", "Händelsen sparas, men ingen arbetsorder skapas. En ny källa står på Av."],
      ["Märkt arbetsorder direkt", "Ett nytt larm med nivån Fel eller Kritiskt blir genast en arbetsorder, och en notis kommer."],
      ["Väntar på godkännande", "Larmet blir ett förslag på sidan Maskiner. Administratörerna får en notis och bestämmer."],
    ],
  },
  {
    id: "sparrar", title: "Det här stoppar en arbetsorder",
    list: [
      "Varning, Info, ett släckt larm, ett driftläge och en diagnos skapar ingen arbetsorder.",
      "Högst en öppen automatisk arbetsorder per objekt, eller per källa när källan saknar objekt.",
      "Efter varje förslag följer en vilotid. I simulatorn är den 30 minuter från början.",
      "Högst 20 per företag under ett dygn, om inget annat är inställt.",
      "Arbetsordern stängs aldrig av sig själv, för ett släckt larm betyder inte att maskinen fungerar igen.",
    ],
  },
  {
    id: "notis", title: "Notisen i klockan",
    list: [
      "Maskinlarm går till dem som har behörighet till Maskiner och till den som får arbetsordern.",
      "Skapas ingen arbetsorder säger notisen varför, till exempel att källan står på Av.",
      "Ett förslag som väntar på godkännande går bara till administratörerna.",
      "Den som trycker Jag tar den blir ansvarig för arbetsordern.",
      "Under Maskiner → Larmansvar ställer företaget in vem som får larmet först.",
    ],
  },
  {
    id: "simulatorn", title: "Så skyddar simulatorn företaget",
    lines: ["Ett larm från simulatorn kan ge riktiga arbetsordrar och notiser. Därför gäller följande:"],
    list: [
      "Inga larm skickas förrän du har en nyckel och har kryssat i Jag förstår.",
      "All text börjar med ”Simulerat:”.",
      "Fel och Kritiskt skickas som Varning tills du tillåter dem, och då skapas ingen arbetsorder.",
      "Nyckeln försvinner när du laddar om sidan.",
    ],
  },
  {
    id: "se", title: "Här ser du vad som hände",
    rows: [
      ["Logg", "I simulatorn: vad som skickades och vad Workflow svarade."],
      ["Maskiner", "I Workflow: händelser, förslag och källans läge."],
      ["Arbetsordrar", "Arbetsordern, skapad av Maskinlarm."],
      ["Klockan", "Notisen, med länk till arbetsordern eller förslaget."],
    ],
  },
];

/** The demo: nothing goes to a server, and what looks like AI there is rules in the browser. */
export const ALARM_DEMO_PART: HelpPart = {
  id: "demo", title: "I den här demon",
  lines: ["Uppgifterna är påhittade, och inget skickas till en server. Under Maskinkoppling finns två exempel."],
  list: [
    "Exempel 1, Traditionellt: PLC:n skickar sin fasta larmtext. Det är ett statiskt larm.",
    "Exempel 2, Med signalmappning: en simulerad lokal AI bredvid PLC:n skriver larmtexten själv.",
    "I exempel 2 gör regler i webbläsaren jobbet, och ingen AI anropas.",
  ],
};

export const ingestExample = (origin: string) => [
  `POST ${origin}/api/ingest/v1/events`,
  "Authorization: Bearer <källans nyckel>",
  "Content-Type: application/json",
  "",
  JSON.stringify(INGEST_EXAMPLE_BODY, null, 2),
].join("\n");

export const INGEST_EXAMPLE_BODY = {
  schemaVersion: 1,
  events: [{ eventId: "pump-2-0001", occurredAt: "2026-11-05T08:00:00+01:00", type: "alarm", code: "PUMP-2-TRYCK", severity: "fault", state: "raised", text: "Högt tryck i pump 2" }],
};

export const API_PARTS: readonly HelpPart[] = [
  {
    id: "steg", title: "Så kommer en händelse in",
    steps: [
      "Skapa en källa under Kopplingar → Maskiner. En källa är ett system som får skicka till Workflow.",
      "Spara nyckeln. Den visas en gång och hör till just den källan.",
      "Systemet skickar händelser till Workflow över HTTPS och har med nyckeln i anropet.",
      "Workflow svarar för varje händelse: mottagen, dubblett eller nekad.",
    ],
  },
  { id: "exempel", title: "Ett exempel" },
  {
    id: "falt", title: "Fälten i en händelse",
    rows: [
      ["eventId", "Systemets eget id. Samma id två gånger blir aldrig två poster."],
      ["occurredAt", "När det hände, med tidszon."],
      ["type", "alarm, state (driftläge) eller diagnosis."],
      ["code", "Larmets kod, till exempel PUMP-2-TRYCK."],
      ["severity", "info, warning, fault eller critical."],
      ["state", "Larm: raised eller cleared. Driftläge: running eller stopped."],
      ["text", "Valfri text, högst 200 tecken. Visas i Workflow."],
    ],
  },
  {
    id: "viktigt", title: "Bra att veta",
    list: [
      "Företaget bestäms av nyckeln, aldrig av innehållet.",
      "Nyckeln kan bara skicka händelser. Den kan inte läsa något.",
      "Trafiken går bara från systemet till Workflow. Inget öppnas mot maskinen.",
      "1–20 händelser per anrop och högst 120 anrop i minuten per källa.",
      "Svaret 202 betyder att anropet togs emot. Läs resultatet för varje händelse.",
    ],
  },
  {
    id: "testa", title: "Testhändelsen",
    lines: ["Generera koppling automatiskt skapar källan och nyckeln, sätter källan på Av och skickar ett test.", "Testa anslutning skickar ett driftläge med koden PLC-SIM-TEST. Det skapar aldrig någon arbetsorder.", "Svaret står under knappen och i panelen Logg."],
  },
  {
    id: "andra", title: "Det här kan du koppla i dag",
    lines: ["I dag kopplar du en PLC eller en Raspberry Pi till Workflow via API, till exempel över en 4G-router. Fler kopplingar utvecklas efter hand.", "Simulatorn använder samma väg som allt annat. Det som kan skicka HTTPS med JSON kan kopplas, till exempel:"],
    list: ["En PLC via Node-RED eller en gateway", "En Raspberry Pi med eget program", "En 4G-router som skickar sin egen JSON", "Ett eget program"],
  },
  {
    id: "pi", title: "Exempel: Raspberry Pi över 4G",
    flow: ["Kundens anläggning", "Raspberry Pi", "4G", "Workflow-servern", "Arbetsorder"],
    lines: ["Ett vanligt sätt är en Raspberry Pi med eget 4G. Pi:n är då skild från kundens nät och skickar själv händelserna ut över 4G."],
    list: [
      "Workflow kontaktar aldrig Pi:n. Trafiken går bara ut från den.",
      "Vilka signaler Pi:n läser väljer den som installerar, och en behörig person kopplar in den.",
      "Ditt eget program, till exempel Node-RED, läser signalerna och lämnar händelserna till Pi:ns mall.",
      "Ligger nätet nere sparas händelserna i en kö och skickas senare.",
      "Mallen är provad mot Workflow men inte på en riktig Pi. Pi och 4G-abonnemang ingår inte.",
      "Upplägget är inget löfte om säkerhet. Vad er anläggning kräver avgör ni själva.",
    ],
  },
  {
    id: "villkor", title: "Vad som krävs av systemet",
    list: [
      "Systemet, eller något framför det, ska skicka formatet ovan. Det finns inga färdiga kopplingar per tillverkare.",
      "Skickar enheten sin egen JSON, till exempel en router, använder du /api/ingest/v1/raw och en formatprofil under Maskiner.",
      "Värdena från /raw blir signaler, och regler på signalerna gör larm av dem.",
      "Varje händelse går sedan samma väg: källans läge, arbetsorder och notis.",
    ],
  },
];

const PANEL_LINES: readonly (readonly [string, string])[] = [
  ["Rityta", "Apparater, ledningar och PLC:n."],
  ["Palett", "Apparater att dra in. Sök i rutan överst."],
  ["Program", "Ladder och ST. Båda visar samma program."],
  ["Taggar", "Alla taggar med värde. I RUN kan du tvinga ett värde."],
  ["Kontroll", "Säger vad som är fel kopplat."],
  ["Egenskaper", "Inställningar för det du har markerat."],
  ["Trend", "Kurvor för de taggar du väljer."],
  ["Maskinkoppling", "Kopplingen till Workflow."],
  ["Logg", "Vad som skickades och vad Workflow svarade."],
  ["Projekt", "Projektets delar. Dubbelklicka för att öppna."],
];

export const HELP_KEYS: readonly (readonly [string, string])[] = [
  ["F1", "Öppna hjälpen"],
  ["F5", "RUN/STOP"],
  ["F7", "Kompilera och verifiera"],
  ["Ctrl+1 … Ctrl+9", "Gå till en panel"],
  ["Ctrl+Z / Ctrl+Y", "Ångra / Gör om"],
  ["Ctrl+D", "Duplicera"],
  ["Delete", "Ta bort det markerade"],
  ["Insert", "Ny rung i Ladder"],
  ["Ctrl+B", "Parallell gren i Ladder"],
  ["V / L", "Markera / Ledning på ritytan"],
  ["Dra", "Flytta vyn på ritytan. Ett klick markerar."],
  ["Ctrl (håll) + dra", "Flytta apparater, rita ledningar och markera med en ruta"],
  ["Redigera", "Knappen i verktygsraden: redigera utan att hålla Ctrl"],
  ["Hjulet", "Zooma på ritytan"],
  ["Esc", "Avbryt det som pågår"],
];

export const COMMON_FAULTS: readonly (readonly [string, string])[] = [
  ["PLC:n saknar matning", "Koppla källans + till L+ och − till M."],
  ["Fel polaritet", "Källans + ska till L+ och − till M. Byt plats på ledningarna."],
  ["Kortslutning", "+ och − möts i samma nät. Klicka på raden i Kontroll, så ser du ledningarna."],
  ["Utgångar hopkopplade", "Två utgångar får inte kopplas ihop. Ta bort ledningen mellan dem."],
  ["Ingång utan gemensam 0 V", "Koppla källans − till PLC:ns M."],
  ["Programmet har ett fel", "Tryck F7. Klicka på felet så kommer du till raden."],
];

/** One line per Ladder instruction: read from the table the Ladder panel draws, so they cannot differ. */
export const LADDER_LINES: readonly (readonly [string, string])[] = INSTRUCTIONS.map((instruction) => [instruction.name, instruction.title]);

export const REFERENCE_PARTS: readonly HelpPart[] = [
  { id: "paneler", title: "Panelerna", lines: ["Dra i en flik för att flytta panelen. En stängd panel öppnar du igen under Visa.", "På ritytan flyttar du vyn genom att dra, och hjulet zoomar. Håll Ctrl, eller välj Redigera, för att flytta apparater och rita ledningar."], rows: PANEL_LINES },
  {
    id: "gren", title: "Parallell gren i Ladder",
    lines: ["En gren betyder ELLER: det räcker att en av vägarna leder."],
    list: [
      "Markera ett element och tryck Gren eller Ctrl+B. Elementet får en väg bredvid sig.",
      "Är ingenting markerat får rungens sista element grenen, och en tom rung får först en kontakt.",
      "Vill du ha två element i samma väg markerar du elementet i grenen och trycker NO. Då hamnar nästa element efter det.",
      "En gren på ett element som har en granne i sin väg blir en gren i grenen.",
      "En gren på en spole ger ytterligare en spole, och båda styrs av samma rung.",
      "Du kan också dra Gren till ett element, ovanför eller under det.",
    ],
  },
  {
    id: "kontaktor", title: "Kontaktorn och motorn",
    lines: ["Simulatorn räknar inte trefas. Den visar bara att kontaktorn drar och att motorn går."],
    rows: [
      ["A1–A2", "Spolen. Med spänning drar kontaktorn."],
      ["1–2", "Sluter när kontaktorn drar. Koppla + till 1, 2 till U1 på motorn och U2 till −."],
      ["13–14", "Hjälpkontakt som sluter när kontaktorn drar."],
      ["21–22", "Hjälpkontakt som bryter när kontaktorn drar."],
    ],
  },
  { id: "fel", title: "Vanliga fel", rows: COMMON_FAULTS },
  { id: "ladder", title: "Ladder-instruktionerna", rows: LADDER_LINES },
  { id: "tangenter", title: "Tangenter", rows: HELP_KEYS },
  { id: "ovning", title: "Ett övningsverktyg", lines: ["Simulatorn är till för att öva och prova. Den räknar med spänningsnivåer, inte strömmar, och är inget verktyg för elsäkerhet.", "Gränserna i simulatorn är simulatorns egna och gäller ingen riktig apparat."] },
];

export const HELP_SEEN_KEY = "workflow-plc-simulator-help-seen-v1";
