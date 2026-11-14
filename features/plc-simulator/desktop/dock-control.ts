import type { AddPanelOptions, DockviewApi, IDockviewPanel } from "dockview-react";
import { notice } from "@/lib/workflow/toast";
import { type PanelId, PANELS } from "./panels";

// PLC-simulatorn, skrivbordet: what can be done to the dock, apart from dragging. The default layout: Projekt and Palett narrow
// on the left, Rityta in the middle (at least 60 % of the width), Program to the right, and under the surface a low row of tabs
// with Kontroll, Egenskaper and Trend first. A panel goes to its own browser window with `popOut`; the window is the dock's
// (a real window.open of an empty page), and the panel in it stays in this page's React tree.

export const POPOUT_URL = "/plc-popout.html";

const panelOptions = (id: PanelId, more: Partial<AddPanelOptions> = {}): AddPanelOptions => ({ id, component: id, title: PANELS[id].title, tabComponent: "plc", minimumWidth: 120, minimumHeight: 70, ...more } as AddPanelOptions);

/** The width of the left column and the Program column, and the height of the row under the surface, for a dock of this size. */
export function defaultSizes(width: number, windowHeight: number) {
  const left = Math.round(Math.min(240, Math.max(160, width * 0.125)));
  const right = Math.round(Math.max(220, width * 0.38 - left));
  // Trend: about 200 px, never above a quarter of the window.
  const bottom = Math.round(Math.min(200, windowHeight * 0.24));
  return { left, right, bottom, narrow: width < 1024 };
}

export function buildDefaultLayout(api: DockviewApi, width: number, windowHeight: number) {
  api.clear();
  const { left, right, bottom, narrow } = defaultSizes(width, windowHeight);
  api.addPanel(panelOptions("surface"));
  api.addPanel(panelOptions("tree", { position: { referencePanel: "surface", direction: "left" }, initialWidth: left, minimumWidth: 120 }));
  api.addPanel(narrow ? panelOptions("palette", { position: { referencePanel: "tree", direction: "within" }, minimumWidth: 120 }) : panelOptions("palette", { position: { referencePanel: "tree", direction: "below" }, minimumWidth: 120 }));
  if (narrow) {
    // Too narrow for three columns: Program beside Rityta as tabs.
    api.addPanel(panelOptions("program", { position: { referencePanel: "surface", direction: "within" }, inactive: true }));
    api.addPanel(panelOptions("tags", { position: { referencePanel: "surface", direction: "within" }, inactive: true }));
  } else {
    api.addPanel(panelOptions("program", { position: { referencePanel: "surface", direction: "right" }, initialWidth: right, minimumWidth: 200 }));
    api.addPanel(panelOptions("tags", { position: { referencePanel: "program", direction: "within" }, inactive: true }));
  }
  api.addPanel(panelOptions("check", { position: { referencePanel: "surface", direction: "below" }, initialHeight: bottom, minimumHeight: 80 }));
  for (const id of ["properties", "trend", "connection", "log"] as const) api.addPanel(panelOptions(id, { position: { referencePanel: "check", direction: "within" }, inactive: true }));
  api.getPanel("surface")?.api.setActive();
  // The sizes once everything stands: the first additions were made while the dock was still being divided.
  api.getPanel("tree")?.group.api.setSize({ width: left });
  if (!narrow) api.getPanel("program")?.group.api.setSize({ width: right });
  api.getPanel("check")?.group.api.setSize({ height: bottom });
}

/** Opens a panel where it fits: as a tab beside Rityta (what the project tree asks for), or just brings it forward when it is already open. */
export function showPanel(api: DockviewApi, id: PanelId): IDockviewPanel {
  const open = api.getPanel(id);
  if (open) { open.api.setActive(); return open; }
  // Hjälp stands in a column of its own: the guide is read beside the drawing and the program, and must not cover them.
  if (id === "help") {
    const beside = api.getPanel("program") ?? api.getPanel("surface") ?? api.panels[0];
    return api.addPanel(panelOptions(id, { ...(beside ? { position: { referencePanel: beside.id, direction: "right" as const } } : {}), initialWidth: 340, minimumWidth: 240 }));
  }
  const reference = api.getPanel("surface") ?? api.panels[0];
  return api.addPanel(panelOptions(id, reference ? { position: { referencePanel: reference.id, direction: "within" } } : {}));
}

export function togglePanel(api: DockviewApi, id: PanelId) {
  const open = api.getPanel(id);
  if (open) open.api.close(); else showPanel(api, id);
}

/** A panel to a browser window of its own. A blocked popup leaves it in the dock, and the dock tells (see `watchFailures` in dock.tsx). */
export async function popOut(api: DockviewApi, id: PanelId) {
  const panel = showPanel(api, id);
  if (panel.group.api.location.type === "popout") { focusPanelWindow(api, id); return; }
  await api.addPopoutGroup(panel, { popoutUrl: POPOUT_URL });
}

function focusPanelWindow(api: DockviewApi, id: PanelId) {
  const location = api.getPanel(id)?.group.api.location;
  if (location?.type === "popout") location.getWindow().focus();
}

/** Ctrl+1 … Ctrl+9: to the panel, in its window, and focus into it so the keyboard goes on from there. */
export function focusPanel(api: DockviewApi, id: PanelId) {
  const panel = showPanel(api, id);
  focusPanelWindow(api, id);
  const element = panel.view.content.element.querySelector<HTMLElement>("[tabindex], button, input, select, textarea");
  element?.focus({ preventScroll: true });
}

export const blockedText = (id?: string) => `Webbläsaren stoppade fönstret${id ? ` för ${id}` : ""}. Tillåt popup-fönster för sidan och försök igen.`;
export const tellBlocked = () => notice(blockedText());
