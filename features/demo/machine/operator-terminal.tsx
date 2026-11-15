"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { DEMO_CONNECTION_ACCOUNT, DEMO_CONNECTION_MACHINE_ID, demoOperatorApi, enterDemoConnection } from "@/features/demo/demo-operator";
import { DEMO_COMPANY } from "@/lib/demo";
import { type OperatorApi, OperatorApiError, type OperatorPageData } from "@/features/operator/operator-api";
import { OperatorApp } from "@/features/operator/operator-app";
import { SIM_TEXT_PREFIX } from "@/lib/machine/simulator/limits";
import { type DemoFaultReport, type DemoMachineMessage, type FeedRow, openDemoChannel } from "./protocol";
import { type DemoMode, EMPTY_DESCRIPTION, type MachineDescription, OPERATOR_AI_NOTE, operatorAdvice, SIMULATION_MARK, type TaughtCause } from "./rules";

// Demokopplingen on the operator page: the real page, with no side menu and the same steps, whose fault reports go to the demo's Workflow
// window instead of a server. Only /operator/demo?demokoppling=1 draws this. What the operator writes is carried and shown and never read: the
// suggestion step is asked with the machine and the cause only, as OperatorApi already has it. On-call is a row in the demo's bell; no message leaves.

const NOT_OPEN = "Workflow-fönstret är inte öppet. Öppna demon först, så kommer anmälan fram där.";
const HINT = `Demo. Texten du skriver visas men tolkas inte. Jouren är simulerad och inget meddelande lämnar webbläsaren. ${SIMULATION_MARK} i Exempel 2.`;
const WAIT_MS = 3000;

function createConnection() {
  let channel: BroadcastChannel | null = null;
  let session: string | null = null;
  let bootedAt = 0;
  let mode: DemoMode = "traditional";
  let description: MachineDescription = EMPTY_DESCRIPTION;
  let taught: TaughtCause[] = [];
  let feed: FeedRow[] = [];
  const waiting = new Map<string, () => void>();
  const seed = new Uint32Array(2);
  // globalThis, not window: the page is drawn on the server too (kundresa 2026-11-07, M9: window there gave HTTP 500).
  globalThis.crypto.getRandomValues(seed);
  const client = `op-${seed[0].toString(36)}${seed[1].toString(36)}`;
  const listeners = new Set<() => void>();
  let version = 0;
  const emit = () => { version += 1; for (const listener of listeners) listener(); };

  const onMessage = (message: DemoMachineMessage) => {
    switch (message.type) {
      case "config":
        if (session && message.session !== session && message.bootedAt < bootedAt) return;
        session = message.session; bootedAt = message.bootedAt; mode = message.mode; description = message.description; taught = message.taught; feed = message.feed;
        emit();
        return;
      case "feed": if (message.session === session) { feed = [message.row, ...feed].slice(0, 10); emit(); } return;
      case "report-done": if (message.session === session && message.client === client) { waiting.get(message.id)?.(); waiting.delete(message.id); } return;
      case "bye": if (message.session === session) { session = null; emit(); } return;
      default:
    }
  };
  const alarms = () => feed.filter((row) => row.origin === "plc" && row.state !== "cleared").map((row) => row.text.replace(SIM_TEXT_PREFIX, ""));
  const api: OperatorApi = {
    ...demoOperatorApi,
    async load(poll) {
      const data = await demoOperatorApi.load(poll);
      return { ...data, ai: mode === "mapped" } satisfies OperatorPageData;
    },
    async send(draft) {
      if (!session) throw new OperatorApiError(409, NOT_OPEN);
      const data = await demoOperatorApi.load();
      const machine = data.machines.find((item) => item.id === draft.machineId);
      const sent = await demoOperatorApi.send(draft);
      const report: DemoFaultReport = { id: sent.id, machineId: draft.machineId, machineLabel: machine?.name ?? "Maskinen", cause: draft.cause, text: draft.text, severity: draft.severity, reporter: draft.reporterName, accountName: DEMO_CONNECTION_ACCOUNT, label: sent.workOrder, onCall: sent.onCall };
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, WAIT_MS);
        waiting.set(report.id, () => { window.clearTimeout(timer); resolve(); });
        channel?.postMessage({ type: "fault-report", client, to: session, report });
      });
      return sent;
    },
    async troubleshoot({ machineId, cause }) {
      if (machineId !== DEMO_CONNECTION_MACHINE_ID) return { suggestions: [{ text: "Den här maskinen är inte beskriven, så det finns inga förslag.", basis: "Bara Fläkt F1 har en beskrivning i demon." }], note: OPERATOR_AI_NOTE };
      return { suggestions: operatorAdvice({ description, taught, recentAlarms: alarms(), cause }), note: OPERATOR_AI_NOTE };
    },
  };
  return {
    api,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    version: () => version,
    aiOn: () => mode === "mapped",
    bound: () => session !== null,
    mount() {
      channel = openDemoChannel(onMessage);
      const hello = () => { if (!session) channel?.postMessage({ type: "hello", client, wf: null, role: "operator" }); };
      hello();
      const timer = window.setInterval(hello, 5000);
      return () => { window.clearInterval(timer); channel?.close(); channel = null; session = null; };
    },
  };
}

export function DemoConnectedOperator({ machine, niva }: { machine: string | null; niva: string | null }) {
  const [connection] = useState(createConnection);
  const [initial, setInitial] = useState<OperatorPageData | null>(null);
  useEffect(() => connection.mount(), [connection]);
  useSyncExternalStore(connection.subscribe, connection.version, () => 0);
  const aiOn = connection.aiOn(), bound = connection.bound();
  useEffect(() => {
    enterDemoConnection();
    let live = true;
    void connection.api.load().then((data) => { if (live) setInitial(data); });
    return () => { live = false; };
  }, [connection, aiOn]);
  const hint = useMemo(() => bound ? HINT : `${NOT_OPEN} ${HINT}`, [bound]);
  if (!initial || initial.ai !== aiOn) return <div className="min-h-dvh bg-background" data-testid="operator-page" />;
  return <OperatorApp key={aiOn ? "ai" : "plain"} pageKey="demo" company={DEMO_COMPANY} initial={initial} microsoft={false} error="" machine={machine} niva={niva} api={connection.api} demoHint={hint} />;
}
