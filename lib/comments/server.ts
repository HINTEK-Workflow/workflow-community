import { prisma } from "@/lib/db";
import { ApiError, requireModule, type Context } from "@/lib/kfid/server";
import { addSwedishDays } from "@/lib/swedish-time";
import { mayHandleDeviation, mayReadDeviation } from "@/lib/self-inspection/incidents";
import { DEVIATION_PERSONAL_DATA_REFUSAL } from "@/lib/self-inspection/retention";
import { canViewTeam, hasWorkflowPermission, normalizeWorkflowPermissionProfile, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { readableTaskWhere } from "@/lib/workflow/task-access";
import { memberMayReadJob } from "@/lib/workflow/assignee-access";
import { COMMENT_FOLLOW_CHANNEL, COMMENT_NOTICE_CHANNEL, COMMENT_NOTICE_LIMIT, COMMENT_READ_CHANNEL, COMMENT_READ_DAYS, COMMENT_REPORT_LIMIT, COMMENT_THREAD_LIMIT, commentFollowKey, commentNoticeKey, commentNoticeKeys, commentNotifications, commentParentOf, commentParentWhere, commentRecipients, mentionedPeople, parseCommentNoticeKey, type CommentAction, type CommentParentRef, type CustomerComment } from "./model";

/**
 * Kommentarer in Cloud (beslut 14, 2026-11-01). Every path comes here with a Context (session or key, membership, company) and
 * goes through resolveParent, so a comment is only ever read or written by someone who may read its parent, in the
 * company they work in. An unknown parent, another company's and one the person may not read answer the same.
 */
const NOT_FOUND = "Hittades inte, eller så saknar du behörighet.";
const can = (ctx: Context) => (subject: WorkflowPermissionSubject) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "read");
const viewerOf = (ctx: Context) => ({ id: ctx.user.id, admin: ctx.admin, team: canViewTeam(ctx) });

type MemberRow = { userId: string; role: string; workflowPermissions: unknown };
type Parent = { ref: CommentParentRef; title: string; /** A deviation whose names and text went with the retention time (lib/self-inspection/retention.ts): no new comment. */ personalDataRemoved?: boolean; /** May choose "Med i kundrapporten": the right to change the parent. */ canChooseCustomer: boolean; /** The project, or the work order's project, is archived: read-only until it is restored. */ archived: boolean; mayRead: (member: MemberRow) => boolean };

/** What others read of a thread, and what the next report prints, stays as it is while the project is archived (as every other write to it). */
function assertNotArchived(parent: Parent) {
  if (parent.archived) throw new ApiError(409, "Återställ projektet från arkivet först.");
}

export async function resolveParent(ctx: Context, ref: CommentParentRef): Promise<Parent> {
  if (ref.type === "WORK_ORDER") {
    const task = await prisma.workflowTask.findFirst({ where: { id: ref.id, organizationId: ctx.organizationId, kind: "WORK_ORDER", AND: [readableTaskWhere(can(ctx))] }, select: { id: true, title: true, project: { select: { archivedAt: true } } } });
    if (!task) throw new ApiError(404, NOT_FOUND);
    return { ref, title: task.title, canChooseCustomer: ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, "work-order", "edit"), archived: Boolean(task.project?.archivedAt), mayRead: (member) => memberMayReadJob(member, "work-order") };
  }
  if (ref.type === "PROJECT") {
    const project = can(ctx)("projects") ? await prisma.project.findFirst({ where: { id: ref.id, organizationId: ctx.organizationId }, select: { id: true, name: true, archivedAt: true } }) : null;
    if (!project) throw new ApiError(404, NOT_FOUND);
    return { ref, title: project.name, canChooseCustomer: ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, "projects", "edit"), archived: Boolean(project.archivedAt), mayRead: (member) => memberMayReadJob(member, "projects") };
  }
  const entry = await prisma.selfInspectionDeviation.findFirst({ where: { id: ref.id, organizationId: ctx.organizationId }, select: { id: true, title: true, type: true, reportedById: true, responsibleUserId: true, personalDataRemovedAt: true } });
  const access = entry ? { type: entry.type, reportedById: entry.reportedById, responsibleId: entry.responsibleUserId } : null;
  if (!entry || !access || !mayReadDeviation(viewerOf(ctx), access)) throw new ApiError(404, NOT_FOUND);
  return {
    ref, title: entry.title, canChooseCustomer: mayHandleDeviation(viewerOf(ctx), access), archived: false, personalDataRemoved: Boolean(entry.personalDataRemovedAt),
    mayRead: (member) => mayReadDeviation({ id: member.userId, admin: member.role === "OWNER" || member.role === "ADMIN", team: hasWorkflowPermission(normalizeWorkflowPermissionProfile(member.workflowPermissions), "team", "read") }, access),
  };
}

/** The company's active members who may read the parent: the only people @namn can point out, and followers are checked against them. */
async function readersOf(ctx: Context, parent: Parent) {
  const members = await prisma.organizationMember.findMany({
    where: { organizationId: ctx.organizationId, isActive: true, user: { isActive: true } }, orderBy: { createdAt: "asc" }, take: 500,
    select: { userId: true, role: true, workflowPermissions: true, user: { select: { name: true, email: true } } },
  });
  return members.filter((member) => parent.mayRead(member)).map((member) => ({ id: member.userId, name: member.user.name?.trim() || member.user.email }));
}

const commentSelect = { id: true, authorUserId: true, authorName: true, body: true, inCustomerReport: true, createdAt: true } as const;
function commentView(ctx: Context, row: { id: string; authorUserId: string | null; authorName: string; body: string; inCustomerReport: boolean; createdAt: Date }) {
  return { id: row.id, authorName: row.authorName, body: row.body, inCustomerReport: row.inCustomerReport, createdAt: row.createdAt.toISOString(), mine: row.authorUserId === ctx.user.id, canRemove: ctx.admin || row.authorUserId === ctx.user.id };
}

/** A thread: the newest comments in the order they were written, whether the person follows, and whom they can point out. */
export async function loadThread(ctx: Context, ref: CommentParentRef) {
  const parent = await resolveParent(ctx, ref);
  const [rows, following, people] = await Promise.all([
    prisma.comment.findMany({ where: { organizationId: ctx.organizationId, ...commentParentWhere(ref) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: COMMENT_THREAD_LIMIT + 1, select: commentSelect }),
    prisma.noticeDelivery.count({ where: { organizationId: ctx.organizationId, userId: ctx.user.id, channel: COMMENT_FOLLOW_CHANNEL, key: commentFollowKey(ref) } }),
    readersOf(ctx, parent),
  ]);
  return {
    comments: rows.slice(0, COMMENT_THREAD_LIMIT).reverse().map((row) => commentView(ctx, row)),
    hasOlder: rows.length > COMMENT_THREAD_LIMIT,
    following: following > 0,
    canChooseCustomer: parent.canChooseCustomer,
    people: people.filter((person) => person.id !== ctx.user.id),
  };
}

async function loadCommentAndParent(ctx: Context, id: string) {
  const row = await prisma.comment.findFirst({ where: { id, organizationId: ctx.organizationId }, select: { id: true, authorUserId: true, workflowTaskId: true, projectId: true, deviationId: true } });
  const ref = row ? commentParentOf(row) : null;
  if (!row || !ref) throw new ApiError(404, NOT_FOUND);
  return { row, parent: await resolveParent(ctx, ref) };
}

/** Writes need Cloud write access (the route checks it) and a project that is not archived; following and "seen" are the person's own marks and need neither. */
export async function applyCommentAction(ctx: Context, input: CommentAction) {
  if (input.action === "add") {
    const ref = { type: input.parentType, id: input.parentId };
    // Företagets moduler (0.39.0): no new comment on a project while Projekt is off; work orders and deviations are always on.
    if (ref.type === "PROJECT") requireModule(ctx, "projects");
    const parent = await resolveParent(ctx, ref);
    assertNotArchived(parent);
    if (parent.personalDataRemoved) throw new ApiError(409, DEVIATION_PERSONAL_DATA_REFUSAL);
    if (input.inCustomerReport && !parent.canChooseCustomer) throw new ApiError(403, "Du får inte välja vad som hamnar i kundrapporten.");
    const [readers, followRows] = await Promise.all([
      readersOf(ctx, parent),
      prisma.noticeDelivery.findMany({ where: { organizationId: ctx.organizationId, channel: COMMENT_FOLLOW_CHANNEL, key: commentFollowKey(ref) }, select: { userId: true }, take: 500 }),
    ]);
    const mayRead = new Set(readers.map((person) => person.id));
    const recipients = commentRecipients({
      authorId: ctx.user.id,
      mentioned: mentionedPeople(input.body, readers).map((person) => person.id),
      followers: followRows.map((row) => row.userId).filter((userId) => mayRead.has(userId)),
    });
    const created = await prisma.$transaction(async (tx) => {
      const comment = await tx.comment.create({
        data: { organizationId: ctx.organizationId, ...commentParentWhere(ref), authorUserId: ctx.user.id, authorName: ctx.user.name?.trim() || ctx.user.email, body: input.body, inCustomerReport: input.inCustomerReport },
        select: commentSelect,
      });
      if (recipients.length) await tx.noticeDelivery.createMany({ data: recipients.map(({ userId, reason }) => ({ organizationId: ctx.organizationId, userId, key: commentNoticeKey(comment.id, reason), channel: COMMENT_NOTICE_CHANNEL })), skipDuplicates: true });
      return comment;
    });
    return { comment: commentView(ctx, created), told: recipients.length };
  }
  if (input.action === "set_customer") {
    const { parent } = await loadCommentAndParent(ctx, input.id);
    if (!parent.canChooseCustomer) throw new ApiError(403, "Du får inte välja vad som hamnar i kundrapporten.");
    assertNotArchived(parent);
    const row = await prisma.comment.update({ where: { id: input.id }, data: { inCustomerReport: input.inCustomerReport }, select: commentSelect });
    return { comment: commentView(ctx, row) };
  }
  if (input.action === "remove") {
    const { row, parent } = await loadCommentAndParent(ctx, input.id);
    if (!ctx.admin && row.authorUserId !== ctx.user.id) throw new ApiError(403, "Du får bara ta bort dina egna kommentarer.");
    assertNotArchived(parent);
    await prisma.$transaction([
      prisma.noticeDelivery.deleteMany({ where: { organizationId: ctx.organizationId, channel: { in: [COMMENT_NOTICE_CHANNEL, COMMENT_READ_CHANNEL] }, key: { in: commentNoticeKeys(row.id) } } }),
      prisma.comment.deleteMany({ where: { id: row.id, organizationId: ctx.organizationId } }),
    ]);
    return { removed: row.id };
  }
  const ref = { type: input.parentType, id: input.parentId };
  await resolveParent(ctx, ref);
  if (input.action === "follow") {
    const mark = { organizationId: ctx.organizationId, userId: ctx.user.id, channel: COMMENT_FOLLOW_CHANNEL, key: commentFollowKey(ref) };
    if (input.follow) await prisma.noticeDelivery.createMany({ data: [mark], skipDuplicates: true });
    else await prisma.noticeDelivery.deleteMany({ where: mark });
    return { following: input.follow };
  }
  // The person opened the thread: their notices of it move to read (only their own, in this company).
  const ids = await prisma.comment.findMany({ where: { organizationId: ctx.organizationId, ...commentParentWhere(ref) }, orderBy: { createdAt: "desc" }, take: COMMENT_THREAD_LIMIT, select: { id: true } });
  if (ids.length) await prisma.noticeDelivery.updateMany({ where: { organizationId: ctx.organizationId, userId: ctx.user.id, channel: COMMENT_NOTICE_CHANNEL, key: { in: ids.flatMap((row) => commentNoticeKeys(row.id)) } }, data: { channel: COMMENT_READ_CHANNEL } });
  return { seen: true };
}

/**
 * A person's comment notices for the bell, read and unread: each comment is read within the company and its parent is checked
 * again, so a notice about something the person may no longer read is not shown. Read ones stay for COMMENT_READ_DAYS.
 */
export async function loadCommentNotifications(ctx: Context, now: Date) {
  if (ctx.organization.storageMode !== "HINTEK_CLOUD") return [];
  const since = addSwedishDays(now, -COMMENT_READ_DAYS);
  const rows = await prisma.noticeDelivery.findMany({
    where: { organizationId: ctx.organizationId, userId: ctx.user.id, OR: [{ channel: COMMENT_NOTICE_CHANNEL }, { channel: COMMENT_READ_CHANNEL, createdAt: { gte: since } }] },
    orderBy: { createdAt: "desc" }, take: COMMENT_NOTICE_LIMIT, select: { key: true, channel: true },
  });
  const parsed = rows.flatMap((row) => { const key = parseCommentNoticeKey(row.key); return key ? [{ ...row, ...key }] : []; });
  if (!parsed.length) return [];
  const comments = await prisma.comment.findMany({
    where: { organizationId: ctx.organizationId, id: { in: parsed.map((row) => row.commentId) } },
    select: {
      id: true, body: true, authorName: true, createdAt: true, workflowTaskId: true, projectId: true, deviationId: true,
      workflowTask: { select: { title: true, kind: true } }, project: { select: { name: true } }, deviation: { select: { title: true, type: true, reportedById: true, responsibleUserId: true } },
    },
  });
  const reads = can(ctx);
  const viewer = viewerOf(ctx);
  const byId = new Map(comments.flatMap((comment) => {
    const parent = commentParentOf(comment);
    if (!parent) return [];
    const access = parent.type === "WORK_ORDER" ? reads("work-order")
      : parent.type === "PROJECT" ? reads("projects")
      : Boolean(comment.deviation) && mayReadDeviation(viewer, { type: comment.deviation!.type, reportedById: comment.deviation!.reportedById, responsibleId: comment.deviation!.responsibleUserId });
    if (!access) return [];
    const parentTitle = comment.workflowTask?.title ?? comment.project?.name ?? comment.deviation?.title ?? "";
    return [[comment.id, { id: comment.id, body: comment.body, authorName: comment.authorName, createdAt: comment.createdAt, parent, parentTitle }] as const];
  }));
  return commentNotifications(parsed.map((row) => ({ key: row.key, read: row.channel === COMMENT_READ_CHANNEL, comment: byId.get(row.commentId) ?? null })));
}

/** The comments chosen "Med i kundrapporten" – the only ones a customer's report may hold. Read within the company. */
export async function customerComments(organizationId: string, ref: CommentParentRef): Promise<CustomerComment[]> {
  const rows = await prisma.comment.findMany({
    where: { organizationId, ...commentParentWhere(ref), inCustomerReport: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: COMMENT_REPORT_LIMIT, select: { authorName: true, body: true, createdAt: true },
  });
  return rows.map((row) => ({ authorName: row.authorName, body: row.body, createdAt: row.createdAt.toISOString() }));
}
