// Kakor (2026-10-03, EU:s regler om kakor och GDPR): every cookie and every kind of browser storage Workflow
// uses, with purpose and lifetime. All of them are strictly necessary for a service the person asked for (signing in,
// security, the person's own settings), so no consent is asked – but they are told. A cookie for statistics or
// marketing must never be added without a consent step; the list is shown on /cookies and checked by a test.
export const COOKIE_NOTICE_VERSION = "2026-10-03";
export const COOKIE_NOTICE_STORAGE_KEY = "wf-cookie-notice";

export type CookieEntry = { name: string; kind: "Kaka" | "Lokal lagring"; purpose: string; lifetime: string };

export const COOKIES: CookieEntry[] = [
  { name: "next-auth.session-token (med prefixet __Secure- över https)", kind: "Kaka", purpose: "Håller dig inloggad. Krypterad, kan inte läsas av sidans skript.", lifetime: "Tills du loggar ut, högst den inloggningstid installationen har valt" },
  { name: "next-auth.csrf-token (med prefixet __Host- över https)", kind: "Kaka", purpose: "Skyddar inloggningen mot förfalskade anrop från andra webbplatser.", lifetime: "Webbläsarsessionen" },
  { name: "next-auth.callback-url (med prefixet __Secure- över https)", kind: "Kaka", purpose: "Kommer ihåg vilken sida du ska tillbaka till efter inloggningen.", lifetime: "Webbläsarsessionen" },
  { name: "wf-register", kind: "Kaka", purpose: "Bär uppgifterna från Skapa konto genom inloggningen med Google.", lifetime: "Högst 15 minuter" },
  { name: "wf-google-link", kind: "Kaka", purpose: "Kopplar ett Google-konto till ditt konto när du själv har bett om det.", lifetime: "Högst 10 minuter" },
  { name: "hwf_demo", kind: "Kaka", purpose: "Visar den påhittade demon i stället för arbetsytan.", lifetime: "Webbläsarsessionen" },
  { name: "wf_view_as", kind: "Kaka", purpose: "Bara för installationens superadmin: visar appen som en annan roll.", lifetime: "Högst 8 timmar" },
  { name: "Inställningar, utkast och visade guider", kind: "Lokal lagring", purpose: "Sparar i din webbläsare sådant du själv har valt: tema, stängda guider, osparade utkast och pågående import.", lifetime: "Tills du rensar webbläsarens data" },
  { name: `${COOKIE_NOTICE_STORAGE_KEY}`, kind: "Lokal lagring", purpose: "Kommer ihåg att du har läst den här informationen.", lifetime: "Tills du rensar webbläsarens data" },
];
