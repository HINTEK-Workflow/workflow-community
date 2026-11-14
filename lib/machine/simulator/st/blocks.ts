import { createPidState, PID_DEFAULTS, stepPid, type PidState } from "@/lib/machine/simulator/pid";
import type { FbKind, StType } from "./ast";

// PLC-simulatorn: the function blocks of the dialect, each a pure step over its own state. Own implementation,
// described in our own words: TON on-delay, TOF off-delay, R_TRIG/F_TRIG one cycle on an edge, CTU/CTD counters, PID the
// regulator in lib/machine/simulator/pid.ts.

export type FbValue = number | boolean;
export type FbInputs = Record<string, FbValue>;
export type FbState = { outputs: Record<string, FbValue>; memory: Record<string, FbValue>; pid?: PidState };

export type FbSignature = { inputs: Record<string, StType>; outputs: Record<string, StType>; required: readonly string[] };

export const FB_SIGNATURES: Record<FbKind, FbSignature> = {
  TON: { inputs: { IN: "BOOL", PT: "TIME" }, outputs: { Q: "BOOL", ET: "TIME" }, required: ["IN", "PT"] },
  TOF: { inputs: { IN: "BOOL", PT: "TIME" }, outputs: { Q: "BOOL", ET: "TIME" }, required: ["IN", "PT"] },
  TP: { inputs: { IN: "BOOL", PT: "TIME" }, outputs: { Q: "BOOL", ET: "TIME" }, required: ["IN", "PT"] },
  R_TRIG: { inputs: { CLK: "BOOL" }, outputs: { Q: "BOOL" }, required: ["CLK"] },
  F_TRIG: { inputs: { CLK: "BOOL" }, outputs: { Q: "BOOL" }, required: ["CLK"] },
  CTU: { inputs: { CU: "BOOL", R: "BOOL", PV: "INT" }, outputs: { Q: "BOOL", CV: "INT" }, required: ["CU"] },
  CTD: { inputs: { CD: "BOOL", LD: "BOOL", PV: "INT" }, outputs: { Q: "BOOL", CV: "INT" }, required: ["CD"] },
  PID: { inputs: { SP: "REAL", PV: "REAL", KP: "REAL", TI: "REAL", TD: "REAL", MIN: "REAL", MAX: "REAL", MANUAL: "BOOL", MV: "REAL" }, outputs: { OUT: "REAL", ERR: "REAL", SP: "REAL", PV: "REAL" }, required: ["SP", "PV"] },
};

export function createFbState(kind: FbKind): FbState {
  const outputs: Record<string, FbValue> = {};
  for (const [name, type] of Object.entries(FB_SIGNATURES[kind].outputs)) outputs[name] = type === "BOOL" ? false : 0;
  return { outputs, memory: {}, ...(kind === "PID" ? { pid: createPidState() } : {}) };
}

const bool = (inputs: FbInputs, name: string) => inputs[name] === true;
const num = (inputs: FbInputs, name: string, fallback: number) => (typeof inputs[name] === "number" ? (inputs[name] as number) : fallback);

/** One cycle of the block. `dtMs` is the cycle time in milliseconds. */
export function stepFb(kind: FbKind, state: FbState, inputs: FbInputs, dtMs: number): FbState {
  const memory = { ...state.memory };
  const outputs = { ...state.outputs };
  switch (kind) {
    case "TON": {
      const on = bool(inputs, "IN");
      const pt = num(inputs, "PT", 0);
      const elapsed = on ? Math.min(pt, (typeof memory.et === "number" ? memory.et : 0) + (memory.wasOn === true ? dtMs : 0)) : 0;
      memory.et = elapsed; memory.wasOn = on;
      outputs.Q = on && elapsed >= pt; outputs.ET = elapsed;
      return { outputs, memory };
    }
    case "TOF": {
      const on = bool(inputs, "IN");
      const pt = num(inputs, "PT", 0);
      const previous = typeof memory.et === "number" ? memory.et : 0;
      // The timer runs while the input is off, after it has been on; the output stays on until it has run out.
      const elapsed = on ? 0 : memory.wasOn === true ? Math.min(pt, previous + dtMs) : previous;
      memory.et = elapsed; memory.wasOn = on || memory.wasOn === true;
      if (!on && elapsed >= pt) memory.wasOn = false;
      outputs.Q = on || (memory.wasOn === true && elapsed < pt); outputs.ET = elapsed;
      return { outputs, memory };
    }
    case "TP": {
      // A pulse: Q goes on at the rising edge of IN and stays on for PT whatever IN does; a new pulse needs a new edge after it.
      const on = bool(inputs, "IN");
      const pt = num(inputs, "PT", 0);
      let running = memory.running === true;
      let elapsed = typeof memory.et === "number" ? memory.et : 0;
      if (running) { elapsed = Math.min(pt, elapsed + dtMs); if (elapsed >= pt) running = false; }
      else if (on && memory.last !== true) { running = pt > 0; elapsed = 0; }
      else if (!on) elapsed = 0;
      memory.running = running; memory.et = elapsed; memory.last = on;
      outputs.Q = running; outputs.ET = elapsed;
      return { outputs, memory };
    }
    case "R_TRIG": case "F_TRIG": {
      const clk = bool(inputs, "CLK");
      const last = memory.last === true;
      outputs.Q = kind === "R_TRIG" ? clk && !last : !clk && last && memory.seen === true;
      memory.last = clk; memory.seen = true;
      return { outputs, memory };
    }
    case "CTU": {
      const count = bool(inputs, "CU"), reset = bool(inputs, "R");
      let cv = typeof outputs.CV === "number" ? outputs.CV : 0;
      if (reset) cv = 0;
      else if (count && memory.last !== true) cv = Math.min(32_767, cv + 1);
      memory.last = count;
      outputs.CV = cv; outputs.Q = cv >= num(inputs, "PV", 0);
      return { outputs, memory };
    }
    case "CTD": {
      const count = bool(inputs, "CD"), load = bool(inputs, "LD");
      let cv = typeof outputs.CV === "number" ? outputs.CV : 0;
      if (load) cv = num(inputs, "PV", 0);
      else if (count && memory.last !== true) cv = Math.max(-32_768, cv - 1);
      memory.last = count;
      outputs.CV = cv; outputs.Q = cv <= 0;
      return { outputs, memory };
    }
    case "PID": {
      const params = { kp: num(inputs, "KP", PID_DEFAULTS.kp), tiS: num(inputs, "TI", PID_DEFAULTS.tiS), tdS: num(inputs, "TD", PID_DEFAULTS.tdS), outMin: num(inputs, "MIN", PID_DEFAULTS.outMin), outMax: num(inputs, "MAX", PID_DEFAULTS.outMax) };
      const sp = num(inputs, "SP", 0), pv = num(inputs, "PV", 0);
      let pid = state.pid ?? createPidState();
      if (bool(inputs, "MANUAL")) {
        // In manual the integral follows the hand value, so the switch back to auto is bumpless.
        const mv = Math.min(Math.max(num(inputs, "MV", 0), Math.min(params.outMin, params.outMax)), Math.max(params.outMin, params.outMax));
        pid = { ...pid, integral: params.tiS > 0 ? mv : 0, out: mv, lastPv: pv, error: sp - pv };
      } else pid = stepPid(pid, params, sp, pv, dtMs / 1000);
      outputs.OUT = pid.out; outputs.ERR = pid.error;
      // What it was given, so a trend can draw setpoint and process value beside the output.
      outputs.SP = sp; outputs.PV = pv;
      return { outputs, memory, pid };
    }
  }
}
