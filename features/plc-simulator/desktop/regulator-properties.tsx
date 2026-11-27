"use client";

import { useState } from "react";
import { DoorOpen, Play, Square } from "lucide-react";
import { MACHINE_SEVERITY_LABELS } from "@/lib/machine/place-status";
import type { MachineEventSeverity } from "@/lib/machine/intake";
import { pidProblem } from "@/lib/machine/simulator/pid";
import { PID_PROCESS_KINDS, PID_PROCESSES, type PidProcessKind } from "@/lib/machine/simulator/pid-loop";
import { useRuntimeSnapshot, useDesktop } from "./context";
import { ChromeButton, LabeledSelect } from "./controls";

// PLC-simulatorn, skrivbordet: the regulator's settings. They used to stand in the PID window beside its trend; the trend panel
// now holds only curves, and these belong to what they are settings of. The same regulator and the same alarms as before.

const SEVERITIES: MachineEventSeverity[] = ["warning", "fault", "critical"];
const numberText = (value: number) => value.toLocaleString("sv-SE", { maximumFractionDigits: 2 });
const typedNumber = (text: string) => { const value = Number(text.trim().replace(",", ".")); return text.trim() && Number.isFinite(value) ? value : null; };

/** Keeps what is being typed while it is the value's own; a value changed from elsewhere shows at once. */
function NumberInput({ id, label, value, onChange, min, max, help }: { id: string; label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; help?: string }) {
  const [edit, setEdit] = useState<{ text: string; value: number } | null>(null);
  const shown = edit && edit.value === value ? edit.text : numberText(value);
  return <label className="plc-field w-24" title={help}>
    <span className="truncate">{label}</span>
    <input id={id} className="plc-input w-full tabular-nums" inputMode="decimal" value={shown} onChange={(event) => {
      const typed = typedNumber(event.target.value);
      const accepted = typed !== null && (min === undefined || typed >= min) && (max === undefined || typed <= max);
      setEdit({ text: event.target.value, value: accepted ? typed : value });
      if (accepted) onChange(typed);
    }} />
  </label>;
}

export function RegulatorProperties() {
  const { runtime } = useDesktop();
  const { pid } = useRuntimeSnapshot();
  const def = PID_PROCESSES[pid.kind];
  const problem = pidProblem(pid.params);
  const setParam = (key: keyof typeof pid.params) => (value: number) => runtime.setPidParams({ ...pid.params, [key]: value });
  const setAlarm = (which: "high" | "low") => (limit: number) => runtime.setPidAlarm(which, { ...pid.alarmDefs[which], limit });
  const setBoth = (key: "hysteresis" | "delayS") => (value: number) => { runtime.setPidAlarm("high", { ...pid.alarmDefs.high, [key]: value }); runtime.setPidAlarm("low", { ...pid.alarmDefs.low, [key]: value }); };
  return <div className="space-y-2" data-testid="plc-pid-card">
    <div className="flex flex-wrap items-end gap-2">
      <LabeledSelect className="w-56" id="plc-pid-process" label="Process" value={pid.kind} options={PID_PROCESS_KINDS.map((kind) => ({ value: kind, label: PID_PROCESSES[kind].label }))} onChange={(event) => runtime.setPidKind(event.target.value as PidProcessKind)} />
      <ChromeButton onClick={() => runtime.setPidRunning(true)} disabled={pid.running || problem !== null} data-testid="plc-pid-run"><Play aria-hidden="true" />Kör</ChromeButton>
      <ChromeButton onClick={() => runtime.setPidRunning(false)} disabled={!pid.running} data-testid="plc-pid-stop"><Square aria-hidden="true" />Stopp</ChromeButton>
      <ChromeButton aria-pressed={pid.disturbed} tone={pid.disturbed ? "danger" : undefined} onClick={() => runtime.setPidDisturbed(!pid.disturbed)} data-testid="plc-pid-disturb"><DoorOpen aria-hidden="true" />{pid.disturbed ? def.undisturb : def.disturb}</ChromeButton>
      <span className="plc-help self-center tabular-nums" data-testid="plc-pid-values">Ärvärde <span data-testid="plc-pid-pv">{numberText(pid.pv)} {def.unit}</span> · utsignal <span data-testid="plc-pid-out">{numberText(pid.out)} %</span></span>
    </div>
    <fieldset className="flex flex-wrap items-end gap-2 border border-[var(--plc-line)] p-1.5">
      <legend className="px-1 font-semibold">Regulator</legend>
      <NumberInput id="plc-pid-setpoint" label={`Börvärde (${def.unit})`} value={pid.setpoint} onChange={runtime.setPidSetpoint} min={def.axisMin} max={def.axisMax} />
      <NumberInput id="plc-pid-kp" label="Kp" value={pid.params.kp} onChange={setParam("kp")} min={0} max={1000} />
      <NumberInput id="plc-pid-ti" label="Ti (s)" help="0 = ingen I-del." value={pid.params.tiS} onChange={setParam("tiS")} min={0} max={100_000} />
      <NumberInput id="plc-pid-td" label="Td (s)" help="0 = ingen D-del." value={pid.params.tdS} onChange={setParam("tdS")} min={0} max={10_000} />
      <LabeledSelect className="w-24" id="plc-pid-sample" label="Samplingstid" value={String(pid.sampleMs)} options={[{ value: "50", label: "50 ms" }, { value: "100", label: "100 ms" }, { value: "200", label: "200 ms" }, { value: "500", label: "500 ms" }, { value: "1000", label: "1 s" }]} onChange={(event) => runtime.setPidSampleMs(Number(event.target.value))} />
      <NumberInput id="plc-pid-noise" label="Brus (σ)" value={pid.noise} onChange={runtime.setPidNoise} min={0} max={20} />
      {pid.kind !== "oven" ? <NumberInput id="plc-pid-outdoor" label="Utetemperatur (°C)" value={pid.outdoorC} onChange={runtime.setPidOutdoorC} min={-40} max={40} /> : null}
      {problem ? <p className="w-full text-[var(--plc-fault)]" role="alert">{problem}</p> : null}
    </fieldset>
    <fieldset className="flex flex-wrap items-end gap-2 border border-[var(--plc-line)] p-1.5" data-testid="plc-pid-alarms">
      <legend className="px-1 font-semibold">Larmgränser</legend>
      <NumberInput id="plc-pid-high" label={`Hög gräns (${def.unit})`} value={pid.alarmDefs.high.limit} onChange={setAlarm("high")} />
      <NumberInput id="plc-pid-low" label={`Låg gräns (${def.unit})`} value={pid.alarmDefs.low.limit} onChange={setAlarm("low")} />
      <NumberInput id="plc-pid-hyst" label="Hysteres" help="Gäller båda." value={pid.alarmDefs.high.hysteresis} onChange={setBoth("hysteresis")} min={0} />
      <NumberInput id="plc-pid-delay" label="Fördröjning (s)" help="Gäller båda." value={pid.alarmDefs.high.delayS} onChange={setBoth("delayS")} min={0} />
      <LabeledSelect className="w-24" id="plc-pid-severity" label="Larmnivå" value={pid.severity} options={SEVERITIES.map((severity) => ({ value: severity, label: MACHINE_SEVERITY_LABELS[severity] }))} onChange={(event) => runtime.setPidSeverity(event.target.value as MachineEventSeverity)} />
      <p className="plc-help w-full">Fel och kritiskt går ut som varning tills du tillåter dem under Maskinkoppling.</p>
    </fieldset>
  </div>;
}
