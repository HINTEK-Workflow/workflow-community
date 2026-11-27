"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { type DockviewApi, type DockviewGroupPanel, type DockviewReadyEvent, DockviewReact, type IDockviewHeaderActionsProps, type IDockviewPanelHeaderProps, type DockviewTheme } from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import { ExternalLink, Maximize2, Minimize2, Pin, PinOff, Undo2, X } from "lucide-react";
import { announce } from "@/lib/workflow/toast";
import { useDesktop } from "./context";
import { buildDefaultLayout, POPOUT_URL } from "./dock-control";
import { isPanelId, type PanelId, PANEL_IDS, PANELS } from "./panels";
import { forgetLayoutText, readLayoutText, writeLayoutText } from "./layout-store";

// PLC-simulatorn, skrivbordet: the docking area. Every panel can be dragged to another place, become a tab, be maximised and be
// broken out to a browser window of its own; the layout is saved on this device and survives a reload. The library is
// dockview-react (MIT): its windows are real window.open windows with the panel's DOM moved over, kept in this page's React tree.

const THEME: DockviewTheme = { name: "plc", className: "dockview-theme-plc", colorScheme: "light", gap: 0, dndOverlayMounting: "absolute" };

function PanelTab({ api, tabLocation }: IDockviewPanelHeaderProps) {
  const id = api.id;
  const def = isPanelId(id) ? PANELS[id] : null;
  const Icon = def?.icon;
  return <div className="plc-tab" data-testid="plc-tab" data-panel={id} data-location={tabLocation} title={def?.line}>
    {Icon ? <Icon aria-hidden="true" /> : null}
    <span>{api.title}</span>
    <button type="button" className="plc-tab-close" aria-label={`Stäng ${api.title}`} data-testid="plc-tab-close" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); api.close(); }}><X aria-hidden="true" /></button>
  </div>;
}

/** Fäst: nothing can be docked into the group by mistake. Saved with the layout. */
function setPinned(group: DockviewGroupPanel, pinned: boolean) { group.locked = pinned ? "no-drop-target" : false; }

function GroupActions({ api, containerApi, activePanel, group }: IDockviewHeaderActionsProps) {
  const [, redraw] = useState(0);
  useEffect(() => {
    const again = () => redraw((count) => count + 1);
    const subscriptions = [containerApi.onDidMaximizedGroupChange(again), api.onDidLocationChange(again), containerApi.onDidLayoutChange(again)];
    return () => subscriptions.forEach((subscription) => subscription.dispose());
  }, [api, containerApi]);
  const inWindow = api.location.type === "popout";
  const maximized = !inWindow && api.isMaximized();
  const pinned = Boolean(group.locked);
  const title = activePanel?.title ?? "panelen";
  const stop = { onPointerDown: (event: React.PointerEvent) => event.stopPropagation() };
  return <div className="plc-group-actions" data-testid="plc-group-actions" data-group={group.id}>
    <button type="button" className="plc-group-action" aria-pressed={pinned} aria-label={pinned ? `Släpp ${title}` : `Fäst ${title}`} title={pinned ? "Fäst: inget kan dockas hit. Klicka för att släppa." : "Fäst panelen: inget kan dockas hit av misstag."} data-testid="plc-group-pin" {...stop} onClick={() => { setPinned(group, !pinned); redraw((count) => count + 1); }}>{pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}</button>
    {inWindow ? <button type="button" className="plc-group-action" aria-label={`Tillbaka hit: ${title}`} title="Tillbaka till huvudfönstret" data-testid="plc-group-back" {...stop} onClick={() => api.moveTo({ position: "right" })}><Undo2 aria-hidden="true" /></button>
      : <>
        <button type="button" className="plc-group-action" aria-label={`Eget fönster: ${title}`} title="Bryt ut till ett eget fönster" data-testid="plc-group-popout" {...stop} onClick={() => { if (activePanel) void containerApi.addPopoutGroup(activePanel, { popoutUrl: POPOUT_URL }); }}><ExternalLink aria-hidden="true" /></button>
        <button type="button" className="plc-group-action" aria-pressed={maximized} aria-label={maximized ? "Återställ storleken" : `Maximera ${title}`} title={maximized ? "Återställ storleken" : "Maximera"} data-testid="plc-group-maximize" {...stop} onClick={() => { if (maximized) api.exitMaximized(); else api.maximize(); }}>{maximized ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}</button>
      </>}
  </div>;
}

/** The person's look on a window the dock opened: theme and text size come from this page's <html>. */
function dressWindow(target: Window) {
  const from = document.documentElement, to = target.document.documentElement;
  for (const attribute of ["data-theme", "lang", "class"]) { const value = from.getAttribute(attribute); if (value !== null) to.setAttribute(attribute, value); }
  to.style.fontSize = from.style.fontSize;
  target.document.body.className = document.body.className;
}

export function DockArea({ bodies, onWindows }: { bodies: Record<PanelId, ComponentType>; onWindows: (windows: readonly Window[]) => void }) {
  const { desk } = useDesktop();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<DockviewApi | null>(null);
  const onWindowsRef = useRef(onWindows);
  useEffect(() => { onWindowsRef.current = onWindows; }, [onWindows]);

  const components = useMemo(() => Object.fromEntries(PANEL_IDS.map((id) => {
    const Body = bodies[id];
    function Panel() {
      return <div className="plc-panel" data-testid={`plc-panel-${id}`} onPointerDownCapture={() => desk.set({ activePanel: id })} onFocusCapture={() => desk.set({ activePanel: id })}><Body /></div>;
    }
    Panel.displayName = `PlcPanel_${id}`;
    return [id, Panel];
  })), [bodies, desk]);
  const tabComponents = useMemo(() => ({ plc: PanelTab }), []);

  const onReady = useCallback((event: DockviewReadyEvent) => {
    const { api } = event;
    apiRef.current = api;
    desk.setDock(api);
    const note = () => {
      desk.set({ openPanels: api.panels.map((panel) => panel.id), popouts: api.panels.filter((panel) => panel.group.api.location.type === "popout").map((panel) => panel.id) });
      const windows = api.groups.flatMap((group) => { const { location } = group.api; return location.type === "popout" ? [location.getWindow()] : []; });
      for (const target of windows) dressWindow(target);
      onWindowsRef.current(windows);
    };
    let saving: ReturnType<typeof setTimeout> | null = null;
    const save = () => {
      if (saving) clearTimeout(saving);
      saving = setTimeout(() => { saving = null; writeLayoutText(JSON.stringify(api.toJSON())); }, 250);
    };
    const host = hostRef.current;
    const restore = () => {
      const stored = readLayoutText();
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as Parameters<DockviewApi["fromJSON"]>[0];
          api.fromJSON(parsed);
          if (api.panels.length) return;
        } catch { forgetLayoutText(); }
      }
      buildDefaultLayout(api, host?.clientWidth || window.innerWidth, window.innerHeight);
    };
    api.onDidLayoutChange(() => { save(); note(); });
    api.onDidAddPopoutGroup(() => note());
    api.onDidRemovePopoutGroup(() => note());
    api.onDidOpenPopoutWindowFail(() => announce("Webbläsaren stoppade fönstret. Panelen står kvar här. Tillåt popup-fönster för sidan och försök igen.", true));
    restore();
    note();
  }, [desk]);

  // React's trial unmount in development must not leave the program without its dock: the same dock is handed back.
  useEffect(() => { if (apiRef.current) desk.setDock(apiRef.current); return () => { desk.setDock(null); }; }, [desk]);

  return <div ref={hostRef} className="plc-dock-area" data-testid="plc-dock">
    <DockviewReact theme={THEME} components={components} tabComponents={tabComponents} defaultTabComponent={PanelTab} rightHeaderActionsComponent={GroupActions} onReady={onReady} popoutUrl={POPOUT_URL} />
  </div>;
}
