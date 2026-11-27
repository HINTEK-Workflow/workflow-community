/**
 * Unsaved form values that survive a trip to another page and back (plan 1O, 2026-10-11: "tillbaka till formuläret
 * med vald post, utan att något osparat går förlorat"). A form that can be left for a register page – Ny kund from a
 * project's customer field on a tablet – registers a snapshot function; the link that leaves saves every registered
 * snapshot under the address of the form, and the form reads it back when it is drawn again at that address. The values
 * live in sessionStorage of this tab only and are dropped when read and used. Browser-only; no React.
 */
import { withoutPicks } from "./return-link";

const PREFIX = "workflow.return-draft:";
const getters = new Map<string, () => unknown>();

/** The address of the page with the markers a return adds (pickCustomer, pickTask …) left out, so both sides compute the same key. */
export function draftAddress(href: string): string {
  return withoutPicks(href);
}

const storageKey = (address: string, name: string) => `${PREFIX}${draftAddress(address)}:${name}`;
const here = () => `${location.pathname}${location.search}`;

/** Registers what a form would save when the person leaves; returns the unregister function. */
export function registerReturnDraft(name: string, snapshot: () => unknown): () => void {
  getters.set(name, snapshot);
  return () => { if (getters.get(name) === snapshot) getters.delete(name); };
}

/** Saves every registered form's values for `address` (the page the person will come back to). */
export function saveReturnDrafts(address: string = here()): void {
  for (const [name, snapshot] of getters) {
    try { sessionStorage.setItem(storageKey(address, name), JSON.stringify(snapshot())); } catch { /* storage blocked: the form just starts over */ }
  }
}

/** Reads the values saved for this form at this address, if any (does not remove them: see clearReturnDraft). */
export function readReturnDraft<T>(name: string, address: string = here()): T | null {
  try {
    const text = sessionStorage.getItem(storageKey(address, name));
    return text ? JSON.parse(text) as T : null;
  } catch { return null; }
}

export function clearReturnDraft(name: string, address: string = here()): void {
  try { sessionStorage.removeItem(storageKey(address, name)); } catch { /* nothing to clear */ }
}
