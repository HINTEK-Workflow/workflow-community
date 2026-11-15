import { FORTNOX_CONNECTION_READY } from "@/lib/quotes/accounting";
import type { CentralField } from "@/lib/secrets/central-fields";
import type { ExternalProvider } from "@/lib/integrations/key-catalog";

/**
 * Externa tjänster (2026-10-25): every program and service outside Workflow that the code talks to, or that talks
 * to Workflow, for the site map (scripts/sitemap/generate.cjs, the part "Externa tjänster"). Names, purposes, the key's
 * kind and owner and where it is administered – never a value, never a hint of a value.
 *
 * tests/external-services.test.ts keeps the list true: every outside host in tests/local-sources.test.ts and every central
 * key (lib/secrets/central-fields.ts) must have an entry, every host here must be one the code names, every module must
 * exist. The commercial part adds its own entries in ee/integrations/external-services.ts (read only when ee/ is there).
 *
 * Pure: no database, no environment.
 */

/** out: Workflow calls the service. in: the service (or a client) calls Workflow. both: both ways. */
export type ServiceDirection = "out" | "in" | "both";
/** Whose key: the installation's central key, the company's own key, a key Workflow issues, or none. */
export type KeyOwner = "central" | "company" | "issued" | "none";
export type ServiceGroup = "ai" | "login" | "payment" | "wholesale" | "lookup" | "messages" | "accounting" | "clients" | "keys";

/** A place in the app: an address (/?view=…, a public path such as /login) or the AI panel ("panel:ai"). */
export type ServicePlace = { label: string; at: string };

export type ExternalService = {
  id: string;
  name: string;
  group: ServiceGroup;
  /** One short line: what Workflow uses it for. */
  purpose: string;
  direction: ServiceDirection;
  key: {
    owner: KeyOwner;
    /** What the key is, in words (never a value). */
    label: string;
    /** The central keys it uses (lib/secrets/central-fields.ts). */
    central?: readonly CentralField[];
    /** The company's own key (IntegrationKey, its provider). */
    company?: ExternalProvider;
  };
  /** Where the key and the settings are administered. */
  admin: readonly ServicePlace[];
  /** Where in the app it is used, as far as the code shows it. */
  usedBy?: readonly ServicePlace[];
  /** Workflow's own addresses the service or the client calls. */
  incoming?: readonly string[];
  /** The outside hosts the code names. */
  hosts?: readonly string[];
  /** Host endings for an address the owner saves. */
  hostEndings?: readonly string[];
  /** How the outside address is reached when the code names no host. */
  via?: string;
  /** The server modules that talk to it (files, or folders ending in /). */
  modules: readonly string[];
  /** Only in an installation where this path exists (the commercial part). */
  onlyWith?: string;
};

export const SERVICE_GROUPS: Record<ServiceGroup, string> = {
  ai: "AI",
  login: "Inloggning",
  payment: "Betalning",
  wholesale: "Grossister",
  lookup: "Uppslag och kartor",
  messages: "E-post och notiser",
  accounting: "Bokföring",
  clients: "Kopplingar in till Workflow",
  keys: "Nyckelförvaring",
};

/** The legend for whose key it is; `type` is the --type-* colour the box is drawn in. */
export const KEY_OWNERS: Record<KeyOwner, { label: string; note: string; type: string }> = {
  central: { label: "Central nyckel", note: "Installationens egen nyckel, under Installation → Tjänster och nycklar.", type: "project" },
  company: { label: "Företagets egen nyckel", note: "Företaget lägger in den under Inställningar → Kopplingar, på områdets sida.", type: "quote" },
  issued: { label: "Nyckel som Workflow utfärdar", note: "Workflow skapar nyckeln eller godkännandet. Bara en kontrollsumma sparas.", type: "round" },
  none: { label: "Ingen nyckel", note: "Tjänsten behöver ingen nyckel.", type: "neutral" },
};

export const DIRECTION_LABELS: Record<ServiceDirection, string> = {
  out: "Workflow → tjänsten",
  in: "Tjänsten → Workflow",
  both: "Åt båda hållen",
};

const KEYS = "Installation → Tjänster och nycklar";
/** Every AI run goes through lib/ai/assistant-provider.ts: the chat, and the agents (surfaces in lib/ai/surface-labels.ts). */
const AI_FEATURES: readonly ServicePlace[] = [
  { label: "Chatten", at: "panel:ai" },
  { label: "Import", at: "/?view=import" },
  { label: "Granska med AI, Skriv med AI och förslag på uppgiften", at: "/?view=workflow_task" },
  { label: "Förslag på planering", at: "/?view=project_planning" },
  { label: "Dagsammanställning", at: "/?view=stats" },
  { label: "Analys av maskinlarm", at: "/?view=advanced&section=machines" },
];

export const EXTERNAL_SERVICES: readonly ExternalService[] = [
  {
    id: "openai", name: "OpenAI", group: "ai", direction: "out",
    purpose: "AI-svar: chatt, import, granskning, förslag och sammanställningar.",
    key: { owner: "central", label: "API-nyckel", central: ["openai.apiKey"] },
    admin: [{ label: `${KEYS} → AI`, at: "/?view=server_keys&section=keys-ai" }, { label: "Installation → Priser → AI-kostnad", at: "/?view=ai_admin" }],
    usedBy: AI_FEATURES,
    hosts: ["api.openai.com", "eu.api.openai.com"],
    modules: ["lib/ai/openai-provider.ts", "lib/ai/openai-structured.ts", "lib/ai/openai-workflow-assistant.ts"],
  },
  {
    id: "azure-openai", name: "Azure OpenAI (EU)", group: "ai", direction: "out",
    purpose: "Samma AI-funktioner för företag som kräver behandling inom EU.",
    key: { owner: "central", label: "Nyckel till Azure-resursen", central: ["azure.apiKey"] },
    admin: [{ label: `${KEYS} → AI (EU-leverantören)`, at: "/?view=server_keys&section=ai" }, { label: "Inställningar → Arbetssätt → AI (företagets EU-val)", at: "/?view=company_features&section=ai" }],
    usedBy: AI_FEATURES,
    hostEndings: [".openai.azure.com", ".services.ai.azure.com", ".cognitiveservices.azure.com"],
    via: "adressen som ägaren sparar",
    modules: ["lib/ai/azure-provider.ts", "lib/ai/azure-settings.ts"],
  },
  {
    id: "google", name: "Google-inloggning", group: "login", direction: "both",
    purpose: "Logga in med ett Google-konto.",
    key: { owner: "central", label: "Klient-id och klienthemlighet", central: ["google.clientId", "google.clientSecret"] },
    admin: [{ label: `${KEYS} → Inloggning`, at: "/?view=server_keys&section=keys-login" }],
    usedBy: [{ label: "Logga in", at: "/login" }, { label: "Konto och säkerhet (koppla kontot)", at: "/?view=settings&step=security" }],
    incoming: ["/api/auth/callback/google"],
    via: "next-auth (Googles egna adresser)",
    modules: ["lib/auth/config.ts", "lib/auth/google-link.ts"],
  },
  {
    id: "microsoft", name: "Microsoft-inloggning (Entra)", group: "login", direction: "both",
    purpose: "Logga in med ett Microsoft-konto i företagets katalog.",
    key: { owner: "central", label: "Klienthemlighet", central: ["microsoft.clientSecret"] },
    admin: [{ label: `${KEYS} → Inloggning med Microsoft`, at: "/?view=server_keys&section=microsoft" }],
    usedBy: [{ label: "Logga in", at: "/login" }],
    hosts: ["login.microsoftonline.com", "graph.microsoft.com"],
    modules: ["lib/auth/microsoft-core.ts", "lib/auth/microsoft.ts"],
  },
  {
    id: "stripe", name: "Stripe", group: "payment", direction: "both",
    purpose: "Kortbetalning, abonnemang och fakturor. Stripe meddelar betalningarna tillbaka.",
    key: { owner: "central", label: "Hemlig nyckel och webhookhemlighet", central: ["stripe.secretKey", "stripe.webhookSecret"] },
    admin: [{ label: `${KEYS} → Betalning`, at: "/?view=server_keys&section=keys-payment" }, { label: `${KEYS} → Prova betalflödet`, at: "/?view=server_keys&section=payments" }],
    usedBy: [{ label: "Abonnemang", at: "/?view=credits" }, { label: "Företag → Abonnemang och fakturor", at: "/?view=company&section=billing" }],
    incoming: ["/api/stripe/webhook"],
    via: "Stripes eget paket",
    modules: ["ee/stripe/", "ee/api/stripe-webhook.ts", "ee/integrations/stripe-key-check.ts"],
    onlyWith: "ee/stripe",
  },
  {
    id: "solar", name: "Solar", group: "wholesale", direction: "out",
    purpose: "Grossistens artikelkatalog till det delade artikelregistret, aldrig priser.",
    key: { owner: "central", label: "Klient-id och klienthemlighet", central: ["solar.clientId", "solar.clientSecret"] },
    admin: [{ label: `${KEYS} → Grossister`, at: "/?view=server_keys&section=keys-wholesale" }],
    usedBy: [{ label: "Artiklar", at: "/?view=articles" }],
    hosts: ["sgidp.b2clogin.com", "sgidp.onmicrosoft.com", "api.solar.eu"],
    modules: ["lib/integrations/solar.ts", "lib/integrations/wholesale-api.ts"],
  },
  {
    id: "scb", name: "SCB företagsuppslag", group: "lookup", direction: "out",
    purpose: "Hämtar företagets namn och adress från organisationsnumret.",
    key: { owner: "central", label: "API-nyckel", central: ["scb.apiKey"] },
    admin: [{ label: `${KEYS} → Företagsuppslag (SCB)`, at: "/?view=server_keys&section=scb" }],
    usedBy: [{ label: "Ny kund", at: "/?view=customers&new=1" }],
    hosts: ["apiafr.scb.se"],
    modules: ["lib/kfid/company-lookup.ts"],
  },
  {
    id: "lantmateriet-map", name: "Lantmäteriet karta", group: "lookup", direction: "out",
    purpose: "Kartbilder till Platser. Servern hämtar dem och visar dem från en egen adress.",
    key: { owner: "central", label: "Användare och lösenord", central: ["lantmateriet.mapUser", "lantmateriet.mapPassword"] },
    admin: [{ label: `${KEYS} → Lantmäteriet`, at: "/?view=server_keys&section=map" }],
    usedBy: [{ label: "Platser", at: "/?view=facilities" }],
    hosts: ["api.lantmateriet.se", "dl1.lantmateriet.se"],
    modules: ["lib/map/"],
  },
  {
    id: "lantmateriet-address", name: "Lantmäteriet adress", group: "lookup", direction: "out",
    purpose: "Söker adresser och ger platsens läge.",
    key: { owner: "central", label: "Användare, lösenord, API-nyckel och API-hemlighet", central: ["lantmateriet.addressUser", "lantmateriet.addressPassword", "lantmateriet.addressKey", "lantmateriet.addressSecret"] },
    admin: [{ label: `${KEYS} → Lantmäteriet`, at: "/?view=server_keys&section=address" }],
    usedBy: [{ label: "Platser", at: "/?view=facilities" }, { label: "Ny kund", at: "/?view=customers&new=1" }],
    hosts: ["api.lantmateriet.se", "api-ver.lantmateriet.se", "apimanager.lantmateriet.se", "apimanager-ver.lantmateriet.se"],
    modules: ["lib/geo/"],
  },
  {
    id: "smtp", name: "E-postserver (SMTP)", group: "messages", direction: "out",
    purpose: "Skickar e-post: inbjudningar, notiser, återställning och utskick.",
    key: { owner: "central", label: "SMTP-lösenord", central: ["smtp.password"] },
    admin: [{ label: `${KEYS} → E-post`, at: "/?view=server_keys&section=keys-email" }, { label: "Installation → Drift och säkerhet → Automatisk e-post", at: "/?view=login_settings&section=mail" }],
    usedBy: [{ label: "Utskick", at: "/?view=mailings" }],
    via: "servern som ägaren anger",
    modules: ["lib/mail/mailer.ts"],
  },
  {
    id: "web-push", name: "Webbpush", group: "messages", direction: "out",
    purpose: "Notiser till telefon och dator via webbläsarens pushtjänst.",
    key: { owner: "central", label: "Privat VAPID-nyckel", central: ["push.privateKey"] },
    admin: [{ label: "Installation → Drift och säkerhet → Webbpush", at: "/?view=login_settings&section=push" }],
    usedBy: [{ label: "Mina inställningar → Notiser", at: "/?view=settings&step=notices" }],
    via: "adressen i webbläsarens prenumeration",
    modules: ["lib/push/web-push.ts", "lib/workflow/notice-delivery.ts"],
  },
  {
    id: "fortnox", name: "Fortnox", group: "accounting", direction: "out",
    purpose: FORTNOX_CONNECTION_READY ? "Skickar fakturaunderlag som faktura till företagets Fortnox." : "Inte öppen än. Kan skicka fakturaunderlag som faktura till företagets Fortnox när kopplingen finns.",
    key: { owner: "company", label: "Företagets Fortnox-nyckel", company: "fortnox" },
    admin: [{ label: "Inställningar → Kopplingar → Bokföring", at: "/?view=advanced&section=accounting" }],
    usedBy: [{ label: "Offerter och fakturaunderlag", at: "/?view=quotes" }],
    hosts: ["api.fortnox.se"],
    modules: ["lib/quotes/fortnox-client.ts", "lib/quotes/accounting-server.ts"],
  },
  {
    id: "payroll-sftp", name: "Tid- och lönesystem via SFTP", group: "accounting", direction: "out",
    purpose: "Hämtar frånvarofiler och lämnar exportfiler på företagets SFTP-server (förberett, avslaget).",
    key: { owner: "company", label: "Företagets SFTP-lösenord eller nyckel", company: "payroll-sftp" },
    admin: [{ label: "Inställningar → Kopplingar → Lön och export", at: "/?view=advanced&section=payroll" }, { label: "Tid → Lön och export", at: "/?view=time&tab=payroll" }],
    usedBy: [{ label: "Import", at: "/?view=import" }],
    via: "servern som företaget anger",
    modules: ["lib/payroll/transport.ts", "lib/payroll/server.ts"],
  },
  {
    // Min webbsida (2026-11-10): every company's own WordPress, reached only under lib/website/net.ts's outbound rules.
    id: "company-website", name: "Företagets webbplats (WordPress)", group: "clients", direction: "out",
    purpose: "Företagets egna webbsidor redigeras och publiceras från Workflow.",
    key: { owner: "none", label: "Applikationslösenord från WordPress, förseglat med företagets nyckel" },
    admin: [{ label: "Inställningar → Min webbsida", at: "/?view=company_website" }],
    via: "webbplatsen som företaget anger (bara publika https-adresser)",
    modules: ["lib/website/"],
  },
  {
    id: "api-v1", name: "Egna system via API", group: "clients", direction: "in",
    purpose: "Företagets egna system läser och skriver data i Workflow.",
    key: { owner: "issued", label: "API-nyckel" },
    admin: [{ label: "Inställningar → Kopplingar → API och MCP", at: "/?view=advanced&section=api" }],
    incoming: ["/api/v1"],
    modules: ["app/api/v1/", "lib/integrations/authenticate.ts"],
  },
  {
    id: "mcp", name: "AI-klienter via MCP", group: "clients", direction: "in",
    purpose: "AI-klienter söker och arbetar i Workflow för en medarbetare.",
    key: { owner: "issued", label: "MCP-nyckel eller OAuth-godkännande" },
    admin: [{ label: "Inställningar → Kopplingar → API och MCP", at: "/?view=advanced&section=api" }, { label: "Inställningar → Kopplade appar", at: "/?view=settings&step=apps" }],
    usedBy: [{ label: "OAuth-godkännande", at: "/oauth/authorize" }],
    incoming: ["/api/mcp", "/api/oauth/register", "/api/oauth/token", "/api/oauth/revoke"],
    modules: ["app/api/mcp/", "app/api/oauth/", "lib/oauth/"],
  },
  {
    id: "machines", name: "Maskiner och styrsystem", group: "clients", direction: "in",
    purpose: "Larm, driftläge och mätvärden från en källa, till exempel Node-RED.",
    key: { owner: "issued", label: "Nyckel per källa" },
    admin: [{ label: "Inställningar → Kopplingar → Maskiner", at: "/?view=advanced&section=machines" }],
    incoming: ["/api/ingest/v1/events", "/api/ingest/v1/raw"],
    modules: ["app/api/ingest/", "lib/machine/authenticate.ts"],
  },
];
