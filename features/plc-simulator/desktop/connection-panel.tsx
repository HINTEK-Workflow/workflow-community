"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Plug, RefreshCw, Unplug, Wand2 } from "lucide-react";
import { SecretField } from "@/features/kfid/secret-field";
import { ALARM_MODE_LABELS, ALARM_MODES, type AlarmMode } from "@/lib/machine/alarm-rules";
import { EVENTS_PATH, type LogEntry } from "@/lib/machine/simulator/device";
import { eventsBody } from "@/lib/machine/simulator/events";
import { DEFAULT_COOLDOWN, generateConnection, type GenerateResult, type GenerateStep, type SourceRow, STEP_TEXT } from "@/lib/machine/simulator/generate-connection";
import { MACHINES_HREF } from "@/lib/machine/simulator/limits";
import { maskText } from "@/lib/machine/simulator/mask";
import { NOT_A_KEY_TEXT } from "@/lib/machine/simulator/words";
import { createSource, listSources, ROUTE, rotateSource, setSourceMode } from "./connection-api";
import { useDesktop, useDeskState, useSimSnapshot } from "./context";
import { ChromeButton } from "./controls";
import { clockText } from "./log-panel";
import { connectionWord } from "./status-bar";

// PLC-simulatorn, Maskinkoppling (2026-11-04): the one place for the connection to Workflow, to try the API as if the simulator were a
// system of its own. The source's mode (stored on the server: what an alarm may become there) and the simulator's own permission for fault
// and critical alarms are two different things and stand apart. The guards are as before: the key only in this window's memory, every text
// marked Simulerat, fault and critical as warning until allowed, everything stops when the window closes.

const TEST_TEXT = "anslutningstest";

// Only the public demo's page ever loads this, in a chunk of its own.
const DemoConnectionPanel = dynamic(() => import("@/features/demo/machine/simulator-panel").then((module) => module.DemoConnectionPanel), { ssr: false });

export function ConnectionPanel() {
  const { demo } = useDesktop();
  if (demo) return <DemoConnectionPanel />;
  return <LiveConnectionPanel />;
}

function LiveConnectionPanel() {
  const { simulator, confirm, upkeepOn, desk } = useDesktop();
  const snapshot = useSimSnapshot();
  const { connectionSource: chosen } = useDeskState();
  const [draft, setDraft] = useState("");
  const [sources, setSources] = useState<SourceRow[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [step, setStep] = useState<GenerateStep | null>(null);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [testAnswer, setTestAnswer] = useState<{ tone: LogEntry["tone"]; text: string } | null>(null);
  const [modeError, setModeError] = useState<string | null>(null);
  const busy = step !== null;

  /** A step's error for the log, as the server said it. */
  const noteFailure = useCallback((what: string, error: string) => simulator.device.note({ path: ROUTE, status: null, summary: `${what}: ${error}`, tone: "danger" }), [simulator]);
  const refresh = useCallback(async () => {
    try { setSources(await listSources()); setListError(null); }
    catch (error) { setListError(maskText(error instanceof Error ? error.message : String(error))); }
  }, []);
  useEffect(() => { let live = true; void listSources().then((rows) => { if (live) { setSources(rows); setListError(null); } }, (error: unknown) => { if (live) setListError(maskText(error instanceof Error ? error.message : String(error))); }); return () => { live = false; }; }, []);

  const onKey = (value: string) => setDraft(simulator.pasteKey(value) ? "" : value);
  const keyProblem = draft.length >= 8 ? NOT_A_KEY_TEXT : null;
  const askFaults = async (value: boolean) => {
    if (!value) { simulator.setAllowFaults(false); return; }
    const yes = await confirm({ title: "Tillåta fel och kritiska larm?", message: "Då kan simulatorn skapa riktiga arbetsordrar och notiser, beroende på källans läge. Valet gäller tills du laddar om sidan.", confirmLabel: "Tillåt", tone: "danger" });
    if (yes) simulator.setAllowFaults(true);
  };
  const testBody = () => eventsBody([simulator.factoryNow().make({ type: "state", code: "PLC-SIM-TEST", severity: "info", state: "running", text: TEST_TEXT }, Date.now())]);
  const sendTest = () => simulator.device.probe({ path: EVENTS_PATH, body: testBody() });
  const test = async () => {
    setTestAnswer(null);
    const answer = await sendTest();
    setTestAnswer("refused" in answer ? { tone: "danger", text: answer.refused } : { tone: answer.tone, text: `${answer.status ?? "Inget svar"}: ${answer.summary}` });
  };
  const generate = async () => {
    setResult(null); setTestAnswer(null);
    const outcome = await generateConnection({
      list: listSources, create: createSource, rotate: rotateSource,
      setMode: (id, mode, cooldown) => setSourceMode(id, mode, cooldown),
      // The key goes from the answer straight into the simulator's closure: nothing here keeps it.
      useKey: (token) => simulator.pasteKey(token),
      sendTest,
    }, setStep);
    setStep(null);
    setResult(outcome);
    if (outcome.source) desk.set({ connectionSource: outcome.source });
    if (!outcome.ok) noteFailure(STEP_TEXT[outcome.step], outcome.error);
    void refresh();
  };
  const chooseSource = (id: string) => { setModeError(null); desk.set({ connectionSource: sources?.find((row) => row.id === id) ?? null }); };
  const chooseMode = async (mode: AlarmMode) => {
    if (!chosen) return;
    setModeError(null);
    if (mode !== "off") {
      const yes = await confirm({ title: `Sätta källan på ${ALARM_MODE_LABELS[mode]}?`, message: "Då kan larm från simulatorn ge riktiga arbetsordrar och notiser för företaget, beroende på larmnivån. Fel och kritiskt går ändå som varning tills du tillåter dem här.", confirmLabel: "Ändra läge", tone: "danger" });
      if (!yes) return;
    }
    try {
      await setSourceMode(chosen.id, mode, chosen.cooldownMinutes || DEFAULT_COOLDOWN);
      desk.set({ connectionSource: { ...chosen, alarmMode: mode } });
      void refresh();
    } catch (error) {
      const text = maskText(error instanceof Error ? error.message : String(error));
      setModeError(text);
      noteFailure("Ändra läge", text);
    }
  };
  const { device } = snapshot;
  const word = connectionWord(snapshot);
  const line = snapshot.sendsLocal ? `Larm går till Workflow. Mottagna ${device.acceptedEvents}, kö ${device.queue.length}${device.lastAnswer ? `, senaste svar ${device.lastAnswer.status} kl ${clockText(device.lastAnswer.atMs)}` : ""}.`
    : snapshot.hasKey ? "Kryssa i rutan så går larmen till Workflow." : "Allt stannar på den här sidan. Generera en koppling eller klistra in en källnyckel.";
  return <div className="plc-scroll space-y-2 p-2" data-testid="plc-connection-card">
    {upkeepOn ? null : <p className="plc-note" role="status" data-testid="module-off-notice">Underhåll är avstängt för företaget. Du kan ändå prova: Workflow svarar 409.</p>}
    <p data-testid="plc-connection-line"><span className="font-semibold" data-testid="plc-connection-state">{word}.</span> {line}{device.halt.kind === "key_refused" ? ` ${device.halt.text}` : ""}</p>

    <div className="flex flex-wrap items-center gap-1">
      <ChromeButton tone="primary" disabled={busy} onClick={() => void generate()} data-testid="plc-generate"><Wand2 aria-hidden="true" />Generera koppling automatiskt</ChromeButton>
      <ChromeButton disabled={busy || !snapshot.hasKey} onClick={() => void test()} title={snapshot.hasKey ? "En testhändelse genom intaget" : "Klistra in nyckeln först."} data-testid="plc-test-connection"><Plug aria-hidden="true" />Testa anslutning</ChromeButton>
      <ChromeButton disabled={!snapshot.hasKey} onClick={() => { simulator.removeKey(); setTestAnswer(null); setResult(null); }} title="Nyckeln glöms och kön töms" data-testid="plc-disconnect"><Unplug aria-hidden="true" />Koppla från</ChromeButton>
      {step ? <span role="status" data-testid="plc-generate-step">{STEP_TEXT[step]} …</span> : null}
    </div>
    {result?.ok ? <div className="plc-note" role="status" data-testid="plc-generate-done">
      <p><span className="font-semibold">Klart.</span> {result.created ? "Källan Simulator är skapad" : "Källan Simulator fanns och återanvänds; den gamla nyckeln gäller inte längre"}. Nyckeln finns bara i det här fönstret.</p>
      <p className="font-semibold" data-testid="plc-generate-off">Källan står på läge Av och ger inga arbetsordrar. Du väljer själv läge nedan.</p>
      <p data-testid="plc-generate-answer">Intagets svar på ”Simulerat: {TEST_TEXT}”: {result.answer.status} · {result.answer.summary}</p>
    </div> : null}
    {result && !result.ok ? <p className="plc-note text-[var(--plc-fault)] [overflow-wrap:anywhere]" role="alert" data-testid="plc-generate-error">{STEP_TEXT[result.step]} gick inte: {result.error}</p> : null}
    {testAnswer ? <p className="plc-note [overflow-wrap:anywhere]" role="status" data-testid="plc-test-answer" data-tone={testAnswer.tone} style={testAnswer.tone === "danger" ? { color: "var(--plc-fault)" } : undefined}>Intagets svar: {testAnswer.text}</p> : null}

    <div className="grid max-w-3xl gap-2 sm:grid-cols-2">
      <div className="min-w-0 space-y-1">
        <SecretField id="plc-key" label="Källnyckel" value={draft} onChange={onKey} stored={snapshot.hasKey} placeholder="hwf_mch_…" removeLabel="Ta bort nyckeln" onRemove={simulator.removeKey} noManager testId="plc-key" hint={keyProblem ?? "Nyckeln finns bara i det här fönstret tills du laddar om."} />
        <a className="underline" href={MACHINES_HREF} target="_blank" rel="noopener">Öppna Maskiner</a>
      </div>
      <div className="min-w-0 space-y-1">
        <div className="flex items-end gap-1">
          <label className="plc-field min-w-0 flex-1"><span>Vald källa</span>
            <select className="plc-select w-full" value={chosen?.id ?? ""} data-testid="plc-source" onChange={(event) => chooseSource(event.target.value)}>
              <option value="">Ingen vald</option>
              {chosen && !sources?.some((row) => row.id === chosen.id) ? <option value={chosen.id}>{chosen.name}</option> : null}
              {(sources ?? []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </label>
          <ChromeButton onClick={() => void refresh()} aria-label="Läs om källorna" data-testid="plc-source-refresh"><RefreshCw aria-hidden="true" /></ChromeButton>
        </div>
        {listError ? <p className="text-[var(--plc-fault)] [overflow-wrap:anywhere]" role="alert" data-testid="plc-source-error">{listError}</p> : null}
        <label className="plc-field"><span>Källans läge (sparas i Workflow)</span>
          <select className="plc-select w-full" disabled={!chosen} value={chosen?.alarmMode ?? "off"} data-testid="plc-source-mode" onChange={(event) => void chooseMode(event.target.value as AlarmMode)}>
            {ALARM_MODES.map((mode) => <option key={mode} value={mode}>{ALARM_MODE_LABELS[mode]}</option>)}
          </select>
        </label>
        {modeError ? <p className="text-[var(--plc-fault)] [overflow-wrap:anywhere]" role="alert" data-testid="plc-mode-error">{modeError}</p> : null}
      </div>
    </div>

    <fieldset className="max-w-3xl space-y-1 border border-[var(--plc-line)] p-1.5">
      <legend className="px-1 font-semibold">Simulatorns spärrar (gäller tills du laddar om)</legend>
      <label className="flex items-center gap-1.5"><input type="checkbox" checked={snapshot.understood} onChange={(event) => simulator.setUnderstood(event.target.checked)} data-testid="plc-understood" />Jag förstår att larm kan skapa riktiga arbetsordrar</label>
      <label className="flex items-center gap-1.5"><input type="checkbox" checked={snapshot.allowFaults} onChange={(event) => void askFaults(event.target.checked)} data-testid="plc-allow-faults" />Tillåt fel och kritiska larm <span className="plc-help">{snapshot.allowFaults ? "Larmen går i väg med sin riktiga nivå." : "Larmnivå: högst varning."}</span></label>
    </fieldset>
  </div>;
}
