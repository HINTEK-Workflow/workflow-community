"use client";

import { AreaIcon } from "@/components/area-icon";
import { RowChevron } from "@/components/row-chevron";
import Link from "next/link";
import { useState } from "react";
import { FolderKanban, LoaderCircle, Package, PackageCheck, Plus, ShoppingCart, Truck, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-shell";
import { ListCard, ListCardGrid, ListFilterBar, useListPrefs } from "@/components/list-filter-bar";
import { useEntryState } from "@/components/history-nav";
import { useAddressEntryState } from "@/components/use-address-filter";
import { api } from "@/features/kfid/api";
import { keepLoadedPages, useWorkspaceData } from "@/features/kfid/use-workspace-data";
import { DelayedSkeleton, RowsSkeleton } from "@/components/skeleton";
import { Empty } from "@/features/kfid/ui";
import { isDenied, NoAccess } from "@/features/quotes/no-access";
import { indicatorBadge, PILL_FIXED_WIDTH_MD } from "@/features/workflow/indicator-tone";
import { purchaseStatusTone } from "@/features/purchases/purchase-editor";
import { purchaseName, PURCHASE_FILTER_LABELS, PURCHASE_FILTERS, PURCHASE_SORTS, PURCHASE_STATUS_LABELS, type PurchaseFilter, type PurchaseListItem } from "@/lib/purchases/model";
import { formatSek } from "@/lib/workflow/expenses";
import { listSortOptions } from "@/lib/list-filter";
import { allowedFilter } from "@/lib/url-filters";
import type { WorkListScope } from "@/lib/workflow/work-list";
import { cn } from "@/lib/utils";
import { useNativeMode } from "@/features/workflow/use-detail-level";
import { NativePurchasesList } from "@/features/purchases/native-purchases";

/**
 * Mina inköp (2026-10-16): the company's purchases, read 20 at a time ("Visa fler"), with the shared toppvisning
 * (2026-10-31): Mina / Alla and the status chips with counts, a search on name, project and number (I-7), the sort
 * and Rader | Kort. The same list layout as Mina offerter: status, suppliers, delivered lines and the purchase sum (excl.
 * VAT, only for those who may see prices) in fixed columns.
 */
type Page = { items: PurchaseListItem[]; total: number; page: number; hasMore: boolean; canEdit: boolean; denied?: boolean; counts?: Record<PurchaseFilter, number> | null };
/** A 403 kept as an answer: the person may not read purchases (decision 6, the box). */
const DENIED: Page = { items: [], total: 0, page: 1, hasMore: false, canEdit: false, denied: true };
const SCOPES: readonly WorkListScope[] = ["mine", "all"];
const SORT_OPTIONS = listSortOptions(PURCHASE_SORTS);

const purchaseHref = (item: PurchaseListItem) => `/?view=purchase&purchaseId=${encodeURIComponent(item.id)}`;
const purchaseLine = (item: PurchaseListItem) => [item.title.trim() ? item.label : "", item.suppliers.join(", "), item.project?.name, item.workOrder?.title].filter(Boolean).join(" · ");
const deliveredText = (item: PurchaseListItem) => item.status === "ORDERED" || item.status === "DELIVERED" ? `${item.delivered} av ${item.lines}` : "";
const amountText = (item: PurchaseListItem) => item.amount === null || item.amount === 0 ? "" : `${formatSek(item.amount)} kr`;
function PurchaseStatusPill({ item, column = false }: { item: PurchaseListItem; column?: boolean }) {
  return <span className={cn("inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium", column && PILL_FIXED_WIDTH_MD, indicatorBadge(purchaseStatusTone(item.status)))}>{PURCHASE_STATUS_LABELS[item.status]}</span>;
}

export function PurchasesList({ personId }: { personId: string }) {
  // Mina / Alla (Mina first, as before), the sort and Rader | Kort are remembered per person on the device.
  const prefs = useListPrefs("purchases", personId, { sorts: PURCHASE_SORTS, scopes: SCOPES, scope: "mine" });
  const scope = prefs.scope ?? "mine";
  // The filter may come from the address (`&filter=`, lib/url-filters.ts) and is kept per history entry for Bakåt, as the search.
  const [filter, setFilter] = useAddressEntryState<PurchaseFilter>("purchases.filter", "filter", (raw) => allowedFilter(raw, PURCHASE_FILTERS), "open");
  const [query, setQuery] = useEntryState("purchases.q", "");
  const native = useNativeMode();
  // Steg 7 (stabil sidladdning): the first page through the workspace's memory cache (Bakåt shows the rows at once, with the
  // pages Visa fler added), read again meanwhile; a new choice keeps the old rows (aria-busy) until its answer comes.
  const params = (page: number) => new URLSearchParams({ filter, page: String(page), sort: prefs.sort, ...(scope === "mine" ? { mine: "1" } : {}), ...(query.trim() ? { q: query.trim() } : {}), ...(page === 1 ? { counts: "1" } : {}) });
  const key = `/api/purchases?${params(1)}`;
  const read = useWorkspaceData<Page>(key, (signal) => api<Page>(key, { cache: "no-store", signal }).catch((cause: unknown) => { if (isDenied(cause)) return DENIED; throw cause; }), { keepPrevious: true, delayMs: query ? 250 : 0, merge: keepLoadedPages });
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState("");
  const items = read.data?.items ?? (read.error ? [] : null);
  const meta = read.data ? { total: read.data.total, page: read.data.page, hasMore: read.data.items.length < read.data.total, canEdit: read.data.canEdit } : { total: 0, page: 1, hasMore: false, canEdit: true };
  const counts = read.data?.counts ?? null;
  const busy = read.fetching || moreBusy;
  const error = moreError || read.error;
  const denied = Boolean(read.data?.denied);
  const more = async () => {
    setMoreBusy(true);
    try {
      const result = await api<Page>(`/api/purchases?${params(meta.page + 1)}`, { cache: "no-store" });
      read.mutate((current) => current ? { ...result, counts: current.counts, items: [...current.items, ...result.items.filter((item) => !current.items.some((seen) => seen.id === item.id))] } : result);
      setMoreError("");
    } catch (cause) { setMoreError((cause as Error).message); } finally { setMoreBusy(false); }
  };
  if (denied) return <div className="space-y-5" data-testid="purchases-list"><PageHeader title="Inköp" /><NoAccess /></div>;
  // Nivå 1 på mobil (Lika är rätt, 2026-11-14): the app screen, as Offerter has.
  if (native) return <NativePurchasesList items={items} total={meta.total} hasMore={meta.hasMore} busy={busy} error={error} canEdit={meta.canEdit}
    scope={scope} onScope={prefs.setScope} filter={filter} onFilter={setFilter} query={query} onQuery={setQuery} onMore={() => void more()} />;
  return <div className="space-y-5" data-testid="purchases-list" data-view={prefs.view} data-scope={scope}>
    <PageHeader title="Inköp" description="Inköp och underlag från en eller flera grossister. Belopp är inköpspris exklusive moms."
      actions={<><Button asChild variant="outline"><Link href="/?view=articles"><Package />Artiklar</Link></Button>
        {meta.canEdit ? <Button asChild><Link href="/?view=purchase" data-testid="purchase-new"><Plus />Nytt inköp</Link></Button> : null}</>} />
    {error ? <p role="alert" className="notice text-destructive">{error}</p> : null}
    <ListFilterBar testId="purchases"
      scope={{ value: scope, scopes: SCOPES, onChange: prefs.setScope }}
      chips={{ label: "Status", chips: PURCHASE_FILTERS.map((value) => ({ value, label: PURCHASE_FILTER_LABELS[value], count: counts?.[value] ?? null })), value: filter, onChange: setFilter }}
      search={{ label: "Sök inköp", placeholder: "Namn, projekt eller nummer (I-7)…", value: query, onChange: setQuery }}
      sort={{ value: prefs.sort, options: SORT_OPTIONS, onChange: prefs.setSort }}
      view={{ value: prefs.view, onChange: prefs.setView }} />
    {/* The rows' grey shape in the list's frame while the first page is read (steg 6), the same grey as every skeleton. */}
    {!items ? <DelayedSkeleton testId="purchases-loading"><div className="rounded-xl border bg-card px-3.5 py-3"><RowsSkeleton rows={7} label="Hämtar inköp…" /></div></DelayedSkeleton>
      : !items.length ? (filter === "open" && !query
        ? <Empty title="Inga pågående inköp" description="Sök artiklar under Artiklar eller skapa ett nytt inköp. Det kan bli offertrader, material eller en beställning." />
        : <div className="notice">Inget matchar urvalet. Ändra filter eller sökning.</div>)
      : <>
        {prefs.view === "cards" ? <ListCardGrid testId="purchases-cards" busy={busy}>{items.map((item) => <ListCard key={item.id} testId="purchase-card" href={purchaseHref(item)}
          icon={<AreaIcon area="purchase" icon={ShoppingCart} />} title={purchaseName(item)} subtitle={[item.title.trim() ? item.label : "", item.suppliers.join(", ")].filter(Boolean).join(" · ")}
          badges={<PurchaseStatusPill item={item} />}
          facts={[
            (item.project || item.workOrder) ? { icon: FolderKanban, label: "Projekt och arbetsorder", value: [item.project?.name, item.workOrder?.title].filter(Boolean).join(" · ") } : null,
            deliveredText(item) ? { icon: PackageCheck, label: "Har kommit", value: `Har kommit ${deliveredText(item)}` } : { icon: Truck, label: "Rader", value: `${item.lines} ${item.lines === 1 ? "rad" : "rader"}` },
            amountText(item) ? { icon: Wallet, label: "Inköp exkl. moms", value: <span className="tabular-nums">{amountText(item)} exkl. moms</span> } : null,
          ]} />)}</ListCardGrid>
        : <div role="table" aria-label="Inköp" aria-busy={busy} className="overflow-hidden rounded-xl border bg-card shadow-xs" data-testid="purchases-table">
          <div role="row" className="hidden gap-x-3 bg-[var(--panel-header)] px-3.5 py-2.5 text-xs font-semibold text-muted-foreground md:grid md:grid-cols-[minmax(0,1fr)_8rem_7rem_8rem_2.5rem]">
            <span role="columnheader">Inköp</span><span role="columnheader">Status</span><span role="columnheader">Har kommit</span><span role="columnheader" className="text-right">Inköp exkl. moms</span><span role="columnheader"><span className="sr-only">Öppna</span></span>
          </div>
          <div role="rowgroup" className="divide-y">{items.map((item) => <Link key={item.id} role="row" href={purchaseHref(item)} data-testid="purchase-row"
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-3.5 py-3 text-sm transition-colors hover:bg-secondary/50 md:grid-cols-[minmax(0,1fr)_8rem_7rem_8rem_2.5rem]">
            <span role="cell" className="flex min-w-0 items-center gap-3">
              <AreaIcon area="purchase" icon={ShoppingCart} />
              <span className="min-w-0"><span className="block truncate font-semibold">{purchaseName(item)}</span>
                <span className="block truncate text-xs text-muted-foreground">{purchaseLine(item)}</span></span>
            </span>
            <span role="cell" className="max-md:order-3"><PurchaseStatusPill item={item} column /></span>
            <span role="cell" className="text-xs text-muted-foreground max-md:order-4 max-md:text-right md:text-sm">{deliveredText(item) || "–"}</span>
            <span role="cell" className="text-right tabular-nums max-md:order-2">{item.amount === null ? <span className="text-xs text-muted-foreground" data-testid="purchase-price-hidden">Pris dolt</span> : amountText(item) || "–"}</span>
            <span role="cell" className="hidden justify-end md:flex"><RowChevron /></span>
          </Link>)}</div>
        </div>}
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>Visar {items.length} av {meta.total}</span>
          {meta.hasMore ? <Button type="button" variant="outline" disabled={busy} onClick={() => void more()} data-testid="purchases-more">{busy ? <LoaderCircle className="animate-spin" /> : null}Visa fler</Button> : null}
        </div>
      </>}
  </div>;
}
