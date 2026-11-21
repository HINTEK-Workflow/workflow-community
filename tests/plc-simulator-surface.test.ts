import assert from "node:assert/strict";
import test from "node:test";
import { parseEvent } from "../lib/machine/intake";
import { createEventFactory, SAFE_POLICY } from "../lib/machine/simulator/events";
import { compileProgram } from "../lib/machine/simulator/st/interpreter";
import { checkDrawing, findingsSummary, PLC_FEED_TEXT } from "../lib/machine/simulator/surface/check";
import { DEVICE_DEFS, DEVICE_KINDS, deviceMatches, devicesInGroup, terminalName, terminalTitle } from "../lib/machine/simulator/surface/devices";
import { connectWire, hitAt, moveSegment, moveWireEnd, removeDevices, removeWires, routesOf, splitWire } from "../lib/machine/simulator/surface/edit";
import { alarmCode, clockText, createEngineState, type EngineState, plcClock, PLC_SUPPLY_TEXT, SHORT_CIRCUIT_TEXT, startRun, START_CLOCK_MIN, stepEngine, touchDevice } from "../lib/machine/simulator/surface/engine";
import { SURFACE_EXAMPLES } from "../lib/machine/simulator/surface/examples";
import { bendsOfRoute, contentBounds, deviceTerminalPoint, junctionsById, plcTerminalPoint, suggestPlace, terminalPoint, wireRoute } from "../lib/machine/simulator/surface/geometry";
import { defaultLabel, emptyLayout, exportLayoutText, freeDeviceId, importLayoutText, type Layout, loadLayoutText, PLC_TERMINALS, startLayout, SUPPLY_LABEL, SURFACE_FILE_VERSION, validateLayout, type Wire, withSupply } from "../lib/machine/simulator/surface/layout";
import { WireRouter } from "../lib/machine/simulator/surface/route";
import { devicesById, solveNets, voltageBetween, wireColour } from "../lib/machine/simulator/surface/wiring";
import { isTerminalEnd } from "../lib/machine/simulator/surface/layout";

// PLC-simulatorn, Grundläggande (2026-11-02): the drawing surface's electrical picture and cycle, pure, without a browser.
// v3 (2026-11-03): orthogonal routes, junctions, external supplies, the drawing check, the wire tool's operations, and a
// version 1 drawing that still opens and behaves as it did.

const START = Date.parse("2026-11-02T08:00:00.000Z");
const ref = (text: string) => { const [device, terminal] = text.split(":"); return { device, terminal }; };
const wiresOf = (pairs: [string, string][]): Wire[] => pairs.map(([from, to], index) => ({ id: `w${index + 1}`, from: from.startsWith("@") ? { junction: from.slice(1) } : ref(from), to: to.startsWith("@") ? { junction: to.slice(1) } : ref(to) }));
/** A drawing for a test: the devices and wires given, plus the 24 V DC source wired to the PLC's L+ and M (as the start drawing has it), unless the test brings its own source. Wires to plc:24V/plc:0V thus sit on the source's nets. */
const layoutWith = (devices: Layout["devices"], pairs: [string, string][], program = "", junctions: Layout["junctions"] = []): Layout => {
  const bare: Layout = { ...emptyLayout(), devices, wires: wiresOf(pairs), junctions, program };
  return devices.some((candidate) => candidate.kind === "kalla24" || candidate.kind === "kallajust") ? bare : withSupply(bare);
};
const device = (id: string, kind: Layout["devices"][number]["kind"], options: Record<string, string> = {}, x = 100, y = 100) => ({ id, kind, x, y, label: id, options });

function run(state: EngineState, layout: Layout, ticks: number, nowMs = START) {
  let current = state;
  const alarms = [];
  for (let index = 0; index < ticks; index += 1) { const result = stepEngine(current, layout, 50, nowMs + index * 50); current = result.state; alarms.push(...result.alarms); }
  return { state: current, alarms };
}
const program = (source: string) => { const result = compileProgram(source); assert.ok(result.ok, result.ok ? "" : result.problem.message); return result.compiled; };
const codes = (state: EngineState) => state.findings.map((finding) => finding.id.split(":")[0]);
const loud = (state: EngineState) => state.findings.filter((finding) => finding.level !== "info").map((finding) => finding.text);
const orthogonal = (route: readonly { x: number; y: number }[]) => route.every((point, index) => index === 0 || point.x === route[index - 1].x || point.y === route[index - 1].y);
const OFF = { do: Array(8).fill(false), ao: [0, 0] };

test("a button between +24 V and DI gives the input 1; wired to 0 V it gives 0; a lamp between DO and 0 V lights", () => {
  const layout = layoutWith([device("knapp-1", "knapp"), device("knapp-2", "knapp"), device("lampa-1", "lampa")], [["plc:24V", "knapp-1:1"], ["knapp-1:2", "plc:DI0"], ["plc:0V", "knapp-2:1"], ["knapp-2:2", "plc:DI1"], ["plc:DO0", "lampa-1:X1"], ["lampa-1:X2", "plc:0V"]], "VAR DI0 : BOOL; DI1 : BOOL; DO0 : BOOL; END_VAR DO0 := DI0 OR DI1;");
  let state = startRun(createEngineState(layout), program(layout.program));
  state = run(state, layout, 2).state;
  assert.equal(state.inputs.di[0], false);
  assert.equal(state.devices["lampa-1"].energised, false);
  state = touchDevice(state, "knapp-1", { pressed: true });
  state = run(state, layout, 2).state;
  assert.equal(state.inputs.di[0], true, "pressed: +24 V reaches DI0");
  assert.equal(state.outputs.do[0], true);
  assert.equal(state.devices["lampa-1"].energised, true, "the lamp lights");
  assert.equal(state.devices["lampa-1"].volts, 24, "24 V across it");
  state = touchDevice(state, "knapp-1", { pressed: false });
  state = touchDevice(state, "knapp-2", { pressed: true });
  state = run(state, layout, 2).state;
  assert.equal(state.inputs.di[1], false, "a button to 0 V never gives 1");
  assert.equal(state.devices["lampa-1"].energised, false);
  assert.equal(state.error, null);
  assert.equal(state.run, true);
});

test("a short between +24 V and 0 V lights ERR with its words and stops the run; the wires are marked", () => {
  const layout = layoutWith([device("lampa-1", "lampa")], [["plc:24V", "lampa-1:X1"], ["lampa-1:X2", "plc:0V"], ["plc:24V", "plc:0V"]], "VAR DO0 : BOOL; END_VAR DO0 := TRUE;");
  const state = run(startRun(createEngineState(layout), program(layout.program)), layout, 1).state;
  assert.equal(state.error, SHORT_CIRCUIT_TEXT);
  assert.equal(state.run, false);
  assert.ok(state.solved.shortedWires.has("w3"));
  assert.deepEqual(state.outputs.do, Array(8).fill(false), "every output is dropped");
  assert.ok(state.findings.some((finding) => finding.level === "error" && finding.stops && finding.wires.includes("w3")), "the check names the short");
  // A DO that is on, wired straight to 0 V, is a short as well.
  const outputShort = layoutWith([], [["plc:DO0", "plc:0V"]], "VAR DO0 : BOOL; END_VAR DO0 := TRUE;");
  assert.equal(run(startRun(createEngineState(outputShort), program(outputShort.program)), outputShort, 1).state.error, SHORT_CIRCUIT_TEXT);
  // The same wiring with the output off is no short at all.
  const quiet = { ...outputShort, program: "VAR DO0 : BOOL; END_VAR DO0 := FALSE;" };
  assert.equal(run(startRun(createEngineState(quiet), program(quiet.program)), quiet, 2).state.error, null);
});

test("a sensor needs its supply: without + and − it gives nothing, which a program can call a sensor fault", () => {
  const good = layoutWith([device("nivagivare-1", "nivagivare")], [["plc:24V", "nivagivare-1:+"], ["nivagivare-1:−", "plc:0V"], ["nivagivare-1:ut", "plc:AI0"]]);
  const dead = layoutWith([device("nivagivare-1", "nivagivare")], [["nivagivare-1:ut", "plc:AI0"]]);
  const fed = run(createEngineState(good), good, 2).state;
  assert.ok(fed.inputs.ai[0] > 1000 && fed.inputs.ai[0] < 3000, `20 % level reads about 2 V: ${fed.inputs.ai[0]}`);
  assert.equal(fed.devices["nivagivare-1"].outV !== null, true);
  const unfed = run(createEngineState(dead), dead, 2).state;
  assert.equal(unfed.inputs.ai[0], 0);
  assert.equal(unfed.devices["nivagivare-1"].outV, null);
  assert.ok(codes(unfed).includes("no-supply"), "the check says the sensor lacks its supply");
  // Swapped + and −: dead, and told why.
  const swapped = layoutWith([device("nivagivare-1", "nivagivare")], [["plc:0V", "nivagivare-1:+"], ["nivagivare-1:−", "plc:24V"], ["nivagivare-1:ut", "plc:AI0"]]);
  assert.ok(codes(run(createEngineState(swapped), swapped, 2).state).includes("polarity"));
});

test("a contactor's coil closes its contacts one cycle later, and the motor behind it spins up", () => {
  const example = SURFACE_EXAMPLES.find((candidate) => candidate.id === "start-stopp")!;
  const layout = example.layout;
  let state = startRun(createEngineState(layout), program(layout.program));
  state = touchDevice(state, "knapp-1", { pressed: true });
  state = run(state, layout, 3).state;
  state = touchDevice(state, "knapp-1", { pressed: false });
  state = run(state, layout, 60).state;
  assert.equal(state.devices["kontaktor-1"].energised, true);
  assert.equal(state.devices["motor-1"].energised, true, "fed through the main contact");
  assert.ok(state.devices["motor-1"].speed > 0.5, `the motor spins: ${state.devices["motor-1"].speed}`);
  assert.equal(state.devices["lampa-1"].energised, true);
  state = touchDevice(state, "knapp-2", { pressed: true });
  state = run(state, layout, 3).state;
  assert.equal(state.devices["motor-1"].energised, false, "Stopp breaks the holding");
});

test("a relay's changeover contact, an illuminated button's lamp and the new switches follow their rules", () => {
  const layout = layoutWith(
    [device("rela-1", "rela"), device("lampa-1", "lampa"), device("lampa-2", "lampa"), device("knapp-lampa-1", "knapp_lampa"), device("valjare-1", "valjare"), device("gransbrytare-1", "gransbrytare", { nc: "nc" })],
    [["plc:DO0", "rela-1:A1"], ["rela-1:A2", "plc:0V"], ["plc:24V", "rela-1:11"], ["rela-1:14", "lampa-1:X1"], ["lampa-1:X2", "plc:0V"], ["rela-1:12", "lampa-2:X1"], ["lampa-2:X2", "plc:0V"],
      ["plc:24V", "knapp-lampa-1:1"], ["knapp-lampa-1:2", "plc:DI0"], ["plc:DO1", "knapp-lampa-1:X1"], ["knapp-lampa-1:X2", "plc:0V"],
      ["plc:24V", "valjare-1:1"], ["valjare-1:2", "plc:DI1"], ["plc:24V", "gransbrytare-1:1"], ["gransbrytare-1:2", "plc:DI2"]],
    "VAR DI0 : BOOL; DI1 : BOOL; DO0 : BOOL; DO1 : BOOL; END_VAR DO0 := DI1; DO1 := NOT DI0;");
  let state = run(startRun(createEngineState(layout), program(layout.program)), layout, 3).state;
  assert.equal(state.devices["lampa-2"].energised, true, "NC contact 11–12 feeds lamp 2 at rest");
  assert.equal(state.devices["lampa-1"].energised, false);
  assert.equal(state.devices["knapp-lampa-1"].energised, true, "the button's lamp is lit by DO1 while the button is up");
  assert.equal(state.inputs.di[2], true, "an NC limit switch at rest gives 1");
  state = touchDevice(state, "valjare-1", { on: true });
  state = touchDevice(state, "knapp-lampa-1", { pressed: true });
  state = touchDevice(state, "gransbrytare-1", { on: true });
  state = run(state, layout, 4).state;
  assert.equal(state.devices["lampa-1"].energised, true, "coil drawn: 11–14 closed");
  assert.equal(state.devices["lampa-2"].energised, false, "11–12 open");
  assert.equal(state.inputs.di[0], true);
  assert.equal(state.devices["knapp-lampa-1"].energised, false, "the lamp follows DO1, not the button");
  assert.equal(state.inputs.di[2], false, "the actuated NC limit switch breaks");
});

test("an alarm output raises and clears an alarm with its label and level, and the event passes the real parseEvent", () => {
  const layout = layoutWith([device("vippa-1", "vippa"), device("larm-1", "larm", { severity: "critical" })], [["plc:24V", "vippa-1:1"], ["vippa-1:2", "plc:DI0"], ["plc:DO0", "larm-1:1"], ["larm-1:2", "plc:0V"]], "VAR DI0 : BOOL; DO0 : BOOL; END_VAR DO0 := DI0;");
  layout.devices[1].label = "Hög nivå i tank";
  let state = startRun(createEngineState(layout), program(layout.program));
  state = run(state, layout, 2).state;
  state = touchDevice(state, "vippa-1", { on: true });
  const raised = run(state, layout, 2);
  assert.equal(raised.alarms.length, 1);
  assert.deepEqual({ ...raised.alarms[0], at: 0 }, { code: "LARM-1", text: "Hög nivå i tank", severity: "critical", state: "raised", at: 0 });
  const factory = createEventFactory("basic-test", SAFE_POLICY);
  const event = factory.make({ type: "alarm", code: raised.alarms[0].code, severity: raised.alarms[0].severity, state: raised.alarms[0].state, text: raised.alarms[0].text }, START);
  const parsed = parseEvent(event, new Date(START));
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.reason);
  assert.equal(event.severity, "warning", "the safe policy clamps a critical alarm");
  state = touchDevice(raised.state, "vippa-1", { on: false });
  const cleared = run(state, layout, 2);
  assert.equal(cleared.alarms[0]?.state, "cleared");
  assert.equal(alarmCode("givare-ute-1"), "GIVARE-UTE-1");
});

test("every example drawing validates, compiles, runs a minute at 60× without a fault, moves its processes, and the check finds no fel or varning", () => {
  for (const example of SURFACE_EXAMPLES) {
    const valid = validateLayout(example.layout);
    assert.ok(valid.ok, valid.ok ? "" : `${example.id}: ${valid.reason}`);
    const state = startRun(createEngineState(example.layout, 60), program(example.layout.program));
    const after = run(state, example.layout, 600).state;
    assert.equal(after.error, null, `${example.id}: ${after.error}`);
    assert.equal(after.run, true);
    assert.ok(after.clockMin > START_CLOCK_MIN + 20, "the clock went on at 60×");
    assert.deepEqual(loud(after), [], example.id);
  }
  const oven = SURFACE_EXAMPLES.find((example) => example.id === "temperatur-pid")!;
  const heated = run(startRun(createEngineState(oven.layout, 60), program(oven.layout.program)), oven.layout, 600).state;
  assert.ok(heated.plant.ovenC > 80, `the PID heats the oven toward the knob's 100 °C: ${heated.plant.ovenC}`);
  const vent = SURFACE_EXAMPLES.find((example) => example.id === "ventilation")!;
  const ventilated = run(startRun(createEngineState(vent.layout, 60), program(vent.layout.program)), vent.layout, 600).state;
  assert.equal(ventilated.devices["tilluftsflakt-1"].energised, true, "weekday 06:50 at 60×: the unit runs");
  assert.ok(Math.abs(ventilated.plant.vent.supplyC - 18) < 3, `supply air held near 18 °C: ${ventilated.plant.vent.supplyC}`);
  const filter = SURFACE_EXAMPLES.find((example) => example.id === "filtervakt")!;
  let dirty = startRun(createEngineState(filter.layout, 600), program(filter.layout.program));
  dirty = touchDevice(dirty, "vippa-1", { on: true });
  const clogged = run(dirty, filter.layout, 1200);
  assert.ok(clogged.alarms.some((alarm) => alarm.code === "LARM-1" && alarm.state === "raised"), "the filter alarm came after an hour of simulated running");
});

test("the frysvakt trips below its limit and the ventilation program stops the unit and raises the alarm", () => {
  const vent = SURFACE_EXAMPLES.find((example) => example.id === "ventilation")!;
  const layout: Layout = { ...vent.layout, outdoorC: -30 };
  let state = startRun(createEngineState(layout, 60), program(layout.program));
  state = { ...state, plant: { ...state.plant, vent: { ...state.plant.vent, supplyC: 2 } } };
  const result = run(state, layout, 10);
  assert.equal(result.state.devices["frysvakt-1"].tripped, true);
  assert.equal(result.state.inputs.di[0], false, "the NC chain is broken");
  assert.equal(result.state.outputs.do[0], false, "the supply fan is off");
  assert.ok(result.alarms.some((alarm) => alarm.code === "LARM-1" && alarm.state === "raised"), "Frysvakt löst");
});

test("layout files: the key form, prototype names, unknown terminals and oversize are refused; a round trip comes back equal", () => {
  const layout = SURFACE_EXAMPLES.find((example) => example.id === "nivareglering")!.layout;
  const text = exportLayoutText(layout);
  assert.match(text, /hintek-plc-simulator-surface/);
  assert.match(text, /"version": 3/);
  const back = importLayoutText(text);
  assert.ok(back.ok);
  assert.deepEqual(back.ok ? back.layout : null, layout);
  assert.match((importLayoutText(text.replace("Hög nivå i tank", `hwf_mch_${"a".repeat(25)}_${"S".repeat(43)}`)) as { reason: string }).reason, /nyckel/);
  assert.match((importLayoutText('{"format":"hintek-plc-simulator-surface","version":1,"layout":{"__proto__":{}}}') as { reason: string }).reason, /inte är tillåtet/);
  assert.match((importLayoutText("{") as { reason: string }).reason, /JSON/);
  assert.match((importLayoutText('{"format":"annat"}') as { reason: string }).reason, /inte en ritning/);
  assert.match((importLayoutText('{"format":"hintek-plc-simulator-surface","version":99,"layout":{}}') as { reason: string }).reason, /version/);
  const badWire = validateLayout({ ...layout, wires: [...layout.wires, { id: "wx", from: { device: "plc", terminal: "DI99" }, to: { device: "motor-1", terminal: "U1" } }] });
  assert.match((badWire as { reason: string }).reason, /plint som inte finns/);
  const badJunction = validateLayout({ ...layout, wires: [...layout.wires, { id: "wx", from: { junction: "j9" }, to: { device: "motor-1", terminal: "U1" } }] });
  assert.match((badJunction as { reason: string }).reason, /knutpunkt som inte finns/);
  const badOption = validateLayout({ ...layout, devices: layout.devices.map((item) => (item.kind === "larm" ? { ...item, options: { severity: "akut" } } : item)) });
  assert.ok(!badOption.ok);
  assert.ok(!validateLayout({ ...layout, program: "x".repeat(20_001) }).ok);
  assert.ok(!validateLayout({ ...layout, language: "ld" }).ok, "Ladder without a ladder program");
  assert.equal(freeDeviceId("lampa", ["lampa-1"]), "lampa-2");
  assert.equal(defaultLabel("lampa", layout.devices), "Lampa 2");
  assert.equal(PLC_TERMINALS.length, 2 + 12 + 4 + 8 + 2);
  assert.equal(SURFACE_FILE_VERSION, 3);
});

/** A drawing exported by the version before junctions and Ladder, pinned as text: it must open and run as it did. */
const V1_FILE = JSON.stringify({
  format: "hintek-plc-simulator-surface", version: 1,
  layout: {
    version: 1, outdoorC: 5,
    devices: [{ id: "knapp-1", kind: "knapp", x: 150, y: 60, label: "Start", options: {} }, { id: "lampa-1", kind: "lampa", x: 820, y: 540, label: "Drift", options: { color: "green" } }],
    wires: [{ id: "w1", from: { device: "plc", terminal: "24V" }, to: { device: "knapp-1", terminal: "1" } }, { id: "w2", from: { device: "knapp-1", terminal: "2" }, to: { device: "plc", terminal: "DI0" } }, { id: "w3", from: { device: "plc", terminal: "DO0" }, to: { device: "lampa-1", terminal: "X1" } }, { id: "w4", from: { device: "lampa-1", terminal: "X2" }, to: { device: "plc", terminal: "0V" } }],
    program: "VAR\n  Start AT %IX0.0 : BOOL;\n  Drift AT %QX0.0 : BOOL;\nEND_VAR\nDrift := Start;",
  },
});

test("a version 1 drawing opens as the current version with a 24 V DC source put in for the PLC, and behaves the same", () => {
  const read = importLayoutText(V1_FILE);
  assert.ok(read.ok, read.ok ? "" : read.reason);
  const layout = read.ok ? read.layout : emptyLayout();
  assert.equal(layout.version, 3);
  assert.deepEqual(layout.junctions, []);
  assert.equal(layout.language, "st");
  assert.equal(layout.ladder, null);
  // The migration (2026-11-03): the drawing had wires but no source, so one was added and wired to L+ and M; the old wires are untouched.
  assert.equal(read.ok && read.supplyAdded, true, "the reader says a source was added");
  const source = layout.devices.find((candidate) => candidate.kind === "kalla24");
  assert.ok(source, "a 24 V DC source is on the drawing");
  assert.equal(source?.label, SUPPLY_LABEL);
  assert.equal(layout.wires.length, 6);
  assert.deepEqual(layout.wires.slice(0, 4).map((wire) => wire.id), ["w1", "w2", "w3", "w4"], "the old wires come first, as they were");
  const feeds = layout.wires.slice(4).map((wire) => `${isTerminalEnd(wire.from) ? wire.from.terminal : "?"}->${isTerminalEnd(wire.to) ? wire.to.terminal : "?"}`);
  assert.deepEqual(feeds, ["+->24V", "−->0V"], "source + to L+, source − to M");
  assert.ok(layout.wires.every((wire) => wire.points === undefined && wire.kind === undefined), "old wires stay auto-routed and auto-coloured");
  let state = startRun(createEngineState(layout), program(layout.program));
  state = touchDevice(state, "knapp-1", { pressed: true });
  state = run(state, layout, 3).state;
  assert.equal(state.devices["lampa-1"].energised, true, "the old drawing works as before");
  assert.deepEqual(loud(state), []);
  // The browser's store from before reads the same way; a drawing that has a source, or no wires at all, is left alone.
  const stored = loadLayoutText(JSON.stringify(JSON.parse(V1_FILE).layout));
  assert.ok(stored.ok && stored.supplyAdded === true && stored.layout.devices.length === 3);
  const again = loadLayoutText(JSON.stringify(stored.ok ? stored.layout : null));
  assert.ok(again.ok && !again.supplyAdded && again.layout.devices.length === 3, "not added twice");
  const untouched = loadLayoutText(JSON.stringify({ ...emptyLayout(), devices: [{ id: "lampa-1", kind: "lampa", x: 100, y: 100, label: "", options: {} }] }));
  assert.ok(untouched.ok && !untouched.supplyAdded && untouched.layout.devices.length === 1, "no wires: nothing to feed, nothing added");
  assert.ok(!validateLayout(JSON.parse(V1_FILE).layout).ok === false, "validation itself never adds anything");
  assert.equal(validateLayout(JSON.parse(V1_FILE).layout).ok && (validateLayout(JSON.parse(V1_FILE).layout) as { layout: Layout }).layout.devices.length, 2);
});

test("a PLC without supply on L+ and M is dark: no RUN, inputs 0, outputs off, an error that says so; fed from the source it works", () => {
  const bare: Layout = { ...emptyLayout(), devices: [device("knapp-1", "knapp"), device("lampa-1", "lampa"), device("kalla24-1", "kalla24")], wires: wiresOf([["kalla24-1:+", "knapp-1:1"], ["knapp-1:2", "plc:DI0"], ["plc:DO0", "lampa-1:X1"], ["lampa-1:X2", "kalla24-1:−"]]), program: "VAR DI0 : BOOL; DO0 : BOOL; END_VAR DO0 := TRUE;" };
  const compiled = program(bare.program);
  let state = createEngineState(bare);
  assert.equal(state.powered, false);
  assert.equal(startRun(state, compiled).run, false, "the switch does nothing without supply");
  state = run(touchDevice(state, "knapp-1", { pressed: true }), bare, 2).state;
  assert.equal(state.inputs.di[0], false, "a dark PLC reads nothing");
  assert.equal(state.outputs.do[0], false);
  assert.equal(state.devices["lampa-1"].energised, false);
  assert.equal(state.error, null, "dark is not ERR");
  assert.equal(loud(state)[0], `${PLC_SUPPLY_TEXT}.`, "the first thing said");
  assert.ok(codes(state).includes("di-unbonded"), "and the source − is not on M either");
  assert.ok(state.findings.find((finding) => finding.id.startsWith("plc-unpowered"))?.terminals.includes("24V"));
  // Fed from the source: everything as before.
  const fed: Layout = { ...bare, wires: [...bare.wires, ...wiresOf([["kalla24-1:+", "plc:24V"], ["kalla24-1:−", "plc:0V"]]).map((wire, index) => ({ ...wire, id: `f${index}` }))] };
  state = run(touchDevice(startRun(createEngineState(fed), compiled), "knapp-1", { pressed: true }), fed, 2).state;
  assert.equal(state.powered, true);
  assert.equal(state.run, true);
  assert.equal(state.inputs.di[0], true);
  assert.equal(state.devices["lampa-1"].energised, true, "DO0 gives the L+ potential");
  assert.deepEqual(loud(state), []);
  // Supply lost while running: the run ends quietly, the outputs drop.
  const cut: Layout = { ...fed, wires: fed.wires.filter((wire) => wire.id !== "f0") };
  state = run(state, cut, 2).state;
  assert.equal(state.run, false);
  assert.equal(state.powered, false);
  assert.equal(state.outputs.do[0], false);
  assert.equal(state.error, null);
  // Wrong polarity and too little: each told in its own words (no source on the drawing gives more than 30 V, so plc-over stays a guard).
  const swapped: Layout = { ...bare, wires: [...bare.wires, ...wiresOf([["kalla24-1:−", "plc:24V"], ["kalla24-1:+", "plc:0V"]]).map((wire, index) => ({ ...wire, id: `f${index}` }))] };
  assert.ok(codes(run(createEngineState(swapped), swapped, 1).state).includes("plc-polarity"));
  const weak: Layout = { ...bare, devices: [...bare.devices, device("kallajust-1", "kallajust")], wires: [...bare.wires, ...wiresOf([["kallajust-1:+", "plc:24V"], ["kallajust-1:−", "plc:0V"], ["kallajust-1:−", "kalla24-1:−"]]).map((wire, index) => ({ ...wire, id: `f${index}` }))] };
  const low = run(touchDevice(createEngineState(weak), "kallajust-1", { value: 40 }), weak, 2).state;
  assert.ok(codes(low).includes("plc-low") && !low.powered, loud(low).join(" | "));
  const full = run(touchDevice(createEngineState(weak), "kallajust-1", { value: 100 }), weak, 2).state;
  assert.ok(full.powered && !codes(full).some((code) => code.startsWith("plc-")), "30 V is the most the PLC takes, and it takes it");
  // The start drawing: the PLC already fed, nothing to warn about.
  const start = createEngineState(startLayout());
  assert.equal(start.powered, true);
  assert.deepEqual(start.findings, []);
});

test("every example is fed from its source: L+ and M from it, every field device from its + and −, never from the PLC's supply terminals", () => {
  for (const example of SURFACE_EXAMPLES) {
    const sources = example.layout.devices.filter((candidate) => candidate.kind === "kalla24");
    assert.equal(sources.length, 1, `${example.id}: one 24 V DC source`);
    const source = sources[0];
    const ends = example.layout.wires.map((wire) => [wire.from, wire.to].map((end) => (isTerminalEnd(end) ? `${end.device}:${end.terminal}` : "@")));
    assert.ok(ends.some(([a, b]) => a === `${source.id}:+` && b === "plc:24V"), `${example.id}: source + feeds L+`);
    assert.ok(ends.some(([a, b]) => a === `${source.id}:−` && b === "plc:0V"), `${example.id}: source − goes to M`);
    const fieldOnPlcSupply = ends.filter(([a, b]) => (a === "plc:24V" || a === "plc:0V" || b === "plc:24V" || b === "plc:0V") && ![a, b].some((end) => end.startsWith(`${source.id}:`)));
    assert.deepEqual(fieldOnPlcSupply, [], `${example.id}: no field device takes supply from L+/M`);
    const state = run(createEngineState(example.layout), example.layout, 2).state;
    assert.equal(state.powered, true, `${example.id}: the PLC has supply`);
    assert.ok(!state.findings.some((finding) => finding.text === PLC_FEED_TEXT), `${example.id}: no note about feeding from the PLC`);
  }
});

test("every device kind draws consistently: terminals on a side, elements on existing terminals, text without makers' names", () => {
  for (const kind of DEVICE_KINDS) {
    const def = DEVICE_DEFS[kind];
    const ids = new Set(def.terminals.map((terminal) => terminal.id));
    assert.equal(ids.size, def.terminals.length, `${kind}: terminal ids are unique`);
    for (const element of def.elements) {
      const used = element.kind === "contact" || element.kind === "load" ? [element.a, element.b] : element.kind === "source" ? [element.terminal, element.minus, ...(element.plus ? [element.plus] : [])] : element.kind === "sink" ? [element.terminal] : [element.plus, element.minus];
      for (const terminal of used) assert.ok(ids.has(terminal), `${kind}: element uses ${terminal}`);
    }
    assert.doesNotMatch(`${def.label} ${def.name} ${def.short}`, /siemens|abb|schneider|beckhoff|omron|mitsubishi|wago|phoenix/i);
    assert.ok(def.name.length <= 14, `${kind}: the palette name is short (${def.name})`);
    const instance = { id: "x", kind, x: 10, y: 20, label: "", options: {} };
    for (const terminal of def.terminals) assert.ok(deviceTerminalPoint(instance, terminal.id), `${kind}: ${terminal.id} has a place`);
    const spot = suggestPlace(kind, []);
    assert.ok(spot.x >= 0 && spot.y >= 0);
  }
  assert.ok(devicesInGroup("el").length >= 4, "the supplies and the meter have their own group");
  assert.ok(deviceMatches(DEVICE_DEFS.kalla24, "källa") && deviceMatches(DEVICE_DEFS.kalla24, "KALLA") && !deviceMatches(DEVICE_DEFS.kalla24, "fläkt"), "search is accent- and case-insensitive");
  assert.deepEqual(plcTerminalPoint("24V")?.side, "top");
  assert.deepEqual(plcTerminalPoint("DO0")?.side, "bottom");
  assert.equal(plcTerminalPoint("DI12"), null);
});

test("wires are routed orthogonally from terminal to terminal, keep their own bends, and go through junctions", () => {
  const layout = SURFACE_EXAMPLES[0].layout;
  const devices = devicesById(layout), junctions = junctionsById(layout);
  for (const wire of layout.wires) {
    const route = wireRoute(wire, devices, junctions)!;
    assert.ok(route.length >= 2 && orthogonal(route), `${wire.id} is orthogonal: ${JSON.stringify(route)}`);
    const from = terminalPoint(ref(`${(wire.from as { device: string }).device}:${(wire.from as { terminal: string }).terminal}`), devices)!;
    assert.deepEqual(route[0], { x: from.x, y: from.y }, "starts at the terminal");
    assert.ok(route.length <= 7, `${wire.id} has no more than five bends`);
  }
  const bent: Wire = { id: "wb", from: ref("plc:DO0"), to: ref("lampa-1:X1"), points: [{ x: 700, y: 500 }, { x: 900, y: 500 }] };
  const route = wireRoute(bent, devices, junctions)!;
  assert.ok(orthogonal(route));
  assert.ok(route.some((point) => point.x === 700 && point.y === 500) && route.some((point) => point.x === 900 && point.y === 500), "the bends are on the route");
  assert.ok(bendsOfRoute(route, "bottom", "top").some((point) => point.x === 700 && point.y === 500), "the stored bend is one of the route's corners");
  // A moved device keeps the bends and gets an elbow instead of a slant.
  const moved = new Map(devices); moved.set("lampa-1", { ...devices.get("lampa-1")!, x: 1000, y: 600 });
  assert.ok(orthogonal(wireRoute(bent, moved, junctions)!));
  // Junctions: one supply wire to a junction, two wires on to two buttons: both buttons are on the +24 V net.
  const branched = layoutWith([device("knapp-1", "knapp", {}, 100, 60), device("knapp-2", "knapp", {}, 240, 60)], [["plc:24V", "@j1"], ["@j1", "knapp-1:1"], ["@j1", "knapp-2:1"], ["knapp-1:2", "plc:DI0"], ["knapp-2:2", "plc:DI1"]], "VAR DI0 : BOOL; DI1 : BOOL; DO0 : BOOL; END_VAR DO0 := DI0 AND DI1;", [{ id: "j1", x: 200, y: 20 }]);
  assert.ok(validateLayout(branched).ok);
  let state = startRun(createEngineState(branched), program(branched.program));
  state = touchDevice(touchDevice(state, "knapp-1", { pressed: true }), "knapp-2", { pressed: true });
  state = run(state, branched, 2).state;
  assert.equal(state.outputs.do[0], true, "both inputs fed through the branch");
  const junctionRoute = wireRoute(branched.wires[1], devicesById(branched), junctionsById(branched))!;
  assert.deepEqual(junctionRoute[0], { x: 200, y: 20 });
  assert.ok(orthogonal(junctionRoute));
  const bounds = contentBounds(branched, branched.wires.map((wire) => wireRoute(wire, devicesById(branched), junctionsById(branched))!));
  assert.ok(bounds.y <= 20 && bounds.width > 500);
});

test("the wire tool: a loose wire, a branch by dropping on a wire, an end moved onto a terminal, a segment moved, a removal that drops its junctions", () => {
  let layout = layoutWith([device("lampa-1", "lampa", {}, 800, 540)], [["plc:DO0", "lampa-1:X1"], ["lampa-1:X2", "plc:0V"]]);
  const loose = connectWire(layout, { kind: "empty", point: { x: 100, y: 100 } }, { kind: "empty", point: { x: 100, y: 100 } })!;
  assert.equal(loose.layout.junctions.length, 2, "two free ends");
  assert.equal(loose.layout.wires.length, 5, "the two lamp wires, the source's two, and the loose one");
  const loosened = run(createEngineState(loose.layout), loose.layout, 1).state;
  assert.ok(loosened.findings.some((finding) => finding.id.startsWith("loose:") && finding.level === "warning"), "a loose wire is a warning");
  // Drop an end on the DO0 wire: it splits into two with a junction, and the loose wire's end sits on it.
  layout = loose.layout;
  const routes = routesOf(layout);
  const onWire = routes.get("w1")![1];
  const branched = moveWireEnd(layout, loose.wireId, "to", { kind: "wire", wireId: "w1", point: onWire })!;
  assert.equal(branched.wires.length, 6, "w1 became two wires");
  assert.equal(branched.junctions.length, 2, "one free end left plus the branch point");
  const hit = hitAt(branched, onWire, routesOf(branched));
  assert.equal(hit.kind, "junction");
  // The other end onto +24 V: the lamp is now also fed from the branch; the free junction disappears.
  const attached = moveWireEnd(branched, loose.wireId, "from", { kind: "terminal", ref: ref("plc:24V") })!;
  assert.equal(attached.junctions.length, 1);
  const solved = solveNets(attached, { closed: new Set(), sourceVolts: new Map(), outputs: OFF });
  assert.equal(voltageBetween(solved, "lampa-1:X1", "lampa-1:X2"), 24, "the lamp is fed from +24 V through the branch");
  // A segment of a routed wire moves perpendicular to itself and the wire keeps the bend.
  const before = routesOf(attached).get("w2")!;
  const middle = before.findIndex((point, index) => index > 0 && index < before.length - 2 && point.y === before[index + 1].y);
  assert.ok(middle > 0, `w2 has a horizontal middle segment: ${JSON.stringify(before)}`);
  const movedLayout = moveSegment(attached, "w2", before, middle, before[middle].y + 40);
  const movedWire = movedLayout.wires.find((wire) => wire.id === "w2")!;
  assert.ok(movedWire.points && movedWire.points.length >= 2, "the wire now has its own bends");
  const after = routesOf(movedLayout).get("w2")!;
  assert.ok(orthogonal(after) && after.some((point) => Math.abs(point.y - (before[middle].y + 40)) <= 4), "the segment lies where it was dragged, on the grid");
  // Splitting at a point and removing wires drops what nothing uses any more.
  const split = splitWire(movedLayout, "w2", after[middle], routesOf(movedLayout))!;
  assert.equal(split.layout.junctions.length, 2);
  const everything = removeWires(split.layout, split.layout.wires.map((wire) => wire.id));
  assert.equal(everything.junctions.length, 0, "no junction without a wire");
  assert.equal(removeDevices(attached, ["lampa-1"]).wires.length, 4, "a removed device takes its wires");
  // A click on empty space far from anything is an empty hit on the grid; near a terminal it is that terminal.
  assert.equal(hitAt(attached, { x: 33, y: 601 }, routesOf(attached)).kind, "empty");
  const di0 = plcTerminalPoint("DI0")!;
  assert.deepEqual(hitAt(attached, { x: di0.x + 5, y: di0.y - 5 }, routesOf(attached)), { kind: "terminal", ref: ref("plc:DI0") });
});

test("an external 24 V source feeds a lamp on its own, but reaches a PLC input only with a common 0 V", () => {
  // Lamp straight on the source: lit, no PLC involved.
  const own = layoutWith([device("kalla24-1", "kalla24"), device("lampa-1", "lampa")], [["kalla24-1:+", "lampa-1:X1"], ["lampa-1:X2", "kalla24-1:−"]]);
  const lit = run(createEngineState(own), own, 2).state;
  assert.equal(lit.devices["lampa-1"].energised, true);
  assert.deepEqual(loud(lit), [`${PLC_SUPPLY_TEXT}.`], "the only complaint: the PLC itself has no supply");
  // Lamp between the source's + and the PLC's M: dark until the source's − is on M too (M is a reference, not a pole).
  const mixed = layoutWith([device("kalla24-1", "kalla24"), device("lampa-1", "lampa")], [["kalla24-1:+", "lampa-1:X1"], ["lampa-1:X2", "plc:0V"]]);
  const dark = run(createEngineState(mixed), mixed, 2).state;
  assert.equal(dark.devices["lampa-1"].energised, false);
  assert.ok(codes(dark).includes("no-return"), `told why: ${loud(dark).join(" | ")}`);
  const bondedLayout = layoutWith(mixed.devices, [["kalla24-1:+", "lampa-1:X1"], ["lampa-1:X2", "plc:0V"], ["kalla24-1:−", "plc:0V"]]);
  assert.equal(run(createEngineState(bondedLayout), bondedLayout, 2).state.devices["lampa-1"].energised, true, "a common 0 V closes the circuit");
  // A button from the source to DI0: nothing without the bond, and a warning that says so; 1 with it.
  const input = layoutWith([device("kalla24-1", "kalla24"), device("knapp-1", "knapp")], [["kalla24-1:+", "knapp-1:1"], ["knapp-1:2", "plc:DI0"]], "VAR DI0 : BOOL; DO0 : BOOL; END_VAR DO0 := DI0;");
  let state = touchDevice(startRun(createEngineState(input), program(input.program)), "knapp-1", { pressed: true });
  state = run(state, input, 2).state;
  assert.equal(state.inputs.di[0], false);
  assert.ok(codes(state).includes("di-unbonded"));
  const inputBonded = { ...input, wires: wiresOf([["kalla24-1:+", "knapp-1:1"], ["knapp-1:2", "plc:DI0"], ["kalla24-1:−", "plc:0V"], ["kalla24-1:+", "plc:24V"]]) };
  state = touchDevice(startRun(createEngineState(inputBonded), program(inputBonded.program)), "knapp-1", { pressed: true });
  state = run(state, inputBonded, 2).state;
  assert.equal(state.inputs.di[0], true);
  assert.equal(state.outputs.do[0], true);
  assert.deepEqual(loud(state), []);
  // One source on L+ and M is simply the PLC's feed; two 24 V sources on one net with a common 0 V is a parallel feed (warning); the source's + against its own − is a short.
  const feed = layoutWith([device("kalla24-1", "kalla24")], [["kalla24-1:+", "plc:24V"], ["kalla24-1:−", "plc:0V"]]);
  const fedState = run(createEngineState(feed), feed, 1).state;
  assert.ok(fedState.powered && loud(fedState).length === 0, loud(fedState).join(" | "));
  const parallel = layoutWith([device("kalla24-1", "kalla24"), device("kalla24-2", "kalla24")], [["kalla24-1:+", "plc:24V"], ["kalla24-1:−", "plc:0V"], ["kalla24-2:+", "plc:24V"], ["kalla24-2:−", "plc:0V"]]);
  assert.ok(codes(run(createEngineState(parallel), parallel, 1).state).includes("parallel"));
  const shorted = layoutWith([device("kalla24-1", "kalla24")], [["kalla24-1:+", "kalla24-1:−"]]);
  const shortState = run(createEngineState(shorted), shorted, 1).state;
  assert.match(shortState.error ?? "", /Kortslutning mellan \+ och −/);
});

test("the adjustable source: 12 V is too little for a 24 V lamp or input and the check says so; 24 V works; 12 V joined with 24 V is a fault", () => {
  const layout = layoutWith([device("kallajust-1", "kallajust"), device("lampa-1", "lampa"), device("knapp-1", "knapp"), device("voltmeter-1", "voltmeter")],
    [["kallajust-1:+", "lampa-1:X1"], ["lampa-1:X2", "kallajust-1:−"], ["kallajust-1:+", "knapp-1:1"], ["knapp-1:2", "plc:DI0"], ["kallajust-1:−", "plc:0V"], ["kallajust-1:+", "plc:24V"], ["voltmeter-1:+", "kallajust-1:+"], ["voltmeter-1:−", "kallajust-1:−"]]);
  let state = touchDevice(touchDevice(createEngineState(layout), "kallajust-1", { value: 40 }), "knapp-1", { pressed: true });
  state = run(state, layout, 2).state;
  assert.equal(state.devices["kallajust-1"].volts, 12);
  assert.equal(state.devices["voltmeter-1"].volts, 12, "the meter reads the source");
  assert.equal(state.devices["lampa-1"].energised, false);
  assert.equal(state.inputs.di[0], false);
  assert.ok(codes(state).includes("low-volts") && codes(state).includes("di-low") && codes(state).includes("plc-low"), loud(state).join(" | "));
  assert.equal(state.powered, false, "12 V is too little for the PLC as well");
  state = touchDevice(state, "kallajust-1", { value: 80 });
  state = run(state, layout, 2).state;
  assert.equal(state.devices["lampa-1"].energised, true);
  assert.equal(state.inputs.di[0], true);
  assert.deepEqual(loud(state), []);
  const joined = layoutWith([device("kallajust-1", "kallajust"), device("kalla24-1", "kalla24")], [["kallajust-1:+", "plc:24V"], ["kallajust-1:−", "plc:0V"], ["kalla24-1:+", "plc:24V"], ["kalla24-1:−", "plc:0V"]]);
  const faulted = run(touchDevice(createEngineState(joined), "kallajust-1", { value: 40 }), joined, 1).state;
  assert.match(faulted.error ?? "", /olika spänning/);
});

test("the 0–10 V signal source reaches an analog input with a common 0 V, and 24 V on an analog input is a stopping fault", () => {
  const layout = layoutWith([device("kalla010-1", "kalla010")], [["kalla010-1:ut", "plc:AI0"], ["kalla010-1:−", "plc:0V"]], "VAR AI0 : INT; AO0 : INT; END_VAR AO0 := AI0;");
  let state = run(startRun(createEngineState(layout), program(layout.program)), layout, 2).state;
  assert.equal(state.inputs.ai[0], 5000, "the knob at 50 gives 5 V");
  assert.equal(state.outputs.ao[0], 5000);
  const floating = layoutWith([device("kalla010-1", "kalla010")], [["kalla010-1:ut", "plc:AI0"]]);
  state = run(createEngineState(floating), floating, 2).state;
  assert.equal(state.inputs.ai[0], 0);
  assert.ok(codes(state).includes("ai-unbonded"));
  const over = layoutWith([], [["plc:24V", "plc:AI0"]], "VAR DO0 : BOOL; END_VAR DO0 := TRUE;");
  state = run(startRun(createEngineState(over), program(over.program)), over, 1).state;
  assert.equal(state.run, false);
  assert.match(state.error ?? "", /AI0 får 24 V/);
  // Two outputs joined: an error, and a stop as soon as one of them is on.
  const joined = layoutWith([device("lampa-1", "lampa")], [["plc:DO0", "plc:DO1"], ["plc:DO1", "lampa-1:X1"], ["lampa-1:X2", "plc:0V"]], "VAR DO0 : BOOL; END_VAR DO0 := TRUE;");
  state = run(createEngineState(joined), joined, 1).state;
  assert.ok(state.findings.some((finding) => finding.id.startsWith("do-joined") && finding.level === "error" && !finding.stops));
  state = run(startRun(state, program(joined.program)), joined, 1).state;
  assert.match(state.error ?? "", /DO0 och DO1 är hopkopplade/);
  // A wire marked 0 V on a +24 V net is a warning, and the summary counts it.
  const marked: Layout = { ...layoutWith([device("lampa-1", "lampa")], [["plc:24V", "lampa-1:X1"], ["lampa-1:X2", "plc:0V"]]) };
  marked.wires[0].kind = "minus";
  const markedState = run(createEngineState(marked), marked, 1).state;
  assert.ok(codes(markedState).includes("marked-minus"));
  assert.equal(findingsSummary(markedState.findings), "1 varning");
  assert.equal(findingsSummary([]), "Inga fel");
  assert.deepEqual(checkDrawing(startLayout(), createEngineState(startLayout()).solved, OFF), []);
  assert.equal(checkDrawing(emptyLayout(), createEngineState(emptyLayout()).solved, OFF).map((finding) => finding.level).join(), "error", "an empty sheet: only that the PLC has no supply");
});

test("wire colours follow the net, or the wire's own marking", () => {
  const layout = SURFACE_EXAMPLES.find((example) => example.id === "temperatur-pid")!.layout;
  const devices = devicesById(layout);
  const solved = solveNets(layout, { closed: new Set(), sourceVolts: new Map(), outputs: OFF });
  const colourOf = (from: string) => wireColour(layout.wires.find((wire) => "device" in wire.from && `${wire.from.device}:${wire.from.terminal}` === from)!, solved, devices);
  assert.equal(colourOf("kalla24-1:+"), "plus");
  assert.equal(colourOf("tempgivare-1:−"), "minus");
  assert.equal(colourOf("tempgivare-1:ut"), "analog");
  assert.equal(colourOf("plc:AO0"), "analog");
  assert.equal(colourOf("plc:DO0"), "plus");
  assert.equal(wireColour({ ...layout.wires[0], kind: "signal" }, solved, devices), "signal", "a marking wins over the net");
});

test("the simulated clock: Monday 05:50 at the start, hours and weekdays roll over", () => {
  assert.deepEqual(plcClock(START_CLOCK_MIN), { weekday: 1, hour: 5, minute: 50 });
  assert.equal(clockText(START_CLOCK_MIN), "Måndag 05:50");
  assert.deepEqual(plcClock(6 * 1440 + 23 * 60 + 59 + 2), { weekday: 1, hour: 0, minute: 1 });
});

test("terminal designations follow the device: NO 13/14, NC 11/12 by the option, lamp X1/X2, coil A1/A2; the ids stay 1/2", () => {
  const knapp = DEVICE_DEFS.knapp;
  assert.deepEqual(knapp.terminals.map((terminal) => terminal.id), ["1", "2"], "the ids wires refer to are unchanged");
  assert.deepEqual(knapp.terminals.map((terminal) => terminalName(knapp, {}, terminal.id)), ["13", "14"]);
  assert.deepEqual(knapp.terminals.map((terminal) => terminalName(knapp, { nc: "nc" }, terminal.id)), ["11", "12"]);
  assert.deepEqual(DEVICE_DEFS.brandlarm.terminals.map((terminal) => terminalName(DEVICE_DEFS.brandlarm, {}, terminal.id)), ["11", "12"], "a fixed NC contact");
  assert.deepEqual(DEVICE_DEFS.vippa.terminals.map((terminal) => terminalName(DEVICE_DEFS.vippa, {}, terminal.id)), ["13", "14"], "a fixed NO contact");
  assert.deepEqual(DEVICE_DEFS.knapp_lampa.terminals.map((terminal) => terminalName(DEVICE_DEFS.knapp_lampa, {}, terminal.id)), ["13", "14", "X1", "X2"]);
  assert.equal(terminalName(DEVICE_DEFS.rela, {}, "A1"), "A1");
  assert.equal(terminalTitle(DEVICE_DEFS.knapp, { nc: "nc" }, "1"), "Plint 11");
  for (const kind of DEVICE_KINDS) {
    const def = DEVICE_DEFS[kind];
    const names = def.terminals.map((terminal) => terminalName(def, {}, terminal.id));
    assert.equal(new Set(names).size, names.length, `${kind}: the shown designations are unique`);
  }
});

test("ritverktyget: the router behind routesOf keeps the old drawings whole – orthogonal, from terminal to terminal, round the plates, the junction model untouched", () => {
  // The version 1 drawing: every wire routed anew by the obstacle-aware router, nothing stored for it.
  const read = importLayoutText(V1_FILE);
  const layout = read.ok ? read.layout : emptyLayout();
  const routes = routesOf(layout);
  assert.equal(routes.size, 6, "the four old wires plus the two the supply migration adds (source + to L+, − to M)");
  const devices = devicesById(layout);
  for (const wire of layout.wires) {
    const route = routes.get(wire.id)!;
    assert.ok(orthogonal(route), `${wire.id}: ${JSON.stringify(route)}`);
    const from = terminalPoint(wire.from as { device: string; terminal: string }, devices)!, to = terminalPoint(wire.to as { device: string; terminal: string }, devices)!;
    assert.deepEqual(route[0], { x: from.x, y: from.y });
    assert.deepEqual(route[route.length - 1], { x: to.x, y: to.y });
    assert.equal(wire.points, undefined, "nothing is written onto the wire by routing it");
  }
  // A branch through a junction routes from the junction's own place, and a wire with bends keeps them whoever routes it.
  const branched = layoutWith([device("knapp-1", "knapp", {}, 100, 60), device("knapp-2", "knapp", {}, 240, 60)], [["plc:24V", "@j1"], ["@j1", "knapp-1:1"], ["@j1", "knapp-2:1"]], "", [{ id: "j1", x: 200, y: 20 }]);
  const branchRoutes = routesOf(branched);
  assert.deepEqual(branchRoutes.get("w2")![0], { x: 200, y: 20 });
  assert.ok([...branchRoutes.values()].every(orthogonal));
  const bent: Layout = { ...layout, wires: layout.wires.map((wire) => (wire.id === "w3" ? { ...wire, points: [{ x: 600, y: 500 }, { x: 840, y: 500 }] } : wire)) };
  const bentRoute = routesOf(bent).get("w3")!;
  assert.ok(bentRoute.some((point) => point.x === 600 && point.y === 500) && bentRoute.some((point) => point.x === 840 && point.y === 500));
  assert.ok(orthogonal(bentRoute));
  // The same drawing routed by two fresh routers gives the same routes: nothing depends on the machine or the moment.
  assert.deepEqual([...new WireRouter().routesOf(layout).entries()], [...new WireRouter().routesOf(layout).entries()]);
});
