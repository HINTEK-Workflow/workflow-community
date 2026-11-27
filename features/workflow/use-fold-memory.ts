"use client";

import { createContext, createElement, useCallback, useContext, useSyncExternalStore, type ReactNode } from "react";
import { readFolds, writeFold, type RememberedFolds } from "@/lib/workflow/fold-memory";

/**
 * The fold memory as a hook (the rules: lib/workflow/fold-memory.ts). The shell names the signed-in person. A card drawn after
 * the page has started (every list here, since their content is read after the first frame) has the remembered state in its
 * first render, so nothing jumps; on the server and in a hydrating render nothing is known, the same as the server's HTML.
 */
const FoldOwnerContext = createContext<string | null>(null);
export function FoldOwnerProvider({ ownerId, children }: { ownerId: string | null | undefined; children: ReactNode }) {
  return createElement(FoldOwnerContext.Provider, { value: ownerId ?? null }, children);
}

const browserStorage = () => { try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; } };
const listeners = new Set<() => void>();
// One parsed copy per person, so reading is cheap and a refused storage still remembers until the page is left.
const cache = new Map<string, RememberedFolds>();
const foldsOf = (ownerId: string) => {
  const known = cache.get(ownerId);
  if (known) return known;
  const read = readFolds(browserStorage(), ownerId);
  cache.set(ownerId, read);
  return read;
};
// Another tab of the same browser changed a fold: read again, and draw it here too.
const onStorage = () => { cache.clear(); listeners.forEach((notify) => notify()); };
function subscribe(listener: () => void) {
  if (!listeners.size && typeof window !== "undefined") window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}
const nothingOnServer = () => null;

/** The person's remembered state of this fold (null: none) and the way to keep a new one. Without a key or a person, nothing. */
export function useFoldMemory(foldKey: string | undefined) {
  const ownerId = useContext(FoldOwnerContext);
  const snapshot = useCallback(() => (foldKey && ownerId ? foldsOf(ownerId)[foldKey] ?? null : null), [foldKey, ownerId]);
  const remembered = useSyncExternalStore(subscribe, snapshot, nothingOnServer);
  const remember = useCallback((collapsed: boolean) => {
    if (!foldKey || !ownerId) return;
    cache.set(ownerId, writeFold(browserStorage(), ownerId, foldKey, collapsed));
    listeners.forEach((notify) => notify());
  }, [foldKey, ownerId]);
  return { remembered, remember };
}
