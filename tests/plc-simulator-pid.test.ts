import assert from "node:assert/strict";
import test from "node:test";
import { seededRandom } from "../lib/machine/simulator/random";
import { createLimitAlarmState, stepLimitAlarm } from "../lib/machine/simulator/limit-alarm";
import { createPidState, PID_DEFAULTS, pidProblem, presetPid, stepPid, type PidParams } from "../lib/machine/simulator/pid";
import { alarmIsActive, createPidLoop, PID_PROCESS_KINDS, PID_PROCESSES, stepPidLoop, } from "../lib/machine/simulator/pid-loop";
import {
  createHeatingState, createVentilationState, HEATING_DEFAULTS, heatingCurve, MOTOR_DEFAULTS, stepHeating, stepMotorSpeed, stepTank, stepTemperature, stepVentilation, TANK_DEFAULTS, TEMPERATURE_DEFAULTS, VENTILATION_DEFAULTS,
} from "../lib/machine/simulator/process-models";

// PLC-simulatorn, Grundläggande (2026-11-02): the regulator, the alarm limits, the small processes and the PID window's loop.

const params: PidParams = { kp: 2, tiS: 10, tdS: 0, outMin: 0, outMax: 100 };

test("PID: proportional alone, the integral walks the error away, limits hold, and the integral never winds up past a limit", () => {
  const p = stepPid(createPidState(), { ...params, tiS: 0 }, 50, 40, 1);
  assert.equal(p.out, 20, "Kp × error");
  assert.equal(p.integral, 0);
  // A first-order plant under the loop settles on the setpoint with an integral.
  let state = createPidState();
  let pv = 20;
  for (let index = 0; index < 600; index += 1) { state = stepPid(state, params, 50, pv, 0.5); pv += ((20 + 0.6 * state.out - pv) / 20) * 0.5; }
  assert.ok(Math.abs(pv - 50) < 0.5, `settled near 50: ${pv}`);
  // Far from the setpoint the output sits on the limit and the integral does not grow.
  let saturated = createPidState();
  for (let index = 0; index < 100; index += 1) saturated = stepPid(saturated, params, 100, 0, 1);
  assert.equal(saturated.out, 100);
  assert.ok(saturated.integral <= 0.01, `no wind-up: ${saturated.integral}`);
  // Once the value crosses the setpoint, the output leaves the limit at once instead of after unwinding.
  const back = stepPid(saturated, params, 100, 110, 1);
  assert.ok(back.out < 100);
  assert.equal(stepPid(createPidState(), params, 0, 100, 1).out, 0, "lower limit");
  const untouched = createPidState();
  assert.equal(stepPid(untouched, params, 50, 40, 0), untouched, "a zero step changes nothing");
});

test("PID: the derivative acts on the measurement, so a setpoint step gives no kick; direct action inverts; preset is bumpless", () => {
  const withD: PidParams = { ...params, tiS: 0, tdS: 5 };
  let state = stepPid(createPidState(), withD, 50, 40, 1);
  const stepped = stepPid(state, withD, 80, 40, 1);
  assert.equal(stepped.out, 80, "a setpoint step is only Kp × error");
  state = stepPid(stepped, withD, 80, 45, 1);
  assert.ok(state.out < 70, `a rising measurement pulls the output down: ${state.out}`);
  const cooling = stepPid(createPidState(), { ...params, tiS: 0, direct: true }, 20, 30, 1);
  assert.equal(cooling.out, 20, "direct: above the setpoint raises the output");
  const preset = presetPid(createPidState(), params, 40);
  assert.equal(preset.out, 40);
  assert.equal(stepPid(preset, params, 50, 50, 1).out, 40, "no error: the preset output stays");
  assert.equal(pidProblem(PID_DEFAULTS), null);
  assert.match(pidProblem({ ...params, tiS: -1 }) ?? "", /negativa/);
  assert.match(pidProblem({ ...params, outMin: 5, outMax: 5 }) ?? "", /skilja/);
});

test("limit alarm: delay before raising, hysteresis before clearing, and a value that leaves early never raises", () => {
  const def = { op: "gt" as const, limit: 50, hysteresis: 2, delayS: 1 };
  let state = createLimitAlarmState();
  let step = stepLimitAlarm(state, def, 55, 0.5);
  assert.equal(step.change, null);
  assert.equal(step.state.phase, "pending");
  step = stepLimitAlarm(step.state, def, 55, 0.5);
  assert.equal(step.change, null, "half a second into the delay");
  step = stepLimitAlarm(step.state, def, 55, 0.5);
  assert.equal(step.change, "raised");
  step = stepLimitAlarm(step.state, def, 49, 0.5);
  assert.equal(step.change, null, "within the hysteresis band it stays active");
  step = stepLimitAlarm(step.state, def, 47.9, 0.5);
  assert.equal(step.change, "cleared");
  state = stepLimitAlarm(createLimitAlarmState(), def, 55, 0.5).state;
  assert.equal(stepLimitAlarm(state, def, 40, 0.5).change, null, "left before the delay ran out");
  const low = { op: "lt" as const, limit: 10, hysteresis: 1, delayS: 0 };
  assert.equal(stepLimitAlarm(createLimitAlarmState(), low, 9, 0.1).change, "raised");
});

test("process models: tank, oven, motor, ventilation, heating and the curve behave and stay within bounds", () => {
  let level = 20;
  for (let index = 0; index < 60; index += 1) level = stepTank(level, 1, 0, TANK_DEFAULTS, 1);
  assert.ok(level > 20 && level <= 100, `the pump fills: ${level}`);
  for (let index = 0; index < 600; index += 1) level = stepTank(level, 1, 0, TANK_DEFAULTS, 1);
  assert.ok(level <= 100);
  for (let index = 0; index < 600; index += 1) level = stepTank(level, 0, 1, TANK_DEFAULTS, 1);
  assert.ok(level >= 0 && level < 5, `the valve empties: ${level}`);
  let temp = 20;
  for (let index = 0; index < 400; index += 1) temp = stepTemperature(temp, 1, false, TEMPERATURE_DEFAULTS, 1);
  assert.ok(Math.abs(temp - 100) < 1, `full power settles at ambient + gain: ${temp}`);
  const opened = stepTemperature(temp, 1, true, TEMPERATURE_DEFAULTS, 1);
  assert.ok(opened < temp, "an open door loses heat");
  assert.equal(stepTemperature(50, 1, false, TEMPERATURE_DEFAULTS, 0), 50);
  let speed = 0;
  for (let index = 0; index < 20; index += 1) speed = stepMotorSpeed(speed, 1, MOTOR_DEFAULTS, 0.5);
  assert.ok(speed > 0.95 && speed <= 1);
  let vent = createVentilationState(21);
  for (let index = 0; index < 600; index += 1) vent = stepVentilation(vent, { supplyFan: 1, extractFan: 1, coil: 0, damper: 1, outdoorC: -10, roomC: 21 }, VENTILATION_DEFAULTS, 1);
  assert.ok(Math.abs(vent.supplyC - (-10 + 0.75 * 31)) < 0.5, `recovery alone: ${vent.supplyC}`);
  assert.ok(vent.filterPa > VENTILATION_DEFAULTS.cleanPa, "the filter clogs with running time");
  const stopped = stepVentilation(vent, { supplyFan: 0, extractFan: 0, coil: 1, damper: 1, outdoorC: -10, roomC: 21 }, VENTILATION_DEFAULTS, 600);
  assert.ok(stopped.flow < 0.01 && Math.abs(stopped.supplyC - 21) < 1, "standing still the duct takes the room's temperature");
  let heat = createHeatingState(15);
  for (let index = 0; index < 6000; index += 1) heat = stepHeating(heat, { pump: 1, shunt: 0.5, source: 1, outdoorC: -5 }, HEATING_DEFAULTS, 1);
  assert.ok(heat.flowC > 30 && heat.roomC > 15 && heat.roomC < 40, `a heated house: flow ${heat.flowC}, room ${heat.roomC}`);
  let cold = createHeatingState(21);
  for (let index = 0; index < 6000; index += 1) cold = stepHeating(cold, { pump: 0, shunt: 0, source: 0, outdoorC: -5 }, HEATING_DEFAULTS, 1);
  assert.ok(cold.roomC < 5, "without heating the room cools toward outdoors");
  const curve = { coldOutC: -20, coldFlowC: 60, warmOutC: 15, warmFlowC: 25 };
  assert.equal(heatingCurve(-20, curve), 60);
  assert.equal(heatingCurve(15, curve), 25);
  assert.equal(heatingCurve(30, curve), 25, "held at the warm end");
  assert.equal(heatingCurve(-2.5, curve), 42.5);
});

test("the PID window: every process runs, the trend is bounded, a limit near the value raises an alarm that reaches the list once", () => {
  for (const kind of PID_PROCESS_KINDS) {
    const def = PID_PROCESSES[kind];
    let loop = { ...createPidLoop(kind), running: true, noise: 0 };
    const random = seededRandom(1);
    for (let index = 0; index < 20 * 60 * 5; index += 1) loop = stepPidLoop(loop, 50, random, index * 50).state;
    assert.ok(Math.abs(loop.pv - def.setpoint) < 3, `${kind}: near its setpoint after five minutes: ${loop.pv}`);
    assert.ok(loop.out >= 0 && loop.out <= 100);
  }
  let loop = { ...createPidLoop("oven"), running: true, noise: 0 };
  const random = seededRandom(2);
  for (let index = 0; index < 20 * 60 * 3; index += 1) loop = stepPidLoop(loop, 50, random, index * 50).state;
  loop = { ...loop, alarmDefs: { ...loop.alarmDefs, high: { ...loop.alarmDefs.high, limit: loop.pv - 5, delayS: 1 } } };
  const raised = [];
  for (let index = 0; index < 60; index += 1) { const step = stepPidLoop(loop, 50, random, index * 50); loop = step.state; raised.push(...step.alarms); }
  assert.equal(raised.filter((alarm) => alarm.state === "raised").length, 1);
  assert.equal(raised[0].code, "PID-HOG");
  assert.equal(raised[0].severity, "fault");
  assert.ok(alarmIsActive(loop));
  const stopped = { ...loop, running: false };
  assert.equal(stepPidLoop(stopped, 50, random, 0).state, stopped, "stopped: nothing moves");
});
