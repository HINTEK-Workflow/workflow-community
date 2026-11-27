import { countsInPlanning, isWorkday, type Absence } from "@/lib/workflow/absence";

/**
 * Varning vid bokning (användartest 2026-10-31, F8): a person booked when they are already booked, or on a day they are away,
 * is told at once – the booking is still saved (the check is advisory, as the card Tidskrockar on Kapacitet). Only
 * times and days are named, never another booking's title or the reason for an absence, so the warning shows nothing the
 * booker may not read. Pure: the server passes the other bookings and the absences it read for the booked people.
 */
export type WarnBooking = { id: string; startsAt: string; endsAt: string; userIds: readonly string[] };

const MAX_ITEMS = 3;
const nextDay = (value: string) => { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10); };
const MONTHS = ["jan", "feb", "mars", "apr", "maj", "juni", "juli", "aug", "sep", "okt", "nov", "dec"];
const short = (day: string) => { const [, month, date] = day.split("-").map(Number); return `${date} ${MONTHS[(month ?? 1) - 1] ?? ""}`.trim(); };

/** The days a booking covers (Swedish days, the last moment included), at most 62. */
export function bookingDays(booking: Pick<WarnBooking, "startsAt" | "endsAt">, swedishDay: (iso: string) => string) {
  const first = swedishDay(booking.startsAt);
  const last = swedishDay(new Date(Math.max(Date.parse(booking.startsAt), Date.parse(booking.endsAt) - 1)).toISOString());
  const days: string[] = [];
  for (let value = first; value <= last && days.length < 62; value = nextDay(value)) days.push(value);
  return days;
}

/** Each clash of the booked people: another active booking that overlaps in time, or an approved absence on a workday it covers. */
export function bookingClashes(input: {
  booking: WarnBooking; others: readonly WarnBooking[]; absences: readonly Absence[];
  swedishDay: (iso: string) => string; swedishClock: (iso: string) => string;
}) {
  const start = Date.parse(input.booking.startsAt), end = Date.parse(input.booking.endsAt);
  const days = bookingDays(input.booking, input.swedishDay);
  const clashes: { userId: string; kind: "booked" | "absent"; text: string }[] = [];
  for (const userId of new Set(input.booking.userIds)) {
    for (const other of input.others) {
      if (other.id === input.booking.id || !other.userIds.includes(userId)) continue;
      if (!(Date.parse(other.startsAt) < end && Date.parse(other.endsAt) > start)) continue;
      const day = input.swedishDay(other.startsAt);
      const lastDay = input.swedishDay(new Date(Date.parse(other.endsAt) - 1).toISOString());
      const when = day === lastDay ? `${short(day)} ${input.swedishClock(other.startsAt)}–${input.swedishClock(other.endsAt)}` : `${short(day)}–${short(lastDay)}`;
      clashes.push({ userId, kind: "booked", text: `redan bokad ${when}` });
    }
    const away = days.filter((day) => isWorkday(day) && input.absences.some((absence) => absence.userId === userId && countsInPlanning(absence) && absence.from <= day && absence.to >= day
      && (!absence.hours || (day === input.swedishDay(input.booking.startsAt) || day === input.swedishDay(input.booking.endsAt)
        ? overlapsHours(absence.hours, day, input) : true))));
    if (away.length) clashes.push({ userId, kind: "absent", text: `frånvarande ${away.length === 1 ? short(away[0]) : `${short(away[0])}–${short(away[away.length - 1])}`}` });
  }
  return clashes;
}

function overlapsHours(hours: { start: string; end: string }, day: string, input: { booking: WarnBooking; swedishDay: (iso: string) => string; swedishClock: (iso: string) => string }) {
  const start = input.swedishDay(input.booking.startsAt) === day ? input.swedishClock(input.booking.startsAt) : "00:00";
  const end = input.swedishDay(input.booking.endsAt) === day ? input.swedishClock(input.booking.endsAt) : "24:00";
  return start < hours.end && end > hours.start;
}

/** The warning in words, or "" when nothing clashes: "Krockar: Anna är redan bokad 2 nov 07:00–15:00. Bo är frånvarande 3 nov." (the caller says first that the booking is saved). */
export function bookingWarningText(clashes: readonly { userId: string; text: string }[], nameOf: (userId: string) => string) {
  if (!clashes.length) return "";
  const byPerson = new Map<string, string[]>();
  for (const clash of clashes) byPerson.set(clash.userId, [...(byPerson.get(clash.userId) ?? []), clash.text]);
  const lines = [...byPerson.entries()].map(([userId, texts]) => `${nameOf(userId)} är ${[...new Set(texts)].slice(0, 2).join(" och ")}${texts.length > 2 ? " med mera" : ""}.`);
  const shown = lines.slice(0, MAX_ITEMS).join(" ");
  return `Krockar: ${shown}${lines.length > MAX_ITEMS ? ` Och ${lines.length - MAX_ITEMS} till.` : ""}`;
}
