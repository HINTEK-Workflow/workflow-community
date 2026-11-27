"use client";

import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { readWorkspaceCache, subscribeWorkspaceCache, workspaceCacheNeedsRead, writeWorkspaceCache } from "@/lib/workflow/workspace-cache";

/**
 * Behåll gammalt innehåll (stabil sidladdning steg 7, 2026-10-22/23): one hook for what a view reads. It shows the
 * latest answer at once – from this tab's memory, lib/workflow/workspace-cache.ts – while the same read is made again
 * (stale-while-revalidate), aborts a read that is no longer wanted (AbortController) and is told to read again after a
 * change (`reload`, or `invalidateWorkspaceCache(prefix)` from anywhere). Going back to a list therefore draws its rows in
 * the first frame, so the remembered scroll position finds its place (P8).
 *
 * The cache key is the scope (company + person + Visa som + role and permissions, given by the workspace with
 * `WorkspaceDataScope`) and the view's own `key` – the API address with every choice that decides the answer, i.e. the
 * page's address and filters. Outside a scope (no person) nothing is kept; the read is made as before.
 */
const ScopeContext = createContext<string | null>(null);

export function WorkspaceDataScope({ scope, children }: { scope: string | null; children: ReactNode }) {
  return createElement(ScopeContext.Provider, { value: scope }, children);
}

export const useWorkspaceDataScope = () => useContext(ScopeContext);

/** `dataId`: the key the shown data was read for (with keepPrevious it can be the previous one while the new is read). */
type State<T> = { id: string | null; scope: string | null; data: T | undefined; dataId: string | null; error: string; fetching: boolean };

export type WorkspaceData<T> = {
  /** The latest answer (also one kept from before), undefined until there is one. */
  data: T | undefined;
  error: string;
  /** Nothing to show yet: the first read of this key in this scope is on its way (the view draws its skeleton). */
  loading: boolean;
  /** A read is on its way (with or without something shown): `aria-busy`, never a dimmed page. */
  fetching: boolean;
  /** Reads again now; resolves when the answer (or the error) has come. */
  reload: () => Promise<void>;
  /** Replaces the shown and kept answer (a page appended by "Visa fler", an optimistic change). */
  mutate: (update: (current: T | undefined) => T) => void;
};

export function useWorkspaceData<T>(key: string | null, fetcher: (signal: AbortSignal) => Promise<T>, options: {
  /** Keep the answer for the previous key while the new one is read (a filter or a search on the same list). */
  keepPrevious?: boolean;
  /** Wait this long before reading (a search typed letter by letter); what is kept is shown at once anyway. */
  delayMs?: number;
  /**
   * How a new answer joins what is shown for the same key – a list with pages added by "Visa fler" keeps them when its
   * first page is read again (`keepLoadedPages`), so going back does not shorten the list under the scroll position.
   */
  merge?: (fresh: T, shown: T) => T;
} = {}): WorkspaceData<T> {
  const scope = useWorkspaceDataScope();
  const id = key === null ? null : `${scope ?? ""}\u0000${key}`;
  const { keepPrevious = false, delayMs = 0 } = options;
  const [state, setState] = useState<State<T>>(() => {
    const kept = key === null ? undefined : readWorkspaceCache<T>(scope, key);
    return { id, scope, data: kept?.value, dataId: kept ? id : null, error: "", fetching: false };
  });
  // A new key (or scope) is taken while rendering (React's "adjust state when a value changes"): the kept answer at once,
  // else the previous one when asked for and still the same person and company, else nothing.
  let shown = state;
  if (state.id !== id) {
    const kept = key === null ? undefined : readWorkspaceCache<T>(scope, key);
    const previous = keepPrevious && state.scope === scope && state.data !== undefined;
    shown = { id, scope, data: kept ? kept.value : previous ? state.data : undefined, dataId: kept ? id : previous ? state.dataId : null, error: "", fetching: false };
    setState(shown);
  }
  const latestFetcher = useRef(fetcher);
  const latestMerge = useRef(options.merge);
  useEffect(() => { latestFetcher.current = fetcher; latestMerge.current = options.merge; });
  const [version, setVersion] = useState(0);
  const forced = useRef(false);
  const waiting = useRef<(() => void)[]>([]);
  const settle = useCallback(() => { const done = waiting.current; waiting.current = []; for (const resolve of done) resolve(); }, []);
  useEffect(() => {
    if (key === null) { settle(); return; }
    const force = forced.current;
    forced.current = false;
    if (!force && !workspaceCacheNeedsRead(readWorkspaceCache(scope, key))) { settle(); return; }
    const abort = new AbortController();
    const timer = window.setTimeout(() => {
      setState((current) => current.id === id ? { ...current, fetching: true } : current);
      latestFetcher.current(abort.signal).then((value) => {
        if (abort.signal.aborted) return;
        setState((current) => {
          if (current.id !== id) return current;
          const merge = latestMerge.current;
          const data = merge && current.dataId === id && current.data !== undefined ? merge(value, current.data) : value;
          writeWorkspaceCache(scope, key, data);
          return { ...current, data, dataId: id, error: "", fetching: false };
        });
        settle();
      }, (issue: unknown) => {
        if (abort.signal.aborted) return;
        setState((current) => current.id === id ? { ...current, error: issue instanceof Error ? issue.message : "Det gick inte att läsa.", fetching: false } : current);
        settle();
      });
    }, delayMs);
    return () => { window.clearTimeout(timer); abort.abort(); };
  }, [id, key, scope, version, delayMs, settle]);
  // Another part of the page changed something this view shows (invalidateWorkspaceCache): read again.
  useEffect(() => subscribeWorkspaceCache((prefix) => {
    if (key !== null && (prefix === null || key.startsWith(prefix))) setVersion((value) => value + 1);
  }), [key]);
  const reload = useCallback(() => new Promise<void>((resolve) => {
    waiting.current.push(resolve);
    forced.current = true;
    setVersion((value) => value + 1);
  }), []);
  const mutate = useCallback((update: (current: T | undefined) => T) => {
    setState((current) => {
      if (current.id !== id) return current;
      const data = update(current.dataId === id ? current.data : undefined);
      if (key !== null) writeWorkspaceCache(scope, key, data);
      return { ...current, data, dataId: id };
    });
  }, [id, key, scope]);
  return { data: shown.data, error: shown.error, loading: shown.data === undefined && !shown.error && key !== null, fetching: shown.fetching, reload, mutate };
}

/**
 * A paged list read again from its first page (steg 7): the fresh first page, then the pages "Visa fler" had added that the
 * fresh page does not already hold, so the list keeps its length (and the scroll position its row) after Bakåt.
 */
export function keepLoadedPages<P extends { items: I[]; page: number }, I extends { id: string }>(fresh: P, shown: P): P {
  if (shown.items.length <= fresh.items.length) return fresh;
  const seen = new Set(fresh.items.map((item) => item.id));
  return { ...fresh, items: [...fresh.items, ...shown.items.slice(fresh.items.length).filter((item) => !seen.has(item.id))], page: Math.max(fresh.page, shown.page) };
}
