import { addDays, occurrenceLate, roundFormNotice, roundHref, roundOrderForDay, roundWhereLabel, scheduleOccurrences, scheduleRuleText, taskRound, type FormSchedule, type RoundOrderRef, type ScheduleOccurrenceState } from "./form-schedule";
import { swedishDate, swedishDayKey } from "@/lib/swedish-time";
import type { CapacityActivity } from "./capacity-summary";
import { bookingOnCancelledJob } from "./task-cancel";

/**
 * Driftronder i Planeringen (2026-10-06): the occurrences of the company's round schedules inside the period Planning
 * shows, as their own kind beside the planned activities. They are computed from `FormSchedule` every time – never
 * stored as planned activities – the same way in Cloud, Local and the demo. An occurrence with a protocol is done or
 * started; one without is missed (before today), due (today) or upcoming. Every occurrence without a protocol can be
 * started now, whatever its day (2026-10-07: "planering är bara en planering"): the protocol is linked to the
 * occurrence, which then counts as started or done and the round's next day is the next one still open.
 */
export type PlanningRound = {
  /** `scheduleId:date`, unique in the list. */
  key: string;
  scheduleId: string;
  title: string;
  templateName: string;
  ruleText: string;
  date: string;
  /** The round's klockslag ("07:00") and beräknad tid in minutes (2026-10-28); null: the whole day / not given. */
  time: string | null;
  durationMinutes: number | null;
  state: ScheduleOccurrenceState["state"];
  taskId: string | null;
  /** The work order the occurrence is registered in (the round's work order for the period, 2026-10-27), when there is one. */
  workOrderId: string | null;
  /** Starts the round (or opens its protocol) – on any day, past, today or ahead: planning is only a plan. Without a
   * protocol and with an unpublished form (formNotice), Driftronder instead. */
  href: string;
  /** 2026-10-24: the round's form is not published (or removed) – shown instead of Starta nu; null when it can start. */
  formNotice: string | null;
  /** Where the occurrence is done: the place of the work order that holds the day (2026-10-27 kväll), its temporary
   * place marked "Tillfällig:", or "Ingen arbetsorder" when no work order holds it. Customer and project are the work order's too. */
  facilityName: string;
  customerName: string;
  projectId: string | null;
  projectName: string;
  assignedToUserId: string | null;
  assignedToName: string;
};

/** At most this many days and occurrences are computed per request, so a daily round never makes an unbounded list. */
export const PLANNING_ROUND_MAX_DAYS = 200;
export const PLANNING_ROUND_LIMIT = 600;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** The period actually computed: valid days, `to` not before `from`, at most PLANNING_ROUND_MAX_DAYS long. */
export function planningRoundPeriod(from: string | null | undefined, to: string | null | undefined, today: string) {
  const start = from && DAY_KEY.test(from) ? from : today;
  let end = to && DAY_KEY.test(to) ? to : addDays(start, 30);
  if (end < start) end = start;
  const last = addDays(start, PLANNING_ROUND_MAX_DAYS - 1);
  return { from: start, to: end > last ? last : end };
}

/** The rounds of the active schedules from `from` to `to` (both included), by day and title, at most `limit`. */
export function planningRounds(schedules: FormSchedule[], tasks: { id: string; status: string; data: unknown }[], period: { from: string; to: string }, today: string, limit = PLANNING_ROUND_LIMIT, orders: readonly RoundOrderRef[] = [], /** Swedish "HH:MM": today's occurrence is missed once its klockslag has passed (2026-10-28). */ now?: string | null,
  /** Ej utfört (2026-10-28, Cloud): the rounds' active outcomes in the period. */ notDone: readonly { scheduleId: string; occurrence: string }[] = []) {
  const protocols = new Map<string, { taskId: string; status: string }>();
  const marked = new Set(notDone.map((item) => `${item.scheduleId}:${item.occurrence}`));
  // A day's completed protocol decides over one that is going, and that over one set to Utgår (2026-10-28).
  const rank = (status: string) => status === "COMPLETED" ? 2 : status === "CANCELLED" ? 0 : 1;
  for (const task of tasks) {
    const round = taskRound(task);
    if (!round) continue;
    const key = `${round.scheduleId}:${round.occurrence}`;
    const seen = protocols.get(key);
    if (!seen || rank(round.status) > rank(seen.status)) protocols.set(key, { taskId: round.taskId, status: round.status });
  }
  const rounds: PlanningRound[] = [];
  let truncated = false;
  for (const schedule of schedules) {
    if (!schedule.active) continue;
    const ruleText = scheduleRuleText(schedule.rule);
    const formNotice = roundFormNotice(schedule);
    const days = scheduleOccurrences(schedule.rule, period.from, period.to, limit + 1);
    if (days.length > limit) truncated = true;
    for (const date of days.slice(0, limit)) {
      const key = `${schedule.id}:${date}`;
      const protocol = protocols.get(key);
      // The round's work order for the day (2026-10-27: the one holding the period; 0.24.0's per day is still read).
      const order = roundOrderForDay(orders, schedule.id, date);
      // Only a 0.24.0 work order for the day handles it by being closed; the round's work order for a period never does.
      const closedOrder = Boolean(order?.occurrence && (order.status === "COMPLETED" || order.status === "CANCELLED"));
      // A protocol set to Utgår does not handle the day (2026-10-28: it showed as started): "cancelled", still open.
      const going = protocol && protocol.status !== "CANCELLED" ? protocol : null;
      const state: PlanningRound["state"] = going ? (going.status === "COMPLETED" ? "done" : "started") : closedOrder ? "done" : marked.has(key) ? "not_done" : protocol ? "cancelled"
        : occurrenceLate(schedule.rule, date, today, now) ? "missed" : date === today ? "due" : "upcoming";
      rounds.push({
        key, scheduleId: schedule.id, title: schedule.title, templateName: schedule.templateName ?? "", ruleText, date, time: schedule.rule.time ?? null, durationMinutes: schedule.rule.durationMinutes ?? null, state, taskId: going?.taskId ?? null, workOrderId: order?.id ?? null,
        href: formNotice && !going ? "/?view=rounds" : roundHref(schedule, { date, taskId: going?.taskId ?? null, workOrderId: order?.id ?? null }), formNotice,
        // Where the occurrence is done: its work order's place (2026-10-27 kväll), with a temporary place marked "Tillfällig:".
        facilityName: roundWhereLabel(order), customerName: order?.customerName ?? "", projectId: order?.projectId ?? null, projectName: order?.projectName ?? "",
        assignedToUserId: schedule.assignedToUserId ?? null, assignedToName: schedule.assignedToName ?? "",
      });
    }
  }
  // By day, then by klockslag (a round without one – the whole day – first), then by title.
  rounds.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "") || a.title.localeCompare(b.title, "sv") || a.scheduleId.localeCompare(b.scheduleId));
  if (rounds.length > limit) truncated = true;
  return { rounds: rounds.slice(0, limit), truncated };
}

export const PLANNING_ROUND_STATE_LABEL: Record<PlanningRound["state"], string> = { done: "Utförd", started: "Påbörjad", missed: "Missad", due: "I dag", upcoming: "Kommande", not_done: "Ej utfört", cancelled: "Utgått" };

/** Planning's status filter applied to a round: done is Slutförd, started Pågår, the rest Planerad; Inställd has none. */
export function planningRoundMatchesStatus(round: Pick<PlanningRound, "state">, status: "all" | "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELED") {
  if (status === "all") return true;
  if (status === "COMPLETED") return round.state === "done";
  if (status === "IN_PROGRESS") return round.state === "started";
  // An utgått protocol leaves the day open (Planerad); Ej utfört is Inställd (2026-10-28).
  if (status === "PLANNED") return round.state === "upcoming" || round.state === "due" || round.state === "missed" || round.state === "cancelled";
  return round.state === "not_done";
}

/** Whether a booking covers a person on a Swedish day: the day lies within it and the person is booked (or named) on it. */
function bookingCovers(booking: CapacityActivity, userId: string, day: string) {
  const people = new Set([...(booking.assignments ?? []).map((item) => item.userId), ...(booking.assignedToUserIds ?? []), ...(booking.assignedToUserId ? [booking.assignedToUserId] : [])]);
  if (!people.has(userId)) return false;
  const start = new Date(booking.startsAt); const end = new Date(booking.endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return false;
  return swedishDayKey(start) <= day && day <= swedishDayKey(new Date(end.getTime() - 1));
}

/**
 * Beräknad tid i beläggningen (2026-10-28): a round occurrence with a beräknad tid and a responsible person loads that
 * person like a booking, through the same capacity rules as the planned activities (lib/workflow/capacity-summary.ts) –
 * nothing is stored, and no second calculation. With a klockslag it is the interval klockslag + beräknad tid; without one
 * the beräknad tid lies on the day. An occurrence that is done, or whose work order already has an active booking of the
 * same person that day (the work order booked in Planering), is not counted again; a booking on a job that has utgått counts for
 * nothing, so it hides no round (2026-11-02). Each load has an id ("round:<key>") and a
 * title, so the clash warnings (lib/workflow/availability-summary.ts) can name it beside the bookings.
 */
export type RoundCapacityActivity = CapacityActivity & { id: string; title: string };
export function roundCapacityActivities(rounds: readonly PlanningRound[], bookings: readonly CapacityActivity[]): RoundCapacityActivity[] {
  return rounds.flatMap((round): RoundCapacityActivity[] => {
    const userId = round.assignedToUserId;
    if (!round.durationMinutes || !userId || round.state === "done" || round.state === "not_done") return [];
    if (round.workOrderId && bookings.some((booking) => booking.workflowTaskId === round.workOrderId && (booking.status === "PLANNED" || booking.status === "IN_PROGRESS") && !bookingOnCancelledJob(booking) && bookingCovers(booking, userId, round.date))) return [];
    const [year, month, day] = round.date.split("-").map(Number) as [number, number, number];
    const [hour, minute] = (round.time ?? "00:00").split(":").map(Number) as [number, number];
    const startsAt = swedishDate(year, month, day, hour, minute);
    const endsAt = round.time ? new Date(startsAt.getTime() + round.durationMinutes * 60_000) : swedishDate(year, month, day + 1);
    return [{
      id: `round:${round.key}`, title: `Driftrond: ${round.title}`, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), assignedToUserId: userId, assignedToUserIds: [userId],
      // With a klockslag the interval itself is the load; without one the minutes are the day's load.
      assignments: [{ userId, plannedMinutes: round.time ? null : round.durationMinutes, startsAt: null, endsAt: null }],
      status: round.state === "started" ? "IN_PROGRESS" : "PLANNED", projectId: round.projectId, workflowTaskId: round.workOrderId,
    }];
  });
}

/** What loads people in the capacity count (2026-11-02): the bookings and the round occurrences they do not already cover. Rounds only while the Driftronder module is on: the caller passes [] otherwise. */
export const capacityLoads = <B extends CapacityActivity>(bookings: readonly B[], rounds: readonly PlanningRound[]): (B | RoundCapacityActivity)[] =>
  [...bookings, ...roundCapacityActivities(rounds, bookings)];
