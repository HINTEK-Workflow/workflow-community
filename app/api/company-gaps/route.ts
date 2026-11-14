import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { companyDocumentGaps } from "@/lib/kfid/company";
import { context, failure, requireAdmin } from "@/lib/kfid/server";

export const dynamic = "force-dynamic";

/**
 * What the company's documents still lack (2026-11-04): the warning in the dialogs that send a quote or an invoice basis.
 * Only the company's administrators, who may see and change Företagsuppgifter, get an answer; everybody else gets the usual
 * refusal and the dialogs show nothing. Names of missing details only – no values – and only the caller's own company.
 */
export async function GET() {
  try {
    const ctx = await context();
    requireAdmin(ctx);
    const settings = await prisma.workspaceSettings.findUnique({ where: { organizationId: ctx.organizationId }, select: { profile: true } });
    return NextResponse.json({ gaps: companyDocumentGaps(settings?.profile ?? {}) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
