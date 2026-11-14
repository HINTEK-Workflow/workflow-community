/**
 * Versionsnyheter (2026-10-06: "Vid varje uppdatering ska en kort presentation av förbättringarna sammanställas
 * i ett veckobrev"): what each version brings, in plain words for the people who use Workflow. One source for the
 * help page ("Nytt i version …"), the notice after an update, the newsletter, the website's version block and the
 * post draft made at a new version.
 *
 * Writing a note: follow docs/regler/versionstexter.md (2026-11-12) – natural Swedish, what the user can do or what
 * works better, a short summary and short points, no internal details, no company, customer or domain names from
 * development. Newest first. Every version in package.json gets a note (tests/release-notes.test.ts checks it).
 */
export type ReleaseNote = {
  version: string;
  /** The day the version was finished, YYYY-MM-DD. */
  date: string;
  /** One short sentence about the version as a whole. */
  summary: string;
  items: string[];
};

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: "0.63.0",
    date: "2026-11-14",
    summary: "Offert, inköp och faktura ser ut som arbetsordern, varje funktion har en egen sida och Workflow Community är öppet.",
    items: [
      "Offerter, inköp och fakturaunderlag ser ut som arbetsordern: Grunduppgifter först, knapparna uppe till höger och det som används sällan under Mer.",
      "Ny offert, Nytt inköp och Nytt fakturaunderlag öppnas direkt och sparas som utkast när du börjar skriva. En faktura startar du alltid med Nytt fakturaunderlag, som också har fått plats.",
      "Projektformuläret har samma fält som arbetsordern, och Inköp har fått en egen vy i mobilen.",
      "Varje funktion på webbplatsen har en egen sida med Läs mer, och korten visar också underhållet.",
      "Workflow Community finns att ladda ner och installera gratis på egen server.",
      "Statistiken är uppdelad i två flikar, en för webbplatsen och demon och en för kunderna i appen.",
      "LinkedIn-kortet säger tydligt att företagssidor fungerar först när LinkedIn har godkänt appen.",
    ],
  },
  {
    version: "0.62.0",
    date: "2026-11-13",
    summary: "Serier av inlägg, fler mallar och loggor, ett sätt att rapportera fel och lika sidor överallt.",
    items: [
      "Med Ny serie skriver du flera inlägg på en gång, till exempel tolv för en månad. Tiderna läggs efter publiceringsrytmen, och varje del går att ändra för sig.",
      "Inlägg har mallarna Vit, Blå och Svart. Under Företag kan du lägga in loggan för mörk och ljus bakgrund, och storleken väljs per inlägg.",
      "Avbrutna och misslyckade schemaläggningar går att ta bort ur listan.",
      "Med Rapportera fel eller förslag kan du och dina kunder skicka in fel och idéer direkt.",
      "Menyn har rubrikerna Arbete, Kunder och Ekonomi.",
      "Flikar, rutor och knappar ligger på samma ställe på alla listor. Fakturor kan visas som rader eller kort och sorteras.",
    ],
  },
  {
    version: "0.61.0",
    date: "2026-11-13",
    summary: "En tydligare meny med rubriker, och Verktyg heter nu Mer.",
    items: [
      "Menyn har rubrikerna Arbete och Affär i stället för linjer, så att det är lättare att hitta.",
      "Verktyg heter nu Mer och öppnar en sida med Rapportarkiv, Egenkontroll, Instrument och de andra verktygen.",
      "Demon visar alla knappar i menyn, även Underhåll och Inköp.",
      "Den blå menyraden på startsidan ser likadan ut som på företagets webbplats.",
    ],
  },
  {
    version: "0.60.0",
    date: "2026-11-13",
    summary: "Stories från Inlägg, egna kort för maskinkällorna och en lugnare startsida på mobilen.",
    items: [
      "Med Även som story går inläggets bild också ut som story på Facebook och Instagram, i stående format. En story visas i 24 timmar.",
      "Under Maskiner har varje källa ett eget kort, och Fånga prov och Prov ligger bland kortets andra knappar.",
      "Kakknappen ligger i sidfoten på startsidan, så att den aldrig skymmer sidan.",
      "När menyn är öppen på mobilen står sidan bakom still.",
    ],
  },
  {
    version: "0.59.0",
    date: "2026-11-12",
    summary: "Enklare schemaläggning, fler inläggsmallar med hashtaggar och tydligare kort under Inställningar.",
    items: [
      "När du schemalägger väljer du dag och tid med ett tryck, och Workflow föreslår nästa lediga tid i företagets publiceringsrytm. Schemalagt visas nu dag för dag.",
      "Med I tur och ordning väljer du flera utkast, ordnar dem och schemalägger alla på en gång, vart och ett på sin egen tid.",
      "Inlägg har åtta nya mallar och ett eget fält för hashtaggar. Bilderna är stående, så att de visas hela även i Instagrams profilvy.",
      "Kortet för Facebook och Instagram har en guide för att skapa en egen Meta-app och koppla den.",
      "Min webbsida visar sidans sidhuvud, rubrik och sidfot och använder samma bredd som webbplatsen.",
      "Säkerhet under Mina inställningar och betalningsdelen under Företag är uppdelade i egna kort, som övriga inställningar.",
      "I Skapa formulär visas bara det markerade fältets verktyg, så att knapparna inte längre hamnar över varandra.",
    ],
  },
  {
    version: "0.58.0",
    date: "2026-11-12",
    summary: "Schemalägg inlägg och webbsidor, publicera på LinkedIn och redigera webbplatsen som den ser ut.",
    items: [
      "Du kan schemalägga inlägg och sidor till en viss dag och tid. Under Schemalagt ser du vad som väntar och kan flytta, avbryta eller publicera direkt.",
      "Med Ny serie planerar du inlägg för en period, till exempel tre gånger i veckan under en månad. Workflow föreslår ett ämne och ett utkast till varje inlägg, och du granskar dem innan de schemaläggs.",
      "LinkedIn kan kopplas under Kopplingar och väljas som kanal i Inlägg, bredvid Facebook och Instagram.",
      "Min webbsida visar sidorna med webbplatsens egna typsnitt, färger och layout, så att det du redigerar ser ut som på den publicerade sidan.",
      "Korten under Kopplingar är uppbyggda på samma sätt överallt, med en Spara-knapp per kort och förklaringarna samlade under Mer.",
      "Det finns en ny integritetspolicy. Du bekräftar den en gång vid nästa inloggning.",
    ],
  },
  {
    version: "0.57.0",
    date: "2026-11-11",
    summary: "Sökmotorinställningar för anslutna webbplatser och enhetliga nyckelkort.",
    items: [
      "Anslutna webbplatser kan nu hantera sidtitlar, beskrivningar och delningsbilder för varje sida, och du kan dölja sidor för sökmotorer. Du kan också förhandsgranska hur en sida visas i sökresultat. Funktionen kräver att webbplatsen har ett SEO-tillägg.",
      "Förhandsvisningen hämtar innehåll från webbplatsen först när du trycker på Visa förhandsvisning.",
      "Kopplingar och nycklar har nu samma kort överallt, med av/på-reglagen samlade överst och en Spara-knapp på varje kort.",
    ],
  },
  {
    version: "0.56.0",
    date: "2026-11-10",
    summary: "Skriv inlägg till företagets Facebook och Instagram direkt i Workflow.",
    items: [
      "Under Inställningar finns nu Inlägg. Skriv texten, välj en mall och se hur inlägget blir innan du trycker Publicera.",
      "Bilden görs med företagets färg och logotyp. Inget publiceras utan att du själv trycker Publicera.",
      "När du publicerar en sida i Min webbsida väljer du vilka delar och vilken bild som ska bli ett utkast till inlägg.",
      "Nycklarna till webbplatsen, Facebook och Instagram finns nu samlade under Kopplingar.",
      "Community-utgåvan har nu även Fakturor, och en installation kan ha en egen appikon.",
    ],
  },
  {
    version: "0.55.0",
    date: "2026-11-10",
    summary: "Redigera företagets WordPress-webbplats direkt i Workflow.",
    items: [
      "Under Inställningar finns nu Min webbsida. Anslut företagets WordPress-webbplats och redigera dess sidor i Workflow.",
      "Ändringar sparas först som utkast och publiceras när du trycker Publicera. Sidan säkerhetskopieras innan den skrivs över, så att du kan återställa den.",
      "Block från tillägg visas som på webbplatsen, och HTML-block redigeras i ett kodfält.",
    ],
  },
  {
    version: "0.54.1",
    date: "2026-11-09",
    summary: "Tydligare apparater i PLC-simulatorn och en givartestare för analoga ingångar.",
    items: [
      "Apparaternas metall ser ut som matt aluminium, och värmekällan har en låga som växer med styrningen.",
      "Voltmetern har en tydligare skala, och signalkällorna visar ärvärdet stort med börvärde och ärvärde bredvid.",
      "Ny signalkälla för 4–20 mA och en givartestare för spänning och ström, med ett exempel.",
    ],
  },
  {
    version: "0.53.0",
    date: "2026-11-09",
    summary: "PLC-simulatorns apparater är nu riktiga bilder, och det finns nödstopp och nödstoppsrelä.",
    items: [
      "Apparaterna i PLC-simulatorn är nya bilder sedda rakt framifrån. Alla rör sig eller lyser när du använder dem.",
      "Klicka på kugghjulet vid en markerad knapp för att välja färg och om den ska vara momentary eller latch.",
      "Nytt nödstopp med två kanaler och nytt nödstoppsrelä med återställning, med ett exempel.",
      "Värdeetiketterna visar både börvärde och ärvärde där apparaten har båda.",
    ],
  },
  {
    version: "0.52.0",
    date: "2026-11-09",
    summary: "Nya konton börjar med serverlagring, och flera små förbättringar.",
    items: [
      "Nya konton börjar med serverlagring, utan lokal lagring.",
      "Fakturor har en ny kvittoikon.",
      "Meddelanderutan högst upp är lika hög som texten.",
      "På telefon visar demon en kort ruta i stället för PLC-simulatorn.",
      "Kortare rader i översikten visar hela texten när du pekar på dem.",
    ],
  },
  {
    version: "0.51.0",
    date: "2026-11-07",
    summary: "Tilldela larm, säkrare riskbedömning och ljud i PLC-simulatorn.",
    items: [
      "Larm och felanmälningar har en Tilldela-knapp.",
      "En ny risk står som Inte bedömd tills någon väljer nivå.",
      "En ny arbetsorder sparas först när du trycker Spara.",
      "PLC-simulatorn har ljud, och apparaterna går att prova och ändra.",
      "Kontroller utan svar står som Ej ifyllt, och svaret Nej räknas som brist.",
    ],
  },
  {
    version: "0.50.0",
    date: "2026-11-06",
    summary: "Prova faktura och PDF i demon, ett bättre PLC-verktyg och många små rättningar.",
    items: [
      "I demon kan du skapa en demofaktura och ta ut en PDF av en kontroll.",
      "PLC-simulatorn har tydligare bilder. Håll in Ctrl för att redigera och mellanslag för att panorera.",
      "Ett maskinlarm kräver riskbedömning innan tiden startar, och larmet visas överst.",
      "Siffrorna på Teamet och Ekonomi är tydligare, och Visa som Medarbetare visar rätt vy.",
      "Många texter är kortare och rättade.",
    ],
  },
  {
    version: "0.49.1",
    date: "2026-11-06",
    summary: "Nya villkor och rättade länkar.",
    items: [
      "Villkoren beskriver nu fakturor, maskinlarm och kopplingar. Du godkänner dem på nytt vid nästa inloggning.",
      "Länkarna tillbaka till startsidan går nu till rätt ställe.",
      "I demon är det du inte får öppna nu gråat.",
    ],
  },
  {
    version: "0.49.0",
    date: "2026-11-05",
    summary: "Det går snabbare att skapa och skicka fakturor, och klockan visar när något nytt har hänt.",
    items: [
      "Skapa en faktura från början eller en proformafaktura, och öppna fakturaunderlaget direkt från arbetsordern.",
      "Klockan rör sig när något nytt kommer, och larm från maskiner visar om en arbetsorder skapades.",
      "PLC-simulatorn har en steg-för-steg-hjälp, grenar i Ladder och tydligare bilder av apparaterna.",
      "PDF-mallarna öppnas och ritas mycket snabbare.",
    ],
  },
  {
    version: "0.48.1",
    date: "2026-11-05",
    summary: "Det är enklare att hitta i demon.",
    items: [
      "Demon startar med tre knappar: Workflow, PLC-simulatorn och Operatörsterminalen.",
    ],
  },
  {
    version: "0.48.0",
    date: "2026-11-05",
    summary: "En ny PLC-simulator, PDF-texter som du ändrar direkt i sidan och fler yrkesprofiler.",
    items: [
      "PLC-simulatorn är nu ett eget program, med Ladder och ST sida vid sida.",
      "Du kan ändra texterna i PDF-dokumenten direkt i sidan.",
      "Det finns nu 19 yrkesprofiler med färdiga förval.",
      "Enskilda firmor kan skaffa konto när registreringen öppnar.",
    ],
  },
  {
    version: "0.47.0",
    date: "2026-11-04",
    summary: "Redigera PDF-mallarna: texter, vilka block som visas och i vilken ordning.",
    items: [
      "Under Installation finns nu PDF-mallar. För varje dokumenttyp ändrar du texterna och väljer vilka block som visas och i vilken ordning, med en förhandsvisning bredvid.",
      "Utseendet följer fortfarande designsystemet. Obligatoriska block, till exempel uppgifterna på en faktura, går inte att dölja.",
      "När ett förval ändras i en ny version följer block du inte ändrat med automatiskt. Block du ändrat behåller din text och märks Förvalet ändrades, så att du kan jämföra och välja.",
    ],
  },
  {
    version: "0.46.0",
    date: "2026-11-04",
    summary: "Ny grunddesign på PDF-dokumenten, en omgjord PLC-simulator och Kopplingar ordnade efter område.",
    items: [
      "Alla PDF-dokument har en ny, lugnare design med större text, tydligare rubriker och statusmärken i långa kontroller. Ekonomidokumenten har en betalruta, och företagets logotyp eller namn står i sidhuvudet.",
      "Kopplingar är ordnade i fyra områden: Bokföring, Lön och export, Maskiner samt API och MCP. Varje nyckel ligger nu vid sin koppling.",
      "PLC-simulatorn har större text, matning från en 24 V DC-källa och apparater som ritas som själva komponenterna, med vanlig numrering av plintarna.",
      "I ritverktyget drar du en ledning från plint till plint. Du kan markera flera objekt, kopiera och klistra in, och zooma och panorera.",
      "Ladder är en egen stor ruta med ST-koden under, som även går att öppna i ett eget fönster. Du kan växla mellan Ladder och ST utan att förlora något.",
      "En öppnad offert visar sin titel i brödsmulan.",
    ],
  },
  {
    version: "0.45.0",
    date: "2026-11-03",
    summary: "Fler yrkesprofiler och förbättrade kunddokument.",
    items: [
      "Nya yrkesprofiler: Solcellsmontör, Driftelektriker och Underhållselektriker. Profilen Kontor är borttagen, och den som hade den har nu Administratör med samma förval och rättigheter.",
      "Produktbilder från grossister visas oftare, även när grossisten skickar bilden i ett format som webbläsaren inte kan visa.",
      "Projektrapporten har avsändarrutan bara på omslaget. Fakturaunderlaget visar kundens kontaktperson och adress, som offerten.",
      "Offerten visar kundtyp bara när ROT gäller, och ett ÄTA-dokument heter ÄTA i titel och sidfot.",
      "Protokoll, avvikelserapporter och egenkontrollprogram har fått mindre justeringar i rutor och talformat.",
    ],
  },
  {
    version: "0.44.0",
    date: "2026-11-03",
    summary: "PDF-dokumenten har samma utseende och sidfot överallt, och Local får företagets färger och logotyp.",
    items: [
      "I Local får protokoll, arbetsorderrapporter, projektrapporter, egenkontrollprogram och avvikelselistor företagets färger, logotyp och avsändarruta, precis som med serverlagring.",
      "Förhandsgranskningen i formulärbyggaren ser ut som det riktiga dokumentet och märks FÖRHANDSGRANSKNING.",
      "Alla rapporter har samma sidfot, och långa företagsnamn kortas.",
      "PDF-filerna har titel och datum och är märkta som svenska, så att uppläsning får rätt språk.",
      "Ett dokument som inte är färdigt märks likadant överallt, med EJ FÄRDIGSTÄLLT.",
    ],
  },
  {
    version: "0.43.0",
    date: "2026-11-03",
    summary: "PLC-simulatorn har fått nivån Grundläggande, med rityta, program i ST och ett PID-fönster.",
    items: [
      "Dra apparater från listan till ritytan och koppla ledningar mellan plintarna. Du ser direkt vad som får spänning, och en kortslutning stoppar allt och förklaras med ord.",
      "Den lilla PLC:n har 12 digitala och 4 analoga ingångar samt 8 digitala och 2 analoga utgångar, med RUN/STOP, display och felindikering.",
      "Programmet skrivs i strukturerad text (ST). Fel visas på svenska med rad och kolumn, och en tabell visar varje plint med adress och värde.",
      "Sex exempel går att ladda, till exempel start/stopp med självhållning, nivåreglering och transportband. Hastigheten går att höja till 600 gånger, och klockan går att ställa.",
      "PID-fönstret visar en regulator på en simulerad ugn, tilluft eller värmekrets, med börvärde, trend, störning och larmgränser.",
      "Avancerat är den tidigare simulatorn. Ritningen sparas i webbläsaren och kan exporteras och importeras som fil.",
    ],
  },
  {
    version: "0.42.0",
    date: "2026-11-03",
    summary: "Tillbaka och Framåt fungerar överallt, Kopplingar ligger på en sida och alla sidor har samma överdel.",
    items: [
      "Tillbaka fungerar så fort du har besökt en sida tidigare i Workflow, även från menyn. Framåt fungerar när du har gått tillbaka.",
      "Kopplingar har områdena i en lista till vänster och innehållet till höger, på samma sida.",
      "Alla sidor har samma överdel: rubrik, flikar och knappar på samma plats, med Avbryt, Spara och Tillbaka uppe till höger.",
      "Kontrollera och synka visar en nyckel i taget med en förloppsstapel och sedan en rapport.",
      "Översikten visar viktigast först: Projektläge på Teamet, Att fakturera på Ekonomi och Kräver åtgärd på Kunder.",
      "I Workflow AI visar textrutan tre rader från början.",
    ],
  },
  {
    version: "0.41.0",
    date: "2026-11-02",
    summary: "Hela maskinträdet på ett ställe, drifttimmar från maskinen och möjlighet att hoppa över riskbedömning med ett skäl.",
    items: [
      "Under Underhåll står platser, maskiner och delar i ett träd. Du kan dra en maskin eller en del till en ny plats.",
      "Drifttimmar kan hämtas från en signal i maskinen. Ett orimligt värde används inte automatiskt utan visas med knappen Använd värdet. Byts räkneverket behåller underhållsplanen de timmar som var kvar.",
      "Nya maskinkällor är avstängda tills du väljer något annat, och Analysera nu kör analysen direkt.",
      "I en arbetsorder kan riskbedömningen hoppas över som undantag, med ett skäl. Undantaget kan ångras, och företaget kan stänga av möjligheten under Arbetssätt.",
      "Vid avvikelser visar Markera klar vad som saknas.",
      "Kort med rubrik minns om du har fällt ihop eller öppnat dem. Klickbara rader har en tunn pil till höger i stället för knappen Öppna.",
      "Min tid är uppdelad i två lika delar, och Rapporterad tid visar fem rader i taget.",
    ],
  },
  {
    version: "0.40.0",
    date: "2026-11-02",
    summary: "Kortare meny, Workflow AI som chatt, enklare planering, ny översikt och möjlighet att stänga av moduler.",
    items: [
      "Menyn är kortare. Användare är en flik under Inställningar, och Operatörskonton en knapp på den sidan.",
      "Workflow AI öppnas med en rund knapp och ser ut som en chatt, med skimrande rader medan AI:n tänker.",
      "Arbetsordern och Teamet har en Boka-knapp som fyller i jobb, namn, person och start.",
      "Kalendern är kortare, och listan Att boka visar jobb som har datum men saknar bokning.",
      "Kapacitet räknas likadant överallt. Frånvaro och helgdagar dras av, och krockar visas på fliken Kapacitet.",
      "Översikten är omgjord: Jag, Teamet, Ekonomi och Kunder har samma storlek, och Förfallet ligger under Gör detta nu.",
      "Företagets administratör kan stänga av delar som inte används, och de försvinner för alla i företaget.",
      "Administratören kan prova maskinkedjan i en PLC-simulator på sidan Maskiner.",
      "Produktbilder hämtas via Workflow, så att din webbläsare inte kontaktar någon annan.",
    ],
  },
  {
    version: "0.38.0",
    date: "2026-11-02",
    summary: "Underhåll med platser och utrustning, förråd med egna nummer, bättre kalkylatorer och personlig kalenderlänk.",
    items: [
      "Underhåll har två träd: Platser och Utrustning. Maskiner från det gamla trädet ligger kvar under Utan plats tills du flyttar dem.",
      "Förrådet har förråd, hyllor och fack med saldo per plats. Varje artikel får ett eget nummer, och du kan se vad den heter hos leverantören.",
      "Kalkylatorerna räknar med företagets egna kabeltyper, parallella ledare, spänningsfall i flera avsnitt och säkringskurvor.",
      "Med en personlig kalenderlänk syns dina bokningar i din egen kalender. Länken går att byta eller ta bort.",
      "Prisfiler fungerar även för grossister utan API-koppling. En ny fil ersätter den gamla.",
    ],
  },
  {
    version: "0.37.0",
    date: "2026-11-02",
    summary: "Yrkesprofiler, nya dokument, bättre notiser och kommentarer samt tydligare regler för tid.",
    items: [
      "Den som bjuds in eller loggar in första gången får meny och startsida som passar arbetet, till exempel som elektriker, vaktmästare eller underhållstekniker. En profil ger aldrig fler rättigheter.",
      "Arbetsvyerna heter nu Utförande, Ledande och Arbetsledning.",
      "På telefonen startar du tid på jobbets första skärm, och Avvikelse och Frånvaro ligger direkt under Ny.",
      "Kunddokumenten har en avsändarruta med organisationsnummer, adress, momsnummer och F-skatt. Protokoll har en gemensam mall med nummer, kund, plats, slutomdöme och signatur.",
      "En mätrad utan gräns måste få en gräns eller bedömas av teknikern innan protokollet kan färdigställas.",
      "Omvänd byggmoms och ROT följer med från offert till fakturaunderlag, som kan tas ut som PDF.",
      "Notiserna har flikarna Till mig och Teamet, Läs alla och Kräver åtgärd överst. Upprepade påminnelser blir en rad per dag.",
      "Du kan kommentera arbetsorder, projekt och avvikelser, nämna kollegor med @namn, följa och välja om kommentaren ska följa med i kundrapporten.",
      "Företaget väljer per tidstyp om restid faktureras, till vilket pris och om den räknas som arbetstid.",
      "Om du loggas ut mitt i arbetet kan du logga in i en ny flik, och det du skrivit ligger kvar.",
    ],
  },
  {
    version: "0.36.0",
    date: "2026-11-01",
    summary: "Ny meny som följer arbetet, med egna flikar för Planering och Tid.",
    items: [
      "Menyn är omgjord efter arbetet: Översikt och Planering, sedan arbetet, kunder och affär, och sist verktyg och företaget.",
      "Planering har Kalender, Tidplan och den nya vyn Kapacitet, som visar bokade timmar mot arbetstid per person och vecka.",
      "Uppgifter är en flik under Arbetsordrar. Tid har flikarna Min tid, Teamet och Lön och export, och under Teamet godkänner du tid och skickar påminnelser.",
      "Teamet delar in det som kräver uppmärksamhet i grupper med var sin siffra: Krockar och frånvaro, Hinder, Att godkänna, Förfallet och Ej startat.",
      "Användare och Operatörskonton är egna menyval, med en lista där ett klick öppnar personens eller kontots sida. Operatörskonton har QR-kod per maskin.",
      "Listor över kunder, platser och rapporter har samma filterrad som övriga listor.",
      "Operatören får ett tydligt kvitto efter en felanmälan.",
      "Sökningen hittar avvikelser, tillbud, olycksfall och maskiner.",
      "Samma sak har samma ikon överallt.",
    ],
  },
  {
    version: "0.35.0",
    date: "2026-11-01",
    summary: "Listorna har samma filterrad, Kopplingar är ordnade per område och rapporterna visar rätt priser.",
    items: [
      "Offerter, Inköp, Fakturaunderlag, Driftronder, Förråd och Avvikelser har samma filterrad: Mina eller Alla, status, sök, sortering och Rader eller Kort. Dina val kommer ihåg per enhet.",
      "Kopplingar har ett kort per område med läget på en rad, och varje område har en egen sida.",
      "Export till lönesystem skapar ingen fil förrän den går att läsa in. Förhandsgranskningen visar vad som saknas, till exempel anställningsnummer eller lönekod.",
      "SIE-filen skapas bara av ett fakturaunderlag som är markerat som fakturerat.",
      "Arbetsorderrapporten med Visa priser visar kundens pris och räknar med rapporterad tid gånger företagets timpris. Samma sak gäller projektrapporten.",
      "Sparstatusen visar Sparar… från första ändringen och Sparat först när allt är sparat. Kryss och svar i en checklista sparas direkt.",
      "Allvarliga tillbud och olycksfall som inte är anmälda märks Anmälningspliktig, och administratörer får en notis tills posten är anmäld eller åtgärdad.",
      "Du får nya notiser när någon bokar dig, flyttar eller tar bort din bokning, lägger in eller tar bort frånvaro, och när en månads tid skickas in, skickas tillbaka eller godkänns.",
      "När du sparar en bokning varnar bekräftelsen om någon redan är bokad eller frånvarande.",
      "Kalkylatorerna föreslår inte längre utlösningsström, spänningsfaktor eller ledartemperatur. Värdena är företagets eller dina egna, och resultatet visar vad som har använts.",
      "Frånkopplingstid räknas nu med rätt spänningsfaktor. Tidigare blev resultatet något för gynnsamt.",
    ],
  },
  {
    version: "0.34.0",
    date: "2026-10-31",
    summary: "Underhåll med maskinträd, förråd och återkommande underhåll, och felanmälan från operatörer.",
    items: [
      "Nytt menyval Underhåll: ett träd för företagets och kundernas maskiner, med bilder, reservdelar, händelser och kostnad per maskin.",
      "Förrådet har platser, även servicebilar. Ett uttag till en arbetsorder blir en materialrad som följer med i rapporten och fakturaunderlaget.",
      "Återkommande underhåll: en plan per maskindel ger en arbetsorder för varje tillfälle, ett år framåt.",
      "Operatörer har en egen sida där de väljer maskin, orsak och allvarlighetsgrad och skickar en felanmälan. En akut felanmälan når jouren. Administratören lägger till operatörskonton och väljer vilka maskiner de ser.",
      "En uppgift utan arbetsorder är ett utkast. Den kopplas till en arbetsorder eller får en ny med Skapa arbetsorder.",
      "Avvikelser kan exporteras som PDF eller CSV, och när du rapporterar en avvikelse anger du allvarlighetsgrad: Låg, Normal, Hög eller Akut.",
      "Tillbud och olycksfall märks Anmälningspliktig bara när de ska anmälas till Arbetsmiljöverket, med en kort förklaring.",
      "Rubrik, knappar och listor står på samma ställe på alla sidor.",
    ],
  },
  {
    version: "0.32.0",
    date: "2026-10-30",
    summary: "Tiden godkänns per månad och blir löneunderlag, och avvikelser har en egen sida.",
    items: [
      "Var och en skickar in sin månad, och arbetsledaren godkänner den per person. En godkänd månad är låst tills den skickas tillbaka.",
      "Löneunderlag per period kan tas ut som PDF eller CSV, och tid kan exporteras till lönesystem i formatet PAXml. Som standard tas bara godkända månader med.",
      "Företaget anger sin vanliga arbetsdag, och timanställda kan markeras med Ingen fast arbetstid. Företaget väljer också hur länge frånvaro sparas.",
      "Avvikelser har en egen sida i menyn, där du rapporterar elinstallation, riskobservation, tillbud och olycksfall. Du kan ta foto eller välja bilder.",
      "Tillbud och olycksfall ser bara den som rapporterade, administratörer och den som får se Teamet. Allvarliga fall visar länkar till myndigheternas anmälningssidor.",
      "Planering har vyerna Tidplan och Kalender, och det valda projektet följer med mellan dem.",
    ],
  },
  {
    version: "0.31.0",
    date: "2026-10-29",
    summary: "Översikten hänger ihop på alla flikar, frånvaro kan anmälas och tid rapporteras med valfri tidstyp.",
    items: [
      "Alla flikar i Översikten är uppbyggda som Jag, så att samma sorts kort har samma storlek och plats.",
      "Teamet visar vem som gör vad just nu, vad som kräver åtgärd, vem som saknar tidrapport, arbete utan ansvarig och utbildningar, körkort och kalibreringar som går ut inom 30 dagar.",
      "Ekonomi visar läget i en mening, jobb med ofakturerad tid eller material och offerter som väntar eller går ut. Kunder visar vad som kräver åtgärd hos kunderna.",
      "Du anmäler sjukdom, VAB, semester och annan frånvaro för dig själv, och som arbetsledare för andra. Teamet visar vilka jobb som påverkas och föreslår vem som kan ta över. Inget flyttas utan att någon väljer.",
      "Frånvaro kan läsas in från en fil, och frånvaro och tid kan exporteras till lönesystemet.",
      "Tid som du rapporterar i efterhand räknas bakåt från nu.",
      "Företaget bestämmer sina egna tidstyper, till exempel ordinarie tid, övertid, restid och jour, med egen lönekod.",
    ],
  },
  {
    version: "0.30.0",
    date: "2026-10-29",
    summary: "Översiktens Jag visar din dag tydligare, med tidslinje och snabbare väg till tiden.",
    items: [
      "Jag hälsar dig med dagens läge: vad som är förfallet, vad du ska börja med och vad som väntar idag och senare i veckan.",
      "Gör detta nu, Förfallet och Mina avvikelser visar kund, plats, hur sent det är, status och hur långt arbetet har kommit.",
      "Dagens tidslinje visar den dag du väljer i kalendern. Ett klick väljer jobbet i Tid.",
      "Tid visar var du senast rapporterade. Fortsätt startar tiden igen, och Skriv tid öppnar tidsrapporteringen med jobbet ifyllt.",
      "Kalendern visar veckonummer.",
      "Översikten fungerar på telefon, surfplatta och stora skärmar.",
    ],
  },
  {
    version: "0.29.0",
    date: "2026-10-28",
    summary: "En ny Översikt med flikarna Jag, Teamet, Ekonomi och Kunder, anpassad efter vad du får se.",
    items: [
      "Jag visar vad du ska göra nu och varför, förfallet arbete, dina avvikelser, utkast som behöver kopplas, tiden som går och din plan för månaden.",
      "Teamet visar belastning per person, arbetsordrar utan riskbedömning, avvikelser, accepterade offerter utan arbetsorder och projektläget. Fliken syns för administratörer och för den som har rätten Teamet.",
      "Ekonomi visar ofakturerad tid som uppskattning, med en knapp till förslaget på fakturaunderlag, offertuppföljning och fakturerat mot företagets mål. Fliken kräver rätten Ekonomi.",
      "Kunder visar kunder med öppna och förfallna arbetsordrar, fakturaunderlag och offerter.",
      "Varje siffra öppnar listan den räknar. Fakturaunderlag har en egen lista under Offerter.",
      "AI-krediterna visar saldot och hur länge det gäller.",
    ],
  },
  {
    version: "0.28.0",
    date: "2026-10-28",
    summary: "Statistiken räknar arbetsordrar, uppgifter och ronder för sig, och företaget kan sätta egna mål.",
    items: [
      "Statistiken visar arbetsordrar, uppgifter och rondtillfällen var för sig. Utkast räknas inte, och utgångna uppgifter räknas aldrig som klara.",
      "Företaget sätter egna mål under Arbetssätt, Mål. Utan mål står det Inget mål satt.",
      "Ett rondtillfälle som inte blir gjort kan markeras Ej utfört, med en anledning. Den ansvarige får en notis, och markeringen kan ångras.",
      "En rond där protokollet har satts till Utgår visas inte längre som påbörjad.",
    ],
  },
  {
    version: "0.27.0",
    date: "2026-10-28",
    summary: "Nyckeltalen öppnar rätt lista, och Hem får nya valbara rutor.",
    items: [
      "Ett klick på ett nyckeltal i översikten öppnar listan med rätt filter, och siffran stämmer med listan.",
      "Jobblistan har filtret Förfallna, och avvikelseloggen har filtren Öppna, Förfallna, Mina och Alla.",
      "Hem i appen kan få rutorna Gör detta nu, Förfallet och Mina avvikelser. De läggs till under Redigera hemskärmen.",
      "Administratören kan ge rätten Teamet, med belastning, tid, projektläge och statistik, utan att personen blir administratör.",
      "En notis om en avvikelse öppnar just den avvikelsen.",
    ],
  },
  {
    version: "0.26.0",
    date: "2026-10-28",
    summary: "Driftronder kan planeras med klockslag i en tydligare kalender, och knapparna ser likadana ut överallt.",
    items: [
      "Schemat för en driftrond visas i klartext, med snabbval, veckodagar som knappar och en kalender där ronderna är markerade.",
      "En rond kan få ett klockslag och en beräknad tid. Den syns i Planering bland bokningarna och räknas in i den ansvariges belastning.",
      "En rond blir försenad först när klockslaget har passerat.",
      "Kopiera, ikonknappar, papperskorgar och nedladdningar ser likadana ut överallt, och ikonknapparna visar vad de gör när du pekar på dem.",
    ],
  },
  {
    version: "0.25.0",
    date: "2026-10-27",
    summary: "Uppgifter kan påbörjas som utkast, och en arbetsorder kan samla en hel driftrond.",
    items: [
      "En uppgift kan sparas som utkast innan den har en arbetsorder. Den kopplas till en arbetsorder innan arbetet börjar.",
      "Riskbedömningen görs i arbetsordern och gäller dess uppgifter och ronder.",
      "En arbetsorder kan avse en driftrond under en period, från en dag till flera år. Varje rond som startas blir ett nytt tillfälle i samma arbetsorder, med eget datum, utförare, protokoll och tid.",
      "Före varje rondtillfälle görs en kort säkerhetsavstämning mot arbetsorderns riskbedömning.",
      "Sidans knappar står kvar där de brukar. Blå knappar längst ned till höger hjälper dig att gå tillbaka, framåt, avbryta och spara när sidans egna knappar inte syns.",
    ],
  },
  {
    version: "0.24.0",
    date: "2026-10-27",
    summary: "Arbetsordern samlar allt arbete, och det är enklare att hitta tillbaka.",
    items: [
      "Varje uppgift ligger i en arbetsorder. När du skapar en uppgift väljer du först arbetsorder, och kund och projekt följer med.",
      "Ronder skapar automatiskt en arbetsorder för varje tillfälle enligt schemat, och missade ronder visas som försenade.",
      "Tid rapporteras på en arbetsorder eller ett projekt, med timer eller i efterhand. Projekttid som projektledning och möten kan föras för sig.",
      "En arbetsorder med färdiga eller signerade protokoll kan inte tas bort, bara avslutas. Innan något tas bort visas vad som påverkas.",
      "Avbryt går ett steg tillbaka, och Spara tar dig tillbaka dit du kom ifrån. Knapparna ligger kvar när du rullar.",
      "Du väljer kund före plats, så att bara kundens platser visas.",
      "I artikellistan ändrar du antal direkt med − och +.",
      "Hemskärmen och flikraden på telefonen går att ordna genom att dra, och båda kan återställas.",
    ],
  },
  {
    version: "0.23.0",
    date: "2026-10-26",
    summary: "Företagets admin väljer AI-profil, och chattens svar visas medan de skrivs.",
    items: [
      "Under Workflow AI väljer företagets admin vilken AI-profil företaget använder.",
      "Chattens svar visas medan de skrivs i stället för när hela svaret är klart.",
      "Webbplatskartan visar vilka externa tjänster Workflow använder och var de hanteras.",
      "Nycklar som läggs in i Workflow lagras krypterade, och varje företags nycklar skyddas separat.",
    ],
  },
  {
    version: "0.22.0",
    date: "2026-10-24",
    summary: "Företaget får egna platser, maskiner kan kopplas till objekt och hela kort går att klicka på.",
    items: [
      "Företagets egna platser, till exempel verkstad, lager och fordon, läggs upp under Företag, Platser och väljs i arbetsordern som Eget företag. Företagets adress med kartnål står i Företagsuppgifter.",
      "Märkning och kritikalitet anges nu på arbetsordern i stället för på platsen.",
      "Kartorna är större och zoomas med Ctrl och mushjulet.",
      "Hela rubrikraden på ett kort öppnar och stänger det, och innehållet visas först när det är klart så att sidan inte hoppar.",
      "Maskiner kan kopplas till ett objekt. Ett larm kan gå till objektets ansvarige och vidare till ersättaren, och från arbetsordern kan du skapa en avvikelse. Platsen visar maskinernas händelser och nyckeltal.",
      "Under Mina inställningar kan du anpassa menyn separat för telefon och dator.",
      "En medarbetare utan rätt till kundregistret ser bara det kundinformation som jobbet kräver.",
    ],
  },
  {
    version: "0.21.0",
    date: "2026-10-24",
    summary: "Workflow känns mer som en app, med tydligare meny och sidor som laddar snabbare utan att hoppa.",
    items: [
      "Telefonen visar alltid appvyn. Längst ned på sidorna finns Visa mer, och under Mina inställningar kan du välja Visa allt på den här enheten.",
      "Menyn visar det du arbetar med: Översikt, Inköp, Offerter, Projekt, Arbetsordrar, Uppgifter, Driftronder, Kalender, Tid, Kunder och Verktyg.",
      "Jobb på telefonen samlar arbetsordrar och uppgifter i en lista, som du filtrerar under Filter.",
      "QR-etiketter skrivs ut från driftronden, även från telefonen. En skanning öppnar bara ett jobb som redan finns.",
      "Riskbedömningen ställer en fråga i taget på telefonen, och jobbets huvudknapp visar nästa steg.",
      "Rutan Tid på Hem visar tiden som går och har en Stoppa-knapp.",
      "Sidorna laddar snabbare på telefonen och hoppar inte när innehållet kommer. Felmeddelanden är på svenska, och fler knappar är lätta att trycka på med fingret.",
      "Version och villkor finns under Hjälp, Om Workflow.",
    ],
  },
  {
    version: "0.20.0",
    date: "2026-10-20",
    summary: "Maskinlarm når rätt personer direkt, och i papperskorgen kan du hantera flera poster samtidigt.",
    items: [
      "Larm från maskiner syns i klockan med knappen Jag tar den. Den som trycker först blir ansvarig för arbetsordern, och de andra får veta att den är tagen.",
      "Under notisvalen väljer du själv om du vill ha maskinlarm. Administratörer har det som förval.",
      "I kundernas papperskorg kan du markera flera poster eller alla, och återställa eller ta bort dem tillsammans. Du ser hur många som lyckades.",
      "När du lägger till artiklar står namnet på inköpet eller offerten på en egen rad, även om det är långt.",
    ],
  },
  {
    version: "0.19.0",
    date: "2026-10-20",
    summary: "Ett maskinlarm kan bli en arbetsorder, Workflow ser när något avviker och företaget kan kräva att AI bara används inom EU.",
    items: [
      "För varje maskinkälla väljer du om ett larm ska bli en arbetsorder direkt, vänta på godkännande eller inte skapa något. Arbetsordern är planerad och märkt som automatisk, och det finns högst en öppen order per källa.",
      "Maskinsidan visar förslag när ett larm fladdrar, larmen har blivit tätare än vanligt eller maskinen har tystnat. Varje förslag visar sitt underlag.",
      "Om företaget tillåter det kan AI förklara en observation på enkel svenska, med några saker att kontrollera. Det görs först när någon trycker, och är en hjälp, aldrig ett besked om att en maskin är säker.",
      "Företaget kan kräva att uppgifter bara bearbetas inom EU. Är ingen EU-leverantör inlagd är AI avstängd för företaget.",
    ],
  },
  {
    version: "0.18.0",
    date: "2026-10-19",
    summary: "Maskiner kan skicka larm och diagnoser till Workflow, och flera sidor har kortare texter.",
    items: [
      "Ny sida Maskiner under Inställningar, Kopplingar och nycklar: skapa en källa, få en nyckel som visas en gång, skicka en testhändelse och se vad källan har skickat. Händelserna sparas i 90 dagar.",
      "En maskin, en gateway eller en Raspberry Pi kan skicka larm, driftläge och färdiga diagnoser. Samma händelse två gånger blir aldrig två poster.",
      "Rubriken i mobilens topprad får plats med fler tecken.",
      "Tolv långa förklaringar är kortare och enklare, till exempel om tvåstegsverifiering och inloggning.",
    ],
  },
  {
    version: "0.17.0",
    date: "2026-10-19",
    summary: "Artikelsökningen är snabbare, listorna går att ändra direkt på kortet och nyckelsidan visar vad som fungerar.",
    items: [
      "Efter Lägg i lista finns − N + och en papperskorg direkt på kortet.",
      "Bilder och produktinfo hämtas först när de behövs, så att sökningen går snabbare.",
      "Tjänster och nycklar visar tre lägen: Inte inlagd, Inlagd men inte kontrollerad och Kontrollerad och fungerar. Översikten räknar bara det som är kontrollerat.",
      "Kontroll före idrifttagning har en ruta, Ta med stöd vid bedömning, som styr om kapitlet ska vara med i rapporten.",
      "Kolumnerna på artikelkortet är bredare så att priset syns.",
    ],
  },
  {
    version: "0.16.0",
    date: "2026-10-19",
    summary: "Artikelsökningen är enklare att hålla ordning på, och Tjänster och nycklar är ordnade i grupper.",
    items: [
      "På artikelkortet har antalsfältet och knappen samma höjd, enheten står bredvid antalet och en papperskorg tar bort just den raden.",
      "Lägg till artiklar säger vilket inköp, vilken offert eller vilken arbetsorder raderna hamnar i, och Lägg i lista har Ångra i beskedet.",
      "I artikelsökningen visas små produktbilder när de finns. Klicka för en större bild. Bilder följer inte med i offerter.",
      "Tjänster och nycklar är ordnade i grupper, med knappar och märken på samma plats på varje kort.",
    ],
  },
  {
    version: "0.15.0",
    date: "2026-10-19",
    summary: "Mer pålitligt, med tydligare besked, ångra där det saknades och kortare texter.",
    items: [
      "Artikelsökningen har en justerare (− N +) i stället för att lägga till samma rad om och om igen, och listorna berättar vad som har hänt.",
      "Spara, Avbryt och Tillbaka ligger på samma plats uppe till höger på redigeringssidorna.",
      "Besked kommer en gång, är korta och försvinner när de inte längre stämmer.",
      "Pausa tid och Utgår frågar om korta tider i stället för att kasta dem, och egen överlappande tid räknas inte dubbelt.",
      "Ett protokoll skapas inte förrän du har skrivit något, och det du kastar sparas inte.",
      "Egenkontrollen är kort på mobil och surfplatta.",
      "Knappar på mobil är minst 44 px höga, och texterna i appen är kortare.",
    ],
  },
  {
    version: "0.14.0",
    date: "2026-10-18",
    summary: "Prisfiler läses in mot grossistens katalog och tar mycket mindre plats, och nyckelsidan är tydligare.",
    items: [
      "En prisfil kan läsas in för en grossist som har en aktiv API-koppling. Priserna kopplas till grossistens egna artiklar, och rader som inte finns i katalogen läses inte in.",
      "Import visar hur många artiklar som är kopplade mot prisfilen och berättar när en rad hoppades över.",
      "Tjänster och nycklar har ett eget kort för varje nyckel, med av/på för Solar, Google och Workflow AI.",
      "Egenkontrollen är hopfälld på mobil och surfplatta, med märken som visar vad som saknas.",
      "I mobilen har arbetslistorna lika marginal, rubriken i toppen får plats på en rad och tryckytorna är större.",
    ],
  },
  {
    version: "0.13.0",
    date: "2026-10-17",
    summary: "Artikelsökningen kan söka i Solars produktkatalog, och mobilen får ikoner i toppen och mjukare rullning.",
    items: [
      "Artikelsökningen söker även i Solars produktkatalog på benämning, produkttyp och nummer. Priset kommer alltid från era egna prisfiler.",
      "Samma produkt hos flera grossister visas med en rad per grossist, med egen status och eget artikelnummer. En grossists pris flyttas aldrig till en annan.",
      "Sökningen förstår teknisk skrivning: 3G2,5 och 3x2,5 ger samma träff, liksom 10 A och 10A, och automatsäkring hittar också dvärgbrytare.",
      "Pris jämförs bara mellan rader som säljs i samma enhet och förpackning.",
      "I mobilen visas bakåt, avbryt, stäng och ny som ikoner i toppen, och sidorna rullar mjukare.",
    ],
  },
  {
    version: "0.12.1",
    date: "2026-10-17",
    summary: "Tydligare text och bättre kontrast i mörkt tema.",
    items: [
      "Brödtexten är lite fetare, så att liten grå text är lättare att läsa.",
      "I temat Dark är den grå hjälptexten och den röda texten ljusare.",
    ],
  },
  {
    version: "0.12.0",
    date: "2026-10-16",
    summary: "Ett lugnare och bredare utseende, artiklar som läggs till som i en varukorg samt favoriter och listor.",
    items: [
      "Sidorna använder hela bredden på stora skärmar, med fler kort bredvid varandra.",
      "Utseendet är lättare, med färre ramar. Ett hopfällt kort öppnas med ett klick var som helst på rubriken.",
      "Det finns två teman: Light, med blå meny och topp, och Dark. Samma typsnitt används överallt.",
      "Du lägger till artiklar på offert, inköp, arbetsorder och fakturaunderlag genom att söka och lägga till rader som i en varukorg. Produktens uppgifter och bild följer med raden.",
      "Favoriter och artikellistor i artikelsökningen. En hel lista kan läggas till på en gång.",
      "Rubrikerna i mobilen är lika stora och centrerade.",
    ],
  },
  {
    version: "0.11.3",
    date: "2026-10-16",
    summary: "Varor från Solars katalog hittas på helt E-nummer och EAN.",
    items: [
      "Namn, tillverkare, status och lagersaldo från Solar visas nu när du söker på ett helt E-nummer eller EAN.",
    ],
  },
  {
    version: "0.11.2",
    date: "2026-10-16",
    summary: "Solars katalog går att söka i utan prisfil.",
    items: [
      "Skriv ett helt E-nummer eller EAN under Artiklar, på en offertrad eller på en materialrad, så hämtas varan från Solars katalog även utan prisfil. Under Artiklar kan den läggas i ett inköp, utan pris.",
      "Sökningen förklarar hur Solars katalog kan användas när era prisfiler saknar varan.",
    ],
  },
  {
    version: "0.11.1",
    date: "2026-10-16",
    summary: "Kundsidan börjar med alla delar hopfällda.",
    items: [
      "På kundsidan är Kontaktuppgifter, Projekt, Uppgifter, Offerter och Anläggningar hopfällda från början, och Anläggningar ligger längst ned. Redigera och länkar till en viss del öppnar den direkt.",
    ],
  },
  {
    version: "0.11.0",
    date: "2026-10-16",
    summary: "Inköp samlar artiklar från flera grossister till offert, material och beställning.",
    items: [
      "Inköp står överst i menyn, med Nytt inköp, Mina inköp och Artiklar.",
      "Ett inköp samlar artiklar från en eller flera grossister, som en varukorg. Summan visas per leverantör, och Till grossist skapar beställningsfilen.",
      "Du kan lägga inköpet i en offert som rader eller som en summa. Kunden ser aldrig leverantör eller inköpspris. Ändras inköpet kan offerten uppdateras så länge den är ett utkast.",
      "Lägg som material lägger inköpets rader på en arbetsorder, utan att lägga in samma rad två gånger.",
      "Markera inköpet som beställt och bocka av varje rad när den har kommit.",
      "Artiklar söker i era prisfiler på namn, artikelnummer, E-nummer, RSK och EAN och visar alla grossisters priser och Solars lagersaldo.",
      "Kundsidan laddar utan att hoppa, och trädet med anläggningar ligger kvar under toppraden när du rullar.",
    ],
  },
  {
    version: "0.10.0",
    date: "2026-10-16",
    summary: "Enklare anläggningar, prisfiler med grundpris, nettopris och rabattbrev, och adressförslag medan du skriver.",
    items: [
      "Anläggningar visas i två paneler: trädet till vänster och det du väljer till höger, med Ny arbetsorder här, Nytt objekt och Redigera.",
      "Grundprislista, nettoprislista och rabattbrev hanteras var för sig per grossist. En ny fil skriver aldrig över de andra, och gällande pris är nettopriset när det finns.",
      "Förpackning, beställningsmultipel, minsta beställning, lagerstatus och status från grossistens fil visas på träffen.",
      "Artiklar som saknas i grossistens senaste prisfil märks men behåller sitt pris.",
      "Lagersaldo nära ert postnummer visas vid träffen med klockslag, och en vara som utgår hos Solar märks.",
      "Adresser från Lantmäteriet föreslås medan du skriver gatuadressen på en plats eller en kund, och kartnålen följer med.",
      "Inställningar och Installation har en sida per flik. Gamla länkar leder rätt.",
      "Fakturaunderlagets materialrader behåller pris, rabatt och artikelnummer från arbetsordern.",
    ],
  },
  {
    version: "0.9.0",
    date: "2026-10-15",
    summary: "Rabattbreven räknar ut ert pris, samma vara hittas hos alla grossister och kundens platser bläddras som mappar.",
    items: [
      "Rabattbrev från Solar och Rexel läses in och ger ert nettopris. På raden står rabatten eller Avtalspris ovanför priset, med grundpriset överstruket. Påslaget läggs på priset efter rabatt.",
      "Samma vara hos olika grossister visas som en produkt med ett pris per grossist, även när artikelnumren skiljer sig.",
      "Import säger direkt om det är rätt eller fel fil.",
      "Kundens anläggningar visas som mappar: alla adresser, en adress med sina objekt och ett objekt. Bakåt går ett steg upp.",
      "En plats som inte används kan tas bort. En plats som används pausas i stället, så att rapporterna behåller den.",
      "QR-etiketten öppnar kunden på rätt plats, med Ny arbetsorder här och ronderna som väntar.",
    ],
  },
  {
    version: "0.8.0",
    date: "2026-10-14",
    summary: "Tydligare och snabbare prisfiler, Avbryt som frågar innan något kastas och ett kundregister som ser ut som resten av Workflow.",
    items: [
      "Import har en ruta per grossist (Solar, Ahlsell, Sonepar och Rexel) som visar vad som är inläst och tar emot nästa fil.",
      "Grossistens grundpris märks Grundpris – inte ert avtalspris, och lägsta pris jämför bara priser av samma sort.",
      "En prisfil läses in 4–6 gånger snabbare, och en import som avbryts tas tillbaka helt.",
      "Förhandsvisningen visar prisexempel och de största prisändringarna innan du importerar.",
      "Avbryt och telefonens Bakåt frågar Kasta ändringarna? när du har ändrat något.",
      "Kundregistret har rubriken överst och Ny kund uppe till höger. Stora formulär som Bilkostnad, Till grossist och Arbetstid öppnas som egna sidor.",
    ],
  },
  {
    version: "0.7.1",
    date: "2026-10-13",
    summary: "Små förbättringar efter 0.7.0.",
    items: [
      "Företagets värden i kalkylatorn har Avbryt och Spara högst upp på telefonen.",
      "Till grossist finns bland offertens knappar och som rad i offertmenyn på telefonen.",
      "Starta tid är avstängd på ett färdigställt jobb och förklarar varför när du trycker.",
      "Ring-knappen med ett långt kundnamn kortas, så att sidan inte rullar i sidled på telefonen.",
    ],
  },
  {
    version: "0.7.0",
    date: "2026-10-12",
    summary: "Enklare mobil för arbete på plats, en ny kalkylator, prisfiler från grossisterna och export av material till grossistens varukorg.",
    items: [
      "Den enkla visningen i mobilen har samma mönster på alla sidor: Tillbaka högst upp, två stora rutor på menysidor och Föregående och Nästa längst ned i ett jobb.",
      "En kontroll går i några större steg i stället för många små, och riskbedömningen leder vidare med Nästa.",
      "Tid har en månadskalender och fler snabbval, och frågar innan tiden byter jobb.",
      "Ring kunden och Navigera till adressen finns på jobbet, kundkortet och platsen.",
      "Du checkar in och ut direkt i jobbet när projektet har personalliggare.",
      "Kalkylatorn räknar effekt, transformator, kortslutning, frånkopplingstid, spänningsfall, största gruppledningslängd och kabelarea, med företagets egna skyddsapparater.",
      "Prisfiler från grossisterna läses även när de är mycket stora. Till grossist kopierar eller exporterar materialet i den form grossisten vill ha.",
      "Sökningen hittar även sparade rapporter.",
    ],
  },
  {
    version: "0.6.4",
    date: "2026-10-11",
    summary: "Finslipning: tydligare jobb, kunden står fast på offerten och kundnummer för bokföringen.",
    items: [
      "Ny kund och Välj plats öppnas som en liten ruta när du redan är inne i ett formulär.",
      "Ny-menyn har även Kund och Offert, och Nytt projekt från ett kundkort fyller i kunden.",
      "En skickad offert visar kunden som den var när den skickades, och kunden kan ladda ned offerten som PDF från sin länk.",
      "Offerten visar alla arbetsordrar som har skapats av den.",
      "Kundnummer för bokföringen sparas på kunden och fylls i när du skickar till Fortnox.",
      "Projektet visar Budget, Offererat, Uppskattat, Bokat och Rapporterat på en rad.",
      "Ett protokoll minns vilket instrument som användes och visar om kalibreringen var försenad.",
      "Inloggningen spärras i stället för att släppa igenom när säkerhetskontrollen inte går att göra.",
    ],
  },
  {
    version: "0.6.3",
    date: "2026-10-10",
    summary: "Fakturaunderlag från det utförda arbetet, och avvikelser som hänger ihop med arbetsordern som åtgärdar dem.",
    items: [
      "Ett färdigställt jobb eller projekt får ett fakturaunderlag med rapporterad tid gånger timpriset, material och utgifter, i en lista du kan ändra.",
      "Underlaget exporteras som CSV, SIE eller till Fortnox. Det som har kommit med i ett underlag kommer aldrig med igen, och ett fakturerat underlag är låst.",
      "En avvikelse i egenkontrollens logg och arbetsordern som åtgärdar den länkar till varandra. När arbetsordern färdigställs blir avvikelsen Åtgärdad, med datum och vem.",
      "Från avvikelseloggen kan du skapa en arbetsorder direkt.",
    ],
  },
  {
    version: "0.6.2",
    date: "2026-10-10",
    summary: "Rättningar efter en genomgång av arbetsdagen på dator, surfplatta och telefon.",
    items: [
      "Ett protokoll sparas inte längre av sig självt när det öppnas.",
      "Avbryt på en ny materialrad tar bara bort den raden, och platsen på en arbetsorder sparas alltid.",
      "Ett färdigställt jobb går att läsa i alla paneler.",
      "På mobilen är kryssrutorna hela rader, och Ny kund, Färdigställ, Rapportera avvikelse och export är egna skärmar med Avbryt och Spara högst upp.",
      "Rapporterad tid går att läsa på telefonen, och listor har en enda rullning med Visa fler.",
      "Offerten har rubriker över varje fält och summan i en tydlig lista.",
      "Du kan ta foto direkt i Bilder och dokument på mobilen.",
    ],
  },
  {
    version: "0.6.1",
    date: "2026-10-10",
    summary: "Kundtyp på kunden, offerter på kundkortet, personalliggaren på plats och radering när ett företag slutar vara kund.",
    items: [
      "Kunden har Kundtyp (Företag eller Privatperson), som offerten hämtar. Den kan ändras på en enskild offert.",
      "Kundkortet visar kundens offerter, och offertens PDF har kundens adress och kontaktperson.",
      "En ny kund med adress kan få en plats med samma adress direkt.",
      "Väljer du ett projekt på en offert fylls kund, plats, rubrik och omfattning i. Byter du kund på ett projekt väljer du om jobben ska följa med.",
      "Den som är incheckad på en byggarbetsplats kan visa dagens personalliggare vid Skatteverkets kontrollbesök.",
      "Jordfelsbrytaren bedöms mot EN 61008 / EN 61009. Äldre protokoll visas som förut.",
      "När ett företag slutar vara kund kan det exportera sina uppgifter i 30 dagar och får påminnelser innan uppgifterna raderas.",
    ],
  },
  {
    version: "0.6.0",
    date: "2026-10-10",
    summary: "Kunden svarar på offerten via en länk, Inställningar har en tydligare ordning och mobilen fungerar som en app.",
    items: [
      "Skicka till kund mejlar en länk till offerten. Kunden accepterar med namn och en kryssruta, eller avböjer, utan att logga in. Offertens status och din notis uppdateras av sig själva, och kunden ser aldrig inköpspris eller påslag.",
      "Inställningar har nio flikar i ny ordning, med en mening om vad varje flik är till för. Gamla länkar fungerar.",
      "Mina inställningar har fyra grupper: Visning, Mobil, Notiser och tips, och Konto.",
      "Den enkla visningen i mobilen är gjord för arbete ute: lugnare topp, listor och egna skärmar för tid, jobb, projekt, planering, offerter, kunder, egenkontroll och hjälp, med Avbryt och Spara högst upp.",
      "Sidor som hör till datorn, som Skapa formulär och Import, finns i den andra visningen. Öppnar du dem i den enkla visningen får du en knapp för att byta.",
      "Bakåt stänger en öppen ruta innan den går tillbaka en sida.",
      "Workflow AI på mobilen är en egen skärm med fältet i hela bredden.",
    ],
  },
  {
    version: "0.5.0",
    date: "2026-10-09",
    summary: "Mobilen som en riktig app, tidplan för projektet, offert hela vägen till arbetsorder och en AI som kan föreslå arbete.",
    items: [
      "Den enkla visningen i mobilen ser ut som en app: Hem med stora rutor, flikrad, listor i telefonens stil och en skärm i taget, även för projekt, kundkort, tid och inställningar.",
      "Du väljer själv vilka rutor Hem visar och vilka knappar flikraden har, under Inställningar, Visning.",
      "Tidplanen på projektet visar jobben som staplar på en tidslinje, med start, Klart senast, uppskattad tid och vilka jobb som börjar efter vilka. Dra ett jobb för att flytta det.",
      "Bokningar räknas per arbetsdag, och bara admin och projektets ansvarige ändrar andras bokningar. Ansvarig kan lämna över till en ställföreträdare.",
      "Ett jobb som inte ska göras markeras Utgår, med ett skäl, i stället för att raderas, och kan återupptas.",
      "Offert från materialet, accepterad offert som blir arbetsorder, ÄTA som ny version, moms och ROT för privatpersoner, och export som CSV, SIE eller till Fortnox.",
      "Workflow AI kan föreslå arbetsorder, material, tid, planering och offert direkt i chatten, alltid med Använd och Ångra. Administratören väljer vad den får göra.",
      "Personalliggaren slås på per byggarbetsplats av den ansvarige.",
    ],
  },
  {
    version: "0.4.29",
    date: "2026-10-09",
    summary: "Offerter med priser på material, elektronisk personalliggare och inloggning med passkey.",
    items: [
      "Skapa en offert med rader för material, arbete och övrigt, med påslag och moms för sig. En skickad offert är låst, och en ändring blir en ny version. Offerten kan tas ut som PDF.",
      "Materialrader kan få à-pris och påslag, med summor på arbetsordern och i Material i projektet. Priserna syns bara för dem som har rätt att se priser.",
      "Personalliggare: checka in och ut på byggarbetsplatsen med en knapp, registrera underentreprenörers personal och visa en kontrollvy med export vid kontrollbesök. Rader rättas bara genom en ny rad, så att originalet finns kvar.",
      "Logga in med passkey (Face ID, fingeravtryck eller Windows Hello). Du lägger till den under Mina inställningar.",
      "En färdigställd uppgift räknas inte längre felaktigt som osparad, så länkar efter Färdigställ fungerar direkt.",
    ],
  },
  {
    version: "0.4.28",
    date: "2026-10-09",
    summary: "Krävd nivå i stället för riskklass, tydligare materialrader och lugnare rutor på mobilen.",
    items: [
      "Riskklass heter nu Krävd nivå (nivå 1, 2 eller 3) och visar vilken nivå en person behöver för uppgiften.",
      "Materialrader har fälten Benämning, Antal och Enhet, med förslag på vanliga enheter.",
      "Projektsidan har panelen Material i projektet, som summerar materialet från projektets arbetsordrar och kan exporteras som CSV.",
      "På mobilen hoppar rutorna inte längre när tangentbordet öppnas, och fältet du skriver i syns alltid.",
    ],
  },
  {
    version: "0.4.27",
    date: "2026-10-08",
    summary: "Tydligare arbetsflöde med steg och riskbedömning i varje jobb, enklare mobil, egna prislistor, tvåstegsinloggning och kompetenskort.",
    items: [
      "Varje jobb har tydliga steg: Beställning, Riskbedömning, Utförande, Signering och Färdigställd. Under stegraden står nästa sak, och knappen Varför kan jag inte gå vidare? visar exakt vad som saknas.",
      "Riskbedömning är ett steg i varje nytt jobb, förenklad med fem frågor eller utökad när risken är högre. Tiden startar och jobbet färdigställs först när steget är gjort.",
      "I arbetsordern väljer du kund och sedan kundens plats. Du kan lägga till eller redigera kunden därifrån utan att förlora det du skrivit.",
      "En tillfällig plats med adress och liten karta kan läggas på ett jobb. Den hamnar aldrig i kundregistret.",
      "Importera era egna prislistor under Import och välj artiklar på materialraderna. Priset sparas på raden och ändras aldrig i efterhand.",
      "Projekt kan märkas med Personalliggare krävs. Den som startar tid påminns om att checka in på plats.",
      "En uppgift kan höra till en arbetsorder, och tid på uppgiften hamnar då på arbetsordern. Projektsidan visar projektets jobb med arbetsordrar och uppgifter samlade.",
      "Du får en notis när någon ger dig en uppgift, och en gråad knapp säger alltid varför den inte går att använda.",
      "Administratören kan ge varje person en förvald arbetsvy: Montör, Ledande montör eller Arbetsledare.",
      "Tvåstegsinloggning med kod från en app i mobilen, reservkoder, en säkerhetslogg och möjlighet att se och logga ut sina inloggningar.",
      "Kompetenskortet har utbildningar, kompetensgrupper, körkort och språk, med historik och påminnelse innan något går ut.",
      "På mobilen öppnas långa rutor, till exempel Nytt projekt, som en egen sida med knapparna fast längst ned, och knapparna är lättare att träffa med fingret.",
      "Menyn och Översikten visar bara det du har rätt att göra.",
    ],
  },
  {
    version: "0.4.26",
    date: "2026-10-08",
    summary: "Smidigare mobil, ny appikon och rättade texter.",
    items: [
      "På mobilen öppnar Sök i bottenmenyn den globala sökningen.",
      "Dialogerna på mobilen ligger kvar ovanför tangentbordet, med rubrik och Stäng synliga medan innehållet rullar.",
      "Kalkylatorn är inte längre en skärmhög platta på mobilen.",
      "Appen har en ny ikon.",
    ],
  },
  {
    version: "0.4.25",
    date: "2026-10-08",
    summary: "Enklare platser med adressförslag, bilkostnad på arbetsordern och en kalkylator i toppraden.",
    items: [
      "En plats som du har valt i Plats-fältet kan redigeras direkt därifrån med pennan: namn, adress och kartnål. En ny plats med samma namn under samma kund stoppas, och du kan välja den befintliga i stället.",
      "Adressen har egna fält för gatuadress, husnummer, postnummer och postort. Med Lantmäteriets adresstjänst föreslås adressen automatiskt när du sätter eller flyttar kartnålen. Ett förslag ersätter aldrig det du har skrivit utan att du väljer det.",
      "Arbetsordern har Material och utgifter: utgiftsrader med à-pris och belopp, en summa och knappen Bilkostnad. Den räknar sträckan till uppdragets plats från din position eller en vald plats, eller utgår från bilens mätarställning. Utgifterna följer med i PDF-filen.",
      "Kalkylatorn i toppraden räknar trefaseffekt: fyll i två av effekt, spänning och ström, så beräknas den tredje.",
      "Egenkontrollprogrammets mall har tio avsnitt, med metoden i åtta steg, roller och bilagorna Rollbeskrivningar och Kompetenskort. Ett program som inte har ändrats uppdateras, och ett redigerat eller fastställt program lämnas orört.",
    ],
  },
  {
    version: "0.4.24",
    date: "2026-10-07",
    summary: "Egenkontrollprogrammet visas som en sida, och redigeringen öppnas när du väljer det.",
    items: [
      "Egenkontroll öppnar programmet som en sida att läsa. Administratören trycker Redigera programmet för att ändra, med Redigera, Läsläge och PDF. Fastställ och Stäng leder tillbaka till sidan.",
      "Appikonen är ett blått W som fyller ikonen bättre.",
    ],
  },
  {
    version: "0.4.23",
    date: "2026-10-07",
    summary: "Platser på kartan, en lugnare verktygsrad i redigerarna och enklare inställningar.",
    items: [
      "Verktygsraden i Skapa formulär och egenkontrollprogrammet har samma knappar i samma ordning, och ingenting flyttar sig när du klickar.",
      "Platsens karta öppnas direkt när platsen har en position. Du sätter kartnålen med ett tryck, drar den till rätt ställe och tar bort den med Ta bort kartnålen.",
      "Platssidan visar platsens nål och nålarna för platserna under, och en nål öppnar platsen. På kundkortet har varje plats med position Visa på karta.",
      "Väljs en plats i projektet, kontrollen eller planeringen fylls arbetsplats och anläggning i från platsen. Ändra plats öppnar platsvalet.",
      "Mina inställningar sparar varje val direkt, och val som sällan ändras ligger hopfällda under Avancerat.",
      "Nya användare börjar med visningsnivå Lagom på mobilen.",
      "Inställningarna har flikarna Mina inställningar, Företaget, Användare, Funktioner, Värden och referenser, Abonnemang och krediter, Workflow AI, Avancerat och Hjälp. Medarbetare ser bara Mina inställningar och Hjälp.",
    ],
  },
  {
    version: "0.4.22",
    date: "2026-10-07",
    summary: "Rättningar efter ett helhetsprov av kundens vardag.",
    items: [
      "Lantmäteriets karta läses rätt, och under Servernycklar finns en provkarta att dra och zooma i.",
      "Med organisationsnumret hämtas företagets namn och adress från SCB, i Ställ in Workflow och i Företagsuppgifter.",
      "En rond som har startats i förväg visas som påbörjad med Fortsätt rond tills protokollet är färdigställt.",
      "Nästa steg efter Färdigställ får plats på mobilen.",
      "Kontaktperson fylls bara i med en riktig kontaktperson.",
      "Driftronderna visar år på tillfällen nästa år och säger till när du saknar behörighet att se ronderna.",
    ],
  },
  {
    version: "0.4.21",
    date: "2026-10-07",
    summary: "Tydligare och kortare texter i hela Workflow och några små rättningar.",
    items: [
      "Texterna i Workflow är genomgångna, språkfel är rättade och långa förklaringar kortare.",
      "Ett kompetenskort sparas i tre månader även när personen själv raderar sitt konto.",
    ],
  },
  {
    version: "0.4.20",
    date: "2026-10-07",
    summary: "Kalkylatorer, kompetenskort med filer, rapportarkiv, notiser per e-post och push samt nivåer och riskklasser för uppgifter.",
    items: [
      "Ställ in Workflow är en lugnare guide med status per steg och en sammanfattning på sista sidan.",
      "Under Inställningar, Funktioner finns företagets valfria funktioner på ett ställe. Kontor och avdelningar är valfritt och av som standard.",
      "Från Planering kan en rond startas alla dagar med Starta nu, även före dagen. Protokollet får rondens plats, kund och ansvarig.",
      "Räkneverktyg under Verktyg: ström och effekt, spänningsfall, kortslutningsström, kabelarea, Ohms lag och energikostnad. Varje verktyg visar hur det räknade, och resultatet går att kopiera. Gränser och belastbarhet anger företaget själv.",
      "Instrument har en egen knapp under Kvalitet i menyn.",
      "Kundens särskilda krav skrivs på kundkortet och visas i kundens projekt och uppgifter.",
      "Intyg och utbildningsbevis kan bifogas som filer på ett kompetenskort. Kortet sparas i tre månader efter att personen har lämnat företaget.",
      "Påminnelserna i klockan kan också skickas som e-post eller push. Du väljer själv under Mina inställningar, Notiser, och inget är påslaget från början.",
      "I Rapportarkivet sparar du en PDF- eller Excel-rapport när du exporterar den och kan hämta den igen senare.",
      "Varje roll i egenkontrollprogrammet har en nivå (1–3), och varje uppgiftstyp har en riskklass som företagets administratör sätter. Ingen kan tilldelas, starta, fylla i, slutföra eller signera en uppgift med högre riskklass än sin nivå, och sidan förklarar vad som saknas.",
      "Den som arbetar under handledning får göra en uppgift en riskklass över sin nivå när en handledare med tillräcklig nivå är ansvarig.",
      "På sidor där besök mäts väljer du i kakrutan mellan Bara nödvändiga och Tillåt statistik. Inget för statistik laddas före ditt val.",
    ],
  },
  {
    version: "0.4.19",
    date: "2026-10-07",
    summary: "Arbetsordrar för underhållsarbete, återkommande kontroller i planeringen och företagets egna gränsvärden.",
    items: [
      "Arbetsordern har ett underhållsblock och kolumnen Prioritet. En pausad order kan vänta på material, kund eller avställning, och akuta öppna ordrar visas överst.",
      "Från en avvikelse i en kontroll skapar du en arbetsorder direkt, med en väg tillbaka till raden.",
      "Ett färdigställt protokoll kan bli en driftrond med formulärets kontrollintervall, plats, kund och ansvarig.",
      "Under Inställningar, Värden och referenser anger företaget sina egna gränsvärden och källan till dem. Protokollen fyller i värdena som förval på mätraderna.",
      "En mätrad utan gräns visas som Ej bedömd i stället för godkänd eller avvikande, även i PDF och Excel.",
      "Planeringen visar driftronderna med status, och en rond kan startas direkt därifrån.",
      "Egenkontrollprogrammet är ett sammanhängande dokument med innehållsförteckning, organisationsschema och personernas roller och kompetens, med instrumentregister och påminnelser.",
      "Under Hjälp ser du vad som är nytt i varje version.",
    ],
  },
];

/** -1, 0 or 1 for two versions such as 0.4.19 and 0.4.20 (numbers compared part by part). */
export function compareVersions(left: string, right: string) {
  const a = left.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const b = right.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return difference < 0 ? -1 : 1;
  }
  return 0;
}

/** The version running now: the one built into the app, otherwise (scripts) the newest note. */
export function currentAppVersion() {
  return process.env.NEXT_PUBLIC_APP_VERSION || RELEASE_NOTES[0]?.version || "0.0.0";
}

export const releaseNoteFor = (version: string, notes = RELEASE_NOTES) => notes.find((note) => note.version === version) ?? null;

/**
 * The notes a newsletter should carry: those after `since` (the version the last one covered) up to the running
 * version, newest first. Without an earlier newsletter only the running version is told about, never the whole history.
 */
export function releaseNotesSince(since: string | null, current = currentAppVersion(), notes = RELEASE_NOTES) {
  const shipped = notes.filter((note) => compareVersions(note.version, current) <= 0);
  if (!since) return shipped.slice(0, 1);
  return shipped.filter((note) => compareVersions(note.version, since) > 0);
}

/** The highest of some versions, or null. */
export function highestVersion(versions: (string | null | undefined)[]) {
  return versions.filter((value): value is string => Boolean(value)).sort(compareVersions).at(-1) ?? null;
}
