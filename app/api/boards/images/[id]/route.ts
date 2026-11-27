import { context, failure, requireCloudStorage } from "@/lib/kfid/server";
import { read } from "@/lib/kfid/storage";
import { boardImageInApp, boardsCallerOf } from "@/lib/boards/server";

export const dynamic = "force-dynamic";

/** A board's picture, for whoever may read boards in the company (screens and links have their own image routes). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const image = await boardImageInApp(boardsCallerOf(ctx), (await params).id.slice(0, 60));
    return new Response(new Uint8Array(await read(image.storagePath)), { headers: { "Content-Type": image.mimeType, "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(image.filename)}`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return failure(error); }
}
