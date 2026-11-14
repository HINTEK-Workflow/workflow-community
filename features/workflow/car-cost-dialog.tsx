"use client";

import { useEffect, useMemo, useState } from "react";
import { Crosshair, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DisabledReason } from "@/components/ui/disabled-reason";
import { DialogActions } from "@/features/kfid/ui";
import { DialogPage } from "@/features/kfid/dialog-page";
import type { PlacePosition } from "@/lib/workflow/place-position";
import { parseDecimal } from "@/lib/calculators/number";
import { geocodeAddress } from "@/lib/geo/geocode";
import { activeRoutingProvider, roadDistanceAvailable, type DistanceBasis } from "@/lib/geo/routing";
import { carCostRow, computeCarCost, convertPrice, formatKm, formatPrice, formatSek, type CarCost, type DistanceUnit, type MaterialRow } from "@/lib/workflow/expenses";

export type CarCostDestination = { label: string; position: PlacePosition | null };
export type CarCostStartPlace = { id: string; label: string; position: PlacePosition };

const PRICE_KEY = "hintek-workflow:car-cost-price";
type RememberedPrice = { price: string; unit: DistanceUnit };

function rememberedPrice(): RememberedPrice {
  try {
    const raw = localStorage.getItem(PRICE_KEY);
    const parsed = raw ? JSON.parse(raw) as Partial<RememberedPrice> : null;
    if (parsed && typeof parsed.price === "string" && (parsed.unit === "km" || parsed.unit === "mil")) return { price: parsed.price, unit: parsed.unit };
  } catch { /* storage blocked */ }
  return { price: "", unit: "mil" };
}
function rememberPrice(value: RememberedPrice) { try { localStorage.setItem(PRICE_KEY, JSON.stringify(value)); } catch { /* storage blocked */ } }

const inputText = (value: number) => formatPrice(value).replace(/ /g, "");

/**
 * Bilkostnad (2026-10-08): the distance from where the person is (or a chosen place, or a typed distance) to the
 * place of the task, as a single expense row on the work order. The position is read only after the click on "Använd
 * min position". Only the straight line can be computed today and it is named "fågelvägen" wherever it shows; the
 * person may overwrite the distance with the reading from the car. Adding again never overwrites or duplicates by
 * itself: when a car cost already exists the person chooses "Lägg till som ny rad" or "Uppdatera raden".
 */
export function CarCostDialog({ open, onOpenChange, destination, startPlaces, existing, onAdd, onUpdate }: {
  open: boolean; onOpenChange: (open: boolean) => void;
  /** The place of the task; null when the task has no place at all. */
  destination: CarCostDestination | null;
  /** Places with a position that can be the start. */
  startPlaces: CarCostStartPlace[];
  /** Car cost rows already on the work order. */
  existing: MaterialRow[];
  onAdd: (row: MaterialRow) => void;
  onUpdate: (row: MaterialRow) => void;
}) {
  // Larger than the popup ceiling (Popupstorlek, 2026-10-13): a page on displays 2 and 3, a screen at level 1.
  return <DialogPage pageKey="bilkostnad" size="page" panelTitle="Resa och kostnad" open={open} onOpenChange={onOpenChange} title="Bilkostnad">
    {open ? <CarCostForm destination={destination} startPlaces={startPlaces} existing={existing} onAdd={(row) => { onAdd(row); onOpenChange(false); }} onUpdate={(row) => { onUpdate(row); onOpenChange(false); }} onCancel={() => onOpenChange(false)} /> : null}
  </DialogPage>;
}

type StartMode = "position" | "place" | "address";

function CarCostForm({ destination, startPlaces, existing, onAdd, onUpdate, onCancel }: {
  destination: CarCostDestination | null; startPlaces: CarCostStartPlace[]; existing: MaterialRow[];
  onAdd: (row: MaterialRow) => void; onUpdate: (row: MaterialRow) => void; onCancel: () => void;
}) {
  const target = destination?.position ?? null;
  const [remembered] = useState(rememberedPrice);
  const [startMode, setStartMode] = useState<StartMode>("position");
  const [startPosition, setStartPosition] = useState<PlacePosition | null>(null);
  const [startLabel, setStartLabel] = useState("");
  const [placeId, setPlaceId] = useState("");
  const [address, setAddress] = useState("");
  const [addressNote, setAddressNote] = useState("");
  const [locating, setLocating] = useState(false);
  const [positionError, setPositionError] = useState("");
  // The provider's answer for the current start and target; anything else counts as no computed distance.
  const [routed, setRouted] = useState<{ key: string; km: number } | null>(null);
  const [typedDistance, setTypedDistance] = useState("");
  const [overridden, setOverridden] = useState(false);
  const [roundTrip, setRoundTrip] = useState(true);
  const [priceText, setPriceText] = useState(remembered.price);
  const [unit, setUnit] = useState<DistanceUnit>(remembered.unit);
  const [writeMode, setWriteMode] = useState<"new" | "update">(existing.length ? "update" : "new");
  const [updateId, setUpdateId] = useState(existing[existing.length - 1]?.id ?? "");
  const provider = activeRoutingProvider();

  const routeKey = startPosition && target ? JSON.stringify([startPosition.latitude, startPosition.longitude, target.latitude, target.longitude]) : null;
  useEffect(() => {
    if (!startPosition || !target || !routeKey) return;
    let cancelled = false;
    provider.distanceKm(startPosition, target).then((result) => { if (!cancelled) setRouted({ key: routeKey, km: result.km }); });
    return () => { cancelled = true; };
  }, [startPosition, target, routeKey, provider]);
  const computedKm = routeKey && routed?.key === routeKey ? routed.km : null;
  // The field mirrors the computed distance until the person writes their own.
  const distanceText = overridden ? typedDistance : computedKm === null ? "" : formatKm(computedKm);

  const usePosition = () => {
    if (!navigator.geolocation) { setPositionError("Webbläsaren kan inte ge en position."); return; }
    setLocating(true); setPositionError("");
    navigator.geolocation.getCurrentPosition((result) => {
      setStartPosition({ latitude: Math.round(result.coords.latitude * 1e6) / 1e6, longitude: Math.round(result.coords.longitude * 1e6) / 1e6 });
      setStartLabel("Min position"); setLocating(false);
    }, (issue) => {
      setLocating(false);
      setPositionError(issue.code === issue.PERMISSION_DENIED ? "Positionen är blockerad. Tillåt plats i webbläsaren, eller välj en plats eller ange sträckan." : "Positionen kunde inte hämtas. Försök igen, välj en plats eller ange sträckan.");
    }, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 });
  };
  const choosePlace = (id: string) => {
    setPlaceId(id);
    const place = startPlaces.find((item) => item.id === id) ?? null;
    setStartPosition(place?.position ?? null); setStartLabel(place?.label ?? "");
  };
  const lookUpAddress = async () => {
    const found = await geocodeAddress(address);
    if (found) { setStartPosition(found); setStartLabel(address.trim()); setAddressNote(""); return; }
    setAddressNote("Startadress kan inte slås upp ännu – välj plats eller ange sträckan.");
  };
  const switchMode = (mode: StartMode) => { setStartMode(mode); setStartPosition(null); setStartLabel(""); setPlaceId(""); setPositionError(""); setAddressNote(""); };
  const switchUnit = (next: DistanceUnit) => {
    if (next === unit) return;
    const parsed = parseDecimal(priceText);
    if (parsed.state === "ok") setPriceText(inputText(convertPrice(parsed.value, unit, next)));
    setUnit(next);
  };

  const distance = parseDecimal(distanceText);
  const price = parseDecimal(priceText);
  const basis: DistanceBasis = overridden || computedKm === null ? "manual" : provider.basis;
  const cost: CarCost | null = useMemo(() => distance.state === "ok" && price.state === "ok" && distance.value >= 0 && price.value >= 0
    ? computeCarCost({ distanceKm: distance.value, roundTrip, price: price.value, unit, basis }) : null, [distance, price, roundTrip, unit, basis]);
  const basisLabel = basis === "manual" ? "enligt bilens mätare" : provider.label;
  const commit = () => {
    if (!cost) return;
    rememberPrice({ price: priceText, unit });
    if (writeMode === "update" && updateId) onUpdate(carCostRow(cost, updateId));
    else onAdd(carCostRow(cost, crypto.randomUUID()));
  };

  const field = "block space-y-2 text-xs font-medium text-muted-foreground";
  const segment = (active: boolean) => active ? "default" as const : "outline" as const;
  return <div className="space-y-4" data-testid="car-cost-dialog">
    <section className="field-group space-y-2 rounded-lg border p-3">
      <h3 className="text-xs font-medium text-muted-foreground">Till</h3>
      {destination ? <p className="text-sm">{destination.label}</p> : <p className="text-sm">Uppgiften har ingen plats.</p>}
      {destination && !destination.position ? <p className="text-xs text-muted-foreground" data-testid="car-cost-no-position">Platsen saknar position. Ange sträckan nedan, eller ge platsen en position på kundkortet.</p> : null}
      {!destination ? <p className="text-xs text-muted-foreground" data-testid="car-cost-no-position">Välj en plats på uppgiften för att räkna sträckan, eller ange sträckan nedan.</p> : null}
    </section>

    {target ? <section className="field-group space-y-3 rounded-lg border p-3">
      <h3 className="text-xs font-medium text-muted-foreground">Från</h3>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Startpunkt">
        <Button type="button" variant={segment(startMode === "position")} aria-pressed={startMode === "position"} onClick={() => switchMode("position")}>Min position</Button>
        <Button type="button" variant={segment(startMode === "place")} aria-pressed={startMode === "place"} onClick={() => switchMode("place")} disabledReason={startPlaces.length ? "" : "Ingen plats med position att utgå från."} aria-describedby={startPlaces.length ? undefined : "car-cost-place-reason"}>En plats</Button>
        <Button type="button" variant={segment(startMode === "address")} aria-pressed={startMode === "address"} onClick={() => switchMode("address")}>Startadress</Button>
      </div>
      <DisabledReason id="car-cost-place-reason" reason={startPlaces.length ? "" : "En plats: ingen plats med position att utgå från."} />
      {startMode === "position" ? <div className="space-y-2">
        <Button type="button" variant="outline" onClick={usePosition} data-testid="car-cost-use-position" busy={locating} busyLabel="Hämtar position…"><Crosshair />Använd min position</Button>
        {positionError ? <p role="alert" className="text-xs text-destructive">{positionError}</p> : null}
        {startPosition && startLabel === "Min position" ? <p className="text-xs text-muted-foreground">Positionen hämtades i webbläsaren och sparas inte.</p> : null}
      </div> : null}
      {startMode === "place" ? <label className={field}>Plats att utgå från<select className="form-select" value={placeId} onChange={(event) => choosePlace(event.target.value)} data-testid="car-cost-start-place">
        <option value="">Välj plats</option>
        {startPlaces.map((place) => <option key={place.id} value={place.id}>{place.label}</option>)}
      </select></label> : null}
      {startMode === "address" ? <div className="space-y-2">
        <div className="flex gap-2">
          <Input aria-label="Startadress" placeholder="Gata, ort" value={address} onChange={(event) => { setAddress(event.target.value); setAddressNote(""); }} />
          <Button type="button" variant="outline" onClick={lookUpAddress} disabled={!address.trim()}><Search />Slå upp</Button>
        </div>
        {addressNote ? <p role="status" className="text-xs text-muted-foreground" data-testid="car-cost-address-note">{addressNote}</p> : null}
      </div> : null}
    </section> : null}

    <section className="field-group space-y-3 rounded-lg border p-3">
      <h3 className="text-xs font-medium text-muted-foreground">Sträcka och pris</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={field}>Sträcka enkel resa (km){computedKm !== null && !overridden ? <span className="font-normal"> – {provider.label}</span> : null}
          <Input inputMode="decimal" placeholder="0" value={distanceText} aria-describedby="car-cost-distance-hint" data-testid="car-cost-distance"
            onChange={(event) => { setTypedDistance(event.target.value); setOverridden(true); }} />
        </label>
        <div className={field}>Resa<div className="flex gap-2" role="group" aria-label="Resa">
          <Button type="button" variant={segment(!roundTrip)} aria-pressed={!roundTrip} onClick={() => setRoundTrip(false)}>Enkel resa</Button>
          <Button type="button" variant={segment(roundTrip)} aria-pressed={roundTrip} onClick={() => setRoundTrip(true)}>Tur och retur</Button>
        </div></div>
      </div>
      <p id="car-cost-distance-hint" className="text-xs text-muted-foreground">
        {roadDistanceAvailable() ? "Sträckan är beräknad längs väg." : `Körsträcka längs väg kan inte hämtas. ${computedKm !== null ? `Den beräknade sträckan är ${provider.label} och är kortare än vägen. ` : ""}Skriv körsträckan enligt bilens mätare om du vet den.`}
        {startLabel && computedKm !== null ? ` Från ${startLabel}.` : ""}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={field}>Pris exkl. moms<Input inputMode="decimal" placeholder="0" value={priceText} onChange={(event) => setPriceText(event.target.value)} aria-invalid={price.state === "invalid" ? true : undefined} data-testid="car-cost-price" /></label>
        <div className={field}>Enhet<div className="flex gap-2" role="group" aria-label="Prisenhet">
          <Button type="button" variant={segment(unit === "km")} aria-pressed={unit === "km"} onClick={() => switchUnit("km")}>kr/km</Button>
          <Button type="button" variant={segment(unit === "mil")} aria-pressed={unit === "mil"} onClick={() => switchUnit("mil")}>kr/mil</Button>
        </div></div>
      </div>
    </section>

    <section className="rounded-lg border p-3" data-testid="car-cost-preview" aria-live="polite">
      <h3 className="text-xs font-medium text-muted-foreground">Förhandsgranskning</h3>
      {cost ? <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
        <div><dt className="text-xs text-muted-foreground">Sträcka</dt><dd>{roundTrip ? `2 × ${formatKm(cost.distanceKm)} km = ${formatKm(cost.totalKm)} km` : `${formatKm(cost.totalKm)} km`} <span className="text-muted-foreground">({basisLabel})</span></dd></div>
        <div><dt className="text-xs text-muted-foreground">Pris</dt><dd>{formatPrice(cost.price)} kr/{unit}{unit === "mil" ? ` (${formatPrice(cost.pricePerKm)} kr/km)` : ""}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Belopp exkl. moms</dt><dd className="font-semibold tabular-nums" data-testid="car-cost-amount">{formatSek(cost.amount)} kr</dd></div>
      </dl> : <p className="mt-2 text-sm text-muted-foreground">{distance.state === "invalid" || price.state === "invalid" ? "Skriv sträckan och priset med siffror, till exempel 23,4 och 35." : "Ange sträcka och pris för att se beloppet."}</p>}
    </section>

    {existing.length ? <section className="field-group space-y-2 rounded-lg border p-3" data-testid="car-cost-existing">
      <h3 className="text-xs font-medium text-muted-foreground">Det finns redan en bilkostnad på arbetsordern</h3>
      <ul className="space-y-1 text-sm">{existing.map((row) => <li key={row.id}>{row.name}{row.amount ? ` – ${row.amount} kr` : ""}</li>)}</ul>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Spara som">
        <Button type="button" variant={segment(writeMode === "update")} aria-pressed={writeMode === "update"} onClick={() => setWriteMode("update")}>Uppdatera raden</Button>
        <Button type="button" variant={segment(writeMode === "new")} aria-pressed={writeMode === "new"} onClick={() => setWriteMode("new")}>Lägg till som ny rad</Button>
      </div>
      {writeMode === "update" && existing.length > 1 ? <label className={field}>Rad att uppdatera<select className="form-select" value={updateId} onChange={(event) => setUpdateId(event.target.value)}>
        {existing.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
      </select></label> : null}
    </section> : null}

    {/* Why Lägg till cannot be used yet, as text by the buttons (QA 2026-10-10: greyed with no visible reason). */}
    <DisabledReason id="car-cost-commit-reason" className="text-right" reason={cost ? "" : distance.state === "invalid" || price.state === "invalid" ? "Skriv sträckan och priset med siffror först." : distance.state !== "ok" ? "Ange sträckan först." : "Ange priset först."} />
    <DialogActions cancel={{ onClick: onCancel }} primary={{ label: existing.length && writeMode === "update" ? "Uppdatera raden" : "Lägg till", disabled: !cost, onClick: commit, testId: "car-cost-commit" }} />
  </div>;
}
