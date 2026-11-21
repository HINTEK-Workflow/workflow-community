import { NextResponse } from "next/server";
import { context, failure, requireCloudStorage } from "@/lib/kfid/server";
import { parseMyDayTiles } from "@/lib/workflow/my-day";
import { loadMyDay } from "@/lib/workflow/my-day-server";

export const dynamic = "force-dynamic";

/**
 * Hem's chosen tiles Gör detta nu, Förfallet and Mina avvikelser (dashboard etapp 2, 2026-10-28):
 * `GET /api/my-day?tiles=next,overdue,deviations` answers only the asked tiles, for the signed-in person only. The session
 * or key, the active membership, the company and the legal gate come from context(); Cloud only (Local and the demo never
 * offer these tiles); every read follows the person's read rights (lib/workflow/my-day-server.ts). Read only, so no Origin.
 */
export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const tiles = parseMyDayTiles(new URL(request.url).searchParams.get("tiles"));
    if (!tiles.length) return NextResponse.json({ error: "Ange vilka rutor." }, { status: 400 });
    return NextResponse.json(await loadMyDay(ctx, tiles), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}
