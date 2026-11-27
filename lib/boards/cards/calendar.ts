import { z } from "zod";
import { addSwedishDays, formatSwedish, startOfSwedishDay, swedishClock, swedishDayKey, swedishMonday } from "@/lib/swedish-time";
import type { CalendarItem, CalendarShape } from "./shapes";

/**
 * Kalenderkortet (2026-11-19): the bookings of Planering's calendar for today or this week, as a list (time, who, what) or as a
 * schedule with a column per person (per day for the week). The server reads the bookings with the same rule as Planering
 * (lib/workflow/planned-activity-access.ts); the names are personal data and outside the app follow the publisher's choice. Pure.
 */
export const calendarSourceSchema = z.object({
  type: z.literal("calendar"),
  range: z.enum(["today", "week"]).optional(),
  view: z.enum(["list", "schedule"]).optional(),
});
export type CalendarSource = z.infer<typeof calendarSourceSchema>;
export const CALENDAR_RANGE_LABEL: Record<CalendarShape["range"], string> = { today: "I dag", week: "Den här veckan" };
export const CALENDAR_VIEW_LABEL: Record<CalendarShape["view"], string> = { list: "Lista", schedule: "Schema" };
export const CALENDAR_MAX_ITEMS = 200;

export type CalendarRow = { startsAt: Date | string; endsAt: Date | string; title: string; people: string[] };

/** The bounds of the card's days: today, or Monday to Sunday of this week. */
export function calendarWindow(range: CalendarShape["range"], now: Date) {
  const from = range === "today" ? startOfSwedishDay(now) : swedishMonday(now);
  const days = range === "today" ? 1 : 7;
  return { from, to: addSwedishDays(from, days), days };
}

/** The bookings cut to each day they touch, in time order; a booking over several days is shown on each of them. */
export function calendarShape(rows: readonly CalendarRow[], source: Pick<CalendarSource, "range" | "view">, now: Date): CalendarShape {
  const range = source.range ?? "today";
  const window = calendarWindow(range, now);
  const days = Array.from({ length: window.days }, (_, index) => {
    const start = addSwedishDays(window.from, index);
    return { start, end: addSwedishDays(start, 1), key: swedishDayKey(start), label: formatSwedish(start, { weekday: "short", day: "numeric", month: "short" }) };
  });
  const items: CalendarItem[] = [];
  for (const row of rows) {
    const starts = new Date(row.startsAt);
    const ends = new Date(row.endsAt);
    for (const day of days) {
      if (!(starts < day.end && ends > day.start)) continue;
      const from = starts < day.start ? day.start : starts;
      const to = ends > day.end ? day.end : ends;
      items.push({
        day: day.key, start: swedishClock(from), end: to >= day.end ? "24:00" : swedishClock(to),
        from: Math.max(0, Math.round((from.getTime() - day.start.getTime()) / 60_000)), to: Math.min(1440, Math.round((to.getTime() - day.start.getTime()) / 60_000)),
        title: row.title.trim() || "Bokning", people: row.people.filter(Boolean),
      });
    }
  }
  items.sort((a, b) => a.day.localeCompare(b.day) || a.from - b.from || a.title.localeCompare(b.title, "sv"));
  return { kind: "calendar", range, view: source.view ?? "list", days: days.map(({ key, label }) => ({ key, label })), items: items.slice(0, CALENDAR_MAX_ITEMS), total: items.length };
}

/** Outside the app: the names hidden or shortened to initials, as the publisher chose for the card. */
export function maskCalendar(shape: CalendarShape, choice: "hidden" | "initials" | "names", initials: (name: string) => string): CalendarShape {
  if (choice === "names") return shape;
  return { ...shape, items: shape.items.map((item) => ({ ...item, people: choice === "hidden" ? [] : item.people.map(initials) })) };
}

/** The schedule's columns: a person each (the day), or a day each (the week); bookings without a person get their own column. */
export function scheduleColumns(shape: CalendarShape): { key: string; label: string; short: string; items: CalendarItem[] }[] {
  if (shape.range === "week") {
    return shape.days.filter((day, index) => index < 5 || shape.items.some((item) => item.day === day.key))
      .map((day) => ({ key: day.key, label: day.label, short: shortDay(day.label), items: shape.items.filter((item) => item.day === day.key) }));
  }
  const people = [...new Set(shape.items.flatMap((item) => item.people))].sort((a, b) => a.localeCompare(b, "sv"));
  const columns = people.map((person) => ({ key: person, label: person, short: shortName(person), items: shape.items.filter((item) => item.people.includes(person)) }));
  const nobody = shape.items.filter((item) => !item.people.length);
  if (nobody.length || !columns.length) { const label = people.length ? "Utan person" : "Bokningar"; columns.push({ key: "", label, short: label, items: nobody }); }
  return columns;
}

// ---------- what fits (2026-11-20: "07:00-0" and "Elis Ham…" on a small card) ----------
//
// A time or a name is never cut in the middle. When the whole does not fit, the card shows a shorter form that does – the start time
// alone ("07:00"), a first name and an initial ("Elis H.") – and when even that does not fit, fewer columns or hour marks rather than
// anything cut. The widths are counted in em of the card's text from an average letter width, so the card measures its box once and
// asks these.

/** Average widths in em: a letter of a bold name, a digit (tabular), a colon and a dash. */
const LETTER_EM = 0.62;
const DIGIT_EM = 0.6;
/** Semibold is a little wider. */
const BOLD = 1.05;
/** The schedule's text (bookings and names) in em of the card's text; the card's title is the same in a schedule. */
export const SCHEDULE_TEXT_EM = 0.8;
/** The hour axis' width and text, in em of the card's text. */
export const SCHEDULE_AXIS_EM = 1.9;
export const SCHEDULE_HOUR_EM = 0.7;
/** The gap between columns and a booking's inset, edge and padding, in em of the card's text. */
const COLUMN_GAP_EM = 0.2;
const BOOKING_EDGE_EM = 0.2 + (0.25 + 0.6) * SCHEDULE_TEXT_EM;

/** "Elis Hammar" → "Elis H."; a single name stays. */
export function shortName(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.length < 2 ? (words[0] ?? "") : `${words[0]} ${words.at(-1)!.charAt(0).toUpperCase()}.`;
}
/** A day's label without its month ("mån 17 nov" → "mån 17"). */
export const shortDay = (label: string) => label.split(/\s+/).slice(0, 2).join(" ");

/** The width in em (at 1em) of a clock time or a range of them. */
export const timeWidthEm = (text: string) => [...text].reduce((sum, char) => sum + (/\d/.test(char) ? DIGIT_EM : char === ":" ? 0.3 : 0.55), 0) * BOLD;
const textWidthEm = (text: string) => text.length * LETTER_EM;

/** How many lines `text` takes in a box `widthEm` wide (at 1em), wrapping between words; Infinity when a word is wider than the box. */
export function linesFor(text: string, widthEm: number) {
  let lines = 0;
  let line = -1;
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    const width = textWidthEm(word);
    if (width > widthEm) return Infinity;
    if (line >= 0 && line + LETTER_EM + width <= widthEm) line += LETTER_EM + width;
    else { lines += 1; line = width; }
  }
  return lines;
}

export type ScheduleFit = { columns: number; names: "full" | "short"; time: "range" | "start"; hourStep: number };

/**
 * What the schedule can show whole in a box `widthEm` × `heightEm` (em of the card's text): as many of the columns as fit with at
 * least a start time and a short name each (at most 8), the full names when they fit on two lines, the time as a range when it fits,
 * and an hour mark every `hourStep` hours so the marks never run into each other.
 */
export function scheduleFit({ widthEm, heightEm, labels, hours }: { widthEm: number; heightEm: number; labels: readonly { label: string; short: string }[]; hours: number }): ScheduleFit {
  const columnWidth = (count: number) => (widthEm - SCHEDULE_AXIS_EM - COLUMN_GAP_EM * (count - 1)) / Math.max(1, count);
  const nameFits = (column: number, pick: (item: { label: string; short: string }) => string, count: number) =>
    labels.slice(0, count).every((item) => linesFor(pick(item), (column - 0.2) / SCHEDULE_TEXT_EM) <= 2);
  const startFits = (column: number) => column - BOOKING_EDGE_EM >= timeWidthEm("07:00") * SCHEDULE_TEXT_EM;
  let count = Math.max(1, Math.min(8, labels.length));
  while (count > 1 && !(startFits(columnWidth(count)) && nameFits(columnWidth(count), (item) => item.short, count))) count -= 1;
  const column = columnWidth(count);
  const names = nameFits(column, (item) => item.label, count) ? "full" : "short";
  const time = column - BOOKING_EDGE_EM >= timeWidthEm("07:00–08:00") * SCHEDULE_TEXT_EM ? "range" : "start";
  // The axis' marks need about 1.3 lines of their own text between them.
  const perHour = heightEm / Math.max(1, hours);
  const hourStep = [1, 2, 3, 4, 6, 12].find((step) => step * perHour >= SCHEDULE_HOUR_EM * 1.3) ?? 12;
  return { columns: count, names, time, hourStep };
}

/**
 * The people of a booking in a box `widthEm` wide at `textEm`: the full names when they fit, else first names with an initial, else
 * the first of them and "+2" for the rest, else nothing (the booking's title still says what it is, and the names are in its tooltip).
 */
export function peopleFit(people: readonly string[], widthEm: number, textEm = 1) {
  if (!people.length) return "";
  const fits = (text: string) => textWidthEm(text) * textEm <= widthEm;
  const full = people.join(", ");
  if (fits(full)) return full;
  const short = people.map(shortName).join(", ");
  if (fits(short)) return short;
  const first = people.length > 1 ? `${shortName(people[0]!)} +${people.length - 1}` : shortName(people[0]!);
  return fits(first) ? first : "";
}

/** The hours the schedule shows: the working day, widened to the bookings. */
export function scheduleHours(items: readonly CalendarItem[]) {
  const first = Math.min(7 * 60, ...items.map((item) => item.from));
  const last = Math.max(17 * 60, ...items.map((item) => item.to));
  return { from: Math.floor(first / 60), to: Math.min(24, Math.ceil(last / 60)) };
}
