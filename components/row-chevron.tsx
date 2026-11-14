import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Pilen på en klickbar rad (2026-11-02, docs/design-standard.md): hela raden går att klicka, pilen säger det. Bara på rader som
 * leder någonstans. Pilen blir primärfärgad när pekaren är över raden (.row-chevron i app/globals.css).
 */
export function RowChevron({ className }: { className?: string }) {
  return <ChevronRight aria-hidden="true" data-testid="row-chevron" className={cn("row-chevron size-4 shrink-0 text-muted-foreground transition-colors", className)} />;
}
