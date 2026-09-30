import { NextResponse } from "next/server";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import {
  context,
  checkOrigin,
  failure,
  ApiError,
  ownedControl,
  requireAdmin,
  requireCloudStorage,
  requireCloudWriteAccess,
  requireWorkflowPermission,
} from "@/lib/kfid/server";
import {
  normalizeControl,
  sectionKeys,
  type SectionKey,
} from "@/lib/kfid/model";
import { store, remove } from "@/lib/kfid/storage";
import { extractLogoPrimary } from "@/lib/logo-color";

export async function POST(request: Request) {
  let key: string | undefined;
  try {
    checkOrigin(request);
    const ctx = await context();
    if (Number(request.headers.get("content-length")) > 12_000_000)
      throw new ApiError(413, "Maximal filstorlek är 10 MB.");
    const form = await request.formData();
    const file = form.get("file");
    const controlId = String(form.get("controlId") || "");
    const logo = form.get("logo") === "true";
    if (!logo) {
      requireCloudStorage(ctx);
      await requireCloudWriteAccess(ctx);
    }
    if (!(file instanceof File) || !file.size || file.size > 10_000_000)
      throw new ApiError(400, "Välj en fil på högst 10 MB.");
    if (logo) requireAdmin(ctx);
    else {
      requireWorkflowPermission(ctx, "kfid", "edit");
      const control = await ownedControl(ctx, controlId);
      if (control.status === "COMPLETED")
        throw new ApiError(409, "En färdigställd kontroll kan inte ändras.");
    }
    let buffer: Buffer = Buffer.from(await file.arrayBuffer());
    let themePrimary: string | null = null;
    let mime = file.type;
    let extension = "bin";
    const isImage = ["image/jpeg", "image/png", "image/webp"].includes(mime);
    if (isImage) {
      try {
        if (logo) themePrimary = await extractLogoPrimary(buffer);
        buffer = await sharp(buffer, { limitInputPixels: 40_000_000 })
          .rotate()
          .resize({
            width: 2000,
            height: 2000,
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality: 85 })
          .toBuffer();
        mime = "image/jpeg";
        extension = "jpg";
      } catch {
        throw new ApiError(
          400,
          "Bilden kunde inte läsas. Välj JPG, PNG eller WebP.",
        );
      }
    } else if (logo) throw new ApiError(400, "Logotypen måste vara en bild.");
    else if (
      mime === "application/pdf" &&
      buffer.subarray(0, 5).toString() === "%PDF-"
    )
      extension = "pdf";
    else if (file.name.endsWith(".txt") && !buffer.includes(0)) {
      extension = "txt";
      mime = "text/plain";
    } else if (
      /\.(docx|xlsx)$/.test(file.name) &&
      buffer[0] === 0x50 &&
      buffer[1] === 0x4b
    ) {
      extension = file.name.endsWith(".docx") ? "docx" : "xlsx";
      mime = "application/octet-stream";
    } else if (
      /\.(doc|xls)$/i.test(file.name) &&
      buffer
        .subarray(0, 8)
        .equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
    ) {
      extension = file.name.toLowerCase().endsWith(".doc") ? "doc" : "xls";
      mime = "application/octet-stream";
    } else
      throw new ApiError(
        400,
        "Tillåtna filer: JPG, PNG, WebP, PDF, TXT, DOC/DOCX och XLS/XLSX.",
      );
    key = await store(buffer, extension);
    if (logo) {
      const old = await prisma.workspaceSettings.findUnique({
        where: { organizationId: ctx.organizationId },
      });
      await prisma.workspaceSettings.upsert({
        where: { organizationId: ctx.organizationId },
        create: {
          organizationId: ctx.organizationId,
          companyName: ctx.organization.name,
          logoPath: key,
          themePrimary,
        },
        update: { logoPath: key, themePrimary },
      });
      if (old?.logoPath) await remove(old.logoPath);
      return NextResponse.json({ ok: true });
    }
    const section = String(form.get("section") || "vis");
    if (!["iso", "cont", "volt", "rcd", "vis"].includes(section))
      throw new ApiError(400, "Ogiltig sektion.");
    const rowId = String(form.get("rowId") || "").slice(0, 100) || null;
    const savedKey = key;
    const attachment = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Control" WHERE id=${controlId} FOR UPDATE`;
      const control = await tx.control.findFirst({
        where: {
          id: controlId,
          organizationId: ctx.organizationId,
          deletedAt: null,
        },
      });
      if (!control) throw new ApiError(404, "Kontrollen hittades inte.");
      if (control.status === "COMPLETED")
        throw new ApiError(409, "En färdigställd kontroll kan inte ändras.");
      if (
        rowId &&
        (!sectionKeys.includes(section as SectionKey) ||
          !normalizeControl(control.data)[section as SectionKey].rows.some(
            (r) => r.uid === rowId,
          ))
      )
        throw new ApiError(
          400,
          "Spara kontrollraden innan du kopplar en bild till den.",
        );
      const items = await tx.attachment.findMany({
        where: { controlId, organizationId: ctx.organizationId },
      });
      const count = items.filter(
        (x) => x.mimeType.startsWith("image/") === isImage,
      ).length;
      if (count >= (isImage ? 10 : 5))
        throw new ApiError(
          400,
          isImage
            ? "Max 10 bilder per kontroll."
            : "Max 5 dokument per kontroll.",
        );
      return tx.attachment.create({
        data: {
          controlId,
          organizationId: ctx.organizationId,
          filename: file.name.slice(0, 200),
          storagePath: savedKey,
          mimeType: mime,
          size: buffer.length,
          section,
          rowId,
        },
      });
    });
    return NextResponse.json({ id: attachment.id });
  } catch (e) {
    if (key) await remove(key);
    return failure(e);
  }
}

export async function DELETE(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    requireCloudStorage(ctx);
    await requireCloudWriteAccess(ctx);
    requireWorkflowPermission(ctx, "kfid", "edit");
    const id = new URL(request.url).searchParams.get("controlId");
    if (!id) throw new ApiError(400, "Välj kontroll.");
    const paths = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Control" WHERE id=${id} AND "organizationId"=${ctx.organizationId} FOR UPDATE`;
      const control = await tx.control.findFirst({
        where: { id, organizationId: ctx.organizationId, deletedAt: null },
      });
      if (!control) throw new ApiError(404, "Kontrollen hittades inte.");
      if (control.status === "COMPLETED")
        throw new ApiError(409, "En färdigställd kontroll kan inte ändras.");
      const files = await tx.attachment.findMany({
        where: { controlId: id, organizationId: ctx.organizationId },
      });
      await tx.attachment.deleteMany({
        where: { controlId: id, organizationId: ctx.organizationId },
      });
      return files.map((f) => f.storagePath);
    });
    await Promise.all(paths.map(remove));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
