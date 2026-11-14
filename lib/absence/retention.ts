import { z } from "zod";
import { swedishDayKey } from "@/lib/swedish-time";
import { retentionCutoff } from "@/lib/workflow/history-retention";

/**
 * Frånvarons lagringstid (2026-10-30): each company chooses how many months absence is kept (1–120, 12 from the start;
 * the database checks the same bounds). Every night the absence that ended longer ago than that is removed, with the history
 * lines older than the limit. Pure rules shared by the settings, the nightly job and the tests; no Prisma here.
 */
export const ABSENCE_RETENTION_DEFAULT_MONTHS = 12;
export const ABSENCE_RETENTION_MIN_MONTHS = 1;
export const ABSENCE_RETENTION_MAX_MONTHS = 120;

export const absenceRetentionMonthsSchema = z.number().int("Ange hela månader.")
  .min(ABSENCE_RETENTION_MIN_MONTHS, `Minst ${ABSENCE_RETENTION_MIN_MONTHS} månad.`)
  .max(ABSENCE_RETENTION_MAX_MONTHS, `Högst ${ABSENCE_RETENTION_MAX_MONTHS} månader.`);

/** A stored value read safely: anything outside the bounds is the default. */
export const absenceRetentionMonthsOf = (value: unknown) => {
  const parsed = absenceRetentionMonthsSchema.safeParse(value);
  return parsed.success ? parsed.data : ABSENCE_RETENTION_DEFAULT_MONTHS;
};

/**
 * The limit as of now: absence whose last day (toDate, a Swedish day) is before `day` is removed, and history lines created
 * before `instant`. The same months back as the history retention (the same day of the month, within the month).
 */
export function absenceRetentionCutoff(months: number, now = new Date()) {
  const instant = retentionCutoff(absenceRetentionMonthsOf(months), now);
  return { instant, day: swedishDayKey(instant) };
}

/** Whether an absence has passed the company's limit (its last day is before the cutoff day). */
export const absenceExpired = (absence: { to: string }, cutoffDay: string) => absence.to < cutoffDay;
