/**
 * Visa mer (UX-granskningen A2, 2026-10-21/22): a phone always shows the app (lib/workflow/detail-level.ts,
 * displayLevelsFor); what Lagom and Allt showed there – the explaining texts, minor facts, extra panels and rows, the
 * pages made for a larger screen – comes back on a page with one small button at the foot of the page, "Visa mer" /
 * "Visa mindre" (components/native/show-more.tsx, drawn by the shell). It only raises the content level (`data-detail`
 * 1 → 3); the layout stays the app's. The choice is remembered per page (the address's `view`) on the device, and
 * "Visa allt på den här enheten" under Mina inställningar turns it on for every page. Display only: Visa mer never
 * changes what the person may do, and the job and its safety are shown with or without it.
 *
 * Pure, so the shell, the button and the tests read the same.
 */

/** Asks the shell to turn Visa mer on (detail `true`) or off (`false`) for the page now open. */
export const SHOW_MORE_EVENT = "hintek:show-more";
/** The device's remembered pages (localStorage, a JSON list of page names). */
export const SHOW_MORE_STORAGE_KEY = "hintek.show-more";
/** No more pages are remembered than this; the oldest is forgotten first. */
export const SHOW_MORE_MAX_PAGES = 60;

/** A page's name for the memory: the address's `view`, or Hem (`stats`) without one. */
export function showMorePage(view: string | null | undefined): string {
  const name = (view ?? "").trim();
  return name && name.length <= 60 ? name : "stats";
}

/** The remembered pages from what the device holds; anything that is not a list of names is nothing remembered. */
export function parseShowMorePages(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 60))].slice(-SHOW_MORE_MAX_PAGES);
  } catch {
    return [];
  }
}

/** The list with `page` turned on (last, so the newest is kept longest) or off. */
export function withShowMorePage(pages: readonly string[], page: string, on: boolean): string[] {
  const rest = pages.filter((item) => item !== page);
  return on ? [...rest, page].slice(-SHOW_MORE_MAX_PAGES) : rest;
}

/** Turns Visa mer on for these pages on this device (the company's settings row, TF10); without storage nothing is remembered. */
export function rememberShowMorePages(pages: readonly string[]) {
  try {
    const stored = parseShowMorePages(window.localStorage.getItem(SHOW_MORE_STORAGE_KEY));
    window.localStorage.setItem(SHOW_MORE_STORAGE_KEY, JSON.stringify(pages.reduce((list, page) => withShowMorePage(list, page, true), stored)));
  } catch { /* no storage: the page itself offers Visa mer */ }
}

/**
 * What the style sheet leaves out at content level 1 (app/globals.css, "Visningsnivå"), read by the button to know
 * whether the open page has anything more to show. An element marked `data-show-more` stands for content a part draws
 * only at a higher level (rows, sections, a page for a larger screen). Keep in step with the style sheet.
 */
export const SHOW_MORE_HIDDEN_SELECTORS: readonly string[] = [
  ".workspace-main h1.page-title + .page-description",
  ".workspace-main .panel-heading h2 + p",
  ".workspace-main [data-detail-min]",
  ".workspace-main :is(.page-header, :has(> h1.page-title), :has(> div > h1.page-title)) + .notice:not([role])",
  ".workspace-main .page-header + [data-section-tabs-slot] + .notice:not([role])",
  ".workspace-main .editor-facts > :not([data-fact-keep])",
];
/**
 * Never shown on a phone, so they never count there (app/globals.css, A5: a phone has no explaining sentence under the heading,
 * also after Visa mer). Ställ in Workflow's steps keep their short line out on a phone (kundresa 2026-11-07, L20: Visa mer looked left over).
 */
export const SHOW_MORE_PHONE_HIDDEN = ".workspace-main h1.page-title + .page-description, .form-page-description, [data-testid=\"setup-guide\"] .panel-heading h2 + p";
export const SHOW_MORE_MARKER = "[data-show-more]";

/**
 * Whether the button is shown: only where Visa mer is offered (a phone with Visa allt off) and the page has something
 * more – or Visa mer is already on, so it can always be turned off again.
 */
export function showMoreButtonShown({ offered, on, hasMore }: { offered: boolean; on: boolean; hasMore: boolean }): boolean {
  return offered && (on || hasMore);
}

export const showMoreLabel = (on: boolean) => on ? "Visa mindre" : "Visa mer";

/**
 * Inget blir onåbart (A2, 2026-10-22): a part the app draws in a slimmer variant – a menu of rows in place of a
 * page's tabs, a list without the office's export – is drawn so only at content level 1: always in the app column of a
 * tablet or a computer, on a phone until Visa mer or Visa allt. Then the part is drawn as the ordinary one (or its app
 * variant gets the row that leads on), as a page for a larger screen is with "Visa sidan". Display only.
 */
export const nativeReduced = (native: boolean, content: 1 | 2 | 3): boolean => native && content === 1;

/** The one line under an app screen that leaves something out, on a phone (Visa mer is the way there). */
export const SHOW_MORE_NOTE = "Fler val under Visa mer längst ned.";

/** That line: on a phone the shared one; in the app column, where display 2 can be chosen, the column's own text. */
export const showMoreNote = (phone: boolean, columnText: string): string => phone ? SHOW_MORE_NOTE : columnText;
