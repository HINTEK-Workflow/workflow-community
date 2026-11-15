"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { BrainCircuit, CheckCircle2, ChevronRight, ClipboardList, Cpu, ExternalLink, FlaskConical, ListChecks, NotebookPen, Plus, RotateCcw, ScrollText, Sparkles, Workflow as WorkflowIcon } from "lucide-react";
import { Segmented } from "@/components/list-filter-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RemoveButton } from "@/components/ui/remove-button";
import { Field, Panel } from "@/features/kfid/ui";
import { demoSimulatorHref } from "@/lib/demo";
import { PHONE_SIMULATOR_TEXT, usePhoneScreen } from "./use-phone-screen";
import { ALARM_SAFETY_TEXT } from "@/lib/machine/alarm-escalation";
import { MACHINES_HREF, SIM_TEXT_PREFIX } from "@/lib/machine/simulator/limits";
import { cn } from "@/lib/utils";
import { clearDemoMachineDescription, demoMachineSnapshot, editTaught, fillReadyDescription, finishMachineOrder, removeTaught, setDemoMachineDescription, setDemoMachineMode, skipMachineRest, subscribeDemoMachine, teachFromAlarm } from "./hub";
import { DEMO_MACHINE_SOURCE_NAME, type FeedRow, logRowText } from "./protocol";
import { BEHAVIOUR_LABELS, type Behaviour, type Candidate, describedEnough, type DemoMode, HUMAN_DECIDES_TEXT, NO_DESCRIPTION_TEXT, ORIGIN_LABELS, SIGNAL_CHOICES, type SignalRow, SIMULATION_MARK, SIMULATION_TEXT } from "./rules";

// Prova maskinkopplingen: a part of the Demo page. The two ways an alarm can arise, side by
// side in one flow: the PLC's fixed text, or a text built from what someone has told the system about the machine. All the state is the
// hub's, in this page's memory.

const clock = (at: number) => new Date(at).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const withoutMark = (text: string) => text.startsWith(SIM_TEXT_PREFIX) ? text.slice(SIM_TEXT_PREFIX.length) : text;
const ORIGIN_VARIANT: Record<Candidate["origin"], "default" | "secondary" | "outline"> = { taught: "default", described: "secondary", generic: "outline" };

function FlowBox({ icon: Icon, title, line, dashed = false, testId }: { icon: typeof Cpu; title: string; line: string; dashed?: boolean; testId?: string }) {
  return <div className={cn("min-w-0 flex-1 rounded-lg border bg-card p-3", dashed && "border-dashed border-primary/50")} data-testid={testId}>
    <p className="flex items-center gap-2 text-sm font-semibold"><Icon aria-hidden="true" className="size-4 shrink-0 text-primary" />{title}</p>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">{line}</p>
  </div>;
}

function Flow({ mode, simulatorOpen }: { mode: DemoMode; simulatorOpen: boolean }) {
  const arrow = <ChevronRight aria-hidden="true" className="mx-auto size-4 shrink-0 rotate-90 self-center text-muted-foreground @2xl/flow:rotate-0" />;
  return <div className="@container/flow">
    <div className="flex flex-col gap-2 @2xl/flow:flex-row" data-testid="demo-machine-flow">
      <FlowBox icon={Cpu} title="PLC" line={simulatorOpen ? "Simulatorn är öppen och kopplad." : "Simulatorn är inte öppen än."} testId="demo-machine-plc" />
      {arrow}
      {mode === "mapped" ? <><FlowBox icon={BrainCircuit} dashed title="Lokal AI (simulerad)" line="Står bredvid PLC:n. Hämtar beskrivningen, bevakar signalerna och skriver larmtexten." testId="demo-machine-local-ai" />{arrow}</> : null}
      <FlowBox icon={WorkflowIcon} title="Workflow" line={mode === "mapped" ? "Tar emot färdig text. Här görs mappningen." : "Tar emot PLC:ns fasta text."} />
    </div>
  </div>;
}

function RowEditor({ row, onChange, onRemove, index }: { row: SignalRow; onChange: (row: SignalRow) => void; onRemove: () => void; index: number }) {
  const patch = (change: Partial<SignalRow>) => onChange({ ...row, ...change });
  const number = (value: string, fallback: number) => { const n = Math.round(Number(value.replace(",", "."))); return Number.isFinite(n) && n > 0 ? Math.min(n, 100_000) : fallback; };
  return <li className="rounded-lg border p-3" data-testid="demo-machine-row">
    <div className="grid grid-cols-2 gap-3 @2xl/rows:grid-cols-[6rem_minmax(0,1fr)_minmax(0,1fr)_auto]">
      <Field id={`demo-signal-${row.id}`} label="Signal" value={row.signal} onChange={(value) => patch({ signal: value })} options={SIGNAL_CHOICES} />
      <Field id={`demo-function-${row.id}`} label="Funktion" value={row.function} onChange={(value) => patch({ function: value })} placeholder="Till exempel Fläkten" />
      <Field id={`demo-behaviour-${row.id}`} label="Normalt" value={row.behaviour} onChange={(value) => patch({ behaviour: value as Behaviour })} options={Object.keys(BEHAVIOUR_LABELS)} optionLabels={BEHAVIOUR_LABELS} />
      <div className="flex items-end justify-end"><RemoveButton label={`Ta bort rad ${index + 1}`} onClick={onRemove} /></div>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-3 @2xl/rows:grid-cols-[6rem_6rem_minmax(0,1fr)]">
      {row.behaviour === "brief" ? <>
        <Field id={`demo-max-${row.id}`} label="Högst antal" type="number" value={String(row.maxCount)} onChange={(value) => patch({ maxCount: number(value, row.maxCount) })} />
        <Field id={`demo-window-${row.id}`} label="På minuter" type="number" value={String(row.windowMin)} onChange={(value) => patch({ windowMin: number(value, row.windowMin) })} />
      </> : null}
      {row.behaviour === "timed" ? <div className="col-span-2 @2xl/rows:col-span-2"><Field id={`demo-expected-${row.id}`} label="Förväntad tid (s)" type="number" value={String(row.expectedS)} onChange={(value) => patch({ expectedS: number(value, row.expectedS) })} /></div> : null}
      {row.behaviour !== "info" ? <div className="col-span-2 @2xl/rows:col-span-1"><Field id={`demo-causes-${row.id}`} label="Möjliga orsaker, en per rad" multiline value={row.causes} onChange={(value) => patch({ causes: value })} /></div> : null}
    </div>
  </li>;
}

function Description() {
  const { description } = useSyncExternalStore(subscribeDemoMachine, demoMachineSnapshot, demoMachineSnapshot);
  const enough = describedEnough(description);
  const setRows = (rows: SignalRow[]) => setDemoMachineDescription({ ...description, rows });
  const nextId = () => `row-${description.rows.length + 1}-${Date.now().toString(36)}`;
  return <Panel icon={NotebookPen} title="Beskriv maskinen" description="Görs i Workflow, där maskiner och signaler redan finns." actions={<div className="flex flex-wrap gap-2">
    <Button type="button" size="sm" onClick={fillReadyDescription} data-testid="demo-machine-fill"><Sparkles />Fyll i exemplet</Button>
    {description.text || description.rows.length ? <Button type="button" size="sm" variant="outline" onClick={clearDemoMachineDescription} data-testid="demo-machine-clear"><RotateCcw />Töm</Button> : null}
  </div>}>
    <div className="space-y-4">
      {!enough ? <p className="notice" role="status" data-testid="demo-machine-no-description">{NO_DESCRIPTION_TEXT}</p> : null}
      <Field id="demo-machine-text" label="Vad gör maskinen?" multiline value={description.text} onChange={(value) => setDemoMachineDescription({ ...description, text: value })} placeholder="Startknappen startar en fläkt som går i en minut." help="Texten visas men tolkas inte. Simuleringen läser bara fälten i tabellen." />
      <div className="@container/rows">
        <ul className="space-y-3" data-testid="demo-machine-rows">
          {description.rows.map((row, index) => <RowEditor key={row.id} row={row} index={index} onChange={(next) => setRows(description.rows.map((item) => item.id === row.id ? next : item))} onRemove={() => setRows(description.rows.filter((item) => item.id !== row.id))} />)}
        </ul>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" size="sm" variant="outline" onClick={() => setRows([...description.rows, { id: nextId(), signal: "DI0", function: "", behaviour: "brief", maxCount: 5, windowMin: 2, expectedS: 60, causes: "" }])} data-testid="demo-machine-add"><Plus />Lägg till signal</Button>
        <p className="text-xs text-muted-foreground">Värdena är dina. Exemplets värden är påhittade.</p>
      </div>
    </div>
  </Panel>;
}

/** The suggestions, each with its origin and the way to say it was this. */
function Candidates({ row }: { row: FeedRow }) {
  if (!row.diagnosis) return null;
  return <div><p className="text-sm font-medium">Kan bero på</p>
    <ol className="mt-1 space-y-1" data-testid="demo-machine-candidates">
      {row.diagnosis.candidates.map((candidate, index) => <li key={candidate.text} className="flex gap-2 text-sm" data-testid="demo-machine-candidate" data-origin={candidate.origin}>
        <span className="leading-7 text-muted-foreground">{index + 1}.</span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="[overflow-wrap:anywhere]">{candidate.text}</span><Badge variant={ORIGIN_VARIANT[candidate.origin]}>{ORIGIN_LABELS[candidate.origin]}</Badge>
          {row.taught ? null : <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => teachFromAlarm(row.id, candidate.text)} data-testid="demo-machine-teach-pick">Det var detta</Button>}
        </div>
      </li>)}
    </ol>
  </div>;
}

function Teach({ row }: { row: FeedRow }) {
  const [text, setText] = useState("");
  if (!row.diagnosis) return null;
  if (row.taught) return <p className="flex items-center gap-1.5 text-sm" data-testid="demo-machine-taught-note"><CheckCircle2 aria-hidden="true" className="size-4 text-primary" />Felet var: {row.taught}</p>;
  return <div className="space-y-2" data-testid="demo-machine-teach">
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-48 flex-1"><Field id={`demo-teach-${row.id}`} label="Var det något annat? Skriv själv" value={text} onChange={setText} placeholder="Till exempel glapp i givaren" /></div>
      <Button type="button" size="sm" disabled={!text.trim()} onClick={() => teachFromAlarm(row.id, text)} data-testid="demo-machine-teach-save">Lär systemet</Button>
    </div>
  </div>;
}

function AlarmRow({ row }: { row: FeedRow }) {
  const outcome = row.outcome;
  const taskId = outcome.kind === "created" || outcome.kind === "skipped" ? outcome.taskId : null;
  const hasOpenOrder = outcome.kind === "skipped" && outcome.reason === "open_order";
  return <li className="space-y-3 rounded-lg border p-3" data-testid="demo-machine-alarm" data-mode={row.mode} data-outcome={outcome.kind}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0 flex-1 basis-60">
        <p className="text-sm font-semibold [overflow-wrap:anywhere]" data-testid="demo-machine-alarm-text">{row.text}</p>
        <p className="text-xs text-muted-foreground">{clock(row.at)} · {row.code} · {row.origin === "operator" ? "Från operatörssidan" : row.mode === "traditional" ? "Fast text från PLC:n" : "Text från den simulerade lokala AI:n"}</p>
      </div>
      {outcome.kind === "created" ? <Badge data-testid="demo-machine-order-badge"><ClipboardList aria-hidden="true" />Arbetsorder</Badge> : null}
    </div>
    <p className="text-sm" data-testid="demo-machine-outcome">{outcome.kind === "created" ? (row.origin === "operator" ? "En märkt arbetsorder skapades av Felanmälan." : "En märkt arbetsorder skapades av Maskinlarm.") : outcome.text}</p>
    {row.note ? <p className="text-sm [overflow-wrap:anywhere]" data-testid="demo-machine-note">{row.note}</p> : null}
    {row.diagnosis ? <div className="space-y-2">
      <div className="text-xs leading-5 text-muted-foreground" data-testid="demo-machine-basis">
        <p><span className="font-medium text-foreground">Observerat:</span> {row.diagnosis.observed.join(" ")}</p>
        <p><span className="font-medium text-foreground">Mappning:</span> {row.diagnosis.mapping.join("; ")}</p>
      </div>
      <Candidates row={row} />
      <Teach row={row} />
    </div> : null}
    <div className="flex flex-wrap gap-2">
      {taskId ? <Button asChild size="sm" variant="outline"><Link href={`/?view=workflow_task&taskId=${encodeURIComponent(taskId)}&taskType=WORK_ORDER`} data-testid="demo-machine-open-order"><ClipboardList />Öppna arbetsordern</Link></Button> : null}
      {outcome.kind === "created" || hasOpenOrder ? <Button type="button" size="sm" variant="ghost" onClick={() => { if (taskId) finishMachineOrder(taskId); }} data-testid="demo-machine-finish"><CheckCircle2 />Färdigställ ordern</Button> : null}
      {outcome.kind === "skipped" && outcome.reason === "cooldown" ? <Button type="button" size="sm" variant="ghost" onClick={skipMachineRest} data-testid="demo-machine-skip-rest">Hoppa över vilan</Button> : null}
    </div>
  </li>;
}

function TaughtLine({ id, cause, label, times, at }: { id: string; cause: string; label: string; times: number; at: number }) {
  return <li className="flex flex-wrap items-end gap-2 rounded-lg border p-3" data-testid="demo-machine-learned">
    <div className="min-w-48 flex-1"><Field id={`demo-learned-${id}`} label={label} value={cause} onChange={(value) => editTaught(id, value)} /></div>
    <p className="pb-2 text-xs text-muted-foreground">{times} {times === 1 ? "gång" : "gånger"}, senast {clock(at)}</p>
    <div className="pb-0.5"><RemoveButton label={`Ta bort ${cause}`} onClick={() => removeTaught(id)} /></div>
  </li>;
}

/** `canOpenEvents`: only the company admin may open Kopplingar → Maskiner; for anyone else the button is shown grey with the reason (2026-11-06: no link on the Demo page may end on a page that says the person lacks access). */
export function DemoMachinePage({ canOpenEvents = true }: { canOpenEvents?: boolean }) {
  const state = useSyncExternalStore(subscribeDemoMachine, demoMachineSnapshot, demoMachineSnapshot);
  const { mode, feed, log, taught, history, findings, simulatorOpen, session, description, cooldownMinutes } = state;
  const shown = feed.filter((row) => row.state !== "cleared");
  const href = demoSimulatorHref(session);
  const phone = usePhoneScreen();
  const open = (event: React.MouseEvent) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    window.open(href, "_blank", "noopener,popup,width=1360,height=900");
  };
  return <section id="maskin" aria-labelledby="demo-machine-title" className="scroll-mt-20 space-y-6" data-testid="demo-machine-page">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1 basis-64">
        <h2 id="demo-machine-title" className="text-lg font-semibold">Prova maskinkopplingen</h2>
        <p className="mt-1 text-sm text-muted-foreground">En PLC som är kopplad till Workflow utan nyckel. Prova två sätt som ett larm kan uppstå på.</p>
      </div>
      {phone ? <p className="notice basis-full text-sm" role="note" data-testid="demo-machine-phone-note">{PHONE_SIMULATOR_TEXT}</p>
        : <Button asChild><a href={href} target="_blank" rel="noopener" onClick={open} data-testid="demo-machine-open-simulator"><ExternalLink aria-hidden="true" />Öppna simulatorn</a></Button>}
    </div>
    <p className="notice" role="note" data-testid="demo-machine-mark"><FlaskConical aria-hidden="true" className="mr-1 inline size-4" /><strong>{SIMULATION_MARK}.</strong> {SIMULATION_TEXT} {HUMAN_DECIDES_TEXT} {ALARM_SAFETY_TEXT}</p>
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-sm font-medium">Exempel</span>
      <Segmented<DemoMode> label="Exempel" value={mode} onChange={setDemoMachineMode} options={[{ value: "traditional", label: "1 Traditionellt" }, { value: "mapped", label: "2 Med signalmappning" }]} testId="demo-machine-mode" />
      <Badge variant={simulatorOpen ? "default" : "outline"} data-testid="demo-machine-connection">{DEMO_MACHINE_SOURCE_NAME}: {simulatorOpen ? "ansluten" : "väntar på simulatorn"}</Badge>
    </div>
    <Flow mode={mode} simulatorOpen={simulatorOpen} />
    {mode === "traditional"
      ? <Panel icon={ListChecks} title="Så här gör du" description="Fasta larm, definierade i PLC:n.">
        <ol className="list-decimal space-y-1 pl-5 text-sm leading-6" data-testid="demo-machine-how-1">
          <li>Öppna simulatorn. Maskinen är laddad och står i RUN.</li>
          <li>Lös ut motorskyddet under Maskinkoppling, eller vippa Motorskydd på ritytan.</li>
          <li>Larmet kommer hit. Arbetsordern får PLC:ns fasta text, som inte ändras efter vad som har hänt.</li>
        </ol>
      </Panel>
      : <>
        <Description />
        <Panel icon={ListChecks} title="Så här gör du" description="Larmtexten byggs av fälten och av det som händer.">
          <ol className="list-decimal space-y-1 pl-5 text-sm leading-6" data-testid="demo-machine-how-2">
            <li>Tryck på Start en gång i simulatorn. Då noteras bara att allt är normalt.</li>
            <li>Tryck 10 gånger. Då säger meddelandet vad det kan bero på.</li>
            <li>Starta fläkten och lös ut motorskyddet innan minuten har gått. Ändra Förväntad tid eller Funktion, så ändras texten också.</li>
            <li>Säg vad felet var. Nästa gång står den orsaken först.</li>
          </ol>
        </Panel>
        <Panel icon={ScrollText} title="Lokal AI (simulerad)" description="Vad den observerar, direkt från simulatorn.">
          <ul className="max-h-64 space-y-1 overflow-auto text-sm" data-testid="demo-machine-log">
            {log.length ? log.map((row) => <li key={row.id} className="flex gap-2"><span className="shrink-0 text-xs leading-5 text-muted-foreground">{clock(row.at)}</span><span className={cn("[overflow-wrap:anywhere]", row.tone === "alarm" && "font-medium text-destructive")}>{logRowText(row)}</span></li>)
              : <li className="text-muted-foreground">{simulatorOpen ? "Inget har hänt än. Tryck på knappen i simulatorn." : "Öppna simulatorn, så börjar bevakningen."}</li>}
          </ul>
        </Panel>
      </>}
    <Panel icon={ClipboardList} title="Larm i Workflow" description={`Från källan ${DEMO_MACHINE_SOURCE_NAME}. Samma regler som i produkten: en öppen order per källa, ${cooldownMinutes} min vila och bara fel och kritiska larm.`} actions={canOpenEvents ? <Button asChild size="sm" variant="outline"><Link href={MACHINES_HREF} data-testid="demo-machine-events"><ScrollText />Händelser</Link></Button>
      : <Button type="button" size="sm" variant="outline" disabledReason="Bara företagsadministratören ser maskinernas händelser. Byt till Elin under Visa som." data-testid="demo-machine-events"><ScrollText />Händelser</Button>}>
      {shown.length ? <ul className="space-y-3" data-testid="demo-machine-feed">{shown.map((row) => <AlarmRow key={row.id} row={row} />)}</ul>
        : <p className="text-sm text-muted-foreground" data-testid="demo-machine-feed-empty">Inga larm än.</p>}
      {findings.length ? <div className="mt-4 rounded-lg border p-3" data-testid="demo-machine-findings">
        <p className="text-sm font-medium">Regelanalysen i produkten säger</p>
        {findings.map((finding) => <p key={finding.dedupeKey} className="text-sm">{withoutMark(finding.title)}: {finding.basis}</p>)}
      </div> : null}
    </Panel>
    {mode === "mapped" ? <Panel icon={BrainCircuit} title="Vad systemet har lärt sig" description={`${describedEnough(description) ? `Beskrivning och ${description.rows.filter((row) => row.function.trim()).length} signaler` : "Ingen beskrivning"}, ${taught.length} ${taught.length === 1 ? "lärd orsak" : "lärda orsaker"}. Finns bara i den här sidans minne.`}>
      <div className="space-y-4">
        {taught.length ? <ul className="space-y-3" data-testid="demo-machine-learned-list">{taught.map((item) => <TaughtLine key={item.id} id={item.id} cause={item.cause} label={item.patternLabel} times={item.times} at={item.lastAt} />)}</ul>
          : <p className="text-sm text-muted-foreground" data-testid="demo-machine-learned-empty">Inget än. Säg vad felet var på ett larm ovan.</p>}
        {history.length ? <div><p className="text-sm font-medium">Så har det vuxit</p>
          <ol className="mt-1 space-y-1 text-sm" data-testid="demo-machine-history">{history.map((item) => <li key={item.id} className="flex gap-2"><span className="shrink-0 text-xs leading-5 text-muted-foreground">{clock(item.at)}</span><span className="[overflow-wrap:anywhere]">{item.text}</span></li>)}</ol>
        </div> : null}
      </div>
    </Panel> : null}
  </section>;
}
