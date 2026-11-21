import { signOut } from "next-auth/react";
import { sealWorkspaceCache } from "@/lib/workflow/workspace-cache";

/** The key prefix of the recent searches on this device, one per person (features/kfid/global-search.tsx). */
export const RECENT_SEARCH_PREFIX = "workflow.search.recent.";

/**
 * Forgets every person's recent searches on this device (2026-10-23, småfixar): what someone searched for and
 * opened is not left for the next person who signs in on a shared phone or computer. Storage blocked: nothing to do.
 */
export function forgetRecentSearches(storage?: Pick<Storage, "length" | "key" | "removeItem">) {
  try {
    const store = storage ?? window.localStorage;
    for (let index = store.length - 1; index >= 0; index -= 1) {
      const key = store.key(index);
      if (key?.startsWith(RECENT_SEARCH_PREFIX)) store.removeItem(key);
    }
  } catch { /* storage blocked */ }
}

/**
 * Every way out of the app signs out through here (tests/sign-out-paths.test.ts), so the local traces go with it – the
 * recent searches and what the tab keeps in memory (stabil sidladdning steg 7).
 */
export function signOutAndForget(options?: Parameters<typeof signOut>[0]) {
  forgetRecentSearches();
  sealWorkspaceCache();
  return signOut(options);
}
