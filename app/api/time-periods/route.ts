import { NextResponse } from "next/server";
import { ApiError, body, checkOrigin, context, failure, requireCloudStorage, requireCloudWriteAccess, requireModule } from "@/lib/kfid/server";
import { periodOf, timePeriodSchema } from "@/lib/workflow/time-periods";
import { loadTimePeriods, remindTimePeriod, timePeriodAction } from "@/lib/workflow/time-periods-server";

/**
 * Tidsperiod (2026-10-30): GET ?period=YYYY-MM (default this month) – my month and, for approvers, everyone's; POST
 * { action: submit | approve | return | reopen, period, userId?, note? } or { action: remind, period, userId } (Påminn). Session, company and membership through context();
 * Cloud storage; write access and Origin on changes. Sending in and approving is a person's act in the app, never an API key's.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const raw = new URL(request.url).searchParams.get("period");
    const period = raw ? timePeriodSchema.parse(raw) : periodOf(new Date());
    return NextResponse.json(await loadTimePeriods(ctx, period), { headers: { "Cache-Control": "private, no-store" } });
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
    requireModule(ctx, "time");
    if (ctx.integration) throw new ApiError(403, "Det här görs av en person i appen.");
    const input = await body(request);
    const remind = typeof input === "object" && input !== null && (input as { action?: unknown }).action === "remind";
    return NextResponse.json(remind ? await remindTimePeriod(ctx, input) : await timePeriodAction(ctx, input));
  } catch (error) {
    return failure(error);
  }
}
