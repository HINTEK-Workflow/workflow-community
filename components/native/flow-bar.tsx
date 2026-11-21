"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { flowBarModel, type FlowStepInput } from "@/lib/workflow/native-nav";
import { shortStepLabel } from "@/lib/workflow/native-mode";
import { StepBar } from "./tile";

/**
 * The bottom row of a flow at level 1 (M3, 2026-10-12): several screens in a row – a control's steps, a quote's
 * Rader → Uppgifter → Summa → Skicka – are three to five bigger steps, each ending in the same row: Föregående, "Nästa: <name>"
 * and, on the last step, the finishing action (Färdigställ, Skicka, Klar). The dots above are the existing StepBar. The row is fixed
 * just above the tab bar (sticky, with its own background) and the content ends above it, so the last field is never hidden.
 *
 * `steps` and `index` (0-based) give the labels and dots; the page does the navigation in `onPrevious`/`onNext`. `finish` is
 * the last step's action; `nextDisabled` keeps Nästa from being pressed until the step allows it (a risk not confirmed yet)
 * and `nextHint` says why, in words, under the row. Logic: `flowBarModel` in lib/workflow/native-nav.ts.
 */
export function NativeFlowBar({ steps, index, onPrevious, onNext, finish, nextDisabled = false, nextHint, label, testId = "native-flow" }: {
  steps: readonly FlowStepInput[];
  index: number;
  onPrevious: () => void;
  onNext: () => void;
  finish?: { label: string; onClick: () => void; busy?: boolean; disabled?: boolean; busyLabel?: string };
  nextDisabled?: boolean;
  nextHint?: ReactNode;
  /** The dots’ accessible name; the default reads "Steg 2 av 4: Mätning". */
  label?: string;
  testId?: string;
}) {
  const model = flowBarModel(steps, index);
  if (!model.total) return null;
  const current = steps[model.position - 1]!;
  // "Nästa: Isolation och Kont…" was cut (2026-10-12): a long name is shortened to its first part, so Nästa and a readable name fit.
  const next = steps[model.position];
  const nextLabel = model.nextLabel && next ? `Nästa: ${shortStepLabel(next.label)}` : model.nextLabel;
  return <div className="native-flow" data-testid={testId} data-step={model.position} data-last={model.isLast || undefined}>
    <StepBar steps={model.dots} label={label ?? `Steg ${model.position} av ${model.total}: ${current.label}`} />
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
      {model.previous
        ? <Button type="button" variant="outline" className="h-12 text-base" onClick={onPrevious} data-testid={`${testId}-previous`}>Föregående</Button>
        : <span />}
      {model.isLast
        ? finish ? <Button type="button" className="h-12 text-base" disabled={finish.disabled || finish.busy} onClick={finish.onClick} data-testid={`${testId}-finish`} busy={finish.busy} busyLabel={finish.busyLabel ?? "Sparar…"}>{finish.label}</Button> : <span />
        : <Button type="button" className="h-12 min-w-0 max-w-full overflow-hidden text-base" disabled={nextDisabled} onClick={onNext} data-testid={`${testId}-next`}><span className="block min-w-0 max-w-full truncate">{nextLabel}</span></Button>}
    </div>
    {nextHint ? <p className="px-1 pt-2 text-center text-xs text-muted-foreground" data-testid={`${testId}-hint`}>{nextHint}</p> : null}
  </div>;
}
