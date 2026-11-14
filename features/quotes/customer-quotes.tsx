"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Plus, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListEmpty, ListGroup, ListRow } from "@/components/native";
import { api } from "@/features/kfid/api";
import { Empty, Panel, ShowMore } from "@/features/kfid/ui";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { cn } from "@/lib/utils";
import { formatSek } from "@/lib/workflow/expenses";
import { formatKronor } from "@/lib/quotes/native";
import { QUOTE_STATUS_LABELS, type QuoteListItem } from "@/lib/quotes/model";
import { quoteStatusTone } from "./quote-status";

/** What the customer card's reply says about the customer's quotes: null without the right to read quotes (or in Local). */
export type CustomerQuotesSummary = { total: number; canCreate: boolean };
type QuotePage = { items: QuoteListItem[]; total: number; page: number; hasMore: boolean };

/** "Ny offert" for a customer: the quote starts with the customer, its type and – when it has one place – the place. */
export const newQuoteHref = (customerId: string) => `/?view=quote&customerId=${encodeURIComponent(customerId)}`;
const quoteHref = (quote: QuoteListItem) => `/?view=quote&quoteId=${encodeURIComponent(quote.id)}`;

/**
 * Kundkortets offerter (2026-10-10): the customer's quotes – the latest version of each, newest change first,
 * with status and sum, a link to each and "Ny offert" for this customer. The server's own quote list
 * (/api/quotes?customerId=&filter=all) with its right (Offerter – läsa) and "Visa fler"; Cloud and the demo only. The
 * page shows the panel, level 1 on a phone the rows of a screen of its own.
 */
export function CustomerQuotes({ customerId, summary, native = false, limit }: { customerId: string; summary: CustomerQuotesSummary; native?: boolean;
  /** The card page (plan 1R): shows the latest `limit` quotes before "Visa alla". */
  limit?: number }) {
  const [items, setItems] = useState<QuoteListItem[] | null>(null);
  const [page, setPage] = useState<Omit<QuotePage, "items"> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [all, setAll] = useState(false);
  const load = useCallback(async (next: number) => {
    setBusy(true);
    try {
      const result = await api<QuotePage>(`/api/quotes?${new URLSearchParams({ customerId, filter: "all", page: String(next) })}`, { cache: "no-store" });
      setItems((current) => next === 1 ? result.items : [...(current ?? []), ...result.items]);
      setPage({ total: result.total, page: result.page, hasMore: result.hasMore });
      setError("");
    } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
  }, [customerId]);
  useEffect(() => { queueMicrotask(() => void load(1)); }, [load]);
  const shown = items ?? [];
  const total = page?.total ?? summary.total;
  const visible = limit && !all ? shown.slice(0, limit) : shown;

  if (native) return <>
    <ListGroup testId="customer-quotes" footer="Summor inklusive moms." alignPills>
      {error ? <ListEmpty>{error}</ListEmpty>
        : !items ? <ListEmpty>Hämtar offerterna…</ListEmpty>
        : shown.length ? shown.map((quote) => <ListRow key={quote.id} type="quote" title={quote.title || quote.label} href={quoteHref(quote)} testId="customer-quote"
          subtitle={[quote.label, `${formatKronor(quote.gross ?? quote.net)} kr`].join(" · ")} pill={{ label: QUOTE_STATUS_LABELS[quote.status], tone: quoteStatusTone(quote.status) }} />)
        : <ListEmpty>Kunden har inga offerter ännu.</ListEmpty>}
      {page?.hasMore ? <ListRow title={<span className="text-primary">{busy ? "Hämtar…" : "Visa fler"}</span>} chevron={false} onClick={busy ? undefined : () => void load(page.page + 1)} testId="customer-quotes-more" /> : null}
    </ListGroup>
    {summary.canCreate ? <ListGroup><ListRow type="new" icon={Plus} title="Ny offert" href={newQuoteHref(customerId)} testId="customer-quote-new" /></ListGroup> : null}
  </>;

  // The same header as the card's other panels (Projekt, Uppgifter, Anläggningar): title and description, small buttons to the right.
  return <Panel icon={FileText} title="Offerter" description="Kundens offerter, senast ändrade först. Belopp exklusive moms."
    actions={summary.canCreate ? <Button asChild size="sm" variant="outline"><Link href={newQuoteHref(customerId)} data-testid="customer-quote-new"><Plus />Ny offert</Link></Button> : undefined}>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p>
      : !items ? <p role="status" className="text-sm text-muted-foreground">Hämtar offerterna…</p>
      : shown.length ? <ul data-testid="customer-quotes" className="divide-y">{visible.map((quote) => <li key={quote.id} data-testid="customer-quote" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0">
        <div className="min-w-0">
          <Link className="font-medium hover:text-primary" href={quoteHref(quote)}>{quote.label} · {quote.title || "Utan rubrik"}{quote.changeOfVersion ? <span className="font-normal text-muted-foreground"> (ÄTA)</span> : null}</Link>
          <p className="text-xs text-muted-foreground">{[quote.projectName, quote.validUntil ? `Giltig till ${quote.validUntil}` : ""].filter(Boolean).join(" · ") || "Inget projekt"}</p>
        </div>
        <span className="flex items-center gap-3">
          <span className="text-sm tabular-nums">{formatSek(quote.net)} kr</span>
          <span className={cn("inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium", indicatorBadge(quoteStatusTone(quote.status)))}>{QUOTE_STATUS_LABELS[quote.status]}</span>
        </span>
      </li>)}</ul>
      : <Empty compact title="Inga offerter" description={summary.canCreate ? "Kunden har inga offerter ännu. Skapa en med Ny offert." : "Kunden har inga offerter ännu."} />}
    {limit && total > limit ? <div className="mt-3 flex justify-center"><Button type="button" size="sm" variant="outline" aria-expanded={all} onClick={() => setAll((value) => !value)} data-testid="customer-quotes-all">{all ? "Visa färre" : `Visa alla (${total})`}</Button></div> : null}
    {items && (!limit || all) ? <ShowMore shown={shown.length} total={total} busy={busy} onMore={() => void load((page?.page ?? 1) + 1)} /> : null}
  </Panel>;
}
