"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { OPEN_ASSISTANT_EVENT } from "@/lib/workflow/shell-events";

/**
 * Formulär med Workflow AI (2026-11-25): what the form builder and Workflow AI's chat tell each other in the browser. The builder
 * says that it is open and which draft it shows, so the chat can offer "Vill du skapa ett formulär?" and send the open draft's id
 * with a change; the dialog beside the external AI opens the chat in form mode; and Skapa utkast asks the builder to open the
 * draft it saved. Nothing here is a permission – the server checks every step again.
 */
type Builder = { templateId: string | null };
let builder: Builder | null = null;
let request = 0;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Set by the form builder while it is open (null when it closes). */
export function publishFormBuilder(next: Builder | null) {
  if (builder === next || (builder && next && builder.templateId === next.templateId)) return;
  builder = next;
  emit();
}
/** The builder's open draft, read when a question is sent. */
export const currentFormBuilder = () => builder;
/** Whether the form builder is the page the person is on. */
export const useFormBuilderOpen = () => useSyncExternalStore(subscribe, () => builder !== null, () => false);

/** Opens Workflow AI's chat in form mode (the dialog's "Skapa med Workflow AI"). */
export function openFormAiChat() {
  request += 1;
  emit();
  window.dispatchEvent(new Event(OPEN_ASSISTANT_EVENT));
}
/** A counter that grows with each request for form mode; the chat enters form mode once per new value. */
export const useFormAiRequest = () => useSyncExternalStore(subscribe, () => request, () => 0);

/** Skapa utkast has saved a draft: the open builder opens it; elsewhere the builder is opened on it. */
export const FORM_AI_OPEN_DRAFT_EVENT = "workflow:form-ai-open-draft";
export function showFormAiDraft(id: string, url: string, navigate: (url: string) => void) {
  if (builder) window.dispatchEvent(new CustomEvent(FORM_AI_OPEN_DRAFT_EVENT, { detail: { id } }));
  else navigate(url);
}
/** The builder's side: `open` is called with the id of a draft Skapa utkast saved or changed. */
export function onFormAiDraft(open: (id: string) => void) {
  const handler = (event: Event) => { const id = (event as CustomEvent<{ id?: unknown }>).detail?.id; if (typeof id === "string" && id) open(id); };
  window.addEventListener(FORM_AI_OPEN_DRAFT_EVENT, handler);
  return () => window.removeEventListener(FORM_AI_OPEN_DRAFT_EVENT, handler);
}

let status: Promise<boolean> | null = null;
/** Whether the company's Workflow AI can make forms for this person (read once per page load; the chat's own status says it). */
function formAiStatus() {
  status ??= fetch("/api/ai/status", { cache: "no-store" }).then((response) => (response.ok ? response.json() : null)).then((data) => Boolean((data as { formAi?: unknown } | null)?.formAi)).catch(() => false);
  return status;
}
export function useFormAiAvailable(enabled = true) {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void formAiStatus().then((value) => { if (active) setAvailable(value); });
    return () => { active = false; };
  }, [enabled]);
  return available;
}
