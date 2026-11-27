/**
 * Bakåt och framåt i Workflow (2026-10-09): the visits made inside the workspace in this tab, so the floating
 * back and forward buttons on phone and tablet follow the person's own way – a work order opened from a task leads back
 * to the same task – and never leave Workflow. Every entry carries an id that the shell also writes into the browser's
 * history state, so a step with the browser's own back gesture is recognised as the same entry. Pure; the shell keeps
 * the state in sessionStorage (per tab, gone when the tab closes).
 */
export type HistoryEntry = { id: string; url: string; scrollY?: number };
export type HistoryState = { entries: HistoryEntry[]; index: number };
export type HistoryEvent =
  /** A new page (a link, router.push): what lay ahead of the current entry is dropped. */
  | { kind: "push"; id: string; url: string }
  /** The same entry with a new address (router.replace, e.g. a new task's first save). */
  | { kind: "replace"; id: string; url: string }
  /** The browser moved to an entry it already had (back, forward, reload); an unknown id starts a new history. */
  | { kind: "visit"; id: string; url: string };

/** At most this many entries are kept; the oldest go first. */
export const HISTORY_LIMIT = 50;
export const emptyHistory = (): HistoryState => ({ entries: [], index: -1 });

export function recordNavigation(state: HistoryState, event: HistoryEvent): HistoryState {
  const current = state.entries[state.index];
  if (event.kind === "visit") {
    const at = state.entries.findIndex((entry) => entry.id === event.id);
    if (at >= 0) return { entries: state.entries.map((entry, index) => (index === at ? { ...entry, url: event.url } : entry)), index: at };
    // An entry this tab never recorded (the first page after signing in, or history from before): a fresh start.
    return { entries: [{ id: event.id, url: event.url }], index: 0 };
  }
  if (event.kind === "replace" && current) {
    // The same entry keeps its scroll position (Next's own replace after every step back came before the next scroll and lost it).
    return { entries: state.entries.map((entry, index) => (index === state.index ? { ...(entry.id === event.id && entry.scrollY !== undefined ? { scrollY: entry.scrollY } : {}), id: event.id, url: event.url } : entry)), index: state.index };
  }
  if (current && current.id === event.id) return { entries: state.entries.map((entry, index) => (index === state.index ? { ...entry, url: event.url } : entry)), index: state.index };
  const entries = [...state.entries.slice(0, state.index + 1), { id: event.id, url: event.url }];
  const overflow = Math.max(0, entries.length - HISTORY_LIMIT);
  return { entries: entries.slice(overflow), index: entries.length - 1 - overflow };
}

export const canGoBack = (state: HistoryState) => state.index > 0;
export const canGoForward = (state: HistoryState) => state.index >= 0 && state.index < state.entries.length - 1;

/** The same address with a form page's `page=<key>` (features/kfid/dialog-page.tsx) on top; a list's `page=2` is a page of its own. */
const isFormPageOf = (next: string, current: string) => {
  const [nextPath, nextQuery = ""] = next.split("?");
  const [currentPath, currentQuery = ""] = current.split("?");
  if (nextPath !== currentPath) return false;
  const params = new URLSearchParams(nextQuery), now = new URLSearchParams(currentQuery);
  const page = params.get("page");
  if (!page || /^\d+$/.test(page) || page === now.get("page")) return false;
  params.delete("page"); now.delete("page");
  params.sort(); now.sort();
  return params.toString() === now.toString();
};

/** The same address, whatever the order of its values (`/` and `/?` are one). */
export function sameAddress(a: string, b: string): boolean {
  const key = (url: string) => {
    const [path, query = ""] = url.split("?");
    const params = new URLSearchParams(query);
    params.sort();
    return `${path}?${params.toString()}`;
  };
  return key(a) === key(b);
}

/**
 * A step that leads nowhere from this address: the same address again (the back guard's extra entry of an unsaved view,
 * lib/workflow/use-back-guard.ts, stays behind when the person leaves or saves), or a closed form page, which cannot bring the form
 * back since what it edited lives in the page, not in the address.
 */
const leadsNowhere = (target: string, current: string) => sameAddress(target, current) || isFormPageOf(target, current);

/**
 * How many entries Tillbaka and Framåt go (2026-11-02: "Fram och tillbaka pilen fungerar inte alltid"): to the nearest entry that
 * shows something else; 0 when there is none, and the arrow then has no function. A press on an arrow always changes the page.
 */
export function stepsBack(state: HistoryState): number {
  const current = state.entries[state.index]?.url;
  if (current === undefined) return 0;
  for (let at = state.index - 1; at >= 0; at -= 1) if (!leadsNowhere(state.entries[at]!.url, current)) return state.index - at;
  return 0;
}
export function stepsForward(state: HistoryState): number {
  const current = state.entries[state.index]?.url;
  if (current === undefined) return 0;
  for (let at = state.index + 1; at < state.entries.length; at += 1) if (!leadsNowhere(state.entries[at]!.url, current)) return at - state.index;
  return 0;
}
export const canStepBack = (state: HistoryState) => stepsBack(state) > 0;
export const canStepForward = (state: HistoryState) => stepsForward(state) > 0;

/**
 * How a document that has just loaded joins the tab's history when its entry has no id. A full load from inside Workflow (a pin on the map,
 * changing company, any plain link) is a step from the page before, and the browser's history still has that page: before 2026-11-02 it
 * started over, and Tillbaka went nearly transparent though there was a page to go to. Anything else starts over: the first page after
 * signing in (the person came from the login page), a new tab that was copied its opener's list but has no history of its own.
 * The same address loaded again takes the place of its own entry, as the browser does.
 */
export function arrivalEvent(state: HistoryState, arrival: { id: string; url: string; loadedBy: string | null; referrer: string | null; historyLength: number }): HistoryEvent {
  const current = state.entries[state.index]?.url;
  if (current !== undefined && arrival.loadedBy === "navigate" && arrival.referrer !== null && arrival.historyLength > 1 && sameAddress(arrival.referrer, current)) {
    return { kind: sameAddress(arrival.url, current) ? "replace" : "push", id: arrival.id, url: arrival.url };
  }
  return { kind: "visit", id: arrival.id, url: arrival.url };
}

/** The scroll position of an entry, saved while the person scrolls so a step back lands where they were. */
export function rememberScroll(state: HistoryState, id: string, scrollY: number): HistoryState {
  const y = Math.max(0, Math.round(scrollY));
  if (!state.entries.some((entry) => entry.id === id && entry.scrollY !== y)) return state;
  return { ...state, entries: state.entries.map((entry) => (entry.id === id ? { ...entry, scrollY: y } : entry)) };
}

/** Reads the stored state; anything unreadable is an empty history. */
export function parseHistory(text: string | null): HistoryState {
  try {
    const value = JSON.parse(text ?? "null") as Partial<HistoryState> | null;
    if (!value || !Array.isArray(value.entries) || typeof value.index !== "number") return emptyHistory();
    const entries = value.entries.filter((entry): entry is HistoryEntry => Boolean(entry) && typeof entry.id === "string" && typeof entry.url === "string").slice(-HISTORY_LIMIT);
    const index = Math.min(entries.length - 1, Math.max(-1, Math.trunc(value.index)));
    return { entries, index };
  } catch {
    return emptyHistory();
  }
}
