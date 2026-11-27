import { prisma } from "@/lib/db";
import { context, checkOrigin, failure, ApiError, requireAdmin } from "@/lib/kfid/server";
import { read, remove } from "@/lib/kfid/storage";
import { logoVariantById } from "@/lib/kfid/logo-variants";
import { NextResponse } from "next/server";

/**
 * The company's logo (`/api/files/logo`) and its variants (`/api/files/logo-on-dark`, `logo-on-light`, `logo-black`; 2026-11-13),
 * always the active company's own; the older control's attachments are gone with its editor (2026-10-06).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await context({ skipLegal: true });
    const { id } = await params;
    const variant = logoVariantById(id);
    if (id !== "logo" && !variant) throw new ApiError(404, "Filen hittades inte.");
    const settings = await prisma.workspaceSettings.findUnique({
      where: { organizationId: ctx.organizationId },
    });
    const key = variant ? settings?.[variant.column] : settings?.logoPath;
    if (!key) throw new ApiError(404, "Ingen logotyp.");
    return new Response(new Uint8Array(await read(key)), {
      headers: {
        "Content-Type": key.endsWith(".png") ? "image/png" : "image/jpeg",
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
    const variant = logoVariantById(id);
    if (id !== "logo" && !variant) throw new ApiError(404, "Filen hittades inte.");
    requireAdmin(ctx);
    const old = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${ctx.organizationId} FOR UPDATE`;
      const settings = await tx.workspaceSettings.findUnique({
        where: { organizationId: ctx.organizationId },
      });
      await tx.workspaceSettings.updateMany({
        where: { organizationId: ctx.organizationId },
        data: variant ? { [variant.column]: null } : { logoPath: null, themePrimary: null },
      });
      return variant ? settings?.[variant.column] : settings?.logoPath;
    });
    if (old) await remove(old);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
