import type { MachineEventSeverity } from "@/lib/machine/intake";
import { createLimitAlarmState, type LimitAlarmDef, type LimitAlarmState, stepLimitAlarm } from "@/lib/machine/simulator/limit-alarm";
import { createPidState, type PidParams, type PidState, stepPid } from "@/lib/machine/simulator/pid";
import {
  createHeatingState, createVentilationState, gaussianNoise, HEATING_DEFAULTS, stepHeating, stepTemperature, stepVentilation, TEMPERATURE_DEFAULTS, VENTILATION_DEFAULTS, type HeatingState, type VentilationState,
} from "@/lib/machine/simulator/process-models";
import type { AlarmChange } from "@/lib/machine/simulator/surface/engine";

// PLC-simulatorn (2026-11-02): the PID window's loop: a regulator on a simulated process, a trend, a
// disturbance, noise, and high/low alarms that become events. Three processes to choose from (2026-11-02: industry and
// building services alike): an oven, the supply air of a ventilation unit, a room on a heating circuit. Pure state and step.

export type PidProcessKind = "oven" | "supply" | "room";
export type PidProcessDef = {
  label: string; unit: string; setpoint: number; params: PidParams; sampleMs: number;
  high: number; low: number; hysteresis: number; delayS: number;
  /** The disturbance button's words. */
  disturb: string; undisturb: string;
  /** Where the trend's value axis starts and ends. */
  axisMin: number; axisMax: number;
};
export const PID_PROCESSES: Record<PidProcessKind, PidProcessDef> = {
  oven: { label: "Temperatur (ugn, industri)", unit: "°C", setpoint: 60, params: { kp: 3, tiS: 40, tdS: 2, outMin: 0, outMax: 100 }, sampleMs: 200, high: 75, low: 35, hysteresis: 2, delayS: 5, disturb: "Öppna dörren", undisturb: "Stäng dörren", axisMin: 0, axisMax: 120 },
  supply: { label: "Tilluftstemperatur (ventilation)", unit: "°C", setpoint: 18, params: { kp: 4, tiS: 60, tdS: 0, outMin: 0, outMax: 100 }, sampleMs: 500, high: 26, low: 12, hysteresis: 1, delayS: 10, disturb: "Kallare ute (−10 °C)", undisturb: "Normalt ute igen", axisMin: -10, axisMax: 40 },
  room: { label: "Rumstemperatur (värmesystem)", unit: "°C", setpoint: 21, params: { kp: 10, tiS: 300, tdS: 0, outMin: 0, outMax: 100 }, sampleMs: 1000, high: 25, low: 16, hysteresis: 0.5, delayS: 30, disturb: "Kallare ute (−10 °C)", undisturb: "Normalt ute igen", axisMin: 0, axisMax: 40 },
};
export const PID_PROCESS_KINDS: readonly PidProcessKind[] = ["oven", "supply", "room"];

export type PidLoopState = {
  kind: PidProcessKind;
  running: boolean;
  setpoint: number; pv: number; out: number;
  params: PidParams; sampleMs: number;
  /** Time since the last sample; the regulator runs on its sample time, the process on every tick. */
  sinceSampleMs: number;
  pid: PidState;
  noise: number;
  disturbed: boolean;
  outdoorC: number;
  oven: number; vent: VentilationState; heat: HeatingState;
  alarmDefs: { high: LimitAlarmDef; low: LimitAlarmDef };
  alarms: { high: LimitAlarmState; low: LimitAlarmState };
  severity: MachineEventSeverity;
  /** Seconds the loop has run, in simulated time. */
  t: number;
};

export function createPidLoop(kind: PidProcessKind): PidLoopState {
  const def = PID_PROCESSES[kind];
  const start = kind === "oven" ? TEMPERATURE_DEFAULTS.ambientC : kind === "supply" ? 15 : 19;
  return {
    kind, running: false, setpoint: def.setpoint, pv: start, out: 0, params: { ...def.params }, sampleMs: def.sampleMs, sinceSampleMs: 0, pid: createPidState(),
    noise: 0.2, disturbed: false, outdoorC: 0, oven: start, vent: { ...createVentilationState(21), supplyC: start, flow: 0.7 }, heat: { ...createHeatingState(start), flowC: 35 },
    alarmDefs: { high: { op: "gt", limit: def.high, hysteresis: def.hysteresis, delayS: def.delayS }, low: { op: "lt", limit: def.low, hysteresis: def.hysteresis, delayS: def.delayS } },
    alarms: { high: createLimitAlarmState(), low: createLimitAlarmState() }, severity: "fault", t: 0,
  };
}

export const PID_ALARM_CODES = { high: "PID-HOG", low: "PID-LAG" } as const;
export const pidAlarmText = (kind: PidProcessKind, which: "high" | "low", value: number) => `${PID_PROCESSES[kind].label}: ${which === "high" ? "över övre gräns" : "under undre gräns"} (${value.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} ${PID_PROCESSES[kind].unit})`;

/** The true process value, before noise. */
function processValue(state: PidLoopState) {
  return state.kind === "oven" ? state.oven : state.kind === "supply" ? state.vent.supplyC : state.heat.roomC;
}

export function stepPidLoop(state: PidLoopState, dtMs: number, random: () => number, nowMs: number): { state: PidLoopState; alarms: AlarmChange[] } {
  if (!state.running || !(dtMs > 0)) return { state, alarms: [] };
  const dtS = dtMs / 1000;
  const next = { ...state, t: state.t + dtS };
  const share = next.out / 100;
  const outdoor = next.outdoorC - (next.disturbed && next.kind !== "oven" ? 10 : 0);
  if (next.kind === "oven") next.oven = stepTemperature(next.oven, share, next.disturbed, TEMPERATURE_DEFAULTS, dtS);
  else if (next.kind === "supply") next.vent = stepVentilation(next.vent, { supplyFan: 0.7, extractFan: 0.7, coil: share, damper: 1, outdoorC: outdoor, roomC: 21 }, VENTILATION_DEFAULTS, dtS);
  else next.heat = stepHeating(next.heat, { pump: 1, shunt: share, source: 1, outdoorC: outdoor }, HEATING_DEFAULTS, dtS);
  next.sinceSampleMs += dtMs;
  if (next.sinceSampleMs >= next.sampleMs) {
    const sampleS = next.sinceSampleMs / 1000;
    next.sinceSampleMs = 0;
    next.pv = processValue(next) + gaussianNoise(random, next.noise);
    next.pid = stepPid(next.pid, next.params, next.setpoint, next.pv, sampleS);
    next.out = next.pid.out;
  }
  const alarms: AlarmChange[] = [];
  const alarmStates = { ...next.alarms };
  for (const which of ["high", "low"] as const) {
    const result = stepLimitAlarm(next.alarms[which], next.alarmDefs[which], next.pv, dtS);
    alarmStates[which] = result.state;
    if (result.change) alarms.push({ code: PID_ALARM_CODES[which], text: pidAlarmText(next.kind, which, next.pv), severity: next.severity, state: result.change, at: nowMs });
  }
  next.alarms = alarmStates;
  return { state: next, alarms };
}

/**
 * A long simulated step cut in the regulator's own samples, so 600× means the same regulation seen faster and not another one. Bounded:
 * a step that would need more than this many samples takes longer ones.
 */
const MAX_SUBSTEPS = 240;
export function advancePidLoop(state: PidLoopState, dtMs: number, random: () => number, nowMs: number): { state: PidLoopState; alarms: AlarmChange[] } {
  if (!state.running || !(dtMs > 0)) return { state, alarms: [] };
  const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(dtMs / state.sampleMs)));
  const alarms: AlarmChange[] = [];
  let current = state;
  for (let index = 0; index < steps; index += 1) {
    const step = stepPidLoop(current, dtMs / steps, random, nowMs);
    current = step.state;
    alarms.push(...step.alarms);
  }
  return { state: current, alarms };
}

export const alarmIsActive = (state: PidLoopState) => state.alarms.high.phase === "active" || state.alarms.low.phase === "active";
