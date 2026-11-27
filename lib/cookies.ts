// Kakor och lagring i webbläsaren (2026-10-03; granskad mot lagen om elektronisk kommunikation 9 kap. 28 §):
// every cookie and every kind of browser storage Workflow uses, by its real name, with content, purpose and lifetime.
// Each one is needed for something the person does or asks for themselves – signing in, keeping work in progress,
// remembering a choice they made – so no consent is asked, but they are told. Anything for statistics, marketing or
// another site must never be added without a consent step that blocks it first and can be refused and withdrawn as
// easily as accepted. tests/cookie-notice.browser.cjs checks that no cookie outside this list is set.
// Since 2026-10-07 (Beteendeanalys) the group "Statistik" exists where the installation measures its public pages: it is
// optional, set only after the visitor chose "Tillåt statistik" in a box that blocks until answered, and withdrawn with
// "Bara nödvändiga" at any time (the round cookie button). lib/analytics/consent.ts holds the rules.
export const COOKIE_NOTICE_VERSION = "2026-10-04";
export const COOKIE_NOTICE_STORAGE_KEY = "wf-cookie-notice";
/** Opens the details from anywhere (the menu's round cookie button, the login page's ?kakor=1). */
export const COOKIE_DETAILS_EVENT = "wf:cookie-details";
/** The app's bar along the bottom edge on a phone or tablet (the tab bar or the bottom bar); the cookie card keeps clear of it. */
export const BOTTOM_BAR_SELECTOR = ".workspace-bottom-nav";
/** The space between the bar and the card. */
export const COOKIE_NOTICE_BAR_GAP_PX = 12;
/**
 * Where the cookie card stands on a page with the app's bottom bar (2026-11-22: at 390 px the card covered the demo's tab bar):
 * just above the bar's measured height, which already holds the safe area. No bar (a computer, a public page) or a hidden one
 * (height 0): null, and the card keeps its place from app/globals.css (.cookie-notice).
 */
export function cookieNoticeBottom(barHeight: number): string | null {
  return Number.isFinite(barHeight) && barHeight > 0 ? `${Math.ceil(barHeight) + COOKIE_NOTICE_BAR_GAP_PX}px` : null;
}

export type CookieEntry = { name: string; kind: "Kaka" | "Lokal lagring" | "Sessionslagring" | "Webbläsardatabas" | "Cache"; content: string; purpose: string; lifetime: string;
  /** Used only where the installation measures its public pages (the choice between "Bara nödvändiga" and "Tillåt statistik"). */
  requires?: "statistics" };
/** `optional: "statistics"`: not set unless the visitor allowed statistics; shown only where the installation measures. */
export type CookieGroup = { title: string; description: string; entries: CookieEntry[]; optional?: "statistics" };

export const COOKIE_GROUPS: CookieGroup[] = [
  {
    title: "Inloggning och säkerhet",
    description: "Behövs för att du ska kunna logga in och för att skydda kontot.",
    entries: [
      { name: "next-auth.session-token (över https: __Secure-next-auth.session-token)", kind: "Kaka", content: "Krypterad inloggning: vem du är och när inloggningen gjordes. Kan inte läsas av sidans skript.", purpose: "Håller dig inloggad mellan sidorna.", lifetime: "Tills du loggar ut, högst den inloggningstid installationen har valt (8 timmar om inget annat är inställt)" },
      { name: "next-auth.csrf-token (över https: __Host-next-auth.csrf-token)", kind: "Kaka", content: "Ett slumpat värde.", purpose: "Skyddar inloggningen mot förfalskade anrop från andra webbplatser.", lifetime: "Tills webbläsaren stängs" },
      { name: "next-auth.callback-url (över https: __Secure-next-auth.callback-url)", kind: "Kaka", content: "Adressen du ska tillbaka till.", purpose: "Skickar dig till rätt sida efter inloggningen.", lifetime: "Tills webbläsaren stängs" },
      { name: "wf-passkey", kind: "Kaka", content: "Ett slumpat id för den passkey-inloggning eller bekräftelse du just har startat. Kan inte läsas av sidans skript.", purpose: "Kontrollerar att svaret från din passkey hör till just den här inloggningen.", lifetime: "Högst 5 minuter" },
      { name: "wf_operator och wf_operator_device", kind: "Kaka", content: "Slumpade värden. Servern sparar bara deras kontrollsumma. Kan inte läsas av sidans skript.", purpose: "Håller en operatör inloggad på operatörssidan, på just den enheten.", lifetime: "Inloggningen högst 24 timmar, enheten högst 400 dagar" },
      { name: "wf_operator_ms", kind: "Kaka", content: "Engångsvärden för en påbörjad inloggning. Kan inte läsas av sidans skript.", purpose: "Kontrollerar att svaret från Microsoft hör till just operatörens inloggning.", lifetime: "Några minuter, tills inloggningen är klar" },
    ],
  },
  {
    title: "Inloggning med Google eller Microsoft",
    description: "Sätts bara när du själv väljer att logga in med Google eller Microsoft, skapar konto med Google eller kopplar ett Google- eller Microsoft-konto.",
    entries: [
      { name: "next-auth.state och next-auth.pkce.code_verifier (över https med prefixet __Secure-)", kind: "Kaka", content: "Slumpade engångsvärden.", purpose: "Kontrollerar att svaret från Google hör till just din inloggning.", lifetime: "Högst 15 minuter" },
      { name: "wf-register", kind: "Kaka", content: "Signerade uppgifter från Skapa konto: företag och godkända villkor.", purpose: "Bär uppgifterna genom inloggningen med Google när du skapar konto.", lifetime: "Högst 15 minuter" },
      { name: "wf-google-link", kind: "Kaka", content: "Signerad uppgift om vilket konto Google-kontot ska kopplas till.", purpose: "Kopplar ett Google-konto till ditt konto när du har bett om det.", lifetime: "Högst 10 minuter" },
      { name: "wf-microsoft-link", kind: "Kaka", content: "Signerad uppgift om vilket konto Microsoft-kontot ska kopplas till.", purpose: "Kopplar ett Microsoft-konto till ditt konto när du har bett om det.", lifetime: "Högst 10 minuter" },
    ],
  },
  {
    title: "Arbete du har påbörjat",
    description: "Skyddar det du skriver mot avbrott, så att inget går förlorat om sidan stängs eller nätet försvinner.",
    entries: [
      { name: "workflow.task-draft.<person>.<uppgift>", kind: "Lokal lagring", content: "Det du har ändrat i en uppgift (arbetsorder, riskbedömning, protokoll) men som inte har nått servern än.", purpose: "Räddar ändringarna om nätet försvinner eller fliken stängs; sparas automatiskt när du öppnar uppgiften igen. Finns kvar efter utloggning.", lifetime: "Tas bort när ändringarna är sparade, annars efter 30 dagar" },
      { name: "hintek-form-editor-recovery-v1", kind: "Lokal lagring", content: "En kopia av formuläret du bygger under Skapa formulär.", purpose: "Återställer formuläret om fliken stängs innan det är sparat.", lifetime: "Tills formuläret är sparat eller kopian kastas" },
      { name: "Väntande import", kind: "Sessionslagring", content: "Ett formulär som Import lämnar över till formulärbyggaren.", purpose: "För över filen du valde under Import till rätt sida.", lifetime: "Tills den har öppnats eller fliken stängs" },
      { name: "workflow.return-draft:<adress>:<namn>", kind: "Sessionslagring", content: "Det du har fyllt i men inte sparat i ett formulär.", purpose: "Behåller värdena när du går till en annan sida och tillbaka.", lifetime: "Tills de har lästs igen eller fliken stängs" },
      { name: "hwf-adjust-time-entry", kind: "Sessionslagring", content: "Id för den tidrad du valde att justera.", purpose: "Öppnar rätt tidrad i Tidrapport efter en stoppad timer.", lifetime: "Tills den har öppnats eller fliken stängs" },
    ],
  },
  {
    title: "Dina val",
    description: "Kommer ihåg sådant du själv har valt eller stängt, så att du slipper göra om det.",
    entries: [
      { name: "workflow.tour.formBuilder", kind: "Lokal lagring", content: "Värdet \"seen\".", purpose: "Visar inte rundturen i Skapa formulär igen när du har stängt den.", lifetime: "Tills du rensar webbläsarens data" },
      { name: "hwf-advisor och hwf-advisor-dismissed", kind: "Lokal lagring", content: "Hur ofta tips ska visas och vilka tips du har stängt.", purpose: "Följer ditt val för tips och visar inte ett stängt tips igen på en stund.", lifetime: "Valet tills du ändrar det; ett stängt tips i 12 timmar" },
      { name: "workflow.search.recent.<person>", kind: "Lokal lagring", content: "Dina senaste sökningar och rubrik och adress för de träffar du har öppnat från Sök.", purpose: "Visar dem när sökrutan är tom, så att du snabbt hittar tillbaka.", lifetime: "Högst åtta av varje; tills du loggar ut, trycker Rensa senaste eller rensar webbläsarens data" },
      { name: "hintek.list.<lista>.<person>, hintek.work-list.<lista>.<person>, hintek.show-more och hintek.work-view-seen.<person>", kind: "Lokal lagring", content: "Hur du vill se listor och menyn och när du senast såg en arbetsvy.", purpose: "Listor och menyn ser ut som du valt nästa gång.", lifetime: "Tills du ändrar valet eller rensar webbläsarens data" },
      { name: "hintek:planning-project:<person>, wf.wholesaler, hintek-workflow:car-cost-price, wf-quickpick-declined:<källa>:<id> och wfmap-dir", kind: "Lokal lagring", content: "Dina senaste val: projekt i planeringen, grossist, bilkostnad, ett nekat förslag och sidkartans riktning.", purpose: "Du slipper välja samma sak igen.", lifetime: "Tills du ändrar valet eller rensar webbläsarens data" },
      { name: "workflow.calculator.three-phase och workflow-plc-simulator-*", kind: "Lokal lagring", content: "Värden och inställningar i kalkylatorn och PLC-simulatorn.", purpose: "Kalkylatorn och simulatorn öppnas som du lämnade dem.", lifetime: "Tills du rensar webbläsarens data" },
      { name: "workflow.history.v1, workflow.sheet.v1, workflow.entry.<id>.<namn> och hwf-assigned-told", kind: "Sessionslagring", content: "Var du har varit i fliken, sökning och filter per sida och vilka tilldelningar du redan fått besked om.", purpose: "Tillbaka tar dig rätt och samma besked visas inte två gånger.", lifetime: "Tills fliken stängs" },
      { name: "kfid.records.<del>.customers", kind: "Sessionslagring", content: "Sökning, filter och sortering i kundregistret.", purpose: "Kundregistret behåller dina filter medan du går mellan sidorna.", lifetime: "Tills fliken stängs" },
      { name: COOKIE_NOTICE_STORAGE_KEY, kind: "Lokal lagring", content: "Datum för den här informationen.", purpose: "Visar informationsrutan bara en gång.", lifetime: "Tills du rensar webbläsarens data" },
      { name: "wf-consent", kind: "Kaka", content: "Ditt svar i kakrutan (bara nödvändiga eller även statistik) och datumet för rutans version.", purpose: "Kommer ihåg ditt val, så att vi inte frågar igen och så att inget statistikrelaterat sätts mot ditt val.", lifetime: "12 månader eller tills rutan ändras", requires: "statistics" },
    ],
  },
  {
    title: "Statistik (valfri)",
    description: "Sätts bara om du väljer Tillåt statistik. Hjälper oss se var besökare på de publika sidorna går vidare eller slutar. Ändra eller ta tillbaka valet när som helst.",
    optional: "statistics",
    entries: [
      { name: "wf-stat", kind: "Kaka", content: "Vilka steg i besöket som har räknats (landningssida, priser, skapa konto, kassa) och dagen då besöket började. Inget id, ingen identitet – två besökare i samma läge har exakt samma värde.", purpose: "Räkna hur många besök som tar sig från ett steg till nästa, en gång per steg, så att sidorna kan förbättras. Summorna sparas utan koppling till dig.", lifetime: "30 dagar, eller tills du väljer Bara nödvändiga" },
    ],
  },
  {
    title: "Offline och lokala arbetsytor",
    description: "Används när du arbetar utan nät eller med en lokal arbetsyta i den här webbläsaren.",
    entries: [
      { name: "kfid-offline-v3", kind: "Cache", content: "Sidan som visas utan nät, dess stilmall och typsnitt – inga personuppgifter.", purpose: "Visar att nätet saknas i stället för webbläsarens felsida.", lifetime: "Tills en ny version ersätter den" },
      { name: "kfid-local-workspaces", kind: "Webbläsardatabas", content: "Behörighet till den mapp du valde och en återställningskopia av den lokala arbetsytan.", purpose: "Öppnar din lokala arbetsyta igen och räddar osparade ändringar.", lifetime: "Tills du tar bort arbetsytan eller rensar webbläsarens data" },
    ],
  },
  {
    title: "Demo och administration",
    description: "Används bara i demon och av installationens superadmin.",
    entries: [
      { name: "hwf_demo", kind: "Kaka", content: "Värdet \"1\".", purpose: "Visar den påhittade demon i stället för arbetsytan.", lifetime: "Tills webbläsaren stängs" },
      { name: "workflow.demo.tour-closed", kind: "Sessionslagring", content: "Att rundturen i demon är stängd.", purpose: "Visar inte demons rundtur igen i samma flik.", lifetime: "Tills fliken stängs" },
      { name: "wf_view_as", kind: "Kaka", content: "Vald roll.", purpose: "Bara för superadmin: Visa som en annan roll.", lifetime: "Högst 8 timmar" },
      { name: "wf-no-stats", kind: "Kaka", content: "Värdet \"1\".", purpose: "Bara för superadmin, när den själv väljer det under Beteendeanalys: besök från den här webbläsaren räknas inte i statistiken.", lifetime: "400 dagar, eller tills valet slås av" },
    ],
  },
];

/** The groups and entries this installation uses: the statistics choice and its cookies only where the public pages are measured. */
export function visibleCookieGroups(statistics: boolean): CookieGroup[] {
  return COOKIE_GROUPS.filter((group) => statistics || group.optional !== "statistics")
    .map((group) => ({ ...group, entries: group.entries.filter((entry) => statistics || entry.requires !== "statistics") }));
}

/** Every entry, for the count shown and for tests. */
export const COOKIES = COOKIE_GROUPS.flatMap((group) => group.entries);
