import { canReadRounds, hasWorkflowPermission, type WorkflowPermissionProfile, type WorkflowPermissionSubject } from "./permissions";
import { SUPPORT_VIEWS, type SupportView } from "./navigation";
import { MODULE_OF_MENU_ITEM, moduleInList } from "./modules";

/**
 * The menu buttons each person may hide (2026-09-30; since 2026-10-22 in Anpassa menyn under Mina inställningar).
 * Only what is shown changes – never what the person may do. Översikt and Inställningar always stay, so the way back is
 * never hidden, and a hidden page that is open is still shown while it is open. Grouped like the menu itself.
 *
 * B1 (2026-10-21, built in UX point 5): the menu shows nouns, not "Ny …"; each list page has its own "+ Ny …" top
 * right. The menu since 2026-11-02: Översikt · Planering | Arbetsordrar · Driftronder · Avvikelser ·
 * Underhåll · Tid | Kunder · Projekt · Offerter · Inköp | Verktyg | Inställningar. Workflow AI is an icon in the floating
 * navigation, Användare a tab of Inställningar and Operatörskonton a button on Användare; all three keep their keys here,
 * because Mer on the phone, the tab bar, the modules and saved choices read them, and only the computer's menu leaves them
 * out (`sidebarMenu`). Planering is a button of its own with the views Kalender · Tidplan · Kapacitet (the link from the page Projekt stays), and
 * Uppgifter is a tab of Arbetsordrar. Projektstatistik is reached from the page Projekt. Verktyg has a fold arrow and holds
 * Rapportarkiv, Egenkontroll, Instrument, Kalkylator, Skapa formulär, Import, Webb och inlägg (2026-11-20) and Nyheter (2026-11-21), each of which can also be a shortcut
 * directly in the menu.
 *
 * Labels (2026-10-22): `label` is the button's own name in the menu; `detail`, in smaller text under it in Anpassa
 * menyn and in the app's Mer sheet, says what follows it or where it sits. Hiding a button hides the rows under it only
 * when they are hidden too.
 */
export const MENU_ITEM_GROUPS = [
  { title: "Arbete", items: [
    // Planering (2026-11-01, decision 1): its own button with Kalender · Tidplan · Kapacitet; the first after Översikt.
    { key: "planning", label: "Planering", detail: "Kalender, Tidplan och Kapacitet" },
    // Uppgifter is a tab of Arbetsordrar (2026-11-01, decision 2).
    { key: "work_orders", label: "Arbetsordrar", detail: "Med Uppgifter" },
    { key: "rounds", label: "Driftronder" },
    // Avvikelser (2026-10-30): the company's deviation log, its own button beside the work (it was a tab of Egenkontroll).
    { key: "deviations", label: "Avvikelser" },
    // Underhåll (2026-10-30): Cloud only, with the right Underhåll – the machine tree, the store and the items.
    { key: "maintenance", label: "Underhåll" },
    { key: "time", label: "Tid" },
  ] },
  // Kunder and Ekonomi (2026-11-13: "Affär" did not feel right): who the work is for, then the money.
  { title: "Kunder", items: [
    // B2 (2026-10-21): the customer is a main concept, not a tool.
    { key: "customers", label: "Kunder" },
    // Projektstatistik is reached from the page Projekt, so it follows it; a project always belongs to a customer.
    { key: "projects", label: "Projekt" },
  ] },
  { title: "Ekonomi", items: [
    // Offerter (2026-10-09, steg B): Cloud only, with the right Offerter.
    { key: "quotes", label: "Offerter" },
    // Fakturor (2026-11-04): only with the company's setting on and the right to see invoices; nothing at all while it is off.
    { key: "customer_invoices", label: "Fakturor" },
    // Inköp (2026-10-16): Cloud only, for everyone who may put material on a work order or a quote; Artiklar is on its list.
    { key: "purchases", label: "Inköp", detail: "Med Artiklar" },
  ] },
  // Tavlor (2026-11-18, fråga 2): a row of its own, with Tabeller and Skärmar as tabs of its page.
  { title: "Uppföljning", items: [
    { key: "boards", label: "Tavlor", detail: "Med Tabeller och Skärmar" },
  ] },
  { title: "Verktyg", items: [
    { key: "report_archive", label: "Rapportarkiv" },
    // Egenkontroll (2026-10-06) and Instrument (2026-10-07): read by every active member.
    { key: "self_inspection", label: "Egenkontroll" },
    { key: "instruments", label: "Instrument" },
    // Kalkylator (2026-11-01, N19): a page of Verktyg like the others; it runs in the browser, so everyone has it.
    { key: "calculators", label: "Kalkylator" },
    // Skapa formulär hör till Verktyg (2026-10-23), not to Uppgifter.
    { key: "forms", label: "Skapa formulär" },
    { key: "import", label: "Import" },
    // Webb och inlägg (2026-11-20): Inlägg and Min webbsida, out of Inställningar; the company's admin, a module off from the start.
    { key: "web_posts", label: "Webb och inlägg", detail: "Inlägg och Min webbsida" },
    // Agenter (2026-11-21): Workflow AI's missions and the built-in agents; also from the chat's menu.
    { key: "agents", label: "Agenter", detail: "Uppdrag och inbyggda agenter" },
    // Nyheter (2026-11-21): the company's internal news, read by every member; last under Mer, so the menu above it stays as it was.
    { key: "news", label: "Nyheter" },
    // Dokument (0.87.0): the customers' and places' documents in one list; added on the customer's page, found here.
    { key: "documents", label: "Dokument" },
  ] },
  { title: "Assistent", items: [
    { key: "ai", label: "Workflow AI" },
  ] },
  // Företaget: rows of Mer on the phone only (2026-11-02). On a computer Användare is a tab of Inställningar and
  // Operatörskonton a button on it.
  { title: "Företaget", items: [
    { key: "administration", label: "Användare" },
    { key: "operator_accounts", label: "Operatörskonton" },
  ] },
] as const;
export const MENU_HIDEABLE = MENU_ITEM_GROUPS.flatMap((group) => group.items.map((item) => item.key)) as [MenuHideable, ...MenuHideable[]];
export type MenuHideable = (typeof MENU_ITEM_GROUPS)[number]["items"][number]["key"];
type MenuItem = { key: MenuHideable; label: string; detail?: string };
const MENU_ITEMS: readonly MenuItem[] = MENU_ITEM_GROUPS.flatMap((group) => group.items as readonly MenuItem[]);
/** The button's name in the menu (B1: nouns). */
export const MENU_LABEL = Object.fromEntries(MENU_ITEMS.map((item) => [item.key, item.label])) as Record<MenuHideable, string>;
/**
 * B4 (point 5): a line under a button in the app's Mer sheet and as the menu button's tooltip. Only Kalender had one
 * ("Teamets vecka"); it is a view of Planering since 2026-10-30, so none is left – the map stays for the next one.
 */
export const MENU_SUBTITLE: Partial<Record<MenuHideable, string>> = {};
/** The menu's name for the group of supporting pages (Verktyg; Register och verktyg before 2026-10-21, Register in point 5 until the review). */
/** The phone Mer sheet's and Anpassa menyn's section of the supporting pages keeps the word Verktyg (a "Mer" inside Mer would read oddly). */
export const TOOLS_GROUP_TITLE = "Verktyg";
export const TOOLS_LABEL = "Mer";

/**
 * Tidplan and Projektstatistik: Tidplan (view=project_planning) for whoever reads projects in Cloud and the demo (Local has
 * no Tidplan, decision 2026-10-09), Projektstatistik as /api/project-statistics (in Cloud, Teamet with the project right,
 * 2026-10-28). Planering's Kalender (view=planning) follows `calendarAllowed`.
 */
export type ProjectPage = "project_planning" | "project_summary";
export const PROJECT_PAGE_SUBTITLE: Record<ProjectPage, string> = { project_planning: "Tidplaner och teamets kalender", project_summary: "Statistik över företagets projekt" };

/**
 * Planering's Kalender, and with it the menu button Planering (2026-11-01): a standalone job's bookings follow the
 * job's own rights (2026-10-10, kartläggningen 5.11), so the project right or the right to read some kind of job
 * shows it. Tidplan's right (reading projects) is part of this rule. Every storage mode and the demo.
 */
export function calendarAllowed(access: MenuAccess | null | undefined): boolean {
  if (!access || !moduleInList(access.modules, "planning")) return false;
  const admin = access.memberRole === "OWNER" || access.memberRole === "ADMIN";
  const reads = (subject: WorkflowPermissionSubject) => admin || hasWorkflowPermission(access.workflowPermissions, subject, "read");
  return reads("projects") || (["kfid", "work-order", "risk-assessment", "forms"] as const).some(reads);
}
export function projectPageAllowed(key: ProjectPage, access: MenuAccess | null | undefined): boolean {
  if (!access || !moduleInList(access.modules, "projects") || (key === "project_planning" && !moduleInList(access.modules, "planning"))) return false;
  const admin = access.memberRole === "OWNER" || access.memberRole === "ADMIN";
  if (key === "project_summary") return (admin || (hasWorkflowPermission(access.workflowPermissions, "team", "read") && hasWorkflowPermission(access.workflowPermissions, "projects", "read"))) && !access.localStorageMode && !access.demo;
  return (admin || hasWorkflowPermission(access.workflowPermissions, "projects", "read")) && !access.localStorageMode;
}

/**
 * Where a button leads: its list. A person who may only create (not read) the kind of thing is led to Ny … instead, as
 * the menu's "Ny X" button did before point 5, so nobody is offered a list they cannot see.
 */
const MENU_ITEM_CREATE: Partial<Record<MenuHideable, string>> = {
  purchases: "/?view=purchase",
  quotes: "/?view=quote",
  projects: "/?view=new_project",
  work_orders: "/?view=workflow_task&taskType=WORK_ORDER",
  rounds: "/?view=rounds&new=1",
  deviations: "/?view=deviations&new=1",
};
export function menuItemHref(key: MenuHideable, canRead = true): string {
  if (canRead) return `/?view=${key}`;
  return MENU_ITEM_CREATE[key] ?? `/?view=${key}`;
}
/** What the person may read and create, per button; `tasks` is Arbetsordrar's tab Uppgifter. Left out: allowed. */
export type MenuRights = Partial<Record<MenuHideable | "tasks", boolean>>;
/**
 * The menu button's address. Arbetsordrar holds Uppgifter (2026-11-01), so whoever may read tasks but not work orders
 * is led to the tab Uppgifter, and whoever may only create tasks to Ny uppgift. The rights themselves do not change.
 */
export function menuButtonHref(key: MenuHideable, read: MenuRights = {}, create: MenuRights = {}, modules?: readonly string[] | null): string {
  // Företagets moduler (0.39.0): the button of Offerter leads to Fakturaunderlag when only that is on.
  if (key === "quotes" && !moduleInList(modules, "quotes")) return "/?view=invoice_bases";
  if (key === "work_orders" && read.work_orders === false) {
    if (read.tasks !== false) return "/?view=tasks";
    if (create.work_orders === false) return "/?view=new_task";
  }
  return menuItemHref(key, read[key] !== false);
}

/** The sub-pages that may also be a shortcut directly in the menu (the pages under Verktyg). */
export const MENU_SHORTCUTTABLE: readonly SupportView[] = SUPPORT_VIEWS;
export const isShortcuttable = (key: string): key is SupportView => (MENU_SHORTCUTTABLE as readonly string[]).includes(key);

/**
 * Saved menu choices from before point 5 (and older names of a button): a key that named a "Ny X" page, its list or the
 * whole Verktyg group is read as the button that holds it now. A key that is not a button is dropped, the rest kept –
 * so a hidden Projektstatistik or `project_planning` is simply dropped. A saved Uppgifter (`tasks`, a button until
 * 2026-11-01) is read as Arbetsordrar, which holds it now; a saved `planning` (Kalender) is the button Planering.
 */
const LEGACY_MENU_KEYS: Record<string, readonly MenuHideable[]> = {
  purchase: ["purchases"], articles: ["purchases"],
  quote: ["quotes"],
  new_project: ["projects"],
  // Uppgifter is a tab of Arbetsordrar since 2026-11-01: having hidden Uppgifter never hides Arbetsordrar, so these are dropped.
  tasks: [], new_task: [], controls: [], new: [],
  // Verktyg / Register och verktyg as one choice: its pages (Kunder left it 2026-10-21 and is not hidden by it; Skapa
  // formulär was not in it then, so it stays shown).
  tools: ["report_archive", "self_inspection", "instruments", "import"],
};
/** Hidden buttons as stored, read with today's keys (unknown keys dropped, no doubles). */
export function normalizeMenuHidden(items: readonly unknown[]): MenuHideable[] {
  const keys = items.flatMap((item): readonly MenuHideable[] => {
    if (typeof item !== "string") return [];
    if ((MENU_HIDEABLE as readonly string[]).includes(item)) return [item as MenuHideable];
    return LEGACY_MENU_KEYS[item] ?? [];
  });
  return [...new Set(keys)];
}
/**
 * Shortcuts as stored: only the pages under Verktyg. Kunder was a shortcut before B2 and is a button of its own now,
 * so a saved Kunder shortcut is simply shown as that button (it is dropped from the shortcuts).
 */
export function normalizeMenuShortcuts(items: readonly unknown[]): SupportView[] {
  return [...new Set(items.filter((item): item is SupportView => typeof item === "string" && isShortcuttable(item)))];
}

export const MENU_VISIBILITY_EVENT = "hintek:menu-visibility";
/** What the menu shows of the person's own choices: hidden buttons and sub-pages shown as shortcuts. */
export type MenuChoices = { hidden: readonly string[]; shortcuts: readonly string[] };
/** The event's detail (or the stored choices), read with today's keys; an older sender may still send the hidden list alone. */
export function menuChoicesOf(detail: unknown): MenuChoices {
  if (Array.isArray(detail)) return { hidden: normalizeMenuHidden(detail), shortcuts: [] };
  const value = (detail ?? {}) as Partial<Record<keyof MenuChoices, unknown>>;
  return {
    hidden: Array.isArray(value.hidden) ? normalizeMenuHidden(value.hidden) : [],
    shortcuts: Array.isArray(value.shortcuts) ? normalizeMenuShortcuts(value.shortcuts) : [],
  };
}
/** Mer's own choices in the event's detail (`phone`, 2026-10-24); null = Mer follows the menu's. */
export function phoneMenuChoicesOf(detail: unknown): MenuChoices | null {
  const phone = detail && typeof detail === "object" && !Array.isArray(detail) ? (detail as { phone?: unknown }).phone : null;
  return phone && typeof phone === "object" ? menuChoicesOf(phone) : null;
}

/** What decides whether a menu button is offered at all: the person's role and rights, and what the installation has. */
export type MenuAccess = {
  /** The company has invoicing on (Utfärda fakturor i Workflow under Arbetssätt → Fakturering; in the core since Fakturor came). */
  invoicingOn?: boolean;
  memberRole: "OWNER" | "ADMIN" | "MEMBER" | null;
  workflowPermissions: WorkflowPermissionProfile;
  canBuildForms?: boolean;
  localStorageMode?: boolean;
  /** This installation has Workflow AI and the Import page (both in ee/). */
  ai?: boolean;
  importPage?: boolean;
  demo?: boolean;
  /** Företagets moduler (0.39.0): the modules that are on in the company; left out is everything on (the demo). */
  modules?: readonly string[] | null;
};

/** The name of a button for the company: Offerter's button is Fakturaunderlag when only that is on. */
export const menuItemLabel = (key: MenuHideable, modules?: readonly string[] | null) => key === "quotes" && !moduleInList(modules, "quotes") ? "Fakturaunderlag" : MENU_LABEL[key];

/**
 * The menu shows only what the person may do (proposal 2026-10-08, step 4), and Anpassa menyn lists only those
 * buttons. Presentation only: the server checks every call against the same rights regardless of the menu.
 * A module the company has turned off is not offered to anyone (0.39.0); a right never brings it back. Mer, Verktyg, Hem and the tab
 * bar all come through here.
 */
export function menuItemAllowed(key: MenuHideable, access: MenuAccess | null | undefined): boolean {
  if (!access) return false;
  const itemModule = MODULE_OF_MENU_ITEM[key];
  if (itemModule && !moduleInList(access.modules, itemModule)) return false;
  // Fakturaunderlag shares Offerter's button: it stays while either is on.
  if (key === "quotes" && !moduleInList(access.modules, "quotes") && !moduleInList(access.modules, "invoicing")) return false;
  const admin = access.memberRole === "OWNER" || access.memberRole === "ADMIN";
  const can = (subject: WorkflowPermissionSubject, action: "read" | "create" | "edit") => admin || hasWorkflowPermission(access.workflowPermissions, subject, action);
  const readTasks = (["kfid", "work-order", "risk-assessment", "forms"] as const).some((subject) => can(subject, "read"));
  const cloud = !access.localStorageMode && !access.demo;
  switch (key) {
    // Arbetsordrar holds the tab Uppgifter (2026-11-01): whoever may only read or create tasks still has the button.
    case "work_orders": return can("work-order", "create") || readTasks || (["kfid", "risk-assessment", "forms"] as const).some((subject) => can(subject, "create"));
    case "planning": return calendarAllowed(access);
    case "projects": return can("projects", "create") || can("projects", "read");
    // Offerter are Cloud only; the public demo shows them too, from invented quotes in memory (features/demo/demo-quotes.ts).
    case "quotes": return (cloud || Boolean(access.demo && !access.localStorageMode)) && can("quotes", "read");
    case "customer_invoices": return (cloud || Boolean(access.demo && !access.localStorageMode)) && Boolean(access.invoicingOn) && can("invoicing", "read");
    // The same right as picking an article on a material row or a quote line (lib/catalogue/access.ts "pick"); Cloud only.
    // Inköp and Underhåll also in the public demo (2026-11-13: "i demo visa alla knappar som finns"), from its in-memory backends.
    case "purchases": return (cloud || Boolean(access.demo && !access.localStorageMode)) && (can("catalogue", "read") || can("work-order", "edit") || can("quotes", "edit"));
    // Tid follows the rights the server uses (2026-10-10, kartläggningen 5.11): time can be written on every task
    // type – also a protocol alone.
    // Driftronder are rounds of forms: the server's own rule (canReadRounds), not every task type.
    case "rounds": return canReadRounds(admin, access.workflowPermissions);
    // Underhåll (2026-10-30): a Cloud feature like the machine connection; hidden in Local, shown in the demo (2026-11-13).
    case "maintenance": return (cloud || Boolean(access.demo && !access.localStorageMode)) && can("maintenance", "read");
    // Tavlor (2026-11-18): the server counts the figures and the screens need it, so not in a company that keeps its data in its own file
    // (.hwf). In the demo since 0.72.0 (features/demo/demo-boards.ts counts the cards in the browser). Whoever may see boards, or only
    // the screens, has the button.
    case "boards": return (cloud || Boolean(access.demo && !access.localStorageMode)) && (admin || hasWorkflowPermission(access.workflowPermissions, "boards", "read") || hasWorkflowPermission(access.workflowPermissions, "screens", "read"));
    case "time": return readTasks;
    case "report_archive": return cloud && (readTasks || can("projects", "read"));
    // The customer register has its own permission since 2026-10-02 (decision 2.2).
    case "customers": return can("customers", "read");
    // Egenkontroll and Instrument are read by every active member; Kalkylator needs nothing from the server.
    case "self_inspection": case "instruments": case "calculators": return true;
    // Avvikelser: every active member reports and reads their own (selfInspectionAccess); the server decides what each sees.
    case "deviations": return true;
    case "ai": return Boolean(access.ai) && !access.localStorageMode; // Local shows no Workflow AI at all (2026-11-02): it could only say "Kräver serverlagring".
    // Import only for whoever may create something it imports (N11, 2026-11-01). Display only: the server checks every row as before.
    case "import": return Boolean(access.importPage) && cloud && (can("customers", "create") || can("projects", "create") || can("work-order", "create") || can("catalogue", "edit") || Boolean(access.canBuildForms));
    case "forms": return Boolean(access.canBuildForms);
    // Webb och inlägg (2026-11-20): the company's admin, as /api/meta and /api/website; the server keeps the data, so not in a .hwf company or the demo.
    case "web_posts": return (access.memberRole === "OWNER" || access.memberRole === "ADMIN") && cloud;
    // Agenter (2026-11-21): every member in a company whose data is on Workflow's server (missions run there); the demo shows its templates.
    case "agents": return Boolean(access.ai) && !access.localStorageMode;
    // Nyheter (2026-11-21): every active member reads them; the server keeps them, so not in a .hwf company. The demo has invented posts.
    case "news": return cloud || Boolean(access.demo && !access.localStorageMode);
    // Dokument (0.87.0): the customer register's right, on Workflow's server (the files are there); the demo has invented ones.
    case "documents": return (cloud || Boolean(access.demo && !access.localStorageMode)) && can("customers", "read");
    // The company's admin, as /api/administration and /api/operator-accounts; operator accounts need Cloud (the demo has invented ones).
    case "administration": return access.memberRole === "OWNER" || access.memberRole === "ADMIN";
    case "operator_accounts": return (access.memberRole === "OWNER" || access.memberRole === "ADMIN") && !access.localStorageMode;
  }
}

/** One line of the menu. */
export type MenuEntry =
  /** A button to its list. */
  | { type: "link"; key: Exclude<MenuHideable, SupportView> }
  /** Verktyg: one button to its hub page, with a fold arrow that shows its pages (open while one of them is open). */
  | { type: "group"; key: "tools"; children: SupportView[] }
  /** A page under Verktyg the person chose to show directly in the menu. */
  | { type: "shortcut"; key: SupportView }
  /** Fler: what a yrkesprofil tucks away, folded in the menu and a section of Mer. Reachable, never forbidden. */
  | { type: "more"; key: "more"; children: MenuHideable[] };

/**
 * The menu as groups separated by dividers (an empty group draws no divider). Översikt comes first and Inställningar last
 * in the shell; between them: Planering | Arbetsordrar, Driftronder, Avvikelser, Underhåll, Tid | Kunder, Projekt, Offerter,
 * Inköp | Verktyg (and its shortcuts) | Workflow AI | Användare, Operatörskonton – the last two groups for Mer on the phone
 * (`sidebarMenu` is the computer's). No button has rows under it. `open` is the open page's button, which is
 * always shown even when hidden. `first` is a yrkesprofil's buttons (lib/workflow/work-profile.ts): they are lifted to a group of
 * their own at the top, in that order, and only those the person is offered. `tucked` is what the same profile tucks away: the
 * rows the person may use and has not brought back stand under Fler, after Verktyg. Display only.
 */
export function resolveMenu(access: MenuAccess | null | undefined, choices: MenuChoices, open: string | null = null, first: readonly MenuHideable[] = [], tucked: readonly MenuHideable[] = []): MenuEntry[][] {
  const hidden = normalizeMenuHidden(choices.hidden);
  const chosenShortcuts = normalizeMenuShortcuts(choices.shortcuts);
  const shown = (key: MenuHideable) => menuItemAllowed(key, access) && (key === open || !hidden.includes(key));
  const lifted = first.filter((key) => key !== "ai" && shown(key));
  const item = (key: Exclude<MenuHideable, SupportView>): MenuEntry[] => shown(key) && !lifted.includes(key) ? [{ type: "link", key }] : [];
  const support = SUPPORT_VIEWS.filter((key) => shown(key) && !lifted.includes(key));
  const shortcuts = support.filter((key) => chosenShortcuts.includes(key));
  const children = support.filter((key) => !shortcuts.includes(key));
  const more = tucked.filter((key) => menuItemAllowed(key, access) && !shown(key));
  const groups: MenuEntry[][] = [
    lifted.map((key): MenuEntry => isShortcuttable(key) ? { type: "shortcut", key } : { type: "link", key: key as Exclude<MenuHideable, SupportView> }),
    item("planning"),
    [...item("work_orders"), ...item("rounds"), ...item("deviations"), ...item("maintenance"), ...item("time")],
    [...item("customers"), ...item("projects")],
    [...item("quotes"), ...item("customer_invoices"), ...item("purchases")],
    item("boards"),
    [...(children.length ? [{ type: "group", key: "tools", children } as MenuEntry] : []), ...shortcuts.map((key) => ({ type: "shortcut", key }) as MenuEntry)],
    more.length ? [{ type: "more", key: "more", children: more }] : [],
    item("ai"),
    [...item("administration"), ...item("operator_accounts")],
  ];
  return groups.filter((group) => group.length > 0);
}

/**
 * What the computer's and the tablet's menu leaves out (2026-11-02): Workflow AI is an icon in the floating navigation,
 * Användare a tab of Inställningar and Operatörskonton a button on Användare. Filtered after `resolveMenu`, so the rule "the
 * open page's button is always shown" never brings a row back, and Mer on the phone keeps its rows.
 */
export const NOT_IN_SIDEBAR: readonly MenuHideable[] = ["ai", "administration", "operator_accounts"];
export function sidebarMenu(groups: readonly MenuEntry[][]): MenuEntry[][] {
  return groups.map((group) => group.filter((entry) => !NOT_IN_SIDEBAR.includes(entry.key as MenuHideable))).filter((group) => group.length > 0);
}
/**
 * Planering stands together with Översikt, without a divider (2026-11-02). With a yrkesprofil's lifted buttons first
 * the group after Översikt is another one, and the dividers stay.
 */
/**
 * The small label over a group in the computer's menu instead of a divider (2026-11-13: "label text för menygruppen i
 * stället för linje"). The group's own title from MENU_ITEM_GROUPS when all its buttons share one; a yrkesprofil's lifted
 * buttons from several groups are "Genvägar"; Verktyg's group (shown as Mer) and Fler have none.
 */
export function menuGroupLabel(group: readonly MenuEntry[]): string | null {
  if (group.some((entry) => entry.type === "group" || entry.type === "more")) return null;
  const titles = new Set(group.map((entry) => MENU_ITEM_GROUPS.find((g) => (g.items as readonly MenuItem[]).some((item) => item.key === entry.key))?.title ?? ""));
  if (titles.size !== 1) return "Genvägar";
  const [title] = [...titles];
  return title || null;
}
/** The sidebar's name for Verktyg's button (2026-11-13: "verktyg kan det stå ...Mer"); the hub page keeps its title. */
export const SIDEBAR_TOOLS_LABEL = TOOLS_LABEL;
export const joinsOverview = (groups: readonly MenuEntry[][], index: number) =>
  index === 0 && groups[0]?.length === 1 && groups[0][0]!.key === "planning";
/**
 * The icon in the floating navigation (2026-11-02): whoever had the menu's row Workflow AI, by the same rule and the same
 * choice in Anpassa menyn. Local has no Workflow AI at all (`menuItemAllowed`), on the phone either.
 */
export function assistantIconAllowed(access: MenuAccess | null | undefined, choices: MenuChoices): boolean {
  return menuItemAllowed("ai", access) && !normalizeMenuHidden(choices.hidden).includes("ai");
}
/** What Anpassa menyn offers on a device: the computer's menu has neither Användare nor Operatörskonton. */
export function menuChoiceOffered(key: MenuHideable, device: "phone" | "desktop", access: MenuAccess | null | undefined): boolean {
  if (!menuItemAllowed(key, access)) return false;
  if (device === "phone" || key === "ai") return true;
  return !NOT_IN_SIDEBAR.includes(key);
}

/** The menu key of a page, for "the open page is always shown" and the marked button (a task editor belongs to Arbetsordrar, and so on). */
export function menuKeyOfView(view: string, /** Fakturor is a button for the person: Fakturaunderlag marks it (kundresa 2026-11-07, M39). */ invoicesButton = false): MenuHideable | null {
  switch (view) {
    case "invoice_bases": return invoicesButton ? "customer_invoices" : "quotes";
    case "quote": case "quotes": return "quotes";
    case "purchase": case "purchases": case "articles": return "purchases";
    // Planering's views (2026-11-01) mark Planering; Projektstatistik is a page of Projekt.
    case "planning": case "project_planning": case "capacity": return "planning";
    case "project": case "projects": case "new_project": case "project_summary": return "projects";
    // Uppgifter is a tab of Arbetsordrar (2026-11-01): every job's page marks Arbetsordrar.
    case "tasks": case "new_task": case "controls": case "new": case "workflow_task": case "work_orders": return "work_orders";
    case "place": return "customers";
    case "place_labels": return "rounds";
    // The two tabs of Webb och inlägg mark its button.
    case "company_posts": case "company_website": case "company_videos": return "web_posts";
    default: return (MENU_HIDEABLE as readonly string[]).includes(view) ? view as MenuHideable : null;
  }
}
