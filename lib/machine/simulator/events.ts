import type { MachineEventSeverity, MachineEventType } from "@/lib/machine/intake";
import { INGEST_SCHEMA_VERSION, MAX_TEXT_LENGTH, SIM_EVENT_PREFIX, SIM_TEXT_PREFIX } from "@/lib/machine/simulator/limits";

// PLC-simulatorn: what leaves the device, exactly as an outside gateway would write it. Every event here passes the real parseEvent
// (tests/plc-simulator-device.test.ts).

export type WireValue = number | boolean | string;
export type WireEvent = {
  eventId: string; occurredAt: string; type: MachineEventType; code: string; severity: MachineEventSeverity;
  state?: string; text?: string; basis?: string; values?: Record<string, WireValue>;
};

/** Belongs to the run, not to the configuration, so neither can be saved or imported. */
export type SendPolicy = { textPrefix: boolean; maxSeverity: "warning" | "critical" };
export const SAFE_POLICY: SendPolicy = { textPrefix: true, maxSeverity: "warning" };

export type EventInput = {
  type: MachineEventType; code: string; severity: MachineEventSeverity; state?: string; text?: string; basis?: string;
  values?: Record<string, WireValue>;
};

const cut = (text: string, max: number) => [...text].slice(0, max).join("");
export const clampSeverity = (severity: MachineEventSeverity, policy: Pick<SendPolicy, "maxSeverity">): MachineEventSeverity =>
  policy.maxSeverity === "warning" && (severity === "fault" || severity === "critical") ? "warning" : severity;

/** One per run: it owns the running number, so a resend (the same object) keeps its eventId and a new event never takes an old one. */
export type EventFactory = { make(input: EventInput, nowMs: number): WireEvent; runId: string; readonly policy: SendPolicy; setPolicy(next: SendPolicy): void };

export function createEventFactory(runId: string, initialPolicy: SendPolicy): EventFactory {
  let policy = initialPolicy;
  let seq = 0;
  let lastAt = 0;
  const wire = (input: EventInput, at: number): WireEvent => {
    seq += 1;
    const text = input.text ? cut(`${policy.textPrefix ? SIM_TEXT_PREFIX : ""}${input.text}`, MAX_TEXT_LENGTH) : undefined;
    return {
      eventId: `${SIM_EVENT_PREFIX}${runId}-${seq}`,
      occurredAt: new Date(at).toISOString(),
      type: input.type, code: input.code, severity: clampSeverity(input.severity, policy),
      ...(input.state ? { state: input.state } : {}),
      ...(text ? { text } : {}),
      ...(input.basis ? { basis: cut(input.basis, MAX_TEXT_LENGTH) } : {}),
      ...(input.values && Object.keys(input.values).length ? { values: input.values } : {}),
    };
  };
  return {
    runId,
    get policy() { return policy; },
    setPolicy(next) { policy = next; },
    make(input, nowMs) {
      // Strictly increasing on the real clock: the server tries only the first of two readings with the same time.
      lastAt = Math.max(nowMs, lastAt + 1);
      return wire(input, lastAt);
    },
  };
}

export const eventsBody = (events: readonly unknown[]) => JSON.stringify({ schemaVersion: INGEST_SCHEMA_VERSION, events });
