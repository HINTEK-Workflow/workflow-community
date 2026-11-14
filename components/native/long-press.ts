"use client";
// The long press of Hem and the tab bar (2026-10-21, UX-granskningen A1), in a file of its own (U1/T2, 2026-10-23):
// the edit mode's drag and drop (components/native/home-edit.tsx) loads only when Hem is edited.
import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from "react";
import { LONG_PRESS_MS, LONG_PRESS_SLOP } from "@/lib/workflow/native-layout";

/**
 * A long press without moving: `onLong` after LONG_PRESS_MS unless the finger moved more than LONG_PRESS_SLOP pixels
 * (then it is a scroll) or let go. The click that ends a long press is swallowed, so a held tile does not also open.
 */
export function useLongPress(onLong: () => void, enabled = true) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const callback = useRef(onLong);
  useEffect(() => { callback.current = onLong; });
  const clear = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = null; start.current = null; }, []);
  useEffect(() => clear, [clear]);
  const onPointerDown = useCallback((event: ReactPointerEvent) => {
    if (!enabled || (event.pointerType === "mouse" && event.button !== 0)) return;
    fired.current = false;
    start.current = { x: event.clientX, y: event.clientY };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; fired.current = true; callback.current(); }, LONG_PRESS_MS);
  }, [enabled]);
  const onPointerMove = useCallback((event: ReactPointerEvent) => {
    if (!start.current) return;
    if (Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > LONG_PRESS_SLOP) clear();
  }, [clear]);
  const onClickCapture = useCallback((event: ReactMouseEvent) => {
    if (!fired.current) return;
    fired.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);
  // The phone's own menu for a held link (open in a new tab, share) would cover the edit mode.
  const onContextMenu = useCallback((event: ReactMouseEvent) => { if (enabled) event.preventDefault(); }, [enabled]);
  return { onPointerDown, onPointerMove, onPointerUp: clear, onPointerCancel: clear, onPointerLeave: clear, onClickCapture, onContextMenu };
}
