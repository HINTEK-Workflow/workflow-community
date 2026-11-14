"use client";

import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { AlertCircle, X } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { indicatorText } from "@/features/workflow/indicator-tone";
import { WORKSPACE_TOAST_EVENT, type WorkspaceToast } from "@/lib/workflow/toast";
import { cn } from "@/lib/utils";

/**
 * The app's toast, drawn in one place: the workspace, and the pages that stand without it. Variants (2026-11-06): `placement
 * "top"` for a reminder that waits for the person after signing in (Serveruppdateringar väntar), `warning` for something
 * that waits but is no error.
 */
export function ToastCard({ error, warning, placement = "bottom", onClose, children, className, testId, ref }: { error: boolean; warning?: boolean; placement?: "bottom" | "top"; onClose: () => void; children: ReactNode; className?: string; testId?: string; ref?: Ref<HTMLDivElement> }) {
  const tone = error ? "danger" : warning ? "warning" : "success";
  return <div ref={ref} role={error ? "alert" : "status"} data-testid={testId} data-placement={placement}
    className={cn("workspace-toast fixed z-[60] flex items-start gap-3 rounded-xl border bg-card p-4 shadow-lg",
      placement === "top" ? "left-4 right-4 top-4 sm:left-auto sm:max-w-md" : "bottom-5 right-5 max-w-[calc(100%-2.5rem)]",
      tone === "danger" ? "border-red-200" : tone === "warning" ? "border-amber-200 dark:border-amber-900" : "border-emerald-200", className)}>
    <AlertCircle className={cn("mt-0.5 size-4 shrink-0", indicatorText(tone))} aria-hidden="true" />
    {children}
    <IconButton label="Stäng meddelande" onClick={onClose}><X /></IconButton>
  </div>;
}

/** For a page with no workspace around it: listens for the app's own toast event (announce, notice) and draws it the same way. */
export function EventToast({ testId, defaultMs = 5000 }: { testId: string; defaultMs?: number }) {
  const [toast, setToast] = useState<{ text: string; error: boolean; at: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const show = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceToast>).detail;
      if (!detail || detail.clear || detail.withdraw || !detail.text) return;
      if (timer.current) clearTimeout(timer.current);
      setToast({ text: detail.text, error: Boolean(detail.error), at: Date.now() });
      timer.current = setTimeout(() => setToast(null), detail.durationMs ?? defaultMs);
    };
    window.addEventListener(WORKSPACE_TOAST_EVENT, show);
    return () => {
      window.removeEventListener(WORKSPACE_TOAST_EVENT, show);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [defaultMs]);
  if (!toast) return null;
  return <ToastCard key={toast.at} error={toast.error} onClose={() => setToast(null)} className="pointer-events-auto" testId={testId}>
    <p className="max-w-md text-sm leading-6">{toast.text}</p>
  </ToastCard>;
}
