"use client";

import { useEffect, useState } from "react";

let availability: Promise<boolean> | null = null;
/** Whether Workflow AI can write for this person's company right now (read once per page load). */
export function aiAvailable() {
  availability ??= fetch("/api/ai/status", { cache: "no-store" }).then((response) => (response.ok ? response.json() : null)).then((status) => Boolean(status?.available)).catch(() => false);
  return availability;
}

export function useAiAvailable() {
  const [available, setAvailable] = useState(false);
  useEffect(() => { let active = true; void aiAvailable().then((value) => { if (active) setAvailable(value); }); return () => { active = false; }; }, []);
  return available;
}

export type Proposal<T> = { id: string; kind: string; status: string; payload: T; result?: Record<string, unknown> };
export type ProposalAnswer<T> = { proposal: Proposal<T> | null; reason?: string; chargedCredits?: number; error?: string };

/** One call to the proposals API; a refusal comes back as the route's own Swedish message. */
export async function proposalRequest<T>(body: Record<string, unknown>): Promise<ProposalAnswer<T>> {
  const response = await fetch("/api/ai/proposals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({})) as ProposalAnswer<T>;
  if (!response.ok) throw new Error(result.error || "Workflow AI kunde inte göra det just nu.");
  return result;
}

/** Records what the person did with a proposal; never stops the page if the record fails. */
export function proposalOutcome(action: "apply" | "dismiss" | "undo", id: string) {
  return proposalRequest({ action, id }).catch(() => null);
}
