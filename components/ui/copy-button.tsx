"use client"

import * as React from "react"
import { Check, Copy } from "lucide-react"

import { Button } from "@/components/ui/button"
import { copyToClipboard } from "@/lib/clipboard"
import { announce } from "@/lib/workflow/toast"

/** How long "Kopierat" stays on the button. */
export const COPIED_MS = 2500

const FAILED = "Kopieringen fungerade inte. Markera texten och kopiera den själv."

/**
 * Kopiera till urklipp (2026-10-28, knappgrupp 1): every copy button goes through `copyToClipboard`, shows
 * "Kopierat" with a check for a short while, and says the same when the browser refuses – a toast, unless the place
 * shows the text to copy by hand itself (`onFailed`). `onCopied` is for the place's own confirmation.
 */
export function CopyButton({ value, label = "Kopiera", copiedLabel = "Kopierat", iconOnly = false, onCopied, onFailed, variant = "outline", size, children, onClick, ...props }: Omit<React.ComponentProps<typeof Button>, "value"> & {
  value: string | (() => string)
  label?: string
  copiedLabel?: string
  iconOnly?: boolean
  onCopied?: () => void
  onFailed?: (text: string) => void
}) {
  const [copied, setCopied] = React.useState(false)
  const timer = React.useRef<number | undefined>(undefined)
  React.useEffect(() => () => window.clearTimeout(timer.current), [])
  const copy = async (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event)
    if (event.defaultPrevented) return
    const text = typeof value === "function" ? value() : value
    if (await copyToClipboard(text)) {
      setCopied(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), COPIED_MS)
      onCopied?.()
    } else {
      setCopied(false)
      if (onFailed) onFailed(text)
      else announce(FAILED, true)
    }
  }
  const text = copied ? copiedLabel : children ?? label
  return <Button type="button" variant={variant} size={size ?? (iconOnly ? "icon" : undefined)} data-copied={copied || undefined}
    aria-label={iconOnly ? (copied ? copiedLabel : label) : undefined} title={iconOnly ? (copied ? copiedLabel : label) : undefined}
    {...props} onClick={(event) => void copy(event)}>
    {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{iconOnly ? null : text}
  </Button>
}
