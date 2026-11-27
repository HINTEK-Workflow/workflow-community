import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { requireCloudStorage, requireCloudWriteAccess, requireModule, type Context } from "@/lib/kfid/server";
import { NOTICE_READ_CHANNEL } from "@/lib/workflow/notification-list";
import { organizationModuleOn } from "@/lib/workflow/modules";
import type { TaskNotification } from "@/lib/workflow/task-notifications";
import {
  NEWS_DRAFTS_MAX, NEWS_MISSING, NEWS_NOTICE_DAYS, NEWS_NOTICE_LIMIT, NEWS_NOTICE_PREFIX, NEWS_PAGE, NEWS_PAGE_MAX, NEWS_WRITE_REFUSAL,
  newsAuditDetail, newsHref, newsNotifications, newsPublishSchema, newsSaveSchema, newsView,
  type NewsFilter, type NewsPostView, type NewsPublishInput, type NewsRow,
} from "./model";

/**
 * Nyheter on the server (2026-11-21). Every function takes the request's Context (lib/kfid/server.ts: session or API/MCP key,
 * the company, the membership, the role, the test-account limits and the legal gate are already checked there) and reads and
 * writes only rows of that company.
 *
 * Reading: every active member reads what is published; drafts only the company's admin. Writing: the company's admin (OWNER or
 * ADMIN) writes, edits, pins, publishes and removes, with Cloud write access and the module Nyheter on; while the module is off
 * what exists can still be read.
 *
 * ---------------------------------------------------------------------------------------------------------------------------
 * CONTRACT FOR OTHER CODE (the agent missions, 2026-11-21). Stable; change it only together with its callers.
 *
 *   publishCompanyNews(actor: Context, input: {
 *     title: string;              // one line, 1–120 characters after trimming
 *     body?: string;              // up to 5000 characters, line breaks kept
 *     status?: "published" | "draft"; // default "published"
 *     source?: "agent" | "manual";    // default "agent"
 *     sourceRef: string;          // 1–200 characters: the run's own key (mission id + occasion); the idempotency key
 *     mission?: { id?: string; name: string }; // shown as "Agent: <name>" when source is "agent"
 *     pinned?: boolean;           // default false
 *   }): Promise<{ post: NewsPostView; href: string; created: boolean; removed: boolean }>
 *
 *   draftCompanyNews(actor, input)  – the same with status "draft".
 *   canWriteCompanyNews(actor)      – whether the actor may write at all (admin, module on, server storage); no write check.
 *
 * - `actor` is the mission owner's Context: inside a run, `runAsPrincipal({ ..., organizationId, actingUserId: owner }, () =>
 *   context())`. The owner's rights are checked again on every call: only the company's admin may write (else ApiError 403
 *   NEWS_WRITE_REFUSAL), the module must be on (409), the company must have Cloud write access (423) and server storage (409).
 * - IDEMPOTENT on (company, source, sourceRef): the first call creates the post; every later call with the same key creates
 *   nothing, changes nothing and returns the same post as it is now, with `created: false`. A post a person has removed since
 *   stays removed (`removed: true`, `post` with empty title and text): a rerun never brings it back.
 * - `href` is the app's link to the post, `/?view=news&post=<id>`, for the run's report, mail or chat ("Visa nyheten").
 * - A published post is told in the bell of every other active member for seven days (computed, nothing is written per member);
 *   the audit line in Administrationshistorik names the mission and the title, never the text.
 * ---------------------------------------------------------------------------------------------------------------------------
 */
export type NewsActor = Context;

const authorNames = async (ids: readonly string[]) => {
  const unique = [...new Set(ids)].filter(Boolean);
  if (!unique.length) return new Map<string, string>();
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, email: true } });
  return new Map(users.map((user) => [user.id, user.name?.trim() || user.email]));
};

const ROW_SELECT = { id: true, title: true, body: true, status: true, pinned: true, source: true, agentName: true, authorUserId: true, publishedAt: true, createdAt: true, updatedAt: true, deletedAt: true } as const;

async function viewsOf(rows: readonly NewsRow[]) {
  const names = await authorNames(rows.map((row) => row.authorUserId));
  return rows.map((row) => newsView(row, names.get(row.authorUserId)));
}

const audit = (actor: NewsActor, action: string, detail: string) =>
  prisma.administrationEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.user.id, action, detail: detail.slice(0, 500) } });

/** Whether the actor may write news now (the page's buttons, an agent's choice of target); the write functions check it again. */
export function canWriteCompanyNews(actor: Pick<Context, "admin" | "organization">) {
  return actor.admin && actor.organization.storageMode === "HINTEK_CLOUD" && organizationModuleOn(actor.organization, "news");
}

/** Every write: server storage, Cloud write access, the module, and the company's admin. */
async function requireNewsWrite(actor: NewsActor) {
  requireCloudStorage(actor);
  await requireCloudWriteAccess(actor);
  requireModule(actor, "news");
  if (!actor.admin) throw new ApiError(403, NEWS_WRITE_REFUSAL);
}

async function liveRow(actor: NewsActor, id: string) {
  const row = await prisma.companyNewsPost.findFirst({ where: { id, organizationId: actor.organizationId, deletedAt: null }, select: ROW_SELECT });
  if (!row) throw new ApiError(404, NEWS_MISSING);
  return row;
}

// ---------- reading ----------

/**
 * One page of the company's news: the published ones (pinned first, newest first) for everyone, or the drafts for the admin. `cursor`
 * is the last id of the page before; `query` looks in the title and the text.
 */
export async function listCompanyNews(actor: NewsActor, options: { filter?: NewsFilter; query?: string | null; cursor?: string | null; limit?: number } = {}) {
  requireCloudStorage(actor);
  const filter = options.filter ?? "published";
  if (filter === "draft" && !actor.admin) throw new ApiError(403, NEWS_WRITE_REFUSAL);
  const query = (options.query ?? "").trim().slice(0, 100);
  const limit = Math.min(NEWS_PAGE_MAX, Math.max(1, options.limit ?? NEWS_PAGE));
  const where: Prisma.CompanyNewsPostWhereInput = {
    organizationId: actor.organizationId, deletedAt: null, status: filter,
    ...(query ? { OR: [{ title: { contains: query, mode: "insensitive" } }, { body: { contains: query, mode: "insensitive" } }] } : {}),
  };
  const take = filter === "draft" ? NEWS_DRAFTS_MAX : limit;
  const cursorRow = options.cursor ? await prisma.companyNewsPost.findFirst({ where: { id: options.cursor, organizationId: actor.organizationId }, select: { id: true } }) : null;
  const rows = await prisma.companyNewsPost.findMany({
    where, select: ROW_SELECT, take: take + 1,
    ...(cursorRow ? { cursor: { id: cursorRow.id }, skip: 1 } : {}),
    orderBy: filter === "draft" ? [{ updatedAt: "desc" }, { id: "desc" }] : [{ pinned: "desc" }, { publishedAt: "desc" }, { id: "desc" }],
  });
  const page = rows.slice(0, take);
  const [items, drafts] = await Promise.all([
    viewsOf(page),
    actor.admin ? prisma.companyNewsPost.count({ where: { organizationId: actor.organizationId, deletedAt: null, status: "draft" } }) : Promise.resolve(0),
  ]);
  return { items, next: rows.length > take && filter !== "draft" ? page.at(-1)?.id ?? null : null, drafts, canWrite: canWriteCompanyNews(actor), moduleOn: organizationModuleOn(actor.organization, "news") };
}

/** One post: a published one for every member, a draft only for the admin. Opening it reads its notice in the bell. */
export async function getCompanyNews(actor: NewsActor, id: string): Promise<{ post: NewsPostView; canWrite: boolean }> {
  requireCloudStorage(actor);
  const row = await liveRow(actor, id);
  if (row.status !== "published" && !actor.admin) throw new ApiError(404, NEWS_MISSING);
  const [post] = await viewsOf([row]);
  // A read mark is the person's own and never business data; failing to write it changes nothing.
  if (row.status === "published")
    await prisma.noticeDelivery.createMany({ data: [{ organizationId: actor.organizationId, userId: actor.user.id, key: `${NEWS_NOTICE_PREFIX}${row.id}`, channel: NOTICE_READ_CHANNEL }], skipDuplicates: true }).catch(() => undefined);
  return { post: post!, canWrite: canWriteCompanyNews(actor) };
}

/** The bell's news for one person (lib/workflow/task-notifications-server.ts): published the last week by someone else. */
export async function loadNewsNotifications(actor: Pick<Context, "organizationId" | "user" | "organization">, now = new Date()): Promise<TaskNotification[]> {
  if (actor.organization.storageMode !== "HINTEK_CLOUD" || !organizationModuleOn(actor.organization, "news")) return [];
  const rows = await prisma.companyNewsPost.findMany({
    where: { organizationId: actor.organizationId, deletedAt: null, status: "published", publishedAt: { gte: new Date(now.getTime() - NEWS_NOTICE_DAYS * 86_400_000) }, authorUserId: { not: actor.user.id } },
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }], take: NEWS_NOTICE_LIMIT,
    select: { id: true, title: true, body: true, source: true, agentName: true, authorUserId: true, publishedAt: true },
  });
  const names = await authorNames(rows.filter((row) => row.source !== "agent").map((row) => row.authorUserId));
  return newsNotifications(rows.map((row) => ({ ...row, authorName: names.get(row.authorUserId) ?? null })), { userId: actor.user.id, now });
}

// ---------- the admin's own writing ----------

/** A new post from the page: a draft, or published at once. */
export async function createCompanyNews(actor: NewsActor, input: unknown) {
  await requireNewsWrite(actor);
  const save = newsSaveSchema.parse(input);
  const now = new Date();
  const row = await prisma.companyNewsPost.create({
    data: { organizationId: actor.organizationId, title: save.title, body: save.body, pinned: save.pinned, status: save.status, publishedAt: save.status === "published" ? now : null, source: "manual", authorUserId: actor.user.id, updatedById: actor.user.id },
    select: ROW_SELECT,
  });
  await audit(actor, save.status === "published" ? "news_published" : "news_draft", newsAuditDetail(save.status === "published" ? "published" : "draft", row));
  const [post] = await viewsOf([row]);
  return { post: post! };
}

/**
 * A change from the page: the text, pinned, and published or back to a draft. Publishing keeps the first publishing time, so a
 * correction is not told in the bell again; a post made a draft and published again is new news.
 */
export async function updateCompanyNews(actor: NewsActor, id: string, input: unknown) {
  await requireNewsWrite(actor);
  const save = newsSaveSchema.parse(input);
  const before = await liveRow(actor, id);
  const publishing = save.status === "published" && before.status !== "published";
  const row = await prisma.companyNewsPost.update({
    where: { id: before.id },
    data: { title: save.title, body: save.body, pinned: save.pinned, status: save.status, updatedById: actor.user.id, ...(publishing ? { publishedAt: new Date() } : save.status === "draft" ? { publishedAt: null } : {}) },
    select: ROW_SELECT,
  });
  const action = publishing ? "published" : save.status === "draft" && before.status === "published" ? "unpublished" : "updated";
  await audit(actor, `news_${action}`, newsAuditDetail(action, row));
  const [post] = await viewsOf([row]);
  return { post: post! };
}

export async function pinCompanyNews(actor: NewsActor, id: string, pinned: boolean) {
  await requireNewsWrite(actor);
  const before = await liveRow(actor, id);
  if (before.pinned === pinned) { const [post] = await viewsOf([before]); return { post: post! }; }
  const row = await prisma.companyNewsPost.update({ where: { id: before.id }, data: { pinned, updatedById: actor.user.id }, select: ROW_SELECT });
  await audit(actor, pinned ? "news_pinned" : "news_unpinned", newsAuditDetail(pinned ? "pinned" : "unpinned", row));
  const [post] = await viewsOf([row]);
  return { post: post! };
}

/** Ta bort: a manual post is deleted; an agent's post stays as an empty row with its key, so the same run never publishes it again. */
export async function deleteCompanyNews(actor: NewsActor, id: string) {
  await requireNewsWrite(actor);
  const before = await liveRow(actor, id);
  if (before.source === "agent") await prisma.companyNewsPost.update({ where: { id: before.id }, data: { title: "", body: "", pinned: false, deletedAt: new Date(), updatedById: actor.user.id } });
  else await prisma.companyNewsPost.delete({ where: { id: before.id } });
  // The bell's read marks of the post go with it.
  await prisma.noticeDelivery.deleteMany({ where: { organizationId: actor.organizationId, channel: NOTICE_READ_CHANNEL, key: `${NEWS_NOTICE_PREFIX}${before.id}` } });
  await audit(actor, "news_deleted", newsAuditDetail("deleted", before));
  return { removed: before.id };
}

// ---------- other code: the agent missions ----------

const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/** See the contract at the top of this file. */
export async function publishCompanyNews(actor: NewsActor, input: NewsPublishInput): Promise<{ post: NewsPostView; href: string; created: boolean; removed: boolean }> {
  await requireNewsWrite(actor);
  const value = newsPublishSchema.parse(input);
  const key = { organizationId: actor.organizationId, source: value.source, sourceRef: value.sourceRef };
  const existing = () => prisma.companyNewsPost.findUnique({ where: { organizationId_source_sourceRef: key }, select: ROW_SELECT });
  const answer = async (row: NonNullable<Awaited<ReturnType<typeof existing>>>, created: boolean) => {
    const [post] = await viewsOf([row]);
    return { post: post!, href: newsHref(row.id), created, removed: Boolean(row.deletedAt) };
  };
  const found = await existing();
  if (found) return answer(found, false);
  const agentName = value.source === "agent" ? value.mission?.name ?? null : null;
  try {
    const row = await prisma.companyNewsPost.create({
      data: {
        ...key, title: value.title, body: value.body, status: value.status, pinned: value.pinned, publishedAt: value.status === "published" ? new Date() : null,
        agentMissionId: value.source === "agent" ? value.mission?.id ?? null : null, agentName, authorUserId: actor.user.id, updatedById: actor.user.id,
      },
      select: ROW_SELECT,
    });
    await audit(actor, value.status === "published" ? "news_published" : "news_draft", newsAuditDetail(value.status === "published" ? "published" : "draft", row));
    return answer(row, true);
  } catch (error) {
    // Two runs at once with the same key: the database lets one through, and the other answers with that post.
    if (!isUniqueViolation(error)) throw error;
    const raced = await existing();
    if (!raced) throw error;
    return answer(raced, false);
  }
}

/** The same as publishCompanyNews, saved as a draft for the admin to read and publish. */
export const draftCompanyNews = (actor: NewsActor, input: Omit<NewsPublishInput, "status">) => publishCompanyNews(actor, { ...input, status: "draft" });
