import { NextResponse } from "next/server";
import { ApiError, checkOrigin, failure, requireCloudWriteAccess } from "@/lib/kfid/server";
import { uploadWebsiteImage, websiteImage } from "@/lib/website/server";
import { imageSignature, MAX_MEDIA_BYTES, MEDIA_TYPES } from "@/lib/website/wp-client";
import { websiteAdmin, websiteRate } from "./website";

/**
 * Min webbsida:s bilder (2026-11-10; one site 2026-11-09): POST uploads a picture to the company's media library (a new image,
 * a cover's background); GET shows a picture on the company's own site in the editor's preview – the app's pages show only
 * their own server's pictures, so the server fetches it, from that company's site only, and hands it on with its type. The
 * company's admin only, like the rest of the page.
 */
export async function GET(request: Request) {
  try {
    const ctx = await websiteAdmin();
    const address = new URL(request.url).searchParams.get("url") ?? "";
    if (!address || address.length > 2000) throw new ApiError(400, "Bildens adress saknas.");
    await websiteRate(ctx, "read");
    const image = await websiteImage(ctx.organizationId, address);
    return new NextResponse(new Uint8Array(image.bytes), { headers: { "Content-Type": image.type, "Cache-Control": "private, max-age=600", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await websiteAdmin();
    await websiteRate(ctx, "change");
    await requireCloudWriteAccess(ctx);
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > MAX_MEDIA_BYTES + 64 * 1024) throw new ApiError(413, "Bilden är för stor (högst 10 MB).");
    const form = await request.formData().catch(() => { throw new ApiError(400, "Ingen bild skickades."); });
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "Ingen bild skickades.");
    if (!MEDIA_TYPES[file.type]) throw new ApiError(400, "Bara PNG, JPEG, WebP och GIF kan laddas upp.");
    if (file.size > MAX_MEDIA_BYTES) throw new ApiError(413, "Bilden är för stor (högst 10 MB).");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!imageSignature(bytes, file.type)) throw new ApiError(400, "Filen är inte en bild av den typen.");
    return NextResponse.json(await uploadWebsiteImage({ userId: ctx.user.id, organizationId: ctx.organizationId }, { bytes, name: file.name.slice(0, 120), type: file.type }), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

