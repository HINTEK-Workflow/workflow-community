import { TOOL_CATALOG, TOOL_NAMES, type ToolName } from "@/lib/tools/catalog";

/**
 * What an agent may do (2026-11-21: "Jag vill att agenten ska få göra så flexibelt och mycket som möjligt inom ramen för de
 * säkra reglerna"). Auto in the chat and every mission may use EVERY tool of the shared catalog (lib/tools/catalog.ts, the same tools
 * as the API and MCP) that the owner's own role, rights and modules permit – the routes decide that on every call, as the owner. Code
 * keeps only a deny-list, and it is not editable by anyone:
 *
 * - never sign, complete (Färdigställ) or lock a work order, protocol or control (the catalog has no such tool, and the words are refused);
 * - no electrical-safety decision (approving a measurement, "får spänningssättas") and no limit value that is not the instrument's or
 *   the company's limit profile's;
 * - never send a quote, an invoice or an invoice basis to a customer (a draft is allowed);
 * - no permanent delete: archive and Utgår are allowed where the catalog has them; "Ta bort" is off;
 * - no change of settings, permissions, roles, users, keys, connections, prices or subscriptions; no credits bought, no payments;
 * - no secrets read; nothing outside the company (the principal's company is the only one); no text from standards or manuals.
 *
 * Pure: the server, the chat, Kontrollera and the tests read the same lists.
 */

const EXTERNAL_ONLY = "Verktyget är till för externa system med en egen API-nyckel. En agent gör inlägg med uppdragets mål Inlägg.";

/** Tools of the catalog an agent never uses, with the reason in plain Swedish. */
export const DENIED_TOOLS: Partial<Record<ToolName, string>> = {
  delete_planned_activity: "Agenter tar aldrig bort något permanent. Planeringen ändras eller sätts till Utgår av en person.",
  // Inlägg, versionsnyheter och besöksstatistik (2026-11-25): tools for an external system's own key. An agent makes a post with
  // the mission's target Inlägg, which has its own rules for drafts and approval.
  list_release_notes: EXTERNAL_ONLY,
  list_social_posts: EXTERNAL_ONLY,
  get_social_post: EXTERNAL_ONLY,
  create_social_post_draft: EXTERNAL_ONLY,
  create_content_brief: EXTERNAL_ONLY,
  get_site_analytics: EXTERNAL_ONLY,
  list_films: EXTERNAL_ONLY,
};

/** What the words of a request may ask for that no agent ever does: refused in Kontrollera and in the chat, with the reason. */
export const DENIED_ACTIONS: readonly { key: string; label: string; pattern: RegExp; reason: string }[] = [
  { key: "sign", label: "Signera", pattern: /\bsignera\w*|\bsignatur\w*|\bintyga\w*/i, reason: "Agenter signerar aldrig. Det gör en person i jobbet." },
  { key: "complete", label: "Färdigställa eller låsa", pattern: /färdigställ\w*|slutför\w*|\blås(a|er)?\b|stäng (arbetsorder|protokoll|kontroll)\w*|markera\w* (som )?klar/i, reason: "Agenter färdigställer eller låser aldrig en arbetsorder, ett protokoll eller en kontroll. Det gör en person." },
  { key: "safety", label: "Beslut om elsäkerhet", pattern: /godkänn\w* (mätvärd|mätning|protokoll|kontroll)\w*|får spänningssättas|spänningssätt\w*|elsäker\w* (beslut|bedömning|godkänn)\w*|bedöm\w* (om|att) .*(säker|farlig)/i, reason: "Agenter fattar aldrig beslut om elsäkerhet. Det gör en behörig person." },
  { key: "limits", label: "Gränsvärden", pattern: /gränsvärd\w*|\bnormvärd\w*|tillåtet värde/i, reason: "Agenter sätter aldrig gränsvärden. De kommer från instrumentet eller företagets gränsprofil." },
  { key: "send", label: "Skicka till kund", pattern: /skicka\w* (offert|faktura|fakturaunderlag)\w*|(offert|faktura|fakturaunderlag)\w* till kund\w*|mejla\w* (offert|faktura)\w*/i, reason: "Agenter skickar aldrig offerter, fakturor eller fakturaunderlag till kunder. Ett utkast går bra; du skickar själv." },
  { key: "delete", label: "Ta bort permanent", pattern: /\b(ta bort|radera|töm|rensa bort|delete)\b/i, reason: "Agenter tar aldrig bort något permanent. Utgår och arkivera går bra där det finns." },
  { key: "settings", label: "Inställningar och behörigheter", pattern: /inställning\w*|behörighet\w* (för|till|åt)|\broll(en|er)?\b (för|till)|lägg\w* till (en )?användare|bjud\w* in|\bnyckel|\bnycklar|koppling\w*|\bpris(er|et|lista)?\b (ändr|sätt|höj|sänk)|abonnemang\w*/i, reason: "Agenter ändrar aldrig inställningar, behörigheter, roller, användare, nycklar, kopplingar, priser eller abonnemang." },
  { key: "payments", label: "Krediter och betalningar", pattern: /köp\w* krediter|betal\w*|\bkortet\b/i, reason: "Agenter köper aldrig krediter och betalar aldrig något." },
  { key: "secrets", label: "Hemligheter", pattern: /lösenord\w*|\bhemlig\w*|api-?nyckel\w*|\btoken\w*/i, reason: "Agenter läser aldrig lösenord, nycklar eller andra hemligheter." },
  { key: "standards", label: "Standarder och manualer", pattern: /\b(standard|manual)\w* (text|tabell|avsnitt|kapitel)|(ur|från) (standard|manual)\w*/i, reason: "Agenter använder aldrig text eller tabeller ur standarder eller manualer." },
];

/** The denied actions the words ask for (none: the words ask for nothing an agent may never do). */
export const deniedActionsIn = (text: string) => DENIED_ACTIONS.filter((item) => item.pattern.test(text));

/** Whether an agent may use the tool at all (the owner's own rights are the route's, on every call). */
export function agentToolAllowed(name: string): { ok: true } | { ok: false; reason: string } {
  if (!(TOOL_NAMES as readonly string[]).includes(name)) return { ok: false, reason: "Verktyget finns inte." };
  const denied = DENIED_TOOLS[name as ToolName];
  return denied ? { ok: false, reason: denied } : { ok: true };
}

/** Every catalog tool an agent may use: everything but the denied ones. */
export const AGENT_TOOLS: readonly ToolName[] = TOOL_NAMES.filter((name) => !DENIED_TOOLS[name]);
export const READ_TOOLS: readonly ToolName[] = AGENT_TOOLS.filter((name) => TOOL_CATALOG[name].effect === "read");
export const WRITE_TOOLS: readonly ToolName[] = AGENT_TOOLS.filter((name) => TOOL_CATALOG[name].effect !== "read");
export const toolTitle = (name: string) => (TOOL_CATALOG as Record<string, { title: string }>)[name]?.title ?? name;

/**
 * Which tools the owner's role, rights and modules make usable (display and Kontrollera; the route checks again on every call). The
 * catalog's scopes are mapped to the permission subjects and modules of lib/workflow/permissions.ts and lib/workflow/modules.ts.
 */
export function toolsForOwner(owner: { admin: boolean; rights: readonly string[]; modulesOn: readonly string[] }): ToolName[] {
  const can = (right: string) => owner.admin || owner.rights.includes(right);
  const on = (module: string) => owner.modulesOn.includes(module);
  const anyTask = (action: string) => ["work-order", "kfid", "risk-assessment", "forms"].some((subject) => can(`${subject}:${action}`));
  const scopeOk: Record<string, () => boolean> = {
    "tasks:read": () => anyTask("read"), "tasks:write": () => anyTask("edit") || anyTask("create"),
    "projects:read": () => on("projects") && can("projects:read"), "projects:write": () => on("projects") && (can("projects:edit") || can("projects:create")),
    "customers:read": () => on("customers") && can("customers:read"), "customers:write": () => on("customers") && (can("customers:edit") || can("customers:create")),
    "planning:read": () => on("planning"), "planning:write": () => on("planning") && (can("projects:create") || can("projects:edit") || anyTask("edit")),
    "time:read": () => on("time"), "time:write": () => on("time"),
    "catalogue:read": () => on("purchasing") && (can("catalogue:read") || can("work-order:edit") || can("quotes:edit")),
    "quotes:read": () => (on("quotes") || on("invoicing")) && can("quotes:read"), "invoices:write": () => on("invoicing") && can("quotes:edit"),
    delete: () => on("projects") && can("projects:archive"),
  };
  return AGENT_TOOLS.filter((name) => (scopeOk[(TOOL_CATALOG[name] as { apiScope: string }).apiScope] ?? (() => false))());
}

/**
 * What Auto may do at once because Ångra can take it back (the rest waits for Använd, also in Auto): the undo is the opposite tool
 * of the catalog, or the fields as they were.
 */
export const UNDOABLE_TOOLS: Partial<Record<ToolName, string>> = {
  create_work_order: "Tar bort arbetsordern om ingen har ändrat den.",
  create_planned_activity: "Tar bort bokningen.",
  report_time: "Tar bort tidposten.",
  update_task: "Sätter tillbaka fälten som de var.",
  update_project: "Sätter tillbaka fälten som de var.",
  update_customer: "Sätter tillbaka fälten som de var.",
  cancel_task: "Återupptar jobbet.",
  report_obstacle: "Löser hindret.",
};
export const isUndoableTool = (name: string) => Boolean(UNDOABLE_TOOLS[name as ToolName]);
/**
 * What Auto saves at once (säkerhetsgranskningen 2026-11-24, F-03): what Ångra takes back, except a customer's details (e-post,
 * telefon, adress) – a text the model read could ask for them, so they always wait for Använd.
 */
const AUTO_WAITS: ReadonlySet<string> = new Set<ToolName>(["update_customer"]);
export const autoAppliesAtOnce = (name: string) => isUndoableTool(name) && !AUTO_WAITS.has(name);

// ---------- the words of a request mapped to the catalog ----------

const WORD_TOOLS: [RegExp, ToolName[]][] = [
  [/(skapa|gör|lägg (till|upp)|ny) (en |ett )?arbetsord(er|rar)/i, ["create_work_order"]],
  [/(ändra|uppdatera|flytta|sätt|byt)\w* .*(arbetsord|uppgift|jobb|status|klart senast|datum|start)|(sätt|tilldela|ge)\w* .*ansvarig/i, ["update_task"]],
  [/utgår|utgå\b|ställ in (jobb|arbetsorder)/i, ["cancel_task"]],
  [/återuppta/i, ["restore_task"]],
  [/hinder/i, ["report_obstacle", "resolve_obstacle"]],
  [/(boka|planera)\w*/i, ["create_planned_activity"]],
  [/(skapa|lägg till|ny) (en |ett )?kund/i, ["create_customer"]],
  [/(ändra|uppdatera)\w* .*kund/i, ["update_customer"]],
  [/(skapa|lägg till|ny) (en |ett )?(plats|anläggning|objekt)/i, ["create_place"]],
  [/(ändra|uppdatera)\w* .*(plats|anläggning|objekt)/i, ["update_place"]],
  [/(skapa|starta|nytt?) (ett )?projekt/i, ["create_project"]],
  [/(ändra|uppdatera)\w* .*projekt/i, ["update_project"]],
  [/arkivera/i, ["archive_project"]],
  [/beslut/i, ["add_project_decision"]],
  [/(skriv|rapportera|registrera)\w* (in )?tid/i, ["report_time"]],
  [/material(rad)?/i, ["add_material_rows"]],
  [/fakturaunderlag/i, ["create_invoice_basis"]],
];

/** The write tools the words name (the reading tools are always there). */
export function writeToolsIn(text: string): ToolName[] {
  return [...new Set(WORD_TOOLS.filter(([pattern]) => pattern.test(text)).flatMap(([, tools]) => tools))].filter((name) => !DENIED_TOOLS[name]);
}

/**
 * Tolka med Workflow AI (2026-11-23): the model may propose write tools from the meaning of the words, not only the patterns above.
 * Only names of the catalog's write tools pass, never a denied one, never the same twice; the owner sees them in Kontrollera and
 * approves them by saving. The route checks the owner's rights on every call as before.
 */
export function acceptedProposedTools(names: readonly unknown[]): ToolName[] {
  return [...new Set(names.filter((name): name is string => typeof name === "string"))]
    .filter((name) => (WRITE_TOOLS as readonly string[]).includes(name) && agentToolAllowed(name).ok).slice(0, 10) as ToolName[];
}
/** The write tools as the model sees them when it reads the words: name and title, never the deny-list. */
export const writeToolMenu = () => WRITE_TOOLS.map((name) => `${name}: ${toolTitle(name)}`).join("\n");

/**
 * Whether the request needs judgement or writing (2026-11-21: "Skapa en rapport över månadens farligaste tillbud – då kanske
 * det måste vara AI som jobbar?"): ranking by meaning, comparing, summarising, explaining or prose. Then the model does that step over
 * what the rules fetched; the rules alone answer only what they fully can.
 */
const JUDGEMENT = /farligast\w*|allvarligast\w*|viktigast\w*|värst\w*|mest (akut|brådskande|kritisk)\w*|sammanfatta\w*|sammanställ\w* (en |ett )?text|förklara\w*|jämför\w*|analys\w*|bedöm\w*|resonera\w*|tolka\w*|skriv (en |ett )?(text|rapport|sammanfattning|nyhet|inlägg|mejl|brev)|rapport över|varför|trend\w*|mönster|rekommend\w*|föreslå\w*/i;
export const needsJudgement = (text: string) => JUDGEMENT.test(text);

/** The data the words ask for: what the rules fetch first (counts, fields, status) before any judgement. */
export const SOURCE_KEYS = ["work_orders", "deviations", "time", "quotes", "planning", "projects", "customers", "credentials", "invoices"] as const;
export type SourceKey = (typeof SOURCE_KEYS)[number];
export const SOURCE_LABEL: Record<SourceKey, string> = { work_orders: "Arbetsordrar", deviations: "Avvikelser, tillbud och olycksfall", time: "Din tid", quotes: "Offerter", planning: "Planering", projects: "Projekt", customers: "Kunder",
  credentials: "Kalibreringar och intyg", invoices: "Fakturor" };
const SOURCE_WORDS: [RegExp, SourceKey][] = [
  [/tillbud|olycksfall|olyck\w*|avvikelse\w*|riskobservation\w*/i, "deviations"],
  [/arbetsord(er|rar)|jobb(en|et)?\b|uppgift\w*/i, "work_orders"],
  [/\btid(en|rapport)?\b|timmar/i, "time"],
  [/offert\w*/i, "quotes"],
  [/planering\w*|bokning\w*|kalender\w*/i, "planning"],
  [/projekt\w*/i, "projects"],
  [/kund\w*/i, "customers"],
  [/kalibrer\w*|intyg\w*|certifikat\w*|behörighet\w* som (går|löper) ut/i, "credentials"],
  [/\bfaktur(a|or|orna|an)\b|obetald\w*|förfallodag\w*/i, "invoices"],
];
export const sourcesIn = (text: string): SourceKey[] => [...new Set(SOURCE_WORDS.filter(([pattern]) => pattern.test(text)).map(([, key]) => key))];
/** The period the words name, for what the rules fetch. */
export function periodIn(text: string): "week" | "month" | "quarter" | "year" {
  return /kvartal/i.test(text) ? "quarter" : /(^|[\s,.])år(et|ets|s)?([\s,.]|$)/i.test(text) ? "year" : /månad/i.test(text) ? "month" : "week";
}
