import type * as React from "react"

import { Button } from "@/components/ui/button"

type ButtonProps = React.ComponentProps<typeof Button>

/**
 * A button that shows only an icon (2026-10-28, knappgrupp 2). `label` is both its accessible name
 * (`aria-label`) and its tooltip (`title`), so the two never drift apart. Ghost and `size="icon"` (32 px, 44 px to
 * touch) is the common look; the deliberate variants are props: `variant="outline"` beside a field, `size="icon-lg"`
 * as tall as a field, `size="icon-sm"` in a tight header. `title` is only given when the tooltip should say more than
 * the name, `title={false}` when a visible text next to it already says it.
 */
export function IconButton({ label, title, variant = "ghost", size = "icon", type = "button", ...props }: Omit<ButtonProps, "aria-label" | "title"> & {
  label: string
  title?: string | false
}) {
  return <Button type={type} variant={variant} size={size} aria-label={label} title={title === false ? undefined : title ?? label} {...props} />
}
