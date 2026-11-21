"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListGroup, ListRow, StepBar } from "@/components/native";
import { api } from "@/features/kfid/api";
import { DialogActions, Field, Modal, Panel } from "@/features/kfid/ui";
import { formatSwedish } from "@/lib/swedish-time";
import { RISK_FORM_ID } from "@/lib/workflow/builtin-originals";
import { initialFormValues, type FormDocument } from "@/lib/workflow/form-document";
import {
  emptyRiskCheck, emptyRiskStepContext, pageRiskStepState, RISK_ANSWER_LABELS, RISK_ANSWERS, RISK_EXCEPTION_DEFAULT_REASON, RISK_EXCEPTION_LABEL, RISK_EXCEPTION_REPORT_TITLE, RISK_QUESTIONS, riskCheckOf,
  type RiskAnswer, type RiskCheck, type RiskStepContext, type RiskStepState,
} from "@/lib/workflow/risk-step";
import { localRiskStepContext } from "@/lib/workflow/risk-step-local";
import { roundSafetyRiskFrom, type RoundSafetyRisk } from "@/lib/workflow/round-safety";
import { firstUnanswered, nextQuestionIndex, showsExtendedChoice } from "@/lib/workflow/risk-step-paging";
import { cn } from "@/lib/utils";
import { HolderLine } from "./shared-basics";

/**
 * Riskbedömning som steg (2026-10-08) on the task page: the simplified questions with a confirmation, or the extended
 * risk assessment created with one tap and linked to the job. The rule is lib/workflow/risk-step.ts; the server decides
 * again when the time starts and when the task is completed.
 */
export const RISK_STEP_TARGET = "task-risk-step";
type RiskTask = { id: string; kind: string; formArea?: string | null; status: string; title: string; data: unknown; workOrderId?: string | null };
type StoredTask = { id: string; kind: string; title: string; status: string; data: unknown; workOrderId?: string | null };
const workOrderIdOf = (task: unknown) => { const value = (task as { workOrderId?: unknown }).workOrderId; return typeof value === "string" && value ? value : null; };

/** The task's step as the page shows it: Cloud and the demo ask the server for the linked tasks, Local reads its file. */
export function useRiskStep({ task, local, preview }: { task: RiskTask; local?: { tasks: readonly StoredTask[]; riskExceptionAllowed?: boolean }; preview?: boolean }) {
  // A new task gets the step when it is saved, so it is shown from the start. A draft without a work order answers the
  // questions on itself (2026-10-30); they move to the work order made from it.
  const draft = task.kind !== "WORK_ORDER" && !workOrderIdOf(task);
  const data = useMemo(() => task.id && !draft ? task.data : { ...(task.data as object), riskStep: true }, [task.id, task.data, draft]);
  const extendedId = riskCheckOf(task.data)?.extendedTaskId ?? "";
  const workOrderId = workOrderIdOf(task);
  const [remote, setRemote] = useState<{ key: string; context: RiskStepContext; roundRisk: RoundSafetyRisk | null } | null>(null);
  // Arbetet är redan utfört (2026-11-02): offered once the company's choice is known. A new work order has no id, so it asks for that alone.
  const [remoteExceptionAllowed, setRemoteExceptionAllowed] = useState(false);
  const key = `${task.id}|${extendedId}|${workOrderId ?? ""}|${task.status}`;
  // A new task opened in a work order is read with the order's id, so it follows the order's step from the start like a saved
  // one (2026-10-29: the new round protocol asked its own risk questions and Starta tid did nothing).
  const query = task.id ? `taskId=${encodeURIComponent(task.id)}` : workOrderId ? `workOrderId=${encodeURIComponent(workOrderId)}` : "";
  const refresh = useCallback(async () => {
    if (local || preview) return;
    try {
      const result = await api<{ context?: RiskStepContext; roundRisk?: RoundSafetyRisk | null; exceptionAllowed?: boolean }>(`/api/workflow-tasks/risk-step?${query || "setting=1"}`);
      setRemoteExceptionAllowed(result.exceptionAllowed === true);
      if (result.context) setRemote({ key, context: result.context, roundRisk: result.roundRisk ?? null });
    }
    catch { /* the server decides anyway; the page keeps what it knows */ }
  }, [local, preview, query, key]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- read again when the task, its link or its status changes
  useEffect(() => { void refresh(); }, [refresh]);
  const context: RiskStepContext = local
    ? localRiskStepContext(local.tasks, { ...task, data, workOrderId })
    : remote && remote.key === key ? remote.context
    // Until the order is read, a new task in it waits for the order's step instead of showing questions of its own.
    : !task.id && workOrderId ? { extended: null, workOrder: { id: workOrderId, title: "", status: "", done: false } } : emptyRiskStepContext();
  const state = pageRiskStepState({ ...task, data }, context);
  // Säkerhetsavstämning (2026-10-27): the work order's risk assessment a round occurrence is checked against.
  const roundRisk = local ? roundSafetyRiskFrom(local.tasks as Parameters<typeof roundSafetyRiskFrom>[0], workOrderId) : remote && remote.key === key ? remote.roundRisk : null;
  const exceptionAllowed = preview ? false : local ? local.riskExceptionAllowed !== false : remoteExceptionAllowed;
  return { state, context, refresh, roundRisk, exceptionAllowed };
}

type JobForAssessment = { id: string; workOrderId?: string | null; title: string; projectId: string | null; customerId: string | null; facilityId?: string | null; assignedToUserId: string | null; assignedToName: string; data: unknown };
type PublishedForm = { id: string; baseId?: string | null; allowInProject?: boolean; allowStandalone?: boolean };

/**
 * One tap: a risk assessment for the job with its project, customer, place and responsible person, as a task in the work
 * order (Arbetsordern styr, 2026-10-26: the step is on the work order, so the job is the work order itself). The published risk form
 * (the company's own version before Workflow's original) when there is one, otherwise the older risk assessment type.
 */
export async function createExtendedAssessment(input: {
  job: JobForAssessment;
  save: (record: Record<string, unknown>) => Promise<{ id: string }>;
  /** Cloud and the demo read the published risk form; Local makes the older type. */
  forms: boolean;
  /** The editor's own prefill (customer, contact, place) for a new protocol. */
  prepare?: (record: Record<string, unknown>) => Record<string, unknown>;
}): Promise<{ id: string; kind: "FORM" | "RISK_ASSESSMENT" }> {
  const { job } = input;
  const tempPlace = job.data && typeof job.data === "object" ? (job.data as { tempPlace?: unknown }).tempPlace : undefined;
  const base = { id: undefined, version: 0, title: `Riskbedömning: ${job.title}`.slice(0, 200), description: `Utökad riskbedömning för ${job.title}.`.slice(0, 5000), status: "PLANNED", progress: 0,
    projectId: job.projectId, customerId: job.customerId, facilityId: job.facilityId ?? null, workOrderId: job.workOrderId || job.id,
    assignedToUserId: job.assignedToUserId, assignedToName: job.assignedToName, dueDate: "", totalDurationSec: 0, timerRunning: false };
  let form: { templateId: string; version: number; name: string; document: FormDocument; publisher?: string } | null = null;
  if (input.forms) {
    try {
      const { forms } = await api<{ forms: PublishedForm[] }>("/api/forms");
      const usable = forms.filter((item) => (item.baseId ?? item.id) === RISK_FORM_ID && (job.projectId ? item.allowInProject !== false : item.allowStandalone !== false))
        .sort((a, b) => Number(Boolean(b.baseId)) - Number(Boolean(a.baseId)));
      if (usable[0]) form = await api(`/api/forms?id=${encodeURIComponent(usable[0].id)}`);
    } catch { form = null; }
  }
  const record = form
    ? { ...base, kind: "FORM", title: base.title, data: { kind: "FORM", ...(tempPlace ? { tempPlace } : {}), details: { templateId: form.templateId, templateVersion: form.version, templateName: form.name, ...(form.publisher ? { publisherName: form.publisher } : {}), document: form.document, values: initialFormValues(form.document) } } }
    : { ...base, kind: "RISK_ASSESSMENT", data: { kind: "RISK_ASSESSMENT", ...(tempPlace ? { tempPlace } : {}), details: { risks: [], generalMeasures: "", approval: { name: "", confirmed: false, approvedAt: null } } } };
  const prepared = input.prepare ? input.prepare(record) : record;
  const result = await input.save(prepared);
  return { id: result.id, kind: form ? "FORM" : "RISK_ASSESSMENT" };
}

const statusText: Record<string, string> = { PLANNED: "Planerad", IN_PROGRESS: "Pågår", PAUSED: "Pausad", NEEDS_ACTION: "Behöver åtgärdas", COMPLETED: "Färdigställd", CANCELLED: "Utgått" };

/**
 * Arbetet är redan utfört (2026-11-02, lib/workflow/risk-step.ts): the button and its dialog. A ready text stands as the reason, for
 * the person to change; an empty one cannot be saved, and the server refuses it too.
 */
function RiskExceptionButton({ onSkip, disabled, busy, className }: { onSkip: (reason: string) => void; disabled: boolean; busy: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(RISK_EXCEPTION_DEFAULT_REASON);
  const missing = reason.trim() ? null : "Skriv varför riskbedömningen inte görs.";
  return <>
    <Button type="button" variant="outline" className={className} disabled={disabled || busy} data-testid="risk-step-exception" onClick={() => { setReason(RISK_EXCEPTION_DEFAULT_REASON); setOpen(true); }}><ClipboardCheck />{RISK_EXCEPTION_LABEL}</Button>
    <Modal open={open} onOpenChange={setOpen} title={RISK_EXCEPTION_LABEL} size="form">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Riskbedömningen hoppas över för den här arbetsordern. Skälet, ditt namn och tiden sparas och syns i rapporten.</p>
        <Field id="risk-exception-reason" multiline label="Skäl" value={reason} onChange={setReason} required />
        <DialogActions cancel={{ onClick: () => setOpen(false) }} primary={{ label: "Hoppa över riskbedömningen", disabled: busy || Boolean(missing), disabledReason: missing ?? undefined, testId: "risk-step-exception-save",
          onClick: () => { onSkip(reason.trim()); setOpen(false); } }} />
      </div>
    </Modal>
  </>;
}

export function RiskStepPanel({ state, context, check, userName, disabled, busy, onChange, onCreateExtended, paged = false, workOrder = null, holder = null, exceptionAllowed = false }: {
  /** The company allows Arbetet är redan utfört (Inställningar → Arbetssätt). */
  exceptionAllowed?: boolean;
  /** Riskbedömningen är gemensam (2026-10-30): a task answers on its work order's data, and the panel says so. */
  holder?: { id: string; title: string } | null;
  /** Arbetsordern styr (2026-10-26): a task's step is its work order's; the panel then says so and leads there instead of asking. */
  workOrder?: { id: string; title: string } | null;
  state: RiskStepState;
  context: RiskStepContext;
  check: RiskCheck | null;
  userName?: string;
  /** The task is completed, frozen or a preview. */
  disabled: boolean;
  busy: boolean;
  onChange: (check: RiskCheck) => void;
  onCreateExtended: () => void;
  /** The app (level 1, a phone or the app column): one question per screen with three big buttons (UX-granskningen avsnitt 6). */
  paged?: boolean;
}) {
  if (!state.applies) return null;
  // A task in a work order (2026-10-26): the risk step is done on the work order and the task follows it.
  if (workOrder) {
    const orderHref = `/?view=workflow_task&taskId=${encodeURIComponent(workOrder.id)}&taskType=WORK_ORDER`;
    return <div data-testid="risk-step" data-state={state.done ? "done" : "open"} data-on-work-order="">
      <Panel icon={ShieldAlert} keepOpen title="Riskbedömning" description="Riskbedömningen görs på arbetsordern och gäller alla uppgifter i den.">
        <div id={RISK_STEP_TARGET} data-flow-target={RISK_STEP_TARGET} className="flex flex-wrap items-center gap-3">
          {state.done ? <p className="inline-flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300" data-testid="risk-step-done"><CheckCircle2 className="size-4" aria-hidden="true" />{state.exception ? `${RISK_EXCEPTION_REPORT_TITLE}, enligt arbetsordern ”${workOrder.title || "Arbetsorder"}”.` : state.via === "completed" ? "Riskbedömningen är avslutad med uppgiften." : `Riskbedömningen är gjord på arbetsordern ”${workOrder.title || "Arbetsorder"}”.`}</p>
            : <p role="note" className="notice flex items-start gap-2 text-sm" data-testid="risk-step-hint"><ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{state.hint}</p>}
          {state.done ? null : <Button asChild><Link href={orderHref} data-testid="risk-step-work-order"><ShieldCheck />Gör riskbedömningen på arbetsordern</Link></Button>}
        </div>
      </Panel>
    </div>;
  }
  const current = check ?? emptyRiskCheck();
  const set = (next: Partial<RiskCheck>) => onChange({ ...current, ...next });
  const answer = (id: string, value: RiskAnswer) => set({ answers: { ...current.answers, [id]: value }, confirmedAt: null, confirmedBy: "" });
  const linked = current.extendedTaskId && context.extended?.id === current.extendedTaskId ? context.extended : null;
  const linkHref = (id: string, kind?: string) => `/?view=workflow_task&taskId=${encodeURIComponent(id)}&taskType=${kind ?? "FORM"}`;
  const showQuestions = current.level !== "extended";
  // An answer that shows a risk never offers Bekräfta (kundresan 2026-11-07, L37: "bekräfta" after Nej, the same sentence two or
  // three times): the hint says once that the extended risk assessment is needed, and its button is the way on.
  const riskShown = state.riskAnswers.length > 0;
  const confirmBlocked = state.unanswered.length ? "Svara på alla frågor så kan du bekräfta." : "";
  const confirm = () => set({ level: "simplified", confirmedAt: new Date().toISOString(), confirmedBy: userName ?? "" });
  // Who and when are set where it is saved; the time here only shows it until then.
  const skip = (reason: string) => set({ exception: { reason, by: userName ?? "", at: new Date().toISOString() } });
  const exceptionButton = exceptionAllowed && !disabled ? <RiskExceptionButton onSkip={skip} disabled={disabled} busy={busy} /> : null;
  const doneText = state.via === "work-order" ? `Riskbedömningen är gjord på arbetsordern ”${context.workOrder?.title || "Arbetsorder"}”.`
    : state.via === "extended" ? `Den utökade riskbedömningen${linked?.title ? ` ”${linked.title}”` : ""} är färdigställd.`
    : state.via === "simplified" || (state.via === "completed" && current.confirmedAt) ? `Förenklad riskbedömning bekräftad${current.confirmedBy ? ` av ${current.confirmedBy}` : ""}${current.confirmedAt ? ` ${formatSwedish(current.confirmedAt, { dateStyle: "short", timeStyle: "short" })}` : ""}.`
    : state.via === "completed" ? "Riskbedömningen är avslutad med uppgiften." : "";
  const confirmButton = <Button type="button" data-testid="risk-step-confirm" disabled={busy || disabled} disabledReason={confirmBlocked} aria-describedby={confirmBlocked ? "risk-step-confirm-reason" : undefined} onClick={confirm}><CheckCircle2 />Bekräfta riskbedömningen</Button>;
  // The step's buttons side by side as long as they fit, then wrapped (2026-11-02). The paged app questions have Bekräfta on their own summary.
  const stepButtons = (withConfirm: boolean) => <div className="flex flex-wrap items-center gap-2" data-testid="risk-step-actions">
    {withConfirm ? confirmButton : null}
    {linked ? <Button asChild><Link href={linkHref(linked.id, linked.kind)} data-testid="risk-step-open-extended"><ShieldCheck />Öppna riskbedömningen ({statusText[linked.status] ?? linked.status})</Link></Button>
      : <Button type="button" variant={state.extendedRequired ? "default" : "outline"} disabled={disabled || busy} data-testid="risk-step-create-extended" onClick={onCreateExtended}><ShieldCheck />Gör utökad riskbedömning</Button>}
    {exceptionButton}
    {current.level === "extended" && !linked && !state.riskAnswers.length && !disabled ? <Button type="button" variant="ghost" onClick={() => set({ level: "simplified" })}>Tillbaka till förenklad</Button> : null}
  </div>;
  const extendedNote = showQuestions && !state.extendedRequired ? <p className="text-xs text-muted-foreground">Du kan alltid välja en utökad riskbedömning.</p> : null;
  // The id sits inside the panel, so the progress line marks this panel and a link to the step opens it when folded.
  return <div data-testid="risk-step" data-state={state.done ? "done" : "open"}>
    <Panel icon={ShieldAlert} keepOpen title="Riskbedömning" description="Riskbedömningen görs innan arbetet startar.">
      {holder ? <div className="mb-4"><HolderLine workOrder={holder} /></div> : null}
      <div id={RISK_STEP_TARGET} data-flow-target={RISK_STEP_TARGET}>
      {state.via === "exception" && current.exception ? <div className="grid justify-items-start gap-2" data-testid="risk-step-exception-done">
        <p role="note" className="notice flex items-start gap-2 text-sm"><ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{RISK_EXCEPTION_REPORT_TITLE}</p>
        <p className="text-sm [overflow-wrap:anywhere]" data-testid="risk-step-exception-reason">{current.exception.reason}</p>
        <p className="text-xs text-muted-foreground">{[current.exception.by, current.exception.at ? formatSwedish(current.exception.at, { dateStyle: "short", timeStyle: "short" }) : ""].filter(Boolean).join(" · ")}</p>
        {disabled ? null : <Button type="button" variant="outline" data-testid="risk-step-exception-undo" onClick={() => onChange((({ exception: _taken, ...rest }) => { void _taken; return rest; })(current))}>Ångra undantaget</Button>}
      </div> : state.done ? <div className="flex flex-wrap items-center gap-3">
        <p className="inline-flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300" data-testid="risk-step-done"><CheckCircle2 className="size-4" aria-hidden="true" />{doneText}</p>
        {linked ? <Button asChild variant="outline"><Link href={linkHref(linked.id, linked.kind)} data-testid="risk-step-open-extended"><ShieldCheck />Öppna riskbedömningen</Link></Button> : null}
        {state.via === "simplified" && !disabled ? <Button type="button" variant="outline" data-testid="risk-step-change" onClick={() => set({ confirmedAt: null, confirmedBy: "" })}>Ändra svaren</Button> : null}
        {state.via === "completed" && current.level === "simplified" && current.confirmedAt ? <AnswerList check={current} /> : null}
      </div> : <div className="space-y-4">
        {showQuestions && paged ? <RiskQuestionsPaged check={current} disabled={disabled} busy={busy} hint={state.hint} confirmBlocked={confirmBlocked} riskShown={riskShown} onAnswer={answer} onConfirm={confirm} extendedRow={stepButtons(false)} exceptionButton={exceptionAllowed && !disabled ? <RiskExceptionButton onSkip={skip} disabled={disabled} busy={busy} className="h-12 w-full" /> : null} /> : <>
        <p role="note" className="notice flex items-start gap-2 text-sm" data-testid="risk-step-hint"><ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{state.hint}</p>
        {showQuestions ? <fieldset className="field-group space-y-3 rounded-lg border p-3" disabled={disabled} data-testid="risk-step-questions">
          <legend className="sr-only">Förenklad riskbedömning</legend>
          {RISK_QUESTIONS.map((question) => <div key={question.id} role="radiogroup" aria-label={question.text} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" data-testid={`risk-question-${question.id}`}>
            <span className="text-sm">{question.text}</span>
            <span className="risk-answers flex shrink-0 gap-1.5">{RISK_ANSWERS.map((value) => {
              const checked = current.answers[question.id] === value;
              return <label key={value} className={cn("touch-target inline-flex h-[var(--control-h)] min-w-16 cursor-pointer items-center justify-center rounded-md border bg-card px-3 text-sm font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                checked && (value === "yes" ? "border-emerald-600 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "border-red-600 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200"))}>
                <input type="radio" className="sr-only" name={`risk-${question.id}`} value={value} checked={checked} onChange={() => answer(question.id, value)} data-testid={`risk-answer-${question.id}-${value}`} />{RISK_ANSWER_LABELS[value]}
              </label>;
            })}</span>
          </div>)}
        </fieldset> : null}
        {/* Never a dead button (docs/ui-system.md 1): while Bekräfta waits it looks inactive, and a tap tells why. */}
        <div className="space-y-2">
          {stepButtons(showQuestions && !riskShown)}
          {showQuestions && !riskShown ? confirmBlocked ? <p id="risk-step-confirm-reason" className="text-xs text-muted-foreground" data-testid="risk-step-confirm-reason">{confirmBlocked}</p> : <p className="text-xs text-muted-foreground">Jag har gått igenom frågorna på plats och svaren stämmer.</p> : null}
          {extendedNote}
        </div>
        </>}
      </div>}
      </div>
    </Panel>
  </div>;
}

/**
 * En fråga per skärm (UX-granskningen avsnitt 6, punkt 7): in the app each question has the screen to itself – a thin step
 * row, the question, and Ja · Nej · Osäker as three big buttons across the width. An answer is kept at once (the same
 * onChange as the list) and moves on to the next unanswered question; Föregående/Nästa fråga step back and forth. After the
 * last one the answers are listed (a tap goes back to that question) with Bekräfta. The rule and the server are unchanged:
 * a Nej or Osäker still requires the extended risk assessment, and Starta tid/Färdigställ are refused until it is done.
 */
function RiskQuestionsPaged({ check, disabled, busy, hint, confirmBlocked, riskShown, onAnswer, onConfirm, extendedRow, exceptionButton }: {
  check: RiskCheck; disabled: boolean; busy: boolean; hint: string; confirmBlocked: string;
  /** An answer shows a risk: no Bekräfta, the hint and Gör utökad riskbedömning lead on. */
  riskShown: boolean;
  onAnswer: (id: string, value: RiskAnswer) => void; onConfirm: () => void;
  /** "Gör utökad riskbedömning" (or the link to it): on the summary only, never under a question (svar 1, 2026-10-24). */
  extendedRow: ReactNode;
  /** Arbetet är redan utfört: under every question too, since the person who skips the step should not have to answer it first. */
  exceptionButton: ReactNode;
}) {
  const total = RISK_QUESTIONS.length;
  const [index, setIndex] = useState(() => firstUnanswered(check.answers));
  const question = index < total ? RISK_QUESTIONS[index] : null;
  const steps = RISK_QUESTIONS.map((item, at) => at === index ? "current" as const : check.answers[item.id] ? "done" as const : "todo" as const);
  const choose = (value: RiskAnswer) => {
    if (!question || disabled) return;
    onAnswer(question.id, value);
    setIndex(nextQuestionIndex({ ...check.answers, [question.id]: value }, index));
  };
  const answeredHere = question ? Boolean(check.answers[question.id]) : false;
  return <div className="space-y-4" data-testid="risk-step-paged" data-question={question?.id ?? "summary"}>
    <div>
      <StepBar steps={steps} label={question ? `Fråga ${index + 1} av ${total}` : "Alla frågor besvarade"} testId="risk-step-bar" />
      <p className="text-xs text-muted-foreground" data-testid="risk-step-count">{question ? `Fråga ${index + 1} av ${total}` : "Dina svar"}</p>
    </div>
    {question ? <>
      <div role="group" aria-labelledby={`risk-q-${question.id}`} className="space-y-4" data-testid={`risk-question-${question.id}`}>
        <p id={`risk-q-${question.id}`} className="min-h-[4.5rem] text-lg font-medium leading-snug">{question.text}</p>
        <div className="grid gap-3">{RISK_ANSWERS.map((value) => {
          const chosen = check.answers[question.id] === value;
          return <button key={value} type="button" aria-pressed={chosen} disabled={disabled} onClick={() => choose(value)} data-testid={`risk-answer-${question.id}-${value}`}
            className={cn("flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border bg-card px-4 text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
              chosen && (value === "yes" ? "border-emerald-600 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "border-red-600 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200"))}>
            {chosen ? <CheckCircle2 className="size-5" aria-hidden="true" /> : null}{RISK_ANSWER_LABELS[value]}
          </button>;
        })}</div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Button type="button" variant="outline" className="h-12" disabled={index === 0} onClick={() => setIndex(index - 1)} data-testid="risk-step-previous"><ChevronLeft />Föregående fråga</Button>
        <Button type="button" variant="outline" className="h-12" disabled={!answeredHere} onClick={() => setIndex(index + 1)} data-testid="risk-step-next">Nästa fråga<ChevronRight /></Button>
      </div>
      {/* Set apart from the question's buttons (resa 2026-11-06), so it is not taken for one of them. It asks for a reason before anything is skipped. */}
      {exceptionButton ? <div className="border-t pt-4" data-testid="risk-step-exception-row">{exceptionButton}</div> : null}
    </> : <>
      <ListGroup testId="risk-step-answers">
        {RISK_QUESTIONS.map((item, at) => <ListRow key={item.id} title={item.short} twoLines value={check.answers[item.id] ? RISK_ANSWER_LABELS[check.answers[item.id]!] : "Inte besvarad"} onClick={() => setIndex(at)} ariaLabel={`Ändra svaret: ${item.short}`} testId={`risk-step-answer-${item.id}`} />)}
      </ListGroup>
      {/* Only bekräfta left: the button says it, so no note repeats it (resa 2026-11-06). */}
      {hint && hint !== CONFIRM_ONLY_HINT ? <p role="note" className="notice flex items-start gap-2 text-sm" data-testid="risk-step-hint"><ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{hint}</p> : null}
      {riskShown ? null : <div className="space-y-1.5">
        <Button type="button" className="h-12 w-full text-base" data-testid="risk-step-confirm" disabled={busy || disabled} disabledReason={confirmBlocked} aria-describedby={confirmBlocked ? "risk-step-confirm-reason" : undefined} onClick={onConfirm}><CheckCircle2 />Bekräfta riskbedömningen</Button>
        {confirmBlocked ? <p id="risk-step-confirm-reason" className="px-1 text-xs text-muted-foreground" data-testid="risk-step-confirm-reason">{confirmBlocked}</p> : <p className="px-1 text-xs text-muted-foreground">Jag har gått igenom frågorna på plats och svaren stämmer.</p>}
      </div>}
      {showsExtendedChoice(index) ? extendedRow : null}
    </>}
  </div>;
}

/** The hint when only the confirmation is left (lib/workflow/risk-step.ts). */
const CONFIRM_ONLY_HINT = "Bekräfta riskbedömningen.";

function AnswerList({ check }: { check: RiskCheck }) {
  return <dl className="grid w-full gap-1 text-xs text-muted-foreground sm:grid-cols-2">
    {RISK_QUESTIONS.map((question) => check.answers[question.id] ? <div key={question.id} className="flex justify-between gap-2"><dt>{question.short}</dt><dd className="font-medium text-foreground">{RISK_ANSWER_LABELS[check.answers[question.id]!]}</dd></div> : null)}
  </dl>;
}
