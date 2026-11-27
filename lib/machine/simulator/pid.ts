// PLC-simulatorn (2026-11-02: "lägg till PID med trendlinje"): one PID regulator, the same maths behind
// the PID window and the PID function block in ST. Pure: the state is a plain object and one step gives the next. Parallel
// (ISA) form with the time constants in seconds, as a Swedish electrician meets them on a compact controller: Kp gain, Ti
// integral time (0 = no integral), Td derivative time (0 = no derivative). The derivative acts on the measurement, not on the
// error, so a setpoint step gives no kick. Anti-windup by clamping: the integral stops growing while the output sits on a limit
// in the same direction.

export type PidParams = {
  kp: number;
  /** Integral time in seconds; 0 turns the integral off. */
  tiS: number;
  /** Derivative time in seconds; 0 turns the derivative off. */
  tdS: number;
  outMin: number;
  outMax: number;
  /** Reverse acting (heating): a value below the setpoint raises the output. Direct acting (cooling) inverts the error. */
  direct?: boolean;
};

export type PidState = { integral: number; lastPv: number | null; out: number; error: number };

export const PID_DEFAULTS: PidParams = { kp: 2, tiS: 60, tdS: 0, outMin: 0, outMax: 100 };

export const createPidState = (): PidState => ({ integral: 0, lastPv: null, out: 0, error: 0 });

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** One sample. `dtS` is the sample time in seconds; a zero or negative step leaves the state as it is. */
export function stepPid(state: PidState, params: PidParams, setpoint: number, pv: number, dtS: number): PidState {
  if (!(dtS > 0) || !Number.isFinite(setpoint) || !Number.isFinite(pv)) return state;
  const low = Math.min(params.outMin, params.outMax);
  const high = Math.max(params.outMin, params.outMax);
  const sign = params.direct ? -1 : 1;
  const error = sign * (setpoint - pv);
  const proportional = params.kp * error;
  // The derivative of the measurement, in the error's direction: -dPV/dt for reverse action.
  const derivative = params.tdS > 0 && state.lastPv !== null ? -sign * params.kp * params.tdS * ((pv - state.lastPv) / dtS) : 0;
  let integral = state.integral;
  if (params.tiS > 0) {
    const candidate = integral + (params.kp / params.tiS) * error * dtS;
    const unclamped = proportional + candidate + derivative;
    // Clamping anti-windup: the integral may only move away from a limit the output is pressing against.
    const pressingHigh = unclamped > high && error > 0;
    const pressingLow = unclamped < low && error < 0;
    if (!pressingHigh && !pressingLow) integral = candidate;
  } else integral = 0;
  const out = clamp(proportional + integral + derivative, low, high);
  return { integral, lastPv: pv, out, error };
}

/** Bumpless start at a given output: the integral takes what the output needs, so the first sample does not jump. */
export function presetPid(state: PidState, params: PidParams, out: number): PidState {
  return { ...state, integral: params.tiS > 0 ? clamp(out, Math.min(params.outMin, params.outMax), Math.max(params.outMin, params.outMax)) : 0, out };
}

/** What a typed parameter set may be: finite, limits apart, times not negative. */
export function pidProblem(params: PidParams): string | null {
  for (const [name, value] of Object.entries(params)) if (typeof value === "number" && !Number.isFinite(value)) return `${name} är inte ett tal.`;
  if (params.tiS < 0 || params.tdS < 0) return "Ti och Td kan inte vara negativa.";
  if (params.outMin === params.outMax) return "Min och max för utsignalen måste skilja sig.";
  return null;
}
