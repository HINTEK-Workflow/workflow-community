import type { ExportAbsence, ExportPerson, ExportTimeEntry } from "./export";

/**
 * Månadens status för lön (2026-10-30): a person's month of time is open, sent in, approved or returned (the TimePeriod
 * table; no row = open). "Bara godkända månader" (on by default) leaves out every row of a person's month that is not approved –
 * worked time and absence alike – and lists what was left out, so nothing goes to payroll unseen. Pure: the server and the demo
 * read the rows and call these.
 */
export const MONTH_STATUSES = ["OPEN", "SUBMITTED", "APPROVED", "RETURNED"] as const;
export type MonthStatus = (typeof MONTH_STATUSES)[number];
export const MONTH_STATUS_LABELS: Record<MonthStatus, string> = { OPEN: "Öppen", SUBMITTED: "Inskickad", APPROVED: "Godkänd", RETURNED: "Tillbakaskickad" };
export type PeriodRow = { userId: string; period: string; status: string };

/** The months (YYYY-MM) a period touches, at most 13. */
export function monthsBetween(from: string, to: string) {
  const months: string[] = [];
  let [year, month] = from.slice(0, 7).split("-").map(Number);
  const last = to.slice(0, 7);
  for (let guard = 0; guard < 13; guard += 1) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    if (key > last) break;
    months.push(key);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return months;
}

const lastDayOf = (month: string) => { const [year, number] = month.split("-").map(Number); return `${month}-${String(new Date(Date.UTC(year, number, 0)).getUTCDate()).padStart(2, "0")}`; };

/** A lookup of the stored rows: a person's month and its status (no row, or an unknown word, = open). */
export function monthStatusLookup(rows: readonly PeriodRow[]) {
  const map = new Map(rows.map((row) => [`${row.userId}|${row.period}`, row.status]));
  return (userId: string, month: string): MonthStatus => {
    const status = map.get(`${userId}|${month}`);
    return status === "SUBMITTED" || status === "APPROVED" || status === "RETURNED" ? status : "OPEN";
  };
}

export type SkippedMonth = { userId: string; month: string; status: MonthStatus };

/**
 * Only approved months: worked time on a day of a month that is not approved is left out, and an absence is cut at the month
 * boundaries so its approved months stay. `skipped` holds each person's month that had something left out.
 */
export function onlyApprovedMonths<E extends Pick<ExportTimeEntry, "userId" | "day">, A extends Pick<ExportAbsence, "userId" | "from" | "to">>(input: {
  entries: readonly E[]; absences: readonly A[]; statusOf: (userId: string, month: string) => MonthStatus;
}): { entries: E[]; absences: A[]; skipped: SkippedMonth[] } {
  const skipped = new Map<string, SkippedMonth>();
  const skip = (userId: string, month: string, status: MonthStatus) => skipped.set(`${userId}|${month}`, { userId, month, status });
  const entries = input.entries.filter((entry) => {
    const month = entry.day.slice(0, 7);
    const status = input.statusOf(entry.userId, month);
    if (status === "APPROVED") return true;
    skip(entry.userId, month, status);
    return false;
  });
  const absences: A[] = [];
  for (const absence of input.absences) {
    for (const month of monthsBetween(absence.from, absence.to)) {
      const status = input.statusOf(absence.userId, month);
      const from = absence.from > `${month}-01` ? absence.from : `${month}-01`;
      const to = absence.to < lastDayOf(month) ? absence.to : lastDayOf(month);
      if (status === "APPROVED") absences.push(from === absence.from && to === absence.to ? absence : { ...absence, from, to });
      else skip(absence.userId, month, status);
    }
  }
  return { entries, absences, skipped: [...skipped.values()].sort((a, b) => a.userId.localeCompare(b.userId) || a.month.localeCompare(b.month)) };
}

/** The warning lines for the months left out, by name; with a period, only its months (an absence may reach outside it). */
export const skippedWarnings = (skipped: readonly SkippedMonth[], people: readonly Pick<ExportPerson, "userId" | "name">[], period?: { from: string; to: string }) => {
  const names = new Map(people.map((person) => [person.userId, person.name]));
  const inPeriod = (month: string) => !period || (month >= period.from.slice(0, 7) && month <= period.to.slice(0, 7));
  return skipped.filter((item) => names.has(item.userId) && inPeriod(item.month))
    .sort((a, b) => names.get(a.userId)!.localeCompare(names.get(b.userId)!, "sv") || a.month.localeCompare(b.month))
    .map((item) => `${names.get(item.userId)}, ${item.month}: månaden är inte godkänd (${MONTH_STATUS_LABELS[item.status]}) och är inte med.`);
};
