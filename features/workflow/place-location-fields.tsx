"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Crosshair, ExternalLink, Map as MapIcon, MapPin, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/features/kfid/api";
import { PlaceMap, useMapStatus } from "./map-view";
import { formatCoordinates, mapLinks, parseCoordinates, type PlacePosition } from "@/lib/workflow/place-position";
import { ADDRESS_ATTRIBUTION_TEXT, MAP_LICENSE_URL } from "@/lib/map/attribution";
import type { AddressProposal } from "@/lib/geo/address-parse";
import { ADDRESS_GEOCODE_DELAY_MS, geocodeMatch, geocodeText, type AddressChoice, type AddressSuggestion } from "@/lib/geo/address-search";
import { AddressSearchField, useAddressLookupStatus } from "./address-search-field";

/** What a place's address and pin are made of: the three address fields and an optional position. */
export type PlaceLocation = { address: string; postalCode: string; city: string; latitude: number | null; longitude: number | null };

type AddressFields = Pick<PlaceLocation, "address" | "postalCode" | "city">;
type Point = { latitude: number; longitude: number };
type ProposalState = { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "none"; reason: string } | { status: "found"; proposal: AddressProposal };
const sameFields = (a: AddressFields, b: AddressFields) => a.address.trim() === b.address.trim() && a.postalCode.trim() === b.postalCode.trim() && a.city.trim() === b.city.trim();
const fieldsOf = (proposal: AddressProposal): AddressFields => ({ address: proposal.address, postalCode: proposal.postalCode, city: proposal.city });
const samePoint = (a: Point | null, b: Point | null) => Boolean(a && b && a.latitude === b.latitude && a.longitude === b.longitude);

/**
 * The address and the pin of a place (2026-10-04/08/15), shared by the place form, the company's place in
 * Företagsuppgifter (2026-10-24: "bara en kartnål och adressen") and the job's Tillfällig plats. Returns the two
 * parts – the address fields and the position fieldset – so each form puts them where it wants them (a compact place form
 * folds the position under Fler uppgifter).
 *
 * Adress och kartnål i takt (2026-10-24), on a top level (`topLevel`) when the installation has Lantmäteriet's
 * addresses:
 * - address → pin: a chosen suggestion sets the pin at its address point; a typed address (street with postnummer or
 *   postort) is searched a moment after the last key, and when Lantmäteriet has that very address the pin moves there –
 *   at once when there is no pin or the pin came from an address, otherwise "Flytta nålen till adressen" offers it, so a
 *   pin the person placed by hand is never moved by itself;
 * - pin → address: a pin that is set, dragged or tapped fetches the nearest address through our own server; it fills the
 *   fields while they are empty or still hold what the map filled, and a typed address waits for "Använd förslaget".
 * A lookup that fails never stops the coordinates or a typed address from being saved. The position also comes from the
 * phone or is pasted; the links open the person's own map service.
 */
export function usePlaceLocationFields<T extends PlaceLocation>({ value, onChange, topLevel = true, name = "", pinLabel = "Platsen", mapLabel = "Karta för platsens position", above = null, testIdPrefix = "place", mapOpen = false }: {
  value: T; onChange: (value: T) => void;
  /** Only a top level carries an address of its own; below it the address fields are not drawn by the caller. */
  topLevel?: boolean;
  /** The place's name, for the map services' links. */
  name?: string; pinLabel?: string; mapLabel?: string;
  /** The place above (a grey pin) when this one has no position of its own. */
  above?: (PlacePosition & { label: string }) | null;
  testIdPrefix?: string;
  /** The map is open from the start even without a position (the job's Tillfällig plats). */
  mapOpen?: boolean;
}): { addressFields: ReactNode; positionFieldset: ReactNode; positionError: string } {
  const position = value.latitude !== null && value.longitude !== null ? { latitude: value.latitude, longitude: value.longitude } : null;
  const shown = position ? formatCoordinates(position) : "";
  const [coordinates, setCoordinates] = useState(shown);
  // The text box follows a pin set on the map, from an address, by the phone or by a colleague, and keeps what the person
  // typed when it is the same position (React's "adjust state when a value changes").
  const [seen, setSeen] = useState(shown);
  if (shown !== seen) {
    setSeen(shown);
    const typed = parseCoordinates(coordinates);
    if (!(typed && position && samePoint(typed, position))) setCoordinates(shown);
  }
  const [positionError, setPositionError] = useState("");
  const [locating, setLocating] = useState(false);
  // Lantmäteriet's map when the installation has it (2026-10-04): a tap sets the pin, and since 2026-10-07 the
  // pin can be dragged. The map is open from the start when there is something to show – the place's own position or
  // the one above it – and otherwise one tap away.
  const mapStatus = useMapStatus();
  const [mapChoice, setMapChoice] = useState<boolean | null>(null);
  const showMap = mapChoice ?? (mapOpen || value.latitude !== null || above !== null);
  const set = (patch: Partial<PlaceLocation>) => onChange({ ...value, ...patch } as T);
  const addressId = useId();
  const links = position ? mapLinks(position, name) : null;

  // Adressförslag (2026-10-08): fetched when the pin is set or moved on a top-level place, a moment after it stops moving.
  const lookupAvailable = useAddressLookupStatus();
  const [proposal, setProposal] = useState<ProposalState>({ status: "idle" });
  // The proposal last written into the fields; while they still hold it, the next proposal may replace it.
  const applied = useRef<AddressFields | null>(null);
  const latest = useRef(value);
  useEffect(() => { latest.current = value; });
  const request = useRef(0);
  // A pin set from an address (a chosen suggestion or a typed address found) already has its address: that position is
  // not asked about again, and the next address may move it.
  const pickedPin = useRef<Point | null>(null);
  const pinFromAddress = useRef<Point | null>(null);
  // The typed address's point when the pin was placed by hand: offered, never moved by itself.
  const [addressPin, setAddressPin] = useState<Point | null>(null);
  // Only what the person types in the three fields is looked up, never a saved address being drawn.
  const typedAddress = useRef(false);
  const geocodeRequest = useRef(0);
  useEffect(() => {
    if (!lookupAvailable || !topLevel || position === null) return;
    if (samePoint(pickedPin.current, position)) return;
    pickedPin.current = null;
    const id = ++request.current;
    const { latitude, longitude } = position;
    const timer = setTimeout(() => {
      setProposal({ status: "loading" });
      // A POST (2026-10-15): the pin's coordinates never stand in an address, and so in no access log.
      fetch("/api/places/address-lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "point", lat: latitude, lon: longitude }), cache: "no-store" })
        .then(async (response) => {
          const data = await response.json().catch(() => ({})) as { error?: string; available?: boolean; found?: boolean; proposal?: AddressProposal; reason?: string };
          if (id !== request.current) return;
          if (!response.ok) { setProposal({ status: "error", message: data.error || `Lantmäteriet svarade ${response.status}.` }); return; }
          if (!data.found || !data.proposal) { setProposal({ status: "none", reason: data.reason || "Lantmäteriet har ingen adress för den här punkten." }); return; }
          setProposal({ status: "found", proposal: data.proposal });
          // Fill only fields that are empty or still hold what the map filled; a typed address waits for the button.
          const current = latest.current;
          const untouched = (!current.address.trim() && !current.postalCode.trim() && !current.city.trim()) || (applied.current !== null && sameFields(current, applied.current));
          if (untouched) { const fields = fieldsOf(data.proposal); applied.current = fields; typedAddress.current = false; onChange({ ...current, ...fields } as T); }
        })
        .catch(() => { if (id === request.current) setProposal({ status: "error", message: "Lantmäteriet kunde inte nås." }); });
    }, 400);
    return () => clearTimeout(timer);
  }, [lookupAvailable, topLevel, position?.latitude, position?.longitude]); // eslint-disable-line react-hooks/exhaustive-deps

  // The pin follows a typed address (2026-10-24): searched a moment after the last key; only the very same address counts.
  useEffect(() => {
    if (!lookupAvailable || !topLevel || !typedAddress.current) return;
    const fields: AddressFields = { address: value.address, postalCode: value.postalCode, city: value.city };
    const text = geocodeText(fields);
    const id = ++geocodeRequest.current;
    if (!text) return;
    const timer = setTimeout(() => {
      void (async () => {
        const found = await api<{ suggestions?: AddressSuggestion[] }>("/api/places/address-lookup", { method: "POST", body: JSON.stringify({ action: "search", text }), cache: "no-store" });
        const hit = geocodeMatch(fields, found.suggestions ?? []);
        if (!hit || id !== geocodeRequest.current) return;
        const picked = await api<{ found?: boolean; choice?: AddressChoice }>("/api/places/address-lookup", { method: "POST", body: JSON.stringify({ action: "pick", id: hit.id }), cache: "no-store" });
        const point = picked.found ? picked.choice?.point ?? null : null;
        const current = latest.current;
        if (!point || id !== geocodeRequest.current || !sameFields(current, fields)) return;
        const pin = current.latitude !== null && current.longitude !== null ? { latitude: current.latitude, longitude: current.longitude } : null;
        if (samePoint(pin, point)) return;
        if (pin && !samePoint(pin, pinFromAddress.current)) { setAddressPin(point); return; }
        pickedPin.current = point; pinFromAddress.current = point;
        request.current += 1; setProposal({ status: "idle" });
        onChange({ ...current, ...point } as T);
      })().catch(() => { /* No pin from the address this time; the typed address is saved as it is. */ });
    }, ADDRESS_GEOCODE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [lookupAvailable, topLevel, value.address, value.postalCode, value.city]); // eslint-disable-line react-hooks/exhaustive-deps

  const typeAddress = (patch: Partial<AddressFields>) => { typedAddress.current = true; setAddressPin(null); set(patch); };
  const useProposal = () => {
    if (proposal.status !== "found") return;
    const fields = fieldsOf(proposal.proposal);
    applied.current = fields;
    typedAddress.current = false;
    set(fields);
  };
  const proposalApplied = proposal.status === "found" && sameFields(value, fieldsOf(proposal.proposal));
  // Adressökning (2026-10-15): a chosen address fills street, postnummer and postort, and – when it has an address
  // point – sets the pin there. The fields then count as Lantmäteriet's, so a later pin move may propose another address.
  const pickAddress = (choice: AddressChoice) => {
    const fields: AddressFields = { address: choice.address, postalCode: choice.postalCode, city: choice.city };
    applied.current = fields;
    typedAddress.current = false;
    geocodeRequest.current += 1;
    request.current += 1;
    setProposal({ status: "idle" }); setAddressPin(null);
    if (choice.point) {
      pickedPin.current = choice.point; pinFromAddress.current = choice.point;
      set({ ...fields, ...choice.point });
      setPositionError("");
    } else set(fields);
  };
  // A pin the person sets: by hand, so a typed address no longer moves it.
  const placePin = (next: Point) => { pinFromAddress.current = null; setAddressPin(null); set(next); setPositionError(""); };
  const movePinToAddress = () => {
    if (!addressPin) return;
    pickedPin.current = addressPin; pinFromAddress.current = addressPin;
    request.current += 1; setProposal({ status: "idle" });
    set(addressPin); setAddressPin(null); setPositionError("");
  };

  const usePosition = () => {
    if (!navigator.geolocation) { setPositionError("Webbläsaren kan inte ge en position."); return; }
    setLocating(true); setPositionError("");
    navigator.geolocation.getCurrentPosition((result) => {
      setLocating(false);
      placePin({ latitude: Math.round(result.coords.latitude * 1e6) / 1e6, longitude: Math.round(result.coords.longitude * 1e6) / 1e6 });
    }, (issue) => {
      setLocating(false);
      setPositionError(issue.code === issue.PERMISSION_DENIED ? "Positionen är blockerad. Tillåt plats i webbläsaren, eller klistra in koordinaterna." : "Positionen kunde inte hämtas. Försök igen eller klistra in koordinaterna.");
    }, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 });
  };
  const pasteCoordinates = (text: string) => {
    setCoordinates(text);
    if (!text.trim()) { pinFromAddress.current = null; set({ latitude: null, longitude: null }); setPositionError(""); request.current += 1; setProposal({ status: "idle" }); return; }
    const parsed = parseCoordinates(text);
    if (parsed) placePin(parsed); else setPositionError("Skriv latitud och longitud, till exempel 57.7089, 11.9746.");
  };
  const field = "block space-y-2 text-xs font-medium text-muted-foreground";
  const distance = (metres: number) => metres >= 1000 ? `${(metres / 1000).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} km` : `${metres} m`;
  const synced = lookupAvailable && topLevel;

  const positionFieldset = (
    <fieldset className="field-group space-y-2 rounded-lg border p-3">
      <legend className="px-1 text-xs font-medium text-muted-foreground">Position (valfritt)</legend>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={usePosition} data-testid={`${testIdPrefix}-use-position`} busy={locating} busyLabel="Hämtar position…"><Crosshair />Använd min position</Button>
        {mapStatus ? <Button type="button" variant="outline" size="sm" aria-pressed={showMap} onClick={() => setMapChoice(!showMap)} data-testid={`${testIdPrefix}-show-map`}><MapIcon />{showMap ? "Dölj kartan" : "Sätt på kartan"}</Button> : null}
        {addressPin ? <Button type="button" variant="outline" size="sm" onClick={movePinToAddress} data-testid={`${testIdPrefix}-pin-to-address`}><MapPin />Flytta nålen till adressen</Button> : null}
        {links ? <>
          <Button asChild variant="outline" size="sm"><a href={links.google} target="_blank" rel="noopener noreferrer"><ExternalLink />Google Kartor</a></Button>
          <Button asChild variant="outline" size="sm"><a href={links.apple} target="_blank" rel="noopener noreferrer"><ExternalLink />Apple Kartor</a></Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => pasteCoordinates("")} data-testid={`${testIdPrefix}-remove-pin`}><Trash2 />Ta bort kartnålen</Button>
        </> : null}
      </div>
      <label className={field}>Koordinater (latitud, longitud)<Input value={coordinates} inputMode="decimal" placeholder="57.7089, 11.9746" aria-invalid={positionError ? true : undefined} onChange={(event) => pasteCoordinates(event.target.value)} data-testid={`${testIdPrefix}-coordinates`} /></label>
      {positionError ? <p role="alert" className="text-xs text-destructive">{positionError}</p> : null}
      {synced ? <p className="text-xs text-muted-foreground" data-testid={`${testIdPrefix}-sync-note`}>Adress och kartnål följer varandra.</p> : null}
      {mapStatus && showMap ? <PlaceMap status={mapStatus} label={mapLabel}
        points={[
          ...(position ? [{ id: "here", ...position, label: pinLabel, draggable: true }] : above ? [{ id: "above", latitude: above.latitude, longitude: above.longitude, label: above.label, muted: true }] : []),
          ...(proposal.status === "found" && proposal.proposal.point && !proposal.proposal.exact ? [{ id: "address", ...proposal.proposal.point, label: `Adresspunkt: ${proposal.proposal.address || "adressen"}`, muted: true }] : []),
          ...(addressPin ? [{ id: "typed-address", ...addressPin, label: `Adressen: ${value.address || "adressen"}`, muted: true }] : []),
        ]}
        hint={position ? "Dra nålen eller tryck i kartan." : above ? "Den grå nålen är platsen ovanför. Tryck på kartan där den här platsen är." : "Tryck i kartan för att sätta nålen."}
        onPick={placePin}
        onMove={(_, next) => placePin(next)} /> : null}
    </fieldset>
  );

  const addressFields = <>
    <AddressSearchField id={`${addressId}-street`} label="Gatuadress och husnummer" value={value.address} onChange={(address) => typeAddress({ address })} onPick={pickAddress} available={lookupAvailable} testId={`${testIdPrefix}-address-search`} />
    <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
      <label className={field}>Postnummer<Input value={value.postalCode} onChange={(event) => typeAddress({ postalCode: event.target.value })} maxLength={20} inputMode="numeric" autoComplete="off" data-testid={`${testIdPrefix}-postal-code`} /></label>
      <label className={field}>Postort<Input value={value.city} onChange={(event) => typeAddress({ city: event.target.value })} maxLength={120} autoComplete="off" data-testid={`${testIdPrefix}-city`} /></label>
    </div>
    {lookupAvailable && proposal.status !== "idle" ? <div className="field-group space-y-1.5 rounded-lg border p-3 text-sm" data-testid="address-proposal" data-state={proposal.status} data-applied={proposalApplied ? "true" : undefined} aria-live="polite">
      <p className="text-xs font-medium text-muted-foreground">{proposalApplied ? "Adress från kartnålen" : "Adressförslag från kartnålen"}</p>
      {proposal.status === "loading" ? <p className="text-sm text-muted-foreground" role="status">Hämtar adress…</p> : null}
      {proposal.status === "error" ? <p className="text-sm text-destructive" role="alert">{proposal.message} Skriv adressen själv.</p> : null}
      {proposal.status === "none" ? <p className="text-sm text-muted-foreground">{proposal.reason} Skriv adressen själv.</p> : null}
      {proposal.status === "found" ? <>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium" data-testid="address-proposal-line">{[proposal.proposal.address, [proposal.proposal.postalCode, proposal.proposal.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}</span>
          {!proposal.proposal.exact ? <span className="rounded-full border border-amber-300 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-200" data-testid="address-proposal-nearby">Förslag från närliggande adresspunkt</span> : null}
        </p>
        {!proposal.proposal.exact || !proposalApplied ? <p className="text-xs text-muted-foreground">{!proposal.proposal.exact ? `Adresspunkten ligger ${distance(proposal.proposal.distanceM)} från kartnålen.` : ""}{!proposalApplied ? `${proposal.proposal.exact ? "" : " "}Fälten har en egen adress.` : ""}</p> : null}
        {!proposalApplied ? <Button type="button" variant="outline" onClick={useProposal} data-testid="address-use-proposal">Använd förslaget</Button> : null}
      </> : null}
      <p className="text-[11px] leading-4 text-muted-foreground" data-testid="address-attribution">{ADDRESS_ATTRIBUTION_TEXT.replace(/\.$/, "")} (<a className="underline" href={MAP_LICENSE_URL} target="_blank" rel="noopener noreferrer">licens</a>).</p>
    </div> : null}
  </>;

  return { addressFields, positionFieldset, positionError };
}
