import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, type Context } from "./server";
import { normalizeControl } from "./model";
import { read, store, remove } from "./storage";
export async function duplicateControl(
  ctx: Context,
  sourceId: string,
  id: string,
  lockToken: string,
  input: unknown,
  customerId: string | null,
  projectId: string | null,
  siteId: string | null,
  departmentId: string | null,
) {
  const copied: string[] = [];
  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Control" WHERE id=${sourceId} FOR UPDATE`;
        const source = await tx.control.findFirst({
          where: {
            id: sourceId,
            organizationId: ctx.organizationId,
            deletedAt: null,
          },
          include: { attachments: true },
        });
        if (!source)
          throw new ApiError(404, "Originalkontrollen hittades inte.");
        const data = normalizeControl(input);
        if (!data.meta.proj.trim())
          throw new ApiError(400, "Ange projekt eller anläggning.");
        if (
          customerId &&
          !(await tx.customer.findFirst({
            where: {
              id: customerId,
              organizationId: ctx.organizationId,
              deletedAt: null,
            },
          }))
        )
          throw new ApiError(400, "Kunden hittades inte.");
        if (projectId && !(await tx.project.findFirst({
          where: { id: projectId, organizationId: ctx.organizationId },
          select: { id: true },
        }))) throw new ApiError(400, "Projektet hittades inte.");
        if (departmentId && !siteId)
          throw new ApiError(400, "Välj plats före avdelning.");
        if (siteId && !(await tx.site.findFirst({
          where: { id: siteId, organizationId: ctx.organizationId, isActive: true },
          select: { id: true },
        }))) throw new ApiError(400, "Platsen hittades inte eller är pausad.");
        if (departmentId && !(await tx.department.findFirst({
          where: { id: departmentId, siteId: siteId!, organizationId: ctx.organizationId, isActive: true },
          select: { id: true },
        }))) throw new ApiError(400, "Avdelningen hittades inte eller är pausad.");
        const control = await tx.control.create({
          data: {
            id,
            organizationId: ctx.organizationId,
            customerId,
            projectId,
            siteId,
            departmentId,
            title: data.meta.name || data.meta.proj,
            project: data.meta.proj,
            performer: data.meta.perf,
            date: data.meta.date,
            data: data as Prisma.InputJsonValue,
            status: "DRAFT",
            createdBy: ctx.user.id,
            updatedBy: ctx.user.id,
            lockToken,
            lockedBy: ctx.user.id,
            lockExpiresAt: new Date(Date.now() + 90_000),
          },
        });
        for (const file of source.attachments) {
          const storagePath = await store(
            await read(file.storagePath),
            file.storagePath.split(".").pop()!,
          );
          copied.push(storagePath);
          await tx.attachment.create({
            data: {
              controlId: id,
              organizationId: ctx.organizationId,
              filename: file.filename,
              mimeType: file.mimeType,
              size: file.size,
              section: file.section,
              rowId: file.rowId,
              storagePath,
            },
          });
        }
        await tx.controlRevision.create({
          data: {
            controlId: id,
            version: 1,
            data: data as Prisma.InputJsonValue,
            createdBy: ctx.user.id,
          },
        });
        return { id: control.id, version: 1, status: "DRAFT" };
      },
      { timeout: 30_000 },
    );
  } catch (e) {
    await Promise.all(copied.map(remove));
    throw e;
  }
}
