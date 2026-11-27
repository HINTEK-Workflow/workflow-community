import { z } from "zod";

/**
 * Frånvaro (2026-10-29: "så blir folk sjuka eller något akut händer … jourledigt"): sickness, VAB, holiday, leave,
 * on-call compensation, training, parental leave or an own reason, for whole days or some hours of one day (2026-10-29:
 * "frånvaro kan även vara timmar mitt på dagen"). Pure rules shared by the
 * demo, the server and the tests:
 * - who may register (everyone for themselves; admins and the Teamet right for anyone),
 * - who sees the type (the person and the Teamet right; everyone else only "Frånvarande" – no medical details are stored),
 * - what share of a day it takes (workdays only; some hours take their share of the day; what that does to the capacity is
 *   capacityInWindow's, lib/workflow/capacity-summary.ts),
 * - which planned work it touches (bookings and work orders), and who could take it over.
 * Nothing here moves work: a person decides (Byt person / Skjut upp / Låt vänta).
 */
// FLEX (frånvaro och lön, 2026-10-29): flexledighet is its own type, apart from komp, because time and payroll systems keep
// them as different balances with different time codes.
export const ABSENCE_TYPES = ["SICK", "VAB", "VACATION", "LEAVE", "COMP", "FLEX", "TRAINING", "PARENTAL", "OTHER"] as const;
export type AbsenceType = (typeof ABSENCE_TYPES)[number];
export const ABSENCE_LABELS: Record<AbsenceType, string> = {
  SICK: "Sjuk", VAB: "VAB", VACATION: "Semester", LEAVE: "Ledig", COMP: "Jourledig/komp", FLEX: "Flexledig", TRAINING: "Utbildning/kurs", PARENTAL: "Föräldraledig", OTHER: "Annan orsak",
};
/**
 * The state of an absence (frånvaro och lön, 2026-10-29). Only APPROVED takes capacity and touches planned work; an applied,
 * rejected or withdrawn absence from a payroll system is kept for traceability but planning ignores it. A manual absence is
 * approved when it is saved.
 */
export const ABSENCE_STATUSES = ["APPLIED", "APPROVED", "REJECTED", "WITHDRAWN"] as const;
export type AbsenceStatus = (typeof ABSENCE_STATUSES)[number];
export const ABSENCE_STATUS_LABELS: Record<AbsenceStatus, string> = { APPLIED: "Ansökt", APPROVED: "Godkänd", REJECTED: "Avslagen", WITHDRAWN: "Återtagen" };
/** Where an absence came from: registered in Workflow, or read from a payroll or HR system (a file, SFTP or an API). */
export const ABSENCE_SOURCES = ["MANUAL", "FILE", "SFTP", "API"] as const;
export type AbsenceSource = (typeof ABSENCE_SOURCES)[number];
/** Whether an absence counts in planning: only an approved one (a manual one always is). */
export const countsInPlanning = (absence: { status?: AbsenceStatus | string | null }) => (absence.status ?? "APPROVED") === "APPROVED";
/**
 * Which side may change a record: a manual absence is Workflow's own; an imported one belongs to the master system and is locked
 * in Workflow unless the company's setting lets it be changed here (it is then overwritten by the next changed import).
 */
export const absenceLocked = (absence: { source?: AbsenceSource | string | null }, importedEditable: boolean) => (absence.source ?? "MANUAL") !== "MANUAL" && !importedEditable;
/** Some hours of one day ("HH:MM"), e.g. the dentist 10:00–12:00; null is the whole day. */
export type AbsenceHours = { start: string; end: string };
/** The quick choices of "Del av dagen": förmiddag and eftermiddag are hours like any other, which can be changed. */
export const MORNING: AbsenceHours = { start: "07:00", end: "12:00" };
export const AFTERNOON: AbsenceHours = { start: "12:00", end: "16:00" };
const minutesOf = (clock: string) => { const [hour, minute] = clock.split(":").map(Number); return hour * 60 + minute; };
export type Absence = {
  id: string; userId: string; type: AbsenceType; note: string;
  /** Swedish days, YYYY-MM-DD; `to` included. */
  from: string; to: string;
  /** Some hours of the day (only when from = to); null = the whole day. */
  hours: AbsenceHours | null;
  createdBy: string; createdAt: string;
  /** Affected work a person has decided to leave as it is (Låt vänta). */
  handled: string[];
  /** Approved when left out (manual absence); only approved absence counts in planning. */
  status?: AbsenceStatus;
  /** MANUAL when left out. */
  source?: AbsenceSource;
  /** The payroll or HR system an imported absence came from (its label, e.g. "Flex HRM"). */
  externalSystem?: string | null;
};
/** What the capacity count reads of an absence: the Kapacitet answer holds only these (status left out = approved, already filtered). */
export type AbsenceSpan = Pick<Absence, "userId" | "from" | "to"> & { hours?: AbsenceHours | null; status?: AbsenceStatus | string | null };

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ange ett datum.");
export const absenceInputSchema = z.object({
  id: z.string().optional(),
  userId: z.string().min(1, "Välj person."),
  type: z.enum(ABSENCE_TYPES),
  note: z.string().trim().max(120, "Skriv högst 120 tecken.").default(""),
  from: day, to: day,
  hours: z.object({ start: z.string().regex(/^\d{2}:\d{2}$/, "Ange tiden."), end: z.string().regex(/^\d{2}:\d{2}$/, "Ange tiden.") }).nullable().default(null),
}).superRefine((value, issues) => {
  if (value.to < value.from) issues.addIssue({ code: "custom", path: ["to"], message: "Till kan inte vara före Från." });
  if (Date.parse(value.to) - Date.parse(value.from) > 366 * 86_400_000) issues.addIssue({ code: "custom", path: ["to"], message: "Högst ett år i taget." });
  if (value.hours && value.from !== value.to) issues.addIssue({ code: "custom", path: ["hours"], message: "Tider gäller en dag." });
  if (value.hours && value.hours.end <= value.hours.start) issues.addIssue({ code: "custom", path: ["hours"], message: "Slut måste vara efter start." });
  if (value.type === "OTHER" && !value.note) issues.addIssue({ code: "custom", path: ["note"], message: "Skriv orsaken." });
});
export type AbsenceInput = z.infer<typeof absenceInputSchema>;

/** Everyone registers their own absence; admins and the Teamet right register and change anyone's. */
export const mayRegisterAbsence = (actor: { id: string; admin: boolean; team: boolean }, userId: string) => actor.admin || actor.team || actor.id === userId;

/** The words others see: the type for the person and the Teamet right, otherwise only "Frånvarande". */
export function absenceLabel(viewer: { id: string; admin: boolean; team: boolean }, absence: Pick<Absence, "userId" | "type" | "note" | "hours">) {
  const own = viewer.admin || viewer.team || viewer.id === absence.userId;
  const base = !own ? "Frånvarande" : absence.type === "OTHER" && absence.note ? absence.note : ABSENCE_LABELS[absence.type];
  return absence.hours ? `${base} ${absence.hours.start}–${absence.hours.end}` : base;
}

const weekday = (value: string) => (new Date(`${value}T12:00:00Z`).getUTCDay() + 6) % 7;
const nextDay = (value: string, step = 1) => { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + step); return date.toISOString().slice(0, 10); };
export const isWorkday = (value: string) => weekday(value) < 5;

/** The person's absence on a day, if any. */
export const absenceOn = <T extends AbsenceSpan>(absences: readonly T[], userId: string, value: string) =>
  absences.find((absence) => absence.userId === userId && absence.from <= value && absence.to >= value && countsInPlanning(absence)) ?? null;

/**
 * The share of a workday the person is away: 1 for the whole day, some hours against the ordinary day (default 8 h). Two absences
 * of some hours the same day add up, a time they share counted once, at most the whole day (2026-11-02: only the first was read).
 */
export const absentShare = (absences: readonly AbsenceSpan[], userId: string, value: string, dayMinutes = 480) => {
  if (!isWorkday(value)) return 0;
  const today = absences.filter((absence) => absence.userId === userId && absence.from <= value && absence.to >= value && countsInPlanning(absence));
  if (!today.length) return 0;
  if (today.some((absence) => !absence.hours)) return 1;
  let minutes = 0; let reached = -Infinity;
  for (const [start, end] of today.map((absence) => [minutesOf(absence.hours!.start), minutesOf(absence.hours!.end)] as const).sort((left, right) => left[0] - right[0])) {
    if (end <= reached) continue;
    minutes += Math.max(0, end - Math.max(start, reached)); reached = end;
  }
  return Math.min(1, minutes / Math.max(1, dayMinutes));
};

/**
 * Whether the person is away the whole day (2026-11-02): an absence of whole days, also on a weekend day inside it (a booking
 * put there on purpose then clashes), or hours that fill the person's day. The one test of the capacity count and the clash check.
 */
export const wholeDayAway = (absences: readonly AbsenceSpan[], userId: string, value: string, dayMinutes = 480) =>
  absences.some((absence) => absence.userId === userId && !absence.hours && absence.from <= value && absence.to >= value && countsInPlanning(absence))
  || absentShare(absences, userId, value, dayMinutes) >= 1;

/**
 * The first day the person is available again after the absence (where postponed work goes): a workday on which they have no
 * whole-day approved absence. Användartest 2026-10-31 (F2): sick on Monday and VAB on Tuesday moved the work to the Tuesday;
 * an absence that follows directly (or after a weekend) is skipped too. `others` are the company's absences (any person's;
 * only the same person's count). Some hours away still leaves the day available.
 */
export function firstDayBack(absence: Pick<Absence, "to"> & { userId?: string }, others: readonly Absence[] = []) {
  const away = (value: string) => absence.userId !== undefined && others.some((item) => item.userId === absence.userId && !item.hours && item.from <= value && item.to >= value && countsInPlanning(item));
  let value = nextDay(absence.to);
  for (let guard = 0; (!isWorkday(value) || away(value)) && guard < 400; guard += 1) value = nextDay(value);
  return value;
}

/** `workOrderId`: the job the booking is for; that job is then listed once, as the booking (resa 4, 2026-11-06). */
export type AbsenceBooking = { id: string; title: string; startsAt: string; endsAt: string; userIds: readonly string[]; status: string; href: string; workOrderId?: string | null };
export type AbsenceWorkOrder = { id: string; title: string; status: string; assignedToUserId: string | null; dueDate: string; plannedStartDate: string; href: string };
export type AffectedWork = { key: string; absenceId: string; userId: string; kind: "booking" | "work-order"; id: string; title: string; day: string; href: string; backOn: string };

/**
 * The planned work an absence touches, from today on: the person's bookings on a day they are away (for some hours, only a
 * booking whose time overlaps them), and their open work orders that start or are due on a whole day away. Work a person
 * chose to leave (Låt vänta) is not listed. A work order with a booking that is listed is not listed again.
 */
export function affectedWork(input: { absences: readonly Absence[]; bookings: readonly AbsenceBooking[]; workOrders: readonly AbsenceWorkOrder[]; today: string; swedishDay: (iso: string) => string;
  /** "HH:MM" of a moment on the Swedish clock, for absences of some hours. */
  swedishClock?: (iso: string) => string }): AffectedWork[] {
  const rows: AffectedWork[] = [];
  const booked = new Set<string>();
  for (const absence of input.absences) {
    const ordersBooked = new Set<string>();
    if (absence.to < input.today || !countsInPlanning(absence)) continue;
    for (const booking of input.bookings) {
      if (booking.status === "CANCELED" || booking.status === "COMPLETED" || !booking.userIds.includes(absence.userId)) continue;
      const first = input.swedishDay(booking.startsAt);
      const last = input.swedishDay(new Date(Date.parse(booking.endsAt) - 1).toISOString());
      const overlapsHours = () => {
        if (!absence.hours || !input.swedishClock) return true;
        const start = first === absence.from ? input.swedishClock(booking.startsAt) : "00:00";
        const end = last === absence.from ? input.swedishClock(booking.endsAt) : "24:00";
        return start < absence.hours.end && end > absence.hours.start;
      };
      const hit = [first, last].find((value) => value >= input.today && value >= absence.from && value <= absence.to) && overlapsHours() ? [first, last].find((value) => value >= input.today && value >= absence.from && value <= absence.to) : undefined;
      if (!hit) continue;
      if (booking.workOrderId) ordersBooked.add(booking.workOrderId);
      const key = `booking:${booking.id}:${absence.userId}`;
      if (absence.handled.includes(key)) continue;
      booked.add(booking.id);
      rows.push({ key, absenceId: absence.id, userId: absence.userId, kind: "booking", id: booking.id, title: booking.title, day: hit, href: booking.href, backOn: firstDayBack(absence, input.absences) });
    }
    for (const order of input.workOrders) {
      if (absence.hours || ordersBooked.has(order.id) || order.assignedToUserId !== absence.userId || order.status === "COMPLETED" || order.status === "CANCELLED") continue;
      const value = order.plannedStartDate && order.plannedStartDate >= absence.from && order.plannedStartDate <= absence.to ? order.plannedStartDate
        : order.dueDate && order.dueDate >= absence.from && order.dueDate <= absence.to ? order.dueDate : "";
      if (!value || value < input.today) continue;
      const key = `work-order:${order.id}:${absence.userId}`;
      if (absence.handled.includes(key)) continue;
      rows.push({ key, absenceId: absence.id, userId: absence.userId, kind: "work-order", id: order.id, title: order.title, day: value, href: order.href, backOn: firstDayBack(absence, input.absences) });
    }
  }
  return rows.sort((a, b) => a.day.localeCompare(b.day) || a.title.localeCompare(b.title, "sv"));
}

/** Who could take the work over that day: not away, the most free time first (planned against the day's capacity). */
export function suggestReplacements(people: readonly { id: string; name: string; freeMinutes: number; away: boolean; mayDo: boolean }[], exceptId: string, limit = 3) {
  return people.filter((person) => person.id !== exceptId && !person.away && person.mayDo)
    .sort((a, b) => b.freeMinutes - a.freeMinutes || a.name.localeCompare(b.name, "sv")).slice(0, limit);
}
