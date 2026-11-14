import { NextResponse } from "next/server";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { context, checkOrigin, failure, ApiError, requireAdmin } from "@/lib/kfid/server";
import { store, remove } from "@/lib/kfid/storage";
import { extractLogoPrimary } from "@/lib/logo-color";
import { logoVariantByKey } from "@/lib/kfid/logo-variants";
import { readLimitedFormData } from "@/lib/security/limited-body";

/**
 * The company's logo for its reports (Rapporter och logotyp), and since 2026-11-13 its variants (`variant`: onDark, onLight or
 * black; lib/kfid/logo-variants.ts) with the same checks: the company's admin, the app's Origin, at most 10 MB, JPEG, PNG or
 * WebP, a picture that can be read. A variant is kept as PNG so its transparency stays; it never changes the company's colour.
 * Task and protocol files have their own route (/api/workflow-task-files); the older control's attachments are gone with its
 * editor (2026-10-06).
 */
export async function POST(request: Request) {
  let key: string | undefined;
  try {
    checkOrigin(request);
    const ctx = await context();
    if (Number(request.headers.get("content-length")) > 12_000_000)
      throw new ApiError(413, "Maximal filstorlek är 10 MB.");
    const form = await readLimitedFormData(request, 12_000_000);
    const file = form.get("file");
    const variantField = form.get("variant");
    const variant = typeof variantField === "string" && variantField ? logoVariantByKey(variantField) : null;
    if (typeof variantField === "string" && variantField && !variant) throw new ApiError(400, "Okänd logga.");
    if (form.get("logo") !== "true" && !variant) throw new ApiError(400, "Endast företagets logotyp laddas upp här.");
    requireAdmin(ctx);
    if (!(file instanceof File) || !file.size || file.size > 10_000_000)
      throw new ApiError(400, "Välj en fil på högst 10 MB.");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new ApiError(400, "Logotypen måste vara en bild.");
    let buffer: Buffer = Buffer.from(await file.arrayBuffer());
    let themePrimary: string | null = null;
    try {
      if (!variant) themePrimary = await extractLogoPrimary(buffer);
      const resized = sharp(buffer, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true });
      buffer = await (variant ? resized.png() : resized.jpeg({ quality: 85 })).toBuffer();
    } catch {
      throw new ApiError(400, "Bilden kunde inte läsas. Välj JPG, PNG eller WebP.");
    }
    key = await store(buffer, variant ? "png" : "jpg");
    const old = await prisma.workspaceSettings.findUnique({ where: { organizationId: ctx.organizationId } });
    if (variant) {
      await prisma.workspaceSettings.upsert({
        where: { organizationId: ctx.organizationId },
        create: { organizationId: ctx.organizationId, companyName: ctx.organization.name, [variant.column]: key },
        update: { [variant.column]: key },
      });
      const previous = old?.[variant.column];
      if (previous) await remove(previous);
      return NextResponse.json({ ok: true });
    }
    await prisma.workspaceSettings.upsert({
      where: { organizationId: ctx.organizationId },
      create: { organizationId: ctx.organizationId, companyName: ctx.organization.name, logoPath: key, themePrimary },
      update: { logoPath: key, themePrimary },
    });
    if (old?.logoPath) await remove(old.logoPath);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (key) await remove(key);
    return failure(e);
  }
}
