"use client";

import { mapSearchHref, type Destination } from "@/lib/workflow/contact-links";
import { ReturnButton, useReturnTo, useSubPageHref } from "./use-return-to";
import { PageActionsSlotProvider, PageHeader, usePageTrail } from "@/components/page-shell";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { MapPin, Pencil, Plus, Trash2, Contact, ClipboardList, FileText, FolderKanban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "./api";
import { Empty, Panel, RowsSkeleton, ShowMore, SkeletonText } from "./ui";
import { PlaceBrowser, PlaceBrowserSkeleton, type PlaceDetailData } from "@/features/workflow/place-browser";
import { rememberedCustomerName } from "./customer-register-layout";
import { useConfirm } from "./confirm";
import { announce } from "@/lib/workflow/toast";
import type { CustomerItem } from "./types";
import { placeName, placePath, type CustomerFacilityInput, type FacilityItem } from "@/lib/workflow/customer-facility";
import { PlaceMap, useMapStatus } from "@/features/workflow/map-view";
import type { ProjectStatus } from "@/lib/workflow/project-status";
import { indicatorBadge, statusTone } from "@/features/workflow/indicator-tone";
import { ListEmpty, ListGroup, ListRow, ListSkeleton, NativePage, NativePickerRow, NativeScreen, useNativeScreen, useNativeTopBar } from "@/components/native";
import { CUSTOMER_SCREEN_TITLE, parseCustomerScreen } from "@/lib/workflow/native-mode";
import { ContactActions } from "@/components/contact-actions";
import { NativeCustomerMenu } from "@/features/workflow/native-customer";
import { CustomerInlineEdit } from "./customer-register-forms";
import type { ReadCustomer, SaveCustomer } from "./customer-form-dialog";
import { CustomerQuotes, type CustomerQuotesSummary } from "@/features/quotes/customer-quotes";
import { useModules } from "@/features/workflow/use-modules";
import { CUSTOMER_TYPE_LABELS, customerTypeOf } from "@/lib/kfid/customer-schema";
import { isOwnCompany, OWN_COMPANY_PLACES_TITLE } from "@/lib/workflow/own-company";
import { customerContact, customerTitle } from "@/lib/kfid/customer-name";
import { JobCustomerCard } from "./job-customer-card";
import { DocumentsSection } from "@/features/documents/documents-panel";
import type { JobCustomerCardData } from "@/lib/kfid/job-access";


export type CustomerCardKind = "all" | "WORK_ORDER" | "RISK_ASSESSMENT" | "FORM";
export type CustomerCardFacility = FacilityItem & { version?: number; links: number; /** Open work orders at the place; null when the member may not read work orders. */ openWorkOrders?: number | null };
export type CustomerCardTask = { id: string; kind: string; title: string; status: string; progress: number; updatedAt: string; facilityId: string | null; projectName: string };
export type CustomerCardData = {
  customer: Omit<CustomerItem, "facilities">;
  facilities: CustomerCardFacility[];
  projects: { id: string; name: string; startDate: string; dueDate: string; facilityId: string | null; status: ProjectStatus }[];
  canReadProjects: boolean;
  /** False for a member without Kunder: Anteckningar, Särskilda krav and the customer number are withheld, so not drawn (2026-10-24). */
  registerNotes?: boolean;
  /** Kundkortets offerter (2026-10-10): null or absent without the right to read quotes, and always in Local. */
  quotes?: CustomerQuotesSummary | null;
  tasks: { items: CustomerCardTask[]; total: number; page: number; pages: number; counts: Record<CustomerCardKind, number> };
  canManageFacilities: boolean;
  /** Underhåll (2026-10-06, B1): the company uses the maintenance module. */
  maintenance?: boolean;
};
/** Local reads the open .hwf file and writes through the same pure store functions; Cloud uses /api/customer-card. */
export type CustomerCardAdapter = {
  load: (kind: CustomerCardKind, page: number) => Promise<CustomerCardData>;
  saveFacility: (input: { id?: string; version?: number; facility: CustomerFacilityInput }) => Promise<void>;
  setFacilityActive: (id: string, isActive: boolean) => Promise<void>;
  /** Ta bort (2026-10-14): only a place nothing points to; the store refuses the others. */
  deleteFacility: (id: string) => Promise<void>;
};

/** Kontaktuppgifter's labels, in the order the card shows them (the page on its way draws the same). */
const CONTACT_LABELS = ["Kundtyp", "Kontaktperson", "Företag", "Adress", "E-post", "Telefon", "Mobil", "Kundnummer i bokföringen", "Anteckningar", "Särskilda krav"] as const;
/** Sections show this many rows before "Visa alla" (plan 1R). */
const PREVIEW = 6;
type Section = "contact" | "facilities" | "projects" | "tasks" | "quotes";
const kindLabels: Record<CustomerCardKind, string> = { all: "Alla", WORK_ORDER: "Arbetsorder", RISK_ASSESSMENT: "Riskbedömningar", FORM: "Formulär" };
const typeLabel = (kind: string) => kind === "WORK_ORDER" ? "Arbetsorder" : kind === "RISK_ASSESSMENT" ? "Riskbedömning" : "Formulär";
const statusLabel = (status: string) => ({ PLANNED: "Planerad", IN_PROGRESS: "Pågår", PAUSED: "Pausad", NEEDS_ACTION: "Behöver åtgärdas", COMPLETED: "Färdigställd", CANCELLED: "Utgått", DRAFT: "Utkast" } as Record<string, string>)[status] ?? status;
// fromCustomer (N14, 2026-11-01): the job's trail and marked menu button lead back here, not through its project.
const taskHref = (task: CustomerCardTask, customerId: string | null) => `/?view=workflow_task&taskId=${encodeURIComponent(task.id)}&taskType=${task.kind}${customerId ? `&fromCustomer=${encodeURIComponent(customerId)}` : ""}`;

function cloudAdapter(customerId: string): CustomerCardAdapter {
  return {
    load: (kind, page) => api<CustomerCardData>(`/api/customer-card?${new URLSearchParams({ id: customerId, kind, page: String(page) })}`),
    saveFacility: async (input) => { await api("/api/customer-card", { method: "POST", body: JSON.stringify({ action: "facility_save", customerId, ...input }) }); },
    setFacilityActive: async (id, isActive) => { await api("/api/customer-card", { method: "POST", body: JSON.stringify({ action: "facility_status", id, isActive }) }); },
    deleteFacility: async (id) => { await api("/api/customer-card", { method: "POST", body: JSON.stringify({ action: "facility_delete", id }) }); },
  };
}

/**
 * The customer card (2026-09-26, decision 12B/D10 B): the customer is the hub for its projects, all its tasks,
 * its facilities (decision 11) and its contact details. Tasks are loaded one bounded page at a time.
 */
export function CustomerCard({ customerId, local, onEdit, canEdit = true, canCreateProject = false, canDelete = false, customerEditor, onCustomerSaved, onDeleteCustomer: onDeleteProp, onName }: { customerId: string; local?: CustomerCardAdapter;
  /** Level 1's way to the customer's form screen; display 2 and 3 fold the form out on the card (plan 1Q, 2026-10-11). */
  onEdit?: (customer: CustomerItem) => void;
  /** How the folded-out form reads and saves the customer; the customer register's API by default (Local brings its own). */
  customerEditor?: { read: ReadCustomer; save: SaveCustomer; idPrefix?: string; submitLabel?: string; message?: string };
  /** The customers permission (2026-10-02): without it, the card is read-only even where onEdit is given. */
  canEdit?: boolean;
  /** Nytt projekt from the card (plan 1A, 2026-10-11): shown with the right to create projects; the server decides again. */
  canCreateProject?: boolean;
  /** The customer was saved from the folded-out form: the register beside the card reads its list again. */
  onCustomerSaved?: () => void;
  /** Ta bort kund in the Kontaktuppgifter header (the register asks first); absent when the person may not remove customers. */
  onDeleteCustomer?: () => void;
  /** Cloud's own page (2026-10-14): the card moves the customer to the papperskorg itself, after asking (admins only). */
  canDelete?: boolean;
  /** The customer's name once it is read, for the register's "Byt kund" bar on a narrow screen. */
  onName?: (name: string) => void }) {
  // Samband (2026-10-26): opened from a job's place or from Företaget, the card leads back there ("Tillbaka till …").
  const way = useReturnTo();
  const subPage = useSubPageHref();
  const [adapter] = useState(() => local ?? cloudAdapter(customerId));
  const [data, setData] = useState<CustomerCardData | null>(null);
  const [tasks, setTasks] = useState<CustomerCardTask[]>([]);
  // The register's counts link straight to a tab and task type (F15, 2026-09-29): ?tab=tasks&kind=WORK_ORDER.
  const params = useSearchParams();
  // Ett kundkort på nivå 1 (2026-10-09): a menu of rows; each tab's panel is a screen of its own (`&step=`).
  const { native, step } = useNativeScreen();
  const screen = parseCustomerScreen(step);
  // The Platser screen's bar belongs to the places' folder view (its own title, back and Avbryt/Spara, 2026-10-14).
  useNativeTopBar(native && screen && screen !== "platser" ? { title: CUSTOMER_SCREEN_TITLE[screen] } : null);
  const [kind, setKind] = useState<CustomerCardKind>(() => (["WORK_ORDER", "RISK_ASSESSMENT", "FORM"].includes(params.get("kind") ?? "") ? params.get("kind") as CustomerCardKind : "all"));
  const [allProjects, setAllProjects] = useState(false);
  const [allTasks, setAllTasks] = useState(false);
  // The register's old counts linked to a tab (?tab=tasks&kind=WORK_ORDER): the section is scrolled into view once the card is read.
  const wantedSection = params.get("tab");
  const scrolledToSection = useRef(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Redigera kund folds the form out on the card (`&edit=1` in the address opens it at once).
  const wantsEdit = params.get("edit") === "1";
  const [editingCustomer, setEditingCustomer] = useState(wantsEdit);
  // Redigera kund: Avbryt and Spara kund stand in the page header, top right, while the form is open (2026-10-26).
  const [editActions, setEditActions] = useState<HTMLElement | null>(null);
  const [confirmDelete, confirmDeleteElement] = useConfirm();
  const router = useRouter();
  // Ta bort kund on Cloud's own page: to the papperskorg (it can be restored there), then back to the register.
  const onDeleteCustomer = onDeleteProp ?? (canDelete && !local ? () => void (async () => {
    if (!(await confirmDelete({ title: "Flytta kunden till papperskorgen?", message: "Du kan återställa kunden från papperskorgen senare.", confirmLabel: "Flytta till papperskorgen", tone: "danger" }))) return;
    try {
      await api("/api/records", { method: "POST", body: JSON.stringify({ kind: "customers", action: "delete", ids: [customerId] }) });
      announce("Kunden ligger i papperskorgen.");
      router.replace("/?view=customers");
    } catch (cause) { announce((cause as Error).message, true); }
  })() : undefined);
  const [seenEdit, setSeenEdit] = useState(wantsEdit);
  if (wantsEdit !== seenEdit) { setSeenEdit(wantsEdit); if (wantsEdit) setEditingCustomer(true); }
  const closeEditing = () => {
    setEditingCustomer(false);
    // The address asked for it once; Avbryt and Spara then do not meet `edit=1` again.
    if (new URL(window.location.href).searchParams.has("edit")) {
      const url = new URL(window.location.href);
      url.searchParams.delete("edit");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
    }
  };
  // Ny adress above the list of places (2026-10-14): the form stands first in the list.
  const [newAddress, setNewAddress] = useState(false);
  // Anläggningar som träd (2026-10-15): the open address or object is in the address (`&place=`), so a QR label, a link and
  // Bakåt from a job open the customer at that place. On display 2–3 the place opens beside the tree (2026-10-15 kväll), so opening a place
  // replaces the entry (Bakåt leaves the customer as before); on level 1 a place is a screen of its own and is pushed.
  const openPlace = params.get("place");
  const navigatePlace = (id: string | null) => {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("place", id); else url.searchParams.delete("place");
    url.searchParams.delete("scan");
    if (native) router.push(`${url.pathname}${url.search}`, { scroll: false });
    else router.replace(`${url.pathname}${url.search}`, { scroll: false });
  };
  const startNewAddress = () => setNewAddress(true);
  const mapStatus = useMapStatus();
  const [showMap, setShowMap] = useState(false);
  const mapBox = useRef<HTMLDivElement | null>(null);
  // "Visa på karta" on a folded-out place (2026-10-07): opens the map and centres it on that place.
  const [focus, setFocus] = useState<{ latitude: number; longitude: number; nonce: number } | null>(null);
  const showOnMap = (place: Destination) => {
    // An address without a position has no point on the company's map: its text opens in the map service, as Navigera (UT7, 2026-11-01).
    if (place.latitude == null || place.longitude == null) {
      const search = mapSearchHref(place);
      if (search) window.open(search, "_blank", "noopener");
      return;
    }
    setShowMap(true);
    setFocus((current) => ({ latitude: place.latitude!, longitude: place.longitude!, nonce: (current?.nonce ?? 0) + 1 }));
    requestAnimationFrame(() => mapBox.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  };
  // The customer's name in the breadcrumbs (Översikt › Register och verktyg › Kundregister › name).
  // No step of its own for the folded-out form: Redigera kund happens on the card (plan 1R).
  // The name the register's row showed is used until the card is read, so the trail does not change length under the eye.
  const moduleIsOn = useModules();
  usePageTrail({ customer: (data ? customerTitle(data.customer) : undefined) ?? rememberedCustomerName(customerId), ...(isOwnCompany(data?.customer) ? { ownCompany: true } : {}) }, { customerId, edit: null });
  const jumpTo = (section: Section) => document.getElementById(`customer-section-${section}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const load = useCallback(async (nextKind: CustomerCardKind, page = 1) => {
    setBusy(true);
    try {
      const result = await (local ?? adapter).load(nextKind, page);
      setData(result);
      // The limited card of someone with a job at the customer (beslut 10) holds no task list.
      if (!("limited" in result)) setTasks((current) => page === 1 ? result.tasks.items : [...current, ...result.tasks.items]);
      setError("");
    } catch (issue) {
      setError((issue as Error).message);
    } finally {
      setBusy(false);
    }
  }, [adapter, local]);
  // Started one microtask later, as useLoadEffect does, so the busy flag is not set inside the effect body.
  useEffect(() => { queueMicrotask(() => void load(kind)); }, [kind, load]);
  const loadedName = data?.customer.name;
  const nameRef = useRef(onName);
  useEffect(() => { nameRef.current = onName; });
  useEffect(() => { if (loadedName) nameRef.current?.(loadedName); }, [loadedName]);
  const readyToScroll = Boolean(data) && !native;
  useEffect(() => {
    if (!readyToScroll || scrolledToSection.current || !wantedSection) return;
    scrolledToSection.current = true;
    requestAnimationFrame(() => document.getElementById(`customer-section-${wantedSection}`)?.scrollIntoView({ block: "start" }));
  }, [readyToScroll, wantedSection]);

  if (error && !data) return <Panel title="Kundkortet kunde inte hämtas"><p role="alert" className="text-sm text-destructive">{error}</p></Panel>;
  if (!data) return <CustomerCardSkeleton native={native} name={rememberedCustomerName(customerId)} placeOpen={Boolean(openPlace)} quotes={!local} />;
  // Kunden via jobbet (beslut 10, 2026-11-01): without the right Kunder the server sends only the limited card.
  if ("limited" in data) return <JobCustomerCard data={data as unknown as JobCustomerCardData} />;
  const { customer } = data;
  // Eget företag (2026-10-24: "Bygg likadant"): the company's own places on the very same page – the tree, the action
  // card and the information card – without the customer's contact details, projects and quotes; changed by those who may
  // edit the company (the server decides). It is reached under Företaget and is no customer to edit or remove.
  const own = isOwnCompany(customer);
  const placeEdit = own ? data.canManageFacilities === true : canEdit;
  // Företagets moduler (0.39.0): the customer's quotes go from the card while Offerter is off; they are read under Offerter by a direct link.
  const quotes = !own && !local && data.quotes && moduleIsOn("quotes") ? data.quotes : null;
  // Dokument (0.87.0): the customer's files on Workflow's server, for whoever reads the customer register (not the company's own places).
  const documents = !own && !local && data.registerNotes !== false;
  // Lists show the whole way below the customer (2026-10-04): "Torslandaverken › Måleriet › Elcentral E12".
  const facilityName = (id: string | null) => id && data.facilities.some((facility) => facility.id === id) ? placePath(data.facilities, id) : undefined;
  // The places' changes go through the card's store and read the card again; an error is shown in the list.
  const places = {
    save: async (input: { id?: string; version?: number; facility: CustomerFacilityInput }) => { await (local ?? adapter).saveFacility(input); await load(kind); announce("Plats sparad."); },
    status: async (place: CustomerCardFacility, isActive: boolean) => { await (local ?? adapter).setFacilityActive(place.id, isActive); await load(kind); },
    remove: async (place: CustomerCardFacility) => { await (local ?? adapter).deleteFacility(place.id); await load(kind); announce(`${placeName(place)} är borttagen.`); },
  };
  const placeList = (footer?: ReactNode, desk?: { map: { shown: boolean; onToggle: () => void } | null; above: ReactNode }) => <PlaceBrowser places={data.facilities} footer={footer} map={desk?.map} above={desk?.above}
    onNewAddress={placeEdit && !customer.deletedAt ? startNewAddress : undefined} current={openPlace && data.facilities.some((place) => place.id === openPlace) ? openPlace : null} onNavigate={navigatePlace} scanned={params.get("scan") === "1"} creating={newAddress} onCreatingDone={() => setNewAddress(false)} testId="customer-facilities"
    canEdit={placeEdit && !customer.deletedAt} canManage={data.canManageFacilities && !customer.deletedAt} maintenance={data.maintenance === true}
    onSave={places.save} onStatus={places.status} onDelete={places.remove}
    documents={documents ? (place) => <DocumentsSection key={place.id} variant={native ? "native" : "inline"} customerId={customer.id} placeId={place.id} readOnly={Boolean(customer.deletedAt)} /> : undefined}
    loadDetail={local ? undefined : (id, page) => api<PlaceDetailData>(`/api/places?id=${encodeURIComponent(id)}&page=${page}`)}
    onShowOnMap={mapStatus ? showOnMap : undefined} />;
  // Kundregister skapar inga jobb (2026-10-22): no Ny arbetsorder här and no QR label at a place – work is created the
  // usual way (Ny arbetsorder, choose customer and place), and QR labels are printed from the round they belong to.
  const address = [customer.address, [customer.postalCode, customer.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  // Kundtyp (QA 2026-10-10: not shown on the card): Företag or Privatperson, read the way the customer form saves it.
  const customerTypeLabel = CUSTOMER_TYPE_LABELS[customerTypeOf(customer.customerType)];
  // The row of facts under the name: how much there is in each section, and a way to it.
  const counts: [Section, string][] = [
    ...(data.canReadProjects && !own ? [["projects", `${data.projects.length} projekt`] as [Section, string]] : []),
    ["tasks", `${data.tasks.counts.all} ${data.tasks.counts.all === 1 ? "uppgift" : "uppgifter"}`],
    ...(quotes ? [["quotes", `${quotes.total} ${quotes.total === 1 ? "offert" : "offerter"}`] as [Section, string]] : []),
  ];
  // Nytt projekt from the card comes back to the card (samband, 2026-10-26).
  const newProjectHref = canCreateProject && moduleIsOn("projects") && !customer.deletedAt ? subPage(`/?view=new_project&customerId=${encodeURIComponent(customer.id)}`) : null;
  return <div className="space-y-6">
    {native && !screen ? <NativeCustomerMenu ownCompany={own} customer={{ ...customer, name: own ? OWN_COMPANY_PLACES_TITLE : customerTitle(customer), contactName: own ? "" : customerContact(customer), address, typeLabel: customerTypeLabel }} places={data.facilities.length} projects={data.canReadProjects && !own ? data.projects.length : null} tasks={data.tasks.counts.all} quotes={quotes ? quotes.total : null} documents={documents}
      onEdit={onEdit && canEdit && !own && !customer.deletedAt ? () => onEdit({ ...customer, facilities: data.facilities }) : null}
      onDelete={onDeleteCustomer && !own && !customer.deletedAt ? onDeleteCustomer : null}
      newProjectHref={newProjectHref} /> : null}
    {/* The customer's own page (2026-10-14): the standard header in the normal page width, the sections under it.
        Registrets knappar (2026-10-22, punkt 5): Ring, Navigera and Redigera together in the header's
        actions, top right as on every other page (actions-top-right); while the form is open its Avbryt and Spara kund stand
        there instead. Ta bort kund stands at the foot of the page (the plan's N18, 2026-11-01): visible, but not with the same
        weight as Redigera. */}
    {confirmDeleteElement}
    <NativeScreen show={[]}><PageHeader title={own ? OWN_COMPANY_PLACES_TITLE : customerTitle(customer)} actionsSlotRef={editingCustomer ? setEditActions : undefined}
      actions={editingCustomer ? undefined : own ? (way ? <ReturnButton /> : undefined) : <>
        <ContactActions name={customerTitle(customer)} phone={customer.phone} mobile={customer.mobile} destination={{ address }} testId="customer-contact-actions" />
        {onEdit && canEdit && !customer.deletedAt ? <Button variant="outline" aria-expanded={false} onClick={() => { setEditingCustomer(true); jumpTo("contact"); }} data-testid="customer-edit-button"><Pencil />Redigera</Button> : null}
        <ReturnButton />
      </>}>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground" data-testid="customer-facts">
        {own ? <span>{customer.name}</span> : null}
        {/* The kind of customer leads the facts (it was the eyebrow until 2026-10-30, Fasta platser). */}
        {!own ? <span data-testid="customer-type-fact">{customerTypeLabel}</span> : null}
        {!own && customerContact(customer) ? <span data-testid="customer-contact-fact">{customerContact(customer)}</span> : null}
        {!own && address ? <span>{address}</span> : null}
        {!own && customer.accountingCustomerNumber ? <span>Kundnr {customer.accountingCustomerNumber}</span> : null}
        {counts.map(([section, text]) => <button key={section} type="button" className="font-medium text-primary hover:underline" onClick={() => jumpTo(section)}>{text}</button>)}
      </div>
    </PageHeader></NativeScreen>
    {customer.deletedAt && <div className="notice">Kunden ligger i papperskorgen. Återställ den i kundregistret för att lägga till arbete.</div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {/* Särskilda krav (2026-10-07): in view above the tabs, since the work is done after them; changed by whoever may edit customers. */}
    {native && screen === "krav" ? <NativePage testId="native-customer-krav"><ListGroup footer="Kraven visas också i kundens projekt och uppgifter.">
      <ListRow type="risk" title={customer.specialRequirements?.trim() || "Inga särskilda krav. Lägg till dem under Redigera kund."} wrap testId="customer-special-requirements" />
      {onEdit && canEdit && !customer.deletedAt ? <ListRow type="neutral" icon={Pencil} title="Redigera kund" onClick={() => onEdit({ ...customer, facilities: data.facilities })} /> : null}
    </ListGroup></NativePage> : null}
    {/* Level 1 on a phone (2026-10-09): the card's screens as lists of rows, one thing per screen; no tables,
        no rows of small buttons. A place opens its own page, where it is changed. */}
    {native && screen && screen !== "krav" ? <NativePage testId={`native-customer-${screen}`}>
      {screen === "projekt" ? <ListGroup testId="customer-projects" alignPills>
        {!data.canReadProjects ? <ListEmpty>Du saknar behörighet att läsa projekt.</ListEmpty>
          : data.projects.length ? data.projects.map((project) => <ListRow key={project.id} type="project" title={project.name} twoLines href={`/?view=project&projectId=${encodeURIComponent(project.id)}`}
            subtitle={[project.startDate && project.dueDate ? `${project.startDate} – ${project.dueDate}` : project.dueDate ? `Slutdatum ${project.dueDate}` : "", facilityName(project.facilityId)].filter(Boolean).join(" · ") || "Ingen tidsram"}
            pill={{ label: project.status.label, tone: project.status.overdue ? "danger" : project.status.state === "IN_PROGRESS" ? "warning" : project.status.state === "READY_TO_CLOSE" || project.status.state === "CLOSED" ? "success" : "neutral" }} />)
          : <ListEmpty>Kunden har inga projekt ännu.</ListEmpty>}
      </ListGroup> : null}
      {/* History to open, nothing to start (2026-10-22): no Ny offert here either, as on the computer. */}
      {screen === "offerter" ? quotes ? <CustomerQuotes native customerId={customer.id} summary={{ ...quotes, canCreate: false }} />
        : <ListGroup testId="customer-quotes"><ListEmpty>Du saknar behörighet att se offerter.</ListEmpty></ListGroup> : null}
      {screen === "dokument" ? documents ? <DocumentsSection variant="native" customerId={customer.id} readOnly={Boolean(customer.deletedAt)} />
        : <ListGroup testId="documents-list"><ListEmpty>Du saknar behörighet att se kundens dokument.</ListEmpty></ListGroup> : null}
      {screen === "jobb" ? <>
        <ListGroup>
          <NativePickerRow label="Visa" display={`${kindLabels[kind]} (${data.tasks.counts[kind]})`}>
            <select aria-label="Uppgiftstyp" value={kind} onChange={(event) => setKind(event.target.value as CustomerCardKind)}>
              {(Object.keys(kindLabels) as CustomerCardKind[]).filter((value) => value !== "FORM" || (data.tasks.counts.FORM ?? 0) > 0).map((value) => <option key={value} value={value}>{kindLabels[value]} ({data.tasks.counts[value]})</option>)}
            </select>
          </NativePickerRow>
        </ListGroup>
        <ListGroup testId="customer-tasks">
          {tasks.length ? tasks.map((task) => <ListRow key={`${task.kind}-${task.id}`} type={task.kind === "WORK_ORDER" ? "work-order" : task.kind === "RISK_ASSESSMENT" ? "risk" : "control"} title={task.title || "Utan rubrik"} twoLines href={taskHref(task, isOwnCompany(data.customer) ? null : data.customer.id)}
            subtitle={[statusLabel(task.status), task.projectName || "Utan projekt", facilityName(task.facilityId)].filter(Boolean).join(" · ")} value={`${task.progress} %`} />)
            : <ListEmpty>Inga uppgifter av den här typen att visa.</ListEmpty>}
          {tasks.length < data.tasks.total ? <ListRow title={<span className="text-primary">{busy ? "Hämtar…" : "Visa fler"}</span>} chevron={false} onClick={() => { if (!busy) void load(kind, data.tasks.page + 1); }} /> : null}
        </ListGroup>
      </> : null}
      {screen === "platser" ? <>
        {mapStatus && showMap ? <div className="mb-2 mt-3 overflow-hidden rounded-[.875rem]" ref={mapBox}><PlaceMap status={mapStatus} label={`Karta över ${customerTitle(customer)}s platser`} focus={focus}
          points={data.facilities.filter((place) => place.latitude != null && place.longitude != null && place.isActive).map((place) => ({ id: place.id, latitude: place.latitude!, longitude: place.longitude!, label: placePath(data.facilities, place.id) }))} /></div> : null}
        {/* Kartan och Ny adress under trädet; inte på en plats eller ett formulärs skärm (the browser shows the footer only with the tree). */}
        {(() => {
          const footer = (mapStatus && data.facilities.some((place) => place.latitude != null)) || (placeEdit && !customer.deletedAt) ? <ListGroup>
            {mapStatus && data.facilities.some((place) => place.latitude != null) ? <ListRow type="customer" icon={MapPin} title={showMap ? "Dölj kartan" : "Visa på karta"} chevron={false} onClick={() => setShowMap((current) => !current)} testId="places-show-map" /> : null}
            {placeEdit && !customer.deletedAt ? <ListRow type="new" icon={Plus} title="Ny adress" onClick={startNewAddress} testId="place-new-top" /> : null}
          </ListGroup> : null;
          return <div className="mt-3">{data.facilities.length || newAddress ? placeList(footer) : <><ListGroup><ListEmpty>Kunden har inga platser ännu.</ListEmpty></ListGroup>{footer}</>}</div>;
        })()}
      </> : null}
    </NativePage> : null}
    {/* The sections, always open (2026-10-22: the customer page's cards are always folded out, no fold icon – an
        exception to the rule that history lists start folded). Kundsidans rutnät (2026-10-24, his prototype; replaces
        the two stacks of 2026-10-23): Kontaktuppgifter wide on the left, Projekt and Offerter side by side on the right with
        Uppgifter under them, no lone half cards and no holes (cards beside each other share their row's height); narrower
        Kontaktuppgifter across, Projekt | Offerter, Uppgifter across; narrowest one column. The DOM is the reading and tab
        order: Kontaktuppgifter, Projekt, Offerter, Uppgifter (the places in app/globals.css, .customer-sections). */}
    {!native && <div className="customer-sections-wrap"><div className="customer-sections" data-testid="customer-sections" data-quotes={quotes ? "1" : "0"} data-own={own ? "1" : undefined}>
    {own ? null : <><div id="customer-section-contact" data-section="contact" className="scroll-mt-24"><Panel icon={Contact} title="Kontaktuppgifter" description="Kontaktpersoner, adress, kundnummer, anteckningar och särskilda krav.">
      {editingCustomer && onEdit && canEdit && !customer.deletedAt
        ? <PageActionsSlotProvider slot={editActions}><CustomerInlineEdit customerId={customer.id} read={customerEditor?.read} save={customerEditor?.save} idPrefix={customerEditor?.idPrefix ?? "customer"} submitLabel={customerEditor?.submitLabel} message={customerEditor?.message} onClose={closeEditing} onSaved={() => { void load(kind); onCustomerSaved?.(); }} /></PageActionsSlotProvider>
        : <dl data-testid="customer-contact" className="grid gap-3 text-sm sm:grid-cols-2">
          {([["Kundtyp", customerTypeLabel], ["Kontaktperson", customer.name], ["Företag", customer.company], ["Adress", address], ["E-post", customer.email], ["Telefon", customer.phone], ["Mobil", customer.mobile], ["Kundnummer i bokföringen", customer.accountingCustomerNumber], ["Anteckningar", customer.notes]] as const).filter(([label]) => data.registerNotes !== false || (label !== "Kundnummer i bokföringen" && label !== "Anteckningar")).map(([label, value]) => <div key={label} className={label === "Anteckningar" ? "sm:col-span-2" : undefined}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 whitespace-pre-wrap break-words">{value ? label === "E-post" ? <a className="hover:text-primary" href={`mailto:${value}`}>{value}</a> : label === "Telefon" || label === "Mobil" ? <a className="hover:text-primary" href={`tel:${value}`}>{value}</a> : value : "–"}</dd></div>)}
          {data.registerNotes === false ? null : <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Särskilda krav</dt><dd data-testid="customer-special-requirements" className="mt-0.5 whitespace-pre-wrap break-words">{customer.specialRequirements?.trim() || "–"}</dd></div>}
        </dl>}
    </Panel></div>

    {/* No Nytt projekt here (2026-10-14): projects are started from Projekt; the card shows the customer's as history to open. */}
    <div id="customer-section-projects" data-section="projects" className="scroll-mt-24"><Panel icon={FolderKanban} title="Projekt" description="Kundens projekt, senast ändrade först.">
      {!data.canReadProjects ? <p className="text-sm text-muted-foreground">Du saknar behörighet att läsa projekt.</p>
        : data.projects.length ? <>
          <ul data-testid="customer-projects" className="divide-y">{(allProjects ? data.projects : data.projects.slice(0, PREVIEW)).map((project) => <li key={project.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
            <div className="min-w-0"><Link className="font-medium hover:text-primary" href={`/?view=project&projectId=${encodeURIComponent(project.id)}`}>{project.name}</Link><p className="text-xs text-muted-foreground">{[project.startDate && project.dueDate ? `${project.startDate} – ${project.dueDate}` : project.dueDate ? `Slutdatum ${project.dueDate}` : "", facilityName(project.facilityId)].filter(Boolean).join(" · ") || "Ingen tidsram"}</p></div>
            <Badge variant="outline" className={indicatorBadge(project.status.overdue ? "danger" : project.status.state === "IN_PROGRESS" ? "warning" : project.status.state === "READY_TO_CLOSE" || project.status.state === "CLOSED" ? "success" : "neutral")}>{project.status.label}</Badge>
          </li>)}</ul>
          <ShowAllToggle total={data.projects.length} expanded={allProjects} onChange={setAllProjects} testId="customer-projects-all" />
        </> : <Empty compact title="Inga projekt" description="Kunden har inga projekt ännu." />}
    </Panel></div>

    {/* No Ny offert here either (2026-10-14); the phone keeps its rows. */}
    {quotes ? <div id="customer-section-quotes" data-section="quotes" className="scroll-mt-24"><CustomerQuotes customerId={customer.id} summary={{ ...quotes, canCreate: false }} limit={PREVIEW} /></div> : null}
    </>}

    <div id="customer-section-tasks" data-section="tasks" className="scroll-mt-24"><Panel icon={ClipboardList} title="Uppgifter" description={own ? "Arbetsordrar, riskbedömningar och kontroller på företagets platser, senast ändrade först." : "Kundens arbetsordrar, riskbedömningar och kontroller, senast ändrade först."}>
      {/* Wraps instead of scrolling sideways on a phone (2026-10-13: the last choice was cut off). */}
      <div className="mb-3 flex max-w-full flex-wrap gap-1" role="group" aria-label="Uppgiftstyp">
        {(Object.keys(kindLabels) as CustomerCardKind[]).filter((value) => value !== "FORM" || (data.tasks.counts.FORM ?? 0) > 0).map((value) => <Button key={value} size="sm" variant={kind === value ? "secondary" : "ghost"} aria-pressed={kind === value} onClick={() => setKind(value)}>{kindLabels[value]} ({data.tasks.counts[value]})</Button>)}
      </div>
      {tasks.length ? <ul data-testid="customer-tasks" className="divide-y">{(allTasks ? tasks : tasks.slice(0, PREVIEW)).map((task) => <li key={`${task.kind}-${task.id}`} className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
        <div className="min-w-0"><Link className="font-medium hover:text-primary" href={taskHref(task, own ? null : data.customer.id)}>{task.title || "Utan rubrik"}</Link><p className="text-xs text-muted-foreground">{[typeLabel(task.kind), task.projectName || "Utan projekt", facilityName(task.facilityId)].filter(Boolean).join(" · ")}</p></div>
        <div className="flex items-center gap-2"><span className="text-xs font-semibold tabular-nums">{task.progress}%</span><Badge variant="outline" className={indicatorBadge(task.status === "NEEDS_ACTION" ? "danger" : statusTone(task.status))}>{statusLabel(task.status)}</Badge></div>
      </li>)}</ul> : <Empty compact title="Inga uppgifter" description={own ? "Inga uppgifter av den här typen på företagets platser att visa." : "Kunden har inga uppgifter av den här typen att visa."} />}
      <ShowAllToggle total={data.tasks.total} expanded={allTasks} onChange={setAllTasks} testId="customer-tasks-all" />
      {allTasks ? <ShowMore shown={tasks.length} total={data.tasks.total} busy={busy} onMore={() => void load(kind, data.tasks.page + 1)} /> : null}
    </Panel></div>
    </div></div>}

    {/* Dokument (0.87.0): across the page under the sections and above Anläggningar; the open place has its own documents beside the tree. */}
    {!native && documents ? <div id="customer-section-documents" data-section="documents" className="scroll-mt-24"><DocumentsSection variant="panel" customerId={customer.id} readOnly={Boolean(customer.deletedAt)}
      description="Kundens ritningar, intyg, avtal och andra filer, också de som hör till en plats. En fil kan laddas ner när virussökningen är klar." /></div> : null}

    {/* Anläggningar last on the page (2026-10-16), always open like the other panels (2026-10-22), with room below it
        before the page's foot. Anläggningar (2026-10-15 night): two panels side by side – the tree and the open place –
        drawn by PlaceBrowser. Since 2026-10-24 (the prototype) the heading stands across the page and every action
        – Ny adress, Nytt objekt, Redigera, Ta bort, the map and Fäll ut/ihop alla – is in the compact action card above the
        two panels (no ⋯, and no QR labels: they belong to the round, 2026-10-22); the map, when shown, lies over both panels. */}
    {!native && <section id="customer-section-facilities" aria-labelledby="customer-facilities-heading" className="customer-facilities scroll-mt-24">
      <FacilitiesHeading own={own} />
      {(() => {
      // Kundens platser på karta (2026-10-04): the places with a position of their own.
      const map = mapStatus && showMap ? <div ref={mapBox}><PlaceMap status={mapStatus} label={`Karta över ${customerTitle(customer)}s platser`} focus={focus}
        points={data.facilities.filter((place) => place.latitude != null && place.longitude != null && place.isActive).map((place) => ({ id: place.id, latitude: place.latitude!, longitude: place.longitude!, label: placePath(data.facilities, place.id) }))} /></div> : null;
      // Hantera anläggningar (2026-10-24): Ny adress and the map are in the action card above the tree.
      const mapToggle = mapStatus && data.facilities.some((place) => place.latitude != null) ? { shown: showMap, onToggle: () => setShowMap((current) => !current) } : null;
      return placeList(undefined, { map: mapToggle, above: map });
    })()}</section>}

    {/* The plan's N18 (2026-11-01): at the foot of the page, not beside Redigera; the phone has it on its menu. */}
    {!native && !own && onDeleteCustomer && !customer.deletedAt && !editingCustomer ? <div className="flex justify-end border-t pt-4"><Button variant="ghost" className="text-destructive" onClick={onDeleteCustomer} data-testid="customer-delete"><Trash2 />Ta bort kund</Button></div> : null}
  </div>;
}

/** Anläggningar's heading across the page with one line (2026-10-24, the prototype); the page on its way draws the same. */
function FacilitiesHeading({ own = false }: { own?: boolean }) {
  return <div className="customer-facilities-head">
    <h2 id="customer-facilities-heading" className="section-title">Anläggningar</h2>
    <p className="mt-0.5 text-xs leading-[1.4] text-muted-foreground">{own ? "Företagets egna adresser, objekt och underobjekt, till exempel verkstad, lager och fordon." : "Kundens adresser, objekt och underobjekt."} Välj en nivå i trädet för att se och hantera den.</p>
  </div>;
}

/**
 * The customer's page on its way (2026-10-16: "sidan hoppar när den bygger och laddar innehåll"): the same header
 * and the same panels in the same order as the read card – the name (the register row's, when it was opened from there)
 * or a grey bar, a grey row of facts, the header's buttons top right, Kontaktuppgifter, Projekt and Uppgifter open with grey
 * rows, Anläggningar as its two panels with their least height – so nothing is pushed down or up when the card comes. Level 1
 * shows the menu's grey rows (`ListSkeleton`).
 */
function CustomerCardSkeleton({ native, name, placeOpen, quotes }: { native: boolean; name?: string; placeOpen: boolean; quotes: boolean }) {
  if (native) return <ListSkeleton rows={6} label="Läser kunden…" testId="native-customer-loading" />;
  const button = <span className="native-skeleton h-[var(--control-h)] w-28 rounded-md" aria-hidden="true" />;
  return <div className="space-y-6" aria-busy="true" data-testid="customer-card-loading">
    <span role="status" className="sr-only">Läser kunden och dess arbete…</span>
    {/* Ring <namn>, Navigera, Redigera and Ta bort kund top right: the first as wide as a call button with a name usually is. */}
    <PageHeader title={name ?? <SkeletonText className="w-72" />}
      actions={<span className="contents" aria-hidden="true"><span className="native-skeleton h-[var(--control-h)] w-48 max-w-full rounded-md" />{button}{button}{button}</span>}>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm" aria-hidden="true">
        <SkeletonText className="w-52" /><SkeletonText className="w-20" /><SkeletonText className="w-16" /><SkeletonText className="w-20" /><SkeletonText className="w-20" />
      </div>
    </PageHeader>
    {/* Open like the page's panels (2026-10-22), in the same grid and order (2026-10-24): Anläggningar last, with its
        heading, its action card and its two panels. Offerter has its place unless the card is Local's (no quotes there). */}
    <div className="customer-sections-wrap"><div className="customer-sections" data-quotes={quotes ? "1" : "0"}>
    <div data-section="contact"><Panel icon={Contact} title="Kontaktuppgifter" description="Kontaktpersoner, adress, kundnummer, anteckningar och särskilda krav.">
      {/* The read card's labels with grey values, so the panel has its own height from the first drawing. */}
      <dl className="grid gap-3 text-sm sm:grid-cols-2" aria-hidden="true">
        {CONTACT_LABELS.map((label) => <div key={label} className={label === "Anteckningar" || label === "Särskilda krav" ? "sm:col-span-2" : undefined}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5"><SkeletonText className="w-2/5" /></dd></div>)}
      </dl>
    </Panel></div>
    <div data-section="projects"><Panel icon={FolderKanban} title="Projekt" description="Kundens projekt, senast ändrade först."><RowsSkeleton rows={2} dense /></Panel></div>
    {quotes ? <div data-section="quotes"><Panel icon={FileText} title="Offerter" description="Kundens offerter, senast ändrade först. Belopp exklusive moms."><RowsSkeleton rows={2} dense /></Panel></div> : null}
    <div data-section="tasks"><Panel icon={ClipboardList} title="Uppgifter" description="Kundens arbetsordrar, riskbedömningar och kontroller, senast ändrade först.">
      {/* The row of task types above the list, so Projekt below it on a narrow screen keeps its place. */}
      <div className="mb-3 flex flex-wrap gap-1" aria-hidden="true">{["w-16", "w-28", "w-32"].map((width) => <span key={width} className={`native-skeleton h-7 rounded-md ${width}`} />)}</div>
      <RowsSkeleton rows={2} dense />
    </Panel></div>
    </div></div>
    <div className="customer-facilities"><FacilitiesHeading /><PlaceBrowserSkeleton placeOpen={placeOpen} /></div>
  </div>;
}

/** "Visa alla (N)" under a section's list that shows the latest few (plan 1R): unfolds the whole list in place, and folds it in again. */
function ShowAllToggle({ total, expanded, onChange, testId }: { total: number; expanded: boolean; onChange: (expanded: boolean) => void; testId: string }) {
  if (total <= PREVIEW) return null;
  return <div className="mt-3 flex justify-center">
    <Button type="button" size="sm" variant="outline" aria-expanded={expanded} onClick={() => onChange(!expanded)} data-testid={testId}>{expanded ? "Visa färre" : `Visa alla (${total})`}</Button>
  </div>;
}


/** The register's link to a customer's card. */
export function CustomerCardLink({ customer }: { customer: Pick<CustomerItem, "id" | "name"> }) {
  return <Button asChild variant="outline"><Link aria-label={`Kundkort för ${customerTitle(customer)}`} href={`/?view=customers&customerId=${encodeURIComponent(customer.id)}`}>Kundkort</Link></Button>;
}
