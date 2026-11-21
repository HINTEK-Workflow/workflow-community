import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { ApiError, failure } from "@/lib/kfid/server";
import { mapStatus, mapTile } from "@/lib/map/topowebb";

export const dynamic = "force-dynamic";

/**
 * A map tile from our own server (2026-10-04): read from this installation's disk, or once from Lantmäteriet by
 * the server and kept. The browser never contacts Lantmäteriet. Signed-in people only; Topografisk webbkarta
 * Nedladdning, raster ©Lantmäteriet, CC BY 4.0.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  try {
    if (!(await getCurrentUser())) throw new ApiError(401, "Logga in för att fortsätta.");
    const raw = await params;
    const [z, x, y] = [raw.z, raw.x, raw.y.replace(/\.png$/, "")].map((value) => /^\d{1,8}$/.test(value) ? Number(value) : NaN);
    if (![z, x, y].every(Number.isInteger) || z > 22 || x >= 2 ** z || y >= 2 ** z) throw new ApiError(400, "Ogiltig kartruta.");
    const status = await mapStatus();
    if (!status.enabled) throw new ApiError(404, "Kartan är inte påslagen.");
    if (z < status.minZoom || z > status.maxZoom) return new NextResponse(null, { status: 404 });
    const tile = await mapTile(z, x, y);
    // A tile the map does not have (sea, outside Sweden, or outside the QA file's small area): 204 No Content, not 404 –
    // a normal answer that the browser does not log as an error (robot finding #6/#18, 2026-10-24); the viewer shows the
    // place as empty and says so when nothing in view has a picture.
    if (!tile) return new NextResponse(null, { status: 204, headers: { "Cache-Control": "private, max-age=86400" } });
    return new NextResponse(Buffer.from(tile), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=604800", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return failure(error);
  }
}
