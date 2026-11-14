import { NextResponse } from "next/server";
import { ApiError, checkOrigin, context, failure, requireCloudStorage, requireCloudWriteAccess, requireModule } from "@/lib/kfid/server";
import { remove, store } from "@/lib/kfid/storage";
import { MAX_ATTACHMENT_BYTES, prepareAttachmentFile } from "@/lib/workflow/attachment-file";
import { readLimitedFormData } from "@/lib/security/limited-body";
import { addImage, callerOf, requireImageUpload } from "@/lib/maintenance/server";

export const dynamic = "force-dynamic";

/**
 * Bilder på maskindelar (Underhåll, 2026-10-30): the company's own pictures, handled like a deviation's photos
 * (app/api/self-inspection/deviation-photos: 10 MB, turned upright, made JPEG, the bytes private in lib/kfid/storage.ts).
 * Only pictures; who may add one: lib/maintenance/server.ts (the module's edit right).
 */
export async function POST(request: Request) {
  let storagePath: string | undefined;
  try {
    checkOrigin(request);
    const ctx = await context();
    requireCloudStorage(ctx);
    await requireCloudWriteAccess(ctx);
    requireModule(ctx, "upkeep");
    if (Number(request.headers.get("content-length")) > 12_000_000) throw new ApiError(413, "Maximal filstorlek är 10 MB.");
    const form = await readLimitedFormData(request, 12_000_000);
    const partId = String(form.get("partId") || "").slice(0, 120);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > MAX_ATTACHMENT_BYTES) throw new ApiError(400, "Välj en bild på högst 10 MB.");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new ApiError(400, "Välj en bild (JPG, PNG eller WebP).");
    const caller = callerOf(ctx);
    const part = await requireImageUpload(caller, partId);
    const { buffer, mimeType, extension } = await prepareAttachmentFile(file);
    storagePath = await store(buffer, extension);
    const created = await addImage(caller, part.id, { filename: file.name.slice(0, 200) || "bild.jpg", storagePath, mimeType, size: buffer.length });
    return NextResponse.json(created);
  } catch (error) {
    if (storagePath) await remove(storagePath);
    return failure(error);
  }
}
