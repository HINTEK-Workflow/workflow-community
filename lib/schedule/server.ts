import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { autoApprovalsFor } from "@/lib/content-assignments/store";
import { absoluteUrl } from "@/lib/env";
import { canAccessTest } from "@/lib/auth/access";
import { ApiError } from "@/lib/kfid/errors";
import { formatSwedish } from "@/lib/swedish-time";
import { postProblem } from "@/lib/meta/text";
import { moduleOnWhere } from "@/lib/workflow/modules";
import { combineOutcomes, outcomeOfError, POST_PUBLISHERS } from "./channels";
import { runClaimed, runDueWith, type ScheduleRunDeps, type ScheduleStore } from "./engine";
import {
  ACTIVE_STATUSES, channelText, parseScheduleTime, POST_CONTENT_FIELDS, postContentHash, websiteContentHash,
  type RunOutcome, type ScheduledView, type ScheduleItem, type ScheduleKind, type WebsitePayload,
} from "./model";

/**
 * Schemalägg (2026-11-11) on the server: scheduling a post (Inlägg) or a page (Min webbsida), the list, Ändra tid, Avbryt,
 * Godkänn igen and Publicera nu, and the job's real database, publishing and mail (lib/schedule/engine.ts runs them).
 *
 * - Every function takes the company the API checked, and every row read or written is that company's.
 * - Schemalägg is the admin's own approval: who and when is stored on the item and in the company's audit. At the time, the job
 *   checks again that the admin is still an active admin of the company with write access, and publishes as that admin through
 *   the same functions as Publicera – so the company's switch for publishing, the token and the page's own checks all apply.
 * - A post is published only while its content is the approved one (its hash). Changing a scheduled post makes the item
 *   "Behöver godkännas" until an admin approves it again. A page's approved markup is stored with the item itself, so a later
 *   edit in the editor never changes what goes out; Schemalägg again replaces it.
 * - A failure is shown as Misslyckades with the reason and mailed once to the company's admins.
 * - The audit never holds a post's or a page's text.
 */
export type Actor = { userId: string; organizationId: string };

async function audit(actor: Actor, action: string, detail: string) {
  await prisma.administrationEvent.create({ data: { actorId: actor.userId, organizationId: actor.organizationId, action, detail: detail.slice(0, 500) } });
}

const when = (at: Date) => formatSwedish(at, { dateStyle: "medium", timeStyle: "short" });
const itemSelect = {
  id: true, organizationId: true, kind: true, targetId: true, title: true, status: true, runAt: true, nextAttemptAt: true, attempts: true, contentHash: true,
  payload: true, channels: true, scheduledById: true, lastError: true, failureMailedAt: true, seriesId: true, scheduledAt: true, result: true, publishedAt: true, updatedAt: true,
} satisfies Prisma.ScheduledPublishSelect;
type ItemRow = Prisma.ScheduledPublishGetPayload<{ select: typeof itemSelect }>;

// ---------- the list ----------

const KEEP_DONE_MS = 30 * 86_400_000;

export async function listScheduled(organizationId: string, filter: { kind?: ScheduleKind; targetId?: string; seriesId?: string } = {}): Promise<ScheduledView[]> {
  const rows = await prisma.scheduledPublish.findMany({
    where: { organizationId, ...(filter.kind ? { kind: filter.kind } : {}), ...(filter.targetId ? { targetId: filter.targetId } : {}), ...(filter.seriesId ? { seriesId: filter.seriesId } : {}),
      OR: [{ status: { in: [...ACTIVE_STATUSES] } }, { updatedAt: { gte: new Date(Date.now() - KEEP_DONE_MS) } }] },
    orderBy: { runAt: "asc" }, take: 200, select: itemSelect,
  });
  const people = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.scheduledById))] } }, select: { id: true, name: true, email: true } });
  const nameOf = new Map(people.map((person) => [person.id, person.name || person.email]));
  // A failed post whose newsletter alone is left can be sent again from the list (Skicka nyhetsbrevet).
  const retry = new Set<string>();
  for (const row of rows.filter((item) => item.status === "failed" && item.kind === "post" && item.channels.includes("newsletter")))
    if (await newsletterPending(row)) retry.add(row.id);
  // Innehållsuppdrag (2026-11-25): which items a key's rule approved automatically, shown in the list.
  const auto = await autoApprovalsFor(organizationId, rows.filter((row) => row.kind === "post").map((row) => row.id));
  return rows.map((row) => ({
    autoApproved: auto.get(row.id) ?? null,
    id: row.id, kind: row.kind as ScheduleKind, targetId: row.targetId, title: row.title, status: row.status as ScheduledView["status"],
    runAt: row.runAt.toISOString(), nextAttemptAt: row.nextAttemptAt.toISOString(), attempts: row.attempts, channels: row.channels, seriesId: row.seriesId,
    scheduledByName: nameOf.get(row.scheduledById) ?? null, scheduledAt: row.scheduledAt.toISOString(), lastError: row.lastError, result: row.result,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    newsletterRetry: retry.has(row.id),
  }));
}

async function itemOf(organizationId: string, id: string) {
  const row = await prisma.scheduledPublish.findFirst({ where: { id, organizationId }, select: itemSelect });
  if (!row) throw new ApiError(404, "Den schemalagda publiceringen finns inte.");
  return row;
}

function timeOf(value: string) {
  const parsed = parseScheduleTime(value);
  if ("error" in parsed) throw new ApiError(400, parsed.error);
  return parsed.at;
}

// ---------- posts ----------

const postContentSelect = { id: true, status: true, heading: true, body: true, caption: true, hashtags: true, link: true, template: true, toFacebook: true, toInstagram: true, toNewsletter: true, newsletterMail: true, toStory: true, logoVariant: true, logoSize: true, logoPlate: true, backgroundSource: true, background: true,
  instagramText: true, campaignLinks: true, aiGenerated: true, images: { select: { bytes: true }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] } } satisfies Prisma.SocialPostSelect;
// A channel that adds a field (POST_CONTENT_FIELDS) is read with the rest.
const postSelectWithChannels = () => ({ ...postContentSelect, ...Object.fromEntries(POST_CONTENT_FIELDS.map((key) => [key, true])) }) as typeof postContentSelect;
type PostRow = Prisma.SocialPostGetPayload<{ select: typeof postContentSelect }>;

export async function postOf(organizationId: string, id: string): Promise<PostRow | null> {
  return prisma.socialPost.findFirst({ where: { id, organizationId }, select: postSelectWithChannels() });
}

const channelsOfPost = (post: PostRow) => POST_PUBLISHERS.flatMap((publisher) => publisher.channels(post as unknown as Record<string, unknown>));

/** Why the post cannot be scheduled now, or null: the same rules as Publicera, and the company's switch must be on. */
export async function postScheduleProblem(organizationId: string, post: PostRow): Promise<string | null> {
  if (post.status === "published" || post.status === "publishing") return "Inlägget är redan publicerat.";
  const problem = postProblem(post);
  if (problem) return problem;
  if (!channelsOfPost(post).length) return "Välj minst en kanal.";
  if (post.toFacebook || post.toInstagram) {
    const connection = await prisma.metaConnection.findUnique({ where: { organizationId }, select: { publishingApproved: true, pageId: true, status: true, instagramId: true } });
    if (!connection?.publishingApproved) return "Publicering är avstängd. Slå på den under Kopplingar → Webb och sociala medier.";
    if (!connection.pageId || connection.status === "invalid" || connection.status === "choose") return "Kopplingen till Facebook fungerar inte. Öppna Kopplingar.";
    if (post.toInstagram && !connection.instagramId) return "Sidan har inget Instagramkonto kopplat.";
  }
  return null;
}

/** A target has at most one active item: a new Schemalägg replaces it (never one that is publishing right now). */
async function replaceActive(tx: Prisma.TransactionClient, actor: Actor, kind: ScheduleKind, targetId: string) {
  const running = await tx.scheduledPublish.findFirst({ where: { organizationId: actor.organizationId, kind, targetId, status: "running" }, select: { id: true } });
  if (running) throw new ApiError(409, "Den publiceras just nu.");
  await tx.scheduledPublish.updateMany({ where: { organizationId: actor.organizationId, kind, targetId, status: { in: ["scheduled", "needs_approval"] } },
    data: { status: "cancelled", cancelledById: actor.userId, cancelledAt: new Date(), result: "Ersatt av en ny schemaläggning." } });
}

/** Även som nyhetsbrev (2026-11-12): a post that is also a newsletter is scheduled or approved only by a person with Utskick. */
async function newsletterRight(actor: Actor, post: PostRow) {
  if (!post.toNewsletter) return;
  const { requireNewsletterRight } = await import("@/lib/mail/post-newsletter");
  await requireNewsletterRight(actor.userId);
}

/** Schemalägg (Inlägg): the admin's press approves the post as it is now, for the chosen Swedish time. */
export async function schedulePost(actor: Actor, postId: string, value: string, options: { seriesId?: string | null } = {}) {
  const at = timeOf(value);
  const post = await postOf(actor.organizationId, postId);
  if (!post) throw new ApiError(404, "Inlägget finns inte.");
  const problem = await postScheduleProblem(actor.organizationId, post);
  if (problem) throw new ApiError(409, problem);
  await newsletterRight(actor, post);
  const channels = channelsOfPost(post);
  const item = await prisma.$transaction(async (tx) => {
    await replaceActive(tx, actor, "post", post.id);
    return tx.scheduledPublish.create({ data: {
      organizationId: actor.organizationId, kind: "post", targetId: post.id, title: post.heading.slice(0, 200), status: "scheduled", runAt: at, nextAttemptAt: at,
      contentHash: postContentHash(post as unknown as Parameters<typeof postContentHash>[0]), channels, seriesId: options.seriesId ?? null, scheduledById: actor.userId,
    }, select: { id: true } });
  });
  await audit(actor, "schedule_create", `Schemalade inlägget (id ${post.id}) till ${when(at)} (${channelText(channels)}).`);
  return item;
}

/**
 * Innehållsuppdrag (2026-11-25): the draft goes into Schemalagt at the recommended time, WAITING FOR APPROVAL – the admin's
 * Godkänn (approveScheduled) is what lets the job publish it, through the same path as every scheduled post. The waiting item's hash
 * never matches a post (a marker, not content), so a later Spara can never approve it by itself (postChanged). Only when the company's
 * own rule for automatic approval allows it (lib/content-assignments/auto-publish.ts) is the item stored as approved, with the post's
 * hash, and the approval is logged with the key. A post that cannot be published (switch off, no channel) is not scheduled.
 */
export async function scheduleForApproval(actor: Actor, postId: string, at: Date, auto: { keyName: string } | null): Promise<{ id: string; status: "needs_approval" | "scheduled" } | { reason: string }> {
  const post = await postOf(actor.organizationId, postId);
  if (!post) throw new ApiError(404, "Inlägget finns inte.");
  const problem = await postScheduleProblem(actor.organizationId, post);
  if (problem) return { reason: `Utkastet schemalades inte: ${problem}` };
  if (post.toNewsletter) return { reason: "Utkastet schemalades inte: ett nyhetsbrev schemaläggs av en person." };
  const channels = channelsOfPost(post);
  const status = auto ? "scheduled" as const : "needs_approval" as const;
  const contentHash = auto ? postContentHash(post as unknown as Parameters<typeof postContentHash>[0]) : `awaiting-approval:${randomUUID()}`;
  const item = await prisma.$transaction(async (tx) => {
    await replaceActive(tx, actor, "post", post.id);
    return tx.scheduledPublish.create({ data: {
      organizationId: actor.organizationId, kind: "post", targetId: post.id, title: post.heading.slice(0, 200), status, runAt: at, nextAttemptAt: at,
      contentHash, channels, scheduledById: actor.userId,
    }, select: { id: true } });
  });
  await audit(actor, auto ? "schedule_autoapprove" : "schedule_create", auto
    ? `Ett innehållsuppdrag godkändes automatiskt av nyckeln ${auto.keyName.slice(0, 80)} för publicering ${when(at)} (${channelText(channels)}, inlägg ${post.id}).`
    : `Ett innehållsuppdrag lades i Schemalagt till ${when(at)} och väntar på godkännande (${channelText(channels)}, inlägg ${post.id}).`);
  return { id: item.id, status };
}

/**
 * Called when a post is changed (Spara, a background) or removed: an active item whose approved content no longer matches waits
 * for a new approval; a removed post's items are cancelled.
 */
export async function postChanged(organizationId: string, postId: string, removed = false) {
  const items = await prisma.scheduledPublish.findMany({ where: { organizationId, kind: "post", targetId: postId, status: { in: ["scheduled", "needs_approval"] } }, select: { id: true, contentHash: true, status: true } });
  if (!items.length) return;
  if (removed) {
    await prisma.scheduledPublish.updateMany({ where: { id: { in: items.map((item) => item.id) }, organizationId, status: { in: ["scheduled", "needs_approval"] } }, data: { status: "cancelled", cancelledAt: new Date(), result: "Inlägget togs bort." } });
    await prisma.contentSeriesItem.deleteMany({ where: { postId, series: { organizationId } } });
    return;
  }
  const post = await postOf(organizationId, postId);
  if (!post) return;
  const hash = postContentHash(post as unknown as Parameters<typeof postContentHash>[0]);
  for (const item of items) {
    const next = item.contentHash === hash ? "scheduled" : "needs_approval";
    if (next !== item.status) await prisma.scheduledPublish.updateMany({ where: { id: item.id, organizationId, status: item.status }, data: { status: next, title: post.heading.slice(0, 200), channels: channelsOfPost(post) } });
  }
}

/** Godkänn igen: the admin approves the post as it is now (after a change), keeping the time. */
export async function approveScheduled(actor: Actor, id: string) {
  const item = await itemOf(actor.organizationId, id);
  if (item.kind === "video" && (item.status === "needs_approval" || item.status === "scheduled")) return approveVideo(actor, item);
  if (item.kind !== "post" || (item.status !== "needs_approval" && item.status !== "scheduled")) throw new ApiError(409, "Det finns inget att godkänna.");
  const post = await postOf(actor.organizationId, item.targetId);
  if (!post) throw new ApiError(404, "Inlägget finns inte.");
  const problem = await postScheduleProblem(actor.organizationId, post);
  if (problem) throw new ApiError(409, problem);
  await newsletterRight(actor, post);
  const changed = await prisma.scheduledPublish.updateMany({ where: { id: item.id, organizationId: actor.organizationId, status: item.status }, data: {
    status: "scheduled", contentHash: postContentHash(post as unknown as Parameters<typeof postContentHash>[0]), channels: channelsOfPost(post), title: post.heading.slice(0, 200),
    scheduledById: actor.userId, scheduledAt: new Date(), lastError: null, failureMailedAt: null,
  } });
  if (!changed.count) throw new ApiError(409, "Den schemalagda publiceringen har ändrats. Ladda om sidan.");
  await audit(actor, "schedule_approve", `Godkände inlägget (id ${post.id}) för publicering ${when(item.runAt)}.`);
}

/**
 * Publicera automatiskt (Agenter, 2026-11-21): an agent's post the owner chose to publish goes through Schemalägg at once –
 * the same checks as Schemalägg (the company's switch, the token, the channels), the same claim and the approved content's hash –
 * as the mission's owner, who must be an admin (authorize). A post already published is not published again.
 */
export async function publishAgentPost(actor: Actor, postId: string): Promise<{ status: string; message: string }> {
  const post = await postOf(actor.organizationId, postId);
  if (!post) throw new ApiError(404, "Inlägget finns inte.");
  if (post.status === "published") return { status: "published", message: "Inlägget var redan publicerat." };
  const problem = await postScheduleProblem(actor.organizationId, post);
  if (problem) throw new ApiError(409, problem);
  const now = new Date();
  const item = await prisma.$transaction(async (tx) => {
    await replaceActive(tx, actor, "post", post.id);
    return tx.scheduledPublish.create({ data: {
      organizationId: actor.organizationId, kind: "post", targetId: post.id, title: post.heading.slice(0, 200), status: "scheduled", runAt: now, nextAttemptAt: now,
      contentHash: postContentHash(post as unknown as Parameters<typeof postContentHash>[0]), channels: channelsOfPost(post), scheduledById: actor.userId,
    }, select: { id: true } });
  });
  await audit(actor, "schedule_create", `Ett agentuppdrag publicerade inlägget (id ${post.id}) direkt (${channelText(channelsOfPost(post))}).`);
  const run = await runClaimed(realDeps(), item.id, now);
  return { status: run.status ?? "scheduled", message: run.outcome?.message ?? "" };
}

// ---------- pages (Min webbsida) ----------

/** Schemalägg (Min webbsida): the page's markup as the editor has it now, checked like Publicera, stored with the item. */
export async function scheduleWebsite(actor: Actor, input: WebsitePayload & { at: string }) {
  const at = timeOf(input.at);
  const { connectionConfig } = await import("@/lib/website/server");
  const { getPage } = await import("@/lib/website/wp-client");
  const { editProblem } = await import("@/lib/website/guard");
  const config = await connectionConfig(actor.organizationId);
  if (!config) throw new ApiError(409, "Webbplatsen är inte kopplad.");
  const current = await getPage(config, input.pageId).catch(() => { throw new ApiError(502, "Sidan kunde inte hämtas från webbplatsen."); });
  if (current.modified !== input.baseModified) throw new ApiError(409, "Sidan har ändrats i WordPress sedan du öppnade den. Ladda om sidan.");
  const problem = editProblem(current.content, input.content, { publishing: true });
  if (problem) throw new ApiError(400, problem);
  const payload: WebsitePayload = { pageId: input.pageId, content: input.content, baseModified: input.baseModified, seo: input.seo ?? null, seoBase: input.seoBase ?? null };
  const targetId = String(input.pageId);
  const item = await prisma.$transaction(async (tx) => {
    await replaceActive(tx, actor, "website", targetId);
    return tx.scheduledPublish.create({ data: {
      organizationId: actor.organizationId, kind: "website", targetId, title: current.title.slice(0, 200), status: "scheduled", runAt: at, nextAttemptAt: at,
      contentHash: websiteContentHash(payload), payload: payload as unknown as Prisma.InputJsonValue, channels: ["website"], scheduledById: actor.userId,
    }, select: { id: true } });
  });
  await audit(actor, "schedule_create", `Schemalade publicering av webbplatsens sida ${current.title} (id ${input.pageId}) till ${when(at)}.`);
  return item;
}

// ---------- films (Filmer, YouTube) ----------

/** Schemalägg (Filmer, 2026-11-20): the film as it is now, checked like Publicera, uploaded to YouTube at the chosen time. */
export async function scheduleVideo(actor: Actor, videoId: string, value: string) {
  const at = timeOf(value);
  const { videoForSchedule, videoContentHash, videoPublishProblem } = await import("@/lib/youtube/videos-server");
  const video = await videoForSchedule(actor.organizationId, videoId);
  if (!video) throw new ApiError(404, "Filmen finns inte.");
  const problem = await videoPublishProblem(actor.organizationId, video);
  if (problem) throw new ApiError(409, problem);
  const item = await prisma.$transaction(async (tx) => {
    await replaceActive(tx, actor, "video", video.id);
    return tx.scheduledPublish.create({ data: {
      organizationId: actor.organizationId, kind: "video", targetId: video.id, title: video.title.slice(0, 200), status: "scheduled", runAt: at, nextAttemptAt: at,
      contentHash: videoContentHash(video), channels: ["youtube"], scheduledById: actor.userId,
    }, select: { id: true } });
  });
  await audit(actor, "schedule_create", `Schemalade filmen (id ${video.id}) till ${when(at)} (YouTube).`);
  return item;
}

async function approveVideo(actor: Actor, item: ItemRow) {
  const { videoForSchedule, videoContentHash, videoPublishProblem } = await import("@/lib/youtube/videos-server");
  const video = await videoForSchedule(actor.organizationId, item.targetId);
  if (!video) throw new ApiError(404, "Filmen finns inte.");
  const problem = await videoPublishProblem(actor.organizationId, video);
  if (problem) throw new ApiError(409, problem);
  const changed = await prisma.scheduledPublish.updateMany({ where: { id: item.id, organizationId: actor.organizationId, status: item.status }, data: {
    status: "scheduled", contentHash: videoContentHash(video), title: video.title.slice(0, 200), scheduledById: actor.userId, scheduledAt: new Date(), lastError: null, failureMailedAt: null,
  } });
  if (!changed.count) throw new ApiError(409, "Den schemalagda publiceringen har ändrats. Ladda om sidan.");
  await audit(actor, "schedule_approve", `Godkände filmen (id ${video.id}) för publicering ${when(item.runAt)}.`);
}

/** The item in the audit's words: the post, the film or the page and its id. */
const itemText = (item: { kind: string; targetId: string }) => item.kind === "post" ? `inlägget (id ${item.targetId})` : item.kind === "video" ? `filmen (id ${item.targetId})` : `sidan (id ${item.targetId})`;

async function publishVideoItem(item: ScheduleItem, actor: Actor): Promise<RunOutcome> {
  const { publishScheduledVideo } = await import("@/lib/youtube/videos-server");
  try { return await publishScheduledVideo(actor, item.targetId, item.contentHash); } catch (error) { return outcomeOfError(error); }
}

// ---------- change, cancel, publish now ----------

export async function rescheduleItem(actor: Actor, id: string, value: string) {
  const at = timeOf(value);
  const item = await itemOf(actor.organizationId, id);
  if (item.status !== "scheduled" && item.status !== "needs_approval" && item.status !== "failed") throw new ApiError(409, item.status === "running" ? "Den publiceras just nu." : "Den kan inte flyttas längre.");
  // A failed item gets a new chance at the new time; its content must still be the approved one (checked at run time).
  const changed = await prisma.scheduledPublish.updateMany({ where: { id: item.id, organizationId: actor.organizationId, status: item.status }, data: {
    runAt: at, nextAttemptAt: at, attempts: 0, lastError: null, failureMailedAt: null, ...(item.status === "failed" ? { status: "scheduled", scheduledById: actor.userId, scheduledAt: new Date() } : {}),
  } });
  if (!changed.count) throw new ApiError(409, "Den schemalagda publiceringen har ändrats. Ladda om sidan.");
  await audit(actor, "schedule_change", `Flyttade den schemalagda publiceringen av ${itemText(item)} till ${when(at)}.`);
}

export async function cancelItem(actor: Actor, id: string) {
  const item = await itemOf(actor.organizationId, id);
  if (item.status === "running") throw new ApiError(409, "Den publiceras just nu.");
  if (item.status !== "scheduled" && item.status !== "needs_approval") throw new ApiError(409, "Den är redan klar eller avbruten.");
  const changed = await prisma.scheduledPublish.updateMany({ where: { id: item.id, organizationId: actor.organizationId, status: item.status }, data: { status: "cancelled", cancelledById: actor.userId, cancelledAt: new Date() } });
  if (!changed.count) throw new ApiError(409, "Den schemalagda publiceringen har ändrats. Ladda om sidan.");
  await audit(actor, "schedule_cancel", `Avbröt den schemalagda publiceringen av ${itemText(item)} (${when(item.runAt)}).`);
}

/** The states an item may be taken out of the list in (Ta bort ur listan, 2026-11-13): done without being published. */
export const REMOVABLE_STATUSES = ["cancelled", "failed"] as const;

/**
 * Ta bort ur listan (2026-11-13): a cancelled or failed item leaves Schemalagt. Only the schedule goes – the post (the
 * draft) or the page stays as it is; the audit keeps that it was removed. Any other state is refused.
 */
export async function removeItem(actor: Actor, id: string) {
  const item = await itemOf(actor.organizationId, id);
  if (!(REMOVABLE_STATUSES as readonly string[]).includes(item.status)) throw new ApiError(409, item.status === "running" ? "Den publiceras just nu." : "Bara avbrutna och misslyckade kan tas bort ur listan. Avbryt den först.");
  const removed = await prisma.scheduledPublish.deleteMany({ where: { id: item.id, organizationId: actor.organizationId, status: { in: [...REMOVABLE_STATUSES] } } });
  if (!removed.count) throw new ApiError(409, "Den schemalagda publiceringen har ändrats. Ladda om sidan.");
  await audit(actor, "schedule_remove", `Tog bort den ${item.status === "failed" ? "misslyckade" : "avbrutna"} publiceringen av ${itemText(item)} (${when(item.runAt)}) ur listan.`);
}

/** Publicera nu: the person's own press (the API asked for the confirmation); runs through the same claim as the job. */
export async function publishItemNow(actor: Actor, id: string) {
  let item = await itemOf(actor.organizationId, id);
  // Skicka nyhetsbrevet (2026-11-12): a failed post whose channels went out but whose newsletter did not is run again for the
  // newsletter alone, by the person who presses (who must have Utskick; checked when it is sent), from a fresh count of attempts.
  if (item.status === "failed" && (await newsletterPending(item))) {
    const reopened = await prisma.scheduledPublish.updateMany({ where: { id: item.id, organizationId: actor.organizationId, status: "failed" },
      data: { status: "scheduled", attempts: 0, lastError: null, failureMailedAt: null, scheduledById: actor.userId, scheduledAt: new Date() } });
    if (!reopened.count) throw new ApiError(409, "Den schemalagda publiceringen har ändrats. Ladda om sidan.");
    item = await itemOf(actor.organizationId, id);
  }
  if (item.status === "needs_approval") throw new ApiError(409, `${item.kind === "video" ? "Filmen" : "Inlägget"} har ändrats. Godkänn ${item.kind === "video" ? "den" : "det"} först.`);
  if (item.status !== "scheduled") throw new ApiError(409, item.status === "running" ? "Den publiceras just nu." : "Den är redan klar eller avbruten.");
  const now = new Date();
  await prisma.scheduledPublish.updateMany({ where: { id: item.id, organizationId: actor.organizationId, status: "scheduled" }, data: { nextAttemptAt: now } });
  await audit(actor, "schedule_publish_now", `Publicerade den schemalagda ${itemText(item)} direkt.`);
  const run = await runClaimed(realDeps(), item.id, now, actor.userId);
  if (!run.claimed) throw new ApiError(409, "Den publiceras redan.");
  // A film handed to the upload here starts at once in this process (the job would otherwise take it within five minutes).
  if (item.kind === "video" && run.status === "published") {
    const { kickVideoUpload } = await import("@/lib/youtube/videos-server");
    await kickVideoUpload(actor.organizationId, item.targetId);
  }
  return { status: run.status ?? "running", message: run.outcome?.message ?? "" };
}

/** Whether a post item's channels went out but its newsletter did not (Skicka nyhetsbrevet). */
async function newsletterPending(item: { kind: string; organizationId: string; targetId: string }) {
  if (item.kind !== "post") return false;
  const post = await prisma.socialPost.findFirst({ where: { id: item.targetId, organizationId: item.organizationId }, select: { status: true, toNewsletter: true } });
  if (!post?.toNewsletter || post.status !== "published") return false;
  return !(await prisma.mailing.count({ where: { socialPostId: item.targetId } }));
}

// ---------- the job's real store, publishing and mail ----------

const asItem = (row: ItemRow): ScheduleItem => ({ ...row, kind: row.kind, status: row.status });

export const prismaStore: ScheduleStore = {
  stale: async (now) => (await prisma.scheduledPublish.findMany({ where: { status: "running", lockedUntil: { lt: now } }, select: itemSelect, take: 50 })).map(asItem),
  // Webb och inlägg off (2026-11-20): the company's items wait, as they are, until the module is on again.
  due: async (now, limit) => (await prisma.scheduledPublish.findMany({ where: { status: "scheduled", nextAttemptAt: { lte: now }, organization: moduleOnWhere("web_posts") }, orderBy: { nextAttemptAt: "asc" }, take: limit, select: itemSelect })).map(asItem),
  async claim(id, now, lockedUntil) {
    const claimed = await prisma.scheduledPublish.updateMany({ where: { id, status: "scheduled", nextAttemptAt: { lte: now } }, data: { status: "running", lockedUntil, attempts: { increment: 1 } } });
    if (!claimed.count) return null;
    const row = await prisma.scheduledPublish.findUnique({ where: { id }, select: itemSelect });
    return row ? asItem(row) : null;
  },
  async finish(id, data, from) {
    const done = await prisma.scheduledPublish.updateMany({ where: { id, status: from }, data: { ...data, nextAttemptAt: data.nextAttemptAt ?? undefined } });
    return done.count > 0;
  },
  async mailed(id, now) { await prisma.scheduledPublish.updateMany({ where: { id }, data: { failureMailedAt: now } }); },
};

/** Whether the admin who scheduled may still publish for the company: active, admin, the company active, Cloud and write access. */
async function authorize(item: ScheduleItem, now: Date): Promise<string | null> {
  const member = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: item.organizationId, userId: item.scheduledById } },
    select: { isActive: true, role: true, user: { select: { isActive: true, email: true } }, organization: { select: { isActive: true, storageMode: true } } },
  });
  if (!member?.isActive || !canAccessTest(member.user) || (member.role !== "OWNER" && member.role !== "ADMIN")) return "Den som schemalade är inte längre administratör i företaget. Schemalägg igen.";
  if (!member.organization.isActive) return "Företaget är pausat.";
  if (member.organization.storageMode !== "HINTEK_CLOUD") return "Företaget använder lokal lagring.";
  try {
    const { serverExtensions } = await import("@/lib/extensions/server");
    const access = await serverExtensions.cloudWriteAccess(item.organizationId, now);
    if (!access.allowed) return "Företaget har ingen giltig Cloud-rättighet för att skriva just nu.";
  } catch { return "Behörigheten kunde inte kontrolleras."; }
  return null;
}

async function publishPostItem(item: ScheduleItem, actor: Actor): Promise<RunOutcome> {
  const post = await postOf(item.organizationId, item.targetId);
  if (!post) return { kind: "skip", message: "Inlägget finns inte längre." };
  // A post already published (by an earlier attempt, or by hand) only runs the parts that go on their own – the newsletter, which
  // is tried again alone after the channels went out (2026-11-12) and is sent at most once (Mailing.socialPostId).
  const published = post.status === "published";
  const pending = POST_PUBLISHERS.filter((publisher) => (!published || publisher.afterPublished) && publisher.channels(post as unknown as Record<string, unknown>).length);
  if (published && !pending.length) return { kind: "skip", message: "Inlägget var redan publicerat." };
  if (post.status === "publishing") return { kind: "fail", message: "Inlägget publicerades redan på annat sätt. Kontrollera sidan." };
  if (postContentHash(post as unknown as Parameters<typeof postContentHash>[0]) !== item.contentHash) return { kind: "fail", message: "Inlägget har ändrats efter schemaläggningen. Godkänn det igen." };
  const outcomes: RunOutcome[] = [];
  for (const publisher of pending) {
    outcomes.push(await publisher.publish(actor, post.id).catch((error) => outcomeOfError(error)));
  }
  return combineOutcomes(outcomes);
}

async function publishWebsiteItem(item: ScheduleItem, actor: Actor): Promise<RunOutcome> {
  const payload = item.payload as WebsitePayload;
  if (!payload?.content || websiteContentHash(payload) !== item.contentHash) return { kind: "fail", message: "Den godkända versionen av sidan saknas. Schemalägg igen." };
  const { publishWebsitePage } = await import("@/lib/website/server");
  try {
    const result = await publishWebsitePage(actor, payload.pageId, { content: payload.content, baseModified: payload.baseModified, seo: payload.seo as never, seoBase: payload.seoBase as never });
    return { kind: "published", message: result.unchanged ? "Sidan på webbplatsen var redan likadan." : "Sidan är publicerad på webbplatsen." };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) return { kind: "fail", message: "Sidan har ändrats i WordPress efter schemaläggningen. Öppna sidan och schemalägg igen." };
    return outcomeOfError(error);
  }
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The company's admins get one mail when an item fails (what goes wrong must reach a person by e-mail, 2026-10-26). */
async function notifyAdmins(item: ScheduleItem, reason: string) {
  const [{ mailConfig }, { sendSystemEmail }, { publicInstance }] = await Promise.all([import("@/lib/mail/settings-server"), import("@/lib/mail/mailer"), import("@/lib/instance")]);
  const config = await mailConfig();
  if (config.blockedReason) return;
  const admins = await prisma.organizationMember.findMany({ where: { organizationId: item.organizationId, isActive: true, role: { in: ["OWNER", "ADMIN"] }, user: { isActive: true } }, select: { user: { select: { email: true } } } });
  const what = item.kind === "post" ? `Inlägget ”${item.title || "utan rubrik"}”` : item.kind === "video" ? `Filmen ”${item.title || "utan titel"}”` : `Sidan ”${item.title || item.targetId}”`;
  const link = absoluteUrl(item.kind === "post" ? `/?view=company_posts&post=${encodeURIComponent(item.targetId)}`
    : item.kind === "video" ? `/?view=company_videos&video=${encodeURIComponent(item.targetId)}` : "/?view=company_website");
  const text = `${what} skulle publiceras ${when(item.runAt)} men kunde inte publiceras.\nOrsak: ${reason}\n\nÖppna och försök igen:\n${link}`;
  for (const admin of admins) {
    await sendSystemEmail({ to: admin.user.email, subject: `[${publicInstance().name}] Schemalagd publicering misslyckades`, text,
      html: `<p>${escape(what)} skulle publiceras ${escape(when(item.runAt))} men kunde inte publiceras.</p><p>Orsak: ${escape(reason)}</p><p><a href="${link}">Öppna och försök igen</a></p>` });
  }
}

export function realDeps(): ScheduleRunDeps {
  return {
    store: prismaStore,
    authorize,
    publish: (item, actorId) => {
      const actor = { userId: actorId, organizationId: item.organizationId };
      return item.kind === "website" ? publishWebsiteItem(item, actor) : item.kind === "video" ? publishVideoItem(item, actor) : publishPostItem(item, actor);
    },
    notify: notifyAdmins,
    audit: (item, detail) => audit({ userId: "system:schedule", organizationId: item.organizationId }, "schedule_run", detail),
  };
}

/** The job (npm run schedule:publish, every five minutes). */
export const runDueScheduled = (now = new Date()) => runDueWith(realDeps(), now);
