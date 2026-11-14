import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { formatSwedish, toSwedishDateTimeInput } from "@/lib/swedish-time";
import { createPost, updatePost } from "@/lib/meta/server";
import { acceptedDraft, SERIES_DRAFT_INSTRUCTIONS, seriesDraftInput, seriesDraftSchema, type SeriesDraft } from "./ai-draft";
import { postChanged, schedulePost, type Actor } from "./server";
import { seriesEndDay, seriesPlanProblem, seriesSlots, SERIES_MAX_SLOTS, type SeriesPeriod } from "./series";
import { isThemeId, templateDraft, themeOf } from "./themes";

/**
 * Innehållsserie (2026-11-11) on the server: Ny serie makes one post per slot (a draft under Inlägg, with the theme's
 * text from the rules), Skriv med AI replaces one draft's text with Workflow AI's (facts only, lib/schedule/ai-draft.ts), Byt
 * tema gives a slot another theme, and Schemalägg serien schedules every draft at its slot – one approval for the series, each
 * item still its own in the list (Ändra tid, Avbryt, Publicera nu). The company's own: every row is the company's.
 */
export type SeriesInput = { name: string; startDay: string; period: SeriesPeriod; weekdays: number[]; time: string; channels: string[]; themes: string[] };

async function audit(actor: Actor, action: string, detail: string) {
  await prisma.administrationEvent.create({ data: { actorId: actor.userId, organizationId: actor.organizationId, action, detail: detail.slice(0, 500) } });
}

const CHANNELS = ["facebook", "instagram"] as const;

export async function createSeries(actor: Actor, input: SeriesInput) {
  const endDay = seriesEndDay(input.startDay, input.period);
  if (!endDay) throw new ApiError(400, "Välj en giltig startdag.");
  const plan = { startDay: input.startDay, endDay, weekdays: input.weekdays, time: input.time };
  const problem = seriesPlanProblem(plan);
  if (problem) throw new ApiError(400, problem);
  const slots = seriesSlots(plan);
  if (!slots.length) throw new ApiError(400, "Perioden har inga tider kvar. Välj en senare startdag.");
  if (input.themes.length !== slots.length || input.themes.some((theme) => !isThemeId(theme))) throw new ApiError(400, "Välj ett tema för varje tid.");
  const channels = input.channels.filter((channel) => (CHANNELS as readonly string[]).includes(channel));
  if (!channels.length) throw new ApiError(400, "Välj minst en kanal.");
  const series = await prisma.contentSeries.create({ data: {
    organizationId: actor.organizationId, name: input.name.trim().slice(0, 80) || "Serie", startDay: input.startDay, endDay, weekdays: [...new Set(input.weekdays)].sort(), time: input.time, channels, createdById: actor.userId,
  }, select: { id: true } });
  for (const [position, slot] of slots.slice(0, SERIES_MAX_SLOTS).entries()) {
    const theme = themeOf(input.themes[position])!;
    const post = await createPost(actor, { ...templateDraft(theme), toFacebook: channels.includes("facebook"), toInstagram: channels.includes("instagram") });
    await prisma.contentSeriesItem.create({ data: { seriesId: series.id, postId: post.id, slotAt: slot.at, theme: theme.id, position, textSource: "rules" } });
  }
  await audit(actor, "series_create", `Skapade innehållsserien ${input.name.trim().slice(0, 80) || "Serie"} med ${slots.length} utkast (${input.startDay} till ${endDay}).`);
  return getSeries(actor.organizationId, series.id);
}

async function seriesOf(organizationId: string, id: string) {
  const series = await prisma.contentSeries.findFirst({ where: { id, organizationId }, include: { items: { orderBy: { position: "asc" } } } });
  if (!series) throw new ApiError(404, "Serien finns inte.");
  return series;
}

export async function listSeries(organizationId: string) {
  const rows = await prisma.contentSeries.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, kind: true, name: true, startDay: true, endDay: true, _count: { select: { items: true } } } });
  return rows.map((row) => ({ id: row.id, kind: row.kind, name: row.name, startDay: row.startDay, endDay: row.endDay, items: row._count.items }));
}

export async function getSeries(organizationId: string, id: string) {
  const series = await seriesOf(organizationId, id);
  const postIds = series.items.map((item) => item.postId);
  const [posts, scheduled] = await Promise.all([
    prisma.socialPost.findMany({ where: { organizationId, id: { in: postIds } }, select: { id: true, heading: true, status: true } }),
    prisma.scheduledPublish.findMany({ where: { organizationId, kind: "post", targetId: { in: postIds }, status: { in: ["scheduled", "needs_approval", "running", "published", "failed"] } }, orderBy: { createdAt: "desc" }, select: { id: true, targetId: true, status: true, runAt: true } }),
  ]);
  const postOf = new Map(posts.map((post) => [post.id, post]));
  const scheduleOf = new Map<string, (typeof scheduled)[number]>();
  for (const item of scheduled) if (!scheduleOf.has(item.targetId)) scheduleOf.set(item.targetId, item);
  return {
    id: series.id, kind: (series.kind === "queue" || series.kind === "posts" ? series.kind : "themes") as "queue" | "posts" | "themes", name: series.name, startDay: series.startDay, endDay: series.endDay, weekdays: series.weekdays, time: series.time, channels: series.channels,
    items: series.items.filter((item) => postOf.has(item.postId)).map((item) => {
      const schedule = scheduleOf.get(item.postId);
      return { id: item.id, postId: item.postId, slotAt: item.slotAt.toISOString(), theme: item.theme, textSource: item.textSource as "rules" | "ai" | "own",
        heading: postOf.get(item.postId)!.heading, postStatus: postOf.get(item.postId)!.status,
        schedule: schedule ? { id: schedule.id, status: schedule.status, runAt: schedule.runAt.toISOString() } : null };
    }),
  };
}
export type SeriesView = Awaited<ReturnType<typeof getSeries>>;

async function itemOf(actor: Actor, seriesId: string, itemId: string) {
  const series = await seriesOf(actor.organizationId, seriesId);
  const item = series.items.find((entry) => entry.id === itemId);
  if (!item) throw new ApiError(404, "Inlägget finns inte i serien.");
  return { series, item };
}

/** Byt tema: the slot's theme and the rules' text for it (the person may then ask Workflow AI for a draft). */
export async function setSeriesTheme(actor: Actor, seriesId: string, itemId: string, themeId: string) {
  const theme = themeOf(themeId);
  if (!theme) throw new ApiError(400, "Okänt tema.");
  const { series, item } = await itemOf(actor, seriesId, itemId);
  if (series.kind !== "themes") throw new ApiError(409, "Inläggen i serien har egna texter.");
  await updatePost(actor, item.postId, templateDraft(theme));
  await prisma.contentSeriesItem.update({ where: { id: item.id }, data: { theme: theme.id, textSource: "rules" } });
  return getSeries(actor.organizationId, seriesId);
}

/**
 * Skriv med AI: Workflow AI writes a draft for the slot from the theme's facts only. Everything an AI call must pass (the server's
 * provider, the company's AI switch, EU, the rate and the credits) is in runStructuredAgent; a refusal is a reason, and the rules'
 * text stays. The model gets no company data – only the product's own facts – so no sharing choice beyond AI on is needed.
 */
export async function draftSeriesItem(actor: Actor, seriesId: string, itemId: string): Promise<{ series: SeriesView; source: "ai" | "rules"; reason: string | null }> {
  const { series, item } = await itemOf(actor, seriesId, itemId);
  if (series.kind !== "themes") throw new ApiError(409, "Inläggen i serien har egna texter.");
  const theme = themeOf(item.theme);
  if (!theme) throw new ApiError(400, "Okänt tema.");
  const { runStructuredAgent } = await import("@/lib/ai/agent-run");
  const outcome = await runStructuredAgent<SeriesDraft>({
    organizationId: actor.organizationId, actorId: actor.userId, agentId: "workflow-writer", taskKind: "WRITING", surface: "post-series",
    subject: { type: "SOCIAL_POST", id: item.postId }, requestKey: `series-draft:${item.postId}:${randomUUID()}`,
    instructions: SERIES_DRAFT_INSTRUCTIONS, input: seriesDraftInput(theme, series.channels), schema: seriesDraftSchema, schemaName: "hintek_series_post",
    shared: () => true, maxOutputTokens: 800,
  }).catch(() => ({ used: false as const, reason: "Workflow AI kunde inte skriva utkastet." }));
  if (!outcome.used) return { series: await getSeries(actor.organizationId, seriesId), source: "rules", reason: outcome.reason };
  const accepted = acceptedDraft(outcome.output, theme);
  await updatePost(actor, item.postId, accepted.text);
  await prisma.contentSeriesItem.update({ where: { id: item.id }, data: { textSource: accepted.source } });
  await audit(actor, "series_ai_draft", `Workflow AI skrev ett utkast till serieinlägget (id ${item.postId})${accepted.source === "rules" ? "; regelns text användes" : ""}.`);
  return { series: await getSeries(actor.organizationId, seriesId), source: accepted.source,
    reason: accepted.problems.length ? `AI-texten hade ${accepted.problems.join(", ")}. Temats egen text används.` : null };
}

/**
 * Schemalägg serien: one press approves every draft of the series as it is now, each at its slot (a slot that has passed is
 * left out). Drafts already scheduled keep their item. Returns how many were scheduled and why any were not.
 */
export async function scheduleSeries(actor: Actor, seriesId: string) {
  const view = await getSeries(actor.organizationId, seriesId);
  let scheduled = 0;
  const skipped: string[] = [];
  for (const item of view.items) {
    if (item.postStatus === "published" || (item.schedule && ["scheduled", "needs_approval", "running", "published"].includes(item.schedule.status))) continue;
    const at = new Date(item.slotAt);
    if (at.getTime() < Date.now() + 120_000) { skipped.push(`${formatSwedish(at, { dateStyle: "medium", timeStyle: "short" })}: tiden har passerat`); continue; }
    try { await schedulePost(actor, item.postId, toSwedishDateTimeInput(at), { seriesId }); scheduled += 1; }
    catch (error) { skipped.push(`${item.heading || "Utan rubrik"}: ${error instanceof Error ? error.message : "kunde inte schemaläggas"}`); }
  }
  await audit(actor, "series_schedule", `Schemalade innehållsserien ${view.name}: ${scheduled} inlägg${skipped.length ? `, ${skipped.length} inte` : ""}.`);
  return { series: await getSeries(actor.organizationId, seriesId), scheduled, skipped };
}

/**
 * Ta bort serien: the drafts that are not published go, and their schedules are cancelled; published posts stay under Inlägg.
 * A queue (2026-11-12) holds the company's own drafts: Ta bort kön only cancels their schedules, and the drafts stay.
 */
export async function deleteSeries(actor: Actor, seriesId: string) {
  const series = await seriesOf(actor.organizationId, seriesId);
  const postIds = series.items.map((item) => item.postId);
  const running = await prisma.scheduledPublish.count({ where: { organizationId: actor.organizationId, kind: "post", targetId: { in: postIds }, status: "running" } });
  if (running) throw new ApiError(409, "Ett inlägg i serien publiceras just nu. Försök igen om en stund.");
  // Ny serie (2026-11-13) holds ordinary posts the admin wrote: like a queue, the drafts stay.
  if (series.kind === "queue" || series.kind === "posts") {
    const cancelled = await prisma.scheduledPublish.updateMany({ where: { organizationId: actor.organizationId, seriesId: series.id, status: { in: ["scheduled", "needs_approval"] } },
      data: { status: "cancelled", cancelledById: actor.userId, cancelledAt: new Date(), result: "Kön togs bort. Utkastet finns kvar." } });
    await prisma.scheduledPublish.updateMany({ where: { organizationId: actor.organizationId, seriesId: series.id }, data: { seriesId: null } });
    await prisma.contentSeries.deleteMany({ where: { id: series.id, organizationId: actor.organizationId } });
    await audit(actor, "series_delete", `Tog bort ${series.kind === "queue" ? "kön" : "serien"} ${series.name}; ${cancelled.count} schemalagda inlägg avbröts, utkasten finns kvar.`);
    return { ok: true };
  }
  const drafts = await prisma.socialPost.findMany({ where: { organizationId: actor.organizationId, id: { in: postIds }, status: { in: ["draft", "failed"] } }, select: { id: true } });
  for (const post of drafts) await postChanged(actor.organizationId, post.id, true);
  await prisma.socialPost.deleteMany({ where: { organizationId: actor.organizationId, id: { in: drafts.map((post) => post.id) }, status: { in: ["draft", "failed"] } } });
  // The schedule's history stays under Schemalagt without the series.
  await prisma.scheduledPublish.updateMany({ where: { organizationId: actor.organizationId, seriesId: series.id }, data: { seriesId: null } });
  await prisma.contentSeries.deleteMany({ where: { id: series.id, organizationId: actor.organizationId } });
  await audit(actor, "series_delete", `Tog bort innehållsserien ${series.name} och ${drafts.length} utkast.`);
  return { ok: true };
}
