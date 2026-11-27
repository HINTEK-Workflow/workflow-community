import type { GuideStep } from "@/lib/help/guide-steps";

/**
 * Din egen AI-app (2026-11-27, steg 1 i "kundens egen AI"): how a company connects its own AI app – ChatGPT, Claude, Copilot or
 * another – to Workflow over MCP. Plain data in our own words (no text or pictures from the providers' documentation), shown under
 * Hjälp (features/ai/own-ai-help.tsx) and searched by the help search (lib/help/search-help.ts), so the page and Workflow AI read the
 * same words. The app's AI runs at the company's own provider and is paid there; Workflow AI and credits are not used.
 */
export const OWN_AI_GUIDE_KEY = "egen-ai";

export const OWN_AI_INTRO = "Företaget kan låta sin egen AI-app, till exempel ChatGPT, Claude eller Copilot, arbeta med Workflow via MCP. AI:n körs då hos er leverantör och ni betalar den där. Workflow AI används inte och inga krediter dras.";

export const OWN_AI_STEPS: GuideStep[] = [
  { name: "1. Slå på Tillåt egna AI-appar", what: "Företagets admin går till Inställningar → Kopplingar → API och MCP och slår på Tillåt egna AI-appar (MCP).",
    result: "Workflows MCP-server svarar för företaget. Är brytaren av fungerar inga MCP-nycklar och inga anslutna appar." },
  { name: "2. Anslut appen", what: "Lägg till Workflows MCP-adress i AI-appen. Adressen står under Anslut på sidan API och MCP och slutar på /api/mcp.",
    choices: "Logga in i Workflow när appen frågar (OAuth), eller klistra in en MCP-nyckel om appen ber om en nyckel. Nyckeln skapar admin med Ny MCP-nyckel på samma sida.",
    result: "Appen står under Anslutna appar, eller nyckeln i listan över MCP-nycklar, med vem den gäller för och när den användes senast." },
  { name: "3. Välj behörigheter", what: "Läsa ingår alltid. Bocka bara i Skapa och ändra, Skapa utkast till fakturaunderlag eller Ta bort och arkivera om appen behöver det.",
    result: "Appen gör aldrig mer än personen själv får göra i Workflow. Slutföra, signera och radera för gott går aldrig via MCP." },
  { name: "4. Koppla från", what: "Var och en kopplar från sina egna appar under Mina inställningar → Anslutna appar. Admin kopplar från alla och återkallar nycklar under API och MCP.",
    result: "Appen eller nyckeln slutar fungera direkt. Allt loggas i företagets historik." },
];

/** OAuth or an MCP key: which way fits which use. */
export const OWN_AI_WAYS: { title: string; text: string }[] = [
  { title: "Logga in (OAuth) – för vanlig chatt", text: "Personen loggar in i Workflow från appen och godkänner. Appen arbetar sedan som personen, med personens behörigheter. Används appen inte på 30 dagar behöver personen logga in igen." },
  { title: "MCP-nyckel – för schemalagda körningar", text: "En MCP-nyckel passar när er egen AI-tjänst ska köra något på schema utan att någon är inloggad. Nyckeln gäller för en vald person och bara inom de behörigheter som bockas i för nyckeln. Välj hur länge den ska gälla, och återkalla den när den inte behövs." },
];

/** Short notes per app, in our own words; the provider decides where its setting is and who may use it. */
export const OWN_AI_APPS: { name: string; text: string }[] = [
  { name: "ChatGPT", text: "Lägg till Workflow som en egen koppling till en MCP-server, med MCP-adressen, och välj inloggning med OAuth. Vilka konton som får lägga till egna kopplingar bestämmer OpenAI, och i ett företagskonto kan er administratör behöva tillåta det först." },
  { name: "Claude", text: "Lägg till Workflow som en egen koppling (en fjärransluten MCP-server) med MCP-adressen. Claude loggar in med OAuth. I ett team- eller företagskonto kan en administratör behöva lägga till kopplingen först." },
  { name: "Copilot", text: "I de Copilot-verktyg från Microsoft som tar emot en MCP-server, till exempel för egna agenter, läggs Workflow till med samma adress. Välj OAuth om verktyget loggar in, annars en MCP-nyckel. Vem som får lägga till kopplingar bestäms i er Microsoft-miljö." },
  { name: "Andra appar", text: "En app som kan använda en MCP-server över HTTP fungerar på samma sätt: MCP-adressen och antingen inloggning eller en MCP-nyckel." },
];

/** What the company should know before it connects. */
export const OWN_AI_NOTE = "Det appen hämtar lämnar Workflow och behandlas hos AI-tjänsten under ert eget avtal, kanske utanför EU. Tjänsten ser riktiga namn och värden, så långt personen själv får se dem. Var inställningen för egna kopplingar finns i appen kan ändras hos leverantören: leta efter kopplingar, appar eller MCP i appens inställningar.";
