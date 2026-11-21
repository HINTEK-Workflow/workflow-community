import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, checkOrigin, context, failure, requireAdmin, requireCloudStorage, requireCloudWriteAccess, requireModule } from "@/lib/kfid/server";
import { read, remove } from "@/lib/kfid/storage";
import { credentialExpired } from "@/lib/self-inspection/model";
import { recordCardVersion } from "@/lib/self-inspection/credentials-server";

export const dynamic = "force-dynamic";

/** A file on a competence card: the card's person and the company's admins read it; only an admin removes it (2026-10-07). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const { id } = await params;
    const file = await prisma.selfInspectionCredentialFile.findFirst({ where: { id, organizationId: ctx.organizationId }, include: { credential: { select: { userId: true, leftAt: true } } } });
    // The same answer for a file that is not there and one that is not the person's: nothing says which cards exist.
    if (!file || (!ctx.admin && (file.credential.userId !== ctx.user.id || file.credential.leftAt))) throw new ApiError(404, "Filen hittades inte.");
    // A card past its three months is not shown even before the night's clean-up has removed it.
    if (file.credential.leftAt && credentialExpired(file.credential.leftAt)) throw new ApiError(404, "Filen hittades inte.");
    return new Response(new Uint8Array(await read(file.storagePath)), { headers: {
      "Content-Type": file.mimeType, "Content-Disposition": `${file.mimeType.startsWith("image/") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(request);
    const ctx = await context();
    requireCloudStorage(ctx);
    await requireCloudWriteAccess(ctx);
    requireModule(ctx, "self_inspection");
    requireAdmin(ctx);
    const { id } = await params;
    const organizationId = ctx.organizationId;
    // The card keeps a version without the file (kompetenskort v2), under the company's lock like every card save.
    const file = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
      const found = await tx.selfInspectionCredentialFile.findFirst({ where: { id, organizationId }, select: { id: true, storagePath: true, filename: true, credential: { select: { userId: true, title: true } } } });
      if (!found) throw new ApiError(404, "Filen hittades inte.");
      await tx.selfInspectionCredentialFile.delete({ where: { id: found.id } });
      await recordCardVersion(tx, { organizationId, userId: found.credential.userId, actorId: ctx.user.id, change: `Fil borttagen från ${found.credential.title}: ${found.filename}` });
      return found;
    });
    await remove(file.storagePath);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
