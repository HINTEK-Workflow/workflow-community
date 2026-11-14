"use client";

import { useEffect, useSyncExternalStore } from "react";
import { ExternalLink, FlaskConical, Hand, Play, RotateCcw, ShieldAlert } from "lucide-react";
import { useActions } from "@/features/plc-simulator/desktop/actions";
import { useDesktop, useRuntimeSnapshot } from "@/features/plc-simulator/desktop/context";
import { ChromeButton } from "@/features/plc-simulator/desktop/controls";
import { DEMO_MACHINE_HREF } from "@/lib/demo";
import { DEMO_MACHINE } from "./example";
import { createMachineLink, type LinkSnapshot, type MachineLink } from "./link";
import { type LogRow, logRowText } from "./protocol";
import { describedEnough, type DemoMode, HUMAN_DECIDES_TEXT, NO_DESCRIPTION_TEXT, ORIGIN_LABELS, SIMULATION_MARK, SIMULATION_TEXT } from "./rules";

// Demokopplingen in the simulator's own look: the link that runs as long as the window does, and the panel that stands where Maskinkoppling
// stands on a real page. Only the public demo's simulator page loads this file (features/plc-simulator: `demo` prop).

const links = new Set<() => void>();
let current: MachineLink | null = null;
const publish = (link: MachineLink | null) => { current = link; for (const listener of links) listener(); };
const subscribeLink = (listener: () => void) => { links.add(listener); return () => { links.delete(listener); }; };
const useMachineLink = () => useSyncExternalStore(subscribeLink, () => current, () => null);
const emptySubscribe = () => () => undefined;
const EMPTY: LinkSnapshot = { bound: false, mode: "traditional", description: { text: "", rows: [] }, taught: [], log: [], feed: [], demoMachineLoaded: false, restarted: false };

export function DemoMachineLink({ example, wf }: { example: boolean; wf: string | null }) {
  const { simulator, runtime } = useDesktop();
  const actions = useActions();
  useEffect(() => {
    const link = createMachineLink(runtime, simulator, wf);
    const stop = link.mount();
    publish(link);
    if (example) link.loadDemoMachine();
    return () => { publish(null); stop(); };
  }, [runtime, simulator, wf, example]);
  // The visitor came for the connection: its panel is shown as soon as the dock stands.
  useEffect(() => {
    if (!example) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      try { actions.showPanel("connection"); window.clearInterval(timer); } catch { if (tries > 20) window.clearInterval(timer); }
    }, 250);
    return () => window.clearInterval(timer);
  }, [actions, example]);
  return null;
}

const clock = (at: number) => new Date(at).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const toneColor = (tone: LogRow["tone"]) => tone === "alarm" ? { color: "var(--plc-fault)" } : undefined;

function ModeButton({ link, mode, current: chosen, title }: { link: MachineLink; mode: DemoMode; current: DemoMode; title: string }) {
  return <ChromeButton tone={chosen === mode ? "primary" : undefined} aria-pressed={chosen === mode} onClick={() => link.setMode(mode)} data-testid={`demo-sim-mode-${mode}`}>{title}</ChromeButton>;
}

export function DemoConnectionPanel() {
  const link = useMachineLink();
  const snapshot = useSyncExternalStore(link?.subscribe ?? emptySubscribe, link?.getSnapshot ?? (() => EMPTY), () => EMPTY);
  const { engine } = useRuntimeSnapshot();
  const protection = Boolean(engine.devices[DEMO_MACHINE.protection]?.on);
  const described = describedEnough(snapshot.description);
  if (!link) return <div className="space-y-2 p-3" data-testid="plc-connection-demo"><p>Allt i simulatorn körs här i webbläsaren.</p></div>;
  return <div className="plc-scroll space-y-2 p-2" data-testid="plc-connection-demo">
    <p data-testid="demo-sim-state"><span className="font-semibold">Demokoppling.</span> {snapshot.bound ? "Ansluten utan nyckel, till demons Workflow-fönster." : "Väntar på demons Workflow-fönster."}</p>
    {!snapshot.bound ? <p className="plc-note" role="status" data-testid="demo-sim-no-workflow">{snapshot.restarted ? "Workflow-fönstret stängdes eller laddades om, så demon börjar om." : "Inget Workflow-fönster svarar."} <a href={DEMO_MACHINE_HREF} target="_blank" rel="noopener" className="underline"><ExternalLink aria-hidden="true" className="inline size-3" /> Öppna Prova maskinkopplingen</a></p> : null}
    {snapshot.bound && snapshot.restarted ? <p className="plc-note" role="status">Workflow-fönstret laddades om, så demon började om.</p> : null}
    <p className="plc-note" data-testid="demo-sim-mark"><FlaskConical aria-hidden="true" className="inline size-3" /> <span className="font-semibold">{SIMULATION_MARK}.</span> {SIMULATION_TEXT}</p>

    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Exempel">
      <ModeButton link={link} mode="traditional" current={snapshot.mode} title="Exempel 1: Traditionellt" />
      <ModeButton link={link} mode="mapped" current={snapshot.mode} title="Exempel 2: Med signalmappning" />
    </div>

    {snapshot.demoMachineLoaded ? <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Maskinen">
      <ChromeButton onClick={() => link.pressStart()} disabled={!engine.run} data-testid="demo-sim-press"><Hand aria-hidden="true" />Tryck Start</ChromeButton>
      <ChromeButton onClick={() => link.pressManyTimes(10)} disabled={!engine.run} data-testid="demo-sim-press-10"><Hand aria-hidden="true" />Tryck 10 gånger</ChromeButton>
      <ChromeButton onClick={() => link.toggleProtection()} disabled={!engine.run} aria-pressed={protection} data-testid="demo-sim-protection"><ShieldAlert aria-hidden="true" />{protection ? "Återställ motorskyddet" : "Lös ut motorskyddet"}</ChromeButton>
      <span className="plc-help" data-testid="demo-sim-fan">{engine.run ? (engine.outputs.do[0] ? "Fläkten går." : "Fläkten står.") : "PLC:n står i STOP."}</span>
    </div> : <div className="flex flex-wrap items-center gap-1">
      <ChromeButton tone="primary" onClick={() => link.loadDemoMachine()} data-testid="demo-sim-load"><Play aria-hidden="true" />Ladda demomaskinen</ChromeButton>
      <span className="plc-help">Knapp, fläkt och motorskydd. Sparas inte över din ritning.</span>
    </div>}
    {snapshot.demoMachineLoaded && !engine.run ? <ChromeButton onClick={() => link.loadDemoMachine()} data-testid="demo-sim-restart"><RotateCcw aria-hidden="true" />Starta om demomaskinen</ChromeButton> : null}

    <section className="border border-[var(--plc-line)]" data-testid="demo-sim-ai">
      <h3 className="border-b border-[var(--plc-line)] bg-[var(--plc-header)] px-2 py-0.5 font-semibold">Lokal AI (simulerad)</h3>
      {snapshot.mode === "traditional"
        ? <p className="px-2 py-1 plc-help">Inte med i Exempel 1. PLC:n skickar sin fasta text direkt till Workflow.</p>
        : <>
          {!described ? <p className="plc-note" role="status" data-testid="demo-sim-no-description">{NO_DESCRIPTION_TEXT} Beskriv maskinen i Workflow-fönstret.</p> : null}
          <ul className="max-h-48 overflow-auto" data-testid="demo-sim-log">
            {snapshot.log.length ? snapshot.log.map((row) => <li key={row.id} className="flex gap-2 border-b border-[var(--plc-grid)] px-2 py-0.5" style={toneColor(row.tone)}><span className="plc-help whitespace-nowrap">{clock(row.at)}</span><span className="[overflow-wrap:anywhere]">{logRowText(row)}</span></li>) : <li className="px-2 py-1 plc-help">Inget observerat än.</li>}
          </ul>
        </>}
    </section>

    <section className="border border-[var(--plc-line)]" data-testid="demo-sim-feed">
      <h3 className="border-b border-[var(--plc-line)] bg-[var(--plc-header)] px-2 py-0.5 font-semibold">Så kom det fram i Workflow</h3>
      <ul className="max-h-48 overflow-auto">
        {snapshot.feed.length ? snapshot.feed.map((row) => <li key={row.id} className="border-b border-[var(--plc-grid)] px-2 py-1 [overflow-wrap:anywhere]" data-testid="demo-sim-feed-row">
          <p className="font-semibold">{row.text}</p>
          <p className="plc-help">{row.outcome.kind === "created" ? `Arbetsorder skapad: ${row.outcome.title}` : row.outcome.text}</p>
          {row.diagnosis?.candidates.length ? <p className="plc-help">Kan bero på: {row.diagnosis.candidates.slice(0, 2).map((item) => `${item.text} (${ORIGIN_LABELS[item.origin]})`).join(" eller ")}. {HUMAN_DECIDES_TEXT}</p> : null}
        </li>) : <li className="px-2 py-1 plc-help">Inga larm än.</li>}
      </ul>
    </section>
  </div>;
}
