import type { DockviewApi } from "dockview-react";
import type { SourceRow } from "@/lib/machine/simulator/generate-connection";
import type { DeviceKindId } from "@/lib/machine/simulator/surface/devices";
import type { WireKind } from "@/lib/machine/simulator/surface/layout";
import type { HelpTopicId } from "@/lib/machine/simulator/help";
import type { PanelId } from "./panels";

// PLC-simulatorn, skrivbordet (2026-11-04): what the menu, the toolbar, the status bar and the panels share and that is not the
// PLC's state: the chosen tool, the surface's zoom, the panel last worked in, the commands a panel has lent out (the toolbar's
// zoom buttons and Ctrl+D act on the surface, but the view lives there) and the dock itself. A small store outside React, read
// with useSyncExternalStore, so a panel that has been moved to a window of its own reads the same object as the rest.

export type Tool = "select" | "wire";
export type Placing = { kind: DeviceKindId; /** A copy's option (PLC-apparater), else none. */ options?: Record<string, string>; startX: number; startY: number; doc: Document };
export type SelectedCorner = { wireId: string; index: number };
export type SurfaceCommands = { zoomIn(): void; zoomOut(): void; fit(): void; duplicate(): void; remove(): void };
export type ProgramCommands = { duplicate(): boolean; remove(): boolean };
export type DeskState = {
  tool: Tool; wireKind: WireKind; zoom: number;
  /** Redigera in the toolbar: the surface edits without Ctrl held (the owner 2026-11-06: no edit by mistake while panning). */
  editLock: boolean;
  /** The panel last clicked or focused: Ctrl+D and Ta bort in the menu act there. */
  activePanel: string | null;
  placing: Placing | null;
  selectedCorner: SelectedCorner | null;
  /** What Egenskaper shows when no device or wire is selected. */
  propertiesOf: "selection" | "regulator";
  /** Panels the dock holds right now, for the checks in Visa. */
  openPanels: readonly string[];
  /** Panels standing in a window of their own. */
  popouts: readonly string[];
  /** The source chosen under Maskinkoppling: its name and mode, never its key. */
  connectionSource: SourceRow | null;
  /** Under Program: Fel, Korsreferens or Övervaka. */
  bottomTab: "errors" | "xref" | "watch";
  xrefTag: string | null;
  /** Counted up by "Gå till ST-rad", so the ST view knows to take the focus. */
  stFocusTick: number;
  /** On a phone a panel is shown by choosing its tab. */
  phoneShow: ((id: PanelId) => void) | null;
  /** Hjälp: the open topic, the step last shown, and what that step marks on the palette and the PLC. */
  helpTopic: HelpTopicId;
  guideStep: string | null;
  guideKinds: readonly string[];
  guideTerminals: readonly string[];
};

export function createDesk() {
  let state: DeskState = { tool: "select", wireKind: "auto", zoom: 100, editLock: false, activePanel: null, placing: null, selectedCorner: null, propertiesOf: "selection", openPanels: [], popouts: [], connectionSource: null, bottomTab: "errors", xrefTag: null, stFocusTick: 0, phoneShow: null, helpTopic: "start", guideStep: null, guideKinds: [], guideTerminals: [] };
  const listeners = new Set<() => void>();
  let dock: DockviewApi | null = null;
  let surface: SurfaceCommands | null = null;
  let program: ProgramCommands | null = null;
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => state,
    set(change: Partial<DeskState>) {
      if ((Object.keys(change) as (keyof DeskState)[]).every((key) => state[key] === change[key])) return;
      state = { ...state, ...change };
      for (const listener of listeners) listener();
    },
    get dock() { return dock; },
    setDock(api: DockviewApi | null) { dock = api; },
    get surface() { return surface; },
    setSurface(commands: SurfaceCommands | null) { surface = commands; },
    get program() { return program; },
    setProgram(commands: ProgramCommands | null) { program = commands; },
  };
}
export type Desk = ReturnType<typeof createDesk>;
