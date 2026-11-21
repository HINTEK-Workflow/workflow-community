"use client";

import { AreaIcon } from "@/components/area-icon";
import { RowChevron } from "@/components/row-chevron";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Boxes, Building2, ClipboardList, MapPin, MapPinHouse } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Empty, ShowMore } from "@/features/kfid/ui";
import { useEntryState } from "@/components/history-nav";
import { ListFilterBar, useListPrefs } from "@/components/list-filter-bar";
import { ListGroup, ListRow } from "@/components/native/list";
import { useAddressEntryState } from "@/components/use-address-filter";
import { listSortOptions } from "@/lib/list-filter";
import { allowedFilter } from "@/lib/url-filters";
import { useNativeMode } from "./use-detail-level";
import { api } from "@/features/kfid/api";
import { cn } from "@/lib/utils";
import { PLACE_KIND_LABELS, PLACE_SEPARATOR, placeKindOf, placeName, type FacilityItem } from "@/lib/workflow/customer-facility";
import { nameplateText, OPERATING_STATE_LABELS, type OperatingState } from "@/lib/workflow/maintenance";
import { listPlaceRegister, objectTypeOptions, PLACE_LEVEL_LABELS, PLACE_LEVELS, PLACE_SORTS, PLACE_STATE_FILTERS, placeRegisterCounts, placeStateLevel, type PlaceLevel, type PlaceRegisterFilter, type PlaceStateFilter } from "@/lib/workflow/place-register";
import { indicatorBadge, type IndicatorTone } from "./indicator-tone";

export type RegisterPlace = Pick<FacilityItem, "id" | "customerId" | "name" | "isActive"> & Partial<FacilityItem> & { updatedAt?: string | Date | null };
export type PlaceRegisterItem = { place: RegisterPlace; path: string; children: number; openWorkOrders?: number | null; customerName?: string };

const stateTone = (value: OperatingState): IndicatorTone => value === "IN_SERVICE" ? "success" : value === "OUT_OF_SERVICE" ? "warning" : "neutral";

/** The badges of a place's object data; nothing when it has none. */
export function PlaceBadges({ place }: { place: Partial<FacilityItem> }) {
  return <>
    {place.operatingState ? <Badge variant="outline" className={indicatorBadge(stateTone(place.operatingState))}>{OPERATING_STATE_LABELS[place.operatingState]}</Badge> : null}
    {place.isActive === false ? <Badge variant="outline" className={indicatorBadge("neutral")}>Pausad</Badge> : null}
  </>;
}

/**
 * One place as a card (2026-10-06: "kort och flikar"): the whole card opens the place, with its way, its object
 * data and what is going on there. Cloud opens the place's page; Local, which has no place page, opens the editor.
 */
export function PlaceCard({ item, href, onOpen, maintenance, showCustomer = false }: { item: PlaceRegisterItem; href?: string; onOpen?: () => void; maintenance: boolean; showCustomer?: boolean }) {
  const { place } = item;
  const kind = placeKindOf(place);
  const Icon = kind === "OBJECT" ? Boxes : kind === "FACILITY" ? Building2 : MapPinHouse;
  const above = item.path.split(PLACE_SEPARATOR).slice(0, -1).join(PLACE_SEPARATOR);
  const nameplate = maintenance ? nameplateText(place) : "";
  const title = placeName({ name: place.name });
  const describedBy = useId();
  return <article data-testid="place-card" data-place-id={place.id} className={cn("workflow-card group flex min-w-0 flex-col gap-3 p-4", (href || onOpen) && "tap-card", !place.isActive && "opacity-75")}>
    <div className="flex min-w-0 items-start gap-3">
      <AreaIcon area="customer" icon={Icon} />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold" title={title} data-card-title="">
          {href ? <Link href={href} aria-describedby={describedBy} className="stretched-link group-hover:text-primary">{title}</Link>
            : onOpen ? <button type="button" aria-describedby={describedBy} onClick={onOpen} className="stretched-link text-left group-hover:text-primary">{title}</button> : title}
        </h3>
        <p id={describedBy} className="mt-0.5 truncate text-xs text-muted-foreground">{[showCustomer ? item.customerName : "", PLACE_KIND_LABELS[kind], maintenance ? place.objectType : "", above ? `i ${above}` : ""].filter(Boolean).join(" · ")}</p>
      </div>
      {href || onOpen ? <RowChevron className="mt-1" /> : null}
    </div>
    {(maintenance && place.operatingState) || !place.isActive ? <div className="flex min-w-0 flex-wrap gap-1.5"><PlaceBadges place={maintenance ? place : { isActive: place.isActive }} /></div> : null}
    {nameplate ? <p className="truncate text-xs text-muted-foreground">{nameplate}</p> : null}
    <dl className="mt-auto flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <div className="flex items-center gap-1.5"><dt className="sr-only">Under platsen</dt><MapPin className="size-3.5" aria-hidden="true" /><dd>{item.children === 1 ? "1 plats under" : `${item.children} platser under`}</dd></div>
      {typeof item.openWorkOrders === "number" ? <div className="flex items-center gap-1.5"><dt className="sr-only">Öppna arbetsordrar</dt><ClipboardList className="size-3.5" aria-hidden="true" />
        <dd className={item.openWorkOrders ? "font-semibold text-foreground" : undefined}>{item.openWorkOrders === 1 ? "1 öppen arbetsorder" : `${item.openWorkOrders} öppna arbetsordrar`}</dd></div> : null}
    </dl>
  </article>;
}

/** Cards in a grid with "Visa fler"; never an unbounded list. */
export function PlaceCardGrid({ items, total, busy, onMore, maintenance, hrefFor, onOpen, showCustomer, empty }: {
  items: PlaceRegisterItem[]; total: number; busy?: boolean; onMore: () => void; maintenance: boolean;
  hrefFor?: (item: PlaceRegisterItem) => string | undefined; onOpen?: (item: PlaceRegisterItem) => void; showCustomer?: boolean; empty: ReactNode;
}) {
  if (!items.length) return <>{empty}</>;
  return <>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4" aria-busy={busy} data-testid="place-cards">
      {items.map((item) => <PlaceCard key={item.place.id} item={item} maintenance={maintenance} showCustomer={showCustomer} href={hrefFor?.(item)} onOpen={onOpen ? () => onOpen(item) : undefined} />)}
    </div>
    <ShowMore shown={items.length} total={total} busy={busy} onMore={onMore} />
  </>;
}

/** One place as a row in Rader: the same way, the same data and the same open as the card. */
function PlaceRow({ item, href, maintenance }: { item: PlaceRegisterItem; href: string; maintenance: boolean }) {
  const { place } = item;
  const kind = placeKindOf(place);
  const above = item.path.split(PLACE_SEPARATOR).slice(0, -1).join(PLACE_SEPARATOR);
  return <li data-testid="place-row" data-place-id={place.id}><Link href={href} className={cn("tap-card flex min-h-14 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 outline-none hover:bg-secondary/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", !place.isActive && "opacity-75")}>
    <AreaIcon area="customer" icon={kind === "OBJECT" ? Boxes : kind === "FACILITY" ? Building2 : MapPinHouse} />
    <span className="min-w-0 flex-1 basis-48"><span className="block truncate text-sm font-medium">{placeName({ name: place.name })}</span>
      <span className="block truncate text-xs text-muted-foreground">{[item.customerName, PLACE_KIND_LABELS[kind], maintenance ? place.objectType : "", above ? `i ${above}` : ""].filter(Boolean).join(" · ")}</span></span>
    <span className="flex min-w-0 flex-wrap items-center gap-1.5"><PlaceBadges place={maintenance ? place : { isActive: place.isActive }} /></span>
    {typeof item.openWorkOrders === "number" ? <span className={cn("shrink-0 text-xs tabular-nums", item.openWorkOrders ? "font-semibold text-foreground" : "text-muted-foreground")}>{item.openWorkOrders === 1 ? "1 öppen arbetsorder" : `${item.openWorkOrders} öppna arbetsordrar`}</span> : null}
    <RowChevron />
  </Link></li>;
}

type RemotePage = { items: PlaceRegisterItem[]; total: number; page: number; pages: number; objectTypes: string[]; counts?: ReturnType<typeof placeRegisterCounts> };

const SORT_OPTIONS = listSortOptions(PLACE_SORTS);
const LEVEL_FILTER = (raw: string) => allowedFilter(raw, PLACE_LEVELS);
const STATE_FILTER = (raw: string) => allowedFilter(raw, PLACE_STATE_FILTERS);

/**
 * Alla objekt (2026-10-06, decision B5): the company's places across customers, with the shared toppvisning (
 * 2026-10-31): Nivå and Driftstatus as chips with counts, the search, Objekttyp, the sort and Rader | Kort. Cloud and the demo
 * read a page at a time from /api/places?register=1, with the chips counted over the whole company; Local passes the file's
 * places and uses the same rules in memory. A phone shows the same choices without the sort and Rader | Kort, and rows.
 */
export function ObjectRegister({ maintenance, local, personId = "" }: { maintenance: boolean; local?: { places: RegisterPlace[]; customerName: (id: string) => string; openWorkOrders: (id: string) => number }; personId?: string }) {
  const native = useNativeMode();
  const prefs = useListPrefs("places", personId, { sorts: PLACE_SORTS });
  const [level, setLevel] = useAddressEntryState<PlaceLevel>("places.level", "level", LEVEL_FILTER, "objects");
  const [state, setState] = useAddressEntryState<PlaceStateFilter>("places.state", "state", STATE_FILTER, "all");
  const [objectType, setObjectType] = useEntryState("places.type", "");
  const [q, setQ] = useEntryState("places.q", "");
  const filter = useMemo<PlaceRegisterFilter>(() => ({ level, objectType, state: state === "all" ? "" : state, q, sort: prefs.sort }), [level, objectType, state, q, prefs.sort]);
  const [localPage, setLocalPage] = useState({ key: "", page: 1 });
  const localKey = JSON.stringify(filter);
  const pageNow = localPage.key === localKey ? localPage.page : 1;
  const memory = useMemo(() => {
    if (!local) return null;
    const result = listPlaceRegister(local.places, filter, pageNow);
    return { ...result, counts: placeRegisterCounts(local.places, filter), objectTypes: objectTypeOptions(local.places) };
  }, [local, filter, pageNow]);
  const [query, setQuery] = useState(q.trim());
  const [remote, setRemote] = useState<RemotePage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  useEffect(() => { const timer = setTimeout(() => setQuery(q.trim()), 250); return () => clearTimeout(timer); }, [q]);
  async function load(page: number) {
    const id = ++request.current;
    setBusy(true);
    try {
      const params = new URLSearchParams({ register: "1", level: filter.level, page: String(page), sort: filter.sort, ...(filter.objectType ? { objectType: filter.objectType } : {}), ...(filter.state ? { state: filter.state } : {}), ...(query ? { q: query } : {}) });
      const next = await api<RemotePage>(`/api/places?${params}`);
      if (id === request.current) { setRemote(next); setError(""); }
    } catch (issue) { if (id === request.current) setError((issue as Error).message); } finally { if (id === request.current) setBusy(false); }
  }
  useEffect(() => { if (!local) queueMicrotask(() => void load(1)); }, [local, filter.level, filter.objectType, filter.state, filter.sort, query]); // eslint-disable-line react-hooks/exhaustive-deps
  const items: PlaceRegisterItem[] | null = memory && local ? memory.items.map((item) => ({ ...item, customerName: local.customerName(item.place.customerId), openWorkOrders: local.openWorkOrders(item.place.id) })) : remote?.items ?? null;
  const counts = memory?.counts ?? remote?.counts ?? null;
  const total = memory?.total ?? remote?.total ?? 0;
  const objectTypes = memory?.objectTypes ?? remote?.objectTypes ?? [];
  const more = () => { if (local) setLocalPage({ key: localKey, page: pageNow + 1 }); else if (remote) void load(remote.page + 1); };
  const hrefFor = (item: PlaceRegisterItem) => local ? `/?view=customers&customerId=${encodeURIComponent(item.place.customerId)}&tab=facilities` : `/?view=place&placeId=${encodeURIComponent(item.place.id)}`;
  // A maintenance filter on the top level would hide everything, so choosing one shows every level.
  const chooseState = (value: string) => { const next = value as PlaceStateFilter; setState(next); if (next !== "all") setLevel(placeStateLevel(level)); };
  const chooseType = (value: string) => { setObjectType(value); if (value) setLevel(placeStateLevel(level)); };
  const empty = <Empty title="Inga platser matchar" description="Ändra nivå eller filter. Platser läggs till på kundkortets flik Anläggningar." />;
  return <div className="space-y-5" data-testid="object-register" data-view={native ? "native" : prefs.view}>
    <div data-testid="object-register-filters"><ListFilterBar testId="object-register" label="Sök och filtrera platser"
      chips={{ label: "Nivå", chips: PLACE_LEVELS.map((value) => ({ value, label: PLACE_LEVEL_LABELS[value], count: counts?.level[value] ?? null })), value: level, onChange: setLevel, testId: "object-register-level" }}
      moreChips={maintenance ? { label: "Driftstatus", chips: PLACE_STATE_FILTERS.map((value) => ({ value, label: value === "all" ? "Alla driftstatusar" : OPERATING_STATE_LABELS[value], count: counts?.state[value] ?? null })), value: state, onChange: chooseState, testId: "object-register-state" } : undefined}
      search={{ label: "Sök plats", placeholder: maintenance ? "Sök namn, tillverkare eller serienummer" : "Sök namn", value: q, onChange: setQ }}
      extras={maintenance ? [{ key: "type", label: "Objekttyp", value: objectType, onChange: chooseType, testId: "object-register-type", className: "sm:w-44 sm:flex-none", options: [{ value: "", label: "Alla objekttyper" }, ...objectTypes.map((type) => ({ value: type, label: type }))] }] : undefined}
      sort={native ? undefined : { value: prefs.sort, options: SORT_OPTIONS, onChange: prefs.setSort }}
      view={native ? undefined : { value: prefs.view, onChange: prefs.setView }} /></div>
    {error ? <p role="alert" className="notice text-destructive">{error}</p> : null}
    {!items ? <p role="status" className="text-sm text-muted-foreground">Hämtar…</p>
      : native ? (items.length ? <>
        <ListGroup testId="place-native-rows">{items.map((item) => <ListRow key={item.place.id} type="customer" icon={placeKindOf(item.place) === "OBJECT" ? Boxes : MapPinHouse} title={placeName({ name: item.place.name })} href={hrefFor(item)} testId="place-row"
          subtitle={[item.customerName, maintenance ? item.place.objectType : "", item.place.operatingState ? OPERATING_STATE_LABELS[item.place.operatingState] : ""].filter(Boolean).join(" · ")} />)}</ListGroup>
        <ShowMore shown={items.length} total={total} busy={busy} onMore={more} />
      </> : empty)
      : prefs.view === "rows" ? (items.length ? <>
        <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs" aria-busy={busy} data-testid="place-rows">{items.map((item) => <PlaceRow key={item.place.id} item={item} href={hrefFor(item)} maintenance={maintenance} />)}</ul>
        <ShowMore shown={items.length} total={total} busy={busy} onMore={more} />
      </> : empty)
      : <PlaceCardGrid items={items} total={total} busy={busy} maintenance={maintenance} showCustomer onMore={more} hrefFor={hrefFor} empty={empty} />}
  </div>;
}
