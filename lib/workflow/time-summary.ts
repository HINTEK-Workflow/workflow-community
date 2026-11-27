import { addSwedishDays, swedishDayKey, swedishMonday } from "@/lib/swedish-time";

export type TimeSummaryEntry = { startedAt: string; durationSec: number };

export type WeekDaySummary = { date: Date; seconds: number };

/** Swedish Monday 00:00 (Europe/Stockholm) of the week containing `value`. */
export function mondayFor(value: Date) {
  return swedishMonday(value);
}

/** Uses Swedish calendar days because the whole product presents time in Europe/Stockholm. */
export function summarizeReportedWeek(entries: TimeSummaryEntry[], anchor: Date) {
  const monday = mondayFor(anchor);
  const days: WeekDaySummary[] = Array.from({ length: 7 }, (_, index) => {
    const date = addSwedishDays(monday, index);
    const key = swedishDayKey(date);
    return {
      date,
      seconds: entries
        .filter((entry) => swedishDayKey(entry.startedAt) === key)
        .reduce((sum, entry) => sum + (Number.isFinite(entry.durationSec) ? Math.max(0, entry.durationSec) : 0), 0),
    };
  });
  const totalSeconds = days.reduce((sum, day) => sum + day.seconds, 0);
  const weekdayPeakSeconds = Math.max(60, ...days.slice(0, 5).map((day) => day.seconds));
  return { days, totalSeconds, weekdayPeakSeconds };
}
