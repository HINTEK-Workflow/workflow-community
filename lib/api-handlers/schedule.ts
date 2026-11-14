import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, body, checkOrigin, failure, requireCloudWriteAccess } from "@/lib/kfid/server";
import { hitRateLimit, RATE_RULES } from "@/lib/security/rate-limit";
import { SCHEDULE_KINDS } from "@/lib/schedule/labels";
import { QUEUE_MAX } from "@/lib/schedule/rhythm";
import { SERIES_PERIODS } from "@/lib/schedule/series";
import { SERIES_PARTS_MAX, SERIES_PARTS_MIN } from "@/lib/schedule/post-series";
import { BODY_MAX, CAPTION_STORE_MAX, HASHTAG_STORE_MAX, HEADING_MAX } from "@/lib/meta/text";
import { approveScheduled, cancelItem, listScheduled, publishItemNow, removeItem, rescheduleItem, schedulePost, scheduleWebsite } from "@/lib/schedule/server";
import { actorOf, metaAdmin, noStore, type MetaContext } from "./meta";

/**
 * Schemalägg och innehållsserier (2026-11-11): the same people and checks as Publicera today – the signed-in person (or an
 * API key's member, with the same checks), an active membership in the active company, ADMIN or OWNER there and Cloud
 * (metaAdmin); on every change the app's Origin, the company's write access and the rate. Schemalägg, Godkänn, Publicera nu and
 * Schemalägg serien and Schemalägg i tur och ordning also need `confirm: true` (the page's confirmation card): the press is the admin's own approval.
 * Everything read or written is the active company's own.
 */
async function rate(ctx: MetaContext, kind: "change" | "read" | "publish") {
  const rule = kind === "change" ? RATE_RULES.metaChange : kind === "read" ? RATE_RULES.metaRead : RATE_RULES.metaPublish;
  const hit = await hitRateLimit(rule, `schedule-${kind}:${ctx.organizationId}`);
  if (!hit.allowed) throw new ApiError(429, "Många ändringar den senaste timmen. Vänta en stund.");
}

const id = z.string().min(1).max(40);
const at = z.string().max(20);

export async function GET(request: Request) {
  try {
    const ctx = await metaAdmin();
    const url = new URL(request.url);
    const series = url.searchParams.get("series");
    if (series) {
      const { getSeries, listSeries } = await import("@/lib/schedule/series-server");
      if (series === "all") return NextResponse.json({ series: await listSeries(ctx.organizationId) }, { headers: noStore });
      return NextResponse.json({ series: await getSeries(ctx.organizationId, id.parse(series)) }, { headers: noStore });
    }
    // Ny serie (2026-11-13): the rhythm and the times other posts already have, for the parts' times.
    if (url.searchParams.get("plan")) {
      const { getRhythm, takenPostTimes } = await import("@/lib/schedule/queue-server");
      const [rhythm, taken] = await Promise.all([getRhythm(ctx.organizationId), takenPostTimes(ctx.organizationId)]);
      return NextResponse.json({ rhythm, taken: taken.map((time) => time.toISOString()) }, { headers: noStore });
    }
    // Schemalägg i tur och ordning (2026-11-12): the drafts that wait, the rhythm and the times other posts already have.
    if (url.searchParams.get("queue")) {
      const { getRhythm, queueCandidates, takenPostTimes } = await import("@/lib/schedule/queue-server");
      const [candidates, rhythm, taken] = await Promise.all([queueCandidates(ctx.organizationId), getRhythm(ctx.organizationId), takenPostTimes(ctx.organizationId)]);
      return NextResponse.json({ candidates, rhythm, taken: taken.map((time) => time.toISOString()) }, { headers: noStore });
    }
    const kind = z.enum(SCHEDULE_KINDS).optional().parse(url.searchParams.get("kind") ?? undefined);
    const target = z.string().max(40).optional().parse(url.searchParams.get("target") ?? undefined);
    const { getRhythm } = await import("@/lib/schedule/queue-server");
    const [items, rhythm] = await Promise.all([listScheduled(ctx.organizationId, { kind, targetId: target }), getRhythm(ctx.organizationId)]);
    return NextResponse.json({ items, rhythm }, { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}

const seo = z.object({ title: z.string().max(400), description: z.string().max(1000), noindex: z.boolean(), image: z.number().int().min(0).max(1_000_000_000) });
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("schedule-post"), postId: id, at, confirm: z.literal(true) }),
  z.object({ action: z.literal("schedule-website"), pageId: z.number().int().positive().max(1_000_000_000), content: z.string().max(1_600_000), baseModified: z.string().min(1).max(40),
    seo: seo.nullable().optional(), seoBase: seo.nullable().optional(), at, confirm: z.literal(true) }),
  z.object({ action: z.literal("reschedule"), id, at }),
  z.object({ action: z.literal("cancel"), id }),
  // Ta bort ur listan (2026-11-13): a cancelled or failed item only; the draft stays.
  z.object({ action: z.literal("remove"), id }),
  z.object({ action: z.literal("approve"), id, confirm: z.literal(true) }),
  z.object({ action: z.literal("publish-now"), id, confirm: z.literal(true) }),
  z.object({ action: z.literal("series-create"), name: z.string().max(120), startDay: z.string().max(10), period: z.enum(SERIES_PERIODS.map((period) => period.key) as [string, ...string[]]),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7), time: z.string().max(5), channels: z.array(z.string().max(20)).min(1).max(5), themes: z.array(z.string().max(40)).max(100) }),
  z.object({ action: z.literal("series-theme"), seriesId: id, itemId: id, theme: z.string().max(40) }),
  z.object({ action: z.literal("series-ai"), seriesId: id, itemId: id }),
  z.object({ action: z.literal("series-schedule"), seriesId: id, confirm: z.literal(true) }),
  z.object({ action: z.literal("series-delete"), seriesId: id }),
  // Återkommande och kö (2026-11-12).
  z.object({ action: z.literal("rhythm-set"), weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7), time: z.string().max(5) }),
  // Ny serie (2026-11-13): ordinary posts with shared look and channels, each part scheduled at its time.
  z.object({ action: z.literal("series-posts"), name: z.string().max(120), template: z.string().max(20), logoVariant: z.string().max(20), logoSize: z.string().max(20),
    hashtags: z.string().max(HASHTAG_STORE_MAX + 500), toFacebook: z.boolean(), toInstagram: z.boolean(), toLinkedIn: z.boolean(),
    parts: z.array(z.object({ heading: z.string().max(HEADING_MAX + 50), body: z.string().max(BODY_MAX + 50), caption: z.string().max(CAPTION_STORE_MAX + 100), at })).min(SERIES_PARTS_MIN).max(SERIES_PARTS_MAX),
    confirm: z.literal(true) }),
  z.object({ action: z.literal("queue-schedule"), items: z.array(z.object({ postId: id, at })).min(1).max(QUEUE_MAX), fromDay: z.string().max(10).nullable().optional(), confirm: z.literal(true) }),
]);

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await metaAdmin();
    const input = requestSchema.parse(await body(request));
    await rate(ctx, input.action === "publish-now" ? "publish" : "change");
    await requireCloudWriteAccess(ctx);
    const actor = actorOf(ctx);
    const list = async () => ({ items: await listScheduled(ctx.organizationId) });
    switch (input.action) {
      case "schedule-post": { const item = await schedulePost(actor, input.postId, input.at); return NextResponse.json({ id: item.id, ...(await list()) }, { headers: noStore }); }
      case "schedule-website": {
        const { action: _action, at: when, confirm: _confirm, ...page } = input; void _action; void _confirm;
        const item = await scheduleWebsite(actor, { ...page, at: when });
        return NextResponse.json({ id: item.id, items: await listScheduled(ctx.organizationId, { kind: "website", targetId: String(input.pageId) }) }, { headers: noStore });
      }
      case "reschedule": await rescheduleItem(actor, input.id, input.at); return NextResponse.json(await list(), { headers: noStore });
      case "cancel": await cancelItem(actor, input.id); return NextResponse.json(await list(), { headers: noStore });
      case "remove": await removeItem(actor, input.id); return NextResponse.json(await list(), { headers: noStore });
      case "approve": await approveScheduled(actor, input.id); return NextResponse.json(await list(), { headers: noStore });
      case "publish-now": { const result = await publishItemNow(actor, input.id); return NextResponse.json({ ...result, ...(await list()) }, { headers: noStore }); }
      case "rhythm-set": { const { setRhythm } = await import("@/lib/schedule/queue-server"); return NextResponse.json({ rhythm: await setRhythm(actor, { weekdays: input.weekdays, time: input.time }) }, { headers: noStore }); }
      case "series-posts": {
        const { createPostSeries } = await import("@/lib/schedule/post-series-server");
        const { action: _action, confirm: _confirm, ...rest } = input; void _action; void _confirm;
        return NextResponse.json({ ...(await createPostSeries(actor, rest)), ...(await list()) }, { headers: noStore });
      }
      case "queue-schedule": { const { scheduleQueue } = await import("@/lib/schedule/queue-server"); return NextResponse.json({ ...(await scheduleQueue(actor, { items: input.items, fromDay: input.fromDay ?? null })), ...(await list()) }, { headers: noStore }); }
      default: break;
    }
    const series = await import("@/lib/schedule/series-server");
    switch (input.action) {
      case "series-create": {
        const { action: _action, ...rest } = input; void _action;
        return NextResponse.json({ series: await series.createSeries(actor, { ...rest, period: rest.period as never }) }, { headers: noStore });
      }
      case "series-theme": return NextResponse.json({ series: await series.setSeriesTheme(actor, input.seriesId, input.itemId, input.theme) }, { headers: noStore });
      case "series-ai": return NextResponse.json(await series.draftSeriesItem(actor, input.seriesId, input.itemId), { headers: noStore });
      case "series-schedule": return NextResponse.json(await series.scheduleSeries(actor, input.seriesId), { headers: noStore });
      case "series-delete": return NextResponse.json(await series.deleteSeries(actor, input.seriesId), { headers: noStore });
    }
    throw new ApiError(400, "Okänd åtgärd.");
  } catch (error) {
    return failure(error);
  }
}
