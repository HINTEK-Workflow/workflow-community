/**
 * Teamet – what tends to fall between the chairs (2026-10-29, punkt 1–3): unreported time per person, work without an
 * owner or a booking, and competence or instruments that run out. Pure rules shared by the server, the demo and the tests;
 * everything is real data the company already has, nothing is guessed.
 */

const DAY_NAMES = ["Mån", "Tis", "Ons", "Tors", "Fre", "Lör", "Sön"];
const weekdayOf = (day: string) => (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
const shift = (day: string, step: number) => { const date = new Date(`${day}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + step); return date.toISOString().slice(0, 10); };
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

/**
 * The workdays to check: this week's workdays before today; on a Monday (or when nothing has passed yet) last week's five.
 * Today itself is never checked – the day is not over.
 */
export function checkedWorkdays(today: string): string[] {
  const monday = shift(today, -weekdayOf(today));
  const thisWeek = Array.from({ length: 5 }, (_, index) => shift(monday, index)).filter((day) => day < today);
  return thisWeek.length ? thisWeek : Array.from({ length: 5 }, (_, index) => shift(monday, index - 7));
}

export type TimeGapRow = { userId: string; name: string; expectedMinutes: number; reportedMinutes: number; missingMinutes: number; days: { date: string; label: string; missingMinutes: number }[] };

/**
 * 1. Tid som inte är rapporterad: per person and checked workday, the reported time against the ordinary day (a fifth of the
 * weekly time) less the share they were away; a day counts as missing when more than half an hour is lacking (the same slack
 * as Jag's "Mån saknar 6,5 h"). Those missing the most first.
 */
export function timeGaps(input: {
  members: readonly { id: string; name: string; dayMinutes: number }[];
  entries: readonly { userId: string; startedAt: Date | string; durationSec: number }[];
  days: readonly string[];
  swedishDay: (value: Date | string) => string;
  /** The share of a day the person was away (lib/workflow/absence.ts absentShare). */
  awayShare?: (userId: string, day: string) => number;
}): TimeGapRow[] {
  const reported = new Map<string, number>();
  for (const entry of input.entries) {
    const key = `${entry.userId}|${input.swedishDay(entry.startedAt)}`;
    reported.set(key, (reported.get(key) ?? 0) + entry.durationSec / 60);
  }
  return input.members.flatMap((member) => {
    let expected = 0, done = 0;
    const days = input.days.flatMap((day) => {
      const want = member.dayMinutes * (1 - (input.awayShare?.(member.id, day) ?? 0));
      const have = reported.get(`${member.id}|${day}`) ?? 0;
      // The real hours (PL11): a capped day made Teamet say 8,5 h where Tid says 8,7 h.
      expected += want; done += have;
      const missing = Math.round(want - have);
      return missing > 30 ? [{ date: day, label: DAY_NAMES[weekdayOf(day)], missingMinutes: missing }] : [];
    });
    if (!days.length) return [];
    return [{ userId: member.id, name: member.name, expectedMinutes: Math.round(expected), reportedMinutes: Math.round(done), missingMinutes: days.reduce((sum, item) => sum + item.missingMinutes, 0), days }];
  }).sort((a, b) => b.missingMinutes - a.missingMinutes || a.name.localeCompare(b.name, "sv"));
}

/** What Ej bokad and Att boka read of a work order. `booked`: any booking not deleted and not cancelled, whoever it is for. */
export type BookableOrder = { status: string; progress?: number | null; startedAt?: string | Date | null; booked: boolean; roundScheduleId?: string | null; dormant?: boolean; plannedStartDate: string; dueDate: string };

/**
 * Att boka (2026-11-02): a dated work order that is waiting for its first booking: not started, not förfallen (it is counted
 * there), no round's holder (the round plans it) and not vilande (the plan owns its day). A passed Start stays until it is booked or
 * started. Ej bokad on Teamet is the same rule with a Start within the week, so every row there is also in Att boka.
 */
export const awaitsBooking = (order: BookableOrder, today: string) =>
  order.status === "PLANNED" && !order.progress && !order.startedAt && !order.booked && !order.roundScheduleId && !order.dormant
  && Boolean(order.plannedStartDate || order.dueDate) && !(order.dueDate && order.dueDate < today);

/** The most rows the list Att boka reads; the total says when there are more. */
export const TO_BOOK_LIMIT = 200;
export type ToBookOrder = BookableOrder & { id: string; title: string; assignedToUserId: string | null; assignedToName: string; customerName: string; projectId: string | null; projectName: string };
export type ToBookRow = Pick<ToBookOrder, "id" | "title" | "plannedStartDate" | "dueDate" | "assignedToUserId" | "assignedToName" | "customerName" | "projectId" | "projectName"> & { lateStart: boolean; href: string };

/** The work orders of Att boka, the soonest first (Start, else Klart senast). The same in Cloud, the demo and Local. */
export function workToBook(input: { workOrders: readonly ToBookOrder[]; today: string }): { total: number; rows: ToBookRow[] } {
  const rows = input.workOrders.filter((order) => awaitsBooking(order, input.today)).map((order): ToBookRow => ({
    id: order.id, title: order.title, plannedStartDate: order.plannedStartDate, dueDate: order.dueDate, assignedToUserId: order.assignedToUserId, assignedToName: order.assignedToName,
    customerName: order.customerName, projectId: order.projectId, projectName: order.projectName,
    lateStart: Boolean(order.plannedStartDate && order.plannedStartDate < input.today), href: `/?view=workflow_task&taskId=${encodeURIComponent(order.id)}&taskType=WORK_ORDER`,
  })).sort((a, b) => (a.plannedStartDate || a.dueDate).localeCompare(b.plannedStartDate || b.dueDate) || a.title.localeCompare(b.title, "sv"));
  return { total: rows.length, rows };
}

export type UnownedRow = { id: string; title: string; customerName: string; reason: "no-owner" | "no-booking"; day: string; href: string;
  /** Ej bokad: whether this person may book it (the rule of plannedActivityWriteRefusal); otherwise the row opens the job. */
  canBook?: boolean };

/**
 * 2. Arbete utan ägare: open work orders without a responsible person, and assigned ones that await a booking (awaitsBooking) and
 * start within a week. `bookable: false` is a company without Planering: there is nowhere to book, so no Ej bokad. The soonest first.
 */
export function unownedWork(input: {
  workOrders: readonly (BookableOrder & { id: string; title: string; assignedToUserId: string | null; customerName: string; canBook?: boolean })[];
  today: string; horizonDays?: number; bookable?: boolean;
}): { total: number; rows: UnownedRow[] } {
  const horizon = shift(input.today, input.horizonDays ?? 7);
  const rows = input.workOrders.flatMap((order): UnownedRow[] => {
    if (order.status === "COMPLETED" || order.status === "CANCELLED") return [];
    const href = `/?view=workflow_task&taskId=${encodeURIComponent(order.id)}&taskType=WORK_ORDER`;
    if (!order.assignedToUserId) return [{ id: order.id, title: order.title, customerName: order.customerName, reason: "no-owner", day: order.plannedStartDate || order.dueDate, href }];
    if (input.bookable !== false && awaitsBooking(order, input.today) && order.plannedStartDate && order.plannedStartDate >= input.today && order.plannedStartDate <= horizon) return [{ id: order.id, title: order.title, customerName: order.customerName, reason: "no-booking", day: order.plannedStartDate, href, ...(order.canBook === undefined ? {} : { canBook: order.canBook }) }];
    return [];
  }).sort((a, b) => (a.day || "9999").localeCompare(b.day || "9999") || a.title.localeCompare(b.title, "sv"));
  return { total: rows.length, rows };
}

export type ExpiringRow = { id: string; kind: "credential" | "licence" | "instrument"; title: string; personName: string; date: string; days: number; overdue: boolean; href: string };

/**
 * 3. Behörigheter och instrument som går ut: trainings and driving licences on the competence cards (people who have left are
 * not counted) and instruments whose calibration is due, within `windowDays` – and what has already run out, first.
 */
export function expiringItems(input: {
  credentials: readonly { id: string; personName: string; title: string; validUntil: string | null; left: boolean }[];
  licences: readonly { personId: string; personName: string; validUntil: string | null; left: boolean }[];
  instruments: readonly { id: string; name: string; nextCalibrationAt: string | null; active: boolean }[];
  today: string; windowDays?: number;
}): ExpiringRow[] {
  const last = shift(input.today, input.windowDays ?? 30);
  const within = (day: string | null): day is string => Boolean(day) && day! <= last;
  const row = (id: string, kind: ExpiringRow["kind"], title: string, personName: string, date: string, href: string): ExpiringRow =>
    ({ id, kind, title, personName, date, days: daysBetween(input.today, date), overdue: date < input.today, href });
  return [
    ...input.credentials.filter((item) => !item.left && within(item.validUntil)).map((item) => row(`credential:${item.id}`, "credential", item.title, item.personName, item.validUntil!, "/?view=self_inspection&tab=competence")),
    ...input.licences.filter((item) => !item.left && within(item.validUntil)).map((item) => row(`licence:${item.personId}`, "licence", "Körkort", item.personName, item.validUntil!, "/?view=self_inspection&tab=competence")),
    ...input.instruments.filter((item) => item.active && within(item.nextCalibrationAt)).map((item) => row(`instrument:${item.id}`, "instrument", item.name, "", item.nextCalibrationAt!, "/?view=instruments")),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, "sv"));
}
