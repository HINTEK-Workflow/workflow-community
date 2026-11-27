"use client";

import { useEffect, useSyncExternalStore } from "react";
import { defaultDetailLevels, detailLevelFor, deviceClass, type DetailLevel } from "@/lib/workflow/detail-level";
import { nativeModeFor } from "@/lib/workflow/native-mode";

/**
 * Visningsnivå för en sida utan appens skal (operatörssidan, 2026-10-30). The page has no person and no saved
 * choices, so the level is the device's default (detailLevelFor: phone 1, tablet 2, computer 3 – the page keeps Lagom on a
 * tablet, which has no app view of its own here, when the app's tablet default became the app view 2026-11-23); `?niva=1|2|3` in the
 * address fixes it (a tablet at a machine, the screen tests). It sets the same `<html>` attributes as the shell –
 * `data-detail`, `data-native`, `data-device` and the 44 px controls at level 1 – so the shared parts behave as in the app.
 */
const STANDALONE_LEVELS = { ...defaultDetailLevels, tablet: 2 } as const;
const subscribe = (notify: () => void) => { window.addEventListener("resize", notify); return () => window.removeEventListener("resize", notify); };
const readWindow = () => `${window.innerWidth}x${window.innerHeight}x${window.matchMedia("(pointer: coarse)").matches ? 1 : 0}`;

export function useStandaloneLevel(fixed: string | null): DetailLevel {
  const size = useSyncExternalStore(subscribe, readWindow, () => "390x844x1");
  const [width, height, touch] = size.split("x").map(Number);
  const chosen = fixed === "1" || fixed === "2" || fixed === "3" ? Number(fixed) as DetailLevel : null;
  const level = chosen ?? detailLevelFor(STANDALONE_LEVELS, width, touch === 1, height);
  const native = nativeModeFor(level, width, deviceClass(width, touch === 1, height) === "phone");
  useEffect(() => {
    const root = document.documentElement;
    const before = { detail: root.dataset.detail, native: root.dataset.native, device: root.dataset.device };
    root.dataset.detail = String(level);
    if (native) root.dataset.native = "1"; else delete root.dataset.native;
    root.dataset.device = deviceClass(width, touch === 1, height);
    const controlBefore = root.style.getPropertyValue("--control-h");
    if (level === 1) root.style.setProperty("--control-h", "2.75rem"); else root.style.removeProperty("--control-h");
    return () => {
      if (controlBefore) root.style.setProperty("--control-h", controlBefore); else root.style.removeProperty("--control-h");
      for (const [key, value] of Object.entries(before)) { if (value === undefined) delete root.dataset[key]; else root.dataset[key] = value; }
    };
  }, [level, native, width, height, touch]);
  return level;
}
