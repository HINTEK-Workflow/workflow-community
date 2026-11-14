import { swedishParts, swedishRepeatedHour, SWEDISH_TIME_ZONE } from "@/lib/swedish-time";

/**
 * A calendar file by RFC 5545 (PL14, 2026-11-01), pure so it is tested without a server. Lines end with CRLF and are folded at
 * 75 octets without splitting a character, text values are escaped, and a time is written in Swedish local time with TZID
 * and the zone's own rules (VTIMEZONE). The second pass of the hour repeated when the clocks go back cannot be told apart in
 * local time (the standard then means the first), so that one instant is written in UTC. An all-day event has a DATE and an end
 * that is the day after its last, as the standard says.
 */
const CRLF = "\r\n";
const MAX_OCTETS = 75;
const encoder = new TextEncoder();
const pad = (value: number, length = 2) => String(value).padStart(length, "0");

/** TEXT by RFC 5545 3.3.11: backslash, semicolon, comma and line breaks are escaped; other control characters are left out. */
export function escapeIcalText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/** Folds one content line (RFC 5545 3.1): no physical line over 75 octets, the space that starts a continuation counts, and no character is split. */
export function foldIcalLine(line: string): string {
  if (encoder.encode(line).length <= MAX_OCTETS) return line;
  const parts: string[] = [];
  let current = "";
  let octets = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (octets + size > MAX_OCTETS) {
      parts.push(current);
      current = " ";
      octets = 1;
    }
    current += character;
    octets += size;
  }
  parts.push(current);
  return parts.join(CRLF);
}

/** 20261101T080000Z */
export function utcStamp(value: Date): string {
  return `${value.getUTCFullYear()}${pad(value.getUTCMonth() + 1)}${pad(value.getUTCDate())}T${pad(value.getUTCHours())}${pad(value.getUTCMinutes())}${pad(value.getUTCSeconds())}Z`;
}

/** DTSTART;TZID=Europe/Stockholm:20261101T090000, or in UTC for the second pass of the repeated hour. */
export function timeProperty(name: "DTSTART" | "DTEND", value: Date): string {
  if (swedishRepeatedHour(value) === "winter") return `${name}:${utcStamp(value)}`;
  const parts = swedishParts(value);
  return `${name};TZID=${SWEDISH_TIME_ZONE}:${parts.year}${pad(parts.month)}${pad(parts.day)}T${pad(parts.hour)}${pad(parts.minute)}${pad(parts.second)}`;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** YYYY-MM-DD that is a real day. */
export const isCalendarDay = (value: unknown): value is string => {
  const match = typeof value === "string" ? DAY.exec(value) : null;
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
};
const compactDay = (day: string) => day.replaceAll("-", "");
/** The day after a YYYY-MM-DD, without a clock: a calendar day has no time zone. */
export function nextCalendarDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(year, month - 1, date + 1));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

export type CalendarEventCategory = "Bokning" | "Arbetsorder" | "Jour";
type EventBase = {
  /** Stable for the same thing, so a calendar updates the event instead of adding a new one. */
  uid: string;
  summary: string;
  category: CalendarEventCategory;
  /** The page in Workflow; only an address with ids. */
  url?: string;
  lastModified?: Date;
};
export type CalendarEvent = EventBase & ({ kind: "time"; startsAt: Date; endsAt: Date } | { kind: "day"; firstDay: string; lastDay: string });

const TIME_ZONE_LINES = [
  "BEGIN:VTIMEZONE",
  `TZID:${SWEDISH_TIME_ZONE}`,
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

function eventLines(event: CalendarEvent, now: Date): string[] {
  const lines = ["BEGIN:VEVENT", `UID:${escapeIcalText(event.uid)}`, `DTSTAMP:${utcStamp(now)}`];
  if (event.kind === "time") lines.push(timeProperty("DTSTART", event.startsAt), timeProperty("DTEND", event.endsAt));
  else lines.push(`DTSTART;VALUE=DATE:${compactDay(event.firstDay)}`, `DTEND;VALUE=DATE:${compactDay(nextCalendarDay(event.lastDay))}`);
  lines.push(`SUMMARY:${escapeIcalText(event.summary)}`, `CATEGORIES:${escapeIcalText(event.category)}`);
  if (event.url) lines.push(`URL:${event.url}`);
  if (event.lastModified) lines.push(`LAST-MODIFIED:${utcStamp(event.lastModified)}`);
  lines.push("END:VEVENT");
  return lines;
}

/** The whole file: read only (METHOD:PUBLISH), one name, and Swedish time's rules once when a time needs them. */
export function buildCalendar(events: readonly CalendarEvent[], now: Date): string {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Workflow//SV", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:Workflow", `X-WR-TIMEZONE:${SWEDISH_TIME_ZONE}`, "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H",
    ...(events.some((event) => event.kind === "time") ? TIME_ZONE_LINES : []),
    ...events.flatMap((event) => eventLines(event, now)),
    "END:VCALENDAR",
  ];
  return lines.map(foldIcalLine).join(CRLF) + CRLF;
}
