import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, body, checkOrigin, failure, signedInAuth } from "@/lib/kfid/server";
import { productOperatorSettings, saveProductOperatorSettings } from "@/lib/operator/settings-server";

export const dynamic = "force-dynamic";

/**
 * Installation → Inloggning → Operatörssidan (2026-10-30): the product owner's switch for the prepared
 * AI troubleshooting step. Off by default; with it off no company sees the step and nothing is asked.
 */
async function superadmin() {
  const auth = await signedInAuth();
  if (!auth) throw new ApiError(401, "Logga in för att fortsätta.");
  if (auth.user.role !== "SUPERADMIN") throw new ApiError(403, "Bara installationens administratör kan göra det.");
  return auth;
}

export async function GET() {
  try {
    await superadmin();
    return NextResponse.json(await productOperatorSettings(), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    await superadmin();
    const input = z.object({ aiTroubleshooting: z.boolean() }).strict().parse(await body(request));
    await saveProductOperatorSettings(input);
    return NextResponse.json(input);
  } catch (error) {
    return failure(error);
  }
}
