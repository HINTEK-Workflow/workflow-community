import QRCode from "qrcode";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { absoluteUrl } from "@/lib/env";
import { ApiError, context, failure, requireCloudStorage } from "@/lib/kfid/server";

export const dynamic = "force-dynamic";

/** The address a place's QR label opens: short, so the code stays small and easy to scan. */
const placeLabelUrl = (placeId: string) => absoluteUrl(`/p/${encodeURIComponent(placeId)}`);

/**
 * A place's QR code as SVG (2026-10-04): made on this server with the qrcode package, no outside service. The
 * code holds only the place's address; scanning it without being signed in leads to the login and then to the place.
 */
export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const id = z.string().min(1).max(100).parse(new URL(request.url).searchParams.get("id"));
    const place = await prisma.customerFacility.findFirst({ where: { id, organizationId: ctx.organizationId }, select: { id: true } });
    if (!place) throw new ApiError(404, "Platsen finns inte i ditt företag.");
    const svg = await QRCode.toString(placeLabelUrl(place.id), { type: "svg", errorCorrectionLevel: "M", margin: 1, color: { dark: "#000000", light: "#ffffff" } });
    return new Response(svg, { headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return failure(error);
  }
}
