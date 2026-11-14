"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useNativeMode } from "@/features/workflow/use-detail-level";
import { screenShown } from "@/lib/workflow/native-mode";

export const NativeLeadPanel = createContext(false);
/**
 * A page's screens drawn all at once, out of sight, as the text a search reads (Hjälp, svar 5 2026-10-24): every screen
 * with one key is drawn whatever the address says, marked `data-native-screen` with its key; [] (never at level 1) is left out.
 */
export const NativeScreenIndex = createContext(false);

/**
 * Nivå 1 på mobil (2026-10-09): a page with a menu of rows (a project, a customer card) keeps its own panels where
 * they are and wraps each one in `NativeScreen`. Outside the native look it draws its children as before (level 2–3, the
 * tablet and the computer are unchanged); at level 1 only on the screens it lists – the screen is `&step=` in the address,
 * "menu" is the page's menu and [] is never.
 */
export function NativeScreen({ show, lead = false, children }: { show: readonly string[]; /** At level 1 the screen's lead panel (its heading is the top bar's title, see NativeLead). */ lead?: boolean; children: ReactNode }) {
  const native = useNativeMode();
  const step = useSearchParams().get("step");
  const index = useContext(NativeScreenIndex);
  if (index) return !show.length ? null : show.length === 1 ? <div data-native-screen={show[0]}>{children}</div> : <>{children}</>;
  if (!screenShown(native, step, show)) return null;
  return native && lead && step ? <NativeLeadPanel.Provider value>{children}</NativeLeadPanel.Provider> : <>{children}</>;
}

/** The screen in the address while the native look is on; null on the page's menu and outside the native look. */
export function useNativeScreen(): { native: boolean; step: string | null } {
  const native = useNativeMode();
  const step = useSearchParams().get("step");
  return { native, step: native ? step : null };
}

/**
 * The lead panel of a screen (Nivå 1 på mobil, 2026-10-09: no double titles): the top bar already names the screen,
 * so a Panel inside `NativeLead` keeps its heading for screen readers only (its description, buttons and fields stay).
 * Pages wrap only the screen's main panel; any other panel on the screen keeps its heading as a small group heading.
 */
export function NativeLead({ children }: { children: ReactNode }) {
  return <NativeLeadPanel.Provider value>{children}</NativeLeadPanel.Provider>;
}

/**
 * Around a page whose own panels are its screens (Hjälp, Mina inställningar): at level 1 on a phone those panels read as
 * the phone's grouped lists (`.native-screen` in app/globals.css: no light-blue header row, no card frame, one scroll);
 * elsewhere it draws nothing of its own, so level 2–3, the tablet and the computer are unchanged.
 */
export function NativeScreenFrame({ children }: { children: ReactNode }) {
  const native = useNativeMode();
  return native ? <div className="native-screen">{children}</div> : <>{children}</>;
}
