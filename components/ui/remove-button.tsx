import type * as React from "react"
import { Trash2 } from "lucide-react"

import { IconButton } from "@/components/ui/icon-button"
import { cn } from "@/lib/utils"

/**
 * Ta bort i en rad (2026-10-28, knappgrupp 3): the bin as an icon button – the same icon, size and colour
 * everywhere (muted at rest, red on hover and focus), `label` as name and tooltip. It only draws the button: the place
 * keeps its own question (`useConfirm` danger), its undo afterwards (`useUndoRemove`) or neither, exactly as before.
 * This is the icon-only form; the labelled "Ta bort"-button with text is a later step.
 */
export function RemoveButton({ label, className, ...props }: Omit<React.ComponentProps<typeof IconButton>, "children" | "variant" | "size">) {
  return <IconButton label={label} className={cn("text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:text-destructive", className)} data-remove-button="" {...props}>
    <Trash2 aria-hidden="true" />
  </IconButton>
}
