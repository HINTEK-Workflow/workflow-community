import type { TaskNotification } from "@/lib/workflow/task-notifications";

/**
 * "Tilldelad dig" (Fas 1B, 2026-10-08): when someone else makes a person responsible for a task (any kind, mostly work
 * orders) – on creation or by changing the responsible – that person gets a notice in the bell, unread until they open
 * the task. Assigning oneself gives nothing. Cloud only: a Local file has one user, so there is nobody else to tell.
 *
 * No schema change: the unread notice is a row in NoticeDelivery (the stored notice marks, per person and company) with
 * the channel "ASSIGNED" and the key `ASSIGNED:<taskId>|<assigner's user id>`. The row exists while the notice is unread;
 * opening the task removes it, and so does a new assignment of the task. The e-mail and push marks of the same notice
 * are separate rows (channels EMAIL and PUSH), so the job in lib/workflow/notice-delivery.ts sends it once at most and
 * only to a person who chose the kind "ASSIGNED". Pure: keys, the decision and the bell's items.
 */
export const ASSIGNED_NOTICE_CHANNEL = "ASSIGNED";
export const ASSIGNED_NOTICE_PREFIX = "ASSIGNED:";
/** Notislistan (beslut 4): an opened "Tilldelad dig" moves here and stays under Läst, while the task is the person's, for this many days. */
export const ASSIGNED_READ_CHANNEL = "ASSIGNED_READ";
export const ASSIGNED_READ_DAYS = 14;
/** At most this many unread assignment notices are read for one person (bounded reads). */
export const ASSIGNED_NOTICE_LIMIT = 100;

export const assignmentKeyPrefix = (taskId: string) => `${ASSIGNED_NOTICE_PREFIX}${taskId}|`;
export const assignmentKey = (taskId: string, byUserId: string) => `${assignmentKeyPrefix(taskId)}${byUserId}`;

export function parseAssignmentKey(key: string): { taskId: string; byUserId: string } | null {
  if (!key.startsWith(ASSIGNED_NOTICE_PREFIX)) return null;
  const [taskId, byUserId, ...rest] = key.slice(ASSIGNED_NOTICE_PREFIX.length).split("|");
  return taskId && byUserId && !rest.length ? { taskId, byUserId } : null;
}

/**
 * What a save means for the notices: `notify` the new responsible when the task got one it did not have and it is not
 * the person saving; `clear` the unread notices of the task for everyone else who had one (the previous responsible,
 * or the same person when they took it over themselves). Nothing when the responsible is unchanged.
 */
export function assignmentChange(input: { previousUserId: string | null | undefined; nextUserId: string | null | undefined; actorId: string }): { notify: string | null; clear: boolean } {
  const previous = input.previousUserId || null;
  const next = input.nextUserId || null;
  if (previous === next) return { notify: null, clear: false };
  return { notify: next && next !== input.actorId ? next : null, clear: true };
}

export type AssignmentNoticeRow = {
  key: string;
  createdAt: Date;
  task: { id: string; title: string; kind: string; status: string; dueDate: string; assignedToUserId: string | null } | null;
  byName: string;
  /** The person has opened the task. */
  read?: boolean;
};

const kindWord: Record<string, string> = { WORK_ORDER: "Arbetsordern", RISK_ASSESSMENT: "Riskbedömningen", FORM: "Uppgiften" };

/**
 * The bell's "Tilldelad dig" items for one person. Callers pass only tasks the person may read in their company; a notice
 * whose task is finished or has another responsible by now is not shown. Newest first.
 */
export function assignmentNotifications(rows: AssignmentNoticeRow[], userId: string): TaskNotification[] {
  return rows.flatMap((row): TaskNotification[] => {
    const parsed = parseAssignmentKey(row.key);
    const task = row.task;
    if (!parsed || !task || task.id !== parsed.taskId || task.assignedToUserId !== userId || task.status === "COMPLETED" || task.status === "CANCELLED") return [];
    // A name is written by a person: one line without the e-mail's formatting marks, as the digest needs (notice-digest.ts).
    const by = row.byName.replace(/[\r\n*[\]()]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 80) || "En kollega";
    return [{
      // The time is part of the id, so a new assignment of the same task to the same person is a new notice to send.
      id: `${ASSIGNED_NOTICE_PREFIX}${task.id}:${row.createdAt.getTime()}`, title: task.title, kind: "ASSIGNED",
      detail: `${kindWord[task.kind] ?? "Uppgiften"} har tilldelats dig av ${by}.`,
      href: `/?view=workflow_task&taskId=${encodeURIComponent(task.id)}&taskType=${encodeURIComponent(task.kind)}`,
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(task.dueDate) ? task.dueDate : "", deadline: null, needsAction: false,
      assignedBy: by, assignedAt: row.createdAt.toISOString(),
      ...(row.read ? { read: true } : {}),
    }];
  }).sort((a, b) => (b.assignedAt ?? "").localeCompare(a.assignedAt ?? "") || a.id.localeCompare(b.id));
}

/** The part of the database (or a transaction) the notices need; tests pass their own. */
export type AssignmentNoticeDb = {
  noticeDelivery: {
    deleteMany(args: { where: { organizationId: string; channel: string; key: { startsWith: string }; userId?: string } }): Promise<unknown>;
    create(args: { data: { organizationId: string; userId: string; key: string; channel: string }; select: { id: true } }): Promise<unknown>;
    updateMany(args: { where: { organizationId: string; channel: string; key: { startsWith: string }; userId: string }; data: { channel: string } }): Promise<unknown>;
  };
};

/**
 * Called by the save path (app/api/workflow-tasks/route.ts) inside its transaction, after the tenant, permission and
 * member checks: the responsible was verified as an active member of the same company (verifyTaskReferences).
 */
export async function recordAssignment(db: AssignmentNoticeDb, input: { organizationId: string; taskId: string; previousUserId: string | null | undefined; nextUserId: string | null | undefined; actorId: string }) {
  const change = assignmentChange(input);
  if (!change.clear) return change;
  // Any unread "Tilldelad dig" of this task is no longer current: the task has another responsible now.
  await db.noticeDelivery.deleteMany({ where: { organizationId: input.organizationId, channel: ASSIGNED_NOTICE_CHANNEL, key: { startsWith: assignmentKeyPrefix(input.taskId) } } });
  await db.noticeDelivery.deleteMany({ where: { organizationId: input.organizationId, channel: ASSIGNED_READ_CHANNEL, key: { startsWith: assignmentKeyPrefix(input.taskId) } } });
  if (change.notify) await db.noticeDelivery.create({ data: { organizationId: input.organizationId, userId: change.notify, key: assignmentKey(input.taskId, input.actorId), channel: ASSIGNED_NOTICE_CHANNEL }, select: { id: true } });
  return change;
}

/**
 * The person opened the task: their "Tilldelad dig" for it is read (only their own, in the company they work in). It moves to
 * ASSIGNED_READ, so it stays in the list under Läst; the earlier read row of the same task goes first (the table's unique key).
 */
export async function markAssignmentSeen(db: AssignmentNoticeDb, input: { organizationId: string; userId: string; taskId: string }) {
  await db.noticeDelivery.deleteMany({ where: { organizationId: input.organizationId, userId: input.userId, channel: ASSIGNED_READ_CHANNEL, key: { startsWith: assignmentKeyPrefix(input.taskId) } } });
  await db.noticeDelivery.updateMany({ where: { organizationId: input.organizationId, userId: input.userId, channel: ASSIGNED_NOTICE_CHANNEL, key: { startsWith: assignmentKeyPrefix(input.taskId) } }, data: { channel: ASSIGNED_READ_CHANNEL } });
}

/** The toast the recipient sees while they are in the app. */
export const assignmentToastText = (item: Pick<TaskNotification, "title" | "assignedBy" | "dueDate">) =>
  `${item.assignedBy || "En kollega"} har tilldelat dig ”${item.title}”${item.dueDate ? `, klart senast ${item.dueDate}` : ""}.`;
