import { NextResponse } from "next/server";
import { ApiError, checkOrigin, context, failure, requireCloudStorage, requireCloudWriteAccess, requireModule } from "@/lib/kfid/server";
import { remove, store } from "@/lib/kfid/storage";
import { readLimitedFormData } from "@/lib/security/limited-body";
import { addBoardImage, boardsCallerOf, requireBoardsEdit } from "@/lib/boards/server";
import { prepareBoardFile } from "@/lib/boards/cards/file-server";
import { boardFileKind } from "@/lib/boards/cards/file";

export const dynamic = "force-dynamic";

/**
 * A file for a board's PDF or sheet card (Tavlor, 2026-11-19): uploaded as the board's pictures are (the same checks, at most 10 MB,
 * the bytes private in lib/kfid/storage.ts) and kept among the boards' own files. Shown only through Workflow's own routes.
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
    if (!(file instanceof File)) throw new ApiError(400, "Välj en fil.");
    const { buffer, mimeType, extension } = await prepareBoardFile(file);
    storagePath = await store(buffer, extension);
    const filename = file.name.slice(0, 200) || `fil.${extension}`;
    const { id } = await addBoardImage(caller, { filename, storagePath, mimeType, size: buffer.length });
    return NextResponse.json({ id, name: filename, kind: boardFileKind(mimeType) });
  } catch (error) {
    if (storagePath) await remove(storagePath);
    return failure(error);
  }
}
