import { NextResponse } from "next/server";
import { context, failure, requireCloudStorage } from "@/lib/kfid/server";
import { archiveQuery } from "@/lib/workflow/report-archive";
import { listArchive } from "@/lib/workflow/report-archive-server";

export const dynamic = "force-dynamic";

/**
 * Rapportarkiv (2026-10-07): the reports the signed-in person may read, newest first, a page at a time ("Visa fler"
 * sends the id of the last one as `cursor`). Mina = the ones they kept; Alla = every one of the areas they may read.
 * Bound to the person's active company; the permission is the one that lets them read the tasks the reports are of.
 */
export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const result = await listArchive(ctx, archiveQuery(new URL(request.url).searchParams));
    return NextResponse.json({ ...result, retentionMonths: ctx.organization.historyRetentionMonths }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}
