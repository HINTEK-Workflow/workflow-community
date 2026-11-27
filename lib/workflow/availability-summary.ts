import { bookingLoadByDay, dailyWorkMinutes, DEFAULT_WEEKLY_WORK_MINUTES, isClockBooking } from "./booking-load";
import { addSwedishDays, formatSwedish, fromSwedishDateInput, startOfSwedishDay, swedishClock, swedishDayKey } from "@/lib/swedish-time";
import { absentShare, countsInPlanning, isWorkday, wholeDayAway, type AbsenceSpan } from "./absence";
import { bookingOnCancelledJob } from "./task-cancel";
import { formatCapacityMinutes } from "./capacity-summary";
import { shortDay } from "./schedule";

export type AvailabilityAssignment = {
  userId: string;
  startsAt: string | null;
  endsAt: string | null;
  /** Hours given for this person (minutes); null or missing = no hours, the booking's time counts. */
  plannedMinutes?: number | null;
};

export type AvailabilityActivity = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELED";
  assignedToUserId: string | null;
  /** The booked job's status, when known: a booking on a job that has utgått never clashes (2026-10-09). */
  workflowTask?: { status?: string | null } | null;
  assignedToUserIds?: string[];
  assignments?: AvailabilityAssignment[];
};

type ConflictActivity = { activityId: string; title: string; startsAt: string; endsAt: string };

export type AvailabilityConflict = {
  /**
   * "overlap": two bookings with clock times (within one day, no hours given) overlap.
   * "overload": the person's booked hours on one day exceed the day's working time, less the share away.
   * "absence" (2026-11-02): one booking on one absence of the person: on whole days away, or overlapping the hours of a
   * shorter one.
   */
  kind: "overlap" | "overload" | "absence";
  userId: string;
  /** The overlap, or the whole Swedish day for an overload, or the absence's days. */
  startsAt: string;
  endsAt: string;
  /** Overlapping minutes, or the minutes booked beyond the day's working time, or the minutes booked while away. */
  minutes: number;
  /** For "overload": the day's booked minutes and working time. */
  bookedMinutes?: number;
  workMinutes?: number;
  /** For "absence": its days and the words the viewer may see. */
  absence?: { from: string; to: string; label: string };
  first: ConflictActivity;
  /** The other booking; for an overload with one booking only (more hours than the day has), the same as first. */
  second: ConflictActivity;
  /** Every booking involved (two for an overlap; all of the day's bookings for an overload). */
  activities: ConflictActivity[];
};

const activeStatuses = new Set<AvailabilityActivity["status"]>(["PLANNED", "IN_PROGRESS"]);

function validDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function internalAssignments(activity: AvailabilityActivity): AvailabilityAssignment[] {
  if (activity.assignments?.length) return activity.assignments;
  return [...new Set([...(activity.assignedToUserIds ?? []), ...(activity.assignedToUserId ? [activity.assignedToUserId] : [])])]
    .map((userId) => ({ userId, startsAt: null, endsAt: null, plannedMinutes: null }));
}

type Booking = { activityId: string; title: string; startsAt: Date; endsAt: Date; plannedMinutes: number | null; clock: boolean };
const described = (booking: Booking): ConflictActivity => ({ activityId: booking.activityId, title: booking.title, startsAt: booking.startsAt.toISOString(), endsAt: booking.endsAt.toISOString() });

/** An absence as the clash check reads it; `label` is what the viewer may see. */
export type AvailabilityAbsence = AbsenceSpan & { label?: string };

const clockMinutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));

/** The minutes a booking within one day shares with an absence's hours that day (the test of bookingClashes, lib/workflow/booking-warning.ts). */
function minutesInHours(booking: Booking, hours: NonNullable<AvailabilityAbsence["hours"]>) {
  const endsNextDay = swedishDayKey(booking.endsAt) !== swedishDayKey(booking.startsAt);
  const from = Math.max(clockMinutes(swedishClock(booking.startsAt)), clockMinutes(hours.start));
  const to = Math.min(endsNextDay ? 24 * 60 : clockMinutes(swedishClock(booking.endsAt)), clockMinutes(hours.end));
  return Math.max(0, to - from);
}

/**
 * Read-only clash check (projektförslaget steg 1, 2026-10-09). Planned work stays distinct from actual time, and a
 * clash only warns. A person has a clash when two bookings with clock times overlap, or when a day holds more booked
 * hours than the day's working time (weekly working time / 5). A week booking given in hours and a short job the same
 * week therefore do not clash while the hours fit.
 *
 * With `absences` (2026-11-02, the same parts as capacityInWindow): a booking on whole days away (wholeDayAway, also hours that
 * fill the person's day, and a weekend day inside an absence) is an "absence" clash and no overload as well; shorter hours away only
 * hit a clock booking that overlaps them, and otherwise shorten the day the overload check compares with. Ingen fast arbetstid has no
 * working day to go over, so no overload; overlaps and absence still warn.
 */
export function summarizeAvailability(activities: AvailabilityActivity[], options: { weeklyWorkMinutesFor?: (userId: string) => number | null | undefined; noFixedHoursFor?: (userId: string) => boolean | null | undefined; absences?: readonly AvailabilityAbsence[] } = {}) {
  const bookingsByUser = new Map<string, Booking[]>();
  for (const activity of activities) {
    if (!activeStatuses.has(activity.status) || bookingOnCancelledJob(activity)) continue;
    for (const assignment of internalAssignments(activity)) {
      const individual = Boolean(assignment.startsAt && assignment.endsAt);
      const startsAt = validDate(individual ? assignment.startsAt! : activity.startsAt);
      const endsAt = validDate(individual ? assignment.endsAt! : activity.endsAt);
      if (!startsAt || !endsAt || endsAt <= startsAt) continue;
      const plannedMinutes = individual ? null : assignment.plannedMinutes ?? null;
      const bookings = bookingsByUser.get(assignment.userId) ?? [];
      bookings.push({ activityId: activity.id, title: activity.title, startsAt, endsAt, plannedMinutes, clock: isClockBooking({ startsAt, endsAt, plannedMinutes }) });
      bookingsByUser.set(assignment.userId, bookings);
    }
  }

  const conflicts: AvailabilityConflict[] = [];
  for (const [userId, bookings] of bookingsByUser) {
    // 1. Clock-time bookings that overlap.
    const clocked = bookings.filter((booking) => booking.clock)
      .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime() || left.endsAt.getTime() - right.endsAt.getTime());
    for (let index = 0; index < clocked.length; index += 1) {
      for (let next = index + 1; next < clocked.length; next += 1) {
        const first = clocked[index]; const second = clocked[next];
        if (second.startsAt >= first.endsAt) break;
        if (first.activityId === second.activityId) continue;
        const overlapStart = new Date(Math.max(first.startsAt.getTime(), second.startsAt.getTime()));
        const overlapEnd = new Date(Math.min(first.endsAt.getTime(), second.endsAt.getTime()));
        if (overlapEnd <= overlapStart) continue;
        conflicts.push({
          kind: "overlap", userId,
          startsAt: overlapStart.toISOString(), endsAt: overlapEnd.toISOString(),
          minutes: Math.round((overlapEnd.getTime() - overlapStart.getTime()) / 60_000),
          first: described(first), second: described(second), activities: [described(first), described(second)],
        });
      }
    }
    const weeklyMinutes = options.weeklyWorkMinutesFor?.(userId) ?? DEFAULT_WEEKLY_WORK_MINUTES;
    const workMinutes = dailyWorkMinutes(weeklyMinutes);
    const absences = (options.absences ?? []).filter((absence) => absence.userId === userId && countsInPlanning(absence));
    // 2. Booked while away, per absence and booking. Minutes a clock booking shares with some hours away are said here, not as load too.
    const sharedWithHours = new Map<string, number>();
    const dayAway = (day: string) => wholeDayAway(absences, userId, day, weeklyMinutes / 5);
    const said = new Set<string>();
    for (const absence of absences) {
      const span = fromSwedishDateInput(absence.from); const last = fromSwedishDateInput(absence.to);
      if (!span || !last) continue;
      const hours = absence.hours;
      const words = { from: absence.from, to: absence.to, label: absence.label ?? "" };
      for (const booking of bookings) {
        let minutes = 0;
        // Each day away is said once, should two absences share it.
        for (const day of bookingLoadByDay({ startsAt: booking.startsAt, endsAt: booking.endsAt, plannedMinutes: booking.plannedMinutes, dailyWorkMinutes: workMinutes })) {
          const key = `${booking.activityId}:${day.day}`;
          if (day.day < absence.from || day.day > absence.to || !dayAway(day.day) || said.has(key)) continue;
          said.add(key); minutes += day.minutes;
        }
        if (hours && !dayAway(absence.from) && booking.clock && swedishDayKey(booking.startsAt) === absence.from && isWorkday(absence.from)) {
          minutes = minutesInHours(booking, hours);
          if (minutes) sharedWithHours.set(absence.from, (sharedWithHours.get(absence.from) ?? 0) + minutes);
        }
        if (!minutes) continue;
        const shown = described(booking);
        conflicts.push({ kind: "absence", userId, startsAt: span.toISOString(), endsAt: addSwedishDays(last, 1).toISOString(), minutes, absence: words, first: shown, second: shown, activities: [shown] });
      }
    }
    if (options.noFixedHoursFor?.(userId)) continue;
    // 3. Days with more booked hours than the day's working time. Clock bookings count by the time they cover together
    // (their overlap is already the clash above), at most the day's working time; other bookings add their load.
    const byDay = new Map<string, { startsAt: Date; total: number; clock: [number, number][]; parts: { booking: Booking; minutes: number }[] }>();
    for (const booking of bookings) {
      for (const day of bookingLoadByDay({ startsAt: booking.startsAt, endsAt: booking.endsAt, plannedMinutes: booking.plannedMinutes, dailyWorkMinutes: workMinutes })) {
        if (!day.minutes) continue;
        const entry = byDay.get(day.day) ?? { startsAt: startOfSwedishDay(day.startsAt), total: 0, clock: [], parts: [] };
        if (booking.clock) entry.clock.push([day.startsAt.getTime(), day.endsAt.getTime()]); else entry.total += day.minutes;
        const same = entry.parts.find((part) => part.booking.activityId === booking.activityId);
        if (same) same.minutes += day.minutes; else entry.parts.push({ booking, minutes: day.minutes });
        byDay.set(day.day, entry);
      }
    }
    for (const entry of [...byDay.values()].sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime())) {
      const dayKey = swedishDayKey(entry.startsAt);
      const away = absentShare(absences, userId, dayKey, weeklyMinutes / 5);
      if (dayAway(dayKey)) continue;
      const dayMinutes = Math.round(workMinutes * (1 - away));
      entry.total += Math.min(workMinutes, unionMinutes(entry.clock));
      if (entry.total - (sharedWithHours.get(dayKey) ?? 0) <= dayMinutes) continue;
      const parts = entry.parts.slice().sort((left, right) => right.minutes - left.minutes);
      const involved = parts.map((part) => described(part.booking));
      conflicts.push({
        kind: "overload", userId,
        startsAt: entry.startsAt.toISOString(), endsAt: addSwedishDays(entry.startsAt, 1).toISOString(),
        minutes: entry.total - dayMinutes, bookedMinutes: entry.total, workMinutes: dayMinutes,
        first: involved[0], second: involved[1] ?? involved[0], activities: involved,
      });
    }
  }
  return { conflicts, userIds: [...bookingsByUser.keys()] };
}

/** The minutes a set of intervals covers together. */
function unionMinutes(intervals: [number, number][]) {
  let total = 0; let end = -Infinity;
  for (const [from, to] of intervals.slice().sort((left, right) => left[0] - right[0])) {
    if (to <= end) continue;
    total += to - Math.max(from, end); end = to;
  }
  return Math.round(total / 60_000);
}

const formatDateTime = (value: string) => formatSwedish(value, { dateStyle: "medium", timeStyle: "short" });

/** "3–5 nov", "30 okt–2 nov", or one day: "3 nov". */
const absenceDays = (from: string, to: string) => from === to ? shortDay(from) : from.slice(0, 7) === to.slice(0, 7) ? `${Number(from.slice(8))}–${shortDay(to)}` : `${shortDay(from)}–${shortDay(to)}`;

/**
 * One clash in words (steg 1, 2026-10-09; shared by Kapacitet, Kalender and the form since 2026-11-02): two clock bookings that
 * overlap, a day with more booked hours than the day's working time, or a booking while away. `self` leaves the booking being
 * looked at out of the names.
 */
export function conflictLine(conflict: AvailabilityConflict, self?: string) {
  const others = (self ? conflictOthers(conflict, self) : []).map((item) => item.title).join(", ");
  if (conflict.kind === "absence" && conflict.absence) {
    const { from, to, label } = conflict.absence;
    return `Frånvarande ${absenceDays(from, to)}: ${formatCapacityMinutes(conflict.minutes)} bokat${label && label !== "Frånvarande" ? ` (${label})` : ""}`;
  }
  if (conflict.kind === "overload")
    return `För mycket bokat ${formatSwedish(conflict.startsAt, { weekday: "short", day: "numeric", month: "short" })}: ${formatCapacityMinutes(conflict.bookedMinutes ?? 0)} av ${formatCapacityMinutes(conflict.workMinutes ?? 0)}${others ? ` (med ${others})` : ""}`;
  return `Överlapp${others ? ` med ${others}` : ""}: ${formatDateTime(conflict.startsAt)}–${formatDateTime(conflict.endsAt)} · ${formatCapacityMinutes(conflict.minutes)}`;
}

/** Whether a clash involves a booking, and the other bookings in it (for "Tidskrock med …"). */
export const conflictInvolves = (conflict: AvailabilityConflict, activityId: string) => conflict.activities.some((activity) => activity.activityId === activityId);
export const conflictOthers = (conflict: AvailabilityConflict, activityId: string) => conflict.activities.filter((activity) => activity.activityId !== activityId);
