import { addSwedishDays, formatSwedish, fromSwedishDateTimeInput, NONEXISTENT_TIME_ERROR, startOfSwedishDay, swedishDayKey, toSwedishDateTimeInput } from "@/lib/swedish-time";

/**
 * Återkommande och kö (2026-11-12), pure – shared by the dialog, the list, the server and the tests.
 *
 * - The company keeps one publishing rhythm for posts: weekdays and a clock time in Swedish time (default Monday, Wednesday and
 *   Friday at 08:00, as a series). It is a rhythm, never a repeated post: the same content is never published twice by itself.
 * - Schemalägg suggests the rhythm's next free time; Schemalägg i tur och ordning spreads chosen drafts over the next free times.
 * - A time is taken when another post is planned less than an hour from it, so two posts never share a slot.
 * - A time must be at least five minutes ahead (the job runs every five minutes); a time that does not exist the night summer
 *   time starts is left out.
 */
export type Rhythm = { weekdays: number[]; time: string };
export const DEFAULT_RHYTHM: Rhythm = { weekdays: [0, 2, 4], time: "08:00" };
/** The quick clock times in the dialog; any other time can be typed. */
export const COMMON_TIMES = ["08:00", "12:00", "17:00"] as const;
/** Two posts closer than this count as the same slot. */
export const SLOT_GAP_MS = 60 * 60_000;
/** How far ahead a suggested time must be. */
export const SLOT_MIN_AHEAD_MS = 5 * 60_000;
/** How many drafts one press may queue. */
export const QUEUE_MAX = 30;
const HORIZON_DAYS = 380;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Why the rhythm cannot be used, or null. */
export function rhythmProblem(rhythm: Rhythm): string | null {
  if (!Array.isArray(rhythm.weekdays) || !rhythm.weekdays.length || rhythm.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) return "Välj minst en veckodag.";
  if (!TIME.test(rhythm.time)) return "Välj ett klockslag.";
  return null;
}

/** The rhythm with each weekday once, in order. */
export const normalizeRhythm = (rhythm: Rhythm): Rhythm => ({ weekdays: [...new Set(rhythm.weekdays)].sort((left, right) => left - right), time: rhythm.time });

const WEEKDAY_TEXT = ["mån", "tis", "ons", "tor", "fre", "lör", "sön"] as const;
/** "mån, ons och fre kl. 08:00". */
export function rhythmText(rhythm: Rhythm): string {
  const days = normalizeRhythm(rhythm).weekdays.map((day) => WEEKDAY_TEXT[day]);
  const list = days.length > 1 ? `${days.slice(0, -1).join(", ")} och ${days[days.length - 1]}` : days[0] ?? "";
  return `${list} kl. ${rhythm.time}`;
}

/** Whether another planned post is less than an hour from `at`. */
export const isTaken = (at: Date, taken: readonly Date[]) => taken.some((other) => Math.abs(other.getTime() - at.getTime()) < SLOT_GAP_MS);

/** The day key (YYYY-MM-DD) of `days` days after today in Swedish time. */
const dayAfter = (now: Date, days: number) => swedishDayKey(addSwedishDays(startOfSwedishDay(now), days));
const weekdayOf = (day: string) => (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;

/**
 * The rhythm's next free times, in order: from `fromDay` (or today), on the rhythm's weekdays at its time, at least five minutes
 * ahead, never within an hour of a taken time, and never two in the same slot.
 */
export function rhythmSlots(rhythm: Rhythm, options: { count: number; taken?: readonly Date[]; now?: Date; fromDay?: string | null }): Date[] {
  if (rhythmProblem(rhythm) || options.count <= 0) return [];
  const now = options.now ?? new Date();
  const days = new Set(rhythm.weekdays);
  const taken = [...(options.taken ?? [])];
  const today = swedishDayKey(now);
  const start = options.fromDay && DAY.test(options.fromDay) && options.fromDay > today ? options.fromDay : today;
  const slots: Date[] = [];
  for (let offset = 0; offset <= HORIZON_DAYS && slots.length < options.count; offset += 1) {
    const day = dayAfter(now, offset);
    if (day < start || !days.has(weekdayOf(day))) continue;
    const at = fromSwedishDateTimeInput(`${day}T${rhythm.time}`);
    if (!at || at.getTime() < now.getTime() + SLOT_MIN_AHEAD_MS || isTaken(at, taken)) continue;
    slots.push(at);
    taken.push(at);
  }
  return slots;
}

/** The rhythm's next free time, or null. */
export const nextFreeSlot = (rhythm: Rhythm, taken: readonly Date[] = [], now = new Date()) => rhythmSlots(rhythm, { count: 1, taken, now })[0] ?? null;

/** The chosen drafts in their order, each at the next free time of the rhythm; a reason when there are none or too many. */
export function spreadQueue(postIds: readonly string[], rhythm: Rhythm, options: { taken?: readonly Date[]; now?: Date; fromDay?: string | null } = {}): { postId: string; at: Date }[] | { error: string } {
  if (!postIds.length) return { error: "Välj minst ett inlägg." };
  if (postIds.length > QUEUE_MAX) return { error: `Välj högst ${QUEUE_MAX} inlägg åt gången.` };
  if (new Set(postIds).size !== postIds.length) return { error: "Ett inlägg finns två gånger i listan." };
  const problem = rhythmProblem(rhythm);
  if (problem) return { error: problem };
  const slots = rhythmSlots(rhythm, { count: postIds.length, ...options });
  if (slots.length < postIds.length) return { error: "Det finns inte tillräckligt många tider inom ett år. Välj fler veckodagar." };
  return postIds.map((postId, index) => ({ postId, at: slots[index] }));
}

/**
 * The approval of a queue: the server spreads the drafts again, and the times must be exactly the ones the admin saw (another
 * post may have taken a slot since). The plan, or why nothing is scheduled.
 */
export function confirmQueue(items: readonly { postId: string; at: string }[], rhythm: Rhythm, options: { taken?: readonly Date[]; now?: Date; fromDay?: string | null } = {}): { postId: string; at: Date }[] | { error: string } {
  const plan = spreadQueue(items.map((item) => item.postId), rhythm, options);
  if ("error" in plan) return plan;
  if (plan.some((entry, index) => toSwedishDateTimeInput(entry.at) !== items[index].at)) return { error: "Tiderna har ändrats sedan listan visades. Titta på tiderna igen." };
  return plan;
}

/** Why a chosen day and time (YYYY-MM-DDTHH:MM, Swedish) cannot be used in the dialog, or null – the server's own rules (lib/schedule/model.ts). */
export function scheduleTimeProblem(value: string, now = new Date()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return "Välj dag och klockslag.";
  const at = fromSwedishDateTimeInput(value);
  if (!at) return NONEXISTENT_TIME_ERROR;
  if (at.getTime() < now.getTime() + 60_000) return "Tiden har redan passerat. Välj en senare tid.";
  if (at.getTime() > now.getTime() + 400 * 86_400_000) return "Välj en tid inom ett år.";
  return null;
}

/** Moves one entry a step up (-1) or down (+1); the list unchanged at its ends. */
export function moveInOrder<T>(list: readonly T[], index: number, step: -1 | 1): T[] {
  const target = index + step;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return [...list];
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

// ---------- words ----------

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const clock = (at: Date) => formatSwedish(at, { hour: "2-digit", minute: "2-digit" });

/** "onsdag 12 november" (and the year when it is not this year's). */
export function dayText(at: Date, now = new Date()) {
  const sameYear = swedishDayKey(at).slice(0, 4) === swedishDayKey(now).slice(0, 4);
  return formatSwedish(at, { weekday: "long", day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }) });
}

/** "Idag", "Imorgon" or "Onsdag 19 november" – a day's heading in the list. */
export function dayHeading(at: Date, now = new Date()) {
  const day = swedishDayKey(at);
  if (day === dayAfter(now, 0)) return "I dag";
  if (day === dayAfter(now, 1)) return "I morgon";
  if (day === dayAfter(now, -1)) return "I går";
  return capital(dayText(at, now));
}

/** "Publiceras onsdag 12 november kl. 08:00" (idag/imorgon by name). */
export function scheduleSentence(at: Date, now = new Date()) {
  const heading = dayHeading(at, now);
  const day = heading === "I dag" || heading === "I morgon" ? `${heading.toLowerCase()}, ${dayText(at, now)}` : dayText(at, now);
  return `Publiceras ${day} kl. ${clock(at)}`;
}

/** The quick day choices: Idag, Imorgon and the next days by name ("Lör 15"). */
export function quickDays(now = new Date(), count = 7): { day: string; label: string }[] {
  return Array.from({ length: count }, (_, offset) => {
    const at = addSwedishDays(startOfSwedishDay(now), offset);
    const day = swedishDayKey(at);
    const label = offset === 0 ? "I dag" : offset === 1 ? "I morgon" : `${capital(WEEKDAY_TEXT[weekdayOf(day)])} ${Number(day.slice(8))}`;
    return { day, label };
  });
}

/** Groups items by their Swedish day, in the items' order. */
export function groupByDay<T>(items: readonly T[], at: (item: T) => Date | string): { day: string; at: Date; items: T[] }[] {
  const groups: { day: string; at: Date; items: T[] }[] = [];
  for (const item of items) {
    const when = new Date(at(item));
    const day = swedishDayKey(when);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(item);
    else groups.push({ day, at: when, items: [item] });
  }
  return groups;
}
