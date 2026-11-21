import { z } from "zod";
import { addDays, isDayKey } from "@/lib/workflow/schedule";

/**
 * Återkommande underhåll (2026-10-30): the rules of a maintenance plan without a database – shared by the server
 * (./plan-server.ts), the job (scripts/maintenance/run-plans.ts), the pages and the unit tests.
 *
 * - One work order per occurrence ("byt lager i pumpen varje halvår"). Calendar time (days, weeks, months) keeps the coming
 *   occurrences as vilande (dormant) work orders, a year ahead or the next 12, whichever comes first. They show in the planning
 *   on their day but are not active: no time and no start until the day has come or a person activates the order.
 * - The interval counts from when the work was actually done: done a day late, the next occurrence moves a day. While an
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

// ---------- input ----------

const dayKey = z.string().trim().refine(isDayKey, "Ange ett datum (ÅÅÅÅ-MM-DD).");
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
export type PlanRule = { unit: PlanUnit; every: number; startDate: string; isActive: boolean };
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
    cursor = addInterval(laterOf(day, today), rule.unit, rule.every);
  }
  while (count < PLAN_MAX_AHEAD && cursor <= horizon) {
    result.create.push(cursor);
    count += 1;
    cursor = addInterval(cursor, rule.unit, rule.every);
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

export type PlanOccurrenceState = "dormant" | "due" | "late" | "started" | "done" | "cancelled";
export const PLAN_STATE_LABELS: Record<PlanOccurrenceState, string> = { dormant: "Vilande", due: "Dags", late: "Förfallen", started: "Pågår", done: "Klar", cancelled: "Utgått" };
export const PLAN_STATE_TONES: Record<PlanOccurrenceState, "neutral" | "info" | "warning" | "danger" | "success"> = { dormant: "neutral", due: "info", late: "danger", started: "warning", done: "success", cancelled: "neutral" };

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
  return occurrence.state === "dormant" || occurrence.state === "due" || occurrence.state === "late";
}

/** "Byt lager · Hydraulpump" – the work order's title for an occurrence. */
export const planOrderTitle = (planName: string, partName: string) => `${planName} · ${partName}`.slice(0, 200);
