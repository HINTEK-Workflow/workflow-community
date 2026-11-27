/**
 * Återimport Local → Cloud of the facilities' limit profiles and the round schedules (2026-10-06). The same rule as the
 * other records: Cloud is never overwritten silently. A record exported from Cloud carries `cloudOrigin` (its Cloud id
 * and version at export); it updates Cloud only when Cloud still has that version, otherwise a changed record is kept as
 * a separate conflict copy. No database access here, so the rules can be tested on their own.
 */
export type FormSettingOrigin = { id: string; version: number };
export type LimitProfileOutcome = "CREATE" | "UPDATE" | "UNCHANGED" | "COPY_CONFLICT";
export type ScheduleOutcome = "CREATE" | "UPDATE" | "DELETE" | "UNCHANGED" | "KEEP_CLOUD" | "COPY_CONFLICT";

const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value;
/** Two sets of limit values are the same regardless of key order. */
export const sameLimitValues = (left: unknown, right: unknown) => JSON.stringify(stable(left ?? {})) === JSON.stringify(stable(right ?? {}));

/**
 * A limit profile: one per form family, facility and object. `origin` is the Cloud profile the file's profile came from
 * when it still has the same key after the facilities are mapped; `atKey` is whatever Cloud has on the target key.
 */
export function planLimitProfileReimport(
  local: { version: number; values: unknown; cloudOrigin?: FormSettingOrigin },
  origin: { version: number; values: unknown } | null,
  atKey: { values: unknown } | null,
): LimitProfileOutcome {
  if (local.cloudOrigin && origin) {
    if (local.version === local.cloudOrigin.version) return "UNCHANGED";
    if (origin.version === local.cloudOrigin.version) return "UPDATE";
    return sameLimitValues(origin.values, local.values) ? "UNCHANGED" : "COPY_CONFLICT";
  }
  if (!atKey) return "CREATE";
  return sameLimitValues(atKey.values, local.values) ? "UNCHANGED" : "COPY_CONFLICT";
}

/**
 * A round schedule. Unchanged in the file: nothing is written. Changed in the file and unchanged in Cloud: updated (or
 * removed). Changed on both sides: a paused conflict copy, so the round is never doubled and no reminder goes out twice;
 * a removal in the file never removes a schedule Cloud has changed since (KEEP_CLOUD).
 */
export function planScheduleReimport(
  local: { version: number; deletedAt: string | null; cloudOrigin?: FormSettingOrigin },
  current: { version: number; deletedAt: Date | string | null } | null,
): ScheduleOutcome {
  if (!local.cloudOrigin) return local.deletedAt ? "UNCHANGED" : "CREATE";
  const changed = Boolean(local.deletedAt) || local.version !== local.cloudOrigin.version;
  if (!changed) return "UNCHANGED";
  if (current && !current.deletedAt && current.version === local.cloudOrigin.version) return local.deletedAt ? "DELETE" : "UPDATE";
  return local.deletedAt ? "KEEP_CLOUD" : "COPY_CONFLICT";
}

const SUFFIX = " (konfliktkopia)";
/** The object name of a limit profile's conflict copy: the first free "… (konfliktkopia)", "… (konfliktkopia 2)" … */
export function conflictObjectName(objectName: string, taken: (name: string) => boolean, max = 120) {
  for (let index = 1; index < 100; index += 1) {
    const suffix = index === 1 ? SUFFIX : ` (konfliktkopia ${index})`;
    const name = `${objectName.slice(0, max - suffix.length)}${suffix}`.trim();
    if (!taken(name)) return name;
  }
  throw new Error("Gränsprofilen har för många konfliktkopior.");
}

export const scheduleConflictTitle = (title: string) => `${title.slice(0, 200 - SUFFIX.length)}${SUFFIX}`;

export type FormSettingsSummary = {
  limitProfiles: { new: number; update: number; unchanged: number; conflictCopies: number; skipped: number };
  schedules: { new: number; update: number; removed: number; unchanged: number; conflictCopies: number; keptCloud: number; skipped: number };
};
export const emptyFormSettingsSummary = (): FormSettingsSummary => ({
  limitProfiles: { new: 0, update: 0, unchanged: 0, conflictCopies: 0, skipped: 0 },
  schedules: { new: 0, update: 0, removed: 0, unchanged: 0, conflictCopies: 0, keptCloud: 0, skipped: 0 },
});
