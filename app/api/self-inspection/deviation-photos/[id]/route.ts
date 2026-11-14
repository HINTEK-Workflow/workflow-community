import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkOrigin, context, failure, requireCloudStorage, requireCloudWriteAccess } from "@/lib/kfid/server";
import { read, remove } from "@/lib/kfid/storage";
import { readablePhoto, removablePhoto } from "@/lib/self-inspection/deviation-photos-server";

export const dynamic = "force-dynamic";

/** A photo on a log entry (2026-10-30): read by whoever may read the entry, removed by whoever handles it or added it. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const photo = await readablePhoto(ctx, (await params).id);
    return new Response(new Uint8Array(await read(photo.storagePath)), { headers: { "Content-Type": photo.mimeType, "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(photo.filename)}`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return failure(error); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(request);
    const ctx = await context();
    requireCloudStorage(ctx);
    await requireCloudWriteAccess(ctx);
    const photo = await removablePhoto(ctx, (await params).id);
    await prisma.selfInspectionDeviationAttachment.deleteMany({ where: { id: photo.id, organizationId: ctx.organizationId } });
    await remove(photo.storagePath);
    return NextResponse.json({ ok: true });
  } catch (error) { return failure(error); }
}
