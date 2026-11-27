"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { arrivalEvent, canGoBack, canStepBack, canStepForward, emptyHistory, parseHistory, recordNavigation, rememberScroll, stepsBack, stepsForward, type HistoryEvent, type HistoryState } from "@/lib/workflow/history-stack";
import { confirmLeave } from "@/lib/workflow/leave-guard";
import { isEdgeSwipeBack, screenChangeFor, type TouchPoint } from "@/lib/workflow/native-nav";
import { holdChrome } from "@/lib/workflow/shell-events";
import { onBackGuardEntry } from "@/lib/workflow/use-back-guard";
import { sameReturnChain, withoutPicks } from "@/lib/workflow/return-link";

/**
 * Bakåt och framåt i Workflow (2026-10-09). The browser's own history is the truth; every entry made inside the
 * workspace carries an id (`__wf` in history.state) and this tab's list of them lives in sessionStorage, so the buttons
 * know whether a step back stays inside Workflow and a back gesture is recognised. Scroll positions are saved per entry
 * and restored when the person comes back; lists keep their search and filters per entry with `useEntryState`.
 */
const STORE = "workflow.history.v1";
const ENTRY_STATE = "workflow.entry.";
const ID_KEY = "__wf";
type Listener = (state: HistoryState, event: HistoryEvent) => void;
const listeners = new Set<Listener>();
let installed = false;
let state: HistoryState = emptyHistory();

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const here = () => `${location.pathname}${location.search}`;
/**
 * The address as it stands, #-part included, for marking the current entry: marking it must never change the address. Without
 * the #-part a shared link (/visa#k=…) sometimes lost its secret before the page had read it (2026-11-19: this runs when the
 * chunk is evaluated, which can fall between Next's own history update and the page's first effect) and showed "Länken kan inte visas".
 */
const hereExactly = () => `${here()}${location.hash}`;
/**
 * A frame of the same origin (the pane beside a list on a tablet, appkänsla 2026-11-22; the proposal's viewer) shares the tab's
 * sessionStorage with the window around it but has a history of its own: its list is kept under its own name, so the two never
 * write over each other. An ordinary window, and the app column's frame (whose window around it keeps no list), use the plain key.
 */
const storeKey = () => { try { return window.parent !== window && /^hintek-(split|visning)/.test(window.name) ? `${STORE}:${window.name}` : STORE; } catch { return STORE; } };
const readState = () => { try { return parseHistory(sessionStorage.getItem(storeKey())); } catch { return emptyHistory(); } };
const writeState = (next: HistoryState) => { state = next; try { sessionStorage.setItem(storeKey(), JSON.stringify(next)); } catch { /* storage blocked: the buttons just know less */ } };
const idOf = (value: unknown) => (value && typeof value === "object" && typeof (value as Record<string, unknown>)[ID_KEY] === "string" ? (value as Record<string, string>)[ID_KEY] : null);
const urlOf = (url: string | URL | null | undefined) => {
  if (!url) return here();
  try { const parsed = new URL(String(url), location.href); return `${parsed.pathname}${parsed.search}`; } catch { return here(); }
};
/**
 * Skärmbyte med riktning (appkänslan, beslutad 2026-11-23): <html data-screen-change="forward|back"> for a moment around a
 * step, so the app look can let the new screen come in from the side it belongs to (app/globals.css). Set before the new
 * screen is drawn (Next moves the history as the new tree is committed) and taken away when the movement is over, so a part
 * that arrives later (a list that was loading) only fades in as before. Display only; nothing reads it but the stylesheet.
 */
const SCREEN_CHANGE_MS = 450;
let tabBarPressAt = 0;
let arrived = false;
let screenChangeTimer: number | undefined;
function markScreenChange(event: HistoryEvent, before: number, after: number) {
  const direction = screenChangeFor({ kind: event.kind, before, after, fromTabBar: Date.now() - tabBarPressAt < 1500 });
  // No direction leaves a mark that is already there: Next replaces the entry's state right after a step back, and that is
  // the same step.
  if (!direction) return;
  window.clearTimeout(screenChangeTimer);
  document.documentElement.dataset.screenChange = direction;
  screenChangeTimer = window.setTimeout(() => { delete document.documentElement.dataset.screenChange; }, SCREEN_CHANGE_MS);
}

function apply(event: HistoryEvent) {
  const before = state.index;
  const next = recordNavigation(state, event);
  writeState(next);
  // Never for the page the window arrives on (a whole page load): the mark would stand on <html> before React has taken
  // the page over, which React reports as a difference from the server's HTML (tests/phone-first-frame.browser.cjs).
  if (arrived) markScreenChange(event, before, next.index);
  if (event.kind === "push") rememberSheetEntry(event.id);
  // Next.js moves the history inside useInsertionEffect, where React may not be told of updates: listeners hear of
  // the step a moment later (the state itself is already written).
  queueMicrotask(() => { for (const listener of listeners) listener(next, event); });
}

/** Called for every step in the workspace's history (push, replace, back/forward); returns the unsubscribe. */
export function subscribeHistory(listener: (event: HistoryEvent) => void): () => void {
  const wrapped: Listener = (_, event) => listener(event);
  listeners.add(wrapped);
  return () => { listeners.delete(wrapped); };
}

/** Where the tab stands among its visits: a visit with a higher number is a step forward, a lower one a step back. */
export function visitIndex(): number {
  return state.index;
}

/** The address of the visit before this one inside Workflow, or null. */
export function previousEntryUrl(): string | null {
  return state.index > 0 ? state.entries[state.index - 1]?.url ?? null : null;
}

/** The address Tillbaka leads to (the arrows pass the steps that lead nowhere, history-stack.ts), or null. */
export function backTargetUrl(): string | null {
  const steps = stepsBack(state);
  return steps ? state.entries[state.index - steps]?.url ?? null : null;
}

/**
 * A page opened from a sheet that lay over the page before (the Mer sheet at level 1, 2026-10-12): the top bar's back then
 * says "Mer" and opens the sheet again on the page it returns to. The sheet's row calls `markOpenedFromSheet` before the
 * navigation; the next entry pushed within two seconds is remembered as opened from that sheet, per tab, by its id.
 */
const SHEET_STORE = "workflow.sheet.v1";
type SheetName = "more";
let pendingSheet: { name: SheetName; at: number } | null = null;
let requestedSheet: SheetName | null = null;
const readSheets = (): Record<string, SheetName> => { try { return JSON.parse(sessionStorage.getItem(SHEET_STORE) ?? "{}") as Record<string, SheetName>; } catch { return {}; } };
export function markOpenedFromSheet(name: SheetName) { pendingSheet = { name, at: Date.now() }; }
function rememberSheetEntry(id: string) {
  if (!pendingSheet) return;
  const { name, at } = pendingSheet;
  pendingSheet = null;
  if (Date.now() - at > 2000) return;
  try {
    const sheets = readSheets();
    sheets[id] = name;
    // Bounded: the newest fifty entries are enough for any back button.
    const keys = Object.keys(sheets);
    for (const key of keys.slice(0, Math.max(0, keys.length - 50))) delete sheets[key];
    sessionStorage.setItem(SHEET_STORE, JSON.stringify(sheets));
  } catch { /* storage blocked: the label falls back to the page before */ }
}
/** The sheet the current entry was opened from, or null. */
export function openedFromSheet(): SheetName | null {
  const id = currentEntryId();
  return id ? readSheets()[id] ?? null : null;
}
/** Asks the tab bar to open a sheet on the page the next step back arrives at. */
export function requestSheet(name: SheetName) { requestedSheet = name; }
export function takeRequestedSheet(): SheetName | null { const name = requestedSheet; requestedSheet = null; return name; }

/**
 * Back to the work a register page was opened from (2026-10-09): the browser's own step back when that is where
 * the person came from – the page then keeps its scroll, search and unsaved draft – otherwise the address itself.
 */
export function returnToWork(address: string, push: (href: string) => void, within?: (url: string) => boolean) {
  // `within`: the visits between may be screens of the same work (a form's parts, 2026-10-12): back goes past them all to
  // the address, so the menu is not added again after them (its "‹ Jobbet" led back into the form).
  for (let at = state.index - 1; at >= 0; at -= 1) {
    const url = state.entries[at]?.url;
    if (url === address) { const steps = state.index - at; if (steps === 1) window.history.back(); else window.history.go(-steps); return; }
    if (!within || !url || !within(url)) break;
  }
  push(address);
}

/**
 * Samband (2026-10-26, lib/workflow/return-link.ts): back to the page a chain of sub-pages was opened from – the
 * browser's own steps back past every page of the chain (they carry the same `returnTo`), so the page comes back as it was
 * (scroll, search, unsaved draft) and Bakåt from it never lands in the sub-pages again. `then` is the address to show when
 * it has come back (the same page with a `pick…` marker for its field); without such a visit the address is opened.
 */
export function returnToOrigin(returnTo: string, push: (href: string) => void, { then, replace }: { then?: string; replace?: (href: string) => void } = {}) {
  const target = withoutPicks(returnTo);
  for (let at = state.index - 1; at >= 0; at -= 1) {
    const url = state.entries[at]?.url;
    if (url && withoutPicks(url) === target) {
      if (then && then !== url) {
        const mark = () => window.setTimeout(() => (replace ? replace(then) : window.history.replaceState(window.history.state, "", then)), 0);
        window.addEventListener("popstate", mark, { once: true });
      }
      window.history.go(at - state.index);
      return;
    }
    if (!url || !sameReturnChain(url, returnTo)) break;
  }
  push(then ?? returnTo);
}

/** Avbryt on a sub-page (samband, 2026-10-26): exactly one step back inside Workflow, or – opened directly – the page it belongs to. */
export function stepBack(fallback: string, push: (href: string) => void) {
  if (canGoBack(state)) window.history.back(); else push(fallback);
}

/** The id of the history entry the person is on now (also right after a back step, before React has drawn it). */
export function currentEntryId(): string | null {
  if (typeof window === "undefined") return null;
  return idOf(window.history.state);
}

/**
 * Installed once, as early as possible: wraps pushState and replaceState so every entry – Next's own navigation and any
 * other – carries an id, and listens for the browser's back and forward.
 */
function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  state = readState();
  const push = window.history.pushState;
  const replace = window.history.replaceState;
  window.history.pushState = function pushState(data: unknown, unused: string, url?: string | URL | null) {
    const id = newId();
    const result = push.call(window.history, { ...(data && typeof data === "object" ? data : {}), [ID_KEY]: id }, unused, url);
    apply({ kind: "push", id, url: urlOf(url) });
    return result;
  };
  window.history.replaceState = function replaceState(data: unknown, unused: string, url?: string | URL | null) {
    const id = idOf(data) ?? idOf(window.history.state) ?? newId();
    const result = replace.call(window.history, { ...(data && typeof data === "object" ? data : {}), [ID_KEY]: id }, unused, url);
    apply({ kind: "replace", id, url: urlOf(url) });
    return result;
  };
  window.addEventListener("popstate", (event) => {
    const id = idOf(event.state);
    if (id) apply({ kind: "visit", id, url: here() });
    else {
      // An entry without an id (made before this was installed): give it one, as a new start.
      const fresh = newId();
      replace.call(window.history, { ...(event.state && typeof event.state === "object" ? event.state : {}), [ID_KEY]: fresh }, "", hereExactly());
      apply({ kind: "visit", id: fresh, url: here() });
    }
  });
  // A press in the tab bar changes place; it is not a step further in (markScreenChange).
  document.addEventListener("click", (event) => { if (event.target instanceof Element && event.target.closest(".native-tab-bar a")) tabBarPressAt = Date.now(); }, true);
  // A page brought back whole from the browser's memory (bfcache) has this tab's list as it was when it was left.
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    state = readState();
    const id = idOf(window.history.state);
    if (id) apply({ kind: "visit", id, url: here() });
  });
  // The page the tab opened on (or came back to after a reload).
  const current = idOf(window.history.state);
  if (current) apply({ kind: "visit", id: current, url: here() });
  else {
    const fresh = newId();
    replace.call(window.history, { ...(window.history.state && typeof window.history.state === "object" ? window.history.state : {}), [ID_KEY]: fresh }, "", hereExactly());
    apply(arrivalEvent(state, { id: fresh, url: here(), loadedBy: loadedBy(), referrer: sameOriginReferrer(), historyLength: window.history.length }));
  }
  // From here on a step is a step inside the app (markScreenChange). A moment later, so nothing done while the page is
  // being taken over counts.
  window.setTimeout(() => { arrived = true; }, 0);
}
const loadedBy = () => (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.type ?? null;
/** The address the page was opened from, when that was this installation. */
function sameOriginReferrer(): string | null {
  try {
    const from = new URL(document.referrer);
    return from.origin === location.origin ? `${from.pathname}${from.search}` : null;
  } catch { return null; }
}
if (typeof window !== "undefined") install();

type HistoryValue = { canBack: boolean; canForward: boolean; back: () => void; forward: () => void };
const HistoryContext = createContext<HistoryValue>({ canBack: false, canForward: false, back: () => undefined, forward: () => undefined });
export const useVisitHistory = () => useContext(HistoryContext);

/**
 * The way out of a page with Avbryt (2026-10-13): back where the person came from, or – when the page was opened directly
 * (a link, a notice, a new tab) – the page above, never out of Workflow as router.back() did. Asks through the leave
 * guards as back() does; a page that has already asked calls leaveWithoutAsking() first.
 */
export function useLeavePage() {
  const router = useRouter();
  const { canBack, back } = useVisitHistory();
  return useCallback((fallback: string) => {
    if (canBack) back();
    else void confirmLeave().then((ok) => { if (ok) router.push(fallback); });
  }, [canBack, back, router]);
}

/**
 * Something open over the page that Bakåt closes first (2026-10-09: the Nytt jobb and Mer sheets at level 1):
 * the floating back button calls it instead of stepping back a page. Only the latest open one is kept.
 */
let closeFirst: (() => void) | null = null;
export function useBackClosesFirst(close: (() => void) | null) {
  useEffect(() => {
    if (!close) return;
    closeFirst = close;
    return () => { if (closeFirst === close) closeFirst = null; };
  }, [close]);
}

/**
 * Where Bakåt leads when there is no visit to go back to (a page opened directly): the level 1 top bar registers its
 * "page above", so the edge swipe goes the same way as the bar's "‹ …" (2026-10-13). Only the shown bar's is kept.
 */
let backFallback: (() => void) | null = null;
export function useBackFallback(fallback: (() => void) | null) {
  const latest = useRef(fallback);
  useEffect(() => { latest.current = fallback; });
  const present = Boolean(fallback);
  useEffect(() => {
    if (!present) return;
    const go = () => latest.current?.();
    backFallback = go;
    return () => { if (backFallback === go) backFallback = null; };
  }, [present]);
}

/**
 * Whether a finger on this element moves the element itself sideways (2026-10-13): a box that scrolls sideways, the
 * map in "Flytta kartan" or anything marked data-no-edge-swipe. A swipe from the edge there scrolls it, never goes back.
 */
function swipesItself(target: EventTarget | null): boolean {
  for (let element = target instanceof Element ? target : null; element && element !== document.body; element = element.parentElement) {
    if (element.hasAttribute("data-no-edge-swipe")) return true;
    if (element.scrollWidth > element.clientWidth + 1 && /^(auto|scroll)$/.test(getComputedStyle(element).overflowX)) return true;
  }
  return false;
}

/** Restores a remembered scroll position once the page is tall enough, and stops if the person scrolls first. */
function restoreScroll(y: number) {
  let cancelled = false;
  const stop = () => { cancelled = true; };
  window.addEventListener("wheel", stop, { once: true, passive: true });
  window.addEventListener("touchstart", stop, { once: true, passive: true });
  window.addEventListener("keydown", stop, { once: true });
  const started = Date.now();
  let done = false;
  // Stabil sidladdning (2026-10-23): checked right after each change of the page (a MutationObserver runs before the
  // browser paints) and once per frame, not every 80 ms – a list drawn from memory gets its scroll position in the same
  // frame it appears in, instead of showing its top for a frame or more first.
  const observer = new MutationObserver(() => attempt());
  const finish = () => { done = true; observer.disconnect(); holdChrome(); window.scrollTo({ top: y, behavior: "instant" as ScrollBehavior }); };
  function attempt() {
    if (done) return;
    if (cancelled) { done = true; observer.disconnect(); return; }
    if (document.documentElement.scrollHeight - window.innerHeight >= y - 4) { finish(); return; }
    if (Date.now() - started >= 2500) finish();
  }
  const frame = () => { attempt(); if (!done) window.requestAnimationFrame(frame); };
  observer.observe(document.body, { childList: true, subtree: true });
  window.requestAnimationFrame(frame);
  window.setTimeout(() => { window.removeEventListener("wheel", stop); window.removeEventListener("touchstart", stop); window.removeEventListener("keydown", stop); }, 2600);
}

export function VisitHistoryProvider({ children }: { children: ReactNode }) {
  // Only whether there is a way back or forward is drawn; the server and the first client render have neither.
  const ways = useSyncExternalStore(subscribeWays, waysSnapshot, () => "false|false");
  useEffect(() => {
    const listener: Listener = (next, event) => {
      if (event.kind !== "visit") return;
      const y = next.entries[next.index]?.scrollY ?? 0;
      if (y > 0) restoreScroll(y);
    };
    listeners.add(listener);
    let timer = 0;
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { const id = currentEntryId(); if (id) writeState(rememberScroll(state, id, window.scrollY)); }, 150);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { listeners.delete(listener); window.removeEventListener("scroll", onScroll); window.clearTimeout(timer); };
  }, []);
  // To the nearest entry that shows something else. On a back guard's own entry only its one step: the guard follows that step itself.
  const back = useCallback(() => { if (closeFirst) { closeFirst(); return; } void confirmLeave().then((ok) => { if (!ok) return; const steps = stepsBack(state); if (!steps) return; if (onBackGuardEntry()) window.history.back(); else window.history.go(-steps); }); }, []);
  const backRef = useRef(back);
  useEffect(() => { backRef.current = back; });
  const forward = useCallback(() => { void confirmLeave().then((ok) => { const steps = stepsForward(state); if (ok && steps) window.history.go(steps); }); }, []);
  // Visning 1 (2026-10-12): a swipe from the left edge goes back, the same back() as the top bar's "‹ …".
  useEffect(() => {
    let start: TouchPoint | null = null;
    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      start = event.touches.length === 1 && touch && document.documentElement.dataset.native === "1" && !swipesItself(event.target) ? { x: touch.clientX, y: touch.clientY } : null;
    };
    const onEnd = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      const from = start;
      start = null;
      if (from && touch && isEdgeSwipeBack(from, { x: touch.clientX, y: touch.clientY })) {
        // Nothing inside Workflow to go back to: the page above, as the top bar's back does.
        if (!closeFirst && !canStepBack(state) && backFallback) backFallback(); else backRef.current();
      }
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", () => { start = null; }, { passive: true });
    return () => { window.removeEventListener("touchstart", onStart); window.removeEventListener("touchend", onEnd); };
  }, []);
  const [canBack, canForward] = ways.split("|").map((part) => part === "true");
  const value = { canBack, canForward, back, forward };
  return <HistoryContext.Provider value={value}>{children}</HistoryContext.Provider>;
}
const waysSnapshot = () => `${canStepBack(state)}|${canStepForward(state)}`;
function subscribeWays(onChange: () => void) {
  install();
  const listener: Listener = () => onChange();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * A list's search and filters, kept per history entry (2026-10-09): leaving the list for a row and coming back
 * shows the same search and filter. A new visit to the list starts from `initial`. sessionStorage, per tab.
 */
export function useEntryState<T>(name: string, initial: T): [T, (value: T | ((current: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    const id = currentEntryId();
    try {
      const stored = id ? sessionStorage.getItem(`${ENTRY_STATE}${id}.${name}`) : null;
      return stored === null ? initial : (JSON.parse(stored) as T);
    } catch { return initial; }
  });
  const set = useCallback((next: T | ((current: T) => T)) => {
    setValue((current) => {
      const resolved = typeof next === "function" ? (next as (current: T) => T)(current) : next;
      const id = currentEntryId();
      try { if (id) sessionStorage.setItem(`${ENTRY_STATE}${id}.${name}`, JSON.stringify(resolved)); } catch { /* optional */ }
      return resolved;
    });
  }, [name]);
  return [value, set];
}
