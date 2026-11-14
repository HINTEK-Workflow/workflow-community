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
