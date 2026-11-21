import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { formatSwedish, swedishDayKey, toSwedishDateTimeInput } from "@/lib/swedish-time";
import { ACTIVE_STATUSES } from "./labels";
import { DEFAULT_RHYTHM, normalizeRhythm, confirmQueue, QUEUE_MAX, rhythmProblem, rhythmText, SLOT_GAP_MS, type Rhythm } from "./rhythm";
import { postOf, postScheduleProblem, schedulePost, type Actor } from "./server";

/**
 * Återkommande och kö (2026-11-12) on the server: the company's publishing rhythm, the drafts that wait, and Schemalägg i
 * tur och ordning – the chosen drafts in the admin's order, each at the rhythm's next free time, approved in one press like
 * Schemalägg serien (the same Schemalägg for every post: its content's hash, its own item under Schemalagt). The queue is kept as
 * a content series of the kind "queue", so it opens, is listed and cancelled like a series. Every row is the company's own.
 */
async function audit(actor: Actor, action: string, detail: string) {
  await prisma.administrationEvent.create({ data: { actorId: actor.userId, organizationId: actor.organizationId, action, detail: detail.slice(0, 500) } });
}

export async function getRhythm(organizationId: string): Promise<Rhythm> {
  const row = await prisma.postingRhythm.findUnique({ where: { organizationId }, select: { weekdays: true, time: true } });
  return row && !rhythmProblem(row) ? normalizeRhythm(row) : DEFAULT_RHYTHM;
}

export async function setRhythm(actor: Actor, input: Rhythm): Promise<Rhythm> {
  const problem = rhythmProblem(input);
  if (problem) throw new ApiError(400, problem);
  const rhythm = normalizeRhythm(input);
  await prisma.postingRhythm.upsert({ where: { organizationId: actor.organizationId }, create: { organizationId: actor.organizationId, ...rhythm, updatedById: actor.userId }, update: { ...rhythm, updatedById: actor.userId } });
  await audit(actor, "schedule_rhythm", `Ändrade publiceringsrytmen till ${rhythmText(rhythm)}.`);
  return rhythm;
}

/** The times other posts are planned for (scheduled, waiting for approval or publishing now): a new post never shares their slot. */
export async function takenPostTimes(organizationId: string): Promise<Date[]> {
  const rows = await prisma.scheduledPublish.findMany({ where: { organizationId, kind: "post", status: { in: [...ACTIVE_STATUSES] }, runAt: { gte: new Date(Date.now() - SLOT_GAP_MS) } }, select: { runAt: true }, orderBy: { runAt: "asc" }, take: 500 });
  return rows.map((row) => row.runAt);
}

export type QueueCandidate = { id: string; heading: string; channels: string[]; updatedAt: string; problem: string | null };

/** The drafts that wait: not published, not scheduled and not part of a series; each with why it cannot be scheduled, if so. */
export async function queueCandidates(organizationId: string): Promise<QueueCandidate[]> {
  const posts = await prisma.socialPost.findMany({ where: { organizationId, status: { in: ["draft", "failed"] } }, orderBy: { createdAt: "asc" }, take: 200, select: { id: true, updatedAt: true, toLinkedIn: true } });
  const ids = posts.map((post) => post.id);
  const [active, inSeries] = await Promise.all([
    prisma.scheduledPublish.findMany({ where: { organizationId, kind: "post", targetId: { in: ids }, status: { in: [...ACTIVE_STATUSES] } }, select: { targetId: true } }),
    prisma.contentSeriesItem.findMany({ where: { postId: { in: ids }, series: { organizationId } }, select: { postId: true } }),
  ]);
  const busy = new Set([...active.map((row) => row.targetId), ...inSeries.map((row) => row.postId)]);
  const result: QueueCandidate[] = [];
  for (const row of posts.filter((entry) => !busy.has(entry.id))) {
    const post = await postOf(organizationId, row.id);
    if (!post) continue;
    const channels = [post.toFacebook ? "facebook" : null, post.toInstagram ? "instagram" : null, row.toLinkedIn ? "linkedin" : null].filter((value): value is string => Boolean(value));
    result.push({ id: row.id, heading: post.heading, channels, updatedAt: row.updatedAt.toISOString(), problem: await postScheduleProblem(organizationId, post) });
  }
  return result;
}

export type QueueInput = { items: { postId: string; at: string }[]; fromDay?: string | null };

/**
 * Schemalägg i tur och ordning: the server spreads the drafts again from the rhythm and the taken times; the times must be the
 * ones the admin saw (otherwise nothing is scheduled and the page shows the new times). Every draft is checked first, so either
 * all are scheduled or none – unless one fails on the way, which is then named.
 */
export async function scheduleQueue(actor: Actor, input: QueueInput) {
  if (!input.items.length) throw new ApiError(400, "Välj minst ett inlägg.");
  if (input.items.length > QUEUE_MAX) throw new ApiError(400, `Välj högst ${QUEUE_MAX} inlägg åt gången.`);
  const postIds = input.items.map((item) => item.postId);
  const candidates = new Map((await queueCandidates(actor.organizationId)).map((candidate) => [candidate.id, candidate]));
  for (const postId of postIds) {
    const candidate = candidates.get(postId);
    if (!candidate) throw new ApiError(409, "Ett av inläggen är redan schemalagt, publicerat eller borttaget. Ladda om sidan.");
    if (candidate.problem) throw new ApiError(409, `${candidate.heading || "Utan rubrik"}: ${candidate.problem}`);
  }
  const rhythm = await getRhythm(actor.organizationId);
  const plan = confirmQueue(input.items, rhythm, { taken: await takenPostTimes(actor.organizationId), fromDay: input.fromDay ?? null });
  if ("error" in plan) throw new ApiError(409, plan.error);
  const channels = [...new Set(postIds.flatMap((postId) => candidates.get(postId)?.channels ?? []))];
  const first = plan[0].at, last = plan[plan.length - 1].at;
  const name = `Kö ${formatSwedish(new Date(), { day: "numeric", month: "long" })}`;
  const series = await prisma.contentSeries.create({ data: {
    organizationId: actor.organizationId, kind: "queue", name, startDay: swedishDayKey(first), endDay: swedishDayKey(last), weekdays: rhythm.weekdays, time: rhythm.time, channels, createdById: actor.userId,
  }, select: { id: true } });
  let scheduled = 0;
  const skipped: string[] = [];
  for (const [position, entry] of plan.entries()) {
    const heading = candidates.get(entry.postId)?.heading || "Utan rubrik";
    try {
      await prisma.contentSeriesItem.create({ data: { seriesId: series.id, postId: entry.postId, slotAt: entry.at, theme: "egen", position, textSource: "own" } });
      await schedulePost(actor, entry.postId, toSwedishDateTimeInput(entry.at), { seriesId: series.id });
      scheduled += 1;
    } catch (error) { skipped.push(`${heading}: ${error instanceof Error ? error.message : "kunde inte schemaläggas"}`); }
  }
  await audit(actor, "queue_schedule", `Schemalade ${scheduled} inlägg i tur och ordning (${rhythmText(rhythm)})${skipped.length ? `, ${skipped.length} inte` : ""}.`);
  return { seriesId: series.id, scheduled, skipped };
}
