"use client";

import { useSubPageHref } from "@/features/kfid/use-return-to";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Materiallista → offert from a saved work order (steg C, 2026-10-09): opens a new quote draft with the work
 * order's material rows as lines (`?view=quote&from=task&taskId=…`). Only a link; the quote page reads the rows through
 * the server, which checks Offerter – redigera and Arbetsorder – läsa. The work order is read from the address, so a new,
 * unsaved work order shows nothing. Rows that came from a quote say so (`quoteRef`).
 */
export function QuoteFromWorkOrder({ rows }: { rows: readonly { name: string; kind?: string; quoteRef?: { quoteLabel: string } }[] }) {
  const taskId = useSearchParams().get("taskId")?.slice(0, 100);
  // The quote leads back to the work order (samband, 2026-10-26).
  const subPage = useSubPageHref();
  const materials = rows.filter((row) => row.kind !== "expense" && row.name.trim());
  if (!taskId || !materials.length) return null;
  const fromQuote = [...new Set(materials.flatMap((row) => row.quoteRef ? [row.quoteRef.quoteLabel] : []))];
  return <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm" data-testid="quote-from-work-order">
    <span className="text-xs text-muted-foreground">{fromQuote.length ? `Material från offert ${fromQuote.join(", ")}.` : ""}</span>
    <Button asChild variant="ghost"><Link href={subPage(`/?view=quote&from=task&taskId=${encodeURIComponent(taskId)}`)}><FileText />Skapa offert av materialet</Link></Button>
  </div>;
}
