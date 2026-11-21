import { context, failure, requireCloudStorage } from "@/lib/kfid/server";
import { read } from "@/lib/kfid/storage";
import { callerOf, readableImage } from "@/lib/maintenance/server";

export const dynamic = "force-dynamic";

/** A machine part's picture, for whoever may read Underhåll (removing it is a POST to /api/maintenance). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const image = await readableImage(callerOf(ctx), (await params).id);
    return new Response(new Uint8Array(await read(image.storagePath)), { headers: { "Content-Type": image.mimeType, "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(image.filename)}`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return failure(error); }
}
