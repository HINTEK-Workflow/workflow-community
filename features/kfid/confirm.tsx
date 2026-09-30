"use client";

import { useCallback, useRef, useState } from "react";
import { AlertDialog } from "radix-ui";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ConfirmOptions = { title: string; message: string; confirmLabel: string; cancelLabel?: string; tone?: "danger" | "default" };

/**
 * An in-app confirmation card in the Workflow design (Daniel 2026-09-26: never the browser's own confirm box).
 * `confirm(...)` resolves true for the action button and false for Avbryt, Escape or a click outside.
 * Render the returned element once in the component that asks.
 */
export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const confirm = useCallback((next: ConfirmOptions) => new Promise<boolean>((resolve) => {
    resolver.current?.(false);
    resolver.current = resolve;
    setOptions(next);
  }), []);
  const close = (value: boolean) => { resolver.current?.(value); resolver.current = null; setOptions(null); };
  const danger = options?.tone === "danger";
  const element = <AlertDialog.Root open={Boolean(options)} onOpenChange={(open) => { if (!open) close(false); }}>
    <AlertDialog.Portal>
      <AlertDialog.Overlay className="fixed inset-0 z-50 bg-slate-950/30" />
      <AlertDialog.Content className="workspace-modal fixed left-1/2 top-[18vh] z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-xl border bg-card p-5 shadow-xl" data-testid="confirm-card">
        <div className="flex gap-3">
          <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", danger ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-secondary text-primary")}><AlertTriangle className="size-4" /></span>
          <div className="min-w-0">
            <AlertDialog.Title className="section-title">{options?.title}</AlertDialog.Title>
            <AlertDialog.Description className="mt-1.5 text-sm leading-6 text-muted-foreground">{options?.message}</AlertDialog.Description>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <AlertDialog.Cancel asChild><Button type="button" variant="outline">{options?.cancelLabel ?? "Avbryt"}</Button></AlertDialog.Cancel>
          <AlertDialog.Action asChild><Button type="button" variant={danger ? "destructive" : "default"} onClick={() => close(true)}>{options?.confirmLabel}</Button></AlertDialog.Action>
        </div>
      </AlertDialog.Content>
    </AlertDialog.Portal>
  </AlertDialog.Root>;
  return [confirm, element] as const;
}
