import { z } from "zod";
import { formDocumentSchema, formRowsWithoutOrder, formValuesSchema } from "./form-document";

/**
 * Återkommande kontroller – driftronder (2026-09-28). A schedule says which form is filled in, where and how often:
 * every N days, on chosen weekdays every N weeks, or on a day of the month every N months. Occurrences are calendar
 * days (Swedish time, "YYYY-MM-DD") computed by this pure function in Cloud, Local and the demo alike. No protocols are
 * made in advance: a round is started from an occurrence and the protocol carries the schedule and the day
 * (`values.round`), which is how an occurrence counts as done.
 */
export const SCHEDULE_FREQUENCIES = ["DAILY", "WEEKLY", "MONTHLY"] as const;
export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];
export const SCHEDULE_FREQUENCY_LABEL: Record<ScheduleFrequency, string> = { DAILY: "Dagligen", WEEKLY: "Veckovis", MONTHLY: "Månadsvis" };
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ange ett datum.");

export const formScheduleRuleSchema = z.object({
  frequency: z.enum(SCHEDULE_FREQUENCIES).default("DAILY"),
  // Every N days, weeks or months ("anpassat intervall").
  interval: z.number().int().min(1).max(366).default(1),
  // Weekly: ISO weekdays 1 (Monday) – 7 (Sunday); empty = the start date's weekday.
  weekdays: z.array(z.number().int().min(1).max(7)).max(7).default([]),
  startDate: date,
  endDate: date.or(z.literal("")).default(""),
}).refine((rule) => !rule.endDate || rule.endDate >= rule.startDate, { message: "Slutdatum kan inte vara före startdatum.", path: ["endDate"] });
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

export const formScheduleInputSchema = z.object({
  id: z.string().min(1).max(100).optional(),
  version: z.number().int().min(0).optional(),
  title: z.string().trim().min(1, "Ange ett namn på ronden.").max(200),
  templateId: z.string().min(1).max(100),
  customerId: z.string().min(1).max(100).nullable().default(null),
  facilityId: z.string().min(1).max(100).nullable().default(null),
  projectId: z.string().min(1).max(100).nullable().default(null),
  assignedToUserId: z.string().min(1).max(100).nullable().default(null),
  assignedToName: z.string().trim().max(160).default(""),
  active: z.boolean().default(true),
  rule: formScheduleRuleSchema,
  reminders: formScheduleRemindersSchema.default(defaultScheduleReminders),
});
export type FormScheduleInput = z.infer<typeof formScheduleInputSchema>;
export type FormSchedule = FormScheduleInput & { id: string; version: number; templateName?: string; facilityName?: string; customerName?: string; projectName?: string; createdAt?: string; updatedAt?: string };

const DAY = 86_400_000;
const toTime = (value: string) => Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
const toDate = (time: number) => new Date(time).toISOString().slice(0, 10);
export const addDays = (value: string, days: number) => toDate(toTime(value) + days * DAY);
const isoWeekday = (value: string) => ((new Date(toTime(value)).getUTCDay() + 6) % 7) + 1;
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/** The occurrences of a rule from `from` to `to` (both included), at most `limit`. */
export function scheduleOccurrences(rule: FormScheduleRule, from: string, to: string, limit = 400): string[] {
  const start = from > rule.startDate ? from : rule.startDate;
  const end = rule.endDate && rule.endDate < to ? rule.endDate : to;
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
  // Monthly: the start date's day of the month, or the month's last day when it is shorter (31 → 30 April).
  const dayOfMonth = Number(rule.startDate.slice(8, 10));
  const baseYear = Number(rule.startDate.slice(0, 4));
  const baseMonth = Number(rule.startDate.slice(5, 7)) - 1;
  for (let step = 0; out.length < limit; step += rule.interval) {
    const year = baseYear + Math.floor((baseMonth + step) / 12);
    const month = (baseMonth + step) % 12;
    const candidate = `${year}-${String(month + 1).padStart(2, "0")}-${String(Math.min(dayOfMonth, daysInMonth(year, month))).padStart(2, "0")}`;
    if (candidate > end) break;
    if (candidate >= start) out.push(candidate);
  }
  return out;
}

/** The next occurrence on or after a day, or null when the schedule has ended. */
export function nextOccurrence(rule: FormScheduleRule, from: string) {
  return scheduleOccurrences(rule, from, addDays(from, 800), 1)[0] ?? null;
}

export type ScheduleRound = { taskId: string; status: string; occurrence: string; /** Deviation rows still without a work order (2026-10-02: a round with a fault looked fine). */ openDeviations?: number };
export type ScheduleOccurrenceState = { date: string; state: "done" | "started" | "missed" | "due" | "upcoming"; taskId?: string; openDeviations?: number };

/**
 * An overview of one schedule: the recent past (done, started or missed), today and the next occurrences. "Missed"
 * is a past occurrence without a protocol; an occurrence with a protocol that is not completed is "started".
 */
export function scheduleOverview(rule: FormScheduleRule, rounds: ScheduleRound[], today: string, options: { pastDays?: number; upcoming?: number } = {}) {
  const byDay = new Map(rounds.map((round) => [round.occurrence, round]));
  const past = scheduleOccurrences(rule, addDays(today, -(options.pastDays ?? 30)), addDays(today, -1));
  const state = (day: string, fallback: ScheduleOccurrenceState["state"]): ScheduleOccurrenceState => {
    const round = byDay.get(day);
    return round ? { date: day, state: round.status === "COMPLETED" ? "done" : "started", taskId: round.taskId, openDeviations: round.openDeviations ?? 0 } : { date: day, state: fallback };
  };
  const todayState = scheduleOccurrences(rule, today, today).length ? state(today, "due") : null;
  const upcoming = scheduleOccurrences(rule, addDays(today, 1), addDays(today, 400), options.upcoming ?? 5).map((day) => state(day, "upcoming"));
  const history = past.map((day) => state(day, "missed")).reverse();
  return {
    today: todayState,
    upcoming,
    history,
    missed: history.filter((item) => item.state === "missed").length,
    openDeviations: [...history, ...(todayState ? [todayState] : [])].reduce((sum, item) => sum + (item.openDeviations ?? 0), 0),
    // The occurrence to start now: today's when it is not done, else the latest missed one within the window.
    current: todayState && todayState.state !== "done" ? todayState : history.find((item) => item.state === "missed" || item.state === "started") ?? null,
    next: upcoming[0]?.date ?? null,
  };
}

/** The rule in words: "Dagligen", "Var 2:a dag", "Veckovis mån, tors", "Var 3:e månad den 15". */
export function scheduleRuleText(rule: FormScheduleRule) {
  const every = (unit: string, plural: string) => rule.interval === 1 ? unit : `Var ${rule.interval}:${rule.interval % 10 === 1 || rule.interval % 10 === 2 ? "a" : "e"} ${plural}`;
  const names = ["mån", "tis", "ons", "tors", "fre", "lör", "sön"];
  if (rule.frequency === "DAILY") return every("Dagligen", "dag");
  if (rule.frequency === "WEEKLY") return `${every("Veckovis", "vecka")} ${(rule.weekdays.length ? [...rule.weekdays].sort() : [isoWeekday(rule.startDate)]).map((day) => names[day - 1]).join(", ")}`;
  return `${every("Månadsvis", "månad")} den ${Number(rule.startDate.slice(8, 10))}`;
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

export type ScheduleView = FormSchedule & { overview: ReturnType<typeof scheduleOverview>; ruleText: string };

/** Every schedule with its overview for today, from the protocols that carry a round – the same in Cloud, Local and the demo. */
export function scheduleViews(schedules: FormSchedule[], tasks: { id: string; status: string; data: unknown }[], today: string): ScheduleView[] {
  const rounds = new Map<string, ScheduleRound[]>();
  for (const task of tasks) {
    const round = taskRound(task);
    if (round) rounds.set(round.scheduleId, [...(rounds.get(round.scheduleId) ?? []), round]);
  }
  return schedules.map((schedule) => ({ ...schedule, ruleText: scheduleRuleText(schedule.rule), overview: scheduleOverview(schedule.rule, rounds.get(schedule.id) ?? [], today) }))
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
      href: current.taskId ? `/?view=workflow_task&taskId=${encodeURIComponent(current.taskId)}&taskType=FORM` : "/?view=rounds",
      dueDate: current.date,
      deadline: current.date < today ? "OVERDUE" as const : "DUE_SOON" as const,
      needsAction: false,
    }];
  });
}
