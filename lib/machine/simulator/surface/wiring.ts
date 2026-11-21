import { ioName, nameIo, type PlcOutputs, rawToVolts } from "@/lib/machine/simulator/st/io";
import { DEVICE_DEFS, knobVolts, type TerminalRole } from "./devices";
import { designedDef, designedJoins } from "./device-designs";
import { type DeviceInst, endKey, isTerminalEnd, type Layout, PLC_DEVICE_ID, terminalKey, type TerminalRef, type Wire, type WireEnd } from "./layout";

// PLC-simulatorn: the electrical picture of the drawing. Wires, junctions and closed contacts join terminals
// into nets (union-find). Since v3 (2026-11-03) a net does not simply "have 24 V": it holds poles – the + of a source, the −
// of a source, or a 0–10 V signal – each named after its source (an external supply or a sensor is its device; the PLC is the
// source "plc" for what its outputs give). Two sources share a reference when their − terminals lie on one net. A load is
// energised only between a + and a − of sources that share a reference, so a lamp between a 24 V source and a 0 V that is
// not that source's − stays dark, as it does on a real panel. A net with + and − of one reference group is a short circuit,
// which the engine shows as ERR and stops the run (2026-11-02: "Kortslutning mellan +24 V och 0 V").
//
// The PLC is fed, it does not feed (2026-11-03: "Den skall ta strömmen från en strömkälla"): its terminals L+ and M
// (ids 24V and 0V, kept for the wires) are supply inputs. The PLC has supply when a source's + stands on L+ and the same
// source's − on M, within the 24 V span; then its outputs give the L+ potential and its inputs read against M. Without
// supply nothing of it works. M is a reference, never a source of potential.
//
// Honest limits: potentials, no currents or resistances; a net is at one voltage; nothing of
// wire gauge, fusing, inductive kick or capacitance. Not a circuit simulator and not a verification of electrical safety.

/** Below this a 24 V input or load counts as off; the simulator's own rule for its 24 V class of devices. */
export const ON_VOLTS = 15;
/** A 24 V class terminal of the PLC takes at most this. */
export const PLC_MAX_VOLTS = 30;
/** The analog inputs and outputs are made for 0–10 V. */
export const ANALOG_MAX_VOLTS = 10;
/** What the source on the start drawing gives, and what the PLC is made for. */
export const PLC_SUPPLY_VOLTS = 24;
export const PLC_SUPPLY_TEXT = "PLC:n saknar matning: koppla L+ och M till en 24 V DC-källa";

export type NetLevel = "plus" | "minus" | "analog" | "none";
export type Pole = { source: string; pole: "+" | "-" | "signal"; volts: number; key: string };
/** plus: red, minus: white with a grey outline, analog: thin red (2026-11-02), signal: dark grey (a drawn marking, v3). */
export type WireColour = "plus" | "minus" | "analog" | "signal";
export type Net = { id: number; keys: string[]; plus: Pole[]; minus: Pole[]; signals: Pole[]; short: string | null; colour: WireColour };
export type Solved = {
  nets: Net[]; netOf: Map<string, Net>;
  /** The net a source's − (reference) lies on, by source id ("plc" or a device id). */
  refNet: Map<string, Net>;
  short: boolean; shortText: string | null; shortedWires: Set<string>;
  /** What stands between the PLC's L+ and M from a source whose − is on M; null when nothing does. */
  plcVolts: number | null;
  /** The PLC has supply: plcVolts within the 24 V span. */
  plcPowered: boolean;
};

/** The PLC runs on this: at least ON_VOLTS, at most PLC_MAX_VOLTS between L+ and M. */
export const plcPoweredBy = (volts: number | null) => volts !== null && volts >= ON_VOLTS && volts <= PLC_MAX_VOLTS;

export type Live = {
  /** Contacts that are closed this cycle, as `device:name`. */
  closed: ReadonlySet<string>;
  /** Volts on every signal terminal that gives something, as `device:terminal`. */
  sourceVolts: ReadonlyMap<string, number>;
  outputs: PlcOutputs;
  /** Knob supplies' volts by device id; a fixed supply needs no entry. */
  supplyVolts?: ReadonlyMap<string, number>;
};

export const SHORT_CIRCUIT_TEXT = "Kortslutning mellan +24 V och 0 V";

const plcRole = (terminal: string): TerminalRole => (terminal === "24V" ? "supply" : terminal === "0V" ? "ground" : nameIo(terminal)?.kind === "AI" || nameIo(terminal)?.kind === "AO" ? "analog" : "wire");

export function terminalRole(ref: TerminalRef, devices: ReadonlyMap<string, DeviceInst>): TerminalRole {
  if (ref.device === PLC_DEVICE_ID) return plcRole(ref.terminal);
  const device = devices.get(ref.device);
  return device ? designedDef(device).terminals.find((terminal) => terminal.id === ref.terminal)?.role ?? "wire" : "wire";
}
export const endRole = (end: WireEnd, devices: ReadonlyMap<string, DeviceInst>): TerminalRole => (isTerminalEnd(end) ? terminalRole(end, devices) : "wire");

class UnionFind {
  private readonly parent = new Map<string, string>();
  find(key: string): string {
    let root = key;
    while (this.parent.get(root) !== undefined && this.parent.get(root) !== root) root = this.parent.get(root)!;
    if (!this.parent.has(key)) this.parent.set(key, key);
    // Path compression keeps the next lookups short.
    let walk = key;
    while (walk !== root) { const next = this.parent.get(walk)!; this.parent.set(walk, root); walk = next; }
    return root;
  }
  union(a: string, b: string) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.parent.set(ra, rb); }
  keys() { return [...this.parent.keys()]; }
}

export const devicesById = (layout: Pick<Layout, "devices">) => new Map(layout.devices.map((device) => [device.id, device]));

/** "PLC", or the device's label, for a message. */
export function sourceLabel(source: string, devices: ReadonlyMap<string, DeviceInst>) {
  if (source === PLC_DEVICE_ID) return "PLC:n";
  const device = devices.get(source);
  return device ? device.label || DEVICE_DEFS[device.kind].label : source;
}

const voltsText = (volts: number) => `${volts.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} V`;

/** Every net in the drawing, with its poles this cycle. */
export function solveNets(layout: Pick<Layout, "devices" | "wires">, live: Live): Solved {
  const devices = devicesById(layout);
  const sets = new UnionFind();
  for (const wire of layout.wires) sets.union(endKey(wire.from), endKey(wire.to));
  for (const device of layout.devices) {
    for (const element of DEVICE_DEFS[device.kind].elements) {
      if (element.kind === "contact" && live.closed.has(`${device.id}:${element.name}`)) sets.union(`${device.id}:${element.a}`, `${device.id}:${element.b}`);
      // Every terminal of a device is in the picture, wired or not, so a message can point at it.
    }
    for (const terminal of designedDef(device).terminals) sets.find(`${device.id}:${terminal.id}`);
    // An extra terminal the design links inside the device (a second A2, a through PE) is one net with it.
    for (const [a, b] of designedJoins(device)) sets.union(`${device.id}:${a}`, `${device.id}:${b}`);
  }
  sets.find(`${PLC_DEVICE_ID}:24V`); sets.find(`${PLC_DEVICE_ID}:0V`);

  // The poles, by terminal key: first what the sources on the drawing give, then what the PLC gives once it has supply.
  const poles = new Map<string, Pole>();
  const references = new Map<string, string>(); // source -> terminal key of its −
  const addPole = (key: string, pole: Pole) => poles.set(key, pole);
  // The PLC's reference is its M terminal: a source whose − lies on that net is bonded with the PLC.
  references.set(PLC_DEVICE_ID, `${PLC_DEVICE_ID}:0V`);
  for (const device of layout.devices) {
    for (const element of DEVICE_DEFS[device.kind].elements) {
      if (element.kind === "supply") {
        const volts = element.volts === "knob" ? live.supplyVolts?.get(device.id) ?? 0 : element.volts;
        addPole(`${device.id}:${element.plus}`, { source: device.id, pole: "+", volts, key: `${device.id}:${element.plus}` });
        addPole(`${device.id}:${element.minus}`, { source: device.id, pole: "-", volts: 0, key: `${device.id}:${element.minus}` });
        references.set(device.id, `${device.id}:${element.minus}`);
      } else if (element.kind === "source") {
        const key = `${device.id}:${element.terminal}`;
        const volts = live.sourceVolts.get(key);
        if (volts !== undefined) addPole(key, { source: device.id, pole: "signal", volts, key });
        references.set(device.id, `${device.id}:${element.minus}`);
      }
    }
  }
  // The PLC's supply: the highest + on L+ from a source whose − shares M's net.
  const rootOf = (key: string) => sets.find(key);
  const plusRoot = rootOf(`${PLC_DEVICE_ID}:24V`), minusRoot = rootOf(`${PLC_DEVICE_ID}:0V`);
  let plcVolts: number | null = null;
  for (const pole of poles.values()) {
    if (pole.pole !== "+" || rootOf(pole.key) !== plusRoot) continue;
    const reference = references.get(pole.source);
    if (reference && rootOf(reference) === minusRoot) plcVolts = Math.max(plcVolts ?? 0, pole.volts);
  }
  const plcPowered = plcPoweredBy(plcVolts);
  if (plcPowered) {
    live.outputs.do.forEach((on, index) => { if (on) { const key = `${PLC_DEVICE_ID}:${ioName({ kind: "DO", index })}`; addPole(key, { source: PLC_DEVICE_ID, pole: "+", volts: plcVolts ?? PLC_SUPPLY_VOLTS, key }); } });
    live.outputs.ao.forEach((raw, index) => { const key = `${PLC_DEVICE_ID}:${ioName({ kind: "AO", index })}`; addPole(key, { source: PLC_DEVICE_ID, pole: "signal", volts: rawToVolts(raw ?? 0), key }); });
  }

  const groups = new Map<string, string[]>();
  for (const key of sets.keys()) { const root = sets.find(key); groups.set(root, [...(groups.get(root) ?? []), key]); }
  const nets: Net[] = [];
  const netOf = new Map<string, Net>();
  let id = 0;
  for (const keys of groups.values()) {
    let groundRole = false, analogRole = false;
    const plus: Pole[] = [], minus: Pole[] = [], signals: Pole[] = [];
    for (const key of keys) {
      if (!key.startsWith("@")) {
        const [device, terminal] = key.split(":");
        const role = terminalRole({ device, terminal }, devices);
        if (role === "ground") groundRole = true;
        if (role === "analog") analogRole = true;
      }
      const pole = poles.get(key);
      if (pole) (pole.pole === "+" ? plus : pole.pole === "-" ? minus : signals).push(pole);
    }
    const net: Net = { id: id++, keys, plus, minus, signals, short: null, colour: groundRole ? "minus" : analogRole ? "analog" : "plus" };
    nets.push(net);
    for (const key of keys) netOf.set(key, net);
  }
  const refNet = new Map<string, Net>();
  for (const [source, key] of references) { const net = netOf.get(key); if (net) refNet.set(source, net); }
  const bonded = (a: string, b: string) => a === b || (refNet.has(a) && refNet.get(a) === refNet.get(b));

  // Shorts: + against − of one reference group, or two + of different voltage in one group.
  let shortText: string | null = null;
  for (const net of nets) {
    for (const p of net.plus) {
      // Through the PLC's L+ or M, or out of one of its outputs, the short is the familiar "+24 V mot 0 V"; between a source's own poles it is named after the source.
      const throughPlc = (pole: Pole) => pole.source === PLC_DEVICE_ID || net.keys.includes(`${PLC_DEVICE_ID}:24V`) || net.keys.includes(`${PLC_DEVICE_ID}:0V`);
      for (const m of net.minus) if (bonded(p.source, m.source)) net.short ??= throughPlc(p) || throughPlc(m) ? SHORT_CIRCUIT_TEXT : `Kortslutning mellan + och − på ${sourceLabel(p.source, devices)}`;
      for (const q of net.plus) if (p.source !== q.source && bonded(p.source, q.source) && Math.abs(p.volts - q.volts) > 0.5) net.short ??= `Två källor med olika spänning är hopkopplade: ${sourceLabel(p.source, devices)} ${voltsText(p.volts)} och ${sourceLabel(q.source, devices)} ${voltsText(q.volts)}`;
    }
    if (net.short && !shortText) shortText = net.short;
  }
  const shortedWires = new Set(layout.wires.filter((wire) => netOf.get(endKey(wire.from))?.short).map((wire) => wire.id));
  return { nets, netOf, refNet, short: shortText !== null, shortText, shortedWires, plcVolts, plcPowered };
}

export const bonded = (solved: Solved, a: string, b: string) => a === b || (solved.refNet.has(a) && solved.refNet.get(a) === solved.refNet.get(b));

/** What the net is, by its poles: for colours and the terminal lamps, not for whether anything works. */
export const netLevelOf = (solved: Solved, key: string): NetLevel => {
  const net = solved.netOf.get(key);
  if (!net) return "none";
  if (net.plus.length) return "plus";
  if (net.minus.length) return "minus";
  return net.signals.length ? "analog" : "none";
};

/**
 * The voltage of a net relative to a source's reference (the PLC's 0 V unless said otherwise): 0 on a bonded −, the highest
 * bonded + or signal, or null when nothing bonded reaches it – a floating net, which an input reads as nothing.
 */
export function potential(solved: Solved, key: string, reference = PLC_DEVICE_ID): number | null {
  const net = solved.netOf.get(key);
  if (!net) return null;
  if (net.minus.some((pole) => bonded(solved, pole.source, reference))) return 0;
  const fed = [...net.plus, ...net.signals].filter((pole) => bonded(solved, pole.source, reference));
  return fed.length ? Math.max(...fed.map((pole) => pole.volts)) : null;
}

/** The voltage from b to a across a load or a meter: positive when a is the + side. Null when the two sides share no reference. */
export function voltageBetween(solved: Solved, a: string, b: string): number | null {
  const A = solved.netOf.get(a), B = solved.netOf.get(b);
  if (!A || !B) return null;
  let best: number | null = null;
  const consider = (volts: number) => { if (best === null || Math.abs(volts) > Math.abs(best)) best = volts; };
  for (const p of [...A.plus, ...A.signals]) for (const m of B.minus) if (bonded(solved, p.source, m.source)) consider(p.volts);
  for (const p of [...B.plus, ...B.signals]) for (const m of A.minus) if (bonded(solved, p.source, m.source)) consider(-p.volts);
  if (best === null) {
    for (const m of A.minus) for (const n of B.minus) if (bonded(solved, m.source, n.source)) consider(0);
    for (const p of A.plus) for (const q of B.plus) if (bonded(solved, p.source, q.source)) consider(p.volts - q.volts);
  }
  return best;
}

/** A load between a and b is energised when at least ON_VOLTS stands across it, either way round. */
export function energised(solved: Solved, deviceId: string, a: string, b: string) {
  const volts = voltageBetween(solved, `${deviceId}:${a}`, `${deviceId}:${b}`);
  return volts !== null && Math.abs(volts) >= ON_VOLTS;
}

/** What an analog terminal of the PLC reads: the potential against its own 0 V, within 0–10 V. */
export const analogVoltsOf = (solved: Solved, key: string) => Math.min(ANALOG_MAX_VOLTS, Math.max(0, potential(solved, key) ?? 0));

/** The colour a wire is drawn in: its own marking when it has one, else its net's, else its ends' roles. */
export function wireColour(wire: Wire, solved: Solved, devices: ReadonlyMap<string, DeviceInst>): WireColour {
  if (wire.kind && wire.kind !== "auto") return wire.kind;
  const net = solved.netOf.get(endKey(wire.from));
  if (net) return net.colour;
  const roles = [endRole(wire.from, devices), endRole(wire.to, devices)];
  return roles.includes("ground") ? "minus" : roles.includes("analog") ? "analog" : "plus";
}

export const plcTerminalKey = (terminal: string) => `${PLC_DEVICE_ID}:${terminal}`;
export const ioTerminalKey = (kind: "DI" | "AI" | "DO" | "AO", index: number) => plcTerminalKey(ioName({ kind, index }));

/** Knob supplies' volts from the devices' knob values, for `Live.supplyVolts`. */
export function supplyVoltsOf(layout: Pick<Layout, "devices">, knobValue: (deviceId: string) => number): Map<string, number> {
  const volts = new Map<string, number>();
  for (const device of layout.devices) {
    const supply = DEVICE_DEFS[device.kind].elements.find((element) => element.kind === "supply");
    if (supply?.kind === "supply" && supply.volts === "knob") volts.set(device.id, knobVolts(device.kind, knobValue(device.id)));
  }
  return volts;
}

export { terminalKey };
