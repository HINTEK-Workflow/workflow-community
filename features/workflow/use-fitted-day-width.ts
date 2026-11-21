"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { fittedDayWidth, type ScheduleZoom } from "@/lib/workflow/schedule";

/**
 * Pixels per day for a time line in `scroller` (2026-11-01: the plan stopped far from the card's right edge): the
 * scale's own width, wider when the days would not fill the room. Measured before the first paint and whenever the room
 * changes, so nothing moves on screen. Without room to fill the time line scrolls as before.
 */
export function useFittedDayWidth(scroller: RefObject<HTMLElement | null>, zoom: ScheduleZoom, days: number) {
  const [room, setRoom] = useState(0);
  const watched = useRef<{ element: HTMLElement; observer: ResizeObserver } | null>(null);
  // The time line may appear after the first draw (it waits for its data): looked for after every draw.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- on purpose after every draw; it stops at once while the same element is watched
  useLayoutEffect(() => {
    const element = scroller.current;
    if (watched.current?.element === element || (!element && !watched.current)) return;
    watched.current?.observer.disconnect();
    watched.current = null;
    if (!element) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- measured before the paint, so the first draw already fills the room
    setRoom(element.clientWidth);
    const observer = new ResizeObserver(() => setRoom(element.clientWidth));
    observer.observe(element);
    watched.current = { element, observer };
  });
  useLayoutEffect(() => () => { watched.current?.observer.disconnect(); watched.current = null; }, []);
  return fittedDayWidth(zoom, days, room);
}
