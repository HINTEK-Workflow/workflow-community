import { z } from "zod";
import { swedishDate, swedishParts } from "@/lib/swedish-time";
import { countsInPlanning } from "@/lib/workflow/absence";
import { isWorkday } from "@/lib/workflow/schedule";

/**
 * Tidsperiod (2026-10-30): a person's month of time is sent in and approved before it goes to payroll. Pure rules here;
 * Cloud in lib/workflow/time-periods-server.ts, the demo in features/demo/demo-time-periods.ts.
 *
 * - The person sends in their own month (Skicka in) → SUBMITTED. Refused for a future month and while the person has a running
 *   timer that started in the month.
 * - An approver approves (Godkänn) → APPROVED, or returns it with a note (Skicka tillbaka) → RETURNED. An approver may reopen an
 *   approved month with a note (Öppna igen) → RETURNED. RETURNED is open again; the person can send in again.
 * - SUBMITTED and APPROVED are locked: no time entry of the person whose start falls in the month (Swedish time) is created,
 *   changed, moved into or out of it, or removed.
 * - Who approves: admins and the Teamet right (team:read) – the same people who see the team's time and register others'
 *   absence (lib/workflow/permissions.ts canViewTeam). Nobody approves their own month, except when nobody else in the
 *   company may approve (a one-person company, or an admin alone with members who lack the right): then sending in approves
 *   at once, and the same person may reopen it.
 * - No row = open. A month opened again by an approver (Öppna igen) is stored as RETURNED without submittedAt and shown as not
 *   sent in (shownStatus, användartest 2026-11-01 PL8); one sent back (Skicka tillbaka) is shown as Tillbakaskickad.
 * - Påminn (beslut 13, 2026-11-01): an approver reminds a person whose month is not sent in; a notice in the bell, one per person
 *   and month a day.
 */
export const TIME_PERIOD_STATUSES = ["SUBMITTED", "APPROVED", "RETURNED"] as const;
export type TimePeriodStatus = (typeof TIME_PERIOD_STATUSES)[number];
/** The status shown: OPEN when there is no row. */
export type TimePeriodView = TimePeriodStatus | "OPEN";
export const TIME_PERIOD_ACTIONS = ["submit", "approve", "return", "reopen"] as const;
export type TimePeriodAction = (typeof TIME_PERIOD_ACTIONS)[number];
export const TIME_PERIOD_NOTE_MAX = 500;

export const TIME_PERIOD_LABELS: Record<TimePeriodView, string> = { OPEN: "Ej inskickad", SUBMITTED: "Inskickad", APPROVED: "Godkänd", RETURNED: "Tillbakaskickad" };
export const TIME_PERIOD_TONES: Record<TimePeriodView, "neutral" | "info" | "success" | "warning"> = { OPEN: "neutral", SUBMITTED: "info", APPROVED: "success", RETURNED: "warning" };

export const timePeriodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Ange månaden som ÅÅÅÅ-MM.");
export const timePeriodInputSchema = z.object({
  action: z.enum(TIME_PERIOD_ACTIONS),
  period: timePeriodSchema,
  /** The person whose month it is; left out = oneself. */
  userId: z.string().min(1).max(100).optional(),
  note: z.string().trim().max(TIME_PERIOD_NOTE_MAX, `Kommentaren får vara högst ${TIME_PERIOD_NOTE_MAX} tecken.`).default(""),
});
export type TimePeriodInput = z.infer<typeof timePeriodInputSchema>;
/** Påminn has no status of its own, so it stands beside the actions. */
export const timePeriodRemindSchema = z.object({ action: z.literal("remind"), period: timePeriodSchema, userId: z.string().min(1).max(100) });

export class TimePeriodError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const pad = (value: number) => String(value).padStart(2, "0");
/** The Swedish month a moment belongs to, YYYY-MM. */
export function periodOf(value: Date | string | number) {
  const parts = swedishParts(value instanceof Date ? value : new Date(value));
  return `${parts.year}-${pad(parts.month)}`;
}
/** The month's bounds in Swedish time: [startsAt, endsAt). */
export function periodBounds(period: string) {
  const [year, month] = period.split("-").map(Number);
  return { startsAt: swedishDate(year, month, 1), endsAt: swedishDate(year, month + 1, 1) };
}
/** The month a number of months away (YYYY-MM). */
export function addPeriods(period: string, months: number) {
  const [year, month] = period.split("-").map(Number);
  const index = year * 12 + (month - 1) + months;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}
const MONTHS = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
/** "oktober 2026". */
export function periodLabel(period: string) {
  const [year, month] = period.split("-").map(Number);
  return `${MONTHS[month - 1] ?? ""} ${year}`;
}

/** The status a person's row shows: a month opened again (no longer sent in) reads as not sent in. */
export const shownStatus = (status: string | null | undefined, submittedAt: unknown): TimePeriodView => (status === "RETURNED" && !submittedAt ? "OPEN" : viewOf(status));

/** Who may be reminded, and the refusal otherwise. `current`: the stored status. */
export function remindRefusal(input: { current: string | null | undefined; period: string; now: Date; own: boolean; person: string }): TimePeriodError | null {
  const month = periodLabel(input.period);
  if (input.own) return new TimePeriodError(409, "Du kan inte påminna dig själv.");
  if (input.period > periodOf(input.now)) return new TimePeriodError(409, `${capital(month)} har inte börjat.`);
  if (viewOf(input.current) === "SUBMITTED") return new TimePeriodError(409, `${input.person} har redan skickat in ${month}.`);
  if (viewOf(input.current) === "APPROVED") return new TimePeriodError(409, `${capital(month)} är redan godkänd.`);
  return null;
}

/** The month's days, YYYY-MM-DD. */
function daysOfPeriod(period: string) {
  const [year, month] = period.split("-").map(Number);
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: count }, (_, index) => `${period}-${pad(index + 1)}`);
}
type MonthAbsence = { from: string; to: string; status?: string | null; hours?: { start: string; end: string } | null };
const clockMinutes = (clock: string) => { const [hour, minute] = clock.split(":").map(Number); return hour * 60 + minute; };
/** The share of a day (0–1) the absences take. Only approved absence counts, as in planning. */
function awayShare(absences: readonly MonthAbsence[], day: string, dayMinutes: number) {
  const absence = absences.find((item) => item.from <= day && item.to >= day && countsInPlanning(item));
  if (!absence) return 0;
  if (!absence.hours) return 1;
  return Math.min(1, Math.max(0, clockMinutes(absence.hours.end) - clockMinutes(absence.hours.start)) / Math.max(1, dayMinutes));
}
/** One person's workdays away in the month, as days (half a day 0,5). No type and no reason: only how much. */
export function absenceDaysInMonth(period: string, absences: readonly MonthAbsence[], dayMinutes = 480) {
  const total = daysOfPeriod(period).filter(isWorkday).reduce((sum, day) => sum + awayShare(absences, day, dayMinutes), 0);
  return Math.round(total * 10) / 10;
}

export type MonthGap = { expectedHours: number; emptyDays: number };
/**
 * What the warning before Skicka in says (PL8): the month's ordinary hours and the workdays so far with neither time nor a whole
 * day away. Null without fixed hours (weeklyMinutes null): nothing to compare with.
 */
export function monthGap(input: { period: string; today: string; weeklyMinutes: number | null; entryDays: ReadonlySet<string>; absences: readonly MonthAbsence[] }): MonthGap | null {
  if (input.weeklyMinutes === null) return null;
  const dayMinutes = input.weeklyMinutes / 5;
  const workdays = daysOfPeriod(input.period).filter(isWorkday);
  const expectedMinutes = workdays.reduce((sum, day) => sum + dayMinutes * (1 - awayShare(input.absences, day, dayMinutes)), 0);
  const emptyDays = workdays.filter((day) => day <= input.today && !input.entryDays.has(day) && awayShare(input.absences, day, dayMinutes) < 1).length;
  return { expectedHours: Math.round((expectedMinutes / 60) * 100) / 100, emptyDays };
}
/** The question before Skicka in, or null when nothing is missing. */
export function submitWarning(hours: number, gap: MonthGap | null) {
  if (!gap || gap.emptyDays <= 0) return null;
  const number = (value: number) => value.toLocaleString("sv-SE", { maximumFractionDigits: 2 });
  return `${number(hours)} h av ${number(gap.expectedHours)} h, ${gap.emptyDays} ${gap.emptyDays === 1 ? "dag" : "dagar"} utan tid. Skicka ändå?`;
}

export const isLockedStatus = (status: string | null | undefined): status is "SUBMITTED" | "APPROVED" => status === "SUBMITTED" || status === "APPROVED";
export const viewOf = (status: string | null | undefined): TimePeriodView => (status && (TIME_PERIOD_STATUSES as readonly string[]).includes(status) ? status as TimePeriodStatus : "OPEN");

/** The error for a time change in a locked month; `own` says whether the person changes their own time. */
export function lockedPeriodMessage(period: string, status: "SUBMITTED" | "APPROVED", own: boolean) {
  const month = periodLabel(period);
  if (status === "APPROVED") return own ? `Din tid för ${month} är godkänd och låst. Be din chef att öppna månaden igen.` : `Tiden för ${month} är godkänd och låst. Öppna månaden igen först.`;
  return own ? `Din tid för ${month} är inskickad och låst. Be din chef att skicka tillbaka den.` : `Tiden för ${month} är inskickad och låst. Skicka tillbaka månaden först.`;
}

/** What a time change touches: the person and the start of each entry before and after the change. */
export type TimeTouch = { userId: string; startedAt: Date | string };
/** Each (person, month) a change touches, once, in a fixed order (the server locks them in this order). */
export function touchedPeriods(touches: readonly TimeTouch[]) {
  const keys = new Map<string, { userId: string; period: string }>();
  for (const touch of touches) {
    const period = periodOf(touch.startedAt);
    keys.set(`${touch.userId}:${period}`, { userId: touch.userId, period });
  }
  return [...keys.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
}
/** The first locked month among the touched ones, or null. `statusOf` gives the stored status (undefined = no row). */
export function lockedTouch(touches: readonly TimeTouch[], statusOf: (userId: string, period: string) => string | null | undefined) {
  for (const { userId, period } of touchedPeriods(touches)) {
    const status = statusOf(userId, period);
    if (isLockedStatus(status)) return { userId, period, status };
  }
  return null;
}

/**
 * The next status of a month, or a TimePeriodError. `actorIsOwner`: the actor's own month. `approver`: the actor may approve
 * (admin or Teamet right). `otherApprover`: someone else in the company, active, may approve this person's month.
 */
export function nextTimePeriodStatus(input: {
  action: TimePeriodAction; current: string | null | undefined; period: string; now: Date; note: string;
  actorIsOwner: boolean; approver: boolean; otherApprover: boolean; runningInPeriod: boolean;
}): { status: TimePeriodStatus; selfApproved?: boolean } {
  const current = viewOf(input.current);
  const month = periodLabel(input.period);
  if (input.action === "submit") {
    if (!input.actorIsOwner) throw new TimePeriodError(403, "Bara personen själv kan skicka in sin månad.");
    if (input.period > periodOf(input.now)) throw new TimePeriodError(409, `${capital(month)} har inte börjat. Skicka in den när månaden är slut.`);
    if (current === "SUBMITTED") throw new TimePeriodError(409, `${capital(month)} är redan inskickad.`);
    if (current === "APPROVED") throw new TimePeriodError(409, `${capital(month)} är redan godkänd.`);
    if (input.runningInPeriod) throw new TimePeriodError(409, `Du har en tid som går i ${month}. Stoppa den innan du skickar in.`);
    // Nobody else may approve (a one-person company): sending in approves at once.
    if (input.approver && !input.otherApprover) return { status: "APPROVED", selfApproved: true };
    return { status: "SUBMITTED" };
  }
  if (!input.approver) throw new TimePeriodError(403, "Du saknar behörighet att godkänna tid.");
  if (input.actorIsOwner && input.otherApprover) throw new TimePeriodError(403, "Du kan inte godkänna din egen tid. En annan chef gör det.");
  if (input.action === "approve") {
    if (current !== "SUBMITTED") throw new TimePeriodError(409, `${capital(month)} är inte inskickad.`);
    return { status: "APPROVED" };
  }
  if (!input.note) throw new TimePeriodError(422, input.action === "return" ? "Skriv varför tiden skickas tillbaka." : "Skriv varför månaden öppnas igen.");
  if (input.action === "return") {
    if (current !== "SUBMITTED") throw new TimePeriodError(409, `${capital(month)} är inte inskickad.`);
    return { status: "RETURNED" };
  }
  if (current !== "APPROVED") throw new TimePeriodError(409, `${capital(month)} är inte godkänd.`);
  return { status: "RETURNED" };
}
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The audit line of an action (no free text from people in it, only who, what and which month). */
export function timePeriodAuditText(action: TimePeriodAction, status: TimePeriodStatus, person: string, period: string) {
  const month = periodLabel(period);
  if (action === "submit") return status === "APPROVED" ? `Skickade in och godkände sin tid för ${month} (ingen annan kan godkänna).` : `Skickade in sin tid för ${month}.`;
  if (action === "approve") return `Godkände tiden för ${person}, ${month}.`;
  if (action === "return") return `Skickade tillbaka tiden för ${person}, ${month}.`;
  return `Öppnade ${person}s tid för ${month} igen.`;
}
export const TIME_PERIOD_REMIND_AUDIT = "time_period_remind";
export const timePeriodRemindAuditText = (person: string, period: string) => `Påminde ${person} om att skicka in tiden för ${periodLabel(period)}.`;
export const TIME_PERIOD_AUDIT_ACTION: Record<TimePeriodAction, string> = { submit: "time_period_submit", approve: "time_period_approve", return: "time_period_return", reopen: "time_period_reopen" };
export const TIME_PERIOD_DONE: Record<TimePeriodAction, string> = { submit: "Månaden är inskickad.", approve: "Tiden är godkänd.", return: "Tiden är tillbakaskickad.", reopen: "Månaden är öppen igen." };
