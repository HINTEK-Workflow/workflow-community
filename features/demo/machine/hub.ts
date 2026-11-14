"use client";

import { analyse, type Finding } from "@/lib/machine/analysis";
import { parseEvent } from "@/lib/machine/intake";
import { SIM_TEXT_PREFIX } from "@/lib/machine/simulator/limits";
import type { WireEvent } from "@/lib/machine/simulator/events";
import { announce, notice } from "@/lib/workflow/toast";
import { demoDatabase } from "../demo-backend";
import { DEMO_CONNECTION_MACHINE_ID } from "../demo-operator";
import { demoMachineEvents, demoMachineIngest, demoMachineSource } from "../demo-connections";
import { considerDemoAlarm, finishDemoOrder, makeDemoFaultOrder, noteCauseOnOrder, skipDemoRest } from "./orders";
import { type DemoFaultReport, type DemoMachineMessage, type Diagnosis, type FeedRow, type LogRow, openDemoChannel, type WorkflowMessage } from "./protocol";
import { describedEnough, type DemoMode, inSentence, EMPTY_DESCRIPTION, type MachineDescription, mappingLine, READY_DESCRIPTION, reportCandidates, SIMULATED_ON_CALL_TEXT, type TaughtCause, teach } from "./rules";

// Demokopplingen, the Workflow window's side: it holds the demo's truth in this page's memory, like the rest of the demo. The description,
// what has been taught, the alarms and the orders live here, and the simulator's window asks for them over the channel, as a local AI beside
// a PLC would fetch its mapping from Workflow. A reload of this window starts the demo over, as the demo promises; the simulator is told. A
// reload of the simulator's window loses nothing, since it asks again. Nothing is stored in the browser and nothing is sent anywhere. It
// starts only where the demo's own backend has been installed.

const MAX_LOG = 80;
const MAX_FEED = 40;
const SIMULATOR_GONE_MS = 70_000;
export type ContextEvent = { id: number; at: number; text: string };
export type HubSnapshot = {
  session: string; mode: DemoMode; description: MachineDescription; taught: TaughtCause[]; feed: FeedRow[]; log: LogRow[]; history: ContextEvent[];
  simulatorOpen: boolean; findings: Finding[]; sourceMode: string; cooldownMinutes: number;
};

let channel: BroadcastChannel | null = null;
let snapshot: HubSnapshot = { session: "", mode: "traditional", description: EMPTY_DESCRIPTION, taught: [], feed: [], log: [], history: [], simulatorOpen: false, findings: [], sourceMode: "direct", cooldownMinutes: 1 };
const bootedAt = Date.now();
const listeners = new Set<() => void>();
const clients = new Map<string, number>();
const seenEvents = new Set<string>();
let sequence = 0;

const set = (change: Partial<HubSnapshot>) => { snapshot = { ...snapshot, ...change }; for (const listener of listeners) listener(); };
const post = (message: WorkflowMessage) => { try { channel?.postMessage(message); } catch { /* The other window simply misses it. */ } };
const sendConfig = () => post({ type: "config", session: snapshot.session, bootedAt, mode: snapshot.mode, description: snapshot.description, taught: snapshot.taught, feed: snapshot.feed.slice(0, 5) });
const remember = (text: string, at = Date.now()) => [{ id: ++sequence, at, text }, ...snapshot.history].slice(0, 30);
const sourceFacts = () => {
  const source = demoMachineSource(demoDatabase(), new Date());
  return { sourceMode: source.alarmMode, cooldownMinutes: source.cooldownMinutes, source };
};
const refreshSimulatorOpen = () => {
  const now = Date.now();
  for (const [client, at] of clients) if (now - at > SIMULATOR_GONE_MS) clients.delete(client);
  const open = clients.size > 0;
  if (open !== snapshot.simulatorOpen) set({ simulatorOpen: open });
};

function ingest(events: readonly WireEvent[], diagnosis: Diagnosis | null) {
  const now = new Date();
  const db = demoDatabase();
  for (const wire of events) {
    if (seenEvents.has(wire.eventId)) continue;
    // The intake's own check of the format: what the demo takes is what the product would.
    const parsed = parseEvent(wire, now);
    if (!parsed.ok) continue;
    seenEvents.add(wire.eventId);
    const event = parsed.event;
    const { source } = sourceFacts();
    demoMachineIngest(db, { eventId: event.eventId, occurredAt: wire.occurredAt, type: event.type, code: event.code, severity: event.severity, state: event.state ?? null, text: event.text ?? "", basis: event.basis ?? null, values: null }, now);
    if (event.type !== "alarm") continue;
    const alarm = { type: event.type, code: event.code, severity: event.severity, state: event.state ?? null, text: event.text ?? "", occurredAt: new Date(wire.occurredAt) };
    const outcome = considerDemoAlarm(db, { id: source.id, name: source.name, alarmMode: source.alarmMode, cooldownMinutes: source.cooldownMinutes }, alarm, diagnosis, now);
    const row: FeedRow = { id: wire.eventId, at: now.getTime(), mode: snapshot.mode, code: event.code, severity: event.severity, state: event.state ?? null, text: event.text ?? event.code, outcome, diagnosis, taught: null, origin: "plc", note: null, plcAlarm: event.text ?? null };
    const stored = demoMachineEvents(db, now).map((item) => ({ occurredAt: new Date(item.occurredAt), type: item.type, code: item.code, severity: item.severity, state: item.state }));
    set({ feed: [row, ...snapshot.feed].slice(0, MAX_FEED), findings: analyse(stored, now, null, { kinds: ["flutter"] }) });
    post({ type: "feed", session: snapshot.session, row });
    if (outcome.kind === "created") announce(`Arbetsorder från ${source.name}: ${alarm.text.replace(SIM_TEXT_PREFIX, "")}`);
  }
}

/** A report from the operator page becomes a marked work order here, in the demo's Workflow, by the product's own text. */
function ingestReport(report: DemoFaultReport, client: string) {
  const now = new Date();
  const db = demoDatabase();
  const latest = snapshot.feed.find((row) => row.origin === "plc" && row.state !== "cleared");
  const known = snapshot.mode === "mapped" && describedEnough(snapshot.description) && report.machineId === DEMO_CONNECTION_MACHINE_ID;
  const pattern = `report:${report.machineId}`;
  const diagnosis: Diagnosis | null = known ? {
    pattern, patternLabel: `Felanmälan på ${report.machineLabel}`, observed: latest ? [`Senast: ${latest.text.replace(SIM_TEXT_PREFIX, "")}.`] : ["Inget ovanligt observerat än."],
    mapping: snapshot.description.rows.filter((row) => row.function.trim()).map(mappingLine), candidates: reportCandidates(pattern, snapshot.description, snapshot.taught),
  } : null;
  const plcAlarm = report.machineId === DEMO_CONNECTION_MACHINE_ID ? latest?.text ?? null : null;
  const task = makeDemoFaultOrder(db, report, plcAlarm, diagnosis, now);
  const words = [report.text ? `Operatören skrev: ”${report.text}”.` : "", report.onCall ? SIMULATED_ON_CALL_TEXT : ""].filter(Boolean).join(" ");
  const row: FeedRow = { id: report.id, at: now.getTime(), mode: snapshot.mode, code: report.label, severity: report.severity, state: null, text: task.title, outcome: { kind: "created", taskId: task.id, title: task.title }, diagnosis, taught: null, origin: "operator", note: words || null, plcAlarm };
  set({ feed: [row, ...snapshot.feed].slice(0, MAX_FEED), history: remember(`En felanmälan kom från operatörssidan: ${report.cause}.`) });
  post({ type: "feed", session: snapshot.session, row });
  post({ type: "report-done", session: snapshot.session, client, id: report.id });
  announce(`Felanmälan från operatörssidan: ${report.cause} – ${report.machineLabel}`);
}

function onMessage(message: DemoMachineMessage) {
  if (message.type === "hello") {
    if (message.wf && message.wf !== snapshot.session) return;
    if (message.role !== "operator") clients.set(message.client, Date.now());
    refreshSimulatorOpen();
    sendConfig();
    return;
  }
  if (!("to" in message) || message.to !== snapshot.session) return;
  switch (message.type) {
    case "alive": clients.set(message.client, Date.now()); refreshSimulatorOpen(); return;
    case "bye-sim": clients.delete(message.client); refreshSimulatorOpen(); return;
    case "set-mode": setDemoMachineMode(message.mode); return;
    case "log": {
      const [last, ...rest] = snapshot.log;
      // The same line again right after itself is counted on its row, not added as a new one.
      if (last && last.text === message.line.text && last.tone === message.line.tone) set({ log: [{ ...last, at: Date.now(), count: (last.count ?? 1) + 1 }, ...rest] });
      else set({ log: [{ id: ++sequence, at: Date.now(), tone: message.line.tone, text: message.line.text }, ...snapshot.log].slice(0, MAX_LOG) });
      return;
    }
    case "events": ingest(message.events, message.diagnosis); return;
    case "fault-report": ingestReport(message.report, message.client); return;
  }
}

/** Started by the demo's app after its backend. Only there: the flag is set by installDemoBackend and by nothing else. */
export function installDemoMachineHub() {
  if (channel || typeof window === "undefined") return;
  if (!(window as typeof window & { __workflowDemo?: boolean }).__workflowDemo) return;
  const seed = new Uint32Array(2);
  window.crypto.getRandomValues(seed);
  const facts = sourceFacts();
  snapshot = { ...snapshot, session: `wf-${seed[0].toString(36)}${seed[1].toString(36)}`, sourceMode: facts.sourceMode, cooldownMinutes: facts.cooldownMinutes };
  channel = openDemoChannel(onMessage);
  window.setInterval(refreshSimulatorOpen, 5000);
  // A reload here starts everything over, and a simulator that is already open hears it first.
  window.addEventListener("pagehide", () => post({ type: "bye", session: snapshot.session }));
  sendConfig();
}

export const subscribeDemoMachine = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const demoMachineSnapshot = () => snapshot;

export function setDemoMachineMode(mode: DemoMode) {
  if (mode === snapshot.mode) return;
  // Each example starts without the other's rest; an order still open stays open.
  skipDemoRest(demoDatabase(), new Date());
  set({ mode, history: remember(mode === "mapped" ? "Bytte till Exempel 2, med signalmappning." : "Bytte till Exempel 1, traditionellt.") });
  sendConfig();
}
export function setDemoMachineDescription(description: MachineDescription) {
  const was = describedEnough(snapshot.description), is = describedEnough(description);
  set({ description, ...(was !== is ? { history: remember(is ? "Maskinen är beskriven. Nu kan förslag byggas." : "Beskrivningen är borta. Inga förslag längre.") } : {}) });
  sendConfig();
}
export function fillReadyDescription() {
  const was = describedEnough(snapshot.description);
  set({ description: { text: READY_DESCRIPTION.text, rows: READY_DESCRIPTION.rows.map((row) => ({ ...row })) }, ...(!was ? { history: remember("Exemplet fylldes i: en text och fyra signaler.") } : {}) });
  sendConfig();
}
export function clearDemoMachineDescription() { setDemoMachineDescription({ text: "", rows: [] }); }

/** On an alarm: what the fault was. It goes into the context and on the work order. */
export function teachFromAlarm(rowId: string, cause: string) {
  const text = cause.trim();
  const row = snapshot.feed.find((item) => item.id === rowId);
  if (!text || !row?.diagnosis) return;
  const now = Date.now();
  const taught = teach(snapshot.taught, { pattern: row.diagnosis.pattern, patternLabel: row.diagnosis.patternLabel, cause: text, id: `taught-${++sequence}`, at: now });
  if (row.outcome.kind === "created") noteCauseOnOrder(demoDatabase(), row.outcome.taskId, text, new Date(now));
  set({ taught, feed: snapshot.feed.map((item) => item.id === rowId ? { ...item, taught: text } : item), history: remember(`Lärde sig: ”${text}” vid ${inSentence(row.diagnosis.patternLabel)}.`, now) });
  sendConfig();
  notice(`Sparat: ${text}`);
}
export function editTaught(id: string, cause: string) {
  const text = cause.trim();
  if (!text) return;
  set({ taught: snapshot.taught.map((item) => item.id === id ? { ...item, cause: text } : item) });
  sendConfig();
}
export function removeTaught(id: string) {
  const found = snapshot.taught.find((item) => item.id === id);
  if (!found) return;
  set({ taught: snapshot.taught.filter((item) => item !== found), history: remember(`Tog bort: ”${found.cause}”.`) });
  sendConfig();
}
export function finishMachineOrder(taskId: string) {
  finishDemoOrder(demoDatabase(), taskId, new Date());
  set({ feed: [...snapshot.feed], history: remember("En arbetsorder färdigställdes. Nästa larm får göra en ny efter vilan.") });
}
export function skipMachineRest() { skipDemoRest(demoDatabase(), new Date()); notice("Vilan är hoppad över, bara i demon."); }

