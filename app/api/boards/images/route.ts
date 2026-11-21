import { NextResponse } from "next/server";
import { ApiError, checkOrigin, context, failure, requireCloudStorage, requireCloudWriteAccess, requireModule } from "@/lib/kfid/server";
import { remove, store } from "@/lib/kfid/storage";
import { MAX_ATTACHMENT_BYTES, prepareAttachmentFile } from "@/lib/workflow/attachment-file";
import { readLimitedFormData } from "@/lib/security/limited-body";
import { addBoardImage, boardsCallerOf, requireBoardsEdit } from "@/lib/boards/server";

export const dynamic = "force-dynamic";

/**
 * A picture for a board's image card (Tavlor, 2026-11-18): the company's own picture, handled like a machine part's (10 MB, turned
 * upright, made JPEG, the bytes private in lib/kfid/storage.ts). Shown only through Workflow's own routes, never from a third party.
 */
export async function POST(request: Request) {
  let storagePath: string | undefined;
  try {
    checkOrigin(request);
    const ctx = await context();
    requireCloudStorage(ctx);
    await requireCloudWriteAccess(ctx);
    requireModule(ctx, "boards");
    const caller = boardsCallerOf(ctx);
    requireBoardsEdit(caller);
    if (Number(request.headers.get("content-length")) > 12_000_000) throw new ApiError(413, "Filen får vara högst 10 MB.");
    const form = await readLimitedFormData(request, 12_000_000);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > MAX_ATTACHMENT_BYTES) throw new ApiError(400, "Välj en bild på högst 10 MB.");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new ApiError(400, "Välj en bild (JPG, PNG eller WebP).");
    const { buffer, mimeType, extension } = await prepareAttachmentFile(file);
    storagePath = await store(buffer, extension);
    return NextResponse.json(await addBoardImage(caller, { filename: file.name.slice(0, 200) || "bild.jpg", storagePath, mimeType, size: buffer.length }));
  } catch (error) {
    if (storagePath) await remove(storagePath);
    return failure(error);
  }
}
