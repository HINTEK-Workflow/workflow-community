"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { LayoutGrid, Cable, Clapperboard, Copy, Cpu, Download, FileCode2, Hand, Image as ImageIcon, ImageUp, Lightbulb, Music, Play, Plus, Power, RotateCcw, Save, Send, SlidersHorizontal, Trash2, Upload, Volume2, VolumeX, Zap } from "lucide-react";
import { ListSearch } from "@/components/list-filter-bar";
import { PageHeader } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { CheckField, DialogActions, Field, Modal, Panel } from "@/features/kfid/ui";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { DeviceDrawing, DeviceThumb, StandardPicture, type DeviceTouch } from "@/features/plc-simulator/surface/device-drawings";
import { SurfaceDefs } from "@/features/plc-simulator/surface/parts";
import { previewSound, useDeviceSounds } from "@/features/plc-simulator/surface/sound-player";
import { usePreference } from "@/features/plc-simulator/surface/surface-preferences";
import { animationText, missingParts, parseAnimation, standardAnimation, STATES, type AnimationSpec } from "@/lib/machine/simulator/surface/animation";
import { SOUND_LABELS, STANDARD_SOUNDS } from "@/lib/machine/simulator/surface/sounds";
import type { DeviceEditorItem } from "@/lib/machine/simulator/device-designs-server";
import {
  cleanImage, cleanSound, DESIGN_OPTION, designedDef, DEVICE_FILE_FORMAT, DEVICE_FILE_VERSION, exportDevices, functionTerminals, isCustomKey, MAX_TERMINALS, nextExtraId, parseDeviceFile, requiredTerminals, ROLE_LABELS,
  pictureParts, readoutFor, splitForImport, STATE_VIEW_LABELS, STATE_VIEWS, TERMINAL_PRESETS, terminalMarking, terminalProblems, validateDesign,
  MAX_SOUND_BYTES, type DesignImage, type DesignSound, type DesignTerminal, type DeviceDesign, type ImportedDevice, settableOptions } from "@/lib/machine/simulator/surface/device-designs";
import { DEVICE_DEFS, DEVICE_GROUPS, DEVICE_KINDS, GROUP_LABELS, deviceMatches, isExtraTerminal, isLatching, optionValue, SENSOR_RANGES, TERMINAL_ROLES, terminalName, type DeviceKindId } from "@/lib/machine/simulator/surface/devices";
import { READOUT_CHOICES, READOUT_SIDE_LABELS, READOUT_SIDES, readoutFrame, SETPOINTS, type Readout, type ReadoutValue } from "@/lib/machine/simulator/surface/readouts";

const READOUT_VALUE_LABELS: Record<ReadoutValue, string> = { reading: "Mätvärde", knob: "Vredets spänning", volts: "Spänning", speed: "Fart", drive: "Styrning", position: "Läge", setpoint: "Börvärde", out: "Utgång (ÄV)", flow: "Framledning (ÄV)", oven: "Ugnstemperatur (ÄV)", supplyAir: "Tilluft (ÄV)" };
import { contactClosed, createDeviceState, type DeviceState, type Plant } from "@/lib/machine/simulator/surface/engine";
import { deviceTerminalPoint, labelPlace, nameLines } from "@/lib/machine/simulator/surface/geometry";
import { createHeatingState, createVentilationState } from "@/lib/machine/simulator/process-models";
import type { DeviceInst } from "@/lib/machine/simulator/surface/layout";
import { useLoadEffect } from "@/lib/use-load-effect";
import { cn } from "@/lib/utils";
import { DEVICE_FORMAT_GUIDE } from "./format-guide";

type Notify = (text: string, error?: boolean) => void;
type View = { items: DeviceEditorItem[] };
const PREVIEW_PLANT: Plant = { tank: 40, ovenC: 20, vent: createVentilationState(21), heat: createHeatingState(21), outdoorC: 5, doorOpen: false };

/** What the editor starts from for an item: its draft, else what is published, else the standard device. */
const startOf = (item: DeviceEditorItem): DeviceDesign => item.draft ?? item.published ?? item.standardDesign!;
const shown = (item: DeviceEditorItem) => item.published ?? item.standardDesign;
/** Utkast, Egen or Ändrad; null is "Standard": the simulator's own device, or the library's original untouched (2026-11-09: "Dessa ska vara originalbilderna"). */
const statusOf = (item: DeviceEditorItem) => (item.draft ? { text: "Utkast", tone: "warning" as const } : item.original ? null : !item.standard && !item.library ? { text: "Egen", tone: "info" as const } : item.published ? { text: "Ändrad", tone: "success" as const } : null);
/** A copy of one's own is removed; a standard device or one from the library goes back to its standard. */
const removable = (item: DeviceEditorItem) => isCustomKey(item.key) && !item.library;
const FUNCTION_LABEL = (kind: DeviceKindId) => DEVICE_DEFS[kind].label;

function download(name: string, text: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const readFile = (file: File, as: "text" | "dataUrl") => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error("Filen gick inte att läsa."));
  if (as === "text") reader.readAsText(file); else reader.readAsDataURL(file);
});

/**
 * PLC-apparater (2026-11-06: "en funktion i prodadmin där jag som superadmin kan redigera dessa symboler och själv bestämma
 * typ/anslutning/bild … inte överdrivet avancerad"): the list of the simulator's devices, and for the chosen one its names, group,
 * picture, how the state shows and where the terminals sit – dragged on the preview or set in the list. The function is one of the
 * simulator's own; a standard device keeps its own, a copy can choose. Spara som utkast, Publicera, Återställ, Kopiera, and the
 * file format for import and export (`hintek-plc-device`). Superadmin only; the server checks every call.
 */
export function PlcDevicesPage({ notify }: { notify: Notify }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string>("knapp");
  const [design, setDesign] = useState<DeviceDesign | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [animationBroken, setAnimationBroken] = useState(false);
  const [copyFunction, setCopyFunction] = useState<DeviceKindId | "">("");
  const [importOpen, setImportOpen] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [search, setSearch] = useState("");
  /** Bild, Animering and Ljud are folded to a line; one is open at a time. */
  const [openCard, setOpenCard] = useState<"bild" | "animering" | "ljud" | null>(null);
  /** Another device asked for while this one has unsaved changes: Spara utkast, Släng ändringarna or Avbryt. */
  const [pending, setPending] = useState<string | null>(null);
  const [ask, confirmDialog] = useConfirm();

  const open = useCallback((next: View, key: string) => {
    const item = next.items.find((entry) => entry.key === key) ?? next.items[0]!;
    setView(next); setSelected(item.key); setDesign(startOf(item)); setDirty(false); setCopyFunction(""); setAnimationBroken(false);
  }, []);
  const load = useCallback(async () => {
    try { open(await api<View>("/api/superadmin/plc-devices", { cache: "no-store" }), "knapp"); } catch (cause) { setError((cause as Error).message); }
  }, [open]);
  useLoadEffect(load);

  const item = view?.items.find((entry) => entry.key === selected) ?? null;
  const check = useMemo(() => (design && item ? validateDesign(item.key, design) : null), [design, item]);
  const change = (patch: Partial<DeviceDesign>) => { setDesign((current) => (current ? { ...current, ...patch } : current)); setDirty(true); };

  // One device at a time (2026-11-07: "Växla bara och redigera bara en apparat i taget"): the list only switches what the one
  // editor shows; unsaved changes are asked about first.
  const choose = (key: string) => {
    if (!view || key === selected) return;
    if (dirty) { setPending(key); return; }
    open(view, key);
  };
  const post = async (body: Record<string, unknown>, done: string, keep = selected) => {
    setBusy(true); setError("");
    try {
      const result = await api<View | { key?: string; view: View }>("/api/superadmin/plc-devices", { method: "POST", body: JSON.stringify(body) });
      const next = "items" in result ? result : result.view;
      open(next, "key" in result && result.key ? result.key : keep);
      notify(done);
      return true;
    } catch (cause) { setError((cause as Error).message); notify((cause as Error).message, true); return false; } finally { setBusy(false); }
  };
  const save = () => item && design && post({ action: "save", key: item.key, revision: item.revision, design }, "Utkastet är sparat.");
  const publish = async () => {
    if (!item) return;
    if (!(await ask({ title: "Publicera apparaten?", message: "Alla simulatorer, också demon, ritar apparaten så här från och med nu.", confirmLabel: "Publicera" }))) return;
    await post({ action: "publish", key: item.key, revision: item.revision }, "Apparaten är publicerad.");
  };
  const reset = async () => {
    if (!item) return;
    const copy = removable(item);
    if (!(await ask({ title: copy ? "Ta bort apparaten?" : "Återställ till standard?", message: copy ? "Den försvinner ur paletten. En apparat som redan står i en ritning ritas som sin funktions vanliga apparat." : item.library ? "Bilden, animeringen, ljudet, namnen och plintarna går tillbaka till standardbibliotekets original." : "Bilden, animeringen, ljudet, namnen och plintarna går tillbaka till simulatorns egna.", confirmLabel: copy ? "Ta bort" : "Återställ", tone: "danger" }))) return;
    await post({ action: "reset", key: item.key, revision: item.revision }, copy ? "Apparaten är borttagen." : "Apparaten är återställd.", copy ? "knapp" : item.key);
  };
  // Publicera alla utkast (2026-11-09, the photo library comes in as 35 drafts at once): every draft published in turn, one confirmation.
  const drafts = view?.items.filter((entry) => entry.draft) ?? [];
  const publishAll = async () => {
    if (!view || !drafts.length) return;
    if (!(await ask({ title: `Publicera ${drafts.length} utkast?`, message: "Alla simulatorer, också demon, ritar apparaterna så här från och med nu.", confirmLabel: "Publicera alla" }))) return;
    setBusy(true); setError("");
    let done = 0;
    try {
      let current = view;
      for (const entry of drafts) {
        const fresh = current.items.find((candidate) => candidate.key === entry.key);
        if (!fresh?.draft) continue;
        const result = await api<View | { key?: string; view: View }>("/api/superadmin/plc-devices", { method: "POST", body: JSON.stringify({ action: "publish", key: fresh.key, revision: fresh.revision }) });
        current = "items" in result ? result : result.view;
        done += 1;
      }
      open(current, selected);
      notify(`${done} apparater är publicerade.`);
    } catch (cause) { setError((cause as Error).message); notify(`${done} publicerade, sedan: ${(cause as Error).message}`, true); void load(); } finally { setBusy(false); }
  };
  const copy = () => item && post({ action: "copy", key: item.key, function: copyFunction || null }, "Kopian är skapad som utkast.");
  const exportOne = () => item && design && download(`plc-apparat-${item.key}.json`, JSON.stringify(exportDevices([{ key: item.key, design }], DEVICE_FORMAT_GUIDE), null, 2));
  // Exportera alla: every device as the editor shows it (the draft, else what is published, else the standard), pictures included.
  const exportAll = () => {
    if (!view) return;
    const devices = view.items.map((entry) => ({ key: entry.key, design: startOf(entry) }));
    download("plc-apparater.json", JSON.stringify(exportDevices(devices, DEVICE_FORMAT_GUIDE), null, 2));
    notify(`${devices.length} apparater är exporterade.`);
  };
  const copyGuide = () => { void navigator.clipboard?.writeText(DEVICE_FORMAT_GUIDE).then(() => notify("Instruktionen är kopierad. Klistra in den hos ett AI-system och be om de apparater du vill ha."), () => notify("Texten gick inte att kopiera. Öppna Visa format och markera den.", true)); };

  const pickImage = async (field: "image" | "imageOn", file: File | undefined) => {
    if (!file) return;
    try {
      const svg = /svg/i.test(file.type) || /\.svg$/i.test(file.name);
      const raw: DesignImage = svg ? { format: "svg", data: await readFile(file, "text") } : { format: "png", data: await readFile(file, "dataUrl") };
      const cleaned = cleanImage(raw);
      if (!cleaned.ok) { notify(cleaned.reason, true); return; }
      change({ [field]: cleaned.image } as Partial<DeviceDesign>);
    } catch (cause) { notify((cause as Error).message, true); }
  };
  const pickSound = async (file: File | undefined) => {
    if (!file) return;
    const format = /\.ogg$|ogg/i.test(`${file.name} ${file.type}`) ? "ogg" : /\.wav$|wav/i.test(`${file.name} ${file.type}`) ? "wav" : /\.mp3$|mpeg/i.test(`${file.name} ${file.type}`) ? "mp3" : null;
    if (!format) { notify("Välj ett ljud i MP3, OGG eller WAV.", true); return; }
    try {
      const cleaned = cleanSound({ format, data: await readFile(file, "dataUrl") });
      if (!cleaned.ok) { notify(cleaned.reason, true); return; }
      change({ sound: cleaned.sound, silent: false });
    } catch (cause) { notify((cause as Error).message, true); }
  };

  if (error && !view) return <div className="space-y-5"><PageHeader title="PLC-apparater" /><p role="alert" className="notice text-destructive">{error}</p></div>;
  if (!view || !item || !design) return <div className="space-y-5"><PageHeader title="PLC-apparater" /><p className="text-sm text-muted-foreground">Hämtar…</p></div>;
  const status = statusOf(item);
  const customKey = isCustomKey(item.key) ? item.key : null;
  const removes = removable(item);
  const saveReason = busy ? null : !dirty ? "Inget är ändrat." : animationBroken ? "Rätta animeringen först." : check && !check.ok ? check.reason : null;

  return <div className="space-y-5" data-testid="plc-devices">
    {confirmDialog}
    <PageHeader title="PLC-apparater" description="Bild, plintar, animering och ljud för apparaterna i PLC-simulatorn."
      actions={<div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => setNewOpen(true)} data-testid="plc-devices-new"><Plus />Ny apparat</Button>
        <Button type="button" variant="outline" onClick={() => setImportOpen(true)} data-testid="plc-devices-import"><Upload />Importera</Button>
        <Button type="button" variant="outline" onClick={exportAll} data-testid="plc-devices-export-all"><Download />Exportera alla</Button>
        <Button type="button" variant="outline" disabled={busy || !drafts.length} disabledReason={drafts.length ? null : "Det finns inga utkast att publicera."} onClick={() => void publishAll()} data-testid="plc-devices-publish-all"><Send />Publicera alla utkast{drafts.length ? ` (${drafts.length})` : ""}</Button>
        <Button type="button" variant="ghost" onClick={() => setFormatOpen(true)} data-testid="plc-devices-format"><FileCode2 />Visa format</Button>
      </div>} />
    {error ? <p role="alert" className="notice text-destructive">{error}</p> : null}
    {/* 2026-11-07: "Gör redigeringen mer kompakt … ser inte ändringarna": the preview (Prova) stays in view – a sticky column
        on the right from 1280 px, a sticky strip on top below that – while the compact editing scrolls; one device at a time. */}
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] [@media(min-width:1440px)]:grid-cols-[minmax(0,13.5rem)_minmax(0,1fr)_minmax(0,24rem)]">
      {/* The device list as before (2026-11-07: "Jag gillade listan med apparaterna som innan"): a column from 1440 px that only
          switches what the one editor shows; narrower, the picker in the editor's top card does the same. */}
      <aside className="hidden min-w-0 [@media(min-width:1440px)]:sticky [@media(min-width:1440px)]:top-20 [@media(min-width:1440px)]:col-start-1 [@media(min-width:1440px)]:row-start-1 [@media(min-width:1440px)]:block" data-testid="plc-devices-tiles">
        <Panel title="Apparater" icon={LayoutGrid}>
          <div className="space-y-2">
            <ListSearch label="Sök apparat" placeholder="Sök" value={search} onChange={setSearch} testId="plc-devices-tile-search" />
            <div className="max-h-[calc(100vh-13rem)] space-y-3 overflow-y-auto pr-1">
              {DEVICE_GROUPS.map((group) => {
                const items = view.items.filter((entry) => { const look = shown(entry) ?? entry.draft; return look?.group === group && deviceMatches({ ...DEVICE_DEFS[look.function], name: look.name, label: look.label, short: look.short }, search); });
                if (!items.length) return null;
                return <section key={group}>
                  <p className="mb-1 text-xs font-semibold text-muted-foreground">{GROUP_LABELS[group]}</p>
                  <div className="grid grid-cols-2 gap-1">
                    {items.map((entry) => {
                      const look = shown(entry) ?? entry.draft!;
                      const tag = statusOf(entry);
                      const options: Record<string, string> = isCustomKey(entry.key) ? { [DESIGN_OPTION]: entry.key } : {};
                      return <button key={entry.key} type="button" onClick={() => choose(entry.key)} aria-pressed={entry.key === selected} data-testid="plc-devices-tile" data-key={entry.key}
                        className={cn("flex min-w-0 flex-col items-center gap-0.5 rounded-lg border bg-card p-1 text-center text-xs transition-colors hover:bg-secondary/60", entry.key === selected && "border-primary bg-primary/5")}>
                        <span className="rounded-md bg-[#0b1220] px-1"><DeviceThumb kind={look.function} options={options} className="h-9 w-11" design={entry.published ?? (entry.draft && !entry.published && isCustomKey(entry.key) ? entry.draft : null)} /></span>
                        <span className="line-clamp-2 w-full font-medium leading-tight">{look.name}</span>
                        <span className={cn("rounded-full border px-1.5 text-[10px]", tag ? indicatorBadge(tag.tone) : "invisible")}>{tag?.text ?? "Standard"}</span>
                      </button>;
                    })}
                  </div>
                </section>;
              })}
            </div>
          </div>
        </Panel>
      </aside>
      <div className="min-w-0 md:sticky md:top-12 md:z-20 xl:top-20 xl:col-start-2 xl:row-start-1 [@media(min-width:1440px)]:col-start-3" data-testid="plc-devices-sticky">
        <TryPanel key={`try:${item.key}:${design.function}`} kind={design.function} design={design} customKey={customKey}
          onMove={(id, side, at) => change({ terminals: design.terminals.map((terminal) => (terminal.id === id ? { ...terminal, side, at } : terminal)) })} />
      </div>

      <div className="min-w-0 space-y-4 xl:col-start-1 xl:row-start-1 [@media(min-width:1440px)]:col-start-2" data-testid="plc-devices-editor">
        <Panel title={design.label} icon={Cpu} description={`${status ? `${status.text}. ` : ""}${item.library ? "Original i standardbiblioteket" : item.standard ? "Standardapparat" : "Egen apparat"}${dirty ? ", ändrad men inte sparad" : ""}.`}
          actions={<div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => void reset()} data-testid="plc-devices-reset">{removes ? <><Trash2 />Ta bort</> : <><RotateCcw />Återställ</>}</Button>
            <Button type="button" variant="outline" disabled={busy || !dirty} disabledReason={saveReason} onClick={() => void save()} data-testid="plc-devices-save"><Save />Spara utkast</Button>
            <Button type="button" disabled={busy} disabledReason={dirty ? "Spara utkastet först." : !item.draft ? "Det finns inget utkast att publicera." : null} onClick={() => void publish()} data-testid="plc-devices-publish"><Send />Publicera</Button>
          </div>}>
          <div className="space-y-3" data-testid="plc-devices-list">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] [@media(min-width:1440px)]:hidden">
              <ListSearch label="Sök apparat" placeholder="Sök apparat" value={search} onChange={setSearch} testId="plc-devices-search" />
              <select className="form-select min-w-0" aria-label="Apparat som visas" value={selected} onChange={(event) => choose(event.target.value)} data-testid="plc-devices-picker">
                {DEVICE_GROUPS.map((group) => {
                  const items = view.items.filter((entry) => { const look = shown(entry) ?? entry.draft; return look?.group === group && (entry.key === selected || deviceMatches({ ...DEVICE_DEFS[look.function], name: look.name, label: look.label, short: look.short }, search)); });
                  return items.length ? <optgroup key={group} label={GROUP_LABELS[group]}>
                    {items.map((entry) => { const look = shown(entry) ?? entry.draft!; const tag = statusOf(entry); return <option key={entry.key} value={entry.key} data-testid="plc-devices-item" data-key={entry.key}>{look.name}{tag ? ` · ${tag.text}` : ""}</option>; })}
                  </optgroup> : null;
                })}
              </select>
            </div>
            <div data-testid="plc-devices-status" className="min-h-5">
              {check && !check.ok ? <p role="alert" className="notice text-sm">{check.reason}</p>
                : <p className="text-sm text-muted-foreground">{item.draft || dirty ? "Simulatorn ritar apparaten som förut tills du publicerar." : item.original ? "Originalet ur standardbiblioteket. Simulatorn ritar apparaten så här." : item.published || !item.standard ? "Simulatorn ritar apparaten så här." : "Simulatorns egen apparat. Ändra och spara ett utkast, publicera när du är nöjd."}</p>}
            </div>
          </div>
        </Panel>

        <Panel title="Apparat" icon={SlidersHorizontal} description="Namn, kategori och funktion."
          actions={<div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={exportOne} data-testid="plc-devices-export"><Download />Exportera</Button></div>}>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
              <Field id="plc-device-name" label="Kort namn (paletten)" value={design.name} onChange={(name) => change({ name })} />
              <Field id="plc-device-label" label="Namn" value={design.label} onChange={(label) => change({ label })} />
              <Field id="plc-device-group" label="Kategori" value={design.group} options={[...DEVICE_GROUPS]} optionLabels={GROUP_LABELS} onChange={(group) => change({ group: group as DeviceDesign["group"] })} />
              <Field id="plc-device-function" label="Funktion" value={design.function} options={[...DEVICE_KINDS]} optionLabels={Object.fromEntries(DEVICE_KINDS.map((kind) => [kind, FUNCTION_LABEL(kind)]))}
                disabled={item.standard} help={item.standard ? "Standardapparat: kopiera för en annan funktion." : undefined}
                onChange={(fn) => change({ function: fn as DeviceKindId, terminals: withFunction(fn as DeviceKindId, design.terminals) })} />
              <Field id="plc-device-short" label="Beskrivning" value={design.short} className="sm:col-span-2 2xl:col-span-4" onChange={(short) => change({ short })} />
            </div>
            {(READOUT_CHOICES[design.function] ?? []).length ? <div className="flex flex-wrap items-end gap-x-4 gap-y-2 border-t pt-3" data-testid="plc-devices-readout">
              <Field id="plc-device-readout-side" label="Värdeetikett" value={readoutFor(design.function, design).side} options={[...READOUT_SIDES]} optionLabels={READOUT_SIDE_LABELS} className="min-w-[10rem]"
                onChange={(side) => change({ readout: { ...readoutFor(design.function, design), side: side as Readout["side"] } })} />
              {(READOUT_CHOICES[design.function] ?? []).map((value) => {
                const current = readoutFor(design.function, design);
                return <CheckField key={value} id={`plc-device-readout-${value}`} label={READOUT_VALUE_LABELS[value]} checked={current.values.includes(value)} className="self-center"
                  onChange={(on) => change({ readout: { ...current, values: (READOUT_CHOICES[design.function] ?? []).filter((candidate) => (candidate === value ? on : current.values.includes(candidate))) } })} />;
              })}
            </div> : null}
            <div className="flex flex-wrap items-end gap-x-4 gap-y-2 border-t pt-3">
              <CheckField id="plc-device-hidden" label="Dölj i paletten" checked={design.hidden} onChange={(hidden) => change({ hidden })} testId="plc-devices-hidden" className="mr-auto self-center" />
              <Field id="plc-device-copy-function" label="Kopiera som ny, med funktionen" value={copyFunction} options={["", ...DEVICE_KINDS]} optionLabels={{ "": "Samma funktion", ...Object.fromEntries(DEVICE_KINDS.map((kind) => [kind, FUNCTION_LABEL(kind)])) }} onChange={(fn) => setCopyFunction(fn as DeviceKindId | "")} className="min-w-[13rem]" />
              <Button type="button" variant="outline" disabled={busy} disabledReason={dirty ? "Spara utkastet först." : null} onClick={() => void copy()} data-testid="plc-devices-copy"><Copy />Kopiera</Button>
            </div>
          </div>
        </Panel>

        <Panel title="Anslutningar" icon={Cable} description="En rad per plint.">
          <TerminalEditor kind={design.function} terminals={design.terminals} onChange={(terminals) => change({ terminals })} />
        </Panel>

        <Panel title="Bild" icon={ImageIcon} description="Standardbilden eller en egen SVG eller PNG." collapsible collapsed={openCard !== "bild"} onCollapsedChange={(folded) => setOpenCard(folded ? null : "bild")}
          foldedContent={<p className="px-4 pb-3 text-sm text-muted-foreground" data-testid="plc-devices-image-summary">{design.image ? `Egen bild (${design.image.format.toUpperCase()}).` : `Standardbild: ${DEVICE_DEFS[design.function].label}.`}</p>}>
          <div className="grid gap-4 sm:grid-cols-2">
            <PictureField label="Bild" image={design.image} fallback={design.function} customKey={customKey} testId="plc-devices-image" notify={notify}
              onPick={(file) => void pickImage("image", file)} onReset={() => change({ image: null, ...(design.stateView === "swap" ? { stateView: "none" as const } : {}) })} />
            <Field id="plc-device-state" label="Extra effekt för en egen bild" value={design.stateView} options={[...STATE_VIEWS]} optionLabels={STATE_VIEW_LABELS} onChange={(stateView) => change({ stateView: stateView as DeviceDesign["stateView"] })}
              help="Rörelser styrs under Animering." />
            {design.stateView === "swap" ? <PictureField label="Bild när apparaten är på" image={design.imageOn} fallback={null} customKey={null} testId="plc-devices-image-on" notify={notify} onPick={(file) => void pickImage("imageOn", file)} onReset={() => change({ imageOn: null })} /> : null}
          </div>
        </Panel>

        <AnimationCard key={`animation:${item.key}:${item.revision}:${design.function}`} kind={design.function} design={design} onOpenFormat={() => setFormatOpen(true)}
          collapsed={openCard !== "animering"} onCollapsedChange={(folded) => setOpenCard(folded ? null : "animering")}
          onChange={(animation) => change({ animation })} onBroken={(broken) => { setAnimationBroken(broken); if (broken) setDirty(true); }} />

        <Panel title="Ljud" icon={Volume2} description="Standardljudet, ett eget ljud eller tyst." collapsible collapsed={openCard !== "ljud"} onCollapsedChange={(folded) => setOpenCard(folded ? null : "ljud")}
          foldedContent={<p className="px-4 pb-3 text-sm text-muted-foreground" data-testid="plc-devices-sound-summary">{soundSummary(design)}</p>}>
          <SoundField kind={design.function} sound={design.sound} silent={design.silent} onPick={(file) => void pickSound(file)} onChange={(patch) => change(patch)} />
        </Panel>
      </div>
    </div>
    {importOpen ? <ImportDialog view={view} onClose={() => setImportOpen(false)} onImported={(next, key) => { setImportOpen(false); open(next, key); notify("Importen är sparad som utkast."); }} /> : null}
    {newOpen ? <NewDeviceDialog busy={busy} onClose={() => setNewOpen(false)} onCreate={async (fn, name) => { if (await post({ action: "create", function: fn, name }, "Apparaten är skapad som utkast.")) setNewOpen(false); }} /> : null}
    {pending ? <Modal open onOpenChange={(value) => { if (!value) setPending(null); }} title="Spara ändringarna först?">
      <p className="text-sm" data-testid="plc-devices-switch-dialog">{design.label} har ändringar som inte är sparade. Bara en apparat är öppen åt gången.</p>
      <DialogActions cancel={{ label: "Avbryt", onClick: () => setPending(null) }}
        primary={{ label: "Spara utkast", icon: <Save />, busy, busyLabel: "Sparar…", disabledReason: saveReason, testId: "plc-devices-switch-save", onClick: () => { const next = pending; setPending(null); if (item && design) void post({ action: "save", key: item.key, revision: item.revision, design }, "Utkastet är sparat.", next); } }}>
        <Button type="button" variant="outline" onClick={() => { const next = pending; setPending(null); open(view, next); }} data-testid="plc-devices-switch-discard"><Trash2 />Släng ändringarna</Button>
      </DialogActions>
    </Modal> : null}
    <Modal open={formatOpen} onOpenChange={setFormatOpen} title="Filformatet" size="view">
      <div className="space-y-3 text-sm" data-testid="plc-devices-format-text">
        <p>Filen heter <code>{DEVICE_FILE_FORMAT}</code> version {DEVICE_FILE_VERSION}. Äldre versioner går också att importera. Texten följer också med överst i varje exporterad fil, så att filen ensam räcker för ett annat AI-system.</p>
        <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 text-xs">{DEVICE_FORMAT_GUIDE}</pre>
      </div>
      <DialogActions cancel={{ label: "Stäng", onClick: () => setFormatOpen(false) }} primary={{ label: "Kopiera texten", icon: <Copy />, onClick: copyGuide }} />
    </Modal>
  </div>;
}

/** Ny apparat: a function and a name; it starts as that function's standard device, as a draft of its own. */
function NewDeviceDialog({ busy, onClose, onCreate }: { busy: boolean; onClose: () => void; onCreate: (fn: DeviceKindId, name: string) => Promise<void> }) {
  const [fn, setFn] = useState<DeviceKindId>("rela");
  const [name, setName] = useState("");
  return <Modal open onOpenChange={(value) => { if (!value) onClose(); }} title="Ny apparat">
    <div className="grid gap-4" data-testid="plc-devices-new-dialog">
      <Field id="plc-new-function" label="Funktion" value={fn} options={[...DEVICE_KINDS]} optionLabels={Object.fromEntries(DEVICE_KINDS.map((kind) => [kind, FUNCTION_LABEL(kind)]))} onChange={(value) => setFn(value as DeviceKindId)}
        help="Hur den fungerar elektriskt. Bild, plintar, animering och ljud ändrar du sedan." />
      <Field id="plc-new-name" label="Namn" value={name} placeholder={`Ny ${FUNCTION_LABEL(fn).toLowerCase()}`} onChange={setName} />
    </div>
    <DialogActions cancel={{ label: "Avbryt", onClick: onClose }} primary={{ label: "Skapa", busy, busyLabel: "Skapar…", onClick: () => void onCreate(fn, name), testId: "plc-devices-new-submit" }} />
  </Modal>;
}

/** The state a device is tried from: at rest, with a sensor's signal and a knob in the middle; only the fixed supply has its 24 V. */
const restState = (kind: DeviceKindId): DeviceState => ({ ...createDeviceState(), outV: 5, value: 50, volts: kind === "kalla24" ? 24 : null });
const SPINS = new Set<DeviceKindId>(["motor", "tilluftsflakt", "franluftsflakt", "cirkpump"]);
/** A sensor's measured value set by hand: the plant field it reads, put where the signal says (0–10 V over its range). */
function plantFor(kind: DeviceKindId, outV: number | null, supplyC: number): Plant {
  const plant: Plant = { ...PREVIEW_PLANT, vent: { ...PREVIEW_PLANT.vent, supplyC }, heat: { ...PREVIEW_PLANT.heat } };
  const range = SENSOR_RANGES[kind];
  if (!range || outV === null) return plant;
  const value = range.low + (outV / 10) * (range.high - range.low);
  switch (range.reads) {
    case "tank": plant.tank = value; break;
    case "oven": plant.ovenC = value; break;
    case "supply": plant.vent.supplyC = value; break;
    case "extract": plant.vent.extractC = value; break;
    case "outdoor": plant.outdoorC = value; break;
    case "room": plant.heat.roomC = value; break;
    case "flow": plant.heat.flowC = value; break;
    case "filter": plant.vent.filterPa = value; break;
  }
  return plant;
}

/**
 * Prova (2026-11-07: "Tillåt så man kan simulera knappen … Vissa apparater går fortfarande inte att simulera"): the device on its
 * plate, worked as in the simulator – press and hold, flip, turn, put voltage on the coil or the load, steer it, run it at a speed, feed
 * a sensor and set what it measures, set a guard's limit on its value tag and let it trip – with its animation and sound, and what that
 * does to its contacts. Whatever the device needs from outside in reality (supply, signal, a measured value) is given here by hand.
 */
function TryPanel({ kind, design, customKey, onMove }: { kind: DeviceKindId; design: DeviceDesign; customKey: string | null; onMove: (id: string, side: "top" | "bottom", at: number) => void }) {
  const def = DEVICE_DEFS[kind];
  const [options, setOptions] = useState<Record<string, string>>({});
  const device = useMemo<DeviceInst>(() => ({ id: "preview", kind, x: 0, y: 0, label: "", options: { ...options, ...(customKey ? { [DESIGN_OPTION]: customKey } : {}) } }), [kind, customKey, options]);
  const shown = designedDef(device, design);
  const [state, setState] = useState<DeviceState>(() => restState(kind));
  const [powered, setPowered] = useState(false);
  const [fed, setFed] = useState(true);
  const [supplyC, setSupplyC] = useState(12);
  const [signal, setSignal] = useState(10);
  const [speedSet, setSpeedSet] = useState(100);
  const [sound, chooseSound] = usePreference<"on" | "off">("sound", "on", ["on", "off"]);
  const load = def.elements.find((element) => element.kind === "load");
  const sink = def.elements.some((element) => element.kind === "sink");
  const source = def.elements.find((element) => element.kind === "source");
  const meter = def.elements.some((element) => element.kind === "meter");
  const trips = def.elements.some((element) => element.kind === "contact" && element.when === "tripped");
  const powered3 = source?.kind === "source" && source.plus !== null;
  const drive = load && powered ? (sink ? signal / 10 : SPINS.has(kind) ? speedSet / 100 : 1) : 0;
  // Running up and down, and the damper's travel, step by step as in the simulator.
  const speedTarget = SPINS.has(kind) ? drive : state.speed;
  const positionTarget = kind === "spjall" ? (powered ? 1 : 0) : state.position;
  const moving = Math.abs(state.speed - speedTarget) > 0.001 || Math.abs(state.position - positionTarget) > 0.001;
  useEffect(() => {
    if (!moving) return;
    const timer = window.setTimeout(() => setState((current) => ({
      ...current,
      speed: current.speed + Math.max(-0.04, Math.min(0.04, speedTarget - current.speed)),
      position: current.position + Math.max(-0.03, Math.min(0.03, positionTarget - current.position)),
    })), 50);
    return () => window.clearTimeout(timer);
  }, [moving, state, speedTarget, positionTarget]);
  // A frost guard trips when the supply air is below its limit, as in the simulator; the limit is its setpoint on the value tag.
  const limit = Number(optionValue(def, device.options, "limitC"));
  const tripped = trips ? supplyC < limit : state.tripped;
  const outV = powered3 && !fed ? null : state.outV;
  const live: DeviceState = { ...state, energised: Boolean(load) && powered, drive, tripped, outV, volts: kind === "kallajust" ? (state.value / 100) * 30 : state.volts };
  const plant = useMemo(() => plantFor(kind, outV, supplyC), [kind, outV, supplyC]);
  const states = useMemo(() => ({ preview: live }), [live.energised, live.drive, live.pressed, live.on, live.tripped, live.speed, live.position, live.value, live.outV, live.volts]); // eslint-disable-line react-hooks/exhaustive-deps
  const devices = useMemo(() => [device], [device]);
  useDeviceSounds(sound === "on", devices, states, design);
  const touch = (patch: DeviceTouch | Partial<Pick<DeviceState, "outV" | "volts">>) => setState((current) => ({ ...current, ...patch }));
  const name = (id: string) => terminalName(shown, device.options, id);
  const contacts = def.elements.flatMap((element) => (element.kind === "contact" ? [{ key: element.name, text: `${name(element.a)}–${name(element.b)}`, closed: contactClosed(element, device, live) }] : []));
  const hold = (pressed: boolean) => touch({ pressed });
  return <Panel title="Prova" icon={Play} description="Använd apparaten som i simulatorn."
    actions={<Button type="button" variant="outline" aria-pressed={sound === "on"} onClick={() => chooseSound(sound === "on" ? "off" : "on")} data-testid="plc-devices-try-sound">{sound === "on" ? <><Volume2 />Ljud på</> : <><VolumeX />Ljud av</>}</Button>}>
    <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-3 xl:grid-cols-1" data-testid="plc-devices-try">
      <div className="min-w-0 space-y-2">
        <Preview device={device} design={design} state={live} plant={plant} onTouch={touch} onOption={(key, value) => setOptions((current) => ({ ...current, [key]: value }))} onMove={onMove} />
        <p className="hidden text-xs text-muted-foreground xl:block">Dra en plint för att flytta den. Plattan blir bredare med fler plintar.</p>
      </div>
      <div className="min-w-0 space-y-2 xl:space-y-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Styr apparaten">
          {def.interaction === "momentary" && isLatching(def, device.options) ? <Button type="button" variant="outline" aria-pressed={state.pressed} data-testid="plc-devices-try-latch" onClick={() => hold(!state.pressed)}><Hand />{state.pressed ? "Intryckt (latch) – tryck igen" : "Tryck (latch)"}</Button> : null}
          {def.interaction === "momentary" && !isLatching(def, device.options) ? <Button type="button" variant="outline" aria-pressed={state.pressed} data-testid="plc-devices-try-hold"
            onPointerDown={(event) => { try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Held without capture. */ } hold(true); }} onPointerUp={() => hold(false)} onPointerCancel={() => hold(false)}
            onKeyDown={(event) => { if ((event.key === " " || event.key === "Enter") && !event.repeat) { event.preventDefault(); hold(true); } }} onKeyUp={() => hold(false)}><Hand />Håll inne</Button> : null}
          {def.interaction === "toggle" ? <Button type="button" variant="outline" aria-pressed={state.on} onClick={() => touch({ on: !state.on })} data-testid="plc-devices-try-toggle"><Power />{state.on ? "Till" : "Från"}</Button> : null}
          {powered3 ? <Button type="button" variant="outline" aria-pressed={fed} onClick={() => setFed(!fed)} data-testid="plc-devices-try-feed"><Zap />{fed ? "Matning på" : "Ingen matning"}</Button> : null}
          {load && load.kind === "load" ? <Button type="button" variant="outline" aria-pressed={powered} onClick={() => setPowered(!powered)} data-testid="plc-devices-try-power"><Zap />{powered ? `Spänning på ${name(load.a)}–${name(load.b)}` : `Ingen spänning på ${name(load.a)}–${name(load.b)}`}</Button> : null}
        </div>
        {def.interaction === "knob" ? <Range id="plc-try-knob" label="Vred" value={state.value} max={100} unit="%" onChange={(value) => touch({ value })} /> : null}
        {SPINS.has(kind) && !sink && load ? <Range id="plc-try-speed" label="Fart" value={speedSet} max={100} step={5} unit="%" onChange={setSpeedSet} /> : null}
        {sink && load ? <Range id="plc-try-signal" label="Styrsignal" value={signal} max={10} step={0.5} unit="V" onChange={setSignal} /> : null}
        {source && source.kind === "source" && def.interaction !== "knob" ? <Range id="plc-try-source" label="Mätvärde" value={state.outV ?? 0} max={10} step={0.1} unit="V" onChange={(outV) => touch({ outV })} /> : null}
        {trips ? <Range id="plc-try-supply" label="Tilluftens temperatur" value={supplyC} min={-5} max={20} step={0.5} unit="°C" onChange={setSupplyC} /> : null}
        {meter ? <Range id="plc-try-meter" label="Spänning att mäta" value={state.volts ?? 0} max={30} step={0.5} unit="V" onChange={(volts) => touch({ volts })} /> : null}
        {settableOptions(device, design).filter((option) => option.key !== SETPOINTS[kind]).map((option) => <Field key={option.key} id={`plc-try-option-${option.key}`} label={option.label} value={optionValue(def, device.options, option.key)} options={option.choices.map((choice) => choice.value)} optionLabels={Object.fromEntries(option.choices.map((choice) => [choice.value, choice.label]))} onChange={(value) => setOptions((current) => ({ ...current, [option.key]: value }))} />)}
        {SETPOINTS[kind] ? <p className="text-xs text-muted-foreground">Börvärdet ändrar du på etiketten bredvid apparaten.</p> : null}
        <p className="flex flex-wrap gap-1 xl:hidden" data-testid="plc-devices-try-chips">{contacts.map((contact) => <span key={contact.key} className={cn("rounded-full border px-1.5 text-xs", indicatorBadge(contact.closed ? "success" : "neutral"))}>{contact.text} {contact.closed ? "sluten" : "öppen"}</span>)}</p>
        <ul className="hidden divide-y rounded-lg border text-sm xl:block" data-testid="plc-devices-try-status">
          {contacts.map((contact) => <li key={contact.key} className="flex items-center justify-between gap-2 px-2.5 py-1.5" data-contact={contact.text} data-closed={contact.closed}>
            <span>Kontakt {contact.text}</span><span className={cn("rounded-full border px-1.5 text-xs", indicatorBadge(contact.closed ? "success" : "neutral"))}>{contact.closed ? "Sluten" : "Öppen"}</span></li>)}
          {load && load.kind === "load" ? <li className="flex items-center justify-between gap-2 px-2.5 py-1.5" data-testid="plc-devices-try-load"><span>{name(load.a)}–{name(load.b)}</span><span className={cn("rounded-full border px-1.5 text-xs", indicatorBadge(powered ? "warning" : "neutral"))}>{powered ? "Spänning" : "Ingen spänning"}</span></li> : null}
          {SPINS.has(kind) ? <li className="flex items-center justify-between gap-2 px-2.5 py-1.5"><span>Fart</span><span className="tabular-nums">{Math.round(state.speed * 100)} %</span></li> : null}
          {kind === "spjall" ? <li className="flex items-center justify-between gap-2 px-2.5 py-1.5"><span>Läge</span><span className="tabular-nums">{Math.round(state.position * 100)} % öppet</span></li> : null}
          {source?.kind === "source" ? <li className="flex items-center justify-between gap-2 px-2.5 py-1.5" data-testid="plc-devices-try-signal-out"><span>Signal {name(source.terminal)}</span><span className="tabular-nums">{outV === null ? "ingen matning" : `${outV.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} V`}</span></li> : null}
          {!contacts.length && !load && source?.kind !== "source" ? <li className="px-2.5 py-1.5 text-muted-foreground">Apparaten har inga kontakter att visa.</li> : null}
        </ul>
      </div>
    </div>
  </Panel>;
}

/** A slider with its label above and its value beside it. */
function Range({ id, label, value, min = 0, max, step = 1, unit, onChange }: { id: string; label: string; value: number; min?: number; max: number; step?: number; unit: string; onChange: (value: number) => void }) {
  return <div className="grid gap-1">
    <label htmlFor={id} className="field-label flex justify-between text-xs font-medium"><span>{label}</span><span className="tabular-nums text-muted-foreground">{value.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} {unit}</span></label>
    <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} className="w-full accent-primary" data-testid={id} />
  </div>;
}

/**
 * Animering (2026-11-07: "Animering skall vara i redigerbar kod"): the device's animation as text in the declarative form of
 * animation.ts – checked as you type, the error said where it is, parts the picture lacks warned about, the preview following at once.
 * Återställ standard goes back to the function's own animation, which is itself written in this form.
 */
function AnimationCard({ kind, design, onChange, onBroken, onOpenFormat, collapsed, onCollapsedChange }: { kind: DeviceKindId; design: DeviceDesign; onChange: (animation: AnimationSpec | null) => void; onBroken: (broken: boolean) => void; onOpenFormat: () => void; collapsed: boolean; onCollapsedChange: (collapsed: boolean) => void }) {
  const standard = standardAnimation(kind);
  const [text, setText] = useState(() => animationText(design.animation ?? standard));
  const parsed = useMemo(() => parseAnimation(text), [text]);
  const missing = parsed.ok ? missingParts(parsed.spec, pictureParts(kind, design)) : [];
  const own = design.animation !== null;
  const edit = (next: string) => {
    setText(next);
    const result = parseAnimation(next);
    onBroken(!result.ok);
    if (result.ok) onChange(JSON.stringify(result.spec) === JSON.stringify(standard) ? null : result.spec);
  };
  const reset = () => { setText(animationText(standard)); onBroken(false); onChange(null); };
  const rules = parsed.ok ? parsed.spec.rules.length : null;
  return <Panel title="Animering" icon={Clapperboard} description="Regler för hur bildens delar rör sig." collapsible collapsed={collapsed} onCollapsedChange={onCollapsedChange}
    foldedContent={<p className="px-4 pb-3 text-sm text-muted-foreground" data-testid="plc-devices-animation-summary">{rules === null ? "Animeringen har fel. Öppna och rätta." : `${own ? "Egen" : "Standard"}, ${rules} ${rules === 1 ? "regel" : "regler"}.`}</p>}
    actions={<div className="flex flex-wrap gap-2">
      <Button type="button" variant="ghost" onClick={onOpenFormat}><FileCode2 />Format</Button>
      <Button type="button" variant="outline" disabled={!own && parsed.ok} onClick={reset} data-testid="plc-devices-animation-reset"><RotateCcw />Återställ standard</Button>
    </div>}>
    <div className="space-y-3" data-testid="plc-devices-animation">
      <Field id="plc-device-animation" label="Regler (JSON)" value={text} multiline code onChange={edit}
        help={`Varje regel: "part" (en del av bilden), "when" (${STATES.filter((state) => state !== "always").join(", ")}, eller med "not " före) och vad som händer: "move", "rotate", "scale", "opacity", "fill", "hidden", "blink", "spin" eller "follow". Ingen kod körs.`} />
      {!parsed.ok ? <div role="alert" className="notice text-sm" data-testid="plc-devices-animation-errors"><ul className="list-disc space-y-0.5 pl-5">{parsed.errors.map((line) => <li key={line}>{line}</li>)}</ul></div> : null}
      {missing.length ? <p className="text-xs text-muted-foreground" data-testid="plc-devices-animation-missing">Bilden har ingen del som heter {missing.join(", ")}. Ge delen ett id i SVG-bilden, eller använd &quot;bild&quot; för hela bilden.</p> : null}
      <p className="text-xs text-muted-foreground">Delar i bilden: {pictureParts(kind, design).filter((part, index, all) => all.indexOf(part) === index).join(", ") || "inga namngivna"}; &quot;bild&quot; är hela bilden.</p>
    </div>
  </Panel>;
}

/** A copy that changes its function: the new function's terminals, and the extra terminals kept (a link to a terminal that is gone is dropped). */
function withFunction(kind: DeviceKindId, terminals: readonly DesignTerminal[]): DesignTerminal[] {
  const own = functionTerminals(kind);
  const extras = terminals.filter((terminal) => isExtraTerminal(terminal.id));
  const ids = new Set([...own, ...extras].map((terminal) => terminal.id));
  return [...own, ...extras.map((terminal) => (terminal.joins && !ids.has(terminal.joins) ? { ...terminal, joins: null } : terminal))];
}

/**
 * The picture layer over the base plate (2026-11-07: "bilden skall vara separerad så den som är nu även är en bild som går
 * ersätta"): the simulator's standard picture until an SVG or PNG replaces it; Standardbilden goes back to it. Ladda ner gives the
 * picture as a file – the standard one as an SVG – so it can be changed elsewhere and put back.
 */
/**
 * The sound (2026-11-07), like the picture: the function's standard sound – made in the simulator, nothing recorded – until a
 * short file replaces it; Standardljudet goes back, Tyst silences the device. Lyssna plays it here.
 */
function SoundField({ kind, sound, silent, onPick, onChange }: { kind: DeviceKindId; sound: DesignSound | null; silent: boolean; onPick: (file: File | undefined) => void; onChange: (patch: Partial<DeviceDesign>) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const standard = STANDARD_SOUNDS[kind] ?? null;
  const plays = silent ? null : standard ?? (sound ? "relay" : null);
  const status = silent ? "Tyst." : sound ? `Eget ljud (${sound.format.toUpperCase()}).` : standard ? `Standardljud: ${SOUND_LABELS[standard]}.` : "Funktionen har inget ljud.";
  return <div className="space-y-1.5" data-testid="plc-devices-sound-field">
    <p className="text-sm font-medium">Ljud</p>
    <div className="flex flex-wrap items-center gap-2">
      <input ref={input} type="file" accept=".mp3,audio/mpeg,.ogg,audio/ogg,.wav,audio/wav,audio/x-wav" className="sr-only" data-testid="plc-devices-sound-input" onChange={(event) => { onPick(event.target.files?.[0]); event.target.value = ""; }} />
      <Button type="button" variant="outline" onClick={() => input.current?.click()} data-testid="plc-devices-sound"><Music />{sound ? "Byt ljud" : standard ? "Ersätt ljudet" : "Lägg till ljud"}</Button>
      <Button type="button" variant="ghost" disabled={!plays} onClick={() => plays && previewSound(plays, sound)} data-testid="plc-devices-sound-play"><Volume2 />Lyssna</Button>
      {sound ? <Button type="button" variant="ghost" onClick={() => onChange({ sound: null })} data-testid="plc-devices-sound-reset"><RotateCcw />{standard ? "Standardljudet" : "Ta bort"}</Button> : null}
    </div>
    <p className="text-xs text-muted-foreground" data-testid="plc-devices-sound-status">{status} MP3, OGG eller WAV, högst {MAX_SOUND_BYTES / 1024} kB.</p>
    <CheckField id="plc-device-silent" label="Tyst" description="Apparaten låter inte i simulatorn." checked={silent} onChange={(value) => onChange({ silent: value })} testId="plc-devices-silent" />
  </div>;
}

function PictureField({ label, image, fallback, customKey, testId, notify, onPick, onReset }: {
  label: string; image: DesignImage | null; fallback: DeviceKindId | null; customKey: string | null; testId: string; notify: Notify;
  onPick: (file: File | undefined) => void; onReset: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const standard = useRef<SVGSVGElement>(null);
  const saveFile = () => {
    if (image) {
      if (image.format === "svg") download(`${testId}.svg`, image.data, "image/svg+xml");
      else { const link = document.createElement("a"); link.href = `data:image/png;base64,${image.data}`; link.download = `${testId}.png`; link.click(); }
      return;
    }
    if (!standard.current || !fallback) return;
    const svgText = new XMLSerializer().serializeToString(standard.current).replace(/ data-testid="[^"]*"/g, "").replace(/ class="[^"]*"/g, "").replace(/ data-part="/g, " id=\"");
    const checked = cleanImage({ format: "svg", data: svgText });
    if (!checked.ok) { notify(checked.reason, true); return; }
    download(`standardbild-${fallback}.svg`, checked.image.data, "image/svg+xml");
  };
  const base = fallback ? DEVICE_DEFS[fallback] : null;
  return <div className="space-y-1.5" data-testid={`${testId}-field`}>
    <p className="text-sm font-medium">{label}</p>
    <div className="flex flex-wrap items-center gap-2">
      <input ref={input} type="file" accept=".svg,image/svg+xml,.png,image/png" className="sr-only" data-testid={`${testId}-input`} onChange={(event) => { onPick(event.target.files?.[0]); event.target.value = ""; }} />
      <Button type="button" variant="outline" onClick={() => input.current?.click()} data-testid={testId}><ImageUp />{image ? "Byt bild" : fallback ? "Ersätt bilden" : "Ladda upp bild"}</Button>
      {image || fallback ? <Button type="button" variant="ghost" onClick={saveFile} data-testid={`${testId}-download`}><Download />Ladda ner</Button> : null}
      {image && fallback ? <Button type="button" variant="ghost" onClick={onReset} data-testid={`${testId}-reset`}><RotateCcw />Standardbilden</Button> : null}
      {image && !fallback ? <Button type="button" variant="ghost" onClick={onReset}><Trash2 />Ta bort</Button> : null}
    </div>
    <p className="text-xs text-muted-foreground" data-testid={`${testId}-status`}>{image ? `Egen bild (${image.format.toUpperCase()}).` : base ? `Standardbild: ${base.label}.` : "Ingen bild vald."} SVG högst 200 kB (med fotolager 1 MB), PNG högst 400 kB.</p>
    {base && fallback ? <svg ref={standard} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${base.width} ${base.height}`} width={base.width * 2} height={base.height * 2} className="hidden" aria-hidden="true">
      <SurfaceDefs />
      <StandardPicture kind={fallback} options={customKey ? { [DESIGN_OPTION]: customKey } : {}} />
    </svg> : null}
  </div>;
}

/**
 * Anslutningar (2026-11-07: "sedan väljer man vilka anslutningar det skall vara så dyker redigerbara fönster upp"): the
 * function's terminals, each in use or not – the ones the function needs say so and stay – and extra terminals added from the common
 * markings or as one's own. Each terminal has its card: marking, explanation, side and place; an extra one also its kind and an
 * inner link. What is not allowed is listed above the cards, never left out silently.
 */
function TerminalEditor({ kind, terminals, onChange }: { kind: DeviceKindId; terminals: DesignTerminal[]; onChange: (terminals: DesignTerminal[]) => void }) {
  const fnDef = DEVICE_DEFS[kind];
  const required = requiredTerminals(kind);
  const problems = terminalProblems(kind, terminals);
  const used = terminals.filter((terminal) => terminal.used);
  const nextId = nextExtraId(terminals);
  const full = !nextId || used.length >= MAX_TERMINALS;
  const set = (id: string, patch: Partial<DesignTerminal>) => onChange(terminals.map((terminal) => (terminal.id === id ? { ...terminal, ...patch } : terminal)));
  const add = (name: string, side: "top" | "bottom", role: DesignTerminal["role"]) => { if (nextId) onChange([...terminals, { id: nextId, name, title: "", side, at: null, used: true, role, joins: null }]); };
  const remove = (id: string) => onChange(terminals.filter((terminal) => terminal.id !== id).map((terminal) => (terminal.joins === id ? { ...terminal, joins: null } : terminal)));
  const markings = new Set(used.map((terminal) => terminalMarking(kind, terminal)));
  const neededText = [...required.keys()].map((id) => terminalMarking(kind, terminals.find((terminal) => terminal.id === id) ?? { id, name: "" })).join(", ");
  return <section className="space-y-3" data-testid="plc-devices-terminals">
    <div>
      <p className="text-xs text-muted-foreground">{used.length} plintar. {fnDef.label} behöver {neededText || "minst en hel kontakt"}. Ledningar i sparade ritningar följer plinten.</p>
    </div>
    {problems.length ? <div role="alert" className="notice text-sm" data-testid="plc-devices-terminal-problems"><ul className="list-disc space-y-0.5 pl-5">{problems.map((line) => <li key={line}>{line}</li>)}</ul></div> : null}
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Lägg till plint" data-testid="plc-devices-add-terminal">
      <span className="mr-1 text-xs text-muted-foreground">Lägg till:</span>
      {TERMINAL_PRESETS.filter((preset) => !markings.has(preset.name)).map((preset) => <Button key={preset.name} type="button" size="sm" variant="outline" disabled={full} onClick={() => add(preset.name, preset.side, preset.role)} data-testid="plc-devices-add-preset" data-name={preset.name}><Plus />{preset.name}</Button>)}
      <Button type="button" size="sm" variant="outline" disabled={full} onClick={() => add("", "top", "wire")} data-testid="plc-devices-add-own"><Plus />Egen</Button>
    </div>
    {/* One row per terminal (2026-11-07: "mer kompakt … inte ha scroll här när ändå raden får rum"): columns that share the
        card's width; in a narrow card each row stacks in two columns with its labels. Never a sideways scroll. */}
    <div className="@container overflow-hidden rounded-lg border" data-testid="plc-devices-terminal-table">
      <div className="hidden gap-2 border-b bg-muted/60 px-2 py-1.5 text-xs font-medium text-muted-foreground @min-[40rem]:grid @min-[40rem]:grid-cols-[3.5rem_4.5rem_6rem_4rem_minmax(0,1fr)_6.5rem_5.5rem_2.5rem]">
        <span>Plint</span><span>Märkning</span><span>Sida</span><span>Läge %</span><span>Förklaring</span><span>Sort</span><span>Förbunden</span><span className="text-right">Används</span>
      </div>
      <div className="divide-y">
        {terminals.map((terminal) => {
          const extra = isExtraTerminal(terminal.id);
          const own = fnDef.terminals.find((candidate) => candidate.id === terminal.id);
          const need = required.get(terminal.id);
          const marking = terminalMarking(kind, terminal);
          const links = terminals.filter((other) => other.id !== terminal.id && other.used && other.joins !== terminal.id);
          const off = !terminal.used;
          const cell = (label: string, control: React.ReactNode, wide = false) => <label className={cn("grid min-w-0 gap-0.5", wide && "col-span-2 @min-[40rem]:col-span-1")}><span className="text-[11px] text-muted-foreground @min-[40rem]:sr-only">{label}</span>{control}</label>;
          return <div key={terminal.id} className={cn("grid grid-cols-2 items-end gap-2 px-2 py-2 text-sm @min-[40rem]:grid-cols-[3.5rem_4.5rem_6rem_4rem_minmax(0,1fr)_6.5rem_5.5rem_2.5rem] @min-[40rem]:items-center @min-[40rem]:py-1", off && "bg-muted/40 text-muted-foreground")} data-testid="plc-devices-terminal" data-terminal={terminal.id} title={need ?? undefined}>
            <div className="col-span-2 flex items-center justify-between gap-2 @min-[40rem]:col-span-1 @min-[40rem]:block">
              <span className="font-semibold tabular-nums">{marking || "Ny"}<span className="ml-1 text-[10px] font-normal text-muted-foreground @min-[40rem]:ml-0 @min-[40rem]:block">{extra ? "extra" : need ? "krävs" : "funktionens"}</span></span>
            </div>
            {cell("Märkning", <Input id={`plc-terminal-name-${terminal.id}`} aria-label="Märkning" className="h-8 w-full min-w-0" disabled={off} value={terminal.name} placeholder={typeof own?.name === "string" ? own.name : own ? terminal.id : "t.ex. PE"} onChange={(event) => set(terminal.id, { name: event.target.value.slice(0, 8) })} />)}
            {cell("Sida", <select id={`plc-terminal-side-${terminal.id}`} aria-label="Sida" className="form-select h-8 w-full min-w-0" disabled={off} value={terminal.side} onChange={(event) => set(terminal.id, { side: event.target.value as "top" | "bottom" })}><option value="top">Överst</option><option value="bottom">Nederst</option></select>)}
            {cell("Läge %", <Input id={`plc-terminal-at-${terminal.id}`} aria-label="Läge %" className="h-8 w-full min-w-0" inputMode="numeric" disabled={off} value={terminal.at === null ? "" : String(Math.round(terminal.at * 100))} placeholder="Jämnt"
              onChange={(event) => { const value = event.target.value; const number = Number.parseInt(value, 10); set(terminal.id, { at: value.trim() === "" || !Number.isFinite(number) ? null : Math.min(100, Math.max(0, number)) / 100 }); }} />)}
            {cell("Förklaring", <Input id={`plc-terminal-title-${terminal.id}`} aria-label="Förklaring" className="h-8 w-full min-w-0" disabled={off} value={terminal.title} placeholder={own?.title ?? ""} onChange={(event) => set(terminal.id, { title: event.target.value.slice(0, 60) })} />)}
            {extra ? cell("Sort", <select id={`plc-terminal-role-${terminal.id}`} aria-label="Sort" className="form-select h-8 w-full min-w-0" value={terminal.role ?? "wire"} onChange={(event) => set(terminal.id, { role: event.target.value as DesignTerminal["role"] })}>{TERMINAL_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}</select>)
              : <span className="hidden text-xs text-muted-foreground @min-[40rem]:block">Funktionens</span>}
            {extra ? cell("Förbunden inuti med", <select id={`plc-terminal-joins-${terminal.id}`} aria-label="Förbunden inuti med" className="form-select h-8 w-full min-w-0" value={terminal.joins ?? ""} onChange={(event) => set(terminal.id, { joins: event.target.value || null })}><option value="">Ingen</option>{links.map((other) => <option key={other.id} value={other.id}>{terminalMarking(kind, other) || other.id}</option>)}</select>)
              : <span className="hidden text-xs text-muted-foreground @min-[40rem]:block">–</span>}
            <div className="col-span-2 flex items-center justify-end gap-1.5 text-xs @min-[40rem]:col-span-1">{extra ? null : <span className="@min-[40rem]:sr-only">Används</span>}{extra
              ? <Button type="button" size="icon-sm" variant="ghost" onClick={() => remove(terminal.id)} aria-label={`Ta bort plint ${marking || terminal.id}`} title="Ta bort" data-testid="plc-devices-terminal-remove"><Trash2 /></Button>
              : <Checkbox id={`plc-terminal-used-${terminal.id}`} aria-label={need ? `Används (${need})` : "Används"} checked={terminal.used} disabled={Boolean(need)} onCheckedChange={(value) => set(terminal.id, { used: value === true })} data-testid="plc-devices-terminal-used" />}</div>
          </div>;
        })}
      </div>
    </div>
  </section>;
}

/** The device large, on the simulator's dark sheet, worked by hand as in the simulator; a terminal is dragged along its side or to the other side. */
function Preview({ device, design, state, plant, onTouch, onOption, onMove }: { device: DeviceInst; design: DeviceDesign; state: DeviceState; plant: Plant; onTouch: (change: DeviceTouch) => void; onOption: (key: string, value: string) => void; onMove: (id: string, side: "top" | "bottom", at: number) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const pad = 40;
  // The view holds the plate, its terminals and name, and the value tag beside it, so nothing is cut off.
  const plateDef = designedDef(device, design);
  const tag = readoutFrame(readoutFor(device.kind, design), plateDef, labelPlace(plateDef).y > plateDef.height);
  // The name beside the plate (a device with terminals on both sides, 2026-11-09) is in the view too, never cut.
  const name = labelPlace(plateDef);
  const nameLeft = name.anchor === "end" ? name.x - (Math.max(...nameLines(device.label || plateDef.label, "end").map((line) => line.length)) * 5.6 + 6) - 4 : 0;
  const view = { x: Math.min(-pad, (tag?.x ?? 0) - 8, nameLeft), y: Math.min(-pad, (tag?.y ?? 0) - 8), width: 0, height: 0 };
  view.width = Math.max(plateDef.width + pad, (tag ? tag.x + tag.width : 0) + 8) - view.x;
  view.height = Math.max(plateDef.height + pad, (tag ? tag.y + tag.height : 0) + 8) - view.y;
  const def = designedDef(device, design);
  const toLocal = (event: ReactPointerEvent) => {
    const box = svg.current!.getBoundingClientRect();
    const scale = view.width / box.width;
    return { x: (event.clientX - box.left) * scale + view.x, y: (event.clientY - box.top) * scale + view.y };
  };
  const move = (event: ReactPointerEvent) => {
    if (!dragging) return;
    const point = toLocal(event);
    onMove(dragging, point.y < def.height / 2 ? "top" : "bottom", Math.round(Math.min(1, Math.max(0, point.x / def.width)) * 100) / 100);
  };
  return <div className="flex justify-center rounded-xl bg-[#0b1220] p-3" data-testid="plc-devices-preview" data-width={def.width}>
    <svg ref={svg} viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} className="h-28 w-auto max-w-full touch-none select-none xl:h-56" role="group" aria-label={`Förhandsvisning av ${design.label}`}
      onPointerMove={move} onPointerUp={() => setDragging(null)} onPointerLeave={() => setDragging(null)}>
      <SurfaceDefs />
      <DeviceDrawing device={device} design={design} state={state} plant={plant} selected={false} onPointerDown={() => undefined} onTouch={onTouch} onOption={onOption} />
      {def.terminals.map((terminal) => {
        const point = deviceTerminalPoint(device, terminal.id, design);
        if (!point) return null;
        return <circle key={terminal.id} cx={point.x} cy={point.y} r={7} fill="transparent" stroke={dragging === terminal.id ? "#facc15" : "transparent"} strokeWidth={2} className="cursor-grab" data-testid="plc-devices-handle" data-terminal={terminal.id}
          onPointerDown={(event) => { event.preventDefault(); (event.target as Element).setPointerCapture?.(event.pointerId); setDragging(terminal.id); }} />;
      })}
    </svg>
  </div>;
}

/**
 * Importera: a file or pasted text with one device or all of them, checked here as the server will and shown before anything is saved
 * – which are new and which replace a device – and each becomes a draft. Many devices go to the server in parts.
 */
function ImportDialog({ view, onClose, onImported }: { view: View; onClose: () => void; onImported: (next: View, key: string) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");
  const [serverError, setServerError] = useState("");
  const [choices, setChoices] = useState<Record<number, "replace" | "new">>({});
  const parsed = useMemo(() => (text.trim() ? parseDeviceFile(text) : null), [text]);
  const existing = (device: ImportedDevice) => Boolean(device.key && view.items.some((entry) => entry.key === device.key && (entry.standard || entry.published || entry.draft)));
  const choiceOf = (device: ImportedDevice, index: number) => (existing(device) ? choices[index] ?? "replace" : "new");
  const devices = parsed?.ok ? parsed.devices : [];
  const replaced = devices.filter((device, index) => choiceOf(device, index) === "replace").length;
  const conflicts = devices.filter(existing).length;
  const setAll = (value: "replace" | "new") => setChoices(Object.fromEntries(devices.map((_, index) => [index, value])));
  const large = text.length > 200_000;
  const run = async () => {
    if (!parsed?.ok) return;
    setServerError("");
    const parts = splitForImport(parsed.devices);
    let last: { keys: string[]; view: View } | null = null;
    const keys: string[] = [];
    try {
      for (const [number, part] of parts.entries()) {
        setBusy(parts.length > 1 ? `Importerar ${number + 1} av ${parts.length}…` : "Importerar…");
        last = await api<{ keys: string[]; view: View }>("/api/superadmin/plc-devices", { method: "POST", body: JSON.stringify({ action: "import", text: part.text, choices: part.indexes.map((index) => choiceOf(parsed.devices[index]!, index)) }) });
        keys.push(...last.keys);
      }
      if (last) onImported(last.view, keys[0] ?? "knapp");
    } catch (cause) {
      setServerError(keys.length ? `${(cause as Error).message} ${keys.length} av ${parsed.devices.length} apparater hann importeras som utkast.` : (cause as Error).message);
    } finally { setBusy(""); }
  };
  return <Modal open onOpenChange={(value) => { if (!value) onClose(); }} title="Importera apparater" size="view">
    <div className="space-y-3" data-testid="plc-devices-import-dialog">
      <p className="text-sm">Välj en fil i formatet {DEVICE_FILE_FORMAT}, med en apparat eller alla, eller klistra in texten. Inget sparas förrän du trycker Importera, och allt blir utkast.</p>
      <input type="file" accept=".json,application/json" data-testid="plc-devices-import-file" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readFile(file, "text").then(setText); }} />
      {large ? <p className="text-sm text-muted-foreground" data-testid="plc-devices-import-large">Filen är vald ({Math.round(text.length / 1024)} kB). <Button type="button" size="sm" variant="ghost" onClick={() => setText("")}>Rensa</Button></p>
        : <Field id="plc-devices-import-text" label="Text" value={text} multiline onChange={setText} />}
      {parsed && !parsed.ok ? <div role="alert" className="notice text-sm" data-testid="plc-devices-import-errors"><p className="font-medium">Filen går inte att importera:</p><ul className="mt-1 list-disc space-y-0.5 pl-5">{parsed.errors.map((line) => <li key={line}>{line}</li>)}</ul></div> : null}
      {parsed?.ok ? <>
        <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="plc-devices-import-summary">
          <span className="font-medium">{devices.length} apparater: {devices.length - replaced} nya, {replaced} ersätter befintliga.</span>
          {conflicts > 1 ? <span className="flex gap-1"><Button type="button" size="sm" variant="outline" onClick={() => setAll("replace")} data-testid="plc-devices-import-replace-all">Ersätt alla</Button><Button type="button" size="sm" variant="outline" onClick={() => setAll("new")} data-testid="plc-devices-import-new-all">Alla som nya</Button></span> : null}
        </div>
        <ul className="max-h-[45vh] divide-y overflow-auto rounded-lg border" data-testid="plc-devices-import-preview">{devices.map((device, index) => <li key={index} className="flex flex-wrap items-center gap-3 p-2" data-choice={choiceOf(device, index)}>
          <span className="rounded-md bg-[#0b1220] px-1"><DeviceThumb kind={device.design.function} design={device.design} /></span>
          <span className="min-w-0 flex-1 text-sm"><span className="font-medium">{device.design.label}</span><span className="block text-xs text-muted-foreground">{DEVICE_DEFS[device.design.function].label} · {GROUP_LABELS[device.design.group]}{device.design.image ? " · egen bild" : ""}</span></span>
          {existing(device) ? <Field id={`plc-import-choice-${index}`} label={`Finns redan (${device.key})`} value={choiceOf(device, index)} options={["replace", "new"]} optionLabels={{ replace: "Ersätt som utkast", new: "Skapa ny" }} onChange={(value) => setChoices({ ...choices, [index]: value as "replace" | "new" })} />
            : <span className="text-xs text-muted-foreground">Ny apparat</span>}
        </li>)}</ul>
      </> : null}
      {serverError ? <p role="alert" className="text-sm text-destructive">{serverError}</p> : null}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Lightbulb className="size-3.5" />Formatet beskrivs under Visa format.</p>
    </div>
    <DialogActions cancel={{ label: "Avbryt", onClick: onClose }} primary={{ label: parsed?.ok ? `Importera ${devices.length}` : "Importera", busy: Boolean(busy), busyLabel: busy || "Importerar…", disabledReason: parsed?.ok ? null : "Välj eller klistra in en giltig fil.", onClick: () => void run(), testId: "plc-devices-import-submit" }} />
  </Modal>;
}

/** The sound card's line when folded. */
function soundSummary(design: DeviceDesign): string {
  if (design.silent) return "Tyst.";
  if (design.sound) return `Eget ljud (${design.sound.format.toUpperCase()}).`;
  const standard = STANDARD_SOUNDS[design.function];
  return standard ? `Standardljud: ${SOUND_LABELS[standard]}.` : "Funktionen har inget ljud.";
}
