"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Ban, Eye, ListVideo, Monitor, MonitorSmartphone, Pencil, Plus, RotateCw, Trash2, Wifi, WifiOff } from "lucide-react";
import { AreaIcon } from "@/components/area-icon";
import { EditorMoreMenu } from "@/components/editor-ribbon";
import { PageHeader } from "@/components/page-shell";
import { DelayedSkeleton } from "@/components/skeleton";
import { Button } from "@/components/ui/button";
import { RemoveButton } from "@/components/ui/remove-button";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { CheckField, DialogActions, Empty, Field, Modal, NoPermission, Panel, RowsSkeleton } from "@/features/kfid/ui";
import { useWorkspaceData } from "@/features/kfid/use-workspace-data";
import { indicatorBadge, type IndicatorTone } from "@/features/workflow/indicator-tone";
import { appAddress, type BoardsAccess } from "@/lib/boards/access";
import { SCREEN_BASE_PATH } from "@/lib/boards/guard";
import { CopyButton } from "@/components/ui/copy-button";
import { normalizePairCode } from "@/lib/boards/screens";
import { DISTANCE, DISTANCES, type Distance } from "@/lib/boards/model";
import { screenCapacity, TV_INCHES, tvInches } from "@/lib/boards/capacity";
import { SCREENS_SENTENCE } from "@/lib/boards/tabs";
import { formatSwedish } from "@/lib/swedish-time";
import { announce, notice } from "@/lib/workflow/toast";
import { cn } from "@/lib/utils";
import { boardsGet, boardsPost, targetOfValue, targetValue, type PairingInfo, type PlaylistListItem, type ScreenItem, type ScreenList, type ScreenSettingsValue } from "./boards-api";
import { TargetSelect, useTargetOptions } from "./target-select";
import { WaysOutHelp } from "./ways-out-help";

/**
 * Fasta skärmar (Tavlor och skärmar etapp 2, 2026-11-18; plan 7; named so 2026-11-19 to set them apart from Delade länkar): the connected screens – name, place, what they show, Online or Offline,
 * last seen and size – with Ändra, Ladda om, Identifiera, Spärra and Ta bort, all taking effect within seconds. Koppla skärm takes the
 * code shown on the screen (or arrives from its QR code with the code filled in), shows what is being connected and needs a name and
 * what to show. Spellistor sit under the screens.
 */
const STATUS: Record<ScreenItem["status"], { label: string; tone: IndicatorTone }> = {
  online: { label: "Online", tone: "success" }, offline: { label: "Offline", tone: "warning" }, revoked: { label: "Spärrad", tone: "danger" }, disconnected: { label: "Bortkopplad", tone: "neutral" },
};
const HOURS = ["", ...Array.from({ length: 24 }, (_, hour) => String(hour))];
const hourLabels = Object.fromEntries([["", "Aldrig"], ...Array.from({ length: 24 }, (_, hour) => [String(hour), `Klockan ${String(hour).padStart(2, "0")}:00`])]);
const DEFAULT_SETTINGS: ScreenSettingsValue = { theme: "dark", reloadHour: 3, burnIn: false, distance: null, inches: null };
/** What can be read on the screen at its size: "Ungefär 24 kort går att läsa." or one figure per distance when it follows the board. */
function capacityText(value: ScreenSettingsValue) {
  const at = (distance: Distance) => screenCapacity("tv1080", "landscape", distance, 14, value.inches).cards;
  if (value.distance) return `Ungefär ${at(value.distance)} kort går att läsa på skärmen${value.inches ? "" : ` (räknat på ${tvInches(value.distance)} tum)`}.`;
  return value.inches
    ? `Ungefär ${at("near")} kort går att läsa vid Nära, ${at("medium")} vid Mellan och ${at("far")} vid Långt.`
    : `Ungefär ${at("near")} kort går att läsa vid Nära (${tvInches("near")} tum), ${at("medium")} vid Mellan (${tvInches("medium")} tum) och ${at("far")} vid Långt (${tvInches("far")} tum).`;
}

export function ScreensPage({ access }: { access: BoardsAccess }) {
  const search = useSearchParams();
  const fromQr = search.get("koppla");
  const read = useWorkspaceData<ScreenList>("/api/boards?part=screens", (signal) => api<ScreenList>("/api/boards?part=screens", { signal, cache: "no-store" }));
  const [connect, setConnect] = useState<{ code?: string; screen?: ScreenItem } | null>(() => fromQr && access.manageScreens ? { code: fromQr } : null);
  const [editing, setEditing] = useState<ScreenItem | null>(null);
  const [confirm, confirmElement] = useConfirm();
  // Online or Offline follows the screens by itself (filmed 2026-11-20: "inte hörd av ännu" while the TV already showed the board):
  // the list is read again every 30 seconds while it is shown, and a few times in the first seconds after a screen is paired.
  const [paired, setPaired] = useState(0);
  const reload = read.reload;
  const watch = access.screens && !access.demo;
  useEffect(() => {
    if (!watch) return;
    const soon = paired ? [2_000, 5_000, 10_000, 20_000].map((ms) => window.setTimeout(() => void reload(), ms)) : [];
    const every = window.setInterval(() => { if (document.visibilityState === "visible") void reload(); }, 30_000);
    return () => { soon.forEach((timer) => window.clearTimeout(timer)); window.clearInterval(every); };
  }, [paired, reload, watch]);
  // A screen's QR code opened by someone who may not connect screens (2026-11-20): a plain message instead of an empty page.
  const qrNoRight = fromQr && !access.manageScreens ? <p className="notice" role="status" data-testid="screen-qr-no-right">Du har inte behörighet att koppla skärmar. Be en administratör i företaget att koppla skärmen med koden {fromQr.slice(0, 12)}.</p> : null;
  if (!access.screens) return qrNoRight ? <div className="space-y-5" data-testid="board-screens"><PageHeader title="Tavlor" description={SCREENS_SENTENCE} />{qrNoRight}</div> : <NoPermission page />;
  const address = appAddress(access, SCREEN_BASE_PATH);
  if (access.demo) return <div className="space-y-5" data-testid="board-screens">
    <PageHeader title="Tavlor" description={SCREENS_SENTENCE} />
    <WaysOutHelp />
    <p className="notice" role="status" data-testid="boards-demo-screens">Fasta skärmar kan inte kopplas i demon. I Workflow öppnar du {address} på skärmen och kopplar den med koden som visas.</p>
  </div>;
  const act = async (body: Record<string, unknown>, done: string) => {
    try { await boardsPost(body); notice(done); void read.reload(); }
    catch (error) { announce(error instanceof Error ? error.message : "Det gick inte.", true); }
  };
  const items = read.data?.items;
  const manage = Boolean(read.data?.canManage ?? access.manageScreens);
  return <div className="space-y-5" data-testid="board-screens">
    {confirmElement}
    <PageHeader title="Tavlor" description={SCREENS_SENTENCE}
      actions={manage ? <Button type="button" onClick={() => setConnect({})} data-testid="screen-connect"><Plus aria-hidden="true" />Koppla skärm</Button> : undefined} />
    <WaysOutHelp />
    {qrNoRight}
    {read.error ? <p role="alert" className="notice text-destructive">{read.error}</p> : null}
    {!items ? <DelayedSkeleton><div className="rounded-xl border bg-card px-3.5 py-3"><RowsSkeleton rows={4} label="Hämtar skärmar…" /></div></DelayedSkeleton>
      : !items.length ? <div className="rounded-xl border bg-card"><Empty title="Inga fasta skärmar än" description={`${SCREENS_SENTENCE} Öppna ${address} i skärmens webbläsare. Skärmen visar en kod som du skriver in här.`}>
        {manage ? <Button type="button" onClick={() => setConnect({})}><Plus aria-hidden="true" />Koppla skärm</Button> : null}
      </Empty></div>
      : <div className="divide-y overflow-hidden rounded-xl border bg-card" role="list" aria-label="Fasta skärmar">{items.map((item) => <div key={item.id} role="listitem" className="flex flex-wrap items-center gap-3 px-3.5 py-3 text-sm" data-testid="screen-row">
        <AreaIcon area="project" icon={Monitor} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2"><span className="truncate font-semibold">{item.name}</span>
            <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", indicatorBadge(STATUS[item.status].tone))} data-testid="screen-status">
              {item.status === "online" ? <Wifi className="size-3" aria-hidden="true" /> : <WifiOff className="size-3" aria-hidden="true" />}{STATUS[item.status].label}</span></span>
          <span className="block truncate text-xs text-muted-foreground">{[item.placeName, `Visar ${item.shows}`, item.settings.distance ? `avstånd ${DISTANCE[item.settings.distance].label.toLowerCase()}` : "", item.settings.inches ? `${item.settings.inches} tum` : "", item.lastSeenAt ? `senast ${formatSwedish(item.lastSeenAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "inte hörd av ännu", item.size].filter(Boolean).join(" · ")}</span>
        </span>
        {manage ? <EditorMoreMenu label={`Åtgärder för ${item.name}`} testId="screen-menu" items={item.status === "revoked" || item.status === "disconnected" ? [
          { label: "Koppla igen", icon: MonitorSmartphone, onSelect: () => setConnect({ screen: item }) },
          { label: "Ta bort", icon: Trash2, danger: true, onSelect: async () => { if (await confirm({ title: `Ta bort ${item.name}?`, message: "Skärmen försvinner ur listan.", confirmLabel: "Ta bort", tone: "danger" })) void act({ action: "delete_screen", id: item.id }, "Skärmen är borttagen."); } },
        ] : [
          { label: "Ändra", icon: Pencil, onSelect: () => setEditing(item) },
          { label: "Ladda om", icon: RotateCw, onSelect: () => void act({ action: "screen_command", id: item.id, command: "reload" }, "Skärmen laddar om inom en minut.") },
          { label: "Identifiera", icon: Eye, onSelect: () => void act({ action: "screen_command", id: item.id, command: "identify" }, "Skärmen visar sitt namn en stund.") },
          { label: "Spärra", icon: Ban, danger: true, onSelect: async () => { if (await confirm({ title: `Spärra ${item.name}?`, message: "Skärmen slutar visa tavlan vid nästa hämtning. Du kan koppla den igen med en ny kod.", confirmLabel: "Spärra", tone: "danger" })) void act({ action: "revoke_screen", id: item.id }, "Skärmen är spärrad."); } },
          { label: "Ta bort", icon: Trash2, danger: true, onSelect: async () => { if (await confirm({ title: `Ta bort ${item.name}?`, message: "Skärmen slutar visa tavlan och försvinner ur listan.", confirmLabel: "Ta bort", tone: "danger" })) void act({ action: "delete_screen", id: item.id }, "Skärmen är borttagen."); } },
        ]} /> : null}
      </div>)}</div>}
    <Panel title="Så startar skärmen" icon={MonitorSmartphone}>
      <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
        <li>Öppna webbläsaren på skärmen och gå till adressen nedan.</li>
        <li>Skärmen visar en kod och en QR-kod. Välj Koppla skärm här och skriv koden, eller skanna QR-koden med telefonen.</li>
        <li>Skärmen kommer ihåg kopplingen. För fast drift fungerar en liten dator som startar webbläsaren i helskärm bäst; guiden i dokumentationen visar hur.</li>
      </ol>
      <div className="mt-3 flex items-center gap-2 rounded-lg border bg-muted/40 p-2" data-testid="screen-address"><code className="min-w-0 flex-1 break-all text-sm">{address}</code><CopyButton value={address} label="Kopiera" /></div>
    </Panel>
    <PlaylistsPanel access={access} />
    {connect ? <ConnectDialog address={address} code={connect.code} screen={connect.screen} screens={items ?? []} onClose={() => setConnect(null)} onDone={() => { setConnect(null); setPaired((count) => count + 1); void read.reload(); }} /> : null}
    {editing ? <ScreenDialog screen={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); void read.reload(); }} /> : null}
  </div>;
}

function SettingsFields({ id, value, onChange }: { id: string; value: ScreenSettingsValue; onChange: (value: ScreenSettingsValue) => void }) {
  return <>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field id={`${id}-theme`} label="Tema" value={value.theme} onChange={(theme) => onChange({ ...value, theme: theme as ScreenSettingsValue["theme"] })} options={["dark", "light"]} optionLabels={{ dark: "Mörkt", light: "Ljust" }} />
      <Field id={`${id}-reload`} label="Ladda om varje natt" value={value.reloadHour === null ? "" : String(value.reloadHour)} onChange={(hour) => onChange({ ...value, reloadHour: hour === "" ? null : Number(hour) })} options={HOURS} optionLabels={hourLabels} help="Skärmens egen klocka." />
    </div>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field id={`${id}-distance`} label="Avstånd" value={value.distance ?? ""} onChange={(distance) => onChange({ ...value, distance: distance === "" ? null : distance as NonNullable<ScreenSettingsValue["distance"]> })}
        options={["", ...DISTANCES]} optionLabels={{ "": "Som tavlan", ...Object.fromEntries(DISTANCES.map((key) => [key, `${DISTANCE[key].label} – ${DISTANCE[key].place}`])) }}
        help="Hur långt ifrån skärmen läses. Längre avstånd ger större text, och då får mindre plats på varje kort." />
      <Field id={`${id}-inches`} label="Skärmstorlek" value={value.inches ? String(value.inches) : ""} onChange={(inches) => onChange({ ...value, inches: inches === "" ? null : Number(inches) })}
        options={["", ...TV_INCHES.map(String)]} optionLabels={{ "": "Vanlig för avståndet", ...Object.fromEntries(TV_INCHES.map((inches) => [String(inches), `${inches} tum`])) }}
        help="Skärmens diagonal. Bilden blir likadan, men Workflow räknar med storleken när det visar hur mycket som går att läsa." />
    </div>
    <p className="text-xs text-muted-foreground" data-testid="screen-capacity">{capacityText(value)}</p>
    <CheckField id={`${id}-burn`} label="Skydd mot inbränning" description="Bilden flyttas en pixel då och då, så att en OLED-skärm inte bränns in." checked={value.burnIn} onChange={(burnIn) => onChange({ ...value, burnIn })} />
  </>;
}

function ConnectDialog({ address, code: initialCode, screen, screens, onClose, onDone }: { address: string; code?: string; screen?: ScreenItem; screens: ScreenItem[]; onClose: () => void; onDone: () => void }) {
  const options = useTargetOptions();
  const [code, setCode] = useState(initialCode ?? "");
  const [info, setInfo] = useState<PairingInfo | null>(null);
  const [name, setName] = useState(screen?.name ?? "");
  const [placeName, setPlaceName] = useState(screen?.placeName ?? "");
  const [target, setTarget] = useState(screen ? targetValue(screen.target) : "");
  const [settings, setSettings] = useState<ScreenSettingsValue>(screen?.settings ?? DEFAULT_SETTINGS);
  const [again, setAgain] = useState(screen?.id ?? "");
  const [busy, setBusy] = useState(false);
  const lookUp = async () => {
    if (!normalizePairCode(code)) { announce("Koden har åtta bokstäver, till exempel BDFG-HJKL.", true); return; }
    setBusy(true);
    try { setInfo(await boardsGet<PairingInfo>(`part=pairing&code=${encodeURIComponent(code)}`)); }
    catch (error) { announce(error instanceof Error ? error.message : "Koden kunde inte läsas.", true); }
    finally { setBusy(false); }
  };
  const approve = async () => {
    if (!name.trim()) { announce("Ge skärmen ett namn.", true); return; }
    if (!target) { announce("Välj vad skärmen ska visa.", true); return; }
    setBusy(true);
    try {
      await boardsPost({ action: "approve_screen", screen: { code, name: name.trim(), placeName, target: targetOfValue(target), settings, ...(again ? { screenId: again } : {}) } });
      notice("Skärmen är kopplad. Den börjar visa tavlan inom några sekunder.");
      onDone();
    } catch (error) { announce(error instanceof Error ? error.message : "Skärmen kunde inte kopplas.", true); }
    finally { setBusy(false); }
  };
  const reconnectable = screens.filter((item) => item.status !== "online");
  return <Modal open onOpenChange={(open) => { if (!open) onClose(); }} title="Koppla skärm" size="form">
    <div className="space-y-4" data-testid="screen-connect-dialog">
      {!info ? <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void lookUp(); }}>
        <p className="text-sm text-muted-foreground" data-testid="screen-connect-sentence">{SCREENS_SENTENCE}</p>
        <Field id="pair-code" label="Koden på skärmen" value={code} onChange={(value) => setCode(value.toUpperCase().slice(0, 9))} placeholder="BDFG-HJKL" help={`Öppna ${address} på skärmen så visas koden. Den gäller i tio minuter.`} />
        <DialogActions cancel={{ onClick: onClose }} primary={{ label: "Fortsätt", type: "submit", busy, busyLabel: "Kontrollerar…", testId: "pair-lookup" }} />
      </form> : <form className="space-y-4" noValidate onSubmit={(event) => { event.preventDefault(); void approve(); }}>
        <div className="rounded-lg border bg-muted/40 p-3 text-sm" data-testid="pair-info">
          <p className="font-semibold">Skärmen som kopplas</p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            <li>Kod {info.code}, begärd {formatSwedish(info.askedAt, { hour: "2-digit", minute: "2-digit" })}</li>
            <li>{info.client}{info.size ? ` · ${info.size}` : ""}</li>
            <li className={info.sameNetwork ? "" : "font-medium text-foreground"}>{info.sameNetwork ? "På samma nät som du." : "Inte på samma nät som du. Koppla bara skärmar du själv har startat."}</li>
          </ul>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="screen-name" label="Namn" value={name} onChange={(value) => setName(value.slice(0, 60))} required placeholder="Till exempel Receptionen" />
          <Field id="screen-place" label="Plats" value={placeName} onChange={(value) => setPlaceName(value.slice(0, 80))} placeholder="Valfritt" />
        </div>
        <TargetSelect id="screen-target" value={target} onChange={setTarget} options={options} testId="screen-target" />
        {!screen && reconnectable.length ? <Field id="screen-again" label="Är det här en skärm som redan finns?" value={again} onChange={(value) => { setAgain(value); const found = screens.find((item) => item.id === value); if (found) { setName(found.name); setPlaceName(found.placeName); setTarget(targetValue(found.target)); setSettings(found.settings); } }}
          options={["", ...reconnectable.map((item) => item.id)]} optionLabels={{ "": "Nej, en ny skärm", ...Object.fromEntries(reconnectable.map((item) => [item.id, `Ja, ${item.name}`])) }} help="Om skärmen har glömt sin koppling behåller den sina inställningar." /> : null}
        <SettingsFields id="connect" value={settings} onChange={setSettings} />
        <DialogActions cancel={{ onClick: onClose }} primary={{ label: "Godkänn", type: "submit", busy, busyLabel: "Kopplar…", testId: "pair-approve" }} />
      </form>}
    </div>
  </Modal>;
}

function ScreenDialog({ screen, onClose, onDone }: { screen: ScreenItem; onClose: () => void; onDone: () => void }) {
  const options = useTargetOptions();
  const [name, setName] = useState(screen.name);
  const [placeName, setPlaceName] = useState(screen.placeName);
  const [target, setTarget] = useState(targetValue(screen.target));
  const [settings, setSettings] = useState(screen.settings);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!name.trim()) { announce("Ge skärmen ett namn.", true); return; }
    setBusy(true);
    try { await boardsPost({ action: "update_screen", id: screen.id, screen: { name: name.trim(), placeName, target: targetOfValue(target), settings } }); notice("Skärmen är ändrad."); onDone(); }
    catch (error) { announce(error instanceof Error ? error.message : "Skärmen kunde inte ändras.", true); }
    finally { setBusy(false); }
  };
  return <Modal open onOpenChange={(open) => { if (!open) onClose(); }} title={`Ändra ${screen.name}`} size="form">
    <form className="space-y-4" noValidate onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="edit-screen-name" label="Namn" value={name} onChange={(value) => setName(value.slice(0, 60))} required />
        <Field id="edit-screen-place" label="Plats" value={placeName} onChange={(value) => setPlaceName(value.slice(0, 80))} />
      </div>
      <TargetSelect id="edit-screen-target" value={target} onChange={setTarget} options={options} />
      <SettingsFields id="edit" value={settings} onChange={setSettings} />
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: "Spara", type: "submit", busy, busyLabel: "Sparar…" }} />
    </form>
  </Modal>;
}

function PlaylistsPanel({ access }: { access: BoardsAccess }) {
  const options = useTargetOptions();
  const [editing, setEditing] = useState<PlaylistListItem | "new" | null>(null);
  const [confirm, confirmElement] = useConfirm();
  if (!access.publish && !access.screens) return null;
  const boardName = (id: string) => options.allBoards.find((board) => board.id === id)?.name ?? "Borttagen tavla";
  return <Panel title="Spellistor" icon={ListVideo} description="Flera tavlor som visas i tur och ordning."
    actions={access.publish ? <Button type="button" size="sm" variant="outline" onClick={() => setEditing("new")} data-testid="playlist-new"><Plus aria-hidden="true" />Ny spellista</Button> : undefined}>
    {confirmElement}
    {!options.ready ? <RowsSkeleton rows={2} /> : !options.playlists.length ? <Empty compact title="Inga spellistor ännu" description="En spellista visar flera tavlor i tur och ordning på en fast skärm." />
      : <ul className="divide-y">{options.playlists.map((playlist) => <li key={playlist.id} className="flex items-center gap-3 py-2.5 text-sm">
        <span className="min-w-0 flex-1"><span className="block truncate font-medium">{playlist.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{playlist.items.map((item) => `${boardName(item.boardId)} (${item.seconds} s)`).join(" · ")}</span></span>
        {access.publish ? <>
          <Button type="button" size="sm" variant="outline" onClick={() => setEditing(playlist)}><Pencil aria-hidden="true" />Ändra</Button>
          <RemoveButton label={`Ta bort ${playlist.name}`} onClick={async () => {
            if (!(await confirm({ title: `Ta bort ${playlist.name}?`, message: "Skärmar och länkar som visar spellistan visar inget förrän de får något annat.", confirmLabel: "Ta bort", tone: "danger" }))) return;
            try { await boardsPost({ action: "delete_playlist", id: playlist.id }); void options.reloadPlaylists(); } catch (error) { announce(error instanceof Error ? error.message : "Det gick inte.", true); }
          }} />
        </> : null}
      </li>)}</ul>}
    {editing ? <PlaylistDialog playlist={editing === "new" ? null : editing} boards={options.boards} onClose={() => setEditing(null)} onDone={() => { setEditing(null); void options.reloadPlaylists(); }} /> : null}
  </Panel>;
}

function PlaylistDialog({ playlist, boards, onClose, onDone }: { playlist: PlaylistListItem | null; boards: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(playlist?.name ?? "");
  const [items, setItems] = useState(playlist?.items ?? (boards[0] ? [{ boardId: boards[0].id, seconds: 30 }] : []));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!name.trim()) { announce("Ge spellistan ett namn.", true); return; }
    setBusy(true);
    try {
      await boardsPost(playlist ? { action: "save_playlist", id: playlist.id, playlist: { name: name.trim(), items } } : { action: "create_playlist", playlist: { name: name.trim(), items } });
      notice("Spellistan är sparad.");
      onDone();
    } catch (error) { announce(error instanceof Error ? error.message : "Spellistan kunde inte sparas.", true); }
    finally { setBusy(false); }
  };
  return <Modal open onOpenChange={(open) => { if (!open) onClose(); }} title={playlist ? "Ändra spellista" : "Ny spellista"} size="form">
    <form className="space-y-4" noValidate onSubmit={(event) => { event.preventDefault(); void save(); }} data-testid="playlist-dialog">
      <Field id="playlist-name" label="Namn" value={name} onChange={(value) => setName(value.slice(0, 60))} required placeholder="Till exempel Hallen" />
      {!boards.length ? <p className="text-sm text-muted-foreground">Publicera en tavla först.</p> : <ul className="space-y-3">{items.map((item, index) => <li key={index} className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_auto]">
        <Field id={`playlist-board-${index}`} label={`Tavla ${index + 1}`} value={item.boardId} onChange={(boardId) => setItems(items.map((row, at) => at === index ? { ...row, boardId } : row))} options={boards.map((board) => board.id)} optionLabels={Object.fromEntries(boards.map((board) => [board.id, board.name]))} />
        <Field id={`playlist-seconds-${index}`} label="Sekunder" type="number" value={item.seconds} onChange={(value) => setItems(items.map((row, at) => at === index ? { ...row, seconds: Math.max(5, Math.min(3600, Math.round(Number(value) || 5))) } : row))} />
        <RemoveButton label={`Ta bort tavla ${index + 1}`} disabled={items.length <= 1} onClick={() => setItems(items.filter((_, at) => at !== index))} />
      </li>)}</ul>}
      {boards.length ? <Button type="button" variant="outline" size="sm" disabled={items.length >= 10} onClick={() => setItems([...items, { boardId: boards[0].id, seconds: 30 }])}><Plus aria-hidden="true" />Tavla</Button> : null}
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: "Spara", type: "submit", busy, busyLabel: "Sparar…", disabled: !boards.length }} />
    </form>
  </Modal>;
}
