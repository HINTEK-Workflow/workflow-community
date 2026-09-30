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
