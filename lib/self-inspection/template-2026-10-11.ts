import type { OldTemplateSection } from "./template-2026-10-07";

/**
 * Workflow's template edition 2026-10-11.1 (the product owner's programme with the regulation check's gaps filled), its
 * sections frozen word for word when edition 2026-11-20.1 replaced it. Like ./template-2026-10-07.ts and
 * ./template-2026-10-08.ts it is no longer offered anywhere: the only use is the equality check that tells an untouched
 * copy from a programme the company has edited (./template-upgrade.ts and the release migration). Its roles are the
 * current edition's, unchanged. Never edit these texts.
 */
export const SECTIONS_2026_10_11_1: readonly OldTemplateSection[] = [
  {
    key: "intro", title: "Inledning", legalRef: "Elsäkerhetslagen (2016:732) 24 §; ELSÄK-FS 2017:3 3 kap. 2 §",
    body: [
      "Det här egenkontrollprogrammet är upprättat för att uppfylla kraven i 24 § elsäkerhetslagen för [företagets namn] med organisationsnummer [organisationsnummer].",
      "[Beskriv kort företagets verksamhet: vilka tjänster företaget erbjuder, vilka slags anläggningar och spänningsnivåer arbetet gäller, och därmed förenlig verksamhet.]",
      "Programmet gäller allt elinstallationsarbete som företaget utför, av egen och inhyrd personal. Det beskriver organisationen och de rutiner som gör att arbetet följer gällande regler. Alla som arbetar enligt programmet tar del av den gällande versionen och bekräftar det i Workflow. Programmet hålls aktuellt, ses över minst en gång per år och varje fastställd version sparas (avsnitt 9).",
      "Programmet är skrivet på svenska. Behöver någon som arbetar i verksamheten programmet på ett annat språk tar företaget fram en översättning innan personen börjar arbeta enligt det.",
    ].join("\n\n"),
  },
  {
    key: "business", title: "Elinstallationsverksamheten", legalRef: "ELSÄK-FS 2017:3 3 kap. 4 §, 5 kap. 2 §",
    body: [
      "## 2.1 Kontaktpersoner",
      "| Namn | Befattning | Kontaktuppgifter |",
      "|---|---|---|",
      "| [Namn] | VD | E-post: [e-post], tel: [telefon] |",
      "| [Namn] | Elinstallatör för regelefterlevnad | E-post: [e-post], tel: [telefon] |",
      "| [Namn] | Administratör för egenkontrollprogrammet | E-post: [e-post], tel: [telefon] |",
      "",
      "## 2.2 Verksamhetens adress och organisationsuppgifter",
      "[Företagets namn], org.nr [organisationsnummer]",
      "[Gatuadress], [postnummer och ort]",
      "E-post: [e-post], tel: [telefon]",
      "",
      "## 2.3 Verksamhetstyper registrerade hos Elsäkerhetsverket",
      "Alla slags elinstallationsarbeten inom de verksamhetstyper som är markerade i programmets uppgifter nedan. Registreringen hos Elsäkerhetsverket anger organisationsnummer, verksamhetstyper, kontaktperson och vilken elinstallatör för regelefterlevnad som är registrerad; den kontrolleras årligen enligt avsnitt 9.2.",
      "Utför företaget bara vissa slags arbeten inom en verksamhetstyp skrivs begränsningen in här, så att det är tydligt vad programmet omfattar.",
      "",
      "## 2.4 Inhyrd personal och underentreprenörer",
      "Personal som hyrs in och arbetar i företagets uppdrag omfattas av det här programmet. Köper företaget elinstallationsarbete av ett annat elinstallationsföretag utförs arbetet enligt det företagets eget egenkontrollprogram; före beställningen kontrolleras att det företaget är registrerat hos Elsäkerhetsverket för de verksamhetstyper arbetet gäller.",
    ].join("\n"),
  },
  {
    key: "competence", title: "Kompetenskrav och tillgången till kompetens", legalRef: "ELSÄK-FS 2017:3 3 kap. 5 §",
    body: [
      "Företaget ansvarar för att elinstallationsarbete utförs av personal med tillräcklig kompetens och att arbetet följer god elsäkerhetsteknisk praxis samt den säkerhetsnivå som är etablerad inom elsäkerhetsområdet. Varje medarbetares kompetens dokumenteras i ett personligt kompetenskort.",
      "För inhyrd personal gäller samma minimikrav som för egen personal, och detta ska styrkas med kompetenskort från det uthyrande företaget.",
      "Personer under utbildning, såsom praktikanter, APL-elever från gymnasieskolan, lärlingar eller motsvarande, får endast utföra elinstallationsarbete under handledning av en montör.",
      "Som anvisning för elsäkerhet i arbetet tillämpas SS-EN 50110-1, såvida inte kunden kräver annat.",
      "Vilka arbeten en person får utföra framgår av personens roller och av bilagan Personer och kompetens, där bedömningen och eventuella begränsningar står. Bedömningen bygger på utbildning, dokumenterad erfarenhet och genomförda arbeten, och vid behov på intern upplärning eller prov.",
      "Finns ingen med rätt kompetens för ett slags arbete utförs det inte förrän kompetensen finns – genom utbildning, nyanställning eller inhyrning – eller så tas arbetet bort ur programmet.",
      "## 3.1 Upprätthållande och utveckling av kompetens",
      "Företaget strävar efter att all personal är uppdaterad på gällande regelverk för de elinstallationsarbeten de utför. Anvisningarna för elsäkerhet vid arbete repeteras vart tredje år, liksom SS 436 40 00.",
      "Genomförda repetitionstillfällen dokumenteras med datum på medarbetarnas kompetenskort. För att säkerställa fortsatt hög kompetens och säkerhet uppdateras och registreras kunskap och utbildningar löpande, och extra utbildning planeras när ny teknik, nya eller ändrade regler eller ovanligt komplicerade anläggningar kräver det.",
    ].join("\n\n"),
  },
  {
    key: "ere", title: "Elinstallatör för regelefterlevnad registrerad hos Elsäkerhetsverket", legalRef: "Elsäkerhetslagen (2016:732) 23 §; ELSÄK-FS 2017:3 3 kap. 6 §",
    body: [
      "Företaget har utsett en auktoriserad elinstallatör för regelefterlevnad som står i företagets registrering hos Elsäkerhetsverket. Vem som är utsedd och auktorisationsnivån framgår nedan, ur rollen Elinstallatör för regelefterlevnad.",
      "Om flera elinstallatörer för regelefterlevnad är utsedda beskrivs här hur uppdraget fördelas mellan dem: [ange fördelningen, eller ta bort stycket om bara en är utsedd].",
    ].join("\n\n"),
  },
  {
    key: "organization", title: "Organisationsschema (roller)", legalRef: "ELSÄK-FS 2017:3 3 kap. 7 §",
    body: [
      "Organisationsschemat nedan visar rollerna i programmet och vilka personer som har dem: VD, Administratör för egenkontrollprogrammet, Elinstallatör för regelefterlevnad, Projektör, Montör, Montör med kontrolluppgift och Inhyrd personal. [Anpassa rollerna efter företagets organisation.] Samma rollnamn används i hela programmet och i arbetsordrar, planer och protokoll.",
      "## 5.1 Organisation för egenkontrollprogram och elinstallationsarbete",
      "Den registrerade elinstallatören har i uppgift att:",
      "- stötta ledningen för regelefterlevnad av företagets egenkontrollprogram,\n- ta fram relevanta utbildningar för personal som ingår i egenkontrollprogrammet,\n- rapportera tillbud och vara delaktig i utredningar vid elolycka,\n- hålla administratören av egenkontrollprogrammet uppdaterad.",
      "Administratören av egenkontrollprogrammet har till uppgift att uppdatera och fastställa egenkontrollprogrammet och registreringen hos Elsäkerhetsverket enligt ELSÄK-FS 2017:3 3 kap. 13 § och hålla medarbetarna uppdaterade enligt företagets organisation.",
      "Respektive roll beskrivs i rollbeskrivningarna i bilagan Roller och ansvar. Uppdragsspecifika roller anges i arbetsorder eller kvalitets- och miljöplan för respektive uppdrag.",
      "## 5.2 Personer med ansvar i egenkontrollprogrammet",
      "Vilka personer som har rollerna VD, Elinstallatör för regelefterlevnad och Administratör för egenkontrollprogrammet framgår av organisationsschemat nedan och av bilagan Roller och ansvar. Kontaktuppgifterna står i avsnitt 2.1.",
    ].join("\n\n"),
  },
  {
    key: "planning", title: "Planering av elinstallationsarbete", legalRef: "ELSÄK-FS 2017:3 3 kap. 8 och 9 §§",
    body: [
      "## 6.1 Uppdrag",
      "Alla uppdrag som innebär elinstallationsarbete ska planeras innan utförande. För service och mindre arbeten dokumenteras planeringen i en arbetsorder. Vid större arbeten och entreprenadprojekt dokumenteras planeringen i en kvalitets- och miljöplan för uppdraget.",
      "Uppdrag ska kopplas till en metod för planering och kontroll där det framgår vilka som ska utföra uppdraget samt att de har relevant kompetens och roll för uppdraget. Innan en person tilldelas arbete kontrolleras att personen är auktoriserad eller omfattas av programmet och har den kompetens som arbetet kräver. Ingen utför elinstallationsarbete som hen inte har fått tilldelat. Om ingen annan metod noterats i arbetsorder eller kvalitets- och miljöplan tillämpas den generella metoden enligt avsnitt 6.3 och 6.4.",
      "## 6.2 Elsäkerhet vid arbete på driftsatta anläggningar",
      "Arbeten på driftsatta anläggningar utförs enligt arbetsmetoden arbete utan spänning enligt SS-EN 50110-1. Om en annan metod krävs ska en särskild plan tas fram av arbetsledningen och personalen ska ha genomgått relevant utbildning för den metoden.",
      "## 6.3 Metod för elinstallationsarbete, inklusive inkoppling av elektrisk utrustning",
      "Projektören eller montören ansvarar för att planera och utföra uppdraget enligt följande steg:",
      [
        "1. Anläggningskännedom: om arbetet gäller en befintlig elanläggning, skaffa en förståelse för hur den ser ut. Inspektera den del av anläggningen som berörs och notera eventuella brister eller viktiga omständigheter. Dokumentation av inspektionen behövs endast om kunden kräver det eller om arbetets omfattning gör det nödvändigt.",
        "2. Bedömning av arbetets omfattning: bestäm hur stort elinstallationsarbetet är. Avgör om det handlar om nyinstallation, ombyggnad eller utvidgning av anläggningen. Ta hänsyn till kundens eller beställarens krav och specifikationer.",
        "3. Kravbestämning: fastställ vilka föreskrifter och standarder som gäller utifrån arbetets typ. Vid nyinstallation, ombyggnad eller utvidgning ska aktuella föreskrifter följas. Vid arbete på befintliga installationer tillämpas de föreskrifter som gällde vid deras ursprungliga utförande.",
        "4. Rådgivning vid osäkerhet: om du är tveksam kring bedömningar eller föreskrifter, kontakta din närmaste chef eller ansvarig person.",
        "5. Kontrollpunkter inför idrifttagning: bestäm vilka kontroller som behöver göras innan anläggningen tas i drift. Kontrollpunkterna dokumenteras i protokoll i Workflow; kundens eller företagets ytterligare dokumentationskrav anges i uppdraget.",
        "6. Hantering av upptäckta brister: informera kunden om eventuella brister i den befintliga anläggningen. Spänningssätt inte anläggningen förrän bristerna är åtgärdade eller kunden har beslutat om åtgärd. Om kunden väljer att inte åtgärda bristerna och arbetet måste avbrytas, meddela kunden tydligt orsaken och att företaget inte tar ansvar om anläggningen ändå spänningssätts.",
        "7. Spänningssättning: när alla brister är åtgärdade kan anläggningen spänningssättas.",
        "8. Kundens krav på dokumentation: om kunden kräver dokumentation av kontroller och godkännande innan spänningssättning, säkerställ att detta utförs.",
      ].join("\n"),
      "## 6.4 Metod för elinstallationsarbete i nyproduktion",
      "Vid nyproduktion tillämpas gällande regelverk vid elinstallationsarbetet. Planeringen utgörs ofta av en beställning med teknisk specifikation och ritningar. Se särskilt dokument för respektive uppdrag eller projekt. Metoden enligt 6.3 kan användas, bortsett från punkt 1.",
      "## 6.5 Montör med kontrolluppgift",
      "Montör med kontrolluppgift ska göra kontroll efter färdigställande (kontroll före idrifttagning). Den ska även kontrollera att övriga utförare genomfört kontroll av sitt utförda elinstallationsarbete. Montör med kontrolluppgift utses för respektive uppdrag där fler än en montör deltar. Särskild rollbeskrivning finns för montör med kontrolluppgift. Alla montörer kan anta rollen.",
    ].join("\n\n"),
  },
  {
    key: "requirements", title: "Kravbestämning", legalRef: "ELSÄK-FS 2017:3 3 kap. 8 §",
    body: [
      "## 7.1 Allmänt",
      "Utförande av elinstallationsarbete ska ske fackmannamässigt med beaktande av tillverkarens montageanvisningar. Ändras förutsättningarna under arbetet – till exempel att anläggningen visar sig vara utförd på annat sätt än väntat eller att omfattningen ändras – görs kravbestämningen om innan arbetet fortsätter.",
      "## 7.2 Nyutförande, ombyggnad och utvidgning",
      "Utförande av elinstallationsarbete ska ske enligt dagens gällande föreskrifter så att god elsäkerhetspraxis uppnås. Om utförandet avviker från fastställd standard ska elinstallationsföretaget kunna styrka att säkerhetsnivån på det alternativa utförandet minst motsvarar standardens.",
      "## 7.3 Underhållsarbeten",
      "Elinstallationsarbeten som enbart innebär utbyte av befintliga elinstallationer i underhållssyfte ska utföras enligt de föreskrifter som gällde vid tiden för originalinstallationens utförande.",
    ].join("\n\n"),
  },
  {
    key: "inspection", title: "Kontroll av elinstallationsarbete", legalRef: "ELSÄK-FS 2017:3 3 kap. 10–11 §§",
    body: [
      "## 8.1 Kontroll av eget arbete",
      "Alla medarbetare som utför elinstallationsarbete är ansvariga för att kontrollera sitt eget arbete under montaget. För erfarna montörer är detta vanligtvis inget problem. Om en medarbetare är ny i yrket eller känner sig osäker ska denne alltid rådfråga en mer erfaren kollega eller sin närmaste chef. Det är av yttersta vikt att arbetet utförs korrekt och säkert, samt att eventuella tveksamheter klargörs innan arbetet fortskrider.",
      "## 8.2 Kontroll efter utförande (kontroll före idrifttagning)",
      "Kontrollen före idrifttagning planeras i samband med elinstallationsarbetets planering. Kontrollpunkterna dokumenteras alltid, i protokoll i Workflow. När instrumentet genererar en rapport över utförd kontroll bifogas den, så att inga extra blanketter behöver fyllas i. Kontrollpunkter som inte är relevanta för den aktuella installationen kan utelämnas.",
      "## 8.3 Uppföljning",
      "Fel som påträffas vid kontrollen rättas till och rapporteras till den som har utfört planeringen. Den som är ansvarig för planeringen avgör om felet utgör ett systematiskt fel som kräver att egenkontrollprogrammet behöver åtgärdas. Detta rapporteras till företagets registrerade elinstallatör.",
    ].join("\n\n"),
  },
  {
    key: "followup", title: "Uppföljning av egenkontrollprogram", legalRef: "ELSÄK-FS 2017:3 3 kap. 11–13 §§",
    body: [
      "## 9.1 Avvikelserapportering",
      "Avvikelser från kontroller, provningar och egna upptäckter rapporteras i avvikelseloggen i Workflow. Avvikelser och felaktigheter av sådan karaktär att de kräver rutinförändringar eller riskerar att upprepas hanteras som avvikelserapporter och kategoriseras som omedelbar åtgärd eller rutinöversyn. Alla som är anställda på företaget har instruerats att rapportera avvikelser.",
      "## 9.2 Registrering hos Elsäkerhetsverket",
      "Kontroll av registreringen hos Elsäkerhetsverket utförs en gång årligen för att säkerställa att den är giltig. Ansvarig för detta är administratören för egenkontrollprogrammet. Egenkontrollprogrammet ses över årligen [i samband med medarbetarsamtal]. Översynen registreras i Workflow; en ändring fastställs som en ny version och tidigare versioner sparas.",
      "Vid översynen går administratören tillsammans med elinstallatören för regelefterlevnad igenom avvikelseloggen, handlingsplanen, kompetenskorten och ett urval av årets protokoll. Syftet är att bedöma om rutinerna fungerar i praktiken och om egenkontrollen räcker för det arbete företaget gör. Resultatet redovisas för VD och det som behöver ändras förs in i handlingsplanen.",
      "## 9.3 Handlingsplan",
      "Avvikelser, förslag och återkommande aktiviteter som gäller egenkontrollprogrammet noteras och följs upp i handlingsplanen i Workflow, tillsammans med avvikelseloggen.",
      "## 9.4 Ändringar, versioner och spårbarhet",
      "Programmet uppdateras när något ändras som har betydelse för egenkontrollen, även mellan de årliga översynerna – till exempel nya verksamhetstyper, en ny elinstallatör för regelefterlevnad, en ändrad organisation eller nya rutiner. Varje ändring fastställs som en ny version med en kort motivering. Tidigare versioner sparas oförändrade. Den som planerar en ny sorts elinstallationsarbete, eller ser att en rutin behöver ändras, säger till administratören och elinstallatören för regelefterlevnad i god tid så att programmet hinner uppdateras.",
      "En fastställd version innehåller namnen på de personer som då hade roller i programmet, den kompetens som var dokumenterad för dem och vem som fastställde versionen. Namnen och uppgifterna ligger kvar i versionen även om en person senare slutar, tas bort ur Workflow eller får sitt kompetenskort raderat. Det är en del av programmet: i efterhand ska det gå att visa vem som hade vilket ansvar och vilken kompetens när ett arbete utfördes.",
      "Varje medarbetare ser sin egen kompetensbedömning i programmet. Administratörerna för programmet ser allas.",
    ].join("\n\n"),
  },
  {
    key: "appendices", title: "Bilagor", legalRef: "",
    body: [
      "Bilaga A Roller och ansvar innehåller rollbeskrivningarna och vilka personer som har rollerna. Bilaga B Personer och kompetens visar vad var och en får utföra och vilka begränsningar som gäller. Kompetenskorten förs i Workflow.",
      "## Om roller och rollbeskrivningar",
      "Ägare eller medarbetare kan ha en eller flera roller. Roller kan gälla tillsvidare och vara fastlagda enligt företagets organisation. Roller kan även tilldelas i ett visst uppdrag. Utöver vad som anges i rollbeskrivningarna har företaget rätt att leda och fördela arbetet, vilket innebär att även andra arbetsuppgifter kan förekomma.",
      "## Allmänt för alla roller",
      "Alla företagets medarbetare är gemensamt delaktiga i det dagliga arbetet genom att:",
      [
        "- efterleva företagets policy och vägvisare samt arbeta efter givna rutiner,",
        "- vara delaktiga i arbetet med ständiga förbättringar,",
        "- bidra till en bättre säkerhetskultur genom att följa rutiner gällande arbetsmiljö och personsäkerhet,",
        "- använda personliga skyddsanordningar för god hälsa och säkerhet,",
        "- hantera maskiner, verktyg och andra tekniska anordningar aktsamt i det dagliga arbetet,",
        "- hålla ordning och reda på arbetsplatsen,",
        "- anmäla felaktigheter, skador etc. på produkter, material och installationer som kan leda till felaktig funktion, incidenter eller olyckor.",
      ].join("\n"),
    ].join("\n\n"),
  },
];
