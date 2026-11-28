import { z } from "zod";
import { addDays, daysBetween, isDayKey } from "@/lib/workflow/schedule";

/**
 * Återkommande underhåll (2026-10-30): the rules of a maintenance plan without a database – shared by the server
 * (./plan-server.ts), the job (scripts/maintenance/run-plans.ts), the pages and the unit tests.
 *
 * - One work order per occurrence ("byt lager i pumpen varje halvår"). Calendar time (days, weeks, months) keeps the coming
 *   occurrences as vilande (dormant) work orders, a year ahead or the next 12, whichever comes first. They show in the planning
 *   on their day but are not active: no time and no start until the day has come or a person activates the order.
 * - Since 2026-11-28 a calendar plan chooses (INTERVAL_MODES): Fast schema keeps the plan's own days, or – as every plan did
 *   before – the interval counts from when the work was actually done: done a day late, the next occurrence moves a day. While an
 *   occurrence is open past its day, the coming ones count from today (so they move each day until it is done). An occurrence
 *   set to Utgår counts from its own day (it was skipped, not done).
 * - A day a person moved (postponed in the plan, or Start changed on the vilande work order) is kept; the ones after it follow.
 * - Drifttimmar (RUN_HOURS): no vilande work orders ahead (chosen as the simple way, decision 2026-10-30): one work order is
 *   made when the part's drifttimmar reach "nästa vid", and the next "nästa vid" counts from the hours when it was done.
 */

export const PLAN_UNITS = ["DAY", "WEEK", "MONTH", "RUN_HOURS"] as const;
export type PlanUnit = (typeof PLAN_UNITS)[number];
export type CalendarUnit = Exclude<PlanUnit, "RUN_HOURS">;
/** How far ahead vilande work orders are kept: a year, at most 12 of them (2026-10-30). */
export const PLAN_HORIZON_DAYS = 365;
export const PLAN_MAX_AHEAD = 12;
export const PLAN_LIMIT_PER_PART = 50;
const MAX_EVERY: Record<PlanUnit, number> = { DAY: 3650, WEEK: 520, MONTH: 120, RUN_HOURS: 1_000_000 };

export const PLAN_UNIT_LABELS: Record<PlanUnit, string> = { DAY: "Dagar", WEEK: "Veckor", MONTH: "Månader", RUN_HOURS: "Drifttimmar" };
const SINGULAR: Record<PlanUnit, string> = { DAY: "dag", WEEK: "vecka", MONTH: "månad", RUN_HOURS: "drifttimme" };

/** Swedish ordinal ending: 1:a, 2:a, 3:e … 11:e, 12:e, 21:a, 22:a. */
const ordinal = (value: number) => { const last = value % 10, lastTwo = value % 100; return `${value}:${(last === 1 || last === 2) && lastTwo !== 11 && lastTwo !== 12 ? "a" : "e"}`; };
/** "Varje månad", "Var 6:e månad", "Var 500:e drifttimme". */
export const intervalText = (unit: PlanUnit, every: number) => every === 1 ? `Varje ${SINGULAR[unit]}` : `Var ${ordinal(every)} ${SINGULAR[unit]}`;

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
/** A day moved by whole months; the 31st becomes the last day of a shorter month. */
export function addMonths(day: string, months: number): string {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const index = year * 12 + (month - 1) + months;
  const nextYear = Math.floor(index / 12), nextMonth = (index % 12) + 1;
  const nextDate = Math.min(date, daysInMonth(nextYear, nextMonth));
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-${String(nextDate).padStart(2, "0")}`;
}

/** The day one interval after `day`. */
export function addInterval(day: string, unit: CalendarUnit, every: number): string {
  if (unit === "MONTH") return addMonths(day, every);
  return addDays(day, unit === "WEEK" ? every * 7 : every);
}

const laterOf = (a: string, b: string) => a > b ? a : b;

// ---------- the interval: fast schema or from the latest done (2026-11-27) ----------

/**
 * How a calendar plan counts its next day (2026-11-27, the round's follow-up): FIXED keeps the plan's own days – the
 * start and every interval after it, whenever the work was done ("Fast schema", chosen per plan); FROM_DONE counts each next
 * day from the day the previous one was actually done ("Räkna från senaste utförda", the default: it is how every plan
 * counted before 2026-11-28, so existing plans keep their behaviour).
 * Drifttimmar always count from the hours when it was done. A rule without a mode counts from the latest done (the pure
 * functions' behaviour before 2026-11-28, kept so callers that pass none are unchanged); the server always passes the plan's.
 */
export const INTERVAL_MODES = ["FIXED", "FROM_DONE"] as const;
export type IntervalMode = (typeof INTERVAL_MODES)[number];
export const INTERVAL_MODE_LABELS: Record<IntervalMode, string> = { FIXED: "Fast schema", FROM_DONE: "Räkna från senaste utförda" };
export const INTERVAL_MODE_HINTS: Record<IntervalMode, string> = {
  FIXED: "Dagarna ligger fast från startdatumet, även om arbetet görs tidigare eller senare.",
  FROM_DONE: "Nästa dag räknas från dagen då arbetet senast gjordes.",
};
export const intervalModeOf = (value: unknown): IntervalMode => value === "FIXED" ? "FIXED" : "FROM_DONE";

const monthIndex = (day: string) => { const [year, month] = day.split("-").map(Number) as [number, number]; return year * 12 + (month - 1); };

/** The first of the plan's own days (the start and every interval after it) that is after `day` – or on it, with `onOrAfter`. */
export function scheduleDayAfter(rule: Pick<PlanRule, "startDate" | "every"> & { unit: CalendarUnit }, day: string, onOrAfter = false): string {
  const passes = (candidate: string) => onOrAfter ? candidate >= day : candidate > day;
  if (passes(rule.startDate)) return rule.startDate;
  if (rule.unit === "MONTH") {
    // Counted from the start each time, so the 31st stays the last day of a short month and comes back after it.
    let k = Math.max(0, Math.floor((monthIndex(day) - monthIndex(rule.startDate)) / rule.every));
    let candidate = addMonths(rule.startDate, k * rule.every);
    while (!passes(candidate)) { k += 1; candidate = addMonths(rule.startDate, k * rule.every); }
    return candidate;
  }
  const step = rule.unit === "WEEK" ? rule.every * 7 : rule.every;
  let k = Math.max(0, Math.floor(daysBetween(rule.startDate, day) / step));
  let candidate = addDays(rule.startDate, k * step);
  while (!passes(candidate)) { k += 1; candidate = addDays(rule.startDate, k * step); }
  return candidate;
}

/** The day after `day` in the plan's sequence: its own next day (Fast schema) or one interval later (from the latest done). */
const followingDay = (rule: PlanRule & { unit: CalendarUnit }, day: string) =>
  rule.mode === "FIXED" ? scheduleDayAfter(rule, day) : addInterval(day, rule.unit, rule.every);

// ---------- input ----------

const dayKey = z.string().trim().refine(isDayKey, "Ange ett datum (ÅÅÅÅ-MM-DD).");
/** Vad som ska göras (2026-11-27): a short checklist per plan, at most 30 rows of 200 characters; empty rows are left out. */
export const PLAN_CHECKLIST_MAX = 30;
export const PLAN_CHECKLIST_TEXT_MAX = 200;
const checklistSchema = z.array(z.string().trim().max(PLAN_CHECKLIST_TEXT_MAX, `En punkt i checklistan får vara högst ${PLAN_CHECKLIST_TEXT_MAX} tecken.`))
  .transform((rows) => rows.filter(Boolean))
  .refine((rows) => rows.length <= PLAN_CHECKLIST_MAX, `Checklistan kan ha högst ${PLAN_CHECKLIST_MAX} punkter.`);
export const planInputSchema = z.object({
  partId: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1, "Skriv vad som ska göras.").max(120),
  description: z.string().trim().max(2000).default(""),
  unit: z.enum(PLAN_UNITS),
  every: z.number().int("Intervallet ska vara ett heltal.").min(1, "Intervallet ska vara minst 1."),
  startDate: dayKey,
  /** RUN_HOURS: "Första vid" – the drifttimmar of the first work order; empty = the part's hours now plus the interval. */
  firstRunHours: z.number().min(0).max(10_000_000).nullable().default(null),
  assignedToUserId: z.string().trim().min(1).max(100).nullable().default(null),
  estimatedMinutes: z.number().int().min(0).max(100_000).nullable().default(null),
  isActive: z.boolean().default(true),
  checklist: checklistSchema.default([]),
  /** Gör i driftronden (2026-11-27): the round whose work order holds the occurrences; null = a work order per occurrence. */
  roundScheduleId: z.string().trim().min(1).max(100).nullable().default(null),
  /** Fast schema or Räkna från senaste utförda (2026-11-27); left out = Räkna från senaste utförda. Only calendar time reads it. */
  intervalMode: z.enum(INTERVAL_MODES).default("FROM_DONE"),
}).superRefine((input, context) => {
  if (input.every > MAX_EVERY[input.unit]) context.addIssue({ code: "custom", path: ["every"], message: `Intervallet kan vara högst ${MAX_EVERY[input.unit]} ${PLAN_UNIT_LABELS[input.unit].toLowerCase()}.` });
});
export type PlanInput = z.output<typeof planInputSchema>;

// ---------- vilande ----------

export type OrderDormancy = { maintenancePlanId: string | null; maintenanceDue: string | null; maintenanceActivatedAt: Date | string | null; status: string };

/**
 * Vilande: a plan's work order that is Planerad, not activated by a person, and whose day is after today. It shows in the
 * planning and on the part's plans; it cannot be started (no time, no Pågår, no Färdigställ) until its day has come or a
 * person presses Aktivera. Nothing is stored for the change on the day – the rule is read every time.
 */
export const isDormant = (order: OrderDormancy, today: string) =>
  Boolean(order.maintenancePlanId && order.maintenanceDue) && !order.maintenanceActivatedAt && order.status === "PLANNED" && (order.maintenanceDue ?? "") > today;

/** What a refused start says. */
export const dormantProblem = (due: string) => `Arbetsordern vilar till ${due}. Aktivera den först, eller vänta till dagen.`;

// ---------- the calendar plan's occurrences ----------

export type PlanOrder = {
  id: string; status: string; due: string; activated: boolean; pinned: boolean;
  /** The work order's Start: a vilande order whose Start a person changed is taken as postponed to that day. */
  plannedStartDate: string;
  /** The Swedish day it was completed, for a completed one. */
  completedDay: string | null;
  /** Something hangs on it (time, tasks, bookings, withdrawals, purchases, files): it is never removed by the plan. */
  touched: boolean;
};
export type PlanRule = { unit: PlanUnit; every: number; startDate: string; isActive: boolean; /** Left out: from the latest done (see INTERVAL_MODES). */ mode?: IntervalMode };
export type FillResult = {
  /** Vilande work orders that get another day (and whether it is a day a person chose). */
  update: { id: string; due: string; pinned: boolean }[];
  /** New vilande work orders, by day. */
  create: string[];
  /** Vilande work orders no longer wanted (outside the window, or the plan is paused); only untouched ones. */
  remove: string[];
  /** The next day the plan counts from (for the page). */
  next: string | null;
};

/** A plan's occurrence that is not vilande: open (activated or its day has come) or closed. */
const isLive = (order: PlanOrder, today: string) => !(order.status === "PLANNED" && !order.activated && order.due > today);

/**
 * The day the plan's next occurrence counts from: from the latest occurrence that is not vilande – its completion day when
 * done, its own day when Utgår, and its day or today (the later) while it is still open – plus one interval. Without any,
 * the plan's start. Never before today.
 */
export function nextPlanDay(rule: PlanRule, orders: readonly PlanOrder[], today: string): string {
  if (rule.unit === "RUN_HOURS") return today;
  const live = orders.filter((order) => isLive(order, today)).sort((a, b) => a.due.localeCompare(b.due) || (a.completedDay ?? "").localeCompare(b.completedDay ?? ""));
  const last = live.at(-1);
  if (rule.mode === "FIXED") {
    // Fast schema: the plan's own day after the latest occurrence's day, however late or early it was done; never before
    // today, and then the plan's first own day from today (a day that was missed is not made afterwards).
    const calendar = { ...rule, unit: rule.unit };
    const next = last ? scheduleDayAfter(calendar, last.due) : rule.startDate;
    return next >= today ? next : scheduleDayAfter(calendar, today, true);
  }
  let next = rule.startDate;
  if (last) {
    const from = last.status === "COMPLETED" ? last.completedDay ?? last.due : last.status === "CANCELLED" ? last.due : laterOf(last.due, today);
    next = addInterval(from, rule.unit, rule.every);
  }
  return laterOf(next, today);
}

/**
 * Fyll på (2026-10-30): which vilande work orders a calendar plan should have now. The existing vilande ones are kept
 * in their order and get the days of the sequence (a day a person chose stays, and the following ones count from it); new
 * ones are added until a year ahead or 12 vilande; the ones outside are removed when nothing hangs on them. A paused plan
 * keeps no vilande work orders (the touched ones stay as they are). Pure: the server carries it out in one transaction.
 */
export function planFill(rule: PlanRule, orders: readonly PlanOrder[], today: string): FillResult {
  const result: FillResult = { update: [], create: [], remove: [], next: null };
  if (rule.unit === "RUN_HOURS") return result;
  const dormant = orders.filter((order) => !isLive(order, today)).sort((a, b) => a.due.localeCompare(b.due) || a.id.localeCompare(b.id));
  if (!rule.isActive) {
    result.remove = dormant.filter((order) => !order.touched).map((order) => order.id);
    return result;
  }
  const horizon = addDays(today, PLAN_HORIZON_DAYS);
  let cursor = nextPlanDay(rule, orders, today);
  result.next = cursor;
  let count = 0;
  for (const order of dormant) {
    const moved = Boolean(order.plannedStartDate) && isDayKey(order.plannedStartDate) && order.plannedStartDate !== order.due;
    const pinned = moved || order.pinned;
    const day = moved ? order.plannedStartDate : order.pinned ? order.due : cursor;
    if (count >= PLAN_MAX_AHEAD || day > horizon) {
      if (!order.touched) result.remove.push(order.id);
      continue;
    }
    if (day !== order.due || pinned !== order.pinned || order.plannedStartDate !== day) result.update.push({ id: order.id, due: day, pinned });
    count += 1;
    cursor = followingDay({ ...rule, unit: rule.unit }, laterOf(day, today));
  }
  while (count < PLAN_MAX_AHEAD && cursor <= horizon) {
    result.create.push(cursor);
    count += 1;
    cursor = followingDay({ ...rule, unit: rule.unit }, cursor);
  }
  return result;
}

// ---------- drifttimmar ----------

/**
 * Drifttimmar: one work order when the part has reached `nextAt` and none is open. While one is open `nextAt` is empty;
 * once it is closed, the next counts from the part's hours then ("räknas från när det faktiskt gjordes").
 */
export function runHoursStep(input: { every: number; nextAt: number | null; runHours: number | null; hasOpen: boolean; isActive: boolean }): { create: boolean; nextAt: number | null } {
  if (input.hasOpen) return { create: false, nextAt: null };
  if (input.nextAt === null) return { create: false, nextAt: (input.runHours ?? 0) + input.every };
  if (input.isActive && input.runHours !== null && input.runHours >= input.nextAt) return { create: true, nextAt: null };
  return { create: false, nextAt: input.nextAt };
}

/** "Första vid" when none is given: the part's hours now plus one interval. */
export const firstRunHours = (input: { every: number; runHours: number | null; chosen: number | null }) => input.chosen ?? (input.runHours ?? 0) + input.every;

// ---------- the page's words ----------

/** coming (2026-11-27): an occurrence in a round's work order whose day is ahead – it is there to see, not vilande. */
export type PlanOccurrenceState = "dormant" | "coming" | "due" | "late" | "started" | "done" | "cancelled";
export const PLAN_STATE_LABELS: Record<PlanOccurrenceState, string> = { dormant: "Vilande", coming: "Kommande", due: "Dags", late: "Förfallen", started: "Pågår", done: "Klar", cancelled: "Utgått" };
export const PLAN_STATE_TONES: Record<PlanOccurrenceState, "neutral" | "info" | "warning" | "danger" | "success"> = { dormant: "neutral", coming: "neutral", due: "info", late: "danger", started: "warning", done: "success", cancelled: "neutral" };

/** One occurrence's state from its work order. */
export function occurrenceState(order: OrderDormancy & { status: string }, today: string): PlanOccurrenceState {
  if (order.status === "COMPLETED") return "done";
  if (order.status === "CANCELLED") return "cancelled";
  if (isDormant(order, today)) return "dormant";
  if (order.status !== "PLANNED") return "started";
  return (order.maintenanceDue ?? today) < today ? "late" : "due";
}

/** A plan's work order in Planering → Kalender (on its day; vilande ones clearly marked). */
export type PlanningMaintenance = { id: string; title: string; partName: string; date: string; state: PlanOccurrenceState; assignedToUserId: string | null; assignedToName: string; projectId: string | null };

/** Planning's status filter applied to an occurrence: started is Pågår, done Slutförd, Utgått Inställd, the rest Planerad. */
export function planningMaintenanceMatchesStatus(occurrence: Pick<PlanningMaintenance, "state">, status: "all" | "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELED") {
  if (status === "all") return true;
  if (status === "IN_PROGRESS") return occurrence.state === "started";
  if (status === "COMPLETED") return occurrence.state === "done";
  if (status === "CANCELED") return occurrence.state === "cancelled";
  return occurrence.state === "dormant" || occurrence.state === "coming" || occurrence.state === "due" || occurrence.state === "late";
}

/** "Byt lager · Hydraulpump" – the work order's title for an occurrence. */
export const planOrderTitle = (planName: string, partName: string) => `${planName} · ${partName}`.slice(0, 200);

// ---------- vad som ska göras: the checklist on the occurrence (2026-11-27) ----------

export type ChecklistRow = { text: string; done: boolean; doneAt: string | null; doneByName: string };

/** The plan's texts as the rows of a new occurrence: nothing ticked. */
export const checklistRows = (texts: readonly string[]): ChecklistRow[] => texts.slice(0, PLAN_CHECKLIST_MAX).map((text) => ({ text, done: false, doneAt: null, doneByName: "" }));

/** A stored checklist (the item's JSON), read safely: anything that is not a row is left out. */
export function readChecklist(value: unknown): ChecklistRow[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, PLAN_CHECKLIST_MAX).flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    if (typeof item.text !== "string" || !item.text.trim()) return [];
    return [{ text: item.text.slice(0, PLAN_CHECKLIST_TEXT_MAX), done: item.done === true, doneAt: typeof item.doneAt === "string" ? item.doneAt : null, doneByName: typeof item.doneByName === "string" ? item.doneByName : "" }];
  });
}

/** A plan's stored checklist texts. */
export const readChecklistTexts = (value: unknown): string[] => Array.isArray(value) ? value.filter((row): row is string => typeof row === "string" && Boolean(row.trim())).slice(0, PLAN_CHECKLIST_MAX) : [];

/**
 * Bocka av: the person sends which rows are done (by position, the texts are the plan's and never change on the item). A row
 * ticked now gets who and when; a row already ticked keeps its time; an unticked row loses it. More or fewer marks than rows is
 * a stale page and is refused by the caller (null).
 */
export function tickChecklist(rows: readonly ChecklistRow[], done: readonly boolean[], by: { name: string; at: string }): ChecklistRow[] | null {
  if (done.length !== rows.length) return null;
  return rows.map((row, index) => done[index]
    ? row.done ? row : { ...row, done: true, doneAt: by.at, doneByName: by.name }
    : { ...row, done: false, doneAt: null, doneByName: "" });
}

/**
 * Klart with points left (2026-11-27): the shared confirm dialog asks "N punkter är inte avbockade. Markera som klart
 * ändå?" with Ja and Gå tillbaka. Null when every point is ticked (or there is no checklist): Klart then needs no question.
 */
export function checklistDoneQuestion(ticked: readonly boolean[]) {
  const open = ticked.filter((done) => !done).length;
  if (!open) return null;
  return { title: `${open} ${open === 1 ? "punkt är inte avbockad" : "punkter är inte avbockade"}`, message: "Markera som klart ändå?", confirmLabel: "Ja", cancelLabel: "Gå tillbaka" };
}

/** "3 av 5 punkter" – how far the checklist is, or "" without one. */
export const checklistText = (rows: readonly ChecklistRow[]) => rows.length ? `${rows.filter((row) => row.done).length} av ${rows.length} punkter` : "";

// ---------- gör i driftronden (2026-11-27) ----------

/**
 * A plan with a round (roundScheduleId) makes no work orders: each occurrence is a maintenance item in the round's work order
 * that covers its day, so the technician does the round and the maintenance in the same work order and marks the item Klar
 * there. One occurrence at a time (like drifttimmar): the next is made when the previous is closed, counted from when it was
 * actually done. It is put in the round's work order once its day is at most PLAN_ROUND_LEAD_DAYS away, so the round does not
 * carry maintenance months ahead. Nothing is closed by itself; an open occurrence follows to the round's next work order when
 * its own is closed.
 */
export const PLAN_ROUND_LEAD_DAYS = 30;

/** A round's work order for a period (roundHolderOf), as the plan reads it. */
export type RoundHolder = { id: string; from: string; to: string; status: string };
/** The plan's open occurrence in the round (an item). `touched`: withdrawals or a person changed it – never removed by the plan. */
export type RoundItem = { id: string; due: string; workOrderId: string | null; holderOpen: boolean; touched: boolean };

const CLOSED_STATUSES = new Set(["COMPLETED", "CANCELLED"]);
/** The round's open work order whose period holds the day (the periods never overlap). */
export const holderForDay = (holders: readonly RoundHolder[], day: string) =>
  holders.find((holder) => !CLOSED_STATUSES.has(holder.status) && holder.from && holder.to && holder.from <= day && day <= holder.to) ?? null;

export type RoundStep = {
  /** A new item for the day, in that work order. */
  create: { due: string; workOrderId: string } | null;
  /** The open item moves to the round's work order that holds it now (its own was closed). */
  move: { id: string; workOrderId: string } | null;
  /** Items no longer wanted (the plan is paused): only untouched ones whose day is ahead. */
  remove: string[];
  /** The day the next occurrence counts as (for the page), or null. */
  next: string | null;
  /** Why nothing was made: later (more than the lead ahead), no_holder (no work order of the round holds the day), open (one is open). */
  waiting: "later" | "no_holder" | "open" | null;
};

/**
 * One fill of a plan in a round, without a database (calendar time). `orders` are the plan's occurrences so far – its work
 * orders from before the round, and its items in the round as live occurrences – for nextPlanDay; `open` is the open item.
 * An open work order of the plan from before (not vilande) also counts as open: never two at once.
 */
export function roundPlanStep(input: { rule: PlanRule; orders: readonly PlanOrder[]; open: RoundItem | null; openOrder: boolean; holders: readonly RoundHolder[]; today: string }): RoundStep {
  const { rule, today } = input;
  const result: RoundStep = { create: null, move: null, remove: [], next: null, waiting: null };
  if (!rule.isActive) {
    if (input.open && !input.open.touched && input.open.due > today) result.remove.push(input.open.id);
    return result;
  }
  if (input.open) {
    result.next = input.open.due;
    result.waiting = "open";
    if (!input.open.holderOpen) {
      // Its work order is closed (or gone): the round's work order for the day it is done now, or for its own day ahead.
      const holder = holderForDay(input.holders, laterOf(input.open.due, today));
      if (holder && holder.id !== input.open.workOrderId) result.move = { id: input.open.id, workOrderId: holder.id };
    }
    return result;
  }
  if (input.openOrder) { result.waiting = "open"; return result; }
  const next = nextPlanDay(rule, input.orders, today);
  result.next = next;
  if (next > addDays(today, PLAN_ROUND_LEAD_DAYS)) { result.waiting = "later"; return result; }
  const holder = holderForDay(input.holders, next);
  if (!holder) { result.waiting = "no_holder"; return result; }
  result.create = { due: next, workOrderId: holder.id };
  return result;
}

/** What the plan says while it waits (the part's tab Planer). */
export function roundWaitingText(step: Pick<RoundStep, "waiting" | "next">, roundTitle: string) {
  const day = step.next ?? "";
  if (step.waiting === "no_holder") return `Ronden ${roundTitle} har ingen arbetsorder för ${day}. Skapa rondens arbetsorder för perioden, så läggs underhållet in där.`;
  if (step.waiting === "later") return `Nästa ${day} i ronden ${roundTitle}. Det läggs in i rondens arbetsorder ${PLAN_ROUND_LEAD_DAYS} dagar före.`;
  return "";
}

/** An occurrence in a round (an item) as the page names it: Klar, Utgått, Förfallen past its day, Dags on it, Kommande before. */
export function itemOccurrenceState(item: { status: string; planDue?: string | null }, today: string): PlanOccurrenceState {
  if (item.status === "DONE") return "done";
  if (item.status === "CANCELLED") return "cancelled";
  const due = item.planDue ?? today;
  return due < today ? "late" : due > today ? "coming" : "due";
}

/** An item's status as an occurrence's status (for nextPlanDay and the follow-up): Klar is done, Utgår cancelled, Öppen planned. */
export const itemOccurrenceStatus = (status: string) => status === "DONE" ? "COMPLETED" : status === "CANCELLED" ? "CANCELLED" : "PLANNED";

/** An item in the round as one of the plan's occurrences: always live (never vilande), done on the day it was marked Klar. */
export const itemPlanOrder = (item: { id: string; status: string; planDue: string; completedDay: string | null; touched?: boolean }): PlanOrder => ({
  id: item.id, status: itemOccurrenceStatus(item.status), due: item.planDue, activated: true, pinned: false, plannedStartDate: item.planDue, completedDay: item.completedDay, touched: item.touched ?? true,
});

// ---------- förfallet och i tid (2026-11-27) ----------

/** How far back "i tid" is counted. */
export const FOLLOW_UP_DAYS = 365;

export type FollowUpOccurrence = {
  /** The occurrence's day; for drifttimmar the day it was made (it has no day of its own). */
  due: string;
  /** COMPLETED | CANCELLED | anything else is open. */
  status: string;
  /** The Swedish day it was completed, for a completed one. */
  completedDay: string | null;
  /** Calendar time; drifttimmar are not counted in the share (they have no day to be in time for). */
  calendar: boolean;
  /** Vilande (its day is ahead and nobody activated it): never counted. */
  dormant?: boolean;
};

/**
 * Hur väl planen följs, only what can be counted: the calendar occurrences whose day lies within the last year up to today –
 * done on or before their day is "i tid", done after it "försenat", open past their day "förfallet", Utgått on its own line.
 * The share is i tid of all counted (an occurrence due today and still open is not counted yet). Null when nothing can be counted.
 */
export function planFollowUp(occurrences: readonly FollowUpOccurrence[], today: string) {
  const from = addDays(today, -FOLLOW_UP_DAYS);
  let onTime = 0, doneLate = 0, overdue = 0, cancelled = 0, runHours = 0;
  for (const occurrence of occurrences) {
    if (occurrence.dormant || !isDayKey(occurrence.due) || occurrence.due < from || occurrence.due > today) continue;
    if (!occurrence.calendar) { runHours += 1; continue; }
    if (occurrence.status === "COMPLETED") { if ((occurrence.completedDay ?? occurrence.due) <= occurrence.due) onTime += 1; else doneLate += 1; }
    else if (occurrence.status === "CANCELLED") cancelled += 1;
    else if (occurrence.due < today) overdue += 1;
  }
  const counted = onTime + doneLate + overdue + cancelled;
  return { onTime, doneLate, overdue, cancelled, counted, runHours, share: counted ? Math.round((onTime / counted) * 100) : null };
}
export type PlanFollowUp = ReturnType<typeof planFollowUp>;

/** "8 av 10 i tid" with what the share stands on, or what is missing. */
export function followUpText(figures: PlanFollowUp) {
  if (!figures.counted) return figures.runHours ? "Planer på drifttimmar har ingen dag att hinna till, så de räknas inte här." : "Inget underlag ännu: inget planerat underhåll har haft sin dag det senaste året.";
  return `${figures.onTime} av ${figures.counted} i tid det senaste året`;
}

/** How many days an open occurrence is past its day (0 when it is not). */
export const daysLate = (due: string, today: string) => isDayKey(due) && due < today ? daysBetween(due, today) : 0;
