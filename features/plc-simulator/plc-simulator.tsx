"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import { useConfirm } from "@/features/kfid/confirm";
import { PanelAreaProvider } from "@/features/kfid/ui";
import { ReauthHost } from "@/features/security/reauth-host";
import { EventToast } from "@/features/workflow/toast-card";
import { HELP_KEYS } from "@/lib/machine/simulator/help";
import { ST_HELP } from "@/lib/machine/simulator/st/examples";
import { clockText, plcClock, WEEKDAYS } from "@/lib/machine/simulator/surface/engine";
import { setPublishedDesigns, type PublishedDesign } from "@/lib/machine/simulator/surface/device-designs";
import type { ThemeChoice } from "@/lib/theme";
import { useRuntime } from "./surface/use-runtime";
import { useLook } from "./look";
import { useSimulator } from "./use-simulator";
import { useActions } from "./desktop/actions";
import { CheckPanel } from "./desktop/check-panel";
import { ConnectionPanel } from "./desktop/connection-panel";
import { DesktopProvider, useRuntimeSnapshot, useDesktop, usePhone } from "./desktop/context";
import { ChromeButton } from "./desktop/controls";
import { createDesk } from "./desktop/desk";
import { HelpHint, HelpPanel } from "./desktop/help-panel";
import { LogPanel } from "./desktop/log-panel";
import { type HelpTopic, MenuBar } from "./desktop/menu-bar";
import { PalettePanel } from "./desktop/palette-panel";
import { PHONE_PANELS, type PanelId, PANELS } from "./desktop/panels";
import { LadderPanel } from "./desktop/ladder-panel";
import { ProgramPanel } from "./desktop/program-panel";
import { StPanel } from "./desktop/st-panel";
import { ProjectTree } from "./desktop/project-tree";
import { PropertiesPanel } from "./desktop/properties-panel";
import { StatusBar } from "./desktop/status-bar";
import { SurfacePanel } from "./desktop/surface-panel";
import { TagsPanel } from "./desktop/tags-panel";
import { ToolBar } from "./desktop/tool-bar";
import { TrendPanel } from "./desktop/trend-panel";
import { PHONE_SIMULATOR_TEXT, usePhoneScreen } from "@/features/demo/machine/use-phone-screen";
import "./desktop/desktop.css";

// PLC-simulatorn as a desktop program (2026-11-04): the whole window, a menu bar, a toolbar, a dock with panels and a status bar. It
// runs in the browser and speaks to the server only through the machine intake with a source's key, as an outside device does.
// Nothing runs when the window is closed. The page's words about what it is have moved to Hjälp.

// The public demo's connection to its own Workflow window: only with the demo prop, and in a chunk of its own.
const DemoMachineLink = dynamic(() => import("@/features/demo/machine/simulator-panel").then((module) => module.DemoMachineLink), { ssr: false });

const DockArea = dynamic(() => import("./desktop/dock").then((module) => module.DockArea), { ssr: false });

const BODIES: Record<PanelId, ComponentType> = { ladder: LadderPanel, st: StPanel, surface: SurfacePanel, program: ProgramPanel, tags: TagsPanel, check: CheckPanel, properties: PropertiesPanel, trend: TrendPanel, connection: ConnectionPanel, log: LogPanel, tree: ProjectTree, palette: PalettePanel, help: HelpPanel };

function HelpBody({ topic }: { topic: HelpTopic }) {
  if (topic === "about") return <div className="space-y-2">
    <p>PLC-simulatorn är en övningsplats och ett testverktyg i webbläsaren. Rita ett skåp med PLC, apparater och ledningar, skriv ett program i Ladder eller ST och se hur allt beter sig när det körs.</p>
    <p>Den räknar med spänningsnivåer, inte strömmar. Det är inget verktyg för elsäkerhet, och gränserna (15 V räknas som på, PLC:n tål 30 V) är simulatorns egna.</p>
    <p>Allt körs på den här sidan. Ritningen sparas i webbläsaren, och inga händelser går till servern förrän du själv kopplar in en källnyckel under Maskinkoppling. I den publika demon finns ingen nyckel: Demokopplingen pratar bara med demons eget fönster.</p>
  </div>;
  if (topic === "keys") return <table className="plc-table"><tbody>
    {HELP_KEYS.map(([key, what]) => <tr key={key}><td className="whitespace-nowrap font-semibold">{key}</td><td>{what}</td></tr>)}
  </tbody></table>;
  if (topic === "st") return <div className="grid gap-3 sm:grid-cols-2">
    {ST_HELP.map((part) => <div key={part.title}><h3 className="font-semibold">{part.title}</h3><ul className="mt-1 space-y-1">{part.lines.map((line) => <li key={line} className="[overflow-wrap:anywhere]">{line}</li>)}</ul></div>)}
  </div>;
  return <ul className="list-disc space-y-1 pl-4">
    <li>Ett larm kan ge riktiga arbetsordrar och notiser, beroende på hur källan är inställd. En ny källa står på Av och ger inga arbetsordrar förrän någon väljer läge.</li>
    <li>Allt märks: texten börjar med ”Simulerat:”.</li>
    <li>Fel och kritiska larm går ut som varning tills någon uttryckligen tillåter dem.</li>
    <li>Nyckeln finns bara i fönstrets minne. Den sparas aldrig och måste klistras in igen efter omladdning.</li>
    <li>Stängs fönstret stannar allt.</li>
  </ul>;
}
const HELP_TITLE: Record<HelpTopic, string> = { about: "Om PLC-simulatorn", keys: "Tangenter", st: "Så skriver du ST", guards: "Kopplingen till Workflow" };

/** The window's small dialogs: square, 12 px, in the chrome; the shared confirm dialog is drawn beside them. */
function ChromeDialog({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: ReactNode }) {
  return <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/25" />
      <Dialog.Content className="plc-chrome fixed left-1/2 top-[12vh] z-50 flex max-h-[76vh] w-[min(40rem,calc(100vw-1rem))] -translate-x-1/2 flex-col border border-[var(--plc-line)]" data-testid="plc-dialog" aria-describedby={undefined}>
        <div className="flex flex-none items-center border-b border-[var(--plc-line)] bg-[var(--plc-header)] px-2 py-1">
          <Dialog.Title className="font-semibold">{title}</Dialog.Title>
          <Dialog.Close asChild><button type="button" className="plc-tab-close ml-auto" aria-label="Stäng"><X aria-hidden="true" /></button></Dialog.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">{children}</div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

function ClockBody({ onClose }: { onClose: () => void }) {
  const { runtime } = useDesktop();
  const { engine } = useRuntimeSnapshot();
  const clock = plcClock(engine.clockMin);
  const setClock = (weekday: number, hour: number, minute: number) => runtime.setClock((weekday - 1) * 1440 + hour * 60 + minute);
  return <div className="flex flex-wrap items-end gap-2">
    <label className="plc-field"><span>Veckodag</span><select className="plc-select" value={clock.weekday} onChange={(event) => setClock(Number(event.target.value), clock.hour, clock.minute)}>{WEEKDAYS.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}</select></label>
    <label className="plc-field"><span>Tid</span><input type="time" className="plc-input" value={`${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}`} onChange={(event) => { const [hour, minute] = event.target.value.split(":").map(Number); if (Number.isFinite(hour) && Number.isFinite(minute)) setClock(clock.weekday, hour, minute); }} /></label>
    <span className="plc-help self-center">{clockText(engine.clockMin)}</span>
    <ChromeButton className="ml-auto" onClick={onClose}>Stäng</ChromeButton>
  </div>;
}

/** F5, F7, Ctrl+1 … 9, and Ctrl+Z/Y/D whichever panel has the focus. A text field keeps its own undo. In every window of the program. */
function useShortcuts(windows: readonly Window[]) {
  const actions = useActions();
  const latest = useRef(actions);
  useEffect(() => { latest.current = actions; }, [actions]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      const target = event.target as HTMLElement | null;
      const typing = target !== null && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      const key = event.key.toLowerCase();
      const handled = () => { event.preventDefault(); event.stopPropagation(); };
      if (event.key === "F1") { handled(); latest.current.openHelp("start"); return; }
      if (event.key === "F5") { handled(); latest.current.toggleRun(); return; }
      if (event.key === "F7") { handled(); latest.current.compile(); return; }
      if (mod && /^[1-9]$/.test(event.key)) { handled(); latest.current.focusPanelAt(Number(event.key) - 1); return; }
      if (mod && key === "d") { handled(); if (!typing) latest.current.duplicate(); return; }
      if (typing) return;
      if (mod && !event.shiftKey && key === "z") { handled(); latest.current.undo(); return; }
      if (mod && (key === "y" || (event.shiftKey && key === "z"))) { handled(); latest.current.redo(); }
    };
    const all: Window[] = [window, ...windows];
    for (const target of all) target.addEventListener("keydown", onKey, true);
    return () => { for (const target of all) { try { target.removeEventListener("keydown", onKey, true); } catch { /* That window is gone. */ } } };
  }, [windows]);
}

function PhoneTabs({ current, onSelect }: { current: PanelId; onSelect: (id: PanelId) => void }) {
  return <div className="plc-phone-tabs" role="tablist" aria-label="Paneler" data-testid="plc-phone-tabs">
    {PHONE_PANELS.map((id) => <button key={id} type="button" role="tab" aria-selected={current === id} className="plc-phone-tab" data-testid="plc-phone-tab" data-panel={id} onClick={() => onSelect(id)}>{PANELS[id].title}</button>)}
  </div>;
}

function Shell() {
  const { desk } = useDesktop();
  const actions = useActions();
  const snapshot = useRuntimeSnapshot();
  const phone = usePhone();
  const [help, setHelp] = useState<HelpTopic | null>(null);
  const [clockOpen, setClockOpen] = useState(false);
  const [phonePanel, setPhonePanel] = useState<PanelId>("surface");
  const [windows, setWindows] = useState<readonly Window[]>([]);
  useShortcuts(windows);
  const onWindows = useCallback((next: readonly Window[]) => setWindows((current) => (current.length === next.length && current.every((item, index) => item === next[index]) ? current : next)), []);
  const PhoneBody = BODIES[phonePanel];
  // On a phone "show this panel" goes to the tab; the rest of the program asks through the desk as on a computer.
  useEffect(() => { if (phone) desk.set({ activePanel: phonePanel, openPanels: PHONE_PANELS, phoneShow: setPhonePanel }); else desk.set({ phoneShow: null }); }, [desk, phone, phonePanel]);
  return <main className="plc-chrome plc-desktop" data-testid="plc-desktop" data-ready="true" data-phone={phone}>
    <MenuBar onHelp={setHelp} onClock={() => setClockOpen(true)} />
    <ToolBar />
    <HelpHint onOpen={actions.openHelp} />
    {snapshot.storeProblem ? <p className="plc-note flex-none" role="status">{snapshot.storeProblem}</p> : null}
    {phone ? <>
      <PhoneTabs current={phonePanel} onSelect={setPhonePanel} />
      <div className="plc-phone-panel plc-panel" data-testid={`plc-panel-${phonePanel}`}><PhoneBody /></div>
    </> : <DockArea bodies={BODIES} onWindows={onWindows} />}
    <StatusBar />
    <ChromeDialog title={help ? HELP_TITLE[help] : ""} open={help !== null} onClose={() => setHelp(null)}>{help ? <HelpBody topic={help} /> : null}</ChromeDialog>
    <ChromeDialog title="Klocka" open={clockOpen} onClose={() => setClockOpen(false)}><ClockBody onClose={() => setClockOpen(false)} /></ChromeDialog>
    {/* A new source key needs a fresh confirmation, asked as everywhere else in Workflow. */}
    <ReauthHost />
    <EventToast testId="plc-toast" defaultMs={6000} />
  </main>;
}

export function PlcSimulator({ upkeepOn, theme, textScale, designs = [], demo = false, demoExample = false, demoWindow = null }: { upkeepOn: boolean; theme: ThemeChoice; textScale: number; /** PLC-apparater: the published device designs. */ designs?: readonly PublishedDesign[]; /** The public demo: no account, so the connection is the demo's own, in the browser. */ demo?: boolean; /** The demo: open with the ready machine. */ demoExample?: boolean; /** The demo: the Workflow window that opened this one. */ demoWindow?: string | null }) {
  const [simulator] = useSimulator();
  const [runtime] = useRuntime(simulator);
  // PLC-apparater (2026-11-06): the product owner's published device designs, read by the page on the server; set before the first
  // drawing so the simulator never flashes its own look first. Without any (an older database) the simulator's own devices.
  useState(() => setPublishedDesigns(designs));
  const [desk] = useState(createDesk);
  const [confirm, confirmElement] = useConfirm();
  useLook(theme, textScale);
  const phone = usePhoneScreen();
  const value = useMemo(() => ({ simulator, runtime, desk, confirm, upkeepOn, demo }), [simulator, runtime, desk, confirm, upkeepOn, demo]);
  if (phone) return <main className="mx-auto w-full max-w-md space-y-4 px-4 py-10" data-testid="plc-phone-note"><h1 className="text-lg font-semibold">PLC-simulator</h1><p className="notice" role="status">{PHONE_SIMULATOR_TEXT}</p><Link href="/" className="underline">Tillbaka till Workflow</Link></main>;
  return <PanelAreaProvider area="maintenance">
    <DesktopProvider value={value}>
      {confirmElement}
      {demo ? <DemoMachineLink example={demoExample} wf={demoWindow} /> : null}
      <Shell />
    </DesktopProvider>
  </PanelAreaProvider>;
}
