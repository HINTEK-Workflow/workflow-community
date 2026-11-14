import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, checkOrigin, context, failure, requireAdmin, requireCloudStorage, requireCloudWriteAccess, requireModule } from "@/lib/kfid/server";
import { remove, store } from "@/lib/kfid/storage";
import { prepareAttachmentFile } from "@/lib/workflow/attachment-file";
import { readLimitedFormData } from "@/lib/security/limited-body";
import { CREDENTIAL_FILE_LIMIT, recordCardVersion } from "@/lib/self-inspection/credentials-server";

export const dynamic = "force-dynamic";

/**
 * A certificate or proof on a line of a competence card (2026-10-07). The same private handling and limits as the
 * other attachments (lib/workflow/attachment-file.ts: 10 MB, pictures, PDF, text, Word and Excel; the bytes in
 * lib/kfid/storage.ts, never public). The person who may edit the card – a company admin – adds and removes files; the
 * card's person and the admins read them (./[id]). The files go with the line, with the card and with the nightly clean-up.
 */
export async function POST(request: Request) {
  let storagePath: string | undefined;
  try {
    checkOrigin(request);
    const ctx = await context();
    requireCloudStorage(ctx);
    await requireCloudWriteAccess(ctx);
    requireModule(ctx, "self_inspection");
    requireAdmin(ctx);
    if (Number(request.headers.get("content-length")) > 12_000_000) throw new ApiError(413, "Maximal filstorlek är 10 MB.");
    const form = await readLimitedFormData(request, 12_000_000);
    const credentialId = String(form.get("credentialId") || "");
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > 10_000_000) throw new ApiError(400, "Välj en fil på högst 10 MB.");
    const organizationId = ctx.organizationId;
    const line = await prisma.selfInspectionCredential.findFirst({ where: { id: credentialId, organizationId }, select: { id: true, leftAt: true } });
    if (!line) throw new ApiError(404, "Utbildningen hittades inte.");
    // The card of a person who left is kept as it was until it is deleted.
    if (line.leftAt) throw new ApiError(409, "Personen har lämnat företaget. Kompetenskortet kan inte ändras, bara tas bort.");
    if (await prisma.selfInspectionCredentialFile.count({ where: { credentialId: line.id, organizationId } }) >= CREDENTIAL_FILE_LIMIT) throw new ApiError(400, `Max ${CREDENTIAL_FILE_LIMIT} filer per utbildning eller intyg.`);
    const { buffer, mimeType, extension } = await prepareAttachmentFile(file);
    storagePath = await store(buffer, extension);
    const path = storagePath;
    const filename = file.name.slice(0, 200);
    // The file is part of the card, so the card keeps a version (kompetenskort v2), under the company's lock like every card save.
    const created = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
      const current = await tx.selfInspectionCredential.findFirst({ where: { id: line.id, organizationId, leftAt: null }, select: { id: true, userId: true, title: true } });
      if (!current) throw new ApiError(404, "Utbildningen hittades inte.");
      const row = await tx.selfInspectionCredentialFile.create({ data: { organizationId, credentialId: current.id, filename, storagePath: path, mimeType, size: buffer.length }, select: { id: true } });
      await recordCardVersion(tx, { organizationId, userId: current.userId, actorId: ctx.user.id, change: `Fil tillagd på ${current.title}: ${filename}` });
      return row;
    });
    return NextResponse.json(created);
  } catch (error) {
    if (storagePath) await remove(storagePath);
    return failure(error);
  }
}
