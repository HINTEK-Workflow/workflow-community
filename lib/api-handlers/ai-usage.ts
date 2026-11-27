import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { publicInstance } from "@/lib/instance";
import { ApiError, body, checkOrigin, context, failure } from "@/lib/kfid/server";
import { getAiSharingPolicy } from "@/lib/ai/sharing-policy";
import { companyAiUsage } from "@/lib/ai/usage-server";

export const dynamic = "force-dynamic";

/**
 * Användning under Inställningar → Arbetssätt → Workflow AI (2026-11-21): the company's own use of Workflow AI. Every member may
 * read it (as the AI choices); the admin sees each person's count of questions, a member only their own. Counts and shares only –
 * never a question, an answer or the provider's cost.
 */
export async function GET() {
  try {
    const ctx = await context();
    const usage = await companyAiUsage(ctx.organizationId, { userId: ctx.user.id, kind: ctx.admin ? "admin" : "member" });
    return NextResponse.json({ usage, canManage: ctx.admin }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

const inputSchema = z.object({ action: z.literal("continue_on_credits"), on: z.boolean() }).strict();

/** Fortsätt med krediter när veckans kvot är slut: the company's admin, only where the installation has credits. */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    if (!ctx.admin) throw new ApiError(403, "Bara en företagsadministratör kan göra det.");
    if (!publicInstance().features.credits) throw new ApiError(409, "Installationen har inga krediter.");
    const input = inputSchema.parse(await body(request));
    const aiPolicy = { ...(await getAiSharingPolicy(ctx.organizationId)), continueOnCredits: input.on };
    await prisma.$transaction(async (tx) => {
      await tx.workspaceSettings.upsert({ where: { organizationId: ctx.organizationId }, create: { organizationId: ctx.organizationId, aiPolicy }, update: { aiPolicy } });
      await tx.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "ai_continue_on_credits",
        detail: input.on ? "Slog på Fortsätt med krediter när veckans kvot är slut." : "Stängde av Fortsätt med krediter när veckans kvot är slut." } });
    });
    return NextResponse.json({ usage: await companyAiUsage(ctx.organizationId, { userId: ctx.user.id, kind: "admin" }), canManage: true });
  } catch (error) {
    return failure(error);
  }
}
