/* eslint-disable @typescript-eslint/no-require-imports -- Build helper (CommonJS): the site map of the workspace. */
/*
 * Webbplatskartan (2026-10-24: "en del av avancerade inställningar för produktionsadmin"): reads the repository and
 * works out every page, tab, step and popup and the ways between them – menus, tabs, breadcrumbs and the phone's Mer are
 * counted with the app's own functions (lib/workflow/*, loaded with jiti), not with a copy. Each box and line is marked
 * with the roles that reach it (superadmin, admin, member) from the same functions (menuItemAllowed, settingsTabDefs,
 * PRODUCT_VIEWS …).
 *
 *   node scripts/sitemap/generate.cjs                      writes .next/workflow-sitemap.json (what the app serves)
 *   node scripts/sitemap/generate.cjs --out <file>         writes the data elsewhere
 *   node scripts/sitemap/generate.cjs --html <file>        also writes the stand-alone page (scripts/sitemap/template.html)
 *   node scripts/sitemap/generate.cjs --build              as after `next build`: a failure is a warning, never a failed build
 *   node scripts/sitemap/generate.cjs --observed <file>    marks the map with another robot round (--no-observed: none)
 *
 * Externa tjänster (2026-10-25): the services outside Workflow, from lib/integrations/external-services.ts (and
 * ee/integrations/external-services.ts when ee/ is there), with whose key each uses and where it is administered.
 *
 * Provat i appen (2026-10-24): scripts/sitemap/observed.json – the click robot's round (scripts/sitemap/crawl/,
 * README.md) – marks each box and line as tried in the app or only in the code, adds what only the robot found and lists
 * its findings; Visa som follows the roles the robot actually met.
 *
 * The data is served only to the superadmin (app/api/superadmin/sitemap, lib/sitemap/server.ts); it is never written to
 * public/ or into the client bundle. The script only READS the repository (source files and `git rev-parse`); it never
 * reads .env. WORKFLOW_REPO=<path> maps another checkout.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { createRequire } = require("module");

const ROLES = ["superadmin", "admin", "member"];
const DEFAULT_OUT = (repo) => path.join(repo, ".next", "workflow-sitemap.json");

/** The whole map as data (nodes, edges, anomalies, roles) for the repository at `repo`. */
function buildSitemap({ repo, observed } = {}) {
const REPO = path.resolve(repo || process.env.WORKFLOW_REPO || path.join(__dirname, "..", ".."));
const abs = (r) => path.join(REPO, r);
const read = (r) => fs.readFileSync(abs(r), "utf8");
const LINES = new Map(); // file → its lines, read once
const lines = (r) => { if (!LINES.has(r)) LINES.set(r, read(r).split(/\r?\n/)); return LINES.get(r); };
const isSecretFile = (name) => /(^|[\\/])\.env/.test(name);

// ---------------------------------------------------------------------------------------------------------------
// 1. Appens egna moduler (rena funktioner) via jiti.
const repoRequire = createRequire(path.join(REPO, "package.json"));
const { createJiti } = repoRequire("jiti");
const jiti = createJiti(path.join(REPO, "generator.js"), { fsCache: false, moduleCache: true, alias: { "@": REPO } });
const load = (r) => jiti(abs(r));
const NAV = load("lib/workflow/navigation.ts");
const MENU = load("lib/workflow/menu-items.ts");
const TABS = load("lib/workflow/settings-tabs.ts");
const NM = load("lib/workflow/native-mode.ts");
const NL = load("lib/workflow/native-layout.ts");
const NC = load("lib/workflow/new-choices.ts");
const PERM = load("lib/workflow/permissions.ts");
const TIME_TABS = load("lib/workflow/time-tabs.ts");
const OVERVIEW = load("lib/overview/tabs.ts");

const git = { branch: "?", commit: "?" };
try {
  // The image build has no .git: the map is made all the same, named by the app's version.
  const quiet = { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] };
  git.branch = execFileSync("git", ["-C", REPO, "rev-parse", "--abbrev-ref", "HEAD"], quiet).trim();
  git.commit = execFileSync("git", ["-C", REPO, "rev-parse", "--short", "HEAD"], quiet).trim();
} catch { /* no git */ }
const version = (() => { try { return JSON.parse(read("package.json")).version || "?"; } catch { return "?"; } })();

// Hjälp: radnummer för första träff av ett mönster i en fil.
function lineOf(file, pattern, from = 0) {
  const ls = lines(file);
  for (let i = from; i < ls.length; i++) if (typeof pattern === "string" ? ls[i].includes(pattern) : pattern.test(ls[i])) return i + 1;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Vyer: app/page.tsx (validViews, demoViews, omdirigeringar) och navigation.ts (namn, brödsmulor).
const PAGE = "app/page.tsx";
const pageSrc = read(PAGE);
const pageLines = lines(PAGE);
function arrayAfter(src, marker) {
  const at = src.indexOf(marker);
  if (at < 0) return [];
  const start = src.indexOf("[", at), end = src.indexOf("]", start);
  return [...src.slice(start, end).matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}
const VALID = arrayAfter(pageSrc, "const validViews = [");
const DEMO_VIEWS = arrayAfter(pageSrc, "const demoViews = [");
const VALID_SET = new Set(VALID);
const LABEL = NAV.VIEW_LABEL;
const allViews = [...new Set([...Object.keys(LABEL), ...VALID])];

// Funktionsfärger: --type-* i app/globals.css (ljust = första blocket, mörkt = blocket med dark-värdena).
function typeColors() {
  const css = read("app/globals.css");
  const light = {}, dark = {};
  const blocks = css.split("}");
  let seenLight = false;
  for (const block of blocks) {
    const found = [...block.matchAll(/--type-([a-z-]+):\s*(#[0-9a-fA-F]{3,8})/g)];
    if (!found.length) continue;
    const target = !seenLight ? light : dark;
    for (const m of found) target[m[1]] = m[2];
    seenLight = true;
  }
  return { light, dark, file: "app/globals.css", line: lineOf("app/globals.css", "--type-work-order") };
}
const COLORS = typeColors();

// LINK_TYPE i native-mode.ts (inte exporterad): läses ur källan.
const LINK_TYPE = (() => {
  const src = read("lib/workflow/native-mode.ts");
  const at = src.indexOf("const LINK_TYPE");
  const block = src.slice(at, src.indexOf("};", at));
  return Object.fromEntries([...block.replace(/\/\/.*$/gm, "").matchAll(/([a-z_]+):\s*"([a-z-]+)"/g)].map((m) => [m[1], m[2]]));
})();
// The groups viewGroupLabel (navigation.ts) returns; Start, Inställningar and Produktadministration stay neutral.
const GROUP_TYPE = { Offerter: "quote", Inköp: LINK_TYPE.purchases || "purchase", Projekt: "project", Arbetsordrar: "work-order", Driftronder: "round", Planering: "calendar", Underhåll: "maintenance", Tid: "time", Kunder: "customer", Verktyg: "tools" };
function typeOfView(view) {
  if (LINK_TYPE[view]) return LINK_TYPE[view];
  const group = NAV.viewGroupLabel(view);
  return GROUP_TYPE[group] || "neutral";
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Noder.
const nodes = new Map();
function addNode(node) {
  if (nodes.has(node.id)) { const old = nodes.get(node.id); Object.assign(old, { ...node, refs: [...(old.refs || []), ...(node.refs || [])] }); return old; }
  nodes.set(node.id, { refs: [], ...node });
  return nodes.get(node.id);
}
const ref = (file, line, text) => ({ file, line: line || null, ...(text ? { text: String(text).trim().slice(0, 160) } : {}) });

// Krav på en vy (för villkorade länkar): admin, superadmin, tillval.
const COMPANY = new Set(TABS.COMPANY_VIEWS);
const PRODUCT = new Set(TABS.PRODUCT_VIEWS);
const VIEW_COND = {};
for (const v of COMPANY) VIEW_COND[v] = "admin";
for (const v of PRODUCT) VIEW_COND[v] = "superadmin";
VIEW_COND.project_summary = "admin"; // projectPageAllowed: bara företagsadmin i Cloud
VIEW_COND.forms = "admin"; // canBuildForms: OWNER/ADMIN i Cloud

// Vyernas noder.
const LABEL_LINE = (v) => lineOf("lib/workflow/navigation.ts", new RegExp(`^\\s*${v}:\\s*"`));
const VALID_LINE = (v) => { const at = pageLines.findIndex((l) => l.trim() === `"${v}",`); return at >= 0 ? at + 1 : null; };
for (const view of allViews) {
  addNode({
    id: `v:${view}`, kind: "view", view, label: LABEL[view] || view, address: `/?view=${view}`, type: typeOfView(view),
    refs: [ref("lib/workflow/navigation.ts", LABEL_LINE(view), "VIEW_LABEL"), ...(VALID_SET.has(view) ? [ref(PAGE, VALID_LINE(view), "validViews")] : [])],
    valid: VALID_SET.has(view), inDemo: DEMO_VIEWS.includes(view), phoneHidden: NM.NATIVE_HIDDEN_VIEWS.has(view), cond: VIEW_COND[view] || null,
  });
}
// Varianter av en vy som brödsmulorna behandlar som egna sidor (parametrar i adressen).
const VARIANTS = [
  { id: "v:customers#kund", view: "customers", label: "Kund (kundkortet)", params: { customerId: "X" }, type: "customer" },
  { id: "v:customers#ny", view: "customers", label: "Ny kund", params: { new: "1" }, type: "customer" },
  { id: "v:customers#redigera", view: "customers", label: "Redigera kund", params: { customerId: "X", edit: "1" }, type: "customer" },
  { id: "v:workflow_task#ny-ao", view: "workflow_task", label: "Ny arbetsorder", params: { taskType: "WORK_ORDER" }, type: "work-order" },
  { id: "v:workflow_task#ao", view: "workflow_task", label: "Arbetsorder (ett jobb)", params: { taskType: "WORK_ORDER", taskId: "X" }, type: "work-order" },
  { id: "v:workflow_task#uppgift", view: "workflow_task", label: "Uppgift (ett jobb)", params: { taskId: "X" }, type: "control" },
  { id: "v:workflow_task#formular", view: "workflow_task", label: "Formulär (ny uppgift)", params: { taskType: "FORM" }, type: "control" },
  { id: "v:rounds#ny", view: "rounds", label: "Ny driftrond", params: { new: "1" }, type: "round" },
  { id: "v:rounds#andra", view: "rounds", label: "Ändra rond", params: { edit: "X" }, type: "round" },
  { id: "v:planning#ny", view: "planning", label: "Ny planering", params: { new: "1" }, type: "calendar" },
  { id: "v:project#redigera", view: "project", label: "Redigera projekt", params: { projectId: "X", edit: "1" }, type: "project" },
  { id: "v:project#planering", view: "project", label: "Ny / redigera planering (i projektet)", params: { projectId: "X", new: "1" }, type: "calendar" },
  { id: "v:project#koppla", view: "project", label: "Koppla befintlig uppgift", params: { projectId: "X", link: "1" }, type: "project" },
  { id: "v:place#ny", view: "place", label: "Ny / redigera plats", params: { placeId: "X", new: "1" }, type: "customer" },
  { id: "v:quote#offert", view: "quote", label: "Offert (en offert)", params: { quoteId: "X" }, type: "quote" },
  { id: "v:purchase#inkop", view: "purchase", label: "Inköp (ett inköp)", params: { purchaseId: "X" }, type: "quote" },
  { id: "v:calculators#verktyg", view: "calculators", label: "En kalkylator", params: { tool: "X" }, type: "tools" },
  // An older address of the list (?view=tasks&type=work_orders); the menu's names are Arbetsordrar and its tab Uppgifter.
  { id: "v:tasks#ao", view: "tasks", label: "Uppgifter · filter Arbetsordrar", params: { type: "work_orders" }, type: "work-order" },
  // Found by the click robot (2026-10-24) and missing from the map until then: Nytt formulär, a form, Företagets värden.
  { id: "v:forms#ny", view: "forms", label: "Nytt formulär", params: { new: "1" } },
  { id: "v:forms#formular", view: "forms", label: "Ett formulär (form=…)", params: { form: "X" } },
  { id: "v:calculators#varden", view: "calculators", label: "Företagets värden", params: { tool: "company-values" }, type: "tools" },
  // The sub-pages breadcrumbTrail knows (resor och webbplatskarta, 2026-11-03): each its own box, not folded into the list.
  { id: "v:workflow_task#fran-kund", view: "workflow_task", label: "Jobb öppnat från kundkortet", params: { taskId: "X", fromCustomer: "X" }, type: "work-order" },
  { id: "v:deviations#post", view: "deviations", label: "Avvikelse (en post)", params: { deviation: "X" } },
  { id: "v:deviations#ny", view: "deviations", label: "Rapportera avvikelse", params: { new: "1" } },
  { id: "v:maintenance#post", view: "maintenance", label: "Underhållspost", params: { item: "X" } },
  { id: "v:maintenance#del", view: "maintenance", label: "Maskin eller del (part=…)", params: { part: "X" } },
  // Tavlor (2026-11-18): one board, its editor, and one of the boards' own tables.
  { id: "v:boards#tavla", view: "boards", label: "En tavla", params: { board: "X" } },
  { id: "v:boards#redigera", view: "boards", label: "Redigera tavlan", params: { board: "X", edit: "1" } },
  { id: "v:boards#tabell", view: "boards", label: "En egen tabell", params: { tab: "tables", table: "X" } },
  { id: "v:place_labels#rond", view: "place_labels", label: "Rondens QR-ark", params: { roundId: "X" } },
  { id: "v:administration#person", view: "administration", label: "En persons sida", params: { person: "X" } },
  { id: "v:administration#inbjudan", view: "administration", label: "En inbjudans sida", params: { invitation: "X" } },
  { id: "v:operator_accounts#konto", view: "operator_accounts", label: "Ett operatörskonto", params: { account: "X" } },
  { id: "v:customer_companies#foretag", view: "customer_companies", label: "Ett kundföretags sida", params: { companyId: "X" } },
];
// The Kalkylator's own values screen (lib/calculators/kalkylator/navigation.ts COMPANY_VALUES_TOOL).
const VALUES_TOOL = (read("lib/calculators/kalkylator/navigation.ts").match(/COMPANY_VALUES_TOOL = "([a-z-]+)"/) || [])[1] || "company-values";
for (const variant of VARIANTS) addNode({ ...variant, type: variant.type || typeOfView(variant.view), kind: "variant", address: `/?view=${variant.view}&` + Object.entries(variant.params).map(([k, v]) => `${k}=${v === "X" ? "…" : v}`).join("&"),
  refs: [ref("lib/workflow/navigation.ts", lineOf("lib/workflow/navigation.ts", `case "${variant.view}"`), "breadcrumbTrail")], cond: VIEW_COND[variant.view] || null, phoneHidden: NM.NATIVE_HIDDEN_VIEWS.has(variant.view) });

// Adress → nod. Returnerar { id, dead, reason, step, section }.
function nodeForAddress(raw) {
  const text = raw.replace(/\$\{[^}]*\}/g, "X").replace(/&amp;/g, "&");
  const query = text.slice(text.indexOf("?") + 1);
  const params = {};
  for (const part of query.split("&")) {
    const [k, ...rest] = part.split("=");
    if (!k) continue;
    params[k] = rest.join("=").replace(/[^A-Za-z0-9_\-X].*$/, "") || "X";
  }
  const view = (params.view || "").replace(/[^a-z_]/g, "");
  if (!view) return null;
  if (!VALID_SET.has(view)) return { id: `v:${view}`, view, dead: true, reason: `?view=${view} finns inte i validViews (app/page.tsx)` };
  let id = `v:${view}`;
  const p = params;
  if (view === "customers") id = p.customerId ? (p.edit ? "v:customers#redigera" : "v:customers#kund") : p.new ? "v:customers#ny" : id;
  else if (view === "workflow_task") id = p.fromCustomer && p.taskId ? "v:workflow_task#fran-kund" : p.taskType === "WORK_ORDER" ? (p.taskId ? "v:workflow_task#ao" : "v:workflow_task#ny-ao") : p.taskType === "FORM" && !p.taskId ? "v:workflow_task#formular" : p.taskId ? "v:workflow_task#uppgift" : id;
  else if (view === "rounds") id = p.new ? "v:rounds#ny" : p.edit ? "v:rounds#andra" : id;
  else if (view === "planning") id = p.new || p.edit ? "v:planning#ny" : id;
  else if (view === "project") id = p.link ? "v:project#koppla" : p.new || (p.activityId && p.edit) ? "v:project#planering" : p.edit && !p.activityId ? "v:project#redigera" : id;
  else if (view === "place") id = p.new || p.edit ? "v:place#ny" : id;
  else if (view === "quote") id = p.quoteId ? "v:quote#offert" : id;
  else if (view === "purchase") id = p.purchaseId ? "v:purchase#inkop" : id;
  else if (view === "calculators") id = p.tool === VALUES_TOOL ? "v:calculators#varden" : p.tool ? "v:calculators#verktyg" : id;
  else if (view === "forms") id = p.new ? "v:forms#ny" : p.form ? "v:forms#formular" : id;
  else if (view === "tasks") id = p.type === "work_orders" ? "v:tasks#ao" : id;
  else if (view === "deviations") id = p.deviation ? "v:deviations#post" : p.new ? "v:deviations#ny" : id;
  else if (view === "maintenance") id = p.item ? "v:maintenance#post" : p.part && !p.tab ? "v:maintenance#del" : id; // Förråd keeps the chosen part in its address
  else if (view === "boards") id = p.table ? "v:boards#tabell" : p.board ? (p.edit ? "v:boards#redigera" : "v:boards#tavla") : id;
  else if (view === "place_labels") id = p.roundId ? "v:place_labels#rond" : id;
  else if (view === "administration") id = p.person ? "v:administration#person" : p.invitation ? "v:administration#inbjudan" : id;
  else if (view === "operator_accounts") id = p.account ? "v:operator_accounts#konto" : id;
  else if (view === "customer_companies") id = p.companyId ? "v:customer_companies#foretag" : id;
  return { id, view, step: p.step && p.step !== "X" ? p.step : null, section: p.section && p.section !== "X" ? p.section : null, tab: p.tab && p.tab !== "X" ? p.tab : null, edit: p.edit };
}

// Föräldrar ur brödsmulorna (breadcrumbTrail + parentCrumb).
function parentOf(view, params, selfId) {
  const trail = NAV.breadcrumbTrail({ view, params: params || {} });
  // Den närmaste smulan med länk som inte är sidan själv (Webbplats och utskick › Landningssidan pekar på sig själv).
  for (let i = trail.length - 2; i >= 0; i--) {
    if (!trail[i].href) continue;
    const target = nodeForAddress(trail[i].href);
    if (target && target.id !== (selfId || `v:${view}`)) return target.id;
  }
  return null;
}

// Nivå 1: menyns grupper (MENU_ITEM_GROUPS) och de knappar som har en egen sida som nav.
const GROUPS = {
  "g:arbete": { label: "Arbete", note: "Menygruppen Arbete (MENU_ITEM_GROUPS)", type: "project" },
  "g:kunder": { label: "Kunder och affär", note: "Menygruppen Kunder och affär (MENU_ITEM_GROUPS)", type: "customer" },
  "g:verktyg": { label: "Verktyg", note: "Menygruppen Verktyg med navsidan ?view=tools", type: "tools" },
  "g:assistent": { label: "Assistent", note: "Menygruppen Assistent (HINTEK AI)", type: "project" },
  // Planering (2026-11-01): one menu button, its three views Kalender · Tidplan · Kapacitet as tabs (planningTabs).
  "g:planering": { label: "Planering", note: "Menyknappen Planering med flikarna Kalender · Tidplan · Kapacitet (planningTabs, features/workflow/section-tabs.tsx)", type: "calendar", parent: "g:arbete", menuLabel: "Arbete" },
  // Företaget (2026-11-02, MENU_ITEM_GROUPS): Användare and Operatörskonton, as in the menu's own groups. On a computer the
  // menu has no such group – Användare is a tab of Inställningar and Operatörskonton a button on it, as the breadcrumbs say.
  "g:foretaget": { label: "Företaget", note: "Menygruppen Företaget (MENU_ITEM_GROUPS): rader i Mer på telefonen; på datorn är Användare en flik i Inställningar och Operatörskonton en knapp där", type: "neutral", cond: "admin" },
  "g:installningar": { label: "Inställningar", note: "Menyknappen Inställningar (längst ned i menyn)", type: "neutral" },
  "g:produkt": { label: "Produktadministration", note: "Bara superadmin", type: "neutral", cond: "superadmin" },
  "g:konto": { label: "Konto och start", note: "Notiser, Hjälp och Kom igång – nås från toppraden och profilmenyn", type: "notice" },
};
const groupLine = (title) => lineOf("lib/workflow/menu-items.ts", `title: "${title}"`);
for (const [id, g] of Object.entries(GROUPS)) addNode({ id, kind: "group", label: g.label, type: g.type, note: g.note, cond: g.cond || null, parent: g.parent || "v:stats",
  refs: [ref("lib/workflow/menu-items.ts", groupLine(g.menuLabel || g.label) || lineOf("lib/workflow/menu-items.ts", "MENU_ITEM_GROUPS"), "MENU_ITEM_GROUPS")] });
// Planering's views by the names of their tabs (planningTabs: page("planning", "Kalender", …)); VIEW_LABEL names all three "Planering".
const PLANNING_TAB_LABEL = Object.fromEntries([...read("features/workflow/section-tabs.tsx").matchAll(/page\("(planning|project_planning|capacity)", "([^"]+)"/g)].map((m) => [m[1], m[2]]));
const FORETAGET = new Set((MENU.MENU_ITEM_GROUPS.find((group) => group.title === "Företaget")?.items || []).map((item) => item.key));
const groupOfTop = (view) => {
  const key = MENU.menuKeyOfView(view);
  if (view === "customers" || (key && MENU.MENU_ITEM_GROUPS[1].items.some((i) => i.key === key))) return "g:kunder";
  if (view === "tools") return "g:verktyg";
  if (view === "settings" || view === "setup") return "g:installningar";
  if (view === "customer_companies") return "g:produkt";
  if (key && MENU.MENU_ITEM_GROUPS[0].items.some((i) => i.key === key)) return "g:arbete";
  return "g:konto";
};

// Föräldrar för vyer och varianter.
for (const node of nodes.values()) {
  if (node.kind === "view") {
    if (node.view === "stats") { node.parent = null; continue; }
    const parent = parentOf(node.view);
    node.parent = parent === "v:stats" || !parent ? groupOfTop(node.view) : parent;
    if (!node.valid) node.parent = node.parent || "g:konto";
    if (PLANNING_TAB_LABEL[node.view]) { node.parent = "g:planering"; node.label = `Planering · ${PLANNING_TAB_LABEL[node.view]}`; node.type = "calendar"; }
    if (FORETAGET.has(node.view)) node.parent = "g:foretaget";
  } else if (node.kind === "variant") {
    const parent = parentOf(node.view, node.params, node.id);
    node.parent = parent && parent !== node.id ? parent : `v:${node.view}`;
    // A variant whose trail names no page above it (Rapportera avvikelse, an older filter address) lies under its own view.
    if (node.parent === "v:stats") node.parent = `v:${node.view}`;
  }
}
// "Plats" har ingen egen sida (leder vidare till kundkortet), men som adress ligger den under Kunder.
// Assistentens panel och telefonens ingångar.
const VIRTUAL = [
  { id: "x:ai", kind: "popup", label: "HINTEK AI (panel)", parent: "g:assistent", type: "project", cond: "tillval", note: "Öppnas som panel från ikonen i den flytande navigeringen, flikraden och Mer – ingen egen adress", refs: [ref("components/floating-nav.tsx", lineOf("components/floating-nav.tsx", 'data-testid="floating-nav-assistant"'), "ikonen HINTEK AI")] },
  { id: "x:sok", kind: "popup", label: "Sök", parent: "g:konto", type: "neutral", note: "Sökfönstret (toppraden, flikraden, Mer)", refs: [ref("features/kfid/global-search.tsx", lineOf("features/kfid/global-search.tsx", "<Modal"), "Modal Sök")] },
  { id: "x:ny", kind: "popup", label: "Ny (telefonens lista)", parent: "e:flikrad", type: "new", note: "Ny-knappen i flikraden och Hem-rutan Nytt jobb", refs: [ref("components/native/tab-bar.tsx", lineOf("components/native/tab-bar.tsx", 'open === "new" ?'), "Ny-arket")] },
  { id: "x:kalkylator", kind: "popup", label: "Kalkylator (Trefaseffekt)", parent: "v:calculators", type: "tools", note: "Toppradens kalkylatorknapp; i Mer under Verktyg", refs: [ref("features/calculators/three-phase-calculator.tsx", lineOf("features/calculators/three-phase-calculator.tsx", "<Modal"), "Modal")] },
];
// Ingångar (nivå 0): sidomenyn på datorn, flikraden och Mer på telefonen; servern (notiser, mejl, API).
const ENTRIES = [
  { id: "e:dator", label: "Sidomenyn (dator)", type: "neutral", note: "components/app-shell.tsx: Översikt, menygrupperna, Produktadministration, Inställningar; toppraden: Notiser, profilmenyn: Hjälp", refs: [ref("components/app-shell.tsx", lineOf("components/app-shell.tsx", 'aria-label="Huvudmeny"'), "sidebar")] },
  { id: "e:flikrad", label: "Flikraden (telefon)", type: "neutral", note: "Nivå 1 på telefon: upp till fyra valda knappar + Mer (lib/workflow/native-layout.ts)", refs: [ref("components/native/tab-bar.tsx", lineOf("components/native/tab-bar.tsx", 'aria-label="Flikrad"'), "NativeTabBar")] },
  { id: "e:mer", label: "Mer (telefon)", type: "neutral", parent: "e:flikrad", note: "Hela menyn som lista (nativeMoreSections → nativeMoreTools → nativeMoreTiles)", refs: [ref("lib/workflow/native-mode.ts", lineOf("lib/workflow/native-mode.ts", "export function nativeMoreSections"), "nativeMoreSections")] },
  { id: "e:server", label: "Servern: notiser, mejl, API", type: "notice", note: "Länkar som skapas på servern (notiser, mejl, påminnelser, API-svar)", refs: [] },
  { id: "e:publik", label: "Publika sidor (utanför appen)", type: "neutral", note: "app/**/page.tsx utanför arbetsytan", refs: [] },
  { id: "e:delad", label: "Delade komponenter och arbetsytan", type: "neutral", note: "Filer som används av många sidor; länkarna visas härifrån", refs: [] },
];
for (const e of ENTRIES) addNode({ kind: "entry", parent: e.parent || null, ...e });
for (const v of VIRTUAL) addNode(v);

// Publika sidor: app/**/page.tsx (utom arbetsytan), plus landningssidan och demon.
function walk(dir, out = []) {
  if (!fs.existsSync(abs(dir))) return out; // ee/ is missing in the community edition
  for (const entry of fs.readdirSync(abs(dir), { withFileTypes: true })) {
    const r = `${dir}/${entry.name}`;
    if (entry.isDirectory()) { if (!["node_modules", ".next", "tests"].includes(entry.name)) walk(r, out); }
    else if (!isSecretFile(entry.name)) out.push(r);
  }
  return out;
}
const PUBLIC_LABEL = { "/login": "Logga in", "/register": "Skapa konto", "/forgot-password": "Glömt lösenord", "/reset-password": "Nytt lösenord", "/invite": "Inbjudan", "/invite/[token]": "Inbjudan (länk)",
  "/legal/[document]": "Juridiska dokument", "/cookies": "Kakor", "/oauth/authorize": "OAuth-godkännande (MCP)", "/offert/[token]": "Offert till kund (länk)", "/unsubscribed": "Avregistrerad", "/newsletter/confirm": "Bekräfta nyhetsbrev", "/rapportera": "Rapportera fel eller förslag",
  "/verify-email": "Bekräfta e-post", "/dashboard": "Gamla startsidan /dashboard", "/design-lab": "Designlabb", "/design-lab/arbetsorder-hallare": "Förslag: arbetsordern som hållare", "/design-lab/operator": "Förslag: operatörssidan", "/form-preview": "Formulärförhandsvisning", "/plc-simulator": "PLC-simulator (eget fönster)", "/operator/[key]": "Operatörssidan /operator/…", "/p/[id]": "QR-etikett /p/…", "/qa": "QA-roller (lokalt)" };
const pageFiles = walk("app").filter((f) => /\/page\.tsx$/.test(f) && f !== "app/page.tsx");
const routeFiles = walk("app").filter((f) => /\/route\.ts$/.test(f) && !f.startsWith("app/api/"));
const publicPath = (f) => "/" + f.replace(/^app\//, "").replace(/\/(page\.tsx|route\.ts)$/, "").split("/").filter((s) => !/^\(.*\)$/.test(s)).join("/");
for (const f of pageFiles) {
  const p = publicPath(f);
  addNode({ id: `p:${p}`, kind: "public", label: PUBLIC_LABEL[p] || p, address: p, type: "neutral", parent: "e:publik", refs: [ref(f, lineOf(f, "export default"), "page.tsx")] });
}
for (const f of routeFiles) {
  const p = publicPath(f);
  addNode({ id: `p:${p}`, kind: "public", label: p === "/demo" ? "Demo (/demo)" : p === "/m/[id]" ? "Utskick i webbläsaren /m/…" : p, address: p, type: "neutral", parent: "e:publik", refs: [ref(f, lineOf(f, "export"), "route.ts")] });
}
addNode({ id: "p:/", kind: "public", label: "Landningssidan /", address: "/", type: "neutral", parent: "e:publik", cond: "tillval", refs: [ref(PAGE, lineOf(PAGE, "serverExtensions.landing({ superadmin: user?.role"), "landing")] });

// Steg (step=) och avsnitt (section=), nivå 4.
const STEP_SETS = [
  { parent: "v:workflow_task#uppgift", keys: NM.JOB_SCREENS, titles: NM.JOB_SCREEN_TITLE, file: "lib/workflow/native-mode.ts", marker: "export const JOB_SCREENS" },
  { parent: "v:project", keys: NM.PROJECT_SCREENS, titles: NM.PROJECT_SCREEN_TITLE, file: "lib/workflow/native-mode.ts", marker: "export const PROJECT_SCREENS" },
  { parent: "v:customers#kund", keys: NM.CUSTOMER_SCREENS, titles: NM.CUSTOMER_SCREEN_TITLE, file: "lib/workflow/native-mode.ts", marker: "export const CUSTOMER_SCREENS" },
  { parent: "v:time", keys: NM.TIME_SCREENS, titles: NM.TIME_SCREEN_TITLE, file: "lib/workflow/native-mode.ts", marker: "export const TIME_SCREENS" },
  { parent: "v:settings", keys: NM.SETTINGS_SECTIONS, titles: NM.SETTINGS_SECTION_TITLE, file: "lib/workflow/native-mode.ts", marker: "export const SETTINGS_SECTIONS" },
];
// Hjälpens skärmar (features/workflow/native-help.tsx).
{
  const f = "features/workflow/native-help.tsx";
  const keys = [], titles = {};
  lines(f).forEach((l) => { for (const m of l.matchAll(/\{ key: "([a-z]+)", title: "([^"]+)"/g)) { keys.push(m[1]); titles[m[1]] = m[2]; } });
  STEP_SETS.push({ parent: "v:help", keys, titles, file: f, marker: "{ key:" });
}
// Driftronder på telefonen: Ny rond och ronden är egna skärmar; Ändra rond är rondens skärm med &edit=1 (features/workflow/form-rounds.tsx roundUrl).
STEP_SETS.push({ parent: "v:rounds", keys: ["ny", "rond"], titles: { ny: "Ny rond (telefon)", rond: "Ronden (telefon)" }, file: "features/workflow/form-rounds.tsx", marker: "const roundUrl" });
// Egenkontrollens flikar (&tab=, features/self-inspection/self-inspection-page.tsx TABS); de tre sista bara för den som redigerar.
{
  const f = "features/self-inspection/self-inspection-page.tsx";
  const src = read(f), at = src.indexOf("const TABS:"), block = at >= 0 ? src.slice(at, src.indexOf("];", at)) : "";
  const keys = [], titles = {}, conds = {};
  for (const m of block.matchAll(/\{ key: "([a-z]+)", label: "([^"]+)"([^}]*)\}/g)) { keys.push(m[1]); titles[m[1]] = m[2]; if (/admin: true/.test(m[3])) conds[m[1]] = "admin"; }
  if (keys.length) STEP_SETS.push({ parent: "v:self_inspection", keys, titles, conds, file: f, marker: "const TABS:", param: "tab" });
}
// The tab rows of Översikt, Tid and Underhåll (&tab=, one address per tab): who sees a tab follows the page's own rule
// (overviewTabs, timeTabsFor), so the roles are worked out below once ACCESS is known; Underhåll's tabs follow the page.
STEP_SETS.push({ parent: "v:stats", keys: [...OVERVIEW.OVERVIEW_TABS], titles: Object.fromEntries(OVERVIEW.OVERVIEW_TABS.map((key) => [key, `Flik ${OVERVIEW.OVERVIEW_TAB_LABEL[key]}`])), file: "lib/overview/tabs.ts", marker: "export const OVERVIEW_TABS", param: "tab", tabRoles: "overview" });
STEP_SETS.push({ parent: "v:time", keys: [...TIME_TABS.TIME_TABS], titles: Object.fromEntries(TIME_TABS.TIME_TABS.map((key) => [key, `Flik ${TIME_TABS.TIME_TAB_LABEL[key]}`])), file: "lib/workflow/time-tabs.ts", marker: "export const TIME_TABS", param: "tab", tabRoles: "time" });
STEP_SETS.push({ parent: "v:boards", keys: ["boards", "tables", "screens", "links"], titles: { boards: "Flik Tavlor", tables: "Flik Tabeller", screens: "Flik Skärmar", links: "Flik Länkar" }, file: "lib/boards/tabs.ts", marker: "export const BOARDS_TABS", param: "tab" });
STEP_SETS.push({ parent: "v:maintenance", keys: ["machines", "store"], titles: { machines: "Flik Anläggning", store: "Flik Förråd" }, file: "features/workflow/section-tabs.tsx", marker: "export function maintenanceTabs", param: "tab" });
STEP_SETS.push({ parent: "v:stats", keys: ["home", "tabs"], titles: { home: "Redigera hemskärmen (edit=home)", tabs: "Redigera flikraden (edit=tabs)" }, file: "lib/workflow/native-mode.ts", marker: "edit=home", param: "edit" });
const STEP_KNOWN = {};
const TAB_KNOWN = {}; // &tab= (Egenkontroll): a tab of the page, on both devices
for (const set of STEP_SETS) {
  const tab = set.param === "tab";
  (tab ? TAB_KNOWN : STEP_KNOWN)[set.parent] = new Set(set.keys);
  for (const key of set.keys) {
    const ln = lineOf(set.file, new RegExp(`\\b${key}\\b`), (lineOf(set.file, set.marker) || 1) - 1);
    addNode({ id: `${set.parent}/${tab ? "tab" : "step"}:${key}`, kind: "step", label: set.titles[key] || key, step: key, parent: set.parent, address: `${nodes.get(set.parent)?.address || ""}&${set.param || "step"}=${key}`,
      type: nodes.get(set.parent)?.type || "neutral", refs: [ref(set.file, ln, `${set.param || "step"}=${key}`)], cond: set.conds?.[key] || null, ...(set.tabRoles ? { tabRoles: set.tabRoles } : {}),
      phoneOnlyStep: !tab && set.param !== "edit" && set.parent !== "v:settings" && set.parent !== "v:help" });
  }
}
// Avsnitt: flikarnas alias och SettingsPart/SettingsGroup-ankarna.
const ALL_SETTINGS = TABS.settingsTabDefs({ admin: true, cloud: true, ai: true, integrations: true, credits: true });
const ALL_PRODUCT = TABS.productTabDefs({ landingEditor: true, pricing: true, ai: true, serverKeys: true, landingPublished: true });
const PART_IDS = new Map(); // id → [ref]
for (const f of walk("features").concat(walk("ee"), walk("components")).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))) {
  lines(f).forEach((l, i) => { for (const m of l.matchAll(/Settings(?:Part|Group) id="([a-z-]+)"/g)) { if (!PART_IDS.has(m[1])) PART_IDS.set(m[1], []); PART_IDS.get(m[1]).push(ref(f, i + 1)); } });
}
{ // SettingsGroup id={`keys-${group.id}`} i integration-keys.tsx
  const f = "features/integrations/integration-keys.tsx";
  if (fs.existsSync(abs(f))) lines(f).forEach((l, i) => { for (const m of l.matchAll(/\{ id: "([a-z]+)", title: "[^"]+", icon:/g)) { const id = `keys-${m[1]}`; if (!PART_IDS.has(id)) PART_IDS.set(id, []); PART_IDS.get(id).push(ref(f, i + 1, "keys-${group.id}")); } });
}
{ // Kopplingar's area pages (2026-10-31): ?view=advanced&section=<area>, one per entry of CONNECTION_AREAS.
  const f = "lib/integrations/connection-areas.ts";
  if (fs.existsSync(abs(f))) lines(f).forEach((l, i) => { for (const m of l.matchAll(/{ key: "([a-z]+)", title: "[^"]+", description:/g)) { if (!PART_IDS.has(m[1])) PART_IDS.set(m[1], []); PART_IDS.get(m[1]).push(ref(f, i + 1, "CONNECTION_AREAS")); } });
}
function tabOf(view) {
  for (const tabs of [ALL_SETTINGS, ALL_PRODUCT]) { const found = TABS.activeTab(tabs, view); if (found) return found.tab.key; }
  return null;
}
function sectionNode(tabView, part, origin) {
  const id = `v:${tabView}/section:${part}`;
  if (!nodes.has(id)) addNode({ id, kind: "section", label: `Avsnitt ${part}`, section: part, parent: `v:${tabView}`, address: `/?view=${tabView}&section=${part}`, type: nodes.get(`v:${tabView}`)?.type || "neutral",
    refs: [...(PART_IDS.get(part) || []), ...(origin ? [origin] : [])], dead: !PART_IDS.has(part), cond: VIEW_COND[tabView] || null, phoneHidden: NM.NATIVE_HIDDEN_VIEWS.has(tabView) });
  return id;
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Kanter.
const edges = new Map();
function addEdge(from, to, cat, r, options = {}) {
  if (!from || !to || from === to) return;
  // `roles`: who is offered this way at all (a menu button, a tab, a row in Mer); without it, everyone who reaches both ends.
  const { roles, ...extra } = options;
  const key = `${from}|${to}|${cat}|${extra.device || ""}|${extra.cond || ""}`;
  if (!edges.has(key)) edges.set(key, { from, to, cat, refs: [], ...extra });
  const e = edges.get(key);
  e.ownRoles = [...new Set([...(e.ownRoles || []), ...(roles || ROLES)])];
  if (r && !e.refs.some((x) => x.file === r.file && x.line === r.line)) e.refs.push(r);
  if (extra.dead) e.dead = true;
  if (extra.reason && !e.reason) e.reason = extra.reason;
  if (extra.label && !e.label) e.label = extra.label;
  if (extra.also) e.also = [...new Set([...(e.also || []), ...extra.also])].filter((x) => x !== from);
}
// Adress → ruta: { to, view, dead, reason, missing } – `missing` is the box to create when the map has none (a step, a tab or
// a page the code links to but does not know). Shared by the code's links (linkTo) and the robot's addresses (observed.json).
function resolveAddress(address) {
  const t = nodeForAddress(address);
  if (!t) return null;
  if (t.dead) return { to: t.id, view: t.view, dead: true, reason: t.reason, missing: nodes.has(t.id) ? null : { id: t.id, kind: "dead", label: `?view=${t.view} (finns inte)`, view: t.view, parent: "g:konto", type: "neutral" } };
  let to = t.id;
  if (t.section) {
    const tab = tabOf(t.view) || t.view;
    const known = PART_IDS.has(t.section);
    return { to: `v:${tab}/section:${t.section}`, view: t.view, section: { tab, part: t.section }, ...(known ? {} : { dead: true, reason: `section=${t.section} finns inte som SettingsPart/SettingsGroup` }) };
  }
  if (t.step) {
    const base = STEP_KNOWN[to] ? to : t.view === "workflow_task" ? "v:workflow_task#uppgift" : STEP_KNOWN[`v:${t.view}`] ? `v:${t.view}` : to === "v:customers" && STEP_KNOWN["v:customers#kund"] ? "v:customers#kund" : to;
    if (STEP_KNOWN[base] && STEP_KNOWN[base].has(t.step)) return { to: `${base}/step:${t.step}`, view: t.view };
    const id = `${base}/step:${t.step}`;
    return { to: id, view: t.view, dead: true, reason: `step=${t.step} är inte en känd skärm för ${base.replace(/^v:/, "")}`,
      missing: nodes.has(id) ? null : { id, kind: "step", label: `step=${t.step}`, step: t.step, parent: base, address: `${nodes.get(base)?.address}&step=${t.step}`, type: nodes.get(base)?.type || "neutral" } };
  }
  if (t.tab && TAB_KNOWN[to]) {
    const id = `${to}/tab:${t.tab}`;
    if (TAB_KNOWN[to].has(t.tab)) return { to: id, view: t.view };
    return { to: id, view: t.view, dead: true, reason: `tab=${t.tab} är inte en flik i ${nodes.get(to)?.label || t.view} (sidan visar första fliken)`,
      missing: nodes.has(id) ? null : { id, kind: "step", label: `tab=${t.tab}`, step: t.tab, parent: to, address: `${nodes.get(to)?.address}&tab=${t.tab}`, type: nodes.get(to)?.type || "neutral" } };
  }
  if (t.edit && STEP_KNOWN[to] && STEP_KNOWN[to].has(t.edit)) to = `${to}/step:${t.edit}`;
  return { to, view: t.view };
}
// Länk till en adress (skapar steg-/avsnittsnoder och markerar döda länkar).
function linkTo(from, address, cat, r, extra = {}) {
  const t = resolveAddress(address);
  if (!t) return;
  if (t.missing) addNode({ ...t.missing, refs: [r], dead: true });
  if (t.dead && nodes.get(t.to)?.kind === "dead") { addEdge(from, t.to, cat, r, { ...extra, dead: true, reason: t.reason }); return; }
  let to = t.to;
  if (t.section) to = sectionNode(t.section.tab, t.section.part, r);
  if (t.dead) Object.assign(extra, { dead: true, reason: t.reason });
  const cond = extra.cond || nodes.get(to)?.cond || (t.view && VIEW_COND[t.view]) || null;
  addEdge(from, to, cat, r, { ...extra, ...(cond ? { cond } : {}) });
}

// 4a. Trädet: förälder → barn.
for (const n of nodes.values()) if (n.parent) addEdge(n.parent, n.id, "tree", null);

// 4b. Sidomenyn på datorn (resolveMenu med full åtkomst), plus vad som döljs för en medarbetare och utan tillval.
const SHELL = "components/app-shell.tsx";
const owner = { memberRole: "OWNER", workflowPermissions: PERM.defaultWorkflowPermissionProfile(), canBuildForms: true, localStorageMode: false, ai: true, importPage: true, invoicingOn: true };
const fieldPreset = PERM.workflowPermissionPresets.find((p) => p.id === "field");
const member = { ...owner, memberRole: "MEMBER", canBuildForms: false, workflowPermissions: fieldPreset ? fieldPreset.profile : PERM.defaultWorkflowPermissionProfile() };
const noExtras = { ...owner, ai: false, importPage: false };
const local = { ...owner, localStorageMode: true };
// The map's three roles (2026-10-24: "prodadmin, kundföretag eller användare"): the product owner (the superadmin,
// who is also the owner of HINTEK's own company), a customer company's admin, and a member with the preset Utföra arbete.
const ACCESS = { superadmin: owner, admin: { ...owner, memberRole: "ADMIN" }, member };
const rolesWhere = (allowed) => ROLES.filter((role) => allowed(role));
const menuRoles = (key) => rolesWhere((role) => MENU.menuItemAllowed(key, ACCESS[role]));
function menuCond(key) {
  if (!MENU.menuItemAllowed(key, noExtras) && MENU.menuItemAllowed(key, owner)) return "tillval";
  if (!MENU.menuItemAllowed(key, member) && MENU.menuItemAllowed(key, owner)) return "admin";
  if (!MENU.menuItemAllowed(key, local)) return "cloud";
  return null;
}
const shellMenuRef = ref(SHELL, lineOf(SHELL, "sidebarGroups.map((group, index)"), "sidomenyn");
linkTo("e:dator", "/?view=stats", "menu", ref(SHELL, lineOf(SHELL, '{navItem("stats")}'), 'navItem("stats")'), { label: "Översikt", device: "desktop" });
// HINTEK AI on a computer (2026-11-02): the icon in the floating navigation, not a row of the menu.
addEdge("e:dator", "x:ai", "menu", ref("components/floating-nav.tsx", lineOf("components/floating-nav.tsx", 'data-testid="floating-nav-assistant"'), "ikonen HINTEK AI"), { label: "HINTEK AI (flytande ikon)", device: "desktop", cond: "tillval", roles: menuRoles("ai") });
for (const group of MENU.sidebarMenu(MENU.resolveMenu(owner, { hidden: [], shortcuts: [] }))) {
  for (const entry of group) {
    if (entry.type === "link") {
      const cond = menuCond(entry.key);
      linkTo("e:dator", MENU.menuItemHref(entry.key, true), "menu", shellMenuRef, { label: MENU.MENU_LABEL[entry.key], device: "desktop", roles: menuRoles(entry.key), ...(cond ? { cond } : {}) });
      const createOnly = MENU.menuItemHref(entry.key, false);
      if (createOnly !== MENU.menuItemHref(entry.key, true))
        linkTo("e:dator", createOnly, "menu", ref("lib/workflow/menu-items.ts", lineOf("lib/workflow/menu-items.ts", `  ${entry.key}: "/?view=`), "MENU_ITEM_CREATE"), { label: `${MENU.MENU_LABEL[entry.key]} (utan läsrätt → Ny …)`, device: "desktop", cond: "behörighet", roles: ["member"] });
    } else if (entry.type === "group") {
      linkTo("e:dator", "/?view=tools", "menu", ref(SHELL, lineOf(SHELL, 'navItem("tools"'), "Verktyg"), { label: "Verktyg", device: "desktop" });
      for (const child of entry.children) { const cond = menuCond(child); linkTo("e:dator", `/?view=${child}`, "menu", ref(SHELL, lineOf(SHELL, "entry.children.map"), "Verktygs fällda rader"), { label: MENU.MENU_LABEL[child], device: "desktop", roles: menuRoles(child), ...(cond ? { cond } : {}) }); }
    }
  }
}
// Genvägar direkt i menyn (MENU_SHORTCUTTABLE) – en andra väg till samma sida när den är vald.
for (const key of MENU.MENU_SHORTCUTTABLE) linkTo("e:dator", `/?view=${key}`, "menu", ref(SHELL, lineOf(SHELL, 'entry.type === "shortcut"'), "menyval: genväg"), { label: `${MENU.MENU_LABEL[key]} (genväg, eget val)`, device: "desktop", cond: "eget val", roles: menuRoles(key) });
linkTo("e:dator", "/?view=customer_companies", "menu", ref(SHELL, lineOf(SHELL, 'navItem("customer_companies"'), "Produktadministration"), { label: "Produktadministration", device: "desktop", cond: "superadmin", roles: ["superadmin"] });
linkTo("e:dator", "/?view=settings", "menu", ref(SHELL, lineOf(SHELL, 'navItem("settings", settingsActive)'), "Inställningar"), { label: "Inställningar", device: "desktop" });
linkTo("e:dator", "/?view=notifications", "menu", ref(SHELL, lineOf(SHELL, 'route("notifications")'), "Notiser i toppraden"), { label: "Notiser (toppraden)", device: "both" });
linkTo("e:dator", "/?view=help", "menu", ref(SHELL, lineOf(SHELL, 'data-testid="profile-help"'), "profilmenyn"), { label: "Hjälp (profilmenyn)", device: "desktop" });
addEdge("e:dator", "x:sok", "menu", ref(SHELL, lineOf(SHELL, "GlobalSearch") || lineOf(SHELL, "search"), "Sök i toppraden"), { label: "Sök (toppraden)", device: "desktop" });
addEdge("e:dator", "x:kalkylator", "menu", ref(SHELL, lineOf(SHELL, "Calculator") , "kalkylatorknappen"), { label: "Kalkylator (toppraden)", device: "desktop" });
// Bottenraden på dator/surfplatta i smalt fönster (nivå 2–3): Hem, Sök, Ny, Spara, Meny.
linkTo("e:dator", "/?view=stats", "menu", ref(SHELL, lineOf(SHELL, 'case "home": return <Link key="home"'), "bottenraden Hem"), { label: "Hem (bottenraden, smalt fönster)", device: "desktop" });
linkTo("e:dator", "/?view=new_task", "menu", ref(SHELL, lineOf(SHELL, 'href={route("new_task")}'), "bottenraden Ny"), { label: "Ny (bottenraden, smalt fönster)", device: "desktop" });

// 4c. Telefonen: flikraden (alla möjliga knappar, standard markerad), Mer och Hem-rutorna.
const TB = "components/native/tab-bar.tsx";
const NLF = "lib/workflow/native-layout.ts";
for (const key of NL.TAB_KEYS) {
  const item = NL.TAB[key];
  const isDefault = NL.DEFAULT_TABS.includes(key);
  const r = ref(NLF, lineOf(NLF, new RegExp(`^\\s*${key}: \\{ label:`), lineOf(NLF, "export const TAB:")), `TAB.${key}`);
  const extra = { label: `${item.label}${isDefault ? " (standard)" : " (eget val)"}`, device: "phone", ...(isDefault ? {} : { cond: "eget val" }) };
  if (item.view) linkTo("e:flikrad", `/?view=${item.view}`, "phone", r, extra);
  else if (item.action === "new") addEdge("e:flikrad", "x:ny", "phone", r, extra);
  else if (item.action === "ai") addEdge("e:flikrad", "x:ai", "phone", r, { ...extra, cond: "tillval" });
  else if (item.action === "search") addEdge("e:flikrad", "x:sok", "phone", r, extra);
}
addEdge("e:flikrad", "e:mer", "phone", ref(TB, lineOf(TB, 'data-testid="native-tab-more"'), "Mer"), { label: "Mer (alltid sist)", device: "phone" });
addEdge("e:flikrad", "v:stats/step:tabs", "phone", ref(TB, lineOf(TB, "edit=tabs"), "håll in flikraden"), { label: "Håll in → redigera flikraden", device: "phone" });
// Ny-listan.
for (const choice of NC.nativeNewChoices({ workOrder: true, task: true, project: true, customer: true, quote: true, round: true, purchase: true }))
  if (choice.href) linkTo("x:ny", choice.href, "phone", ref("lib/workflow/new-choices.ts", lineOf("lib/workflow/new-choices.ts", choice.href), `Ny: ${choice.label}`), { label: choice.label, device: "phone" });
// Mer: som skalet räknar fram det (content 1 = Enkel; content 3 = Visa mer/Visa allt).
function merRows(content, access, productAdmin) {
  const groups = MENU.resolveMenu(access, { hidden: [], shortcuts: [] });
  const canRead = { quotes: true, projects: true, work_orders: true, tasks: true };
  const sections = NM.nativeMoreTools(NM.nativeMoreSections(groups, { canRead, productAdmin }), content);
  const tiled = NM.nativeMoreTiles(sections, { jobsTab: true });
  return [...tiled.tiles, ...tiled.sections.flatMap((s) => s.rows.map((row) => ({ ...row, section: s.title })))];
}
const mer1 = merRows(1, owner, true), mer3 = merRows(3, owner, true);
const mer1Keys = new Set(mer1.map((r) => r.key));
// Who has each row in Mer: the same function for each role's menu (Produktadministration only for the superadmin).
const merByRole = Object.fromEntries(ROLES.map((role) => [role, new Set(merRows(3, ACCESS[role], role === "superadmin").map((row) => row.key))]));
const NMF = "lib/workflow/native-mode.ts";
for (const row of mer3) {
  const onlyMore = !mer1Keys.has(row.key);
  const r = ref(NMF, lineOf(NMF, `key: "${row.key}"`) || lineOf(NMF, "export function nativeMoreSections"), `Mer: ${row.label}`);
  const cond = row.key === "customer_companies" ? "superadmin" : onlyMore ? "visa mer" : (row.href ? null : null);
  const extra = { label: `${row.label}${row.section ? ` (${row.section})` : ""}${onlyMore ? " – bara med Visa mer" : ""}`, device: "phone", roles: rolesWhere((role) => merByRole[role].has(row.key)), ...(cond ? { cond } : {}) };
  if (row.href) linkTo("e:mer", row.href, "phone", r, extra);
  else if (row.action === "ai") addEdge("e:mer", "x:ai", "phone", r, { ...extra, cond: "tillval" });
  else if (row.action === "calculator") addEdge("e:mer", "x:kalkylator", "phone", r, extra);
}
addEdge("e:mer", "x:sok", "phone", ref(TB, lineOf(TB, "native-more-search"), "Sök i Mer"), { label: "Sök", device: "phone" });
// Hem-rutorna (nivå 1, telefon).
for (const key of NL.HOME_TILE_KEYS) {
  const tile = NL.HOME_TILE[key];
  const isDefault = NL.DEFAULT_HOME_TILES.includes(key);
  const r = ref(NLF, lineOf(NLF, new RegExp(`^\\s*${key}: \\{ label:`), lineOf(NLF, "export const HOME_TILE")), `HOME_TILE.${key}`);
  const extra = { label: `Hem-ruta ${tile.label}${isDefault ? "" : " (eget val)"}`, device: "phone", ...(isDefault ? {} : { cond: "eget val" }) };
  if (tile.view) linkTo("v:stats", `/?view=${tile.view}`, "phone", r, extra);
  else if (tile.action === "new") addEdge("v:stats", "x:ny", "phone", r, extra);
  else if (tile.action === "ai") addEdge("v:stats", "x:ai", "phone", r, { ...extra, cond: "tillval" });
}

// 4d. Omdirigeringar: app/page.tsx, demons karta, arbetsytans router.replace, gamla sidor och flikarnas alias.
{
  for (let i = 0; i < pageLines.length; i++) {
    const l = pageLines[i];
    if (!/redirect\(\s*["`]\/\?view=/.test(l)) continue;
    const stmt = (/^\s*if \(/.test(l) ? l : `${pageLines[i - 1] || ""} ${l}`);
    const sources = [...stmt.matchAll(/view === "([a-z_]+)"/g)].map((m) => m[1]);
    const target = (l.match(/redirect\(\s*["`](\/\?view=[^"`]+)["`]/) || [])[1];
    if (!target || !sources.length) continue;
    const condText = (stmt.match(/if \((.*)\)\s*(redirect|$)/) || [])[1] || "";
    const cond = /features\./.test(condText) ? "tillval" : null;
    for (const s of new Set(sources)) {
      const sec = condText.match(new RegExp(`view === "${s}" && params\\.section === "([a-z]+)"`));
      const fromId = sec ? `v:${s}#section:${sec[1]}` : `v:${s}`;
      if (sec && !nodes.has(fromId)) addNode({ id: fromId, kind: "section", label: `${s}&section=${sec[1]} (gammal adress)`, parent: `v:${s}`, address: `/?view=${s}&section=${sec[1]}`, type: "neutral", refs: [ref(PAGE, i + 1)] });
      if (sec) addEdge(`v:${s}`, fromId, "tree", null);
      linkTo(fromId, target, "redirect", ref(PAGE, i + 1, l), { label: `redirect${cond ? " (utan tillval)" : ""}`, ...(cond ? { cond } : {}), ...(!new RegExp(`view === "${s}"\\s*&&|&&[^|]*view === "${s}"`).test(condText) ? { always: true } : {}) });
    }
  }
  const demoLine = lineOf(PAGE, "const requested = ({ new:");
  const demoMap = (pageLines[demoLine - 1].match(/\(\{([^}]*)\}/) || [])[1] || "";
  for (const m of demoMap.matchAll(/([a-z_]+): "([a-z_]+)"/g)) linkTo(`v:${m[1]}`, `/?view=${m[2]}`, "redirect", ref(PAGE, demoLine, "demo"), { label: "i demon", cond: "demo" });
  const WS = "features/kfid/workspace.tsx";
  lines(WS).forEach((l, i) => {
    const m = l.match(/router\.replace\("(\/\?view=[^"]+)"\)/);
    if (!m) return;
    const sources = [...l.matchAll(/view === "([a-z_]+)"/g)].map((x) => x[1]);
    const step = (l.match(/get\("step"\) === "([a-z]+)"/) || [])[1];
    for (const s of sources) {
      const from = step && STEP_KNOWN[`v:${s}`]?.has(step) ? `v:${s}/step:${step}` : `v:${s}`;
      linkTo(from, m[1], "redirect", ref(WS, i + 1, l), { label: /native/.test(l) ? "i appvyn (telefon)" : "router.replace", device: /native/.test(l) ? "phone" : undefined });
    }
  });
  linkTo("p:/dashboard", "/?view=credits", "redirect", ref("app/dashboard/page.tsx", lineOf("app/dashboard/page.tsx", "redirect("), "redirect"), { label: "redirect" });
  linkTo("p:/p/[id]", "/?view=place&placeId=X&scan=1", "redirect", ref("app/p/[id]/page.tsx", lineOf("app/p/[id]/page.tsx", "view=place"), "redirect"), { label: "QR-kod" });
  linkTo("p:/demo", "/?view=stats", "redirect", ref("app/demo/route.ts", lineOf("app/demo/route.ts", "view=stats"), "303"), { label: "startar demon" });
  addEdge("p:/", "p:/login", "redirect", ref(PAGE, lineOf(PAGE, 'redirect(`${site.appOrigin}/login`)'), "dold landningssida"), { label: "landningssidan dold → login" });
}
// Flikarnas alias (körs när arbetsytans grenar är kända, avsnitt 5).
function aliasEdges() {
  // Flikarnas alias: en gammal adress visas som en del av en flik (ingen ny adress, men samma sida).
  for (const [tabs, file] of [[ALL_SETTINGS, "lib/workflow/settings-tabs.ts"], [ALL_PRODUCT, "lib/workflow/settings-tabs.ts"]]) {
    for (const tab of tabs) {
      for (const [alias, part] of Object.entries(tab.aliases || {})) {
        const to = part ? sectionNode(tab.key, part, null) : `v:${tab.key}`;
        // Ett alias som arbetsytan ritar med en egen gren (Värden och referenser) är en egen sida: bara fliken markeras.
        const branch = WS_BRANCH.find((b) => b.views.includes(alias));
        if (branch && !branch.views.includes(tab.key)) { const n = nodes.get(`v:${alias}`); if (n) n.note = `Egen sida; fliken ${tab.label} markeras (alias i settings-tabs.ts)`; continue; }
        addEdge(`v:${alias}`, to, "redirect", ref(file, lineOf(file, `${alias}:`) || lineOf(file, `"${alias}"`), `alias ${alias}`), { label: `alias → ${tab.label}${part ? ` › ${part}` : ""}`, cond: VIEW_COND[tab.key] || null, always: true });
      }
    }
  }
}

// 4e. Popupar och steg: varje steg från sin sida, varje Modal från filens sida.
for (const n of nodes.values()) if (n.kind === "step" || n.kind === "section") addEdge(n.parent, n.id, "popup", n.refs[0] || null, { label: n.kind === "step" ? `${n.id.includes("/tab:") ? "tab" : "step"}=${n.step}` : `section=${n.section}`, device: n.phoneOnlyStep ? "phone" : undefined });

// ---------------------------------------------------------------------------------------------------------------
// 5. Vilken sida en fil hör till: arbetsytans grenar (features/kfid/workspace.tsx) och importerna därifrån.
const WS = "features/kfid/workspace.tsx";
const wsLines = lines(WS);
const IMPORTS = new Map(); // file → [{names, target}]
const resolveImport = (from, spec) => {
  let base;
  if (spec.startsWith("@/")) base = spec.slice(2);
  else if (spec.startsWith(".")) base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  else return null;
  for (const ext of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) { const f = base + ext; if (fs.existsSync(abs(f)) && fs.statSync(abs(f)).isFile()) return f; }
  return null;
};
function importsOf(file) {
  if (IMPORTS.has(file)) return IMPORTS.get(file);
  const src = read(file);
  const out = [];
  for (const m of src.matchAll(/import\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/g)) {
    if (m[1]) continue;
    const target = resolveImport(file, m[3]);
    if (!target) continue;
    const names = [...m[2].matchAll(/([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?/g)].map((x) => x[2] || x[1]).filter((x) => x !== "type");
    out.push({ names, target });
  }
  // dynamic(() => import("…")) och lazy-komponenter.
  for (const m of src.matchAll(/const\s+(\w+)\s*=\s*(?:dynamic|lazy)\([^;]*?import\(["']([^"']+)["']\)/g)) { const target = resolveImport(file, m[2]); if (target) out.push({ names: [m[1]], target }); }
  IMPORTS.set(file, out);
  return out;
}
const compFile = new Map();
for (const imp of importsOf(WS)) for (const name of imp.names) compFile.set(name, imp.target);
// features/kfid/workspace-views.tsx: sidorna laddas med next/dynamic (load.X → fil) och VIEW_CODE säger vilken vy
// som behöver vilken kod – appens egen karta över vilken fil som hör till vilken sida.
const WSV = "features/kfid/workspace-views.tsx";
const VIEW_CODE_FILES = new Map(); // view → [file]
if (fs.existsSync(abs(WSV))) {
  const src = read(WSV);
  const loaders = {};
  for (const m of src.matchAll(/^\s*(\w+): \(\) => import\("([^"]+)"\)/gm)) loaders[m[1]] = resolveImport(WSV, m[2]);
  for (const m of src.matchAll(/export const (\w+) = dynamic\(\(\) => load\.(\w+)\(\)/g)) if (loaders[m[2]]) compFile.set(m[1], loaders[m[2]]);
  const at = src.indexOf("const VIEW_CODE");
  const block = src.slice(at, src.indexOf("};", at));
  for (const m of block.matchAll(/([a-z_]+): \[([^\]]*)\]/g)) VIEW_CODE_FILES.set(m[1], [...m[2].matchAll(/load\.(\w+)/g)].map((x) => loaders[x[1]]).filter(Boolean));
}
// Grenarna i arbetsytan: från första "content =" till flikraden.
const WS_BRANCH = []; // { start, end, views }
{
  const startAt = Math.max(0, wsLines.findIndex((l) => /^\s*let content\b/.test(l)));
  const endAt = wsLines.findIndex((l, i) => i > startAt && /const tabRow =/.test(l));
  let current = null;
  for (let i = startAt; i < (endAt > 0 ? endAt : wsLines.length); i++) {
    const l = wsLines[i];
    const branch = /^\s*(\} )?else if \(|^\s*if \(|^\s*(\} )?else \{/.test(l) && /view|else \{/.test(l);
    if (branch) {
      let views = [...l.matchAll(/view === "([a-z_]+)"/g)].map((m) => m[1]);
      const arr = l.match(/\[([^\]]*)\]\.includes\(view\)/);
      if (arr) views = views.concat([...arr[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
      if (/^\s*(\} )?else \{/.test(l)) views = ["help"];
      if (/COMPANY_ADMIN_VIEWS|PRODUCT_VIEWS\)|CLOUD_ONLY_VIEWS|nativeHides|legalRequired/.test(l) && !views.length) views = [];
      if (views.length || /^\s*(\} )?else \{/.test(l)) { if (current) current.end = i - 1; current = { start: i + 1, end: null, views: [...new Set(views)] }; WS_BRANCH.push(current); }
    }
  }
  if (current) current.end = endAt > 0 ? endAt : wsLines.length;
}
const wsViewsAtLine = (ln) => { const b = WS_BRANCH.find((x) => ln >= x.start && ln <= (x.end || Infinity)); return b ? b.views : null; };
const FILE_VIEWS = new Map(); // file → Set(nodeId)
const addFileView = (file, id) => { if (!FILE_VIEWS.has(file)) FILE_VIEWS.set(file, new Set()); FILE_VIEWS.get(file).add(id); };
for (const b of WS_BRANCH) {
  for (let i = b.start; i <= (b.end || b.start); i++) for (const m of (wsLines[i - 1] || "").matchAll(/<([A-Z][A-Za-z0-9]+)/g)) {
    const f = compFile.get(m[1]);
    if (f && /^(features|ee)\//.test(f)) for (const v of b.views) addFileView(f, `v:${v}`);
  }
}
// Tillägg (ee/) som arbetsytan får via lib/extensions/core-client.tsx: dynamic<Props<"Namn">>(() => import("…")).
{
  const CC = "lib/extensions/core-client.tsx";
  if (fs.existsSync(abs(CC))) for (const m of read(CC).matchAll(/const (\w+) = dynamic<Props<"(\w+)">>\(\(\) => import\("([^"]+)"\)/g)) {
    const f = resolveImport(CC, m[3]);
    if (f) { compFile.set(m[1], f); compFile.set(m[2], f); }
  }
}
// VIEW_CODE: filerna varje vy laddar.
for (const [view, files] of VIEW_CODE_FILES) files.forEach((f) => addFileView(f, `v:${view}`));
// Kända filer som inte är sidor (ingångar, popupar, servern).
const FILE_OVERRIDE = [
  [/^components\/app-shell\.tsx$/, "e:dator"], [/^components\/native\/tab-bar\.tsx$/, "e:flikrad"], [/^components\/bottom-bar\.tsx$/, "e:dator"],
  [/^features\/kfid\/global-search\.tsx$|^lib\/search\//, "x:sok"], [/^app\/api\/workflow-search\//, "x:sok"],
  [/^features\/ai\/assistant-panel\.tsx$|^lib\/ai\/assistant-/, "x:ai"], [/^features\/ai\/proposals\.tsx$/, "x:ai"],
  [/^features\/demo\//, "p:/demo"], [/^features\/workflow\/native-home\.tsx$/, "v:stats"], [/^lib\/setup-guide\.ts$/, "v:setup"],
  [/^features\/workflow\/native-help\.tsx$/, "v:help"], [/^features\/design-lab\//, "p:/design-lab"], [/^features\/auth\/components\/register-form/, "p:/register"],
  [/^lib\/workflow\/overview-work\.ts$|^features\/workflow\/overview-kpis\.tsx$/, "v:stats"], [/^lib\/self-inspection\//, "v:self_inspection"], [/^lib\/tools\/registry\.ts$/, "v:tools"],
  [/^app\/manifest\.ts$/, "e:server"], [/^app\/\(public\)\/cookies\//, "p:/cookies"],
];
// The list of outside services names app addresses as data, not as links (5c2 draws them).
const STRUCTURAL = new Set(["lib/integrations/external-services.ts", "ee/integrations/external-services.ts", "lib/workflow/navigation.ts", "lib/workflow/menu-items.ts", "lib/workflow/native-mode.ts", "lib/workflow/native-layout.ts", "lib/workflow/settings-tabs.ts", "lib/workflow/new-choices.ts", "app/page.tsx", "app/dashboard/page.tsx", "app/p/[id]/page.tsx", "app/demo/route.ts", "components/native/tab-bar.tsx"]);
// Importerna vidare (två steg från arbetsytans komponenter, och från de publika sidorna).
{
  for (const f of pageFiles) { const p = publicPath(f); for (const imp of importsOf(f)) if (/^(features|ee)\//.test(imp.target)) addFileView(imp.target, `p:${p}`); }
  for (let round = 0; round < 3; round++) {
    for (const [file, set] of [...FILE_VIEWS.entries()]) {
      if (!/\.(tsx?)$/.test(file)) continue;
      for (const imp of importsOf(file)) {
        if (!/^(features|ee|lib)\//.test(imp.target) || imp.target === WS || STRUCTURAL.has(imp.target)) continue;
        if (FILE_VIEWS.has(imp.target) && FILE_VIEWS.get(imp.target).__direct) continue;
        for (const id of set) addFileView(imp.target, id);
      }
    }
  }
}
for (const set of FILE_VIEWS.values()) set.__direct = true;
function sourcesOfFile(file, ln) {
  for (const [re, id] of FILE_OVERRIDE) if (re.test(file)) return { ids: [id] };
  if (file === WS) { const v = wsViewsAtLine(ln); if (v && v.length) return { ids: [`v:${v[0]}`], shared: v.length > 1, also: v.slice(1).map((x) => `v:${x}`) }; return { ids: ["e:delad"], shared: true }; }
  if (/^lib\/|^app\/api\//.test(file) && !FILE_VIEWS.has(file)) return { ids: ["e:server"] };
  const set = FILE_VIEWS.get(file);
  if (!set || !set.size) return { ids: ["e:delad"], shared: true, unknown: true };
  const ids = [...set].filter((id) => nodes.has(id));
  if (ids.length > 5) return { ids: ["e:delad"], shared: true, many: ids.length, also: ids };
  // Flera sidor använder filen: länken ritas från den grundaste sidan (närmast menyn) och de andra står som "också från".
  const depthOf = (id) => NAV.breadcrumbTrail({ view: nodes.get(id)?.view || "stats" }).length;
  const sorted = [...ids].sort((a, b) => depthOf(a) - depthOf(b));
  return { ids: sorted.slice(0, 1), shared: ids.length > 1, also: sorted.slice(1) };
}

// 5b. Länkar inne på sidor: varje "/?view=…" i features/, components/, ee/, app/ och lib/.
const SCAN = ["features", "components", "ee", "app", "lib"].flatMap((d) => walk(d)).filter((f) => /\.(tsx?|cjs|mjs)$/.test(f) && !/\.test\.|\.spec\.|\/tests?\//.test(f) && !STRUCTURAL.has(f));
let dynamicLinks = 0;
const TPL = String.raw`\$\{(?:[^{}]|\{[^{}]*\})*\}`;
const VIEW_RE = new RegExp(String.raw`\/\?view=([a-z_]+)((?:${TPL}|[^"'\x60\s<>)\\])*)`, "g");
// Hjälpfunktioner i lib/ som bygger en adress (roundLabelsHref, customerPlaceHref, menuItemHref …): anropen är länkar.
const HELPERS = new Map(); // namn → { address, file, line }
const HELPER_LINES = new Map(); // fil → Set(rad) inne i en hjälpfunktion (räknas vid anropen, inte där)
for (const file of walk("lib").concat(walk("features")).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))) {
  const ls = lines(file);
  ls.forEach((l, i) => {
    const m = l.match(/^export (?:const|function) (\w+)/);
    if (!m || /^[A-Z_]+$/.test(m[1])) return;
    const body = [l];
    for (let j = i + 1; j < Math.min(ls.length, i + 12) && !/^export /.test(ls[j]); j++) body.push(ls[j]);
    const hit = body.join("\n").match(new RegExp(String.raw`\/\?view=([a-z_]+)((?:${TPL}|[^"'\x60\s<>)\\])*)`));
    if (hit) { HELPERS.set(m[1], { address: hit[0], file, line: i + 1 }); if (!HELPER_LINES.has(file)) HELPER_LINES.set(file, new Set()); for (let k = 0; k < body.length; k++) HELPER_LINES.get(file).add(i + 1 + k); }
  });
}
HELPERS.delete("menuItemHref"); // menyknappen: ritad som menylänk
const HELPER_RE = new RegExp(String.raw`\b(${[...HELPERS.keys()].join("|") || "__none__"})\(`, "g");
for (const file of SCAN) {
  const ls = lines(file);
  const native = /native|mobile/.test(file);
  // Variabler som håller en adress (const projectHref = `/?view=project…`), så att `${projectHref}&edit=1` blir en länk.
  const hrefVars = new Map();
  ls.forEach((l) => { const m = l.match(new RegExp(String.raw`(?:const|let)\s+(\w+Href)\s*=\s*[^;"\x60]*["\x60](\/\?view=[a-z_]+(?:${TPL}|[^"'\x60\s<>)\\])*)`)); if (m) hrefVars.set(m[1], m[2]); });
  const isLib = /^lib\/|^app\/api\/|^app\/manifest/.test(file);
  ls.forEach((l, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(l)) return; // kommentarer
    if (/\/\?view=\$\{/.test(l)) dynamicLinks++;
    const found = [];
    if (!HELPER_LINES.get(file)?.has(i + 1)) for (const m of l.matchAll(VIEW_RE)) found.push(`/?view=${m[1]}${m[2]}`);
    for (const [name, value] of hrefVars) for (const m of l.matchAll(new RegExp(String.raw`\$\{${name}\}((?:${TPL}|[^"'\x60\s<>)\\])*)`, "g"))) if (m[1]) found.push(value + m[1]);
    const viaHelper = [];
    for (const m of l.matchAll(HELPER_RE)) { const h = HELPERS.get(m[1]); if (h.file !== file) viaHelper.push([h.address, ref(h.file, h.line, `${m[1]}() bygger adressen`)]); }
    for (const m of l.matchAll(/\broute\("([a-z_]+)"\)/g)) if (file !== SHELL) found.push(`/?view=${m[1]}`);
    if (!found.length && !viaHelper.length) return;
    const src = sourcesOfFile(file, i + 1);
    const cat = isLib && src.ids[0] === "e:server" ? "system" : "inpage";
    const r = ref(file, i + 1, l);
    const extra = () => ({ ...(native ? { device: "phone" } : {}), ...(src.shared ? { shared: true, also: src.also || [] } : {}) });
    for (const address of new Set(found)) for (const from of src.ids) linkTo(from, address, cat, r, extra());
    for (const [address, defRef] of viaHelper) for (const from of src.ids) { linkTo(from, address, cat, r, extra()); linkTo(from, address, cat, defRef, extra()); }
  });
}
// Popupar (Modal) med rubrik, under den sida filen hör till.
let modalCount = 0;
for (const file of SCAN.filter((f) => /\.tsx$/.test(f))) {
  const ls = lines(file);
  ls.forEach((l, i) => {
    if (!/<Modal\b/.test(l)) return;
    const window = ls.slice(i, i + 8).join(" ");
    const lit = window.match(/title=\{?["`]([^"`]+)["`]\}?/);
    let title = lit ? lit[1].replace(/\$\{[^}]*\}/g, "…") : null;
    const tern = window.match(/title=\{[^"`]*\?\s*["`]([^"`]+)["`]\s*:\s*["`]([^"`]+)["`]/);
    if (tern) title = `${tern[1].replace(/\$\{[^}]*\}/g, "…")} / ${tern[2].replace(/\$\{[^}]*\}/g, "…")}`;
    if (!title) title = `Popup i ${path.basename(file)} (rubrik från anroparen)`;
    const src = sourcesOfFile(file, i + 1);
    modalCount++;
    const id = `m:${file}:${i + 1}`;
    const parent = src.ids[0];
    addNode({ id, kind: "modal", label: title, parent, type: nodes.get(parent)?.type || "neutral", refs: [ref(file, i + 1, l)], note: src.shared ? `Delad fil, används av: ${src.ids.join(", ")}` : null });
    for (const from of src.ids) addEdge(from, id, from === parent ? "popup" : "popup", ref(file, i + 1, "<Modal"), { label: "popup", shared: src.shared });
    if (!edges.has(`${parent}|${id}|tree||`)) addEdge(parent, id, "tree", null);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// 5c. Flikarnas alias och flikraderna (SectionTabs): Inställningar, Produktadministration, Webbplats och utskick, Projekt.
aliasEdges();
{
  const ST = "features/workflow/section-tabs.tsx";
  const chip = ref(ST, lineOf(ST, "const chip = (tab: Tab)"), "SectionTabs");
  const second = ref(ST, lineOf(ST, "href={sectionHref(item)}"), "andra raden");
  // Who sees each tab: Inställningar's tabs as settingsTabDefs gives them to an admin or a member; Produktadministration's
  // only to the superadmin.
  const settingsByRole = Object.fromEntries(ROLES.map((role) => [role, TABS.settingsTabDefs({ admin: role !== "member", cloud: true, ai: true, integrations: true, credits: true })]));
  const tabRoles = (product, key) => product ? ["superadmin"] : rolesWhere((role) => settingsByRole[role].some((tab) => tab.key === key || tab.sections.some((section) => section.view === key)));
  for (const [tabs, hub] of [[ALL_SETTINGS, "v:settings"], [ALL_PRODUCT, "v:customer_companies"]]) {
    const product = hub === "v:customer_companies";
    for (const tab of tabs) {
      linkTo(hub, `/?view=${tab.key}`, "inpage", chip, { label: `flik ${tab.label}`, roles: tabRoles(product, tab.key) });
      if (tab.sections.length > 1) for (const section of tab.sections) linkTo(`v:${tab.key}`, TABS.sectionHref(section), "inpage", second, { label: `${tab.label} › ${section.label}`, roles: tabRoles(product, section.view) });
    }
  }
  // Användare's button Operatörskonton (2026-11-02): by the rule of the menu's row.
  const USERS = "features/kfid/administration-users.tsx";
  linkTo("v:administration", "/?view=operator_accounts", "inpage", ref(USERS, lineOf(USERS, 'data-testid="users-operator-accounts"'), "Operatörskonton"), { label: "Operatörskonton", device: "desktop", cond: "cloud", roles: menuRoles("operator_accounts") });
  // Kalkylator → Företagets värden: calcHref(COMPANY_VALUES_TOOL) (the helper's address has the tool as a variable).
  const CP = "features/calculators/calculators-page.tsx";
  if (fs.existsSync(abs(CP))) for (const [i, l] of lines(CP).entries()) if (l.includes("calcHref(COMPANY_VALUES_TOOL)")) addEdge("v:calculators", "v:calculators#varden", "inpage", ref(CP, i + 1, l), { label: "Företagets värden", cond: "admin" });
  // Projekt has the link Planering and the button Projektstatistik in its head; Planering has its views Kalender, Tidplan and
  // Kapacitet as tabs (planningTabs, 2026-11-01), and Arbetsordrar its tab Uppgifter (workOrderTabs).
  const WP = "features/kfid/workflow-projects.tsx";
  linkTo("v:projects", "/?view=project_planning", "inpage", ref(WP, lineOf(WP, 'data-testid="projects-planning-link"'), "Planering"), { label: "Planering", roles: rolesWhere((role) => MENU.projectPageAllowed("project_planning", ACCESS[role])) });
  linkTo("v:projects", "/?view=project_summary", "inpage", ref(WP, lineOf(WP, 'data-testid="projects-summary-link"'), "Projektstatistik"), { label: "Projektstatistik", roles: rolesWhere((role) => MENU.projectPageAllowed("project_summary", ACCESS[role])) });
  const planningTabsLine = ref(WS, lineOf(WS, 'label="Planering" current={view}'), "planningTabs");
  const capacityRoles = rolesWhere((role) => MENU.calendarAllowed(ACCESS[role]) && !ACCESS[role].localStorageMode);
  linkTo("v:planning", "/?view=capacity", "inpage", planningTabsLine, { label: "flik Kapacitet", roles: capacityRoles });
  linkTo("v:capacity", "/?view=planning", "inpage", planningTabsLine, { label: "flik Kalender", roles: capacityRoles });
  const workTabsLine = ref(WS, lineOf(WS, 'label="Arbetsordrar" current={view}'), "workOrderTabs");
  linkTo("v:work_orders", "/?view=tasks", "inpage", workTabsLine, { label: "flik Uppgifter", device: "desktop" });
  linkTo("v:tasks", "/?view=work_orders", "inpage", workTabsLine, { label: "flik Arbetsordrar", device: "desktop" });
  linkTo("v:project_planning", "/?view=planning", "inpage", planningTabsLine, { label: "flik Kalender", roles: rolesWhere((role) => MENU.projectPageAllowed("project_planning", ACCESS[role]) && MENU.calendarAllowed(ACCESS[role])) });
  linkTo("v:planning", "/?view=project_planning", "inpage", planningTabsLine, { label: "flik Tidplan", roles: rolesWhere((role) => MENU.projectPageAllowed("project_planning", ACCESS[role]) && MENU.calendarAllowed(ACCESS[role])) });
}
// 5c2. Externa tjänster (2026-10-25: "vad som pratar med vad"): the programs and services outside Workflow, from the
// app's own list (lib/integrations/external-services.ts) and, when ee/ is there, the commercial part's
// (ee/integrations/external-services.ts) – never a copy here. A box per service under its group, in the colour of whose
// key it is, with lines from the pages where the key is administered and the pages that use the service.
const SERVICES_FILE = "lib/integrations/external-services.ts";
const EE_SERVICES_FILE = "ee/integrations/external-services.ts";
const SVC = load(SERVICES_FILE);
const CENTRAL = load("lib/secrets/central-fields.ts").CENTRAL_FIELDS;
const hasEe = fs.existsSync(abs("ee/server.ts"));
const serviceList = [
  ...SVC.EXTERNAL_SERVICES.map((s) => ({ s, file: SERVICES_FILE })),
  ...(hasEe && fs.existsSync(abs(EE_SERVICES_FILE)) ? load(EE_SERVICES_FILE).EE_EXTERNAL_SERVICES.map((s) => ({ s, file: EE_SERVICES_FILE })) : []),
].filter(({ s }) => !s.onlyWith || fs.existsSync(abs(s.onlyWith)));
const SERVICE_CATS = new Set(["service-admin", "service-use"]);
/** A place in the app (an address, a public path or the AI panel) → its box, or null when the map has none. */
function placeNode(at, r) {
  if (at === "panel:ai") return nodes.has("x:ai") ? "x:ai" : null;
  if (at.startsWith("/?")) {
    const t = resolveAddress(at);
    if (!t || t.dead) return null;
    if (t.section) return sectionNode(t.section.tab, t.section.part, r);
    return nodes.has(t.to) ? t.to : null;
  }
  return nodes.has(`p:${at}`) ? `p:${at}` : null;
}
if (serviceList.length) {
  addNode({ id: "e:extern", kind: "entry", label: "Externa tjänster", type: "neutral", parent: null, note: "Program och tjänster utanför Workflow som koden pratar med, eller som pratar med Workflow",
    refs: [ref(SERVICES_FILE, lineOf(SERVICES_FILE, "export const EXTERNAL_SERVICES"), "EXTERNAL_SERVICES")] });
  for (const group of Object.keys(SVC.SERVICE_GROUPS)) {
    if (!serviceList.some(({ s }) => s.group === group)) continue;
    addNode({ id: `t:${group}`, kind: "group", label: SVC.SERVICE_GROUPS[group], type: "neutral", parent: "e:extern", refs: [ref(SERVICES_FILE, lineOf(SERVICES_FILE, new RegExp(`^\\s*${group}: "`)), group)] });
  }
  for (const { s, file } of serviceList) {
    const id = `t:${s.group}/${s.id}`;
    const r = ref(file, lineOf(file, `id: "${s.id}"`), s.name);
    const owner = SVC.KEY_OWNERS[s.key.owner] || SVC.KEY_OWNERS.none;
    const fields = (s.key.central || []).map((field) => (CENTRAL[field] ? CENTRAL[field].label : field));
    addNode({ id, kind: "service", label: s.name, type: owner.type, parent: `t:${s.group}`, note: s.purpose, refs: [r, ...s.modules.map((m) => ref(m, null))],
      service: {
        purpose: s.purpose, direction: s.direction, directionLabel: SVC.DIRECTION_LABELS[s.direction], owner: s.key.owner, ownerLabel: owner.label, key: s.key.label,
        ...(fields.length ? { fields } : {}), ...(s.key.company ? { company: s.key.company } : {}),
        admin: s.admin.map((p) => p.label), usedBy: (s.usedBy || []).map((p) => p.label), incoming: [...(s.incoming || [])],
        hosts: [...(s.hosts || []), ...(s.hostEndings || []).map((end) => `*${end}`)], ...(s.via ? { via: s.via } : {}), modules: [...s.modules],
      } });
    for (const [cat, places] of [["service-admin", s.admin], ["service-use", s.usedBy || []]]) {
      for (const place of places) { const from = placeNode(place.at, r); if (from) addEdge(from, id, cat, r, { label: place.label }); }
    }
  }
  for (const n of nodes.values()) if (n.parent && (n.id.startsWith("t:"))) addEdge(n.parent, n.id, "tree", null);
}

for (const n of nodes.values()) if ((n.kind === "step" || n.kind === "section") && n.parent) { addEdge(n.parent, n.id, "popup", n.refs[0] || null, { label: n.kind === "step" ? `${n.id.includes("/tab:") ? "tab" : "step"}=${n.step}` : `section=${n.section}` }); addEdge(n.parent, n.id, "tree", null); }

// 5d. Provat i appen (2026-10-24: "är testet gjort i webbplatskartan?"): the click robot's round
// (scripts/sitemap/crawl/, summed up in scripts/sitemap/observed.json). Each address the robot opened is mapped to its box
// with the same rules as the code's links; a way the robot followed marks the code's line between the same boxes, and a
// way or a page the code does not know becomes a box or a line of its own ("robot"). The marking is written out in 6c.
const OBS = loadObserved(observed, REPO);
const TESTED = new Map(); // box → Set(run): reached by clicking
const PROBED = new Map(); // box → Set(run): opened directly by the role probe (counts as tried, not as a way there)
const DENIED = new Map(); // box → Set(run): the robot got the permission box
const WAYS = []; // { from, to, how, runs }
const markRuns = (map, id, runs) => { if (!id || !nodes.has(id)) return; if (!map.has(id)) map.set(id, new Set()); for (const r of runs) map.get(id).add(r); };
const robotRoles = (runs) => ROLES.filter((role) => runs.some((run) => run.startsWith(`${role}-`)));
const runsDevice = (runs) => { const d = runs.some((r) => r.endsWith("-desktop")), p = runs.some((r) => r.endsWith("-phone")); return d && p ? "both" : d ? "desktop" : "phone"; };
const observedNode = (() => {
  const SPECIAL = { "@mer": "e:mer", "@ny": "x:ny", "@flikrad": "e:flikrad", "@meny": "e:dator", "@skal": "e:delad", "@sok": "x:sok", "@ai": "x:ai", "@kalkylator": "x:kalkylator" };
  const publics = [...nodes.values()].filter((n) => n.kind === "public" && n.address).map((n) => ({ id: n.id, parts: n.address.split("/") }));
  const publicNode = (pathname) => {
    const parts = pathname.split("/");
    const hit = publics.find((p) => p.parts.length === parts.length && p.parts.every((part, i) => part === parts[i] || /^\[.+\]$/.test(part)));
    return hit ? hit.id : null;
  };
  const cache = new Map();
  return (address) => {
    if (!address) return null;
    if (SPECIAL[address]) return SPECIAL[address];
    if (cache.has(address)) return cache.get(address);
    const pathname = address.split("?")[0];
    let id = null;
    if (pathname.startsWith("/api/")) id = null;
    else if (pathname !== "/" || !/[?&]view=/.test(address)) {
      // "/" signed in is the workspace itself (Översikt); the landing page is for the signed-out visitor.
      id = pathname === "/" ? (/[?&]landing=/.test(address) ? "p:/" : "v:stats") : publicNode(pathname);
      if (!id) { // a page or a file the code's map does not know (e.g. /third-party-licenses.txt)
        id = `p:${pathname}`;
        if (!nodes.has(id)) addNode({ id, kind: "public", label: pathname, address: pathname, type: "neutral", parent: "e:publik", refs: [], robotOnly: true });
      }
    } else {
      const t = resolveAddress(address);
      if (t) {
        if (t.missing) addNode({ ...t.missing, refs: [], robotOnly: true, ...(t.dead ? { dead: true } : {}) });
        const old = t.section ? `v:${t.view}#section:${t.section.part}` : null; // an old address the code redirects (4d)
        if (old && nodes.has(old)) id = old;
        else if (!t.section) id = t.to;
        else if (PART_IDS.has(t.section.part) || nodes.has(t.to)) id = sectionNode(t.section.tab, t.section.part, null);
        else { addNode({ id: t.to, kind: "section", label: `Avsnitt ${t.section.part}`, section: t.section.part, parent: `v:${t.section.tab}`, address, type: "neutral", refs: [], robotOnly: true }); id = t.to; }
      }
    }
    cache.set(address, id);
    return id;
  };
})();
if (OBS) {
  for (const page of OBS.pages || []) {
    const id = observedNode(page.address);
    markRuns(TESTED, id, page.runs || []);
    markRuns(DENIED, id, page.denied || []);
    if (page.redirect) { const to = observedNode(page.redirect); if (to && to !== id) WAYS.push({ from: id, to, how: "pekar om", runs: page.runs || [], redirect: true }); }
  }
  for (const way of OBS.ways || []) {
    const from = observedNode(way.from), to = observedNode(way.to);
    if (!from || !to || from === to) continue;
    markRuns(TESTED, from, way.runs);
    WAYS.push({ from, to, how: way.how, runs: way.runs });
  }
  // Rollprovet: the robot's own verdict per box and role (visas, nekas, pekar om, bara adressen).
  for (const probe of OBS.roleProbe || []) {
    const id = observedNode(probe.address);
    if (!id || !nodes.has(id)) continue;
    const n = nodes.get(id);
    n.probe = { ...(n.probe || {}), [probe.role]: probe.result };
    markRuns(PROBED, id, [`${probe.role}-desktop`]);
    if (probe.result === "nekas") markRuns(DENIED, id, [`${probe.role}-desktop`]);
    if (probe.result === "pekar om" && probe.to) { const to = observedNode(probe.to); if (to && to !== id) WAYS.push({ from: id, to, how: "pekar om", runs: [`${probe.role}-desktop`], redirect: true }); }
  }
  // Popups the robot opened: the panels by their title, a Modal by its title under the page it was opened on.
  const PANEL = { Trefaseffekt: "x:kalkylator", "HINTEK AI": "x:ai", Mer: "e:mer", Sök: "x:sok" };
  for (const popup of OBS.popups || []) {
    const page = observedNode(popup.page);
    let id = PANEL[popup.label] || null;
    if (!id) {
      const label = popup.label.toLowerCase(), view = nodes.get(page)?.view;
      const modal = [...nodes.values()].find((n) => n.kind === "modal" && n.label.toLowerCase() === label && (n.parent === page || (view && nodes.get(n.parent)?.view === view)));
      id = modal ? modal.id : null;
    }
    // The shell's panels (Mer, Sök, HINTEK AI, Kalkylator) open from every page: only the panel is marked, not a way per page.
    if (id) { markRuns(TESTED, id, popup.runs); if (page && page !== id && !Object.values(PANEL).includes(id)) WAYS.push({ from: page, to: id, how: "popup", runs: popup.runs }); }
  }
  // Each way: the code's line between the same boxes, else a line of the robot's own.
  const codeOut = new Map();
  for (const e of edges.values()) if (e.cat !== "tree") for (const f of [e.from, ...(e.also || [])]) { if (!codeOut.has(f)) codeOut.set(f, new Set()); codeOut.get(f).add(e.to); }
  const above = (id) => { const out = new Set(); let p = nodes.get(id)?.parent, hops = 0; while (p && hops++ < 30) { out.add(p); p = nodes.get(p)?.parent; } return out; };
  const sameView = (a, b) => Boolean(nodes.get(a)?.view) && nodes.get(a)?.view === nodes.get(b)?.view;
  const known = (from, to) => codeOut.get(from)?.has(to) || codeOut.get("e:delad")?.has(to) || above(from).has(to) || nodes.get(to)?.parent === from
    // A way inside one page (a step, a tab, a job's own screens), or one the code draws from another box of the same page.
    || sameView(from, to) || [...codeOut.entries()].some(([f, tos]) => tos.has(to) && sameView(f, from))
    // A tab row repeats on each of its tabs: the code draws it once, from the hub above them.
    || codeOut.get(nodes.get(from)?.parent)?.has(to)
    // The shell's links (side menu, top bar) seen on many pages: known when any entry of the code reaches the page.
    || from === "e:delad" && [...codeOut.entries()].some(([f, tos]) => f.startsWith("e:") && tos.has(to));
  const robotEdges = new Map();
  for (const way of WAYS) {
    if (way.redirect ? [...edges.values()].some((e) => e.cat === "redirect" && e.from === way.from && e.to === way.to) : known(way.from, way.to)) continue;
    const key = `${way.from}|${way.to}`;
    if (!robotEdges.has(key)) robotEdges.set(key, { from: way.from, to: way.to, how: new Set(), runs: new Set() });
    const r = robotEdges.get(key);
    (way.redirect ? [way.how] : way.how.split(" ")).forEach((h) => r.how.add(h)); way.runs.forEach((x) => r.runs.add(x));
  }
  for (const r of robotEdges.values()) {
    const runs = [...r.runs];
    addEdge(r.from, r.to, "robot", null, { label: `roboten: ${[...r.how].join(", ")}`, device: runsDevice(runs), roles: robotRoles(runs), robotOnly: true });
  }
}

// 6. Nivåer (djup i trädet) och avvikelser.
const childrenOf = new Map();
for (const n of nodes.values()) if (n.parent && nodes.has(n.parent)) { if (!childrenOf.has(n.parent)) childrenOf.set(n.parent, []); childrenOf.get(n.parent).push(n.id); }
const ROOTS = ["v:stats", "e:dator", "e:flikrad", "e:server", "e:delad", "e:publik", "e:extern"];
const depth = new Map();
function setDepth(id, d, seen = new Set()) { if (seen.has(id)) return; seen.add(id); depth.set(id, d); for (const c of childrenOf.get(id) || []) setDepth(c, d + 1, seen); }
for (const r of ROOTS) setDepth(r, 0);
for (const n of nodes.values()) { if (!depth.has(n.id)) { n.parent = null; setDepth(n.id, 0); } n.level = depth.get(n.id); }
// Kanter som nämner en nod som inte finns: skapa en död nod.
for (const e of edges.values()) for (const end of [e.from, e.to]) if (!nodes.has(end)) addNode({ id: end, kind: "dead", label: end, parent: null, level: 0, type: "neutral", dead: true, refs: [] });

// Enskilda poster (2026-10-24: "kartan skall ju visa utan pågående jobb, bara hur navigeringen fungerar"):
// rutor som står för ett enskilt objekt – ett jobb, ett projekt, en kund, en plats, en offert, ett inköp, en rond, en
// kalkylator – och allt som hänger under dem. De döljs som förval; kryssrutan "Visa enskilda poster" tar tillbaka dem.
const ITEM_ROOTS = new Set(["v:workflow_task#uppgift", "v:workflow_task#ao", "v:project", "v:project#redigera", "v:project#koppla", "v:customers#kund", "v:customers#redigera",
  "v:place", "v:place#ny", "v:place_labels", "v:quote#offert", "v:purchase#inkop", "v:rounds#andra", "v:calculators#verktyg", "v:forms#formular"]);
for (const n of nodes.values()) {
  let p = n.id, hops = 0;
  while (p && hops++ < 20) { if (ITEM_ROOTS.has(p)) { n.item = true; break; } p = nodes.get(p)?.parent; }
}

const LINK_CATS = new Set(["menu", "phone", "inpage", "system", "popup"]);
const isPage = (n) => ["view", "variant"].includes(n.kind) && n.valid !== false;
// Avvikelserna räknas två gånger: på navigeringen (förval) och med de enskilda posterna; kartan visar den som syns.
function computeAnomalies(includeItems) {
  const shown = (id) => { const n = nodes.get(id); return Boolean(n) && (includeItems || !n.item); };
  const nodeList = [...nodes.values()].filter((n) => shown(n.id));
  const edgeList = [...edges.values()].filter((e) => shown(e.from) && shown(e.to)).map((e) => ({ ...e, also: (e.also || []).filter(shown) }));
  const anomalies = { noIncoming: [], multiMenu: [], oneDevice: [], dead: [], oldAddress: [] };
  const incoming = new Map();
  for (const e of edgeList) { if (!incoming.has(e.to)) incoming.set(e.to, []); incoming.get(e.to).push(e); }
  for (const n of nodeList) {
    if (!isPage(n) || n.id === "v:stats") continue;
    const inc = (incoming.get(n.id) || []).filter((e) => LINK_CATS.has(e.cat));
    if (!inc.length) {
      const redirected = edgeList.some((e) => e.from === n.id && e.cat === "redirect");
      anomalies.noIncoming.push({ id: n.id, note: redirected ? "pekas om till en annan sida (gammal adress)" : "ingen länk, meny eller flik leder hit" });
    }
  }
  // Fler än en väg från menyn (per enhet). Datorn: en genväg tar raden ur Verktygs fällda lista, så den räknas inte.
  for (const n of nodeList) {
    const inc = incoming.get(n.id) || [];
    const desk = inc.filter((e) => e.cat === "menu" && e.cond !== "behörighet" && e.cond !== "eget val");
    const phone = inc.filter((e) => e.cat === "phone");
    const deskLabels = [...new Set(desk.map((e) => e.label))];
    const phoneLabels = [...new Set(phone.map((e) => `${nodes.get(e.from)?.label}: ${e.label}`))];
    const phoneDefault = [...new Set(phone.filter((e) => e.cond !== "eget val").map((e) => `${nodes.get(e.from)?.label}: ${e.label}`))];
    if (deskLabels.length > 1) anomalies.multiMenu.push({ id: n.id, device: "dator", ways: deskLabels, byDefault: true });
    if (phoneLabels.length > 1) anomalies.multiMenu.push({ id: n.id, device: "telefon", ways: phoneLabels, byDefault: phoneDefault.length > 1 });
  }
  // Nås bara på en enhet: sökning från ingångarna per enhet (delade komponenter och serverns notiser finns på båda).
  function reach(device) {
    const start = device === "desktop" ? ["e:dator", "v:stats", "e:delad", "e:server"] : ["e:flikrad", "v:stats", "e:delad", "e:server"];
    const seen = new Set(start), queue = [...start], out = new Map();
    for (const e of edgeList) {
      if (!["menu", "phone", "inpage", "popup", "redirect"].includes(e.cat)) continue;
      if (device === "desktop" && (e.cat === "phone" || e.device === "phone")) continue;
      if (device === "phone" && ((e.cat === "menu" && e.device !== "both") || e.device === "desktop")) continue;
      for (const from of [e.from, ...(e.also || [])]) { if (!out.has(from)) out.set(from, []); out.get(from).push(e.to); }
    }
    while (queue.length) {
      const id = queue.shift();
      for (const next of out.get(id) || []) {
        if (seen.has(next)) continue;
        const n = nodes.get(next);
        if (device === "phone" && n && n.phoneHidden) continue; // dold i appvyn (nivå 1) utan Visa mer
        seen.add(next); queue.push(next);
      }
    }
    return seen;
  }
  const deskReach = reach("desktop"), phoneReach = reach("phone");
  for (const n of nodeList) {
    if (!isPage(n)) continue;
    const d = deskReach.has(n.id), p = phoneReach.has(n.id);
    if (includeItems === Boolean(n.item) || !n.reach) n.reach = d && p ? "båda" : d ? "dator" : p ? "telefon" : "ingen";
    if (d !== p) anomalies.oneDevice.push({ id: n.id, device: d ? "bara dator" : "bara telefon", note: !d ? "nås bara från telefonens flikrad/Mer/Hem" : n.phoneHidden ? "dold i appvyn på telefon (NATIVE_HIDDEN_VIEWS) – bara med Visa mer" : "ingen väg i appvyn på telefon" });
  }
  for (const e of edgeList) if (e.dead) anomalies.dead.push({ from: e.from, to: e.to, reason: e.reason, refs: e.refs });
  for (const n of nodeList) if (n.dead && n.kind === "section" && !anomalies.dead.some((d) => d.to === n.id)) anomalies.dead.push({ from: n.parent, to: n.id, reason: `section=${n.section} har inget ankare (SettingsPart/SettingsGroup)`, refs: n.refs });
  // Länkar som går till en gammal adress (som sedan pekas om): en omväg i koden.
  const redirectsFrom = new Set(edgeList.filter((e) => e.cat === "redirect" && e.always).map((e) => e.from));
  for (const e of edgeList) if (["menu", "phone", "inpage", "system"].includes(e.cat) && redirectsFrom.has(e.to) && nodes.get(e.to)?.kind === "view") anomalies.oldAddress.push({ from: e.from, to: e.to, refs: e.refs });
  return anomalies;
}
for (const e of edges.values()) if (e.cat === "redirect" && e.always && nodes.get(e.from)?.kind === "view") nodes.get(e.from).old = true;
// Iakttagelserna räknas alltid på hela kartan, också de enskilda posterna (2026-10-24: "möjliga vägar skall ju finnas").
const anomalies = computeAnomalies(true);
// Samma namn på olika vyer.
anomalies.sameName = [];
{
  const byLabel = new Map();
  for (const n of nodes.values()) if (n.kind === "view") { if (!byLabel.has(n.label)) byLabel.set(n.label, []); byLabel.get(n.label).push(n); }
  for (const [label, list] of byLabel) if (list.length > 1) for (const n of list) anomalies.sameName.push({ id: n.id, note: `"${label}" heter också: ${list.filter((x) => x !== n).map((x) => "?view=" + x.view).join(", ")}`, refs: n.refs.slice(0, 1) });
}


// ---------------------------------------------------------------------------------------------------------------
// 6b. Roles: who reaches each box and line (2026-10-24: "tända och släcka om jag är prodadmin, kundföretag eller
// användare"). A page's own rule comes from the app's lists and functions – PRODUCT_VIEWS (superadmin), COMPANY_VIEWS
// (the company's admins), projectPageAllowed and menuItemAllowed for the menu's pages – and a box under another (a tab's
// part, a step, a popup) is reached only by those who reach the box above it. A line is offered to those who reach both
// ends and, for a menu button, a tab or a row in Mer, to those the menu, tab row or Mer shows it to.
function viewRoles(view) {
  if (PRODUCT.has(view)) return ["superadmin"];
  if (COMPANY.has(view)) return ["superadmin", "admin"];
  if (view === "project_summary" || view === "project_planning") return rolesWhere((role) => MENU.projectPageAllowed(view, ACCESS[role]));
  // Planering's Kalender (a menu button until 2026-10-30) keeps the menu button's rule.
  if (view === "planning") return rolesWhere((role) => MENU.calendarAllowed(ACCESS[role]));
  if (MENU.MENU_HIDEABLE.includes(view)) return menuRoles(view);
  return ROLES;
}
// Översikt's and Tid's tabs: the pages' own rules (lib/overview/tabs.ts, lib/workflow/time-tabs.ts) for each role.
const viewerOf = (role) => ({ admin: ACCESS[role].memberRole !== "MEMBER", workflowPermissions: ACCESS[role].workflowPermissions, organization: null });
function tabRoles(n) {
  if (n.tabRoles === "overview") return rolesWhere((role) => OVERVIEW.overviewTabs(viewerOf(role))[n.step]);
  if (n.tabRoles === "time") return rolesWhere((role) => { const v = viewerOf(role); return TIME_TABS.timeTabsFor({ local: false, team: PERM.canViewTeam(v), admin: v.admin }).includes(n.step); });
  return ROLES;
}
const ownNodeRoles = (n) => n.tabRoles ? tabRoles(n) : n.id === "g:produkt" ? ["superadmin"] : n.id === "g:foretaget" ? ["superadmin", "admin"] : (n.kind === "view" || n.kind === "variant") && n.view ? viewRoles(n.view) : ROLES;
const NODE_ROLES = new Map();
function rolesOf(id, seen = new Set()) {
  if (NODE_ROLES.has(id)) return NODE_ROLES.get(id);
  const n = nodes.get(id);
  if (!n) return ROLES;
  let roles = ownNodeRoles(n);
  if (n.parent && !seen.has(id)) {
    seen.add(id);
    const above = rolesOf(n.parent, seen);
    roles = roles.filter((role) => above.includes(role));
  }
  NODE_ROLES.set(id, roles);
  return roles;
}
const only = (list, allowed) => list.filter((role) => allowed.includes(role));
const edgeRoles = (e) => {
  const from = [...new Set([e.from, ...(e.also || [])].flatMap((id) => rolesOf(id)))];
  return only(only(e.ownRoles || ROLES, from), rolesOf(e.to));
};

// ---------------------------------------------------------------------------------------------------------------
// 6c. Provat i appen: which boxes and lines the robot reached (per role and device), the roles it actually met (Visa som
// follows them where they exist – QA's member has no Kunder, the code's "Användare" has), and its findings.
const sameView = (a, b) => Boolean(nodes.get(a)?.view) && nodes.get(a)?.view === nodes.get(b)?.view;
const childrenAll = new Map();
for (const n of nodes.values()) if (n.parent) { if (!childrenAll.has(n.parent)) childrenAll.set(n.parent, []); childrenAll.get(n.parent).push(n.id); }
const testedRuns = (() => {
  const memo = new Map();
  const of = (id, seen = new Set()) => {
    if (memo.has(id)) return memo.get(id);
    const own = new Set([...(TESTED.get(id) || []), ...(PROBED.get(id) || [])]);
    // A menu group or an entry is tried when something under it is.
    const n = nodes.get(id);
    if (n && ["group", "entry"].includes(n.kind) && !seen.has(id)) { seen.add(id); for (const c of childrenAll.get(id) || []) for (const r of of(c, seen)) own.add(r); }
    memo.set(id, own);
    return own;
  };
  return (id) => (OBS ? of(id) : new Set());
})();
const waysTo = new Map();
for (const w of WAYS) { if (!waysTo.has(w.to)) waysTo.set(w.to, []); waysTo.get(w.to).push(w); }
function edgeTested(e) {
  if (!OBS) return [];
  const runs = new Set();
  if (e.cat === "tree" || e.cat === "popup") { const a = testedRuns(e.from), b = testedRuns(e.to); for (const r of b) if (a.has(r)) runs.add(r); }
  else for (const w of waysTo.get(e.to) || []) {
    if (!e.robotOnly && (e.cat === "redirect" ? !w.redirect : w.redirect)) continue;
    if (e.robotOnly ? w.from === e.from : w.from === e.from || (e.also || []).includes(w.from) || e.from === "e:delad" || sameView(w.from, e.from)) w.runs.forEach((r) => runs.add(r));
  }
  return [...runs];
}
// The robot's verdict per box and role: visas, nekas (the permission box), pekar om, bara adressen, inte i menyn.
const menuSeen = Object.fromEntries(ROLES.map((role) => [role, new Set(WAYS.filter((w) => ["e:dator", "e:mer"].includes(w.from) && w.runs.some((r) => r.startsWith(`${role}-`))).map((w) => w.from))]));
function verdict(id, role) {
  if (!OBS) return null;
  const n = nodes.get(id);
  if ([...(DENIED.get(id) || [])].some((r) => r.startsWith(`${role}-`))) return "nekas";
  if ([...(TESTED.get(id) || [])].some((r) => r.startsWith(`${role}-`))) return "visas";
  // The code gives the role a menu row here, the robot opened that menu as the role and the row was not there.
  const menuRows = !["view", "variant"].includes(n?.kind) ? [] : [...edges.values()].filter((e) => e.to === id && ["menu", "phone"].includes(e.cat) && ["e:dator", "e:mer"].includes(e.from) && !e.cond && (e.ownRoles || ROLES).includes(role) && menuSeen[role].has(e.from));
  if (menuRows.length && !WAYS.some((w) => w.to === id && menuRows.some((e) => e.from === w.from) && w.runs.some((r) => r.startsWith(`${role}-`)))) return "inte i menyn";
  return n?.probe?.[role] || null;
}
const APP_ROLES = new Map();
function appRolesOf(id, seen = new Set()) {
  if (APP_ROLES.has(id)) return APP_ROLES.get(id);
  const n = nodes.get(id);
  if (!n) return ROLES;
  const v = Object.fromEntries(ROLES.map((role) => [role, verdict(id, role)]));
  let roles = ROLES.filter((role) => v[role] === "visas" || v[role] === "pekar om" || (!["nekas", "inte i menyn"].includes(v[role]) && ownNodeRoles(n).includes(role)));
  if (n.parent && !seen.has(id)) { seen.add(id); const up = appRolesOf(n.parent, seen); roles = roles.filter((role) => up.includes(role) || v[role] === "visas"); }
  APP_ROLES.set(id, roles);
  return roles;
}
const edgeAppRoles = (e) => {
  const from = [...new Set([e.from, ...(e.also || [])].flatMap((id) => appRolesOf(id)))];
  return only(only(e.ownRoles || ROLES, from), appRolesOf(e.to));
};
const ROLE_NAME = { superadmin: "produktadmin", admin: "kundföretagets admin", member: "medarbetaren" };
const isPageBox = (n) => ["view", "variant", "step", "section", "public"].includes(n.kind);
if (OBS) {
  const rows = [];
  for (const f of OBS.findings || []) rows.push({ id: observedNode(f.page || f.address) || "v:stats", kind: "finding", sub: f.kind, title: f.title, status: f.status || "öppet",
    ...(f.commit ? { commit: f.commit } : {}), ...(f.note ? { note: f.note } : {}), runs: f.runs || [], address: f.address, ...(f.also ? { also: f.also } : {}) });
  for (const n of nodes.values()) if (n.robotOnly) rows.push({ id: n.id, kind: "robotNode", title: "Nådd av roboten men saknas i koden", status: "öppet", runs: [...testedRuns(n.id)], address: n.address });
  for (const e of edges.values()) if (e.robotOnly) rows.push({ id: e.from, to: e.to, kind: "robotEdge", title: `Väg som bara roboten hittade → ${nodes.get(e.to)?.label || e.to}`, status: "öppet", runs: edgeTested(e), note: e.label });
  // The code's roles against the robot's (QA's roles): where they disagree.
  for (const n of nodes.values()) {
    if (!["view", "variant"].includes(n.kind)) continue;
    for (const role of ROLES) {
      const v = verdict(n.id, role), code = rolesOf(n.id).includes(role);
      const text = code && v === "nekas" ? `Koden säger att ${ROLE_NAME[role]} når sidan; roboten fick behörighetsrutan`
        : code && v === "inte i menyn" ? `Koden ger ${ROLE_NAME[role]} en menyrad hit; QA:s ${role === "member" ? "medarbetare" : ROLE_NAME[role]} hade ingen`
          : !code && v === "visas" ? `Roboten nådde sidan som ${ROLE_NAME[role]}; koden säger att rollen inte når den` : null;
      if (text) rows.push({ id: n.id, kind: "roleMap", title: text, status: "öppet", runs: [`${role}-desktop`], note: "Visa som följer robotens prov" });
    }
  }
  const back = OBS.back || {};
  if (back.checks) rows.push({ id: "v:stats", kind: "back", title: `Bakåt: ${back.ok} av ${back.checks} rätt, ${back.notTried || 0} kunde inte provas, ${back.wrong || 0} fel`, status: back.wrong ? "öppet" : "inget fel", runs: (OBS.runs || []).map((r) => r.run) });
  // Bakåt first, then what is open (findings, roles, what only the robot found), then the fixed and the dismissed.
  const rank = (r) => (r.kind === "back" ? 0 : r.status === "öppet" ? 1 + ["finding", "roleMap", "robotNode", "robotEdge"].indexOf(r.kind) / 10 : r.status === "rättat" ? 2 : 3);
  anomalies.observed = rows.map((r, i) => [r, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([r]) => r);
}

// ---------------------------------------------------------------------------------------------------------------
// 7. Skriv ut.
const CATS = [
  { key: "tree", label: "Trädet (förälder → barn, brödsmulorna)", color: "#8a94a6", on: true, dash: "" },
  { key: "menu", label: "Menylänkar på datorn (sidomeny, topprad, profilmeny)", color: "#0a72e8", on: true, dash: "" },
  { key: "phone", label: "Telefonens flikrad, Mer, Ny och Hem-rutor", color: "#22a447", on: true, dash: "" },
  { key: "inpage", label: "Länkar inne på sidor (knappar, kort, rader)", color: "#e09a00", on: true, dash: "" },
  { key: "redirect", label: "Gamla adresser som pekar om (redirect, alias)", color: "#e5372c", on: true, dash: "6 4" },
  { key: "popup", label: "Popupar, steg (step=) och avsnitt (section=)", color: "#9b4fd6", on: true, dash: "2 3" },
  { key: "system", label: "Servern: notiser, mejl, sök och AI", color: "#0f9cb8", on: false, dash: "1 4" },
  { key: "via", label: "Via en enskild post (ett jobb, en kund …), när de är dolda", color: "#0d9488", on: true, dash: "10 4" },
  ...(OBS ? [{ key: "robot", label: "Bara hittad av roboten (saknas i koden)", color: "#db2777", on: true, dash: "4 2 1 2" }] : []),
  ...(serviceList.length ? [
    { key: "service-admin", label: "Externa tjänster: där nyckeln och inställningen finns", color: "#c2410c", on: true, dash: "8 3" },
    { key: "service-use", label: "Externa tjänster: sidor som använder tjänsten", color: "#64748b", on: false, dash: "3 3" },
  ] : []),
];
// An outside service is no page: the robot never opens it, so it carries no Provat i appen mark (always shown).
const isService = (n) => n.kind === "service" || n.id === "e:extern" || n.id.startsWith("t:");
const nodeList = [...nodes.values()].map((n) => {
  const out = { id: n.id, kind: n.kind, label: n.label, level: n.level, parent: n.parent || null, type: n.type || "neutral" };
  for (const k of ["view", "address", "note", "cond", "valid", "inDemo", "phoneHidden", "reach", "dead", "step", "section", "old", "item", "robotOnly", "service"]) if (n[k] !== undefined && n[k] !== null && n[k] !== false) out[k] = n[k];
  out.roles = rolesOf(n.id);
  if (OBS && !isService(n)) {
    out.tested = [...testedRuns(n.id)];
    out.appRoles = appRolesOf(n.id);
    const probe = Object.fromEntries(ROLES.map((role) => [role, verdict(n.id, role)]).filter(([, v]) => v));
    if (Object.keys(probe).length) out.probe = probe;
  }
  out.refs = (n.refs || []).filter(Boolean).slice(0, 12);
  return out;
});
const edgeList = [...edges.values()].map((e) => ({ from: e.from, to: e.to, cat: e.cat, ...(e.label ? { label: e.label } : {}), ...(e.cond ? { cond: e.cond } : {}), ...(e.device ? { device: e.device } : {}), ...(e.dead ? { dead: true, reason: e.reason } : {}), ...(e.shared ? { shared: true } : {}), ...(e.always ? { always: true } : {}), ...(e.also && e.also.length ? { also: e.also } : {}), ...(e.robotOnly ? { robotOnly: true } : {}),
  roles: edgeRoles(e), ...(OBS && !SERVICE_CATS.has(e.cat) && !isService(nodes.get(e.to) || { id: "" }) ? { tested: edgeTested(e), appRoles: edgeAppRoles(e) } : {}), refs: e.refs.filter(Boolean).slice(0, 12) }));
// The robot's counts are over what it can open: the outside services carry no mark.
const triable = (list) => list.filter((item) => item.tested !== undefined);
const byRole = Object.fromEntries(ROLES.map((role) => [role, nodeList.filter((n) => n.roles.includes(role)).length]));
const observedMeta = OBS ? (() => {
  const pagesAll = nodeList.filter(isPageBox), testedPages = pagesAll.filter((n) => n.tested.length);
  const rows = anomalies.observed || [];
  const status = (s) => rows.filter((r) => r.kind === "finding" && r.status === s).length;
  return {
    date: OBS.date || null, commit: OBS.commit || null, target: OBS.target || null, runs: OBS.runs || [], back: OBS.back || null,
    counts: {
      boxes: triable(nodeList).length, boxesTested: triable(nodeList).filter((n) => n.tested.length).length, pages: pagesAll.length, pagesTested: testedPages.length,
      edges: triable(edgeList).length, edgesTested: triable(edgeList).filter((e) => e.tested.length).length, robotNodes: nodeList.filter((n) => n.robotOnly).length, robotEdges: edgeList.filter((e) => e.robotOnly).length,
      findings: rows.filter((r) => r.kind === "finding").length, fixed: status("rättat"), open: status("öppet"), dismissed: status("avfärdat"),
    },
    byRole: Object.fromEntries(ROLES.map((role) => [role, nodeList.filter((n) => (n.appRoles || n.roles).includes(role)).length])),
  };
})() : null;
return {
  generated: new Date().toISOString(), version, repo: REPO.split(path.sep).join("/"), branch: git.branch, commit: git.commit,
  colors: COLORS, cats: CATS, roles: ROLES, nodes: nodeList, edges: edgeList, anomalies, ...(observedMeta ? { observed: observedMeta } : {}),
  ...(serviceList.length ? { serviceOwners: Object.entries(SVC.KEY_OWNERS).map(([key, owner]) => ({ key, ...owner })) } : {}),
  stats: { views: nodeList.filter((n) => n.kind === "view").length, pages: nodeList.filter((n) => ["view", "variant", "public"].includes(n.kind)).length, nodes: nodeList.length, edges: edgeList.length, modals: modalCount, dynamicLinks, scannedFiles: SCAN.length, services: nodeList.filter((n) => n.kind === "service").length, byRole },
};
}

/**
 * The robot's round (scripts/sitemap/observed.json, written by scripts/sitemap/crawl/summarize.cjs): `false` = none, an
 * object = that data, a string = that file, otherwise the repository's own file. A missing or broken file means no marking.
 */
function loadObserved(observed, repo) {
  if (observed === false || observed === null) return null;
  if (typeof observed === "object") return observed;
  const file = typeof observed === "string" ? observed : [path.join(repo, "scripts", "sitemap", "observed.json"), path.join(__dirname, "observed.json")].find((f) => fs.existsSync(f));
  if (!file || !fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

/** The stand-alone page: scripts/sitemap/template.html with the data in it. */
function writeHtml(data, file) {
  const template = fs.readFileSync(path.join(__dirname, "template.html"), "utf8");
  const json = JSON.stringify(data).replace(/</g, "\u003c");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, template.replace("__MAP_DATA__", () => json), "utf8");
}

const HELP = `Webbplatskartan: node scripts/sitemap/generate.cjs [--out <fil>] [--html <fil>] [--observed <fil> | --no-observed] [--build]

Kartan räknas ur koden. Finns scripts/sitemap/observed.json (klickrobotens omgång) märks varje ruta och linje
"Provad i appen" eller "Bara i koden", vägar som bara roboten hittade blir linjesorten "robot" och robotens fynd
står under Iakttagelser → Provat i appen.

Köra om roboten (bara mot QA på loopback, aldrig när QA provas för ett släpp) – se scripts/sitemap/README.md:
  node scripts/sitemap/crawl/crawl.cjs <superadmin|admin|member> <desktop|phone>   (alla sex kombinationerna)
  node scripts/sitemap/crawl/roles.cjs
  node scripts/sitemap/crawl/back.cjs <roll>-<enhet>                                 (alla sex)
  node scripts/sitemap/crawl/recheck.cjs
  node scripts/sitemap/crawl/summarize.cjs [--commit <sha>]   → scripts/sitemap/observed.json (committas)`;

function main(argv) {
  const arg = (name) => { const at = argv.indexOf(name); return at >= 0 && argv[at + 1] ? argv[at + 1] : null; };
  try {
    if (argv.includes("--help")) { console.log(HELP); return; }
    const data = buildSitemap({ observed: argv.includes("--no-observed") ? false : arg("--observed") || undefined });
    const out = path.resolve(arg("--out") || DEFAULT_OUT(path.join(__dirname, "..", "..")));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(data), "utf8");
    const byCat = {};
    for (const e of data.edges) byCat[e.cat] = (byCat[e.cat] || 0) + 1;
    console.log(`Webbplatskarta: ${data.stats.nodes} rutor (${data.stats.pages} sidor, ${data.stats.views} vyer), ${data.stats.edges} linjer`, byCat);
    console.log(`Avvikelser: utan inkommande ${data.anomalies.noIncoming.length}, flera menyvägar ${data.anomalies.multiMenu.length}, en enhet ${data.anomalies.oneDevice.length}, döda ${data.anomalies.dead.length}`);
    if (data.observed) {
      const c = data.observed.counts;
      console.log(`Provat i appen (${data.observed.date}): ${c.boxesTested} av ${c.boxes} rutor, ${c.pagesTested} av ${c.pages} sidor och steg, ${c.edgesTested} av ${c.edges} linjer; bara hos roboten ${c.robotNodes} rutor och ${c.robotEdges} vägar; fynd ${c.fixed} rättade, ${c.open} öppna, ${c.dismissed} avfärdade`);
    } else console.log("Provat i appen: ingen scripts/sitemap/observed.json – kartan visar bara koden");
    console.log(`Skrev ${out}`);
    const html = arg("--html");
    if (html) { writeHtml(data, path.resolve(html)); console.log(`Skrev ${path.resolve(html)}`); }
  } catch (error) {
    // After `next build` the map is a help for the superadmin, never a reason for a failed release.
    if (!argv.includes("--build")) throw error;
    console.warn(`Webbplatskartan kunde inte räknas fram (${error && error.message}); bygget fortsätter utan den.`);
  }
}

module.exports = { buildSitemap, writeHtml, ROLES, DEFAULT_OUT };
if (require.main === module) main(process.argv.slice(2));
