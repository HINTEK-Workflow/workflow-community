import { NextResponse } from "next/server";
import { z } from "zod";
import { body, checkOrigin, context, failure, requireCloudStorage, requireCloudWriteAccess } from "@/lib/kfid/server";
import { ApiError } from "@/lib/kfid/errors";
import { canViewEconomy, canViewTeam } from "@/lib/workflow/permissions";
import { visibleCompanyGoals } from "@/lib/workflow/company-goals";
import { readCompanyGoals, writeCompanyGoals } from "@/lib/workflow/company-goals-server";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "private, no-store" };

/**
 * Företagets mål (2026-10-28). GET: the goals for those who may see Teamet or Ekonomi (the economy goals only for
 * Ekonomi's readers); POST: the company's admin saves them. Cloud only; session, company, role, Cloud write access and
 * Origin are checked on every call.
 */
export async function GET() {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const economy = canViewEconomy(ctx);
    if (!economy && !canViewTeam(ctx)) throw new ApiError(403, "Du saknar behörighet att se företagets mål.");
    return NextResponse.json({ goals: visibleCompanyGoals(await readCompanyGoals(ctx.organizationId), { economy }), canEdit: ctx.admin }, { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    requireCloudStorage(ctx);
    if (!ctx.admin) throw new ApiError(403, "Företagsadministratör krävs.");
    await requireCloudWriteAccess(ctx);
    const input = z.object({ goals: z.unknown() }).parse(await body(request));
    return NextResponse.json({ goals: await writeCompanyGoals(ctx, input.goals) });
  } catch (error) {
    return failure(error);
  }
}
