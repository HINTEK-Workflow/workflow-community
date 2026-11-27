"use client";

import { withReturn } from "@/lib/workflow/return-link";
import { useEffect, useMemo, useState } from "react";
import { placeNeedsCustomerHint } from "@/lib/workflow/customer-place";
import { useRouter } from "next/navigation";
import { MapPin, Pencil, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Modal, useInsideView } from "@/features/kfid/ui";
import { useNativeScreen } from "@/components/native";
import { api } from "@/features/kfid/api";
import { invalidateCustomerOptions } from "@/features/kfid/customer-options";
import type { CustomerItem } from "@/features/kfid/types";
import { facilityLabel, nextPlaceKind, PLACE_KIND_LABELS, placeAddress, placeAddressId, placeKindOf, placeName, placePath, placeTree, type CustomerFacilityInput, type FacilityItem } from "@/lib/workflow/customer-facility";
import { emptyPlace, PlaceForm, type PlaceDraft } from "./place-editor";
import { confirmLeave } from "@/lib/workflow/leave-guard";
import { customerPlaceHref } from "@/lib/workflow/navigation";
import { IconButton } from "@/components/ui/icon-button";
import { customerTitle } from "@/lib/kfid/customer-name";

/**
 * Saves a place and returns its id: a new one without `existing`, otherwise the one given. Cloud goes through the customer
 * card's API, Local writes the open file.
 */
export type SavePlace = (customerId: string, place: CustomerFacilityInput, existing?: { id: string; version?: number }) => Promise<string>;
export const cloudSavePlace: SavePlace = async (customerId, place, existing) => {
  const saved = await api<{ id: string }>("/api/customer-card", { method: "POST", body: JSON.stringify({ action: "facility_save", customerId, ...(existing ? { id: existing.id, version: existing.version } : {}), facility: place }) });
  invalidateCustomerOptions();
  return saved.id;
};

const SHOWN = 60;
type Duplicate = { existingId: string; message: string };
const duplicateOf = (issue: unknown): Duplicate | null => {
  const error = issue as { status?: number; message?: string; details?: { existingId?: string } };
  return error?.status === 409 && error.details?.existingId ? { existingId: error.details.existingId, message: error.message ?? "" } : null;
};

/**
 * Plats (2026-10-04): one field in projects, work orders, controls and rounds. It searches the whole way –
 * "Volvo Cars › Torslandaverken › Måleriet › Linje 3 › Elcentral E12" – and a new place can be added right here,
 * under the one chosen. Without a chosen customer every customer's places are searched, and picking one sets both.
 * The chosen place shows its (inherited) address; a new name that already exists on the same level is refused and the
 * existing place offered. Since 2026-10-24 (one page for the place and the customer's Anläggningar) the pencil opens
 * the customer's page at the place – the same tree, cards and editor as under Kunder – and Bakåt returns to the work; there
 * is no separate place editor here any more.
 * Inside an open view (the project or round form) the chooser is a small dialog over the view, never a second view
 * (docs/ui-system.md 4; plan 1A, 2026-10-11); elsewhere it is a temporary view as before.
 */
export function PlacePicker({ customers, customerId, value, onChange, savePlace, disabled, label = "Plats (valfritt)", id, openRequest = 0 }: {
  customers: CustomerItem[];
  customerId: string | null;
  value: string | null;
  onChange: (placeId: string | null, customerId: string | null) => void;
  /** Without it the field only chooses (no right to add or change customers' places). */
  savePlace?: SavePlace;
  disabled?: boolean;
  label?: string;
  id?: string;
  /** Opens the picker from outside when the number changes ("Ändra plats" by a field filled from the place, 2026-10-07). */
  openRequest?: number;
}) {
  const router = useRouter();
  const inView = useInsideView();
  const native = useNativeScreen().native;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState<{ customerId: string; draft: PlaceDraft } | null>(null);
  const [error, setError] = useState("");
  const [duplicate, setDuplicate] = useState<Duplicate | null>(null);
  const [busy, setBusy] = useState(false);
  // Places created here before the customer list has been read again.
  const [created, setCreated] = useState<FacilityItem[]>([]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- answers a request from outside the field
  useEffect(() => { if (openRequest && !disabled && (customerId || value)) { setOpen(true); setError(""); setDuplicate(null); } }, [openRequest, disabled, customerId, value]);
  const placesOf = (customer: CustomerItem) => [
    ...(customer.facilities ?? []),
    ...created.filter((place) => place.customerId === customer.id && !(customer.facilities ?? []).some((item) => item.id === place.id)),
  ];
  // Only the chosen customer's places are offered (2026-10-26, customer first): without a customer the field is off.
  const scope = customerId ? customers.filter((customer) => customer.id === customerId) : [];
  const needsCustomer = placeNeedsCustomerHint(customerId, value);
  const off = Boolean(disabled) || Boolean(needsCustomer);
  const rows = useMemo(() => scope.flatMap((customer) => {
    const places = placesOf(customer);
    return placeTree(places).filter(({ place }) => place.isActive || place.id === value).map(({ place, depth }) => ({ place, depth, customer, places, path: placePath(places, place.id, customerTitle(customer)) }));
  }), [scope, created, value]); // eslint-disable-line react-hooks/exhaustive-deps
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = words.length ? rows.filter((row) => words.every((word) => `${row.path} ${PLACE_KIND_LABELS[placeKindOf(row.place)]}`.toLowerCase().includes(word))) : rows;
  const owner = customers.find((customer) => customer.id === customerId);
  const ownerPlaces = owner ? placesOf(owner) : [];
  // The chosen place, its customer and the address that applies to it (its own on the top level, else inherited).
  const chosen = value ? (() => {
    const customer = customers.find((item) => placesOf(item).some((place) => place.id === value));
    if (!customer) return null;
    const places = placesOf(customer);
    const place = places.find((item) => item.id === value)!;
    return { customer, places, place, path: placePath(places, value, customerTitle(customer)), address: facilityLabel({ name: "", ...placeAddress(places, value) }).replace(/^, /, "") };
  })() : null;
  const selectedPath = value ? chosen?.path ?? "Platsen finns inte i listan" : "";
  const pick = (placeId: string | null, owningCustomer: string | null) => { onChange(placeId, owningCustomer); setOpen(false); setQuery(""); setDuplicate(null); };
  const startAdding = () => {
    if (!customerId) { setError("Välj kund först, så hamnar platsen under rätt kund."); return; }
    // Adress och objekt (2026-10-14): a new place from the field is an object at the chosen place's address.
    const parent = value && ownerPlaces.some((place) => place.id === value) ? placeAddressId(ownerPlaces, value) : null;
    setError(""); setDuplicate(null);
    setAdding({ customerId, draft: { ...emptyPlace(parent, nextPlaceKind(parent ? "FACILITY" : null)), name: query.trim() } });
  };
  const saveNew = async () => {
    if (!adding || !savePlace) return;
    setBusy(true); setError(""); setDuplicate(null);
    try {
      const placeId = await savePlace(adding.customerId, adding.draft);
      setCreated((current) => [...current, { ...adding.draft, id: placeId, customerId: adding.customerId, isActive: true }]);
      setAdding(null);
      pick(placeId, adding.customerId);
    } catch (issue) { setDuplicate(duplicateOf(issue)); setError((issue as Error).message); } finally { setBusy(false); }
  };
  // To the customer's page at the place (one page for places, 2026-10-24); the open job saves first (or asks), as
  // for a link. The customer lists are read again, so a change there shows here when Bakåt returns.
  const openOnCustomer = () => {
    if (!chosen) return;
    // Samband (2026-10-26): with the way back, so the card says "Tillbaka till arbetsordern".
    const target = withReturn(customerPlaceHref(chosen.customer.id, chosen.place.id, native), `${window.location.pathname}${window.location.search}`);
    void confirmLeave().then((ok) => { if (ok) { invalidateCustomerOptions(); router.push(target); } });
  };
  const close = (next: boolean) => { setOpen(next); if (!next) { setAdding(null); setQuery(""); setDuplicate(null); setError(""); } };
  const duplicateName = duplicate ? placeName(ownerPlaces.find((place) => place.id === duplicate.existingId) ?? { name: "den befintliga platsen" }) : "";
  const errorBlock = error ? <div className="space-y-2" role="alert">
    <p className="text-sm text-destructive">{error}</p>
    {duplicate ? <Button type="button" variant="outline" onClick={() => { setAdding(null); pick(duplicate.existingId, customerId); }} data-testid="place-pick-existing"><MapPin />Välj {duplicateName}</Button> : null}
  </div> : null;
  // A block label with the shared 6 px step, level with the fields beside it (QA 2026-10-10: Plats vs Kontor).
  return <div className="space-y-1.5 text-xs font-medium text-muted-foreground">
    <span id={id ? `${id}-label` : undefined} className="block">{label}</span>
    <div className="flex gap-2">
      {/* The name is the label and then what the button shows ("Plats Garage › Laddbox"), WCAG 2.5.3 (granskningen 2026-11-24). */}
      <button type="button" id={id} aria-labelledby={id ? `${id}-label ${id}` : undefined} data-needs-customer={needsCustomer ? "" : undefined} aria-haspopup="dialog" disabled={off} data-testid="place-picker"
        className="form-select flex h-auto min-h-[var(--control-h)] [html[data-native]_&]:min-h-11 w-full min-w-0 items-center gap-2 text-left text-sm text-foreground disabled:opacity-60" onClick={() => { setOpen(true); setError(""); setDuplicate(null); }}>
        <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className={selectedPath ? "truncate" : "truncate text-muted-foreground"} title={selectedPath || undefined}>{selectedPath || (needsCustomer ? needsCustomer.replace(/.$/, "") : "Ingen plats")}</span>
      </button>
      {value && !disabled && savePlace && chosen ? <IconButton label="Redigera platsen hos kunden" variant="outline" size="icon-lg" className="shrink-0 [html[data-native]_&]:size-11" onClick={openOnCustomer} data-testid="place-edit-chosen"><Pencil /></IconButton> : null}
      {value && !disabled ? <IconButton label="Ta bort platsen" variant="outline" size="icon-lg" className="shrink-0 [html[data-native]_&]:size-11" onClick={() => onChange(null, customerId)}><X /></IconButton> : null}
    </div>
    {chosen?.address ? <p className="truncate font-normal" title={chosen.address} data-testid="place-picker-address">{chosen.address}</p> : null}
    <Modal size={inView ? "compact" : "view"} open={open} onOpenChange={close} title={adding ? "Ny plats" : "Välj plats"} className={adding ? "max-w-lg" : inView ? "max-w-md" : undefined}>
      {adding ? <>
        <p className="mb-3 text-sm text-muted-foreground">Hos {customers.find((customer) => customer.id === adding.customerId)?.name ?? "kunden"}{adding.draft.parentId ? `, under ${placePath(ownerPlaces, adding.draft.parentId)}` : ""}.</p>
        <PlaceForm compact value={adding.draft} onChange={(draft) => setAdding({ ...adding, draft })} places={ownerPlaces} busy={busy} onCancel={() => setAdding(null)} onSubmit={() => void saveNew()} submitLabel="Lägg till och välj" />
        {errorBlock}
      </> : <div className="space-y-3">
        <label className="relative block">
          <span className="sr-only">Sök plats</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Sök på namn eller kund" className="pl-9" data-testid="place-search" />
        </label>
        <ul className={cn("divide-y overflow-y-auto rounded-lg border", inView ? "max-h-64" : "max-h-[50dvh]")} data-testid="place-options">
          <li><button type="button" className="w-full px-3 py-2.5 text-left text-sm hover:bg-secondary" onClick={() => pick(null, customerId)}>Ingen plats</button></li>
          {matches.slice(0, SHOWN).map((row) => <li key={row.place.id}>
            <button type="button" aria-current={row.place.id === value ? "true" : undefined} className="flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm hover:bg-secondary aria-[current=true]:bg-secondary"
              style={{ paddingLeft: words.length ? undefined : `${0.75 + row.depth * 1.1}rem` }} onClick={() => pick(row.place.id, row.customer.id)}>
              <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block font-medium">{placeName(row.place)}</span>
                <span className="block truncate text-xs text-muted-foreground">{PLACE_KIND_LABELS[placeKindOf(row.place)]} · {row.path}{row.place.isActive ? "" : " (pausad)"}</span>
              </span>
            </button>
          </li>)}
          {!matches.length ? <li className="px-3 py-3 text-sm text-muted-foreground">{rows.length ? "Ingen plats matchar." : customerId ? "Kunden har inga platser ännu." : "Inga platser ännu. Välj kund för att lägga till en."}</li> : null}
          {matches.length > SHOWN ? <li className="px-3 py-2 text-xs text-muted-foreground">Visar {SHOWN} av {matches.length}. Skriv mer för att hitta rätt.</li> : null}
        </ul>
        {errorBlock}
        {savePlace ? <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{customerId ? (value ? "En ny plats hamnar under den valda platsen. Det går att ändra." : "En ny plats hamnar på översta nivån. Det går att ändra.") : "Välj kund för att lägga till en plats."}</p>
          <Button type="button" variant="outline" onClick={startAdding} disabled={!customerId} data-testid="place-add"><Plus />Ny plats{query.trim() ? ` ”${query.trim()}”` : ""}</Button>
        </div> : null}
      </div>}
    </Modal>
  </div>;
}
