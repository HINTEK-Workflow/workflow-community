"use client";

import { AreaIcon } from "@/components/area-icon";
import { RowChevron } from "@/components/row-chevron";
import { useModuleOn } from "@/features/workflow/use-modules";
import Link from "next/link";
import { useState } from "react";
import { CalendarClock, FileText, LoaderCircle, Plus, Receipt, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/features/kfid/api";
import { keepLoadedPages, useWorkspaceData } from "@/features/kfid/use-workspace-data";
import { DelayedSkeleton, RowsSkeleton } from "@/components/skeleton";
import { Empty } from "@/features/kfid/ui";
import { indicatorBadge, PILL_FIXED_WIDTH_MD } from "@/features/workflow/indicator-tone";
import { cn } from "@/lib/utils";
import { formatSek } from "@/lib/workflow/expenses";
import { QUOTE_FILTER_LABELS, QUOTE_FILTERS, QUOTE_SORTS, QUOTE_STATUS_LABELS, type QuoteFilter, type QuoteListItem } from "@/lib/quotes/model";
import { PageHeader } from "@/components/page-shell";
import { ListCard, ListCardGrid, ListFilterBar, useListPrefs } from "@/components/list-filter-bar";
import { useEntryState } from "@/components/history-nav";
import { QuotesBulkExport } from "@/features/quotes/quote-export";
import { quoteStatusTone } from "@/features/quotes/quote-status";
import { NativeQuotesList } from "@/features/quotes/native-quotes";
import { isDenied, NoAccess } from "@/features/quotes/no-access";
import { useNativeMode, useNativeReduced } from "@/features/workflow/use-detail-level";
import { useAddressEntryState } from "@/components/use-address-filter";
import { allowedFilter } from "@/lib/url-filters";
import { listSortOptions } from "@/lib/list-filter";
import type { WorkListScope } from "@/lib/workflow/work-list";

/**
 * Mina offerter (2026-10-09, steg B): the company's quotes, read 20 at a time from the server ("Visa fler"), with
 * the shared toppvisning (2026-10-31, components/list-filter-bar.tsx): Mina / Alla and the status chips with counts,
 * a search on title, number and customer, the sort and Rader | Kort. Only the latest version of each quote is listed; the
 * quote shows its versions. Amounts are excl. VAT.
 */
type Page = { items: QuoteListItem[]; total: number; page: number; hasMore: boolean; canEdit: boolean; denied?: boolean; counts?: Record<QuoteFilter, number> | null };
/** A 403 kept as an answer: the person may not read quotes (decision 6, the box). */
const DENIED: Page = { items: [], total: 0, page: 1, hasMore: false, canEdit: false, denied: true };
const SCOPES: readonly WorkListScope[] = ["mine", "all"];
const SORT_OPTIONS = listSortOptions(QUOTE_SORTS);

export { quoteStatusTone };

const quoteHref = (item: QuoteListItem) => `/?view=quote&quoteId=${encodeURIComponent(item.id)}`;
function QuoteStatusPill({ item, column = false }: { item: QuoteListItem; column?: boolean }) {
  return <span className={cn("inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium", column && PILL_FIXED_WIDTH_MD, indicatorBadge(quoteStatusTone(item.status)))}>{QUOTE_STATUS_LABELS[item.status]}</span>;
}

export function QuotesList({ personId, canEditHint }: { personId: string; canEditHint: boolean }) {
  // Mina / Alla, the sort and Rader | Kort are remembered per person on the device (Alla first, as before); Mina / Alla
  // may also come from the address for the visit.
  const prefs = useListPrefs("quotes", personId, { sorts: QUOTE_SORTS, scopes: SCOPES, scope: "all" });
  const scope = prefs.scope ?? "all";
  // The filter may come from the address (`&filter=`, dashboard etapp 3, 2026-10-28; lib/url-filters.ts).
  const [filter, setFilter] = useAddressEntryState<QuoteFilter>("quotes.filter", "filter", (raw) => allowedFilter(raw, QUOTE_FILTERS), "open");
  // The search is kept per history entry, so Bakåt from a quote shows the same list.
  const [query, setQuery] = useEntryState("quotes.q", "");
  const native = useNativeMode();
  // Visa mer on a phone (A2): the app's list keeps its look and gets Exportera offerter.
  const reduced = useNativeReduced();
  // Steg 7 (stabil sidladdning): the first page through the workspace's memory cache (Bakåt shows the rows at once, with the
  // pages Visa fler added), read again meanwhile; a new choice keeps the old rows (aria-busy) until its answer comes. The
  // first page also asks for the chips' counts (the server decides whether they are given).
  const params = (page: number) => new URLSearchParams({ filter, page: String(page), sort: prefs.sort, ...(scope === "mine" ? { mine: "1" } : {}), ...(query.trim() ? { q: query.trim() } : {}), ...(page === 1 ? { counts: "1" } : {}) });
  const key = `/api/quotes?${params(1)}`;
  const read = useWorkspaceData<Page>(key, (signal) => api<Page>(key, { cache: "no-store", signal }).catch((cause: unknown) => { if (isDenied(cause)) return DENIED; throw cause; }), { keepPrevious: true, delayMs: query ? 250 : 0, merge: keepLoadedPages });
  const [moreBusy, setMoreBusy] = useState(false);
  const invoicingOn = useModuleOn("invoicing");
  const [moreError, setMoreError] = useState("");
  const items = read.data?.items ?? (read.error ? [] : null);
  const meta = read.data ? { total: read.data.total, page: read.data.page, hasMore: read.data.items.length < read.data.total, canEdit: read.data.canEdit } : { total: 0, page: 1, hasMore: false, canEdit: canEditHint };
  const counts = read.data?.counts ?? null;
  const busy = read.fetching || moreBusy;
  const error = moreError || read.error;
  const denied = Boolean(read.data?.denied);
  const more = async () => {
    setMoreBusy(true);
    try {
      const result = await api<Page>(`/api/quotes?${params(meta.page + 1)}`, { cache: "no-store" });
      read.mutate((current) => current ? { ...result, counts: current.counts, items: [...current.items, ...result.items.filter((item) => !current.items.some((seen) => seen.id === item.id))] } : result);
      setMoreError("");
    } catch (cause) { setMoreError((cause as Error).message); } finally { setMoreBusy(false); }
  };
  // One rule for a person without the right (decision 6): the box, nothing else.
  if (denied) return <div className="space-y-5" data-testid="quotes-list"><PageHeader title="Offerter" /><NoAccess /></div>;
  // Nivå 1 på mobil (2026-10-10): the same list as the phone's settings, grouped by what the quote waits for.
  if (native) return <NativeQuotesList items={items} total={meta.total} hasMore={meta.hasMore} busy={busy} error={error} canEdit={meta.canEdit}
    scope={scope} onScope={prefs.setScope} filter={filter} onFilter={setFilter} query={query} onQuery={setQuery} onMore={() => void more()}
    exportMenu={reduced ? undefined : <QuotesBulkExport items={items} />} />;
  return <div className="space-y-5" data-testid="quotes-list" data-view={prefs.view} data-scope={scope}>
    <PageHeader title="Offerter" description="Företagets offerter, med belopp exklusive moms. En skickad offert är låst. Vill du ändra den gör du en ny version."
      actions={<>{invoicingOn ? <Button asChild variant="outline"><Link href="/?view=invoice_bases" data-testid="quotes-invoice-bases"><Receipt />Fakturaunderlag</Link></Button> : null}
        <QuotesBulkExport items={items} />
        {meta.canEdit ? <Button asChild><Link href="/?view=quote" data-testid="quote-new"><Plus />Ny offert</Link></Button> : null}</>} />
    {error ? <p role="alert" className="notice text-destructive">{error}</p> : null}
    <ListFilterBar testId="quotes"
      scope={{ value: scope, scopes: SCOPES, onChange: prefs.setScope }}
      chips={{ label: "Status", chips: QUOTE_FILTERS.map((value) => ({ value, label: QUOTE_FILTER_LABELS[value], count: counts?.[value] ?? null })), value: filter, onChange: setFilter }}
      search={{ label: "Sök offert", placeholder: "Rubrik, kund, projekt eller nummer (O-12)…", value: query, onChange: setQuery }}
      sort={{ value: prefs.sort, options: SORT_OPTIONS, onChange: prefs.setSort }}
      view={{ value: prefs.view, onChange: prefs.setView }} />
    {/* The rows' grey shape in the list's frame while the first page is read (steg 6). */}
    {!items ? <DelayedSkeleton testId="quotes-loading"><div className="rounded-xl border bg-card px-3.5 py-3"><RowsSkeleton rows={7} label="Hämtar offerter…" /></div></DelayedSkeleton>
      : !items.length ? (filter === "open" && !query && scope === "all"
        ? <Empty title="Inga pågående offerter" description={meta.canEdit ? "Skapa en offert med material, arbete och övrigt. Priserna låses när den markeras som skickad." : "Här visas företagets offerter när de har skapats."} />
        : <div className="notice">Inget matchar urvalet. Ändra filter eller sökning.</div>)
      : <>
        {prefs.view === "cards" ? <ListCardGrid testId="quotes-cards" busy={busy}>{items.map((item) => <ListCard key={item.id} testId="quote-card" href={quoteHref(item)}
          icon={<AreaIcon area="quote" icon={FileText} />} title={item.title} subtitle={[item.label, item.customerName, item.projectName].filter(Boolean).join(" · ")}
          badges={<QuoteStatusPill item={item} />}
          facts={[
            { icon: CalendarClock, label: "Giltig till", value: item.validUntil ? `Giltig till ${item.validUntil}` : "Inget giltighetsdatum" },
            { icon: Wallet, label: "Summa exkl. moms", value: <span className="tabular-nums">{formatSek(item.net)} kr exkl. moms{item.unpriced ? ` · ${item.unpriced} utan pris` : ""}</span> },
          ]} />)}</ListCardGrid>
        : <div role="table" aria-label="Offerter" aria-busy={busy} className="overflow-hidden rounded-xl border bg-card shadow-xs" data-testid="quotes-table">
          <div role="row" className="hidden gap-x-3 bg-[var(--panel-header)] px-3.5 py-2.5 text-xs font-semibold text-muted-foreground md:grid md:grid-cols-[minmax(0,1fr)_9rem_8rem_8rem_2.5rem]">
            <span role="columnheader">Offert</span><span role="columnheader">Status</span><span role="columnheader">Giltig till</span><span role="columnheader" className="text-right">Summa exkl. moms</span><span role="columnheader"><span className="sr-only">Öppna</span></span>
          </div>
          <div role="rowgroup" className="divide-y">{items.map((item) => <Link key={item.id} role="row" href={quoteHref(item)} data-testid="quote-row"
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-3.5 py-3 text-sm transition-colors hover:bg-secondary/50 max-sm:px-4 md:grid-cols-[minmax(0,1fr)_9rem_8rem_8rem_2.5rem]">
            <span role="cell" className="flex min-w-0 items-center gap-3">
              <AreaIcon area="quote" icon={FileText} />
              <span className="min-w-0"><span className="block truncate font-semibold">{item.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{[item.label, item.customerName, item.projectName].filter(Boolean).join(" · ")}</span></span>
            </span>
            <span role="cell" className="max-md:order-3"><QuoteStatusPill item={item} column /></span>
            <span role="cell" className="text-xs text-muted-foreground max-md:order-4 max-md:text-right md:text-sm">{item.validUntil ? <><span className="md:hidden">Giltig till </span>{item.validUntil}</> : "–"}</span>
            <span role="cell" className="text-right tabular-nums max-md:order-2">{formatSek(item.net)} kr{item.unpriced ? <span className="block text-xs text-muted-foreground">{item.unpriced} utan pris</span> : null}</span>
            <span role="cell" className="hidden justify-end md:flex"><RowChevron /></span>
          </Link>)}</div>
        </div>}
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>Visar {items.length} av {meta.total}</span>
          {meta.hasMore ? <Button type="button" variant="outline" disabled={busy} onClick={() => void more()} data-testid="quotes-more">{busy ? <LoaderCircle className="animate-spin" /> : null}Visa fler</Button> : null}
        </div>
      </>}
  </div>;
}
