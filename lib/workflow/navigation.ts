import { settingsPlace } from "./settings-tabs";

/**
 * Navigation as one whole (2026-10-09, docs/ui-system.md): the names of the pages and how they hang together.
 * Breadcrumbs lead to the pages ABOVE the current one (parents, never the history); the back and forward buttons follow
 * the visits (lib/workflow/history-stack.ts); Stäng ends a temporary view and Avbryt ends editing without saving. Pure,
 * so the shell, the tests and the documentation read the same rules.
 */

/** The name of every page (view) in the workspace, as the menu, the breadcrumbs and the page titles say it. */
export const VIEW_LABEL = {
  stats: "Översikt",
  setup: "Ställ in Workflow",
  notifications: "Notiser",
  new: "Kontroll före idrifttagning",
  new_task: "Ny uppgift",
  workflow_task: "Uppgift",
  // A menu button's list is called as the button (2026-10-23, point 5 at the review): "Arbetsordrar", not "Mina
  // arbetsordrar"; the list's own Mina/Alla choice is unchanged.
  controls: "Uppgifter",
  tasks: "Uppgifter",
  work_orders: "Arbetsordrar",
  new_project: "Nytt projekt",
  projects: "Projekt",
  project: "Projekt",
  project_summary: "Projektstatistik",
  // Inköp (2026-10-16): Nytt inköp, Mina inköp and Artiklar, a group of its own above Offert.
  purchase: "Nytt inköp",
  purchases: "Inköp",
  articles: "Artiklar",
  quote: "Ny offert",
  quotes: "Offerter",
  // Fakturaunderlag (2026-10-28): the company's list of invoice bases, a page under Offerter like Artiklar under Inköp.
  invoice_bases: "Fakturaunderlag",
  customer_invoices: "Fakturor",
  rounds: "Driftronder",
  // Avvikelser (2026-10-30): the company's deviation log – Egenkontroll, Riskobservation, Tillbud, Olycksfall – a page of
  // its own in the work part of the menu, not a part of the egenkontroll programme.
  deviations: "Avvikelser",
  // Underhåll (2026-10-30): the machine tree, the store and the maintenance items – Cloud, with the right Underhåll.
  maintenance: "Underhåll",
  // Planering (2026-11-01): a menu button with the views Kalender (view=planning), Tidplan (view=project_planning,
  // plan 1M) and Kapacitet (view=capacity); all are called Planering.
  planning: "Planering",
  project_planning: "Planering",
  capacity: "Planering",
  time: "Tid",
  // Verktyg (called Register for a while in point 5; Verktyg again 2026-10-23); the customer register is the menu button Kunder (B2).
  // Mer (2026-11-13): the menu button and the hub page have the same name, as Mer on the phone.
  tools: "Mer",
  demo: "Demo",
  report_archive: "Rapportarkiv",
  calculators: "Kalkylator",
  facilities: "Platser",
  place: "Plats",
  place_labels: "QR-etiketter",
  customers: "Kunder",
  self_inspection: "Egenkontroll",
  instruments: "Instrument",
  import: "Import",
  forms: "Skapa formulär",
  credits: "Abonnemang",
  help: "Hjälp",
  settings: "Inställningar",
  // Användare and Operatörskonton (2026-10-31): menu buttons of their own under Företaget, as lists with own pages.
  administration: "Användare",
  operator_accounts: "Operatörskonton",
  integrations: "API och MCP",
  ai_settings: "Workflow AI",
  company_values: "Värden och referenser",
  history_retention: "Historik och lagring",
  company: "Företag",
  // One page per tab since 2026-10-15 (lib/workflow/settings-tabs.ts): a tab's page carries the tab's name; an older
  // address that became a part of a page keeps the part's name here.
  advanced: "Kopplingar",
  company_features: "Arbetssätt",
  company_website: "Min webbsida",
  company_posts: "Inlägg",
  company_settings: "Företaget",
  quote_settings: "Priser och offert",
  view_as: "Visa som",
  // C6 (2026-10-21): the e-mail server is on Tjänster och nycklar, which mails are sent on Drift och säkerhet.
  mail_settings: "Tjänster och nycklar",
  login_settings: "Drift och säkerhet",
  mailings: "Utskick",
  behavior_analytics: "Beteendeanalys",
  server_keys: "Tjänster och nycklar",
  services: "Tjänster och nycklar",
  landing_editor: "Landningssidan",
  pdf_templates: "PDF-mallar",
  plc_devices: "PLC-apparater",
  customer_companies: "Installation",
  product_overview: "Produktöversikt",
  pricing_admin: "Priser",
  ai_admin: "AI-kostnad",
} as const;
export type ViewKey = keyof typeof VIEW_LABEL;

/**
 * The pages gathered under Verktyg (2026-10-09; Kunder left it for a button of its own, B2 2026-10-21, and Skapa
 * formulär moved here from Uppgifter 2026-10-23), in the order the menu and the hub show them.
 */
export const SUPPORT_VIEWS = ["report_archive", "self_inspection", "instruments", "calculators", "forms", "import"] as const;
export type SupportView = (typeof SUPPORT_VIEWS)[number];
/** One line per support page for the hub page and the settings. */
export const SUPPORT_DESCRIPTION: Record<SupportView, string> = {
  report_archive: "PDF- och Excelrapporter som sparades vid export.",
  self_inspection: "Företagets egenkontrollprogram, roller och kompetens.",
  instruments: "Mätinstrument med kalibrering.",
  calculators: "Effekt, transformator, kortslutning, frånkoppling, spänningsfall och kabel.",
  import: "Läs in kunder, projekt, arbete och prisfiler från fil.",
  forms: "Företagets egna formulär och protokoll.",
};


export type Crumb = { label: string; href: string | null };

/** Names a page knows only after reading its record (a project's name, a customer's, a task's title). */
export type TrailLabels = {
  project?: string;
  customer?: string;
  /** The customer page is the company's own places (Eget företag, 2026-10-24): its trail is Företag, not Kunder. */
  ownCompany?: boolean;
  place?: string;
  task?: string;
  workOrder?: string;
  quote?: string;
  /** The opened purchase's name ("Kabel till hus 2", or "Inköp I-0035" without one; Lika är rätt 2026-11-13, before "Inköp › Inköp"). */
  purchase?: string;
  /**
   * The heading of a page that is not saved yet and names itself (simulation 0.6.3: a new protocol said "Ny uppgift" in
   * the trail and "Ny kontroll" as its heading); given by the editor's header and used for a new task only.
   */
  heading?: string;
  /** The open calculator of the Kalkylator page (2026-10-12). */
  calculator?: string;
  /** The opened entry of Avvikelser ("Tillbud 3", 2026-10-30). */
  deviation?: string;
  /** The opened company of Kundföretag (the plan's SA12, 2026-11-01). */
  company?: string;
};
export type TrailInput = {
  view: string;
  params?: Partial<Record<"customerId" | "projectId" | "taskId" | "taskType" | "placeId" | "quoteId" | "purchaseId" | "workOrderId" | "edit" | "new" | "link" | "activityId" | "roundId" | "tool" | "deviation" | "item" | "person" | "invitation" | "account" | "companyId" | "fromCustomer" | "invoices", string | null | undefined>>;
  labels?: TrailLabels;
};

const href = (view: string, query: Record<string, string | null | undefined> = {}) => {
  const rest = Object.entries(query).filter(([, value]) => value).map(([key, value]) => `&${key}=${encodeURIComponent(value!)}`).join("");
  return `/?view=${view}${rest}`;
};
const crumb = (view: ViewKey, query?: Record<string, string | null | undefined>): Crumb => ({ label: VIEW_LABEL[view], href: href(view, query) });
const shorten = (text: string, max = 48) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const named = (label: string | undefined, fallback: string) => shorten((label ?? "").trim() || fallback);

/** The list a task of this kind lives in when it belongs to no project or work order. */
function taskListCrumb(taskType: string | null | undefined): Crumb {
  return taskType === "WORK_ORDER" ? crumb("work_orders") : crumb("tasks");
}

/** The label sheet of a round (QR hör till driftronden, 2026-10-22): printed from the round, for its place and the objects under it. */
export const roundLabelsHref = (roundId: string) => `/?view=place_labels&roundId=${encodeURIComponent(roundId)}`;

/**
 * The page whose menu button (and tab) the open page marks, from the names the page gave its trail: Företagets platser is
 * the customer page of the company's own record, so like its trail it belongs to Företag under Inställningar – the menu
 * marks Inställningar and the phone's tab row Mer, not Kunder (2026-10-24). Every other page marks its own view.
 */
export function menuViewOfPage(view: string, labels: TrailLabels | null | undefined, fromCustomer?: string | null): string {
  if (view === "customers" && labels?.ownCompany) return "company";
  // A job opened from a customer's page (N14, 2026-11-01) marks Kunder, like its trail.
  if (view === "workflow_task" && fromCustomer) return "customers";
  return view;
}

/**
 * The breadcrumb trail of a page: Översikt first, then every parent page with a link, and the page itself last without a
 * link. A task inside a project shows the project; a task that belongs to a work order shows the work order (and that
 * work order's project). Names that are not known yet fall back to the kind of page ("Projekt", "Arbetsorder").
 */
export function breadcrumbTrail({ view, params = {}, labels = {} }: TrailInput): Crumb[] {
  const root = crumb("stats");
  const here = (label: string): Crumb => ({ label, href: null });
  const known = (Object.keys(VIEW_LABEL) as string[]).includes(view) ? view as ViewKey : "stats";
  if (known === "stats") return [here(VIEW_LABEL.stats)];
  const tools = crumb("tools");
  const customers = crumb("customers");
  switch (known) {
    case "new_task": return [root, crumb("tasks"), here(VIEW_LABEL.new_task)];
    case "new": return [root, crumb("tasks"), here(VIEW_LABEL.new)];
    // Forms as pages (plan 1O, 2026-10-11): Ny rond / Ändra rond and Ny planering / Redigera planering lie under their list.
    case "rounds": if (params.new || params.edit) return [root, crumb("rounds"), here(params.new ? "Ny driftrond" : "Ändra rond")]; return [root, here(VIEW_LABEL.rounds)];
    // Planering is a menu button (2026-11-01), the forms of its Kalender under it.
    case "planning": if (params.new || params.edit) return [root, crumb("planning"), here(params.new ? "Ny planering" : "Redigera planering")]; return [root, here(VIEW_LABEL.planning)];
    case "purchase": return [root, crumb("purchases"), here(params.purchaseId ? named(labels.purchase, "Inköp") : VIEW_LABEL.purchase)];
    case "articles": return [root, crumb("purchases"), here(VIEW_LABEL.articles)];
    // Under Fakturor when the person has that button (kundresa 2026-11-07, M39), else under Offerter.
    case "invoice_bases": return [root, crumb(params.invoices ? "customer_invoices" : "quotes"), here(VIEW_LABEL.invoice_bases)];
    // Fakturor is its own menu button (2026-11-04), not a page under Offerter (resa 2026-11-06).
    case "customer_invoices": return [root, here(VIEW_LABEL.customer_invoices)];
    case "controls": case "tasks": case "work_orders": case "projects": case "quotes": case "purchases": case "time": case "notifications": case "tools":
      return [root, here(VIEW_LABEL[known])];
    case "new_project": return [root, crumb("projects"), here(VIEW_LABEL.new_project)];
    case "project_summary": return [root, crumb("projects"), here(VIEW_LABEL.project_summary)];
    case "project_planning": case "capacity": return [root, here(VIEW_LABEL.planning)];
    case "project": {
      const name = named(labels.project, VIEW_LABEL.project);
      // The project's own forms as pages: Redigera projekt, Koppla befintlig uppgift, Ny / Redigera planering.
      const form = params.link ? "Koppla befintlig uppgift" : params.new ? "Ny planering" : params.activityId && params.edit ? "Redigera planering" : params.edit ? "Redigera projekt" : null;
      return form ? [root, crumb("projects"), { label: name, href: href("project", { projectId: params.projectId }) }, here(form)] : [root, crumb("projects"), here(name)];
    }
    case "quote": return [root, crumb("quotes"), here(params.quoteId ? named(labels.quote, "Offert") : VIEW_LABEL.quote)];
    case "workflow_task": {
      const isWorkOrder = params.taskType === "WORK_ORDER";
      const title = params.taskId ? named(labels.task, isWorkOrder ? "Arbetsorder" : "Uppgift") : named(labels.heading, isWorkOrder ? "Ny arbetsorder" : "Ny uppgift");
      // Opened from a customer's page (N14, 2026-11-01): the way there, not the project's.
      if (params.fromCustomer) return [root, customers, { label: named(labels.customer, "Kund"), href: href("customers", { customerId: params.fromCustomer }) }, here(title)];
      const parents: Crumb[] = [];
      if (params.projectId) parents.push(crumb("projects"), { label: named(labels.project, VIEW_LABEL.project), href: href("project", { projectId: params.projectId }) });
      if (params.workOrderId && !isWorkOrder) {
        if (!params.projectId) parents.push(crumb("work_orders"));
        parents.push({ label: named(labels.workOrder, "Arbetsorder"), href: href("workflow_task", { taskId: params.workOrderId, taskType: "WORK_ORDER" }) });
      }
      if (!parents.length) parents.push(taskListCrumb(params.taskType));
      return [root, ...parents, here(title)];
    }
    case "customers":
      // Ny kund lives in the register, like a customer card (simulation 0.6.3); Kunder is a menu button of its own (B2).
      if (!params.customerId) return params.new ? [root, customers, here("Ny kund")] : [root, here(VIEW_LABEL.customers)];
      if (labels.ownCompany) return [root, crumb("company"), here("Företagets platser")];
      return params.edit
        ? [root, customers, { label: named(labels.customer, "Kund"), href: href("customers", { customerId: params.customerId }) }, here("Redigera kund")]
        : [root, customers, here(named(labels.customer, "Kund"))];
    case "place": {
      const owner: Crumb[] = params.customerId ? [{ label: named(labels.customer, "Kund"), href: href("customers", { customerId: params.customerId }) }] : [];
      const placeName = named(labels.place, VIEW_LABEL.place);
      // Ny plats under this place / Redigera plats are pages of their own (plan 1O).
      if (params.new || params.edit) return [root, customers, ...owner, { label: placeName, href: href("place", { placeId: params.placeId, customerId: params.customerId }) }, here(params.new ? "Ny plats" : "Redigera plats")];
      // Otherwise the address only leads on to the customer's page with the place folded out (no page of its own,
      // 2026-10-14), so it has that page's trail from the start: one crumb more while it loads made the top bar jump.
      return [root, customers, here(named(labels.customer, "Kund"))];
    }
    // QR hör till driftronden (2026-10-22): the label sheet lies under Driftronder, also for an older address from the register.
    case "place_labels": return [root, crumb("rounds"), here(VIEW_LABEL.place_labels)];
    // Avvikelser (2026-10-30): the log, and Rapportera avvikelse under it (`&new=`).
    // Rapportera avvikelse (&new=) is a DialogPage: it adds its own name to the trail.
    // One entry (`&deviation=`, 2026-10-30: the list opens the entry) lies under the list.
    case "deviations": return params.deviation ? [root, crumb("deviations"), here(named(labels.deviation, "Avvikelse"))] : [root, here(VIEW_LABEL.deviations)];
    // Underhåll (2026-10-30): the module, and one maintenance item (`&item=`) under it.
    case "maintenance": return params.item ? [root, crumb("maintenance"), here(named(labels.heading, "Underhållspost"))] : [root, here(VIEW_LABEL.maintenance)];
    // Skapa formulär is one of Verktyg's pages since 2026-10-23 (it stood under Uppgifter before).
    case "report_archive": case "self_inspection": case "instruments": case "import": case "forms":
      return [root, tools, here(VIEW_LABEL[known])];
    // Kalkylator (2026-10-12): the list, and a calculator under it (a screen of its own on a phone at level 1).
    case "calculators":
      return params.tool ? [root, tools, crumb("calculators"), here(named(labels.calculator, VIEW_LABEL.calculators))] : [root, tools, here(VIEW_LABEL.calculators)];
    // Användare is a tab of Inställningar and Operatörskonton a page under it (2026-11-02): the list, and one person's,
    // invitation's or account's own page under it (Kunders upplägg).
    case "administration": return params.person || params.invitation ? [root, crumb("settings"), crumb("administration"), here(named(labels.heading, "Person"))] : [root, crumb("settings"), here(VIEW_LABEL.administration)];
    case "operator_accounts": return params.account ? [root, crumb("settings"), crumb("administration"), crumb("operator_accounts"), here(named(labels.heading, "Konto"))] : [root, crumb("settings"), crumb("administration"), here(VIEW_LABEL.operator_accounts)];
    case "facilities": return [root, crumb("settings"), here(VIEW_LABEL.facilities)];
    case "setup": return [root, crumb("settings"), here(VIEW_LABEL.setup)];
    // Värden och referenser keeps a page of its own, reached from Arbetssätt (UX-granskningen C2, 2026-10-22).
    case "company_values": return [root, crumb("settings"), { label: "Arbetssätt", href: href("company_features") }, here(VIEW_LABEL.company_values)];
    // A company's own page (the plan's SA12, 2026-11-01) under the list of Kundföretag.
    case "customer_companies": if (params.companyId) return [root, crumb("customer_companies"), { label: "Kundföretag", href: href("customer_companies") }, here(named(labels.company, "Kundföretag"))];
    // falls through
    default: {
      // The pages under Inställningar and Installation (lib/workflow/settings-tabs.ts): one page per tab since
      // 2026-10-15, so the trail ends with the tab's name, also for an older address that lands on a part of the page
      // (?view=view_as → Installation › Inloggning och säkerhet). Webbplats alone has two pages: › Webbplats › Beteendeanalys.
      // The first tab too (2026-10-24, analysens fråga 4): Översikt › Inställningar › Mina inställningar and
      // Översikt › Installation › Kundföretag, so the last crumb is always the page's heading.
      const place = settingsPlace(known);
      if (!place) return [root, here(VIEW_LABEL[known])];
      const area = place.area === "settings" ? crumb("settings") : { ...crumb("customer_companies"), href: href("product_overview") };
      return place.section
        ? [root, area, { label: place.tab.label, href: href(place.tab.key) }, here(place.section.label)]
        : [root, area, here(place.tab.label)];
    }
  }
}

/** The parent page (the last crumb with a link), where "upp en nivå" leads; null on Översikt. */
export function parentCrumb(trail: Crumb[]): Crumb | null {
  for (let index = trail.length - 2; index >= 0; index -= 1) if (trail[index].href) return trail[index];
  return null;
}

/**
 * Where to go after a register page was opened from ongoing work ("Redigera kund" on a work order, 2026-10-09): only an
 * address inside the workspace is followed, never another site (`returnTo` comes from the address bar).
 */
export function safeReturnTo(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.trim();
  if (!text.startsWith("/?") || text.startsWith("//") || /[\s\\]/.test(text) || text.length > 1000) return null;
  return text;
}

/** The address of the current work with one parameter set (the customer just created, to be chosen on return). */
export function withParam(address: string, key: string, value: string): string {
  const [path, query = ""] = address.split("?");
  const params = new URLSearchParams(query);
  params.set(key, value);
  return `${path}?${params.toString()}`;
}

/**
 * One page for a customer's places (2026-10-24): the place in a work order and the customer's Anläggningar are the
 * same thing, so the pen beside a chosen place opens the customer's page at that place (level 1: its Platser screen). The
 * page is pushed, so Bakåt returns to the work order.
 */
export function customerPlaceHref(customerId: string, placeId: string, native = false): string {
  return `/?view=customers&customerId=${encodeURIComponent(customerId)}&place=${encodeURIComponent(placeId)}${native ? "&step=platser" : ""}`;
}

/**
 * The menu group a view belongs to (plan 1S, 2026-10-11), used by the site map (scripts/sitemap). It was the small
 * eyebrow over every page's heading until 2026-10-30, when the eyebrow was removed (Fasta platser: the breadcrumbs say where
 * you are, and the eyebrow pushed the heading down on some pages only). `null` for a view of no group.
 */
export function viewGroupLabel(view: string): string | null {
  switch (view) {
    case "stats": case "setup": case "notifications": return "Start";
    case "quote": case "quotes": case "invoice_bases": case "customer_invoices": return "Offerter";
    case "purchase": case "purchases": case "articles": return "Inköp";
    case "planning": case "project_planning": case "capacity": return "Planering";
    case "projects": case "new_project": case "project": case "project_summary": return "Projekt";
    case "work_orders": case "tasks": case "controls": case "new_task": case "new": case "workflow_task": return "Arbetsordrar";
    // QR hör till driftronden (2026-10-22): the label sheet marks Driftronder.
    case "rounds": case "place_labels": return "Driftronder";
    case "deviations": return null;
    case "maintenance": return "Underhåll";
    // B1 (point 5): the menu button Tid.
    case "time": return "Tid";
    case "customers": case "place": return "Kunder";
    case "tools": case "report_archive": case "self_inspection": case "instruments": case "import": case "forms": case "calculators": return VIEW_LABEL.tools;
    case "facilities": case "administration": case "operator_accounts": return "Inställningar";
    default: {
      const place = settingsPlace(view);
      if (place) return place.area === "settings" ? "Inställningar" : "Installation";
      return null;
    }
  }
}
