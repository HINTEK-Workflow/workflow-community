import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { ApiError, failure } from "@/lib/kfid/server";
import { mapStatus } from "@/lib/map/topowebb";

export const dynamic = "force-dynamic";

/** Whether the installation has a map (2026-10-04): without Lantmäteriet's sign-in there is none, and nothing else changes. */
export async function GET() {
  try {
    if (!(await getCurrentUser())) throw new ApiError(401, "Logga in för att fortsätta.");
    return NextResponse.json(await mapStatus(), { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (error) {
    return failure(error);
  }
}
