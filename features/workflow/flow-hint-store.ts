"use client";

import { useSyncExternalStore } from "react";

/**
 * "Nu: <steg>. <vad du gör>" in the header of the panel where the step is done (2026-10-01: "ska visas i
 * cardets topp, höger om rubriken Grunduppgifter"). The progress line publishes the panel's heading and the text;
 * the panel with that heading shows it. One page has one progress line, so one hint at a time.
 */
export type FlowHint = { panel: string; step: string; hint: string; number: number; total: number };

let current: FlowHint | null = null;
const listeners = new Set<() => void>();

export function publishFlowHint(next: FlowHint | null) {
  if (current?.panel === next?.panel && current?.step === next?.step && current?.hint === next?.hint && current?.number === next?.number) return;
  current = next;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** The hint for the panel with this heading, if the current step is done there. */
export function useFlowHint(panel: string): FlowHint | null {
  return useSyncExternalStore(subscribe, () => (current?.panel === panel ? current : null), () => null);
}

/** Whether a panel shows the hint right now (the progress line then leaves its own line out). */
export function useFlowHintShown(): boolean {
  return useSyncExternalStore(subscribe, () => current !== null, () => false);
}

// ---------- the page the person is on, for Workflow AI ----------
let pageContext: unknown = null;
/** Set by the progress line of the open page; read by the assistant when a question is sent. */
export function publishPageContext(next: unknown) { pageContext = next; }
export function currentPageContext() { return pageContext; }
