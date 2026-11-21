/** Window events the shell listens for, kept here so any part of the app can send them without importing the shell. */

/** Opens Sök from anywhere (the bottom bar, a temporary view's bar, a button elsewhere in the shell). */
export const OPEN_SEARCH_EVENT = "workflow:open-search";

/** Opens Workflow AI from anywhere (Hem's tile and the tab bar at level 1 on a phone). */
export const OPEN_ASSISTANT_EVENT = "workflow:open-assistant";

/** The person saved Hem's tiles or the tab bar for level 1 (detail: NativeLayout); the shell follows at once. */
export const NATIVE_LAYOUT_EVENT = "workflow:native-layout";

/**
 * Profilmenyn and Anpassa menyn (2026-10-21, UX-granskningen C1) save the person's own choices without a page of
 * their own: the shell sends the change (detail: { patch, message }) and the workspace saves it as on Mina inställningar.
 */
export const PREFERENCES_PATCH_EVENT = "workflow:preferences-patch";
/** The workspace tells the shell the person's current theme, text size and menu choices (detail: PreferencesState). */
export const PREFERENCES_STATE_EVENT = "workflow:preferences-state";
/** The menu choices are the computer's and the tablet's menu; phoneMenu is Mer on the phone (null = follows the menu). */
export type PreferencesState = { theme: "light" | "dark" | "system"; textScale: "100" | "110" | "125"; hiddenMenuItems: string[]; menuShortcuts: string[]; phoneMenu: { hiddenMenuItems: string[]; menuShortcuts: string[] } | null;
  /** The stamp of the yrkesprofil in force (empty without one): a menu choice saved now is made under it. */
  profileStamp?: string };
/** Opens Anpassa menyn (the button at the foot of the menu, and the line under Mina inställningar → Avancerat). */
export const OPEN_MENU_CUSTOMIZE_EVENT = "workflow:open-menu-customize";

/** Opens the calculator from anywhere (Mer → Verktyg at level 1 on a phone, where the top bar has no calculator icon). */
export const OPEN_CALCULATOR_EVENT = "workflow:open-calculator";

/** Brings the top bar and the tab bar back when they slid away with the page's scrolling (a screen at level 1 opens). */
export const SHOW_CHROME_EVENT = "workflow:show-chrome";

/**
 * The app itself moves the page – Bakåt putting it back where it was scrolled, "rulla till fältet" (2026-10-13): the
 * bars stay shown for that scrolling instead of reading it as a finger pushing the page up (they vanished after Bakåt).
 */
export const HOLD_CHROME_EVENT = "workflow:hold-chrome";
export const holdChrome = (ms = 900) => window.dispatchEvent(new CustomEvent<number>(HOLD_CHROME_EVENT, { detail: ms }));
