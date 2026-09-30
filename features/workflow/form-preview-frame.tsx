"use client";

import { Suspense, useEffect, useState } from "react";
import type { CustomerItem, ProjectItem } from "@/features/kfid/types";
import type { FormDocument, FormValues } from "@/lib/workflow/form-document";
import { WorkflowTaskEditor } from "./workflow-task-editor";

/**
 * The phone in the form builder's preview (2026-09-28: the preview must show exactly what the person filling in
 * the protocol sees). A phone's look depends on the real viewport width, so the task editor is drawn in a frame of a
 * phone's width at /form-preview and gets the draft, the example answers and the theme from the builder by message.
 * The frame accepts messages from its own origin and its parent window only, fetches nothing and stores nothing.
 */
export const FORM_PREVIEW_PATH = "/form-preview";
export type FormPreviewTheme = { theme?: string; density?: string; style: string };
export type FormPreviewMessage =
  | { type: "hintek-form-preview-ready" }
  | { type: "hintek-form-preview-show"; document: FormDocument; name: string; values: FormValues; area?: string; publisher?: string; userName?: string; theme: FormPreviewTheme }
  | { type: "hintek-form-preview-values"; values: FormValues }
  | { type: "hintek-form-preview-focus"; blockId: string };

/** The example customer and project of the preview, standing in for the company's own; nothing is looked up. */
export const PREVIEW_CUSTOMERS: CustomerItem[] = [{ id: "preview-customer", name: "Anna Exempel", company: "Exempel Fastigheter AB", address: "Storgatan 1", postalCode: "123 45", city: "Exempelstad", email: "anna@exempel.se", phone: "", mobile: "", lat: null, lng: null, notes: "", version: 1, deletedAt: null, facilities: [] }];
export const PREVIEW_PROJECTS: ProjectItem[] = [{ id: "preview-project", name: "Exempelprojekt – ny elcentral", description: "", dueDate: "", customerId: "preview-customer", updatedAt: "2026-01-01T00:00:00.000Z" }];

/** The theme of the builder's page, so the frame is drawn in the same colours, density and text size. */
export function currentPreviewTheme(): FormPreviewTheme {
  const root = window.document.documentElement;
  return { theme: root.dataset.theme, density: root.dataset.density, style: root.getAttribute("style") ?? "" };
}

/** Moves to the block a requirement points at – the same as the builder's own list does on a computer. */
export function focusPreviewBlock(root: Document, blockId: string) {
  const target = root.getElementById(blockId === "deviations" ? "form-deviations" : `form-${blockId}`);
  target?.scrollIntoView({ block: "center", behavior: "smooth" });
  (target?.matches("input, textarea, select, button") ? target : target?.querySelector<HTMLElement>("input, textarea, select, button"))?.focus({ preventScroll: true });
}

export function FormPreviewFrame() {
  const [shown, setShown] = useState<Extract<FormPreviewMessage, { type: "hintek-form-preview-show" }> | null>(null);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    if (window.parent === window) return;
    const onMessage = (event: MessageEvent<FormPreviewMessage>) => {
      if (event.origin !== window.location.origin || event.source !== window.parent || !event.data || typeof event.data !== "object") return;
      if (event.data.type === "hintek-form-preview-show") {
        const root = window.document.documentElement;
        if (event.data.theme.theme) root.dataset.theme = event.data.theme.theme;
        if (event.data.theme.density) root.dataset.density = event.data.theme.density;
        root.setAttribute("style", event.data.theme.style);
        setShown(event.data);
        setGeneration((value) => value + 1);
      } else if (event.data.type === "hintek-form-preview-focus") focusPreviewBlock(window.document, event.data.blockId);
    };
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ type: "hintek-form-preview-ready" } satisfies FormPreviewMessage, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  if (!shown) return <p role="status" className="p-4 text-sm text-muted-foreground">Öppnar förhandsgranskningen…</p>;
  // The same main area as the app's, so gutters and text sizes match the real page.
  return <main className="workspace-main mx-auto max-w-7xl px-4 py-7 sm:px-8 sm:py-10" data-testid="form-preview-frame-main">
    <Suspense>
      <WorkflowTaskEditor key={generation} kind="FORM" customers={PREVIEW_CUSTOMERS} projects={PREVIEW_PROJECTS} userName={shown.userName}
        preview={{ document: shown.document, name: shown.name, values: shown.values, area: shown.area, publisher: shown.publisher,
          onValuesChange: (values) => window.parent.postMessage({ type: "hintek-form-preview-values", values } satisfies FormPreviewMessage, window.location.origin) }} />
    </Suspense>
  </main>;
}
