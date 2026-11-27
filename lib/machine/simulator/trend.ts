import type { PidLoopState } from "./pid-loop";
import type { Compiled, RunState } from "./st/interpreter";
import { allIo, ioName, nameIo } from "./st/io";
import type { EngineState } from "./surface/engine";

// PLC-simulatorn, Trend (2026-11-04: "kopplad till det som händer i PLC-systemet"): the pens are the PLC's own things, chosen by the
// person: a tag of the program, a terminal, a block's output, a process value behind the sensors, the regulator's values. A sample's time
// is the simulated clock, so the curves follow the speed. Pens of one unit that belong together share a lane (setpoint and process
// value); every other pen has a lane of its own with a scale of its own, all on the same time axis, never two value axes in one plot.

export const PROCESS_PENS = { tank: "Tanknivå", oven: "Ugnstemperatur", supply: "Tilluft", extract: "Frånluft", outdoor: "Utetemperatur", room: "Rumstemperatur", flow: "Framledning", filter: "Filtertryck" } as const;
export const REGULATOR_PENS = { sp: "Regulator börvärde", pv: "Regulator ärvärde", out: "Regulator utsignal" } as const;
const PROCESS_UNIT: Record<keyof typeof PROCESS_PENS, string> = { tank: "%", oven: "°C", supply: "°C", extract: "°C", outdoor: "°C", room: "°C", flow: "°C", filter: "Pa" };

export type PenSource = { engine: Pick<EngineState, "inputs" | "outputs" | "program" | "plant">; pid: Pick<PidLoopState, "setpoint" | "pv" | "out"> };
export type PenInfo = { id: string; label: string; unit: string; digital: boolean; lane: string };

/** What a pen's id says: its name, unit and lane. `compiled` tells a bit from a number. */
export function penInfo(id: string, compiled: Compiled | null): PenInfo {
  const [source, rest = ""] = id.split(/:(.*)/);
  if (source === "plant") return { id, label: PROCESS_PENS[rest as keyof typeof PROCESS_PENS] ?? rest, unit: PROCESS_UNIT[rest as keyof typeof PROCESS_UNIT] ?? "", digital: false, lane: id };
  if (source === "pid") return { id, label: REGULATOR_PENS[rest as keyof typeof REGULATOR_PENS] ?? rest, unit: rest === "out" ? "%" : "°C", digital: false, lane: rest === "out" ? id : "pid" };
  if (source === "io") { const point = nameIo(rest); return { id, label: rest, unit: "", digital: point?.kind === "DI" || point?.kind === "DO", lane: id }; }
  if (source === "fb") {
    const [block, output] = rest.split(".");
    const digital = output === "Q";
    return { id, label: rest, unit: output === "ET" ? "ms" : "", digital, lane: output === "SP" || output === "PV" ? `fb:${block}` : id };
  }
  const info = compiled?.vars.get(rest);
  return { id, label: rest, unit: "", digital: info ? info.type === "BOOL" : false, lane: id };
}

/** A pen's value now, as a number (a bit is 0 or 1); null when the PLC has no such thing right now. */
export function readPen(id: string, { engine, pid }: PenSource): number | null {
  const [source, rest = ""] = id.split(/:(.*)/);
  const asNumber = (value: unknown) => (typeof value === "boolean" ? (value ? 1 : 0) : typeof value === "number" ? value : null);
  switch (source) {
    case "var": return asNumber((engine.program as RunState | null)?.vars[rest]);
    case "fb": { const [block, output] = rest.split("."); return asNumber((engine.program as RunState | null)?.fbs[block]?.outputs[output]); }
    case "io": {
      const point = nameIo(rest);
      if (!point) return null;
      return asNumber(point.kind === "DI" ? engine.inputs.di[point.index] : point.kind === "DO" ? engine.outputs.do[point.index] : point.kind === "AI" ? engine.inputs.ai[point.index] : engine.outputs.ao[point.index]);
    }
    case "pid": return rest === "sp" ? pid.setpoint : rest === "pv" ? pid.pv : rest === "out" ? pid.out : null;
    case "plant": {
      const { plant } = engine;
      switch (rest) {
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
    default: return null;
  }
}

/** Everything a pen can be set on right now, for the list in the panel. */
export function penCatalogue(compiled: Compiled | null): { group: string; pens: { id: string; label: string }[] }[] {
  const named = new Set<string>();
  const tags = [...(compiled?.vars.values() ?? [])].map((info) => { if (info.io) named.add(ioName(info.io)); return { id: `var:${info.name}`, label: info.name }; });
  const blocks = [...(compiled?.fbs ?? [])].flatMap(([name, kind]) => {
    const outputs = kind === "PID" ? ["SP", "PV", "OUT"] : kind === "TON" || kind === "TOF" || kind === "TP" ? ["Q", "ET"] : kind === "CTU" || kind === "CTD" ? ["Q", "CV"] : ["Q"];
    return outputs.map((output) => ({ id: `fb:${name}.${output}`, label: `${name}.${output}` }));
  });
  return [
    { group: "Taggar", pens: tags },
    { group: "Block", pens: blocks },
    { group: "Plintar", pens: allIo().filter((point) => !named.has(ioName(point))).map((point) => ({ id: `io:${ioName(point)}`, label: ioName(point) })) },
    { group: "Process", pens: (Object.keys(PROCESS_PENS) as (keyof typeof PROCESS_PENS)[]).map((key) => ({ id: `plant:${key}`, label: PROCESS_PENS[key] })) },
    { group: "Regulator", pens: (Object.keys(REGULATOR_PENS) as (keyof typeof REGULATOR_PENS)[]).map((key) => ({ id: `pid:${key}`, label: REGULATOR_PENS[key] })) },
  ].filter((group) => group.pens.length);
}

// ---------- the samples ----------

export type TrendSample = { t: number; values: Record<string, number | null> };
/** A sample at most this often in real time; at 1× the buffer holds several minutes, at 600× days. */
export const TREND_SAMPLE_REAL_MS = 200;
export const MAX_TREND_SAMPLES = 2400;

export type TrendBuffer = { samples: TrendSample[]; lastRealMs: number; version: number };
export const createTrendBuffer = (): TrendBuffer => ({ samples: [], lastRealMs: 0, version: 0 });

/** One step: a new sample when it is time. `t` is the simulated clock in seconds: it grows with the speed. */
export function sampleTrend(buffer: TrendBuffer, pens: readonly string[], source: PenSource, clockMin: number, nowMs: number): boolean {
  if (!pens.length || nowMs - buffer.lastRealMs < TREND_SAMPLE_REAL_MS) return false;
  buffer.lastRealMs = nowMs;
  const values: Record<string, number | null> = {};
  for (const pen of pens) values[pen] = readPen(pen, source);
  buffer.samples.push({ t: clockMin * 60, values });
  if (buffer.samples.length > MAX_TREND_SAMPLES) buffer.samples.splice(0, buffer.samples.length - MAX_TREND_SAMPLES);
  buffer.version += 1;
  return true;
}

export type TrendLane = { key: string; pens: PenInfo[]; digital: boolean; min: number; max: number };

/** The lanes for a set of pens over the samples in the window: pens that belong together in one, a scale from what is visible. */
export function trendLanes(pens: readonly PenInfo[], samples: readonly TrendSample[]): TrendLane[] {
  const lanes = new Map<string, TrendLane>();
  for (const pen of pens) {
    const lane = lanes.get(pen.lane);
    if (lane) lane.pens.push(pen); else lanes.set(pen.lane, { key: pen.lane, pens: [pen], digital: pen.digital, min: 0, max: 1 });
  }
  for (const lane of lanes.values()) {
    if (lane.digital) continue;
    let min = Infinity, max = -Infinity;
    for (const sample of samples) for (const pen of lane.pens) { const value = sample.values[pen.id]; if (value !== null && value !== undefined) { min = Math.min(min, value); max = Math.max(max, value); } }
    if (min === Infinity) { lane.min = 0; lane.max = 1; continue; }
    const pad = Math.max((max - min) * 0.08, Math.abs(max) * 0.01, 0.5);
    lane.min = min - pad; lane.max = max + pad;
  }
  return [...lanes.values()];
}

/** The clock text under the time axis. */
export function trendClockText(tSeconds: number) {
  const total = Math.floor(((tSeconds % 604_800) + 604_800) % 604_800);
  const hour = Math.floor(total / 3600) % 24, minute = Math.floor(total / 60) % 60, second = total % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}
