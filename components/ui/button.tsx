import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"
import { disabledReasonProps } from "@/components/ui/disabled-reason"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-transparent bg-clip-padding text-sm font-semibold text-foreground whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-[var(--primary-hover)] [a]:hover:bg-[var(--primary-hover)]",
        // Flat (2026-10-16): a white button with the field's quiet edge; hover is a light blue-grey, not a tint.
        outline:
          "border-[var(--workflow-field-border)] bg-card hover:border-[var(--workflow-field-border-hover)] hover:bg-[var(--surface-hover)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground dark:border-input dark:bg-input/30",
        // The soft blue button (the lab's "mjuk"): a secondary action that should still be seen.
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-secondary hover:text-secondary-foreground aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        // 34 px with a mouse, 44 px on touch (--control-h, app/globals.css).
        default:
          "h-[var(--control-h)] gap-1.5 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-2.5 text-[0.8rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 gap-2 px-4 text-sm font-semibold has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        icon: "size-8",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-lg": "size-[var(--control-h)]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

/**
 * While busy the text is swapped for `busyLabel` (icons in the children stay where they are), so a hand-written
 * `{saving ? "Sparar…" : "Spara"}` is not needed (2026-10-28, knappgrupp 4).
 */
function busyChildren(children: React.ReactNode, busyLabel: React.ReactNode) {
  let placed = false
  return React.Children.map(children, (child) => {
    if (typeof child === "string" || typeof child === "number") {
      if (placed) return null
      placed = true
      return busyLabel
    }
    return child
  })
}

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  disabledReason,
  busy = false,
  busyLabel,
  children,
  ...rest
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    /**
     * Why the button cannot be used now (2026-10-08). It then looks disabled but stays focusable; a click or tap shows
     * the reason as a toast. Pair it with a visible `DisabledReason` and pass its id as `aria-describedby`. A real
     * `disabled` (e.g. while busy) still wins.
     */
    disabledReason?: string | null
    /** Working: really disabled, `aria-busy`, and the text is `busyLabel` when given ("Sparar…"). */
    busy?: boolean
    busyLabel?: React.ReactNode
  }) {
  const Comp = asChild ? Slot.Root : "button"
  const working = busy && !asChild
  const props = working ? { ...rest, disabled: true, "aria-busy": true as const } : rest
  const blocked = disabledReason && !props.disabled
    ? disabledReasonProps({ reason: disabledReason, describedBy: props["aria-describedby"], title: props.title, className, onClick: props.onClick as React.MouseEventHandler<HTMLElement> | undefined })
    : null

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      {...props}
      {...blocked}
      className={cn(buttonVariants({ variant, size, className: blocked?.className ?? className }))}
    >{working && busyLabel !== undefined ? busyChildren(children, busyLabel) : children}</Comp>
  )
}

export { Button, buttonVariants }
