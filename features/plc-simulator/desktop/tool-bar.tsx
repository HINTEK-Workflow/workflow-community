"use client";

import { Cable, Maximize2, MousePointer2, Pencil, Play, Spline, Square, Volume2, VolumeX, Waypoints, Wrench, ZoomIn, ZoomOut } from "lucide-react";
import { WIRE_STYLES, type WireStyle } from "@/lib/machine/simulator/surface/draw";
import { plcClock, SPEEDS, type SurfaceSpeed, WEEKDAYS } from "@/lib/machine/simulator/surface/engine";
import { WIRE_KIND_LABELS, WIRE_KINDS, type WireKind } from "@/lib/machine/simulator/surface/layout";
import { useDeviceSounds } from "../surface/sound-player";
import { usePreference } from "../surface/surface-preferences";
import { useActions } from "./actions";
import { useRuntimeSnapshot, useDesktop, useDeskState } from "./context";
import { Lamp, ToolButton } from "./controls";

// PLC-simulatorn, skrivbordet: the toolbar. The mode indicator at far left (Run, Prog, Fault with lamps; the word always stands
// beside the lamp, so colour is never the only sign), then the drawing tools, zoom, RUN/STOP, compile, speed, clock and the outdoor
// temperature as compact controls.

export function ToolBar() {
  const { runtime, desk } = useDesktop();
  const actions = useActions();
  const snapshot = useRuntimeSnapshot();
  const { tool, wireKind, zoom, editLock } = useDeskState();
  const [wireStyle, chooseStyle] = usePreference<WireStyle>("wireStyle", "soft", WIRE_STYLES);
  // Ljud (2026-11-07): on unless turned off on this device; the sounds start with the first click on the page.
  const [sound, chooseSound] = usePreference<"on" | "off">("sound", "on", ["on", "off"]);
  useDeviceSounds(sound === "on", snapshot.layout.devices, snapshot.engine.devices);
  const { engine } = snapshot;
  const clock = plcClock(engine.clockMin);
  const setClock = (weekday: number, hour: number, minute: number) => runtime.setClock((weekday - 1) * 1440 + hour * 60 + minute);
  const fault = engine.error !== null;
  const mode = fault ? "Fault" : engine.run ? "Run" : "Prog";
  return <div className="plc-toolbar" role="toolbar" aria-label="Verktyg" data-testid="plc-toolbar">
    <div className="plc-mode" role="status" aria-label={`Läge: ${mode}`} data-testid="plc-mode" data-mode={mode} title={engine.error ?? undefined}>
      <span className="plc-mode-item" data-on={engine.run && !fault}><Lamp tone="run" on={engine.run && !fault} />Run</span>
      <span className="plc-mode-item" data-on={!engine.run && !fault}><Lamp tone="prog" on={!engine.run && !fault} />Prog</span>
      <span className="plc-mode-item" data-on={fault}><Lamp tone="fault" on={fault} />Fault</span>
    </div>
    <span className="plc-tool-sep" />
    {/* Ljud first after the mode, so it is in reach on a phone too, where the rest of the row scrolls. */}
    <ToolButton label={sound === "on" ? "Ljud på: stäng av ljudet" : "Ljud av: slå på ljudet"} pressed={sound === "on"} onClick={() => chooseSound(sound === "on" ? "off" : "on")} data-testid="plc-sound" data-sound={sound}>{sound === "on" ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}</ToolButton>
    <span className="plc-tool-sep" />
    <ToolButton label="Markera (V)" pressed={tool === "select"} onClick={() => desk.set({ tool: "select" })} data-testid="plc-tool-select"><MousePointer2 aria-hidden="true" /></ToolButton>
    <ToolButton label="Ledning (L)" pressed={tool === "wire"} onClick={() => desk.set({ tool: "wire" })} data-testid="plc-tool-wire"><Cable aria-hidden="true" /></ToolButton>
    <ToolButton label="Redigera: flytta apparater och rita utan att hålla Ctrl" pressed={editLock} onClick={() => desk.set({ editLock: !editLock })} data-testid="plc-tool-edit"><Pencil aria-hidden="true" /><span>Redigera</span></ToolButton>
    <select className="plc-select" aria-label="Ny ledning ritas som" title="Ny ledning ritas som" data-testid="plc-wire-kind" value={wireKind} onChange={(event) => desk.set({ wireKind: event.target.value as WireKind })}>
      {WIRE_KINDS.map((kind) => <option key={kind} value={kind}>{kind === "auto" ? "Färg: följer nätet" : WIRE_KIND_LABELS[kind]}</option>)}
    </select>
    <ToolButton label="Mjuka ledningar" pressed={wireStyle === "soft"} onClick={() => chooseStyle("soft")} data-testid="plc-wire-soft"><Spline aria-hidden="true" /></ToolButton>
    <ToolButton label="Raka ledningar" pressed={wireStyle === "straight"} onClick={() => chooseStyle("straight")} data-testid="plc-wire-straight"><Waypoints aria-hidden="true" /></ToolButton>
    <span className="plc-tool-sep" />
    <ToolButton label="Zooma ut" onClick={() => desk.surface?.zoomOut()} data-testid="plc-zoom-out"><ZoomOut aria-hidden="true" /></ToolButton>
    <span className="plc-tool-label tabular-nums" style={{ minWidth: 38, textAlign: "center" }} data-testid="plc-zoom">{zoom} %</span>
    <ToolButton label="Zooma in" onClick={() => desk.surface?.zoomIn()} data-testid="plc-zoom-in"><ZoomIn aria-hidden="true" /></ToolButton>
    <ToolButton label="Anpassa: visa alla apparater" onClick={() => desk.surface?.fit()} data-testid="plc-zoom-fit"><Maximize2 aria-hidden="true" /></ToolButton>
    <span className="plc-tool-sep" />
    <ToolButton label={engine.run ? "STOP (F5)" : "RUN (F5)"} pressed={engine.run} onClick={actions.toggleRun} data-testid="plc-tool-run">{engine.run ? <Square aria-hidden="true" /> : <Play aria-hidden="true" />}<span>{engine.run ? "STOP" : "RUN"}</span></ToolButton>
    <ToolButton label="Kompilera (F7)" onClick={actions.compile} data-testid="plc-st-compile"><Wrench aria-hidden="true" /><span>Kompilera</span></ToolButton>
    <span className="plc-tool-sep" />
    <div role="radiogroup" aria-label="Hastighet" className="contents" data-testid="plc-surface-speed">
      {SPEEDS.map((speed) => <button key={speed} type="button" role="radio" aria-checked={engine.speed === speed} data-on={engine.speed === speed} className="plc-tool tabular-nums" onClick={() => runtime.setSpeed(speed as SurfaceSpeed)} data-testid={`plc-speed-${speed}`}>{speed}×</button>)}
    </div>
    <span className="plc-tool-sep" />
    <span className="plc-tool-label">Klocka</span>
    <select className="plc-select" aria-label="Veckodag" value={clock.weekday} onChange={(event) => setClock(Number(event.target.value), clock.hour, clock.minute)}>{WEEKDAYS.map((day, index) => <option key={day} value={index + 1}>{day.slice(0, 3)}</option>)}</select>
    <input type="time" className="plc-input" aria-label="Tid" style={{ width: 66 }} value={`${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}`} data-testid="plc-clock-time" onChange={(event) => { const [hour, minute] = event.target.value.split(":").map(Number); if (Number.isFinite(hour) && Number.isFinite(minute)) setClock(clock.weekday, hour, minute); }} />
    <span className="plc-tool-sep" />
    <label className="plc-tool-label" htmlFor="plc-outdoor">Ute</label>
    <input id="plc-outdoor" type="number" className="plc-input tabular-nums" aria-label="Utetemperatur" style={{ width: 48 }} min={-30} max={35} value={engine.plant.outdoorC} data-testid="plc-outdoor" onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) runtime.setOutdoorC(value); }} />
    <span className="plc-tool-label">°C</span>
  </div>;
}
