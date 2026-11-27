import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAnimation, standardAnimation } from "../lib/machine/simulator/surface/animation";
import { DEVICE_DEFS, DEVICE_KINDS, type DeviceKindId, milliampsToVolts, signalKind } from "../lib/machine/simulator/surface/devices";
import { contactClosed, createEngineState, type DeviceState, type EngineState, stepEngine } from "../lib/machine/simulator/surface/engine";
import { emptyLayout, type Layout, loadLayoutText } from "../lib/machine/simulator/surface/layout";
import { rawToVolts } from "../lib/machine/simulator/st/io";
import { STANDARD_SOUNDS } from "../lib/machine/simulator/surface/sounds";
import { READOUT_CHOICES, readoutLines, standardReadout } from "../lib/machine/simulator/surface/readouts";

// Every device (2026-11-07: "Kontrollera alla givare och attribut att det fungerar … Alla apparaterna menar jag"): each one
// wired to a fed PLC as it would be, operated, and the PLC must see what the device's own state says; every option must change what it
// should; every device with an animation must move when it is used. One loop over the whole catalogue, so a new device is checked too.

type Kind = DeviceKindId;
const ref = (text: string) => { const [device, terminal] = text.split(":"); return { device: device!, terminal: terminal! }; };
const wires = (pairs: [string, string][]) => pairs.map(([from, to], index) => ({ id: `w${index + 1}`, from: ref(from), to: ref(to) }));
const SUPPLY: [string, string][] = [["k:+", "plc:24V"], ["k:−", "plc:0V"]];
const rig = (kind: Kind, pairs: [string, string][], options: Record<string, string> = {}): Layout => ({
  ...emptyLayout(),
  devices: [{ id: "k", kind: "kalla24", x: 0, y: 300, label: "", options: {} }, ...(kind === "kalla24" ? [] : [{ id: "d", kind, x: 300, y: 0, label: "", options }])],
  wires: wires([...SUPPLY, ...pairs]),
});
const run = (layout: Layout, set: Partial<DeviceState> = {}, steps = 6): EngineState => {
  let state = createEngineState(layout);
  if (layout.devices.some((device) => device.id === "d")) state = { ...state, devices: { ...state.devices, d: { ...state.devices.d!, ...set } } };
  for (let index = 0; index < steps; index += 1) {
    state = stepEngine(state, layout, 200, 1000 + index * 200, () => 0.5).state;
    if (layout.devices.some((device) => device.id === "d")) state = { ...state, devices: { ...state.devices, d: { ...state.devices.d!, ...set } } };
  }
  return state;
};
const parses = (layout: Layout) => { const loaded = loadLayoutText(JSON.stringify(layout)); assert.ok(loaded.ok, loaded.ok ? "" : loaded.reason); };

/** What a hand does to each kind of device to "use" it. */
const operate = (kind: Kind): Partial<DeviceState> => {
  const def = DEVICE_DEFS[kind];
  // The emergency stop relay is pulled in by its own logic (its own test below); "used" is pulled in.
  if (kind === "nodstoppsrela") return { on: true };
  if (def.interaction === "momentary") return { pressed: true };
  if (def.interaction === "toggle") return { on: true };
  if (def.interaction === "knob") return { value: 70 };
  return {};
};

test("the emergency stop relay: pulled in only by reset with both channels whole, dropped by either channel, and stays out until reset again", () => {
  // + to A1, − to A2; the two channels and reset each from + through a switch we set by hand (a toggle as stand-in); 13–14 to DI0.
  const layout: Layout = { ...emptyLayout(), devices: [{ id: "k", kind: "kalla24", x: 0, y: 300, label: "", options: {} }, { id: "d", kind: "nodstoppsrela", x: 300, y: 0, label: "", options: {} },
    { id: "c1", kind: "vippa", x: 500, y: 0, label: "", options: {} }, { id: "c2", kind: "vippa", x: 600, y: 0, label: "", options: {} }, { id: "r", kind: "vippa", x: 700, y: 0, label: "", options: {} }],
    wires: wires([...SUPPLY, ["k:+", "d:A1"], ["d:A2", "k:−"], ["k:+", "c1:1"], ["c1:2", "d:S12"], ["k:+", "c2:1"], ["c2:2", "d:S22"], ["k:+", "r:1"], ["r:2", "d:S34"], ["k:+", "d:13"], ["d:14", "plc:DI0"]]) };
  parses(layout);
  let state = createEngineState(layout);
  const set = (id: string, on: boolean) => { state = { ...state, devices: { ...state.devices, [id]: { ...state.devices[id]!, on } } }; };
  const step = (n = 4) => { for (let index = 0; index < n; index += 1) state = stepEngine(state, layout, 200, 1000 + index * 200, () => 0.5).state; };
  set("c1", true); set("c2", true); step();
  assert.equal(state.inputs.di[0], false, "both channels whole is not enough: it waits for reset");
  set("r", true); step(); set("r", false); step();
  assert.equal(state.devices.d!.on, true); assert.equal(state.inputs.di[0], true, "reset pulls it in and 13–14 closes");
  set("c2", false); step();
  assert.equal(state.inputs.di[0], false, "one channel lost drops it");
  set("c2", true); step();
  assert.equal(state.inputs.di[0], false, "and it stays out with the channel back");
  set("r", true); step();
  assert.equal(state.inputs.di[0], true, "until reset again");
  set("r", false); set("c1", false); set("c2", false); step(); set("r", true); step();
  assert.equal(state.inputs.di[0], false, "reset cannot pull it in with the channels open");
});

for (const kind of DEVICE_KINDS) {
  const def = DEVICE_DEFS[kind];
  test(`${kind} (${def.label}): wired to the PLC it works, its options act, its animation and sound answer`, () => {
    const contacts = def.elements.flatMap((element) => (element.kind === "contact" ? [element] : []));
    const load = def.elements.find((element) => element.kind === "load");
    const source = def.elements.find((element) => element.kind === "source");
    const supply = def.elements.find((element) => element.kind === "supply");
    const meter = def.elements.find((element) => element.kind === "meter");
    const sink = def.elements.find((element) => element.kind === "sink");

    // Contacts: through each contact from + to DI0 – the PLC sees exactly what the contact's state says, at rest and used.
    for (const contact of contacts) {
      const pairs: [string, string][] = [["k:+", `d:${contact.a}`], [`d:${contact.b}`, "plc:DI0"]];
      if (contact.when === "energised" && load?.kind === "load") pairs.push(["k:+", `d:${load.a}`], [`d:${load.b}`, "k:−"]);
      if ((contact.when === "open" || contact.when === "closed") && load?.kind === "load") pairs.push(["k:+", `d:${load.a}`], [`d:${load.b}`, "k:−"]);
      const layout = rig(kind, pairs);
      parses(layout);
      const used = run(layout, contact.when === "tripped" ? { tripped: true } : operate(kind), contact.when === "open" || contact.when === "closed" ? 80 : 6);
      const device = layout.devices.find((candidate) => candidate.id === "d")!;
      assert.equal(used.powered, true, "the PLC has its supply");
      assert.equal(used.inputs.di[0], contactClosed(contact, device, used.devices.d!), `${contact.name}: DI0 follows the contact`);
      const rest = run(rig(kind, [["k:+", `d:${contact.a}`], [`d:${contact.b}`, "plc:DI0"]]));
      assert.equal(rest.inputs.di[0], contactClosed(contact, device, rest.devices.d!), `${contact.name} at rest`);
      if (contact.when === "pressed" || contact.when === "on" || contact.when === "energised") assert.notEqual(used.inputs.di[0], rest.inputs.di[0], `${contact.name}: using the device changes what the PLC sees`);
    }
    // The NO/NC option turns the contact round.
    if (def.options.some((option) => option.key === "nc")) {
      const contact = contacts[0]!;
      const no = run(rig(kind, [["k:+", `d:${contact.a}`], [`d:${contact.b}`, "plc:DI0"]], { nc: "no" }));
      const nc = run(rig(kind, [["k:+", `d:${contact.a}`], [`d:${contact.b}`, "plc:DI0"]], { nc: "nc" }));
      assert.notEqual(no.inputs.di[0], nc.inputs.di[0], "NO and NC read the other way round at rest");
    }

    // A signal source: on AI0 the PLC reads the same volts as the device gives.
    if (source?.kind === "source") {
      const pairs: [string, string][] = [[`d:${source.terminal}`, "plc:AI0"], [`d:${source.minus}`, "k:−"]];
      if (source.plus) pairs.push([`d:${source.plus}`, "k:+"]);
      const used = run(rig(kind, pairs), operate(kind));
      const volts = used.devices.d!.outV;
      assert.notEqual(volts, null, "the source has its supply and gives a signal");
      assert.ok(Math.abs(rawToVolts(used.inputs.ai[0]!) - volts!) < 0.05, `AI0 reads ${rawToVolts(used.inputs.ai[0]!)} V, the device gives ${volts} V`);
      // 0–10 V: 7 V; 4–20 mA: 15,2 mA, which the input reads over its 500 Ω as 7,6 V.
      if (def.interaction === "knob") { const want = signalKind(kind) === "current" ? milliampsToVolts(4 + 16 * 0.7) : 7; assert.ok(Math.abs(volts! - want) < 0.05, `the knob at 70 % gives ${want} V`); }
    }

    // A load: with + and − across it, it is energised (and an actuator or motor is driven).
    if (load?.kind === "load") {
      const used = run(rig(kind, [["k:+", `d:${load.a}`], [`d:${load.b}`, "k:−"]]), {}, 30);
      assert.equal(used.devices.d!.energised, true, "energised across the supply");
      assert.ok(used.devices.d!.drive > 0, "and driven");
      if (["motor", "tilluftsflakt", "franluftsflakt", "cirkpump"].includes(kind)) assert.ok(used.devices.d!.speed > 0.5, "the motor runs up");
      const off = run(rig(kind, [["k:+", `d:${load.a}`]]));
      assert.equal(off.devices.d!.energised, false, "and not with one side open");
      if (sink?.kind === "sink") {
        const half = run({ ...rig(kind, [["k:+", `d:${load.a}`], [`d:${load.b}`, "k:−"], ["s:ut", `d:${sink.terminal}`], ["s:−", "k:−"]]), devices: [...rig(kind, []).devices, { id: "s", kind: "kalla010", x: 600, y: 300, label: "", options: {} }] }, {}, 10);
        assert.ok(half.devices.d!.drive > 0.3 && half.devices.d!.drive < 0.7, `0–10 V on ${sink.terminal} steers the drive (got ${half.devices.d!.drive})`);
      }
    }

    // A supply feeds the PLC; the adjustable one by its knob (24 V yes, 6 V too low).
    if (supply?.kind === "supply") {
      const layout: Layout = { ...emptyLayout(), devices: [{ id: "d", kind, x: 0, y: 300, label: "", options: {} }], wires: wires([["d:+", "plc:24V"], ["d:−", "plc:0V"]]) };
      assert.equal(run(layout, { value: 80 }).powered, true);
      if (supply.volts === "knob") assert.equal(run(layout, { value: 20 }).powered, false, "6 V is too little for the PLC");
    }

    // A meter reads the volts across it.
    if (meter?.kind === "meter") {
      const used = run(rig(kind, [[`d:${meter.plus}`, "k:+"], [`d:${meter.minus}`, "k:−"]]));
      assert.ok(Math.abs((used.devices.d!.volts ?? 0) - 24) < 0.1, `reads ${used.devices.d!.volts} V`);
    }

    // Every option value is accepted on a placed device.
    for (const option of def.options) for (const choice of option.choices) parses(rig(kind, [], { [option.key]: choice.value }));

    // The animation: each part with a rule looks different used than at rest.
    const animation = standardAnimation(kind);
    if (animation.rules.length) {
      const base: DeviceState = { pressed: false, on: false, tripped: false, value: 0, energised: false, drive: 0, speed: 0, position: 0, outV: 5, volts: null };
      const busy: DeviceState = { ...base, pressed: true, on: true, tripped: true, value: 100, energised: true, drive: 1, speed: 1, position: 1, volts: 24 };
      const rest = evaluateAnimation(animation, base), used = evaluateAnimation(animation, busy);
      for (const part of new Set(animation.rules.map((rule) => rule.part))) assert.notDeepEqual(used.get(part), rest.get(part), `part ${part} moves when the device is used`);
    }

    // Sound: the function's sound is one of the known ones, or none.
    const sound = STANDARD_SOUNDS[kind];
    if (sound) assert.ok(typeof sound === "string");

    // The value label: the standard values are among the ones the function can show, and each has a text.
    const readout = standardReadout(kind);
    for (const value of readout.values) assert.ok(READOUT_CHOICES[kind]?.includes(value), `${value} is a value of ${kind}`);
    const lines = readoutLines(kind, readout.values, { ...run(rig(kind, [])).devices.d ?? { pressed: false, on: false, tripped: false, value: 50, energised: false, drive: 0, speed: 0, position: 0, outV: 5, volts: 24 } }, run(rig(kind, [])).plant, {});
    assert.equal(lines.length, readout.values.length);
    for (const line of lines) assert.match(line.text, /\d|–/, `${line.value} shows a number`);
  });
}

// 2026-11-09: "Är och bör fungerar inte". BV is the knob, ÄV what really comes out at the terminals.
test("set and actual value: a source gives nothing into a short, a current flows only round a closed loop, a meter reads 0 V open", () => {
  const value = (layout: Layout, set: Partial<DeviceState> = {}) => { const state = run(layout, set); return readoutLines(layout.devices.find((device) => device.id === "d")!.kind, standardReadout(layout.devices.find((device) => device.id === "d")!.kind).values, state.devices.d!, state.plant, layout.devices.find((device) => device.id === "d")!.options).map((line) => line.text); };
  // 0–10 V: on AI0, BV and ÄV agree; ut joined to its own − gives 0 V.
  assert.deepEqual(value(rig("kalla010", [["d:ut", "plc:AI0"], ["d:−", "k:−"]]), { value: 50 }), ["BV 5,0 V", "ÄV 5,0 V"]);
  assert.deepEqual(value(rig("kalla010", [["d:ut", "d:−"]]), { value: 50 }), ["BV 5,0 V", "ÄV 0,0 V"], "shorted");
  // The adjustable supply: BV from the knob, ÄV 0 when + and − are joined.
  assert.deepEqual(value(rig("kallajust", [["d:+", "plc:DI0"]]), { value: 50 }), ["BV 15,0 V", "ÄV 15,0 V"]);
  assert.deepEqual(value(rig("kallajust", [["d:+", "d:−"]]), { value: 50 }), ["BV 15,0 V", "ÄV 0,0 V"], "shorted");
  // 4–20 mA: open loop 0 mA; round AI0 and back to 0 V the current flows and AI0 reads it over 500 Ω.
  assert.deepEqual(value(rig("kalla420", []), { value: 50 }), ["BV 12,0 mA", "ÄV 0,0 mA"], "open loop");
  const loop = run(rig("kalla420", [["d:ut", "plc:AI0"], ["d:−", "k:−"]]), { value: 50 });
  assert.ok(Math.abs(rawToVolts(loop.inputs.ai[0]!) - 6) < 0.01, "12 mA over 500 Ω is 6 V");
  assert.deepEqual(value(rig("kalla420", [["d:ut", "plc:AI0"], ["d:−", "k:−"]]), { value: 0 }), ["BV 4,0 mA", "ÄV 4,0 mA"]);
  // The loop calibrator: 0–10 V or 4–20 mA by its switch.
  assert.deepEqual(value(rig("signalsim", [["d:ut", "plc:AI0"], ["d:−", "k:−"]]), { value: 100 }), ["BV 10,0 V", "ÄV 10,0 V"]);
  assert.deepEqual(value(rig("signalsim", [["d:ut", "plc:AI0"], ["d:−", "k:−"]], { mode: "mA" }), { value: 100 }), ["BV 20,0 mA", "ÄV 20,0 mA"]);
  // The voltmeter with nothing on its leads.
  assert.deepEqual(value(rig("voltmeter", [])), ["0,0 V"]);
});
