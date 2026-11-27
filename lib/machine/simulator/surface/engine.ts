import type { MachineEventSeverity } from "@/lib/machine/intake";
import {
  createHeatingState, createVentilationState, HEATING_DEFAULTS, MOTOR_DEFAULTS, stepHeating, stepMotorSpeed, stepTank, stepTemperature, stepVentilation, TANK_DEFAULTS, TEMPERATURE_DEFAULTS,
  VENTILATION_DEFAULTS, type HeatingState, type VentilationState,
} from "@/lib/machine/simulator/process-models";
import { carryRunState, type Compiled, type CompileProblem, createRunState, runCycle, type RunState, type Value } from "@/lib/machine/simulator/st/interpreter";
import { emptyInputs, emptyOutputs, ioName, PLC_IO, type PlcClock, type PlcInputs, type PlcOutputs, voltsToRaw } from "@/lib/machine/simulator/st/io";
import { checkDrawing, type Finding } from "./check";
import { DEVICE_DEFS, type DeviceKindId, type Element, knobSignal, knobVolts, milliampsToVolts, optionValue, rangeToVolts, SENSOR_RANGES, signalKind } from "./devices";
import { type DeviceInst, type Layout, wiresAtTerminal } from "./layout";
import { analogVoltsOf, bonded, energised, ON_VOLTS, plcTerminalKey, PLC_SUPPLY_TEXT, potential, SHORT_CIRCUIT_TEXT, solveNets, type Solved, supplyVoltsOf, voltageBetween } from "./wiring";

// PLC-simulatorn: the cycle of the drawing surface. Each tick reads the devices into the PLC's inputs through the
// wiring, runs the program when the switch is on RUN, writes the outputs back through the wiring, moves the small processes
// and raises alarms from the alarm outputs. Pure: state in, state out, with the clock and the random source as arguments.
// Speed (2026-11-02: a speedable clock for schedules) scales the simulated clock, the processes and the program's
// timers alike, so a TON of T#60s and the room it waits for move together at 600×. The measured cycle time is real time.
// v3 (2026-11-03): external supplies, a voltage threshold instead of "has 24 V", the drawing check every cycle, and a hard
// finding (short, overvoltage on the PLC, two outputs joined while one is on) stops the run and lights ERR as a short did.
// The PLC itself is fed through L+ and M (2026-11-03): without supply it reads nothing, drives nothing and cannot run.

export const TICK_MS = 50;
export { PLC_SUPPLY_TEXT, SHORT_CIRCUIT_TEXT };
export const SPEEDS = [1, 10, 60, 600] as const;
export type SurfaceSpeed = (typeof SPEEDS)[number];
export const WEEKDAYS = ["Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag", "Söndag"] as const;

export type DeviceState = {
  /** A button held, a switch on, a fire alarm or thermostat tripped. */
  pressed: boolean; on: boolean; tripped: boolean;
  /** The knob 0–100. */
  value: number;
  energised: boolean;
  /** The actuator's effective share 0–1: on/off, or the signal on `styr`. */
  drive: number;
  /** A motor's or fan's speed, a damper's position, 0–1. */
  speed: number; position: number;
  /** What a sensor puts on `ut`, or null when it has no supply. */
  outV: number | null;
  /** The voltage across the load, what a meter reads, or what a supply gives; null when nothing is known. */
  volts: number | null;
};
export type Plant = { tank: number; ovenC: number; vent: VentilationState; heat: HeatingState; outdoorC: number; doorOpen: boolean };
export type AlarmChange = { code: string; text: string; severity: MachineEventSeverity; state: "raised" | "cleared"; at: number };
export type EngineState = {
  devices: Record<string, DeviceState>;
  plant: Plant;
  /** Minutes since Monday 00:00 of the simulated week. */
  clockMin: number;
  speed: SurfaceSpeed;
  inputs: PlcInputs; outputs: PlcOutputs;
  solved: Solved;
  /** What the drawing check found this cycle, errors first. */
  findings: Finding[];
  run: boolean;
  /** The PLC has supply on L+ and M (`solved.plcPowered`); false means dark: no RUN, inputs 0, outputs off. */
  powered: boolean;
  /** The red lamp's reason: a short, a hard finding, a runtime fault. Null when all is well. */
  error: string | null;
  compiled: Compiled | null; program: RunState | null;
  /** The program's variables as the cycle began, so a Ladder view can show the flow the cycle saw. */
  varsBefore: Record<string, Value> | null;
  /** Measured time of the last program cycle and the longest so far. */
  cycleMs: number; cycleMaxMs: number;
  activeAlarms: Record<string, boolean>;
  /** Tags forced from the tag editor while running. Empty when none; a stop takes them all away. */
  forces: Record<string, Value>;
};

export const createDeviceState = (): DeviceState => ({ pressed: false, on: false, tripped: false, value: 50, energised: false, drive: 0, speed: 0, position: 0, outV: null, volts: null });

export function plcClock(clockMin: number): PlcClock {
  const minutes = ((Math.floor(clockMin) % (7 * 1440)) + 7 * 1440) % (7 * 1440);
  return { weekday: Math.floor(minutes / 1440) + 1, hour: Math.floor((minutes % 1440) / 60), minute: minutes % 60 };
}
export const clockText = (clockMin: number) => { const clock = plcClock(clockMin); return `${WEEKDAYS[clock.weekday - 1]} ${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}`; };
/** Monday 06:00: the schedules in the examples start soon after. */
export const START_CLOCK_MIN = 5 * 60 + 50;

export function createEngineState(layout: Layout, speed: SurfaceSpeed = 1): EngineState {
  const devices: Record<string, DeviceState> = {};
  for (const device of layout.devices) devices[device.id] = createDeviceState();
  const plant: Plant = { tank: 20, ovenC: TEMPERATURE_DEFAULTS.ambientC, vent: createVentilationState(21), heat: createHeatingState(21), outdoorC: layout.outdoorC, doorOpen: false };
  const outputs = emptyOutputs();
  const solved = solveNets(layout, { closed: new Set(), sourceVolts: new Map(), outputs, supplyVolts: supplyVoltsOf(layout, (id) => devices[id]?.value ?? 50) });
  return { devices, plant, clockMin: START_CLOCK_MIN, speed, inputs: emptyInputs(plcClock(START_CLOCK_MIN)), outputs, solved, findings: checkDrawing(layout, solved, outputs), run: false, powered: solved.plcPowered, error: null, compiled: null, program: null, varsBefore: null, cycleMs: 0, cycleMaxMs: 0, activeAlarms: {}, forces: {} };
}

/** Whether a contact is closed, from the device's own state and the element's rule. */
export function contactClosed(element: Extract<Element, { kind: "contact" }>, device: DeviceInst, state: DeviceState) {
  const base = element.when === "pressed" ? state.pressed : element.when === "on" ? state.on : element.when === "energised" ? state.energised : element.when === "tripped" ? state.tripped : element.when === "open" ? state.position >= 0.99 : state.position <= 0.01;
  if (element.invert === true) return !base;
  if (element.invert === "nc-option") return base !== (optionValue(DEVICE_DEFS[device.kind], device.options, "nc") === "nc");
  return base;
}

/** Which contacts are closed, from the devices' own states before this cycle. A contactor's contacts follow the coil one cycle later, as the real one needs a moment to pull in. */
function closedContacts(layout: Layout, devices: Record<string, DeviceState>): Set<string> {
  const closed = new Set<string>();
  for (const device of layout.devices) {
    const state = devices[device.id] ?? createDeviceState();
    for (const element of DEVICE_DEFS[device.kind].elements) if (element.kind === "contact" && contactClosed(element, device, state)) closed.add(`${device.id}:${element.name}`);
  }
  return closed;
}

/** What a sensor measures right now, in its own unit. */
export function sensorReading(kind: DeviceKindId, plant: Plant, state: DeviceState): number | null {
  if (kind === "vred" || kind === "kalla010") return state.value / 10;
  const range = SENSOR_RANGES[kind];
  if (!range) return null;
  switch (range.reads) {
    case "tank": return plant.tank;
    case "oven": return plant.ovenC;
    case "supply": return plant.vent.supplyC;
    case "extract": return plant.vent.extractC;
    case "outdoor": return plant.outdoorC;
    case "room": return plant.heat.roomC;
    case "flow": return plant.heat.flowC;
    case "filter": return plant.vent.filterPa;
  }
}
export const sensorUnit = (kind: DeviceKindId) => (kind === "vred" || kind === "kalla010" ? "V" : SENSOR_RANGES[kind]?.unit ?? "");

function sensorVolts(kind: DeviceKindId, plant: Plant, state: DeviceState): number | null {
  if (kind === "vred" || kind === "kalla010") return state.value / 10;
  const range = SENSOR_RANGES[kind];
  const reading = sensorReading(kind, plant, state);
  return range && reading !== null ? rangeToVolts(reading, range) : null;
}

/** Sources with their supply in place (+ against − at least ON_VOLTS), or self-powered; else the sensor is dead and gives nothing (a "givarfel" to find). */
function sourceVolts(layout: Layout, plant: Plant, devices: Record<string, DeviceState>, powered: Solved): Map<string, number> {
  const volts = new Map<string, number>();
  for (const device of layout.devices) {
    for (const element of DEVICE_DEFS[device.kind].elements) {
      if (element.kind !== "source") continue;
      const state = devices[device.id] ?? createDeviceState();
      const signal = signalKind(device.kind, device.options);
      if (signal === "current") {
        // A current flows only round a closed loop: ut on an analog input, − on the PLC's 0 V. The input reads it over its 500 Ω.
        const loop = currentLoopClosed(powered, device.id, element.terminal, element.minus);
        if (loop) volts.set(`${device.id}:${element.terminal}`, milliampsToVolts(knobSignal(device.kind, device.options, state.value)));
        continue;
      }
      if (signal === "volts" && element.plus === null) { volts.set(`${device.id}:${element.terminal}`, knobSignal(device.kind, device.options, state.value)); continue; }
      const hasSupply = element.plus === null || (voltageBetween(powered, `${device.id}:${element.plus}`, `${device.id}:${element.minus}`) ?? 0) >= ON_VOLTS;
      const value = hasSupply ? sensorVolts(device.kind, plant, state) : null;
      if (value !== null) volts.set(`${device.id}:${element.terminal}`, value);
    }
  }
  return volts;
}

/** A current loop is closed when the source's signal terminal shares a net with one of the PLC's analog inputs and its − lies on the PLC's 0 V. */
export function currentLoopClosed(solved: Solved, deviceId: string, terminal: string, minus: string): boolean {
  const out = solved.netOf.get(`${deviceId}:${terminal}`), back = solved.netOf.get(`${deviceId}:${minus}`);
  if (!out || !back || out === back) return false;
  const toInput = Array.from({ length: PLC_IO.ai }, (_, index) => solved.netOf.get(plcTerminalKey(ioName({ kind: "AI", index })))).some((net) => net === out);
  return toInput && back === solved.netOf.get(plcTerminalKey("0V"));
}

/**
 * What really stands on a source's output (ÄV, 2026-11-09: "Är och bör fungerar inte"): a supply gives nothing into a short; a
 * signal source gives nothing when its output is joined to its own − or to a 0 V; a current source gives its current only round a closed
 * loop (as volts over the input's 500 Ω); a sensor gives what it measures once it has supply. Null: no output at all.
 */
function actualOutput(solved: Solved, device: DeviceInst, given: number | null): number | null {
  const def = DEVICE_DEFS[device.kind];
  const supply = def.elements.find((element) => element.kind === "supply");
  if (supply?.kind === "supply") {
    const plus = solved.netOf.get(`${device.id}:${supply.plus}`), minus = solved.netOf.get(`${device.id}:${supply.minus}`);
    return plus && (plus === minus || plus.short) ? 0 : given;
  }
  const source = def.elements.find((element) => element.kind === "source");
  if (source?.kind !== "source") return null;
  if (given === null) return signalKind(device.kind, device.options) === "current" ? 0 : null;
  const out = solved.netOf.get(`${device.id}:${source.terminal}`), minus = solved.netOf.get(`${device.id}:${source.minus}`);
  if (signalKind(device.kind, device.options) === "volts" && out && (out === minus || out.minus.some((pole) => bonded(solved, pole.source, device.id)))) return 0;
  return given;
}

/** What the inputs see: a DI is 1 from ON_VOLTS against M, an AI reads 0–10 V against M; a PLC without supply reads nothing. */
function readInputs(solved: Solved, clock: PlcClock): PlcInputs {
  if (!solved.plcPowered) return { ...emptyInputs(clock), clock };
  const di = Array.from({ length: PLC_IO.di }, (_, index) => (potential(solved, plcTerminalKey(ioName({ kind: "DI", index }))) ?? 0) >= ON_VOLTS);
  const ai = Array.from({ length: PLC_IO.ai }, (_, index) => voltsToRaw(analogVoltsOf(solved, plcTerminalKey(ioName({ kind: "AI", index })))));
  return { di, ai, clock };
}

const maxOf = (values: number[]) => (values.length ? Math.max(...values) : 0);

export type StepResult = { state: EngineState; alarms: AlarmChange[] };

export function stepEngine(stateIn: EngineState, layout: Layout, dtMs: number, nowMs: number, measure: () => number = () => 0): StepResult {
  const devices: Record<string, DeviceState> = {};
  for (const device of layout.devices) devices[device.id] = stateIn.devices[device.id] ?? createDeviceState();
  const plant = { ...stateIn.plant };
  const dtS = dtMs / 1000;
  const simDtS = dtS * stateIn.speed;
  const clockMin = stateIn.clockMin + (dtMs / 60_000) * stateIn.speed;
  const clock = plcClock(clockMin);
  const supplyVolts = supplyVoltsOf(layout, (id) => devices[id]?.value ?? 50);

  // 1. The electrical picture with last cycle's outputs: who has supply, what the inputs see.
  const closed = closedContacts(layout, devices);
  const powered = solveNets(layout, { closed, sourceVolts: new Map(), outputs: stateIn.outputs, supplyVolts });
  const sources = sourceVolts(layout, plant, devices, powered);
  const beforeProgram = solveNets(layout, { closed, sourceVolts: sources, outputs: stateIn.outputs, supplyVolts });
  const inputs = readInputs(beforeProgram, clock);
  const hasSupply = beforeProgram.plcPowered;

  // 2. The program, when the PLC has supply, the switch is on RUN and the code compiled. Losing supply ends the run quietly: no ERR, the display says so.
  let outputs = emptyOutputs();
  let program = stateIn.program;
  let varsBefore = stateIn.varsBefore;
  let run = stateIn.run && hasSupply;
  let error = stateIn.error;
  let cycleMs = 0;
  if (run && stateIn.compiled && program) {
    const started = measure();
    varsBefore = program.vars;
    const result = runCycle(stateIn.compiled, program, inputs, dtMs * stateIn.speed, stateIn.forces);
    cycleMs = Math.max(0, measure() - started);
    if (result.problem) { run = false; error = `Rad ${result.problem.line}: ${result.problem.message}`; program = result.state; }
    else { program = result.state; outputs = result.outputs; }
  }

  // 3. The picture with this cycle's outputs, and the check of it: a hard finding stops everything and lights ERR.
  let solved = solveNets(layout, { closed, sourceVolts: sources, outputs, supplyVolts });
  let findings = checkDrawing(layout, solved, outputs);
  const hard = solved.shortText ?? findings.find((finding) => finding.stops)?.text.replace(/\.$/, "") ?? null;
  if (hard) {
    run = false; error = hard; outputs = emptyOutputs();
    solved = solveNets(layout, { closed, sourceVolts: sources, outputs, supplyVolts });
    // The findings that explain the stop stay; the picture is drawn without the outputs.
    if (!findings.some((finding) => finding.stops)) findings = checkDrawing(layout, solved, outputs);
  }

  // 4. Devices: energised loads, drives, speeds, positions and readings.
  const kinds = (kind: DeviceKindId) => layout.devices.filter((device) => device.kind === kind);
  const drive = (device: DeviceInst) => devices[device.id].drive;
  for (const device of layout.devices) {
    const state = { ...devices[device.id] };
    const def = DEVICE_DEFS[device.kind];
    const loadElement = def.elements.find((element) => element.kind === "load");
    state.energised = loadElement?.kind === "load" ? energised(solved, device.id, loadElement.a, loadElement.b) : false;
    state.volts = loadElement?.kind === "load" ? voltageBetween(solved, `${device.id}:${loadElement.a}`, `${device.id}:${loadElement.b}`) : null;
    const meter = def.elements.find((element) => element.kind === "meter");
    if (meter?.kind === "meter") state.volts = voltageBetween(solved, `${device.id}:${meter.plus}`, `${device.id}:${meter.minus}`);
    const supply = def.elements.find((element) => element.kind === "supply");
    if (supply?.kind === "supply") state.volts = supply.volts === "knob" ? knobVolts(device.kind, state.value) : supply.volts;
    const sink = def.elements.find((element) => element.kind === "sink");
    if (sink?.kind === "sink") {
      const key = `${device.id}:${sink.terminal}`;
      const connected = wiresAtTerminal(layout, { device: device.id, terminal: sink.terminal }).length > 0;
      state.drive = state.energised ? (connected ? analogVoltsOf(solved, key) / 10 : 1) : 0;
    } else state.drive = state.energised ? 1 : 0;
    if (device.kind === "varmekalla" && optionValue(def, device.options, "sort") === "varmepump") state.drive = Math.round(state.drive * 2) / 2;
    if (device.kind === "motor" || device.kind === "tilluftsflakt" || device.kind === "franluftsflakt" || device.kind === "cirkpump") state.speed = stepMotorSpeed(state.speed, state.drive, MOTOR_DEFAULTS, simDtS);
    if (device.kind === "spjall") state.position = Math.min(1, Math.max(0, state.position + (state.energised ? 1 : -1) * (simDtS / 10)));
    if (device.kind === "nodstoppsrela") {
      // Both channels at 24 V against A2, and reset's rising edge pulls it in; a channel lost or no supply drops it (state.pressed holds reset's last level).
      const at = (terminal: string) => (voltageBetween(solved, `${device.id}:${terminal}`, `${device.id}:A2`) ?? 0) >= ON_VOLTS;
      const channels = at("S12") && at("S22"), reset = at("S34");
      if (!state.energised || !channels) state.on = false;
      else if (reset && !state.pressed) state.on = true;
      state.pressed = reset;
    }
    if (device.kind === "frysvakt") {
      const limit = Number(optionValue(def, device.options, "limitC"));
      if (plant.vent.supplyC < limit) state.tripped = true;
      else if (plant.vent.supplyC > limit + 3) state.tripped = false;
    }
    state.outV = supply?.kind === "supply" ? actualOutput(solved, device, state.volts) : actualOutput(solved, device, sources.get(`${device.id}:ut`) ?? null);
    devices[device.id] = state;
  }

  // 5. The processes, in simulated time. Every device of a kind acts on the one plant: the strongest counts.
  plant.tank = stepTank(plant.tank, maxOf(kinds("motor").map((device) => devices[device.id].speed)), maxOf(kinds("ventil").map(drive)), TANK_DEFAULTS, simDtS);
  plant.ovenC = stepTemperature(plant.ovenC, maxOf(kinds("varmare").map(drive)), plant.doorOpen, TEMPERATURE_DEFAULTS, simDtS);
  const dampers = kinds("spjall");
  plant.vent = stepVentilation(plant.vent, {
    supplyFan: maxOf(kinds("tilluftsflakt").map((device) => devices[device.id].speed)), extractFan: maxOf(kinds("franluftsflakt").map((device) => devices[device.id].speed)),
    coil: maxOf(kinds("varmebatteri").map(drive)), damper: dampers.length ? maxOf(dampers.map((device) => devices[device.id].position)) : 1, outdoorC: plant.outdoorC, roomC: plant.heat.roomC,
  }, VENTILATION_DEFAULTS, simDtS);
  // Without a heating circuit on the drawing the house has its own heating: the room stays at 21 °C instead of cooling to the outdoor temperature.
  const heated = kinds("cirkpump").length > 0 || kinds("varmekalla").length > 0 || kinds("shunt").length > 0;
  plant.heat = heated
    ? stepHeating(plant.heat, { pump: maxOf(kinds("cirkpump").map((device) => devices[device.id].speed)), shunt: maxOf(kinds("shunt").map(drive)), source: maxOf(kinds("varmekalla").map(drive)), outdoorC: plant.outdoorC }, HEATING_DEFAULTS, simDtS)
    : createHeatingState(21);

  // 6. Alarm outputs: a change is an event, locally and, when connected, to Workflow.
  const activeAlarms: Record<string, boolean> = {};
  const alarms: AlarmChange[] = [];
  for (const device of kinds("larm")) {
    const active = devices[device.id].energised;
    activeAlarms[device.id] = active;
    if (active !== (stateIn.activeAlarms[device.id] ?? false)) {
      alarms.push({ code: alarmCode(device.id), text: device.label || DEVICE_DEFS.larm.label, severity: optionValue(DEVICE_DEFS.larm, device.options, "severity") as MachineEventSeverity, state: active ? "raised" : "cleared", at: nowMs });
    }
  }

  return { state: { ...stateIn, devices, plant, clockMin, inputs, outputs, solved, findings, run, powered: hasSupply, error, program, varsBefore, cycleMs, cycleMaxMs: Math.max(stateIn.cycleMaxMs, cycleMs), activeAlarms }, alarms };
}

/** `larm-2` → `LARM-2`: a code the intake accepts, from the device's id. */
export const alarmCode = (deviceId: string) => deviceId.toUpperCase().replace(/[^A-Z0-9_-]/g, "-").slice(0, 64);

/** The switch to RUN: with a compiled program the cycle starts from fresh variables; without one, or without supply, nothing starts. */
export function startRun(state: EngineState, compiled: Compiled): EngineState {
  if (!state.powered) return state;
  const program = createRunState(compiled);
  return { ...state, run: true, error: null, compiled, program, varsBefore: program.vars, cycleMaxMs: 0 };
}
export function stopRun(state: EngineState): EngineState {
  return { ...state, run: false, outputs: emptyOutputs(), forces: {} };
}
/** Verifiera while running: the new program takes over at the next cycle without a stop; what it shares with the old one keeps its value. */
export function reloadRun(state: EngineState, compiled: Compiled): EngineState {
  if (!state.run || !state.compiled || !state.program) return { ...state, compiled };
  const program = carryRunState(compiled, state.program, state.compiled);
  const forces = Object.fromEntries(Object.entries(state.forces).filter(([name]) => compiled.vars.has(name)));
  return { ...state, compiled, program, varsBefore: program.vars, forces };
}
/** A tag forced to a value, or let go with null. Only in RUN: at a stop every force goes. */
export function forceTag(state: EngineState, name: string, value: Value | null): EngineState {
  if (!state.run && value !== null) return state;
  const forces = { ...state.forces };
  if (value === null) delete forces[name]; else forces[name] = value;
  return { ...state, forces };
}
export const compileProblemText = (problem: CompileProblem) => `Rad ${problem.line}, kolumn ${problem.col}: ${problem.message}`;

/** The person's hand on a device. */
export function touchDevice(state: EngineState, deviceId: string, change: Partial<Pick<DeviceState, "pressed" | "on" | "value" | "tripped">>): EngineState {
  const current = state.devices[deviceId];
  if (!current) return state;
  const value = change.value === undefined ? current.value : Math.min(100, Math.max(0, change.value));
  return { ...state, devices: { ...state.devices, [deviceId]: { ...current, ...change, value } } };
}
