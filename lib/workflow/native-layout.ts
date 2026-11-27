import type { TypeKey } from "./native-mode";
import { calendarAllowed, menuItemAllowed, type MenuAccess } from "./menu-items";
import { canViewTeam, hasWorkflowPermission, normalizeWorkflowPermissionProfile } from "./permissions";
import { moduleInList } from "./modules";

/**
 * Hem and the tab bar at level 1 on a phone, chosen by each person (2026-10-09 evening): which big tiles Hem
 * shows and in what order, and which buttons the tab bar holds. Everyone starts from the same default; the choice is
 * personal, saved with the person's other display choices, and changes nothing about what the person may do – a tile or
 * a tab the person has no right to is simply not drawn. Mer is always the tab bar's last button, so the whole menu is
 * always one tap away. Pure, so the settings editor, the shell, Hem and the tests read the same.
 */

// B3/point 5 (2026-10-23): no tile or tab of its own for work orders – Jobb is the one job list (with Arbetsordrar as
// its filter), so a tile or tab that led there without lighting up is gone; a saved one is read as Jobb (LEGACY_LAYOUT_KEYS).
// Dashboard etapp 2 (2026-10-28): Gör detta nu, Förfallet and Mina avvikelser are tiles each person may add; they are
// off from the start (not in DEFAULT_HOME_TILES), so nobody's Hem changes until they choose them.
// The phone's quickest steps (2026-11-01): Frånvaro, Teamet and Underhåll are tiles too; off from the start like the ones above,
// a yrkesprofil starts with them (lib/workflow/work-profile.ts).
export const HOME_TILE_KEYS = ["jobs", "checkin", "new", "time", "ai", "continue", "notices", "planning", "rounds", "next", "overdue", "deviations", "absence", "team", "maintenance"] as const;
export type HomeTileKey = (typeof HOME_TILE_KEYS)[number];
export const TAB_KEYS = ["home", "jobs", "new", "time", "ai", "search", "projects", "planning", "rounds", "customers", "notifications", "team", "maintenance"] as const;
export type TabKey = (typeof TAB_KEYS)[number];

// Workflow AI is a standard tab of the bar (2026-11-21: "chattikonen ska vara en av standardikonerna i bottenraden"), so
// it is no longer a tile on Hem from the start; a person may still add the tile.
export const DEFAULT_HOME_TILES: readonly HomeTileKey[] = ["jobs", "checkin", "new", "time", "continue", "notices"];
/** The tiles whose figures come from GET /api/my-day (lib/workflow/my-day.ts); read only when one of them is on Hem. */
export const MY_DAY_TILES = ["next", "overdue", "deviations"] as const satisfies readonly HomeTileKey[];
export type MyDayTile = (typeof MY_DAY_TILES)[number];
export const isMyDayTile = (key: string): key is MyDayTile => (MY_DAY_TILES as readonly string[]).includes(key);
/**
 * Workflow AI is one of the standard tabs (2026-11-21), with a dot when a proposal or a tip waits. Five buttons in all still
 * fit, so Tid gave way: it is on Hem as a tile, in Mer as a row, and the timer itself is started on the job. Without Workflow AI
 * (Local, or a company without it) Tid takes its place again (`shownTabs`).
 */
export const DEFAULT_TABS: readonly TabKey[] = ["home", "jobs", "new", "ai"];
/** Buttons the person chooses; Mer comes after them. Five in all fits a phone's width with readable labels. */
export const MAX_TABS = 4;
/** The person's tabs that they may use; the standard Workflow AI tab gives way to Tid where there is no Workflow AI. */
export function shownTabs(tabs: readonly TabKey[], allowed: readonly TabKey[]): TabKey[] {
  const shown = tabs.filter((key) => allowed.includes(key));
  if (tabs.includes("ai") && !allowed.includes("ai") && allowed.includes("time") && !shown.includes("time") && shown.length < MAX_TABS) shown.push("time");
  return shown;
}

export type NativeLayout = { home: HomeTileKey[]; tabs: TabKey[] };
export const defaultNativeLayout = (): NativeLayout => ({ home: [...DEFAULT_HOME_TILES], tabs: [...DEFAULT_TABS] });

/** Keys saved before point 5 that are read as another tile or tab now (the Arbetsorder tile and the Order tab → Jobb). */
const LEGACY_LAYOUT_KEYS: Record<string, string> = { work_orders: "jobs" };
const pick = <K extends string>(value: unknown, keys: readonly K[]): K[] =>
  Array.isArray(value) ? [...new Set(value.map((item) => (typeof item === "string" ? LEGACY_LAYOUT_KEYS[item] ?? item : item)).filter((item): item is K => typeof item === "string" && (keys as readonly string[]).includes(item)))] : [];

/** A stored choice made safe: known keys once each, at most four tabs, at least one; anything else is the default. */
export function normalizeNativeLayout(value: unknown): NativeLayout {
  const raw = (value && typeof value === "object" ? value : {}) as { home?: unknown; tabs?: unknown };
  const home = Array.isArray(raw.home) ? pick(raw.home, HOME_TILE_KEYS) : [...DEFAULT_HOME_TILES];
  const tabs = pick(raw.tabs, TAB_KEYS).slice(0, MAX_TABS);
  return { home, tabs: tabs.length ? tabs : [...DEFAULT_TABS] };
}

/** Översiktens flik Teamet and the window Anmäl frånvaro on Jag, which the phone reaches with one tap (2026-11-01). */
export const TEAM_HREF = "/?view=stats&tab=team";
export const ABSENCE_HREF = "/?view=stats&tab=me&absence=new";
/** How a tile or a tab looks: its label, the colour of its square (Hem) and where it leads (a view, or an action). */
export type LayoutItem = { label: string; hint: string; type: TypeKey; view?: string; href?: string; action?: "new" | "ai" | "search" | "checkin";
  /** A tile Hem shows only sometimes: when (said in the edit mode, 2026-10-26). */
  when?: string };
export const HOME_TILE: Record<HomeTileKey, LayoutItem> = {
  jobs: { label: "Mina jobb", hint: "Öppna och förfallna", type: "project", view: "tasks" },
  checkin: { label: "Checka in", hint: "Personalliggaren", type: "checkin", action: "checkin", when: "Visas när ett projekt har personalliggare" },
  new: { label: "Nytt jobb", hint: "Arbetsorder eller uppgift", type: "new", action: "new" },
  time: { label: "Tid", hint: "Tid i dag", type: "time", view: "time" },
  ai: { label: "Workflow AI", hint: "Fråga om ditt arbete", type: "control", action: "ai" },
  continue: { label: "Fortsätt", hint: "Jobbet du är på, med nästa steg", type: "work-order", when: "Visas när du är på ett jobb" },
  notices: { label: "Notiser", hint: "Listan under rutorna", type: "notice" },
  planning: { label: "Kalender", hint: "Teamets vecka", type: "calendar", view: "planning" },
  rounds: { label: "Driftronder", hint: "Ronder och tillsyn", type: "round", view: "rounds" },
  next: { label: "Gör detta nu", hint: "Det viktigaste för dig nu", type: "project" },
  overdue: { label: "Förfallet", hint: "Dina förfallna jobb och ronder", type: "work-order" },
  deviations: { label: "Mina avvikelser", hint: "Öppna avvikelser du ansvarar för", type: "tools" },
  absence: { label: "Frånvaro", hint: "Sjuk eller annan frånvaro", type: "notice", href: ABSENCE_HREF },
  // Short enough for a half tile on a 360 px phone (mobil 2026-11-17: "Vilka som jobbar och va…" was cut).
  team: { label: "Teamet", hint: "Vem jobbar med vad", type: "customer", href: TEAM_HREF },
  maintenance: { label: "Underhåll", hint: "Maskiner, delar och förråd", type: "maintenance", view: "maintenance" },
};
export const TAB: Record<TabKey, LayoutItem> = {
  home: { label: "Hem", hint: "Startskärmen", type: "neutral", view: "stats" },
  jobs: { label: "Jobb", hint: "Mina jobb", type: "project", view: "tasks" },
  new: { label: "Ny", hint: "Skapa arbetsorder, uppgift eller projekt", type: "new", action: "new" },
  time: { label: "Tid", hint: "Tidrapport", type: "time", view: "time" },
  ai: { label: "AI", hint: "Workflow AI", type: "control", action: "ai" },
  search: { label: "Sök", hint: "Sök i allt", type: "neutral", action: "search" },
  projects: { label: "Projekt", hint: "Mina projekt", type: "project", view: "projects" },
  planning: { label: "Kalender", hint: "Teamets vecka", type: "calendar", view: "planning" },
  rounds: { label: "Ronder", hint: "Driftronder", type: "round", view: "rounds" },
  customers: { label: "Kunder", hint: "Kundregistret", type: "customer", view: "customers" },
  notifications: { label: "Notiser", hint: "Det som väntar på dig", type: "notice", view: "notifications" },
  team: { label: "Teamet", hint: "Vem jobbar med vad", type: "customer", href: TEAM_HREF },
  maintenance: { label: "Underhåll", hint: "Maskiner, delar och förråd", type: "maintenance", view: "maintenance" },
};

/**
 * The tab that is the open page's: the tab for exactly this view first, else Jobb for a job's pages, else Mer.
 * `jobsViews` are the views that belong under Jobb (nativeTabOf in native-mode.ts).
 */
export function activeTab(tabs: readonly TabKey[], view: string, belongsToJobs: boolean, overviewTab?: string | null): TabKey | "more" {
  if (view === "stats" && overviewTab === "team" && tabs.includes("team")) return "team";
  const exact = tabs.find((key) => TAB[key].view === view);
  if (exact) return exact;
  if (belongsToJobs && tabs.includes("jobs")) return "jobs";
  return "more";
}

/** Moves `key` within or into `list` to stand at `index` (from the pool when it was not there). */
export function placeAt<K extends string>(list: readonly K[], key: K, index: number): K[] {
  const without = list.filter((item) => item !== key);
  const at = Math.max(0, Math.min(index, without.length));
  return [...without.slice(0, at), key, ...without.slice(at)];
}

/**
 * Hem without scrolling (2026-10-21, UX-granskningen A1 and avsnitt 4): two tiles in a row; from seven small tiles
 * three in a row (icon and one word); four in a row on a phone held sideways. Wide tiles (Fortsätt) always take the whole
 * row. Notices are at most three rows on Hem, fewer when the screen is lower, and "Visa alla" leads to the rest.
 */
export const HOME_NOTICE_MAX = 3;
export const WIDE_HOME_TILES: readonly HomeTileKey[] = ["continue", "notices", ...MY_DAY_TILES];
export function homeGridColumns(smallTiles: number, landscape: boolean): 2 | 3 | 4 {
  if (landscape) return 4;
  return smallTiles >= 7 ? 3 : 2;
}
/** How many notice rows fit in `room` points beside the group's heading and the "Visa alla" row, between none and three. */
export function noticeRowsThatFit(room: number, rowHeight: number, total: number, fixed = 0) {
  if (!Number.isFinite(room) || rowHeight <= 0) return Math.min(HOME_NOTICE_MAX, total);
  // The "Visa alla" row is needed only when some notices are left out.
  const fits = (rows: number) => fixed + rows * rowHeight + (rows < total ? rowHeight : 0) <= room;
  let rows = Math.min(HOME_NOTICE_MAX, total);
  while (rows > 0 && !fits(rows)) rows -= 1;
  return rows;
}

/** Editing Hem in place (avsnitt 3): what the "Lägg till" sheet offers – the tiles the person may use but does not show. */
export function addableTiles(chosen: readonly HomeTileKey[], allowed: readonly HomeTileKey[]): HomeTileKey[] {
  return allowed.filter((key) => !chosen.includes(key));
}
/** Removes a tile and says where it stood, so Ångra can put it back in the same place. */
export function removeTile(chosen: readonly HomeTileKey[], key: HomeTileKey): { home: HomeTileKey[]; index: number } {
  return { home: chosen.filter((item) => item !== key), index: chosen.indexOf(key) };
}
/** A long press opens the edit mode; a finger that moves more than this many pixels is scrolling instead. */
export const LONG_PRESS_MS = 500;
export const LONG_PRESS_SLOP = 6;

/** The tiles and tabs a person may use, by the menu's own rule; the rest are never offered or drawn. Display only. */
export function nativeLayoutAllowed(access: MenuAccess | null): { allowedHome: HomeTileKey[]; allowedTabs: TabKey[] } {
  const admin = access?.memberRole === "OWNER" || access?.memberRole === "ADMIN";
  const profile = normalizeWorkflowPermissionProfile(access?.workflowPermissions);
  const cloud = Boolean(access) && !access?.localStorageMode && !access?.demo;
  const canCreate = (["work-order", "kfid", "risk-assessment", "forms", "projects"] as const).some((subject) => admin || hasWorkflowPermission(profile, subject, "create"));
  const allowed = (key: string): boolean => {
    switch (key) {
      case "jobs": return menuItemAllowed("work_orders", access);
      // The tab Ny always holds Avvikelse, which every active member may report (2026-11-01); the tile Nytt jobb is about jobs (below).
      case "new": return Boolean(access);
      // Teamet is a tab of Översikten, which Local does not have; the same right as the tab itself.
      case "team": return Boolean(access) && !access?.localStorageMode && canViewTeam({ admin, workflowPermissions: profile });
      case "maintenance": return menuItemAllowed("maintenance", access);
      // Frånvaro is registered on Jag, in the company's database; everyone registers their own.
      case "absence": return Boolean(access) && !access?.localStorageMode && moduleInList(access?.modules, "time");
      // Checka in is the staff register's, which a company can have turned off (0.39.0).
      case "checkin": return moduleInList(access?.modules, "staff_register");
      case "ai": case "time": case "projects": case "rounds": case "customers": return menuItemAllowed(key, access);
      // Kalender is a view of Planering; the tile and the tab lead straight to it, by its own rule.
      case "planning": return calendarAllowed(access);
      // Dashboard etapp 2 (2026-10-28): Cloud only (the figures come from the company's database; Local and the demo
      // never offer them). Gör detta nu and Förfallet need some job or round the person may read; Mina avvikelser the
      // deviation log, which every active member reads (selfInspectionAccess, beslut 3) – the menu's own rule.
      case "next": case "overdue": return cloud && (menuItemAllowed("work_orders", access) || menuItemAllowed("rounds", access));
      case "deviations": return cloud && menuItemAllowed("deviations", access);
      default: return true;
    }
  };
  return { allowedHome: HOME_TILE_KEYS.filter((key) => allowed(key) && (key !== "new" || canCreate)), allowedTabs: TAB_KEYS.filter(allowed) };
}
