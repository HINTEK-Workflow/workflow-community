"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { EDGE_SWIPE } from "@/lib/workflow/native-nav";
import { PULL_REFRESH, pullDistance, pullRefreshes } from "@/lib/workflow/app-feel";

/**
 * Dra för att hämta nytt (appkänslan, beslutad 2026-11-23): in the installed app nothing else fetches what has changed since the
 * page was opened – a browser tab has the browser's own pull, so there this stays away. The finger pulls the page down from
 * its top; past the threshold the shell reads the page again (`onRefresh`). Never while something is being edited (`blocked`),
 * a sheet or a dialog is open, or the finger started in a field or on the edge that swipes back. Drawn by the shell, once.
 */
const SKIP = "[role=dialog], .native-sheet, .native-assistant, input, textarea, select, [contenteditable], .native-movable, [data-no-pull]";
/** The installed app (home screen, or the app's own window). */
function pullOffered(): boolean {
  if ((navigator as Navigator & { standalone?: boolean }).standalone) return true;
  return window.matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches;
}

export function PullRefresh({ onRefresh, blocked = false }: { onRefresh: () => Promise<void> | void; blocked?: boolean }) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const state = useRef({ blocked, busy, onRefresh });
  useEffect(() => { state.current = { blocked, busy, onRefresh }; });
  useEffect(() => {
    if (!pullOffered()) return;
    let startY: number | null = null;
    let dy = 0;
    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      const target = event.target;
      startY = null;
      dy = 0;
      if (!touch || event.touches.length !== 1 || state.current.blocked || state.current.busy) return;
      if (window.scrollY > 0 || touch.clientX < EDGE_SWIPE.edge || document.documentElement.hasAttribute("data-scroll-held")) return;
      if (target instanceof Element && target.closest(SKIP)) return;
      startY = touch.clientY;
    };
    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (startY === null || !touch) return;
      if (window.scrollY > 0) { startY = null; setPull(0); return; }
      dy = touch.clientY - startY;
      setPull(dy > 8 ? pullDistance(dy) : 0);
    };
    const onEnd = () => {
      if (startY === null) return;
      const go = pullRefreshes(dy);
      startY = null;
      dy = 0;
      if (!go) { setPull(0); return; }
      setBusy(true);
      setPull(PULL_REFRESH.threshold);
      // At least a moment, so the answer is seen even when the page was read at once.
      void Promise.all([Promise.resolve(state.current.onRefresh()), new Promise((done) => window.setTimeout(done, 600))]).finally(() => { setBusy(false); setPull(0); });
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => { window.removeEventListener("touchstart", onStart); window.removeEventListener("touchmove", onMove); window.removeEventListener("touchend", onEnd); window.removeEventListener("touchcancel", onEnd); };
  }, []);
  if (!pull && !busy) return null;
  const ready = pull >= PULL_REFRESH.threshold;
  return <div className="native-pull" data-busy={busy || undefined} data-ready={ready || undefined} style={{ transform: `translate3d(-50%, ${Math.round(pull)}px, 0)`, opacity: Math.min(1, pull / 40) }} role="status" data-testid="native-pull">
    <RefreshCw aria-hidden="true" style={busy ? undefined : { transform: `rotate(${Math.round(pull * 3)}deg)` }} />
    <span className="sr-only">{busy ? "Hämtar nytt…" : ready ? "Släpp för att hämta nytt" : "Dra för att hämta nytt"}</span>
  </div>;
}
