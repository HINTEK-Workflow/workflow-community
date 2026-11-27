"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, Download, FileText, MapPinHouse, Pencil, RotateCcw, Trash2, UserRound, Users } from "lucide-react";
import { AreaIcon } from "@/components/area-icon";
import { useEntryState } from "@/components/history-nav";
import { ListCard, ListCardGrid, ListFilterBar, useListPrefs } from "@/components/list-filter-bar";
import { ListEmpty, ListGroup, ListRow, NativeLargeTitle, NativePage, useNativeTopBar } from "@/components/native";
import { PageHeader } from "@/components/page-shell";
import { DelayedSkeleton } from "@/components/skeleton";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { RemoveButton } from "@/components/ui/remove-button";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { Empty, RowsSkeleton } from "@/features/kfid/ui";
import { useNativeMode } from "@/features/workflow/use-detail-level";
import { formatSwedish } from "@/lib/swedish-time";
import { useLoadEffect } from "@/lib/use-load-effect";
import { announce } from "@/lib/workflow/toast";
import { customerPlaceHref } from "@/lib/workflow/navigation";
import {
  DOCUMENT_FILTER_LABEL, DOCUMENT_FILTERS, DOCUMENT_PAGE, DOCUMENT_SCAN_PILL, DOCUMENT_SCAN_TONE, DOCUMENT_SORT_LABEL, DOCUMENT_SORTS, documentKindLabel, documentSizeLabel,
  type DocumentFilter, type DocumentSort, type DocumentView,
} from "@/lib/documents/model";
import { DocumentScanPill, downloadDocument, RenameDialog, type DocumentListing } from "./documents-panel";

/**
 * Mer › Dokument (0.87.0): every document of the company's customers and their places in one list, built as the other lists
 * (docs/ui-system.md 2, Lista; the top as Kunder): PageHeader, the shared filter row – Alla | Väntar på virussökning | Papperskorg
 * with counts, the search, Kund and Anläggning, the sort and Rader | Kort – then rows or cards and Visa fler. A document is added on
 * the customer's or the place's tab Dokument, where it belongs; here it is found, downloaded, renamed, removed and restored. The
 * server decides every call (lib/documents/server.ts).
 */
type Facets = { customers: { id: string; name: string }[]; places: { id: string; name: string }[] };
const DAY = { dateStyle: "medium" } as const;
const customerHref = (item: DocumentView) => item.placeId ? customerPlaceHref(item.customerId, item.placeId) : `/?view=customers&customerId=${encodeURIComponent(item.customerId)}`;
const metaLine = (item: DocumentView) => [documentKindLabel(item.name), documentSizeLabel(item.size), item.uploadedBy, formatSwedish(item.createdAt, DAY)].filter(Boolean).join(" · ");
const whereLine = (item: DocumentView) => [item.customerName, item.placeName].filter(Boolean).join(" › ");

export function DocumentsPage({ personId }: { personId: string }) {
  const native = useNativeMode();
  const prefs = useListPrefs("documents", personId, { sorts: DOCUMENT_SORTS });
  const [filter, setFilter] = useEntryState<DocumentFilter>("documents.filter", "all");
  const [query, setQuery] = useEntryState("documents.q", "");
  const [customerId, setCustomerId] = useEntryState("documents.customer", "");
  const [placeId, setPlaceId] = useEntryState("documents.place", "");
  const [search, setSearch] = useState(query.trim());
  const [listing, setListing] = useState<DocumentListing | null>(null);
  const [facets, setFacets] = useState<Facets>({ customers: [], places: [] });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pages, setPages] = useState(1);
  const [renaming, setRenaming] = useState<DocumentView | null>(null);
  const [confirm, confirmElement] = useConfirm();

  useEffect(() => { const timer = window.setTimeout(() => setSearch(query.trim()), 300); return () => window.clearTimeout(timer); }, [query]);
  const sort = prefs.sort as DocumentSort;
  const address = useCallback((upTo: number) => `/api/documents?${new URLSearchParams({
    filter, sort, limit: String(Math.min(100, upTo * DOCUMENT_PAGE)),
    ...(search ? { q: search } : {}), ...(customerId ? { customerId } : {}), ...(customerId && placeId ? { placeId } : {}),
  })}`, [filter, sort, search, customerId, placeId]);
  const load = useCallback(async (upTo = 1) => {
    try { setListing(await api<DocumentListing>(address(upTo), { cache: "no-store" })); setError(""); }
    catch (cause) { setError((cause as Error).message); }
  }, [address]);
  useLoadEffect(load);
  const loadFacets = useCallback(async () => {
    try { setFacets(await api<Facets>(`/api/documents?facets=1${customerId ? `&customerId=${encodeURIComponent(customerId)}` : ""}`, { cache: "no-store" })); } catch { /* the filter stays as it was */ }
  }, [customerId]);
  useLoadEffect(loadFacets);
  const more = () => { const next = pages + 1; setPages(next); void load(next); };

  const act = async (run: () => Promise<unknown>, done: string, undo?: () => void) => {
    setBusy(true);
    try { await run(); announce(done, false, undo ? [{ label: "Ångra", run: undo }] : undefined); }
    catch (cause) { announce((cause as Error).message, true); }
    finally { setBusy(false); await load(pages); void loadFacets(); }
  };
  const restore = (item: DocumentView) => act(() => api(`/api/documents/${encodeURIComponent(item.id)}`, { method: "PATCH", body: JSON.stringify({ action: "restore" }) }), "Dokumentet är återställt.");
  const trash = async (item: DocumentView) => {
    if (!(await confirm({ title: "Flytta dokumentet till papperskorgen?", message: `${item.name} kan återställas från papperskorgen.`, confirmLabel: "Flytta till papperskorgen", tone: "danger" }))) return;
    await act(() => api(`/api/documents/${encodeURIComponent(item.id)}`, { method: "DELETE" }), "Dokumentet ligger i papperskorgen.", () => void restore(item));
  };
  const purge = async (item: DocumentView) => {
    if (!(await confirm({ title: "Ta bort dokumentet för gott?", message: `${item.name} och filen tas bort. Det går inte att ångra.`, confirmLabel: "Ta bort för gott", tone: "danger" }))) return;
    await act(() => api(`/api/documents/${encodeURIComponent(item.id)}?permanent=1`, { method: "DELETE" }), "Dokumentet är borttaget.");
  };

  const canEdit = Boolean(listing?.canEdit);
  const shownFilter: DocumentFilter = canEdit ? filter : filter === "trash" ? "all" : filter;
  const items = listing?.items ?? [];
  const counts = listing?.counts;
  const chips = { label: "Visa dokument", value: shownFilter, onChange: (value: DocumentFilter) => { setFilter(value); setPages(1); }, testId: "documents-chips",
    chips: DOCUMENT_FILTERS.filter((key) => key !== "trash" || canEdit).map((key) => ({ value: key, label: DOCUMENT_FILTER_LABEL[key], count: counts ? key === "all" ? counts.all : key === "pending" ? counts.pending : counts.trash : null })) };
  const customerOptions = useMemo(() => [{ value: "", label: "Alla kunder" }, ...facets.customers.map((item) => ({ value: item.id, label: item.name }))], [facets.customers]);
  const placeOptions = useMemo(() => [{ value: "", label: "Alla anläggningar" }, ...facets.places.map((item) => ({ value: item.id, label: item.name }))], [facets.places]);
  const extras = [
    { key: "customer", label: "Kund", value: customerId, options: customerOptions, onChange: (value: string) => { setCustomerId(value); setPlaceId(""); setPages(1); }, testId: "documents-customer" },
    ...(customerId ? [{ key: "place", label: "Anläggning", value: placeId, options: placeOptions, onChange: (value: string) => { setPlaceId(value); setPages(1); }, testId: "documents-place" }] : []),
  ];
  const filterBar = <ListFilterBar testId="documents-filter" label="Sök och filtrera dokument" chips={chips}
    search={{ label: "Sök dokument", placeholder: "Sök på namn, kund eller anläggning", value: query, onChange: (value) => { setQuery(value); setPages(1); }, testId: "documents-search" }}
    extras={extras}
    sort={{ value: sort, options: DOCUMENT_SORTS.map((value) => ({ value, label: DOCUMENT_SORT_LABEL[value] })), onChange: (value) => { prefs.setSort(value); setPages(1); } }}
    view={{ value: prefs.view, onChange: prefs.setView }} />;
  const filtered = Boolean(search || customerId);
  const emptyText = filtered ? "Inget dokument matchar urvalet" : shownFilter === "trash" ? "Papperskorgen är tom" : shownFilter === "pending" ? "Inget väntar på virussökning" : "Inga dokument ännu";
  const rename = renaming ? <RenameDialog item={renaming} onClose={() => setRenaming(null)} onSaved={() => { setRenaming(null); void load(pages); }} /> : null;
  const inTrash = shownFilter === "trash";
  const rowActions = (item: DocumentView) => inTrash ? <>
    {canEdit ? <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void restore(item)} data-testid="document-restore"><RotateCcw aria-hidden="true" />Återställ</Button> : null}
    {listing?.canPurge ? <IconButton label={`Ta bort ${item.name} för gott`} title="Ta bort för gott" disabled={busy} className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => void purge(item)} data-testid="document-purge"><Trash2 aria-hidden="true" /></IconButton> : null}
  </> : <>
    <IconButton label={`Ladda ner ${item.name}`} title="Ladda ner" disabled={!item.downloadable} onClick={() => downloadDocument(item)} data-testid="document-download"><Download aria-hidden="true" /></IconButton>
    {canEdit ? <IconButton label={`Byt namn på ${item.name}`} title="Byt namn" disabled={busy} onClick={() => setRenaming(item)} data-testid="document-rename"><Pencil aria-hidden="true" /></IconButton> : null}
    {canEdit ? <RemoveButton label={`Ta bort ${item.name}`} disabled={busy} onClick={() => void trash(item)} data-testid="document-remove" /> : null}
  </>;
  // On the phone a tap on the row downloads, so the row keeps only Byt namn and Ta bort (or Återställ in the papperskorg).
  const nativeActions = (item: DocumentView) => inTrash ? rowActions(item) : <>
    <IconButton label={`Byt namn på ${item.name}`} title="Byt namn" disabled={busy} onClick={() => setRenaming(item)} data-testid="document-rename"><Pencil aria-hidden="true" /></IconButton>
    <RemoveButton label={`Ta bort ${item.name}`} disabled={busy} onClick={() => void trash(item)} data-testid="document-remove" />
  </>;
  const scanOff = listing?.scan === "off" ? <p className="text-xs text-muted-foreground" data-testid="document-scan-off">Virussökning är inte påslagen på den här installationen. Filerna märks Inte virussökt.</p> : null;

  if (native) return <NativePage testId="native-documents">
    {confirmElement}{rename}
    <NativeDocumentsTop />
    {filterBar}
    {error && !listing ? <ListGroup><ListEmpty><span className="text-destructive" role="alert">{error}</span></ListEmpty></ListGroup>
      : !listing ? <ListGroup><ListEmpty>Hämtar dokumenten…</ListEmpty></ListGroup>
      : !items.length ? <ListGroup testId="documents-empty"><ListEmpty>{emptyText}.</ListEmpty></ListGroup>
      : <ListGroup testId="documents-list" footer={listing.scan === "off" ? "Virussökning är inte påslagen. Filerna märks Inte virussökt." : undefined}>{items.map((item) => <ListRow key={item.id} type="customer" icon={FileText} title={item.name} twoLines
        subtitle={[whereLine(item), formatSwedish(item.createdAt, DAY)].filter(Boolean).join(" · ")} testId={`document-row-${item.id}`}
        pill={item.scanStatus === "clean" ? null : { label: DOCUMENT_SCAN_PILL[item.scanStatus], tone: DOCUMENT_SCAN_TONE[item.scanStatus] }}
        onClick={inTrash ? undefined : () => downloadDocument(item)} chevron={false} accessory={canEdit ? nativeActions(item) : undefined} />)}</ListGroup>}
    {listing && items.length < listing.total ? <ListGroup><ListRow title={<span className="text-primary">Visa fler dokument</span>} chevron={false} onClick={more} testId="documents-more" /></ListGroup> : null}
  </NativePage>;

  return <div className="space-y-5" data-testid="documents-page" data-view={prefs.view}>
    {confirmElement}{rename}
    <PageHeader title="Dokument" description="Kundernas och anläggningarnas dokument. Ladda upp nya på kundens sida eller vid en plats." />
    {error ? <p className="notice text-destructive" role="alert">{error}</p> : null}
    {filterBar}
    {!listing ? <DelayedSkeleton testId="documents-loading"><div className="rounded-xl border bg-card px-3.5 py-3"><RowsSkeleton rows={5} label="Hämtar dokumenten…" /></div></DelayedSkeleton>
      : !items.length ? (filtered
        ? <div className="notice" data-testid="documents-empty">Inget matchar urvalet. Ändra filter eller sökning.</div>
        : <div className="rounded-xl border bg-card" data-testid="documents-empty"><Empty title={emptyText}
          description={inTrash ? "Ett dokument som tas bort hamnar här och kan återställas." : "Dokument laddas upp under Dokument på kundens sida eller vid en plats i anläggningsträdet."}>
          {inTrash ? null : <Button asChild variant="outline"><Link href="/?view=customers"><Users aria-hidden="true" />Öppna Kunder</Link></Button>}
        </Empty></div>)
      : prefs.view === "cards" ? <ListCardGrid testId="documents-cards">{items.map((item) => <ListCard key={item.id} testId={`document-row-${item.id}`} href={customerHref(item)} action="Öppna kunden"
          icon={<AreaIcon area="tools" icon={FileText} />} title={item.name} subtitle={whereLine(item)}
          badges={<DocumentScanPill item={item} />}
          facts={[{ icon: UserRound, label: "Uppladdad av", value: item.uploadedBy }, { icon: CalendarClock, label: "Uppladdad", value: formatSwedish(item.createdAt, DAY) }, ...(item.placeName ? [{ icon: MapPinHouse, label: "Anläggning", value: item.placeName }] : [])]}
          footer={<div className="tap-above flex flex-wrap items-center justify-end gap-1">{rowActions(item)}</div>} />)}</ListCardGrid>
      : <div role="table" aria-label="Dokument" className="overflow-hidden rounded-xl border bg-card shadow-xs" data-testid="documents-table">
        <div role="row" className="hidden gap-x-3 bg-[var(--panel-header)] px-3.5 py-2.5 text-xs font-semibold text-muted-foreground md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_6rem_9rem]">
          <span role="columnheader">Dokument</span><span role="columnheader">Kund och anläggning</span><span role="columnheader">Status</span><span role="columnheader"><span className="sr-only">Åtgärder</span></span>
        </div>
        <div role="rowgroup" className="divide-y">{items.map((item) => <div key={item.id} role="row" className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-3.5 py-3 text-sm md:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_6rem_9rem]" data-testid={`document-row-${item.id}`}>
          <span role="cell" className="flex min-w-0 items-center gap-3">
            <AreaIcon area="tools" icon={FileText} />
            <span className="min-w-0">
              {item.downloadable && !inTrash ? <button type="button" className="block max-w-full truncate text-left font-semibold hover:text-primary hover:underline" onClick={() => downloadDocument(item)} data-testid="document-name">{item.name}</button>
                : <span className="block truncate font-semibold" data-testid="document-name">{item.name}</span>}
              <span className="block truncate text-xs text-muted-foreground">{metaLine(item)}</span>
              <span className="block truncate text-xs text-muted-foreground md:hidden"><Link className="hover:text-primary hover:underline" href={customerHref(item)}>{whereLine(item)}</Link></span>
            </span>
          </span>
          <span role="cell" className="truncate text-xs max-md:hidden"><Link className="hover:text-primary hover:underline" href={customerHref(item)} data-testid="document-customer">{whereLine(item)}</Link></span>
          <span role="cell" className="max-md:hidden"><DocumentScanPill item={item} /></span>
          <span role="cell" className="flex items-center justify-end gap-1"><span className="md:hidden"><DocumentScanPill item={item} /></span>{rowActions(item)}</span>
        </div>)}</div>
      </div>}
    {listing && items.length < listing.total ? <div className="flex justify-center"><Button type="button" variant="outline" size="sm" onClick={more} data-testid="documents-more">Visa fler dokument</Button></div> : null}
    {scanOff}
  </div>;
}

/** Level 1 on a phone: the top bar's title and Mer as the way back. */
function NativeDocumentsTop() {
  useNativeTopBar({ title: "Dokument", back: { label: "Mer" } });
  return <NativeLargeTitle inBar>Dokument</NativeLargeTitle>;
}
