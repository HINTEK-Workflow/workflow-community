"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { defaultDetailLevels, detailLevelFor, deviceClass, type DetailLevel } from "@/lib/workflow/detail-level";
import { nativeModeFor } from "@/lib/workflow/native-mode";

/**
 * Visningsnivå in the proposals (2026-10-30). The proposal pages stand outside the app shell, so they set the same
 * `<html>` attributes the shell sets – `data-detail` (the level), `data-native` (the app look: level 1 in a phone-wide
 * window, nativeModeFor) and `data-device` – from the device's default level (detailLevelFor), or from the level chosen
 * with the switch (`?niva=1|2|3`). The shared parts (useNativeMode, NativeScreenFrame, Modal, [data-detail-min]) then
 * behave as in the app. Level 1 in a wider window is drawn in a column of the app column's width (560 px).
 */

const subscribe = (notify: () => void) => { window.addEventListener("resize", notify); return () => window.removeEventListener("resize", notify); };
const readWindow = () => `${window.innerWidth}x${window.innerHeight}x${window.matchMedia("(pointer: coarse)").matches ? 1 : 0}`;

export const ProposalLevelContext = createContext<DetailLevel>(3);
export const useProposalLevel = () => useContext(ProposalLevelContext);

export function useLevelState(initial: string | null) {
  const size = useSyncExternalStore(subscribe, readWindow, () => "1440x900x0");
  const [width, height, touch] = size.split("x").map(Number);
  const chosenStart = initial === "1" || initial === "2" || initial === "3" ? Number(initial) as DetailLevel : null;
  const [chosen, setChosen] = useState<DetailLevel | null>(chosenStart);
  const level = chosen ?? detailLevelFor(defaultDetailLevels, width, touch === 1, height);
  const native = nativeModeFor(level, width, deviceClass(width, touch === 1, height) === "phone");
  useEffect(() => {
    const root = document.documentElement;
    const before = { detail: root.dataset.detail, native: root.dataset.native, device: root.dataset.device };
    root.dataset.detail = String(level);
    if (native) root.dataset.native = "1"; else delete root.dataset.native;
    root.dataset.device = deviceClass(width, touch === 1, height);
    // Level 1 is the touch app: its controls are 44 px tall as on a touch screen (globals.css sets this for pointer: coarse).
    const controlBefore = root.style.getPropertyValue("--control-h");
    if (level === 1) root.style.setProperty("--control-h", "2.75rem"); else root.style.removeProperty("--control-h");
    return () => {
      if (controlBefore) root.style.setProperty("--control-h", controlBefore); else root.style.removeProperty("--control-h");
      for (const [key, value] of Object.entries(before)) { if (value === undefined) delete root.dataset[key]; else root.dataset[key] = value; }
    };
  }, [level, native, width, height, touch]);
  const choose = (next: DetailLevel) => {
    setChosen(next);
    const url = new URL(window.location.href);
    url.searchParams.set("niva", String(next));
    window.history.replaceState(window.history.state, "", url);
  };
  return { level, native, choose };
}

/** The proposal's own switch, in its bar (not part of the design being tried). */
export function LevelSwitch({ level, onChoose }: { level: DetailLevel; onChoose: (level: DetailLevel) => void }) {
  return <div role="radiogroup" aria-label="Visningsnivå" className="flex items-center gap-1" data-testid="level-switch">
    <span className="mr-1 text-xs text-muted-foreground">Visning</span>
    {([1, 2, 3] as const).map((item) => <button key={item} type="button" role="radio" aria-checked={level === item} onClick={() => onChoose(item)} data-testid={`level-${item}`}
      className={cn("touch-target inline-flex size-8 items-center justify-center rounded-full border text-xs font-semibold", level === item ? "border-primary/30 bg-secondary text-foreground" : "text-muted-foreground")}>{item}</button>)}
  </div>;
}

/** The content's width: level 1 is the app's column, levels 2–3 the page's width. */
export function LevelColumn({ level, wide = "max-w-[1600px]", children }: { level: DetailLevel; wide?: string; children: ReactNode }) {
  return <div className={cn("mx-auto w-full", level === 1 ? "max-w-[560px]" : wide)} data-level={level}>{children}</div>;
}
