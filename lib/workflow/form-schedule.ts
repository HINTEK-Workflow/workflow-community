import { z } from "zod";
import { formatSwedish } from "@/lib/swedish-time";
import { formDocumentSchema, formLeafBlocks, formRowsWithoutOrder, formValuesSchema, type FormFieldBlock } from "./form-document";
import { listPlaceLabel, tempPlaceOf, tempPlacePosition, type TempPlace } from "./temp-place";
import type { RoundNotDone } from "./round-outcome";

/**
 * Återkommande kontroller – driftronder (2026-09-28). A schedule says which form is filled in and how often: every N days,
 * on chosen weekdays every N weeks, or on a day of the month (or a weekday of the month) every N months – until further
 * notice, until a day or for a number of times. Occurrences are calendar days (Swedish time, "YYYY-MM-DD") computed by this
 * pure function in Cloud, Local and the demo alike. The round is held by a work order with a period (2026-10-27,
 * punkt 3; lib/workflow/round-work-orders.ts): a person makes the work order, says it is for the round and gives its start
 * and end, and every occurrence in the period is registered in that same work order when the round is started – nothing is
 * made by itself. The protocol carries the schedule and the day (`values.round`), which is how an occurrence counts as
 * done. Work orders made per occurrence by 0.24.0 are still read.
 *
 * Where (2026-10-27 kväll: "Ronden är framför allt tidsreglerna som ställs in – kund och plats hänger med från
 * arbetsordern"): the round has no customer, place, temporary place or project of its own. They are the work order's that
 * holds the occurrence – the protocol takes them when it is started in it, and the lists show them from it.
 */
export const SCHEDULE_FREQUENCIES = ["DAILY", "WEEKLY", "MONTHLY"] as const;
export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];
export const SCHEDULE_FREQUENCY_LABEL: Record<ScheduleFrequency, string> = { DAILY: "Dagligen", WEEKLY: "Veckovis", MONTHLY: "Månadsvis" };
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ange ett datum.");
/** Månadsvis på en veckodag (2026-10-27): the first to the fourth, or the last (-1), of a weekday in the month. */
export const MONTH_WEEKS = [1, 2, 3, 4, -1] as const;
export type MonthWeek = (typeof MONTH_WEEKS)[number];
/** The most times a round may be set to end after ("Efter N gånger"). */
export const SCHEDULE_COUNT_MAX = 500;
/** A round's klockslag, "07:00" (24 h). */
export const ROUND_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
/** The longest beräknad tid of a round: a day, in minutes. */
export const ROUND_DURATION_MAX = 1440;
/** The quick choices of Beräknad tid, in minutes. */
export const ROUND_DURATION_CHOICES = [15, 30, 60, 120] as const;

export const formScheduleRuleSchema = z.object({
  frequency: z.enum(SCHEDULE_FREQUENCIES).default("DAILY"),
  // Every N days, weeks or months ("anpassat intervall").
  interval: z.number().int().min(1).max(366).default(1),
  // Weekly: ISO weekdays 1 (Monday) – 7 (Sunday); empty = the start date's weekday.
  weekdays: z.array(z.number().int().min(1).max(7)).max(7).default([]),
  startDate: date,
  endDate: date.or(z.literal("")).default(""),
  /**
   * Monthly on a weekday (2026-10-27, "Hur ofta"): `monthWeek` 1–4 or -1 (the last) with `monthWeekday` 1–7 –
   * "första måndagen", "sista fredagen". Both absent (every rule before 2026-10-27): the start date's day of the month.
   */
  monthWeek: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(-1)]).optional(),
  monthWeekday: z.number().int().min(1).max(7).optional(),
  /** "Efter N gånger" (2026-10-27): the rule ends after its Nth occurrence counted from the start date. Absent: no such end. */
  count: z.number().int().min(1).max(SCHEDULE_COUNT_MAX).optional(),
  /**
   * Klockslag and beräknad tid (2026-10-28: "när man markerar kalendern vet man inte vilken tid man ska göra det"):
   * when on the day the round is done, "HH:MM", and about how long it takes in minutes. Both optional; absent (every rule
   * before 2026-10-28) the round is for the whole day, as before. Same rule in Cloud, Local and the demo, and in the export.
   */
  time: z.string().regex(ROUND_TIME_PATTERN, "Ange klockslaget som TT:MM.").optional(),
  durationMinutes: z.number().int().min(1).max(ROUND_DURATION_MAX).optional(),
}).refine((rule) => !rule.endDate || rule.endDate >= rule.startDate, { message: "Slutdatum kan inte vara före startdatum.", path: ["endDate"] })
  .refine((rule) => (rule.monthWeek === undefined) === (rule.monthWeekday === undefined), { message: "Ange både vilken vecka och vilken veckodag.", path: ["monthWeek"] });
export type FormScheduleRule = z.infer<typeof formScheduleRuleSchema>;

/**
 * Reminders for a round (2026-09-30): a notice in the bell of the top bar (on from the start) and an e-mail
 * (chosen per round). They go to the round's responsible person, or to the company's administrators when none is chosen.
 */
export const formScheduleRemindersSchema = z.object({ bell: z.boolean().default(true), email: z.boolean().default(false) });
export type FormScheduleReminders = z.infer<typeof formScheduleRemindersSchema>;
export const defaultScheduleReminders: FormScheduleReminders = { bell: true, email: false };
/** Stored reminders from before 2026-09-30, or a broken value, read as the defaults. */
export const parseScheduleReminders = (value: unknown): FormScheduleReminders => formScheduleRemindersSchema.safeParse(value ?? {}).data ?? defaultScheduleReminders;

/**
 * A round as it is planned (2026-10-27 kväll): the form, a name, the time rules, active, the person responsible for
 * the reminders and the reminders. No customer, place, temporary place or project – they come with the work order that
 * holds the round. An older client may still send them: they are not part of the round and are dropped here.
 */
export const formScheduleInputSchema = z.object({
  id: z.string().min(1).max(100).optional(),
  version: z.number().int().min(0).optional(),
  title: z.string().trim().min(1, "Ange ett namn på ronden.").max(200),
  templateId: z.string().min(1).max(100),
  assignedToUserId: z.string().min(1).max(100).nullable().default(null),
  assignedToName: z.string().trim().max(160).default(""),
  active: z.boolean().default(true),
  rule: formScheduleRuleSchema,
  reminders: formScheduleRemindersSchema.default(defaultScheduleReminders),
});
export type FormScheduleInput = z.infer<typeof formScheduleInputSchema>;

/**
 * What a round planned before 2026-10-27 (kväll) has stored of its own customer, place, temporary place and project. The data
 * is kept as it is and never changed. Its only use is the suggestion when a work order is made for the round ("Skapa
 * arbetsorder för ronden"); the project also still decides who may change such a round (lib/workflow/round-planning.ts).
 */
export type RoundLegacyPlace = { customerId: string | null; facilityId: string | null; projectId: string | null; tempPlace: TempPlace | null };
/** The stored fields of a round as its suggestion, or null when it has none. */
export function roundLegacyPlace(row: { customerId?: string | null; facilityId?: string | null; projectId?: string | null; tempPlace?: unknown }): RoundLegacyPlace | null {
  const tempPlace = scheduleTempPlace(row.tempPlace);
  if (!row.customerId && !row.facilityId && !row.projectId && !tempPlace) return null;
  return { customerId: row.customerId ?? null, facilityId: row.facilityId ?? null, projectId: row.projectId ?? null, tempPlace };
}

export type FormSchedule = FormScheduleInput & { id: string; version: number; templateName?: string; /** The form is removed or no longer published: the round cannot be started (KTR-03). */ templateMissing?: boolean;
  /** The form is there but not published (2026-10-24): templateMissing is then true too, and the warning says so. */ templateUnpublished?: boolean;
  /** A round from before 2026-10-27 (kväll): its stored customer, place and project – the suggestion for its work order only. */ legacyPlace?: RoundLegacyPlace | null;
  createdAt?: string; updatedAt?: string };

/** A round's stored temporary place, or null (none, empty or malformed) – the same reading as a task's. */
export function scheduleTempPlace(value: unknown): TempPlace | null {
  return tempPlaceOf({ tempPlace: value });
}

const DAY = 86_400_000;
const toTime = (value: string) => Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
const toDate = (time: number) => new Date(time).toISOString().slice(0, 10);
export const addDays = (value: string, days: number) => toDate(toTime(value) + days * DAY);
const isoWeekday = (value: string) => ((new Date(toTime(value)).getUTCDay() + 6) % 7) + 1;
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/** The day of the month that is the `week`:th (1–4, or -1 for the last) ISO `weekday` of a month (month 0–11). */
function monthWeekdayDay(year: number, month: number, week: MonthWeek, weekday: number) {
  if (week === -1) {
    const last = daysInMonth(year, month);
    const lastWeekday = ((new Date(Date.UTC(year, month, last)).getUTCDay() + 6) % 7) + 1;
    return last - ((lastWeekday - weekday + 7) % 7);
  }
  const firstWeekday = ((new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7) + 1;
  return 1 + ((weekday - firstWeekday + 7) % 7) + (week - 1) * 7;
}

/** The occurrences of a rule without its count, from `start` to `end` (both included and already clipped), at most `limit`. */
function occurrencesBetween(rule: FormScheduleRule, start: string, end: string, limit: number): string[] {
  const out: string[] = [];
  if (start > end) return out;
  if (rule.frequency === "DAILY") {
    const offset = Math.round((toTime(start) - toTime(rule.startDate)) / DAY);
    let day = addDays(rule.startDate, Math.ceil(offset / rule.interval) * rule.interval);
    for (; day <= end && out.length < limit; day = addDays(day, rule.interval)) out.push(day);
    return out;
  }
  if (rule.frequency === "WEEKLY") {
    const weekdays = rule.weekdays.length ? [...new Set(rule.weekdays)].sort() : [isoWeekday(rule.startDate)];
    // Weeks are counted from the Monday of the start date's week.
    const firstMonday = addDays(rule.startDate, 1 - isoWeekday(rule.startDate));
    for (let day = addDays(start, 1 - isoWeekday(start)); day <= end && out.length < limit; day = addDays(day, 7)) {
      const week = Math.round((toTime(day) - toTime(firstMonday)) / (7 * DAY));
      if (week % rule.interval) continue;
      for (const weekday of weekdays) {
        const candidate = addDays(day, weekday - 1);
        if (candidate >= start && candidate <= end && candidate >= rule.startDate && out.length < limit) out.push(candidate);
      }
    }
    return out;
  }
  // Monthly: the start date's day of the month, or the month's last day when it is shorter (31 → 30 April); or, with
  // `monthWeek` and `monthWeekday` (2026-10-27), that weekday of the month ("första måndagen", "sista fredagen").
  const dayOfMonth = Number(rule.startDate.slice(8, 10));
  const baseYear = Number(rule.startDate.slice(0, 4));
  const baseMonth = Number(rule.startDate.slice(5, 7)) - 1;
  const onWeekday = rule.monthWeek !== undefined && rule.monthWeekday !== undefined;
  for (let step = 0; out.length < limit; step += rule.interval) {
    const year = baseYear + Math.floor((baseMonth + step) / 12);
    const month = (baseMonth + step) % 12;
    const day = onWeekday ? monthWeekdayDay(year, month, rule.monthWeek!, rule.monthWeekday!) : Math.min(dayOfMonth, daysInMonth(year, month));
    const candidate = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (candidate > end) break;
    if (candidate >= start && candidate >= rule.startDate) out.push(candidate);
  }
  return out;
}

/** The last day of a rule that ends after a number of times ("Efter N gånger"), or null when it has no count. */
export function scheduleCountEnd(rule: FormScheduleRule): string | null {
  if (!rule.count) return null;
  const days = occurrencesBetween(rule, rule.startDate, rule.endDate || "9999-12-31", rule.count);
  return days[days.length - 1] ?? rule.startDate;
}

/** The occurrences of a rule from `from` to `to` (both included), at most `limit`. */
export function scheduleOccurrences(rule: FormScheduleRule, from: string, to: string, limit = 400): string[] {
  const start = from > rule.startDate ? from : rule.startDate;
  const counted = scheduleCountEnd(rule);
  const last = [to, rule.endDate, counted].filter((value): value is string => Boolean(value)).sort()[0]!;
  return occurrencesBetween(rule, start, last, limit);
}

/** The next occurrence on or after a day, or null when the schedule has ended. */
export function nextOccurrence(rule: FormScheduleRule, from: string) {
  return scheduleOccurrences(rule, from, addDays(from, 800), 1)[0] ?? null;
}

/** Beräknad tid in words: "30 min", "1 h", "1 h 30 min". */
export function roundDurationText(minutes: number) {
  const hours = Math.floor(minutes / 60); const rest = minutes % 60;
  return [hours ? `${hours} h` : "", rest || !hours ? `${rest} min` : ""].filter(Boolean).join(" ");
}
/** A round's klockslag and beräknad tid as the lists show them, "kl. 07:00, ca 30 min"; empty when it has neither. */
export function roundTimeText(rule: Pick<FormScheduleRule, "time" | "durationMinutes">, separator = ", ") {
  return [rule.time ? `kl. ${rule.time}` : "", rule.durationMinutes ? `ca ${roundDurationText(rule.durationMinutes)}` : ""].filter(Boolean).join(separator);
}
/**
 * Whether an occurrence without a protocol is late now (2026-10-28): a day before today always; today only once the
 * round's klockslag has passed (`now`, Swedish "HH:MM"). Without a klockslag – or without `now` – today is never late, as
 * before. The reminder still goes out in the morning; only "försenad" waits for the klockslag. The same rule for the
 * Driftronder list, Planering, the round's work order and the bell.
 */
export function occurrenceLate(rule: Pick<FormScheduleRule, "time">, date: string, today: string, now?: string | null) {
  return date < today || (date === today && Boolean(rule.time && now && now > rule.time));
}
const WEEKDAY_SHORT = ["mån", "tis", "ons", "tors", "fre", "lör", "sön"];
/**
 * The chosen day of the round's calendar on one line (2026-10-28): "ons 28 okt 2026 · kl. 07:00 · ca 30 min", "… ·
 * hela dagen" without a klockslag, or "… · ingen rond den dagen".
 */
export function roundDayLine(rule: FormScheduleRule, day: string) {
  const head = `${WEEKDAY_SHORT[isoWeekday(day) - 1]} ${ruleDayText(day)}`;
  if (!scheduleOccurrences(rule, day, day, 1).length) return `${head} · ingen rond den dagen`;
  return [head, rule.time ? `kl. ${rule.time}` : "hela dagen", rule.durationMinutes ? `ca ${roundDurationText(rule.durationMinutes)}` : ""].filter(Boolean).join(" · ");
}

export type ScheduleRound = { taskId: string; status: string; occurrence: string; /** Deviation rows still without a work order (2026-10-02: a round with a fault looked fine). */ openDeviations?: number };
/**
 * An occurrence's state (2026-10-28, etapp 5): planerat (upcoming, due), försenat (missed), utfört (done), påbörjat
 * (started), ej utfört (not_done: recorded with a reason, lib/workflow/round-outcome.ts) and utgått (cancelled: its only
 * protocol was set to Utgår). A cancelled protocol does not handle the day: the occurrence is still open – late once its
 * time has passed (`late`), counted as missed and offered to start again or to mark Ej utfört – until a new protocol or an
 * Ej utfört handles it. Ej utfört is handled: never late, missed, current or reminded about.
 */
export type ScheduleOccurrenceState = { date: string; state: "done" | "started" | "missed" | "due" | "upcoming" | "not_done" | "cancelled"; taskId?: string; openDeviations?: number;
  /** The work order the occurrence is registered in (the round's work order for the period), when there is one. */ workOrderId?: string;
  /** not_done: the reason, who and when. */ notDone?: RoundNotDone;
  /** cancelled: the protocol that was set to Utgår (opened from the chip; never continued by Starta). */ cancelledTaskId?: string;
  /** cancelled: the day's time has passed, so it counts as försenat. */ late?: boolean };
/** Whether an occurrence still waits to be handled and is late now: försenat, or utgått after its time. */
export const occurrenceOverdue = (item: Pick<ScheduleOccurrenceState, "state" | "late">) => item.state === "missed" || (item.state === "cancelled" && Boolean(item.late));
/** Whether an occurrence is handled: utfört or ej utfört. */
export const occurrenceHandled = (item: Pick<ScheduleOccurrenceState, "state">) => item.state === "done" || item.state === "not_done";
/**
 * Where a round's occurrence is done (2026-10-27 kväll): the customer, place, temporary place and project of the
 * work order that holds it, with the names the lists show (filled in by Cloud, Local and the demo where they read them).
 */
export type RoundOrderPlace = {
  customerId?: string | null; facilityId?: string | null; projectId?: string | null; tempPlace?: TempPlace | null;
  customerName?: string; facilityName?: string; projectName?: string;
  /** The place on the map: its own position or the nearest above (Platser, 2026-10-04). */
  facilityPosition?: { latitude: number; longitude: number } | null;
};
/**
 * A round's work order as the views read it (2026-10-27, punkt 3): the work order holding the round for a period
 * (`from`–`to`), or – made by 0.24.0 – one for a single occurrence (`occurrence`). Its id, status, title and where.
 */
export type RoundOrderRef = { scheduleId: string; id: string; status: string; title?: string; occurrence?: string | null; from?: string; to?: string } & RoundOrderPlace;
/** The text a list shows for where a round is done when no work order holds it. */
export const ROUND_NO_WORK_ORDER = "Ingen arbetsorder";

/**
 * The work order an occurrence is registered in: a 0.24.0 work order made for exactly that day, else the round's work
 * order whose period holds the day (not one that has been cancelled; an open one before a completed one). Null when none.
 */
export function roundOrderForDay<T extends RoundOrderRef>(orders: readonly T[], scheduleId: string, day: string): T | null {
  const own = orders.filter((order) => order.scheduleId === scheduleId);
  const single = own.find((order) => order.occurrence === day);
  if (single) return single;
  const holding = own.filter((order) => !order.occurrence && order.status !== "CANCELLED" && order.from && order.to && order.from <= day && day <= order.to);
  return holding.find((order) => order.status !== "COMPLETED") ?? holding[0] ?? null;
}

/** Of a day's protocols, the one that decides its state: a completed one, else one that is going, else one that has utgått. */
function dayProtocols(rounds: readonly ScheduleRound[]) {
  const byDay = new Map<string, ScheduleRound>();
  const rank = (round: ScheduleRound) => round.status === "COMPLETED" ? 2 : round.status === "CANCELLED" ? 0 : 1;
  for (const round of rounds) {
    const seen = byDay.get(round.occurrence);
    if (!seen || rank(round) > rank(seen)) byDay.set(round.occurrence, round);
  }
  return byDay;
}

/**
 * An overview of one schedule: the recent past (done, started, missed, not done or cancelled), today and the next
 * occurrences. "Missed" is a past occurrence without a protocol; an occurrence with a protocol that is not completed is
 * "started" – unless the protocol was set to Utgår ("cancelled"; 2026-10-28 it wrongly showed as started). `notDone`: the
 * round's active Ej utfört (lib/workflow/round-outcome.ts), keyed by day – a changed rule keeps them in the data while the
 * overview shows the days of the rule now.
 */
export function scheduleOverview(rule: FormScheduleRule, rounds: ScheduleRound[], today: string, options: { pastDays?: number; upcoming?: number; /** Swedish "HH:MM": today's occurrence is missed once the round's klockslag has passed (2026-10-28). */ now?: string | null; notDone?: readonly RoundNotDone[] } = {}, orders: readonly Omit<RoundOrderRef, "scheduleId">[] = []) {
  const byDay = dayProtocols(rounds);
  const notDone = new Map((options.notDone ?? []).map((item) => [item.occurrence, item]));
  const past = scheduleOccurrences(rule, addDays(today, -(options.pastDays ?? 30)), addDays(today, -1));
  const state = (day: string, fallback: ScheduleOccurrenceState["state"]): ScheduleOccurrenceState => {
    const round = byDay.get(day);
    const order = roundOrderForDay(orders.map((item) => ({ ...item, scheduleId: "" })), "", day);
    const withOrder = order ? { workOrderId: order.id } : {};
    if (round && round.status !== "CANCELLED") return { date: day, state: round.status === "COMPLETED" ? "done" : "started", taskId: round.taskId, openDeviations: round.openDeviations ?? 0, ...withOrder };
    // A 0.24.0 work order made for the day and closed without a protocol (färdigställd or Utgår) has handled its occurrence;
    // the round's work order for a period never closes an occurrence by itself.
    if (order?.occurrence && (order.status === "COMPLETED" || order.status === "CANCELLED")) return { date: day, state: "done", ...withOrder };
    const marked = notDone.get(day);
    if (marked) return { date: day, state: "not_done", notDone: marked, ...withOrder };
    // Utgått (2026-10-28): the protocol was set to Utgår, so the day is not handled – late like a missed one once due.
    if (round) return { date: day, state: "cancelled", cancelledTaskId: round.taskId, late: fallback === "missed", ...withOrder };
    return { date: day, state: fallback, ...withOrder };
  };
  // Today's occurrence is due until the round's klockslag has passed, then missed (försenad) like a past one (2026-10-28).
  const todayState = scheduleOccurrences(rule, today, today).length ? state(today, occurrenceLate(rule, today, today, options.now) ? "missed" : "due") : null;
  // Far enough ahead that a long interval (a control repeated every 24 or 36 months) still has a next date.
  const horizon = 400 + (rule.frequency === "MONTHLY" ? rule.interval * 31 : rule.frequency === "WEEKLY" ? rule.interval * 7 : rule.interval);
  const shown = options.upcoming ?? 5;
  // A round can be started ahead of its day ("planering är bara en planering", 2026-10-07): the occurrence then has a
  // protocol and counts as started or done, so the next one is the first coming day still without one. The scan reaches
  // past as many days as have a protocol already, so it never stops on a day that is done.
  const early = rounds.filter((round) => round.occurrence > today && round.status !== "CANCELLED").length;
  const coming = scheduleOccurrences(rule, addDays(today, 1), addDays(today, horizon), shown + early + 1).map((day) => state(day, "upcoming"));
  const upcoming = coming.slice(0, shown);
  const history = past.map((day) => state(day, "missed")).reverse();
  // A coming occurrence started ahead stays the next one until its protocol is completed (2026-10-07: the card offered
  // Starta nu for the occurrence after it, and the started protocol was only reachable from a small date chip).
  const ahead = coming.find((item) => !occurrenceHandled(item)) ?? null;
  return {
    today: todayState,
    upcoming,
    history,
    // Försenat: missed, or utgått after its time; Ej utfört is handled and never counted (2026-10-28).
    missed: history.filter(occurrenceOverdue).length + (todayState && occurrenceOverdue(todayState) ? 1 : 0),
    /** Ej utfört in the window, today included: the follow-up on Driftronder and the dashboard (2026-10-28). */
    notDone: history.filter((item) => item.state === "not_done").length + (todayState?.state === "not_done" ? 1 : 0),
    openDeviations: [...history, ...(todayState ? [todayState] : [])].reduce((sum, item) => sum + (item.openDeviations ?? 0), 0),
    // The occurrence to start now: today's when it is not done, else the latest missed one within the window.
    // Ej utfört is handled like done (2026-10-28); an utgått day is still open and is started again from here.
    current: todayState && !occurrenceHandled(todayState) ? todayState : history.find((item) => occurrenceOverdue(item) || item.state === "started") ?? null,
    next: ahead?.date ?? null,
    /** The protocol of the next occurrence when it was started ahead and is not completed yet (Fortsätt rond). */
    nextTaskId: ahead?.state === "started" ? ahead.taskId ?? null : null,
    /** Every occurrence in the window whose protocol exists and is not completed: the jobs a scanned QR label may open (2026-10-22). */
    // Read from the protocols themselves (an occurrence may have more than one), within the same past window; a cancelled one is no job to open.
    started: rounds.filter((round) => round.status !== "COMPLETED" && round.status !== "CANCELLED" && round.occurrence >= addDays(today, -(options.pastDays ?? 30)))
      .map((round) => ({ date: round.occurrence, taskId: round.taskId })).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/** An occurrence on a date chip: "7 okt.", with the year when it is not this year ("7 okt. 2028", 2026-10-07). */
export function occurrenceChipDate(date: string, today: string) {
  return formatSwedish(`${date}T12:00:00`, { day: "numeric", month: "short", ...(date.slice(0, 4) !== today.slice(0, 4) ? { year: "numeric" } : {}) });
}

/** The rule in words: "Dagligen", "Var 2:a dag", "Veckovis mån, tors", "Var 3:e månad den 15". */
export function scheduleRuleText(rule: FormScheduleRule) {
  const every = (unit: string, plural: string) => rule.interval === 1 ? unit : `Var ${rule.interval}:${rule.interval % 10 === 1 || rule.interval % 10 === 2 ? "a" : "e"} ${plural}`;
  const names = ["mån", "tis", "ons", "tors", "fre", "lör", "sön"];
  // Klockslag and beräknad tid (2026-10-28) follow the rhythm: "Veckovis mån kl. 07:00, ca 30 min".
  const clock = roundTimeText(rule) ? ` ${roundTimeText(rule)}` : "";
  const times = `${clock}${rule.count ? `, ${rule.count} gånger` : ""}`;
  if (rule.frequency === "DAILY") return every("Dagligen", "dag") + times;
  if (rule.frequency === "WEEKLY") return `${every("Veckovis", "vecka")} ${(rule.weekdays.length ? [...rule.weekdays].sort() : [isoWeekday(rule.startDate)]).map((day) => names[day - 1]).join(", ")}${times}`;
  const monthly = rule.monthWeek !== undefined && rule.monthWeekday !== undefined
    ? `${every("Månadsvis", "månad")} ${MONTH_WEEK_WORD[rule.monthWeek]} ${names[rule.monthWeekday - 1]}` : `${every("Månadsvis", "månad")} den ${Number(rule.startDate.slice(8, 10))}`;
  return `${monthly}${times}`;
}

const MONTH_WEEK_WORD: Record<MonthWeek, string> = { 1: "första", 2: "andra", 3: "tredje", 4: "fjärde", [-1]: "sista" } as Record<MonthWeek, string>;
const WEEKDAY_NAMES = ["måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag", "söndag"];
const MONTH_SHORT = ["jan", "feb", "mars", "apr", "maj", "juni", "juli", "aug", "sep", "okt", "nov", "dec"];
const MONTH_LONG = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
/** A Swedish ordinal: 1:a, 2:a, 3:e … 11:e, 12:e … 21:a, 22:a. */
export const swedishOrdinal = (value: number) => `${value}:${value % 10 <= 2 && value % 10 >= 1 && value % 100 !== 11 && value % 100 !== 12 ? "a" : "e"}`;
/** "14 okt 2026" – the short day the rule's sentence uses. */
export const ruleDayText = (day: string) => `${Number(day.slice(8, 10))} ${MONTH_SHORT[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;
const listWords = (words: string[]) => words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} och ${words[words.length - 1]}`;
/** The weekdays a weekly rule is done on, sorted: its own, else the start date's. */
export const ruleWeekdays = (rule: Pick<FormScheduleRule, "weekdays" | "startDate">) => rule.weekdays.length ? [...new Set(rule.weekdays)].sort((a, b) => a - b) : [isoWeekday(rule.startDate)];
/** The ISO weekday (1 Monday – 7 Sunday) of a day. */
export const weekdayOf = (day: string) => isoWeekday(day);
/** Which of the month's weekdays a day is: 1–4, or -1 when it is the month's last (the 29th–31st). */
export function monthWeekOf(day: string): MonthWeek {
  const date = Number(day.slice(8, 10));
  return date > 28 ? -1 : (Math.ceil(date / 7) as 1 | 2 | 3 | 4);
}

/**
 * "Hur ofta" in plain words (2026-10-27): what the rule does, from when and until when – "Varje vardag från 14 okt
 * 2026, tills vidare", "Varannan vecka på måndag och torsdag från …", "Den 14:e varje månad från … till 31 dec 2027",
 * "Första måndagen varje månad från …, 10 gånger", "Varje år den 14 oktober från …". The same rule engine as the occurrences.
 */
export function scheduleRuleSentence(rule: FormScheduleRule) {
  const every = (unit: string) => rule.interval === 1 ? `varje ${unit}` : rule.interval === 2 ? `varannan ${unit}` : `var ${swedishOrdinal(rule.interval)} ${unit}`;
  const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
  let what: string;
  if (rule.frequency === "DAILY") what = capital(every("dag"));
  else if (rule.frequency === "WEEKLY") {
    const days = ruleWeekdays(rule);
    what = rule.interval === 1 && days.join() === "1,2,3,4,5" ? "Varje vardag" : `${capital(every("vecka"))} på ${listWords(days.map((day) => WEEKDAY_NAMES[day - 1]!))}`;
  } else if (rule.monthWeek !== undefined && rule.monthWeekday !== undefined) {
    what = `${capital(MONTH_WEEK_WORD[rule.monthWeek])} ${WEEKDAY_NAMES[rule.monthWeekday - 1]}en ${every("månad")}`;
  } else if (rule.interval === 12) {
    what = `Varje år den ${Number(rule.startDate.slice(8, 10))} ${MONTH_LONG[Number(rule.startDate.slice(5, 7)) - 1]}`;
  } else what = `Den ${swedishOrdinal(Number(rule.startDate.slice(8, 10)))} ${every("månad")}`;
  const end = rule.endDate ? ` till ${ruleDayText(rule.endDate)}` : rule.count ? `, ${rule.count} ${rule.count === 1 ? "gång" : "gånger"}` : ", tills vidare";
  // "Varje vardag kl. 07:00, ca 30 min, från 14 okt 2026, tills vidare" (2026-10-28); without them as before.
  const clock = roundTimeText(rule);
  return `${what}${clock ? ` ${clock},` : ""} från ${ruleDayText(rule.startDate)}${end}`;
}

/** The next occurrences of a rule from a day on (the start date when it lies ahead): "Nästa tillfällen", at most `count`. */
export function upcomingOccurrences(rule: FormScheduleRule, from: string, count = 8) {
  const start = from > rule.startDate ? from : rule.startDate;
  return scheduleOccurrences(rule, start, addDays(start, 3700), count);
}

/** The quick choices of "Hur ofta" (2026-10-27): each is a rule of the same engine; Eget opens interval and unit. */
export const SCHEDULE_PRESETS = [
  { id: "day", label: "Varje dag" }, { id: "weekday", label: "Varje vardag" }, { id: "week", label: "Varje vecka" }, { id: "biweekly", label: "Varannan vecka" },
  { id: "month", label: "Varje månad" }, { id: "year", label: "Varje år" }, { id: "custom", label: "Eget" },
] as const;
export type SchedulePreset = (typeof SCHEDULE_PRESETS)[number]["id"];

/** The quick choice a rule reads as (a saved rule opens on it), or Eget. */
export function schedulePresetOf(rule: FormScheduleRule): SchedulePreset {
  if (rule.frequency === "DAILY") return rule.interval === 1 ? "day" : "custom";
  if (rule.frequency === "WEEKLY") return rule.interval === 1 ? (ruleWeekdays(rule).join() === "1,2,3,4,5" ? "weekday" : "week") : rule.interval === 2 ? "biweekly" : "custom";
  return rule.interval === 1 ? "month" : rule.interval === 12 && rule.monthWeek === undefined ? "year" : "custom";
}

/** A rule with a quick choice applied: the start date and the end stay; a weekly choice keeps the chosen weekdays. */
export function applySchedulePreset(rule: FormScheduleRule, preset: Exclude<SchedulePreset, "custom">): FormScheduleRule {
  const base = { ...rule, monthWeek: undefined, monthWeekday: undefined };
  const weekdays = rule.frequency === "WEEKLY" && ruleWeekdays(rule).join() !== "1,2,3,4,5" ? ruleWeekdays(rule) : [isoWeekday(rule.startDate)];
  if (preset === "day") return { ...base, frequency: "DAILY", interval: 1, weekdays: [] };
  if (preset === "weekday") return { ...base, frequency: "WEEKLY", interval: 1, weekdays: [1, 2, 3, 4, 5] };
  if (preset === "week" || preset === "biweekly") return { ...base, frequency: "WEEKLY", interval: preset === "week" ? 1 : 2, weekdays };
  if (preset === "month") return { ...rule, frequency: "MONTHLY", interval: 1, weekdays: [], ...(rule.frequency === "MONTHLY" ? {} : { monthWeek: undefined, monthWeekday: undefined }) };
  return { ...base, frequency: "MONTHLY", interval: 12, weekdays: [] };
}

/** The round a protocol was started from, read from its answers (`values.round`). */
export function taskRound(task: { id: string; status: string; data: unknown }): (ScheduleRound & { scheduleId: string }) | null {
  const round = (task.data as { details?: { values?: { round?: { scheduleId?: unknown; occurrence?: unknown } | null } } } | null)?.details?.values?.round;
  if (!round || typeof round.scheduleId !== "string" || typeof round.occurrence !== "string") return null;
  const details = (task.data as { details?: { document?: unknown; values?: unknown } } | null)?.details;
  const document = formDocumentSchema.safeParse(details?.document);
  const values = formValuesSchema.safeParse(details?.values);
  return { scheduleId: round.scheduleId, occurrence: round.occurrence, taskId: task.id, status: task.status, openDeviations: document.success && values.success ? formRowsWithoutOrder(document.data, values.data) : 0 };
}

export type ScheduleView = FormSchedule & { overview: ReturnType<typeof scheduleOverview>; ruleText: string;
  /**
   * The work order that holds the round now (2026-10-27 kväll): the one whose period holds today, else the one of the
   * occurrence to start (a missed day), else of the next one. Where the round is done is read from it; null: "Ingen arbetsorder".
   */
  holder: RoundOrderRef | null };

/** The work order that holds a round now: today's, else the current occurrence's, else the next one's. */
export function roundHolderNow(orders: readonly RoundOrderRef[], scheduleId: string, overview: Pick<ReturnType<typeof scheduleOverview>, "current" | "next">, today: string): RoundOrderRef | null {
  return roundOrderForDay(orders, scheduleId, today) ?? (overview.current ? roundOrderForDay(orders, scheduleId, overview.current.date) : null)
    ?? (overview.next ? roundOrderForDay(orders, scheduleId, overview.next) : null);
}

/** Where a round is done as a list shows it: the holding work order's place (its temporary place marked), or "Ingen arbetsorder". */
export function roundWhereLabel(holder: RoundOrderPlace | null | undefined) {
  if (!holder) return ROUND_NO_WORK_ORDER;
  return listPlaceLabel(holder.facilityName, holder.tempPlace) || holder.customerName || "";
}

/** The holding work order's place on the map: the register place's position, else the pin of its temporary place. */
export function roundPosition(holder: RoundOrderPlace | null | undefined) {
  return holder ? holder.facilityPosition ?? tempPlacePosition(holder.tempPlace) : null;
}

export const ROUND_FORM_UNPUBLISHED = "Formuläret är inte publicerat";
export const ROUND_FORM_REMOVED = "Formuläret är borttaget";
/**
 * Why a round cannot be started, or null when it can (2026-10-24, analysens fråga 2: "Markera och dölj Starta"):
 * Driftronder, the calendar, the phone's screen and the QR question show this warning instead of Starta until the form is
 * published again or the round gets another form. A protocol already started still opens.
 */
export function roundFormNotice(schedule: Pick<FormSchedule, "templateMissing" | "templateUnpublished">): string | null {
  if (!schedule.templateMissing) return null;
  return schedule.templateUnpublished ? ROUND_FORM_UNPUBLISHED : ROUND_FORM_REMOVED;
}

/** Every schedule with its overview for today, from the protocols that carry a round – the same in Cloud, Local and the demo. */
export function scheduleViews(schedules: FormSchedule[], tasks: { id: string; status: string; data: unknown }[], today: string, orders: readonly RoundOrderRef[] = [], /** Swedish "HH:MM" now: a round with a klockslag is late today once it has passed. */ now?: string | null,
  /** Ej utfört (2026-10-28, Cloud only): the rounds' active outcomes, each with its round. */ notDone: readonly (RoundNotDone & { scheduleId: string })[] = []): ScheduleView[] {
  const rounds = new Map<string, ScheduleRound[]>();
  for (const task of tasks) {
    const round = taskRound(task);
    if (round) rounds.set(round.scheduleId, [...(rounds.get(round.scheduleId) ?? []), round]);
  }
  return schedules.map((schedule) => {
    const own = orders.filter((order) => order.scheduleId === schedule.id);
    const overview = scheduleOverview(schedule.rule, rounds.get(schedule.id) ?? [], today, { now, notDone: notDone.filter((item) => item.scheduleId === schedule.id) }, own);
    return { ...schedule, ruleText: scheduleRuleText(schedule.rule), overview, holder: roundHolderNow(own, schedule.id, overview, today) };
  })
    // Due today or missed first, then by the next occurrence.
    .sort((a, b) => Number(Boolean(b.active && b.overview.current)) - Number(Boolean(a.active && a.overview.current)) || String(a.overview.next ?? "9999").localeCompare(String(b.overview.next ?? "9999")) || a.title.localeCompare(b.title, "sv"));
}

/** Who a round's reminder is for: its responsible person, or the company's administrators when none is chosen. */
export function roundReminderFor(schedule: Pick<FormSchedule, "assignedToUserId">, user: { id: string; admin: boolean }) {
  return schedule.assignedToUserId ? schedule.assignedToUserId === user.id : user.admin;
}

/**
 * The rounds to remind about now (2026-09-30): an active round with the bell on whose occurrence today is not
 * done, or whose latest occurrence within the window was missed or left unfinished. An administrator sees the team's
 * rounds, like the other reminders; anyone else the rounds they are responsible for.
 */
export function roundNotifications(views: ScheduleView[], user: { id: string; admin: boolean }, today: string) {
  return views.flatMap((view) => {
    const current = view.overview.current;
    if (!view.active || !current || !(view.reminders ?? defaultScheduleReminders).bell) return [];
    if (!(user.admin || roundReminderFor(view, user))) return [];
    return [{
      id: `ROUND:${view.id}:${current.date}`,
      title: view.title,
      kind: "ROUND" as const,
      href: current.taskId ? `/?view=workflow_task&taskId=${encodeURIComponent(current.taskId)}&taskType=FORM` : current.workOrderId ? `/?view=workflow_task&taskId=${encodeURIComponent(current.workOrderId)}&taskType=WORK_ORDER` : "/?view=rounds",
      dueDate: current.date,
      // Late before today, or today once the round's klockslag has passed (2026-10-28); the reminder itself still comes in the morning.
      deadline: current.date < today || occurrenceOverdue(current) ? "OVERDUE" as const : "DUE_SOON" as const,
      needsAction: false,
    }];
  });
}

/**
 * The link that starts (or continues) a round: the form's editor with the schedule, the day and the round's responsible
 * person, in the round's work order for the day (`workOrderId`; without one the round page offers to make it first). The
 * customer, place, temporary place and project are the work order's (2026-10-27 kväll): the protocol takes them when
 * it is started in it – the page and the server both – so the link carries none of them.
 * `scanPlace`: the place whose QR label was scanned (2026-10-04), so the protocol opens at its point and records it.
 */
export function roundHref(schedule: Pick<FormSchedule, "id" | "templateId" | "title"> & Partial<Pick<FormSchedule, "assignedToUserId" | "assignedToName">>, occurrence: { date: string; taskId?: string | null; workOrderId?: string | null }, scanPlace?: string) {
  const scan = scanPlace ? `&scanPlace=${encodeURIComponent(scanPlace)}` : "";
  if (occurrence.taskId) return `/?view=workflow_task&taskType=FORM&taskId=${encodeURIComponent(occurrence.taskId)}${scan}`;
  // The protocol is named after the round and its day, so rounds of the same form can be told apart (F14, 2026-09-29).
  const params = new URLSearchParams({ view: "workflow_task", taskType: "FORM", formId: schedule.templateId, scheduleId: schedule.id, occurrence: occurrence.date, roundTitle: schedule.title });
  if (occurrence.workOrderId) params.set("workOrderId", occurrence.workOrderId);
  // The round's responsible person is the protocol's (2026-10-07), so a round started by someone else keeps its owner.
  if (schedule.assignedToUserId) { params.set("assignedTo", schedule.assignedToUserId); if (schedule.assignedToName) params.set("assignedToName", schedule.assignedToName.slice(0, 160)); }
  if (scanPlace) params.set("scanPlace", scanPlace);
  return `/?${params}`;
}

/** A day plus whole months; the month's last day when it is shorter (31 January + 1 → 28/29 February). */
export function addMonths(value: string, months: number) {
  const month = Number(value.slice(5, 7)) - 1 + months;
  const year = Number(value.slice(0, 4)) + Math.floor(month / 12);
  const index = ((month % 12) + 12) % 12;
  const day = Math.min(Number(value.slice(8, 10)), daysInMonth(year, index));
  return `${year}-${String(index + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The default interval of "Upprepa kontrollen" when the form has no interval of its own. */
export const DEFAULT_REPEAT_MONTHS = 12;

/**
 * The form's own control interval in months (2026-10-06, "Upprepa kontrollen"): a number field counted in months whose
 * label says interval, read from the protocol's answer or else its default. Null when the form has none.
 */
export function formIntervalMonths(document: unknown, values: unknown): number | null {
  const parsed = formDocumentSchema.safeParse(document);
  if (!parsed.success) return null;
  const field = formLeafBlocks(parsed.data).find((block): block is FormFieldBlock => block.type === "field" && block.input === "number"
    && /^mån/i.test(block.unit ?? "") && /intervall/i.test(block.label));
  if (!field) return null;
  const answer = (values as { fields?: Record<string, unknown> } | null)?.fields?.[field.key];
  for (const candidate of [answer, field.defaultValue]) {
    const months = typeof candidate === "number" ? candidate : typeof candidate === "string" && candidate.trim() ? Number(candidate.replace(",", ".")) : NaN;
    if (Number.isInteger(months) && months >= 1 && months <= 366) return months;
  }
  return null;
}

/**
 * "Upprepa kontrollen" (2026-10-06): a completed protocol becomes a monthly round of the same form with the same responsible
 * person, every N months (the form's interval, else 12), the first one interval from today. The person may change it before
 * saving; nothing is stored until then. Where it is done is not the round's (2026-10-27 kväll): the work order made
 * for the round when its time comes brings the customer and the place.
 */
export function repeatScheduleDraft(task: { title: string; assignedToUserId: string | null; assignedToName: string;
  data: { details: { templateId: string; templateName?: string; document?: unknown; values?: unknown } } }, today: string): FormScheduleInput {
  const months = formIntervalMonths(task.data.details.document, task.data.details.values) ?? DEFAULT_REPEAT_MONTHS;
  return {
    title: (task.title.trim() || task.data.details.templateName || "Återkommande kontroll").slice(0, 200), templateId: task.data.details.templateId,
    assignedToUserId: task.assignedToUserId ?? null, assignedToName: task.assignedToName ?? "", active: true,
    rule: { frequency: "MONTHLY", interval: months, weekdays: [], startDate: addMonths(today, months), endDate: "" },
    reminders: { ...defaultScheduleReminders },
  };
}
