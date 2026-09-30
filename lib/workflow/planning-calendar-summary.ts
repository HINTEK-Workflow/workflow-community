import type { AvailabilityActivity } from "./availability-summary";
import { addSwedishDays, formatSwedish, startOfSwedishDay, startOfSwedishMonth, swedishDate, swedishDayDifference, swedishMonday, swedishParts } from "@/lib/swedish-time";

export type PlanningCalendarMode = "day" | "week" | "month";

// Calendar days are Swedish days (Europe/Stockholm); each returned Date is the instant of a Swedish midnight.
export function planningCalendarDays(anchor: Date, mode: PlanningCalendarMode) {
  if (mode === "day") return [startOfSwedishDay(anchor)];
  if (mode === "week") { const first = swedishMonday(anchor); return Array.from({ length: 7 }, (_, index) => addSwedishDays(first, index)); }
  const gridStart = swedishMonday(startOfSwedishMonth(anchor));
  return Array.from({ length: 42 }, (_, index) => addSwedishDays(gridStart, index));
}

export function movePlanningCalendar(anchor: Date, mode: PlanningCalendarMode, direction: -1 | 1) {
  if (mode === "day") return addSwedishDays(anchor, direction);
  if (mode === "week") return addSwedishDays(anchor, direction * 7);
  return startOfSwedishMonth(anchor, direction);
}

/** Whether a calendar day belongs to the anchor's Swedish month (month view shows neighbouring days muted). */
export function isInSwedishMonth(day: Date, anchor: Date) {
  const left = swedishParts(day); const right = swedishParts(anchor);
  return left.year === right.year && left.month === right.month;
}

/**
 * A calendar date has no inherent time. Opening a planning form from a date
 * uses this ordinary one-hour work interval (08:00–09:00 Swedish time) as a
 * default only; saving remains an explicit user action.
 */
export function planningDefaultInterval(day: Date) {
  const { year, month, day: date } = swedishParts(day);
  return { startsAt: swedishDate(year, month, date, 8), endsAt: swedishDate(year, month, date, 9) };
}

export function planningActivitiesForDay<T extends AvailabilityActivity>(activities: T[], day: Date): T[] {
  const startsAt = startOfSwedishDay(day);
  const endsAt = addSwedishDays(startsAt, 1);
  return activities.filter((activity) => {
    const activityStart = new Date(activity.startsAt); const activityEnd = new Date(activity.endsAt);
    return !Number.isNaN(activityStart.getTime()) && !Number.isNaN(activityEnd.getTime()) && activityEnd > startsAt && activityStart < endsAt;
  }).sort((left, right) => left.startsAt.localeCompare(right.startsAt));
}

type MovableAssignment = { startsAt: string | null; endsAt: string | null };

/**
 * Moves a planned activity to another calendar day by whole Swedish days. Swedish time of day and duration are kept,
 * also across daylight-saving changes, and individual participant intervals move by the same number of days.
 * Returns null when the target is the activity's current start day. Reported time is never involved.
 */
export function movePlannedActivityToDay<A extends MovableAssignment>(activity: { startsAt: string; endsAt: string; assignments: A[] }, targetDay: Date) {
  const start = new Date(activity.startsAt);
  const end = new Date(activity.endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const days = swedishDayDifference(start, targetDay);
  if (!days) return null;
  const shift = (value: string) => addSwedishDays(value, days).toISOString();
  return {
    startsAt: shift(activity.startsAt),
    endsAt: shift(activity.endsAt),
    assignments: activity.assignments.map((assignment) => assignment.startsAt && assignment.endsAt
      ? { ...assignment, startsAt: shift(assignment.startsAt), endsAt: shift(assignment.endsAt) }
      : assignment),
  };
}

export function planningCalendarTitle(anchor: Date, mode: PlanningCalendarMode) {
  if (mode === "month") return formatSwedish(anchor, { month: "long", year: "numeric" });
  const days = planningCalendarDays(anchor, mode);
  if (mode === "day") return formatSwedish(days[0], { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return `${formatSwedish(days[0], { day: "numeric", month: "short" })}–${formatSwedish(days.at(-1)!, { day: "numeric", month: "short" })}`;
}
