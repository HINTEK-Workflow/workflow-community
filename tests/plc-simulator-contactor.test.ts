import assert from "node:assert/strict";
import test from "node:test";
import { compileProgram } from "../lib/machine/simulator/st/interpreter";
import { DEVICE_DEFS } from "../lib/machine/simulator/surface/devices";
import { createEngineState, stepEngine } from "../lib/machine/simulator/surface/engine";
import { SURFACE_EXAMPLES } from "../lib/machine/simulator/surface/examples";
import { emptyLayout, type Layout, loadLayoutText } from "../lib/machine/simulator/surface/layout";

// The contactor (the owner 2026-11-05): the coil and auxiliary contacts that really switch, and a plain connection to the motor. No three-phase.

const ref = (text: string) => { const [device, terminal] = text.split(":"); return { device, terminal }; };
const wires = (pairs: [string, string][]) => pairs.map(([from, to], index) => ({ id: `w${index + 1}`, from: ref(from), to: ref(to) }));
const device = (id: string, kind: Layout["devices"][number]["kind"], x: number, y: number) => ({ id, kind, x, y, label: "", options: {} });

/** Power, a switch on the coil, a lamp on 13–14 and a lamp on 21–22: nothing but the contacts drives the lamps. */
const rig = (): Layout => ({
  ...emptyLayout(),
  devices: [device("k", "kalla24", 0, 300), device("s", "vippa", 0, 0), device("q", "kontaktor", 400, 0), device("no", "lampa", 300, 300), device("nc", "lampa", 500, 300), device("m", "motor", 700, 300)],
  wires: wires([["k:+", "plc:24V"], ["k:−", "plc:0V"], ["k:+", "s:1"], ["s:2", "q:A1"], ["q:A2", "k:−"], ["k:+", "q:13"], ["q:14", "no:X1"], ["no:X2", "k:−"], ["k:+", "q:21"], ["q:22", "nc:X1"], ["nc:X2", "k:−"], ["k:+", "q:1"], ["q:2", "m:U1"], ["m:U2", "k:−"]]),
});

const settle = (layout: Layout, on: boolean) => {
  let state = createEngineState(layout);
  state = { ...state, devices: { ...state.devices, s: { ...state.devices.s, on } } };
  for (let index = 0; index < 5; index += 1) state = stepEngine(state, layout, 100, 1000 + index * 100, () => 0.5).state;
  return state;
};

test("the contactor has a coil, a contact to the motor and two auxiliary contacts, and no three-phase terminals", () => {
  const ids = DEVICE_DEFS.kontaktor.terminals.map((terminal) => terminal.id);
  assert.deepEqual(ids, ["A1", "A2", "1", "2", "13", "14", "21", "22"]);
  for (const name of ["L1", "L2", "L3", "T1", "T2", "T3", "3", "4", "5", "6"]) assert.ok(!ids.includes(name), name);
});

test("the auxiliary contacts really switch, and the motor runs when the contactor pulls", () => {
  const off = settle(rig(), false);
  assert.equal(off.devices.q.energised, false);
  assert.equal(off.devices.no.energised, false, "13–14 is open at rest");
  assert.equal(off.devices.nc.energised, true, "21–22 is closed at rest");
  assert.equal(off.devices.m.energised, false);
  const on = settle(rig(), true);
  assert.equal(on.devices.q.energised, true);
  assert.equal(on.devices.no.energised, true, "13–14 closes");
  assert.equal(on.devices.nc.energised, false, "21–22 opens");
  assert.equal(on.devices.m.energised, true, "the motor runs through 1–2");
});

test("a drawing saved before the new contacts opens, with its wires and its running result", () => {
  const example = SURFACE_EXAMPLES.find((candidate) => candidate.id === "start-stopp")!;
  const old = JSON.stringify(example.layout);
  const loaded = loadLayoutText(old);
  assert.ok(loaded.ok, "it opens");
  if (!loaded.ok) return;
  assert.deepEqual(loaded.layout.wires.map((wire) => wire.id), example.layout.wires.map((wire) => wire.id));
  assert.ok(compileProgram(loaded.layout.program).ok);
});
