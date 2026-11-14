import { NextResponse } from "next/server";
import { z } from "zod";
import { body, checkOrigin, failure, requireCloudWriteAccess } from "@/lib/kfid/server";
import { createPost, deletePost, getPost, listPosts, logoAvailability, metaView, postImage, publishPost, renderImage, setPostBackground, updatePost } from "@/lib/meta/server";
import { ApiError } from "@/lib/kfid/server";
import { MAX_MEDIA_BYTES } from "@/lib/website/wp-client";
import { BODY_MAX, CAPTION_STORE_MAX, HASHTAG_STORE_MAX, HEADING_MAX, LINK_MAX } from "@/lib/meta/text";
import { linkedInView } from "@/lib/linkedin/server";
import { newsletterMailSchema } from "@/lib/mail/post-newsletter-mail";
import { actorOf, metaAdmin, metaRate, noStore } from "./meta";

/**
 * Inlägg (2026-11-10): the company's posts for Facebook and Instagram – drafts, the picture, Testpublicering and Publicera.
 * The same checks as the connection (lib/api-handlers/meta.ts): the company's admin, Cloud, and on every change the app's
 * Origin, write access and the rate. Publicera and Testpublicering also need `confirm: true` (the page's confirmation card)
 * and the company's own switch for publishing (lib/meta/server.ts); nothing is ever posted any other way.
 */
/**
 * Även som nyhetsbrev (2026-11-12): only for a person with Utskick (the installation's superadmin) – null for everyone else, so
 * the page never shows the choice; the server refuses the tick, Publicera and the preview for them as well.
 */
async function newsletterView(userId: string) {
  const { mayMailNewsletter, newsletterRecipientCount } = await import("@/lib/mail/post-newsletter");
  if (!(await mayMailNewsletter(userId))) return null;
  return { recipients: await newsletterRecipientCount() };
}

const jpeg = (bytes: Buffer) => new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
const id = z.string().min(1).max(40);

export async function GET(request: Request) {
  try {
    const ctx = await metaAdmin();
    const url = new URL(request.url);
    const image = url.searchParams.get("image");
    if (image) { await metaRate(ctx, "read"); return jpeg(await postImage(ctx.organizationId, id.parse(image))); }
    // Välj från webbplatsen: the newest pictures of the connected site's media library (shown through the app's own server).
    if (url.searchParams.get("media")) {
      await metaRate(ctx, "read");
      const { websiteMedia } = await import("@/lib/website/server");
      return NextResponse.json({ media: await websiteMedia(ctx.organizationId) }, { headers: noStore });
    }
    const one = url.searchParams.get("id");
    if (one) return NextResponse.json({ post: await getPost(ctx.organizationId, id.parse(one)) }, { headers: noStore });
    const [posts, connection, linkedin, newsletter, logos] = await Promise.all([listPosts(ctx.organizationId), metaView(ctx.organizationId), linkedInView(ctx.organizationId), newsletterView(ctx.user.id), logoAvailability(ctx.organizationId)]);
    return NextResponse.json({ posts, connection, linkedin, newsletter, logos }, { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}

const fields = {
  heading: z.string().max(HEADING_MAX + 50).optional(), body: z.string().max(BODY_MAX + 50).optional(), caption: z.string().max(CAPTION_STORE_MAX + 100).optional(), hashtags: z.string().max(HASHTAG_STORE_MAX + 500).optional(),
  link: z.string().max(LINK_MAX).nullable().optional(), template: z.string().max(20).optional(), toFacebook: z.boolean().optional(), toInstagram: z.boolean().optional(), toLinkedIn: z.boolean().optional(),
  toNewsletter: z.boolean().optional(), newsletterMail: newsletterMailSchema.nullable().optional(), toStory: z.boolean().optional(),
  logoVariant: z.string().max(20).optional(), logoSize: z.string().max(20).optional(),
};
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), ...fields }),
  z.object({ action: z.literal("update"), id, ...fields }),
  z.object({ action: z.literal("delete"), id }),
  // format story (2026-11-13): the 9:16 story picture.
  z.object({ action: z.literal("preview"), heading: z.string().max(HEADING_MAX + 50), body: z.string().max(BODY_MAX + 50), template: z.string().max(20), id: id.optional(), format: z.enum(["feed", "story"]).optional(),
    logoVariant: z.string().max(20).optional(), logoSize: z.string().max(20).optional() }),
  z.object({ action: z.literal("background"), id, url: z.string().trim().min(8).max(2000).nullable() }),
  z.object({ action: z.literal("publish"), id, mode: z.enum(["test", "live"]), confirm: z.literal(true) }),
  // Visa mejlet: the newsletter exactly as Publicera or the schedule would send it, and the recipients now.
  z.object({ action: z.literal("newsletter-preview"), id }),
]);

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await metaAdmin();
    // Ladda upp en bakgrund: a picture file with the post's id.
    if ((request.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
      await metaRate(ctx, "change");
      await requireCloudWriteAccess(ctx);
      if (Number(request.headers.get("content-length") ?? 0) > MAX_MEDIA_BYTES + 64 * 1024) throw new ApiError(413, "Bilden är för stor (högst 10 MB).");
      const form = await request.formData().catch(() => { throw new ApiError(400, "Ingen bild skickades."); });
      const file = form.get("file");
      const postId = id.parse(String(form.get("id") ?? ""));
      if (!(file instanceof File)) throw new ApiError(400, "Ingen bild skickades.");
      if (file.size > MAX_MEDIA_BYTES) throw new ApiError(413, "Bilden är för stor (högst 10 MB).");
      return NextResponse.json({ post: await setPostBackground(actorOf(ctx), postId, { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type }) }, { headers: noStore });
    }
    const input = requestSchema.parse(await body(request));
    await metaRate(ctx, input.action === "preview" || input.action === "newsletter-preview" ? "read" : input.action === "publish" ? "publish" : "change");
    if (input.action !== "preview" && input.action !== "newsletter-preview") await requireCloudWriteAccess(ctx);
    const actor = actorOf(ctx);
    switch (input.action) {
      case "create": { const { action: _create, ...rest } = input; void _create; return NextResponse.json({ post: await createPost(actor, rest) }, { headers: noStore }); }
      case "update": { const { action: _update, id: postId, ...rest } = input; void _update; return NextResponse.json({ post: await updatePost(actor, postId, rest) }, { headers: noStore }); }
      case "delete": return NextResponse.json(await deletePost(actor, input.id), { headers: noStore });
      case "preview": return jpeg(await renderImage(ctx.organizationId, input, input.id ?? null, input.format ?? "feed"));
      case "background": return NextResponse.json({ post: await setPostBackground(actor, input.id, input.url ? { url: input.url } : null) }, { headers: noStore });
      case "publish": return NextResponse.json(await publishPost(actor, input.id, input.mode), { headers: noStore });
      case "newsletter-preview": {
        const { previewPostNewsletter, requireNewsletterRight } = await import("@/lib/mail/post-newsletter");
        await requireNewsletterRight(actor.userId);
        const post = await getPost(ctx.organizationId, input.id);
        return NextResponse.json(await previewPostNewsletter(post, new Uint8Array(await postImage(ctx.organizationId, post.id))), { headers: noStore });
      }
    }
  } catch (error) {
    return failure(error);
  }
}
