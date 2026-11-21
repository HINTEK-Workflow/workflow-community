import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure, requireAdmin, requireCloudStorage, requireCloudWriteAccess } from "@/lib/kfid/server";
import { companyValueCatalogFor, companyValues } from "@/lib/kfid/company-values-server";
import { companyValueBlank, companyValuesSaveSchema } from "@/lib/workflow/company-values";
import { FORM_PERMISSION_AREAS, hasWorkflowPermission } from "@/lib/workflow/permissions";

export const dynamic = "force-dynamic";

/**
 * Värden och referenser (2026-10-06): the company's own values for the limits its forms declare. Read by the
 * company's administrator here and by everyone who may read protocols (also through /api/form-limits with the
 * protocol); changed only by the administrator, in Cloud with write access. Always scoped to the session's company – a
 * superadmin sees only the company they are a member of, like any other member.
 */
export async function GET() {
  try {
    const ctx = await context();
    if (!ctx.admin && !FORM_PERMISSION_AREAS.some((area) => hasWorkflowPermission(ctx.workflowPermissions, area, "read"))) throw new ApiError(403, "Du saknar behörighet att visa företagets värden.");
    const cloud = ctx.organization.storageMode === "HINTEK_CLOUD";
    // Local keeps its values in the file; the server only says which limits the forms declare.
    const [catalog, values] = await Promise.all([companyValueCatalogFor(ctx.organizationId), cloud ? companyValues(ctx.organizationId) : Promise.resolve([])]);
    return NextResponse.json({ canEdit: ctx.admin && cloud, catalog, values });
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
    const { values } = companyValuesSaveSchema.parse(await body(request));
    const actor = { updatedBy: ctx.user.id, updatedByName: ctx.user.name || ctx.user.email };
    await prisma.$transaction(async (tx) => {
      for (const input of values) {
        const where = { organizationId_key: { organizationId: ctx.organizationId, key: input.key } };
        const existing = await tx.companyReferenceValue.findUnique({ where });
        if (existing && input.version !== undefined && existing.version !== input.version) throw new ApiError(409, "Värdena har ändrats av någon annan. Läs in sidan på nytt.");
        const fields = { low: input.low, high: input.high, warnLow: input.warnLow, warnHigh: input.warnHigh, source: input.source, reference: input.reference };
        if (companyValueBlank(fields)) { if (existing) await tx.companyReferenceValue.delete({ where: { id: existing.id } }); continue; }
        if (existing) await tx.companyReferenceValue.update({ where: { id: existing.id, version: existing.version }, data: { ...fields, ...actor, version: { increment: 1 } } });
        else await tx.companyReferenceValue.create({ data: { organizationId: ctx.organizationId, key: input.key, ...fields, ...actor } });
      }
    });
    return NextResponse.json({ values: await companyValues(ctx.organizationId) });
  } catch (error) {
    return failure(error);
  }
}
