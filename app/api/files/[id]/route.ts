import { prisma } from "@/lib/db";
import {
  context,
  checkOrigin,
  failure,
  ApiError,
  requireAdmin,
  requireCloudStorage,
  requireCloudWriteAccess,
  requireWorkflowPermission,
} from "@/lib/kfid/server";
import { read, remove } from "@/lib/kfid/storage";
import { NextResponse } from "next/server";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await context({ skipLegal: true });
    const { id } = await params;
    if (id === "logo") {
      const settings = await prisma.workspaceSettings.findUnique({
        where: { organizationId: ctx.organizationId },
      });
      if (!settings?.logoPath) throw new ApiError(404, "Ingen logotyp.");
      return new Response(new Uint8Array(await read(settings.logoPath)), {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    requireCloudStorage(ctx);
    requireWorkflowPermission(ctx, "kfid", "read");
    const file = await prisma.attachment.findFirst({
      where: {
        id,
        organizationId: ctx.organizationId,
        control: { deletedAt: null },
      },
    });
    if (!file) throw new ApiError(404, "Filen hittades inte.");
    return new Response(new Uint8Array(await read(file.storagePath)), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": `${file.mimeType.startsWith("image/") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    checkOrigin(request);
    const ctx = await context();
    const { id } = await params;
    if (id === "logo") {
      requireAdmin(ctx);
      const old = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${ctx.organizationId} FOR UPDATE`;
        const settings = await tx.workspaceSettings.findUnique({
          where: { organizationId: ctx.organizationId },
        });
        await tx.workspaceSettings.updateMany({
          where: { organizationId: ctx.organizationId },
          data: { logoPath: null, themePrimary: null },
        });
        return settings?.logoPath;
      });
      if (old) await remove(old);
      return NextResponse.json({ ok: true });
    }
    requireCloudStorage(ctx);
    await requireCloudWriteAccess(ctx);
    requireWorkflowPermission(ctx, "kfid", "edit");
    const file = await prisma.attachment.findFirst({
      where: { id, organizationId: ctx.organizationId },
    });
    if (!file) throw new ApiError(404, "Filen hittades inte.");
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Control" WHERE id=${file.controlId} FOR UPDATE`;
      const control = await tx.control.findFirst({
        where: {
          id: file.controlId,
          organizationId: ctx.organizationId,
          deletedAt: null,
        },
      });
      if (!control) throw new ApiError(404, "Kontrollen hittades inte.");
      if (control.status === "COMPLETED")
        throw new ApiError(409, "En färdigställd kontroll kan inte ändras.");
      await tx.attachment.delete({ where: { id } });
    });
    await remove(file.storagePath);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
