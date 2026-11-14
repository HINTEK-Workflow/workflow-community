"use client";

import { useCallback, useRef, useState } from "react";
import { AlertDialog } from "radix-ui";
import { AlertTriangle, CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

/** A warning triangle is for a "danger" question only; an ordinary question gets a question mark (Fas 2, 2026-10-11). */
export type ConfirmOptions = { title: string; message: string; confirmLabel: string; cancelLabel?: string; tone?: "danger" | "default";
  /** A third, plain choice between Avbryt and the action (Stoppa under a minute: Släng, 2026-10-12); resolves "alternative". */
  alternative?: { label: string };
  /**
   * A checkbox under the text (Inlägg, 2026-11-10): `required` keeps the action back until it is ticked (a confirmation that is
   * read, not clicked past); `onResult` gets whether it was ticked when the action is chosen.
   */
  checkbox?: { label: string; initial?: boolean; required?: boolean; onResult?: (checked: boolean) => void; testId?: string } };
type ConfirmAnswer = boolean | "alternative";

/** The one question before changes are thrown away (lib/workflow/discard-question.ts); the same for Avbryt and every Bakåt. */
export { DISCARD_QUESTION } from "@/lib/workflow/discard-question";
type ConfirmFn = {
  (next: ConfirmOptions & { alternative: { label: string } }): Promise<ConfirmAnswer>;
  (next: ConfirmOptions): Promise<boolean>;
};

/**
 * An in-app confirmation card in the Workflow design (2026-09-26: never the browser's own confirm box).
 * `confirm(...)` resolves true for the action button and false for Avbryt, Escape or a click outside; with an
 * `alternative` it may also resolve "alternative". Render the returned element once in the component that asks.
 */
export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: ConfirmAnswer) => void) | null>(null);
  const [checked, setChecked] = useState(false);
  const ask = useCallback((next: ConfirmOptions) => new Promise<ConfirmAnswer>((resolve) => {
    resolver.current?.(false);
    resolver.current = resolve;
    setChecked(Boolean(next.checkbox?.initial));
    setOptions(next);
  }), []);
  const confirm = ask as ConfirmFn;
  const close = (value: ConfirmAnswer) => { if (value === true) options?.checkbox?.onResult?.(checked); resolver.current?.(value); resolver.current = null; setOptions(null); };
  const danger = options?.tone === "danger";
  const element = <AlertDialog.Root open={Boolean(options)} onOpenChange={(open) => { if (!open) close(false); }}>
    <AlertDialog.Portal>
      <AlertDialog.Overlay className="fixed inset-0 z-50 bg-slate-950/30" />
      <AlertDialog.Content className="workspace-modal fixed left-1/2 top-[18vh] z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-xl border bg-card p-5 shadow-xl" data-testid="confirm-card">
        <div className="flex gap-3">
          <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", danger ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-secondary text-primary")}>{danger ? <AlertTriangle className="size-4" /> : <CircleHelp className="size-4" />}</span>
          <div className="min-w-0">
            <AlertDialog.Title className="section-title">{options?.title}</AlertDialog.Title>
            <AlertDialog.Description className="mt-1.5 text-sm leading-6 text-muted-foreground">{options?.message}</AlertDialog.Description>
          </div>
        </div>
        {options?.checkbox ? <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-sm" data-testid={options.checkbox.testId ?? "confirm-checkbox"}>
          <Checkbox checked={checked} onCheckedChange={(value) => setChecked(value === true)} className="mt-0.5" />
          <span>{options.checkbox.label}</span>
        </label> : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <AlertDialog.Cancel asChild><Button type="button" variant="outline">{options?.cancelLabel ?? "Avbryt"}</Button></AlertDialog.Cancel>
          {options?.alternative ? <Button type="button" variant="outline" onClick={() => close("alternative")} data-testid="confirm-alternative">{options.alternative.label}</Button> : null}
          <AlertDialog.Action asChild><Button type="button" variant={danger ? "destructive" : "default"} disabled={Boolean(options?.checkbox?.required && !checked)} onClick={() => close(true)}>{options?.confirmLabel}</Button></AlertDialog.Action>
        </div>
      </AlertDialog.Content>
    </AlertDialog.Portal>
  </AlertDialog.Root>;
  return [confirm, element] as const;
}
