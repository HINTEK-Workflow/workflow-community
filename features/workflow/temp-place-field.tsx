"use client";

import { useState } from "react";
import { MapPinPlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { emptyTempPlace, tempPlaceIsEmpty, tempPlacePosition, type TempPlace } from "@/lib/workflow/temp-place";
import { usePlaceLocationFields } from "./place-location-fields";

/**
 * Tillfällig plats (2026-10-08): one optional extra place on the job – just an address and a pin on a map.
 * It is kept in the task alone and never added to the customer register.
 * 2026-10-24: the same address field, map and address–pin sync as a place (`usePlaceLocationFields`).
 * 2026-10-26: the button Tillfällig plats stays the whole time and shows or hides the fields (no heading row and no
 * fold arrow of its own); while a place is entered a bin of the same height stands right beside it. Folded, the place is
 * one line beside the buttons.
 */
export function TempPlaceField({ value, onChange, disabled = false }: { value: TempPlace | null; onChange: (value: TempPlace | null) => void; disabled?: boolean }) {
  // A saved place starts folded with its summary; a new one opens.
  const [open, setOpen] = useState(false);
  const place = value ?? emptyTempPlace();
  const position = tempPlacePosition(place);
  const empty = tempPlaceIsEmpty(value);
  const { addressFields, positionFieldset } = usePlaceLocationFields({ value: place, onChange, pinLabel: place.address || "Tillfällig plats",
    mapLabel: "Karta för den tillfälliga platsen", testIdPrefix: "temp-place", mapOpen: true });
  if (disabled && empty) return null;
  const summary = [place.address, [place.postalCode, place.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") + (position ? `${place.address || place.city ? " · " : ""}kartnål satt` : "");
  const remove = () => { setOpen(false); onChange(null); };
  return <div className="space-y-3" data-testid="temp-place">
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" aria-expanded={open} aria-controls="temp-place-fields" onClick={() => setOpen((current) => !current)} data-testid="temp-place-add">
        <MapPinPlus />Tillfällig plats
      </Button>
      {!empty && !disabled ? <Button type="button" variant="outline" size="icon-lg" aria-label="Ta bort tillfällig plats" title="Ta bort tillfällig plats" onClick={remove} data-testid="temp-place-remove">
        <Trash2 />
      </Button> : null}
      {!open && !empty ? <span className="min-w-0 truncate text-sm text-muted-foreground" data-testid="temp-place-summary">{summary}</span> : null}
    </div>
    {open ? <fieldset id="temp-place-fields" className="space-y-3" disabled={disabled}>
      <p className="text-xs text-muted-foreground">Gäller bara det här jobbet, till exempel en tillfällig adress. Den läggs inte till i kundregistret.</p>
      {addressFields}
      {positionFieldset}
    </fieldset> : null}
  </div>;
}
