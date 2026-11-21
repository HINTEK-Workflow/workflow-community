import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { formatSwedish, fromSwedishDateTimeInput, swedishDayKey } from "@/lib/swedish-time";
import { createPost } from "@/lib/meta/server";
import { isLogoPlate, isLogoSize, isLogoVariant, isTemplate, normalizeHashtags } from "@/lib/meta/text";
import { seriesProblem, type SeriesPart, type SeriesShared } from "./post-series";
import { getRhythm } from "./queue-server";
import { postScheduleProblem, schedulePost, type Actor } from "./server";

/**
 * Ny serie (2026-11-13) on the server: the admin's series of ordinary posts – one draft per part with the shared template,
 * logo, hashtags and channels and the part's own texts – each scheduled at its time with the same Schemalägg as one post (its own
 * item under Schemalagt: Ändra tid, Godkänn, Publicera nu, Avbryt). Everything is checked before anything is made: the texts and
 * times of every part (a time that has passed is refused) and the company's publishing switch and connection. The series is kept
 * as a content series of the kind "posts", so it opens and is listed like a queue; each post is the company's own and can be
 * edited, moved or removed on its own afterwards.
 */
export type PostSeriesInput = SeriesShared & { name: string; parts: SeriesPart[] };

async function audit(actor: Actor, action: string, detail: string) {
  await prisma.administrationEvent.create({ data: { actorId: actor.userId, organizationId: actor.organizationId, action, detail: detail.slice(0, 500) } });
}

export async function createPostSeries(actor: Actor, input: PostSeriesInput) {
  if (!isTemplate(input.template)) throw new ApiError(400, "Okänd mall.");
  if (!isLogoVariant(input.logoVariant)) throw new ApiError(400, "Okänd logga.");
  if (!isLogoSize(input.logoSize)) throw new ApiError(400, "Okänd storlek på loggan.");
  if (input.logoPlate != null && !isLogoPlate(input.logoPlate)) throw new ApiError(400, "Okänd bakgrund bakom loggan.");
  const shared: SeriesShared = { ...input, hashtags: normalizeHashtags(input.hashtags) };
  const problem = seriesProblem(shared, input.parts);
  if (problem) throw new ApiError(400, problem.message);
  // The company's switch and connection, as for one post (the first part stands for all: they share the channels).
  const first = input.parts[0];
  const connection = await postScheduleProblem(actor.organizationId, {
    id: "", status: "draft", heading: first.heading, body: first.body, caption: first.caption, hashtags: shared.hashtags, link: null, template: shared.template,
    logoVariant: shared.logoVariant, logoSize: shared.logoSize, logoPlate: shared.logoPlate ?? null, toFacebook: shared.toFacebook, toInstagram: shared.toInstagram, toNewsletter: false, newsletterMail: null,
    toStory: false, backgroundSource: null, background: null, instagramText: "", campaignLinks: true, aiGenerated: false, images: [], ...({ toLinkedIn: shared.toLinkedIn } as object),
  });
  if (connection) throw new ApiError(409, connection);
  const times = input.parts.map((part) => fromSwedishDateTimeInput(part.at)!);
  const sorted = [...times].sort((left, right) => left.getTime() - right.getTime());
  const rhythm = await getRhythm(actor.organizationId);
  const name = input.name.trim().slice(0, 80) || `Serie ${formatSwedish(new Date(), { day: "numeric", month: "long" })}`;
  const channels = [shared.toFacebook ? "facebook" : null, shared.toInstagram ? "instagram" : null, shared.toLinkedIn ? "linkedin" : null].filter((value): value is string => Boolean(value));
  const series = await prisma.contentSeries.create({ data: {
    organizationId: actor.organizationId, kind: "posts", name, startDay: swedishDayKey(sorted[0]), endDay: swedishDayKey(sorted[sorted.length - 1]),
    weekdays: rhythm.weekdays, time: rhythm.time, channels, createdById: actor.userId,
  }, select: { id: true } });
  let scheduled = 0;
  const skipped: string[] = [];
  for (const [position, part] of input.parts.entries()) {
    try {
      const post = await createPost(actor, { heading: part.heading, body: part.body, caption: part.caption, hashtags: shared.hashtags, link: null, template: shared.template,
        logoVariant: shared.logoVariant, logoSize: shared.logoSize, logoPlate: shared.logoPlate, toFacebook: shared.toFacebook, toInstagram: shared.toInstagram, toLinkedIn: shared.toLinkedIn });
      await prisma.contentSeriesItem.create({ data: { seriesId: series.id, postId: post.id, slotAt: times[position], theme: "egen", position, textSource: "own" } });
      await schedulePost(actor, post.id, part.at, { seriesId: series.id });
      scheduled += 1;
    } catch (error) { skipped.push(`Del ${position + 1}: ${error instanceof Error ? error.message : "kunde inte schemaläggas"}`); }
  }
  await audit(actor, "series_posts", `Skapade serien ${name} med ${input.parts.length} inlägg; ${scheduled} schemalagda${skipped.length ? `, ${skipped.length} inte` : ""}.`);
  return { seriesId: series.id, scheduled, skipped };
}
