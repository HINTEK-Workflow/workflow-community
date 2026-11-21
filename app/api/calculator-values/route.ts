import { NextResponse } from "next/server";
import { ApiError, context, failure } from "@/lib/kfid/server";
import { calculatorValues } from "@/lib/calculators/company-values-server";
import { FORM_PERMISSION_AREAS, hasWorkflowPermission } from "@/lib/workflow/permissions";

export const dynamic = "force-dynamic";

/**
 * The company's values for the Räkneverktyg (2026-10-07): the reactance, limit and tables the company entered
 * under Inställningar → Värden och referenser, without the catalogue of the forms' limits that page also reads. The
 * same rule as the values themselves: the company's administrator and everyone who may read protocols; always the
 * session's own company. Changed only through /api/company-values, by the administrator. A company that keeps its data
 * locally has none here – the values are in its file.
 */
export async function GET() {
  try {
    const ctx = await context();
    if (!ctx.admin && !FORM_PERMISSION_AREAS.some((area) => hasWorkflowPermission(ctx.workflowPermissions, area, "read"))) throw new ApiError(403, "Du saknar behörighet att läsa företagets värden.");
    const cloud = ctx.organization.storageMode === "HINTEK_CLOUD";
    return NextResponse.json({ canEdit: ctx.admin && cloud, values: cloud ? await calculatorValues(ctx.organizationId) : [] });
  } catch (error) {
    return failure(error);
  }
}
