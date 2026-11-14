import type { WireEvent } from "@/lib/machine/simulator/events";
import type { Severity } from "@/lib/operator/rules";
import type { Candidate, DemoMode, MachineDescription, ObserverLine, TaughtCause } from "./rules";

// Demokopplingen: what the demo's Workflow window and the simulator's window say to each other. A BroadcastChannel reaches only windows of
// the same origin in the same browser: nothing here leaves the computer.

export const DEMO_MACHINE_CHANNEL = "hintek-demo-machine-v1";
export const DEMO_MACHINE_SOURCE_NAME = "Demokoppling";

/** `count`: the same line said again right after itself is one row with a count (kundresa 2026-11-07, L14: 20 equal rows). */
export type LogRow = { id: number; at: number; tone: ObserverLine["tone"]; text: string; count?: number };
/** The line said again, "Vänta … (3 gånger)". */
export const logRowText = (row: Pick<LogRow, "text" | "count">) => row.count && row.count > 1 ? `${row.text} (${row.count} gånger)` : row.text;
export type OrderOutcome =
  | { kind: "created"; taskId: string; title: string }
  | { kind: "skipped"; reason: "mode_off" | "cooldown" | "daily_cap" | "open_order"; taskId: string | null; text: string }
  | { kind: "none"; text: string };
/** What came with an alarm from the simulated local AI: the basis and the suggestions. */
export type Diagnosis = { pattern: string; patternLabel: string; observed: string[]; mapping: string[]; candidates: Candidate[] };
export type FeedRow = {
  id: string; at: number; mode: DemoMode; code: string; severity: string; state: string | null; text: string; outcome: OrderOutcome; diagnosis: Diagnosis | null; taught: string | null;
  /** The PLC or a person on the operator page. */
  origin: "plc" | "operator";
  /** What the operator wrote, and what it did, in words. */
  note: string | null;
  /** The PLC's alarm text this row holds: its own, or the machine's latest on a report. */
  plcAlarm: string | null;
};
/** A fault report from the demo's operator page, already checked by the page's own rules. */
export type DemoFaultReport = { id: string; machineId: string; machineLabel: string; cause: string; text: string; severity: Severity; reporter: string; accountName: string; label: string; onCall: boolean };

export type WorkflowMessage =
  | { type: "config"; session: string; bootedAt: number; mode: DemoMode; description: MachineDescription; taught: TaughtCause[]; feed: FeedRow[] }
  | { type: "feed"; session: string; row: FeedRow }
  | { type: "report-done"; session: string; client: string; id: string }
  | { type: "bye"; session: string };
export type SimulatorMessage =
  | { type: "hello"; client: string; wf: string | null; role?: "operator" }
  | { type: "fault-report"; client: string; to: string; report: DemoFaultReport }
  | { type: "alive"; client: string; to: string }
  | { type: "bye-sim"; client: string; to: string }
  | { type: "set-mode"; client: string; to: string; mode: DemoMode }
  | { type: "log"; client: string; to: string; line: ObserverLine }
  | { type: "events"; client: string; to: string; events: WireEvent[]; diagnosis: Diagnosis | null };
export type DemoMachineMessage = WorkflowMessage | SimulatorMessage;

/** One open channel, or null where the browser has none: the two windows then simply do not meet, and the pages say so. */
export function openDemoChannel(onMessage: (message: DemoMachineMessage) => void) {
  if (typeof BroadcastChannel === "undefined") return null;
  const channel = new BroadcastChannel(DEMO_MACHINE_CHANNEL);
  channel.onmessage = (event: MessageEvent<DemoMachineMessage>) => onMessage(event.data);
  return channel;
}
