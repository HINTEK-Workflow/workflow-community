import { bookingPeriodLabel, taskBookingLine, upcomingTaskBookings } from "./bookings";
import { storedJobFlow, type StoredJob } from "./job-flow";
import { nextStepLine } from "./next-step";
import { RISK_QUESTIONS, riskCheckOf, riskStepRefusal, type RiskQuestionId, type RiskStepState } from "./risk-step";
import { isTaskCancelled } from "./task-cancel";
import { isLateTask } from "./late-tasks";
import { workflowTaskCompletion } from "./task-model";
import { effectiveStartDate } from "./job-planning";
import { jobObstacle } from "./obstacles";

/**
 * Jobbets läge (Workflow AI-planen 2026-10-11, steg 3; built 2026-10-09): what a job's page says about where it stands –
 * the risk step, what stops Starta tid and Färdigställ and why, the next step, the bookings, Utgår and the schedule – as
 * one small object for get_task (the chat, API v1 and MCP alike). No rules of its own: the risk step (risk-step.ts), the
 * progress line and the completion requirements (job-flow.ts, task-model.ts), the next-step line (next-step.ts), the
 * bookings (bookings.ts) and Utgår (task-cancel.ts) are the same functions the page and the routes use, and the level
 * messages come from the level rule itself (checkLevel). Pure, so it is tested without a database.
 */

export const JOB_STATUS_LABELS: Record<string, string> = { PLANNED: "Planerad", IN_PROGRESS: "Pågår", PAUSED: "Pausad", NEEDS_ACTION: "Behöver åtgärdas", COMPLETED: "Färdigställd", CANCELLED: "Utgått" };
/** How many completion requirements and bookings are listed (the rest is counted). */
const LIST_MAX = 8;
const BOOKINGS_MAX = 5;

type BookingInput = { workflowTaskId?: string | null; status: string; startsAt: string | Date; endsAt: string | Date; deletedAt?: string | Date | null; assignedToName?: string; assignedToUserId?: string | null; assignedToUserIds?: string[]; assignments?: { userId: string }[] };

export type JobStateInput = {
  task: StoredJob & {
    kind: string; plannedStartDate?: string; estimatedMinutes?: number | null; stage?: string; createdAt?: string | Date; updatedAt?: string | Date;
    cancelledAt?: string | Date | null; cancelReason?: string;
  };
  /** The task's own risk step (riskStepState with the context the server read). */
  risk: RiskStepState;
  /**
   * Hör till arbetsorder: the time runs on the work order (the timer route's loadTimeOwner), so Starta tid asks the work
   * order's status and risk step. `refusal` is riskStepRefusal(work order's state, "start") when it could be read.
   */
  timeOwner?: { title: string; status: string; riskDone: boolean; refusal?: string | null } | null;
  /** The level rule's messages for the reader (checkLevel), or null when allowed; left out when it was not read. */
  level?: { work: string | null; start: string | null; complete: string | null } | null;
  /** The reader may edit this kind of job (the timer and Färdigställ need it). */
  mayEdit?: boolean;
  /** The job's project is archived or closed: nothing in it is saved, so it cannot be completed. */
  projectFrozen?: "archived" | "closed" | null;
  /** The job's bookings as the planning route returned them; null when they could not be read. */
  bookings?: BookingInput[] | null;
  now?: Date;
  /** Today in Swedish time (YYYY-MM-DD), for "late". */
  today?: string;
};

const shortOf = (ids: RiskQuestionId[]) => ids.map((id) => RISK_QUESTIONS.find((question) => question.id === id)?.short ?? id);

function riskView(task: JobStateInput["task"], state: RiskStepState) {
  if (!state.applies) return { applies: false as const, text: "Jobbet har inget riskbedömningssteg (en riskbedömning, eller skapat innan steget fanns)." };
  const check = riskCheckOf(task.data);
  const level = state.exception ? "Ej gjord" : state.extendedRequired || check?.level === "extended" || check?.extendedTaskId ? "Utökad" : "Förenklad";
  const text = !state.done ? `Inte klar. ${state.hint}`.trim()
    : state.via === "exception" ? `Ej gjord: arbetet redan utfört${check?.exception?.reason ? `. Skäl: ${check.exception.reason}` : ""}`
    : state.via === "work-order" && state.exception ? "Ej gjord på arbetsordern: arbetet redan utfört."
    : state.via === "work-order" ? "Klar via arbetsorderns riskbedömning."
      : state.via === "extended" ? "Klar: den utökade riskbedömningen är färdigställd."
        : state.via === "completed" ? "Jobbet är färdigställt."
          : `Klar: förenklad, bekräftad${check?.confirmedBy ? ` av ${check.confirmedBy}` : ""}.`;
  return {
    applies: true as const, done: state.done, level, text,
    ...(state.extendedRequired ? { extendedRequired: true, extendedReason: state.extendedReason === "answers" ? "Ett svar är Nej eller Osäker." : "Personen valde utökad." } : {}),
    ...(state.riskAnswers.length ? { answersShowingRisk: shortOf(state.riskAnswers) } : {}),
    ...(!state.done && state.unanswered.length && !state.extendedRequired ? { unanswered: shortOf(state.unanswered) } : {}),
  };
}

export function jobState(input: JobStateInput) {
  const { task, risk } = input;
  const now = input.now ?? new Date();
  const cancelled = isTaskCancelled(task.status);
  const completed = task.status === "COMPLETED";
  const workOrder = input.timeOwner ?? null;

  // The progress line, the completion requirements and the next step, exactly as the job's page builds them.
  let flow: ReturnType<typeof storedJobFlow> | null = null;
  let issues: { field: string; message: string }[] = [];
  try {
    flow = storedJobFlow(task, risk.applies ? { met: risk.done, hint: risk.hint } : undefined);
    issues = workflowTaskCompletion({ title: task.title, status: task.status, data: task.data } as Parameters<typeof workflowTaskCompletion>[0]).issues;
  } catch { flow = null; }
  const completeRisk = risk.applies ? riskStepRefusal(risk, "complete") : null;
  const next = !cancelled && flow ? nextStepLine({ flow, issues, riskRefusal: completeRisk, blocked: input.projectFrozen ? null : input.level?.work ?? null }) : null;

  // Färdigställ: what the route refuses, in the order the page tells it (a block on the work, the requirements, the risk step).
  const completeBlockers: string[] = cancelled ? ["Jobbet har utgått. Återuppta det först."]
    : completed ? ["Jobbet är redan färdigställt."]
      : [
        ...(input.projectFrozen === "archived" ? ["Projektet är arkiverat. Återställ projektet först."] : input.projectFrozen === "closed" ? ["Projektet är avslutat. Återöppna projektet först."] : []),
        ...(input.mayEdit === false ? ["Du har inte behörighet att ändra den här sortens jobb."] : []),
        ...(input.level?.complete ? [input.level.complete] : []),
        ...issues.slice(0, LIST_MAX).map((issue) => issue.message),
        ...(issues.length > LIST_MAX ? [`… och ${issues.length - LIST_MAX} krav till.`] : []),
        ...(completeRisk ? [completeRisk] : []),
      ];

  // Starta tid: the timer route's own order – permission, the owner's Utgår/Färdigställd, the level, the owner's risk step.
  const ownerStatus = workOrder?.status ?? task.status;
  const startRisk = workOrder ? (workOrder.riskDone ? null : workOrder.refusal || `Gör riskbedömningen innan du startar tiden. Tiden räknas på arbetsordern ”${workOrder.title || "Arbetsorder"}”, och dess riskbedömning är inte klar.`)
    : risk.applies ? riskStepRefusal(risk, "start") : null;
  const startBlockers: string[] = [
    ...(input.mayEdit === false ? ["Du har inte behörighet att ändra den här sortens jobb."] : []),
    ...(isTaskCancelled(ownerStatus) ? [workOrder ? `Tiden räknas på arbetsordern ”${workOrder.title}”, som har utgått.` : "Jobbet har utgått. Återuppta det för att skriva tid."] : []),
    ...(ownerStatus === "COMPLETED" ? [workOrder ? `Tiden räknas på arbetsordern ”${workOrder.title}”, som är färdigställd. Återöppna den för att skriva tid.` : "En färdigställd uppgift kan inte tidrapporteras."] : []),
    ...(input.level?.start ? [input.level.start] : []),
    ...(startRisk ? [startRisk] : []),
  ];

  // The job's coming bookings, nearest first (the "Bokad:" line on the job's page).
  const ownBookings = input.bookings ? upcomingTaskBookings(input.bookings, task.id, now) : null;

  const late = !cancelled && !completed && Boolean(input.today) && isLateTask({ status: String(task.status), dueDate: task.dueDate ? String(task.dueDate) : "" }, String(input.today));
  return {
    status: JOB_STATUS_LABELS[task.status] ?? task.status,
    ...(cancelled ? { cancelled: { at: task.cancelledAt ? new Date(task.cancelledAt).toISOString() : null, reason: task.cancelReason ?? "", text: "Jobbet har utgått: det görs inte, räknas inte som öppet eller förfallet och kan återupptas (Återuppta)." } } : {}),
    riskStep: riskView(task, risk),
    canStartTime: startBlockers.length === 0,
    ...(startBlockers.length ? { startTimeBlockedBy: startBlockers } : {}),
    canComplete: completeBlockers.length === 0,
    ...(completeBlockers.length ? { completeBlockedBy: completeBlockers } : {}),
    ...(next ? { nextStep: { step: next.step, text: next.text } } : {}),
    time: {
      runsOn: workOrder ? `arbetsordern ”${workOrder.title || "Arbetsorder"}”` : "jobbet självt",
      timerRunning: Boolean(task.timerRunning), totalMinutes: Math.round((task.totalDurationSec ?? 0) / 60),
    },
    schedule: {
      plannedStartDate: task.plannedStartDate || null, dueDate: task.dueDate || null,
      // Start på alla jobb (plan 1M): the day the job counts from – its Start, or for an older job the day it was created.
      startDate: task.plannedStartDate || (task.createdAt ? effectiveStartDate({ plannedStartDate: "", createdAt: task.createdAt }) : null),
      estimatedMinutes: typeof task.estimatedMinutes === "number" ? task.estimatedMinutes : null, late,
      stage: task.stage || null,
    },
    // Rapportera hinder (plan 1M): what the job waits for, or null.
    obstacle: jobObstacle({ status: task.status, data: task.data, updatedAt: task.updatedAt }),
    ...(ownBookings ? { bookings: {
      line: taskBookingLine(ownBookings),
      upcoming: ownBookings.slice(0, BOOKINGS_MAX).map((booking) => ({ period: bookingPeriodLabel(booking.startsAt, booking.endsAt), status: booking.status === "IN_PROGRESS" ? "Pågår" : "Planerad", assignedToName: booking.assignedToName ?? "" })),
      ...(ownBookings.length > BOOKINGS_MAX ? { more: ownBookings.length - BOOKINGS_MAX } : {}),
    } } : {}),
  };
}
export type JobState = ReturnType<typeof jobState>;

/** get_task's answer with the job's state right after the task's own fields, before the long details (a cut answer keeps it). */
export function withJobState(view: Record<string, unknown>, state: JobState | null): Record<string, unknown> {
  if (!state) return view;
  const entries = Object.entries(view);
  const at = entries.findIndex(([key]) => key === "project");
  return Object.fromEntries(at < 0 ? [...entries, ["job", state]] : [...entries.slice(0, at), ["job", state], ...entries.slice(at)]);
}
