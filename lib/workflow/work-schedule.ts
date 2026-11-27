import { z } from "zod";

export const DEFAULT_WEEKLY_WORK_MINUTES = 40 * 60;
export const weeklyWorkMinutesSchema = z.number().int().min(0).max(7 * 24 * 60);
export const weeklyWorkMinutesOverrideSchema = weeklyWorkMinutesSchema.nullable();

// A Local file has a local owner, not a verified Cloud user identity. The Cloud
// reimport boundary is therefore fail-closed for both schedule values.
export const CLOUD_WORK_SCHEDULE_IMPORT_POLICY = {
  organization: "PRESERVED",
  memberOverride: "PRESERVED",
} as const;

export function effectiveWeeklyWorkMinutes(organizationMinutes: number, memberMinutes: number | null | undefined) {
  return memberMinutes ?? organizationMinutes;
}

export function weeklyWorkRemainingMinutes(reportedMinutes: number, organizationMinutes: number, memberMinutes: number | null | undefined) {
  return Math.max(0, effectiveWeeklyWorkMinutes(organizationMinutes, memberMinutes) - Math.max(0, reportedMinutes));
}

const dayNumber = (day: string) => Math.floor(Date.parse(`${day}T12:00:00Z`) / 86_400_000);

/** The workdays, Monday to Friday, among the days `from` to `to` (YYYY-MM-DD, both included) up to and including `today`. */
export function workdaysSoFar(from: string, to: string, today: string): number {
  const first = dayNumber(from), last = Math.min(dayNumber(to), dayNumber(today));
  let count = 0;
  // Day 0 (1970-01-01) was a Thursday: (n + 3) % 7 is 0 on a Monday … 6 on a Sunday.
  for (let day = first; day <= last; day += 1) if ((day + 3) % 7 < 5) count += 1;
  return count;
}

/**
 * The ordinary time expected so far in a period (2026-11-22): every workday Monday–Friday from its first day up to and
 * including today, or to its last day when that is earlier, with the ordinary day – a fifth of the weekly time (40 h ⇒ 8 h).
 * Saturday and Sunday add nothing, so a week viewed at the weekend compares with Monday–Friday, and a week ahead expects nothing.
 */
export function expectedWorkMinutesSoFar(input: { from: string; to: string; today: string; weeklyMinutes: number }): number {
  return Math.round(workdaysSoFar(input.from, input.to, input.today) * Math.max(0, input.weeklyMinutes) / 5);
}

/**
 * Ingen fast arbetstid (2026-10-30): a person paid by the hour has no expected time and no capacity – 0 a week, so
 * they are never "missing time" and never count in capacity or load. Otherwise the person's own hours, else the company's.
 */
export function expectedWeeklyWorkMinutes(organizationMinutes: number, member: { weeklyWorkMinutes: number | null | undefined; noFixedHours?: boolean | null }) {
  return member.noFixedHours ? 0 : effectiveWeeklyWorkMinutes(organizationMinutes, member.weeklyWorkMinutes);
}

// ---------- the company's workday (2026-10-30) ----------

/**
 * The company's ordinary workday, start and end in minutes after midnight. Only a suggestion in the time report (time on another
 * day starts there); no schedule, no overtime – the payroll or time system handles that. The database checks the same bounds.
 */
export const DEFAULT_WORKDAY = { startMinutes: 7 * 60, endMinutes: 16 * 60 } as const;
export const workdaySchema = z.object({
  startMinutes: z.number().int().min(0).max(1439),
  endMinutes: z.number().int().min(1).max(1440),
}).refine((value) => value.startMinutes < value.endMinutes, { message: "Arbetsdagen måste sluta efter att den börjar.", path: ["endMinutes"] });
export type Workday = z.infer<typeof workdaySchema>;

/** Minutes after midnight as HH:MM (1440 is 24:00). */
export const clockOfMinutes = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** HH:MM (from a time field) as minutes after midnight, or null; 24:00 is the end of the day. */
export function minutesOfClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return Number(match[2]) < 60 && minutes <= 1440 ? minutes : null;
}

/** A workday as typed (two time fields): the minutes, or what is wrong. */
export function workdayInput(start: string, end: string): { workday: Workday | null; problem: string } {
  const startMinutes = minutesOfClock(start); const endMinutes = minutesOfClock(end);
  if (startMinutes === null || endMinutes === null) return { workday: null, problem: "Ange start och slut." };
  const parsed = workdaySchema.safeParse({ startMinutes, endMinutes });
  return parsed.success ? { workday: parsed.data, problem: "" } : { workday: null, problem: parsed.error.issues[0]?.message ?? "Kontrollera arbetsdagen." };
}
