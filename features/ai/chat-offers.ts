"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { offeredAt } from "@/lib/agents/system-agents";
import type { AdvisorLevel } from "@/lib/workflow/flow-advisor";

/**
 * Förslag och tips i chatten (2026-11-21: "i stället för en fast knapp skulle knappen kunna vara en del av chattfönstret som
 * känner av att nu finns det ett förslag att ta ställning till"). A page publishes what its built-in agents have to say – a rule
 * tip with its action (Starta tid, Färdigställ …), or a proposal the agent can make here (Föreslå arbetsorder ur avvikelserna) with
 * the same component as before – instead of drawing a fixed AI button. Workflow AI's button shows that something waits: a dot, and a
 * small movement of the bubble once per offer (never while the person types; with reduced motion only the dot). Opening the chat
 * shows the offers first, with Använd/Avfärda from the proposal itself, or the tip's own button.
 *
 * Each person's level per agent (Ofta, Normalt, Sällan, Av; GET /api/agents?part=system) decides what is offered; the company's Av
 * hides the agent for everyone. Rule tips never leave Workflow; a proposal uses the model only when the person asks for it.
 */
export type ChatOffer = {
  /** Stable per page and event, so the bubble moves at most once for it. */
  id: string;
  agentId: string;
  title: string;
  text?: string;
  priority: 1 | 2 | 3;
  /** The offer's own controls: the tip's action, or the proposal component (it calls the API itself). */
  node?: ReactNode;
  actions?: { label: string; run: () => void; testId?: string }[];
  onDismiss?: () => void;
  onMute?: () => void;
};

let offers: ChatOffer[] = [];
let seen = new Set<string>();
type Levels = Record<string, { on: boolean; level: AdvisorLevel; when?: string }> | null;
let levels: Levels = null as Levels;
let nudgeId: string | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Whether an offer is shown for this person: the company's Av and the person's own level. Unknown agents: shown. */
export function offerShown(offer: Pick<ChatOffer, "agentId" | "priority">, known: Levels) {
  const agent = known?.[offer.agentId];
  if (!agent) return true;
  // "Bara när du frågar i chatten": the company chose that the agent never speaks up on a page by itself.
  return agent.on && agent.when !== "asked" && offeredAt(agent.level, offer.priority);
}

const typing = () => {
  const active = typeof document === "undefined" ? null : document.activeElement;
  return Boolean(active && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement || (active as HTMLElement).isContentEditable));
};

export function publishChatOffer(offer: ChatOffer) {
  const at = offers.findIndex((item) => item.id === offer.id);
  offers = at >= 0 ? offers.map((item, index) => (index === at ? offer : item)) : [...offers, offer];
  // The bubble moves once per offer, and not while the person is typing in a field.
  if (at < 0 && !seen.has(offer.id) && offerShown(offer, levels) && !typing()) { nudgeId = offer.id; window.setTimeout(() => { if (nudgeId === offer.id) { nudgeId = null; emit(); } }, 1_600); }
  emit();
}
export function withdrawChatOffer(id: string) {
  if (!offers.some((item) => item.id === id)) return;
  offers = offers.filter((item) => item.id !== id);
  emit();
}
/** The chat was opened: what waits is seen (the dot goes; the offers stay in the chat while the page has them). */
export function markChatOffersSeen() {
  seen = new Set([...seen, ...offers.map((item) => item.id)]);
  nudgeId = null;
  emit();
}
export function setAgentLevels(next: Levels) { levels = next; emit(); }

let shownCache: { source: ChatOffer[]; known: Levels; value: ChatOffer[] } | null = null;
const shownOffers = () => {
  if (shownCache && shownCache.source === offers && shownCache.known === levels) return shownCache.value;
  const value = offers.filter((offer) => offerShown(offer, levels)).sort((a, b) => b.priority - a.priority);
  shownCache = { source: offers, known: levels, value };
  return value;
};
const EMPTY: ChatOffer[] = [];
export const useChatOffers = () => useSyncExternalStore(subscribe, shownOffers, () => EMPTY);

let signalCache: { waiting: boolean; nudge: boolean } = { waiting: false, nudge: false };
const signal = () => {
  const shown = shownOffers();
  const waiting = shown.some((offer) => !seen.has(offer.id));
  const nudge = Boolean(nudgeId && shown.some((offer) => offer.id === nudgeId));
  if (signalCache.waiting !== waiting || signalCache.nudge !== nudge) signalCache = { waiting, nudge };
  return signalCache;
};
const QUIET = { waiting: false, nudge: false };
/** For Workflow AI's button and tab: a dot while something waits unseen, and the one-time movement. */
export function useChatOfferSignal() {
  const value = useSyncExternalStore(subscribe, signal, () => QUIET);
  const reduced = useSyncExternalStore(subscribeMotion, () => window.matchMedia(REDUCED).matches, () => true);
  return { waiting: value.waiting, nudge: value.nudge && !reduced };
}
const REDUCED = "(prefers-reduced-motion: reduce)";
const subscribeMotion = (listener: () => void) => { const media = window.matchMedia(REDUCED); media.addEventListener("change", listener); return () => media.removeEventListener("change", listener); };

/** A page's offer while it is shown; null withdraws it. `key` changes when the offer's content does. */
export function useChatOffer(offer: ChatOffer | null, key: string) {
  useEffect(() => {
    if (!offer) return;
    publishChatOffer(offer);
    return () => withdrawChatOffer(offer.id);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- the offer is re-published when its key changes
}

/** The person's levels, read once per page load (the demo and Local answer without them: everything at Normalt). */
let loading = false;
export function useAgentLevels(enabled: boolean) {
  useEffect(() => {
    if (!enabled || levels || loading) return;
    loading = true;
    fetch("/api/agents?part=system", { cache: "no-store" }).then((response) => (response.ok ? response.json() : null)).then((data: { system?: { id: string; on: boolean; level: AdvisorLevel; whenChosen?: string }[] } | null) => {
      if (data?.system) setAgentLevels(Object.fromEntries(data.system.map((agent) => [agent.id, { on: agent.on, level: agent.level, when: agent.whenChosen }])));
    }).catch(() => undefined).finally(() => { loading = false; });
  }, [enabled]);
}

/**
 * Whether this screen has Workflow AI's button or tab (the app shell says so). Without it – Local, an installation without Workflow AI –
 * a page keeps its tip on the page, as before, since there is no chat to wait in.
 */
let host = false;
export function setChatOffersHost(next: boolean) { if (host !== next) { host = next; emit(); } }
export const useChatOffersHost = () => useSyncExternalStore(subscribe, () => host, () => false);

/** For the tests: the store's state from the start. */
export function resetChatOffersForTests() { offers = []; seen = new Set(); levels = null; nudgeId = null; shownCache = null; emit(); }
