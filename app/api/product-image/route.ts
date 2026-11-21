import { NextResponse } from "next/server";
import { productImageAnswer } from "@/lib/catalogue/product-image";
import { context, failure } from "@/lib/kfid/server";
import { hitRateLimit, RATE_RULES } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

/**
 * A supplier's product picture from our own server (2026-11-02), the same way as the map's tiles: the browser never contacts
 * the supplier. Signed-in members of a company only; no catalogue permission of its own, since the picture shows on any row the person
 * may read and is no company's data. The address must be signed by this server or known from the supplier's API (lib/catalogue/product-image.ts);
 * how it is fetched is lib/security/external-image.ts. GET only: a browser's <img> sends no Origin, and nothing changes here.
 */
export async function GET(request: Request) {
  try {
    const ctx = await context();
    if (!(await hitRateLimit(RATE_RULES.productImageUser, ctx.user.id)).allowed) return new NextResponse(null, { status: 429, headers: { "Cache-Control": "private, no-store" } });
    return await productImageAnswer(request, ctx.organizationId);
  } catch (error) {
    return failure(error);
  }
}
