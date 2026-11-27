import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, checkOrigin, context, failure, requireCloudStorage, requireCloudWriteAccess } from "@/lib/kfid/server";
import { remove, store } from "@/lib/kfid/storage";
import { MAX_ATTACHMENT_BYTES, prepareAttachmentFile } from "@/lib/workflow/attachment-file";
import { readLimitedFormData } from "@/lib/security/limited-body";
import { requirePhotoUpload } from "@/lib/self-inspection/deviation-photos-server";

export const dynamic = "force-dynamic";

/**
 * Bilder på avvikelser (2026-10-30): one photo on a log entry, "BEFORE" when it is reported or "AFTER" when it is
 * marked done. The same handling and limits as a work order's attachments (lib/workflow/attachment-file.ts: 10 MB, turned
 * upright, made JPEG; the bytes private in lib/kfid/storage.ts) – but only pictures. Who may add one: ./deviation-photos-server.ts.
 */
export async function POST(request: Request) {
  let storagePath: string | undefined;
  try {
    checkOrigin(request);
    const ctx = await context();
    requireCloudStorage(ctx);
    await requireCloudWriteAccess(ctx);
    if (Number(request.headers.get("content-length")) > 12_000_000) throw new ApiError(413, "Filen får vara högst 10 MB.");
    const form = await readLimitedFormData(request, 12_000_000);
    const deviationId = String(form.get("deviationId") || "").slice(0, 120);
    const phase = form.get("phase") === "AFTER" ? "AFTER" as const : "BEFORE" as const;
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > MAX_ATTACHMENT_BYTES) throw new ApiError(400, "Välj en bild på högst 10 MB.");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new ApiError(400, "Välj en bild (JPG, PNG eller WebP).");
    const entry = await requirePhotoUpload(ctx, deviationId, phase);
    const { buffer, mimeType, extension } = await prepareAttachmentFile(file);
    storagePath = await store(buffer, extension);
    const created = await prisma.selfInspectionDeviationAttachment.create({
      data: { organizationId: ctx.organizationId, deviationId: entry.id, phase, filename: file.name.slice(0, 200) || "bild.jpg", storagePath, mimeType, size: buffer.length, createdById: ctx.user.id },
      select: { id: true },
    });
    return NextResponse.json(created);
  } catch (error) {
    if (storagePath) await remove(storagePath);
    return failure(error);
  }
}
