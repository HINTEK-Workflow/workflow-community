"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Boxes, ChevronsDownUp, ChevronsUpDown, Layers, ListTree, Pencil, Plus, Trash2, Truck, Warehouse, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AreaIcon } from "@/components/area-icon";
import { IconActionBar } from "@/components/icon-action-bar";
import { ListCard, ListCardGrid, ListFilterBar, useListPrefs } from "@/components/list-filter-bar";
import { useEntryState } from "@/components/history-nav";
import { useAddressEntryState } from "@/components/use-address-filter";
import { listSortOptions } from "@/lib/list-filter";
import { itemsAtLocations, listStoreItems, STORE_FILTER_LABEL, STORE_FILTERS, STORE_SORTS, type StoreFilter } from "@/lib/maintenance/store-list";
import { allowedFilter } from "@/lib/url-filters";
import { ListGroup, ListRow, NativeActions } from "@/components/native/list";
import { useNativeTopBar } from "@/components/native/top-bar";
import { Empty, Panel, RowsSkeleton } from "@/features/kfid/ui";
import { useConfirm } from "@/features/kfid/confirm";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { placeParentIds, PlaceTreeView, type PlaceTreeDrag } from "@/features/workflow/place-tree";
import { useNativeMode } from "@/features/workflow/use-detail-level";
import { announce } from "@/lib/workflow/toast";
import { useLoadEffect } from "@/lib/use-load-effect";
import { partDepth, quantityText, storeLevelName, storeLocationProblem, subtreeIds } from "@/lib/maintenance/model";
import { maintenanceGet, maintenancePost, type Store, type StoreItemRow, type StoreLocationRow } from "./maintenance-api";
import { MaintenanceHeader, NEW_BUTTON_WIDTH } from "./maintenance-header";
import { StoreArticlePane, StorePlacePane, STORE_TAB_ARTICLES, type StoreTab } from "./store-cards";
import { AddItemDialog, LocationDialog } from "./store-dialogs";
import { useSetQuery } from "./use-set-query";

/**
 * Förrådet (2026-10-30 och 2026-10-31): samma utseende som Underhåll. Åtgärdsraden överst, förvaringsträdet (Förråd › Skåp › Hylla
 * › Hyllplats, så djupt man vill) till vänster och valt förråd, vald plats eller vald artikel som kort till höger med flikar och
 * nyckeltal. Sidhuvudet och artiklarna följer den gemensamma toppvisningen: chips Alla | Lågt saldo | Slut med antal, sök, sortering och
 * Rader | Kort (lib/maintenance/store-list.ts), direkt under sidhuvudet som på Projekt. Ny artikel är sidhuvudets knapp; på telefonens
 * nivå 1 står den till höger i toppfältet, som Ny offert. Uttag görs på arbetsordern (en dels Reservdelar eller underhållsposten). Servern
 * kontrollerar rättigheten Underhåll för varje anrop.
 */
const STORE_SORT_OPTIONS = listSortOptions(STORE_SORTS);
const asTreeItem = (row: StoreLocationRow) => ({ ...row, name: row.label, customerId: "", address: "", postalCode: "", city: "", description: "" });
type TreeItem = ReturnType<typeof asTreeItem>;
const ALL_STORES = asTreeItem({ id: "all", parentId: null, name: "Alla förråd", label: "Alla förråd", kind: "STORE", isActive: true, seriesStart: null, nextNumber: null });
const EMPTY_SET: ReadonlySet<string> = new Set();

export function StoreView() {
  const native = useNativeMode();
  const search = useSearchParams();
  const setQuery = useSetQuery();
  const storeParam = search.get("store");
  const articleParam = search.get("article");
  const [store, setStore] = useState<Store | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useEntryState("store.q", "");
  const [filter, setFilter] = useAddressEntryState<StoreFilter>("store.filter", "filter", (raw) => allowedFilter(raw, STORE_FILTERS), "all");
  const prefs = useListPrefs("store", "", { sorts: STORE_SORTS });
  const [tab, setTab] = useState<StoreTab>(() => q || filter !== "all" ? STORE_TAB_ARTICLES : "Översikt");
  const [location, setLocation] = useState<{ mode: "store" | "child" | "edit" } | null>(null);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string> | null>(null);
  const [cardKey, setCardKey] = useState(0);
  const [confirm, confirmElement] = useConfirm();
  const draggedRow = useRef<TreeItem | null>(null);
  const load = useCallback(async () => {
    try { setStore(await maintenanceGet<Store>(`part=store&q=${encodeURIComponent(q)}`)); setError(""); } catch (cause) { setError((cause as Error).message); }
  }, [q]);
  useLoadEffect(load);
  const reload = useCallback(async () => { await load(); setCardKey((key) => key + 1); }, [load]);
  useNativeTopBar(native ? { title: "Underhåll", save: store?.canEdit ? { label: "Ny artikel", onClick: () => setAdding(true) } : null } : null);
  const locations = useMemo(() => store?.locations ?? [], [store]);
  const items = useMemo(() => locations.map(asTreeItem), [locations]);
  const chosen = storeParam && locations.some((row) => row.id === storeParam) ? storeParam : null;
  const chosenRow = locations.find((row) => row.id === chosen) ?? null;
  const shaped = useMemo(() => locations.map((row) => ({ id: row.id, parentId: row.parentId, name: row.name })), [locations]);
  const depth = chosen ? partDepth(shaped, chosen) : -1;
  const ids = useMemo(() => chosen ? subtreeIds(shaped, chosen) : null, [chosen, shaped]);
  const atPlace = useMemo(() => itemsAtLocations(store?.items ?? [], ids), [store, ids]);
  const listed = useMemo(() => listStoreItems(atPlace, { filter, sort: prefs.sort }), [atPlace, filter, prefs.sort]);
  const parents = useMemo(() => placeParentIds(items), [items]);
  const treeOpen: ReadonlySet<string> = open ?? new Set(parents);
  const toggle = (id: string) => setOpen((current) => { const next = new Set(current ?? parents); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const canEdit = Boolean(store?.canEdit);
  const noEdit = canEdit ? null : "Du får inte ändra i Underhåll.";
  // A search or a chip is about the articles: the card shows them.
  const searchTo = (next: string) => { setQ(next); setTab(STORE_TAB_ARTICLES); };
  const chipTo = (next: StoreFilter) => { setFilter(next); setTab(STORE_TAB_ARTICLES); };
  const openArticle = (id: string) => setQuery({ article: id }, native);
  const selectPlace = (id: string) => setQuery({ store: id === "all" ? null : id, article: null });
  const remove = async () => {
    if (!chosenRow) return;
    if (!(await confirm({ title: `Ta bort ${chosenRow.label}?`, message: "En plats som har saldo, logg eller platser under sig kan inte tas bort. Pausa den i stället.", confirmLabel: "Ta bort", tone: "danger" }))) return;
    try {
      await maintenancePost({ action: "delete_location", id: chosenRow.id });
      announce("Förrådsplatsen togs bort.");
      setQuery({ store: chosenRow.parentId, article: null });
      await reload();
    } catch (cause) { announce((cause as Error).message, true); }
  };
  const rootClass = native ? "space-y-2" : "space-y-5";
  const articleScreen = native && Boolean(articleParam);
  const top = articleScreen ? null : <>
    <MaintenanceHeader view="store" action={<Button type="button" className={NEW_BUTTON_WIDTH} data-testid="store-item-new" onClick={() => setAdding(true)}
      disabledReason={!store ? "Hämtar förrådet…" : noEdit}><Plus />Ny artikel</Button>} />
    {/* Level 1 on a phone keeps its own rows (no sort or Rader | Kort); the search and the chips (a select there) stay. */}
    <ListFilterBar testId="store"
      chips={{ label: "Saldo", chips: STORE_FILTERS.map((value) => ({ value, label: STORE_FILTER_LABEL[value], count: store ? listed.counts[value] : null })), value: filter, onChange: chipTo, testId: "store-filter" }}
      search={{ label: "Sök i förrådet", placeholder: "Sök benämning, nummer eller hylla", value: q, onChange: searchTo, testId: "store-search" }}
      sort={native ? undefined : { value: prefs.sort, options: STORE_SORT_OPTIONS, onChange: prefs.setSort }}
      view={native ? undefined : { value: prefs.view, onChange: prefs.setView }} />
  </>;
  if (error) return <div className={rootClass}>{top}<p role="alert" className="notice text-destructive">{error}</p></div>;
  if (!store) return <div className={rootClass}>{top}<RowsSkeleton rows={4} label="Hämtar förrådet…" /></div>;

  const selectedLine = chosenRow ? chosenRow.name : "Alla förråd";
  const bar = <IconActionBar title="Hantera förråd" label="Hantera förråd" icon={<AreaIcon area="maintenance" icon={ListTree} tone="solid" />} line={`Vald: ${selectedLine}`} testId="store-actions"
    groups={[
      [
        { key: "new-store", label: "Nytt förråd", icon: Warehouse, testId: "store-location-new", disabledReason: noEdit, onClick: () => setLocation({ mode: "store" }) },
        { key: "new-place", label: "Ny plats", icon: Layers, testId: "store-place-new", disabledReason: noEdit ?? (chosenRow ? null : "Välj ett förråd först."), onClick: () => setLocation({ mode: "child" }) },
      ],
      [
        { key: "edit", label: "Redigera", icon: Pencil, testId: "store-location-edit", disabledReason: noEdit ?? (chosenRow ? null : "Välj ett förråd eller en plats först."), onClick: () => setLocation({ mode: "edit" }) },
        { key: "delete", label: "Ta bort", icon: Trash2, tone: "danger", testId: "store-location-delete", disabledReason: noEdit ?? (chosenRow ? null : "Välj ett förråd eller en plats först."), onClick: () => void remove() },
      ],
    ]}
    end={[
      { key: "open-all", label: "Fäll ut alla", icon: ChevronsUpDown, iconOnly: true, disabledReason: parents.every((id) => treeOpen.has(id)) ? "Allt i förvaringen är redan utfällt." : null, onClick: () => setOpen(new Set(parents)) },
      { key: "fold-all", label: "Fäll ihop alla", icon: ChevronsDownUp, iconOnly: true, disabledReason: parents.some((id) => treeOpen.has(id)) ? null : "Allt i förvaringen är redan hopfällt.", onClick: () => setOpen(new Set()) },
    ]} />;
  // Dra och släpp (2026-11-02): the same rule and action as Ligger under in Redigera; on Alla förråd it comes to the top.
  const dropVerdict = (target: TreeItem) => {
    const row = draggedRow.current;
    const parentId = target.id === "all" ? null : target.id;
    if (!row || row.id === target.id || (row.parentId ?? null) === parentId) return { same: true, problem: "" };
    return { same: false, problem: storeLocationProblem(locations, row.id, parentId) };
  };
  const treeDrag: PlaceTreeDrag<TreeItem> | undefined = canEdit && !native ? {
    canDrag: (row) => row.id !== "all",
    start: (row) => { draggedRow.current = row; },
    end: () => { draggedRow.current = null; },
    active: () => draggedRow.current !== null,
    verdict: (target) => { const verdict = dropVerdict(target); return verdict.same ? "same" : verdict.problem ? "refused" : "ok"; },
    drop: (target) => {
      const row = draggedRow.current;
      const verdict = dropVerdict(target);
      draggedRow.current = null;
      if (!row || verdict.same) return;
      if (verdict.problem) { announce(verdict.problem, true); return; }
      void maintenancePost({ action: "update_location", id: row.id, location: { name: row.label, kind: row.kind, isActive: row.isActive, parentId: target.id === "all" ? null : target.id } })
        .then(async () => { announce(`${row.label} är flyttad.`); await reload(); }).catch((cause: Error) => announce(cause.message, true));
    },
  } : undefined;
  const icon = (item: TreeItem): LucideIcon => item.id === "all" ? Boxes : item.kind === "VEHICLE" && !item.parentId ? Truck : item.parentId ? Layers : Warehouse;
  const line = (item: TreeItem, level: number) => {
    if (item.id === "all") return `${store.items.length} ${store.items.length === 1 ? "artikel" : "artiklar"}`;
    return [storeLevelName(level, item.kind), level === 0 && item.nextNumber ? `Nästa nr ${item.nextNumber}` : ""].filter(Boolean).join(" · ");
  };
  const tree = <>
    <PlaceTreeView places={[ALL_STORES]} open={EMPTY_SET} onToggle={() => undefined} selected={chosen ?? "all"} icon={icon} line={line} label="Alla förråd" testId="store-tree-all" onOpen={(item) => selectPlace(item.id)} drag={treeDrag} />
    {items.length ? <PlaceTreeView places={items} open={treeOpen} onToggle={toggle} selected={chosen} icon={icon} line={line} label="Förvaring" testId="store-tree" onOpen={(item) => selectPlace(item.id)} drag={treeDrag} />
      : <Empty compact title="Inga förråd än" description="Börja med Nytt förråd. Ett litet företag kan stanna där och skriva hyllan på artikeln." />}
  </>;
  const articles = !listed.items.length ? <p className="text-sm text-muted-foreground">{q || filter !== "all" ? "Inget matchar." : "Inga artiklar här än."}</p>
    : native ? <ListGroup>{listed.items.map((item) => <ListRow key={item.id} title={item.name} subtitle={[item.ownNumber ? `Nr ${item.ownNumber}` : "", `${quantityText(item.total)} ${item.unit}`, item.low ? "Lågt" : ""].filter(Boolean).join(" · ")} onClick={() => openArticle(item.id)} testId="store-item" />)}</ListGroup>
    : prefs.view === "cards" ? <ListCardGrid testId="store-cards">{listed.items.map((item) => <ListCard key={item.id} testId="store-item" onOpen={() => openArticle(item.id)}
      icon={<AreaIcon area="maintenance" icon={Boxes} />} title={item.name} subtitle={item.ownNumber ? `Nr ${item.ownNumber}` : "Inget eget nummer"}
      badges={<ItemBadges item={item} />}
      facts={[
        item.shelfText ? { icon: Layers, label: "Hylla", value: item.shelfText } : null,
        item.articleNo || item.supplierName ? { icon: Warehouse, label: "Beställs som", value: orderAs(item) } : null,
      ]} />)}</ListCardGrid>
    : <ul className="-mx-4 divide-y border-y text-sm" data-testid="store-items">{listed.items.map((item) => <li key={item.id} data-testid="store-item">
      <button type="button" className="grid w-full gap-1 px-5 py-2 text-left hover:bg-muted sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" onClick={() => openArticle(item.id)} data-testid="store-item-open">
        <span className="min-w-0"><span className="block truncate font-semibold">{item.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{[item.ownNumber ? `Nr ${item.ownNumber}` : "Inget eget nummer", item.shelfText ? `Hylla ${item.shelfText}` : "", item.fromRegister ? "" : "Egen artikel", item.minQuantity !== null ? `Lägsta ${quantityText(item.minQuantity)}` : "", item.parts ? `${item.parts} ${item.parts === 1 ? "del" : "delar"}` : ""].filter(Boolean).join(" · ")}</span>
          {item.articleNo || item.supplierName ? <span className="block truncate text-xs text-muted-foreground" data-testid="store-item-order-as">Beställs som {orderAs(item)}</span> : null}</span>
        <span className="flex flex-wrap items-center gap-2"><ItemBadges item={item} /></span>
      </button>
    </li>)}</ul>;
  const pane = articleParam
    ? <StoreArticlePane key={articleParam} id={articleParam} locations={locations} native={native} onBack={() => setQuery({ article: null })} onChanged={load} onGone={() => { setQuery({ article: null }); void load(); }} />
    : <StorePlacePane key={`${chosen ?? "all"}-${cardKey}`} id={chosen} name={chosenRow?.label ?? "Alla förråd"} row={chosenRow} level={depth} native={native} tab={tab} onTab={setTab} articles={articles} onOpenArticle={openArticle} />;
  const dialogs = <>
    {location ? <LocationDialog mode={location.mode} row={location.mode === "edit" ? chosenRow : null} parent={location.mode === "child" ? chosenRow : null} locations={locations} onClose={() => setLocation(null)}
      onSaved={async (id) => { setLocation(null); setQuery({ store: id, article: null }); await reload(); }} /> : null}
    {adding ? <AddItemDialog locations={locations} storeId={chosen} onClose={() => setAdding(false)} onSaved={async (id) => { setAdding(false); await reload(); openArticle(id); }} /> : null}
    {confirmElement}
  </>;
  if (native) {
    if (articleScreen) return <div className="space-y-2" data-testid="maintenance-store">{pane}{dialogs}</div>;
    return <div className={rootClass} data-testid="maintenance-store">
      {top}
      <ListGroup title="Förvaring"><div role="listitem"><nav aria-label="Förvaring" className="p-2">{tree}</nav></div></ListGroup>
      {pane}
      {canEdit ? <NativeActions>
        <Button type="button" variant="ghost" onClick={() => setLocation({ mode: "store" })} data-testid="store-location-new"><Warehouse />Nytt förråd</Button>
        {chosenRow ? <Button type="button" variant="ghost" onClick={() => setLocation({ mode: "child" })} data-testid="store-place-new"><Layers />Ny plats under {chosenRow.label}</Button> : null}
        {chosenRow ? <Button type="button" variant="ghost" onClick={() => setLocation({ mode: "edit" })} data-testid="store-location-edit"><Pencil />Redigera {chosenRow.label}</Button> : null}
      </NativeActions> : null}
      {dialogs}
    </div>;
  }
  return <div className={rootClass} data-testid="maintenance-store">{top}<div className="place-explorer-wrap"><div className="place-explorer">
    <div className="place-explorer-bar">{bar}</div>
    <div className="place-explorer-tree">
      <Panel icon={Warehouse} title="Förvaring" className="place-tree-panel"><nav aria-label="Förvaring">{tree}</nav></Panel>
    </div>
    <div className="place-pane">{pane}</div>
    {dialogs}
  </div></div></div>;
}

const orderAs = (item: { supplierName: string; articleNo: string }) => [item.supplierName, item.articleNo].filter(Boolean).join(" ");

function ItemBadges({ item }: { item: StoreItemRow }) {
  return <>
    <span className="tabular-nums text-sm font-medium" data-testid="store-item-total">{quantityText(item.total)} {item.unit}</span>
    {item.total <= 0 ? <Badge variant="outline" className={indicatorBadge("danger")} data-testid="store-item-out">Slut</Badge> : item.low ? <Badge variant="outline" className={indicatorBadge("warning")} data-testid="store-item-low">Lågt</Badge> : null}
  </>;
}
