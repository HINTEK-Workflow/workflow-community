import type { OverviewTab } from "@/lib/overview/tabs";
import { menuItemAllowed, type MenuAccess, type MenuHideable } from "./menu-items";
import type { NewChoice } from "./new-choices";
import { defaultNativeLayout, normalizeNativeLayout, type HomeTileKey, type NativeLayout, type TabKey } from "./native-layout";
import { workflowPermissionPresets, type WorkflowPermissionGrant, type WorkflowPermissionProfile } from "./permissions";
import { workViewStamp, type WorkView, type WorkViewSetting } from "./work-view";

/**
 * Yrkesprofil (2026-11-01, replaces the list "Typ av användare"): what is shown first for a person, by what the person
 * works with. Three layers are kept apart: company modules decide what exists in the company, permissions decide what the
 * person may do, and the profile decides only what stands first. A profile never grants anything; no permission check reads
 * it, and Företagsadmin stays a role, not a profile. It fills in the work view, the menu's order and what is tucked away under
 * Fler, Hem and the tab bar, the order of Ny on the phone, the overview's start tab and the guide's first steps, and suggests
 * rights the admin sees and can change. What the person may not use is simply not drawn (menuItemAllowed, nativeLayoutAllowed,
 * overviewStartTab), and everyone can change what they see.
 *
 * One row per kind of work (2026-11-04, replaces "one title per row" of 2026-11-02, whose 49 rows shared about ten sets of
 * defaults): two rows must differ in their defaults, tests/work-profile.test.ts holds that. The titles that were merged stay
 * findable as `alternativeNames`, searched in the picker (findWorkProfileTitles). The table with old and new rows is in
 * docs/beslut/produkt-och-prioritet.md. The stored key never changes meaning: `lead_electrician` is still the key of "Ledande
 * montör", `caretaker` of "Vaktmästare" and `work_lead` of "Arbetsledare". The electrical safety roles (eldriftledare,
 * elsäkerhetsledare, kopplingsledare …) are functions in the work, not occupations, and are not profiles.
 *
 * Storage: the admin's choice beside the work view in the member's JSON record (key `workProfile`), which an invitation
 * carries over as it is; the permission schema drops the key. The person's own choice is in UserPreferences
 * (`ownWorkProfile`), display only. Pure, so the server's first frame, the shell, the guide and the tests read the same.
 */
export const WORK_PROFILES = [
  // El och service
  "electrician", "service_electrician", "lead_electrician",
  // Elkraft och elnät
  "grid_fitter", "power_technician",
  // Automation
  "automation_technician",
  // Industri och underhåll
  "maintenance_technician", "maintenance_electrician", "operator",
  // Fastighet och drift
  "caretaker", "property_operations_technician",
  // Projekt och arbetsledning
  "project_manager", "work_lead", "maintenance_lead", "designer",
  // Kontor och administration
  "estimator", "administrator", "purchaser", "it",
] as const;
export type WorkProfile = (typeof WORK_PROFILES)[number];
export const isWorkProfile = (value: unknown): value is WorkProfile => WORK_PROFILES.includes(value as WorkProfile);

/**
 * A key that left the table and the row that took its place, so a choice stored earlier still gives the person a profile.
 * Reading it is enough: nothing is rewritten, and the stamps stay, so the person's saved menu and Hem still count.
 */
export const RETIRED_WORK_PROFILE: Readonly<Record<string, WorkProfile>> = {
  office: "administrator", finance_assistant: "administrator", white_collar: "administrator",
  installation_electrician: "electrician", solar_fitter: "electrician", fitter: "electrician", blue_collar: "electrician", technician: "electrician",
  hvac_fitter: "service_electrician", refrigeration_technician: "service_electrician",
  distribution_electrician: "grid_fitter", line_fitter: "grid_fitter", cable_fitter: "grid_fitter", station_technician: "grid_fitter",
  grid_operations_technician: "property_operations_technician",
  power_engineer: "project_manager", site_manager: "project_manager",
  operations_engineer: "work_lead",
  grid_planner: "designer", electrical_designer: "designer", engineer: "designer",
  automation_electrician: "automation_technician", control_technician: "automation_technician", instrument_technician: "automation_technician",
  automation_engineer: "maintenance_lead",
  maintenance_mechanic: "maintenance_technician", repairer: "maintenance_technician",
  industrial_electrician: "maintenance_electrician", operations_electrician: "maintenance_electrician",
  property_technician: "caretaker", property_caretaker: "caretaker",
};
export const currentWorkProfile = (value: unknown): unknown => (typeof value === "string" && Object.hasOwn(RETIRED_WORK_PROFILE, value) ? RETIRED_WORK_PROFILE[value] : value);

/** What a company can work with. Several can be chosen, and a company can mix every profile; nothing is locked by them. */
export const WORK_AREAS = ["electric", "power", "automation", "industry", "property", "projects", "office"] as const;
export type WorkArea = (typeof WORK_AREAS)[number];
export const WORK_AREA_LABEL: Record<WorkArea, string> = {
  electric: "El och service",
  power: "Elkraft och elnät",
  automation: "Automation",
  industry: "Industri och underhåll",
  property: "Fastighet och drift",
  projects: "Projekt och arbetsledning",
  office: "Kontor och administration",
};

/** One first thing to do: a link in the guide's last step and in the empty lists, drawn only when the person may use its button. */
export type WorkProfileStep = { menu: MenuHideable; href: string; title: string; text: string };
/** The choices of Ny in the order the profile wants them first; the rest follow, and only what the person may create is drawn. */
export type NewChoiceKey = NewChoice["key"];

export type WorkProfileDefinition = {
  label: string;
  area: WorkArea;
  description: string;
  /** Other titles for the same work: a person searching for one of them finds this row. */
  alternativeNames: readonly string[];
  workView: WorkView;
  /** The rights suggested when the admin chooses the profile, and how they are named to the admin. */
  grants: readonly WorkflowPermissionGrant[];
  rights: readonly string[];
  /** The menu buttons that stand first, in this order. */
  menuFirst: readonly MenuHideable[];
  /** Buttons tucked away under Fler from the start; one click away, and Anpassa menyn brings them back. */
  menuHidden: readonly MenuHideable[];
  home: readonly HomeTileKey[];
  tabs: readonly TabKey[];
  startTab: OverviewTab;
  newFirst: readonly NewChoiceKey[];
  firstSteps: readonly WorkProfileStep[];
};

// ---------- The rights a profile may suggest: the admin's presets and two small additions, never more ----------
export const FIELD_GRANTS: readonly WorkflowPermissionGrant[] = workflowPermissionPresets.find((preset) => preset.id === "field")!.profile.grants;
export const READ_GRANTS: readonly WorkflowPermissionGrant[] = workflowPermissionPresets.find((preset) => preset.id === "report")!.profile.grants;
export const MAINTENANCE_GRANTS: readonly WorkflowPermissionGrant[] = ["maintenance:read", "maintenance:edit"];
export const OFFICE_GRANTS: readonly WorkflowPermissionGrant[] = ["customers:read", "customers:create", "customers:edit", "quotes:read", "quotes:edit", "economy:read", "catalogue:read", "projects:read", "projects:report", "work-order:read", "work-order:report"];
const PROJECT_LEAD_GRANTS: readonly WorkflowPermissionGrant[] = [...FIELD_GRANTS, "projects:archive", "team:read"];
const MAINTENANCE_LEAD_GRANTS: readonly WorkflowPermissionGrant[] = [...FIELD_GRANTS, "team:read", ...MAINTENANCE_GRANTS];
const FIELD_MAINTENANCE_GRANTS: readonly WorkflowPermissionGrant[] = [...FIELD_GRANTS, ...MAINTENANCE_GRANTS];

const FIELD = ["Utföra arbete"] as const;
const FIELD_MAINTENANCE = ["Utföra arbete", "Underhåll"] as const;
const OFFICE = ["Kunder", "Offerter", "Ekonomi", "Läsa projekt och arbetsordrar"] as const;

// ---------- The first things to do, in plain Swedish; titles are short, they stand side by side on a wide screen ----------
const STEP_JOBS: WorkProfileStep = { menu: "work_orders", href: "/?view=work_orders", title: "Öppna dina jobb", text: "Det du är bokad på står här. Starta tiden på jobbet." };
const STEP_TIME: WorkProfileStep = { menu: "time", href: "/?view=time", title: "Se din tid", text: "Veckans timmar, och det du behöver rätta." };
const STEP_DEVIATION: WorkProfileStep = { menu: "deviations", href: "/?view=deviations&new=1", title: "Rapportera avvikelse", text: "Är något fel på plats? Skriv det här." };
const STEP_ROUNDS: WorkProfileStep = { menu: "rounds", href: "/?view=rounds", title: "Gå en driftrond", text: "Ronderna som väntar står här." };
const STEP_MACHINES: WorkProfileStep = { menu: "maintenance", href: "/?view=maintenance", title: "Se maskinerna", text: "Maskinträdet, förrådet och det som är på tur." };
const STEP_CUSTOMERS: WorkProfileStep = { menu: "customers", href: "/?view=customers", title: "Hitta kunden", text: "Kundkortet visar platser och tidigare jobb." };
const STEP_SELF_INSPECTION: WorkProfileStep = { menu: "self_inspection", href: "/?view=self_inspection", title: "Öppna egenkontrollen", text: "Programmet, krävd nivå och brister." };
const STEP_PURCHASES: WorkProfileStep = { menu: "purchases", href: "/?view=purchases", title: "Beställ material", text: "Inköp och artiklar samlade." };
const STEP_PROJECTS: WorkProfileStep = { menu: "projects", href: "/?view=projects", title: "Öppna projekten", text: "Börja här. Nytt projekt står uppe till höger." };
const STEP_PLANNING: WorkProfileStep = { menu: "planning", href: "/?view=planning", title: "Öppna planeringen", text: "Kalender, tidplan och kapacitet." };
const STEP_QUOTES: WorkProfileStep = { menu: "quotes", href: "/?view=quotes", title: "Skriv en offert", text: "Offerterna och deras status samlade." };
const STEP_REPORTS: WorkProfileStep = { menu: "report_archive", href: "/?view=report_archive", title: "Läs rapporterna", text: "Färdiga rapporter att läsa och ladda ned." };
const STEP_INSTRUMENTS: WorkProfileStep = { menu: "instruments", href: "/?view=instruments", title: "Se instrumenten", text: "Företagets instrument och deras kalibrering." };

// ---------- Hem and the tab bar ----------
const HOME_JOBS: readonly HomeTileKey[] = ["jobs", "time", "new", "absence", "checkin", "continue", "notices"];
const HOME_LEAD_JOBS: readonly HomeTileKey[] = ["jobs", "time", "new", "absence", "checkin", "continue", "deviations", "notices"];
const HOME_ROUNDS: readonly HomeTileKey[] = ["jobs", "rounds", "new", "time", "absence", "continue", "notices"];
const HOME_ROUNDS_FIRST: readonly HomeTileKey[] = ["rounds", "jobs", "new", "time", "absence", "deviations", "continue", "notices"];
const HOME_MAINTENANCE: readonly HomeTileKey[] = ["maintenance", "jobs", "rounds", "new", "time", "absence", "continue", "notices"];
const HOME_TEAM: readonly HomeTileKey[] = ["team", "planning", "jobs", "new", "continue", "notices"];
const HOME_TEAM_MAINTENANCE: readonly HomeTileKey[] = ["team", "maintenance", "planning", "jobs", "new", "continue", "notices"];
// Nytt jobb is about jobs and needs work-order:create, which the office rows do not suggest, so it is not among their tiles.
const HOME_OFFICE: readonly HomeTileKey[] = ["planning", "next", "notices"];
const TABS_JOBS: readonly TabKey[] = ["home", "jobs", "new", "time"];
const TABS_ROUNDS: readonly TabKey[] = ["home", "jobs", "rounds", "new"];
const TABS_ROUNDS_TIME: readonly TabKey[] = ["home", "jobs", "rounds", "time"];
const TABS_ROUNDS_FIRST: readonly TabKey[] = ["home", "rounds", "jobs", "new"];
const TABS_MAINTENANCE: readonly TabKey[] = ["home", "maintenance", "jobs", "new"];
const TABS_OFFICE: readonly TabKey[] = ["home", "customers", "new", "notifications"];

const FIELD_ROW = { workView: "fitter", grants: FIELD_GRANTS, rights: FIELD, startTab: "me" } as const;
const FIELD_MAINTENANCE_ROW = { workView: "fitter", grants: FIELD_MAINTENANCE_GRANTS, rights: FIELD_MAINTENANCE, startTab: "me" } as const;
const OFFICE_ROW = { workView: "supervisor", grants: OFFICE_GRANTS, rights: OFFICE, home: HOME_OFFICE, tabs: TABS_OFFICE } as const;
const WORK_LEAD_ROW = { workView: "supervisor", grants: MAINTENANCE_LEAD_GRANTS, rights: ["Utföra arbete", "Teamet", "Underhåll"], startTab: "team" } as const;

export const WORK_PROFILE: Record<WorkProfile, WorkProfileDefinition> = {
  // ----- El och service: installation and service at the customer's -----
  electrician: { ...FIELD_ROW, label: "Elektriker", area: "electric", description: "Dagens jobb, tid och material först.",
    alternativeNames: ["Installationselektriker", "Montör", "Solcellsmontör", "Tekniker", "Kollektivanställd"],
    menuFirst: ["work_orders", "time", "purchases"], menuHidden: ["maintenance", "rounds", "quotes"], home: HOME_JOBS, tabs: TABS_JOBS,
    newFirst: ["work-order", "deviation", "absence", "purchase"], firstSteps: [STEP_JOBS, STEP_TIME, STEP_DEVIATION] },
  service_electrician: { ...FIELD_ROW, label: "Servicetekniker", area: "electric", description: "Dagens jobb, kunder och tid först.",
    alternativeNames: ["Serviceelektriker", "VVS-montör", "Kyltekniker"],
    menuFirst: ["work_orders", "customers", "time"], menuHidden: ["maintenance", "rounds"], home: HOME_JOBS, tabs: ["home", "jobs", "customers", "new"],
    newFirst: ["work-order", "customer", "deviation", "absence"], firstSteps: [STEP_JOBS, STEP_CUSTOMERS, STEP_TIME] },
  lead_electrician: { ...FIELD_ROW, workView: "lead", label: "Ledande montör", area: "electric", description: "Jobb, egenkontroll och tid först.",
    alternativeNames: ["Ledande elektriker"],
    menuFirst: ["work_orders", "self_inspection", "time"], menuHidden: ["maintenance", "rounds"], home: HOME_LEAD_JOBS, tabs: TABS_JOBS,
    newFirst: ["work-order", "task", "deviation", "absence"], firstSteps: [STEP_JOBS, STEP_SELF_INSPECTION, STEP_DEVIATION] },

  // ----- Elkraft och elnät: building and running the grid -----
  grid_fitter: { ...FIELD_ROW, label: "Montör, elnät", area: "power", description: "Jobb, ronder och tid först.",
    alternativeNames: ["Distributionselektriker", "Linjemontör", "Kabelmontör", "Stationstekniker"],
    menuFirst: ["work_orders", "rounds", "time"], menuHidden: ["maintenance", "quotes"], home: HOME_ROUNDS, tabs: TABS_ROUNDS_TIME,
    newFirst: ["work-order", "deviation", "round", "absence"], firstSteps: [STEP_JOBS, STEP_ROUNDS, STEP_TIME] },
  power_technician: { ...FIELD_ROW, workView: "lead", label: "Elkrafttekniker", area: "power", description: "Jobb, ronder och egenkontroll först.",
    alternativeNames: ["Elkraftstekniker"],
    menuFirst: ["work_orders", "rounds", "self_inspection"], menuHidden: ["maintenance", "quotes"], home: ["jobs", "rounds", "time", "new", "absence", "continue", "deviations", "notices"], tabs: TABS_ROUNDS_TIME,
    newFirst: ["work-order", "round", "deviation", "absence"], firstSteps: [STEP_JOBS, STEP_ROUNDS, STEP_SELF_INSPECTION] },

  // ----- Automation: control systems and instruments -----
  automation_technician: { ...FIELD_MAINTENANCE_ROW, label: "Automationstekniker", area: "automation", description: "Underhåll, jobb och instrument först.",
    alternativeNames: ["Automationselektriker", "Styr- och reglertekniker", "Instrumenttekniker"],
    menuFirst: ["maintenance", "work_orders", "instruments"], menuHidden: ["quotes", "rounds"], home: ["maintenance", "jobs", "new", "time", "absence", "continue", "notices"], tabs: TABS_MAINTENANCE,
    newFirst: ["work-order", "deviation", "purchase", "absence"], firstSteps: [STEP_MACHINES, STEP_JOBS, STEP_INSTRUMENTS] },

  // ----- Industri och underhåll: the company's own machines -----
  maintenance_technician: { ...FIELD_MAINTENANCE_ROW, label: "Underhållstekniker", area: "industry", description: "Underhåll, jobb och ronder först.",
    alternativeNames: ["Underhållsmekaniker", "Reparatör"],
    menuFirst: ["maintenance", "work_orders", "rounds"], menuHidden: ["quotes"], home: HOME_MAINTENANCE, tabs: TABS_MAINTENANCE,
    newFirst: ["work-order", "deviation", "round", "absence"], firstSteps: [STEP_MACHINES, STEP_JOBS, STEP_ROUNDS] },
  maintenance_electrician: { ...FIELD_MAINTENANCE_ROW, label: "Underhållselektriker", area: "industry", description: "Underhåll, jobb och egenkontroll först.",
    alternativeNames: ["Driftelektriker", "Industrielektriker"],
    menuFirst: ["maintenance", "work_orders", "self_inspection"], menuHidden: ["quotes", "rounds"], home: ["maintenance", "jobs", "deviations", "new", "time", "absence", "continue", "notices"], tabs: ["home", "maintenance", "jobs", "time"],
    newFirst: ["work-order", "deviation", "absence", "purchase"], firstSteps: [STEP_MACHINES, STEP_JOBS, STEP_SELF_INSPECTION] },
  operator: { ...FIELD_ROW, grants: [...FIELD_GRANTS, "maintenance:read"], rights: ["Utföra arbete", "Läsa underhåll"], label: "Operatör", area: "industry", description: "Avvikelser, underhåll och jobb först.",
    alternativeNames: ["Processoperatör", "Maskinoperatör"],
    menuFirst: ["deviations", "maintenance", "work_orders"], menuHidden: ["quotes", "projects", "customers"], home: ["maintenance", "jobs", "deviations", "new", "time", "absence", "continue", "notices"], tabs: TABS_MAINTENANCE,
    newFirst: ["deviation", "absence", "work-order"], firstSteps: [STEP_DEVIATION, STEP_MACHINES, STEP_JOBS] },

  // ----- Fastighet och drift -----
  caretaker: { ...FIELD_ROW, label: "Vaktmästare", area: "property", description: "Jobb, ronder och avvikelser först.",
    alternativeNames: ["Fastighetstekniker", "Fastighetsskötare"],
    menuFirst: ["work_orders", "rounds", "deviations"], menuHidden: ["quotes", "maintenance"], home: HOME_ROUNDS, tabs: TABS_ROUNDS,
    newFirst: ["deviation", "work-order", "absence", "round"], firstSteps: [STEP_JOBS, STEP_ROUNDS, STEP_DEVIATION] },
  property_operations_technician: { ...FIELD_ROW, label: "Drifttekniker", area: "property", description: "Ronder, jobb och avvikelser först.",
    alternativeNames: ["Drifttekniker, elnät", "Drifttekniker, fastighet"],
    menuFirst: ["rounds", "work_orders", "deviations"], menuHidden: ["quotes", "maintenance"], home: HOME_ROUNDS_FIRST, tabs: TABS_ROUNDS_FIRST,
    newFirst: ["round", "deviation", "work-order", "absence"], firstSteps: [STEP_ROUNDS, STEP_JOBS, STEP_DEVIATION] },

  // ----- Projekt och arbetsledning -----
  project_manager: { workView: "supervisor", grants: PROJECT_LEAD_GRANTS, rights: ["Utföra arbete", "Arkivera projekt", "Teamet"], label: "Projektledare", area: "projects", description: "Projekt, planering och teamet först.",
    alternativeNames: ["Platschef", "Elkraftsingenjör"],
    menuFirst: ["projects", "planning", "work_orders"], menuHidden: ["maintenance"], home: HOME_TEAM, tabs: ["home", "projects", "planning", "new"], startTab: "team",
    newFirst: ["project", "work-order", "customer", "task"], firstSteps: [STEP_PROJECTS, STEP_PLANNING, STEP_JOBS] },
  work_lead: { ...WORK_LEAD_ROW, label: "Arbetsledare", area: "projects", description: "Planering, teamet och underhåll först.",
    alternativeNames: ["Driftingenjör"],
    menuFirst: ["planning", "work_orders", "maintenance"], menuHidden: [], home: ["team", "planning", "jobs", "maintenance", "new", "continue", "notices"], tabs: ["home", "planning", "jobs", "team"],
    newFirst: ["work-order", "task", "round", "absence"], firstSteps: [STEP_PLANNING, STEP_JOBS, STEP_ROUNDS] },
  maintenance_lead: { ...WORK_LEAD_ROW, label: "Underhållsledare", area: "projects", description: "Underhåll, planering och teamet först.",
    alternativeNames: ["Automationsingenjör", "Underhållschef"],
    menuFirst: ["maintenance", "planning", "work_orders"], menuHidden: ["quotes"], home: HOME_TEAM_MAINTENANCE, tabs: ["home", "maintenance", "planning", "team"],
    newFirst: ["work-order", "round", "purchase", "absence"], firstSteps: [STEP_MACHINES, STEP_PLANNING, STEP_JOBS] },
  designer: { workView: "supervisor", grants: FIELD_GRANTS, rights: FIELD, label: "Projektör", area: "projects", description: "Projekt, kunder och planering först.",
    alternativeNames: ["Elkonstruktör", "Beredare", "Ingenjör"],
    menuFirst: ["projects", "customers", "planning"], menuHidden: ["maintenance", "rounds"], home: ["planning", "jobs", "new", "continue", "notices"], tabs: ["home", "projects", "customers", "planning"], startTab: "me",
    newFirst: ["project", "work-order", "customer", "task"], firstSteps: [STEP_PROJECTS, STEP_CUSTOMERS, STEP_PLANNING] },

  // ----- Kontor och administration -----
  estimator: { ...OFFICE_ROW, label: "Kalkylator", area: "office", description: "Offerter, kunder och projekt först.",
    alternativeNames: ["Kalkylingenjör"],
    menuFirst: ["quotes", "customers", "projects"], menuHidden: ["rounds", "maintenance", "instruments"], startTab: "customers",
    newFirst: ["quote", "customer", "project"], firstSteps: [STEP_QUOTES, STEP_CUSTOMERS, STEP_PROJECTS] },
  administrator: { ...OFFICE_ROW, label: "Administratör", area: "office", description: "Kunder, offerter och ekonomi först.",
    alternativeNames: ["Ekonomiassistent", "Tjänsteman", "Kontor"],
    menuFirst: ["customers", "quotes", "projects"], menuHidden: ["rounds", "maintenance", "instruments"], startTab: "economy",
    newFirst: ["customer", "quote", "purchase"], firstSteps: [STEP_CUSTOMERS, STEP_QUOTES, STEP_PROJECTS] },
  purchaser: { ...OFFICE_ROW, home: ["next", "notices"], label: "Inköpare", area: "office", description: "Inköp, artiklar och kunder först.",
    alternativeNames: [],
    menuFirst: ["purchases", "customers", "quotes"], menuHidden: ["rounds", "maintenance"], startTab: "economy",
    newFirst: ["purchase", "customer", "quote"], firstSteps: [STEP_PURCHASES, STEP_CUSTOMERS, STEP_QUOTES] },
  // IT reads mostly: the integrations (Kopplingar) live under Inställningar, so the menu starts with the archive and the registers.
  it: { workView: "supervisor", grants: READ_GRANTS, rights: ["Läsa och rapportera"], label: "IT", area: "office", description: "Läsning, rapportarkiv och register först.",
    alternativeNames: ["IT-tekniker"],
    menuFirst: ["report_archive", "customers", "projects"], menuHidden: ["quotes", "rounds", "maintenance", "instruments"], home: ["notices", "next", "continue"], tabs: ["home", "search", "notifications"], startTab: "me",
    newFirst: ["deviation", "absence"], firstSteps: [STEP_REPORTS, STEP_CUSTOMERS, STEP_PROJECTS] },
};

export type WorkProfileGroup = { area: WorkArea; label: string; profiles: WorkProfile[] };
/** The profiles under what they belong to; what the company works with comes first, and all of them are always offered. */
export function workProfileGroups(first: readonly WorkArea[] = []): WorkProfileGroup[] {
  const areas = [...WORK_AREAS].sort((left, right) => Number(first.includes(right)) - Number(first.includes(left)));
  return areas.map((area) => ({ area, label: WORK_AREA_LABEL[area], profiles: WORK_PROFILES.filter((profile) => WORK_PROFILE[profile].area === area) }));
}

/** A hit of the picker's search: the title the person looked for and the row it belongs to. */
export type WorkProfileTitleHit = { profile: WorkProfile; title: string };
/** The rows whose name or alternative name holds the search, those that start with it first; two letters are needed. */
export function findWorkProfileTitles(query: string, limit = 6): WorkProfileTitleHit[] {
  const needle = query.trim().toLocaleLowerCase("sv-SE");
  if (needle.length < 2) return [];
  const titles = WORK_PROFILES.flatMap((profile) => [WORK_PROFILE[profile].label, ...WORK_PROFILE[profile].alternativeNames].map((title) => ({ profile, title, lower: title.toLocaleLowerCase("sv-SE") })));
  const hits = titles.filter((item) => item.lower.includes(needle));
  return hits.sort((left, right) => Number(right.lower.startsWith(needle)) - Number(left.lower.startsWith(needle))).slice(0, limit).map(({ profile, title }) => ({ profile, title }));
}

/** The first things to do for the person: only what the person may use. Empty without a profile, or before the admin has given any rights. */
export function workProfileFirstSteps(profile: WorkProfile | null | undefined, access: MenuAccess | null | undefined): WorkProfileStep[] {
  return profile ? WORK_PROFILE[profile].firstSteps.filter((step) => menuItemAllowed(step.menu, access)) : [];
}

/** What the profile tucks away and the person has not brought back: the rows of Fler in the menu. */
export function workProfileTucked(profile: WorkProfile | null | undefined, hidden: readonly string[]): MenuHideable[] {
  return profile ? WORK_PROFILE[profile].menuHidden.filter((key) => hidden.includes(key)) : [];
}

/** What the company works with as stored (WorkspaceSettings.profile.workAreas); anything unknown is dropped. */
export function normalizeWorkAreas(value: unknown): WorkArea[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is WorkArea => WORK_AREAS.includes(item as WorkArea)))] : [];
}

/**
 * A save of the company's details writes the whole profile and knows nothing of what the company works with, so it carries the
 * stored answer over; without this every save of Företagsuppgifter would empty it. The answer is only ever changed by work_areas.
 * The same for the company's choice to turn the risk exception off (Arbetssätt, 2026-11-02), only changed by risk_exception.
 */
export function keepWorkAreas<T extends object>(details: T, stored: unknown): T & { workAreas?: WorkArea[]; riskExceptionOff?: true } {
  const workAreas = normalizeWorkAreas(stored && typeof stored === "object" ? (stored as { workAreas?: unknown }).workAreas : null);
  const off = Boolean(stored && typeof stored === "object" && (stored as { riskExceptionOff?: unknown }).riskExceptionOff === true);
  return { ...details, ...(workAreas.length ? { workAreas } : {}), ...(off ? { riskExceptionOff: true as const } : {}) };
}

export const suggestedRights = (profile: WorkProfile): WorkflowPermissionProfile => ({ version: 1, grants: [...new Set(WORK_PROFILE[profile].grants)] });
const sameGrants = (left: readonly string[], right: readonly string[]) => left.length === right.length && left.every((grant) => right.includes(grant));

/**
 * What choosing a profile does with the rights in the form. A new invitation gets the suggestion while the admin has not
 * set anything else; everything else is a question, so rights never change silently. An admin holds every right by role.
 */
export function profileRightsStep(input: { isNew: boolean; role: string; current: readonly string[]; previous: WorkProfile | null; next: WorkProfile | null }): "keep" | "fill" | "ask" {
  if (!input.next || input.role !== "MEMBER") return "keep";
  if (sameGrants(input.current, WORK_PROFILE[input.next].grants)) return "keep";
  const untouched = input.current.length === 0 || (input.previous !== null && sameGrants(input.current, WORK_PROFILE[input.previous].grants));
  return input.isNew && untouched ? "fill" : "ask";
}

// ---------- The admin's choice in the member's JSON record, with its stamp ----------
export type WorkProfileSetting = { profile: WorkProfile | null; setAt: string };

export function readWorkProfile(raw: unknown): WorkProfileSetting | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = (raw as { workProfile?: unknown }).workProfile;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { profile, setAt } = value as { profile?: unknown; setAt?: unknown };
  if (typeof setAt !== "string" || !setAt || setAt.length > 40) return null;
  const current = currentWorkProfile(profile);
  return { profile: isWorkProfile(current) ? current : null, setAt };
}

/** The member's JSON record with the profile beside what else it holds (which stays exactly as it was). */
export function withWorkProfile(record: unknown, setting: WorkProfileSetting | null | undefined) {
  const base = record && typeof record === "object" && !Array.isArray(record) ? { ...(record as Record<string, unknown>) } : {};
  delete base.workProfile;
  return setting ? { ...base, workProfile: setting } : base;
}

/** The admin's save: a new stamp only when the profile changes or the person's choices are reset. `undefined` = nothing to write. */
export function nextWorkProfileSetting(stored: WorkProfileSetting | null, wanted: WorkProfile | null | undefined, reset: boolean, now: Date): WorkProfileSetting | undefined {
  if (wanted === undefined && !reset) return undefined;
  const profile = wanted === undefined ? stored?.profile ?? null : wanted;
  if ((stored?.profile ?? null) === profile && (!reset || !profile)) return undefined;
  return { profile, setAt: now.toISOString() };
}

// ---------- What is in force for a person: the admin's choice, or the person's own made under it ----------
/** What the admin has chosen for the member. Empty in Local, the demo and under "Visa som". */
export type AdminWorkChoices = { profile: WorkProfileSetting | null; view: WorkViewSetting | null };
export const NO_ADMIN_WORK_CHOICES: AdminWorkChoices = { profile: null, view: null };

/** The person's own choice: display only, and it stops counting when the admin changes the profile or the view. */
export type OwnWorkProfile = { profile: WorkProfile; setAt: string; basis: string };
export type EffectiveWorkProfile = { profile: WorkProfile | null; stamp: string; own: boolean };
export const NO_WORK_PROFILE: EffectiveWorkProfile = { profile: null, stamp: "", own: false };

const adminBasis = (admin: AdminWorkChoices) => `${workViewStamp(admin.view)}|${admin.profile?.setAt ?? ""}`;
const ownCounts = (admin: AdminWorkChoices, own: OwnWorkProfile | null | undefined): own is OwnWorkProfile => Boolean(own) && own!.basis === adminBasis(admin);

/** The person's own choice as a save, made under what the admin has chosen now. */
export const ownWorkProfileChoice = (admin: AdminWorkChoices, profile: WorkProfile, now: Date): OwnWorkProfile => ({ profile, setAt: now.toISOString(), basis: adminBasis(admin) });

export function effectiveWorkProfile(admin: AdminWorkChoices, own: OwnWorkProfile | null | undefined): EffectiveWorkProfile {
  if (ownCounts(admin, own)) return { profile: own.profile, stamp: own.setAt, own: true };
  return { profile: admin.profile?.profile ?? null, stamp: admin.profile?.setAt ?? "", own: false };
}
/** The person's own choice while it counts, for the settings page's select. */
export const ownWorkProfileShown = (admin: AdminWorkChoices, own: OwnWorkProfile | null | undefined): WorkProfile | null => ownCounts(admin, own) ? own.profile : null;

/**
 * The work view in force: the person's own profile's while it counts; otherwise the view the admin chose (under Anpassa),
 * or the admin's profile's when no view was chosen. Without any choice it is what it was (no view, today's defaults).
 */
export function effectiveWorkView(admin: AdminWorkChoices, own: OwnWorkProfile | null | undefined): WorkViewSetting | null {
  if (ownCounts(admin, own)) return { view: WORK_PROFILE[own.profile].workView, setAt: own.setAt };
  if (admin.view?.view) return admin.view;
  if (admin.profile?.profile) return { view: WORK_PROFILE[admin.profile.profile].workView, setAt: admin.profile.setAt };
  return admin.view;
}

// ---------- Menu, Hem and the tab bar: the person's saved choices while they count, otherwise the profile's ----------
/**
 * The stamp of the profile a saved choice was made under: `menu` the computer's and the tablet's menu, `phone` Mer, `native`
 * Hem and the tab bar. Missing = not chosen under any profile, null = back to the profile's. This is what tells "not chosen"
 * from "chosen empty": the lists themselves look the same, since every save writes them back through the schema.
 */
export type ChoiceBasis = { menu?: string | null; phone?: string | null; native?: string | null };
type DeviceChoices = { hiddenMenuItems: readonly string[]; menuShortcuts: readonly string[] };
type StoredChoices = DeviceChoices & { phoneMenu?: DeviceChoices | null; nativeLayout?: unknown; choiceBasis?: ChoiceBasis | null };
export type EffectiveMenuChoices = { hiddenMenuItems: string[]; menuShortcuts: string[]; phoneMenu: { hiddenMenuItems: string[]; menuShortcuts: string[] } | null };

const copyOf = (choices: DeviceChoices) => ({ hiddenMenuItems: [...choices.hiddenMenuItems], menuShortcuts: [...choices.menuShortcuts] });

/** Without a profile the stored lists as they are, as before profiles. */
export function effectiveMenuChoices(effective: EffectiveWorkProfile, stored: StoredChoices): EffectiveMenuChoices {
  if (!effective.profile) return { ...copyOf(stored), phoneMenu: stored.phoneMenu ? copyOf(stored.phoneMenu) : null };
  const menu = stored.choiceBasis?.menu === effective.stamp ? copyOf(stored) : { hiddenMenuItems: [...WORK_PROFILE[effective.profile].menuHidden] as string[], menuShortcuts: [] };
  return { ...menu, phoneMenu: stored.choiceBasis?.phone === effective.stamp && stored.phoneMenu ? copyOf(stored.phoneMenu) : null };
}

/** Hem and the tab bar as the profile starts them; today's default without a profile. */
export function profileNativeLayout(profile: WorkProfile | null): NativeLayout {
  return profile ? { home: [...WORK_PROFILE[profile].home], tabs: [...WORK_PROFILE[profile].tabs] } : defaultNativeLayout();
}
export function effectiveNativeLayout(effective: EffectiveWorkProfile, stored: Pick<StoredChoices, "nativeLayout" | "choiceBasis">): NativeLayout {
  if (effective.profile && stored.choiceBasis?.native !== effective.stamp) return profileNativeLayout(effective.profile);
  return normalizeNativeLayout(stored.nativeLayout);
}

export const workProfileMenuFirst = (profile: WorkProfile | null | undefined): readonly MenuHideable[] => profile ? WORK_PROFILE[profile].menuFirst : [];
export const workProfileStartTab = (profile: WorkProfile | null | undefined): OverviewTab | null => profile ? WORK_PROFILE[profile].startTab : null;
export const workProfileNewFirst = (profile: WorkProfile | null | undefined): readonly NewChoiceKey[] => profile ? WORK_PROFILE[profile].newFirst : [];
/** Back to the profile's menu, Hem and tab bar (Återställ till standard). */
export const RESET_CHOICE_BASIS: ChoiceBasis = { menu: null, phone: null, native: null };

/** What the shell is given and shares: what the admin has chosen and what is in force now. */
export type ShellWorkProfile = { admin: AdminWorkChoices; effective: EffectiveWorkProfile; firstSteps?: readonly WorkProfileStep[] };
