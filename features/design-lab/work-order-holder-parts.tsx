"use client";

import { useId } from "react";
import { CheckCircle2, FileText, Link2, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Panel } from "@/features/kfid/ui";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { RISK_ANSWER_LABELS, RISK_ANSWERS, RISK_QUESTIONS, type RiskAnswer } from "@/lib/workflow/risk-step";
import { cn } from "@/lib/utils";

/**
 * Förslag: arbetsordern som hållare (2026-10-30). Example data in memory only – invented names, nothing is read
 * from or written to a database or the browser's storage. The two shared panels below are THE point of the proposal:
 * the work order and every task in it draw Grunduppgifter and Riskbedömning with the same component on the same data.
 */

export type Basics = { title: string; customer: string; place: string; project: string; responsible: string; start: string; due: string; description: string };
export type RiskState = { answers: Partial<Record<string, RiskAnswer>>; confirmedBy: string };
export type TaskKind = "Protokoll" | "Driftrond" | "Underhållspost";
export type DemoTask = { id: string; kind: TaskKind; title: string; done: boolean; values: Record<string, string> };
export type DemoOrder = {
  id: string;
  basics: Basics;
  risk: RiskState;
  tasks: DemoTask[];
  execution: { notes: string; deviations: string };
  signing: { name: string; confirmed: boolean };
  timer: { running: boolean; minutes: number };
  status: "Planerad" | "Pågår" | "Hinder" | "Färdigställd" | "Utgått";
  images: number;
};
/** Where the last change of the shared data was made, so the other view can say so. */
export type LastEdit = { from: "order" | "task"; part: "basics" | "risk"; at: number } | null;

export const CUSTOMERS = ["Exempelkund Fastigheter AB", "Brf Exempelgården", "Testbolaget i Mellanstad AB"];
export const PLACES = ["Kontorshuset, plan 3", "Garage B, nivå −1", "Pumpstation 2"];
export const PROJECTS = ["", "P-1042 Ombyggnad kontor plan 3", "P-1038 Laddplatser garage"];
export const PEOPLE = ["Anna Nilsson", "Erik Lund", "Sara Holm"];
export const TASK_KINDS: TaskKind[] = ["Protokoll", "Driftrond", "Underhållspost"];

export const emptyBasics = (): Basics => ({ title: "", customer: CUSTOMERS[0], place: PLACES[0], project: "", responsible: PEOPLE[0], start: "2026-11-02", due: "2026-11-06", description: "" });
export const emptyRisk = (): RiskState => ({ answers: {}, confirmedBy: "" });

export const INITIAL_ORDERS: DemoOrder[] = [{
  id: "AO-1042",
  basics: { title: "Byte av belysning trapphus", customer: CUSTOMERS[1], place: PLACES[0], project: PROJECTS[1], responsible: PEOPLE[0], start: "2026-11-02", due: "2026-11-06", description: "Byt armaturer i trapphus 1–3 och kontrollera nödljuset." },
  risk: { answers: { deenergized: "yes", competence: "yes", height: "unsure" }, confirmedBy: "" },
  tasks: [
    { id: "U-1", kind: "Protokoll", title: "Egenkontroll belysning", done: false, values: { c1: "OK", c2: "", c3: "" } },
    { id: "U-2", kind: "Underhållspost", title: "Underhåll · Hydraulpump", done: false, values: { part: "Press 4 › Hydraulpump", type: "Avhjälpande", priority: "Hög", criticality: "A", marking: "P4-HP1", fault: "Oljetemperaturen stiger vid full last.", cause: "Slitage", causeNote: "Packningen läcker.", reported: "2026-10-29T03:12", stopped: "2026-10-29T03:12", restored: "2026-10-29T07:40" } },
  ],
  execution: { notes: "", deviations: "" },
  signing: { name: "", confirmed: false },
  timer: { running: false, minutes: 95 },
  status: "Planerad",
  images: 2,
}];

/** The status pill of a work order (the app's indicator tones). */
export function OrderStatus({ status }: { status: DemoOrder["status"] }) {
  const tone = status === "Färdigställd" ? "success" : status === "Hinder" ? "danger" : status === "Utgått" ? "neutral" : status === "Pågår" ? "info" : "warning";
  return <Badge variant="outline" className={indicatorBadge(tone)}>{status}</Badge>;
}

/** "Hör till arbetsorder AO-1042 – ändras på båda ställena": the line a task's shared panels carry. */
function HolderLine({ orderId, onOpen }: { orderId: string; onOpen?: () => void }) {
  return <p className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-muted/40 px-3 py-2 text-sm" data-testid="holder-line">
    <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    <span className="min-w-0 flex-1">Hör till arbetsorder <strong>{orderId}</strong> – ändras på båda ställena.</span>
    {onOpen ? <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={onOpen}>Öppna arbetsordern</button> : null}
  </p>;
}

/** A short "Ändrat i uppgiften nyss" in the header of the panel that did not make the change. */
function SyncNote({ lastEdit, here, part }: { lastEdit: LastEdit; here: "order" | "task"; part: "basics" | "risk" }) {
  if (!lastEdit || lastEdit.from === here || lastEdit.part !== part) return null;
  return <Badge key={lastEdit.at} variant="outline" className={cn(indicatorBadge("info"), "animate-in fade-in")} data-testid="sync-note">Ändrat i {lastEdit.from === "task" ? "uppgiften" : "arbetsordern"} nyss</Badge>;
}

/** Grunduppgifter – one component for the work order, every task and the new-task form. */
export function SharedBasicsPanel({ basics, onChange, holder, onOpenHolder, lastEdit, here = "order", disabled = false }: {
  basics: Basics;
  onChange: (next: Basics) => void;
  /** The work order a task belongs to; empty on the work order itself and on a new one. */
  holder?: string;
  onOpenHolder?: () => void;
  lastEdit?: LastEdit;
  here?: "order" | "task";
  disabled?: boolean;
}) {
  const id = useId();
  const set = (key: keyof Basics) => (value: string) => onChange({ ...basics, [key]: value });
  return <Panel icon={FileText} area="work-order" title="Grunduppgifter" actions={<SyncNote lastEdit={lastEdit ?? null} here={here} part="basics" />}>
    {holder ? <HolderLine orderId={holder} onOpen={onOpenHolder} /> : null}
    <div className="@container" data-testid="shared-basics">
      <div className="grid gap-4 @xl:grid-cols-2 @4xl:grid-cols-3">
        <Field id={`${id}-title`} label="Rubrik" value={basics.title} onChange={set("title")} disabled={disabled} placeholder="Vad ska göras?" />
        <Field id={`${id}-customer`} label="Kund" value={basics.customer} onChange={set("customer")} options={CUSTOMERS} disabled={disabled} />
        <Field id={`${id}-place`} label="Plats" value={basics.place} onChange={set("place")} options={PLACES} disabled={disabled} />
        <Field id={`${id}-project`} label="Projekt" value={basics.project} onChange={set("project")} options={PROJECTS} optionLabels={{ "": "Inget projekt" }} disabled={disabled} />
        <Field id={`${id}-responsible`} label="Ansvarig" value={basics.responsible} onChange={set("responsible")} options={PEOPLE} disabled={disabled} />
        <div className="grid grid-cols-2 gap-4">
          <Field id={`${id}-start`} label="Start" type="date" value={basics.start} onChange={set("start")} disabled={disabled} />
          <Field id={`${id}-due`} label="Klart senast" type="date" value={basics.due} onChange={set("due")} disabled={disabled} />
        </div>
      </div>
      <Field id={`${id}-description`} className="mt-4" label="Beskrivning" multiline value={basics.description} onChange={set("description")} disabled={disabled} />
    </div>
  </Panel>;
}

/** Riskbedömning – the five questions of the real risk step (lib/workflow/risk-step.ts), one component everywhere. */
export function SharedRiskPanel({ risk, onChange, holder, onOpenHolder, lastEdit, here = "order", userName = PEOPLE[0], disabled = false }: {
  risk: RiskState;
  onChange: (next: RiskState) => void;
  holder?: string;
  onOpenHolder?: () => void;
  lastEdit?: LastEdit;
  here?: "order" | "task";
  userName?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const unanswered = RISK_QUESTIONS.filter((question) => !risk.answers[question.id]).length;
  const risky = RISK_QUESTIONS.some((question) => risk.answers[question.id] && risk.answers[question.id] !== "yes");
  const blocked = unanswered ? `Svara på ${unanswered === 1 ? "en fråga till" : `${unanswered} frågor till`}.` : risky ? "Ett svar visar en risk – gör en utökad riskbedömning." : "";
  return <Panel icon={ShieldAlert} area="risk" title="Riskbedömning" actions={<SyncNote lastEdit={lastEdit ?? null} here={here} part="risk" />}>
    {holder ? <HolderLine orderId={holder} onOpen={onOpenHolder} /> : null}
    <fieldset className="space-y-3 rounded-lg border p-3" disabled={disabled} data-testid="shared-risk">
      <legend className="sr-only">Riskbedömning</legend>
      {RISK_QUESTIONS.map((question) => <div key={question.id} role="radiogroup" aria-label={question.text} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-sm">{question.short}</span>
        <span className="flex shrink-0 gap-1.5">{RISK_ANSWERS.map((value) => {
          const checked = risk.answers[question.id] === value;
          return <label key={value} className={cn("touch-target inline-flex h-[var(--control-h)] min-w-16 cursor-pointer items-center justify-center rounded-md border bg-card px-3 text-sm font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
            checked && (value === "yes" ? "border-emerald-600 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "border-red-600 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200"))}>
            <input type="radio" className="sr-only" name={`${id}-${question.id}`} value={value} checked={checked}
              onChange={() => onChange({ answers: { ...risk.answers, [question.id]: value }, confirmedBy: "" })} />{RISK_ANSWER_LABELS[value]}
          </label>;
        })}</span>
      </div>)}
      <div className="flex flex-wrap items-center gap-3 border-t pt-3">
        {risk.confirmedBy ? <p className="inline-flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="size-4" aria-hidden="true" />Bekräftad av {risk.confirmedBy}.</p>
          : <><Button type="button" disabledReason={blocked} onClick={() => onChange({ ...risk, confirmedBy: userName })}><CheckCircle2 />Bekräfta</Button>
            {blocked ? <span className="text-xs text-muted-foreground">{blocked}</span> : null}</>}
      </div>
    </fieldset>
  </Panel>;
}
