import type * as React from "react"

import { cn } from "@/lib/utils"
import { announce } from "@/lib/workflow/toast"

/**
 * A control that cannot be used yet says why in visible text (2026-10-08: phones have no hover, so a tooltip alone is
 * never enough). The control stays focusable and clickable with `aria-disabled`; a click or tap shows the same reason
 * as a toast instead of doing nothing, and `aria-describedby` points at the visible line under the control.
 */
export type DisabledReasonInput = {
  /** Why the control cannot be used now; empty or null when it can. */
  reason?: string | null
  /** The id of the visible line (`DisabledReason`) that says the same thing. */
  describedBy?: string
  title?: string
  className?: string
  onClick?: React.MouseEventHandler<HTMLElement>
  /** How the reason is told on click; the workspace toast by default. */
  notify?: (text: string) => void
}

export type DisabledReasonProps = {
  "aria-disabled"?: true
  "aria-describedby"?: string
  "data-disabled-reason"?: string
  title?: string
  className?: string
  onClick?: React.MouseEventHandler<HTMLElement>
}

/** The props a blocked control gets: looks disabled, stays reachable, and tells the reason on click. */
export function disabledReasonProps({ reason, describedBy, title, className, onClick, notify = (text) => announce(text) }: DisabledReasonInput): DisabledReasonProps {
  const text = reason?.trim()
  if (!text) return { "aria-describedby": describedBy, title, className, onClick }
  return {
    "aria-disabled": true,
    "aria-describedby": describedBy,
    "data-disabled-reason": text,
    title: title ?? text,
    className: cn(className, "cursor-not-allowed opacity-50 active:translate-y-0"),
    onClick: (event) => { event.preventDefault(); event.stopPropagation(); notify(text) },
  }
}

/** The reason as a short muted line, placed under or next to the control it explains. Renders nothing without one. */
export function DisabledReason({ id, reason, className }: { id: string; reason?: string | null; className?: string }) {
  const text = reason?.trim()
  if (!text) return null
  return <p id={id} data-testid="disabled-reason" className={cn("text-xs leading-5 text-muted-foreground", className)}>{text}</p>
}
