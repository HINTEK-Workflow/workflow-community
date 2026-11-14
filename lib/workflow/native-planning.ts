import { swedishDate, swedishDayKey } from "@/lib/swedish-time";

/**
 * Planering på nivå 1 (2026-10-09): on a phone at level 1 the planning is a week list per person instead of a
 * calendar grid – a group per person with that person's bookings and rounds of the week, day by day. Pure, so the page
 * and the tests read the same. Display only: the list holds what the server already let the person read.
 */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const dayNumber = (day: string) => {
  const match = DAY.exec(day);
  if (!match) return NaN;
  return Math.round(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000);
};
const dayKey = (value: number) => new Date(value * 86_400_000).toISOString().slice(0, 10);

export type PlanningWeek = { days: string[]; from: string; to: string; week: number };

/** The week (Monday to Sunday) a YYYY-MM-DD day belongs to, with its ISO week number. */
export function planningWeekOf(day: string): PlanningWeek {
  const value = dayNumber(day);
  if (!Number.isFinite(value)) throw new Error(`Ogiltigt datum: ${day}`);
  // 1970-01-01 was a Thursday: (n + 3) % 7 is 0 on a Monday.
  const monday = value - ((value + 3) % 7 + 7) % 7;
  const days = Array.from({ length: 7 }, (_, index) => dayKey(monday + index));
  // ISO 8601: week 1 is the week with the year's first Thursday (the week that holds 4 January).
  const thursdayYear = Number(dayKey(monday + 3).slice(0, 4));
  const jan4 = dayNumber(`${thursdayYear}-01-04`);
  const firstMonday = jan4 - ((jan4 + 3) % 7 + 7) % 7;
  return { days, from: days[0], to: days[6], week: Math.floor((monday - firstMonday) / 7) + 1 };
}

/** The same weekday `weeks` weeks later (or earlier with a negative number). */
export const shiftPlanningWeek = (day: string, weeks: number) => dayKey(dayNumber(day) + 7 * weeks);

type Booking = { id: string; startsAt: string; endsAt: string; assignedToUserIds: string[]; assignedToName?: string | null; deletedAt?: string | null };
type Round = { key: string; date: string; assignedToUserId?: string | null; assignedToName?: string | null; /** Klockslag "07:00" (2026-10-28); none: the whole day. */ time?: string | null };
export type PlanningWeekItem<A, R> = { kind: "activity"; day: string; activity: A } | { kind: "round"; day: string; round: R };
export type PlanningPerson<A, R> = { key: string; name: string; me: boolean; items: PlanningWeekItem<A, R>[] };
export const UNALLOCATED = "unallocated";

/**
 * The week's bookings and rounds grouped by person: the person's own group first, then the members in their order,
 * others by name, and what has no one last ("Oallokerad"). A booking with several people is in each person's group; one
 * running over several days is shown on its first day in the week. Removed bookings are left out. Inside a group the
 * items follow the day and the start time.
 */
export function planningWeekByPerson<A extends Booking, R extends Round>(activities: readonly A[], rounds: readonly R[], week: Pick<PlanningWeek, "from" | "to">,
  people: readonly { id: string; name: string }[], me: string, dayOf: (iso: string) => string = (iso) => swedishDayKey(iso)): PlanningPerson<A, R>[] {
  const groups = new Map<string, PlanningPerson<A, R>>();
  const names = new Map(people.map((person) => [person.id, person.name]));
  const add = (key: string, name: string, item: PlanningWeekItem<A, R>) => {
    const group = groups.get(key) ?? { key, name, me: key === me, items: [] };
    group.items.push(item);
    groups.set(key, group);
  };
  const owners = (ids: readonly string[], name: string | null | undefined) => {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length) return unique.map((id) => ({ key: id, name: names.get(id) ?? (unique.length === 1 && name?.trim() ? name.trim() : "Okänd person") }));
    return name?.trim() ? [{ key: `name:${name.trim()}`, name: name.trim() }] : [{ key: UNALLOCATED, name: "Ingen ansvarig" }];
  };
  for (const activity of activities) {
    if (activity.deletedAt) continue;
    const start = dayOf(activity.startsAt);
    // An activity that ends at midnight belongs to the day before.
    const endTime = Date.parse(activity.endsAt);
    const end = Number.isFinite(endTime) && endTime > Date.parse(activity.startsAt) ? dayOf(new Date(endTime - 1).toISOString()) : start;
    if (start > week.to || end < week.from) continue;
    const day = start < week.from ? week.from : start;
    for (const owner of owners(activity.assignedToUserIds, activity.assignedToName)) add(owner.key, owner.name, { kind: "activity", day, activity });
  }
  for (const round of rounds) {
    if (round.date < week.from || round.date > week.to) continue;
    for (const owner of owners(round.assignedToUserId ? [round.assignedToUserId] : [], round.assignedToName)) add(owner.key, owner.name, { kind: "round", day: round.date, round });
  }
  const order = new Map(people.map((person, index) => [person.id, index]));
  const rank = (group: PlanningPerson<A, R>) => group.me ? -1 : group.key === UNALLOCATED ? Number.MAX_SAFE_INTEGER : order.get(group.key) ?? people.length;
  // A round with a klockslag (2026-10-28) takes its place by that Swedish time; without one it comes first on its day.
  const time = (item: PlanningWeekItem<A, R>) => item.kind === "activity" ? Date.parse(item.activity.startsAt) || 0
    : item.round.time ? swedishDate(Number(item.day.slice(0, 4)), Number(item.day.slice(5, 7)), Number(item.day.slice(8, 10)), Number(item.round.time.slice(0, 2)), Number(item.round.time.slice(3, 5))).getTime() : -Infinity;
  return [...groups.values()]
    .map((group) => ({ ...group, items: group.items.sort((left, right) => left.day.localeCompare(right.day) || (time(left) === time(right) ? 0 : time(left) < time(right) ? -1 : 1)) }))
    .sort((left, right) => rank(left) - rank(right) || left.name.localeCompare(right.name, "sv"));
}
