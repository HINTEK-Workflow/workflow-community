// PLC-simulatorn (2026-11-02): the small processes behind the field devices on the drawing surface and in
// the PID card. Each is a first-order model advanced by one pure function, exact for any step length, so a slow browser tab
// gives the same curve as a fast one. The numbers are made up for play and are not any real plant's.

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
/** How far a first-order system moves toward its target in one step of `dtS` with time constant `tauS`. */
const approach = (value: number, target: number, tauS: number, dtS: number) => (tauS <= 0 ? target : value + (target - value) * (1 - Math.exp(-dtS / tauS)));

export type TankParams = {
  /** Percent of the tank the pump fills per second at full flow. */
  fillPerS: number;
  /** Percent per second that leaves through an open valve when the tank is full; the flow falls with the level. */
  drainPerS: number;
  /** A steady loss, percent per second, so a level does not stay put for ever (0 for a closed tank). */
  leakPerS: number;
};
export const TANK_DEFAULTS: TankParams = { fillPerS: 4, drainPerS: 6, leakPerS: 0.3 };

/** Level 0–100 %. `pump` is the pump's share 0–1 (a plain motor is 0 or 1), `valve` the drain valve's opening 0–1. */
export function stepTank(level: number, pump: number, valve: number, params: TankParams, dtS: number): number {
  if (!(dtS > 0)) return level;
  const inflow = params.fillPerS * clamp(pump, 0, 1);
  const outflow = (params.drainPerS * clamp(valve, 0, 1) + params.leakPerS) * Math.sqrt(clamp(level, 0, 100) / 100);
  return clamp(level + (inflow - outflow) * dtS, 0, 100);
}

export type TemperatureParams = {
  /** Where the temperature settles with the heater off and the door shut. */
  ambientC: number;
  /** Degrees above ambient at full heater power. */
  gainC: number;
  /** Seconds to settle; the heater and the loss share it. */
  tauS: number;
  /** An open door: the temperature pulls toward ambient this many times faster and loses this many degrees of reach. */
  doorLossC: number;
};
export const TEMPERATURE_DEFAULTS: TemperatureParams = { ambientC: 20, gainC: 80, tauS: 40, doorLossC: 25 };

/** `power` is the heater's share 0–1. `doorOpen` is the disturbance button in the PID card. */
export function stepTemperature(tempC: number, power: number, doorOpen: boolean, params: TemperatureParams, dtS: number): number {
  if (!(dtS > 0)) return tempC;
  const target = params.ambientC + params.gainC * clamp(power, 0, 1) - (doorOpen ? params.doorLossC : 0);
  return approach(tempC, target, doorOpen ? params.tauS / 3 : params.tauS, dtS);
}

export type MotorParams = { tauS: number };
export const MOTOR_DEFAULTS: MotorParams = { tauS: 1.5 };

/** Speed 0–1. `drive` is 0 or 1 for a contactor-fed motor, or an analog share 0–1 for a drive. */
export function stepMotorSpeed(speed: number, drive: number, params: MotorParams, dtS: number): number {
  if (!(dtS > 0)) return speed;
  return clamp(approach(speed, clamp(drive, 0, 1), params.tauS, dtS), 0, 1);
}

/** Gaussian noise from a 0–1 source; the simulator seeds its own, so nothing here reaches for a global source of randomness. */
export const gaussianNoise = (random: () => number, sigma: number) => (sigma > 0 ? sigma * Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random()) : 0);

// ---------- building services (2026-11-02: vaktmästare and fastighetstekniker use the system too) ----------

export type VentilationState = { supplyC: number; extractC: number; flow: number; filterPa: number; dirt: number };
export type VentilationInputs = {
  /** Fan speeds 0–1; the flow follows the faster fan, so a unit with one fan still moves air. */
  supplyFan: number; extractFan: number;
  /** The heating coil's valve 0–1. */
  coil: number;
  /** The outdoor damper 0–1: shut, no outdoor air reaches the coil. */
  damper: number;
  outdoorC: number;
  roomC: number;
};
export type VentilationParams = {
  /** Heat recovery: the share of the room-to-outdoor difference the exchanger gives back. */
  recovery: number;
  /** Degrees the coil adds at full valve and full flow. */
  coilGainC: number;
  tauS: number;
  /** Pressure over a clean filter at full flow. */
  cleanPa: number;
  /** How fast the filter clogs: added to `dirt` per second at full flow (1 = pressure doubled). */
  dirtPerS: number;
};
export const VENTILATION_DEFAULTS: VentilationParams = { recovery: 0.75, coilGainC: 30, tauS: 25, cleanPa: 120, dirtPerS: 1 / 1800 };
export const createVentilationState = (roomC: number): VentilationState => ({ supplyC: roomC, extractC: roomC, flow: 0, filterPa: 0, dirt: 0 });

export function stepVentilation(state: VentilationState, inputs: VentilationInputs, params: VentilationParams, dtS: number): VentilationState {
  if (!(dtS > 0)) return state;
  const flow = approach(state.flow, clamp(Math.max(inputs.supplyFan, inputs.extractFan), 0, 1), 3, dtS);
  const damper = clamp(inputs.damper, 0, 1);
  // Standing still, the air in the duct takes the room's temperature; running, it is outdoor air warmed by the exchanger and the coil.
  const fresh = flow > 0.02 && damper > 0.02;
  const target = fresh ? inputs.outdoorC + params.recovery * (inputs.roomC - inputs.outdoorC) + params.coilGainC * clamp(inputs.coil, 0, 1) : inputs.roomC;
  const supplyC = approach(state.supplyC, target, fresh ? params.tauS : params.tauS * 4, dtS);
  const extractC = approach(state.extractC, inputs.roomC, params.tauS, dtS);
  const dirt = Math.min(4, state.dirt + params.dirtPerS * flow * dtS);
  // Roughly linear in the flow through the filter medium; the dirt multiplies it, up to five times the clean pressure.
  const filterPa = params.cleanPa * flow * (1 + dirt);
  return { supplyC, extractC, flow, filterPa, dirt };
}

export type HeatingState = { flowC: number; roomC: number };
export type HeatingInputs = {
  /** Circulation pump 0–1. */
  pump: number;
  /** Shunt valve 0–1: how much hot water from the source is mixed in. */
  shunt: number;
  /** The heat source's share 0–1 (0 or 1 for an electric boiler, steps for a heat pump). */
  source: number;
  outdoorC: number;
};
export type HeatingParams = {
  /** Water temperature from the source at full output. */
  sourceC: number;
  tauFlowS: number;
  /** Room heating: degrees per second per degree of flow-to-room difference, with the pump running. */
  radiatorPerS: number;
  /** Room loss: degrees per second per degree of room-to-outdoor difference. */
  lossPerS: number;
};
export const HEATING_DEFAULTS: HeatingParams = { sourceC: 70, tauFlowS: 60, radiatorPerS: 1 / 1400, lossPerS: 1 / 1500 };
export const createHeatingState = (roomC: number): HeatingState => ({ flowC: roomC, roomC });

export function stepHeating(state: HeatingState, inputs: HeatingInputs, params: HeatingParams, dtS: number): HeatingState {
  if (!(dtS > 0)) return state;
  const pump = clamp(inputs.pump, 0, 1);
  const hot = inputs.outdoorC + (params.sourceC - inputs.outdoorC) * clamp(inputs.source, 0, 1);
  // The return water is cooler than the flow by what the radiators gave off; the shunt mixes return and source water.
  const returnC = state.roomC + 0.6 * (state.flowC - state.roomC);
  const target = pump > 0.02 ? returnC + clamp(inputs.shunt, 0, 1) * (Math.max(hot, returnC) - returnC) : state.roomC;
  const flowC = approach(state.flowC, target, params.tauFlowS, dtS);
  const roomC = state.roomC + (pump * params.radiatorPerS * (flowC - state.roomC) - params.lossPerS * (state.roomC - inputs.outdoorC)) * dtS;
  return { flowC, roomC: clamp(roomC, -40, 60) };
}

/** A plain outdoor-compensation curve: flow setpoint from the outdoor temperature, a straight line between two points, held at the ends. */
export function heatingCurve(outdoorC: number, curve: { coldOutC: number; coldFlowC: number; warmOutC: number; warmFlowC: number }): number {
  if (curve.warmOutC === curve.coldOutC) return curve.coldFlowC;
  const share = clamp((outdoorC - curve.coldOutC) / (curve.warmOutC - curve.coldOutC), 0, 1);
  return curve.coldFlowC + share * (curve.warmFlowC - curve.coldFlowC);
}
