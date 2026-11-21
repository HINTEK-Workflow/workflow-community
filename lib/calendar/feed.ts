import { myDayJobHref } from "@/lib/workflow/my-day";
import { swedishDayKey } from "@/lib/swedish-time";
import { isCalendarDay, type CalendarEvent } from "./ical";

/**
 * What the personal calendar shows (PL14, 2026-11-01), as plain functions. Only what the rows here carry can reach the file:
 * a title, times, an id. A booking's description, a customer's notes, a fault report's text and every price are never read
 * for it (lib/calendar/feed-server.ts selects these fields and no others). A title is the only free text, and the same title
 * is what the person sees in the app.
 *
 * Jour: there is no on-call schedule yet (planned as its own stage). What exists is a fault report that went the on-call way and
 * was taken by the person; those are shown as "Jour: …". When the schedule is built, its passes are added here.
 */
export type BookingRow = {
  id: string; title: string; startsAt: Date; endsAt: Date; updatedAt: Date;
  /** The person's own times on the booking, when they differ from the booking's. */
  own: { startsAt: Date | null; endsAt: Date | null } | null;
  workflowTask: { id: string; kind: string } | null;
};
export type WorkOrderRow = { id: string; title: string; plannedStartDate: string | null; dueDate: string | null; updatedAt: Date };
export type OnCallRow = { id: string; taskId: string; title: string; at: Date };

/** How long a taken on-call job is drawn: the report has a time and no length. */
export const ON_CALL_MINUTES = 60;
/** The file is bounded: this far back and ahead, and at most this many of each kind. */
export const CALENDAR_DAYS_BACK = 30;
export const CALENDAR_DAYS_AHEAD = 365;
export const CALENDAR_ROW_LIMIT = 500;

const uid = (kind: string, id: string) => `${kind}-${id}@workflow.hintek`;

/** The work order's days: Start to Klart senast; one of them alone is that day; a Start after Klart senast is that one day each, so it is read as the due day. */
export function workOrderDays(row: Pick<WorkOrderRow, "plannedStartDate" | "dueDate">): { firstDay: string; lastDay: string } | null {
  const start = isCalendarDay(row.plannedStartDate) ? row.plannedStartDate : null;
  const due = isCalendarDay(row.dueDate) ? row.dueDate : null;
  if (start && due) return start <= due ? { firstDay: start, lastDay: due } : { firstDay: due, lastDay: due };
  const day = start ?? due;
  return day ? { firstDay: day, lastDay: day } : null;
}

/**
 * The events, by rising start. A work order the person has a booking on is shown as the booking (with its times), and one taken
 * from the on-call way as that, so the same job does not stand twice.
 */
export function calendarEvents(input: { bookings: readonly BookingRow[]; workOrders: readonly WorkOrderRow[]; onCall: readonly OnCallRow[]; appUrl: (path: string) => string }): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const shown = new Set<string>();
  const taskUrl = (task: { id: string; kind: string }) => input.appUrl(myDayJobHref(task.id, task.kind));
  for (const row of input.bookings) {
    if (row.workflowTask) shown.add(row.workflowTask.id);
    const startsAt = row.own?.startsAt ?? row.startsAt;
    const endsAt = row.own?.endsAt ?? row.endsAt;
    if (!(endsAt.getTime() > startsAt.getTime())) continue;
    events.push({ kind: "time", uid: uid("bokning", row.id), summary: row.title, category: "Bokning", startsAt, endsAt, lastModified: row.updatedAt, ...(row.workflowTask ? { url: taskUrl(row.workflowTask) } : {}) });
  }
  for (const row of input.onCall) {
    shown.add(row.taskId);
    events.push({ kind: "time", uid: uid("jour", row.id), summary: `Jour: ${row.title}`, category: "Jour", startsAt: row.at, endsAt: new Date(row.at.getTime() + ON_CALL_MINUTES * 60_000), url: taskUrl({ id: row.taskId, kind: "WORK_ORDER" }) });
  }
  for (const row of input.workOrders) {
    if (shown.has(row.id)) continue;
    const days = workOrderDays(row);
    if (days) events.push({ kind: "day", uid: uid("arbetsorder", row.id), summary: row.title, category: "Arbetsorder", ...days, lastModified: row.updatedAt, url: taskUrl({ id: row.id, kind: "WORK_ORDER" }) });
  }
  const startKey = (event: CalendarEvent) => (event.kind === "time" ? swedishDayKey(event.startsAt) : event.firstDay);
  return events.sort((a, b) => startKey(a).localeCompare(startKey(b)) || a.uid.localeCompare(b.uid));
}
