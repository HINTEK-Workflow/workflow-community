"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OPERATING_STATE_LABELS, OPERATING_STATES, PLACE_ATTRIBUTE_LIMIT, type PlaceObjectData } from "@/lib/workflow/maintenance";
import { RemoveButton } from "@/components/ui/remove-button";

/**
 * A place's object data (2026-10-06, Underhåll stage 2; the type is an ordinary field since 2026-10-15) (criticality moved to the work order 2026-10-24): operating state, the
 * nameplate, installation date and free technical values – all optional text the user writes. A replaced unit changes
 * the nameplate here; the place stays the same position (B3).
 */
export function PlaceObjectFields({ value, onChange }: { value: PlaceObjectData; onChange: (patch: Partial<PlaceObjectData>) => void }) {
  const field = "block space-y-2 text-xs font-medium text-muted-foreground";
  const attributes = value.attributes;
  const setAttribute = (index: number, patch: Partial<PlaceObjectData["attributes"][number]>) => onChange({ attributes: attributes.map((item, at) => at === index ? { ...item, ...patch } : item) });
  return <fieldset className="field-group space-y-4 rounded-lg border p-3" data-testid="place-object-fields">
    <legend className="px-1 text-xs font-medium text-muted-foreground">Objektdata (valfritt)</legend>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className={field}>Driftstatus<select className="form-select" value={value.operatingState} onChange={(event) => onChange({ operatingState: event.target.value as PlaceObjectData["operatingState"] })} data-testid="place-operating-state">
        <option value="">Inte angiven</option>
        {OPERATING_STATES.map((state) => <option key={state} value={state}>{OPERATING_STATE_LABELS[state]}</option>)}
      </select></label>
      <label className={field}>Installerad<Input type="date" value={value.installedOn} onChange={(event) => onChange({ installedOn: event.target.value })} /></label>
      <label className={field}>Tillverkare<Input value={value.manufacturer} maxLength={120} onChange={(event) => onChange({ manufacturer: event.target.value })} /></label>
      <label className={field}>Modell<Input value={value.model} maxLength={120} onChange={(event) => onChange({ model: event.target.value })} /></label>
      <label className={`${field} sm:col-span-2`}>Serienummer<Input value={value.serialNumber} maxLength={120} onChange={(event) => onChange({ serialNumber: event.target.value })} /></label>
    </div>
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">Tekniska värden</p>
      {attributes.length ? <ul className="space-y-2">{attributes.map((item, index) => <li key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
        <Input aria-label={`Värde ${index + 1}: vad`} placeholder="Till exempel Märkström" value={item.label} maxLength={60} onChange={(event) => setAttribute(index, { label: event.target.value })} />
        <Input aria-label={`Värde ${index + 1}: värde`} placeholder="63 A" value={item.value} maxLength={200} onChange={(event) => setAttribute(index, { value: event.target.value })} />
        <RemoveButton label={`Ta bort värde ${index + 1}`} onClick={() => onChange({ attributes: attributes.filter((_, at) => at !== index) })} />
      </li>)}</ul> : <p className="text-xs text-muted-foreground">Inga tekniska värden ännu.</p>}
      {attributes.length < PLACE_ATTRIBUTE_LIMIT ? <Button type="button" variant="outline" size="sm" onClick={() => onChange({ attributes: [...attributes, { label: "", value: "" }] })}><Plus />Lägg till värde</Button> : null}
    </div>
  </fieldset>;
}
