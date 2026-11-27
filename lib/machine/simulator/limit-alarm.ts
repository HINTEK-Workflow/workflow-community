import { holds } from "@/lib/machine/signal-rules";

// PLC-simulatorn (2026-11-02): a high or low limit on a simulated value, with hysteresis and an on-delay,
// for the PID window's alarms. The comparison is the server's own `holds`, so what the page calls an alarm is what a signal
// rule in Workflow would also call one.

export type LimitAlarmDef = {
  /** gt: above the limit; lt: below it. */
  op: "gt" | "lt";
  limit: number;
  hysteresis: number;
  delayS: number;
};
export type LimitAlarmState = { phase: "normal" | "pending" | "active"; pendingS: number };
export type LimitAlarmChange = "raised" | "cleared" | null;

export const createLimitAlarmState = (): LimitAlarmState => ({ phase: "normal", pendingS: 0 });

/** One sample. The change is `raised` the moment the delay has run out and `cleared` when the value has left the band. */
export function stepLimitAlarm(state: LimitAlarmState, def: LimitAlarmDef, value: number, dtS: number): { state: LimitAlarmState; change: LimitAlarmChange } {
  const active = state.phase === "active";
  const holding = holds({ operator: def.op, value: def.limit, hysteresis: def.hysteresis }, value, active);
  if (!holding) return { state: createLimitAlarmState(), change: active ? "cleared" : null };
  if (active) return { state, change: null };
  const pendingS = state.phase === "pending" ? state.pendingS + dtS : 0;
  if (pendingS < def.delayS) return { state: { phase: "pending", pendingS }, change: null };
  return { state: { phase: "active", pendingS: 0 }, change: "raised" };
}
