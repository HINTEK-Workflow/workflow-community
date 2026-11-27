/**
 * Versionsnyheter (2026-10-06: "Vid varje uppdatering ska en kort presentation av förbättringarna sammanställas
 * i ett veckobrev"): what each version brings, in plain words for the people who use Workflow. One source for the
 * help page ("Nytt i version …"), the notice after an update, the newsletter, the website's version block and the
 * post draft made at a new version.
 *
 * Writing a note: follow docs/regler/versionstexter.md (2026-11-12) – natural Swedish, what the user can do or what
 * works better, a short summary and short points, no internal details, no company, customer or domain names from
 * development. Newest first. Every version in package.json gets a note (tests/release-notes.test.ts checks it).
 *
 * Only the progression and the improvements (2026-11-22): the summary and the few most important things a user notices,
 * normally one to four points. Small fixes, wording and anything that was later removed or replaced are left out.
 */
export type ReleaseNote = {
  version: string;
  /** The day the version was finished, YYYY-MM-DD. */
  date: string;
  /** One short sentence about the version as a whole. */
  summary: string;
  items: string[];
  /**
   * Optional short lines for the public start page's block Nytt i systemet (at most three are shown). Without them the block
   * shows the first points (releaseHighlights).
   */
  highlights?: string[];
};

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: "0.89.0",
    date: "2026-11-27",
    summary: "Gör underhållet i driftronden och logga in med telefonen.",
    items: [
      "Underhåll kan nu göras i driftronden. Välj ronden under Var görs det på planen, så hamnar underhållet i rondens arbetsorder när det är dags, och teknikern bockar av punkterna och trycker på Klart.",
      "En plan kan ha en instruktion och en checklista. Under Underhåll visar rutan Planerat underhåll vad som är försenat och hur stor del som gjordes i tid, och varje maskin har fått fliken Historik.",
      "Har du godkänt inloggningen med Microsofts tvåsteg, till exempel i Microsoft Authenticator, behöver du inte skriva Workflows kod efteråt. Med Logga in med telefonen skannar du en QR-kod och godkänner med ansikte eller finger.",
      "I mörkt tema visas menyns ikoner nu i samma färg som texten.",
    ],
    highlights: [
      "Underhåll i driftronden",
      "Planerat underhåll och Historik per maskin",
      "Logga in med telefonen",
    ],
  },
  {
    version: "0.88.0",
    date: "2026-11-26",
    summary: "Låt fler bygga formulär, och spara företagets nycklar i en säker fil.",
    items: [
      "Nu kan du låta fler bygga formulär. Under Användare ger du behörigheten Bygga formulär till dem som ska skapa och ändra formulär, också med Skapa med AI.",
      "Under Inställningar › Kopplingar kan du exportera företagets nycklar till en lösenordsskyddad fil och läsa in dem igen. Filen öppnas i de flesta lösenordshanterare, och efter en inläsning ser du vilka nycklar som bör bytas.",
    ],
    highlights: [
      "Fler kan bygga formulär",
      "Exportera och läs in företagets nycklar",
    ],
  },
  {
    version: "0.87.0",
    date: "2026-11-26",
    summary: "Spara dokument på kunden och platsen, knappar som ser likadana ut överallt, och en tydligare QR-kod i mörkt tema.",
    items: [
      "Nu kan du spara dokument på kunden och vid varje plats, till exempel ritningar, intyg och avtal. Under Mer › Dokument hittar du alla på ett ställe. Varje fil virussöks innan den kan laddas ner.",
      "Knapparna ser likadana ut överallt: samma höjd, form och färg för samma sorts knapp. Val som Dag, Vecka och Månad eller Teamet och Jag har samma reglage som Mina och Alla, och pilarna bredvid I dag är lika höga som knappen.",
      "QR-koden för tvåstegsverifiering syns tydligt även i mörkt tema.",
    ],
    highlights: [
      "Dokument på kunden och platsen",
      "Samma knappar överallt",
    ],
  },
  {
    version: "0.86.0",
    date: "2026-11-25",
    summary: "Skapa formulär med Workflow AI, enklare tvåstegsinloggning med passkey, och en lugnare egenkontroll där texten och inställningarna har var sin plats.",
    items: [
      "I formulärbyggaren kan du be Workflow AI om ett formulär. Beskriv vad protokollet ska innehålla, eller bifoga en bild av ert eget protokoll, så får du ett förslag som du sparar som utkast. Vill du ändra något skriver du det i chatten. Du granskar och publicerar själv.",
      "Skapa med AI har fått en egen knapp högst upp i formulärbyggaren.",
      "Det är enklare att slå på tvåstegsverifiering. Du skannar en stor QR-kod med telefonen och skriver de sex siffrorna, så går Workflow vidare av sig själv. Vid inloggning kan du använda en passkey med ansikte eller finger i stället för koden.",
      "När du redigerar egenkontrollprogrammet ändrar du bara texten. Roller och kompetensbedömning sköts under Kompetenskort, och programmets uppgifter hittar du under Uppgifter i verktygsraden.",
      "Ett annat system kan med en egen API-nyckel ge Workflow ett uppdrag om ett inlägg. Workflow AI skriver utkastet, och det väntar under Schemalagt tills du godkänner det.",
      "Filmer till YouTube laddas upp i mindre delar och fortsätter där de var om nätet hackar.",
    ],
    highlights: [
      "Skapa formulär med Workflow AI",
      "Tvåsteg med QR-kod och passkey",
      "Egenkontrollen: texten för sig, inställningarna för sig",
    ],
  },
  {
    version: "0.85.0",
    date: "2026-11-24",
    summary: "Egenkontrollprogrammet har fått en ny uppbyggnad, en AI som ChatGPT eller Claude kan skapa formulär åt dig, och filmerna går att dela och söka i.",
    items: [
      "I Egenkontroll har Rollbeskrivningar, Kompetenskort, Organisation och ansvar och Inhyrd personal fått egna flikar. Du lägger upp rollerna och personerna en gång, och programmet hämtar dem därifrån.",
      "Under Organisation och ansvar bygger du organisationen med kort som du drar dit du vill och kopplar ihop. Ordna korten ställer upp dem prydligt.",
      "Kompetenskortet räknar fram nivån från antal års erfarenhet. Den som får justera nivån skriver en motivering.",
      "Välj Skapa formulär med extern AI och ladda ner paketet. Ge filerna till din AI tillsammans med din beskrivning eller ditt dokument, och importera sedan formuläret som AI:n skapar. Det blir ett utkast som du granskar och publicerar.",
      "På sidan Filmer kan du söka efter ett ord. Workflow letar i filmernas namn och i det som sägs i filmerna, och ett klick på en träff spelar filmen därifrån. Varje film har också en egen länk som du delar med knappen Dela.",
      "Du kan importera en formulärfil som har exporterats från en nyare version av Workflow. Inställningar som din version inte känner till tas bort, och du får se vilka.",
      "Stora filmer laddas upp stabilare och fortsätter där de var om nätet hackar.",
      "Agenterna följer företagets val för vad som får skickas till AI. När en agent vill ändra något väntar ändringen under Körhistorik tills du väljer Godkänn.",
      "Ägarens roll kan bara ändras av ägaren. Är tvåstegsverifiering påslagen frågar Workflow efter koden också när du loggar in med Google eller Microsoft.",
    ],
  },
  {
    version: "0.84.1",
    date: "2026-11-24",
    summary: "Agenterna förstår dig bättre i samtalet.",
    items: [
      "Svarar du E-post när Workflow frågar hur du vill få resultatet, bekräftas det bara. Tidigare lades ordet till i det agenten ska göra.",
      "Du kan skriva klockan sju eller klockan fjorton med bokstäver, så förstår Workflow tiden.",
      "Texterna i hjälpen följer de nya filmerna.",
    ],
  },
  {
    version: "0.84.0",
    date: "2026-11-24",
    summary: "Agenter görs nu i ett samtal: du skriver vad agenten ska göra, och Workflow fyller i resten.",
    items: [
      "Under Agenter ligger dina uppdrag, exemplen och de inbyggda agenterna i en enda lista, med sök och filter som på andra sidor.",
      "I ett uppdrag skriver du till agenten som i Workflow AI. Workflow fyller i korten Vad, När, Underlag, Resultat och Till vem, och frågar bara om det som saknas.",
      "Resultatet kan gå till kollegor eller alla administratörer, och agenten kan köras varannan vecka, sista dagen i månaden, flera gånger om dagen eller ett visst datum.",
      "De inbyggda agenterna kan anpassas för företaget med en egen instruktion, och Återställ till original tar tillbaka Workflows version.",
    ],
    highlights: [
      "Skriv till agenten, så fyller Workflow i uppdraget.",
      "Fler mottagare och friare schema.",
      "Inbyggda agenter går att anpassa.",
    ],
  },
  {
    version: "0.83.0",
    date: "2026-11-23",
    summary: "Appen känns mer som telefonens och surfplattans egna appar, och Workflow AI är enklare att använda i mobilen.",
    items: [
      "I telefonen följer appen telefonens egna vanor: på iPhone som Apples appar och på Android som Googles. Knappar, tillbaka och sidbyten känns som du är van vid.",
      "På surfplattan fyller appen hela skärmen. Menyn står till vänster, och när plattan ligger ner ser du listan och det du har öppnat bredvid varandra.",
      "Workflow AI fyller hela skärmen i telefonen, och texten är lika stor som i resten av appen. Förslagen på frågor ligger på en rad ovanför fältet, och du sveper i sidled för att se fler.",
    ],
    highlights: [
      "Appen följer iPhones och Androids egna vanor.",
      "Lista och innehåll bredvid varandra på surfplattan.",
      "Workflow AI enklare att använda i mobilen.",
    ],
  },
  {
    version: "0.82.0",
    date: "2026-11-22",
    summary: "Sökningen visar bara det du letar efter, Nyheter fungerar som de andra sidorna, och filmerna går att spola med piltangenterna.",
    items: [
      "Sökrutan visar bara träffarna, utan filterbrickor och ikoner. Filtren som kund: och status: fungerar fortfarande när du skriver dem.",
      "Under Nyheter ser du först listan med Publicerade och Utkast. Ny nyhet och Redigera öppnar ett eget formulär.",
      "Agenter, Inlägg, Filmer och Användning ser ut och fungerar som resten av Workflow.",
      "I filmerna på webbplatsen hoppar du 10 sekunder med knapparna under filmen eller med piltangenterna.",
    ],
    highlights: [
      "Sökrutan visar bara träffarna.",
      "Nyheter med lista och eget formulär, som de andra sidorna.",
      "Spola filmerna 10 sekunder med piltangenterna.",
    ],
  },
  {
    version: "0.81.0",
    date: "2026-11-22",
    summary: "Telefonen känns lugnare: sidan står still bakom menyerna, och Workflow AI har fått ett enklare utseende.",
    items: [
      "När du öppnar Ny, Mer eller en annan meny i telefonen står sidan bakom still. Du skrollar bara i menyn.",
      "I Workflow AI står svaren som vanlig text, utan rutor. Längst upp finns bara ⋯ och stäng, och under ⋯ hittar du konversationerna och inställningarna.",
      "Manuellt och Auto väljer du nu vid mikrofonen. Där finns också Agent, där du beskriver ett uppdrag med egna ord och kontrollerar det under Agenter innan det sparas.",
    ],
    highlights: [
      "Sidan står still bakom menyerna i telefonen.",
      "Workflow AI med svar utan rutor och ett enklare huvud.",
      "Välj Manuellt, Auto eller Agent vid mikrofonen.",
    ],
  },
  {
    version: "0.80.0",
    date: "2026-11-22",
    summary: "Arbetsordern visar samma procent överallt, utgångna offerter syns, och demon går att prova med Workflow AI.",
    items: [
      "I arbetsordern visar huvudet och rutan Färdigställ samma procent. Arbetsordern blir 100 % när du färdigställer den.",
      "Ett offertutkast vars Giltig till har passerat visas nu som Utgången. Ändra Giltig till om du vill skicka offerten ändå.",
      "Under Tid jämför Min vecka med vardagarna hittills i veckan. På måndag morgon saknas alltså inte hela veckans timmar.",
      "I demon svarar Workflow AI med exempelsvar på vanliga frågor, och du ser Manuellt och Auto som i appen.",
    ],
    highlights: [
      "Arbetsordern visar samma procent i huvudet och i rutan Färdigställ.",
      "Ett offertutkast som har passerat Giltig till visas som Utgången.",
      "I demon svarar Workflow AI med exempelsvar.",
    ],
  },
  {
    version: "0.79.0",
    date: "2026-11-21",
    summary: "Workflow AI kan nu göra saker åt dig, både direkt och som agenter på schema, och förslag och tips kommer i chatten.",
    items: [
      "Workflow AI har två lägen ovanför skrivfältet. I Manuellt föreslår den och du väljer Använd. I Auto gör den uppgiften direkt, och du får en länk och kan ångra.",
      "Under Mer finns Agenter. Där skapar du uppdrag som Workflow AI gör åt dig på schema eller när något händer, och rapporterna kommer som PDF i företagets utseende.",
      "I chatten kan du bifoga en bild, till exempel ett foto av en märkskylt, eller prata in ett meddelande. Du kan också fråga hur något görs i Workflow.",
      "Under Mer finns Nyheter, där företagets admin skriver nyheter till alla i företaget.",
    ],
  },
  {
    version: "0.78.0",
    date: "2026-11-21",
    summary: "Vanliga frågor till Workflow AI ingår nu i abonnemanget, och företaget kan välja att AI bara används inom EU.",
    items: [
      "Vanliga frågor och förslag i Workflow AI ingår i abonnemanget, inom en kvot per vecka. Under Inställningar › Arbetssätt › Workflow AI › Användning ser du hur mycket som är använt.",
      "Företagets admin kan välja att Workflow AI bara används inom EU. Slår ni på Workflow AI för första gången är EU förvalt.",
      "Vill ni använda en egen AI-app, till exempel ChatGPT eller Claude, slår admin på Tillåt egna AI-appar under Kopplingar. Under Mina inställningar › Anslutna appar ser du de appar du har godkänt.",
    ],
  },
  {
    version: "0.77.0",
    date: "2026-11-21",
    summary: "Inlägg, webbsida och filmer har fått en egen sida under Mer, och Tavlor säger om tavlan går att läsa på din skärm.",
    items: [
      "Inlägg, Min webbsida och Filmer finns under Mer › Webb och inlägg. Under Filmer publicerar eller schemalägger du filmer på företagets YouTube-kanal.",
      "Tavlor säger om tavlan går att läsa på den skärm och det avstånd du har valt. Förhandsgranska visar det för varje skärm.",
      "När du loggar ut avslutas inloggningen också på servern, och ett lösenord som är för vanligt godtas inte.",
      "När du klickar på en driftronds namn öppnas ronden med dagens tillfälle.",
    ],
  },
  {
    version: "0.76.0",
    date: "2026-11-21",
    summary: "Filmerna spelas i en stor ruta med Nästa film, och Tavlor förklarar skillnaden mellan fasta skärmar och delade länkar.",
    items: [
      "När du spelar en film öppnas den i en stor ruta över sidan. Under filmen tar Nästa film dig vidare i serien.",
      "Under Fasta skärmar och Delade länkar förklarar en ruta skillnaden och hur de skyddas. Skannar du en skärms QR-kod utan att vara inloggad kommer du efter inloggningen direkt till Koppla skärm.",
      "I en egen installation nämner Workflow inte längre krediter eller Cloud-abonnemang.",
      "På offerter, fakturaunderlag och fakturor med ROT står det kort: Preliminärt avdrag. Skatteverket avgör.",
    ],
  },
  {
    version: "0.75.0",
    date: "2026-11-20",
    summary: "Protokollen i arbetsordern är lättare att känna igen, riskbedömningen frågar inte i onödan och inbjudningarna ger tydligare besked.",
    items: [
      "Under Uppgifter i arbetsordern visas varje protokoll med formulärets namn. Platsen står direkt under namnet.",
      "En bekräftad riskbedömning är redan sparad. I telefonen frågar Avbryt och Bakåt därför inte längre om ändringarna ska kastas.",
      "En inbjudningslänk som redan har använts säger det och visar vägen till inloggningen.",
    ],
  },
  {
    version: "0.74.0",
    date: "2026-11-20",
    summary: "Funktionssidorna och startsidan kan visa en film, och sökningen visar träffarna tydligare.",
    items: [
      "Funktionssidorna och startsidan kan visa en film. Klicka på spelknappen mitt på bilden så spelas filmen där bilden var.",
      "Sök visar varje träff med sin ikon och en rad om vad det är, och de ord du sökt på står i fetstil.",
    ],
  },
  {
    version: "0.73.0",
    date: "2026-11-19",
    summary: "Tavlorna visar trender, har nya kort och gör texten större ju längre bort skärmen sitter.",
    items: [
      "Välj Avstånd för tavlan: Nära för en whiteboard, Mellan för ett mötesrum och Långt för en produktionshall. Längre avstånd ger större text på korten.",
      "Nyckeltal visar en trend med en liten kurva och ändringen mot förra perioden. Det nya kortet Trend visar mått över tid mot ert eget mål.",
      "Nya kort visar dagens bokningar, maskinernas läge och larm, underhållsjobb och felanmälningar.",
      "Korttyperna ligger i en rad med ikoner överst. Klicka på en eller dra den till rätt plats på tavlan.",
    ],
  },
  {
    version: "0.72.0",
    date: "2026-11-19",
    summary: "Tavlorna har fått tio färdiga exempel, bättre redigering av varje kort och ser bra ut på alla skärmstorlekar.",
    items: [
      "Under Ny tavla finns tio exempeltavlor, till exempel Veckans arbete, Ekonomi i månaden och Skärm i verkstaden.",
      "Varje kort kan få period, jämförelse med förra perioden, mål, enhet och färg.",
      "Text, tal och diagram växer med skärmen, från en surfplatta till en stor tv.",
      "Nya mått: nya avvikelser, ronder som inte gjordes, godkända offerter, fakturerat, förfallna fakturor och nya kunder.",
    ],
  },
  {
    version: "0.71.0",
    date: "2026-11-19",
    summary: "Nu kan ni bygga tavlor med nyckeltal och visa dem på en skärm, och arbetsordern kan skapa inköp direkt.",
    items: [
      "Tavlor är nytt: samla nyckeltal, diagram, tabeller, text och bilder på en tavla och publicera den när den är klar.",
      "En tavla kan visas i helskärm med Presentera, på en fast skärm i till exempel verkstaden eller via en delad länk med slutdatum och kod.",
      "Arbetsordern har knappen Skapa inköp, som gör ett inköp av materialraderna.",
    ],
  },
  {
    version: "0.70.0",
    date: "2026-11-18",
    summary: "Workflow känns mer som en app i telefonen, med ett tydligt toppfält och val som öppnas nedifrån.",
    items: [
      "I telefonen har listor och sidor rundade grupper, ett tydligt toppfält och knappen Ny som öppnas nedifrån. Spara står uppe till höger.",
      "Filter i listorna öppnas nedifrån, och Fakturor och Fakturaunderlag har sökfält direkt.",
      "Tiden som går visas på jobbet med en klocka och en Stoppa-knapp.",
    ],
  },
  {
    version: "0.69.0",
    date: "2026-11-18",
    summary: "Funktionssidorna har fått fler bilder och exempel, och startsidan fungerar bättre i mobilen.",
    items: [
      "Varje funktionssida visar bilder och PDF-exempel, och bilderna går att förstora.",
      "På surfplattan ligger pilarna och Workflow AI till höger, som på datorn.",
    ],
  },
  {
    version: "0.68.0",
    date: "2026-11-16",
    summary: "Startsidan visar hur du kommer igång, och demon passar bättre i mobilen.",
    items: [
      "I mobilen börjar demon med rundturen, och du kan se ett larm bli en arbetsorder direkt i telefonen.",
      "Skriv {version} i ett inlägg så står den senaste versionen där när inlägget publiceras.",
      "En ny Community-installation öppnar guiden Ställ in Workflow vid första inloggningen.",
    ],
  },
  {
    version: "0.67.0",
    date: "2026-11-16",
    summary: "Inlägg kan ha flera bilder och en egen text för Instagram, och du ser hur publiceringen går.",
    items: [
      "Ett inlägg kan ha en egen text för Instagram och flera bilder som visas som ett bildspel.",
      "Du ser hur långt publiceringen har kommit och kan avbryta den.",
      "Du kan markera att ett inlägg innehåller AI-genererad bild eller AI-genererat ljud.",
    ],
  },
  {
    version: "0.66.0",
    date: "2026-11-16",
    summary: "Du loggas inte längre ut när Workflow uppdateras, och Rapportera fel eller förslag är lättare att hitta.",
    items: [
      "Du loggas inte längre ut när Workflow startar om efter en uppdatering.",
      "Rapportera fel eller förslag syns tydligare i sidfoten och på inloggningssidan.",
      "Rondprotokoll får läsbara nummer, och långa företagsnamn får plats i PDF:ernas sidhuvud och sidfot.",
    ],
  },
  {
    version: "0.65.0",
    date: "2026-11-15",
    summary: "Knapparna står på samma plats på alla sidor, och installationen av Community är tydligare.",
    items: [
      "Sidans knappar för att skapa något nytt står alltid uppe till höger. Knapparna för det du har öppet står vid det.",
      "Installationen av Community visar kommandot för både Windows och Linux eller macOS, och guiden är tydligare.",
    ],
  },
  {
    version: "0.64.0",
    date: "2026-11-14",
    summary: "Texterna i hela Workflow är lättare att läsa, och korten under Kopplingar står i linje.",
    items: [
      "Texterna i hela appen och i demon är genomgångna: kortare meningar, rätt ordföljd och samma ord för samma sak överallt.",
      "Vad en användare får göra heter Behörigheter överallt, och ett meddelande säger tydligt vem som får göra något.",
      "När kort står bredvid varandra ligger Spara och Mer på samma höjd längst ner.",
    ],
  },
  {
    version: "0.63.0",
    date: "2026-11-14",
    summary: "Offert, inköp och faktura ser ut som arbetsordern, och Workflow Community går att installera gratis.",
    items: [
      "Offerter, inköp och fakturaunderlag ser ut som arbetsordern: Grunduppgifter först, knapparna uppe till höger och det som används sällan under Mer.",
      "Ny offert, Nytt inköp och Nytt fakturaunderlag öppnas direkt och sparas som utkast när du börjar skriva.",
      "Workflow Community finns att ladda ner och installera gratis på egen server.",
    ],
  },
  {
    version: "0.62.0",
    date: "2026-11-13",
    summary: "Serier av inlägg, fler mallar och ett sätt att rapportera fel.",
    items: [
      "Med Ny serie skriver du flera inlägg på en gång, till exempel tolv för en månad. Tiderna läggs efter publiceringsrytmen.",
      "Inlägg har mallarna Vit, Blå och Svart, och företagets logga kan läggas in för mörk och ljus bakgrund.",
      "Med Rapportera fel eller förslag kan du och dina kunder skicka in fel och idéer direkt.",
    ],
  },
  {
    version: "0.61.0",
    date: "2026-11-13",
    summary: "Verktyg heter nu Mer och samlar verktygen på en egen sida.",
    items: [
      "Verktyg heter nu Mer och öppnar en sida med Rapportarkiv, Egenkontroll, Instrument och de andra verktygen.",
    ],
  },
  {
    version: "0.60.0",
    date: "2026-11-13",
    summary: "Inlägg kan gå ut som story, och varje maskinkälla har ett eget kort.",
    items: [
      "Med Även som story går inläggets bild också ut som story på Facebook och Instagram. En story visas i 24 timmar.",
      "Under Maskiner har varje källa ett eget kort, och Fånga prov och Prov ligger bland kortets andra knappar.",
    ],
  },
  {
    version: "0.59.0",
    date: "2026-11-12",
    summary: "Enklare schemaläggning och fler inläggsmallar med hashtaggar.",
    items: [
      "När du schemalägger väljer du dag och tid med ett tryck, och Workflow föreslår nästa lediga tid i publiceringsrytmen.",
      "Med I tur och ordning schemalägger du flera utkast på en gång, vart och ett på sin egen tid.",
      "Inlägg har åtta nya mallar och ett eget fält för hashtaggar.",
    ],
  },
  {
    version: "0.58.0",
    date: "2026-11-12",
    summary: "Schemalägg inlägg och webbsidor, publicera på LinkedIn och redigera webbplatsen som den ser ut.",
    items: [
      "Du kan schemalägga inlägg och sidor till en viss dag och tid. Under Schemalagt ser du vad som väntar och kan flytta eller avbryta.",
      "LinkedIn kan kopplas under Kopplingar och väljas som kanal i Inlägg, bredvid Facebook och Instagram.",
      "Min webbsida visar sidorna med webbplatsens egna typsnitt, färger och layout.",
      "Det finns en ny integritetspolicy. Du bekräftar den en gång vid nästa inloggning.",
    ],
  },
  {
    version: "0.57.0",
    date: "2026-11-11",
    summary: "Anslutna webbplatser kan hantera sidtitlar och beskrivningar för sökmotorer.",
    items: [
      "Anslutna webbplatser kan hantera sidtitlar, beskrivningar och delningsbilder för varje sida. Du kan också förhandsgranska hur en sida visas i sökresultat.",
      "Förhandsvisningen hämtar innehåll från webbplatsen först när du trycker på Visa förhandsvisning.",
    ],
  },
  {
    version: "0.56.0",
    date: "2026-11-10",
    summary: "Skriv inlägg till företagets Facebook och Instagram direkt i Workflow.",
    items: [
      "Skriv texten, välj en mall och se hur inlägget blir innan du trycker Publicera. Bilden görs med företagets färg och logotyp.",
      "När du publicerar en sida i Min webbsida kan delar av den bli ett utkast till inlägg.",
      "Community-utgåvan har nu även Fakturor.",
    ],
  },
  {
    version: "0.55.0",
    date: "2026-11-10",
    summary: "Redigera företagets WordPress-webbplats direkt i Workflow.",
    items: [
      "Med Min webbsida ansluter du företagets WordPress-webbplats och redigerar dess sidor i Workflow.",
      "Ändringar sparas först som utkast och publiceras när du trycker Publicera. Sidan säkerhetskopieras innan den skrivs över, så att du kan återställa den.",
    ],
  },
  {
    version: "0.54.1",
    date: "2026-11-09",
    summary: "Tydligare apparater i PLC-simulatorn och en givartestare för analoga ingångar.",
    items: [
      "Ny signalkälla för 4–20 mA och en givartestare för spänning och ström, med ett exempel.",
      "Apparaterna är tydligare, och signalkällorna visar ärvärdet stort med börvärdet bredvid.",
    ],
  },
  {
    version: "0.53.0",
    date: "2026-11-09",
    summary: "PLC-simulatorns apparater är nu riktiga bilder, och det finns nödstopp och nödstoppsrelä.",
    items: [
      "Apparaterna i PLC-simulatorn är nya bilder sedda rakt framifrån. Alla rör sig eller lyser när du använder dem.",
      "Nytt nödstopp med två kanaler och nytt nödstoppsrelä med återställning, med ett exempel.",
    ],
  },
  {
    version: "0.52.0",
    date: "2026-11-09",
    summary: "Nya konton börjar direkt med serverlagring.",
    items: [
      "Ett nytt konto börjar direkt med serverlagring, utan något att installera.",
    ],
  },
  {
    version: "0.51.0",
    date: "2026-11-07",
    summary: "Tilldela larm, säkrare riskbedömning och ljud i PLC-simulatorn.",
    items: [
      "Larm och felanmälningar har en Tilldela-knapp.",
      "En ny risk står som Inte bedömd tills någon väljer nivå.",
      "Kontroller utan svar står som Ej ifyllt, och svaret Nej räknas som brist.",
    ],
  },
  {
    version: "0.50.0",
    date: "2026-11-06",
    summary: "Prova faktura och PDF i demon, och ett maskinlarm kräver riskbedömning innan tiden startar.",
    items: [
      "I demon kan du skapa en demofaktura och ta ut en PDF av en kontroll.",
      "Ett maskinlarm kräver riskbedömning innan tiden startar, och larmet visas överst.",
    ],
  },
  {
    version: "0.49.1",
    date: "2026-11-06",
    summary: "Nya villkor som beskriver fakturor, maskinlarm och kopplingar.",
    items: [
      "Villkoren beskriver nu fakturor, maskinlarm och kopplingar. Du godkänner dem på nytt vid nästa inloggning.",
    ],
  },
  {
    version: "0.49.0",
    date: "2026-11-05",
    summary: "Det går snabbare att skapa och skicka fakturor, och klockan visar när något nytt har hänt.",
    items: [
      "Skapa en faktura från början eller en proformafaktura, och öppna fakturaunderlaget direkt från arbetsordern.",
      "Klockan rör sig när något nytt kommer, och larm från maskiner visar om en arbetsorder skapades.",
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
      "Fler yrkesprofiler med färdiga förval.",
    ],
  },
  {
    version: "0.47.0",
    date: "2026-11-04",
    summary: "Redigera PDF-mallarna: texter, vilka block som visas och i vilken ordning.",
    items: [
      "Under Installation finns PDF-mallar. För varje dokumenttyp ändrar du texterna och väljer vilka block som visas och i vilken ordning.",
      "Ändras ett förval i en ny version behåller block du har ändrat din text och märks Förvalet ändrades, så att du kan jämföra och välja.",
    ],
  },
  {
    version: "0.46.0",
    date: "2026-11-04",
    summary: "Ny grunddesign på PDF-dokumenten, en omgjord PLC-simulator och Kopplingar ordnade efter område.",
    items: [
      "Alla PDF-dokument har en lugnare design med större text och tydligare rubriker, och företagets logotyp eller namn står i sidhuvudet.",
      "Kopplingar är ordnade i fyra områden: Bokföring, Lön och export, Maskiner samt API och MCP.",
      "I PLC-simulatorn drar du ledningar från plint till plint, och du kan växla mellan Ladder och ST utan att förlora något.",
    ],
  },
  {
    version: "0.45.0",
    date: "2026-11-03",
    summary: "Fler yrkesprofiler och förbättrade kunddokument.",
    items: [
      "Nya yrkesprofiler: Solcellsmontör, Driftelektriker och Underhållselektriker.",
      "Fakturaunderlaget visar kundens kontaktperson och adress, som offerten.",
    ],
  },
  {
    version: "0.44.0",
    date: "2026-11-03",
    summary: "PDF-dokumenten har samma utseende och sidfot överallt, med företagets färger och logotyp.",
    items: [
      "Protokoll, arbetsorderrapporter, projektrapporter och avvikelselistor får företagets färger, logotyp och avsändarruta.",
      "Alla rapporter har samma sidfot, och ett dokument som inte är färdigt märks EJ FÄRDIGSTÄLLT.",
    ],
  },
  {
    version: "0.43.0",
    date: "2026-11-03",
    summary: "PLC-simulatorn har fått nivån Grundläggande, med rityta, program i ST och ett PID-fönster.",
    items: [
      "Dra apparater till ritytan och koppla ledningar mellan plintarna. Du ser direkt vad som får spänning, och en kortslutning förklaras med ord.",
      "Programmet skrivs i strukturerad text (ST), och fel visas på svenska med rad och kolumn.",
      "PID-fönstret visar en regulator på en simulerad ugn, tilluft eller värmekrets.",
    ],
  },
  {
    version: "0.42.0",
    date: "2026-11-03",
    summary: "Tillbaka och Framåt fungerar överallt, och alla sidor har samma överdel.",
    items: [
      "Tillbaka fungerar så fort du har besökt en sida tidigare i Workflow. Framåt fungerar när du har gått tillbaka.",
      "Alla sidor har samma överdel, med rubrik, flikar och knappar på samma plats.",
      "Översikten visar det viktigaste först på varje flik.",
    ],
  },
  {
    version: "0.41.0",
    date: "2026-11-02",
    summary: "Hela maskinträdet på ett ställe, drifttimmar från maskinen och möjlighet att hoppa över riskbedömning med ett skäl.",
    items: [
      "Under Underhåll står platser, maskiner och delar i ett träd. Du kan dra en maskin eller en del till en ny plats.",
      "Drifttimmar kan hämtas från en signal i maskinen.",
      "I en arbetsorder kan riskbedömningen hoppas över som undantag, med ett skäl. Företaget kan stänga av möjligheten under Arbetssätt.",
    ],
  },
  {
    version: "0.40.0",
    date: "2026-11-02",
    summary: "Workflow AI som chatt, enklare planering, ny översikt och möjlighet att stänga av moduler.",
    items: [
      "Workflow AI öppnas med en rund knapp och ser ut som en chatt.",
      "Arbetsordern och Teamet har en Boka-knapp, och listan Att boka visar jobb som har datum men saknar bokning.",
      "Kapacitet räknas likadant överallt, och frånvaro och helgdagar dras av.",
      "Företagets administratör kan stänga av delar som inte används, och de försvinner för alla i företaget.",
    ],
  },
  {
    version: "0.38.0",
    date: "2026-11-02",
    summary: "Underhåll med platser och utrustning, förråd med egna nummer, bättre kalkylatorer och personlig kalenderlänk.",
    items: [
      "Underhåll har två träd: Platser och Utrustning.",
      "Förrådet har förråd, hyllor och fack med saldo per plats.",
      "Kalkylatorerna räknar med företagets egna kabeltyper, parallella ledare och säkringskurvor.",
      "Med en personlig kalenderlänk syns dina bokningar i din egen kalender.",
    ],
  },
  {
    version: "0.37.0",
    date: "2026-11-02",
    summary: "Yrkesprofiler, kommentarer, bättre notiser och tydligare regler för tid.",
    items: [
      "Den som loggar in första gången får meny och startsida som passar arbetet, till exempel som elektriker eller underhållstekniker. En profil ger aldrig fler rättigheter.",
      "Du kan kommentera arbetsordrar, projekt och avvikelser och nämna kollegor med @namn.",
      "Notiserna har flikarna Till mig och Teamet, och upprepade påminnelser blir en rad per dag.",
      "Om du loggas ut mitt i arbetet kan du logga in i en ny flik, och det du skrivit ligger kvar.",
    ],
  },
  {
    version: "0.36.0",
    date: "2026-11-01",
    summary: "Ny meny som följer arbetet, med egna flikar för Planering och Tid.",
    items: [
      "Menyn följer arbetet: Översikt och Planering först, sedan arbetet, kunder och affär, och sist företaget.",
      "Planering har Kalender, Tidplan och Kapacitet, som visar bokade timmar mot arbetstid per person och vecka.",
      "Tid har flikarna Min tid, Teamet och Lön och export. Under Teamet godkänner du tid och skickar påminnelser.",
    ],
  },
  {
    version: "0.35.0",
    date: "2026-11-01",
    summary: "Listorna har samma filterrad, och rapporterna visar rätt priser.",
    items: [
      "Offerter, Inköp, Fakturaunderlag, Driftronder, Förråd och Avvikelser har samma filterrad, och dina val kommer ihåg.",
      "Arbetsorderrapporten med Visa priser räknar med rapporterad tid gånger företagets timpris.",
      "Du får en notis när någon bokar dig eller flyttar din bokning, och när din månads tid godkänns eller skickas tillbaka.",
      "Frånkopplingstid räknas nu med rätt spänningsfaktor. Tidigare blev resultatet något för gynnsamt.",
    ],
  },
  {
    version: "0.34.0",
    date: "2026-10-31",
    summary: "Underhåll med maskinträd, förråd och återkommande underhåll, och felanmälan från operatörer.",
    items: [
      "Under Underhåll finns ett träd för företagets och kundernas maskiner, med bilder, reservdelar, händelser och kostnad per maskin.",
      "Återkommande underhåll: en plan per maskindel ger en arbetsorder för varje tillfälle, ett år framåt.",
      "Operatörer har en egen sida där de väljer maskin, orsak och allvarlighetsgrad och skickar en felanmälan.",
      "Förrådet har platser, även servicebilar, och ett uttag till en arbetsorder blir en materialrad.",
    ],
  },
  {
    version: "0.32.0",
    date: "2026-10-30",
    summary: "Tiden godkänns per månad och blir löneunderlag, och avvikelser har en egen sida.",
    items: [
      "Var och en skickar in sin månad, och arbetsledaren godkänner den per person.",
      "Löneunderlag kan tas ut som PDF eller CSV och exporteras till lönesystemet.",
      "Avvikelser har en egen sida, där du rapporterar elinstallation, riskobservation, tillbud och olycksfall med foton.",
    ],
  },
  {
    version: "0.31.0",
    date: "2026-10-29",
    summary: "Översikten hänger ihop på alla flikar, frånvaro kan anmälas och tid rapporteras med valfri tidstyp.",
    items: [
      "Teamet visar vem som gör vad just nu, vad som kräver åtgärd och vem som saknar tidrapport.",
      "Du anmäler sjukdom, VAB, semester och annan frånvaro, och Teamet visar vilka jobb som påverkas.",
      "Företaget bestämmer sina egna tidstyper, till exempel övertid, restid och jour, med egen lönekod.",
    ],
  },
  {
    version: "0.30.0",
    date: "2026-10-29",
    summary: "Översiktens Jag visar din dag tydligare, med tidslinje och snabbare väg till tiden.",
    items: [
      "Jag hälsar dig med dagens läge: vad som är förfallet, vad du ska börja med och vad som väntar.",
      "Dagens tidslinje visar den dag du väljer i kalendern.",
      "Tid visar var du senast rapporterade, och Fortsätt startar tiden igen.",
    ],
  },
  {
    version: "0.29.0",
    date: "2026-10-28",
    summary: "En ny Översikt med flikarna Jag, Teamet, Ekonomi och Kunder, anpassad efter vad du får se.",
    items: [
      "Jag visar vad du ska göra nu, förfallet arbete, dina avvikelser och tiden som går.",
      "Teamet visar belastning per person och projektläget, och Ekonomi visar ofakturerad tid och offertuppföljning.",
      "Varje siffra öppnar listan den räknar.",
    ],
  },
  {
    version: "0.28.0",
    date: "2026-10-28",
    summary: "Statistiken räknar arbetsordrar, uppgifter och ronder för sig, och företaget kan sätta egna mål.",
    items: [
      "Statistiken visar arbetsordrar, uppgifter och rondtillfällen var för sig.",
      "Företaget sätter egna mål under Arbetssätt › Mål.",
      "Ett rondtillfälle som inte blir gjort kan markeras Ej utfört, med en anledning.",
    ],
  },
  {
    version: "0.27.0",
    date: "2026-10-28",
    summary: "Nyckeltalen öppnar rätt lista, och Hem får nya valbara rutor.",
    items: [
      "Ett klick på ett nyckeltal i översikten öppnar listan med rätt filter, och siffran stämmer med listan.",
      "Hem i appen kan få rutorna Gör detta nu, Förfallet och Mina avvikelser.",
      "Administratören kan ge rätten Teamet utan att personen blir administratör.",
    ],
  },
  {
    version: "0.26.0",
    date: "2026-10-28",
    summary: "Driftronder kan planeras med klockslag i en tydligare kalender.",
    items: [
      "Schemat för en driftrond visas i klartext, med veckodagar som knappar och en kalender där ronderna är markerade.",
      "En rond kan få ett klockslag och en beräknad tid. Den syns i Planering och räknas in i den ansvariges belastning.",
    ],
  },
  {
    version: "0.25.0",
    date: "2026-10-27",
    summary: "Uppgifter kan påbörjas som utkast, och en arbetsorder kan samla en hel driftrond.",
    items: [
      "En uppgift kan sparas som utkast innan den har en arbetsorder.",
      "En arbetsorder kan avse en driftrond under en period. Varje rond som startas blir ett nytt tillfälle i samma arbetsorder.",
      "Före varje rondtillfälle görs en kort säkerhetsavstämning mot arbetsorderns riskbedömning.",
    ],
  },
  {
    version: "0.24.0",
    date: "2026-10-27",
    summary: "Arbetsordern samlar allt arbete, och det är enklare att hitta tillbaka.",
    items: [
      "Varje uppgift ligger i en arbetsorder, och kund och projekt följer med.",
      "Tid rapporteras på en arbetsorder eller ett projekt, med timer eller i efterhand.",
      "En arbetsorder med färdiga eller signerade protokoll kan inte tas bort, bara avslutas.",
      "Hemskärmen och flikraden på telefonen går att ordna genom att dra.",
    ],
  },
  {
    version: "0.23.0",
    date: "2026-10-26",
    summary: "Företagets admin väljer AI-profil, och chattens svar visas medan de skrivs.",
    items: [
      "Under Workflow AI väljer företagets admin vilken AI-profil företaget använder.",
      "Chattens svar visas medan de skrivs i stället för när hela svaret är klart.",
      "Nycklar som läggs in i Workflow lagras krypterade, och varje företags nycklar skyddas separat.",
    ],
  },
  {
    version: "0.22.0",
    date: "2026-10-24",
    summary: "Företaget får egna platser, och maskiner kan kopplas till objekt.",
    items: [
      "Företagets egna platser, till exempel verkstad, lager och fordon, läggs upp under Företag › Platser och väljs i arbetsordern.",
      "Maskiner kan kopplas till ett objekt, och ett larm kan gå till objektets ansvarige och vidare till ersättaren.",
      "Under Mina inställningar kan du anpassa menyn separat för telefon och dator.",
    ],
  },
  {
    version: "0.21.0",
    date: "2026-10-24",
    summary: "Workflow känns mer som en app, med sidor som laddar snabbare utan att hoppa.",
    items: [
      "Telefonen visar alltid appvyn, och Jobb samlar arbetsordrar och uppgifter i en lista.",
      "Riskbedömningen ställer en fråga i taget på telefonen, och jobbets huvudknapp visar nästa steg.",
      "QR-etiketter skrivs ut från driftronden, även från telefonen.",
      "Sidorna laddar snabbare på telefonen och hoppar inte när innehållet kommer.",
    ],
  },
  {
    version: "0.20.0",
    date: "2026-10-20",
    summary: "Maskinlarm når rätt personer direkt, och i papperskorgen kan du hantera flera poster samtidigt.",
    items: [
      "Larm från maskiner syns i klockan med knappen Jag tar den. Den som trycker först blir ansvarig för arbetsordern.",
      "I kundernas papperskorg kan du markera flera poster och återställa eller ta bort dem tillsammans.",
    ],
  },
  {
    version: "0.19.0",
    date: "2026-10-20",
    summary: "Ett maskinlarm kan bli en arbetsorder, Workflow ser när något avviker och företaget kan kräva att AI bara används inom EU.",
    items: [
      "För varje maskinkälla väljer du om ett larm ska bli en arbetsorder direkt, vänta på godkännande eller inte skapa något.",
      "Maskinsidan visar förslag när ett larm fladdrar, när larmen har blivit tätare än vanligt eller när maskinen har tystnat.",
      "Företaget kan kräva att uppgifter bara bearbetas inom EU.",
    ],
  },
  {
    version: "0.18.0",
    date: "2026-10-19",
    summary: "Maskiner kan skicka larm och diagnoser till Workflow.",
    items: [
      "Under Kopplingar finns Maskiner. Där skapar du en källa, får en nyckel och ser vad källan har skickat.",
      "En maskin, en gateway eller en enkortsdator som Raspberry Pi kan skicka larm, driftläge och färdiga diagnoser.",
    ],
  },
  {
    version: "0.17.0",
    date: "2026-10-19",
    summary: "Artikelsökningen är snabbare, och nyckelsidan visar vad som fungerar.",
    items: [
      "Bilder och produktinfo hämtas först när de behövs, så att sökningen går snabbare.",
      "Tjänster och nycklar visar om en nyckel inte är inlagd, är inlagd men inte kontrollerad eller fungerar.",
    ],
  },
  {
    version: "0.16.0",
    date: "2026-10-19",
    summary: "Artikelsökningen är enklare att hålla ordning på, och Tjänster och nycklar är ordnade i grupper.",
    items: [
      "I artikelsökningen visas små produktbilder när de finns. Klicka för en större bild.",
      "Lägg till artiklar säger vilket inköp, vilken offert eller vilken arbetsorder raderna hamnar i.",
    ],
  },
  {
    version: "0.15.0",
    date: "2026-10-19",
    summary: "Mer pålitligt, med tydligare besked och knapparna på samma plats.",
    items: [
      "Spara, Avbryt och Tillbaka ligger på samma plats uppe till höger på redigeringssidorna.",
      "Pausa tid och Utgår frågar om korta tider i stället för att kasta dem, och egen överlappande tid räknas inte dubbelt.",
      "Ett protokoll skapas inte förrän du har skrivit något.",
    ],
  },
  {
    version: "0.14.0",
    date: "2026-10-18",
    summary: "Prisfiler läses in mot grossistens katalog, och nyckelsidan är tydligare.",
    items: [
      "En prisfil kopplas till grossistens egna artiklar, och rader som inte finns i katalogen läses inte in.",
      "Import visar hur många artiklar som är kopplade och berättar när en rad hoppades över.",
      "Tjänster och nycklar har ett eget kort för varje nyckel.",
    ],
  },
  {
    version: "0.13.0",
    date: "2026-10-17",
    summary: "Artikelsökningen kan söka i Solars produktkatalog och förstår teknisk skrivning.",
    items: [
      "Artikelsökningen söker även i Solars produktkatalog. Priset kommer alltid från era egna prisfiler.",
      "Samma produkt hos flera grossister visas med en rad per grossist, och en grossists pris flyttas aldrig till en annan.",
      "Sökningen förstår teknisk skrivning: 3G2,5 och 3x2,5 ger samma träff, liksom 10 A och 10A.",
    ],
  },
  {
    version: "0.12.1",
    date: "2026-10-17",
    summary: "Tydligare text och bättre kontrast i mörkt tema.",
    items: [
      "Brödtexten är lite fetare, och i temat Dark är den grå hjälptexten och den röda texten ljusare.",
    ],
  },
  {
    version: "0.12.0",
    date: "2026-10-16",
    summary: "Ett lugnare och bredare utseende, artiklar som läggs till som i en varukorg samt favoriter och listor.",
    items: [
      "Sidorna använder hela bredden på stora skärmar, och det finns två teman: Light och Dark.",
      "Du lägger till artiklar på offert, inköp, arbetsorder och fakturaunderlag som i en varukorg.",
      "Artikelsökningen har favoriter och artikellistor, och en hel lista kan läggas till på en gång.",
    ],
  },
  {
    version: "0.11.3",
    date: "2026-10-16",
    summary: "Varor från Solars katalog hittas på helt E-nummer och EAN.",
    items: [
      "Namn, tillverkare, status och lagersaldo från Solar visas när du söker på ett helt E-nummer eller EAN.",
    ],
  },
  {
    version: "0.11.2",
    date: "2026-10-16",
    summary: "Solars katalog går att söka i utan prisfil.",
    items: [
      "Skriv ett helt E-nummer eller EAN, så hämtas varan från Solars katalog även utan prisfil.",
    ],
  },
  {
    version: "0.11.1",
    date: "2026-10-16",
    summary: "Kundsidan börjar med alla delar hopfällda.",
    items: [
      "På kundsidan är Kontaktuppgifter, Projekt, Uppgifter, Offerter och Anläggningar hopfällda från början.",
    ],
  },
  {
    version: "0.11.0",
    date: "2026-10-16",
    summary: "Inköp samlar artiklar från flera grossister till offert, material och beställning.",
    items: [
      "Ett inköp samlar artiklar från en eller flera grossister, som en varukorg, och Till grossist skapar beställningsfilen.",
      "Du kan lägga inköpet i en offert som rader eller som en summa. Kunden ser aldrig leverantör eller inköpspris.",
      "Lägg som material lägger inköpets rader på en arbetsorder.",
      "Artiklar söker i era prisfiler på namn, artikelnummer, E-nummer, RSK och EAN och visar alla grossisters priser.",
    ],
  },
  {
    version: "0.10.0",
    date: "2026-10-16",
    summary: "Enklare anläggningar, prisfiler med grundpris, nettopris och rabattbrev, och adressförslag medan du skriver.",
    items: [
      "Anläggningar visas med trädet till vänster och det du väljer till höger.",
      "Grundprislista, nettoprislista och rabattbrev hanteras var för sig per grossist, och gällande pris är nettopriset när det finns.",
      "Adresser från Lantmäteriet föreslås medan du skriver gatuadressen på en plats eller en kund, och kartnålen följer med.",
    ],
  },
  {
    version: "0.9.0",
    date: "2026-10-15",
    summary: "Rabattbreven räknar ut ert pris, samma vara hittas hos alla grossister och kundens platser bläddras som mappar.",
    items: [
      "Rabattbrev läses in och ger ert nettopris, med grundpriset överstruket.",
      "Samma vara hos olika grossister visas som en produkt med ett pris per grossist.",
      "Kundens anläggningar visas som mappar: alla adresser, en adress med sina objekt och ett objekt.",
    ],
  },
  {
    version: "0.8.0",
    date: "2026-10-14",
    summary: "Tydligare och snabbare prisfiler, och Avbryt frågar innan något kastas.",
    items: [
      "Import har en ruta per grossist som visar vad som är inläst och tar emot nästa fil.",
      "En prisfil läses in 4–6 gånger snabbare, och förhandsvisningen visar de största prisändringarna innan du importerar.",
      "Avbryt och telefonens Bakåt frågar Kasta ändringarna? när du har ändrat något.",
    ],
  },
  {
    version: "0.7.1",
    date: "2026-10-13",
    summary: "Små förbättringar efter 0.7.0.",
    items: [
      "Starta tid är avstängd på ett färdigställt jobb och förklarar varför när du trycker.",
      "Till grossist finns bland offertens knappar.",
    ],
  },
  {
    version: "0.7.0",
    date: "2026-10-12",
    summary: "Enklare mobil för arbete på plats, en ny kalkylator, prisfiler från grossisterna och export av material till grossistens varukorg.",
    items: [
      "Den enkla visningen i mobilen har samma mönster på alla sidor, och en kontroll går i några större steg.",
      "Ring kunden och Navigera till adressen finns på jobbet, kundkortet och platsen.",
      "Kalkylatorn räknar effekt, kortslutning, frånkopplingstid, spänningsfall och kabelarea, med företagets egna skyddsapparater.",
      "Till grossist kopierar eller exporterar materialet i den form grossisten vill ha.",
    ],
  },
  {
    version: "0.6.4",
    date: "2026-10-11",
    summary: "Kunden står fast på en skickad offert, och projektet visar sina siffror på en rad.",
    items: [
      "En skickad offert visar kunden som den var när den skickades, och kunden kan ladda ned offerten som PDF från sin länk.",
      "Projektet visar Budget, Offererat, Uppskattat, Bokat och Rapporterat på en rad.",
      "Ett protokoll minns vilket instrument som användes och visar om kalibreringen var försenad.",
    ],
  },
  {
    version: "0.6.3",
    date: "2026-10-10",
    summary: "Fakturaunderlag från det utförda arbetet, och avvikelser som hänger ihop med arbetsordern som åtgärdar dem.",
    items: [
      "Ett färdigställt jobb eller projekt får ett fakturaunderlag med rapporterad tid, material och utgifter.",
      "Underlaget exporteras som CSV eller SIE. Det som har kommit med i ett underlag kommer aldrig med igen.",
      "En avvikelse och arbetsordern som åtgärdar den länkar till varandra. När arbetsordern färdigställs blir avvikelsen Åtgärdad.",
    ],
  },
  {
    version: "0.6.2",
    date: "2026-10-10",
    summary: "Rättningar efter en genomgång av arbetsdagen på dator, surfplatta och telefon.",
    items: [
      "Ett protokoll sparas inte längre av sig självt när det öppnas.",
      "På mobilen är kryssrutorna hela rader, och större formulär är egna skärmar med Avbryt och Spara högst upp.",
      "Du kan ta foto direkt i Bilder och dokument på mobilen.",
    ],
  },
  {
    version: "0.6.1",
    date: "2026-10-10",
    summary: "Kundtyp på kunden, offerter på kundkortet, personalliggaren på plats och radering när ett företag slutar vara kund.",
    items: [
      "Kunden har Kundtyp, Företag eller Privatperson, som offerten hämtar. Kundkortet visar kundens offerter.",
      "Den som är incheckad på en byggarbetsplats kan visa dagens personalliggare vid Skatteverkets kontrollbesök.",
      "När ett företag slutar vara kund kan det exportera sina uppgifter i 30 dagar innan de raderas.",
    ],
  },
  {
    version: "0.6.0",
    date: "2026-10-10",
    summary: "Kunden svarar på offerten via en länk, och mobilen fungerar som en app.",
    items: [
      "Skicka till kund mejlar en länk till offerten. Kunden accepterar eller avböjer utan att logga in och ser aldrig inköpspris eller påslag.",
      "Den enkla visningen i mobilen är gjord för arbete ute, med egna skärmar för tid, jobb, projekt, offerter och kunder.",
      "Bakåt stänger en öppen ruta innan den går tillbaka en sida.",
    ],
  },
  {
    version: "0.5.0",
    date: "2026-10-09",
    summary: "Mobilen som en riktig app, tidplan för projektet, offert hela vägen till arbetsorder och en AI som kan föreslå arbete.",
    items: [
      "Den enkla visningen i mobilen ser ut som en app, och du väljer själv vilka rutor Hem visar.",
      "Tidplanen på projektet visar jobben som staplar på en tidslinje. Dra ett jobb för att flytta det.",
      "En offert kan göras av materialet och bli en arbetsorder när den accepteras, med moms och ROT för privatpersoner.",
      "Workflow AI kan föreslå arbetsorder, material, tid, planering och offert i chatten, alltid med Använd och Ångra.",
    ],
  },
  {
    version: "0.4.29",
    date: "2026-10-09",
    summary: "Offerter med priser på material, elektronisk personalliggare och inloggning med passkey.",
    items: [
      "Skapa en offert med rader för material, arbete och övrigt. En skickad offert är låst, och en ändring blir en ny version.",
      "Personalliggare: checka in och ut på byggarbetsplatsen med en knapp och visa en kontrollvy vid kontrollbesök.",
      "Logga in med passkey, till exempel Face ID, fingeravtryck eller Windows Hello.",
    ],
  },
  {
    version: "0.4.28",
    date: "2026-10-09",
    summary: "Krävd nivå i stället för riskklass, tydligare materialrader och lugnare rutor på mobilen.",
    items: [
      "Riskklass heter nu Krävd nivå och visar vilken nivå en person behöver för uppgiften.",
      "Projektsidan summerar materialet från projektets arbetsordrar under Material i projektet.",
      "På mobilen hoppar rutorna inte längre när tangentbordet öppnas.",
    ],
  },
  {
    version: "0.4.27",
    date: "2026-10-08",
    summary: "Tydligare arbetsflöde med steg och riskbedömning i varje jobb, tvåstegsinloggning och kompetenskort.",
    items: [
      "Varje jobb har tydliga steg, och knappen Varför kan jag inte gå vidare? visar exakt vad som saknas.",
      "Riskbedömning är ett steg i varje nytt jobb. Tiden startar och jobbet färdigställs först när steget är gjort.",
      "Tvåstegsinloggning med kod från en app i mobilen, reservkoder och en säkerhetslogg.",
      "Kompetenskortet har utbildningar, körkort och språk, med påminnelse innan något går ut.",
    ],
  },
  {
    version: "0.4.26",
    date: "2026-10-08",
    summary: "Smidigare sökning och dialoger på mobilen.",
    items: [
      "På mobilen öppnar Sök i bottenmenyn den globala sökningen, och dialogerna ligger kvar ovanför tangentbordet.",
    ],
  },
  {
    version: "0.4.25",
    date: "2026-10-08",
    summary: "Enklare platser med adressförslag och bilkostnad på arbetsordern.",
    items: [
      "Adressen har egna fält för gatuadress, husnummer, postnummer och postort, och den föreslås när du sätter kartnålen.",
      "Arbetsordern har Material och utgifter, och knappen Bilkostnad räknar sträckan till uppdragets plats.",
    ],
  },
  {
    version: "0.4.24",
    date: "2026-10-07",
    summary: "Egenkontrollprogrammet visas som en sida, och redigeringen öppnas när du väljer det.",
    items: [
      "Egenkontroll öppnar programmet som en sida att läsa. Administratören trycker Redigera programmet för att ändra.",
    ],
  },
  {
    version: "0.4.23",
    date: "2026-10-07",
    summary: "Platser på kartan och en lugnare verktygsrad i redigerarna.",
    items: [
      "Platsens karta öppnas direkt när platsen har en position. Du sätter kartnålen med ett tryck och drar den till rätt ställe.",
      "Verktygsraden i Skapa formulär och egenkontrollprogrammet har samma knappar i samma ordning.",
      "Mina inställningar sparar varje val direkt.",
    ],
  },
  {
    version: "0.4.22",
    date: "2026-10-07",
    summary: "Rättningar efter ett helhetsprov av kundens vardag.",
    items: [
      "Med organisationsnumret hämtas företagets namn och adress, i Ställ in Workflow och i Företagsuppgifter.",
      "En rond som har startats i förväg visas som påbörjad med Fortsätt rond tills protokollet är färdigställt.",
    ],
  },
  {
    version: "0.4.21",
    date: "2026-10-07",
    summary: "Tydligare och kortare texter i hela Workflow.",
    items: [
      "Texterna i Workflow är genomgångna, språkfel är rättade och långa förklaringar kortare.",
    ],
  },
  {
    version: "0.4.20",
    date: "2026-10-07",
    summary: "Räkneverktyg, rapportarkiv, notiser per e-post och push samt nivåer för uppgifter.",
    items: [
      "Räkneverktyg för ström och effekt, spänningsfall, kortslutningsström, kabelarea och energikostnad. Gränserna anger företaget själv.",
      "I Rapportarkivet sparar du en PDF- eller Excel-rapport när du exporterar den och kan hämta den igen senare.",
      "Påminnelserna i klockan kan också skickas som e-post eller push. Du väljer själv under Mina inställningar › Notiser.",
      "Varje roll i egenkontrollprogrammet har en nivå, och ingen kan tilldelas, starta eller signera en uppgift över sin nivå.",
    ],
  },
  {
    version: "0.4.19",
    date: "2026-10-07",
    summary: "Arbetsordrar för underhållsarbete, återkommande kontroller i planeringen och företagets egna gränsvärden.",
    items: [
      "Arbetsordern har ett underhållsblock och Prioritet, och akuta öppna ordrar visas överst.",
      "Från en avvikelse i en kontroll skapar du en arbetsorder direkt.",
      "Företaget anger sina egna gränsvärden, och protokollen fyller i dem som förval på mätraderna.",
      "Under Hjälp ser du vad som är nytt i varje version.",
    ],
  },
];

/** The short lines the public start page shows for a version: its own highlights, otherwise its first points; at most three. */
export const releaseHighlights = (note: ReleaseNote, max = 3) => (note.highlights?.length ? note.highlights : note.items).slice(0, max);

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
