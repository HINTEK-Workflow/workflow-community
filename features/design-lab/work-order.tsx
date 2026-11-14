"use client";

import { useState } from "react";
import { Check, Clock3, Package, Paperclip, Pause, Play, ShieldCheck, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CUSTOMERS, PEOPLE, PLACES, PROJECTS, RISK_QUESTIONS, SCHEDULE_DAYS, WORK_ORDER_STEPS, type RiskAnswer } from "./data";
import { Bar, Eyebrow, LabCard, LabField, LabSelect, Notice, PhoneGroup, PhoneRow, PhoneTopBar, Pill, Segmented, useLab, useLookOnly } from "./parts";
import s from "./design-lab.module.css";

const ANSWERS: readonly RiskAnswer[] = ["Ja", "Nej", "Osäker"];
const STATUSES = ["Planerad", "Behöver åtgärdas", "Väntar på material"];

/**
 * Arbetsorder (Lovable "Ny arbetsorder", 2026-10-16): the steps on the left, the form in the middle (basics with a
 * day schedule, the risk step as Ja/Nej/Osäker rows) and a right-hand column with the progress, the facts and what to
 * do next. Example data in memory only.
 */
export function WorkOrderDemo() {
  const { view, toast } = useLab();
  const lookOnly = useLookOnly();
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("");
  const [project, setProject] = useState(PROJECTS[0]);
  const [customer, setCustomer] = useState(CUSTOMERS[0]);
  const [place, setPlace] = useState(PLACES[0]);
  const [owner, setOwner] = useState(PEOPLE[0]);
  const [hours, setHours] = useState("6");
  const [status, setStatus] = useState(STATUSES[0]);
  const [description, setDescription] = useState("");
  const [days, setDays] = useState<number[]>([20, 21]);
  const [answers, setAnswers] = useState<(RiskAnswer | null)[]>(RISK_QUESTIONS.map(() => null));
  const [riskDone, setRiskDone] = useState(false);
  const [timing, setTiming] = useState(false);

  const answered = answers.filter(Boolean).length;
  const allAnswered = answered === RISK_QUESTIONS.length;
  // "Klart": the fields that make the order (title, description, a day) and the risk step.
  const progress = Math.round(([title.trim(), description.trim(), days.length > 0, riskDone].filter(Boolean).length / 4) * 100);
  const next = !title.trim() || !description.trim() ? "Ange rubrik och vad som ska göras, och spara." : !riskDone ? "Svara på riskfrågorna och bekräfta riskbedömningen." : "Spara och planera in jobbet.";
  const save = () => toast("Sparas inte – designlabbet visar bara exempeldata.");
  const toggleDay = (day: number) => setDays((list) => list.includes(day) ? list.filter((value) => value !== day) : [...list, day].sort((a, b) => a - b));
  const answer = (index: number, value: RiskAnswer) => { setRiskDone(false); setAnswers((list) => list.map((item, i) => i === index ? value : item)); };
  const confirmRisk = () => { if (!allAnswered) { toast("Svara på alla frågor först."); return; } setRiskDone(true); toast("Riskbedömningen är bekräftad (bara i designlabbet)."); };

  const facts = [
    { icon: ShieldCheck, label: "Kräver nivå 1" },
    { icon: Package, label: "0 material" },
    { icon: Paperclip, label: "0 bilagor" },
    { icon: Clock3, label: "0 h rapporterad" },
  ];

  const schedule = <div className={s.days} role="group" aria-label="Tidsplan, välj dagar">
    {SCHEDULE_DAYS.map(({ day, weekday }) => <button key={day} type="button" className={s.day} aria-pressed={days.includes(day)} onClick={() => toggleDay(day)}>
      <span>{weekday}</span><strong>{day}</strong>
    </button>)}
  </div>;

  const basicsFields = <div className={s.formGrid3}>
    <LabField label="Rubrik" wide><Input className={s.input} value={title} placeholder="Till exempel Byte av armaturer i trapphus" onChange={(event) => setTitle(event.target.value)} data-testid="lab-wo-title" /></LabField>
    <LabField label="Projekt"><LabSelect value={project} options={PROJECTS} onChange={setProject} /></LabField>
    <LabField label="Kund"><LabSelect value={customer} options={CUSTOMERS} onChange={setCustomer} /></LabField>
    <LabField label="Plats"><LabSelect value={place} options={PLACES} onChange={setPlace} /></LabField>
    <LabField label="Ansvarig"><LabSelect value={owner} options={PEOPLE} onChange={setOwner} /></LabField>
    <LabField label="Uppskattad tid (h)"><Input className={s.input} inputMode="decimal" value={hours} onChange={(event) => setHours(event.target.value)} /></LabField>
    <LabField label="Status"><LabSelect value={status} options={STATUSES} onChange={setStatus} /></LabField>
    <LabField label="Beskrivning" wide><textarea className={s.textarea} rows={3} value={description} placeholder="Vad ska göras, och vad behöver montören veta?" onChange={(event) => setDescription(event.target.value)} /></LabField>
    <div className={s.fieldWide}><p className={s.fieldLabel}>Tidsplan</p>{schedule}</div>
  </div>;

  const riskRows = <ul className={s.questionList}>
    {RISK_QUESTIONS.map((question, index) => <li key={question} className={s.question}>
      <span>{question}</span>
      <Segmented label={question} value={answers[index]} options={ANSWERS} onChange={(value) => answer(index, value)} />
    </li>)}
  </ul>;
  const riskFoot = <div className={s.riskFoot}>
    <Button className={s.btn} aria-disabled={!allAnswered || undefined} data-blocked={!allAnswered ? "" : undefined} onClick={confirmRisk} data-testid="lab-confirm-risk">
      {riskDone ? <Check /> : null}{riskDone ? "Riskbedömningen är bekräftad" : "Bekräfta riskbedömningen"}
    </Button>
    {!allAnswered ? <span className={s.reason}>Svara på alla frågor först ({answered} av {RISK_QUESTIONS.length}).</span> : null}
  </div>;

  const timerButton = <Button variant="outline" className={s.btn} onClick={() => setTiming((value) => !value)} aria-pressed={timing}>
    {timing ? <Pause /> : <Play />}{timing ? "Pausa tid" : "Starta tid"}
  </Button>;

  // ---------- Display level 1: the app look on the phone ----------
  if (view === 1) {
    return <div className={s.phoneScreen} data-testid="lab-work-order">
      <PhoneTopBar title="Ny arbetsorder" back="Jobb" onBack={lookOnly("Tillbaka")} action="Spara" onAction={save} />
      <div className={s.phoneBody}>
        <div className={s.phoneLead}>
          <div className={s.minw0}>
            <p className={s.phoneLeadMeta}>Steg {step + 1} av {WORK_ORDER_STEPS.length} · {WORK_ORDER_STEPS[step]}</p>
            <div className={s.phoneSteps} aria-hidden="true">{WORK_ORDER_STEPS.map((name, index) => <i key={name} data-state={index < step ? "done" : index === step ? "current" : undefined} />)}</div>
          </div>
        </div>
        <PhoneGroup title="Uppdraget">
          <div className={s.phoneForm}>
            <LabField label="Rubrik"><Input className={s.input} value={title} placeholder="Vad ska göras?" onChange={(event) => setTitle(event.target.value)} data-testid="lab-wo-title" /></LabField>
            <LabField label="Beskrivning"><textarea className={s.textarea} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></LabField>
          </div>
        </PhoneGroup>
        <PhoneGroup title="Var och vem">
          <div className={s.phoneForm}>
            <LabField label="Kund"><LabSelect value={customer} options={CUSTOMERS} onChange={setCustomer} /></LabField>
            <LabField label="Plats"><LabSelect value={place} options={PLACES} onChange={setPlace} /></LabField>
            <LabField label="Ansvarig"><LabSelect value={owner} options={PEOPLE} onChange={setOwner} /></LabField>
          </div>
        </PhoneGroup>
        <PhoneGroup title="Tidsplan"><div className={s.phoneForm}>{schedule}</div></PhoneGroup>
        <PhoneGroup title={`Riskbedömning (${answered} av ${RISK_QUESTIONS.length})`}>
          {riskRows}
          <div className={s.phoneForm}>{riskFoot}</div>
        </PhoneGroup>
        <PhoneGroup title="Fakta">
          {facts.map((fact) => <PhoneRow key={fact.label} icon={fact.icon} title={fact.label} />)}
        </PhoneGroup>
      </div>
      <div className={s.phoneFlow}>
        <Button variant="outline" className={s.btn} onClick={() => setTiming((value) => !value)}>{timing ? <Pause /> : <Play />}{timing ? "Pausa" : "Starta tid"}</Button>
        <Button className={s.btnGrow} onClick={() => setStep((value) => Math.min(value + 1, WORK_ORDER_STEPS.length - 1))}>Nästa: {WORK_ORDER_STEPS[Math.min(step + 1, WORK_ORDER_STEPS.length - 1)]}</Button>
      </div>
    </div>;
  }

  const stepNav = <nav className={s.steps} aria-label="Arbetsorderns steg" data-testid="lab-steps">
    <Eyebrow>Arbetsorder</Eyebrow>
    <ol>
      {WORK_ORDER_STEPS.map((name, index) => <li key={name}>
        <button type="button" className={s.stepButton} aria-current={index === step ? "step" : undefined} data-done={index < step || (index === 2 && riskDone) ? "" : undefined} onClick={() => setStep(index)}>
          <span className={s.stepRing}>{index < step || (index === 2 && riskDone) ? <Check aria-hidden="true" /> : index + 1}</span>{name}
        </button>
      </li>)}
    </ol>
  </nav>;

  const header = <header className={s.pageHeader} data-testid="lab-page-header">
    <div className={s.minw0}>
      {/* No eyebrow over a page's title (Fasta platser, 2026-10-30). */}
      <h1 className={s.pageTitle}>Ny arbetsorder {timing ? <Pill tone="info">Tid går</Pill> : null}</h1>
      <p className={s.pageSub}>Steg {step + 1} av {WORK_ORDER_STEPS.length} · {WORK_ORDER_STEPS[step]}</p>
    </div>
    <div className={s.headerActions}>
      {timerButton}
      <Button className={s.btn} onClick={save}>Spara</Button>
    </div>
  </header>;

  const showsForm = step === 0 || step === 2;
  const main = showsForm ? <>
    <LabCard title="Grunduppgifter" description="Rubrik, plats, ansvarig och när jobbet görs." testId="lab-wo-basics" collapsible={view === 2} defaultOpen={step === 0}>{basicsFields}</LabCard>
    <LabCard title="Riskbedömning" description="Svara på frågorna innan arbetet börjar." icon={riskDone ? ShieldCheck : ShieldAlert} flush testId="lab-risk" collapsible={view === 2} defaultOpen={view === 3 || step === 2}>
      {riskRows}
      <div className={s.cardBody}>{riskFoot}</div>
    </LabCard>
  </> : <LabCard title={WORK_ORDER_STEPS[step]} testId="lab-step-placeholder">
    <p className={s.empty}>Steget {WORK_ORDER_STEPS[step].toLowerCase()} visas inte i designlabbet. Välj Beställning eller Riskbedömning.</p>
  </LabCard>;

  const progressCard = <div className={s.summaryCard} data-testid="lab-wo-progress">
    <p className={s.summaryLabel}>Klart</p>
    <p className={s.figure}>{progress} %</p>
    <Bar value={progress} label="Klart" />
  </div>;
  const factCard = <div className={s.card}><ul className={s.facts}>
    {facts.map((fact) => <li key={fact.label}><fact.icon aria-hidden="true" />{fact.label}</li>)}
  </ul></div>;
  const nextNotice = <Notice tone="info" testId="lab-next"><strong>Nästa:</strong> {next}</Notice>;

  if (view === 2) {
    return <div className={s.page} data-testid="lab-work-order">
      {header}
      <div className={s.stepChips} role="group" aria-label="Arbetsorderns steg">
        {WORK_ORDER_STEPS.map((name, index) => <button key={name} type="button" className={s.stepChip} aria-current={index === step ? "step" : undefined} onClick={() => setStep(index)}>{index + 1}. {name}</button>)}
      </div>
      <div className={s.strip}>
        <div><p className={s.summaryLabel}>Klart</p><p className={s.stripFigure}>{progress} %</p></div>
        {facts.slice(1).map((fact) => <div key={fact.label} className={s.stripFact}><fact.icon aria-hidden="true" />{fact.label}</div>)}
      </div>
      <div className={s.stack}>
        {nextNotice}
        {main}
      </div>
    </div>;
  }

  return <div className={s.page} data-testid="lab-work-order">
    <div className={s.withSteps}>
      {stepNav}
      <div className={cn(s.stack, s.minw0)}>
        {header}
        {main}
      </div>
      <aside className={s.aside} aria-label="Sammanfattning" data-testid="lab-summary">
        {progressCard}
        {factCard}
        {nextNotice}
      </aside>
    </div>
  </div>;
}
