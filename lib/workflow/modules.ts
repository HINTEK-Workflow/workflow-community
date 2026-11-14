import type { WorkArea } from "./work-profile";

/**
 * Företagets moduler (0.39.0). Three layers stay apart: a module is the company's choice and the server refuses new actions in one
 * that is off, also for admin, API, MCP and AI; a permission is the person's; a yrkesprofil only decides what is shown first. What
 * counts for a person: the module is on, and the person has the right. A permission never turns a module on, a module never gives a
 * right, and prices follow their own right (canSeePrices) whichever modules are on.
 *
 * Stored as what is OFF (`Organization.disabledModules`): empty is everything on, so a company that never chose anything is
 * unaffected. Nothing is deleted when a module goes off: those with the right read and export the history through a direct link and
 * the archive, and turning it on again loses nothing. This is a choice of how the company works, not a price model: modules are not
 * sold separately. Pure, so the server, the shell, the demo and the tests read the same.
 */
export const MODULE_KEYS = ["customers", "projects", "planning", "rounds", "upkeep", "time", "quotes", "invoicing", "purchasing", "staff_register", "self_inspection"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];
export const isModuleKey = (value: unknown): value is ModuleKey => (MODULE_KEYS as readonly unknown[]).includes(value);

/** The parts of Workflow that are always on: without them there is no flow of work, and an incident can always be reported. */
export const ALWAYS_ON_PARTS = ["Översikt", "Arbetsordrar med Uppgifter", "Avvikelser", "Användare", "Inställningar"] as const;

export type ModuleDefinition = {
  key: ModuleKey;
  title: string;
  /** One line under the switch. */
  short: string;
  /** Where the history is read while the module is off; null when the module has no list of its own. */
  historyHref: string | null;
};

export const MODULE_DEFINITIONS: readonly ModuleDefinition[] = [
  { key: "customers", title: "Kunder", short: "Kundregistret. Av: företagets egna platser finns kvar och jobben fungerar utan kund.", historyHref: "/?view=customers" },
  { key: "projects", title: "Projekt", short: "Projekt som samlar jobb, tid och beslut. Jobb och tid fungerar utan projekt.", historyHref: "/?view=projects" },
  { key: "planning", title: "Planering", short: "Kalender, Tidplan och Kapacitet.", historyHref: "/?view=planning" },
  { key: "rounds", title: "Driftronder", short: "Återkommande ronder och deras påminnelser.", historyHref: "/?view=rounds" },
  { key: "upkeep", title: "Underhåll", short: "Maskiner, underhållsplaner, förråd och maskinlarm.", historyHref: "/?view=maintenance" },
  { key: "time", title: "Tid och lön", short: "Tidrapport, månadens godkännande, frånvaro och löneunderlag.", historyHref: "/?view=time" },
  { key: "quotes", title: "Offerter", short: "Offerter till kunder och kundens svar.", historyHref: "/?view=quotes" },
  { key: "invoicing", title: "Fakturaunderlag", short: "Underlag av tid och material från färdiga jobb.", historyHref: "/?view=invoice_bases" },
  { key: "purchasing", title: "Inköp och artiklar", short: "Inköp, artikelregister och prisfiler. Av: materialrader skrivs som fritext.", historyHref: "/?view=purchases" },
  { key: "staff_register", title: "Personalliggare", short: "In- och utcheckning på byggarbetsplats. Kontrollvyn och exporten går alltid att nå.", historyHref: "/?view=projects" },
  { key: "self_inspection", title: "Egenkontroll", short: "Egenkontrollprogram, roller med nivå och kompetenskort. Avvikelser och Instrument finns alltid.", historyHref: "/?view=self_inspection" },
];
const DEFINITION = Object.fromEntries(MODULE_DEFINITIONS.map((item) => [item.key, item])) as Record<ModuleKey, ModuleDefinition>;
export const moduleTitle = (key: ModuleKey) => DEFINITION[key].title;
export const moduleDefinition = (key: ModuleKey) => DEFINITION[key];

/**
 * Hard dependencies: a module that cannot work without another. Turning the other off turns this one off too (the dialog says so),
 * and turning this one on turns the other on. A register row lives on a project; a quote and an invoice basis are written to a customer.
 */
export const MODULE_REQUIRES: Partial<Record<ModuleKey, readonly ModuleKey[]>> = {
  staff_register: ["projects"],
  quotes: ["customers"],
  invoicing: ["customers"],
};

/**
 * Soft dependencies: both work apart, and this is what changes (shown in the dialog before a module goes off). Tested so that a new
 * module cannot be left without an answer.
 */
export const MODULE_EFFECTS: Record<ModuleKey, readonly string[]> = {
  customers: ["Jobb kan sparas utan kund, eller på Eget företag.", "Kunder som redan står på jobb finns kvar där."],
  projects: ["Arbetsordrar, kontroller och tid fungerar utan projekt.", "Tidplanen i Planering försvinner. Kalender och Kapacitet finns kvar."],
  planning: ["Jobbens datum finns kvar. Bokningar och Tidplan går inte att ändra."],
  rounds: ["Påminnelser om ronder slutar. Arbetsordrar som redan har en rond finns kvar."],
  upkeep: ["Nya maskinlarm tas inte emot. Enheten får ett tydligt svar och behåller larmen i sin kö.", "Underhållsplaner skapar inga nya arbetsordrar. Vilande arbetsordrar väntar tills modulen slås på."],
  time: ["Jobb kan utföras och färdigställas utan tid.", "Pågående tid kan alltid stoppas. Tid som redan finns kan faktureras."],
  quotes: ["Priser på materialrader följer fortfarande personens rätt.", "Kunder kan inte längre svara på skickade offerter."],
  invoicing: ["Tid och material finns kvar på jobben. Inget räknas som ofakturerat."],
  purchasing: ["Materialrader skrivs som fritext. Rader med vald artikel finns kvar.", "Förrådet kan inte beställa."],
  staff_register: ["Ingen kan checka in. Den som är incheckad kan checka ut, och rader kan rättas.", "Kontrollvyn och exporten går alltid att nå."],
  self_inspection: ["Avvikelser och Instrument finns kvar.", "Roller med nivå slutar gälla: ingen stoppas av krävd nivå."],
};

// ---------- what is on ----------

/** A stored list, or anything else, as known keys in a fixed order, with whatever a module that is off takes with it. */
export function normalizeDisabledModules(value: unknown): ModuleKey[] {
  const off = new Set<ModuleKey>(Array.isArray(value) ? value.filter(isModuleKey) : []);
  for (let changed = true; changed;) {
    changed = false;
    for (const key of MODULE_KEYS) {
      if (!off.has(key) && (MODULE_REQUIRES[key] ?? []).some((needed) => off.has(needed))) { off.add(key); changed = true; }
    }
  }
  return MODULE_KEYS.filter((key) => off.has(key));
}

/** Whether a module is on, from the stored list of what is off. Anything missing is on (a company that never chose, the demo). */
export const moduleOn = (disabled: readonly string[] | null | undefined, key: ModuleKey) => !(disabled ?? []).includes(key);
/** The same from whatever holds the company's row (a request's context). */
export const organizationModuleOn = (organization: { disabledModules?: readonly string[] | null } | null | undefined, key: ModuleKey) => moduleOn(organization?.disabledModules, key);
/** The modules that are on, as the shell and the menu are given them. */
export const enabledModules = (disabled: readonly string[] | null | undefined): ModuleKey[] => MODULE_KEYS.filter((key) => moduleOn(disabled, key));
/** The reverse of `enabledModules`, for what the client is given. Left out (undefined) is everything on. */
export const moduleInList = (modules: readonly string[] | null | undefined, key: ModuleKey) => !modules || modules.includes(key);

/** Prisma's filter for a background job: only companies with this module on. */
export const moduleOnWhere = (key: ModuleKey) => ({ NOT: { disabledModules: { has: key } } });

export const moduleOffText = (key: ModuleKey) => key === "staff_register"
  ? "Personalliggaren är avstängd för företaget. Kontrollvyn och exporten går alltid att nå. Slå på den under Inställningar → Arbetssätt."
  : `${moduleTitle(key)} är avstängt för företaget. Det som finns går att läsa. Slå på det under Inställningar → Arbetssätt.`;

/** One line on a page of a module that is off (a direct link, the archive). */
export const moduleOffNotice = (key: ModuleKey) => `${moduleTitle(key)} är avstängt för företaget. Du kan läsa det som finns, men inget nytt kan göras här.`;

// ---------- a change ----------

export type ModuleChanges = Partial<Record<ModuleKey, boolean>>;
export type ModuleChangeResult = {
  disabled: ModuleKey[];
  /** What goes off and on in the end, compared with now. */
  turnedOff: ModuleKey[];
  turnedOn: ModuleKey[];
};

/**
 * The company's list after a change. What goes off first, then what goes on, which takes what it needs with it: when one choice asks
 * for both, on wins, because the admin has asked for that module to work. Dependencies always hold afterwards.
 */
export function applyModuleChanges(current: unknown, changes: ModuleChanges): ModuleChangeResult {
  const before = normalizeDisabledModules(current);
  const off = new Set<ModuleKey>(before);
  for (const key of MODULE_KEYS) if (changes[key] === false) off.add(key);
  const turnOn = (key: ModuleKey) => { off.delete(key); for (const needed of MODULE_REQUIRES[key] ?? []) turnOn(needed); };
  for (const key of MODULE_KEYS) if (changes[key] === true) turnOn(key);
  const disabled = normalizeDisabledModules([...off]);
  return { disabled, turnedOff: disabled.filter((key) => !before.includes(key)), turnedOn: before.filter((key) => !disabled.includes(key)) };
}

/** The audit line for a change (what the administration history shows). */
export function moduleChangeDetail(change: Pick<ModuleChangeResult, "turnedOff" | "turnedOn">) {
  const names = (keys: readonly ModuleKey[]) => keys.map(moduleTitle).join(", ");
  return [change.turnedOff.length ? `Moduler av: ${names(change.turnedOff)}.` : "", change.turnedOn.length ? `Moduler på: ${names(change.turnedOn)}.` : ""].filter(Boolean).join(" ");
}

// ---------- where a module is ----------

/** The menu button of a module; Fakturaunderlag shares Offerter's button, which stays while either of them is on. */
export const MODULE_OF_MENU_ITEM: Readonly<Record<string, ModuleKey>> = {
  customers: "customers", projects: "projects", planning: "planning", rounds: "rounds", maintenance: "upkeep", time: "time",
  purchases: "purchasing", self_inspection: "self_inspection", customer_invoices: "invoicing",
  // The operator page stands on Underhåll's machine tree (lib/operator/machines.ts).
  operator_accounts: "upkeep",
};

/** The pages of a module, for the line on a page opened through a direct link. Kunder's page is also the company's own places, which the caller tells apart. */
const MODULE_OF_VIEW: Readonly<Record<string, ModuleKey>> = {
  customers: "customers",
  projects: "projects", project: "projects", new_project: "projects", project_summary: "projects",
  planning: "planning", capacity: "planning", project_planning: "planning",
  rounds: "rounds", place_labels: "rounds",
  maintenance: "upkeep",
  time: "time",
  quotes: "quotes", quote: "quotes",
  invoice_bases: "invoicing",
  customer_invoices: "invoicing",
  purchases: "purchasing", purchase: "purchasing", articles: "purchasing",
  self_inspection: "self_inspection",
};
export const moduleOfView = (view: string): ModuleKey | null => MODULE_OF_VIEW[view] ?? null;
/** A page's module, also where the page is a section of a bigger page: Maskiner under Kopplingar is Underhåll's. */
export const moduleOfPage = (view: string, section?: string | null): ModuleKey | null => view === "advanced" && section === "machines" ? "upkeep" : moduleOfView(view);

/** The search's kinds of record that belong to one module. Places stay: the company's own places are always there. */
export const MODULE_OF_SEARCH_TYPE: Readonly<Record<string, ModuleKey>> = {
  project: "projects", quote: "quotes", invoice_basis: "invoicing", customer: "customers", round: "rounds", machine: "upkeep",
};
/** The search's pages (lib/search/commands.ts) that belong to one module. */
export const MODULE_OF_COMMAND: Readonly<Record<string, ModuleKey>> = {
  new_project: "projects", projects: "projects", new_purchase: "purchasing", purchases: "purchasing", articles: "purchasing",
  maintenance: "upkeep", connections_machines: "upkeep", operator_accounts: "upkeep", new_quote: "quotes", quotes: "quotes", invoice_bases: "invoicing",
  project_planning: "planning", planning: "planning", capacity: "planning", new_round: "rounds", rounds: "rounds",
  time: "time", time_team: "time", connections_payroll: "time", customers: "customers",
  self_inspection: "self_inspection", self_inspection_levels: "self_inspection",
};

// ---------- the API routes of a module ----------

/**
 * The routes of each module, as paths under app/api. `write`: every change there goes through requireModule (or, for machine intake
 * and a customer's answer, the same rule by another way in), which the guard test tests/modules-guard.test.ts reads from the code.
 * `read`: only reads, or changes nothing of the module, so they stay open: the history is read and exported through them.
 */
export const MODULE_ROUTES: Record<ModuleKey, { write: readonly string[]; read: readonly string[] }> = {
  customers: { write: ["customer-card", "records", "workspace"], read: ["places", "places/qr", "places/address-lookup"] },
  projects: { write: ["projects", "project-schedule"], read: ["project-portfolio", "project-statistics", "projects/[id]/report"] },
  planning: { write: ["planned-activities", "project-schedule"], read: ["planning-capacity"] },
  rounds: { write: ["form-schedules"], read: [] },
  upkeep: { write: ["maintenance", "maintenance/images", "machine-sources", "ingest/v1/events", "ingest/v1/raw"], read: ["maintenance/images/[id]"] },
  time: { write: ["workflow-time", "time-periods", "payroll", "absence"], read: [] },
  quotes: { write: ["quotes", "quotes/export", "customer-quote", "ai/quote"], read: ["quotes/[id]/pdf", "customer-quote/pdf"] },
  invoicing: { write: ["invoice-bases", "invoice-bases/export"], read: [] },
  purchasing: { write: ["purchases", "catalogue", "catalogue-lists"], read: [] },
  staff_register: { write: ["staff-register"], read: ["staff-register/export"] },
  self_inspection: { write: ["self-inspection", "self-inspection/credential-files", "self-inspection/credential-files/[id]"], read: ["self-inspection/levels", "self-inspection/report", "self-inspection/work"] },
};

/** Routes under a module's address that belong to an always-on part: Avvikelser live under self-inspection. */
export const ALWAYS_ON_ROUTES: readonly string[] = ["self-inspection/deviation-export", "self-inspection/deviation-photos", "self-inspection/deviation-photos/[id]"];

/**
 * What stays open in /api/self-inspection while Egenkontroll is off: the deviation log and the instruments are always-on parts that
 * have their actions on the same route. Everything else on it is the programme, its roles and its competence.
 */
export const ALWAYS_ON_SELF_INSPECTION_ACTIONS: readonly string[] = [
  "save_deviation", "withdraw_deviation", "save_investigation", "mark_deviation_done", "reopen_deviation", "mark_reported_to_authority", "set_deviation_hold",
  "save_instrument", "remove_instrument",
];
export const selfInspectionActionNeedsModule = (action: string) => !ALWAYS_ON_SELF_INSPECTION_ACTIONS.includes(action);

// ---------- machine intake ----------

export const MACHINE_INTAKE_OFF_CODE = "module_off";
/** The answer to a machine source while Underhåll is off: nothing was saved, and the sender keeps what it has. */
export const MACHINE_INTAKE_OFF_TEXT = "Underhåll är avstängt för företaget, så händelserna togs inte emot. Behåll dem och skicka igen när modulen är på.";

// ---------- packages per line of business ----------

/**
 * What each line of business usually uses. A proposal the admin sees and confirms in the guide: what the company works with is the
 * sum of the choices, the answer itself is stored as before (WorkspaceSettings.profile.workAreas), and only a confirmed package
 * changes any module. An industrial company works with its own machines and sites, so Kunder is off in its package.
 */
export const MODULE_PACKAGES: Record<WorkArea, readonly ModuleKey[]> = {
  electric: ["customers", "projects", "planning", "time", "quotes", "invoicing", "purchasing", "staff_register", "self_inspection"],
  // Elkraft och elnät (2026-11-02): the grid owner or the contractor is the customer, the work is projects and rounds in stations
  // and along lines; no quotes by default, and the material is mostly the owner's.
  power: ["customers", "projects", "planning", "rounds", "time", "staff_register", "self_inspection"],
  // Automation (2026-11-02): machines and control systems under Underhåll, delivered as projects to customers or kept in the own plant.
  automation: ["customers", "projects", "planning", "upkeep", "time", "purchasing", "self_inspection"],
  industry: ["planning", "rounds", "upkeep", "time", "purchasing"],
  property: ["customers", "planning", "rounds", "time", "self_inspection"],
  projects: ["customers", "projects", "planning", "time", "staff_register"],
  office: ["customers", "time", "quotes", "invoicing"],
};

/** The package for what the company works with, as the changes to make; null when nothing is chosen, which changes nothing. */
export function modulePackageChanges(areas: readonly WorkArea[]): ModuleChanges | null {
  if (!areas.length) return null;
  const on = new Set<ModuleKey>(areas.flatMap((area) => MODULE_PACKAGES[area]));
  return Object.fromEntries(MODULE_KEYS.map((key) => [key, on.has(key)])) as ModuleChanges;
}
