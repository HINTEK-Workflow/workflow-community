/**
 * Arbetsytans minnescache (stabil sidladdning steg 7, 2026-10-22/23, beslut 4): the latest answer of a view's read,
 * kept only in this tab's memory so that going back to a list shows it at once (and the scroll position finds its place)
 * while it is read again. Never in localStorage, sessionStorage, IndexedDB or the service worker.
 *
 * Strictly per company and person: every entry belongs to one scope – the person, the active company, Visa som and the
 * person's role and permissions (`workspaceCacheScope`). Only one scope lives in memory at a time; entering another one
 * (a company switch, Visa som on or off, changed permissions, another person in the same tab) empties the cache first, and
 * an answer that arrives for an old scope is thrown away. Sign-out empties it too (features/auth/sign-out.ts). On the
 * server nothing is ever kept: the module is shared by every request there.
 */

export type WorkspaceCacheIdentity = {
  id?: string | null;
  organizationId?: string | null;
  viewAs?: string | null;
  role?: string | null;
  memberRole?: string | null;
  workflowPermissions?: unknown;
};

type Entry = { value: unknown; at: number; stale: boolean };
type Listener = (key: string | null) => void;

/** At most this many answers are kept; the oldest goes first. A list page with a few filters fits many times over. */
export const WORKSPACE_CACHE_LIMIT = 40;
/** An answer younger than this is not read again when the same view mounts once more (a quick back and forth). */
export const WORKSPACE_CACHE_FRESH_MS = 2_000;

const entries = new Map<string, Entry>();
const listeners = new Set<Listener>();
let activeScope: string | null = null;
// Sealed on the way out of the tab's person or company (sign-out, a company switch): nothing is kept again until the page
// has loaded anew, so an answer read in between can never be kept under the scope that is leaving.
let sealed = false;

/** Whether this runtime may keep anything: only a browser tab, never the server (shared between people). */
function enabled() {
  return typeof window !== "undefined";
}

/** The scope of one person in one company, as one string (stable for the same identity, different for any change). */
export function workspaceCacheScope(identity: WorkspaceCacheIdentity | null | undefined): string | null {
  if (!identity?.id) return null;
  return JSON.stringify([identity.id, identity.organizationId ?? "", identity.viewAs ?? "", identity.role ?? "", identity.memberRole ?? "", identity.workflowPermissions ?? null]);
}

/**
 * The scope that is shown now. A different scope than the one before empties the cache first, so nothing read for one
 * company or person is ever kept beside another's. Safe to call on every render (it only acts on a change).
 */
export function enterWorkspaceCacheScope(scope: string | null) {
  if (sealed || scope === activeScope) return;
  entries.clear();
  activeScope = scope;
  // No one is told: this runs while the workspace renders, and every view's key carries the scope, so they follow by themselves.
}

/** The scope in force (for tests and the hook). */
export function currentWorkspaceCacheScope() {
  return activeScope;
}

function notify(key: string | null) {
  for (const listener of [...listeners]) listener(key);
}

/** The kept answer for `key` in `scope`, or undefined (another scope, nothing kept, or on the server). */
export function readWorkspaceCache<T>(scope: string | null, key: string): { value: T; at: number; stale: boolean } | undefined {
  if (!enabled() || sealed || !scope || scope !== activeScope) return undefined;
  const entry = entries.get(key);
  return entry ? { value: entry.value as T, at: entry.at, stale: entry.stale } : undefined;
}

/** Keeps an answer, unless it belongs to a scope that is no longer shown (a late answer from before a switch). */
export function writeWorkspaceCache(scope: string | null, key: string, value: unknown, now = Date.now()) {
  if (!enabled() || sealed || !scope || scope !== activeScope) return false;
  entries.delete(key);
  entries.set(key, { value, at: now, stale: false });
  while (entries.size > WORKSPACE_CACHE_LIMIT) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
  return true;
}

/** Whether an answer must be read again: nothing kept, marked stale, or older than the fresh window. */
export function workspaceCacheNeedsRead(entry: { at: number; stale: boolean } | undefined, now = Date.now()) {
  return !entry || entry.stale || now - entry.at >= WORKSPACE_CACHE_FRESH_MS;
}

/**
 * After a change (Spara, Ta bort …): the answers whose key starts with `prefix` (all without one) are marked stale – still
 * shown while they are read again – and the views that show them read them again now.
 */
export function invalidateWorkspaceCache(prefix?: string) {
  for (const [key, entry] of entries) if (!prefix || key.startsWith(prefix)) entry.stale = true;
  notify(prefix ?? null);
}

/**
 * Empties the cache altogether (sign-out, a company switch, Visa som). Nothing is read again: the page is on its way to
 * the login or to another company, whose scope starts empty.
 */
export function clearWorkspaceCache() {
  entries.clear();
  activeScope = null;
}

// Whether something was changed since the overview was last read (any request through api() that is not a read).
let changedSinceOverview = false;

/**
 * Something was changed (a save, a removal …, features/kfid/api.ts calls this after every successful request that is not a
 * read): every kept answer is marked stale, so the next view that shows it reads it again, and the next page change reads
 * the overview again once (steg 8b: a page change without a change reads nothing).
 */
export function noteWorkspaceChange() {
  changedSinceOverview = true;
  for (const entry of entries.values()) entry.stale = true;
}

/** Whether there was a change since the last call (the workspace asks before it reads the overview). */
export function takeWorkspaceChange() {
  const changed = changedSinceOverview;
  changedSinceOverview = false;
  return changed;
}

/** Empties the cache and keeps it empty until the page loads again (sign-out, a company switch). */
export function sealWorkspaceCache() {
  entries.clear();
  activeScope = null;
  sealed = true;
}

/** Back to a fresh page's state (tests only). */
export function resetWorkspaceCacheForTests() {
  entries.clear();
  activeScope = null;
  sealed = false;
  changedSinceOverview = false;
}

/** Tells `listener` about an invalidation: the prefix, or null for everything. */
export function subscribeWorkspaceCache(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The number of kept answers (tests). */
export function workspaceCacheSize() {
  return entries.size;
}
