"use client";

import { useState } from "react";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { PlaceMap, useMapStatus, type MapPoint } from "@/features/workflow/map-view";
import { usePlaceLocationFields } from "@/features/workflow/place-location-fields";
import { machinePins, machinePositionText, placePositionUp, type MachinePosition, type Positioned, type PositionedPlace } from "@/lib/maintenance/location";

/**
 * Kartnål på plats och maskin i Underhåll (0.92.0): the same position fields and the same Lantmäteriet map as the customer
 * register's places (features/workflow/place-location-fields.tsx), through our own server – the browser never asks Lantmäteriet.
 * Underhåll's places have no address, so only the pin is set here (on the map, from the phone or pasted).
 */
const NO_ADDRESS = { address: "", postalCode: "", city: "" };

/** The pin of a place or a machine. `above` is the place above (a grey pin) when there is no pin of its own. */
export function usePositionFieldset({ value, onChange, above, name, testIdPrefix, pinLabel, mapLabel }: {
  value: Positioned; onChange: (next: Positioned) => void; above: (Positioned & { label: string }) | null; name: string; testIdPrefix: string; pinLabel: string; mapLabel: string;
}) {
  const aboveAt = above && above.latitude !== null && above.longitude !== null ? { latitude: above.latitude, longitude: above.longitude, label: above.label } : null;
  const { positionFieldset, positionError } = usePlaceLocationFields({
    value: { ...NO_ADDRESS, latitude: value.latitude, longitude: value.longitude },
    onChange: (next) => onChange({ latitude: next.latitude, longitude: next.longitude }),
    topLevel: false, name, above: aboveAt, testIdPrefix, pinLabel, mapLabel,
  });
  return { positionFieldset, positionError };
}

/** The place above with a pin, as the grey pin of the map. */
export function aboveOf(places: readonly PositionedPlace[], placeId: string | null | undefined) {
  const found = placePositionUp(places, placeId);
  return found ? { latitude: found.latitude, longitude: found.longitude, label: `Ovanför: ${found.placeName}` } : null;
}

/**
 * The machine's pin in its form: "Samma som platsen" (no pin of its own, the place's is shown) or a pin of its own. Turning
 * Samma som platsen on removes the machine's own pin.
 */
export function MachinePositionFields({ value, onChange, places, placeId, name }: { value: Positioned; onChange: (next: Positioned) => void; places: readonly PositionedPlace[]; placeId: string | null; name: string }) {
  const own = value.latitude !== null && value.longitude !== null;
  const [same, setSame] = useState(!own);
  const found = placePositionUp(places, placeId);
  const above = found ? { latitude: found.latitude, longitude: found.longitude, label: `Platsen: ${found.placeName}` } : null;
  const { positionFieldset } = usePositionFieldset({ value, onChange, above, name, testIdPrefix: "maintenance-machine", pinLabel: name || "Maskinen", mapLabel: "Karta för maskinens position" });
  return <div className="space-y-3" data-testid="maintenance-machine-position">
    <label className="flex items-start gap-2 text-sm">
      <Checkbox checked={same} onCheckedChange={(checked) => { const on = checked === true; setSame(on); if (on) onChange({ latitude: null, longitude: null }); }} data-testid="maintenance-machine-same-place" />
      <span>Samma position som platsen<span className="block text-xs text-muted-foreground">{found ? `Maskinen visas där ${found.placeName} är på kartan.` : placeId ? "Platsen har ingen kartnål än. Sätt en på platsen eller på maskinen." : "Maskinen står inte på någon plats. Sätt en egen kartnål om den ska synas på kartan."}</span></span>
    </label>
    {same ? null : positionFieldset}
  </div>;
}

/** The machine's position on its card: a line, and the map with its pin when the installation has Lantmäteriet's map. */
export function MachinePositionCard({ position, name, isPart }: { position: MachinePosition | null; name: string; isPart: boolean }) {
  const mapStatus = useMapStatus();
  const [shown, setShown] = useState(false);
  const text = isPart ? (position ? "Visas där maskinen är." : "Maskinen har ingen position.") : machinePositionText(position);
  return <div className="space-y-2" data-testid="maintenance-position">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      <span className="inline-flex items-center gap-1.5 text-muted-foreground"><MapPin className="size-4" aria-hidden="true" /><span data-testid="maintenance-position-text">{text}</span></span>
      {mapStatus && position ? <Button type="button" variant="outline" size="sm" aria-pressed={shown} onClick={() => setShown((value) => !value)} data-testid="maintenance-position-map"><MapPin />{shown ? "Dölj kartan" : "Visa på karta"}</Button> : null}
    </div>
    {mapStatus && position && shown ? <PlaceMap status={mapStatus} label={`Karta: ${name}`} hint={null}
      points={[{ id: "machine", latitude: position.latitude, longitude: position.longitude, label: position.from === "machine" ? name : `${name} · ${position.placeName}` }]} /> : null}
  </div>;
}

/** The machines at a choice in the place tree on the map: each machine's own pin or its place's; a tap opens the machine. */
export function MachinesMap<T extends Positioned & { id: string; parentId: string | null; placeId: string | null; name: string }>({ machines, places, label }: { machines: readonly T[]; places: readonly PositionedPlace[]; label: string }) {
  const mapStatus = useMapStatus();
  const [shown, setShown] = useState(false);
  const pins = machinePins(machines, places);
  if (!mapStatus || !pins.length) return null;
  const hrefOf = (id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("part", id); url.searchParams.delete("place");
    return `${url.pathname}?${url.searchParams}`;
  };
  const points: MapPoint[] = shown ? pins.map((pin) => ({ ...pin, href: hrefOf(pin.id) })) : [];
  return <div className="space-y-3" data-testid="maintenance-machines-map">
    <Button type="button" variant="outline" size="sm" aria-pressed={shown} onClick={() => setShown((value) => !value)} data-testid="maintenance-machines-show-map"><MapPin />{shown ? "Dölj kartan" : "Maskinerna på karta"}</Button>
    {shown ? <PlaceMap status={mapStatus} label={label} points={points} hint="Tryck på en maskin för att öppna den. En grå punkt står där platsen är." /> : null}
  </div>;
}
