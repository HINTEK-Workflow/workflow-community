import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, context, failure, requireCloudStorage, requireModule } from "@/lib/kfid/server";
import { followUpChoices, roundFollowUpsOf } from "@/lib/kfid/round-follow-up-server";

export const dynamic = "force-dynamic";

/**
 * Driftronden som tillsyn (2026-11-27, lib/workflow/round-follow-up.ts), read only:
 * - ?workOrderId= – "Från ronden" on the round's work order: the work orders made from its brister (Akut/Planerad, Öppen/Klar)
 *   that the person may read, and how many brister were fixed on the spot.
 * - ?protocolId=&rowId= – the dialog of Akut or Planerad arbetsorder: the round point's machine, and whether machines can be chosen.
 * Every call checks the session and the company (context), Cloud, the module Driftronder and the person's read rights
 * (lib/kfid/round-follow-up-server.ts). The work order itself is made by POST /api/workflow-tasks (`roundFollowUp`), which also
 * checks Origin, write access and the test account's limits.
 */
const id = z.string().trim().min(1).max(100);
const noStore = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    requireModule(ctx, "rounds");
    const url = new URL(request.url);
    const workOrderId = url.searchParams.get("workOrderId");
    if (workOrderId) return NextResponse.json(await roundFollowUpsOf(ctx, id.parse(workOrderId)), { headers: noStore });
    const protocolId = url.searchParams.get("protocolId");
    if (protocolId) {
      const rowId = url.searchParams.get("rowId");
      return NextResponse.json(await followUpChoices(ctx, id.parse(protocolId), rowId ? id.parse(rowId) : null), { headers: noStore });
    }
    throw new ApiError(400, "Ange arbetsorder eller protokoll.");
  } catch (error) {
    return failure(error);
  }
}
