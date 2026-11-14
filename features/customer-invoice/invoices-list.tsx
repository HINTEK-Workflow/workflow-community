"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CalendarClock, FileText, Plus, Power, Receipt, Wallet } from "lucide-react";
import { RowChevron } from "@/components/row-chevron";
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
import { NoAccess, isDenied } from "@/features/quotes/no-access";
import { cn } from "@/lib/utils";
import { allowedFilter } from "@/lib/url-filters";
import { listSortOptions } from "@/lib/list-filter";
import { INVOICE_LIST_FILTER_LABELS, INVOICE_LIST_FILTERS, INVOICE_LIST_SORTS, INVOICE_PAYMENT_LABELS, signedSek, type InvoiceListFilter, type InvoicePage, type InvoicePaymentState } from "@/lib/customer-invoice/model";
import type { BlankInvoiceStart } from "@/features/invoice-basis/invoice-basis-view";
import { InvoiceViewPage } from "./invoice-view";

/**
 * Fakturor: the company's list (owner's decision 2026-11-04), newest number first, with what is overdue as a filter. A row opens the
 * invoice. An invoice is always made from a fakturaunderlag (one way, Lika är rätt 2026-11-14): Fakturaunderlag top right leads
 * there, where Nytt fakturaunderlag starts one from nothing. With the setting off the list has nothing to show and says so.
 */
type Page = InvoicePage & { denied?: boolean; off?: boolean };
const EMPTY = { items: [], total: 0, page: 1, pageSize: 25, canEdit: false, counts: null };
const SORT_OPTIONS = listSortOptions(INVOICE_LIST_SORTS);
const statusOf = (cause: unknown) => (cause as { status?: number } | null)?.status;
export const paymentTone = (state: InvoicePaymentState) => state === "PAID" ? "success" as const : state === "OVERDUE" ? "danger" as const : state === "UNPAID" ? "warning" as const : "neutral" as const;
export function PaymentPill({ state, column = false }: { state: InvoicePaymentState; column?: boolean }) {
  return <span className={cn("inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium", column && PILL_FIXED_WIDTH_MD, indicatorBadge(paymentTone(state)))} data-testid="invoice-state" data-state={state}>{INVOICE_PAYMENT_LABELS[state]}</span>;
}

/**
 * The way in from Fakturaunderlag; while invoicing is off, the company's admin is shown where it is turned on. With `onNew`
 * Nytt fakturaunderlag follows as the last button, for whoever may make invoices. En väg till en faktura (Lika är rätt,
 * 2026-11-14): it opens an empty basis at once, saved at its first change; Skapa faktura is a button in the basis.
 */
export function CustomerInvoicesLink({ onNew }: { onNew?: (start: BlankInvoiceStart) => void }) {
  const [on, setOn] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [offer, setOffer] = useState(false);
  useEffect(() => {
    let live = true;
    api<{ canEdit?: boolean }>("/api/customer-invoices?state=1", { cache: "no-store" }, { change: false }).then((state) => { if (live) { setOn(true); setCanEdit(state.canEdit === true); } }).catch(() => {
      if (!live) return;
      setOn(false);
      api<{ canTurnOn: boolean }>("/api/customer-invoices?offer=1", { cache: "no-store" }, { change: false }).then((next) => { if (live) setOffer(next.canTurnOn); }).catch(() => undefined);
    });
    return () => { live = false; };
  }, []);
  if (on) return <>
    <Button asChild variant="outline"><Link href="/?view=customer_invoices" data-testid="customer-invoices-link"><Receipt />Fakturor</Link></Button>
    {onNew && canEdit ? <Button type="button" onClick={() => onNew({ create: createStandalone })} data-testid="invoice-bases-new"><Plus />Nytt fakturaunderlag</Button> : null}
  </>;
  return offer ? <Button asChild variant="outline"><Link href="/?view=company#invoicing" data-testid="customer-invoices-turn-on"><Power />Slå på fakturering</Link></Button> : null;
}

/** A basis without a job or project, the start of an invoice from nothing (2026-11-05): the customer and the title may come later. */
const createStandalone = (input: { customerId: string | null; title: string }) =>
  api<{ id: string; label: string }>("/api/customer-invoices", { method: "POST", body: JSON.stringify({ action: "standalone", invoice: input }) });

export function CustomerInvoicesList({ personId = "" }: { personId?: string }) {
  const searchParams = useSearchParams();
  const [filter, setFilter] = useAddressEntryState<InvoiceListFilter>("customer-invoices.filter", "filter", (raw) => allowedFilter(raw, INVOICE_LIST_FILTERS), "all");
  const [query, setQuery] = useEntryState("customer-invoices.q", "");
  // The sort and Rader | Kort as on Fakturaunderlag (Lika är rätt, 2026-11-13), remembered on the device.
  const prefs = useListPrefs("customer-invoices", personId, { sorts: INVOICE_LIST_SORTS });
  const wanted = searchParams.get("invoice");
  const wantsSend = searchParams.get("send") === "1";
  const [openId, setOpenId] = useState<string | null>(wanted);
  // An invoice issued from the basis view on this page: the address changes, and the invoice opens over it.
  const [seen, setSeen] = useState(wanted);
  if (wanted !== seen) { setSeen(wanted); setOpenId(wanted); }
  const params = (page: number) => new URLSearchParams({ list: "1", status: filter, page: String(page), sort: prefs.sort, ...(query.trim() ? { q: query.trim() } : {}), ...(page === 1 ? { counts: "1" } : {}) });
  const key = `/api/customer-invoices?${params(1)}`;
  const read = useWorkspaceData<Page>(key, (signal) => api<Page>(key, { cache: "no-store", signal }).catch((cause: unknown) => {
    if (isDenied(cause)) return { ...EMPTY, denied: true };
    if (statusOf(cause) === 404) return { ...EMPTY, off: true };
    throw cause;
  }), { keepPrevious: true, delayMs: query ? 250 : 0, merge: keepLoadedPages });
  const [moreBusy, setMoreBusy] = useState(false);
  const items = read.data?.items ?? (read.error ? [] : null);
  const total = read.data?.total ?? 0;
  const more = async () => {
    setMoreBusy(true);
    try {
      const result = await api<Page>(`/api/customer-invoices?${params((read.data?.page ?? 1) + 1)}`, { cache: "no-store" });
      read.mutate((current) => current ? { ...result, counts: current.counts, items: [...current.items, ...result.items.filter((item) => !current.items.some((seen) => seen.id === item.id))] } : result);
    } finally { setMoreBusy(false); }
  };
  if (read.data?.denied) return <div className="space-y-5" data-testid="customer-invoices"><PageHeader title="Fakturor" /><NoAccess /></div>;
  if (read.data?.off) return <div className="space-y-5" data-testid="customer-invoices"><PageHeader title="Fakturor" /><div className="notice" data-testid="customer-invoices-off">Fakturering är inte påslagen för företaget.</div></div>;
  return <div className="space-y-5" data-testid="customer-invoices" data-view={prefs.view}>
    <PageHeader title="Fakturor" description="Fakturor som Workflow har utfärdat. En faktura görs från ett fakturaunderlag."
      actions={<Button asChild variant="outline"><Link href="/?view=invoice_bases" data-testid="customer-invoices-bases-link"><FileText />Fakturaunderlag</Link></Button>} />
    {read.error ? <p role="alert" className="notice text-destructive">{read.error}</p> : null}
    <ListFilterBar testId="customer-invoices"
      chips={{ label: "Status", chips: INVOICE_LIST_FILTERS.map((value) => ({ value, label: INVOICE_LIST_FILTER_LABELS[value], count: read.data?.counts?.[value] ?? null })), value: filter, onChange: setFilter }}
      search={{ label: "Sök fakturor", placeholder: "Nummer, rubrik eller kund…", value: query, onChange: setQuery }}
      sort={{ value: prefs.sort, options: SORT_OPTIONS, onChange: prefs.setSort }}
      view={{ value: prefs.view, onChange: prefs.setView }} />
    {!items ? <DelayedSkeleton testId="customer-invoices-loading"><div className="rounded-xl border bg-card px-3.5 py-3"><RowsSkeleton rows={7} label="Hämtar fakturor…" /></div></DelayedSkeleton>
      : !items.length ? (filter === "all" && !query ? <Empty title="Inga fakturor än" description="Utfärdade fakturor visas här. Du gör en faktura från ett fakturaunderlag." /> : <div className="notice">Inget matchar urvalet. Ändra filter eller sökning.</div>)
      : <>
        {prefs.view === "cards" ? <ListCardGrid testId="customer-invoices-cards" busy={read.fetching}>{items.map((item) => <ListCard key={item.id} testId="customer-invoices-card" onOpen={() => setOpenId(item.id)}
          icon={<AreaIcon area="quote" icon={Receipt} />} title={`${item.label} · ${item.title}`} subtitle={[item.buyerName, item.issuedOn].filter(Boolean).join(" · ")}
          badges={<PaymentPill state={item.state} />}
          facts={[
            item.dueOn ? { icon: CalendarClock, label: "Förfaller", value: item.dueOn } : null,
            { icon: Wallet, label: "Belopp", value: <span className="tabular-nums">{signedSek(item.toPay)} kr</span> },
          ]} />)}</ListCardGrid>
        : <div role="table" aria-label="Fakturor" aria-busy={read.fetching} className="overflow-hidden rounded-xl border bg-card shadow-xs" data-testid="customer-invoices-table">
          <div role="row" className="hidden gap-x-3 bg-[var(--panel-header)] px-3.5 py-2.5 text-xs font-semibold text-muted-foreground md:grid md:grid-cols-[minmax(0,1fr)_7rem_8rem_8rem_2.5rem]">
            <span role="columnheader">Faktura</span><span role="columnheader">Förfaller</span><span role="columnheader">Status</span><span role="columnheader" className="text-right">Belopp</span><span role="columnheader"><span className="sr-only">Öppna</span></span>
          </div>
          <div role="rowgroup" className="divide-y">{items.map((item) => <button key={item.id} type="button" role="row" onClick={() => setOpenId(item.id)} data-testid="customer-invoices-row"
            className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-3.5 py-3 text-left text-sm transition-colors hover:bg-secondary/50 max-sm:px-4 md:grid-cols-[minmax(0,1fr)_7rem_8rem_8rem_2.5rem]">
            <span role="cell" className="flex min-w-0 items-center gap-3">
              <AreaIcon area="quote" icon={Receipt} />
              <span className="min-w-0"><span className="block truncate font-semibold">{item.label} · {item.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{[item.buyerName, item.issuedOn].filter(Boolean).join(" · ")}</span></span>
            </span>
            <span role="cell" className="tabular-nums max-md:order-3 max-md:text-xs max-md:text-muted-foreground">{item.dueOn ?? ""}</span>
            <span role="cell" className="max-md:order-4 max-md:justify-self-end"><PaymentPill state={item.state} column /></span>
            <span role="cell" className="text-right tabular-nums max-md:order-2">{signedSek(item.toPay)} kr</span>
            <span role="cell" className="hidden justify-end md:flex"><RowChevron /></span>
          </button>)}</div>
        </div>}
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>Visar {items.length} av {total}</span>
          {items.length < total ? <Button type="button" variant="outline" disabled={moreBusy} onClick={() => void more()} data-testid="customer-invoices-more">Visa fler</Button> : null}
        </div>
      </>}
    {openId ? <InvoiceViewPage id={openId} startSend={wantsSend && openId === wanted} onClose={() => setOpenId(null)} onChanged={() => void read.reload()} onOpen={setOpenId} /> : null}
  </div>;
}
