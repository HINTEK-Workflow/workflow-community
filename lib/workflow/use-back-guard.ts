"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The browser's and the phone's own Bakåt (a back gesture, the back key, history.back) for a view with unsaved changes
 * (QA 2026-10-10: the fakturaunderlag's view was closed and its changes lost without a question). The app's own ways out –
 * links, breadcrumbs, Hem, the floating Bakåt – already ask through the leave guard (lib/workflow/leave-guard.ts); a
 * browser step back cannot be stopped once it has happened, so while `active` the view keeps one extra history entry
 * at the same address. A step back then only leaves that entry: the page stays, `ask` gets the question, and the view
 * is kept (the entry is put back) or `onLeave` closes it without saving. When the changes are saved or the view is
 * closed some other way, the extra entry is taken away again. `skip` says that the view is already being closed (the
 * app's Bakåt asked first): the step back then simply goes on to the page before.
 *
 * Returns `release` (2026-10-13): a save that moves to another address (Skapa → the new job) first steps off the extra
 * entry and waits for it, so the new address takes the form's own entry and Bakåt never leads to the filled-in form. The
 * guard never steps back from an address other than the one it kept (a save that was quicker than the step back).
 *
 * A page opened on top (DialogPage, `page=` in the address – e.g. Lägg till artiklar, 2026-10-16) has history steps of its
 * own. A guard that became active while such a page was open would put its entry on top of the page's and take the page's
 * own closing step for the person's Bakåt. So the guard waits until the address is back on its own page (`page`: the
 * page value it belongs to – by default the one when it was first drawn; false = it belongs to the page on top itself).
 */
const MARK = "__wfUnsavedView";
/** The person stands on a guard's extra entry: its one step back is the guard's to follow. */
export const onBackGuardEntry = () => typeof window !== "undefined" && Boolean((window.history.state as Record<string, unknown> | null)?.[MARK]);

export function useBrowserBackGuard(active: boolean, options: { ask: () => Promise<boolean>; onLeave: () => void; skip?: () => boolean; page?: string | null | false }) {
  const latest = useRef(options);
  const [drawnPage] = useState(() => (typeof window === "undefined" ? null : new URL(window.location.href).searchParams.get("page")));
  const ownPage = options.page === undefined ? drawnPage : options.page;
  const [waited, setWaited] = useState(0);
  useEffect(() => { latest.current = options; });
  // One mark per view: a quick change back and forth never mistakes the view's own earlier entry for a step back.
  const token = useRef("");
  const releaseRef = useRef<() => Promise<void>>(() => Promise.resolve());
  // The step off the extra entry waits a moment: React may mount the view again at once (development's double effects,
  // a quick re-render), and the guard that comes back keeps the same entry instead of losing it to a late step back.
  const pendingBack = useRef<number | null>(null);
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    // A page opened on top is still open (or still taking its steps back): wait, then take the guard's entry.
    if (ownPage !== false && new URL(window.location.href).searchParams.get("page") !== ownPage) {
      const timer = window.setInterval(() => { if (new URL(window.location.href).searchParams.get("page") === ownPage) { window.clearInterval(timer); setWaited((count) => count + 1); } }, 100);
      return () => window.clearInterval(timer);
    }
    // Mounted again at once: the entry is still there, so the step off it is not taken.
    if (pendingBack.current !== null) { window.clearTimeout(pendingBack.current); pendingBack.current = null; }
    if (!token.current) token.current = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    const mark = token.current;
    const onOwnEntry = () => (window.history.state as Record<string, unknown> | null)?.[MARK] === mark;
    let kept = window.location.href;
    const keep = () => { kept = window.location.href; window.history.pushState({ [MARK]: mark }, ""); };
    if (!onOwnEntry()) keep();
    let armed = true;
    const onPop = () => {
      if (!armed || onOwnEntry()) return;
      armed = false;
      if (latest.current.skip?.()) { window.history.back(); return; }
      void latest.current.ask().then((leave) => {
        if (leave) latest.current.onLeave();
        else { keep(); armed = true; }
      });
    };
    window.addEventListener("popstate", onPop);
    /** Off the extra entry before a save moves on; resolves once the step back has happened (or at once without one). */
    releaseRef.current = () => new Promise<void>((resolve) => {
      if (!armed || !onOwnEntry() || window.location.href !== kept) { resolve(); return; }
      armed = false;
      let done = false;
      const finish = () => { if (done) return; done = true; window.removeEventListener("popstate", finish); resolve(); };
      window.addEventListener("popstate", finish);
      window.setTimeout(finish, 800);
      window.history.back();
    });
    return () => {
      window.removeEventListener("popstate", onPop);
      releaseRef.current = () => Promise.resolve();
      if (!armed || !onOwnEntry()) return;
      // Still the kept address: step off the extra entry. Another address took it over (a save quicker than the step
      // back): stay, and only take the mark away so it is an ordinary entry.
      if (window.location.href === kept) pendingBack.current = window.setTimeout(() => { pendingBack.current = null; if (onOwnEntry() && window.location.href === kept) window.history.back(); }, 0);
      else { const { [MARK]: _mark, ...rest } = (window.history.state ?? {}) as Record<string, unknown>; void _mark; window.history.replaceState(rest, ""); }
    };
  }, [active, waited, ownPage]);
  return useCallback(() => releaseRef.current(), []);
}
