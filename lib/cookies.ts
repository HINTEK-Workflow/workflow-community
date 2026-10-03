// Kakor och lagring i webbläsaren (2026-10-03; granskad mot lagen om elektronisk kommunikation 9 kap. 28 §):
// every cookie and every kind of browser storage Workflow uses, by its real name, with content, purpose and lifetime.
// Each one is needed for something the person does or asks for themselves – signing in, keeping work in progress,
// remembering a choice they made – so no consent is asked, but they are told. Anything for statistics, marketing or
// another site must never be added without a consent step that blocks it first and can be refused and withdrawn as
// easily as accepted. tests/cookie-notice.browser.cjs checks that no cookie outside this list is set.
export const COOKIE_NOTICE_VERSION = "2026-10-03b";
export const COOKIE_NOTICE_STORAGE_KEY = "wf-cookie-notice";
/** Opens the details from anywhere (the menu's round cookie button, the login page's ?kakor=1). */
export const COOKIE_DETAILS_EVENT = "wf:cookie-details";

export type CookieEntry = { name: string; kind: "Kaka" | "Lokal lagring" | "Sessionslagring" | "Webbläsardatabas" | "Cache"; content: string; purpose: string; lifetime: string };
export type CookieGroup = { title: string; description: string; entries: CookieEntry[] };

export const COOKIE_GROUPS: CookieGroup[] = [
  {
    title: "Inloggning och säkerhet",
    description: "Behövs för att du ska kunna logga in och för att skydda kontot.",
    entries: [
      { name: "next-auth.session-token (över https: __Secure-next-auth.session-token)", kind: "Kaka", content: "Krypterad inloggning: vem du är och när inloggningen gjordes. Kan inte läsas av sidans skript.", purpose: "Håller dig inloggad mellan sidorna.", lifetime: "Tills du loggar ut, högst den inloggningstid installationen har valt (8 timmar om inget annat är inställt)" },
      { name: "next-auth.csrf-token (över https: __Host-next-auth.csrf-token)", kind: "Kaka", content: "Ett slumpat värde.", purpose: "Skyddar inloggningen mot förfalskade anrop från andra webbplatser.", lifetime: "Tills webbläsaren stängs" },
      { name: "next-auth.callback-url (över https: __Secure-next-auth.callback-url)", kind: "Kaka", content: "Adressen du ska tillbaka till.", purpose: "Skickar dig till rätt sida efter inloggningen.", lifetime: "Tills webbläsaren stängs" },
    ],
  },
  {
    title: "Inloggning med Google",
    description: "Sätts bara när du själv väljer att logga in med Google, skapar konto med Google eller kopplar ett Google-konto.",
    entries: [
      { name: "next-auth.state och next-auth.pkce.code_verifier (över https med prefixet __Secure-)", kind: "Kaka", content: "Slumpade engångsvärden.", purpose: "Kontrollerar att svaret från Google hör till just din inloggning.", lifetime: "Högst 15 minuter" },
      { name: "wf-register", kind: "Kaka", content: "Signerade uppgifter från Skapa konto: företag och godkända villkor.", purpose: "Bär uppgifterna genom inloggningen med Google när du skapar konto.", lifetime: "Högst 15 minuter" },
      { name: "wf-google-link", kind: "Kaka", content: "Signerad uppgift om vilket konto Google-kontot ska kopplas till.", purpose: "Kopplar ett Google-konto till ditt konto när du har bett om det.", lifetime: "Högst 10 minuter" },
    ],
  },
  {
    title: "Arbete du har påbörjat",
    description: "Skyddar det du skriver mot avbrott, så att inget går förlorat om sidan stängs eller nätet försvinner.",
    entries: [
      { name: "kfid.v3.draft.<e-post>.<företag>", kind: "Lokal lagring", content: "Utkastet till den kontroll du arbetar med.", purpose: "Autosparning och arbete offline, om autosparning är påslagen under Mina inställningar.", lifetime: "Skrivs över vid varje ändring; tas bort när du börjar på en ny kontroll eller hämtar serverversionen" },
      { name: "kfid.offline.owner", kind: "Lokal lagring", content: "Din e-post, ditt namn och företagets id.", purpose: "Låter offlineformuläret veta vems utkast det är.", lifetime: "Tills du loggar ut" },
      { name: "hintek-form-editor-recovery-v1", kind: "Lokal lagring", content: "En kopia av formuläret du bygger under Skapa formulär.", purpose: "Återställer formuläret om fliken stängs innan det är sparat.", lifetime: "Tills formuläret är sparat eller kopian kastas" },
      { name: "kfid.lock.<e-post>.<företag>", kind: "Sessionslagring", content: "Ett slumpat id för fliken.", purpose: "Förhindrar att två flikar skriver över varandras ändringar i samma kontroll.", lifetime: "Tills fliken stängs" },
      { name: "Väntande import (två poster)", kind: "Sessionslagring", content: "En kontroll eller ett formulär som Import lämnar över till redigeraren.", purpose: "För över filen du valde under Import till rätt sida.", lifetime: "Tills den har öppnats eller fliken stängs" },
      { name: "hwf-adjust-time-entry", kind: "Sessionslagring", content: "Id för den tidrad du valde att justera.", purpose: "Öppnar rätt tidrad i Tidrapport efter en stoppad timer.", lifetime: "Tills den har öppnats eller fliken stängs" },
    ],
  },
  {
    title: "Dina val",
    description: "Kommer ihåg sådant du själv har valt eller stängt, så att du slipper göra om det.",
    entries: [
      { name: "workflow.tour.formBuilder", kind: "Lokal lagring", content: "Värdet \"seen\".", purpose: "Visar inte rundturen i Skapa formulär igen när du har stängt den.", lifetime: "Tills du rensar webbläsarens data" },
      { name: "hwf-advisor och hwf-advisor-dismissed", kind: "Lokal lagring", content: "Hur ofta tips ska visas och vilka tips du har stängt.", purpose: "Följer ditt val för tips och visar inte ett stängt tips igen på en stund.", lifetime: "Valet tills du ändrar det; ett stängt tips i 12 timmar" },
      { name: "kfid.records.<del>.<typ>", kind: "Lokal lagring", content: "Sökning, filter och sortering i arkivet.", purpose: "Arkivet öppnas med de filter du senast valde.", lifetime: "Tills du rensar webbläsarens data" },
      { name: COOKIE_NOTICE_STORAGE_KEY, kind: "Lokal lagring", content: "Datum för den här informationen.", purpose: "Visar informationsrutan bara en gång.", lifetime: "Tills du rensar webbläsarens data" },
    ],
  },
  {
    title: "Offline och lokala arbetsytor",
    description: "Används när du arbetar utan nät eller med en lokal arbetsyta i den här webbläsaren.",
    entries: [
      { name: "kfid-offline-v2", kind: "Cache", content: "Offlineformuläret, dess stilmall och typsnitt – inga personuppgifter.", purpose: "Gör att formuläret för offlinearbete öppnas utan nät.", lifetime: "Tills en ny version ersätter den" },
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
    ],
  },
];

/** Every entry, for the count shown and for tests. */
export const COOKIES = COOKIE_GROUPS.flatMap((group) => group.entries);
