/**
 * Beteendeanalys (2026-10-07): what is counted, with Swedish names. Pure, so the browser, the server and the
 * tests read the same lists. Everything counted is a count per day of a fixed key – never a person, a company, an
 * address or a browser – and a key that is not in these lists is never stored, so the table cannot grow without bound.
 */
import { OPERATOR_SITE } from "@/lib/operator-site";

export const ANALYTICS_KINDS = ["page", "feature", "funnel", "consent", "demo"] as const;
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
  facilities: "Platser", customers: "Kunder", self_inspection: "Egenkontroll", deviations: "Avvikelser", place: "Plats", place_labels: "Platsetiketter", credits: "Abonnemang",
  help: "Hjälp", settings: "Mina inställningar", administration: "Användare", operator_accounts: "Operatörskonton", company: "Företag", advanced: "Kopplingar", quote_settings: "Priser och offert", view_as: "Visa som", integrations: "API och MCP", history_retention: "Historik och lagring",
  company_values: "Värden och referenser", company_settings: "Rapporter och logotyp", company_features: "Arbetssätt", company_website: "Min webbsida", company_posts: "Inlägg", forms: "Skapa formulär", import: "Import", ai_settings: "Workflow AI",
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
export const DEMO_START_KEYS: readonly string[] = present(["start_button", SITE_START, "start_link", "start_login"]);
/**
 * Where a demo start came from (2026-11-11, "vilken väg man kom in" in the privacy policy 2026-11-11.1, avsnitt 3): the
 * Referer header sorted into one of the fixed groups when the demo starts. The address itself is never kept or sent on.
 */
export const DEMO_SOURCE_KEYS: readonly string[] = present(["from_own", SITE_SOURCE, "from_search", "from_other", "from_none"]);
export const DEMO_FLOW_KEYS = ["flow_tour_start", "flow_tour_done", "flow_user_switch", "flow_exit"] as const;
export const DEMO_TIME_KEYS = ["time_lt1", "time_1to3", "time_3to10", "time_gt10"] as const;
export const DEMO_LABELS: Record<string, string> = {
  start_button: "Knapp på startsidan", start_link: "Direkt länk", start_login: "Inloggningen (demo / demo)",
  from_own: "Workflows egna sidor", from_search: "Sökmotor", from_other: "Annan webbplats", from_none: "Ingen hänvisning (direkt eller app)",
  flow_tour_start: "Rundturen påbörjad", flow_tour_done: "Rundturen genomförd", flow_user_switch: "Byte av användare (Visa som)", flow_exit: "Demon avslutad med knappen",
  time_lt1: "Under 1 minut", time_1to3: "1–3 minuter", time_3to10: "3–10 minuter", time_gt10: "Över 10 minuter",
  ...(OPERATOR_SITE && SITE_START && SITE_SOURCE ? { [SITE_START]: OPERATOR_SITE.startLabel, [SITE_SOURCE]: OPERATOR_SITE.label } : {}),
};
/** How the visitor came, from `/demo?via=…`: the start page's button, the operator's website's link, the login page, otherwise the plain link. */
const DEMO_VIA: Record<string, string> = { button: "start_button", ...(OPERATOR_SITE && SITE_START ? { [OPERATOR_SITE.via]: SITE_START } : {}), login: "start_login" };
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

/** Whether a key may be stored for a kind (the closed lists above; pages and functions are checked where they are counted). */
export function validCounter(kind: AnalyticsKind, key: string) {
  if (kind === "demo") return isDemoKey(key);
  if (kind === "funnel") return isFunnelStep(key);
  if (kind === "consent") return isConsentChoice(key);
  if (kind === "feature") return isFeatureKey(key);
  return pageKey(key.split(":")[0]) !== null && /^[a-z_]{1,40}(:[A-Z_]{1,30})?$/.test(key);
}

export const kindLabel = (kind: string, key: string) =>
  kind === "page" ? pageLabel(key) : kind === "feature" ? featureLabel(key) : kind === "funnel" && isFunnelStep(key) ? FUNNEL_LABELS[key] : kind === "consent" && isConsentChoice(key) ? CONSENT_LABELS[key] : kind === "demo" ? demoKeyLabel(key) : key;
