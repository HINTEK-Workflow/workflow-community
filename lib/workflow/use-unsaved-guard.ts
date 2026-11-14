"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { leaveWithoutAsking, leavingWithoutAsking, registerLeaveGuard } from "./leave-guard";
import { useBrowserBackGuard } from "./use-back-guard";
import { DISCARD_QUESTION, type DiscardQuestion } from "./discard-question";

type Ask = (options: DiscardQuestion) => Promise<boolean>;

// Unsaved work is never lost silently (2026-10-02, the day simulation): the browser asks when the tab is closed or
// reloaded, and an in-app link is stopped, asked about with the in-app card and then followed.
// With `flush` (an editor that autosaves, 2026-10-05) a link saves first and is followed without a question;
// only a save that fails asks. Closing the tab needs no question then: the browser draft brings the change back.
// Since 2026-10-09 the same answer is given to the back and forward buttons and Hem (lib/workflow/leave-guard.ts).
// `browserBack` (2026-10-13): the browser's and the phone's own Bakåt asks too (lib/workflow/use-back-guard.ts) – for a
// form that does not autosave; an autosaving editor saves instead. The returned function steps off the browser-back
// entry before a save that moves on (call it, await it, then save).
// Every way out asks the same question as Avbryt, "Kasta ändringarna?" with Kasta / Fortsätt redigera (2026-10-14;
// replaces "Lämna <what>? / Lämna utan att spara", which the phone's Bakåt showed next to Avbryt's question).
export function useUnsavedGuard(active: boolean, ask: Ask, flush?: () => Promise<boolean>, options: { browserBack?: boolean } = {}) {
  const router = useRouter();
  const flushRef = useRef(flush);
  useEffect(() => { flushRef.current = flush; });
  const canFlush = Boolean(flush);
  const askLeave = () => ask(DISCARD_QUESTION);
  const askRef = useRef(askLeave);
  useEffect(() => { askRef.current = askLeave; });
  useEffect(() => {
    if (!active) return;
    /** Saved (or the person chose to leave without saving): the way out is free. */
    const mayLeave = async () => {
      if (leavingWithoutAsking()) return true;
      const save = flushRef.current;
      if (save) { try { if (await save()) return true; } catch { /* asked below */ } }
      // Answered once: the browser step that follows (past the entry the back guard keeps) does not ask again.
      const leave = await askRef.current();
      if (leave) leaveWithoutAsking();
      return leave;
    };
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    const navigate = (event: MouseEvent) => {
      const anchor = (event.target as Element).closest("a");
      // A link to a place on this very page (#anchor: Egenkontrollens innehållslista, 2026-10-18) leaves nothing behind and is no way out.
      if (anchor && anchor.hash && anchor.origin === location.origin && anchor.pathname === location.pathname && anchor.search === location.search) return;
      // A link that only opens a choice on this same page (data-stays-on-page: Koppla till arbetsorder) keeps what is written.
      if (anchor?.hasAttribute("data-stays-on-page")) return;
      if (anchor && anchor.origin === location.origin && anchor.href !== location.href && !anchor.hasAttribute("download") && anchor.target !== "_blank") {
        event.preventDefault();
        event.stopPropagation();
        const href = anchor.href;
        void mayLeave().then((ok) => { if (ok) router.push(href.slice(location.origin.length)); });
      }
    };
    if (!canFlush) window.addEventListener("beforeunload", handler);
    document.addEventListener("click", navigate, true);
    const unregister = registerLeaveGuard(mayLeave);
    return () => {
      window.removeEventListener("beforeunload", handler);
      document.removeEventListener("click", navigate, true);
      unregister();
    };
  }, [active, router, canFlush]);
  return useBrowserBackGuard(active && Boolean(options.browserBack) && !canFlush, {
    ask: () => askRef.current(),
    // Leaving: the step back the person asked for, past the entry the guard kept.
    onLeave: () => { if (!leavingWithoutAsking()) window.history.back(); },
    skip: leavingWithoutAsking,
  });
}
