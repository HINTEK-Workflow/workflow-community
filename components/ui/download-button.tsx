import type * as React from "react"
import { FileDown } from "lucide-react"

import { Button } from "@/components/ui/button"

/**
 * Ladda ner / Exportera (2026-10-28, knappgrupp 4): one icon for every download (FileDown), outline as the
 * common look. The text stays the place's own ("PDF", "Exportera CSV"); `busy` with `busyLabel` while the file is made.
 * With `href` it is a plain link to the file (`download`, a name or true); otherwise `onClick` makes the file and saves
 * it with `saveBlob`/`saveResponse` (`lib/download.ts`) or opens it as before.
 */
export function DownloadButton({ variant = "outline", type = "button", href, download, children, ...props }: React.ComponentProps<typeof Button> & {
  href?: string
  download?: string | boolean
}) {
  if (href) {
    return <Button asChild variant={variant} {...props}>
      <a href={href} download={download === true ? "" : download || undefined}><FileDown aria-hidden="true" />{children}</a>
    </Button>
  }
  return <Button type={type} variant={variant} {...props}><FileDown aria-hidden="true" />{children}</Button>
}
