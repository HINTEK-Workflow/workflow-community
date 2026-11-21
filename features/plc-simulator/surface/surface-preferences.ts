"use client";

import { useSyncExternalStore } from "react";
import { holdsKeyForm } from "@/lib/machine/simulator/mask";

// PLC-simulatorn (ritverktyget, 2026-11-03): the surface's small preferences, remembered on this device –
// the wires' style (Mjuka/Raka), the palette's fold, the last view and the sound on or off (2026-11-07). The only place beside the two runtimes that writes
// to the browser's store (tests/plc-simulator-page.test.ts): four fixed keys, short plain values, never anything shaped like
// a key, read as an external store so the server's frame shows the default and the client takes the remembered value.

const KEYS = {
  wireStyle: "workflow-plc-simulator-wire-style-v1",
  palette: "workflow-plc-simulator-palette-v1",
  view: "workflow-plc-simulator-view-v2",
  sound: "workflow-plc-simulator-sound-v1",
} as const;
export type PreferenceKey = keyof typeof KEYS;
/** A value is a word or a few numbers: nothing longer or stranger is ever written. */
const PLAIN = /^[A-Za-z0-9.,:-]{1,80}$/;

const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function readPreference(key: PreferenceKey): string | null {
  try { const value = window.localStorage.getItem(KEYS[key]); return value !== null && PLAIN.test(value) ? value : null; } catch { return null; }
}

export function writePreference(key: PreferenceKey, value: string) {
  if (!PLAIN.test(value) || holdsKeyForm(value)) return;
  try { window.localStorage.setItem(KEYS[key], value); } catch { /* Not remembered, nothing more. */ }
  for (const listener of listeners) listener();
}

/** A remembered choice among fixed words, with its setter. */
export function usePreference<T extends string>(key: PreferenceKey, fallback: T, valid: readonly T[]): [T, (value: T) => void] {
  const value = useSyncExternalStore(subscribe, () => { const stored = readPreference(key); return stored && (valid as readonly string[]).includes(stored) ? (stored as T) : fallback; }, () => fallback);
  return [value, (next: T) => writePreference(key, next)];
}

export type ViewPreference = { x: number; y: number; scale: number };
/** The last view as "x,y,scale", if one is remembered and sane. */
export function readView(minScale: number, maxScale: number): ViewPreference | null {
  const stored = readPreference("view");
  if (!stored) return null;
  const [x, y, scale] = stored.split(",").map(Number);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(scale) && scale >= minScale && scale <= maxScale ? { x, y, scale } : null;
}
export const writeView = (view: ViewPreference) => writePreference("view", [view.x, view.y, view.scale].map((value) => Math.round(value * 1000) / 1000).join(","));
