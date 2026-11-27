"use client";
import { CollapsibleSection, DialogActions, FormPanel } from "@/features/kfid/ui";

import { useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { PLACE_KINDS, PLACE_MAX_DEPTH, placeChain, placeName, placePath, placePosition, placeSubtreeHeight, placeTree, placeWithDescendants, type CustomerFacilityInput, type FacilityItem, type PlaceKind } from "@/lib/workflow/customer-facility";
import { objectTypeOptions } from "@/lib/workflow/place-register";
import { emptyPlaceObject, placeHasObjectData, placeObjectOf, type PlaceObjectData } from "@/lib/workflow/maintenance";
import { PlaceObjectFields } from "./place-object-fields";
import { usePlaceLocationFields } from "./place-location-fields";

export type PlaceDraft = Required<Omit<CustomerFacilityInput, "latitude" | "longitude" | keyof PlaceObjectData>> & { latitude: number | null; longitude: number | null } & PlaceObjectData;
export const emptyPlace = (parentId: string | null = null, kind: PlaceKind = "FACILITY"): PlaceDraft => ({ name: "", kind, parentId, address: "", postalCode: "", city: "", description: "", latitude: null, longitude: null, ...emptyPlaceObject() });
export const placeDraftOf = (place: FacilityItem): PlaceDraft => ({
  name: place.name, kind: (PLACE_KINDS as readonly string[]).includes(place.kind ?? "") ? place.kind as PlaceKind : "FACILITY", parentId: place.parentId ?? null,
  address: place.address, postalCode: place.postalCode, city: place.city, description: place.description, latitude: place.latitude ?? null, longitude: place.longitude ?? null,
  // Object data is always carried, so saving with the module off never empties it (Underhåll, 2026-10-06).
  ...placeObjectOf(place),
});

/**
 * One place (2026-10-04, Platser): kind and name (the marking moved to the work order 2026-10-24), where it lies,
 * the address on the top level only (it is inherited below) and an optional position. The address and the pin are the
 * shared `usePlaceLocationFields` (place-location-fields.tsx), which the company's place in Företagsuppgifter uses too
 * (2026-10-24).
 */
export function PlaceForm({ value, onChange, places, placeId, error, busy, onCancel, onSubmit, submitLabel = "Spara plats", maintenance = false, compact = false, inline = false, quick = false, formId, hideActions = false }: {
  /** Level 1 on a phone: Avbryt and Spara stand in the top bar, which submits the form by its id (no buttons under it). */
  formId?: string; hideActions?: boolean;
  /**
   * In the customer's list of places (Anläggningar som mappar, 2026-10-14): the place is already chosen where it stands, so
   * there is no "Var ligger …" choice; an existing object can be moved to another address under Fler uppgifter.
   */
  inline?: boolean;
  /**
   * Snabbregistrering i trädet (2026-10-15): a new object or sub-object with only the name required and type
   * (with the maintenance module) and description beside it; where it lies is given by the + that was pressed.
   * Position and object data are added later under Redigera.
   */
  quick?: boolean;
  /** A small dialog in the middle of another form (plan 1O): name and address first, the position under Fler uppgifter. */
  compact?: boolean;
  /** Underhåll (2026-10-06): the company uses the module, so the object data is shown. */
  maintenance?: boolean;
  value: PlaceDraft; onChange: (value: PlaceDraft) => void;
  /** The customer's other places, for "Ligger under". */
  places: FacilityItem[]; placeId?: string; error?: string; busy?: boolean;
  onCancel: () => void; onSubmit: () => void; submitLabel?: string;
}) {
  const above = value.parentId ? placePosition(places, value.parentId) : null;
  const set = (patch: Partial<PlaceDraft>) => onChange({ ...value, ...patch });
  const chooseParent = (parentId: string | null) => set({ parentId, kind: parentId ? "OBJECT" : "FACILITY" });
  // Ligger under (several levels again, 2026-10-15): any of the customer's places that keeps the tree whole – never the
  // place itself or below it, and with room for the place and everything under it – in the tree's order, indented by level.
  const own = placeId ? placeWithDescendants(places, placeId) : new Set<string>();
  const height = placeId ? placeSubtreeHeight(places, placeId) : 1;
  const parents = placeTree(places).filter(({ place, depth }) => !own.has(place.id) && (place.isActive || place.id === value.parentId) && depth + 1 + height <= PLACE_MAX_DEPTH);
  const typeListId = useId();
  const topLevel = !value.parentId;
  const { addressFields, positionFieldset, positionError } = usePlaceLocationFields({ value, onChange, topLevel, name: value.name, pinLabel: value.name || "Platsen",
    above: above ? { ...above, label: `Platsen ovanför (${placeChain(places, value.parentId)[0]?.name ?? "anläggningen"})` } : null });

  const field = "block space-y-2 text-xs font-medium text-muted-foreground";
  // Typ (2026-10-15): what the object is – Elcentral, Laddbox – an ordinary field of an object, shown in the tree.
  const typeField = (label: string) => <label className={field}>{label}<Input list={typeListId} value={value.objectType} maxLength={80} placeholder="Till exempel Elcentral, Pump" onChange={(event) => set({ objectType: event.target.value })} data-testid="place-object-type" />
    <datalist id={typeListId}>{objectTypeOptions(places).map((type) => <option key={type} value={type} />)}</datalist></label>;
  // Förenklad platsform (2026-10-09): name of the work site, address and pin first; level, "Ligger under",
  // description and object data under Fler uppgifter, open when the place already has such values. Nothing
  // in the data changes. On the top level the name may be left out: the street address (or the town) becomes the name.
  const hasMore = Boolean((compact && (value.parentId || value.kind !== "FACILITY")) || value.description.trim() || (maintenance && placeHasObjectData(value)));
  const [moreOpen, setMoreOpen] = useState(hasMore);
  const fallbackName = topLevel ? (value.address.trim() || value.city.trim()) : "";
  const pendingSubmit = useRef(false);
  useEffect(() => {
    if (!pendingSubmit.current || !value.name.trim()) return;
    pendingSubmit.current = false;
    onSubmit();
  });
  const submit = () => {
    if (positionError) return;
    if (!value.name.trim() && fallbackName) { pendingSubmit.current = true; set({ name: fallbackName.slice(0, 160) }); return; }
    onSubmit();
  };
  const moreSummary = [compact && value.parentId ? `under ${placePath(places, value.parentId)}` : "", value.description.trim() ? "beskrivning" : "", maintenance && placeHasObjectData(value) ? "objektdata" : ""].filter(Boolean).join(" · ");

  // Var ligger objektet? The address or object it lies under, chosen among the customer's places when there is a choice.
  const addressChoice = <label className={field}>{inline ? "Flytta till" : "Ligger under"}<select className="form-select" value={value.parentId ?? ""} onChange={(event) => chooseParent(event.target.value || null)} data-testid="place-parent">
    {compact || !value.parentId ? <option value="">Ingen – en egen adress</option> : null}
    {parents.map(({ place, depth }) => <option key={place.id} value={place.id}>{" ".repeat(depth)}{placeName(place)}</option>)}
  </select></label>;
  const placement = value.parentId ? <FormPanel title="Var ligger objektet?">
    <p className="rounded-lg bg-muted/40 px-3 py-2 text-sm" data-testid="place-path-preview"><span className="text-muted-foreground">{placePath(places, value.parentId)} › </span><span className="font-semibold">{value.name.trim() || (placeId ? "objektet" : "det nya objektet")}</span></p>
    {parents.length > 1 ? addressChoice : null}
  </FormPanel> : null;
  if (quick) return <form id={formId} className="space-y-4" data-testid="place-form" data-quick="" onSubmit={(event) => { event.preventDefault(); submit(); }}>
    <label className={field}>Namn<Input value={value.name} onChange={(event) => set({ name: event.target.value })} maxLength={160} required autoFocus placeholder="Till exempel Elcentral" /></label>
    {typeField("Typ (valfritt)")}
    <label className={field}>Beskrivning (valfritt)<textarea className="form-textarea" value={value.description} onChange={(event) => set({ description: event.target.value })} maxLength={2000} /></label>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {hideActions || value.name.trim() ? null : <p className="text-xs text-muted-foreground" data-testid="place-submit-hint">Skriv ett namn först.</p>}
    {hideActions ? null : <DialogActions cancel={{ onClick: onCancel }} primary={{ label: submitLabel, type: "submit", disabled: !value.name.trim(), busy }} />}
  </form>;
  return <form id={formId} className="space-y-4" data-testid="place-form" onSubmit={(event) => { event.preventDefault(); submit(); }}>
    {compact || inline ? null : placement}
    <FormPanel title="Platsuppgifter">
    <label className={field}>{topLevel ? "Namn (valfritt)" : "Namn"}<Input value={value.name} onChange={(event) => set({ name: event.target.value })} maxLength={160} required={!topLevel} autoFocus placeholder={value.kind === "OBJECT" ? "Till exempel Elcentral" : value.kind === "SPACE" ? "Till exempel Linje 3" : value.kind === "BUILDING" ? "Till exempel Måleriet" : "Till exempel Torslandaverken"} /></label>
    {topLevel && !value.name.trim() && fallbackName ? <p className="text-xs text-muted-foreground" data-testid="place-name-fallback">Utan namn heter platsen {fallbackName}.</p> : null}
    {value.parentId ? <p className="text-xs text-muted-foreground">Adressen följer {placeChain(places, value.parentId)[0]?.name ?? "anläggningen"}.</p> : addressFields}
    {compact ? null : positionFieldset}
    <CollapsibleSection title="Fler uppgifter" summary={moreSummary || (compact && parents.length ? "Adress, beskrivning" : "Beskrivning") + (maintenance ? " och objektdata" : "")} open={moreOpen} onOpenChange={setMoreOpen} testId="place-more">
      {compact ? positionFieldset : null}
      {compact && parents.length ? addressChoice : null}
      {inline && placeId && value.parentId && parents.length > 1 ? addressChoice : null}
      {value.parentId ? typeField("Typ") : null}
      <label className={field}>Beskrivning<textarea className="form-textarea" value={value.description} onChange={(event) => set({ description: event.target.value })} maxLength={2000} /></label>
      {maintenance ? <PlaceObjectFields value={value} onChange={set} /> : null}
    </CollapsibleSection>
    </FormPanel>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {hideActions || value.name.trim() || fallbackName ? null : <p className="text-xs text-muted-foreground" data-testid="place-submit-hint">Skriv en adress eller ett namn först.</p>}
    {hideActions ? null : <DialogActions cancel={{ onClick: onCancel }} primary={{ label: submitLabel, type: "submit", disabled: !(value.name.trim() || fallbackName) || Boolean(positionError), busy }} />}
  </form>;
}
