"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Bell } from "lucide-react";

/** The last count this tab has shown, so a reload does not ring for what the person has already seen. */
const SEEN_KEY = "hwf-bell-seen";
const readSeen = () => { try { return Number(window.sessionStorage.getItem(SEEN_KEY)) || 0; } catch { return 0; } };
const saveSeen = (count: number) => { try { window.sessionStorage.setItem(SEEN_KEY, String(count)); } catch { /* it may ring again after a reload */ } };

/** Goes up each time the count rises: the number is the key that restarts the animation of the bell and its figure. */
export function useBellRing(count: number | null | undefined) {
  const [ring, setRing] = useState(0);
  useEffect(() => {
    if (count === undefined || count === null) return;
    if (count > readSeen()) setRing((value) => value + 1); // eslint-disable-line react-hooks/set-state-in-effect -- the count comes from the feed outside React
    saveSeen(count);
  }, [count]);
  return ring;
}

/**
 * Notisklockan (2026-11-05: "lite animerad så man ser tydligt att något nytt har hänt"). When the count rises the bell swings a
 * few times and the figure bounces, then both stand still with the figure left. Only transforms, so nothing moves on the page, and only
 * without prefers-reduced-motion (app/globals.css).
 */
export function NotificationBell({ ring }: { ring: number }) {
  return <Bell key={ring} className={ring ? "notification-bell-ring size-5" : "size-5"} data-testid="notification-bell" data-ring={ring} />;
}

export function NotificationBadge({ ring, children }: { ring: number; children: ReactNode }) {
  return <span key={ring} data-testid="notification-count" aria-hidden="true" className={`absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-[#b91c1c] px-1.5 text-center text-[0.6875rem] font-bold leading-5 tabular-nums text-white ring-2 ring-card ${ring ? "notification-count-pop" : ""}`}>
    {children}
  </span>;
}
