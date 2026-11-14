import { z } from "zod";
import { formatSwedish } from "@/lib/swedish-time";
import type { TaskNotification } from "@/lib/workflow/task-notifications";
import { scheduleOccurrences, type FormScheduleRule } from "./form-schedule";

/**
 * Ej utfört (2026-10-28, 0.28.0 etapp 5): an occurrence of a round that will not be done is recorded with a required
 * reason, the person and the time – no protocol is made for it, and it stays in the round's work order for the period like
 * the other occurrences. Its own history (RoundOccurrenceOutcome, alternative A): keyed by the round and the day, never by
 * the rule, so a changed rule keeps it; a mistake is revoked (Ångra), never deleted, and marking again is a new row.
 *
 * The states an occurrence can have (lib/workflow/form-schedule.ts scheduleOverview): planerat (upcoming/due), försenat
 * (missed), utfört (done), ej utfört (not_done) and utgått (cancelled: its protocol was set to Utgår). Ej utfört is not late,
 * not missed and not reminded about. Cloud only: Local and the demo do not offer it (the open file has one user and no
 * follow-up of others). Pure: validation, refusals, recipients and the bell's items.
 */
export const ROUND_NOT_DONE = "NOT_DONE" as const;
export const NOT_DONE_REASON_MIN = 3;
export const NOT_DONE_REASON_MAX = 1000;
export const ROUND_NOT_DONE_LABEL = "Ej utfört";

/** The reason is required: trimmed, 3–1000 characters. */
export const notDoneReasonSchema = z.string().trim()
  .min(NOT_DONE_REASON_MIN, `Skriv en kort anledning (minst ${NOT_DONE_REASON_MIN} tecken).`)
  .max(NOT_DONE_REASON_MAX, `Anledningen får vara högst ${NOT_DONE_REASON_MAX} tecken.`);

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ange ett datum.");
const identifier = z.string().min(1).max(100);
/** The two actions of the round route (app/api/form-schedules). */
export const markNotDoneSchema = z.object({ action: z.literal("mark_not_done"), scheduleId: identifier, occurrence: day, reason: notDoneReasonSchema });
export const revokeNotDoneSchema = z.object({ action: z.literal("revoke_not_done"), id: identifier });

/** An active (not revoked) Ej utfört as the views read it. */
export type RoundNotDone = { id: string; occurrence: string; reason: string; userName: string; recordedAt: string; userId?: string; workOrderId?: string | null };

/** The views' shape of a stored row; revoked rows are left out by the caller. */
export function roundNotDoneOf(row: { id: string; occurrence: string; reason: string; userName: string; userId: string; recordedAt: Date | string; workOrderId?: string | null }): RoundNotDone {
  return { id: row.id, occurrence: row.occurrence, reason: row.reason, userName: row.userName, userId: row.userId, recordedAt: typeof row.recordedAt === "string" ? row.recordedAt : row.recordedAt.toISOString(), workOrderId: row.workOrderId ?? null };
}

/** "Ej utfört · Pumpen var avställd · Anna Berg 28 okt. 2026 14:02" – the line the history shows. */
export function notDoneLine(item: Pick<RoundNotDone, "reason" | "userName" | "recordedAt">) {
  const when = formatSwedish(item.recordedAt, { dateStyle: "medium", timeStyle: "short" });
  return [ROUND_NOT_DONE_LABEL, item.reason, [item.userName, when].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
}

/**
 * Why an occurrence cannot be marked Ej utfört now, with the HTTP status, or null when it can: it must be one of the round's
 * days by its rule now, today or before, without a protocol that is started or completed (a protocol set to Utgår does not
 * count), not handled by a 0.24.0 work order for the day, and without an active Ej utfört already (409).
 */
export function notDoneRefusal(input: {
  rule: FormScheduleRule; occurrence: string; today: string;
  /** The statuses of the round's protocols for the day. */
  protocolStatuses: readonly string[];
  /** A 0.24.0 work order made for exactly this day that is completed or has utgått. */
  closedDayOrder?: boolean;
  active: boolean;
}): { status: 400 | 409; message: string } | null {
  if (input.occurrence > input.today) return { status: 400, message: "Ett kommande tillfälle kan inte markeras Ej utfört." };
  if (!scheduleOccurrences(input.rule, input.occurrence, input.occurrence, 1).length) return { status: 400, message: "Ronden har inget tillfälle den dagen." };
  if (input.protocolStatuses.some((status) => status === "COMPLETED")) return { status: 409, message: "Tillfället är redan utfört." };
  if (input.protocolStatuses.some((status) => status !== "CANCELLED")) return { status: 409, message: "Tillfället är påbörjat. Sätt protokollet till Utgår först." };
  if (input.closedDayOrder) return { status: 409, message: "Tillfället är redan avslutat i sin arbetsorder." };
  if (input.active) return { status: 409, message: "Tillfället är redan markerat Ej utfört." };
  return null;
}

/** Who may revoke: an administrator, the person who recorded it, or the round's responsible person. */
export function mayRevokeNotDone(actor: { userId: string; admin: boolean }, outcome: { userId: string }, schedule: { assignedToUserId: string | null }) {
  return actor.admin || outcome.userId === actor.userId || schedule.assignedToUserId === actor.userId;
}

/**
 * Who is told (2026-10-28: "Möjliggör uppföljning och notifiering av ansvarig"): the round's responsible person, or
 * the company's administrators when none is chosen – the same people as the round's reminders – never the person who
 * recorded it, and only active members.
 */
export function notDoneRecipients(input: { assignedToUserId: string | null; recorderId: string; members: readonly { userId: string; admin: boolean }[] }): string[] {
  const wanted = input.assignedToUserId ? input.members.filter((member) => member.userId === input.assignedToUserId) : input.members.filter((member) => member.admin);
  return [...new Set(wanted.map((member) => member.userId).filter((id) => id !== input.recorderId))];
}

/**
 * The unread notice is a NoticeDelivery row (as "Hinder rapporterat", lib/workflow/obstacle-notice.ts; no schema of its
 * own) with the channel ROUND_NOT_DONE and the key `ROUND_NOT_DONE:<outcome id>`. It goes when the person opens
 * Driftronder, when the outcome is revoked, and is not shown after NOT_DONE_NOTICE_DAYS.
 */
export const NOT_DONE_NOTICE_CHANNEL = "ROUND_NOT_DONE";
export const NOT_DONE_NOTICE_PREFIX = "ROUND_NOT_DONE:";
export const NOT_DONE_NOTICE_LIMIT = 50;
export const NOT_DONE_NOTICE_DAYS = 14;
export const notDoneNoticeKey = (outcomeId: string) => `${NOT_DONE_NOTICE_PREFIX}${outcomeId}`;
export function parseNotDoneNoticeKey(key: string) {
  if (!key.startsWith(NOT_DONE_NOTICE_PREFIX)) return null;
  const id = key.slice(NOT_DONE_NOTICE_PREFIX.length);
  return id && !id.includes("|") ? { outcomeId: id } : null;
}

const oneLine = (value: string, max: number) => value.replace(/[\r\n*[\]()]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, max);

/**
 * The bell's items for the person's unread Ej utfört notices: kind ROUND (the "Driftronder" choice for e-mail and push),
 * newest first. A revoked outcome, one of a round the person may no longer read, or an old one is not shown.
 */
export function notDoneNotifications(rows: readonly { createdAt: Date; outcome: (RoundNotDone & { scheduleId: string; revoked: boolean; title: string }) | null }[], now: Date): TaskNotification[] {
  const oldest = now.getTime() - NOT_DONE_NOTICE_DAYS * 86_400_000;
  return rows.flatMap((row): TaskNotification[] => {
    const outcome = row.outcome;
    if (!outcome || outcome.revoked || row.createdAt.getTime() < oldest) return [];
    const by = oneLine(outcome.userName, 80) || "En kollega";
    return [{
      id: `${NOT_DONE_NOTICE_PREFIX}${outcome.id}`, title: outcome.title, kind: "ROUND",
      detail: `${by} markerade tillfället ${outcome.occurrence} som Ej utfört: ${oneLine(outcome.reason, 200)}.`,
      href: "/?view=rounds&attention=1", dueDate: outcome.occurrence, deadline: null, needsAction: false,
      assignedBy: by, assignedAt: outcome.recordedAt,
    }];
  }).sort((a, b) => (b.assignedAt ?? "").localeCompare(a.assignedAt ?? "") || a.id.localeCompare(b.id));
}
