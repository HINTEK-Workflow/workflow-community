import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, body, checkOrigin, failure, requireCloudWriteAccess, requireModule } from "@/lib/kfid/server";
import { readLimitedUpload } from "@/lib/security/limited-body";
import { DESCRIPTION_MAX_BYTES, PRIVACY_KEYS, TAG_MAX, TAGS_MAX_COUNT, THUMBNAIL_MAX_BYTES, TITLE_MAX, VIDEO_CHUNK_BYTES } from "@/lib/youtube/model";
import { youTubePublishBlock, youTubeView } from "@/lib/youtube/server";
import {
  cancelVideoUpload, createVideo, deleteVideoFromWorkflow, getVideoView, linkableVideos, listVideos, removeVideoFromYouTube, retryVideoUpload, setVideoThumbnail,
  startVideoPublish, storeVideoPiece, updateVideo, videoLimits, videoThumbnail,
} from "@/lib/youtube/videos-server";
import { actorOf, noStore, youTubeAdmin, youTubeRate } from "./youtube";

/**
 * Filmer (2026-11-20): Mer → Webb och inlägg → Filmer. The same people and checks as Inlägg: the company's admin, Cloud, and on
 * every change the app's Origin, write access, the module Webb och inlägg and the rate (the film's pieces their own, higher
 * ceiling). Publicera and Ta bort från YouTube also need `confirm: true` (the page's confirmation card) and the company's own
 * switch for publishing; nothing goes to YouTube any other way. No token and no upload address ever reaches the page, and the
 * browser never talks to Google: the film goes to our own server in pieces and on to YouTube from there.
 */
const id = z.string().min(1).max(40);
const whole = (value: FormDataEntryValue | null) => (typeof value === "string" && /^\d{1,13}$/.test(value) ? Number(value) : NaN);

export async function GET(request: Request) {
  try {
    const ctx = await youTubeAdmin();
    const url = new URL(request.url);
    // The cover picture from our own server (the page never loads anything from YouTube).
    const thumbnail = url.searchParams.get("thumbnail");
    if (thumbnail) {
      await youTubeRate(ctx, "read");
      const image = await videoThumbnail(ctx.organizationId, id.parse(thumbnail));
      if (!image) throw new ApiError(404, "Bilden finns inte.");
      return new Response(new Uint8Array(image.bytes), { headers: { "Content-Type": image.type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    }
    // Inlägg: the published films a post may link to.
    if (url.searchParams.get("linkable")) return NextResponse.json({ videos: await linkableVideos(ctx.organizationId) }, { headers: noStore });
    const one = url.searchParams.get("id");
    if (one) return NextResponse.json({ video: await getVideoView(ctx.organizationId, id.parse(one)) }, { headers: noStore });
    const [videos, connection, block] = await Promise.all([listVideos(ctx.organizationId), youTubeView(ctx.organizationId), youTubePublishBlock(ctx.organizationId)]);
    return NextResponse.json({
      videos, block, limits: videoLimits(),
      // Only what the page needs of the connection: the channel, its playlists and the categories, and Google's audit.
      connection: { status: connection.status, statusMessage: connection.statusMessage, channel: connection.channel, playlists: connection.playlists, categories: connection.categories, privateLocked: connection.privateLocked, publishingApproved: connection.publishingApproved },
    }, { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}

const fields = {
  title: z.string().max(TITLE_MAX + 50).optional(),
  description: z.string().max(DESCRIPTION_MAX_BYTES + 100).optional(),
  tags: z.array(z.string().max(TAG_MAX + 20)).max(TAGS_MAX_COUNT + 10).optional(),
  categoryId: z.string().max(4).nullable().optional(),
  privacy: z.enum(PRIVACY_KEYS).optional(),
  madeForKids: z.boolean().nullable().optional(),
  playlistId: z.string().max(64).nullable().optional(),
};
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create") }),
  z.object({ action: z.literal("update"), id, ...fields }),
  z.object({ action: z.literal("publish"), id, confirm: z.literal(true) }),
  z.object({ action: z.literal("retry"), id }),
  z.object({ action: z.literal("cancel-upload"), id }),
  z.object({ action: z.literal("thumbnail-remove"), id }),
  z.object({ action: z.literal("remove-youtube"), id, confirm: z.literal(true) }),
  z.object({ action: z.literal("delete"), id }),
]);

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await youTubeAdmin();
    // A piece of the film or a cover picture: multipart with the film's id.
    if ((request.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
      // Read with a ceiling: one piece of 8 MB and the form's fields, also without Content-Length.
      const form = await readLimitedUpload(request, VIDEO_CHUNK_BYTES + 200_000, { tooLarge: "Delen är för stor.", notAForm: "Ingen fil skickades." });
      const kind = form.get("kind");
      await youTubeRate(ctx, kind === "piece" ? "upload" : "change");
      await requireCloudWriteAccess(ctx);
      requireModule(ctx, "web_posts");
      const videoId = id.parse(String(form.get("id") ?? ""));
      const file = form.get("file");
      if (!(file instanceof File)) throw new ApiError(400, "Ingen fil skickades.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (kind === "piece") {
        const upload = form.get("upload");
        const name = form.get("name");
        return NextResponse.json(await storeVideoPiece(actorOf(ctx), videoId, {
          upload: typeof upload === "string" ? upload : "", offset: whole(form.get("offset")), total: whole(form.get("total")), bytes, name: typeof name === "string" ? name : "",
        }), { headers: noStore });
      }
      if (kind === "thumbnail") {
        if (bytes.byteLength > THUMBNAIL_MAX_BYTES) throw new ApiError(413, "Omslagsbilden får vara högst 2 MB.");
        const source = form.get("source") === "frame" ? "frame" : "own";
        return NextResponse.json({ video: await setVideoThumbnail(actorOf(ctx), videoId, { bytes, source }) }, { headers: noStore });
      }
      throw new ApiError(400, "Okänd sorts fil.");
    }
    const input = requestSchema.parse(await body(request));
    await youTubeRate(ctx, input.action === "publish" || input.action === "retry" ? "publish" : "change");
    await requireCloudWriteAccess(ctx);
    // Webb och inlägg: nothing new while the module is off; a running upload can always be stopped and a film removed.
    if (input.action !== "cancel-upload" && input.action !== "delete") requireModule(ctx, "web_posts");
    const actor = actorOf(ctx);
    switch (input.action) {
      case "create": return NextResponse.json({ video: await createVideo(actor) }, { headers: noStore });
      case "update": { const { action: _update, id: videoId, ...rest } = input; void _update; return NextResponse.json({ video: await updateVideo(actor, videoId, rest) }, { headers: noStore }); }
      case "publish": return NextResponse.json({ video: await startVideoPublish(actor, input.id) }, { headers: noStore });
      case "retry": return NextResponse.json({ video: await retryVideoUpload(actor, input.id) }, { headers: noStore });
      case "cancel-upload": return NextResponse.json({ video: await cancelVideoUpload(actor, input.id) }, { headers: noStore });
      case "thumbnail-remove": return NextResponse.json({ video: await setVideoThumbnail(actor, input.id, null) }, { headers: noStore });
      case "remove-youtube": return NextResponse.json({ video: await removeVideoFromYouTube(actor, input.id) }, { headers: noStore });
      case "delete": return NextResponse.json(await deleteVideoFromWorkflow(actor, input.id), { headers: noStore });
    }
  } catch (error) {
    return failure(error);
  }
}
