"use client";
import { createContext, useCallback, useContext, useEffect, useRef } from "react";
import type { IndicatorTone } from "@/features/workflow/indicator-tone";

/**
 * Översikt on Tjänster och nycklar (2026-10-08) and on Webb och sociala medier under Kopplingar (2026-11-11): each card
 * on the page tells the overview at the top its name, its status and – when the service can be switched on and off – its
 * switch, so the page shows at a glance what is in place, what is missing and what is on. The cards keep their own fetching,
 * masking and access; outside a page with an overview (no provider) the report goes nowhere.
 */
export type ServerKeyGroupId = "payment" | "ai" | "login" | "wholesale" | "email" | "support" | "lookup" | "security";
export type ServerKeySectionId = ServerKeyGroupId | "server" | "scb" | "map" | "address" | "microsoft" | "azure" | "website" | "meta" | "linkedin" | "github";
/**
 * A service's on/off in the overview (activation, separate from the status): saved at once. `onChange` says whether it went
 * well; false puts the switch back (the service said why).
 */
export type ServiceToggle = { label: string; on: boolean; disabledReason?: string | null; onChange: (on: boolean) => Promise<boolean>; /** The switch's own test id beside service-switch. */ testId?: string };
export type ServerKeySectionStatus = { label: string; tone: IndicatorTone; detail?: string; name?: string; toggle?: ServiceToggle };
type Report = (id: ServerKeySectionId, status: ServerKeySectionStatus) => void;

export const ServerKeyStatusReport = createContext<Report | null>(null);

export const serverKeySectionAnchor = (id: ServerKeySectionId) => `server-keys-${id}`;

/** Whether two reports draw the same (the switch's handler may be new on every render). */
export function sameSectionStatus(a: ServerKeySectionStatus | undefined, b: ServerKeySectionStatus) {
  if (!a) return false;
  return a.label === b.label && a.tone === b.tone && a.detail === b.detail && a.name === b.name
    && Boolean(a.toggle) === Boolean(b.toggle) && a.toggle?.on === b.toggle?.on && a.toggle?.label === b.toggle?.label && (a.toggle?.disabledReason ?? null) === (b.toggle?.disabledReason ?? null);
}

export function useServerKeySectionStatus(id: ServerKeySectionId, status: ServerKeySectionStatus | null) {
  const report = useContext(ServerKeyStatusReport);
  // The switch's handler is kept in a ref, so the overview always calls the card's latest one.
  const change = useRef(status?.toggle?.onChange);
  useEffect(() => { change.current = status?.toggle?.onChange; });
  const onChange = useCallback((on: boolean) => change.current?.(on) ?? Promise.resolve(false), []);
  const label = status?.label;
  const tone = status?.tone;
  const detail = status?.detail;
  const name = status?.name;
  const toggleLabel = status?.toggle?.label;
  const toggleOn = status?.toggle?.on;
  const toggleReason = status?.toggle?.disabledReason ?? null;
  const toggleTestId = status?.toggle?.testId;
  useEffect(() => {
    if (!report || !label || !tone) return;
    report(id, { label, tone, detail, name, ...(toggleLabel !== undefined && toggleOn !== undefined ? { toggle: { label: toggleLabel, on: toggleOn, disabledReason: toggleReason, onChange, testId: toggleTestId } } : {}) });
  }, [report, id, label, tone, detail, name, toggleLabel, toggleOn, toggleReason, toggleTestId, onChange]);
}
