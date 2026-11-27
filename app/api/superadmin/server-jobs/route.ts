import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, body, checkOrigin, context, failure } from "@/lib/kfid/server";
import { CONTROLLED_JOB_KEYS, serverJobAccess } from "@/lib/ops/server-jobs";
import { readServerJobs, requestJobRun, setJobPaused } from "@/lib/ops/server-jobs-server";

export const dynamic = "force-dynamic";

/**
 * Installation → Drift och säkerhet → Serverjobb (2026-11-14): every scheduled job with its schedule, last and
 * next run, the backups on the database server and the monitor's limits (read-only). The superadmin only, never through an
 * API key. PATCH (Origin) pauses or starts a job that runs in the app; POST (Origin) runs one now. Both are logged. Nothing
 * here runs anything on the database server or changes a schedule.
 */
const key = z.enum(CONTROLLED_JOB_KEYS as [string, ...string[]]);
const pauseInput = z.object({ key, paused: z.boolean() });
const runInput = z.object({ key });

async function superadmin() {
  const ctx = await context({ skipLegal: true });
  const access = serverJobAccess(ctx.user, ctx.integration);
  if (!access.ok) throw new ApiError(access.status, access.message);
  return ctx;
}

export async function GET() {
  try {
    await superadmin();
    return NextResponse.json(await readServerJobs(), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await superadmin();
    const input = pauseInput.parse(await body(request));
    await setJobPaused({ key: input.key, paused: input.paused, actorId: ctx.user.id, organizationId: ctx.organizationId });
    return NextResponse.json({ ok: true, paused: input.paused });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await superadmin();
    const input = runInput.parse(await body(request));
    return NextResponse.json(await requestJobRun({ key: input.key, actorId: ctx.user.id, organizationId: ctx.organizationId }));
  } catch (error) {
    return failure(error);
  }
}
