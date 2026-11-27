"use client";

import { createContext, createElement, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { appColumnDevice, deviceClass, type DeviceClass } from "@/lib/workflow/detail-level";
import { NO_FIRST_FRAME, type FirstFrame } from "@/lib/workflow/first-frame";
import { nativeReduced, showMoreNote } from "@/lib/workflow/show-more";

// The content level now in force on this device (1–3): what is left out. The server writes `data-detail` on <html> for
// its guess of the device (Telefonens första bild, lib/workflow/first-frame.ts) and the app shell sets it after the page
// has mounted, so it is read as an external store that follows that attribute; 3 while it is not set. `data-native`
// beside it is the layout – the app look (Nivå 1 på mobil, lib/workflow/native-mode.ts). On a phone the layout is always the
// app and Visa mer raises only the content level (A2, lib/workflow/detail-level.ts displayLevelsFor), so a part that
// decides its layout reads useNativeMode, never this level.
const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!observer && typeof MutationObserver !== "undefined") {
    observer = new MutationObserver(() => listeners.forEach((notify) => notify()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-detail", "data-native", "data-device", "data-form"] });
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { observer?.disconnect(); observer = null; }
  };
}
/**
 * The server's first frame (app/layout.tsx): what the hooks below answer on the server and in the hydrating render, the
 * same values the server wrote on <html>. After hydration they read the attributes, which the shell corrects.
 */
const FirstFrameContext = createContext<FirstFrame>(NO_FIRST_FRAME);
export function FirstFrameProvider({ value, children }: { value: FirstFrame; children: ReactNode }) {
  return createElement(FirstFrameContext.Provider, { value }, children);
}
/** The server's first frame, for a part that starts its own state from it (the shell's app column). */
export const useFirstFrame = () => useContext(FirstFrameContext);

const read = (): 1 | 2 | 3 => { const value = Number(document.documentElement.dataset.detail); return value === 1 || value === 2 ? value : 3; };

export function useDetailLevel() {
  const first = useContext(FirstFrameContext).detail ?? 3;
  return useSyncExternalStore(subscribe, read, () => first);
}

const readNative = () => document.documentElement.dataset.native === "1";
/**
 * Nivå 1 på mobil (2026-10-09): true while the app look is in force – always on a signed-in phone since A2
 * (2026-10-22), and in the app column's frame – where the pages draw their native look (components/native/). The shell
 * decides it (nativeModeFor, from the layout level) and sets `data-native`.
 * Display only; on the server and in the hydrating render the server's first frame (false when it did not know).
 */
export function useNativeMode() {
  const first = useContext(FirstFrameContext).native;
  return useSyncExternalStore(subscribe, readNative, () => first);
}

/**
 * Appkänsla 2026-11-22 (prototyp): the app view's form – "tablet" while the app fills a tablet's window (a rail at the side,
 * a pane beside the lists), "pane" inside that pane's frame, null on a phone and in the app column. The shell decides it
 * (`data-form`). False/null on the server and until the shell has decided.
 */
const readForm = (): "tablet" | "pane" | null => { const value = document.documentElement.dataset.form; return value === "tablet" || value === "pane" ? value : null; };
export function useAppForm() {
  return useSyncExternalStore(subscribe, readForm, () => null);
}

/**
 * Inget blir onåbart (A2, lib/workflow/show-more.ts nativeReduced): true while the app draws its slimmer variant of a part –
 * the app look at content level 1. On a phone Visa mer (or Visa allt) makes it false, and the part is drawn as the ordinary
 * one, or with the row that leads on. A part that leaves out a function in the app chooses with this, not useNativeMode.
 */
export function useNativeReduced() {
  return nativeReduced(useNativeMode(), useDetailLevel());
}

// The device the shell names (`data-device`: the phone, or in the app column's frame the device the person sits at).
const readDevicePhone = () => document.documentElement.dataset.device === "phone";
/**
 * The line under an app screen that leaves something out: on a phone the shared "Fler val under Visa mer längst ned."; in
 * the app column of a tablet or a computer `columnText` (display 2 can be chosen there). Draw a ShowMoreMarker with it so
 * the page's Visa mer button is shown.
 */
export function useShowMoreNote(columnText: string) {
  const first = useContext(FirstFrameContext).device === "phone";
  return showMoreNote(useSyncExternalStore(subscribe, readDevicePhone, () => first), columnText);
}

/**
 * A page of one task (work order, protocol, risk assessment). On levels 1 and 2 its panels start folded, except the one
 * where the current step is done (2026-10-02 for level 1; level 2, the phone's default, since 2026-10-08). Folded
 * panels keep their title and a button to open them; nothing is hidden for good. The job and safety (description,
 * place, fault, the customer's requirements, risk class, priority, due date) stay outside the panels at every level.
 */
export const TaskPageFold = createContext(false);

/** Whether a task page folds its panels at this level (1 and 2; 3 shows everything). */
export const foldsTaskPanels = (level: 1 | 2 | 3) => level < 3;

/**
 * Whether this window is a phone (`deviceClass`: narrower than 768 px, or a touch screen whose short side is under 600 px, so
 * a phone on its side counts too). Read from the window at once, so a part that is drawn after the page has loaded never
 * shows the wrong layout for a frame, as `useCurrentDevice` (which starts as "phone") would. On the server the first
 * frame's guess of this window (false when not known).
 */
const subscribeWindow = (listener: () => void) => {
  window.addEventListener("resize", listener);
  window.addEventListener("orientationchange", listener);
  return () => { window.removeEventListener("resize", listener); window.removeEventListener("orientationchange", listener); };
};
const readPhone = () => deviceClass(window.innerWidth, window.matchMedia("(pointer: coarse)").matches, window.innerHeight) === "phone";
export function useIsPhone() {
  const first = useContext(FirstFrameContext).windowDevice === "phone";
  return useSyncExternalStore(subscribeWindow, readPhone, () => first);
}

/**
 * Whether a long document (Egenkontrollens program, read and edit, 2026-10-18) folds its parts into rows: on a phone and on a tablet
 * (`deviceClass` is not "desktop"), where it was 15 000–28 000 px tall. A computer reads and edits it open, as before. Read from the
 * window at once, like `useIsPhone`; on the server the first frame's guess (false when not known).
 */
const readFolds = () => deviceClass(window.innerWidth, window.matchMedia("(pointer: coarse)").matches, window.innerHeight) !== "desktop";
export function useFoldsDocument() {
  const known = useContext(FirstFrameContext).windowDevice;
  const first = known !== null && known !== "desktop";
  return useSyncExternalStore(subscribeWindow, readFolds, () => first);
}

/**
 * The device the person sits at (plan 1P): from the window's width and touch, or – inside the app column's frame, whose
 * own width says "phone" – the device the column stands on. "phone" until the window is known (the first render).
 */
export function useCurrentDevice(): DeviceClass {
  const [device, setDevice] = useState<DeviceClass>("phone");
  useEffect(() => {
    const read = () => setDevice((window.parent !== window ? appColumnDevice(window.name) : null) ?? deviceClass(window.innerWidth, window.matchMedia("(pointer: coarse)").matches, window.innerHeight));
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  return device;
}
