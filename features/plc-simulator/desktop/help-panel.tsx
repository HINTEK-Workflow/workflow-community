"use client";

import { useState, useSyncExternalStore } from "react";
import { CircleHelp, Play, Wand2, X } from "lucide-react";
import { ALARM_DEMO_PART, ALARM_PARTS, API_PARTS, GUIDE_EXAMPLE_ID, GUIDE_PROGRAM, GUIDE_STEPS, HELP_TOPICS, ingestExample, REFERENCE_PARTS, type GuideShow, type HelpPart, type HelpTopicId } from "@/lib/machine/simulator/help";
import { MACHINES_HREF } from "@/lib/machine/simulator/limits";
import { useActions } from "./actions";
import { useDesktop, useDeskState, useRuntimeSnapshot } from "./context";
import { ChromeButton } from "./controls";
import { readHelpSeen, saveHelpSeen } from "./layout-store";

// PLC-simulatorn, Hjälp (2026-11-05): a panel, not a dialog, so the guide stands beside the drawing while the person follows it. The
// texts are data in lib/machine/simulator/help.ts. "Visa mig" opens the right panel and marks what the step is about on the palette and the PLC.

/** Something would be lost: an empty rung is what every new drawing starts with, and it holds nothing. */
const hasProgram = (program: string, filledRungs: number) => filledRungs > 0 || program.includes(":=");

function Part({ part, children }: { part: HelpPart; children?: React.ReactNode }) {
  return <section className="plc-help-part" data-testid="plc-help-part" data-part={part.id}>
    <h3 className="font-semibold">{part.title}</h3>
    {part.flow ? <ol className="plc-help-flow" data-testid="plc-help-flow" aria-label="Kedjan steg för steg">{part.flow.map((step, index) => <li key={step}>{index ? <span aria-hidden="true">→</span> : null}<span className="plc-help-flow-box">{step}</span></li>)}</ol> : null}
    {part.lines?.map((line) => <p key={line}>{line}</p>)}
    {part.steps ? <ol className="plc-help-steps">{part.steps.map((line) => <li key={line}>{line}</li>)}</ol> : null}
    {part.list ? <ul className="plc-help-list">{part.list.map((line) => <li key={line}>{line}</li>)}</ul> : null}
    {part.rows ? <table className="plc-table"><tbody>{part.rows.map(([name, what]) => <tr key={name}><td className="whitespace-nowrap align-top font-semibold">{name}</td><td className="[overflow-wrap:anywhere]">{what}</td></tr>)}</tbody></table> : null}
    {part.code ? <pre className="plc-help-code">{part.code}</pre> : null}
    {children}
  </section>;
}

function Guide() {
  const { runtime, desk, confirm } = useDesktop();
  const actions = useActions();
  const { layout, engine } = useRuntimeSnapshot();
  const { guideStep } = useDeskState();
  const mark = (step: string, kinds: readonly string[], terminals: readonly string[]) => desk.set({ guideStep: step, guideKinds: kinds, guideTerminals: terminals });
  const shows: Record<GuideShow, (step: string) => void | Promise<void>> = {
    supply(step) { mark(step, ["kalla24"], ["24V", "0V"]); actions.showPanel("palette"); },
    devices(step) { mark(step, ["knapp", "lampa"], []); actions.showPanel("palette"); },
    wires(step) { mark(step, [], ["DI0", "DO0"]); actions.showPanel("surface"); },
    check(step) { mark(step, [], []); actions.showPanel("check"); },
    async program(step) {
      mark(step, [], []);
      if (hasProgram(layout.program, layout.ladder?.rungs.filter((rung) => rung.items.length || rung.outputs.length).length ?? 0) && layout.program !== GUIDE_PROGRAM) {
        const yes = await confirm({ title: "Byta programmet?", message: "Programmet som står nu ersätts av guidens program.", confirmLabel: "Byt program", tone: "danger" });
        if (!yes) return;
      }
      runtime.setProgram(GUIDE_PROGRAM);
      actions.showPanel("program");
      actions.compile();
    },
    run(step) { mark(step, [], []); actions.showPanel("surface"); runtime.setRun(true); },
    tags(step) { mark(step, [], []); actions.showPanel("tags"); },
    connection(step) { mark(step, [], []); actions.showPanel("connection"); },
  };
  return <div className="space-y-2" data-testid="plc-help-guide">
    <p>Här tänder du en lampa med en tryckknapp, steg för steg. Simulatorn är ett övningsverktyg, så inget du gör här kan skada något.</p>
    <ol className="space-y-2">
      {GUIDE_STEPS.map((step, index) => <li key={step.id} className="plc-help-step" data-testid="plc-help-step" data-step={step.id} data-current={guideStep === step.id}>
        <span className="plc-help-number" aria-hidden="true">{index + 1}</span>
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="font-semibold">{step.title}</h3>
          {step.lines.map((line) => <p key={line}>{line}</p>)}
          {step.list ? <ul className="plc-help-list">{step.list.map((line) => <li key={line}>{line}</li>)}</ul> : null}
          {step.code ? <pre className="plc-help-code" data-testid="plc-help-program">{step.code}</pre> : null}
          {step.show ? <ChromeButton disabled={step.show.action === "run" && engine.run} onClick={() => void shows[step.show!.action](step.id)} data-testid={`plc-help-show-${step.show.action}`}>
            {step.show.action === "run" ? <Play aria-hidden="true" /> : null}{step.show.action === "run" && engine.run ? "PLC:n kör" : step.show.label}
          </ChromeButton> : null}
        </div>
      </li>)}
    </ol>
    <div className="plc-note space-y-1">
      <p>Vill du se det färdigt? Exemplet ersätter ritningen. Ångra tar tillbaka den.</p>
      <ChromeButton onClick={() => actions.openExample(GUIDE_EXAMPLE_ID)} data-testid="plc-help-example"><Wand2 aria-hidden="true" />Öppna det färdiga exemplet</ChromeButton>
    </div>
  </div>;
}

function Parts({ parts, extra }: { parts: readonly HelpPart[]; extra?: Partial<Record<string, React.ReactNode>> }) {
  return <>{parts.map((part) => <Part key={part.id} part={part}>{extra?.[part.id]}</Part>)}</>;
}

function Alarms() {
  const { demo } = useDesktop();
  const actions = useActions();
  return <div className="space-y-3" data-testid="plc-help-alarms">
    {demo ? <Part part={ALARM_DEMO_PART} /> : null}
    <Parts parts={ALARM_PARTS} />
    <div className="flex flex-wrap gap-1">
      <ChromeButton onClick={() => actions.showPanel("connection")} data-testid="plc-help-alarm-connection">Visa Maskinkoppling</ChromeButton>
      <ChromeButton onClick={() => actions.showPanel("log")}>Visa Logg</ChromeButton>
      {demo ? null : <a className="plc-button" href={MACHINES_HREF} target="_blank" rel="noopener">Öppna Maskiner</a>}
    </div>
  </div>;
}

function Api() {
  const { demo } = useDesktop();
  const example = ingestExample(typeof window === "undefined" ? "https://din-adress" : window.location.origin);
  return <div className="space-y-3" data-testid="plc-help-api">
    {demo ? <p className="plc-note" role="status">I demon finns ingen nyckel och inget skickas. Så här fungerar det i ett riktigt företag.</p> : null}
    <Parts parts={API_PARTS} extra={{
      exempel: <pre className="plc-help-code" data-testid="plc-help-api-example">{example}</pre>,
      steg: demo ? null : <a className="plc-button mt-1" href={MACHINES_HREF} target="_blank" rel="noopener" data-testid="plc-help-machines">Skapa nyckeln under Maskiner</a>,
    }} />
  </div>;
}

export function HelpPanel() {
  const { desk } = useDesktop();
  const { helpTopic } = useDeskState();
  return <div className="flex h-full min-h-0 flex-col" data-testid="plc-help">
    <div className="plc-help-tabs" role="tablist" aria-label="Hjälp">
      {HELP_TOPICS.map((topic) => <button key={topic.id} type="button" role="tab" aria-selected={helpTopic === topic.id} className="plc-help-tab" data-testid="plc-help-tab" data-topic={topic.id} onClick={() => desk.set({ helpTopic: topic.id })}>{topic.label}</button>)}
    </div>
    <div className="plc-scroll p-2" role="tabpanel" data-testid="plc-help-body" data-topic={helpTopic}>
      {helpTopic === "start" ? <Guide /> : helpTopic === "alarms" ? <Alarms /> : helpTopic === "api" ? <Api /> : <div className="space-y-3" data-testid="plc-help-reference"><Parts parts={REFERENCE_PARTS} /></div>}
    </div>
  </div>;
}

const noSubscribe = () => () => {};

/** The first time on this device: one line that opens the guide. It never comes back once closed or used. */
export function HelpHint({ onOpen }: { onOpen: (topic: HelpTopicId) => void }) {
  const seen = useSyncExternalStore(noSubscribe, readHelpSeen, () => true);
  const [closed, setClosed] = useState(false);
  if (seen || closed) return null;
  const done = () => { saveHelpSeen(); setClosed(true); };
  return <div className="plc-note flex flex-none flex-wrap items-center gap-2" role="status" data-testid="plc-help-hint">
    <CircleHelp aria-hidden="true" className="size-3.5 flex-none" />
    <span className="min-w-0">Första gången här? Guiden visar steg för steg hur du tänder en lampa.</span>
    <ChromeButton tone="primary" onClick={() => { done(); onOpen("start"); }} data-testid="plc-help-hint-open">Öppna guiden</ChromeButton>
    <button type="button" className="plc-tab-close ml-auto" aria-label="Stäng" onClick={done} data-testid="plc-help-hint-close"><X aria-hidden="true" /></button>
  </div>;
}
