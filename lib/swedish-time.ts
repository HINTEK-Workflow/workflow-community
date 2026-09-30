// Product-wide calendar time: every calendar day, week, day boundary and displayed clock time is Swedish time
// (Europe/Stockholm) regardless of the browser's or server's time zone. Instants are still stored as absolute times.
export const SWEDISH_TIME_ZONE = "Europe/Stockholm";

type DateInput = Date | string | number;
export type SwedishParts = { year: number; month: number; day: number; hour: number; minute: number; second: number; /** 0 = Monday … 6 = Sunday */ weekday: number };

const weekdays: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const partsFormatter = new Intl.DateTimeFormat("en-US", { timeZone: SWEDISH_TIME_ZONE, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", weekday: "short" });
const pad = (value: number) => String(value).padStart(2, "0");
const toDate = (value: DateInput) => value instanceof Date ? value : new Date(value);

export function swedishParts(value: DateInput): SwedishParts {
  const parts: Record<string, string> = {};
  for (const part of partsFormatter.formatToParts(toDate(value))) parts[part.type] = part.value;
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour) % 24, minute: Number(parts.minute), second: Number(parts.second), weekday: weekdays[parts.weekday] ?? 0 };
}

// Difference between Swedish wall-clock time and UTC at an instant, in milliseconds.
function offsetAt(instant: number) {
  const whole = instant - (((instant % 1000) + 1000) % 1000);
  const parts = swedishParts(whole);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - whole;
}

/** The instant of a Swedish wall-clock time. Overflowing days/months roll over like Date.UTC. */
export function swedishDate(year: number, month: number, day: number, hour = 0, minute = 0, second = 0) {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const first = wall - offsetAt(wall);
  return new Date(wall - offsetAt(first));
}

export const swedishDayKey = (value: DateInput) => { const parts = swedishParts(value); return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`; };
export const isSameSwedishDay = (left: DateInput, right: DateInput) => swedishDayKey(left) === swedishDayKey(right);
export function startOfSwedishDay(value: DateInput) { const parts = swedishParts(value); return swedishDate(parts.year, parts.month, parts.day); }
/** Moves whole Swedish calendar days while keeping the Swedish clock time. */
export function addSwedishDays(value: DateInput, days: number) { const parts = swedishParts(value); return swedishDate(parts.year, parts.month, parts.day + days, parts.hour, parts.minute, parts.second); }
export function swedishMonday(value: DateInput) { const parts = swedishParts(value); return swedishDate(parts.year, parts.month, parts.day - parts.weekday); }
export function startOfSwedishMonth(value: DateInput, monthOffset = 0) { const parts = swedishParts(value); return swedishDate(parts.year, parts.month + monthOffset, 1); }
/** Whole Swedish calendar days from `from` to `to`. */
export function swedishDayDifference(from: DateInput, to: DateInput) {
  const left = swedishParts(from); const right = swedishParts(to);
  return Math.round((Date.UTC(right.year, right.month - 1, right.day) - Date.UTC(left.year, left.month - 1, left.day)) / 86_400_000);
}

/** Value for <input type="datetime-local"> showing Swedish time. */
export function toSwedishDateTimeInput(value: DateInput) { const parts = swedishParts(value); return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`; }
/** Parses a datetime-local value as Swedish time; returns null for an invalid value. */
export function fromSwedishDateTimeInput(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  const result = swedishDate(year, month, day, hour, minute);
  return Number.isFinite(result.getTime()) ? result : null;
}
/** Parses a YYYY-MM-DD value as the start of that Swedish day. */
export function fromSwedishDateInput(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? swedishDate(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
/** Formats in Swedish locale and Swedish time. */
export function formatSwedish(value: DateInput, options: Intl.DateTimeFormatOptions = { dateStyle: "short", timeStyle: "short" }) {
  const key = JSON.stringify(options);
  let formatter = formatters.get(key);
  if (!formatter) { formatter = new Intl.DateTimeFormat("sv-SE", { ...options, timeZone: SWEDISH_TIME_ZONE }); formatters.set(key, formatter); }
  return formatter.format(toDate(value));
}
export const formatSwedishDate = (value: DateInput, options: Intl.DateTimeFormatOptions = { dateStyle: "short" }) => formatSwedish(value, options);
export const formatSwedishTime = (value: DateInput, options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" }) => formatSwedish(value, options);
