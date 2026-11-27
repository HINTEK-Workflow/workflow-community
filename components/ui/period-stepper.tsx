import { ChevronLeft, ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"

/**
 * Bläddra i en period (ärende #8, 2026-11-26): ‹ I dag › – the arrows and the optional today button as one row of one height
 * (`--control-h`, 34 px with a mouse, 44 px on touch), outline, never a 32 px arrow beside a 34 px button. Used by Planeringskalendern,
 * Kapacitet, Tid's calendar, Översikt's month and Tid's period. The phone's list row (Tid's period on level 1) keeps its own ghost
 * arrows in the row.
 */
export function PeriodStepper({ previousLabel, nextLabel, onPrevious, onNext, today, nextDisabled, testId }: {
  previousLabel: string
  nextLabel: string
  onPrevious: () => void
  onNext: () => void
  /** The button between the arrows ("I dag", "Denna vecka"); left out when the period has none. */
  today?: { label: string; onClick: () => void; disabled?: boolean; testId?: string }
  nextDisabled?: boolean
  /** `-previous` and `-next` are added for the arrows. */
  testId?: string
}) {
  return <div className="flex items-center gap-1" role="group" aria-label="Bläddra" data-testid={testId}>
    <IconButton label={previousLabel} variant="outline" size="icon-lg" onClick={onPrevious} data-testid={testId ? `${testId}-previous` : undefined}><ChevronLeft /></IconButton>
    {today ? <Button type="button" variant="outline" disabled={today.disabled} onClick={today.onClick} data-testid={today.testId}>{today.label}</Button> : null}
    <IconButton label={nextLabel} variant="outline" size="icon-lg" disabled={nextDisabled} onClick={onNext} data-testid={testId ? `${testId}-next` : undefined}><ChevronRight /></IconButton>
  </div>
}
