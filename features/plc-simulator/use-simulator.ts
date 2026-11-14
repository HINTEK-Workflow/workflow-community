"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createDevice, deviceStatus, fetchTransport, isSourceKey, type Device, type DeviceState, type DeviceStatus } from "@/lib/machine/simulator/device";
import { createEventFactory, type EventFactory, type EventInput } from "@/lib/machine/simulator/events";
import { newRunId, seededRandom } from "@/lib/machine/simulator/random";
import { MODULE_OFF_TEXT } from "@/lib/machine/simulator/words";
import { announce, notice } from "@/lib/workflow/toast";

// PLC-simulatorn (2026-11-02): the connection to Workflow, outside React's state: a device that speaks to the intake as an outside
// one does. The key lives in one closure variable: it is never in the snapshot, in a prop or in anything saved, and only the device's
// getKey can ask for it, at the moment of a call. Nothing runs when the window is closed: everything stops on unmount and on pagehide.

const TICK_MS = 250;
const PUBLISH_EVERY = 2;

export type SimSnapshot = {
  nowMs: number; hasKey: boolean;
  understood: boolean; allowFaults: boolean;
  device: DeviceState; status: DeviceStatus;
  /** An alarm from the surface or the regulator would leave for Workflow right now. */
  sendsLocal: boolean;
  /** The public demo's connection is up. Never true with an account. */
  demoLinked: boolean;
};

function createSimulator() {
  // The one place the key is held.
  let key: string | null = null;
  let random = seededRandom(1);
  const clock = () => Date.now();
  const device: Device = createDevice({
    transport: (request) => fetchTransport(window.fetch.bind(window))(request),
    getKey: () => key, clock, random: () => random(),
  });
  let understood = false, allowFaults = false;
  let tickCount = 0, seenAccepted = false;
  let lastHalt = device.getState().halt.kind;
  let factory: EventFactory | null = null;
  // Only the demo's page sets this; on a real page it stays null and the alarms go the way they always have.
  let demoSink: ((inputs: readonly EventInput[]) => boolean) | null = null;
  const stopListeners = new Set<() => void>();

  const listeners = new Set<() => void>();
  const build = (nowMs: number): SimSnapshot => {
    const state = device.getState();
    return { nowMs, hasKey: key !== null, understood, allowFaults, device: state, status: deviceStatus(state, nowMs), sendsLocal: key !== null && understood && state.halt.kind !== "key_refused", demoLinked: demoSink !== null };
  };
  // The first frame is the same on the server and the client: nothing depends on the clock until the page has mounted.
  let snapshot = build(0);
  const emit = () => { snapshot = build(clock()); for (const listener of listeners) listener(); };

  /** Important changes also get one short toast; the reason itself stands in the panel and the log. */
  function noteChanges() {
    const state = device.getState();
    const halt = state.halt.kind;
    if (halt !== lastHalt) {
      if (halt === "key_refused") announce("Simulatorn stoppade: nyckeln nekades.", true);
      if (halt === "module_off") announce(MODULE_OFF_TEXT, true);
      lastHalt = halt;
    }
    if (!seenAccepted && state.acceptedEvents > 0) { seenAccepted = true; notice("Workflow tog emot den första händelsen."); }
  }

  function tick() {
    void device.pump();
    noteChanges();
    tickCount += 1;
    if (tickCount % PUBLISH_EVERY === 0) emit();
  }

  function stop() {
    device.stop();
    for (const listener of stopListeners) listener();
    emit();
  }

  const policyNow = () => ({ textPrefix: true, maxSeverity: allowFaults ? ("critical" as const) : ("warning" as const) });
  const factoryNow = () => {
    if (!factory) factory = createEventFactory(`desk-${newRunId(clock(), random)}`, policyNow());
    else factory.setPolicy(policyNow());
    return factory;
  };

  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    /** Started by the page. Reversible, since React may mount twice in development. */
    mount() {
      const seed = new Uint32Array(1);
      window.crypto.getRandomValues(seed);
      random = seededRandom(seed[0]);
      const unsubscribe = device.subscribe(emit);
      window.addEventListener("pagehide", stop);
      const timer = setInterval(tick, TICK_MS);
      emit();
      return () => { stop(); clearInterval(timer); unsubscribe(); window.removeEventListener("pagehide", stop); };
    },
    /** True when the value was a key and has been taken: the field must then be emptied. */
    pasteKey(value: string) {
      const candidate = value.trim();
      if (!isSourceKey(candidate)) return false;
      // What waits was made for the old source, under the choices made then: it does not go along to another one.
      if (candidate === key) device.rearm(); else device.keyChanged();
      key = candidate;
      emit();
      return true;
    },
    /** Koppla från: the key is forgotten, and what waits goes with it. */
    removeKey() {
      stop();
      key = null;
      device.keyChanged();
      emit();
    },
    setUnderstood(value: boolean) { understood = value; emit(); },
    /** Off counts at once, also for what waits in the queue. */
    setAllowFaults(value: boolean) {
      allowFaults = value;
      if (!value) device.clampQueue("warning");
      emit();
    },
    stop,
    clearQueue() { device.clearQueue(); },
    clearLog() { device.clearLog(); },
    logFileText: () => device.logFileText(),
    /** Everything else that runs on the page stops with it. */
    onStop(listener: () => void) { stopListeners.add(listener); return () => { stopListeners.delete(listener); }; },
    /** Alarms from the surface and the regulator, as events through the device, under the choices made: the key, the tick, the fault switch, the Simulerat mark. True when they left for the queue. */
    sendLocalEvents(inputs: readonly EventInput[]): boolean {
      if (demoSink) return inputs.length ? demoSink(inputs) : false;
      if (key === null || !understood || device.getState().halt.kind === "key_refused" || !inputs.length) return false;
      const made = factoryNow();
      const now = clock();
      device.enqueue(inputs.map((input) => made.make(input, now)));
      device.start();
      emit();
      return true;
    },
    /** The public demo's connection, without any key. Called only from the demo's own link, which only the demo's page draws. */
    setDemoSink(sink: ((inputs: readonly EventInput[]) => boolean) | null) { demoSink = sink; emit(); },
    device,
    factoryNow,
  };
}

export type Simulator = ReturnType<typeof createSimulator>;

/** One simulator per page; everything stops when the page goes. */
export function useSimulator() {
  const [simulator] = useState(createSimulator);
  useEffect(() => simulator.mount(), [simulator]);
  const snapshot = useSyncExternalStore(simulator.subscribe, simulator.getSnapshot, simulator.getSnapshot);
  return [simulator, snapshot] as const;
}
