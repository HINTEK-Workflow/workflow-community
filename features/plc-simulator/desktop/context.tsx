"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import type { useConfirm } from "@/features/kfid/confirm";
import type { Runtime } from "../surface/use-runtime";
import type { Simulator } from "../use-simulator";
import type { Desk } from "./desk";

// PLC-simulatorn, skrivbordet: the three stores every panel reads, through context. A panel the dock has moved to a window of its
// own is still in this React tree (a portal), so it reads the same objects: nothing is copied between the windows and the source
// key never leaves the one closure that holds it.

export type Confirm = ReturnType<typeof useConfirm>[0];
export type Desktop = { simulator: Simulator; runtime: Runtime; desk: Desk; confirm: Confirm; upkeepOn: boolean; demo: boolean };

const DesktopContext = createContext<Desktop | null>(null);
export const DesktopProvider = DesktopContext.Provider;

export function useDesktop(): Desktop {
  const desktop = useContext(DesktopContext);
  if (!desktop) throw new Error("useDesktop is used outside the desktop.");
  return desktop;
}
export function useRuntimeSnapshot() {
  const { runtime } = useDesktop();
  return useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot);
}
export function useSimSnapshot() {
  const { simulator } = useDesktop();
  return useSyncExternalStore(simulator.subscribe, simulator.getSnapshot, simulator.getSnapshot);
}
export function useDeskState() {
  const { desk } = useDesktop();
  return useSyncExternalStore(desk.subscribe, desk.getSnapshot, desk.getSnapshot);
}

const MOBILE = "(max-width: 767px)";
const subscribeMobile = (listener: () => void) => { const media = window.matchMedia(MOBILE); media.addEventListener("change", listener); return () => media.removeEventListener("change", listener); };
/** Under 768 px: one column of tabs, no dock and no windows. The server's frame says desktop. */
export const usePhone = () => useSyncExternalStore(subscribeMobile, () => window.matchMedia(MOBILE).matches, () => false);
