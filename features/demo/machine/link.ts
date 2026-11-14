"use client";

import { createEventFactory, type EventFactory, type EventInput } from "@/lib/machine/simulator/events";
import type { Runtime } from "@/features/plc-simulator/surface/use-runtime";
import type { Simulator } from "@/features/plc-simulator/use-simulator";
import { DEMO_MACHINE, demoMachineLayout } from "./example";
import { type DemoMachineMessage, type FeedRow, type LogRow, openDemoChannel, type SimulatorMessage } from "./protocol";
import { basisText, candidateSentence, createObserver, type DemoMode, EMPTY_DESCRIPTION, type Finished, type MachineDescription, needsTick, observe, type Observer, type ObserverLine, type TaughtCause } from "./rules";

// Demokopplingen, the simulator window's side: stands where a small local AI would stand, between the PLC and Workflow. It fetches the
// description from the Workflow window, watches the PLC's digital signals and sends finished alarms back. Exists only on the demo's
// simulator page: the page draws this only with the demo cookie (app/plc-simulator/page.tsx), and with a key or an account nothing here runs.
// It reads the engine's outputs, so the simulator's own cycle is not touched; only a change in the signals costs anything.

const MAX_ROWS = 60;
const PRESS_MS = 180;
const ALIVE_MS = 5000;

export type LinkSnapshot = { bound: boolean; mode: DemoMode; description: MachineDescription; taught: TaughtCause[]; log: LogRow[]; feed: FeedRow[]; demoMachineLoaded: boolean; restarted: boolean };

const eventsFor = (make: EventFactory["make"], finished: Finished, now: number) => {
  const inputs: EventInput[] = [{ type: "alarm", code: finished.code, severity: "fault", state: "raised", text: finished.text }];
  const sentence = candidateSentence(finished.candidates);
  if (sentence) inputs.push({ type: "diagnosis", code: finished.code, severity: "info", text: sentence, basis: basisText(finished) });
  return inputs.map((input) => make(input, now));
};

export function createMachineLink(runtime: Runtime, simulator: Simulator, wfWanted: string | null) {
  let wanted = wfWanted;
  let session: string | null = null;
  let bootedAt = 0;
  let channel: BroadcastChannel | null = null;
  let mode: DemoMode = "traditional";
  let description = EMPTY_DESCRIPTION;
  let taught: TaughtCause[] = [];
  let log: LogRow[] = [];
  let feed: FeedRow[] = [];
  let restarted = false;
  let observer: Observer = createObserver();
  let wasRunning = false;
  let lastSignature = "";
  let sequence = 0;
  const seed = new Uint32Array(2);
  window.crypto.getRandomValues(seed);
  const client = `sim-${seed[0].toString(36)}${seed[1].toString(36)}`;
  const factory = createEventFactory(`demo-${client}`, { textPrefix: true, maxSeverity: "critical" });
  const listeners = new Set<() => void>();

  const hasDemoMachine = () => runtime.getSnapshot().layout.devices.some((device) => device.id === DEMO_MACHINE.start);
  const build = (): LinkSnapshot => ({ bound: session !== null, mode, description, taught, log, feed, demoMachineLoaded: hasDemoMachine(), restarted });
  let snapshot = build();
  const emit = () => { snapshot = build(); for (const listener of listeners) listener(); };

  const post = (message: SimulatorMessage) => { try { channel?.postMessage(message); } catch { /* The other window simply misses it. */ } };
  const write = (line: ObserverLine) => {
    // The same line again right after itself is counted on its row (kundresa 2026-11-07, L14).
    const [last, ...rest] = log;
    log = last && last.text === line.text && last.tone === line.tone ? [{ ...last, at: Date.now(), count: (last.count ?? 1) + 1 }, ...rest]
      : [{ id: ++sequence, at: Date.now(), tone: line.tone, text: line.text }, ...log].slice(0, MAX_ROWS);
    if (session) post({ type: "log", client, to: session, line });
    emit();
  };
  const values = () => {
    const { engine } = runtime.getSnapshot();
    const read: Record<string, boolean> = {};
    engine.inputs.di.forEach((on, index) => { read[`DI${index}`] = on; });
    engine.outputs.do.forEach((on, index) => { read[`DO${index}`] = on; });
    return read;
  };
  /** Starts watching from how things stand now, so a mode change or a STOP is not taken for something that happened. */
  const rebase = () => { observer = { ...createObserver(), last: values() }; lastSignature = ""; };

  /** The fixed alarms of the PLC: in Exempel 1 they go through; in Exempel 2 the local AI's text is what is sent. */
  const sink = (inputs: readonly EventInput[]) => {
    if (!session) return false;
    if (mode !== "traditional") { write({ tone: "info", text: "PLC:ns fasta larm skickas inte i det här exemplet." }); return false; }
    const now = Date.now();
    post({ type: "events", client, to: session, events: inputs.map((input) => factory.make(input, now)), diagnosis: null });
    return true;
  };

  function onRuntime() {
    const { engine } = runtime.getSnapshot();
    if (mode !== "mapped") { wasRunning = engine.run; return; }
    if (!engine.run) { if (wasRunning) { write({ tone: "info", text: "PLC:n står i STOP. Ingen bevakning." }); rebase(); } wasRunning = false; return; }
    if (!wasRunning) { wasRunning = true; rebase(); }
    let signature = "";
    for (const on of engine.inputs.di) signature += on ? "1" : "0";
    for (const on of engine.outputs.do) signature += on ? "1" : "0";
    if (signature === lastSignature && !needsTick(observer)) return;
    lastSignature = signature;
    const result = observe(observer, description, taught, { atMs: engine.clockMin * 60_000, values: values() });
    observer = result.state;
    for (const line of result.log) write(line);
    for (const finished of result.finished) {
      if (!session) { write({ tone: "note", text: "Workflow-fönstret är inte öppet, så larmet kom inte fram." }); continue; }
      post({ type: "events", client, to: session, events: eventsFor(factory.make, finished, Date.now()), diagnosis: { pattern: finished.pattern, patternLabel: finished.patternLabel, observed: finished.observed, mapping: finished.mapping, candidates: finished.candidates } });
    }
  }

  function onMessage(message: DemoMachineMessage) {
    switch (message.type) {
      case "config": {
        // The window the simulator was opened from stands first; the newest of the others otherwise.
        if (!session && wanted && message.session !== wanted) return;
        if (session && message.session !== session) {
          if (wanted === session || message.bootedAt < bootedAt) return;
          log = []; feed = []; restarted = true;
        }
        const newMode = message.mode !== mode;
        session = message.session;
        bootedAt = message.bootedAt;
        mode = message.mode;
        description = message.description;
        taught = message.taught;
        if (!feed.length) feed = message.feed;
        simulator.setDemoSink(sink);
        if (newMode) rebase();
        emit();
        return;
      }
      case "feed": if (message.session === session) { feed = [message.row, ...feed].slice(0, 10); emit(); } return;
      case "bye":
        if (message.session !== session) return;
        if (wanted === session) wanted = null;
        session = null; restarted = true; log = []; feed = [];
        description = EMPTY_DESCRIPTION; taught = [];
        simulator.setDemoSink(null);
        emit();
        return;
      default:
    }
  }

  const pressOnce = () => { runtime.touch(DEMO_MACHINE.start, { pressed: true }); window.setTimeout(() => runtime.touch(DEMO_MACHINE.start, { pressed: false }), PRESS_MS); };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    mount() {
      channel = openDemoChannel(onMessage);
      const unsubscribe = runtime.subscribe(onRuntime);
      const timer = window.setInterval(() => {
        // The window asked for did not answer: any demo window will do.
        if (session) post({ type: "alive", client, to: session }); else { wanted = null; post({ type: "hello", client, wf: null }); }
        const loaded = hasDemoMachine();
        if (loaded !== snapshot.demoMachineLoaded) emit();
      }, ALIVE_MS);
      const leave = () => { if (session) post({ type: "bye-sim", client, to: session }); };
      window.addEventListener("pagehide", leave);
      post({ type: "hello", client, wf: wanted });
      return () => { leave(); window.removeEventListener("pagehide", leave); window.clearInterval(timer); unsubscribe(); simulator.setDemoSink(null); channel?.close(); channel = null; session = null; };
    },
    /** The ready machine, running. The drawing is the visitor's for now and is not saved over anything. */
    loadDemoMachine() {
      runtime.adoptTemporary(demoMachineLayout());
      runtime.setRun(true);
      rebase();
      emit();
    },
    setMode(next: DemoMode) { if (session) post({ type: "set-mode", client, to: session, mode: next }); },
    pressStart: pressOnce,
    pressManyTimes(times: number) { for (let index = 0; index < times; index += 1) window.setTimeout(pressOnce, index * (PRESS_MS * 2)); },
    toggleProtection() {
      const device = runtime.getSnapshot().engine.devices[DEMO_MACHINE.protection];
      runtime.touch(DEMO_MACHINE.protection, { on: !device?.on });
    },
    protectionOn: () => Boolean(runtime.getSnapshot().engine.devices[DEMO_MACHINE.protection]?.on),
  };
}
export type MachineLink = ReturnType<typeof createMachineLink>;
