import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure } from "@/lib/kfid/server";
import { companyAiUsage } from "@/lib/ai/usage-server";
import { setCompanyWeeklyQuota } from "@/lib/ai/weekly-quota-server";

export const dynamic = "force-dynamic";

async function superadmin() {
  const ctx = await context();
  if (ctx.user.role !== "SUPERADMIN") throw new ApiError(403, "Bara installationens administratör kan göra det.");
  return ctx;
}
const companyId = z.string().min(1).max(100);

/**
 * Workflow AI per kundföretag (2026-11-21): the superadmin sees a company's weekly quota (what it comes from and the cost),
 * this week's use and the last weeks as metadata – answers and shares, never a question, an answer or who asked.
 */
export async function GET(request: Request) {
  try {
    const ctx = await superadmin();
    const organizationId = companyId.parse(new URL(request.url).searchParams.get("organizationId"));
    if (!(await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } }))) throw new ApiError(404, "Företaget finns inte.");
    const [usage, own] = await Promise.all([
      companyAiUsage(organizationId, { userId: ctx.user.id, kind: "superadmin" }),
      prisma.workspaceSettings.findUnique({ where: { organizationId }, select: { aiPolicy: true } }),
    ]);
    const ownKr = (own?.aiPolicy as { weeklyQuotaKr?: unknown } | null)?.weeklyQuotaKr;
    return NextResponse.json({ usage, ownQuotaKr: typeof ownKr === "number" ? ownKr : null }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

const inputSchema = z.object({ action: z.literal("set_quota"), organizationId: companyId, quotaKr: z.number().int().min(0).max(10_000).nullable() }).strict();

/** A company's own weekly quota in kr (null: the installation's rule again). Logged in the company's history. */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await superadmin();
    const input = inputSchema.parse(await body(request));
    if (!(await prisma.organization.findUnique({ where: { id: input.organizationId }, select: { id: true } }))) throw new ApiError(404, "Företaget finns inte.");
    await setCompanyWeeklyQuota(input.organizationId, input.quotaKr);
    await prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: input.organizationId, action: "ai_week_quota_set",
      detail: input.quotaKr === null ? "Veckokvoten för Workflow AI följer abonnemanget igen." : `Egen veckokvot för Workflow AI: ${input.quotaKr} kr.` } });
    return NextResponse.json({ usage: await companyAiUsage(input.organizationId, { userId: ctx.user.id, kind: "superadmin" }), ownQuotaKr: input.quotaKr });
  } catch (error) {
    return failure(error);
  }
}
