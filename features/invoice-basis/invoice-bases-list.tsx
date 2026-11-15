"use client";

import { useState } from "react";
import { RowChevron } from "@/components/row-chevron";
import { FolderKanban, LoaderCircle, Receipt, Wallet } from "lucide-react";
import { AreaIcon } from "@/components/area-icon";
import { Button } from "@/components/ui/button";
import { DelayedSkeleton, RowsSkeleton } from "@/components/skeleton";
import { PageHeader } from "@/components/page-shell";
import { ListCard, ListCardGrid, ListFilterBar, useListPrefs } from "@/components/list-filter-bar";
import { useEntryState } from "@/components/history-nav";
import { useAddressEntryState } from "@/components/use-address-filter";
import { api } from "@/features/kfid/api";
import { Empty } from "@/features/kfid/ui";
import { keepLoadedPages, useWorkspaceData } from "@/features/kfid/use-workspace-data";
import { indicatorBadge, PILL_FIXED_WIDTH_MD } from "@/features/workflow/indicator-tone";
import { isDenied, NoAccess } from "@/features/quotes/no-access";
import { cn } from "@/lib/utils";
import { formatSek } from "@/lib/workflow/expenses";
import { listSortOptions } from "@/lib/list-filter";
import { allowedFilter } from "@/lib/url-filters";
import type { WorkListScope } from "@/lib/workflow/work-list";
import { INVOICE_BASIS_FILTER_LABELS, INVOICE_BASIS_FILTERS, INVOICE_BASIS_SORTS, invoiceBasisStatusText, type InvoiceBasisFilter, type InvoiceBasisPage, type InvoiceBasisRow } from "@/lib/invoice-basis/model";
import { InvoiceBasisModal, invoiceDay, statusTone, type InvoiceBasisTarget } from "./invoice-basis-view";
import type { ProjectItem } from "@/features/kfid/types";
import { clientExtensions } from "@ee/client";

const { CustomerInvoicesLink } = clientExtensions;

/**
 * Fakturaunderlag – the company's list (2026-10-28: "en samlad lista över fakturaunderlag"), with the shared
 * toppvisning (2026-10-31): Mina (the bases I made) / Alla, the status chips with counts (a status from the address,
 * &filter=DRAFT|INVOICED, lib/url-filters.ts), a search, the sort and Rader | Kort; 25 at a time with Visa fler. A row or
 * card opens the existing basis view (the same as on the job's and project's panel), where it is changed, exported,
 * marked as invoiced or deleted. New bases are made on a finished work order or a project (or from Ekonomi's
 * Ofakturerad tid), and with invoicing on Nytt fakturaunderlag (top right) opens an empty basis at once, saved at its first
 * change – the one way to start an invoice (Lika är rätt, 2026-11-14). The server decides who sees what (Offerter – läsa and the job's or project's own right).
 */
type Page = InvoiceBasisPage & { denied?: boolean };
const DENIED: Page = { items: [], total: 0, page: 1, pageSize: 25, hasMore: false, canEdit: false, denied: true };
const SCOPES: readonly WorkListScope[] = ["mine", "all"];
const SORT_OPTIONS = listSortOptions(INVOICE_BASIS_SORTS);

function BasisStatusPill({ item, column = false }: { item: InvoiceBasisRow; column?: boolean }) {
  return <span className={cn("inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium", column && PILL_FIXED_WIDTH_MD, indicatorBadge(statusTone(item.status)))}>{invoiceBasisStatusText(item, invoiceDay)}</span>;
}

export function InvoiceBasesList({ personId = "", projects = [] }: { personId?: string; /** For a new basis that may choose its project. */ projects?: ProjectItem[] }) {
  // Mina / Alla (Alla first, as before), the sort and Rader | Kort remembered per person on the device.
  const prefs = useListPrefs("invoice-bases", personId, { sorts: INVOICE_BASIS_SORTS, scopes: SCOPES, scope: "all" });
  const scope = prefs.scope ?? "all";
  const [filter, setFilter] = useAddressEntryState<InvoiceBasisFilter>("invoice-bases.filter", "filter", (raw) => allowedFilter(raw, INVOICE_BASIS_FILTERS), "all");
  const [query, setQuery] = useEntryState("invoice-bases.q", "");
  const [target, setTarget] = useState<InvoiceBasisTarget | null>(null);
  const params = (page: number) => new URLSearchParams({ list: "1", status: filter, page: String(page), sort: prefs.sort, ...(scope === "mine" ? { mine: "1" } : {}), ...(query.trim() ? { q: query.trim() } : {}), ...(page === 1 ? { counts: "1" } : {}) });
  const key = `/api/invoice-bases?${params(1)}`;
  const read = useWorkspaceData<Page>(key, (signal) => api<Page>(key, { cache: "no-store", signal }).catch((cause: unknown) => { if (isDenied(cause)) return DENIED; throw cause; }), { keepPrevious: true, delayMs: query ? 250 : 0, merge: keepLoadedPages });
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState("");
  const items = read.data?.items ?? (read.error ? [] : null);
  const meta = read.data ? { total: read.data.total, page: read.data.page, hasMore: read.data.items.length < read.data.total } : { total: 0, page: 1, hasMore: false };
  const counts = read.data?.counts ?? null;
  const busy = read.fetching || moreBusy;
  const error = moreError || read.error;
  const more = async () => {
    setMoreBusy(true);
    try {
      const result = await api<Page>(`/api/invoice-bases?${params(meta.page + 1)}`, { cache: "no-store" });
      read.mutate((current) => current ? { ...result, counts: current.counts, items: [...current.items, ...result.items.filter((item) => !current.items.some((seen) => seen.id === item.id))] } : result);
      setMoreError("");
    } catch (cause) { setMoreError((cause as Error).message); } finally { setMoreBusy(false); }
  };
  if (read.data?.denied) return <div className="space-y-5" data-testid="invoice-bases-list"><PageHeader title="Fakturaunderlag" /><NoAccess /></div>;
  return <div className="space-y-5" data-testid="invoice-bases-list" data-view={prefs.view} data-scope={scope}>
    <PageHeader title="Fakturaunderlag" description="Belopp exkl. moms. Fakturerat betyder fakturerat i Workflow eller markerat som fakturerat utanför." actions={CustomerInvoicesLink ? <CustomerInvoicesLink onNew={(start) => setTarget({ blank: start })} /> : undefined} />
    {error ? <p role="alert" className="notice text-destructive">{error}</p> : null}
    <ListFilterBar testId="invoice-bases"
      scope={{ value: scope, scopes: SCOPES, onChange: prefs.setScope }}
      chips={{ label: "Status", chips: INVOICE_BASIS_FILTERS.map((value) => ({ value, label: INVOICE_BASIS_FILTER_LABELS[value], count: counts?.[value] ?? null })), value: filter, onChange: setFilter }}
      search={{ label: "Sök fakturaunderlag", placeholder: "Rubrik, kund, projekt eller nummer (F-12)…", value: query, onChange: setQuery }}
      sort={{ value: prefs.sort, options: SORT_OPTIONS, onChange: prefs.setSort }}
      view={{ value: prefs.view, onChange: prefs.setView }} />
    {!items ? <DelayedSkeleton testId="invoice-bases-loading"><div className="rounded-xl border bg-card px-3.5 py-3"><RowsSkeleton rows={7} label="Hämtar fakturaunderlag…" /></div></DelayedSkeleton>
      : !items.length ? (filter === "all" && !query && scope === "all"
        ? <Empty title="Inga fakturaunderlag än" description="Du skapar ett underlag på en färdig arbetsorder eller ett projekt." />
        : <div className="notice">Inget matchar urvalet. Ändra filter eller sökning.</div>)
      : <>
        {prefs.view === "cards" ? <ListCardGrid testId="invoice-bases-cards" busy={busy}>{items.map((item) => <ListCard key={item.id} testId="invoice-bases-card" onOpen={() => setTarget({ id: item.id })}
          icon={<AreaIcon area="quote" icon={Receipt} />} title={item.title} subtitle={[item.label, item.customerName].filter(Boolean).join(" · ")}
          badges={<BasisStatusPill item={item} />}
          facts={[
            item.subjectTitle ? { icon: FolderKanban, label: item.scope === "project" ? "Projekt" : "Arbetsorder", value: item.subjectTitle } : null,
            { icon: Wallet, label: "Summa exkl. moms", value: <span className="tabular-nums">{formatSek(item.net)} kr exkl. moms{item.unpriced ? ` · ${item.unpriced} utan pris` : ""}</span> },
          ]} />)}</ListCardGrid>
        : <div role="table" aria-label="Fakturaunderlag" aria-busy={busy} className="overflow-hidden rounded-xl border bg-card shadow-xs" data-testid="invoice-bases-table">
          <div role="row" className="hidden gap-x-3 bg-[var(--panel-header)] px-3.5 py-2.5 text-xs font-semibold text-muted-foreground md:grid md:grid-cols-[minmax(0,1fr)_10rem_8rem_2.5rem]">
            <span role="columnheader">Underlag</span><span role="columnheader">Status</span><span role="columnheader" className="text-right">Summa exkl. moms</span><span role="columnheader"><span className="sr-only">Öppna</span></span>
          </div>
          <div role="rowgroup" className="divide-y">{items.map((item) => <button key={item.id} type="button" role="row" onClick={() => setTarget({ id: item.id })} data-testid="invoice-bases-row"
            className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-3.5 py-3 text-left text-sm transition-colors hover:bg-secondary/50 max-sm:px-4 md:grid-cols-[minmax(0,1fr)_10rem_8rem_2.5rem]">
            <span role="cell" className="flex min-w-0 items-center gap-3">
              <AreaIcon area="quote" icon={Receipt} />
              <span className="min-w-0"><span className="block truncate font-semibold">{item.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{[item.label, item.customerName, item.subjectTitle].filter(Boolean).join(" · ")}</span></span>
            </span>
            <span role="cell" className="max-md:order-3"><BasisStatusPill item={item} column /></span>
            <span role="cell" className="text-right tabular-nums max-md:order-2">{formatSek(item.net)} kr{item.unpriced ? <span className="block text-xs text-muted-foreground">{item.unpriced} utan pris</span> : null}</span>
            <span role="cell" className="hidden justify-end md:flex"><RowChevron /></span>
          </button>)}</div>
        </div>}
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>Visar {items.length} av {meta.total}</span>
          {meta.hasMore ? <Button type="button" variant="outline" disabled={busy} onClick={() => void more()} data-testid="invoice-bases-more">{busy ? <LoaderCircle className="animate-spin" /> : null}Visa fler</Button> : null}
        </div>
      </>}
    <InvoiceBasisModal target={target} open={Boolean(target)} projects={projects} onClose={() => setTarget(null)} onChanged={() => void read.reload()} />
  </div>;
}
