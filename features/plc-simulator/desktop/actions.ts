"use client";

import { useMemo } from "react";
import { saveBlob } from "@/lib/download";
import { MAX_SURFACE_FILE_BYTES } from "@/lib/machine/simulator/surface/layout";
import { removeSelection } from "@/lib/machine/simulator/surface/edit";
import { announce, notice } from "@/lib/workflow/toast";
import type { HelpTopicId } from "@/lib/machine/simulator/help";
import { useDesktop } from "./context";
import { buildDefaultLayout, focusPanel, popOut, showPanel, togglePanel } from "./dock-control";
import { forgetLayoutText } from "./layout-store";
import { PANEL_IDS, type PanelId } from "./panels";

// PLC-simulatorn, skrivbordet: what the menu, the toolbar and the keys do. One function each, so the three cannot differ.

export function useActions() {
  const { runtime, desk, confirm } = useDesktop();
  return useMemo(() => {
    const askClear = async (title: string, confirmLabel: string) => {
      const { layout } = runtime.getSnapshot();
      if (!layout.devices.length && !layout.program && !layout.wires.length) return true;
      return confirm({ title, message: "Apparater, ledningar och programmet försvinner. Ångra tar tillbaka dem, och du kan exportera först.", confirmLabel, tone: "danger" });
    };
    const fitSoon = () => window.setTimeout(() => desk.surface?.fit(), 60);
    return {
      async newProject() { if (await askClear("Börja ett nytt projekt?", "Nytt")) runtime.clearSurface(); },
      async clear() { if (await askClear("Rensa ritytan?", "Rensa")) runtime.clearSurface(); },
      exportFile() { saveBlob(runtime.exportText(), "plc-rityta.json", "application/json"); },
      async importFile(file: File | undefined) {
        if (!file) return;
        if (file.size > MAX_SURFACE_FILE_BYTES) { announce("Filen är för stor.", true); return; }
        runtime.importText(await file.text());
        fitSoon();
      },
      /** The drawing is new: Anpassa, once the panel has drawn it. */
      openExample(id: string) { runtime.loadExample(id); fitSoon(); },
      undo() { runtime.undo(); },
      redo() { runtime.redo(); },
      /** Ctrl+D and Duplicera: in the panel last worked in. */
      duplicate() {
        if (desk.getSnapshot().activePanel === "program" && desk.program?.duplicate()) return;
        desk.surface?.duplicate();
      },
      remove() {
        if (desk.getSnapshot().activePanel === "program" && desk.program?.remove()) return;
        if (desk.surface) { desk.surface.remove(); return; }
        const { selected } = runtime.getSnapshot();
        if (!selected) return;
        const set = selected.kind === "device" ? { devices: [selected.id], wires: [] } : selected.kind === "wire" ? { devices: [], wires: [selected.id] } : { devices: selected.devices, wires: selected.wires };
        runtime.edit((current) => removeSelection(current, set));
      },
      toggleRun() { const { engine } = runtime.getSnapshot(); runtime.setRun(!engine.run); },
      compile() {
        const result = runtime.verify();
        desk.set({ bottomTab: "errors" });
        if (result.ok) notice("Programmet är klart.");
        else announce(`Programmet har ett fel på rad ${result.problem.line}.`, true);
        return result;
      },
      openHelp(topic: HelpTopicId) { desk.set({ helpTopic: topic }); const { phoneShow } = desk.getSnapshot(); if (phoneShow) phoneShow("help"); else if (desk.dock) showPanel(desk.dock, "help"); },
      togglePanel(id: PanelId) { if (desk.dock) togglePanel(desk.dock, id); },
      showPanel(id: PanelId) { const { phoneShow } = desk.getSnapshot(); if (phoneShow) phoneShow(id); else if (desk.dock) showPanel(desk.dock, id); },
      popOut(id: PanelId) { if (desk.dock) void popOut(desk.dock, id); },
      /** Ctrl+1 … Ctrl+9. */
      focusPanelAt(index: number) { const id = PANEL_IDS[index]; if (id && desk.dock) focusPanel(desk.dock, id); },
      resetLayout() {
        forgetLayoutText();
        const { dock } = desk;
        if (dock) buildDefaultLayout(dock, dock.width, window.innerHeight);
      },
    };
  }, [runtime, desk, confirm]);
}
export type Actions = ReturnType<typeof useActions>;
