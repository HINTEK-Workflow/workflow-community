import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure, requireAdmin, requireCloudStorage, requireCloudWriteAccess, requireWorkflowPermission } from "@/lib/kfid/server";
import { formFamily } from "@/lib/kfid/form-server";
import { formLimitProfileInputSchema, limitProfileValueSchema, type FormLimitProfile } from "@/lib/workflow/form-limits";
import { formPermissionArea } from "@/lib/workflow/permissions";

export const dynamic = "force-dynamic";
const identifier = z.string().min(1).max(100);

const view = (row: { id: string; templateId: string; facilityId: string; objectName: string; values: unknown; version: number; updatedAt: Date; updatedByName: string }): FormLimitProfile => ({
  id: row.id, templateId: row.templateId, facilityId: row.facilityId, objectName: row.objectName, version: row.version, updatedAt: row.updatedAt.toISOString(), updatedByName: row.updatedByName,
  values: z.record(z.string(), limitProfileValueSchema).catch({}).parse(row.values),
});

/**
 * Limit profiles (2026-09-28): the company's own limit values for a form at a facility. Everyone who may read the
 * form's protocols reads them; only the company's administrator changes them, since they decide what is a deviation.
 */
export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const url = new URL(request.url);
    const templateId = identifier.parse(url.searchParams.get("templateId"));
    const facilityParam = url.searchParams.get("facilityId");
    const { family, permissionArea } = await formFamily(ctx.organizationId, templateId);
    requireWorkflowPermission(ctx, formPermissionArea(permissionArea), "read");
    const rows = await prisma.formLimitProfile.findMany({
      where: { organizationId: ctx.organizationId, templateId: family, ...(facilityParam ? { facilityId: identifier.parse(facilityParam) } : {}) },
      orderBy: [{ facilityId: "asc" }, { objectName: "asc" }], take: 500,
    });
    return NextResponse.json({ family, canEdit: ctx.admin, profiles: rows.map(view) });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    requireCloudStorage(ctx);
    await requireCloudWriteAccess(ctx);
    requireAdmin(ctx);
    const input = formLimitProfileInputSchema.parse(await body(request));
    const facility = await prisma.customerFacility.findFirst({ where: { id: input.facilityId, organizationId: ctx.organizationId }, select: { id: true } });
    if (!facility) throw new ApiError(400, "Anläggningen hittades inte.");
    const { family } = await formFamily(ctx.organizationId, input.templateId);
    const actor = { updatedBy: ctx.user.id, updatedByName: ctx.user.name || ctx.user.email };
    const values = input.values as Prisma.InputJsonValue;
    const existing = await prisma.formLimitProfile.findUnique({ where: { organizationId_templateId_facilityId_objectName: { organizationId: ctx.organizationId, templateId: family, facilityId: input.facilityId, objectName: input.objectName } } });
    if (existing && input.version !== undefined && existing.version !== input.version) throw new ApiError(409, "Gränsvärdena har ändrats av någon annan. Läs in dem på nytt.");
    const row = existing
      ? await prisma.formLimitProfile.update({ where: { id: existing.id, version: existing.version }, data: { values, version: { increment: 1 }, ...actor } })
      : await prisma.formLimitProfile.create({ data: { organizationId: ctx.organizationId, templateId: family, facilityId: input.facilityId, objectName: input.objectName, values, ...actor } });
    return NextResponse.json({ profile: view(row) });
  } catch (error) {
    return failure(error);
  }
}
