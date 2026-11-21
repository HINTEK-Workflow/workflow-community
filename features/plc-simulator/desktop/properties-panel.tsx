"use client";

import { Copy, Trash2 } from "lucide-react";
import { DEVICE_DEFS, terminalName } from "@/lib/machine/simulator/surface/devices";
import { looseEnds } from "@/lib/machine/simulator/surface/edit";
import { type DeviceInst, isTerminalEnd, MAX_LABEL, type Wire, WIRE_KIND_LABELS, WIRE_KINDS, type WireKind } from "@/lib/machine/simulator/surface/layout";
import { RegulatorProperties } from "./regulator-properties";
import { useRuntimeSnapshot, useDesktop, useDeskState } from "./context";
import { designFor, settableOptions } from "@/lib/machine/simulator/surface/device-designs";
import { ChromeButton, LabeledInput, LabeledSelect } from "./controls";

// PLC-simulatorn, skrivbordet: Egenskaper. What the panel under the surface used to hold, for the selected device, wire or
// several things; with nothing selected, the regulator's settings when the tree asked for them. The settings belong to what they
// are settings of: the trend panel holds only curves.

/** "PLC DI0", "Start 13" (the device's name and the designation printed at its terminal) or "knutpunkt j1". */
function refLabel(end: Wire["from"], devices: readonly DeviceInst[]) {
  if (!isTerminalEnd(end)) return `knutpunkt ${end.junction}`;
  if (end.device === "plc") return `PLC ${end.terminal}`;
  const device = devices.find((candidate) => candidate.id === end.device);
  return device ? `${device.label || DEVICE_DEFS[device.kind].label} ${terminalName(DEVICE_DEFS[device.kind], device.options, end.terminal)}` : `${end.device}:${end.terminal}`;
}

export function PropertiesPanel() {
  const { runtime, desk } = useDesktop();
  const { selected, layout } = useRuntimeSnapshot();
  const { selectedCorner, propertiesOf } = useDeskState();
  const device = selected?.kind === "device" ? layout.devices.find((candidate) => candidate.id === selected.id) ?? null : null;
  const wire = selected?.kind === "wire" ? layout.wires.find((candidate) => candidate.id === selected.id) ?? null : null;
  const many = selected?.kind === "many" ? selected : null;
  return <div className="plc-scroll p-2" data-testid="plc-inspector">
    {device ? <div className="flex flex-wrap items-end gap-2">
      <LabeledInput className="w-44" id="plc-device-label" label={`${DEVICE_DEFS[device.kind].label}: text`} value={device.label} onChange={(event) => runtime.setDeviceLabel(device.id, event.target.value.slice(0, MAX_LABEL))} />
      {settableOptions(device, designFor(device)).map((option) => <LabeledSelect key={option.key} className="w-36" id={`plc-device-${option.key}`} label={option.label} value={device.options[option.key] ?? option.choices[0].value} options={option.choices} onChange={(event) => runtime.setDeviceOption(device.id, option.key, event.target.value)} />)}
      <ChromeButton onClick={() => desk.surface?.duplicate()} data-testid="plc-device-duplicate"><Copy aria-hidden="true" />Duplicera</ChromeButton>
      <ChromeButton tone="danger" onClick={() => runtime.removeDevice(device.id)} title="Delete eller Backspace tar också bort" data-testid="plc-device-remove"><Trash2 aria-hidden="true" />Ta bort</ChromeButton>
      <p className="plc-help w-full">{DEVICE_DEFS[device.kind].short}</p>
    </div> : wire ? <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-0">
        <p className="font-semibold">Ledning {wire.id}</p>
        <p className="plc-help">{refLabel(wire.from, layout.devices)} – {refLabel(wire.to, layout.devices)}{looseEnds(layout, wire).length ? " · lös ände" : ""}{selectedCorner?.wireId === wire.id ? ` · hörn ${selectedCorner.index + 1} markerat` : ""}</p>
      </div>
      <LabeledSelect className="w-36" id="plc-wire-kind-selected" label="Ritas som" value={wire.kind ?? "auto"} options={WIRE_KINDS.map((kind) => ({ value: kind, label: WIRE_KIND_LABELS[kind] }))} onChange={(event) => runtime.setWireKind(wire.id, event.target.value as WireKind)} />
      {selectedCorner?.wireId === wire.id ? <ChromeButton onClick={() => desk.surface?.remove()} data-testid="plc-corner-remove">Ta bort hörnet</ChromeButton> : null}
      {wire.points?.length ? <ChromeButton onClick={() => runtime.straightenWire(wire.id)} data-testid="plc-wire-straighten">Räta ut</ChromeButton> : null}
      <ChromeButton tone="danger" onClick={() => runtime.removeWire(wire.id)} aria-label="Ta bort ledningen" title="Delete eller Backspace tar också bort" data-testid="plc-wire-remove"><Trash2 aria-hidden="true" />Ta bort ledningen</ChromeButton>
    </div> : many ? <div className="flex flex-wrap items-center gap-2">
      <p className="plc-help" data-testid="plc-many-text">{many.devices.length} apparater och {many.wires.length} ledningar markerade.</p>
      {many.devices.length ? <ChromeButton onClick={() => desk.surface?.duplicate()} data-testid="plc-many-duplicate"><Copy aria-hidden="true" />Duplicera</ChromeButton> : null}
      <ChromeButton tone="danger" onClick={() => runtime.removeSelected()} title="Delete eller Backspace tar också bort" data-testid="plc-many-remove"><Trash2 aria-hidden="true" />Ta bort markeringen</ChromeButton>
    </div> : propertiesOf === "regulator" ? <RegulatorProperties />
      : <p className="plc-help">Klicka en apparat eller ledning på ritytan. Dubbelklicka Regulator (PID) i projektet för regulatorns inställningar.</p>}
  </div>;
}
