import { z } from "zod";

// Shared Cloud/Local rules for who may register, correct or delete reported time.
export const TIME_CORRECTION_REASON_MAX = 500;
export const timeCorrectionReasonSchema = z.string().trim().max(TIME_CORRECTION_REASON_MAX).default("");

export type TimeEntryTaskState = { status: string; archived: boolean };
export type TimeCorrectionInput = {
  actorIsAdmin: boolean;
  actorOwnsEntry: boolean;
  // The entry's current task (absent for a new entry) and the task it is saved to (absent for a delete).
  source?: TimeEntryTaskState;
  target?: TimeEntryTaskState;
};

export class TimeCorrectionError extends Error {
  constructor(message: string, readonly status: 403 | 409 | 422) { super(message); }
}

export function timeCorrectionRequiresReason({ actorIsAdmin, actorOwnsEntry, source, target }: TimeCorrectionInput) {
  const completed = [source, target].some((task) => task?.status === "COMPLETED" || task?.status === "CANCELLED");
  return actorIsAdmin && (completed || !actorOwnsEntry);
}

/** Throws a TimeCorrectionError when the change is not allowed; returns the normalized reason. */
export function assertTimeCorrection(input: TimeCorrectionInput, reason: string) {
  const { actorIsAdmin, actorOwnsEntry, source, target } = input;
  if (!actorOwnsEntry && !actorIsAdmin) throw new TimeCorrectionError("Du kan bara ändra din egen rapporterade tid.", 403);
  if ([source, target].some((task) => task?.archived)) throw new TimeCorrectionError("Återställ projektet innan du ändrar tid i det.", 409);
  // A job that has utgått (2026-10-09) is said as such, not as slutförd.
  if ([source, target].some((task) => task?.status === "CANCELLED") && !actorIsAdmin)
    throw new TimeCorrectionError("Jobbet har utgått. Be en administratör korrigera tiden.", 409);
  if ([source, target].some((task) => task?.status === "COMPLETED") && !actorIsAdmin)
    throw new TimeCorrectionError("Uppgiften är färdigställd. Be en administratör korrigera tiden.", 409);
  const normalized = timeCorrectionReasonSchema.parse(reason);
  if (timeCorrectionRequiresReason(input) && !normalized) throw new TimeCorrectionError("Ange en kommentar som förklarar korrigeringen.", 422);
  return normalized;
}

/** `taskId` is the owner (a work order, or a project when `projectId` is set – Arbetsordern styr, 2026-10-26). */
/** `timeType` (2026-10-29): the type by name when the entry was saved; missing on older history. */
export type TimeEntrySnapshot = { taskId: string; taskTitle: string; projectId?: string; startedAt: string; endedAt: string | null; durationSec: number; note: string; timeType?: string };
export type TimeEntryEvent = {
  id: string;
  entryId: string;
  userId: string;
  action: "CREATED" | "UPDATED" | "DELETED";
  previous: TimeEntrySnapshot | null;
  next: TimeEntrySnapshot | null;
  reason: string;
  actorUserId: string;
  actorName: string;
  createdAt: string;
  /** Set on events exported from Cloud so a re-import never duplicates them. */
  cloudOrigin?: { id: string };
};

export const timeEntrySnapshotSchema = z.object({
  taskId: z.string().min(1).max(100),
  taskTitle: z.string().max(200),
  projectId: z.string().min(1).max(100).optional(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  durationSec: z.number().int().nonnegative(),
  note: z.string().max(1000),
  timeType: z.string().max(40).optional(),
});
export const timeEntryEventSchema = z.object({
  id: z.string().min(1).max(100),
  entryId: z.string().min(1).max(100),
  userId: z.string().max(100),
  action: z.enum(["CREATED", "UPDATED", "DELETED"]),
  previous: timeEntrySnapshotSchema.nullable(),
  next: timeEntrySnapshotSchema.nullable(),
  reason: z.string().max(TIME_CORRECTION_REASON_MAX),
  actorUserId: z.string().max(100),
  actorName: z.string().max(160),
  createdAt: z.iso.datetime(),
  cloudOrigin: z.object({ id: z.string().min(1).max(100) }).optional(),
});
