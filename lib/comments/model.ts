import { z } from "zod";
import type { TaskNotification } from "@/lib/workflow/task-notifications";

/**
 * Kommentarer (beslut 14, 2026-11-01): one thread per work order, project and deviation. A comment is internal unless it
 * is chosen "Med i kundrapporten"; only those reach the customer's report. @namn tells that person, and a person can follow
 * a job and be told about new comments.
 *
 * One table for the text (Comment). Who follows and who has a notice are rows in NoticeDelivery, the stored notice marks that
 * "Tilldelad dig" and "Hinder" already use: channel COMMENT_FOLLOW with the key `FOLLOW:<type>:<parent>`, channel COMMENT with the
 * key `COMMENT:<comment>|<MENTION or FOLLOW>`, which moves to COMMENT_READ when the person has opened the thread. The bell
 * checks the right to read the parent again, so a notice is never more than the person may read now.
 * Cloud only: a Local file has one user, so the thread is hidden there. Pure: input, names, keys and the bell's items.
 */
export const COMMENT_PARENT_TYPES = ["WORK_ORDER", "PROJECT", "DEVIATION"] as const;
export type CommentParentType = (typeof COMMENT_PARENT_TYPES)[number];
export type CommentParentRef = { type: CommentParentType; id: string };

export const COMMENT_BODY_MAX = 4000;
/** At most this many comments are read for one thread (bounded reads), the newest ones. */
export const COMMENT_THREAD_LIMIT = 200;
/** At most this many people are told about one comment (bounded writes). */
export const COMMENT_NOTICE_MAX_RECIPIENTS = 100;
/** At most this many of a person's comment notices are read for the bell. */
export const COMMENT_NOTICE_LIMIT = 100;
/** A report prints at most this many comments per work order, project or deviation. */
export const COMMENT_REPORT_LIMIT = 50;
/** A comment in the company's file: more than COMMENT_BODY_MAX is allowed, since erasing a person's name can lengthen a text. */
export const COMMENT_FILE_BODY_MAX = 20_000;
/** How long a read comment notice is kept in the list under Läst. */
export const COMMENT_READ_DAYS = 14;

export const COMMENT_NOTICE_CHANNEL = "COMMENT";
export const COMMENT_READ_CHANNEL = "COMMENT_READ";
export const COMMENT_FOLLOW_CHANNEL = "COMMENT_FOLLOW";
export const COMMENT_NOTICE_PREFIX = "COMMENT:";

const id = z.string().trim().min(1).max(64);
const parent = { parentType: z.enum(COMMENT_PARENT_TYPES), parentId: id };
export const commentParentQuery = z.object(parent);
export const commentActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), ...parent, body: z.string().trim().min(1, "Skriv en kommentar.").max(COMMENT_BODY_MAX, `Högst ${COMMENT_BODY_MAX} tecken.`), inCustomerReport: z.boolean().default(false) }),
  z.object({ action: z.literal("set_customer"), id, inCustomerReport: z.boolean() }),
  z.object({ action: z.literal("remove"), id }),
  z.object({ action: z.literal("follow"), ...parent, follow: z.boolean() }),
  z.object({ action: z.literal("seen"), ...parent }),
]);
export type CommentAction = z.infer<typeof commentActionSchema>;

export const commentFollowKey = (ref: CommentParentRef) => `FOLLOW:${ref.type}:${ref.id}`;
export const commentNoticeKey = (commentId: string, reason: "MENTION" | "FOLLOW") => `${COMMENT_NOTICE_PREFIX}${commentId}|${reason}`;
export const commentNoticeKeys = (commentId: string) => [commentNoticeKey(commentId, "MENTION"), commentNoticeKey(commentId, "FOLLOW")];
export function parseCommentNoticeKey(key: string): { commentId: string; reason: "MENTION" | "FOLLOW" } | null {
  if (!key.startsWith(COMMENT_NOTICE_PREFIX)) return null;
  const [commentId, reason, ...rest] = key.slice(COMMENT_NOTICE_PREFIX.length).split("|");
  return commentId && (reason === "MENTION" || reason === "FOLLOW") && !rest.length ? { commentId, reason } : null;
}

const isNameCharacter = (char: string | undefined) => Boolean(char && /[\p{L}\p{N}_-]/u.test(char));

/**
 * The people an @namn in the text points out: "@" and the whole name, in any case, not followed by more of a word. The server
 * reads the names from the text itself and from the people it passes, so nothing else in a request can notify anyone.
 */
export function mentionedPeople<T extends { name: string }>(body: string, people: readonly T[]): T[] {
  const text = body.toLocaleLowerCase("sv");
  return people.filter((person) => {
    const name = person.name.trim().toLocaleLowerCase("sv");
    if (name.length < 2) return false;
    const needle = `@${name}`;
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) {
      if (!isNameCharacter(text[at + needle.length])) return true;
    }
    return false;
  });
}

/** Who is told about a new comment: the mentioned and the followers, never the author, the mention winning, bounded. */
export function commentRecipients(input: { authorId: string; mentioned: readonly string[]; followers: readonly string[] }): { userId: string; reason: "MENTION" | "FOLLOW" }[] {
  const seen = new Set<string>([input.authorId]);
  const out: { userId: string; reason: "MENTION" | "FOLLOW" }[] = [];
  for (const [ids, reason] of [[input.mentioned, "MENTION"], [input.followers, "FOLLOW"]] as const) {
    for (const userId of ids) if (!seen.has(userId)) { seen.add(userId); out.push({ userId, reason }); }
  }
  return out.slice(0, COMMENT_NOTICE_MAX_RECIPIENTS);
}

/** Where a thread's parent is opened. */
export function commentParentHref(ref: CommentParentRef) {
  const parentId = encodeURIComponent(ref.id);
  if (ref.type === "WORK_ORDER") return `/?view=workflow_task&taskId=${parentId}&taskType=WORK_ORDER`;
  if (ref.type === "PROJECT") return `/?view=project&projectId=${parentId}`;
  return `/?view=deviations&deviation=${parentId}`;
}

/** The comment columns of a parent, with the company around them at every read and write. */
export function commentParentWhere(ref: CommentParentRef) {
  if (ref.type === "WORK_ORDER") return { workflowTaskId: ref.id };
  if (ref.type === "PROJECT") return { projectId: ref.id };
  return { deviationId: ref.id };
}

/** Which parent a comment row belongs to. */
export function commentParentOf(row: { workflowTaskId: string | null; projectId: string | null; deviationId: string | null }): CommentParentRef | null {
  if (row.workflowTaskId) return { type: "WORK_ORDER", id: row.workflowTaskId };
  if (row.projectId) return { type: "PROJECT", id: row.projectId };
  return row.deviationId ? { type: "DEVIATION", id: row.deviationId } : null;
}

/**
 * The re-import: the comments that come back, as rows without the company. Only a thread whose parent the import had to create comes
 * back, so a comment someone removed in Cloud stays removed, a thread is never doubled, and a parent still in Cloud keeps Cloud's
 * own thread. The maps go from the file's id to the row just created in this company, so the file cannot point at another row.
 */
export function commentsToRestore(comments: readonly { parentType: CommentParentType; parentId: string; authorName: string; body: string; inCustomerReport: boolean; createdAt: string }[], created: { workOrders: ReadonlyMap<string, string>; projects: ReadonlyMap<string, string>; deviations: ReadonlyMap<string, string> }) {
  const parents = { WORK_ORDER: created.workOrders, PROJECT: created.projects, DEVIATION: created.deviations };
  return comments.flatMap((comment) => {
    const id = parents[comment.parentType].get(comment.parentId);
    return id ? [{ ...commentParentWhere({ type: comment.parentType, id }), authorUserId: null, authorName: comment.authorName, body: comment.body, inCustomerReport: comment.inCustomerReport, createdAt: new Date(comment.createdAt) }] : [];
  });
}

const oneLine = (value: string, max: number) => {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
};

export type CommentNoticeRow = {
  key: string;
  read: boolean;
  comment: { id: string; body: string; authorName: string; createdAt: Date; parent: CommentParentRef; parentTitle: string } | null;
};

/**
 * The bell's items for a person's comment notices. Callers pass only comments whose parent the person may read in their
 * company. Newest first. The name goes through the same line cleaning as "Tilldelad dig", since the digest's text needs it.
 */
export function commentNotifications(rows: readonly CommentNoticeRow[]): TaskNotification[] {
  return rows.flatMap((row): TaskNotification[] => {
    const parsed = parseCommentNoticeKey(row.key);
    const comment = row.comment;
    if (!parsed || !comment || comment.id !== parsed.commentId) return [];
    const by = comment.authorName.replace(/[\r\n*[\]()]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 80) || "En kollega";
    return [{
      id: `${COMMENT_NOTICE_PREFIX}${comment.id}`, title: comment.parentTitle, kind: "COMMENT",
      label: parsed.reason === "MENTION" ? "Nämnde dig" : "Ny kommentar",
      detail: `${by}: ${oneLine(comment.body, 140)}`,
      href: commentParentHref(comment.parent),
      dueDate: "", deadline: null, needsAction: false,
      assignedBy: by, assignedAt: comment.createdAt.toISOString(),
      ...(row.read ? { read: true } : {}),
    }];
  }).sort((a, b) => (b.assignedAt ?? "").localeCompare(a.assignedAt ?? "") || a.id.localeCompare(b.id));
}

/** The toast the recipient sees while they are in the app. */
export const commentToastText = (item: Pick<TaskNotification, "title" | "label" | "assignedBy">) =>
  item.label === "Nämnde dig" ? `${item.assignedBy || "En kollega"} nämnde dig på ${item.title}.` : `Ny kommentar på ${item.title}.`;

export type CustomerComment = { authorName: string; body: string; createdAt: string };
