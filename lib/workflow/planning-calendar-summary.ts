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
export function planningDefaultInterval(day: Date, now: Date = new Date()) {
  const { year, month, day: date } = swedishParts(day);
  const morning = { startsAt: swedishDate(year, month, date, 8), endsAt: swedishDate(year, month, date, 9) };
  // Today, after 08:00 has passed: the next whole hour instead of a time in the past (PRJ-10, 2026-10-18).
  if (morning.startsAt.getTime() > now.getTime() || swedishDayDifference(day, now) !== 0) return morning;
  const next = swedishParts(new Date(Math.ceil((now.getTime() + 1) / 3_600_000) * 3_600_000));
  if (next.day !== date || next.hour > 22) return morning;
  return { startsAt: swedishDate(year, month, date, next.hour), endsAt: swedishDate(year, month, date, next.hour + 1) };
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

/** The calendar's heading with only its first letter raised: "Oktober 2026", "Måndag 5 oktober 2026", "5 okt.–11 okt." (CSS capitalize raised every word: "5 Okt.–11 Okt."). */
export function planningCalendarTitle(anchor: Date, mode: PlanningCalendarMode) {
  const first = (text: string) => text.charAt(0).toLocaleUpperCase("sv-SE") + text.slice(1);
  if (mode === "month") return first(formatSwedish(anchor, { month: "long", year: "numeric" }));
  const days = planningCalendarDays(anchor, mode);
  if (mode === "day") return first(formatSwedish(days[0], { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
  return `${formatSwedish(days[0], { day: "numeric", month: "short" })}–${formatSwedish(days.at(-1)!, { day: "numeric", month: "short" })}`;
}

/**
 * The day the Dag view opens on after browsing (R2-PRJ-06): today when the shown week or month contains it, else the
 * first day of the shown period – never the last day of a week reached with Nästa.
 */
export function dayViewAnchor(anchor: Date, mode: PlanningCalendarMode, today: Date) {
  if (mode === "day") return anchor;
  const first = mode === "week" ? swedishMonday(anchor) : startOfSwedishMonth(anchor);
  const last = addSwedishDays(first, mode === "week" ? 6 : swedishDaysInMonth(anchor) - 1);
  const todayStart = startOfSwedishDay(today);
  return todayStart >= first && todayStart <= last ? today : first;
}

function swedishDaysInMonth(anchor: Date) {
  const parts = swedishParts(anchor);
  return new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();
}

/**
 * Who is away, in the calendar's short words (2026-11-02): the shortest form that is unique among the company's people. The
 * first name when only one has it, "Anna A." when two do, and the whole name if that still collides. Among all members and not only
 * those away that day: "Anna" alone on a day could otherwise be either Anna.
 */
export function shortNames(members: readonly { id: string; name: string }[]) {
  const parts = (name: string) => name.trim().split(/\s+/);
  const count = <T,>(values: readonly T[]) => { const seen = new Map<T, number>(); for (const value of values) seen.set(value, (seen.get(value) ?? 0) + 1); return seen; };
  const first = count(members.map((member) => parts(member.name)[0]));
  const initial = (name: string) => { const [given, family] = parts(name); return family ? `${given} ${family[0]}.` : given; };
  const withInitial = count(members.map((member) => initial(member.name)));
  return new Map(members.map((member) => [member.id, first.get(parts(member.name)[0]) === 1 ? parts(member.name)[0]
    : withInitial.get(initial(member.name)) === 1 ? initial(member.name) : member.name.trim()]));
}
