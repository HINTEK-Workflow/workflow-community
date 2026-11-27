"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { DelayedSkeleton } from "@/components/skeleton";
import { ListEmpty, ListGroup, ListRow, ListSkeleton, NativeActions, NativePage, NativePickerRow, NativeSearch, NativeSegmented, ShowMoreMarker, useNativeTopBar } from "@/components/native";
import { formatKronor, quoteListGroups } from "@/lib/quotes/native";
import { QUOTE_FILTER_LABELS, QUOTE_FILTERS, QUOTE_STATUS_LABELS, type QuoteFilter, type QuoteListItem } from "@/lib/quotes/model";
import { quoteStatusTone } from "./quote-status";

/**
 * Mina offerter at level 1 on a phone (2026-10-10, docs/ui-system.md 9): the top bar (‹ back, title, Ny offert), the compact search,
 * Mina | Alla, the status filter as one row that opens the phone's own list, and the quotes as rows grouped by what they
 * wait for – Väntar på kundens svar, Utkast, Accepterade, Avböjda och utgångna. A row: the title, the customer and the
 * sum incl. VAT, and the status as a pill. The same server list, filters and paging as the ordinary page; the export of
 * many quotes (bookkeeping) is office work: in visning 2, and on a phone at the foot of the list with Visa mer (A2, `exportMenu`).
 */
export function NativeQuotesList({ items, total, hasMore, busy, error, canEdit, scope, onScope, filter, onFilter, query, onQuery, onMore, exportMenu }: {
  items: QuoteListItem[] | null; total: number; hasMore: boolean; busy: boolean; error: string; canEdit: boolean;
  scope: "mine" | "all"; onScope: (scope: "mine" | "all") => void; filter: QuoteFilter; onFilter: (filter: QuoteFilter) => void;
  query: string; onQuery: (query: string) => void; onMore: () => void;
  /** Exportera offerter, given with Visa mer (content level 3); without it the page tells the button there is more. */
  exportMenu?: ReactNode;
}) {
  const router = useRouter();
  // M4 (2026-10-12): the top bar names the page; Ny offert is its main action, so the page has no large title of its own.
  useNativeTopBar({ title: "Offerter", save: canEdit ? { label: "Ny offert", onClick: () => router.push("/?view=quote") } : null });
  const groups = items ? quoteListGroups(items) : [];
  return <NativePage testId="native-quotes">
    <NativeSearch value={query} onChange={onQuery} label="Sök offert" placeholder="Rubrik, kund eller nummer" />
    <NativeSegmented label="Mina eller alla" testId="quotes-scope" value={scope} onChange={onScope} options={[["mine", "Mina"], ["all", "Alla"]]} />
    <ListGroup testId="native-quotes-filter">
      <NativePickerRow label="Filter" display={QUOTE_FILTER_LABELS[filter]}>
        <select aria-label="Status" value={filter} onChange={(event) => onFilter(event.target.value as QuoteFilter)}>
          {QUOTE_FILTERS.map((value) => <option key={value} value={value}>{QUOTE_FILTER_LABELS[value]}</option>)}
        </select>
      </NativePickerRow>
    </ListGroup>
    {error ? <p role="alert" className="notice mt-3 text-destructive">{error}</p> : null}
    {!items ? <DelayedSkeleton><ListSkeleton rows={6} label="Hämtar offerter…" testId="native-quotes-loading" /></DelayedSkeleton>
      : !items.length ? <ListGroup><ListEmpty>{filter === "open" && !query && scope === "all" ? "Inga pågående offerter." : "Inget matchar urvalet. Ändra filter eller sökning."}</ListEmpty></ListGroup>
      : <div aria-busy={busy} data-testid="native-quote-rows">
        {groups.map((group) => <ListGroup key={group.key} title={group.label} testId={`native-quote-group-${group.key}`} alignPills>
          {group.items.map((item) => <ListRow key={item.id} href={`/?view=quote&quoteId=${encodeURIComponent(item.id)}`} type="quote" title={item.title || item.label} testId="quote-row"
            subtitle={[`${formatKronor(item.gross ?? item.net)} kr`, item.customerName || "Ingen kund"].join(" · ")}
            pill={{ label: QUOTE_STATUS_LABELS[item.status], tone: quoteStatusTone(item.status) }} />)}
        </ListGroup>)}
        <p className="px-4 pt-3 text-xs text-muted-foreground" role="status">Visar {items.length} av {total} · summor inklusive moms</p>
        {hasMore ? <ListGroup><ListRow title={<span className="text-primary">{busy ? "Hämtar…" : "Visa fler offerter"}</span>} chevron={false} onClick={busy ? undefined : onMore} testId="quotes-more" /></ListGroup> : null}
      </div>}
    {exportMenu ? <NativeActions testId="native-quotes-export">{exportMenu}</NativeActions> : <ShowMoreMarker />}
  </NativePage>;
}
