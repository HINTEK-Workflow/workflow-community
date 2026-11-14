import { z } from "zod";
import { RISK_FORM_ID } from "./builtin-originals";
import { formLeafBlocks, type FormDocument } from "./form-document";

/**
 * Riskbedömning som steg på arbetsordern (2026-10-08, beslut 3; since 2026-10-26 "Arbetsordern styr": the step is
 * only on the work order, and the tasks in it inherit it – a task never has a step of its own). Before the work starts the
 * work order has a risk step. Simplified by default (a few questions in Workflow's own words and a confirmation by the
 * person); extended – a real risk assessment linked to the job – when an answer shows a risk or when the person chooses it.
 * Starting the time and completing are refused until the step is done. The task type's level (Egenkontroll, "Krävd nivå")
 * is about who may do the task, not the risk assessment, so it never forces extended (2026-10-09).
 *
 * Pure rules shared by Cloud (the routes), Local, the demo and the screen. Stored in the task's own JSON data
 * (`data.riskCheck`, and `data.riskStep` on tasks created since the step exists), so no migration: older tasks and .hwf
 * files parse unchanged and are never locked. The wording is Workflow's own; no text from standards or publishers.
 */

export const RISK_QUESTIONS = [
  { id: "deenergized", text: "Det jag ska arbeta i är spänningsfritt och säkrat mot påslag – eller så berör jobbet ingen el.", short: "Spänningsfritt och säkrat" },
  { id: "competence", text: "Jag har behörighet, kunskap och rätt utrustning för jobbet.", short: "Behörighet och utrustning" },
  { id: "height", text: "Jobbet kräver inget arbete på höjd eller i trånga utrymmen.", short: "Inget arbete på höjd eller i trånga utrymmen" },
  { id: "others", text: "Andra som finns på platsen vet om arbetet, och området är avgränsat där det behövs.", short: "Andra på platsen är informerade" },
  { id: "special", text: "Jag ser inga andra särskilda risker på platsen, till exempel trafik, tunga lyft, kemikalier eller brandrisk.", short: "Inga särskilda risker på platsen" },
] as const;
export type RiskQuestionId = (typeof RISK_QUESTIONS)[number]["id"];
export const RISK_ANSWERS = ["yes", "no", "unsure"] as const;
export type RiskAnswer = (typeof RISK_ANSWERS)[number];
export const RISK_ANSWER_LABELS: Record<RiskAnswer, string> = { yes: "Ja", no: "Nej", unsure: "Osäker" };

const answer = z.enum(RISK_ANSWERS).optional();
export const riskCheckSchema = z.object({
  level: z.enum(["simplified", "extended"]).default("simplified"),
  answers: z.object(Object.fromEntries(RISK_QUESTIONS.map((question) => [question.id, answer])) as Record<RiskQuestionId, typeof answer>).default({}),
  confirmedBy: z.string().trim().max(160).default(""),
  confirmedById: z.string().max(100).optional(),
  // Set by the persistence boundary (the server, Local's store, the demo), never trusted from a client.
  confirmedAt: z.iso.datetime().nullable().default(null),
  extendedTaskId: z.string().min(1).max(100).optional(),
  // Undantag (2026-11-02, RISK_EXCEPTION_LABEL): the step skipped because the work is already done. The reason is the person's;
  // who and when are set by the persistence boundary, like the confirmation, never trusted from a client.
  exception: z.object({
    reason: z.string().trim().min(1, "Skriv varför riskbedömningen inte görs.").max(1000),
    by: z.string().trim().max(160).default(""),
    byId: z.string().max(100).optional(),
    at: z.iso.datetime().nullable().default(null),
  }).optional(),
});
export type RiskCheck = z.output<typeof riskCheckSchema>;
export const emptyRiskCheck = (): RiskCheck => ({ level: "simplified", answers: {}, confirmedBy: "", confirmedAt: null });

/**
 * Undantag från riskbedömningen (2026-11-02: "om jag var klar med tillbudet och skapade en arbetsorder efteråt så skall jag
 * inte behöva göra riskbedömning"): whoever may do the step says the work is already done, with a reason. It lifts the block on
 * Starta tid and Färdigställ for this work order and the tasks in it, and the report says so. A company can turn it off
 * (Inställningar → Arbetssätt; on by default); stored in WorkspaceSettings.profile, so no migration.
 */
export const RISK_EXCEPTION_LABEL = "Arbetet är redan utfört";
export const RISK_EXCEPTION_DEFAULT_REASON = "Arbetet var redan klart när arbetsordern skapades, så riskbedömningen kunde inte göras före arbetet.";
export const RISK_EXCEPTION_REPORT_TITLE = "Riskbedömning ej gjord: arbetet redan utfört";
export const RISK_EXCEPTION_OFF = "Företaget har stängt av undantaget. Gör riskbedömningen.";

/** The company's choice from WorkspaceSettings.profile: on unless it has been turned off. */
export const riskExceptionOn = (profile: unknown): boolean => !(profile && typeof profile === "object" && (profile as { riskExceptionOff?: unknown }).riskExceptionOff === true);

/**
 * Why this save may not take the exception, or null. Only a new or changed exception is refused while it is off: one
 * already made stays, with its reason and its person, and so does the way to take it back.
 */
export function riskExceptionRefusal(data: unknown, stored: unknown, allowed: boolean): string | null {
  if (allowed) return null;
  const next = riskCheckOf(data)?.exception;
  if (!next) return null;
  const before = riskCheckOf(stored)?.exception;
  return before && before.reason === next.reason ? null : RISK_EXCEPTION_OFF;
}

/** The task's risk check from its data, or null (older tasks and anything malformed have none). */
export function riskCheckOf(data: unknown): RiskCheck | null {
  const raw = data && typeof data === "object" ? (data as { riskCheck?: unknown }).riskCheck : undefined;
  if (!raw) return null;
  const parsed = riskCheckSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** The task data with the risk check set, or removed. */
export function withRiskCheck<T extends object>(data: T, check: RiskCheck | null): T {
  const { riskCheck: _old, ...rest } = data as T & { riskCheck?: unknown };
  void _old;
  return (check ? { ...rest, riskCheck: check } : rest) as T;
}

type TaskLike = { kind: string; formArea?: string | null; data: unknown };

/** A risk assessment never needs a risk step of its own: the old kind, the risk form (Workflow's or the company's version). */
export function isRiskAssessmentTask(task: TaskLike): boolean {
  if (task.kind === "RISK_ASSESSMENT") return true;
  if (task.kind !== "FORM") return false;
  if (task.formArea === "risk-assessment") return true;
  const details = (task.data as { details?: { templateId?: string; document?: FormDocument } } | null | undefined)?.details;
  if (details?.templateId === RISK_FORM_ID) return true;
  // A copy of the risk form (Local has no permission area): its table of hazards with a protective measure each.
  try {
    return Boolean(details?.document && formLeafBlocks(details.document).some((block) => block.type === "table" && ["fara", "atgard"].every((key) => block.columns.some((column) => column.key === key))));
  } catch { return false; }
}

/** Created since the step exists (`data.riskStep`, set by the persistence boundary on creation) and not a risk assessment. */
export function riskStepRequired(task: TaskLike): boolean {
  const flag = task.data && typeof task.data === "object" ? (task.data as { riskStep?: unknown }).riskStep : undefined;
  return flag === true && !isRiskAssessmentTask(task);
}

/**
 * Whether the gates (Starta tid, Färdigställ) ask about the risk step: a work order with the step, and every task in a work
 * order except a risk assessment – the task follows its work order's step (Arbetsordern styr, 2026-10-26). An older task
 * outside a work order (a Local file before the upgrade) keeps its own flag.
 */
export function riskStepApplies(task: TaskLike & { workOrderId?: string | null }): boolean {
  if (task.kind === "WORK_ORDER") return riskStepRequired(task);
  if (isRiskAssessmentTask(task)) return false;
  return Boolean(task.workOrderId) || riskStepRequired(task);
}

/** Whether the persistence boundary stamps the step on a new task: only a work order gets it (2026-10-26). */
export const riskStepExempt = (task: TaskLike) => task.kind !== "WORK_ORDER" || isRiskAssessmentTask(task);

export type LinkedTaskState = { id: string; title: string; status: string; kind?: string };
/** What the rule needs besides the task itself, read by each place from its own store. */
export type RiskStepContext = {
  /** The linked extended risk assessment as read now; null when there is none or it was not found. */
  extended: LinkedTaskState | null;
  /** The work order the task belongs to (Fas 2, `workOrderId`) and whether its own risk step is done. */
  workOrder: (LinkedTaskState & { done: boolean; /** Done through the exception: the assessment was not made. */ exception?: boolean }) | null;
};
export const emptyRiskStepContext = (): RiskStepContext => ({ extended: null, workOrder: null });

export type RiskStepState = {
  /** The task has the step at all. */
  applies: boolean;
  done: boolean;
  via: "not-required" | "completed" | "work-order" | "simplified" | "extended" | "exception" | null;
  /** The step is done through the exception, here or on the work order the task follows: no assessment was made. */
  exception?: boolean;
  extendedRequired: boolean;
  /** Why extended is required: an answer that shows risk, or the person's own choice. */
  extendedReason: "answers" | "chosen" | null;
  /** Questions answered Nej or Osäker. */
  riskAnswers: RiskQuestionId[];
  unanswered: RiskQuestionId[];
  /** What to do next, in one sentence (empty when done). */
  hint: string;
};

const NOT_REQUIRED: RiskStepState = { applies: false, done: true, via: "not-required", extendedRequired: false, extendedReason: null, riskAnswers: [], unanswered: [], hint: "" };

/** The rule: whether the task's risk step is done, and what is left. */
export function riskStepState(task: TaskLike & { status: string }, context: RiskStepContext): RiskStepState {
  // A task in a work order follows the work order's step: done when it is, otherwise "do it on the work order".
  if (task.kind !== "WORK_ORDER" && context.workOrder && !isRiskAssessmentTask(task)) {
    const base = { applies: true as const, extendedRequired: false, extendedReason: null, riskAnswers: [] as RiskQuestionId[], unanswered: [] as RiskQuestionId[] };
    if (task.status === "COMPLETED") return { ...base, done: true, via: "completed", hint: "" };
    if (context.workOrder.done) return { ...base, done: true, via: "work-order", hint: "", ...(context.workOrder.exception ? { exception: true } : {}) };
    return { ...base, done: false, via: null, hint: `Gör riskbedömningen på arbetsordern ”${context.workOrder.title || "Arbetsorder"}”.` };
  }
  if (!riskStepRequired(task)) return NOT_REQUIRED;
  const check = riskCheckOf(task.data);
  // The exception decides on its own: answers that show a risk or a chosen extended assessment no longer ask for anything. It comes
  // before "completed", so a finished work order still says that no assessment was made.
  if (check?.exception) return { applies: true, done: true, via: "exception", exception: true, extendedRequired: false, extendedReason: null, riskAnswers: [], unanswered: [], hint: "" };
  const riskAnswers = RISK_QUESTIONS.filter((question) => { const value = check?.answers[question.id]; return value === "no" || value === "unsure"; }).map((question) => question.id);
  const unanswered = RISK_QUESTIONS.filter((question) => !check?.answers[question.id]).map((question) => question.id);
  const extendedReason = riskAnswers.length ? "answers" : check?.level === "extended" ? "chosen" : null;
  const extendedRequired = extendedReason !== null;
  const base = { applies: true, extendedRequired, extendedReason, riskAnswers, unanswered } as const;
  // A completed task is never locked again; it shows what was done.
  if (task.status === "COMPLETED") return { ...base, done: true, via: "completed", hint: "" };
  const linked = check?.extendedTaskId && context.extended?.id === check.extendedTaskId ? context.extended : null;
  if (linked && linked.status === "COMPLETED") return { ...base, done: true, via: "extended", hint: "" };
  if (!extendedRequired && !unanswered.length && check?.confirmedAt) return { ...base, done: true, via: "simplified", hint: "" };
  // A task that belongs to a work order inherits the work order's completed risk step.
  if (context.workOrder?.done) return { ...base, done: true, via: "work-order", hint: "" };
  const hint = linked ? `Gör klart och färdigställ riskbedömningen ”${linked.title || "Riskbedömning"}”.`
    : check?.extendedTaskId ? "Den kopplade riskbedömningen hittades inte. Skapa en ny utökad riskbedömning."
    : riskAnswers.length ? "Ett svar visar en risk, så en utökad riskbedömning krävs. Skapa den med Gör utökad riskbedömning."
    : extendedRequired ? "Skapa den utökade riskbedömningen med Gör utökad riskbedömning."
    : unanswered.length ? "Svara på frågorna i riskbedömningen och bekräfta."
    : "Bekräfta riskbedömningen.";
  return { ...base, done: false, via: null, hint: context.workOrder ? `${hint} Eller gör den på arbetsordern ”${context.workOrder.title || "Arbetsorder"}”.` : hint };
}

/**
 * The step as the task page shows it. An unsaved task gets the flag when it is saved, so it is shown from the start; one
 * opened in a work order (Starta ronden, Ny uppgift, Koppla till arbetsorder) needs its order in `context.workOrder` – read
 * by the page with the order's id – so it follows the work order's step like a saved task does, not a step of its own
 * (2026-10-29: the new round protocol asked its own questions and Starta tid did nothing).
 */
export function pageRiskStepState(task: TaskLike & { id?: string | null; status: string }, context: RiskStepContext): RiskStepState {
  const data = task.id ? task.data : { ...(task.data && typeof task.data === "object" ? task.data : {}), riskStep: true };
  return riskStepState({ ...task, data }, context);
}

/** The refusal for starting the time or completing while the step is not done, or null. */
export function riskStepRefusal(state: RiskStepState, action: "start" | "complete"): string | null {
  if (!state.applies || state.done) return null;
  return `${action === "start" ? "Gör riskbedömningen innan du startar tiden." : "Gör riskbedömningen innan du färdigställer uppgiften."} ${state.hint}`.trim();
}

const sameAnswers = (a: RiskCheck | null, b: RiskCheck | null) => Boolean(a && b && a.level === b.level && RISK_QUESTIONS.every((question) => a.answers[question.id] === b.answers[question.id]));

/**
 * The persistence boundary (Cloud's route, Local's store, the demo): a new task gets `riskStep` (unless it is a risk
 * assessment), a saved one keeps what it was created with whatever the client sends, and the confirmation's person and time
 * are set here – kept while the answers are unchanged, set anew when they change. The exception's person and time likewise: kept
 * while its reason is unchanged, set here when it is new. Whether it is allowed at all is riskExceptionRefusal, asked by the boundary first.
 */
export function stampRiskStep<T extends object>(data: T, input: { created: boolean; stored: unknown; exempt: boolean; actor: { id: string; name: string }; now: string }): T {
  const { riskStep: _flag, ...rest } = data as T & { riskStep?: unknown };
  void _flag;
  const storedFlag = input.stored && typeof input.stored === "object" && (input.stored as { riskStep?: unknown }).riskStep === true;
  const flagged = (input.created ? !input.exempt : storedFlag) ? { ...rest, riskStep: true } : rest;
  const next = riskCheckOf(data);
  const before = riskCheckOf(input.stored);
  // A save that does not carry the check at all (an API/MCP update, an older client) keeps the stored one; only an
  // explicit riskCheck: null clears it, so a confirmed step is never lost by accident.
  if (!next) return withRiskCheck(flagged as T, !("riskCheck" in (data as object)) && before ? before : null);
  const { confirmedById: _id, exception: sentException, ...withoutStamps } = next;
  void _id;
  const exception = !sentException ? undefined
    : before?.exception && before.exception.reason === sentException.reason ? before.exception
    : { reason: sentException.reason, by: input.actor.name.slice(0, 160), byId: input.actor.id.slice(0, 100), at: input.now };
  const unconfirmed = exception ? { ...withoutStamps, exception } : withoutStamps;
  if (!next.confirmedAt) return withRiskCheck(flagged as T, { ...unconfirmed, confirmedBy: "", confirmedAt: null });
  if (before?.confirmedAt && sameAnswers(before, next)) return withRiskCheck(flagged as T, { ...unconfirmed, confirmedBy: before.confirmedBy, confirmedAt: before.confirmedAt, ...(before.confirmedById ? { confirmedById: before.confirmedById } : {}) });
  return withRiskCheck(flagged as T, { ...unconfirmed, confirmedBy: input.actor.name.slice(0, 160), confirmedById: input.actor.id.slice(0, 100), confirmedAt: input.now });
}

/** The facts the report shows: the level, each answer, who confirmed and when, or the exception. Empty when the task has no risk check. */
export function riskStepReportFacts(data: unknown): { level: string; rows: { label: string; value: string; risk: boolean }[]; confirmedBy: string; confirmedAt: string | null; extended: boolean; exception: { reason: string; by: string; at: string | null } | null } | null {
  const check = riskCheckOf(data);
  if (!check) return null;
  const extended = check.level === "extended" || Boolean(check.extendedTaskId);
  const rows = RISK_QUESTIONS.flatMap((question) => {
    const value = check.answers[question.id];
    return value ? [{ label: question.short, value: RISK_ANSWER_LABELS[value], risk: value !== "yes" }] : [];
  });
  const exception = check.exception ? { reason: check.exception.reason, by: check.exception.by, at: check.exception.at } : null;
  return { level: extended ? "Utökad" : "Förenklad", rows, confirmedBy: check.confirmedBy, confirmedAt: check.confirmedAt, extended, exception };
}
