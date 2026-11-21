import type { TaskNotification } from "@/lib/workflow/task-notifications";
import { jobObstacle, obstacleText } from "./obstacles";

/**
 * "Hinder rapporterat" (plan 1M, 2026-10-11): when someone reports an obstacle on a job, the job's responsible person and the
 * project's responsible person get a notice in the bell (and the toast, and e-mail/push for those who chose "Hinder"),
 * until the obstacle is resolved. Same pattern as "Tilldelad dig" (task-assignment-notice.ts), no schema of its own: the
 * notice is a NoticeDelivery row with the channel "OBSTACLE" and the key `OBSTACLE:<taskId>|<reporter's user id>`.
 * Användartest 2026-10-31 (F3): the row used to go when the owner opened the job, so a look at the job emptied the bell and
 * the hinder was "never told". It now stays, under Kräver åtgärd (needsAction), until the obstacle is resolved or a new report
 * replaces it; markObstacleSeen is kept for callers that want to read one person's notice.
 * Cloud only: a Local file has one user. Pure: keys, recipients and the bell's items.
 */
export const OBSTACLE_NOTICE_CHANNEL = "OBSTACLE";
export const OBSTACLE_NOTICE_PREFIX = "OBSTACLE:";
/** At most this many unread obstacle notices are read for one person (bounded reads). */
export const OBSTACLE_NOTICE_LIMIT = 100;

export const obstacleKeyPrefix = (taskId: string) => `${OBSTACLE_NOTICE_PREFIX}${taskId}|`;
export const obstacleKey = (taskId: string, byUserId: string) => `${obstacleKeyPrefix(taskId)}${byUserId}`;

export function parseObstacleKey(key: string): { taskId: string; byUserId: string } | null {
  if (!key.startsWith(OBSTACLE_NOTICE_PREFIX)) return null;
  const [taskId, byUserId, ...rest] = key.slice(OBSTACLE_NOTICE_PREFIX.length).split("|");
  return taskId && byUserId && !rest.length ? { taskId, byUserId } : null;
}

/**
 * Who is told: the job's responsible person and the project's, each once, never the person who reported. Only active
 * members of the company (the caller passes the set) – the notice is a courtesy, not an access.
 */
export function obstacleRecipients(input: { taskResponsibleId: string | null | undefined; projectResponsibleId: string | null | undefined; reporterId: string; activeMemberIds: ReadonlySet<string> }): string[] {
  const ids = [input.taskResponsibleId, input.projectResponsibleId].filter((id): id is string => Boolean(id) && id !== input.reporterId && input.activeMemberIds.has(id!));
  return [...new Set(ids)];
}

export type ObstacleNoticeRow = {
  key: string;
  createdAt: Date;
  task: { id: string; title: string; kind: string; status: string; dueDate: string; data: unknown; updatedAt: Date } | null;
  byName: string;
};

const kindWord: Record<string, string> = { WORK_ORDER: "arbetsordern", RISK_ASSESSMENT: "riskbedömningen", FORM: "uppgiften" };
const oneLine = (value: string, max: number) => value.replace(/[\r\n*[\]()]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, max);

/** The bell's "Hinder rapporterat" items, newest first; a notice whose job has no obstacle any more is not shown. */
export function obstacleNotifications(rows: readonly ObstacleNoticeRow[]): TaskNotification[] {
  return rows.flatMap((row): TaskNotification[] => {
    const parsed = parseObstacleKey(row.key);
    const task = row.task;
    const obstacle = task ? jobObstacle(task) : null;
    if (!parsed || !task || task.id !== parsed.taskId || !obstacle) return [];
    const by = oneLine(row.byName, 80) || "En kollega";
    return [{
      // The time is part of the id, so a new report on the same job is a new notice to send.
      id: `${OBSTACLE_NOTICE_PREFIX}${task.id}:${row.createdAt.getTime()}`, title: task.title, kind: "OBSTACLE",
      detail: `${by} har rapporterat hinder på ${kindWord[task.kind] ?? "uppgiften"}: ${oneLine(obstacleText(obstacle), 200)}.`,
      href: `/?view=workflow_task&taskId=${encodeURIComponent(task.id)}&taskType=${encodeURIComponent(task.kind)}`,
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(task.dueDate) ? task.dueDate : "", deadline: null, needsAction: true,
      assignedBy: by, assignedAt: row.createdAt.toISOString(),
    }];
  }).sort((a, b) => (b.assignedAt ?? "").localeCompare(a.assignedAt ?? "") || a.id.localeCompare(b.id));
}

/** The part of the database (or a transaction) the notices need; tests pass their own. */
export type ObstacleNoticeDb = {
  noticeDelivery: {
    deleteMany(args: { where: { organizationId: string; channel: string; key: { startsWith: string }; userId?: string } }): Promise<unknown>;
    create(args: { data: { organizationId: string; userId: string; key: string; channel: string }; select: { id: true } }): Promise<unknown>;
  };
};

/** Replaces the job's unread obstacle notices with one for each recipient. */
export async function recordObstacle(db: ObstacleNoticeDb, input: { organizationId: string; taskId: string; reporterId: string; recipients: readonly string[] }) {
  await clearObstacleNotices(db, input);
  for (const userId of input.recipients)
    await db.noticeDelivery.create({ data: { organizationId: input.organizationId, userId, key: obstacleKey(input.taskId, input.reporterId), channel: OBSTACLE_NOTICE_CHANNEL }, select: { id: true } });
}

/** The obstacle is resolved: nobody has an unread notice of it any more. */
export async function clearObstacleNotices(db: ObstacleNoticeDb, input: { organizationId: string; taskId: string }) {
  await db.noticeDelivery.deleteMany({ where: { organizationId: input.organizationId, channel: OBSTACLE_NOTICE_CHANNEL, key: { startsWith: obstacleKeyPrefix(input.taskId) } } });
}

/** The person opened the job: their notice of it is read (only their own). */
export async function markObstacleSeen(db: ObstacleNoticeDb, input: { organizationId: string; userId: string; taskId: string }) {
  await db.noticeDelivery.deleteMany({ where: { organizationId: input.organizationId, userId: input.userId, channel: OBSTACLE_NOTICE_CHANNEL, key: { startsWith: obstacleKeyPrefix(input.taskId) } } });
}

/** The toast the recipient sees while they are in the app. */
export const obstacleToastText = (item: Pick<TaskNotification, "title" | "assignedBy">) =>
  `${item.assignedBy || "En kollega"} har rapporterat hinder på ”${item.title}”.`;
