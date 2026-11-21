import { z } from "zod";
import { DEVICE_DEFS, type DeviceKindId, knobSignal, knobVolts, optionValue, SENSOR_RANGES, signalKind, voltsToMilliamps } from "./devices";
import type { DeviceState, Plant } from "./engine";

// PLC-simulatorn, värdeetiketter (2026-11-07: "Visa sådana texter i en egen liten ruta med lite större siffror … sätt värdet
// som en etikett utanför"): a device's values – a sensor's reading, a knob's volts, a motor's speed, a damper's position, a frost
// guard's setpoint – in a small tag beside the plate, on a side without terminals, with larger tabular digits. A setpoint is changed
// on the tag itself; it is the same option the simulator's properties panel sets (one source). Which values and which side are part
// of the device design and its file format (`readout`).

export const READOUT_VALUES = ["reading", "knob", "volts", "speed", "drive", "position", "setpoint", "out", "flow", "oven", "supplyAir"] as const;
export type ReadoutValue = (typeof READOUT_VALUES)[number];
export const READOUT_VALUE_TEXT: Record<ReadoutValue, string> = {
  reading: "mätvärdet (givarens storhet och enhet)", knob: "börvärdet (BV) från vredet, i volt eller mA", volts: "spänningen (en voltmeter visar 0,0 V med öppna mätsladdar)", speed: "farten i %", drive: "styrningen i %", position: "läget i % öppet", setpoint: "börvärdet (BV), som går att ändra på etiketten", out: "det som faktiskt kommer ut (ärvärdet): volt, 0 vid kortslutning, eller mA för en strömkälla (0 mA i öppen slinga)", flow: "framledningens temperatur (ärvärdet)", oven: "ugnens temperatur (ärvärdet)", supplyAir: "tilluftens temperatur (ärvärdet)",
};
/**
 * The values a picture may write into itself (the animation rule "show", 2026-11-09: "värde" is one of the ways a device is animated):
 * those the device's own state holds, so a picture needs no plant – a sensor's reading is read back from its 0–10 V.
 */
export const SHOW_VALUES = ["reading", "knob", "volts", "speed", "drive", "position", "out", "flow"] as const;
export type ShowValue = (typeof SHOW_VALUES)[number];
export const SHOW_VALUE_TEXT: Record<ShowValue, string> = {
  reading: "mätvärdet med enhet (från givarens 0–10 V)", knob: "börvärdet från vredet (V eller mA)", volts: "spänningen", speed: "farten i %", drive: "styrningen i %", position: "läget i %", out: "det som faktiskt kommer ut (ärvärdet, V eller mA)", flow: "framledningens temperatur i värmekretsen (ärvärdet)",
};
export const READOUT_SIDES = ["right", "left", "below", "above"] as const;
export type ReadoutSide = (typeof READOUT_SIDES)[number];
export const READOUT_SIDE_LABELS: Record<ReadoutSide, string> = { right: "Till höger", left: "Till vänster", below: "Under", above: "Över" };

/** What each function can show; the standard tag shows all of it. */
export const READOUT_CHOICES: Partial<Record<DeviceKindId, readonly ReadoutValue[]>> = {
  ...Object.fromEntries(Object.keys(SENSOR_RANGES).map((kind) => [kind, ["reading"] as const])),
  // Börvärde and ärvärde together where a device has both (2026-11-09: "Gå igen alla objekt som bör ha ett bör och är värde").
  vred: ["knob", "out"], kalla010: ["knob", "out"], kalla420: ["knob", "out"], signalsim: ["knob", "out"], kallajust: ["knob", "out"], voltmeter: ["volts"],
  motor: ["speed"], tilluftsflakt: ["drive", "speed"], franluftsflakt: ["drive", "speed"], cirkpump: ["speed"],
  varmare: ["drive", "oven"], varmebatteri: ["drive", "supplyAir"], shunt: ["drive", "flow"], varmekalla: ["drive", "flow"],
  spjall: ["position"], frysvakt: ["setpoint", "reading"],
};
/** The option a setpoint is: the frost guard's trip limit. */
export const SETPOINTS: Partial<Record<DeviceKindId, string>> = { frysvakt: "limitC" };

export const readoutSchema = z.object({ side: z.enum(READOUT_SIDES), values: z.array(z.enum(READOUT_VALUES)).max(4) }).strict();
export type Readout = z.infer<typeof readoutSchema>;
export const standardReadout = (kind: DeviceKindId): Readout => ({ side: "right", values: [...(READOUT_CHOICES[kind] ?? [])] });
/** What is wrong with a design's tag: a value the function does not have. */
export function readoutProblems(kind: DeviceKindId, readout: Readout): string[] {
  const choices = READOUT_CHOICES[kind] ?? [];
  return readout.values.filter((value) => !choices.includes(value)).map((value) => `Värdeetiketten: ${DEVICE_DEFS[kind].label} har inget värde "${value}".`);
}

const number = (value: number, decimals: number) => value.toLocaleString("sv-SE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
export type ReadoutLine = { value: ReadoutValue; text: string; setpoint: { key: string; choices: { value: string; label: string }[]; current: string } | null };

/** The lines of a device's tag, as shown: "21,5 °C", "BV 5 °C", "7,0 V", "80 %". */
export function readoutLines(kind: DeviceKindId, values: readonly ReadoutValue[], state: DeviceState, plant: Plant, options: Readonly<Record<string, string>>): ReadoutLine[] {
  const def = DEVICE_DEFS[kind];
  const percent = (share: number) => `${Math.round(Math.min(1, Math.max(0, share)) * 100)} %`;
  // With both a set value and an actual one, each line says which: BV (or SP for a control signal) and ÄV.
  const both = values.some((value) => SET_VALUES.has(value)) && values.some((value) => !SET_VALUES.has(value));
  return values.map((value): ReadoutLine => {
    const line = lineOf(value);
    if (!both || value === "setpoint" || line.text === "–") return line;
    return { ...line, text: `${SET_VALUES.has(value) ? (value === "drive" ? "SP" : "BV") : "ÄV"} ${line.text}` };
  });
  function lineOf(value: ReadoutValue): ReadoutLine {
    switch (value) {
      case "reading": {
        if (kind === "frysvakt") return { value, text: `${number(plant.vent.supplyC, 1)} °C`, setpoint: null };
        const range = SENSOR_RANGES[kind];
        const reading = sensorReading(kind, plant, state);
        const dead = state.outV === null;
        return { value, text: dead || reading === null ? "–" : `${number(reading, range?.unit === "Pa" || range?.unit === "%" ? 0 : 1)} ${range?.unit ?? ""}`.trim(), setpoint: null };
      }
      case "knob": return { value, text: knobText(kind, state, options), setpoint: null };
      case "volts": return { value, text: voltsText(kind, state), setpoint: null };
      case "speed": return { value, text: percent(state.speed), setpoint: null };
      case "drive": return { value, text: percent(state.drive), setpoint: null };
      case "position": return { value, text: `${percent(state.position)} öppet`, setpoint: null };
      case "out": return { value, text: outText(kind, state, options), setpoint: null };
      case "flow": return { value, text: `${number(plant.heat.flowC, 1)} °C`, setpoint: null };
      case "oven": return { value, text: `${number(plant.ovenC, 1)} °C`, setpoint: null };
      case "supplyAir": return { value, text: `${number(plant.vent.supplyC, 1)} °C`, setpoint: null };
      case "setpoint": {
        const key = SETPOINTS[kind];
        const option = key ? def.options.find((candidate) => candidate.key === key) : undefined;
        if (!key || !option) return { value, text: "–", setpoint: null };
        const current = optionValue(def, options, key);
        return { value, text: `BV ${option.choices.find((choice) => choice.value === current)?.label ?? current}`, setpoint: { key, choices: option.choices, current } };
      }
    }
  }
}
/** The values that are what is asked for (a knob, a control signal, a setpoint); the rest are what is. */
const SET_VALUES = new Set<ReadoutValue>(["knob", "drive", "setpoint"]);

/** The set value (BV) of a knob: 0–10 V, 0–30 V on the adjustable supply, or 4–20 mA. */
function knobText(kind: DeviceKindId, state: DeviceState, options: Readonly<Record<string, string>>): string {
  if (DEVICE_DEFS[kind].elements.some((element) => element.kind === "supply")) return `${number(knobVolts(kind, state.value), 1)} V`;
  return signalKind(kind, options) === "current" ? `${number(knobSignal(kind, options, state.value), 1)} mA` : `${number(state.value / 10, 1)} V`;
}
/** What really comes out (ÄV, engine.ts actualOutput): volts, or a current source's mA (0 mA in an open loop). */
function outText(kind: DeviceKindId, state: DeviceState, options: Readonly<Record<string, string>>): string {
  if (signalKind(kind, options) === "current") return `${number(voltsToMilliamps(state.outV ?? 0), 1)} mA`;
  return state.outV === null ? "–" : `${number(state.outV, 1)} V`;
}
/** A meter reads 0 V with its leads open (2026-11-09: the voltmeter showed "–"). */
const voltsText = (kind: DeviceKindId, state: DeviceState) => (state.volts === null && kind !== "voltmeter" && kind !== "kallajust" ? "–" : `${number(Math.abs(state.volts ?? (kind === "kallajust" ? (state.value / 100) * 30 : 0)), 1)} V`);

/** A value as a picture writes it in its own display (the rule "show"): "12,5 V", "21,5 °C", "80 %"; "–" when nothing is known. */
export function pictureValueText(kind: DeviceKindId, value: ShowValue, state: DeviceState, plant?: Plant, options: Readonly<Record<string, string>> = {}): string {
  const percent = (share: number) => `${Math.round(Math.min(1, Math.max(0, share)) * 100)} %`;
  switch (value) {
    case "reading": {
      if (kind === "vred" || kind === "kalla010") return `${number(state.value / 10, 1)} V`;
      const range = SENSOR_RANGES[kind];
      if (!range || state.outV === null) return "–";
      const reading = range.low + (Math.min(10, Math.max(0, state.outV)) / 10) * (range.high - range.low);
      return `${number(reading, range.unit === "Pa" || range.unit === "%" ? 0 : 1)} ${range.unit}`.trim();
    }
    case "knob": return knobText(kind, state, options);
    case "volts": return voltsText(kind, state);
    case "speed": return percent(state.speed);
    case "drive": return percent(state.drive);
    case "position": return percent(state.position);
    case "out": return outText(kind, state, options);
    case "flow": return plant ? `${number(plant.heat.flowC, 1)} °C` : "–";
  }
}

/** The tag's size in the surface's units, from its lines: wide enough for the longest, 15 per line. */
export const READOUT_LINE = 15;
export function readoutSize(lines: readonly { text: string }[]): { width: number; height: number } {
  const longest = Math.max(0, ...lines.map((line) => line.text.length));
  return { width: Math.max(34, Math.round(longest * 7 + 12)), height: lines.length * READOUT_LINE + 4 };
}
/** Where the tag stands relative to the plate (its top-left corner), on the chosen side, 6 units off. */
export function readoutPlace(side: ReadoutSide, plate: { width: number; height: number }, size: { width: number; height: number }, label: { below: boolean }): { x: number; y: number } {
  const gap = 6;
  switch (side) {
    case "right": return { x: plate.width + gap, y: (plate.height - size.height) / 2 };
    case "left": return { x: -size.width - gap, y: (plate.height - size.height) / 2 };
    case "below": return { x: (plate.width - size.width) / 2, y: plate.height + gap + (label.below ? 34 : 18) };
    case "above": return { x: (plate.width - size.width) / 2, y: -size.height - gap - 18 };
  }
}

/** The widest text each value can have, so a tag keeps its size while the value changes (nothing jumps). */
const WIDEST: Record<ReadoutValue, string> = { reading: "ÄV −40,0 °C", knob: "BV 20,0 mA", volts: "30,0 V", speed: "ÄV 100 %", drive: "SP 100 %", position: "100 % öppet", setpoint: "BV 8 °C", out: "ÄV 20,0 mA", flow: "ÄV 100,0 °C", oven: "ÄV 200,0 °C", supplyAir: "ÄV −10,0 °C" };
/** The tag's box relative to the device's top-left corner, or null when it shows nothing. */
export function readoutFrame(readout: Readout, plate: { width: number; height: number }, labelBelow: boolean): { x: number; y: number; width: number; height: number } | null {
  if (!readout.values.length) return null;
  const size = readoutSize(readout.values.map((value) => ({ text: WIDEST[value] })));
  return { ...readoutPlace(readout.side, plate, size, { below: labelBelow }), ...size };
}

/** A sensor's reading from the plant (as engine.ts sensorReading; here so this file needs nothing but types from the engine). */
function sensorReading(kind: DeviceKindId, plant: Plant, state: DeviceState): number | null {
  if (kind === "vred" || kind === "kalla010") return state.value / 10;
  switch (SENSOR_RANGES[kind]?.reads) {
    case "tank": return plant.tank;
    case "oven": return plant.ovenC;
    case "supply": return plant.vent.supplyC;
    case "extract": return plant.vent.extractC;
    case "outdoor": return plant.outdoorC;
    case "room": return plant.heat.roomC;
    case "flow": return plant.heat.flowC;
    case "filter": return plant.vent.filterPa;
    default: return null;
  }
}
