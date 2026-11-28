import { NextResponse } from "next/server";
import { ApiError, failure, signedInAuth } from "@/lib/kfid/server";
import { platformChainStatus } from "@/lib/traceability/chain-server";

export const dynamic = "force-dynamic";

/**
 * Installation → Drift och säkerhet → Loggarnas kedja (K3.1, 2026-11-27): how many log chains the nightly check
 * looked at, and every broken one with the company's name, which log and where. Metadata only – never a row of a company's
 * log. The superadmin only; read only.
 */
export async function GET() {
  try {
    const auth = await signedInAuth();
    if (!auth) throw new ApiError(401, "Logga in för att fortsätta.");
    if (auth.user.role !== "SUPERADMIN") throw new ApiError(403, "Bara installationens administratör kan göra det.");
    return NextResponse.json(await platformChainStatus(), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}
