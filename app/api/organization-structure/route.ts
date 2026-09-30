import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure, requireAdmin, requireCloudWriteAccess } from "@/lib/kfid/server";

const identifier = z.string().min(1).max(100);
const name = z.string().trim().min(1).max(120);
const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("site_save"), id: identifier.optional(), name }),
  z.object({ action: z.literal("department_save"), id: identifier.optional(), siteId: identifier, name }),
  z.object({ action: z.literal("site_status"), id: identifier, isActive: z.boolean() }),
  z.object({ action: z.literal("department_status"), id: identifier, isActive: z.boolean() }),
]);

export async function GET() {
  try {
    const ctx = await context();
    const sites = await prisma.site.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        isActive: true,
        departments: {
          orderBy: { name: "asc" },
          select: { id: true, name: true, isActive: true },
        },
      },
    });
    return NextResponse.json({ sites });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    requireAdmin(ctx);
    await requireCloudWriteAccess(ctx);
    const input = inputSchema.parse(await body(request));
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${ctx.organizationId} FOR UPDATE`;
      const audited = async (id: string) => {
        await tx.administrationEvent.create({
          data: {
            actorId: ctx.user.id,
            organizationId: ctx.organizationId,
            action: input.action,
            detail: `Uppdaterade plats- eller avdelningsstruktur: ${id}`,
          },
        });
        return { id };
      };
      if (input.action === "site_save") {
        const conflicting = await tx.site.findFirst({
          where: { organizationId: ctx.organizationId, name: input.name, id: { not: input.id } },
          select: { id: true },
        });
        if (conflicting) throw new ApiError(409, "Platsen finns redan i företaget.");
        if (input.id) {
          const changed = await tx.site.updateMany({
            where: { id: input.id, organizationId: ctx.organizationId },
            data: { name: input.name },
          });
          if (!changed.count) throw new ApiError(404, "Platsen hittades inte.");
          return audited(input.id);
        }
        const site = await tx.site.create({
          data: { organizationId: ctx.organizationId, name: input.name },
          select: { id: true },
        });
        return audited(site.id);
      }
      if (input.action === "department_save") {
        const site = await tx.site.findFirst({
          where: { id: input.siteId, organizationId: ctx.organizationId, isActive: true },
          select: { id: true },
        });
        if (!site) throw new ApiError(404, "Platsen hittades inte eller är pausad.");
        const conflicting = await tx.department.findFirst({
          where: { siteId: input.siteId, name: input.name, id: { not: input.id } },
          select: { id: true },
        });
        if (conflicting) throw new ApiError(409, "Avdelningen finns redan på platsen.");
        if (input.id) {
          const changed = await tx.department.updateMany({
            where: { id: input.id, siteId: input.siteId, organizationId: ctx.organizationId },
            data: { name: input.name },
          });
          if (!changed.count) throw new ApiError(404, "Avdelningen hittades inte.");
          return audited(input.id);
        }
        const department = await tx.department.create({
          data: { organizationId: ctx.organizationId, siteId: input.siteId, name: input.name },
          select: { id: true },
        });
        return audited(department.id);
      }
      if (input.action === "site_status") {
        const changed = await tx.site.updateMany({
          where: { id: input.id, organizationId: ctx.organizationId },
          data: { isActive: input.isActive },
        });
        if (!changed.count) throw new ApiError(404, "Platsen hittades inte.");
      } else {
        const changed = await tx.department.updateMany({
          where: { id: input.id, organizationId: ctx.organizationId },
          data: { isActive: input.isActive },
        });
        if (!changed.count) throw new ApiError(404, "Avdelningen hittades inte.");
      }
      return audited(input.id);
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return failure(error);
  }
}
