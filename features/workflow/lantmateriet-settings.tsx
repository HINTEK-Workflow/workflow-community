"use client";

import { useEffect, useState } from "react";
import { Map as MapIcon, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SecretField } from "@/features/kfid/secret-field";
import { api } from "@/features/kfid/api";
import { useServerKeySectionStatus } from "@/features/integrations/server-key-status";
import { KEY_STATUS, KeyCard, KeyFields, KeyTextField } from "@/features/integrations/key-card";
import { formatSwedish } from "@/lib/swedish-time";
import { ADDRESS_ATTRIBUTION_TEXT, MAP_LAYER_LABELS, MAP_LAYERS, type MapLayer } from "@/lib/map/attribution";
import { MapAttribution, PlaceMap } from "./map-view";

type Check = { ok: boolean; message: string; at: string } | null;
type MapState = { configured: boolean; userHint: string | null; layer: MapLayer; capMb: number; zoom: { min: number; max: number } | null; lastCheck: Check; cache: { tiles: number; bytes: number } };
type Environment = "verification" | "production";
type AddressState = { method: "map" | "basic" | "oauth"; environment: Environment; configured: boolean; basic: { configured: boolean; userHint: string | null }; lastCheck: Check; qa: boolean };
const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} MB`;
const TONE = { none: "border-border text-muted-foreground", ok: "border-emerald-300 text-emerald-800 dark:text-emerald-200", bad: "border-red-300 text-red-800 dark:text-red-200" } as const;

/**
 * Lantmäteriet på ett kort (2026-10-18): karta och adresser använder samma inloggning i Geotorget i dag, så en
 * inloggning (användarnamn, lösenord, Spara, Ta bort, Kontrollera) gäller båda. Lagringen är kvar per funktion (kartans
 * och adressernas egna inställningar), så de kan delas upp på två konton senare; fylls ett par i sparas det för båda.
 * Värdena skrivs bara – de visas aldrig.
 */
export function LantmaterietSettings({ notify }: { notify: (text: string, error?: boolean) => void }) {
  const [map, setMap] = useState<MapState | null>(null);
  const [address, setAddress] = useState<AddressState | null>(null);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  // The bins mark the sign-in for removal until the card is saved (2026-11-11).
  const [removeLogin, setRemoveLogin] = useState(false);
  const [layer, setLayer] = useState<MapLayer>("topowebb");
  const [capMb, setCapMb] = useState("1024");
  const [environment, setEnvironment] = useState<Environment>("production");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const applyMap = (next: MapState) => { setMap(next); setLayer(next.layer); setCapMb(String(next.capMb)); };
  const applyAddress = (next: AddressState) => { setAddress(next); setEnvironment(next.environment); };
  useEffect(() => {
    api<MapState>("/api/superadmin/map-settings").then(applyMap).catch((cause: Error) => setError(cause.message));
    api<AddressState>("/api/superadmin/address-lookup-settings").then(applyAddress).catch((cause: Error) => setError(cause.message));
  }, []);

  const postMap = async (input: Record<string, unknown>) => {
    const result = await api<MapState & { check?: { ok: boolean; message: string } }>("/api/superadmin/map-settings", { method: "POST", body: JSON.stringify(input) });
    applyMap(result);
    return result.check;
  };
  const postAddress = async (input: Record<string, unknown>) => {
    const result = await api<AddressState & { check?: { ok: boolean; message: string } }>("/api/superadmin/address-lookup-settings", { method: "POST", body: JSON.stringify(input) });
    applyAddress(result);
    return result.check;
  };
  const run = async (work: () => Promise<{ text?: string; failed?: boolean } | void>) => {
    setBusy(true); setError("");
    try {
      const outcome = await work();
      setUser(""); setPassword(""); setRemoveLogin(false);
      if (outcome?.text) notify(outcome.text, outcome.failed);
      return true;
    } catch (cause) { setError((cause as Error).message); notify((cause as Error).message, true); return false; } finally { setBusy(false); }
  };
  const said = (checks: ({ ok: boolean; message: string } | undefined)[]) => {
    const done = checks.filter((item): item is { ok: boolean; message: string } => Boolean(item));
    return done.length ? { text: done.map((item) => item.message).join(" "), failed: done.some((item) => !item.ok) } : undefined;
  };

  const save = () => run(async () => {
    if (!map || !address) return;
    if (removeLogin) {
      await postMap({ user: null, password: null, layer, capMb: Number(capMb) || map.capMb });
      await postAddress({ user: null, password: null, environment });
      return { text: "Inloggningen är borttagen. Kartan och adresserna används inte längre." };
    }
    const mapInput: Record<string, unknown> = { layer, capMb: Number(capMb) || map.capMb };
    if (user.trim()) mapInput.user = user.trim();
    if (password) mapInput.password = password;
    const addressInput: Record<string, unknown> = { environment };
    // One pair of sign-in values goes to both functions; the address lookup then uses its own copy.
    if (user.trim() || password) { addressInput.method = "basic"; if (user.trim()) addressInput.user = user.trim(); if (password) addressInput.password = password; }
    const checkedMap = await postMap(mapInput);
    const checkedAddress = await postAddress(addressInput);
    return said([checkedMap, checkedAddress]) ?? { text: "Sparat" };
  });
  const check = () => run(async () => said([await postMap({ action: "check" }), ...(address?.configured ? [await postAddress({ action: "check" })] : [])]));

  const part = (state: { configured: boolean; lastCheck: Check } | null, okText: string) =>
    !state ? null : !state.configured ? { label: "Inte inlagd", tone: TONE.none, kind: "none" as const }
      : state.lastCheck?.ok ? { label: okText, tone: TONE.ok, kind: "ok" as const }
        : { label: state.lastCheck ? "Fungerar inte" : "Inte kontrollerad", tone: TONE.bad, kind: "bad" as const };
  const mapStatus = part(map, "Klar – kartan visas");
  const addressStatus = part(address, "Klar – adresser från Lantmäteriet");
  const failure = map?.lastCheck?.ok === false ? `Karta: ${map.lastCheck.message}` : address?.lastCheck?.ok === false ? `Adresser: ${address.lastCheck.message}` : null;
  const kinds = [mapStatus?.kind, addressStatus?.kind];
  const status = !map || !address ? null : failure ? { ...KEY_STATUS.failed, problem: failure }
    : kinds.every((kind) => kind === "ok") ? KEY_STATUS.works
      : kinds.every((kind) => kind === "none") ? KEY_STATUS.missing : KEY_STATUS.untested;
  useServerKeySectionStatus("map", status ? { label: status.label, tone: status.tone, detail: failure ?? undefined, name: "Lantmäteriet" } : error ? { label: "Kunde inte hämtas", tone: "danger", name: "Lantmäteriet" } : null);

  const stored = Boolean(map?.configured || address?.basic.configured);
  const dirty = Boolean(map && address && (removeLogin || user.trim() || password || layer !== map.layer || capMb !== String(map.capMb) || environment !== address.environment));
  const field = "grid gap-1.5 text-xs font-medium text-muted-foreground";
  const checkReason = !map?.configured ? "Lägg in inloggningen och spara först." : null;
  const lastCheck = (id: string, name: string, value: Check) => value ? <p className={`text-xs ${value.ok ? "text-muted-foreground" : "text-red-700 dark:text-red-300"}`} data-testid={id}>
    {name}: kontrollerad {formatSwedish(value.at, { dateStyle: "medium", timeStyle: "short" })} – {value.message}
  </p> : null;
  return <div data-testid="map-settings"><KeyCard icon={MapIcon} title="Lantmäteriet" status={status} statusTestId="lantmateriet-status" moreTestId="lantmateriet-more" moreOpenWhen={Boolean(failure)}
    check={map && address ? { onClick: () => void check(), busy, disabled: busy, disabledReason: checkReason, label: "Kontrollera Lantmäteriet", testId: "address-check" } : undefined}
    save={map && address ? { dirty, onSave: save } : undefined} saveable
    settings={map && address ? <div className="grid gap-3 @lg:grid-cols-2">
      <label className={field}>Kartlager<select className="form-select" value={layer} onChange={(event) => setLayer(event.target.value as MapLayer)}>
        {MAP_LAYERS.map((item) => <option key={item} value={item}>{MAP_LAYER_LABELS[item]}</option>)}
      </select></label>
      <KeyTextField id="map-cap" label="Disk för kartan, högst (MB)" type="number" inputMode="numeric" value={capMb} onChange={setCapMb} removeLabel="Töm diskgränsen" />
      <label className={field}>Miljö för adresser<select className="form-select" value={environment} onChange={(event) => setEnvironment(event.target.value as Environment)} data-testid="address-environment">
        <option value="production">Produktion</option>
        <option value="verification">Verifiering</option>
      </select></label>
    </div> : null}
    more={!map || !address ? undefined : (open) => <>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="flex items-center gap-2">Karta{mapStatus ? <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${mapStatus.tone}`} data-testid="map-status">{mapStatus.label}</span> : null}</span>
        <span className="flex items-center gap-2">Adresser{addressStatus ? <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${addressStatus.tone}`} data-testid="address-lookup-status">{addressStatus.label}</span> : null}</span>
        {map.zoom ? <span>Nivåer {map.zoom.min}–{map.zoom.max}</span> : null}
        {address.qa ? <span>QA-exempel: ett fast exempel svarar för adresser.</span> : null}
      </p>
      {lastCheck("map-last-check", "Karta", map.lastCheck)}
      {lastCheck("address-last-check", "Adresser", address.lastCheck)}
      <p data-testid="map-cache">Bara rutor som någon tittat på sparas. Nu: {map.cache.tiles.toLocaleString("sv-SE")} kartrutor, {megabytes(map.cache.bytes)} av {map.capMb.toLocaleString("sv-SE")} MB.</p>
      <p className="text-[11px] leading-4">{ADDRESS_ATTRIBUTION_TEXT}</p>
      {!open ? null : map.configured && map.lastCheck?.ok && map.zoom ? <div className="space-y-2" data-testid="map-preview">
        <p className="font-medium">Provkarta – dra och zooma.</p>
        <PlaceMap key={map.lastCheck.at} status={{ enabled: true, layer: map.layer, minZoom: map.zoom.min, maxZoom: map.zoom.max }} points={[]} label="Provkarta" />
      </div> : <MapAttribution />}
      {/* What removes stands last in Mer, to the left (2026-11-12). */}
      <Button type="button" variant="ghost" size="sm" className="w-fit text-destructive" disabled={busy || !map.cache.bytes} onClick={() => void run(async () => { await postMap({ action: "clear_cache" }); return { text: "Kartcachen är tömd." }; })} data-testid="map-clear-cache"><Trash2 />Töm kartcachen</Button>
    </>}>
    {!map || !address ? <p className="text-muted-foreground">{error || "Hämtar…"}</p> : <div className="space-y-3">
      <KeyFields>
        <KeyTextField id="map-user" label="Användarnamn i Geotorget" value={user} onChange={(value) => { setUser(value); setRemoveLogin(false); }}
          placeholder={removeLogin ? "Tas bort när du sparar" : stored ? `${map.userHint ?? address.basic.userHint ?? ""} (sparat)` : "Användarnamn"} removeLabel="Töm användarnamnet" />
        <SecretField keepBin id="map-password" label="Lösenord" autoComplete="new-password" value={password} onChange={(value) => { setPassword(value); setRemoveLogin(false); }} stored={stored} removed={removeLogin} placeholder="Lösenord"
          removeLabel="Ta bort inloggningen" busy={busy} onRemove={() => { setUser(""); setPassword(""); setRemoveLogin(true); }} onUndo={() => setRemoveLogin(false)} />
      </KeyFields>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>}
  </KeyCard></div>;
}
