"use client";
import { usePageTrail } from "@/components/page-shell";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CircleDashed, ClipboardList, ExternalLink, FolderKanban, Gauge, LayoutDashboard, ListTree, MapPinHouse, Pencil, Play, Plus, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DialogActions, Empty, FormPage, Modal, Panel, ShowMore } from "@/features/kfid/ui";
import { api } from "@/features/kfid/api";
import { formatSwedish, fromSwedishDateInput, swedishDayKey } from "@/lib/swedish-time";
import { PLACE_KIND_LABELS, placeName, type FacilityItem, type PlaceKind } from "@/lib/workflow/customer-facility";
import { OPERATING_STATE_LABELS, placeHasObjectData, type PlaceObjectData } from "@/lib/workflow/maintenance";
import { mapLinks } from "@/lib/workflow/place-position";
import { occurrenceOverdue, roundFormNotice, roundHref, type ScheduleOccurrenceState } from "@/lib/workflow/form-schedule";
import { scanOutcome, scanStartQuestion, type ScanStart } from "@/lib/workflow/place-scan";
import { indicatorBadge, indicatorText, statusTone } from "./indicator-tone";
import { cn } from "@/lib/utils";
import { PlaceMap, useMapStatus } from "./map-view";
import { emptyPlace, placeDraftOf, PlaceForm, type PlaceDraft } from "./place-editor";
import { PlaceBadges, PlaceCardGrid, type PlaceRegisterItem } from "./place-register";
import { listPlaceLabel, type TempPlace } from "@/lib/workflow/temp-place";
import { returnToWork } from "@/components/history-nav";
import { customerPlaceHref, safeReturnTo } from "@/lib/workflow/navigation";
import { announce } from "@/lib/workflow/toast";
import { invalidateCustomerOptions } from "@/features/kfid/customer-options";
import { ListEmpty, ListGroup, ListRow, NativePage, useNativeScreen, useNativeTopBar } from "@/components/native";
import { withScreen } from "@/lib/workflow/native-mode";
import { PageHeader } from "@/components/page-shell";
import { ContactActions } from "@/components/contact-actions";

type HistoryItem = { id: string; kind: string; title: string; status: string; progress: number; updatedAt: string; below: string; assignedToName: string; href: string };
/**
 * A round at the place (2026-10-27 kväll): one whose work order stands here and holds today – the work order's place
 * and temporary place, which the protocol started in it takes.
 */
type Round = { id: string; title: string; templateId: string; templateName?: string; workOrderId?: string | null; workOrderTitle?: string; facilityId: string | null; facilityName?: string; active: boolean; ruleText: string;
  tempPlace?: TempPlace | null;
  current: { date: string; state: ScheduleOccurrenceState["state"]; late?: boolean; taskId?: string | null; workOrderId?: string | null } | null; next: string | null;
  /** As on Driftronder: the round's responsible person follows into the protocol; a removed form cannot be started. */
  assignedToUserId?: string | null; assignedToName?: string; templateMissing?: boolean; templateUnpublished?: boolean;
  /** The occurrences whose protocol exists and is not completed: what a scanned label may open (2026-10-22). */
  started?: { date: string; taskId: string }[] };
type Child = { id: string; name: string; kind: PlaceKind; children: number; openWorkOrders: number | null } & PlaceObjectData;
/**
 * Without the right Kunder (beslut 10, 2026-11-01) the server sends only this: the place's name and address, the person's own
 * jobs there and today's rounds there (lib/kfid/place-server.ts limitedPlaceView).
 */
type LimitedPlaceData = {
  limited: true;
  place: { id: string; customerId: string; kind: PlaceKind; name: string; isActive: boolean; path: string; address: string; postalCode: string; city: string; position: { latitude: number; longitude: number; own: boolean } | null };
  customer: { id: string; name: string; deleted: boolean } | null;
  jobs: { id: string; kind: string; title: string; status: string; href: string }[];
  rounds: Round[];
};
export type PlaceData = {
  limited?: undefined;
  place: { id: string; customerId: string; parentId: string | null; kind: PlaceKind; name: string; description: string; isActive: boolean; version: number; path: string; address: string; postalCode: string; city: string;
    latitude: number | null; longitude: number | null; ownAddress: { address: string; postalCode: string; city: string };
    position: { latitude: number; longitude: number; own: boolean } | null;
    /** The place above whose position applies here, when the place has none of its own. */
    positionFrom?: { id: string; name: string } | null; openWorkOrders: number | null } & PlaceObjectData;
  /** The places below with positions of their own (2026-10-07), each a pin that opens the place. */
  pins?: { id: string; latitude: number; longitude: number; label: string }[];
  customer: { id: string; name: string; deleted: boolean } | null;
  chain: { id: string; name: string }[];
  children: Child[];
  history: { items: HistoryItem[]; total: number; page: number };
  projects: { id: string; name: string; startDate: string; dueDate: string; closedAt: string | null; archivedAt: string | null; below: string }[];
  rounds: Round[];
  limits: { id: string; templateId: string; templateName: string; objectName: string; count: number; updatedAt: string; updatedByName: string }[];
  maintenance: boolean;
  places: (FacilityItem & { version?: number })[];
  canCreate: { workOrder: boolean };
  canEdit: boolean;
};

const typeLabel = (kind: string) => kind === "WORK_ORDER" ? "Arbetsorder" : kind === "RISK_ASSESSMENT" ? "Riskbedömning" : kind === "FORM" ? "Protokoll" : "Kontroll före idrifttagning";
const statusLabel = (status: string) => ({ PLANNED: "Planerad", IN_PROGRESS: "Pågår", PAUSED: "Pausad", NEEDS_ACTION: "Behöver åtgärdas", COMPLETED: "Färdigställd", CANCELLED: "Utgått", DRAFT: "Utkast" } as Record<string, string>)[status] ?? status;
// Kundregister skapar inga jobb (2026-10-22): only a round whose protocol already exists is offered here, and it opens
// that protocol; a round is started from Driftronder.
const dueNow = (round: Round) => Boolean(round.active && round.current && round.current.state !== "done" && round.current.taskId);
const day = (value: string) => { const date = fromSwedishDateInput(value); return date ? formatSwedish(date, { day: "numeric", month: "short", year: "numeric" }) : value; };

const TABS = ["overview", "structure", "plan", "history", "limits"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = { overview: "Översikt", structure: "Struktur", plan: "Underhållsplan", history: "Historik", limits: "Gränsvärden" };
/** Level 1: names that say what is behind the row (audit 2026-10-12: "Översikt" did not say what it showed). */
const NATIVE_TAB_LABELS: Record<Tab, string> = { overview: "Fakta och karta", structure: "Platser under", plan: "Underhållsplan", history: "Historik", limits: "Gränsvärden" };
const TAB_ICONS = { overview: LayoutDashboard, structure: ListTree, plan: Repeat, history: ClipboardList, limits: Gauge } as const;
const CHILD_PAGE = 12;
/** Level 1 on a phone: each tab is a screen of its own (`&step=`), opened from the place's menu of rows. */
const NATIVE_STEP: Record<Tab, string> = { overview: "oversikt", structure: "struktur", plan: "plan", history: "historik", limits: "granser" };
const tabOfStep = (step: string | null) => (Object.keys(NATIVE_STEP) as Tab[]).find((key) => NATIVE_STEP[key] === step) ?? null;
const taskType = (kind: string) => kind === "WORK_ORDER" ? "work-order" as const : kind === "RISK_ASSESSMENT" ? "risk" as const : "control" as const;

/** The page's tabs: chips that wrap from 640 px and one picker on a phone – never a sideways scroll. */
function PlaceTabs({ tab, onTab, counts }: { tab: Tab; onTab: (tab: Tab) => void; counts: Partial<Record<Tab, number>> }) {
  const label = (value: Tab) => `${TAB_LABELS[value]}${counts[value] !== undefined ? ` (${counts[value]})` : ""}`;
  return <div data-testid="place-tabs">
    <label className="block sm:hidden"><span className="sr-only">Platsens flikar</span>
      <select className="form-select w-full" value={tab} onChange={(event) => onTab(event.target.value as Tab)} data-testid="place-tab-select">
        {TABS.map((value) => <option key={value} value={value}>{label(value)}</option>)}
      </select>
    </label>
    <div role="tablist" aria-label="Platsens flikar" className="hidden w-fit max-w-full flex-wrap gap-1 rounded-xl border bg-card p-1 sm:flex">
      {TABS.map((value) => { const Icon = TAB_ICONS[value]; return <Button key={value} role="tab" aria-selected={tab === value} size="sm" variant={tab === value ? "secondary" : "ghost"} onClick={() => onTab(value)} data-testid={`place-tab-${value}`}><Icon />{label(value)}</Button>; })}
    </div>
  </div>;
}

/** The place for someone with a job or a round there and without the right Kunder: what they came for and nothing more. */
function LimitedPlace({ data }: { data: LimitedPlaceData }) {
  const { place } = data;
  const address = [place.address, [place.postalCode, place.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const due = data.rounds.filter(dueNow);
  return <Panel icon={MapPinHouse} title={placeName(place)}>
    <div className="space-y-3 text-sm" data-testid="place-limited">
      {address ? <p className="[overflow-wrap:anywhere]">{address}</p> : null}
      <ContactActions destination={{ address: place.address, postalCode: place.postalCode, city: place.city, latitude: place.position?.latitude ?? null, longitude: place.position?.longitude ?? null }} testId="place-navigate" />
      {data.jobs.length ? <ul className="divide-y rounded-lg border" aria-label="Dina jobb här" data-testid="place-limited-jobs">{data.jobs.map((job) => <li key={job.id}><Link className="tap-card block truncate px-3 py-2" href={job.href}>{job.title}</Link></li>)}</ul> : null}
      {due.length ? <ul className="divide-y rounded-lg border" aria-label="Påbörjade ronder här" data-testid="place-limited-rounds">{due.map((round) => <li key={round.id}><Link className="tap-card block truncate px-3 py-2" href={roundHref(round, round.current!, place.id)}>{round.title}</Link></li>)}</ul> : null}
      {!data.jobs.length && !due.length ? <p role="status" className="notice" data-testid="place-scan-none">Inget planerat jobb här.</p> : null}
      {data.customer ? <Button asChild variant="outline"><Link href={customerPlaceHref(data.customer.id, place.id)}>{data.customer.name}</Link></Button> : null}
    </div>
  </Panel>;
}

/**
 * A place (2026-10-04, Platser etapp 3; 2026-10-06 in tabs, Underhåll stage 3): its whole way and object data,
 * the places below it, the rounds made there, what has been done there and its limit profiles – the page a QR label
 * opens. Scanned at an object with one open round protocol, it opens straight away at the object's point; several or none
 * are shown on the customer's page (a short choice, or "Inget planerat jobb här"; lib/workflow/place-scan.ts). A round
 * there with nothing started asks first (svar 10, 2026-10-24): Starta ronden creates its protocol, Avbryt opens the place.
 */
export function PlacePage({ placeId, scanned }: { placeId: string; scanned: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [data, setData] = useState<PlaceData | LimitedPlaceData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>(() => (TABS as readonly string[]).includes(params.get("tab") ?? "") ? params.get("tab") as Tab : "overview");
  const [childPage, setChildPage] = useState(1);
  const [editing, setEditing] = useState<{ id?: string; version?: number; facility: PlaceDraft } | null>(null);
  const [formError, setFormError] = useState("");
  const mapStatus = useMapStatus();
  const opened = useRef(false);
  const load = useCallback(async (page = 1) => {
    setBusy(true);
    try {
      const result = await api<PlaceData | LimitedPlaceData>(`/api/places?id=${encodeURIComponent(placeId)}&page=${page}`);
      // The server returns every item up to the page asked for, so the newest answer replaces the list.
      setData(result);
      setError("");
    } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
  }, [placeId]);
  useEffect(() => { opened.current = false; queueMicrotask(() => void load()); }, [load]);
  // The pen beside a chosen place (2026-10-09): `edit=1` opens the form at once, and with `returnTo` Spara and
  // Avbryt lead back to the work – a step back in the history when that is where the person came from, as for customers.
  const returnTo = safeReturnTo(params.get("returnTo"));
  const editRequested = params.get("edit") === "1";
  const editOpened = useRef(false);
  // Ny plats under this place (`&new=1`) is a page of its own too (plan 1O); level 1 keeps its screens.
  const newRequested = params.get("new") === "1";
  const nativeMode = useNativeScreen().native;
  const pageMode = !nativeMode && (editRequested || newRequested);
  useEffect(() => {
    if (!pageMode) { editOpened.current = false; return; }
  }, [pageMode]);
  useEffect(() => {
    if (!(editRequested || (newRequested && !nativeMode)) || !data || editOpened.current) return;
    editOpened.current = true;
    if (data.limited) return;
    const own = data.canEdit ? data.places.find((item) => item.id === data.place.id) : undefined;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- answers the address once, when the place has been read
    if (newRequested && data.canEdit) setEditing({ facility: emptyPlace(data.place.id, "OBJECT") });
    else if (own) setEditing({ id: own.id, version: own.version, facility: placeDraftOf(own) });
  }, [editRequested, newRequested, nativeMode, data]);
  const closeEditor = (saved: boolean) => {
    const wasPlacePen = Boolean(returnTo && editing?.id === placeId && editRequested);
    setEditing(null);
    if (wasPlacePen && returnTo) { if (saved) announce("Platsen är uppdaterad."); returnToWork(returnTo, router.push); }
  };
  const due = useMemo(() => data?.rounds.filter(dueNow) ?? [], [data]);
  // Scanned at the object (2026-10-22): the label opens a round protocol made beforehand, never a new job. One opens
  // at once at the object's point (the scan is recorded in the protocol); several or none show on the customer's page.
  const scan = useMemo(() => scanned && data ? scanOutcome(data.rounds, placeId, swedishDayKey(new Date())) : null, [scanned, data, placeId]);
  // A round here with nothing started (svar 10): the app asks; only Starta ronden creates the protocol, Avbryt opens the place.
  const [declined, setDeclined] = useState(false);
  const asking = scan?.kind === "start" && !declined;
  useEffect(() => {
    if (scan?.kind !== "open" || opened.current) return;
    opened.current = true;
    router.replace(scan.job.href);
  }, [scan, router]);

  // Ingen egen sida för en plats (2026-10-14): the place opens folded out on its customer's page – a QR label, a
  // search hit or an older link alike. Only the place form (the pen in the Plats field, Ny plats) and a scan that opens
  // the one round protocol here stay on this address.
  const toCustomer = Boolean(data) && !data?.limited && !pageMode && scan?.kind !== "open" && !asking;
  const customerHref = data ? `${customerPlaceHref(data.place.customerId, data.place.id)}${scanned && !declined ? "&scan=1" : ""}${nativeMode ? "&step=platser" : ""}` : "";
  useEffect(() => { if (toCustomer && customerHref) router.replace(customerHref); }, [toCustomer, customerHref, router]);

  // Nivå 1 på mobil (2026-10-09): the place as a menu of rows, each tab a screen of its own with its title on top.
  const { native, step } = useNativeScreen();
  const nativeTab = native ? tabOfStep(step) : null;
  // The menu names the place and goes back to "Kunden" (the customer's name made the title run out of room).
  useNativeTopBar(nativeTab ? { title: NATIVE_TAB_LABELS[nativeTab] } : native && data ? { title: placeName(data.place), back: { label: "Kunden" } } : null);
  // The customer and the place in the breadcrumbs (Översikt › Register och verktyg › Kundregister › kund › plats).
  usePageTrail({ customer: data?.customer?.name, place: data ? placeName(data.place) : undefined }, { customerId: data?.place.customerId || undefined });
  if (error && !data) return <Panel title="Platsen kunde inte öppnas"><p role="alert" className="text-sm text-destructive">{error}</p></Panel>;
  if (data && asking && scan?.kind === "start") return <ScanStartPrompt place={placeName(data.place)} starts={scan.starts} onStart={(start) => router.replace(start.href)} onCancel={() => setDeclined(true)} />;
  if (!data || toCustomer) return <Panel title="Hämtar plats"><p role="status" className="text-sm text-muted-foreground">{toCustomer ? "Öppnar platsen hos kunden…" : "Läser platsen och dess historik…"}</p></Panel>;
  if (data.limited) return <LimitedPlace data={data} />;
  const { place } = data;
  const address = [place.address, [place.postalCode, place.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  // Navigera (2026-10-12): the place's own or inherited position, else its address.
  const destination = { address: place.address, postalCode: place.postalCode, city: place.city, latitude: place.position?.latitude ?? null, longitude: place.position?.longitude ?? null };
  const links = place.position ? mapLinks(place.position, placeName(place)) : null;
  const maintenance = data.maintenance;
  const children: PlaceRegisterItem[] = data.children.map((child) => ({ place: { ...child, customerId: place.customerId, isActive: true, parentId: place.id }, path: `${place.path} › ${placeName(child)}`, children: child.children, openWorkOrders: child.openWorkOrders }));
  const save = async (finishPage?: (id: string) => void) => {
    if (!editing) return;
    setBusy(true); setFormError("");
    try {
      const saved = await api<{ id?: string }>("/api/customer-card", { method: "POST", body: JSON.stringify({ action: "facility_save", customerId: place.customerId, id: editing.id, version: editing.version, facility: editing.facility }) });
      // The work the person returns to reads the customers' places again.
      invalidateCustomerOptions();
      // The page stays mounted when Spara leads back to the place, so it reads the saved place again (otherwise it showed the old values).
      if (finishPage) { setEditing(null); void load(data.history.page); finishPage(saved?.id ?? editing.id ?? place.id); return; }
      if (returnTo && editRequested && editing.id === placeId) { closeEditor(true); return; }
      setEditing(null);
      await load(data.history.page);
    } catch (issue) { setFormError((issue as Error).message); } finally { setBusy(false); }
  };
  const editable = data.canEdit && data.places.length > 0;
  const fact = (label: string, value: React.ReactNode, wide = false) => value ? <div className={wide ? "sm:col-span-2" : undefined}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 whitespace-pre-wrap break-words">{value}</dd></div> : null;

  const editOwn = () => {
    if (!native) { router.push(`/?view=place&placeId=${encodeURIComponent(place.id)}&edit=1`); return; }
    const own = data.places.find((item) => item.id === place.id); if (own) { setFormError(""); setEditing({ id: own.id, version: own.version, facility: placeDraftOf(own) }); }
  };
  const addChild = () => {
    if (!native) { router.push(`/?view=place&placeId=${encodeURIComponent(place.id)}&new=1`); return; }
    setFormError(""); setEditing({ facility: emptyPlace(place.id, "OBJECT") });
  };
  const editor = <Modal size="view" open={native && Boolean(editing)} onOpenChange={(open) => { if (!open) closeEditor(false); }} title={editing?.id ? "Redigera plats" : `Ny plats under ${placeName(place)}`} className="max-w-lg">
      {editing?.id && returnTo && editRequested ? <p className="mb-3 text-sm text-muted-foreground" data-testid="place-edit-return-note">Ändringen gäller platsen överallt.</p> : null}
      {editing ? <PlaceForm maintenance={data.maintenance} value={editing.facility} onChange={(facility) => setEditing({ ...editing, facility })} places={data.places} placeId={editing.id} error={formError} busy={busy} onCancel={() => closeEditor(false)} onSubmit={() => void save()}
        submitLabel={editing.id && returnTo && editRequested ? "Spara och gå tillbaka" : undefined} /> : null}
    </Modal>;
  const placeHref = (id: string) => `/?view=place&placeId=${encodeURIComponent(id)}`;
  // Redigera plats / Ny plats under …: a page of its own on levels 2–3; Avbryt goes back where the person came from,
  // Spara to the place (the new one for a new place), or back to the work it was opened from (returnTo).
  if (pageMode) return <FormPage title={newRequested && !editRequested ? `Ny plats under ${placeName(place)}` : "Redigera plats"} back={returnTo ?? placeHref(place.id)} testId="place-form-page"
    description={editing?.id && returnTo ? "Ändringen gäller platsen överallt." : undefined}>
    {(form) => editing ? <PlaceForm maintenance={data.maintenance} value={editing.facility} onChange={(facility) => setEditing({ ...editing, facility })} places={data.places} placeId={editing.id} error={formError} busy={busy} onCancel={form.cancel}
      onSubmit={() => void save((id) => { if (returnTo && editing.id === placeId) { announce("Platsen är uppdaterad."); form.done(); } else { announce("Plats sparad."); form.done(placeHref(id)); } })}
      submitLabel={editing.id && returnTo ? "Spara och gå tillbaka" : undefined} />
      : <p role="status" className="text-sm text-muted-foreground">{data.canEdit ? "Hämtar platsen…" : "Du saknar behörighet att ändra platsen."}</p>}
  </FormPage>;
  if (native) {
    const screenHref = (tabKey: Tab) => withScreen(params.toString(), NATIVE_STEP[tabKey]);
    const factRow = (label: string, value: React.ReactNode) => value ? <ListRow key={label} title={value} subtitle={label} wrap /> : null;
    const counts: Partial<Record<Tab, number>> = { structure: data.children.length, plan: data.rounds.length, history: data.history.total, limits: data.limits.length };
    return <NativePage testId="place-page">
      {!nativeTab ? <>
        {/* M1/M2 (2026-10-12): the place's name is the top bar's title; the two usual actions are big tiles. */}
        <p className="min-w-0 break-words px-1 pb-1 pt-1 text-sm leading-5 text-muted-foreground" data-testid="place-summary">{[PLACE_KIND_LABELS[place.kind], maintenance ? place.objectType : "", address, !place.isActive ? "pausad" : ""].filter(Boolean).join(" · ")}</p>
        {/* No Ny arbetsorder or Ny uppgift tiles (2026-10-22): the register creates no jobs; work is created the usual way. */}
        <ContactActions native destination={destination} testId="place-navigate" />
        {error ? <p role="alert" className="notice text-destructive">{error}</p> : null}
        {data.chain.length > 1 ? <ListGroup title="Ligger under" testId="place-chain">
          {data.chain.slice(0, -1).map((item) => <ListRow key={item.id} type="customer" icon={MapPinHouse} title={placeName(item)} href={`/?view=place&placeId=${encodeURIComponent(item.id)}`} />)}
        </ListGroup> : null}
        {due.length ? <ListGroup title={scanned && due.length > 1 ? "Vilken rond gör du?" : "Påbörjade ronder här"} testId="place-rounds-due">
          {due.map((round) => <ListRow key={round.id} type="round" icon={CircleDashed} title={round.title} href={roundHref(round, round.current!, place.id)}
            subtitle={`${round.current!.state === "started" ? "Påbörjad" : occurrenceOverdue(round.current!) ? "Missad" : "I dag"} · ${listPlaceLabel(round.facilityName, round.tempPlace)}`} />)}
        </ListGroup> : null}
        <ListGroup title="Platsen" testId="place-rows">
          {TABS.map((value) => { const Icon = TAB_ICONS[value]; return <ListRow key={value} type={value === "plan" ? "round" : value === "history" ? "control" : value === "limits" ? "instrument" : "customer"} icon={Icon} title={NATIVE_TAB_LABELS[value]}
            value={counts[value] !== undefined ? String(counts[value]) : undefined} href={screenHref(value)} testId={`place-row-${value}`} />; })}
        </ListGroup>
        {editable ? <ListGroup><ListRow type="neutral" icon={Pencil} title="Redigera plats" onClick={editOwn} testId="place-edit" /></ListGroup> : null}
      </> : null}
      {nativeTab === "overview" ? <>
        <ListGroup testId="place-overview">
          {factRow("Väg", place.path)}{factRow("Typ", PLACE_KIND_LABELS[place.kind])}{factRow("Adress", address)}{factRow("Beskrivning", place.description)}
          {typeof place.openWorkOrders === "number" ? factRow("Öppna arbetsordrar", String(place.openWorkOrders)) : null}
          {maintenance ? <>
            {factRow("Objekttyp", place.objectType)}
            {factRow("Driftstatus", place.operatingState ? OPERATING_STATE_LABELS[place.operatingState] : "")}{factRow("Tillverkare", place.manufacturer)}{factRow("Modell", place.model)}
            {factRow("Serienummer", place.serialNumber)}{factRow("Installerad", place.installedOn ? day(place.installedOn) : "")}
          </> : null}
        </ListGroup>
        {maintenance && place.attributes.length ? <ListGroup title="Tekniska värden" testId="place-attributes">{place.attributes.map((item, index) => <ListRow key={index} title={item.label} value={item.value || "–"} />)}</ListGroup> : null}
        {mapStatus && (place.position || data.pins?.length) ? <div className="mt-4 overflow-hidden rounded-[.875rem]" data-testid="place-page-map">
          <PlaceMap status={mapStatus} label={`Karta: ${placeName(place)}`} hint={data.pins?.length ? "Nålarna för platserna under öppnar dem." : null}
            points={[
              ...(place.position ? [{ id: place.id, latitude: place.position.latitude, longitude: place.position.longitude, label: place.position.own ? place.path : `${place.positionFrom?.name ?? "Platsen ovanför"} (ärvd position)`, muted: !place.position.own }] : []),
              ...(data.pins ?? []).map((pin) => ({ ...pin, href: `/?view=place&placeId=${encodeURIComponent(pin.id)}` })),
            ]} />
        </div> : null}
        {links ? <ListGroup title="Vägbeskrivning">
          <ListRow type="customer" icon={ExternalLink} title="Google Kartor" onClick={() => window.open(links.google, "_blank", "noopener")} />
          <ListRow type="customer" icon={ExternalLink} title="Apple Kartor" onClick={() => window.open(links.apple, "_blank", "noopener")} />
        </ListGroup> : null}
        {editable ? <ListGroup><ListRow type="neutral" icon={Pencil} title="Redigera plats" onClick={editOwn} /></ListGroup> : null}
      </> : null}
      {nativeTab === "structure" ? <ListGroup testId="place-children">
        {children.length ? children.slice(0, childPage * CHILD_PAGE).map((item) => <ListRow key={item.place.id} type="customer" icon={MapPinHouse} title={placeName(item.place)} twoLines href={`/?view=place&placeId=${encodeURIComponent(item.place.id)}`}
          subtitle={[item.place.kind ? PLACE_KIND_LABELS[item.place.kind as PlaceKind] : "", item.children ? `${item.children} under` : "", item.openWorkOrders ? `${item.openWorkOrders} öppna arbetsordrar` : ""].filter(Boolean).join(" · ")} />)
          : <ListEmpty>Inget under platsen ännu.</ListEmpty>}
        {children.length > childPage * CHILD_PAGE ? <ListRow title={<span className="text-primary">Visa fler</span>} chevron={false} onClick={() => setChildPage((current) => current + 1)} /> : null}
        {editable && place.isActive ? <ListRow type="new" icon={Plus} title="Lägg till under" onClick={addChild} testId="place-add-child" /> : null}
      </ListGroup> : null}
      {nativeTab === "plan" ? <ListGroup testId="place-rounds" footer="Ronderna planeras under Driftronder.">
        {data.rounds.length ? data.rounds.map((round) => <ListRow key={round.id} type="round" icon={Repeat} title={round.title} twoLines href={round.active && round.current?.taskId ? roundHref(round, round.current, place.id) : undefined}
          subtitle={[roundFormNotice(round) ?? round.templateName, listPlaceLabel(round.facilityName, round.tempPlace), round.ruleText, round.active ? "" : "Pausad"].filter(Boolean).join(" · ")}
          value={round.active && round.current?.taskId ? "Fortsätt" : round.next ? `Nästa ${round.next}` : undefined} />)
          : <ListEmpty>Ingen rond vid platsen.</ListEmpty>}
      </ListGroup> : null}
      {nativeTab === "history" ? <>
        <ListGroup testId="place-history">
          {data.history.items.length ? data.history.items.map((item) => <ListRow key={`${item.kind}-${item.id}`} type={taskType(item.kind)} title={item.title || "Utan rubrik"} twoLines href={item.href}
            subtitle={[statusLabel(item.status), item.below ? `under ${item.below}` : "", item.assignedToName, formatSwedish(item.updatedAt, { dateStyle: "short" })].filter(Boolean).join(" · ")} />)
            : <ListEmpty>Inget gjort här ännu.</ListEmpty>}
          {data.history.items.length < data.history.total ? <ListRow title={<span className="text-primary">{busy ? "Hämtar…" : "Visa fler"}</span>} chevron={false} onClick={() => { if (!busy) void load(data.history.page + 1); }} /> : null}
        </ListGroup>
        {data.projects.length ? <ListGroup title="Projekt här">{data.projects.map((project) => <ListRow key={project.id} type="project" title={project.name} href={`/?view=project&projectId=${encodeURIComponent(project.id)}`}
          subtitle={[project.startDate && project.dueDate ? `${project.startDate} – ${project.dueDate}` : "", project.below ? `under ${project.below}` : "", project.archivedAt ? "Arkiverat" : project.closedAt ? "Avslutat" : ""].filter(Boolean).join(" · ") || undefined} />)}</ListGroup> : null}
      </> : null}
      {nativeTab === "limits" ? <ListGroup testId="place-limits" footer="Gränsvärdena ändras i ett protokoll på platsen av företagets administratör.">
        {data.limits.length ? data.limits.map((limit) => <ListRow key={limit.id} type="instrument" icon={Gauge} title={limit.templateName} twoLines
          subtitle={[limit.objectName, `${limit.count} ${limit.count === 1 ? "gränsvärde" : "gränsvärden"}`, `ändrat ${formatSwedish(limit.updatedAt, { dateStyle: "short" })}`].filter(Boolean).join(" · ")} />)
          : <ListEmpty>Inga gränsvärden här.</ListEmpty>}
      </ListGroup> : null}
      {editor}
    </NativePage>;
  }
  return <div className="space-y-6" data-testid="place-page">
    <PageHeader title={<>{placeName(place)}{!place.isActive ? <span className="text-base font-normal text-muted-foreground">(pausad)</span> : null}</>}
      description={[PLACE_KIND_LABELS[place.kind], maintenance ? place.objectType : "", address].filter(Boolean).join(" · ")}
      /* No QR label, Ny uppgift här or Ny arbetsorder här (2026-10-22): the register creates no jobs; QR labels are printed from the round. */
      actions={editable ? <Button variant="outline" onClick={editOwn} data-testid="place-edit-top"><Pencil />Redigera</Button> : undefined}>
      {data.chain.length > 1 ? <nav aria-label="Ligger under" className="mt-2 flex flex-wrap items-center gap-1 text-sm text-muted-foreground" data-testid="place-chain">
          <span>Ligger under</span>
          {data.chain.slice(0, -1).map((item, index) => <span key={item.id} className="flex items-center gap-1">{index > 0 ? <span aria-hidden="true">›</span> : null}<Link className="text-primary hover:underline" href={`/?view=place&placeId=${encodeURIComponent(item.id)}`}>{placeName(item)}</Link></span>)}
        </nav> : null}
      {maintenance && place.operatingState ? <div className="mt-2 flex flex-wrap gap-1.5" data-testid="place-badges"><PlaceBadges place={place} /></div> : null}
      <div className="mt-3"><ContactActions destination={destination} testId="place-navigate" /></div>
    </PageHeader>

    {/* Several rounds due here: a short choice, each opening at this place's point. */}
    {due.length ? <Panel title={scanned && due.length > 1 ? "Vilken rond gör du?" : "Påbörjade ronder här"} description="Ronden öppnas vid den här platsens punkt, och skanningen noteras i protokollet." icon={Repeat}>
      <ul className="grid gap-2 sm:grid-cols-2" data-testid="place-rounds-due">
        {due.map((round) => <li key={round.id}><Button asChild variant="outline" className="h-auto w-full justify-start py-3 text-left"><Link href={roundHref(round, round.current!, place.id)}>
          <CircleDashed className="shrink-0" /><span className="min-w-0"><span className="block truncate font-medium">{round.title}</span><span className="block truncate text-xs text-muted-foreground">{round.current!.state === "started" ? "Påbörjad" : occurrenceOverdue(round.current!) ? "Missad" : "Idag"} · {listPlaceLabel(round.facilityName, round.tempPlace)}</span></span>
        </Link></Button></li>)}
      </ul>
    </Panel> : null}

    <PlaceTabs tab={tab} onTab={setTab} counts={{ structure: data.children.length, plan: data.rounds.length, history: data.history.total, limits: data.limits.length }} />
    {error ? <p role="alert" className="notice text-destructive">{error}</p> : null}

    {tab === "overview" ? <>
      <Panel title="Översikt" description={maintenance ? "Platsens uppgifter och objektdata." : "Platsens uppgifter."} icon={LayoutDashboard}
        actions={editable ? <Button size="sm" variant="outline" onClick={editOwn} data-testid="place-edit"><Pencil />Redigera</Button> : undefined}>
        <dl className="grid gap-3 text-sm sm:grid-cols-2" data-testid="place-overview">
          {fact("Väg", place.path, true)}
          {fact("Typ", PLACE_KIND_LABELS[place.kind])}
          {fact("Adress", address, true)}
          {fact("Beskrivning", place.description, true)}
          {typeof place.openWorkOrders === "number" ? fact("Öppna arbetsordrar", String(place.openWorkOrders)) : null}
          {maintenance ? <>
            {fact("Objekttyp", place.objectType)}
            {fact("Driftstatus", place.operatingState ? OPERATING_STATE_LABELS[place.operatingState] : "")}
            {fact("Tillverkare", place.manufacturer)}
            {fact("Modell", place.model)}
            {fact("Serienummer", place.serialNumber)}
            {fact("Installerad", place.installedOn ? day(place.installedOn) : "")}
          </> : null}
        </dl>
        {maintenance && place.attributes.length ? <div className="mt-4"><h3 className="text-xs font-semibold text-muted-foreground">Tekniska värden</h3>
          <dl className="mt-2 divide-y rounded-lg border text-sm" data-testid="place-attributes">{place.attributes.map((item, index) => <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 px-3 py-2"><dt className="text-muted-foreground">{item.label}</dt><dd className="break-words">{item.value || "–"}</dd></div>)}</dl></div> : null}
        {maintenance && !placeHasObjectData(place) && editable ? <p className="mt-4 text-xs text-muted-foreground">Ingen objektdata ännu. Lägg till med Redigera.</p> : null}
      </Panel>
      {mapStatus && (place.position || data.pins?.length) ? <div data-testid="place-page-map">
        <PlaceMap status={mapStatus} label={`Karta: ${placeName(place)}`} hint={data.pins?.length ? "Nålarna för platserna under öppnar dem." : null}
          points={[
            ...(place.position ? [{ id: place.id, latitude: place.position.latitude, longitude: place.position.longitude, label: place.position.own ? place.path : `${place.positionFrom?.name ?? "Platsen ovanför"} (ärvd position)`, muted: !place.position.own }] : []),
            ...(data.pins ?? []).map((pin) => ({ ...pin, href: `/?view=place&placeId=${encodeURIComponent(pin.id)}` })),
          ]} />
        {place.position && !place.position.own && place.positionFrom ? <p className="mt-1.5 text-xs text-muted-foreground" data-testid="place-position-inherited">Positionen ärvs från <Link className="text-primary hover:underline" href={`/?view=place&placeId=${encodeURIComponent(place.positionFrom.id)}`}>{place.positionFrom.name}</Link>.{editable ? " Sätt platsens egen position med Redigera." : ""}</p> : null}
      </div>
        : links ? <p className="flex flex-wrap gap-2"><Button asChild variant="outline" size="sm"><a href={links.google} target="_blank" rel="noopener noreferrer"><ExternalLink />Google Kartor</a></Button><Button asChild variant="outline" size="sm"><a href={links.apple} target="_blank" rel="noopener noreferrer"><ExternalLink />Apple Kartor</a></Button></p> : null}
    </> : null}

    {tab === "structure" ? <Panel title="Struktur" description="Det som finns under den här platsen." icon={ListTree}
      actions={editable && place.isActive ? <Button size="sm" variant="outline" data-testid="place-add-child" onClick={addChild}><Plus />Lägg till under</Button> : undefined}>
      <PlaceCardGrid items={children.slice(0, childPage * CHILD_PAGE)} total={children.length} onMore={() => setChildPage((current) => current + 1)} maintenance={maintenance}
        hrefFor={(item) => `/?view=place&placeId=${encodeURIComponent(item.place.id)}`}
        empty={<Empty title="Inget under platsen" description="Byggnader, utrymmen och objekt som läggs under platsen visas här." />} />
    </Panel> : null}

    {tab === "plan" ? <Panel title="Underhållsplan" description="Driftronder vid platsen. De planeras under Driftronder." icon={Repeat}
      actions={<Button asChild size="sm" variant="outline"><Link href="/?view=rounds" data-testid="place-open-rounds"><Repeat />Öppna Driftronder</Link></Button>}>
      {data.rounds.length ? <ul className="divide-y" data-testid="place-rounds">{data.rounds.map((round) => <li key={round.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
        <div className="min-w-0"><p className="font-medium">{round.title}</p><p className="text-xs text-muted-foreground">{[roundFormNotice(round) ?? round.templateName, listPlaceLabel(round.facilityName, round.tempPlace), round.ruleText, round.active ? "" : "Pausad"].filter(Boolean).join(" · ")}</p></div>
        {round.active && round.current?.taskId ? <Button asChild size="sm" variant="outline"><Link href={roundHref(round, round.current, place.id)}><CircleDashed />Fortsätt</Link></Button> : round.next ? <span className="text-xs text-muted-foreground">Nästa {round.next}</span> : null}
      </li>)}</ul> : <Empty title="Ingen rond här" description="Driftronder som schemaläggs på platsen, på något ovanför den eller under den visas här." />}
    </Panel> : null}

    {tab === "history" ? <>
      <Panel title="Historik" description="Allt som gjorts här och på platserna under, senast ändrat först." icon={ClipboardList}>
        {data.history.items.length ? <ul className="divide-y" data-testid="place-history">{data.history.items.map((item) => <li key={`${item.kind}-${item.id}`} className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
          <div className="min-w-0"><Link className="font-medium hover:text-primary" href={item.href}>{item.title || "Utan rubrik"}</Link>
            <p className="text-xs text-muted-foreground">{[typeLabel(item.kind), item.below ? `under ${item.below}` : "", item.assignedToName, formatSwedish(item.updatedAt, { dateStyle: "short" })].filter(Boolean).join(" · ")}</p></div>
          <Badge variant="outline" className={indicatorBadge(item.status === "NEEDS_ACTION" ? "danger" : statusTone(item.status))}>{statusLabel(item.status)}</Badge>
        </li>)}</ul> : <Empty title="Inget gjort här ännu" description="Uppgifter, protokoll och kontroller för platsen." />}
        <ShowMore shown={data.history.items.length} total={data.history.total} busy={busy} onMore={() => void load(data.history.page + 1)} />
      </Panel>
      {data.projects.length ? <Panel title="Projekt här" icon={FolderKanban}>
        <ul className="divide-y">{data.projects.map((project) => <li key={project.id} className="py-2.5 first:pt-0 last:pb-0"><Link className="font-medium hover:text-primary" href={`/?view=project&projectId=${encodeURIComponent(project.id)}`}>{project.name}</Link>
          <p className="text-xs text-muted-foreground">{[project.startDate && project.dueDate ? `${project.startDate} – ${project.dueDate}` : "", project.below ? `under ${project.below}` : "", project.archivedAt ? "Arkiverat" : project.closedAt ? "Avslutat" : ""].filter(Boolean).join(" · ")}</p></li>)}</ul>
      </Panel> : null}
    </> : null}

    {tab === "limits" ? <Panel title="Gränsvärden" description="Företagets gränsvärden för platsen. Ändras av administratör i ett protokoll." icon={Gauge}>
      {data.limits.length ? <ul className="divide-y" data-testid="place-limits">{data.limits.map((limit) => <li key={limit.id} className="py-2.5 first:pt-0 last:pb-0">
        <p className="font-medium">{limit.templateName}{limit.objectName ? <span className="font-normal text-muted-foreground"> · {limit.objectName}</span> : null}</p>
        <p className="text-xs text-muted-foreground">{[`${limit.count} ${limit.count === 1 ? "gränsvärde" : "gränsvärden"}`, `ändrat ${formatSwedish(limit.updatedAt, { dateStyle: "short" })}`, limit.updatedByName].filter(Boolean).join(" · ")}</p>
      </li>)}</ul> : <Empty title="Inga gränsvärden här" description="Gränsvärden som sätts för ett formulär på platsen visas här." />}
    </Panel> : null}

    {editor}
  </div>;
}

/**
 * Svar 10 (2026-10-24): a scanned place with a round but no started protocol. One round: "<Rond> ska göras i dag –
 * Starta ronden?" (or "Starta en extra rond?") with Starta ronden and Avbryt; several: a list to choose from. Starta opens the
 * round's new protocol the same way as Starta under Driftronder (`scanStart`: it is created at once, the server decides
 * the right) at the scanned point. Nothing is created without the tap.
 */
function ScanStartPrompt({ place, starts, onStart, onCancel }: { place: string; starts: ScanStart[]; onStart: (start: ScanStart) => void; onCancel: () => void }) {
  const one = starts.length === 1 ? starts[0]! : null;
  // 2026-10-24: a round whose form is not published shows the warning and no Starta.
  const blocked = one?.formNotice ?? null;
  return <Panel title={place} description="Skannad plats">
    <p role="status" className="text-sm text-muted-foreground">Ingen rond är påbörjad här.</p>
    <Modal open onOpenChange={(open) => { if (!open) onCancel(); }} title={blocked ? "Ronden kan inte startas" : one ? (one.today ? "Starta ronden?" : "Starta en extra rond?") : "Vilken rond gör du?"} size="compact" className="max-w-lg">
      <div className="space-y-4" data-testid="place-scan-start">
        {one && blocked ? <p role="alert" className={cn("text-sm font-medium", indicatorText("warning"))} data-testid="round-form-missing">{one.title}: {blocked}.</p>
        : one ? <>
          <p className="text-sm" data-testid="place-scan-start-question">{scanStartQuestion(one)}</p>
          {one.today ? null : <p className="text-sm text-muted-foreground">{one.title}</p>}
        </> : <ul className="grid gap-2" data-testid="place-scan-start-list">{starts.map((start) => <li key={start.roundId}>
          {start.formNotice ? <p className="rounded-lg border px-3 py-2 text-sm" data-testid="round-form-missing"><span className="block font-medium">{start.title}</span><span className={cn("block text-xs font-medium", indicatorText("warning"))}>{start.formNotice}</span></p> : <Button type="button" variant="outline" className="h-auto min-h-11 w-full justify-start whitespace-normal py-2 text-left" onClick={() => onStart(start)} data-testid="place-scan-start-choice" aria-label={`Starta ${start.title}`}>
            <Play /><span className="min-w-0"><span className="block font-medium">{start.title}</span><span className="block text-xs text-muted-foreground">{start.today ? "Ska göras i dag" : "Extra rond"}</span></span>
          </Button>}
        </li>)}</ul>}
        <DialogActions cancel={{ onClick: onCancel }} primary={one && !blocked ? { label: "Starta ronden", icon: <Play />, onClick: () => onStart(one), testId: "place-scan-start-go" } : null} />
      </div>
    </Modal>
  </Panel>;
}
