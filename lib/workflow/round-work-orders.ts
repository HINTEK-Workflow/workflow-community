import { addDays, addMonths, occurrenceLate, roundFormNotice, roundHref, roundOrderForDay, scheduleOccurrences, scheduleRuleText, scheduleTempPlace, type FormSchedule, type FormScheduleRule, type RoundOrderRef } from "./form-schedule";
import { tempPlaceOf, withTempPlace, type TempPlace } from "./temp-place";
import type { RoundNotDone } from "./round-outcome";

/**
 * Driftrond i arbetsordern (2026-10-27, punkt 3; replaces 0.24.0's work order per occurrence, svar 1a 2026-10-26):
 * the work order is the holder of the round. A person creates a work order, says it is for a round, chooses the round and
 * the work order's period – start and end, one day, months or years (`plannedStartDate`–`dueDate`, with
 * `roundScheduleId` set and `roundOccurrence` empty). During the period that same work order gathers every occurrence:
 * starting the round registers a new occurrence (the protocol, carrying the schedule and the day in `values.round`) under
 * it, with its own day, person, protocol, deviations and time. Nothing is made by itself – no work order per day or per
 * start; the schedule still shows the occurrences that are due or late under the work order. One work order per round and
 * day: the periods of a round's work orders never overlap (a database trigger refuses it too).
 *
 * The work orders 0.24.0 made per occurrence (`roundOccurrence` set) are kept as they were and still read: they hold their
 * own day and are grouped under their round in the lists.
 *
 * Where the round is done is the work order's (2026-10-27 kväll: "Ronden är framför allt tidsreglerna som ställs in –
 * kund och plats hänger med från arbetsordern"): its customer, place, temporary place and project go into every protocol
 * started in it, and the lists show the round's place from it. A round planned before then may still have its own stored
 * customer and place; they are only the suggestion when its work order is made.
 *
 * Pure rules shared by Cloud, Local and the demo.
 */

/** The choices for the period when the work order is made: one day, a month or a year from the start (both days included). */
export const ROUND_PERIOD_PRESETS = [
  { id: "day", label: "En dag" },
  { id: "month", label: "En månad" },
  { id: "year", label: "Ett år" },
] as const;
export type RoundPeriodPreset = (typeof ROUND_PERIOD_PRESETS)[number]["id"];

/** The period's last day for a preset: the start itself, the day before the same day next month, or next year. */
export function roundPeriodEnd(start: string, preset: RoundPeriodPreset) {
  if (preset === "day") return start;
  return addDays(addMonths(start, preset === "month" ? 1 : 12), -1);
}

/** The longest period a round's work order may have (a work order is followed up, not left open for ever). */
export const ROUND_PERIOD_MAX_YEARS = 5;

export type RoundPeriod = { from: string; to: string };
const isDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Why the period cannot be the work order's, or null. */
export function roundPeriodError(period: { from?: string | null; to?: string | null }): string | null {
  if (!isDay(period.from) || !isDay(period.to)) return "Ange arbetsorderns startdatum och slutdatum för ronden.";
  if (period.to < period.from) return "Slutdatum kan inte vara före startdatum.";
  if (period.to > addDays(addMonths(period.from, ROUND_PERIOD_MAX_YEARS * 12), -1)) return `Perioden får vara högst ${ROUND_PERIOD_MAX_YEARS} år.`;
  return null;
}

/** The round a work order holds for a period, or null (a 0.24.0 work order for one occurrence, or no round). */
export function roundHolderOf(task: { roundScheduleId?: string | null; roundOccurrence?: string | null; plannedStartDate?: string | null; dueDate?: string | null }): (RoundPeriod & { scheduleId: string }) | null {
  if (!task.roundScheduleId || task.roundOccurrence) return null;
  return { scheduleId: task.roundScheduleId, from: task.plannedStartDate ?? "", to: task.dueDate ?? "" };
}

/** The round a work order was made for, as lists and filters read it ("Rondordrar", grouped per round): either kind. */
export function roundOfWorkOrder(task: { roundScheduleId?: string | null; roundOccurrence?: string | null }) {
  return task.roundScheduleId ? { scheduleId: task.roundScheduleId, occurrence: task.roundOccurrence ?? null } : null;
}

/** A work order as the round views read it, from its stored fields. */
export function roundOrderRef(task: { id: string; status: string; title?: string; roundScheduleId?: string | null; roundOccurrence?: string | null; plannedStartDate?: string | null; dueDate?: string | null;
  customerId?: string | null; facilityId?: string | null; projectId?: string | null; /** The work order's data, for its temporary place (Local, the demo). */ data?: unknown; /** Its temporary place when the data is not read (Cloud). */ tempPlace?: unknown }): RoundOrderRef | null {
  if (!task.roundScheduleId) return null;
  // Where the occurrences are done (2026-10-27 kväll): the work order's customer, place, temporary place and project.
  const place = { customerId: task.customerId ?? null, facilityId: task.facilityId ?? null, projectId: task.projectId ?? null, tempPlace: task.data !== undefined ? tempPlaceOf(task.data) : scheduleTempPlace(task.tempPlace) };
  return task.roundOccurrence
    ? { scheduleId: task.roundScheduleId, id: task.id, status: task.status, title: task.title, occurrence: task.roundOccurrence, ...place }
    : { scheduleId: task.roundScheduleId, id: task.id, status: task.status, title: task.title, occurrence: null, from: task.plannedStartDate ?? "", to: task.dueDate ?? "", ...place };
}

const overlaps = (a: RoundPeriod, b: RoundPeriod) => a.from <= b.to && b.from <= a.to;

/**
 * Why the round's work order cannot have this period: the round already has another work order (not cancelled) whose
 * period overlaps, so one day would have two. `others` are the round's other work orders. Returns the refusal, or null.
 */
export function roundPeriodOverlapError(period: RoundPeriod, others: readonly RoundOrderRef[]): string | null {
  const taken = others.find((order) => order.status !== "CANCELLED" && !order.occurrence && order.from && order.to && overlaps(period, { from: order.from, to: order.to }));
  return taken ? `Ronden har redan arbetsordern ”${taken.title?.trim() || "Arbetsorder"}” för ${taken.from}–${taken.to}. Perioderna får inte gå omlott.` : null;
}

/**
 * Why a saved round work order cannot change like this: the round is fixed once an occurrence is registered in it, and the
 * period must still hold every registered occurrence. `occurrences` are the days of its protocols.
 */
export function roundHolderChangeError(previous: { scheduleId: string | null }, next: { scheduleId: string | null; from: string; to: string }, occurrences: readonly string[]): string | null {
  if (!occurrences.length) return null;
  if (previous.scheduleId !== next.scheduleId) return "Ronden kan inte bytas när rondtillfällen redan finns i arbetsordern.";
  const sorted = [...occurrences].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return first < next.from || last > next.to ? `Perioden måste omfatta rondtillfällena som redan finns i arbetsordern (${first}–${last}).` : null;
}

/** The work order's title when it is made from the round: the round and its period. */
export function roundHolderTitle(schedule: Pick<FormSchedule, "title">, period: RoundPeriod) {
  const name = schedule.title.trim() || "Driftrond";
  return `${name} ${period.from === period.to ? period.from : `${period.from}–${period.to}`}`.slice(0, 200);
}

/**
 * Ny arbetsorder för ronden: the address of a new work order that holds the round, with a period from `from` (a year by
 * default). The work order chooses its own customer and place (2026-10-27 kväll); a round planned before then that
 * has a customer and place stored gets them filled in as the suggestion – the only use left of those fields. The person may
 * change it all before saving; nothing is made until then.
 */
export function newRoundHolderHref(schedule: Pick<FormSchedule, "id"> & Partial<Pick<FormSchedule, "legacyPlace">>, from: string, preset: RoundPeriodPreset = "year") {
  const params = new URLSearchParams({ view: "workflow_task", taskType: "WORK_ORDER", roundScheduleId: schedule.id, roundFrom: from, roundTo: roundPeriodEnd(from, preset) });
  const legacy = schedule.legacyPlace;
  if (legacy?.customerId) params.set("customerId", legacy.customerId);
  if (legacy?.facilityId) params.set("facilityId", legacy.facilityId);
  return `/?${params}`;
}

const emptyOrderDetails = () => ({ executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "" });

/**
 * The round's work order as a task input (Local, the demo, tests): the customer, place and temporary place the person chose
 * (`place`; else a round's stored suggestion from before 2026-10-27 kväll), the round's responsible person, the period as Start
 * and Klart senast and the risk step (the full risk assessment is made on the work order, punkt 2). A project is the work
 * order's own choice (`place.projectId`); `projectOpen` false leaves a closed or archived one out.
 */
export function roundHolderDraft(schedule: Pick<FormSchedule, "id" | "title" | "assignedToUserId" | "assignedToName"> & Partial<Pick<FormSchedule, "legacyPlace">>, period: RoundPeriod,
  options: { projectOpen?: boolean; place?: { customerId?: string | null; facilityId?: string | null; projectId?: string | null; tempPlace?: TempPlace | null } } = {}) {
  const place = options.place ?? schedule.legacyPlace ?? null;
  const data = withTempPlace({ kind: "WORK_ORDER" as const, details: emptyOrderDetails(), riskStep: true }, place?.tempPlace ?? null);
  const projectId = options.place?.projectId ?? null;
  return {
    kind: "WORK_ORDER" as const,
    title: roundHolderTitle(schedule, period),
    description: "",
    status: "PLANNED" as const,
    projectId: options.projectOpen === false ? null : projectId,
    customerId: place?.customerId ?? null,
    facilityId: place?.facilityId ?? null,
    assignedToUserId: schedule.assignedToUserId ?? null,
    assignedToName: schedule.assignedToName ?? "",
    dueDate: period.to,
    plannedStartDate: period.from,
    roundScheduleId: schedule.id,
    data,
  };
}

/**
 * The temporary place of a protocol started in a round's work order (2026-10-27 kväll): its own when it has one, else
 * the work order's – like the customer, place and project it takes from the work order. Returns the protocol's data.
 */
export function withRoundOrderTempPlace<T extends object>(taskData: T, orderData: unknown): T {
  return tempPlaceOf(taskData) ? taskData : withTempPlace(taskData, tempPlaceOf(orderData));
}

/** The round of a protocol's answers (`values.round`): the occurrence it registers. */
export function roundOfProtocolValues(data: unknown): { scheduleId: string; occurrence: string } | null {
  const round = (data as { kind?: string; details?: { values?: { round?: { scheduleId?: unknown; occurrence?: unknown } | null } } } | null)?.details?.values?.round;
  if (!round || typeof round.scheduleId !== "string" || !isDay(round.occurrence)) return null;
  return { scheduleId: round.scheduleId, occurrence: round.occurrence };
}

/** The refusal when a round is started for a day without a work order that holds it. */
export const roundHolderMissing = (occurrence: string) => `Ronden har ingen arbetsorder för ${occurrence}. Skapa en arbetsorder för ronden och ange dess period först.`;

/**
 * Which work order a protocol started from a round goes into (the server, Local and the demo): the one the person came
 * with when it holds the round for the day, else the round's work order for the day. Returns its id or the refusal.
 */
export function roundProtocolOrder(round: { scheduleId: string; occurrence: string }, chosen: string | null | undefined, orders: readonly RoundOrderRef[]): { id: string; error?: undefined } | { id?: undefined; error: string } {
  const own = orders.filter((order) => order.scheduleId === round.scheduleId);
  if (chosen) {
    const order = own.find((item) => item.id === chosen);
    if (!order) return { error: "Arbetsordern håller inte den här ronden. Starta ronden från rondens arbetsorder." };
    const holds = order.occurrence ? order.occurrence === round.occurrence : Boolean(order.from && order.to && order.from <= round.occurrence && round.occurrence <= order.to);
    return holds ? { id: order.id } : { error: `Arbetsorderns period omfattar inte ${round.occurrence}.` };
  }
  const order = roundOrderForDay(own, round.scheduleId, round.occurrence);
  return order ? { id: order.id } : { error: roundHolderMissing(round.occurrence) };
}

/**
 * The occurrences of the round within the work order's period before today that have no protocol yet: shown as late on
 * the work order (the schedule still shows what is due, punkt 3). At most `limit`, the latest first. Today's occurrence is
 * late too once the round's klockslag has passed (`now`, Swedish "HH:MM", 2026-10-28) – the same rule as Driftronder.
 */
export function lateOccurrencesInPeriod(rule: FormScheduleRule, period: RoundPeriod, started: ReadonlySet<string>, today: string, limit = 20, now?: string | null) {
  const last = occurrenceLate(rule, today, today, now) ? today : addDays(today, -1);
  const end = period.to < last ? period.to : last;
  if (end < period.from) return [];
  return scheduleOccurrences(rule, period.from, end, 2000).filter((day) => !started.has(day)).reverse().slice(0, limit);
}

/** The round's first occurrence within the period from today on without a protocol: what Starta ronden starts. */
export function nextOccurrenceInPeriod(rule: FormScheduleRule, period: RoundPeriod, started: ReadonlySet<string>, today: string) {
  const from = period.from > today ? period.from : today;
  return scheduleOccurrences(rule, from, period.to, 400).find((day) => !started.has(day)) ?? null;
}

/**
 * Every check of a round's work order on save in one place, for Local and the demo (Cloud runs the same pieces against the
 * database): the round exists, the period is valid and free, and registered occurrences keep their round and days.
 * `others` are the round's other work orders, `occurrences` the days registered in this one. Returns the refusal, or null.
 */
export function roundHolderSaveError(input: { roundScheduleId: string | null; from: string; to: string; status: string }, previous: { roundScheduleId: string | null; roundOccurrence?: string | null } | null, context: { scheduleExists: boolean; others: readonly RoundOrderRef[]; occurrences: readonly string[] }): string | null {
  if (previous?.roundOccurrence) return input.roundScheduleId === previous.roundScheduleId ? null : "Rondens arbetsorder för ett tillfälle kan inte byta rond.";
  const change = roundHolderChangeError({ scheduleId: previous?.roundScheduleId ?? null }, { scheduleId: input.roundScheduleId, from: input.from, to: input.to }, context.occurrences);
  if (change) return change;
  if (!input.roundScheduleId) return null;
  if (!context.scheduleExists) return "Ronden hittades inte.";
  const period = { from: input.from, to: input.to };
  return roundPeriodError(period) ?? (input.status === "CANCELLED" ? null : roundPeriodOverlapError(period, context.others));
}

export type RoundOrderSummary = {
  /** `time`: the round's klockslag ("07:00", 2026-10-28), shown with the occurrence Starta ronden starts; null: the whole day. */
  round: { id: string; title: string; ruleText: string; time: string | null } | null;
  period: RoundPeriod | null;
  /** The occurrence Starta ronden starts now: today's, else the latest late one, else the next in the period. */
  occurrence: string | null;
  /** The occurrences in the period before today without a protocol (the latest first), each with its start link. */
  late: { date: string; href: string | null }[];
  /** Ej utfört (2026-10-28): the occurrences in the period recorded as not done, the latest first – handled, not late. */
  notDone: RoundNotDone[];
  href: string | null;
  notice: string | null;
};

/**
 * The round on its work order (Cloud, Local and the demo): which round and period the work order holds, Starta ronden for
 * the occurrence to do now as the protocol's link in this work order, and the late occurrences. A 0.24.0 work order for one
 * occurrence starts that day while it has no protocol. `started` are the days registered in the work order; `round` is
 * the schedule as the person may see it (null when gone or hidden).
 */
export function roundOrderSummary(order: { id: string; status: string; roundScheduleId?: string | null; roundOccurrence?: string | null; plannedStartDate?: string | null; dueDate?: string | null },
  round: (Pick<FormSchedule, "id" | "templateId" | "title" | "rule"> & Partial<Pick<FormSchedule, "assignedToUserId" | "assignedToName" | "templateMissing" | "templateUnpublished">>) | null,
  registered: ReadonlySet<string>, today: string, /** Swedish "HH:MM": today's occurrence is late once the klockslag has passed (2026-10-28). */ now?: string | null,
  /** Ej utfört (2026-10-28, Cloud): the round's active outcomes; a day recorded as not done is handled like a registered one. */ notDone: readonly RoundNotDone[] = []): RoundOrderSummary | null {
  if (!order.roundScheduleId) return null;
  if (!round) return { round: null, period: null, occurrence: null, late: [], notDone: [], href: null, notice: "Ronden finns inte längre, eller så får du inte se den." };
  const closed = order.status === "COMPLETED" || order.status === "CANCELLED";
  const formNotice = roundFormNotice(round);
  const link = (date: string) => formNotice || closed ? null : roundHref(round, { date, workOrderId: order.id });
  const holder = roundHolderOf(order);
  const period = holder ? { from: holder.from, to: holder.to } : { from: order.roundOccurrence ?? "", to: order.roundOccurrence ?? "" };
  const marked = notDone.filter((item) => period.from <= item.occurrence && item.occurrence <= period.to).sort((a, b) => b.occurrence.localeCompare(a.occurrence));
  const started = new Set([...registered, ...marked.map((item) => item.occurrence)]);
  const late = holder ? lateOccurrencesInPeriod(round.rule, period, started, today, 20, now) : [];
  const todayDue = period.from <= today && today <= period.to && !started.has(today) && scheduleOccurrences(round.rule, today, today, 1).length > 0;
  const occurrence = !holder ? (order.roundOccurrence && !started.has(order.roundOccurrence) ? order.roundOccurrence : null)
    : todayDue ? today : late[0] ?? nextOccurrenceInPeriod(round.rule, period, started, today);
  return {
    round: { id: round.id, title: round.title, ruleText: scheduleRuleText(round.rule), time: round.rule.time ?? null },
    period, occurrence, late: late.map((date) => ({ date, href: link(date) })), notDone: marked,
    notice: formNotice ?? (closed || occurrence ? null : "Inga fler rondtillfällen i arbetsorderns period."),
    href: occurrence ? link(occurrence) : null,
  };
}

/**
 * What a tap on a round does now (Driftronder, the round's own screen, the map): continue a started protocol, start the
 * occurrence in the round's work order for its day, or – when no work order holds that day – make that work order first
 * ("Skapa arbetsorder för ronden", punkt 3: nothing is made by itself). The occurrence is today's or a missed one, else the
 * next one. Null when the round is paused, ended or its form cannot be started.
 */
export function roundStartAction(schedule: Pick<FormSchedule, "id" | "templateId" | "title" | "active" | "templateMissing"> & Partial<Pick<FormSchedule, "assignedToUserId" | "assignedToName" | "legacyPlace">>
  & { overview: { current: { date: string; taskId?: string; workOrderId?: string } | null; next: string | null; nextTaskId: string | null; upcoming: { date: string; workOrderId?: string }[] } }): { href: string; label: string; kind: "continue" | "start" | "create" } | null {
  if (!schedule.active || schedule.templateMissing) return null;
  const current = schedule.overview.current;
  const target = current ? { date: current.date, taskId: current.taskId ?? null, workOrderId: current.workOrderId ?? null }
    : schedule.overview.next ? { date: schedule.overview.next, taskId: schedule.overview.nextTaskId, workOrderId: schedule.overview.upcoming.find((item) => item.date === schedule.overview.next)?.workOrderId ?? null } : null;
  if (!target) return null;
  if (target.taskId) return { href: roundHref(schedule, target), label: "Fortsätt rond", kind: "continue" };
  if (!target.workOrderId) return { href: newRoundHolderHref(schedule, target.date), label: "Skapa arbetsorder för ronden", kind: "create" };
  return { href: roundHref(schedule, target), label: current ? "Starta rond" : "Starta nu", kind: "start" };
}
