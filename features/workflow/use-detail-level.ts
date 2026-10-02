"use client";

import { createContext, useSyncExternalStore } from "react";

// The display level now in force on this device (1–3). The app shell sets `data-detail` on <html> after the page has
// mounted, so it is read as an external store that follows that attribute; 3 until it is set.
const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!observer && typeof MutationObserver !== "undefined") {
    observer = new MutationObserver(() => listeners.forEach((notify) => notify()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-detail"] });
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { observer?.disconnect(); observer = null; }
  };
}
const read = (): 1 | 2 | 3 => { const value = Number(document.documentElement.dataset.detail); return value === 1 || value === 2 ? value : 3; };

export function useDetailLevel() {
  return useSyncExternalStore(subscribe, read, () => 3 as const);
}

/**
 * A page of one task (work order, protocol, risk assessment). On level 1 its panels start folded, except the one where
 * the current step is done (2026-10-02: levels 1 and 3 looked almost the same at the top of a control). Folded
 * panels keep their title and a button to open them; nothing is hidden for good.
 */
export const TaskPageFold = createContext(false);
