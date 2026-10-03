import { NextResponse } from "next/server";
import { z } from "zod";
import { digestJobTokenValid } from "@/lib/ai/daily-digest";
import { runDailyDigests } from "@/lib/ai/daily-digest-server";
import { getAiSharingPolicy } from "@/lib/ai/sharing-policy";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { ApiError, context, failure } from "@/lib/kfid/server";
import { hasWorkflowPermission } from "@/lib/workflow/permissions";
import { swedishDayKey } from "@/lib/swedish-time";

export const dynamic = "force-dynamic";

/**
 * The latest digest for the person's company, for Översikt: the day, the text and the numbers. Only numbers and
 * project names are in it, and it is shown to those who may read the company's projects.
 */
export async function GET() {
  try {
    const ctx = await context();
    const policy = await getAiSharingPolicy(ctx.organizationId);
    if (!policy.enabled || !policy.dailyDigest) return NextResponse.json({ enabled: false, digest: null });
    if (!ctx.admin && !hasWorkflowPermission(ctx.workflowPermissions, "projects", "read")) return NextResponse.json({ enabled: true, digest: null });
    const digest = await prisma.aiDailyDigest.findFirst({ where: { organizationId: ctx.organizationId }, orderBy: { day: "desc" }, select: { day: true, text: true, facts: true, source: true } });
    // An old digest says nothing about how things stand now.
    const fresh = digest && Date.now() - Date.parse(`${digest.day}T12:00:00Z`) < 4 * 24 * 60 * 60 * 1000;
    return NextResponse.json({ enabled: true, digest: fresh ? digest : null });
  } catch (error) {
    return failure(error);
  }
}

const jobSchema = z.object({ day: z.iso.date().optional() }).strict();

/**
 * The night job (scripts/ai/run-daily-digest.ts) asks the running app to write the digests. No session: the job
 * proves itself with a key derived from the server's own secret for today. Answers with counts only.
 */
export async function POST(request: Request) {
  try {
    const token = /^Bearer\s+([0-9a-f]{64})$/.exec(request.headers.get("authorization") ?? "")?.[1];
    if (!token || !digestJobTokenValid(env.AUTH_SECRET, swedishDayKey(new Date()), token)) throw new ApiError(401, "Jobbnyckeln är ogiltig.");
    const text = await request.text();
    const input = jobSchema.parse(text ? JSON.parse(text) : {});
    return NextResponse.json(await runDailyDigests(new Date(), input.day));
  } catch (error) {
    return failure(error);
  }
}
