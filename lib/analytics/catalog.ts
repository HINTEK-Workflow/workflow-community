/**
 * Beteendeanalys (2026-10-07): what is counted, with Swedish names. Pure, so the browser, the server and the
 * tests read the same lists. Everything counted is a count per day of a fixed key – never a person, a company, an
 * address or a browser – and a key that is not in these lists is never stored, so the table cannot grow without bound.
 */
import { OPERATOR_SITE } from "@/lib/operator-site";

export const ANALYTICS_KINDS = ["page", "feature", "funnel", "consent", "demo", "landing"] as const;
export type AnalyticsKind = (typeof ANALYTICS_KINDS)[number];
export const isAnalyticsKind = (value: unknown): value is AnalyticsKind => (ANALYTICS_KINDS as readonly string[]).includes(String(value));

/** The days kept unless the product owner chooses otherwise (14 months, like most statistics tools). */
export const DEFAULT_RETENTION_MONTHS = 14;
export const RETENTION_CHOICES = [3, 6, 12, 14, 24] as const;

// ---------- pages in the app ----------

/** The pages of the product owner's own administration are not counted: they are not what customers do. */
const OWNER_VIEWS = new Set(["product_overview", "customer_companies", "pricing_admin", "ai_admin", "landing_editor", "pdf_templates", "plc_devices", "mail_settings", "login_settings", "server_keys", "services", "mailings", "behavior_analytics"]);

export const PAGE_LABELS: Record<string, string> = {
  demo: "Demo", stats: "Översikt", setup: "Kom igång", notifications: "Notiser", new_task: "Ny uppgift", new: "Ny kontroll", new_project: "Nytt projekt", projects: "Projekt",
  planning: "Planering – Kalender", project_planning: "Planering – Tidplan", capacity: "Planering – Kapacitet", rounds: "Driftronder", project: "Projekt (öppnat)", tasks: "Uppgifter", work_orders: "Arbetsordrar", time: "Tid",
  facilities: "Platser", customers: "Kunder", self_inspection: "Egenkontroll", deviations: "Avvikelser", place: "Plats", place_labels: "Platsetiketter", round_paper: "Rondprotokoll på papper", credits: "Abonnemang",
  help: "Hjälp", settings: "Mina inställningar", administration: "Användare", operator_accounts: "Operatörskonton", company: "Företag", advanced: "Kopplingar", quote_settings: "Priser och offert", view_as: "Visa som", integrations: "API och MCP", history_retention: "Historik och lagring",
  company_values: "Värden och referenser", company_settings: "Rapporter och logotyp", company_features: "Arbetssätt", company_website: "Min webbsida", company_posts: "Inlägg", company_videos: "Filmer", forms: "Skapa formulär", import: "Import", ai_settings: "Workflow AI", agents: "Agenter",
  quotes: "Offerter", quote: "Offert (öppnad)", purchases: "Inköp", purchase: "Inköp (öppnat)", articles: "Artiklar", invoice_bases: "Fakturaunderlag",
  "workflow_task:WORK_ORDER": "Arbetsorder (öppnad)", "workflow_task:RISK_ASSESSMENT": "Riskbedömning (öppnad)", "workflow_task:FORM": "Protokoll (öppnat)", workflow_task: "Uppgift (öppnad)",
};

const TASK_TYPES = new Set(["WORK_ORDER", "RISK_ASSESSMENT", "FORM"]);

/**
 * The key a page view is counted under, or null when it is not counted. `view` is the page the app has already
 * accepted; the task editors are told apart by their type (never by form, title or id).
 */
export function pageKey(view: string | null | undefined, taskType?: string | null): string | null {
  if (!view || !/^[a-z_]{1,40}$/.test(view) || OWNER_VIEWS.has(view)) return null;
  if (view === "workflow_task") return taskType && TASK_TYPES.has(taskType) ? `workflow_task:${taskType}` : "workflow_task";
  return view;
}
const own = (names: Record<string, string>, key: string) => (Object.hasOwn(names, key) ? names[key] : undefined);
export const pageLabel = (key: string) => own(PAGE_LABELS, key) ?? key;

// ---------- functions used ----------

export const FEATURE_LABELS: Record<string, string> = {
  task_created_WORK_ORDER: "Arbetsorder skapad", task_created_RISK_ASSESSMENT: "Riskbedömning skapad", task_created_FORM: "Protokoll skapat",
  report_pdf: "Rapport hämtad (PDF eller Excel)", report_mail: "Rapport skickad med e-post",
  time: "Tid (start, stopp, justering)", rounds: "Driftronder (planera och ändra)", planning: "Planering (aktivitet skapad eller ändrad)", projects: "Projekt (skapa och ändra)",
  places: "Platser (skapa och ändra)", attachments: "Bilagor uppladdade", import: "Import", ai_chat: "Workflow AI: fråga i chatten", ai_proposal: "Workflow AI: förslag", ai_review: "Workflow AI: granska protokoll",
  self_inspection: "Egenkontroll", company_values: "Värden och referenser", invitations: "Kollegor inbjudna", offices: "Kontor och avdelningar", api_keys: "API- och MCP-nycklar", cloud_transfer: "Cloud-export och återimport",
  quotes: "Offerter (skapa och ändra)",
  purchases: "Inköp (skapa och ändra)",
};

/** The route families whose changes are counted as one function (the part of the address after /api/). Longest first. */
const MUTATION_RULES: { prefix: string; key: string }[] = [
  { prefix: "workflow-tasks/snapshot-report", key: "report_pdf" },
  { prefix: "workflow-tasks/", key: "report_mail" }, // …/<id>/send; other task routes are not counted here (see recordFeature)
  { prefix: "workflow-task-files", key: "attachments" },
  { prefix: "workflow-time", key: "time" },
  { prefix: "form-schedules", key: "rounds" },
  { prefix: "planned-activities", key: "planning" },
  { prefix: "projects", key: "projects" },
  { prefix: "places", key: "places" },
  { prefix: "import", key: "import" },
  { prefix: "ai/chat", key: "ai_chat" },
  { prefix: "ai/proposals", key: "ai_proposal" },
  { prefix: "ai/review", key: "ai_review" },
  { prefix: "self-inspection", key: "self_inspection" },
  { prefix: "company-values", key: "company_values" },
  { prefix: "invitations", key: "invitations" },
  { prefix: "integration-keys", key: "api_keys" },
  { prefix: "cloud-workspace", key: "cloud_transfer" },
  { prefix: "quotes", key: "quotes" },
  { prefix: "purchases", key: "purchases" },
];

/**
 * The function a changing request (POST, PUT, PATCH, DELETE) belongs to, from its address; null when it is not one of
 * the counted functions. Task saves are not counted here: autosave would count the same sitting many times, so the
 * server counts a created task once where it is created.
 */
export function featureForRequest(method: string, pathname: string): string | null {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase())) return null;
  const path = pathname.replace(/^\/api\//, "").replace(/\/+$/, "");
  if (path === pathname) return null;
  for (const rule of MUTATION_RULES) {
    if (rule.prefix === "workflow-tasks/") { if (/^workflow-tasks\/[^/]+\/send$/.test(path)) return rule.key; continue; }
    if (path === rule.prefix || path.startsWith(`${rule.prefix}/`)) return rule.key;
  }
  return null;
}

export const featureLabel = (key: string) => own(FEATURE_LABELS, key) ?? key;
export const isFeatureKey = (key: string) => Object.hasOwn(FEATURE_LABELS, key);

// ---------- the public pages (only with consent) ----------

/** The steps of the funnel, in order: landing page, the price section, Skapa konto and the checkout. */
export const FUNNEL_STEPS = ["landing", "pricing", "register", "checkout"] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];
export const FUNNEL_LABELS: Record<FunnelStep, string> = { landing: "Landningssidan", pricing: "Priser", register: "Skapa konto", checkout: "Kassa" };
export const isFunnelStep = (value: unknown): value is FunnelStep => (FUNNEL_STEPS as readonly string[]).includes(String(value));

/** The answers in the cookie box; "statistics" is the visitor allowing statistics, "necessary" refusing them. */
export const CONSENT_CHOICES = ["necessary", "statistics"] as const;
export type ConsentChoice = (typeof CONSENT_CHOICES)[number];
export const CONSENT_LABELS: Record<ConsentChoice, string> = { necessary: "Bara nödvändiga", statistics: "Tillåt statistik" };
export const isConsentChoice = (value: unknown): value is ConsentChoice => (CONSENT_CHOICES as readonly string[]).includes(String(value));

// ---------- the public demo (2026-11-04) ----------

/**
 * Demon: one anonymous count per day of a fixed key, no cookie, no stored identifier, no IP address
 * and nothing typed by a visitor. A count is a visit (a page load), never a person: nobody is recognised between visits.
 * The keys are these fixed ones plus `view:<page>` for a page of the demo.
 */
// The operator's own website (lib/operator-site.ts) adds its demo link and its referrer group; the community edition has none.
const SITE_START = OPERATOR_SITE ? `start_${OPERATOR_SITE.key}` : null;
const SITE_SOURCE = OPERATOR_SITE ? `from_${OPERATOR_SITE.key}` : null;
const present = (keys: readonly (string | null)[]) => keys.filter((key): key is string => key !== null);
export const DEMO_START_KEYS: readonly string[] = present(["start_button", "start_simulator", SITE_START, "start_link", "start_login", "start_facebook", "start_instagram", "start_linkedin"]);
/**
 * Where a demo start came from (2026-11-11, "vilken väg man kom in" in the privacy policy 2026-11-11.1, avsnitt 3): the
 * Referer header sorted into one of the fixed groups when the demo starts. The address itself is never kept or sent on.
 */
export const DEMO_SOURCE_KEYS: readonly string[] = present(["from_own", SITE_SOURCE, "from_search", "from_other", "from_none"]);
export const DEMO_FLOW_KEYS = ["flow_tour_start", "flow_tour_done", "flow_user_switch", "flow_exit"] as const;
export const DEMO_TIME_KEYS = ["time_lt1", "time_1to3", "time_3to10", "time_gt10"] as const;
/** The screen width's group of a demo visit (2026-11-16, "om det är besökare från dator eller mobil"), once per page load, as on the website. */
export const DEMO_DEVICE_KEYS = ["device_mobile", "device_tablet", "device_desktop"] as const;
export const DEMO_LABELS: Record<string, string> = {
  start_button: "Knapp på startsidan", start_simulator: "Simulatorknappen på webbplatsen", start_link: "Direkt länk", start_login: "Inloggningen (demo / demo)",
  // Kampanjlänkar i Inlägg (2026-11-16): a post's link gets ?via=<channel> (lib/meta/text.ts, campaignLink).
  start_facebook: "Inlägg på Facebook", start_instagram: "Inlägg på Instagram", start_linkedin: "Inlägg på LinkedIn",
  from_own: "Workflows egna sidor", from_search: "Sökmotor", from_other: "Annan webbplats", from_none: "Ingen hänvisning (direkt eller app)",
  flow_tour_start: "Rundturen påbörjad", flow_tour_done: "Rundturen genomförd", flow_user_switch: "Byte av användare (Visa som)", flow_exit: "Demon avslutad med knappen",
  time_lt1: "Under 1 minut", time_1to3: "1–3 minuter", time_3to10: "3–10 minuter", time_gt10: "Över 10 minuter",
  device_mobile: "Mobil", device_tablet: "Surfplatta", device_desktop: "Dator",
  ...(OPERATOR_SITE && SITE_START && SITE_SOURCE ? { [SITE_START]: OPERATOR_SITE.startLabel, [SITE_SOURCE]: OPERATOR_SITE.label } : {}),
};
/**
 * How the visitor came, from `/demo?via=…`: the start page's button, the simulator button (`via=simulator`, 2026-11-16), the
 * operator's website's link, the login page, a post's campaign link (facebook/instagram/linkedin), otherwise the plain link.
 */
const DEMO_VIA: Record<string, string> = { button: "start_button", simulator: "start_simulator", ...(OPERATOR_SITE && SITE_START ? { [OPERATOR_SITE.via]: SITE_START } : {}), login: "start_login", facebook: "start_facebook", instagram: "start_instagram", linkedin: "start_linkedin" };
export const demoStartKey = (via: string | null | undefined) => (via && Object.hasOwn(DEMO_VIA, via) ? DEMO_VIA[via] : "start_link");

const SEARCH_ENGINES = /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|startpage|qwant|yandex|baidu|brave)\.((com|co)\.[a-z]{2}|[a-z]{2,3})$/;
/**
 * The group a demo start's Referer belongs to. `ownHosts` are this installation's own addresses (the app and the public
 * site). Only the group is counted; the address is looked at for this one question and never stored.
 */
export function demoSourceKey(referer: string | null | undefined, ownHosts: readonly (string | null | undefined)[]): string {
  let host = "";
  try { host = referer ? new URL(referer).hostname.toLowerCase().replace(/\.$/, "") : ""; } catch { host = ""; }
  if (!host) return "from_none";
  const own = ownHosts.map((value) => (value ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "")).filter(Boolean);
  if (own.includes(host)) return "from_own";
  if (SITE_SOURCE && OPERATOR_SITE?.hosts.some((site) => host === site || host.endsWith(`.${site}`))) return SITE_SOURCE;
  if (SEARCH_ENGINES.test(host)) return "from_search";
  return "from_other";
}

/** A visit's time in the demo as one of four buckets; the exact time is never sent. */
export const demoTimeKey = (seconds: number) => (seconds < 60 ? "time_lt1" : seconds < 180 ? "time_1to3" : seconds < 600 ? "time_3to10" : "time_gt10") as (typeof DEMO_TIME_KEYS)[number];
export const demoViewKey = (view: string | null | undefined) => { const key = pageKey(view); return key && Object.hasOwn(PAGE_LABELS, key) ? `view:${key}` : null; };
export function isDemoKey(key: string) {
  if (Object.hasOwn(DEMO_LABELS, key)) return true;
  return key.startsWith("view:") && demoViewKey(key.slice(5)) === key;
}
/**
 * The keys the browser may send (pages, the tour, Visa som, Avsluta and the time bucket). How a demo starts and where it
 * came from are counted by the server on /demo, so a browser can never add to them (2026-11-11).
 */
const SERVER_DEMO_KEYS = new Set<string>([...DEMO_START_KEYS, ...DEMO_SOURCE_KEYS]);
export const isDemoBrowserKey = (key: string) => isDemoKey(key) && !SERVER_DEMO_KEYS.has(key);
export const demoKeyLabel = (key: string) => (key.startsWith("view:") ? pageLabel(key.slice(5)) : own(DEMO_LABELS, key) ?? key);

// ---------- the public website (2026-11-16) ----------

/**
 * Landningssidan (2026-11-15/16): anonymous sums per day like the demo – no cookie, no identifier, nothing typed by a
 * visitor. A count is a page load or a click, never a person. Keys:
 * - `page:start` / `page:<slug>`: the start page or a feature page (/funktioner/<slug>) was shown;
 * - `click:<target>`: one of the fixed buttons below was pressed (sorted by its address, never the address itself);
 * - `device:<mobile|tablet|desktop>`: the screen width's group, once per page load;
 * - `ref:<domain>`: the site a visitor came from (the domain only, never the address), `ref:none` without one and
 *   `ref:other` past the day's limit, once per visit from outside;
 * - `newsletter:requested` / `newsletter:confirmed`: Följ nyhetsbrevet asked for and confirmed.
 */
export const LANDING_CLICK_KEYS = ["demo", "simulator", "operator_demo", "plan", "signup", "contact", "github", "install", "read_more"] as const;
export type LandingClick = (typeof LANDING_CLICK_KEYS)[number];
export const LANDING_CLICK_LABELS: Record<LandingClick, string> = {
  demo: "Prova demon", simulator: "Simulatorn i demon", operator_demo: "Operatörssidan i demon", plan: "Planerna och deras knappar", signup: "Logga in eller Skapa konto",
  contact: "Kontakta oss (e-post)", github: "GitHub", install: "Kopiera installationskommandot", read_more: "Läs mer (undersida)",
};
export const LANDING_DEVICE_KEYS = ["mobile", "tablet", "desktop"] as const;
export type LandingDevice = (typeof LANDING_DEVICE_KEYS)[number];
export const LANDING_DEVICE_LABELS: Record<LandingDevice, string> = { mobile: "Mobil", tablet: "Surfplatta", desktop: "Dator" };
export const LANDING_NEWSLETTER_KEYS = ["requested", "confirmed"] as const;
export type LandingNewsletter = (typeof LANDING_NEWSLETTER_KEYS)[number];
export const LANDING_NEWSLETTER_LABELS: Record<LandingNewsletter, string> = { requested: "Anmälningar till nyhetsbrevet", confirmed: "Bekräftade anmälningar" };
/** The most different referring domains kept per day; the rest are counted together as `ref:other`. */
export const LANDING_REF_DAY_LIMIT = 40;

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
const DOMAIN = /^(?=.{3,60}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
export const isLandingSlug = (value: unknown): value is string => typeof value === "string" && SLUG.test(value);
const inList = <T extends string>(list: readonly T[], value: unknown): value is T => (list as readonly string[]).includes(String(value));
export const isLandingClick = (value: unknown): value is LandingClick => inList(LANDING_CLICK_KEYS, value);
export const isLandingDevice = (value: unknown): value is LandingDevice => inList(LANDING_DEVICE_KEYS, value);

/**
 * Från AI-tjänster (Growth Engine paket 2, 2026-11-28): a visit that came from an AI assistant – by the referring site's host name
 * (its subdomains too) or by the link's utm_source – is also counted as `ai:<service>`, a source of its own. A fixed list, so
 * nothing outside it is ever stored; the name is the service's own.
 */
export const AI_SERVICES = [
  { key: "chatgpt", label: "ChatGPT", domains: ["chatgpt.com", "chat.openai.com", "openai.com"], names: ["chatgpt", "openai"] },
  { key: "perplexity", label: "Perplexity", domains: ["perplexity.ai"], names: ["perplexity"] },
  { key: "copilot", label: "Microsoft Copilot", domains: ["copilot.microsoft.com", "copilot.cloud.microsoft", "m365.cloud.microsoft", "edgeservices.bing.com"], names: ["copilot"] },
  { key: "gemini", label: "Gemini", domains: ["gemini.google.com"], names: ["gemini"] },
  { key: "claude", label: "Claude", domains: ["claude.ai"], names: ["claude"] },
  { key: "mistral", label: "Mistral Le Chat", domains: ["chat.mistral.ai"], names: ["mistral"] },
  { key: "deepseek", label: "DeepSeek", domains: ["chat.deepseek.com"], names: ["deepseek"] },
  // "meta" alone is also what Meta's own ads write in utm_source, so only the assistant's address counts.
  { key: "meta", label: "Meta AI", domains: ["meta.ai"], names: [] },
  { key: "grok", label: "Grok", domains: ["grok.com"], names: ["grok"] },
] as const satisfies readonly { key: string; label: string; domains: readonly string[]; names: readonly string[] }[];
export type AiServiceKey = (typeof AI_SERVICES)[number]["key"];
export const AI_SERVICE_KEYS: readonly AiServiceKey[] = AI_SERVICES.map((service) => service.key);
export const isAiServiceKey = (value: unknown): value is AiServiceKey => inList(AI_SERVICE_KEYS, value);
export const aiServiceLabel = (key: string) => AI_SERVICES.find((service) => service.key === key)?.label ?? key;

/** A utm_source as the beacon sends it: lower case, only a–z, 0–9, dot and hyphen, at most 100 characters. */
export const cleanUtmSource = (value: string | null | undefined) => (value ?? "").toLowerCase().replace(/[^a-z0-9.-]/g, "").slice(0, 100);
const onDomain = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/**
 * The AI service a visit came from, as the key `ai:<service>`, or null: `domain` is the referring page's host name (the full name,
 * subdomains count), `utmSource` the link's utm_source (ChatGPT writes utm_source=chatgpt.com on its links). Only the fixed list.
 */
export function aiServiceOf(domain: string | null | undefined, utmSource?: string | null): `ai:${AiServiceKey}` | null {
  const host = bareHost(domain);
  const utm = cleanUtmSource(utmSource).replace(/^www\./, "");
  for (const service of AI_SERVICES) {
    if (host && service.domains.some((item) => onDomain(host, item))) return `ai:${service.key}`;
    if (utm && (service.domains.some((item) => onDomain(utm, item)) || (service.names as readonly string[]).includes(utm))) return `ai:${service.key}`;
  }
  return null;
}

export function isLandingKey(key: string) {
  const parts = key.split(":");
  if (parts.length !== 2) return false;
  const [group, rest] = parts;
  if (group === "page") return rest === "start" || isLandingSlug(rest);
  if (group === "click") return isLandingClick(rest);
  if (group === "device") return isLandingDevice(rest);
  if (group === "ref") return rest === "none" || rest === "other" || DOMAIN.test(rest);
  if (group === "newsletter") return inList(LANDING_NEWSLETTER_KEYS, rest);
  if (group === "ai") return isAiServiceKey(rest);
  return false;
}

/** Second-level labels under which a country's sites sit (example.co.uk), so the domain kept is the site's own. */
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "ac", "edu"]);
const bareHost = (value: string | null | undefined) => (value ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "").replace(/^www\./, "");
/**
 * The domain a referring address belongs to ("l.facebook.com/l.php?u=…" → "facebook.com"), or null when there is
 * none, it is not http(s), an IP address, or one of this installation's own hosts (`ownHosts`, their subdomains too). Only
 * the domain is kept; the rest of the address is dropped here and never stored.
 */
export function referrerDomain(referrer: string | null | undefined, ownHosts: readonly (string | null | undefined)[] = []): string | null {
  let host = "";
  try {
    const url = new URL(String(referrer ?? ""));
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    host = url.hostname.toLowerCase().replace(/\.$/, "");
  } catch { return null; }
  if (!host || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[") || !host.includes(".")) return null;
  const bare = host.replace(/^www\./, "");
  if (ownHosts.map(bareHost).filter(Boolean).some((own) => bare === own || bare.endsWith(`.${own}`))) return null;
  const labels = bare.split(".");
  const keep = labels.length >= 3 && labels[labels.length - 1].length === 2 && SECOND_LEVEL.has(labels[labels.length - 2]) ? 3 : 2;
  const domain = labels.slice(-keep).join(".");
  return DOMAIN.test(domain) ? domain : null;
}

/**
 * Which counted button a link on the landing page is, from its address (the owner edits the buttons, so the address decides,
 * never the text). `inPlans` is a link in the price section. Null for any other link.
 */
export function landingClickOf(href: string, options: { inPlans?: boolean; base?: string } = {}): LandingClick | null {
  let url: URL;
  try { url = new URL(href, options.base ?? "https://workflow.invalid/"); } catch { return null; }
  const host = url.hostname.toLowerCase();
  if (url.protocol === "https:" && (host === "github.com" || host.endsWith(".github.com"))) return "github";
  if (options.inPlans) return "plan";
  if (url.protocol === "mailto:") return "contact";
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.hash === "#priser") return "plan";
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path === "/demo") return url.hash === "#maskin" || url.searchParams.get("via") === "simulator" ? "simulator" : "demo";
  if (path === "/operator/demo") return "operator_demo";
  if (path === "/login" || path === "/register") return "signup";
  if (path.startsWith("/funktioner/")) return "read_more";
  return null;
}

/** The screen width's group: under 768 px a phone, under 1100 px a tablet, otherwise a computer. */
export const landingDeviceOf = (width: number): LandingDevice => (width < 768 ? "mobile" : width < 1100 ? "tablet" : "desktop");
/** A demo visit's screen group, by the same widths as the website's (2026-11-16). */
export const demoDeviceKey = (width: number) => `device_${landingDeviceOf(width)}` as (typeof DEMO_DEVICE_KEYS)[number];

/** A feature page's address in words (2026-11-16, Beteendeanalys in plain labels): "maskin-larm" → "Maskin larm". */
export const slugWords = (slug: string) => { const words = slug.replace(/-+/g, " ").trim(); return words ? words[0].toUpperCase() + words.slice(1) : slug; };
export function landingKeyLabel(key: string) {
  const [group, rest = ""] = key.split(":");
  if (group === "page") return rest === "start" ? "Startsidan" : `Undersida: ${slugWords(rest)}`;
  if (group === "click" && isLandingClick(rest)) return LANDING_CLICK_LABELS[rest];
  if (group === "device" && isLandingDevice(rest)) return LANDING_DEVICE_LABELS[rest];
  if (group === "ref") return rest === "none" ? "Ingen hänvisning (direkt)" : rest === "other" ? "Övriga webbplatser" : rest;
  if (group === "newsletter" && inList(LANDING_NEWSLETTER_KEYS, rest)) return LANDING_NEWSLETTER_LABELS[rest];
  if (group === "ai" && isAiServiceKey(rest)) return aiServiceLabel(rest);
  return key;
}

/** Whether a key may be stored for a kind (the closed lists above; pages and functions are checked where they are counted). */
export function validCounter(kind: AnalyticsKind, key: string) {
  if (kind === "demo") return isDemoKey(key);
  if (kind === "landing") return isLandingKey(key);
  if (kind === "funnel") return isFunnelStep(key);
  if (kind === "consent") return isConsentChoice(key);
  if (kind === "feature") return isFeatureKey(key);
  return pageKey(key.split(":")[0]) !== null && /^[a-z_]{1,40}(:[A-Z_]{1,30})?$/.test(key);
}

export const kindLabel = (kind: string, key: string) =>
  kind === "page" ? pageLabel(key) : kind === "feature" ? featureLabel(key) : kind === "funnel" && isFunnelStep(key) ? FUNNEL_LABELS[key] : kind === "consent" && isConsentChoice(key) ? CONSENT_LABELS[key] : kind === "demo" ? demoKeyLabel(key) : kind === "landing" ? landingKeyLabel(key) : key;
